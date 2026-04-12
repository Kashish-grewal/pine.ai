// ================================================================
// POST-PROCESSING — Speaker correction layer (enhanced)
// ================================================================
// Runs AFTER transcription, BEFORE LLM correction + DB write.
//
// Rules from original:
//   Rule 1 — Honorific tail ("...yes sir." → candidate)
//   Rule 2 — Name address ("Monica, you said..." → panel member)
//   Rule 3 — Short orphan (≤3 words, inherit previous speaker)
//
// NEW rules for WhisperX output:
//   Rule 4 — Speaker consistency (fix mid-conversation label flips)
//   Rule 5 — Overlap resolution (merge overlapping segments correctly)
//   Rule 6 — Short gap merge (combine fragments from same speaker)
// ================================================================

/**
 * Auto-detect which speaker label belongs to the candidate.
 * The candidate is whoever uses "sir" / "ma'am" most across all segments.
 *
 * @param   {Array}  utterances  - utterances with .speaker and .text
 * @returns {string|null}        - label like "A", "SPEAKER_00", etc.
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
 * Rule 4: Speaker consistency scoring.
 *
 * Detects and fixes mid-conversation speaker label flips.
 * If a speaker says one segment, then the next segment is assigned to
 * a different speaker but sounds like a continuation (no pause, similar
 * length), it's likely a diarization error.
 *
 * @param {Array} utterances - array with .speaker, .text, .start, .end
 * @returns {Array} corrected utterances
 */
const fixSpeakerConsistency = (utterances) => {
  if (!utterances || utterances.length < 3) return utterances;

  const result = utterances.map((u) => ({ ...u }));

  for (let i = 1; i < result.length - 1; i++) {
    const prev = result[i - 1];
    const curr = result[i];
    const next = result[i + 1];

    // Pattern: A → B → A with B being very short and close to both
    // This is likely a misattribution of B
    if (
      prev.speaker === next.speaker &&
      curr.speaker !== prev.speaker
    ) {
      const currDuration = (curr.end - curr.start);
      const gapBefore = curr.start - prev.end;
      const gapAfter = next.start - curr.end;

      // Short segment (<2s) sandwiched closely between same speaker
      if (currDuration < 2000 && gapBefore < 500 && gapAfter < 500) {
        const wordCount = curr.text.split(/\s+/).length;
        // Only fix if it's a short interjection (≤5 words)
        if (wordCount <= 5) {
          result[i] = {
            ...curr,
            speaker: prev.speaker,
            original_speaker: curr.speaker,
          };
        }
      }
    }
  }

  return result;
};

/**
 * Rule 5: Overlap resolution.
 *
 * WhisperX may produce overlapping segments (same time range, different speakers).
 * This sorts them and ensures clean boundaries.
 *
 * @param {Array} utterances
 * @returns {Array} non-overlapping utterances
 */
const resolveOverlaps = (utterances) => {
  if (!utterances || utterances.length < 2) return utterances;

  // Sort by start time
  const sorted = [...utterances].sort((a, b) => a.start - b.start);

  const result = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = result[result.length - 1];
    const curr = sorted[i];

    // If segments overlap in time
    if (curr.start < prev.end) {
      if (prev.speaker === curr.speaker) {
        // Same speaker overlapping — merge
        prev.end = Math.max(prev.end, curr.end);
        prev.text = prev.text + ' ' + curr.text;
      } else {
        // Different speakers overlapping — trim the overlap
        // Give the overlap to the speaker with the longer segment
        const prevDuration = prev.end - prev.start;
        const currDuration = curr.end - curr.start;

        if (prevDuration >= currDuration) {
          // Trim current's start to after prev's end
          curr.start = prev.end;
          if (curr.start < curr.end) {
            result.push(curr);
          }
        } else {
          // Trim prev's end to current's start
          prev.end = curr.start;
          result.push(curr);
        }
      }
    } else {
      result.push(curr);
    }
  }

  return result;
};

/**
 * Rule 6: Short gap merge.
 *
 * Merge consecutive segments from the same speaker that are very close
 * together (gap < 300ms). WhisperX sometimes splits continuous speech
 * into tiny fragments.
 *
 * @param {Array} utterances
 * @returns {Array} merged utterances
 */
const mergeShortGaps = (utterances) => {
  if (!utterances || utterances.length < 2) return utterances;

  const result = [{ ...utterances[0] }];

  for (let i = 1; i < utterances.length; i++) {
    const prev = result[result.length - 1];
    const curr = utterances[i];

    const sameSpeaker = prev.speaker === curr.speaker;
    const smallGap = (curr.start - prev.end) < 300; // 300ms threshold

    if (sameSpeaker && smallGap) {
      prev.end = curr.end;
      prev.text = prev.text + ' ' + curr.text;
    } else {
      result.push({ ...curr });
    }
  }

  return result;
};

/**
 * Apply rule-based corrections to speaker labels.
 *
 * @param {Array}  utterances         - utterances with .speaker, .text, .start, .end
 * @param {Object} opts
 * @param {string} [opts.candidateLabel]     - known label, or auto-detected
 * @param {string[]} [opts.participantNames] - e.g. ["Monica"] from session metadata
 * @returns {Array} utterances with corrected .speaker, original kept in .original_speaker
 */
const correctSpeakers = (utterances, opts = {}) => {
  if (!utterances || utterances.length === 0) return utterances;

  const { participantNames = [] } = opts;

  // Step 1: Fix overlaps and merge fragments
  let processed = resolveOverlaps(utterances);
  processed = mergeShortGaps(processed);

  // Step 2: Fix speaker consistency (sandwich pattern)
  processed = fixSpeakerConsistency(processed);

  // Step 3: Apply original semantic rules
  const candidateLabel = opts.candidateLabel ?? detectCandidateLabel(processed);

  if (!candidateLabel) {
    console.warn('[Postprocess] Could not detect candidate speaker label — returning with structural fixes only');
    return processed;
  }

  console.log(`[Postprocess] Candidate detected as Speaker ${candidateLabel}`);

  const nameLower = participantNames.map((n) => n.toLowerCase());

  // Track the most recent non-candidate speaker for inheritance
  let lastPanelSpeaker = null;

  return processed.map((u, i) => {
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
      corrected = processed[i - 1].speaker; // inherit prev
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
 * Convert speaker labels to human-readable names.
 *
 * Example:
 *   candidateSpeakerLabel = "SPEAKER_00", candidateName = "Monica"
 *   Result: SPEAKER_00 → "Monica", SPEAKER_01 → "Panelist 1", etc.
 *
 * @param {Array}  utterances
 * @param {string} candidateSpeakerLabel  - e.g. "SPEAKER_00" or "A"
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