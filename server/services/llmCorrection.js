const axios = require('axios');

// ================================================================
// LLM TRANSCRIPT CORRECTION — Groq (free) + Gemini (free fallback)
// ================================================================
// After WhisperX transcribes, this runs the raw text through an LLM
// to fix misheard words, apply domain context, and clean up grammar.
//
// This catches the last ~5% of errors that even Whisper misses:
//   - "pine eye" → "pine AI"
//   - "harmonica" → "Monica" (when Monica is a participant)
//   - Homophone errors, jargon, etc.
//
// Both Groq and Gemini have generous free tiers.
// ================================================================

const MAX_SEGMENT_BATCH = 10; // Smaller batches to stay within Groq free rate limits
const MAX_RETRIES = 2;

// ----------------------------------------------------------------
// Build the correction prompt
// ----------------------------------------------------------------
const buildCorrectionPrompt = (segments, context = {}) => {
  const { participantNames = [], keywordBoostList = [], title = '', language = 'en' } = context;

  const contextBlock = [];

  if (title) contextBlock.push(`Meeting title: "${title}"`);
  if (participantNames.length > 0) {
    contextBlock.push(`Participants: ${participantNames.join(', ')}`);
  }
  if (keywordBoostList.length > 0) {
    contextBlock.push(`Domain terms/keywords: ${keywordBoostList.slice(0, 30).join(', ')}`);
  }

  const segmentText = segments
    .map((s, i) => `[${s.speaker_label}] ${s.text_segment}`)
    .join('\n');

  return `You are a transcript correction assistant. Fix transcription errors in the meeting transcript below.

CONTEXT:
${contextBlock.join('\n')}

RULES:
1. Fix misheard words using the context above (participant names, domain terms)
2. Fix homophones and similar-sounding word errors
3. Fix punctuation and sentence boundaries
4. DO NOT change the meaning, add information, or summarize
5. DO NOT change speaker labels
6. Keep the exact same number of lines/segments
7. Return ONLY the corrected transcript in the same format: [SPEAKER] text

TRANSCRIPT TO CORRECT:
${segmentText}

CORRECTED TRANSCRIPT:`;
};

// ----------------------------------------------------------------
// Parse LLM response back into segments
// ----------------------------------------------------------------
const parseCorrectedTranscript = (llmResponse, originalSegments) => {
  const lines = llmResponse
    .trim()
    .split('\n')
    .filter((line) => line.trim());

  // If LLM returned wrong number of lines, fall back to originals
  if (lines.length !== originalSegments.length) {
    console.warn(
      `[LLM Correction] Line count mismatch: expected ${originalSegments.length}, got ${lines.length}. ` +
      `Using originals.`
    );
    return originalSegments;
  }

  return originalSegments.map((original, i) => {
    const line = lines[i];
    // Extract text after the [SPEAKER] prefix
    const match = line.match(/^\[.*?\]\s*(.+)$/);
    const correctedText = match ? match[1].trim() : line.trim();

    // Only use corrected text if it's reasonable (not too different)
    if (!correctedText || correctedText.length < 1) {
      return original;
    }

    // Safety check: if the correction changed more than 50% of characters, it's suspicious
    const originalLen = original.text_segment.length;
    const correctedLen = correctedText.length;
    const lenRatio = Math.min(originalLen, correctedLen) / Math.max(originalLen, correctedLen);

    if (lenRatio < 0.3) {
      console.warn(`[LLM Correction] Segment ${i} changed too drastically, keeping original`);
      return original;
    }

    return {
      ...original,
      text_segment: correctedText,
      original_text: original.text_segment,  // Keep original for debugging
    };
  });
};

// ----------------------------------------------------------------
// Call Groq API (free tier — Llama 3.3 70B)
// ----------------------------------------------------------------
const callGroq = async (prompt) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a precise transcript correction assistant. Only fix errors, never add or remove content.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,  // Low temperature for consistent corrections
      max_tokens: 8000,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );

  return response.data.choices?.[0]?.message?.content || '';
};

// ----------------------------------------------------------------
// Call Gemini API (free tier — fallback)
// ----------------------------------------------------------------
const callGemini = async (prompt) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8000,
      },
    },
    { timeout: 60000 }
  );

  return response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
};

// ----------------------------------------------------------------
// correctTranscript(segments, context)
//
// Main entry point. Runs transcript through LLM for correction.
// Processes in batches to handle long meetings.
// ----------------------------------------------------------------
const correctTranscript = async (segments, context = {}) => {
  if (!segments || segments.length === 0) return segments;

  // Check if any LLM is available
  const hasGroq = !!process.env.GROQ_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;

  if (!hasGroq && !hasGemini) {
    console.warn('[LLM Correction] No LLM API keys found — skipping correction');
    return segments;
  }

  console.log(`[LLM Correction] Correcting ${segments.length} segments...`);
  const startTime = Date.now();

  // Process in batches
  const correctedSegments = [];

  for (let i = 0; i < segments.length; i += MAX_SEGMENT_BATCH) {
    const batch = segments.slice(i, i + MAX_SEGMENT_BATCH);
    const batchNum = Math.floor(i / MAX_SEGMENT_BATCH) + 1;
    const totalBatches = Math.ceil(segments.length / MAX_SEGMENT_BATCH);

    console.log(`[LLM Correction] Batch ${batchNum}/${totalBatches} (${batch.length} segments)`);

    const prompt = buildCorrectionPrompt(batch, context);

    let corrected = batch; // Default: keep originals
    let success = false;

    // Try Groq first, then Gemini
    for (let attempt = 0; attempt < MAX_RETRIES && !success; attempt++) {
      try {
        const llmResponse = hasGroq
          ? await callGroq(prompt)
          : await callGemini(prompt);

        corrected = parseCorrectedTranscript(llmResponse, batch);
        success = true;
      } catch (err) {
        const provider = hasGroq ? 'Groq' : 'Gemini';
        console.warn(
          `[LLM Correction] ${provider} attempt ${attempt + 1} failed: ${err.message}`
        );

        // If Groq failed and Gemini is available, try Gemini
        if (hasGroq && hasGemini && attempt === MAX_RETRIES - 1) {
          try {
            console.log('[LLM Correction] Trying Gemini fallback...');
            const geminiResponse = await callGemini(prompt);
            corrected = parseCorrectedTranscript(geminiResponse, batch);
            success = true;
          } catch (geminiErr) {
            console.warn(`[LLM Correction] Gemini also failed: ${geminiErr.message}`);
          }
        }
      }
    }

    correctedSegments.push(...corrected);

    // Small delay between batches to respect rate limits
    if (i + MAX_SEGMENT_BATCH < segments.length) {
      await new Promise((r) => setTimeout(r, 8000)); // 3s delay to respect Groq rate limits (30 req/min)
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const changedCount = correctedSegments.filter((s) => s.original_text).length;
  console.log(`[LLM Correction] Done in ${elapsed}s — ${changedCount}/${segments.length} segments corrected`);

  return correctedSegments;
};

module.exports = { correctTranscript, buildCorrectionPrompt };
