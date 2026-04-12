const DEFAULT_LANGUAGE_LOCALE = 'en-US';
const MAX_KEYWORDS = 60;

const MEDIUM_PRIORITY_DICTIONARY = [
  'api', 'backend', 'frontend', 'kubernetes', 'deployment', 'invoice', 'budget',
  'timeline', 'deadline', 'roadmap', 'meeting', 'followup', 'action-item',
  'sprint', 'bug', 'release', 'production', 'staging', 'infrastructure',
  'database', 'postgres', 'assemblyai', 'diarization', 'transcript',
  'architecture', 'authentication', 'integration', 'microservice', 'compliance',
];

const LOW_PRIORITY_TERMS = [
  'eta', 'sla', 'okr', 'kpi', 'poc', 'mvp', 'qa', 'ui', 'ux', 'llm', 'asr',
  'stt', 'pii', 'json', 'csv', 'sdk', 'api', 'infra', 'ops', 'sync', 'async',
];

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'did',
  'do', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'i', 'if',
  'in', 'into', 'is', 'it', 'its', 'just', 'me', 'my', 'not', 'of', 'on', 'or',
  'our', 'out', 'she', 'so', 'that', 'the', 'their', 'them', 'there', 'they',
  'this', 'to', 'too', 'up', 'us', 'was', 'we', 'were', 'what', 'when', 'which',
  'who', 'will', 'with', 'you', 'your', 'okay', 'right', 'yes', 'no',
]);

const collapseWhitespace = (value) => value.replace(/\s+/g, ' ').trim();

const parseMaybeJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // Fallback to comma splitting below.
    }
  }

  return trimmed.split(',');
};

const normalizeLanguageLocale = (value) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return DEFAULT_LANGUAGE_LOCALE;

  const normalized = raw.replace(/_/g, '-');
  if (!/^[A-Za-z]{2,3}(-[A-Za-z]{2})?$/.test(normalized)) {
    return DEFAULT_LANGUAGE_LOCALE;
  }

  const [language, region] = normalized.split('-');
  if (!region) {
    if (language.toLowerCase() === 'en') return 'en-US';
    if (language.toLowerCase() === 'hi') return 'hi-IN';
    return language.toLowerCase();
  }

  return `${language.toLowerCase()}-${region.toUpperCase()}`;
};

const normalizeExpectedSpeakerCount = (value, participantCount = 0) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 20) {
    return parsed;
  }

  if (participantCount > 0 && participantCount <= 20) {
    return participantCount;
  }

  return null;
};

const normalizeKeywordCasing = (term) => {
  if (/^[A-Z0-9]{2,8}$/.test(term)) return term;
  return term;
};

const sanitizePhraseArray = (input, options = {}) => {
  const {
    maxItems = 60,
    maxLength = 80,
    minLength = 2,
  } = options;

  const seen = new Set();
  const cleaned = [];

  for (const rawItem of parseMaybeJsonArray(input)) {
    if (typeof rawItem !== 'string') continue;

    const candidate = collapseWhitespace(rawItem).slice(0, maxLength);
    if (candidate.length < minLength) continue;

    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    cleaned.push(candidate);

    if (cleaned.length >= maxItems) break;
  }

  return cleaned;
};

const generateNameVariants = (name) => {
  const base = collapseWhitespace(name);
  if (!base) return [];

  const parts = base.split(' ').filter(Boolean);
  const variants = new Set([base]);

  if (parts.length > 1) {
    variants.add(parts[0]);
    variants.add(parts.join(''));
  }

  return Array.from(variants);
};

const isNoisyKeyword = (term) => {
  const clean = term.trim();
  if (!clean) return true;
  if (clean.length < 2 || clean.length > 80) return true;
  if (/^[0-9]+$/.test(clean)) return true;
  if (STOP_WORDS.has(clean.toLowerCase())) return true;
  return false;
};

const tokenizeText = (text) => {
  if (!text || typeof text !== 'string') return [];

  const matches = text.match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g) || [];
  return matches
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !STOP_WORDS.has(token.toLowerCase()));
};

const extractFrequentTermsFromTexts = (texts, limit = 40) => {
  const counts = new Map();

  for (const text of texts || []) {
    for (const token of tokenizeText(text)) {
      const key = token.toLowerCase();
      const current = counts.get(key) || { term: token, count: 0 };
      current.count += 1;
      // Keep acronym casing when encountered.
      if (/^[A-Z0-9]{2,8}$/.test(token)) {
        current.term = token;
      }
      counts.set(key, current);
    }
  }

  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
};

const addScoredTerm = (scoreMap, term, score) => {
  const cleanTerm = collapseWhitespace(term || '');
  if (isNoisyKeyword(cleanTerm)) return;

  const key = cleanTerm.toLowerCase();
  const existing = scoreMap.get(key);

  if (!existing || score > existing.score) {
    scoreMap.set(key, {
      term: normalizeKeywordCasing(cleanTerm),
      score,
    });
    return;
  }

  existing.score += Math.max(1, Math.floor(score * 0.1));
};

const buildTranscriptionMetadata = (input) => {
  const participantNames = sanitizePhraseArray(input.participantNames, { maxItems: 20 });
  const userKeywords = sanitizePhraseArray(input.userKeywords, { maxItems: 40 });
  const languageLocale = normalizeLanguageLocale(input.languageLocale);
  const expectedSpeakerCount = normalizeExpectedSpeakerCount(
    input.expectedSpeakerCount,
    participantNames.length
  );

  const scoreMap = new Map();

  for (const name of participantNames) {
    addScoredTerm(scoreMap, name, 120);
    for (const variant of generateNameVariants(name)) {
      addScoredTerm(scoreMap, variant, 105);
    }
  }

  for (const keyword of userKeywords) {
    addScoredTerm(scoreMap, keyword, 95);
  }

  const titleAndDescriptionTerms = extractFrequentTermsFromTexts([
    input.title || '',
    input.description || '',
  ], 20);

  for (const term of titleAndDescriptionTerms) {
    addScoredTerm(scoreMap, term.term, 60 + Math.min(term.count, 5));
  }

  for (const term of MEDIUM_PRIORITY_DICTIONARY) {
    addScoredTerm(scoreMap, term, 45);
  }

  for (const term of LOW_PRIORITY_TERMS) {
    addScoredTerm(scoreMap, term, 25);
  }

  for (const historical of input.historicalTerms || []) {
    if (typeof historical === 'string') {
      addScoredTerm(scoreMap, historical, 45);
      continue;
    }

    if (historical && typeof historical.term === 'string') {
      const countBonus = Number.isFinite(historical.count)
        ? Math.min(Math.max(historical.count, 0), 15)
        : 0;
      addScoredTerm(scoreMap, historical.term, 45 + countBonus);
    }
  }

  for (const term of input.historicalConfirmedKeywords || []) {
    addScoredTerm(scoreMap, term, 75);
  }

  const sortedKeywords = Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_KEYWORDS)
    .map((entry) => entry.term);

  const keywordBoostList = sortedKeywords.length > 0
    ? sortedKeywords
    : participantNames;

  return {
    participantNames,
    expectedSpeakerCount,
    languageLocale,
    userKeywords,
    keywordBoostList,
  };
};

module.exports = {
  buildTranscriptionMetadata,
  extractFrequentTermsFromTexts,
  normalizeExpectedSpeakerCount,
  normalizeLanguageLocale,
  sanitizePhraseArray,
};
