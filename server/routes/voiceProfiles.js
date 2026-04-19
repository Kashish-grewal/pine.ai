const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');
const { pool } = require('../db/db');
const { protect } = require('../middleware/auth');
const multer = require('multer');
const crypto = require('crypto');

const router = express.Router();

// ================================================================
// VOICE PROFILES — Speaker Enrollment for Better Diarization
// ================================================================
// Users upload a 10-15 second voice clip per participant.
// Pyannote extracts a 512-dim speaker embedding (voiceprint).
// During transcription, these voiceprints are matched against
// diarized speakers using cosine similarity to map
// SPEAKER_XX → real participant names automatically.
// ================================================================

const PYTHON_DIR = path.join(__dirname, '..', 'python');
const VENV_PYTHON = path.join(PYTHON_DIR, 'venv', 'bin', 'python3');
const EXTRACT_SCRIPT = path.join(PYTHON_DIR, 'extract_embedding.py');
const VOICE_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'voices');

// Ensure voice upload directory exists
if (!fs.existsSync(VOICE_UPLOAD_DIR)) {
  fs.mkdirSync(VOICE_UPLOAD_DIR, { recursive: true });
}

// Multer config for voice samples (5MB max, audio only)
const voiceStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VOICE_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const hex = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase() || '.wav';
    cb(null, `${Date.now()}-${hex}${ext}`);
  },
});

const AUDIO_MIMES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
  'audio/mp4', 'audio/x-m4a', 'audio/webm', 'audio/ogg', 'video/webm',
]);

const uploadVoice = multer({
  storage: voiceStorage,
  fileFilter: (req, file, cb) => {
    if (AUDIO_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only audio files are accepted.'), false);
  },
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }, // 5MB
}).single('voice');

// ----------------------------------------------------------------
// Helper: extract embedding via Python
// ----------------------------------------------------------------
const extractEmbedding = (audioPath) => {
  return new Promise((resolve, reject) => {
    const hfToken = process.env.HF_TOKEN || '';
    const args = [EXTRACT_SCRIPT, audioPath];
    if (hfToken) args.push('--hf-token', hfToken);
    args.push('--device', 'cpu');

    let stdout = '';
    let stderr = '';

    const proc = spawn(VENV_PYTHON, args, {
      cwd: PYTHON_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      timeout: 120_000, // 2 min
    });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => {
      const line = d.toString().trim();
      if (line) console.log(`  [Embedding] ${line}`);
      stderr += line + '\n';
    });

    proc.on('error', (err) => reject(new Error(`Embedding process failed: ${err.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Embedding extraction failed (code ${code}): ${stderr.slice(-300)}`));
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        if (!result.success) {
          reject(new Error(result.error || 'Unknown embedding error'));
          return;
        }
        resolve(result);
      } catch (e) {
        reject(new Error(`Failed to parse embedding output: ${e.message}`));
      }
    });
  });
};

// ----------------------------------------------------------------
// GET /api/v1/voice-profiles
// List all voice profiles for the logged-in user
// ----------------------------------------------------------------
router.get('/', protect, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT profile_id, speaker_name, duration_secs, created_at, updated_at
       FROM voice_profiles
       WHERE user_id = $1
       ORDER BY speaker_name ASC`,
      [req.user.userId]
    );

    res.json({
      success: true,
      data: { profiles: result.rows },
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------
// POST /api/v1/voice-profiles
// Upload a voice sample + speaker name → extract embedding → save
// ----------------------------------------------------------------
router.post('/', protect, (req, res, next) => {
  uploadVoice(req, res, async (multerErr) => {
    if (multerErr) {
      return res.status(400).json({
        success: false,
        message: multerErr.message || 'Voice upload failed.',
      });
    }

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No voice file provided. Send the file under the field name "voice".',
        });
      }

      const speakerName = req.body.speaker_name?.trim();
      if (!speakerName) {
        // Clean up uploaded file
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({
          success: false,
          message: 'Speaker name is required.',
        });
      }

      console.log(`[VoiceProfile] Extracting embedding for "${speakerName}"...`);

      // Extract embedding via Python
      const embeddingResult = await extractEmbedding(req.file.path);

      // Check if profile already exists for this user + name (upsert)
      const existing = await pool.query(
        'SELECT profile_id, audio_path FROM voice_profiles WHERE user_id = $1 AND speaker_name = $2',
        [req.user.userId, speakerName]
      );

      let profileId;

      if (existing.rows.length > 0) {
        // Update existing profile
        const oldPath = existing.rows[0].audio_path;
        profileId = existing.rows[0].profile_id;

        await pool.query(
          `UPDATE voice_profiles
           SET audio_path = $1, embedding = $2, duration_secs = $3, updated_at = NOW()
           WHERE profile_id = $4`,
          [req.file.filename, JSON.stringify(embeddingResult.embedding), embeddingResult.duration, profileId]
        );

        // Delete old audio file
        if (oldPath) {
          fs.unlink(path.join(VOICE_UPLOAD_DIR, oldPath), () => {});
        }

        console.log(`[VoiceProfile] Updated profile for "${speakerName}" (${embeddingResult.dimensions}-dim)`);
      } else {
        // Insert new profile
        const insertResult = await pool.query(
          `INSERT INTO voice_profiles (user_id, speaker_name, audio_path, embedding, duration_secs)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING profile_id`,
          [req.user.userId, speakerName, req.file.filename, JSON.stringify(embeddingResult.embedding), embeddingResult.duration]
        );

        profileId = insertResult.rows[0].profile_id;
        console.log(`[VoiceProfile] Created profile for "${speakerName}" (${embeddingResult.dimensions}-dim)`);
      }

      res.status(201).json({
        success: true,
        message: `Voice profile for "${speakerName}" saved successfully.`,
        data: {
          profileId,
          speakerName,
          duration: embeddingResult.duration,
          dimensions: embeddingResult.dimensions,
        },
      });
    } catch (err) {
      // Clean up file on error
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      next(err);
    }
  });
});

// ----------------------------------------------------------------
// DELETE /api/v1/voice-profiles/:id
// Delete a voice profile
// ----------------------------------------------------------------
router.delete('/:id', protect, async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM voice_profiles WHERE profile_id = $1 AND user_id = $2 RETURNING audio_path, speaker_name',
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Voice profile not found.' });
    }

    // Delete audio file
    const audioPath = result.rows[0].audio_path;
    if (audioPath) {
      fs.unlink(path.join(VOICE_UPLOAD_DIR, audioPath), () => {});
    }

    console.log(`[VoiceProfile] Deleted profile for "${result.rows[0].speaker_name}"`);

    res.json({ success: true, message: 'Voice profile deleted.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
