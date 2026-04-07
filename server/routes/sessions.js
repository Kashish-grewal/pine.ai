const { processSession } = require('../services/pipeline');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db/db');
const { protect } = require('../middleware/auth');
const { uploadAudio, handleMulterError } = require('../middleware/upload');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/v1/sessions/upload
// ---------------------------------------------------------------------------
// Protected. Accepts one audio file, saves to disk, creates a session row
// in the DB with status = 'pending', returns session ID.
//
// The protect middleware runs first — if the token is missing or
// expired the request never reaches the upload handler.
// ---------------------------------------------------------------------------
router.post(
  '/upload',
  protect,
  (req, res, next) => {
    // Run multer, then pass multer errors to handleMulterError
    uploadAudio(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  async (req, res, next) => {
    // If multer didn't attach a file, the field was missing entirely
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No audio file provided. Send the file under the field name "audio".',
        code: 'NO_FILE',
      });
    }

    const { originalname, filename, size, mimetype, path: filePath } = req.file;

    // Optional metadata the client can send alongside the file
    const title = req.body.title?.trim() || originalname;
    const description = req.body.description?.trim() || null;

    try {
      // -------------------------------------------------------------------
      // Create the session row
      // -------------------------------------------------------------------
      // status starts as 'pending' — the transcription job will move it
      // through 'transcribing' → 'processing' → 'completed' (or 'failed').
      //
      // audio_url stores the relative path on disk. We store just the
      // filename, not the full absolute path, so the app works regardless
      // of where it's deployed.
      // -------------------------------------------------------------------
      const result = await pool.query(
        `INSERT INTO sessions 
           (user_id, title, description, audio_url, audio_format, file_size_bytes, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         RETURNING session_id, title, description, audio_format, file_size_bytes, status, created_at`,
        [
          req.user.userId,
          title,
          description,
          filename,          // store only the generated filename
          mimetype,
          size,
        ]
      );

      const session = result.rows[0];

      // Respond immediately — don't make the user wait for transcription
      res.status(201).json({
        success: true,
        message: 'Audio uploaded successfully. Processing will begin shortly.',
        data: {
          sessionId: session.session_id,
          title: session.title,
          status: session.status,
          audioFormat: session.audio_format,
          fileSizeBytes: session.file_size_bytes,
          createdAt: session.created_at,
        },
      });

      // Fire pipeline in the background — non-blocking
      // filePath is the full disk path multer saved the file to
      processSession(session.session_id, filePath).catch((err) => {
        console.error('[Upload] Pipeline trigger failed:', err.message);
      });

    } catch (err) {
      // -------------------------------------------------------------------
      // If the DB insert fails, delete the file we just saved to disk.
      // Orphaned files on disk with no DB record are a storage leak.
      // -------------------------------------------------------------------
      fs.unlink(filePath, () => { }); // fire and forget — don't block the error response
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/v1/sessions
// ---------------------------------------------------------------------------
// Returns all sessions for the authenticated user, newest first.
// This powers the history/dashboard view on the frontend.
// ---------------------------------------------------------------------------
router.get('/', protect, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT 
         session_id, title, description, audio_format, file_size_bytes,
         status, duration_secs, created_at, updated_at
       FROM sessions
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.userId]
    );

    return res.json({
      success: true,
      data: {
        sessions: result.rows,
        count: result.rows.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/sessions/:id
// ---------------------------------------------------------------------------
// Returns full details for a single session including transcript and summary
// if they exist. The frontend polls this every few seconds to track progress.
//
// IMPORTANT: We always filter by BOTH session id AND user_id. This prevents
// a logged-in user from fetching another user's session by guessing the ID.
// ---------------------------------------------------------------------------
router.get('/:id', protect, async (req, res, next) => {
  const { id } = req.params;

  try {
    // Fetch the session — scoped to this user
    const sessionResult = await pool.query(
      `SELECT 
         session_id, title, description, audio_format, file_size_bytes,
         status, duration_secs, created_at, updated_at
       FROM sessions
       WHERE session_id = $1 AND user_id = $2`,
      [id, req.user.userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.',
        code: 'SESSION_NOT_FOUND',
      });
    }

    const session = sessionResult.rows[0];

    // Fetch transcript if it exists (will be null until transcription completes)
    const transcriptResult = await pool.query(
      `SELECT transcript_id, speaker_label, start_time, end_time, text_segment, created_at
       FROM transcripts
       WHERE session_id = $1
       ORDER BY start_time ASC`,
      [id]
    );

    // Fetch summary if it exists (will be null until LLM processing completes)
    const summaryResult = await pool.query(
      `SELECT summary_id, executive_summary, key_decisions, sentiment, created_at
       FROM meeting_summaries
       WHERE session_id = $1`,
      [id]
    );

    return res.json({
      success: true,
      data: {
        session,
        transcript: transcriptResult.rows,        // ALL segments (array), not just row[0]
        summary:    summaryResult.rows[0] || null, // Still single summary object
      },
    });

  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/sessions/:id
// ---------------------------------------------------------------------------
// Deletes a session and its audio file from disk. Only the owner can delete.
// Cascades to transcripts, tasks, summaries via DB foreign keys.
// ---------------------------------------------------------------------------
router.delete('/:id', protect, async (req, res, next) => {
  const { id } = req.params;

  try {
    // Get the session first so we know the filename to delete from disk
    const sessionResult = await pool.query(
      `SELECT session_id, audio_url FROM sessions WHERE session_id = $1 AND user_id = $2`,
      [id, req.user.userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.',
        code: 'SESSION_NOT_FOUND',
      });
    }

    const { audio_url } = sessionResult.rows[0];

    // Delete from DB first — if the file delete fails it's not critical
    await pool.query(`DELETE FROM sessions WHERE session_id = $1`, [id]);

    // Delete audio file from disk
    if (audio_url) {
      const filePath = path.join(__dirname, '..', 'uploads', 'temp', audio_url);
      fs.unlink(filePath, () => { }); // fire and forget
    }

    return res.json({
      success: true,
      message: 'Session deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;