const fs = require('fs');
const { pool } = require('../db/db');
const { transcribeAudio } = require('./transcription');

// ================================================================
// PROCESSING PIPELINE
// ================================================================
// Called after the upload route responds to the client.
// Runs entirely in the background — the user never waits for this.
//
// Flow:
//   1. Set status = 'processing'
//   2. Call Deepgram → get diarized segments
//   3. Save each segment to the transcripts table
//   4. Set status = 'completed' + save duration
//   5. Delete audio file from disk (ephemeral storage policy)
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

    // Step 2 — Transcribe audio with Deepgram
    console.log(`[Pipeline] Sending to Deepgram...`);
    const { segments, duration } = await transcribeAudio(filePath);
    console.log(`[Pipeline] Got ${segments.length} segments, duration ${duration}s`);

    // Step 3 — Save each diarized segment to transcripts table
    for (const segment of segments) {
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

    // Step 4 — Mark session as completed
    await pool.query(
      `UPDATE sessions
       SET status = 'completed', duration_secs = $2, updated_at = NOW()
       WHERE session_id = $1`,
      [sessionId, Math.round(duration)]
    );

    // Step 5 — Delete the audio file from disk
    // We never store audio permanently — privacy + storage policy
    fs.unlink(filePath, (err) => {
      if (err) console.warn(`[Pipeline] Could not delete file: ${filePath}`);
    });

    console.log(`[Pipeline] ✅ Session ${sessionId} completed.`);

  } catch (err) {
    console.error(`[Pipeline] ❌ Session ${sessionId} failed:`, err.message);

    // Save the error so the frontend can show what went wrong
    await pool.query(
      `UPDATE sessions
       SET status = 'failed', error_message = $2, updated_at = NOW()
       WHERE session_id = $1`,
      [sessionId, err.message]
    ).catch(() => {}); // Don't crash if this update also fails
  }
};

module.exports = { processSession };
