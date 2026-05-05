const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const Groq = require('groq-sdk');

// ================================================================
// TRANSCRIPTION SERVICE
// ================================================================
// Strategy:
//   1. Groq API  → fast transcription (Whisper large-v3, cloud)
//   2. LLM diarization → Groq assigns Speaker 1/2/3 from context
//   3. Pyannote → only if GPU available (WHISPERX_DEVICE=cuda)
//   4. WhisperX local → offline fallback
//
// Why skip Pyannote on CPU?
//   - 5min audio = 10min processing, still inaccurate
//   - LLM diarization is faster, free, and uses conversational context
//   - Pyannote is kept for GPU environments where it shines
// ================================================================

const PYTHON_DIR      = path.join(__dirname, '..', 'python');
const VENV_PYTHON     = path.join(PYTHON_DIR, 'venv', 'bin', 'python3');
const TRANSCRIBE_SCRIPT = path.join(PYTHON_DIR, 'transcribe.py');
const MAX_FILE_SIZE_MB  = 24; // Groq limit is 25MB, keep buffer

const isWhisperXAvailable = () =>
  fs.existsSync(VENV_PYTHON) && fs.existsSync(TRANSCRIBE_SCRIPT);

const isGpuAvailable = () =>
  (process.env.WHISPERX_DEVICE || 'cpu').toLowerCase() === 'cuda';

const { getGroq } = require('./groqClient');

// ================================================================
// FILE SPLITTING — Handle audio files > 24MB
// ================================================================
const splitAudioFile = async (filePath, maxSizeMB = MAX_FILE_SIZE_MB) => {
  const stats = fs.statSync(filePath);
  const sizeMB = stats.size / (1024 * 1024);

  if (sizeMB <= maxSizeMB) return [filePath];

  console.log(`[Transcription] File ${sizeMB.toFixed(1)}MB > ${maxSizeMB}MB — splitting...`);

  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execPromise = promisify(exec);

  let duration = 300;

  try {
    const { stdout } = await execPromise(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { maxBuffer: 1024 * 1024 }
    );
    duration = parseFloat(stdout.trim()) || 300;
  } catch {}

  const numChunks = Math.ceil(sizeMB / (maxSizeMB * 0.8));
  const chunkSecs = Math.floor(duration / numChunks);

  console.log(
    `[Transcription] Duration: ${duration}s, splitting into ~${numChunks} chunks of ${chunkSecs}s`
  );

  const tempDir = path.join(os.tmpdir(), `pine-split-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const outputPattern = path.join(tempDir, "chunk_%03d.mp3");

  try {
    await execPromise(
      `ffmpeg -i "${filePath}" -f segment -segment_time ${chunkSecs} -acodec libmp3lame -ab 64k -ac 1 "${outputPattern}" -y 2>/dev/null`,
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 5 * 60 * 1000
      }
    );
  } catch (err) {
    console.error("[Transcription] ffmpeg split failed:", err.message);
    return [filePath];
  }

  const chunks = fs.readdirSync(tempDir)
    .filter(f => f.startsWith("chunk_") && f.endsWith(".mp3"))
    .sort()
    .map(f => path.join(tempDir, f));

  if (chunks.length === 0) {
    console.warn("[Transcription] No chunks created — using original file");
    return [filePath];
  }

  chunks.forEach((c, i) => {
    const mb = fs.statSync(c).size / (1024 * 1024);
    console.log(`[Transcription] Chunk ${i + 1}: ${mb.toFixed(1)}MB`);
  });

  console.log(`[Transcription] Split into ${chunks.length} chunks`);
  return chunks;
};

 

// ================================================================
// GROQ TRANSCRIPTION — Single chunk
// ================================================================
const transcribeChunkWithGroq = async (filePath, startOffset = 0, options = {}) => {
  const language = (options.languageLocale || 'en').split(/[-_]/)[0].toLowerCase();
  const buffer   = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', buffer, { filename: fileName });
  form.append('model', 'whisper-large-v3');
  form.append('response_format', 'verbose_json');
  form.append('language', language);
  form.append('timestamp_granularities[]', 'segment');

  const response = await axios.post(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    form,
    {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      maxContentLength: 100 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
    }
  );

  const data = response.data;
  const segments = (data.segments || []).map(seg => ({
    speaker_label: 'Speaker 1', // placeholder — LLM will assign
    start_time:    (seg.start || 0) + startOffset,
    end_time:      (seg.end   || 0) + startOffset,
    text_segment:  (seg.text  || '').trim(),
  }));

  if (segments.length === 0 && data.text) {
    segments.push({
      speaker_label: 'Speaker 1',
      start_time:    startOffset,
      end_time:      (data.duration || 0) + startOffset,
      text_segment:  data.text.trim(),
    });
  }

  return { segments, duration: data.duration || 0, language: data.language || language };
};

// ================================================================
// GROQ TRANSCRIPTION — Full file (handles splitting)
// ================================================================
const transcribeWithGroq = async (filePath, options = {}) => {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
  console.log('[Transcription] Using Groq (Whisper large-v3)...');

  const chunks = await splitAudioFile(filePath);
  if (chunks.length === 1) {
    const result = await transcribeChunkWithGroq(filePath, 0, options);
    console.log(`[Transcription] Groq done — ${result.segments.length} segments, ${result.duration}s`);
    return { ...result, method: 'groq' };
  }

  // Multiple chunks
  const allSegments = [];
  let totalDuration = 0;
  let language = 'en';
  const tempDir = chunks.length > 0 ? path.dirname(chunks[0]) : null;

  try {
    for (let i = 0; i < chunks.length; i++) {
      console.log(`[Transcription] Chunk ${i + 1}/${chunks.length}...`);
      try {
        const r = await transcribeChunkWithGroq(chunks[i], totalDuration, options);
        allSegments.push(...r.segments);
        totalDuration += r.duration;
        language = r.language;
      } catch (err) {
        console.error(`[Transcription] Chunk ${i + 1} failed: ${err.message}`);
        // Exponential backoff on failure before retrying next chunk
        if (i < chunks.length - 1) {
          await new Promise(r => setTimeout(r, 3000 * Math.pow(2, Math.min(i, 3))));
        }
      }
      // Cleanup individual chunk file immediately
      fs.unlink(chunks[i], () => {});
    }
  } finally {
    // Always cleanup temp dir, even on crash
    if (tempDir && tempDir.includes('pine-split-')) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { }
    }
  }

  console.log(`[Transcription] Groq done — ${allSegments.length} segments, ${totalDuration}s`);
  return { segments: allSegments, duration: totalDuration, language, method: 'groq' };
};

// ================================================================
// LLM DIARIZATION — Assign speaker labels using conversational context
// ================================================================
// This replaces Pyannote on CPU. The LLM reads the transcript and
// identifies speaker changes based on:
//   - Conversational flow (question → answer)
//   - Direct address ("Hey Don", "Yes sir")
//   - Self-reference ("I will", "My team")
//   - Topic ownership and speaking style
// ================================================================

const diarizeWithLLM = async (segments, options = {}) => {
  if (!process.env.GROQ_API_KEY) {
    console.warn('[LLM Diarization] No GROQ_API_KEY — skipping');
    return segments;
  }

  const { expectedSpeakerCount = 2, participantNames = [] } = options;
  const speakerCount = Math.min(Math.max(parseInt(expectedSpeakerCount) || 2, 1), 10);

  console.log(`[LLM Diarization] Assigning speakers to ${segments.length} segments (expecting ${speakerCount} speakers)...`);

  // Process in chunks of 80 segments with 10-segment overlap for context continuity
  const CHUNK_SIZE = 80;
  const OVERLAP    = 10;
  const result     = [...segments];

  for (let start = 0; start < segments.length; start += CHUNK_SIZE - OVERLAP) {
    const end   = Math.min(start + CHUNK_SIZE, segments.length);
    const chunk = segments.slice(start, end);
    const chunkNum   = Math.floor(start / (CHUNK_SIZE - OVERLAP)) + 1;
    const totalChunks = Math.ceil(segments.length / (CHUNK_SIZE - OVERLAP));

    console.log(`[LLM Diarization] Chunk ${chunkNum}/${totalChunks} (segments ${start}–${end})...`);

    // Use LOCAL indices (0-based within this chunk) to avoid confusing the LLM
    const transcriptText = chunk
      .map((seg, i) => `[${i}] ${seg.text_segment}`)
      .join('\n');

    const participantHint = participantNames.length > 0
      ? `\nKnown participants: ${participantNames.join(', ')}`
      : '';

    const system = `You are an expert at identifying speaker changes in transcripts.
Assign a speaker label to each numbered segment based on conversational flow.
Return ONLY a valid JSON object mapping segment index to speaker label. No markdown, no explanation.
Format: { "0": "Speaker 1", "1": "Speaker 2", "2": "Speaker 1" }
Rules:
- Use exactly ${speakerCount} distinct speaker(s): "Speaker 1" through "Speaker ${speakerCount}"
- Identify speaker changes from: questions vs answers, direct address, topic switches, self-references
- Be consistent — same person = same label throughout
- When uncertain, continue previous speaker rather than switching${participantHint}`;

    const user = `Assign speaker labels to these ${chunk.length} segments:\n\n${transcriptText}`;

    try {
      const response = await getGroq().chat.completions.create({
        model:       'llama-3.3-70b-versatile',
        temperature: 0.1, // low temp = more consistent
        max_tokens:  1000,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user   },
        ],
      });

      const raw     = response.choices[0]?.message?.content || '';
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const mapping = JSON.parse(cleaned);

      // Remap LOCAL indices back to GLOBAL indices and apply
      const applyFrom = start === 0 ? 0 : OVERLAP; // skip overlap segments from prev chunk
      for (let localIdx = applyFrom; localIdx < chunk.length; localIdx++) {
        const globalIdx = start + localIdx;
        const label = mapping[String(localIdx)];
        if (label && /^Speaker \d+$/.test(label)) {
          result[globalIdx] = { ...result[globalIdx], speaker_label: label };
        }
      }
    } catch (err) {
      console.warn(`[LLM Diarization] Chunk ${chunkNum} failed: ${err.message} — keeping "Speaker 1"`);
    }

    // Rate limit: exponential backoff between chunks
    if (end < segments.length) {
      const delay = 2000 * Math.pow(1.5, Math.min(chunkNum - 1, 4)); // 2s → 3s → 4.5s → max ~11s
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // Count unique speakers assigned
  const speakers = new Set(result.map(s => s.speaker_label));
  console.log(`[LLM Diarization] ✅ Done — ${speakers.size} speaker(s) identified: ${[...speakers].join(', ')}`);

  return result;
};

// ================================================================
// PYANNOTE DIARIZATION — Only runs on GPU
// ================================================================
const addDiarizationWithPyannote = (filePath, groqSegments, options = {}) => {
  return new Promise((resolve) => {
    const { expectedSpeakerCount, voiceProfilesPath } = options;
    const hfToken = process.env.HF_TOKEN || '';

    if (!hfToken || !isWhisperXAvailable() || !isGpuAvailable()) {
      console.log('[Transcription] Pyannote skipped (requires GPU + HF_TOKEN)');
      resolve(null); // null = not run
      return;
    }

    console.log('[Transcription] Running Pyannote diarization (GPU mode)...');

    const outputJson = path.join(os.tmpdir(), `pine_diarize_${Date.now()}.json`);
    const args = [
      TRANSCRIBE_SCRIPT, filePath, outputJson,
      '--hf-token', hfToken,
      '--device', 'cuda',
      '--model', 'tiny',
      '--language', 'en',
    ];

    if (expectedSpeakerCount > 0) args.push('--speakers', String(expectedSpeakerCount));
    if (voiceProfilesPath)       args.push('--voice-profiles', voiceProfilesPath);

    const proc = spawn(VENV_PYTHON, args, {
      cwd: PYTHON_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      timeout: 20 * 60 * 1000,
    });

    proc.stderr.on('data', d => console.log(`  ${d.toString().trim()}`));

    proc.on('error', err => {
      console.warn(`[Transcription] Pyannote failed to start: ${err.message}`);
      resolve(null);
    });

    proc.on('close', code => {
      if (code !== 0) { resolve(null); return; }

      try {
        const diarizeResult = JSON.parse(fs.readFileSync(outputJson, 'utf-8'));
        fs.unlink(outputJson, () => {});

        const diarizedSegs = diarizeResult.segments || [];
        if (diarizedSegs.length === 0) { resolve(null); return; }

        // Map Groq segments to Pyannote speaker labels
        const labeled = groqSegments.map(seg => {
          const mid   = (seg.start_time + seg.end_time) / 2;
          const match = diarizedSegs.find(d => mid >= d.start && mid <= d.end);
          return { ...seg, speaker_label: match ? match.speaker : seg.speaker_label };
        });

        // Normalize to "Speaker 1", "Speaker 2" format
        const labelMap = {};
        let counter = 1;
        const normalized = labeled.map(seg => {
          if (!labelMap[seg.speaker_label]) labelMap[seg.speaker_label] = `Speaker ${counter++}`;
          return { ...seg, speaker_label: labelMap[seg.speaker_label] };
        });

        const speakers = new Set(normalized.map(s => s.speaker_label));
        console.log(`[Transcription] Pyannote done — ${speakers.size} speakers`);
        resolve(normalized);
      } catch (err) {
        console.warn(`[Transcription] Pyannote parse error: ${err.message}`);
        resolve(null);
      }
    });
  });
};

// ================================================================
// WhisperX LOCAL — Full offline fallback
// ================================================================
const transcribeWithWhisperX = (filePath, options = {}) => {
  return new Promise((resolve, reject) => {
    const { expectedSpeakerCount, languageLocale, participantNames = [], keywordBoostList = [] } = options;

    const outputJson = path.join(os.tmpdir(), `pine_transcription_${Date.now()}.json`);
    const language   = languageLocale ? languageLocale.split(/[-_]/)[0].toLowerCase() : null;
    const model      = process.env.WHISPERX_MODEL || 'medium';
    const device     = process.env.WHISPERX_DEVICE || 'cpu';

    const args = [TRANSCRIBE_SCRIPT, filePath, outputJson];
    if (language && language !== 'auto') args.push('--language', language);
    if (expectedSpeakerCount > 0) args.push('--speakers', String(expectedSpeakerCount));

    const boostWords = [...new Set([...participantNames, ...keywordBoostList])];
    if (boostWords.length > 0) args.push('--boost', boostWords.join(','));

    const hfToken = process.env.HF_TOKEN || '';
    if (hfToken) args.push('--hf-token', hfToken);

    args.push('--device', device, '--model', model);

    console.log(`[Transcription] WhisperX local (model=${model}, device=${device})`);

    let stderrOutput = '';
    const proc = spawn(VENV_PYTHON, args, {
      cwd: PYTHON_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      timeout: 45 * 60 * 1000,
    });

    proc.stderr.on('data', d => {
      const line = d.toString().trim();
      if (line) { console.log(`  ${line}`); stderrOutput += line + '\n'; }
    });

    proc.on('error', err => reject(new Error(`WhisperX failed to start: ${err.message}`)));

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`WhisperX exited code ${code}. Stderr: ${stderrOutput.slice(-500)}`));
        return;
      }
      try {
        const output   = JSON.parse(fs.readFileSync(outputJson, 'utf-8'));
        fs.unlink(outputJson, () => {});

        const segments = (output.segments || []).map(seg => ({
          speaker_label: seg.speaker || 'Speaker 1',
          start_time:    seg.start || 0,
          end_time:      seg.end   || 0,
          text_segment:  (seg.text || '').trim(),
        }));

        resolve({ segments, duration: output.duration || 0, language: output.language || 'en', method: 'whisperx' });
      } catch (err) {
        reject(new Error(`WhisperX output parse failed: ${err.message}`));
      }
    });
  });
};

// ================================================================
// transcribeAudio — Main entry point
// ================================================================
const transcribeAudio = async (filePath, options = {}) => {
  const hasGroq = !!process.env.GROQ_API_KEY;

  if (hasGroq) {
    try {
      // Step 1: Groq transcription
      const groqResult = await transcribeWithGroq(filePath, options);

      // Step 2a: Try Pyannote first (only runs on GPU)
      const pyannoteSegments = await addDiarizationWithPyannote(
        filePath, groqResult.segments, options
      );

      if (pyannoteSegments) {
        // Pyannote worked (GPU mode)
        return {
          ...groqResult,
          segments:    pyannoteSegments,
          numSpeakers: new Set(pyannoteSegments.map(s => s.speaker_label)).size,
          method:      'groq+pyannote',
        };
      }

      // Step 2b: Pyannote skipped — use LLM diarization
      console.log('[Transcription] Using LLM diarization (CPU mode)...');
      const llmSegments = await diarizeWithLLM(groqResult.segments, options);

      return {
        ...groqResult,
        segments:    llmSegments,
        numSpeakers: new Set(llmSegments.map(s => s.speaker_label)).size,
        method:      'groq+llm-diarization',
      };

    } catch (groqErr) {
      console.error(`[Transcription] Groq failed: ${groqErr.message}`);
      console.log('[Transcription] Falling back to WhisperX local...');
    }
  }

  // Fallback: Full WhisperX local
  if (isWhisperXAvailable()) {
    const result = await transcribeWithWhisperX(filePath, options);
    // Apply LLM diarization to WhisperX output too if speakers look generic
    const needsDiarization = result.segments.some(s => /^(Speaker A|SPEAKER_\d+)$/.test(s.speaker_label));
    if (needsDiarization) {
      result.segments = await diarizeWithLLM(result.segments, options);
    }
    return result;
  }

  throw new Error('No transcription method available. Set GROQ_API_KEY or run python/setup.sh');
};

module.exports = { transcribeAudio, isWhisperXAvailable };
