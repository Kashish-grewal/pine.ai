const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { structureSession } = require('./structuring');
// ── Simple sequential job queue ─────────────────────────────────────
// WhisperX loads a ~3GB model into GPU memory. Running multiple
// transcriptions simultaneously will crash or stall the machine.
// This queue ensures only ONE transcription runs at a time.
// ────────────────────────────────────────────────────────────────────
const jobQueue = [];
let isProcessing = false;

const enqueueSession = (sessionId, filePath) => {
  return new Promise((resolve, reject) => {
    jobQueue.push({ sessionId, filePath, resolve, reject });
    console.log(`[Queue] Session ${sessionId} queued (position ${jobQueue.length})`);
    processQueue();
  });
};

// ── Pipeline timeout — kills stuck sessions after 30 min ────────────
const PIPELINE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const withTimeout = (promise, ms, sessionId) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Pipeline timeout: session ${sessionId} exceeded ${ms / 60000} minutes`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const processQueue = async () => {
  if (isProcessing || jobQueue.length === 0) return;
  isProcessing = true;

  const { sessionId, filePath, resolve, reject } = jobQueue.shift();
  console.log(`[Queue] Starting session ${sessionId} (${jobQueue.length} remaining in queue)`);

  try {
    await withTimeout(processSession(sessionId, filePath), PIPELINE_TIMEOUT_MS, sessionId);
    resolve();
  } catch (err) {
    reject(err);
  } finally {
    isProcessing = false;
    // Process next job if any
    if (jobQueue.length > 0) {
      processQueue();
    }
  }
};
const { pool }           = require('../db/db');
const { transcribeAudio } = require('./transcription');
const {
  buildTranscriptionMetadata,
  extractFrequentTermsFromTexts,
  sanitizePhraseArray,
} = require('./transcriptionMetadata');

// Keep the API alive even if the optional speaker post-process module is missing.
let correctSpeakers = (utterances) => utterances;
let relabelSpeakers = (utterances) => utterances;
let detectCandidateLabel = () => null;

try {
  ({ correctSpeakers, relabelSpeakers, detectCandidateLabel } = require('./postprocess'));
} catch (err) {
  console.warn('[Pipeline] postprocess.js not available; continuing without speaker correction:', err.message);
}

// ================================================================
// PROCESSING PIPELINE
// ================================================================
// Flow:
//   1. Set status = 'processing'
//   2. Fetch session metadata (participants list, speaker count)
//   3. Call WhisperX → get diarized utterances (fallback: Groq)
//   4. Post-process: fix misattributed speaker labels
//   5. LLM correction: fix misheard words using domain context (NEW)
//   6. Save each corrected segment to the transcripts table
//   7. Set status = 'completed' + save duration
//   8. Delete audio file from disk
//
// If anything fails → set status = 'failed' + save error message
// ================================================================

const buildTranscriptionOptions = (metadata) => ({
  expectedSpeakerCount: metadata.expectedSpeakerCount,
  languageLocale: metadata.languageLocale,
  participantNames: metadata.participantNames,
  keywordBoostList: metadata.keywordBoostList,
  voiceProfilesPath: metadata.voiceProfilesPath || null,
});

const transcribeWithRetries = async (filePath, options, phaseLabel) => {
  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.log(`[Pipeline] ${phaseLabel} transcription attempt ${attempt}/${maxAttempts}`);
      return await transcribeAudio(filePath, options);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        console.warn(`[Pipeline] ${phaseLabel} transcription attempt ${attempt} failed: ${err.message}`);
      }
    }
  }

  throw lastError;
};

const processSession = async (sessionId, filePath) => {
  try {
    console.log(`[Pipeline] Starting session ${sessionId}`);

    // Step 1 — Mark session as processing
    await pool.query(
      `UPDATE sessions
       SET status = 'processing', updated_at = NOW()
       WHERE session_id = $1`,
      [sessionId]
    );

    // ── Step 2 — Fetch and build transcription metadata ─────────────
    const { rows } = await pool.query(
      `SELECT user_id, title, description, participants, expected_speaker_count,
              language_locale, user_keywords
       FROM sessions
       WHERE session_id = $1`,
      [sessionId]
    );

    if (rows.length === 0) {
      throw new Error(`Session ${sessionId} not found.`);
    }

    const sessionRow = rows[0];
    const historicalTranscriptResult = await pool.query(
      `SELECT t.text_segment
       FROM transcripts t
       INNER JOIN sessions s ON s.session_id = t.session_id
       WHERE s.user_id = $1 AND s.session_id <> $2
       ORDER BY t.created_at DESC
       LIMIT 600`,
      [sessionRow.user_id, sessionId]
    );

    const historicalKeywordResult = await pool.query(
      `SELECT user_keywords
       FROM sessions
       WHERE user_id = $1
         AND session_id <> $2
         AND user_keywords IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 40`,
      [sessionRow.user_id, sessionId]
    );

    const historicalTerms = extractFrequentTermsFromTexts(
      historicalTranscriptResult.rows.map((row) => row.text_segment),
      40
    );

    const historicalConfirmedKeywords = sanitizePhraseArray(
      historicalKeywordResult.rows.flatMap((row) => {
        if (Array.isArray(row.user_keywords)) return row.user_keywords;
        return [];
      }),
      { maxItems: 60 }
    );

    const participants = Array.isArray(sessionRow.participants) ? sessionRow.participants : [];
    // If user didn't specify expected_speaker_count, default to participant count.
    // This prevents pyannote from over-detecting speakers (e.g. finding 5 when there are 2).
    const expectedSpeakerCount =
      sessionRow.expected_speaker_count ||
      (participants.length > 0 ? participants.length : null);

    const transcriptionMetadata = buildTranscriptionMetadata({
      participantNames: participants,
      expectedSpeakerCount,
      languageLocale: sessionRow.language_locale,
      userKeywords: sessionRow.user_keywords,
      title: sessionRow.title,
      description: sessionRow.description,
      historicalTerms,
      historicalConfirmedKeywords,
    });

    await pool.query(
      `UPDATE sessions
       SET auto_keywords = $2::jsonb,
           transcription_metadata = $3::jsonb,
           updated_at = NOW()
       WHERE session_id = $1`,
      [
        sessionId,
        JSON.stringify(transcriptionMetadata.keywordBoostList),
        JSON.stringify(transcriptionMetadata),
      ]
    );

    const transcriptionOptions = buildTranscriptionOptions(transcriptionMetadata);

    // ── Step 2b — Fetch voice profiles for this user ─────────────────
    let voiceProfilesPath = null;
    try {
      const vpResult = await pool.query(
        'SELECT speaker_name, embedding FROM voice_profiles WHERE user_id = $1',
        [sessionRow.user_id]
      );
      if (vpResult.rows.length > 0) {
        const profiles = vpResult.rows.map((r) => ({
          name: r.speaker_name,
          embedding: typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding,
        }));
        voiceProfilesPath = path.join(os.tmpdir(), `pine_profiles_${sessionId}.json`);
        fs.writeFileSync(voiceProfilesPath, JSON.stringify(profiles));
        transcriptionOptions.voiceProfilesPath = voiceProfilesPath;
        console.log(`[Pipeline] Loaded ${profiles.length} voice profiles for speaker matching`);
      }
    } catch (vpErr) {
      console.warn(`[Pipeline] Could not load voice profiles: ${vpErr.message}`);
    }

    // ── Step 3 — Transcribe audio with WhisperX (or Groq fallback) ──
    console.log(`[Pipeline] Starting transcription...`);
    let transcriptionResult = await transcribeWithRetries(
      filePath,
      transcriptionOptions,
      'initial'
    );

    // If the first pass returns no segments, do a second pass
    if ((transcriptionResult.segments || []).length === 0) {
      console.warn('[Pipeline] No segments in initial pass. Running second pass.');
      transcriptionResult = await transcribeWithRetries(
        filePath,
        transcriptionOptions,
        'second-pass'
      );
    }

    const { segments, duration } = transcriptionResult;
    const method = transcriptionResult.method || 'unknown';
    console.log(`[Pipeline] Got ${segments.length} segments, duration ${duration}s (via ${method})`);

    // ── Step 4 — Post-process speaker labels ────────────────────────
    // Apply rule-based corrections (honorifics, name detection, short orphans)
    let processedSegments = segments;

    if (segments.length > 0 && transcriptionResult.method === 'whisperx') {
      // Convert to utterance-like format for postprocess compatibility
      const utteranceLike = segments.map((s) => ({
        speaker: s.speaker_label,
        text: s.text_segment,
        start: s.start_time * 1000, // seconds → ms for postprocess
        end: s.end_time * 1000,
      }));

      let correctedUtterances = correctSpeakers(utteranceLike, {
        participantNames: transcriptionMetadata.participantNames,
      });

      // If participant names provided, try to relabel speakers
      if (transcriptionMetadata.participantNames.length > 0) {
        const candidateLabel = detectCandidateLabel(correctedUtterances);
        if (candidateLabel) {
          correctedUtterances = relabelSpeakers(
            correctedUtterances,
            candidateLabel,
            transcriptionMetadata.participantNames[0]
          );
        }
      }

      // Convert back to segment format
      processedSegments = correctedUtterances.map((u) => ({
        speaker_label: u.speaker,
        start_time: u.start / 1000,   // ms → seconds
        end_time: u.end / 1000,
        text_segment: u.text,
      }));
    }
    // ── Step 6 — Save each segment to transcripts table ─────────────
    // Normalize speaker labels → clean "Speaker 1", "Speaker 2", etc.
    // Handles SPEAKER_00, Speaker A, SPEAKER_01, unknown labels, etc.
    const labelMap = {};
    let speakerCounter = 1;
    let finalSegments = processedSegments.map(seg => {
      const raw = seg.speaker_label || 'Unknown';
      if (!labelMap[raw]) {
        labelMap[raw] = `Speaker ${speakerCounter++}`;
      }
      return { ...seg, speaker_label: labelMap[raw] };
    });
    console.log('[Pipeline] Speaker label map:', labelMap);

    // Batch insert — single query instead of N individual INSERTs
    if (finalSegments.length > 0) {
      const BATCH_SIZE = 200; // pg has a ~65535 param limit; 200 rows × 5 cols = 1000 params
      for (let b = 0; b < finalSegments.length; b += BATCH_SIZE) {
        const batch = finalSegments.slice(b, b + BATCH_SIZE);
        const values = [];
        const params = [];
        batch.forEach((seg, i) => {
          const offset = i * 5;
          values.push(`($${offset+1}, $${offset+2}, $${offset+3}, $${offset+4}, $${offset+5})`);
          params.push(sessionId, seg.speaker_label, seg.start_time, seg.end_time, seg.text_segment);
        });
        await pool.query(
          `INSERT INTO transcripts (session_id, speaker_label, start_time, end_time, text_segment)
           VALUES ${values.join(', ')}`,
          params
        );
      }
      console.log(`[Pipeline] Inserted ${finalSegments.length} transcript segments (batched)`);
    }


    // ── Step 7 — Mark session as completed ──────────────────────────
    await pool.query(
      `UPDATE sessions
       SET status = 'completed', duration_secs = $2, updated_at = NOW()
       WHERE session_id = $1`,
      [sessionId, Math.round(duration)]
    );

    // ── Step 8.5 — Structure the transcript (tasks, summary, expenses)
    try {
      await structureSession(
        sessionId,
        sessionRow.user_id,
        finalSegments,
        sessionRow.title,
        transcriptionMetadata.participantNames
      );
    } catch (structureErr) {
      console.warn('[Pipeline] Structuring failed (non-fatal):', structureErr.message);
    }

    // ── Step 8 — Delete audio file ───────────────────────────────────
    fs.unlink(filePath, (err) => {
      if (err) console.warn(`[Pipeline] Could not delete file: ${filePath}`);
    });

    console.log(`[Pipeline] ✅ Session ${sessionId} completed (${method}).`);

  } catch (err) {
    console.error(`[Pipeline] ❌ Session ${sessionId} failed:`, err.message);

    await pool.query(
      `UPDATE sessions
       SET status = 'failed', error_message = $2, updated_at = NOW()
       WHERE session_id = $1`,
      [sessionId, err.message]
    ).catch(() => {});
  }
};

module.exports = { processSession: enqueueSession };