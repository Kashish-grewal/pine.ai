// ================================================================
// SHARED GROQ CLIENT
// ================================================================
// Single Groq SDK instance shared across all services.
// Avoids creating redundant clients in transcription, structuring,
// and workflow visualization services.
// ================================================================

const Groq = require('groq-sdk');

let _groq = null;

const getGroq = () => {
  if (!_groq) {
    const apiKey = process.env.GROQ_API_KEY_STRUCTURING || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('No Groq API key configured (set GROQ_API_KEY)');
    _groq = new Groq({ apiKey });
  }
  return _groq;
};

module.exports = { getGroq };
