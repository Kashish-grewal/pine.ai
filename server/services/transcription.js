const { AssemblyAI } = require('assemblyai');

// ================================================================
// TRANSCRIPTION SERVICE — AssemblyAI
// ================================================================
// Uploads an audio file to AssemblyAI and returns:
//   segments — array of { speaker_label, start_time, end_time, text_segment }
//   duration — total audio length in seconds
//   rawUtterances — original utterances before post-processing
// ================================================================

const client = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY,
});

// ----------------------------------------------------------------
// transcribeAudio(filePath, options)
//
// NEW OPTIONS (all optional but improve diarization significantly):
//   speakersExpected  {number}   — how many speakers to expect.
//                                  If you have this, always pass it.
//                                  Prevents AssemblyAI from merging or
//                                  splitting voices incorrectly.
//
//   participants      {string[]} — known names e.g. ["Monica", "Sarah"].
//                                  Added to word_boost so names aren't
//                                  misheard as similar-sounding words.
//
//   languageCode      {string}   — defaults to 'en'. Pass 'hi' for Hindi,
//                                  or remove entirely for auto-detect.
// ----------------------------------------------------------------

const transcribeAudio = async (filePath, options = {}) => {
  const {
    speakersExpected,
    participants = [],
    languageCode = 'en',
  } = options;

  console.log('[Transcription] Uploading to AssemblyAI...');
  if (speakersExpected) console.log(`[Transcription] Expecting ${speakersExpected} speakers`);
  if (participants.length) console.log(`[Transcription] Boosting names: ${participants.join(', ')}`);

  const config = {
    audio: filePath,
    speech_models: ['universal-3-pro', 'universal-2'],
    speaker_labels: true,
    language_code: languageCode,
    punctuate: true,
    format_text: true,
    disfluencies: false,

    // ── NEW: tell AssemblyAI exactly how many speakers to find ──────
    // Without this, the model guesses and often merges two voices into
    // one (the most common cause of wrong speaker labels in interviews).
    ...(speakersExpected ? { speakers_expected: speakersExpected } : {}),

    // ── NEW: boost recognition accuracy for known names ─────────────
    // Prevents "Monica" being transcribed as "harmonica" etc.
    // Also accepts domain terms: ["IAS", "IRMS", "diarization"].
    ...(participants.length > 0
      ? { word_boost: participants, boost_param: 'high' }
      : {}),
  };

  const transcript = await client.transcripts.transcribe(config);

  if (transcript.status === 'error') {
    throw new Error(`AssemblyAI error: ${transcript.error}`);
  }

  const utterances = transcript.utterances || [];

  if (utterances.length === 0) {
    console.warn('[Transcription] No utterances returned — falling back to single segment.');
    return {
      segments: [{
        speaker_label: 'Speaker A',
        start_time:    0,
        end_time:      transcript.audio_duration || 0,
        text_segment:  transcript.text || '',
      }],
      duration:       transcript.audio_duration || 0,
      rawUtterances:  [],
    };
  }

  const segments = utterances.map((u) => ({
    speaker_label: `Speaker ${u.speaker}`,  // "A" → "Speaker A"
    start_time:    u.start / 1000,          // ms → seconds
    end_time:      u.end   / 1000,          // ms → seconds
    text_segment:  u.text,
  }));

  const duration = transcript.audio_duration;

  console.log(`[Transcription] Done — ${segments.length} utterances, ${duration}s`);

  // rawUtterances keeps the original { speaker, text, start, end } shape
  // so postprocess.js can work on it before we convert to segments
  return { segments, duration, rawUtterances: utterances };
};

module.exports = { transcribeAudio };