// ================================================================
// POST-PROCESSING — Speaker correction layer
// ================================================================
// Runs AFTER AssemblyAI returns utterances, BEFORE DB write.
//
// AssemblyAI clusters voices by acoustic similarity alone.
// These rules add semantic context it can't know:
//
//   Rule 1 — Honorific tail
//     "...yes sir." / "...thank you ma'am" at the END of a segment
//     → must be the candidate. No panel member addresses another
//       panel member as "sir" in this format.
//
//   Rule 2 — Name address
//     Segment opens with the candidate's name ("Monica, you said...")
//     → must be a panel member speaking, not the candidate.
//
//   Rule 3 — Short orphan
//     Segment is ≤ 3 words AND has no honorific AND the previous
//     speaker was different → likely a mis-boundary, inherit prev.
//     Catches: "Yes.", "Okay.", "Right." being flipped.
//
// correctSpeakers() works on raw AssemblyAI utterances.
// relabelSpeakers() converts "A"/"B"/"C" to readable names.
// ================================================================

/**
 * Auto-detect which AssemblyAI speaker label belongs to the candidate.
 * The candidate is whoever uses "sir" / "ma'am" most across all segments.
 *
 * @param   {Array}  utterances  - raw AssemblyAI utterances
 * @returns {string|null}        - label like "A", "B", etc.
 */
const detectCandidateLabel = (utterances) => {
  const counts = {};
  for (const u of utterances) {
    if (/\b(sir|ma'?am)\b/i.test(u.text)) {
      counts[u.speaker] = (counts[u.speaker] || 0) + 1;
    }
  }
  if (Object.keys(counts).length === 0) return null;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
};

/**
 * Apply rule-based corrections to speaker labels.
 *
 * @param {Array}  utterances         - raw AssemblyAI utterances
 * @param {Object} opts
 * @param {string} [opts.candidateLabel]     - known label, or auto-detected
 * @param {string[]} [opts.participantNames] - e.g. ["Monica"] from session metadata
 * @returns {Array} utterances with corrected .speaker, original kept in .original_speaker
 */
const correctSpeakers = (utterances, opts = {}) => {
  if (!utterances || utterances.length === 0) return utterances;

  const { participantNames = [] } = opts;

  // Auto-detect candidate if not provided
  const candidateLabel = opts.candidateLabel ?? detectCandidateLabel(utterances);

  if (!candidateLabel) {
    console.warn('[Postprocess] Could not detect candidate speaker label — skipping correction');
    return utterances;
  }

  console.log(`[Postprocess] Candidate detected as Speaker ${candidateLabel}`);

  const nameLower = participantNames.map((n) => n.toLowerCase());

  // Track the most recent non-candidate speaker for inheritance
  let lastPanelSpeaker = null;

  return utterances.map((u, i) => {
    const text = u.text.trim();
    const textLower = text.toLowerCase();
    let corrected = u.speaker;

    // ── Rule 1: segment ends with honorific → candidate ─────────────
    if (/\b(sir|ma'?am)[.!,]?\s*$/.test(textLower)) {
      corrected = candidateLabel;
    }

    // ── Rule 2: segment opens with candidate's name → panel member ──
    const openedWithName = nameLower.some((name) => {
      return (
        textLower.startsWith(name + ',')  ||
        textLower.startsWith(name + '.')  ||
        textLower.startsWith(name + ' ')  ||
        textLower.startsWith('so ' + name)  ||
        textLower.startsWith('okay ' + name) ||
        textLower.startsWith('ok ' + name)   ||
        textLower.startsWith('right ' + name)
      );
    });

    if (openedWithName && lastPanelSpeaker) {
      corrected = lastPanelSpeaker;
    }

    // ── Rule 3: very short segment with no honorific ─────────────────
    const wordCount = text.split(/\s+/).length;
    const hasHonorific = /\b(sir|ma'?am)\b/i.test(text);
    if (wordCount <= 3 && !hasHonorific && i > 0) {
      corrected = utterances[i - 1].speaker; // inherit prev
    }

    // Track the last panel speaker for rule 2 fallback
    if (corrected !== candidateLabel) {
      lastPanelSpeaker = corrected;
    }

    return {
      ...u,
      speaker:          corrected,
      original_speaker: u.speaker,           // keep original for debugging
    };
  });
};

/**
 * Convert AssemblyAI letter labels to human-readable names.
 *
 * Example:
 *   candidateSpeakerLabel = "A", candidateName = "Monica"
 *   Result: A → "Monica", B → "Panelist 1", C → "Panelist 2"
 *
 * @param {Array}  utterances
 * @param {string} candidateSpeakerLabel  - e.g. "A"
 * @param {string} candidateName          - e.g. "Monica"
 * @returns {Array}
 */
const relabelSpeakers = (utterances, candidateSpeakerLabel, candidateName) => {
  if (!candidateSpeakerLabel || !candidateName) return utterances;

  const labelMap = { [candidateSpeakerLabel]: candidateName };
  let panelIndex = 1;

  return utterances.map((u) => {
    if (!labelMap[u.speaker]) {
      labelMap[u.speaker] = `Panelist ${panelIndex++}`;
    }
    return { ...u, speaker: labelMap[u.speaker] };
  });
};

module.exports = { correctSpeakers, relabelSpeakers, detectCandidateLabel };