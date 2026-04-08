const fs   = require('fs');
const { pool }           = require('../db/db');
const { transcribeAudio} = require('./transcription');

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
//   3. Call AssemblyAI → get diarized utterances
//   4. Post-process: fix misattributed speaker labels  ← NEW
//   5. Save each corrected segment to the transcripts table
//   6. Set status = 'completed' + save duration
//   7. Delete audio file from disk
//
// If anything fails → set status = 'failed' + save error message
// ================================================================

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

    // ── Step 2 — Fetch session metadata ─────────────────────────────
    // We need `participants` (JSONB array of names) so we can:
    //   a) pass speakers_expected to AssemblyAI
    //   b) boost name recognition
    //   c) relabel "Speaker A" → "Monica" after the fact
    // ──────────────────────────────────────────────────────────────────
    const { rows } = await pool.query(
      `SELECT participants FROM sessions WHERE session_id = $1`,
      [sessionId]
    );

    const participants = rows[0]?.participants || [];       // e.g. ["Monica", "Interviewer"]
    const speakersExpected = participants.length > 0
      ? participants.length
      : undefined;

    // ── Step 3 — Transcribe audio with AssemblyAI ────────────────────
    console.log(`[Pipeline] Sending to AssemblyAI...`);
    const { segments, duration, rawUtterances } = await transcribeAudio(filePath, {
      speakersExpected,
      participants,
    });
    console.log(`[Pipeline] Got ${segments.length} segments, duration ${duration}s`);

    // ── Step 4 — Post-process speaker labels ────────────────────────
    // Only runs if we have raw utterances (not the single-segment fallback)
    let processedUtterances = rawUtterances;

    if (rawUtterances.length > 0) {
      // Rule-based correction (honorifics, name detection, short orphans)
      processedUtterances = correctSpeakers(rawUtterances, { participantNames: participants });

      // If the first participant name is the candidate, relabel A→"Monica" etc.
      if (participants.length > 0) {
        const candidateLabel = detectCandidateLabel(processedUtterances);
        if (candidateLabel) {
          processedUtterances = relabelSpeakers(
            processedUtterances,
            candidateLabel,
            participants[0]       // treat first name as the candidate
          );
        }
      }
    }

    // Convert processed utterances back to the segments shape the DB expects.
    // If post-processing ran, use processedUtterances; otherwise fall back to
    // the segments that transcribeAudio() already built.
    const finalSegments = rawUtterances.length > 0
      ? processedUtterances.map((u) => ({
          speaker_label: u.speaker,                // now "Monica" / "Panelist 1" etc.
          start_time:    u.start / 1000,
          end_time:      u.end   / 1000,
          text_segment:  u.text,
        }))
      : segments;

    // ── Step 5 — Save each segment to transcripts table ─────────────
    for (const segment of finalSegments) {
      await pool.query(
        `INSERT INTO transcripts (session_id, speaker_label, start_time, end_time, text_segment)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          sessionId,
          segment.speaker_label,
          segment.start_time,
          segment.end_time,
          segment.text_segment,
        ]
      );
    }

    // ── Step 6 — Mark session as completed ──────────────────────────
    await pool.query(
      `UPDATE sessions
       SET status = 'completed', duration_secs = $2, updated_at = NOW()
       WHERE session_id = $1`,
      [sessionId, Math.round(duration)]
    );

    // ── Step 7 — Delete audio file ───────────────────────────────────
    fs.unlink(filePath, (err) => {
      if (err) console.warn(`[Pipeline] Could not delete file: ${filePath}`);
    });

    console.log(`[Pipeline] ✅ Session ${sessionId} completed.`);

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

module.exports = { processSession };