// ================================================================
// EXTENSION DOWNLOAD ROUTE
// ================================================================
// GET /api/v1/extension/download → Zips and serves the extension
// ================================================================

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

// ---------------------------------------------------------------------------
// GET /download — Stream the extension folder as a .zip file
// ---------------------------------------------------------------------------
router.get('/download', (req, res, next) => {
  const extensionDir = path.join(__dirname, '..', '..', 'extension');

  // Verify the extension folder exists
  if (!fs.existsSync(extensionDir)) {
    return res.status(404).json({
      success: false,
      message: 'Extension files not found on server.',
    });
  }

  // Set headers for zip download
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="pine-ai-extension.zip"');

  // Create a zip archive and pipe it directly to the response
  const archive = archiver('zip', { zlib: { level: 6 } });

  archive.on('error', (err) => {
    console.error('[Extension] Archive error:', err);
    // Only send error if headers haven't been sent
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to create extension archive.' });
    }
  });

  archive.pipe(res);

  // Add the entire extension directory contents into the zip
  // The files will be at the root of the zip (no wrapper folder)
  archive.directory(extensionDir, 'pine-ai-extension');

  archive.finalize();
});

// ---------------------------------------------------------------------------
// GET /info — Returns extension metadata (version, name, etc.)
// ---------------------------------------------------------------------------
router.get('/info', (req, res) => {
  const manifestPath = path.join(__dirname, '..', '..', 'extension', 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({
      success: false,
      message: 'Extension manifest not found.',
    });
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    res.json({
      success: true,
      extension: {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
      },
    });
  } catch (err) {
    console.error('[Extension] Failed to read manifest:', err);
    res.status(500).json({ success: false, message: 'Failed to read extension info.' });
  }
});

module.exports = router;
