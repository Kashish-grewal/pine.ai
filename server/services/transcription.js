const { AssemblyAI } = require('assemblyai');

// ================================================================
// TRANSCRIPTION SERVICE — AssemblyAI
// ================================================================
// Uploads an audio file to AssemblyAI and returns:
//   segments — array of { speaker_label, start_time, end_time, text_segment }
//   duration — total audio length in seconds
//
// Why AssemblyAI:
//   - Whisper-based model (best available accuracy)
//   - Speaker diarization returns pre-grouped utterances (no manual grouping)
//   - Works great on compressed/mono audio (WhatsApp, phone calls, etc.)
//   - Native Node.js SDK — no Python needed
//   - Free tier: $50 credit (~95 hours of audio)
// ================================================================

const client = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY,
});

const transcribeAudio = async (filePath) => {
  console.log('[Transcription] Uploading to AssemblyAI...');

  // transcripts.transcribe() handles: file upload → job creation → polling → result
  // The SDK polls automatically until the transcript is complete (or throws on error)
  const transcript = await client.transcripts.transcribe({
    audio: filePath,          // Local file path — SDK uploads it automatically
    speech_model: 'best',     // Whisper-based universal model — highest accuracy
    speaker_labels: true,     // Diarization — identifies who said what
    language_code: 'en',      // Language (or remove for auto-detect)
    punctuate: true,          // Auto punctuation
    format_text: true,        // Clean text formatting (capitalization etc.)
    disfluencies: false,      // Remove "um", "uh", "you know"
  });

  // AssemblyAI surfaces errors in transcript.status
  if (transcript.status === 'error') {
    throw new Error(`AssemblyAI error: ${transcript.error}`);
  }

  // ------------------------------------------------------------------
  // AssemblyAI returns `utterances` — already grouped by speaker.
  // Each utterance: { speaker, text, start, end }
  //   speaker → "A", "B", "C" (letter per unique voice)
  //   start/end → in milliseconds
  // We normalize: "A" → "Speaker A", ms → seconds
  // ------------------------------------------------------------------
  const utterances = transcript.utterances || [];

  if (utterances.length === 0) {
    // Fallback: no diarization result — return full transcript as one segment
    console.warn('[Transcription] No utterances returned — falling back to single segment.');
    return {
      segments: [{
        speaker_label: 'Speaker A',
        start_time: 0,
        end_time: transcript.audio_duration || 0,
        text_segment: transcript.text || '',
      }],
      duration: transcript.audio_duration || 0,
    };
  }

  const segments = utterances.map((u) => ({
    speaker_label: `Speaker ${u.speaker}`,   // "A" → "Speaker A"
    start_time:    u.start / 1000,           // ms → seconds
    end_time:      u.end   / 1000,           // ms → seconds
    text_segment:  u.text,
  }));

  const duration = transcript.audio_duration; // already in seconds

  console.log(`[Transcription] Done — ${segments.length} utterances, ${duration}s`);

  return { segments, duration };
};

module.exports = { transcribeAudio };
