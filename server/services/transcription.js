const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');

// ================================================================
// TRANSCRIPTION SERVICE — Hybrid: Groq (fast) + WhisperX (diarization)
// ================================================================
// Strategy (optimized for speed + accuracy):
//   1. PRIMARY:  Groq API (Whisper large-v3, free, ~30s for 1hr audio)
//              + WhisperX local (Pyannote diarization only)
//   2. FALLBACK: Full WhisperX local (slower but works offline)
//
// Why hybrid? Groq runs Whisper large-v3 on their fast infra in seconds.
// WhisperX locally with large-v3 on CPU takes 30-60 min for 1hr audio.
// But Groq has no diarization. So we use Groq for text + WhisperX/Pyannote
// for speaker labels only. Best of both worlds.
// ================================================================

const PYTHON_DIR = path.join(__dirname, '..', 'python');
const VENV_PYTHON = path.join(PYTHON_DIR, 'venv', 'bin', 'python3');
const TRANSCRIBE_SCRIPT = path.join(PYTHON_DIR, 'transcribe.py');

const isWhisperXAvailable = () => {
  return fs.existsSync(VENV_PYTHON) && fs.existsSync(TRANSCRIBE_SCRIPT);
};

// ----------------------------------------------------------------
// Groq API: Free Whisper large-v3 transcription (fast, no diarization)
// ----------------------------------------------------------------
const transcribeWithGroq = async (filePath, options = {}) => {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) throw new Error('GROQ_API_KEY not set');

  const { languageLocale } = options;
  const language = languageLocale
    ? languageLocale.split(/[-_]/)[0].toLowerCase()
    : 'en';

  console.log('[Transcription] Using Groq (Whisper large-v3, cloud)...');

  const audioBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', audioBuffer, { filename: fileName });
  form.append('model', 'whisper-large-v3');
  form.append('response_format', 'verbose_json');
  form.append('language', language);
  form.append('timestamp_granularities[]', 'segment');

  const response = await axios.post(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${groqKey}`,
      },
      maxContentLength: 100 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
    }
  );

  const data = response.data;

  const segments = (data.segments || []).map((seg) => ({
    speaker_label: 'Speaker A',
    start_time: seg.start || 0,
    end_time: seg.end || 0,
    text_segment: (seg.text || '').trim(),
    words: [],
  }));

  if (segments.length === 0 && data.text) {
    segments.push({
      speaker_label: 'Speaker A',
      start_time: 0,
      end_time: data.duration || 0,
      text_segment: data.text.trim(),
      words: [],
    });
  }

  console.log(`[Transcription] Groq done — ${segments.length} segments, ${data.duration || 0}s`);

  return {
    segments,
    duration: data.duration || 0,
    rawSegments: segments,
    numSpeakers: 1,
    language: data.language || language,
    method: 'groq',
  };
};

// ----------------------------------------------------------------
// WhisperX local: Full pipeline (transcription + diarization)
// Used as fallback when Groq is unavailable
// ----------------------------------------------------------------
const transcribeWithWhisperX = (filePath, options = {}) => {
  return new Promise((resolve, reject) => {
    const {
      expectedSpeakerCount,
      languageLocale,
      participantNames = [],
      keywordBoostList = [],
    } = options;

    const outputJson = path.join(os.tmpdir(), `pine_transcription_${Date.now()}.json`);
    const args = [TRANSCRIBE_SCRIPT, filePath, outputJson];

    const language = languageLocale
      ? languageLocale.split(/[-_]/)[0].toLowerCase()
      : null;
    if (language && language !== 'auto') {
      args.push('--language', language);
    }

    if (expectedSpeakerCount && expectedSpeakerCount > 0) {
      args.push('--speakers', String(expectedSpeakerCount));
    }

    const allBoostWords = [...new Set([...participantNames, ...keywordBoostList])];
    if (allBoostWords.length > 0) {
      args.push('--boost', allBoostWords.join(','));
    }

    const hfToken = process.env.HF_TOKEN || '';
    if (hfToken) args.push('--hf-token', hfToken);

    const device = process.env.WHISPERX_DEVICE || 'cpu';
    args.push('--device', device);

    const model = process.env.WHISPERX_MODEL || 'medium';
    args.push('--model', model);

    console.log(`[Transcription] Starting WhisperX local (model=${model}, device=${device})`);

    const startTime = Date.now();
    let stderrOutput = '';
    let stdoutOutput = '';

    const proc = spawn(VENV_PYTHON, args, {
      cwd: PYTHON_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      timeout: 45 * 60 * 1000, // 45 min timeout
    });

    proc.stdout.on('data', (data) => { stdoutOutput += data.toString(); });
    proc.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        console.log(`  ${line}`);
        stderrOutput += line + '\n';
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`WhisperX process failed to start: ${err.message}`));
    });

    proc.on('close', (code) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (code !== 0) {
        reject(new Error(`WhisperX exited with code ${code} after ${elapsed}s. Stderr: ${stderrOutput.slice(-500)}`));
        return;
      }

      try {
        if (!fs.existsSync(outputJson)) {
          reject(new Error(`WhisperX output file not found: ${outputJson}`));
          return;
        }

        const rawJson = fs.readFileSync(outputJson, 'utf-8');
        const output = JSON.parse(rawJson);
        fs.unlink(outputJson, () => {});

        const segments = (output.segments || []).map((seg) => ({
          speaker_label: seg.speaker || 'SPEAKER_00',
          start_time: seg.start || 0,
          end_time: seg.end || 0,
          text_segment: (seg.text || '').trim(),
          words: seg.words || [],
        }));

        console.log(`[Transcription] WhisperX done — ${segments.length} segments, ${output.num_speakers || 1} speakers, ${elapsed}s`);

        resolve({
          segments,
          duration: output.duration || 0,
          rawSegments: output.segments || [],
          numSpeakers: output.num_speakers || 1,
          language: output.language || 'en',
          method: 'whisperx',
        });
      } catch (parseErr) {
        reject(new Error(`Failed to parse WhisperX output: ${parseErr.message}`));
      }
    });
  });
};

// ----------------------------------------------------------------
// Diarization only: Run Pyannote via WhisperX on existing segments
// This takes Groq's text segments and adds speaker labels
// ----------------------------------------------------------------
const addDiarization = (filePath, groqSegments, options = {}) => {
  return new Promise((resolve, reject) => {
    const { expectedSpeakerCount } = options;
    const hfToken = process.env.HF_TOKEN || '';

    if (!hfToken || !isWhisperXAvailable()) {
      console.log('[Transcription] No HF_TOKEN or WhisperX — skipping diarization');
      resolve(groqSegments);
      return;
    }

    console.log('[Transcription] Adding speaker diarization via Pyannote...');

    const outputJson = path.join(os.tmpdir(), `pine_diarize_${Date.now()}.json`);
    const args = [
      TRANSCRIBE_SCRIPT, filePath, outputJson,
      '--hf-token', hfToken,
      '--device', process.env.WHISPERX_DEVICE || 'cpu',
      '--model', 'tiny',   // Use tiny model — we only need diarization, not transcription
      '--language', 'en',
    ];

    if (expectedSpeakerCount && expectedSpeakerCount > 0) {
      args.push('--speakers', String(expectedSpeakerCount));
    }

    const startTime = Date.now();
    let stderrOutput = '';
    let stdoutOutput = '';

    const proc = spawn(VENV_PYTHON, args, {
      cwd: PYTHON_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      timeout: 20 * 60 * 1000, // 20 min
    });

    proc.stdout.on('data', (d) => { stdoutOutput += d.toString(); });
    proc.stderr.on('data', (d) => {
      const line = d.toString().trim();
      if (line) {
        console.log(`  ${line}`);
        stderrOutput += line + '\n';
      }
    });

    proc.on('error', (err) => {
      console.warn(`[Transcription] Diarization failed to start: ${err.message}`);
      resolve(groqSegments); // fall back to undiarized
    });

    proc.on('close', (code) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (code !== 0) {
        console.warn(`[Transcription] Diarization failed (code ${code}) after ${elapsed}s — using Groq text without speaker labels`);
        resolve(groqSegments);
        return;
      }

      try {
        if (!fs.existsSync(outputJson)) {
          resolve(groqSegments);
          return;
        }

        const rawJson = fs.readFileSync(outputJson, 'utf-8');
        const diarizeResult = JSON.parse(rawJson);
        fs.unlink(outputJson, () => {});

        // Build a time-to-speaker map from diarization
        const diarizedSegs = diarizeResult.segments || [];
        if (diarizedSegs.length === 0) {
          console.warn('[Transcription] Diarization returned no segments — keeping Groq labels');
          resolve(groqSegments);
          return;
        }

        // Map Groq segments to speakers using diarization time ranges
        const labeled = groqSegments.map((seg) => {
          const midpoint = (seg.start_time + seg.end_time) / 2;

          // Find the diarized segment that covers this midpoint
          const match = diarizedSegs.find(
            (d) => midpoint >= d.start && midpoint <= d.end
          );

          return {
            ...seg,
            speaker_label: match ? match.speaker : seg.speaker_label,
          };
        });

        const speakers = new Set(labeled.map((s) => s.speaker_label));
        console.log(`[Transcription] Diarization applied — ${speakers.size} speakers detected, ${elapsed}s`);

        resolve(labeled);
      } catch (err) {
        console.warn(`[Transcription] Diarization parse error: ${err.message}`);
        resolve(groqSegments);
      }
    });
  });
};

// ----------------------------------------------------------------
// transcribeAudio — Main entry point
// Strategy: Groq first (fast), then add diarization from Pyannote
// Fallback: Full WhisperX local
// ----------------------------------------------------------------
const transcribeAudio = async (filePath, options = {}) => {
  const hasGroq = !!process.env.GROQ_API_KEY;

  // Strategy 1: Groq (fast transcription) + Pyannote (speaker labels)
  if (hasGroq) {
    try {
      const groqResult = await transcribeWithGroq(filePath, options);

      // Add speaker diarization from Pyannote
      if (isWhisperXAvailable() && process.env.HF_TOKEN) {
        try {
          const diarizedSegments = await addDiarization(filePath, groqResult.segments, options);
          groqResult.segments = diarizedSegments;
          const speakers = new Set(diarizedSegments.map((s) => s.speaker_label));
          groqResult.numSpeakers = speakers.size;
          groqResult.method = 'groq+pyannote';
        } catch (diaErr) {
          console.warn(`[Transcription] Diarization step failed: ${diaErr.message}`);
          // Still have Groq transcription — usable without speakers
        }
      }

      return groqResult;
    } catch (groqErr) {
      console.error(`[Transcription] Groq failed: ${groqErr.message}`);
      console.log('[Transcription] Falling back to full WhisperX local...');
    }
  }

  // Strategy 2: Full WhisperX local (slower, but works offline)
  if (isWhisperXAvailable()) {
    return await transcribeWithWhisperX(filePath, options);
  }

  throw new Error('No transcription method available. Set GROQ_API_KEY or run python/setup.sh');
};

module.exports = { transcribeAudio, isWhisperXAvailable };