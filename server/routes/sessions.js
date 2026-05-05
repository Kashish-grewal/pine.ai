const { processSession } = require('../services/pipeline');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db/db');
const { protect } = require('../middleware/auth');
const { uploadAudio, handleMulterError } = require('../middleware/upload');
const {
  normalizeExpectedSpeakerCount,
  normalizeLanguageLocale,
  sanitizePhraseArray,
} = require('../services/transcriptionMetadata');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/v1/sessions/upload
// ---------------------------------------------------------------------------
// Protected. Accepts one audio file, saves to disk, creates a session row
// in the DB with status = 'pending', returns session ID.
// ---------------------------------------------------------------------------
router.post(
  '/upload',
  protect,
  (req, res, next) => {
    uploadAudio(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  async (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No audio file provided. Send the file under the field name "audio".',
        code: 'NO_FILE',
      });
    }

    const { originalname, filename, size, mimetype, path: filePath } = req.file;

    const title = req.body.title?.trim() || originalname;
    const description = req.body.description?.trim() || null;

    const participantNames = sanitizePhraseArray(req.body.participant_names, {
      maxItems: 20,
      maxLength: 80,
    });

    const expectedSpeakerCount = normalizeExpectedSpeakerCount(
      req.body.expected_speaker_count,
      participantNames.length
    );

    const languageLocale = normalizeLanguageLocale(req.body.language_locale);

    const userKeywords = sanitizePhraseArray(req.body.user_keywords, {
      maxItems: 40,
      maxLength: 80,
    });

    if (participantNames.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'participant_names is required and must contain at least one name.',
        code: 'INVALID_PARTICIPANTS',
      });
    }

    if (!expectedSpeakerCount) {
      return res.status(400).json({
        success: false,
        message: 'expected_speaker_count is required and must be between 1 and 20.',
        code: 'INVALID_SPEAKER_COUNT',
      });
    }

    try {
      const result = await pool.query(
        `INSERT INTO sessions 
         (
           user_id, title, description, audio_url, audio_format, file_size_bytes,
           participants, expected_speaker_count, language_locale, user_keywords,
           status
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,'pending')
         RETURNING session_id,title,description,audio_format,file_size_bytes,
                   participants,expected_speaker_count,language_locale,
                   user_keywords,status,created_at`,
        [
          req.user.userId,
          title,
          description,
          filename,
          mimetype,
          size,
          JSON.stringify(participantNames),
          expectedSpeakerCount,
          languageLocale,
          JSON.stringify(userKeywords),
        ]
      );

      const session = result.rows[0];

      res.status(201).json({
        success: true,
        message: 'Audio uploaded successfully. Processing will begin shortly.',
        data: {
          sessionId: session.session_id,
          title: session.title,
          status: session.status,
          audioFormat: session.audio_format,
          fileSizeBytes: session.file_size_bytes,
          participants: session.participants,
          expectedSpeakerCount: session.expected_speaker_count,
          languageLocale: session.language_locale,
          userKeywords: session.user_keywords,
          createdAt: session.created_at,
        },
      });

      processSession(session.session_id, filePath).catch((err) => {
        console.error('[Upload] Pipeline trigger failed:', err.message);
      });

    } catch (err) {
      fs.unlink(filePath, () => {});
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/v1/sessions/upload-audio
// ---------------------------------------------------------------------------
// Upload audio for existing session and trigger pipeline
// ---------------------------------------------------------------------------
router.post(
  '/upload-audio',
  protect,
  (req, res, next) => {
    uploadAudio(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  async (req, res) => {
    try {
      const { sessionId } = req.body;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'sessionId is required',
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No audio file uploaded',
        });
      }

      const audioPath = req.file.path;

      const result = await pool.query(
        `UPDATE sessions
         SET audio_url = $1,
             audio_format = $2,
             file_size_bytes = $3,
             status = $4,
             updated_at = NOW()
         WHERE session_id = $5
         AND user_id = $6
         RETURNING session_id`,
        [
          req.file.filename,
          req.file.mimetype,
          req.file.size,
          'processing',
          sessionId,
          req.user.userId,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Session not found',
        });
      }

      processSession(sessionId, audioPath).catch((err) => {
        console.error('[Session] Pipeline error:', err);
      });

      res.json({
        success: true,
        message: 'Audio uploaded successfully',
        sessionId,
      });

    } catch (err) {
      console.error('[Session] Upload error:', err);

      res.status(500).json({
        success: false,
        message: 'Upload failed',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/v1/sessions
// ---------------------------------------------------------------------------
router.get('/', protect, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT 
         session_id,title,description,audio_format,file_size_bytes,
         participants,expected_speaker_count,language_locale,user_keywords,
         auto_keywords,status,duration_secs,created_at,updated_at
       FROM sessions
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.userId]
    );

    res.json({
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
router.get('/:id', protect, async (req, res, next) => {
  const { id } = req.params;

  try {
    const sessionResult = await pool.query(
      `SELECT 
         session_id,title,description,audio_format,file_size_bytes,
         participants,expected_speaker_count,language_locale,user_keywords,
         auto_keywords,transcription_metadata,status,duration_secs,
         error_message,created_at,updated_at
       FROM sessions
       WHERE session_id = $1 AND user_id = $2`,
      [id, req.user.userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.',
      });
    }

    const transcriptResult = await pool.query(
      `SELECT transcript_id,speaker_label,start_time,end_time,text_segment,created_at
       FROM transcripts
       WHERE session_id = $1
       ORDER BY start_time ASC`,
      [id]
    );

    const summaryResult = await pool.query(
      `SELECT summary_id,executive_summary,key_decisions,open_questions,owners,deadlines,next_meeting,sentiment,created_at
       FROM meeting_summaries
       WHERE session_id = $1`,
      [id]
    );

    const tasksResult = await pool.query(
      `SELECT task_id,assignee,description,deadline,priority,is_completed,created_at
       FROM tasks
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    const transactionsResult = await pool.query(
      `SELECT transaction_id,type,amount,category,description,logged_date
       FROM transactions
       WHERE session_id = $1
       ORDER BY logged_date ASC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        session:      sessionResult.rows[0],
        transcript:   transcriptResult.rows,
        summary:      summaryResult.rows[0] || null,
        tasks:        tasksResult.rows,
        transactions: transactionsResult.rows,
      },
    });

  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/sessions/:id/reprocess
// ---------------------------------------------------------------------------
// Re-run Groq structuring on existing transcript (no diarization re-do)
// ---------------------------------------------------------------------------
router.post('/:id/reprocess', protect, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify session belongs to user and is completed
    const { rows } = await pool.query(
      `SELECT session_id, user_id, title, participants, status
       FROM sessions WHERE session_id = $1 AND user_id = $2`,
      [id, req.user.userId]
    );

    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Session not found.' });

    if (rows[0].status !== 'completed')
      return res.status(400).json({ success: false, message: 'Session must be completed first.' });

    const session = rows[0];

    // Fetch existing transcript segments
    const transcriptResult = await pool.query(
      `SELECT speaker_label, text_segment FROM transcripts
       WHERE session_id = $1 ORDER BY start_time ASC`,
      [id]
    );

    if (transcriptResult.rows.length === 0)
      return res.status(400).json({ success: false, message: 'No transcript found.' });

    res.json({ success: true, message: 'Re-processing insights…' });

    const { structureSession } = require('../services/structuring');
    const participants = Array.isArray(session.participants) ? session.participants : [];

    // ── Normalize speaker labels in DB ──────────────────────────────
    // Fixes corrupt labels (e.g. "don", "boss", "SPEAKER_00") → "Speaker 1", "Speaker 2"
    const rawLabels = [...new Set(transcriptResult.rows.map(r => r.speaker_label).filter(Boolean))];
    const needsNormalize = rawLabels.some(l => !/^Speaker \d+$/.test(l));

    if (needsNormalize) {
      console.log(`[Reprocess] Normalizing speaker labels: ${rawLabels.join(', ')}`);
      const labelMap = {};
      let counter = 1;
      // Assign numbers in order of first appearance
      for (const row of transcriptResult.rows) {
        const raw = row.speaker_label || 'Unknown';
        if (!labelMap[raw]) labelMap[raw] = `Speaker ${counter++}`;
      }
      // Update DB
      for (const [oldLabel, newLabel] of Object.entries(labelMap)) {
        if (oldLabel !== newLabel) {
          await pool.query(
            `UPDATE transcripts SET speaker_label = $1 WHERE session_id = $2 AND speaker_label = $3`,
            [newLabel, id, oldLabel]
          );
        }
      }
      console.log('[Reprocess] Label map:', labelMap);

      // Re-fetch with corrected labels
      const refreshed = await pool.query(
        `SELECT speaker_label, text_segment FROM transcripts WHERE session_id = $1 ORDER BY start_time ASC`,
        [id]
      );
      var segments = refreshed.rows.map(r => ({
        speaker_label: r.speaker_label,
        text_segment:  r.text_segment,
      }));
    } else {
      var segments = transcriptResult.rows.map(r => ({
        speaker_label: r.speaker_label,
        text_segment:  r.text_segment,
      }));
    }

    // Run structuring FIRST, then delete old data only on success.
    // structureSession uses ON CONFLICT for summaries and INSERTs for tasks/transactions.
    // We delete old tasks/transactions first within structureSession's scope.
    try {
      // Delete old tasks and transactions (summaries use UPSERT so no delete needed)
      await pool.query(`DELETE FROM tasks WHERE session_id = $1`, [id]);
      await pool.query(`DELETE FROM transactions WHERE session_id = $1`, [id]);

      // Run structuring synchronously so we know it succeeded
      await structureSession(
        session.session_id,
        session.user_id,
        segments,
        session.title,
        participants
      );

      console.log(`[Reprocess] ✅ Session ${id} re-processed successfully`);
    } catch (structErr) {
      console.error('[Reprocess] Structuring failed:', structErr.message);
      return res.status(500).json({
        success: false,
        message: 'Re-processing failed. Previous data may be incomplete.',
      });
    }

  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/sessions/:id/rename-speaker
// ---------------------------------------------------------------------------
// Manually rename all transcript segments from one speaker label to another.
// LLM mapping runs automatically — this is the human fallback.
// ---------------------------------------------------------------------------
router.post('/:id/rename-speaker', protect, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { oldLabel, newLabel } = req.body;

    if (!oldLabel || !newLabel)
      return res.status(400).json({ success: false, message: 'oldLabel and newLabel required.' });

    // Verify session belongs to user
    const { rows } = await pool.query(
      'SELECT session_id FROM sessions WHERE session_id = $1 AND user_id = $2',
      [id, req.user.userId]
    );
    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Session not found.' });

    const result = await pool.query(
      `UPDATE transcripts SET speaker_label = $1
       WHERE session_id = $2 AND speaker_label = $3`,
      [newLabel.trim(), id, oldLabel]
    );

    res.json({ success: true, updated: result.rowCount });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/sessions/:id

// ---------------------------------------------------------------------------
router.delete('/:id', protect, async (req, res, next) => {
  const { id } = req.params;

  try {
    const sessionResult = await pool.query(
      `SELECT session_id,audio_url
       FROM sessions
       WHERE session_id = $1 AND user_id = $2`,
      [id, req.user.userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found.',
      });
    }

    const { audio_url } = sessionResult.rows[0];

    await pool.query(
      `DELETE FROM sessions WHERE session_id = $1`,
      [id]
    );

    if (audio_url) {
      const filePath = path.join(__dirname, '..', 'uploads', 'temp', audio_url);
      fs.unlink(filePath, () => {});
    }

    res.json({
      success: true,
      message: 'Session deleted successfully.',
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;