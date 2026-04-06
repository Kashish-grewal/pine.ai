const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Where files land on disk
// ---------------------------------------------------------------------------
// We never use the original filename the client sends — it could contain
// path traversal attacks like "../../etc/passwd". Instead we generate a
// random hex string + timestamp and keep only the file extension.
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'temp'));
  },
  filename: (req, file, cb) => {
    const randomHex = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${timestamp}-${randomHex}${ext}`);
  },
});

// ---------------------------------------------------------------------------
// File type filter — audio only
// ---------------------------------------------------------------------------
// We check BOTH the mimetype (sent by the client) and the file extension.
// Checking only mimetype is not enough — a client can lie about mimetype.
// Checking only extension is not enough — someone can rename a .exe to .mp3.
// Checking both gives us two layers of validation.
// ---------------------------------------------------------------------------
const ALLOWED_MIMETYPES = new Set([
  'audio/mpeg',       // .mp3
  'audio/mp3',        // .mp3 (some browsers send this variant)
  'audio/wav',        // .wav
  'audio/wave',       // .wav (safari variant)
  'audio/x-wav',      // .wav (another variant)
  'audio/mp4',        // .m4a
  'audio/x-m4a',      // .m4a
  'audio/webm',       // .webm
  'audio/ogg',        // .ogg
  'video/webm',       // webm recorded from browser MediaRecorder (contains audio)
  'video/mp4',        // mp4 recorded from browser MediaRecorder
]);

const ALLOWED_EXTENSIONS = new Set([
  '.mp3', '.wav', '.m4a', '.webm', '.ogg', '.mp4',
]);

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ALLOWED_MIMETYPES.has(file.mimetype) && ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true); // accept
  } else {
    cb(
      new multer.MulterError(
        'LIMIT_UNEXPECTED_FILE',
        `Invalid file type. Allowed formats: mp3, wav, m4a, webm, ogg. Received: ${file.mimetype}`
      ),
      false
    );
  }
};

// ---------------------------------------------------------------------------
// The multer instance
// ---------------------------------------------------------------------------
// 100MB cap. For a typical 1-hour meeting at reasonable quality this is
// plenty. We can raise it later if needed.
// ---------------------------------------------------------------------------
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB in bytes
    files: 1,                     // only one file per request
  },
});

// ---------------------------------------------------------------------------
// Exported middleware
// ---------------------------------------------------------------------------
// uploadAudio is the multer middleware for a single file under the field
// name "audio". This is what your route uses.
//
// handleMulterError sits after uploadAudio and catches multer-specific errors
// (size exceeded, wrong type) and formats them into clean JSON instead of
// letting Express show a raw error.
// ---------------------------------------------------------------------------
const uploadAudio = upload.single('audio');

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 100MB.',
        code: 'FILE_TOO_LARGE',
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: err.field || 'Invalid file type. Only audio files are accepted.',
        code: 'INVALID_FILE_TYPE',
      });
    }
    return res.status(400).json({
      success: false,
      message: 'File upload error.',
      code: err.code,
    });
  }
  next(err);
};

module.exports = { uploadAudio, handleMulterError };