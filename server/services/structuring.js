// ================================================================
// STRUCTURING SERVICE — Optimised (chunked for long meetings)
// ================================================================
// Extracts meeting insights via Groq LLM:
//   - Meeting summary + sentiment + key decisions
//   - Open questions, owners, deadlines
//   - Action items / tasks with assignee + priority
//   - Financial transactions
//
// For long transcripts (>150 segments), splits into chunks to stay
// within Groq's 12K TPM limit, then merges results.
// ================================================================

const { getGroq } = require('./groqClient');
const { pool } = require('../db/db');

const buildTranscriptText = (segments) =>
  segments.map(s => `${s.speaker_label || 'Speaker'}: ${s.text_segment}`).join('\n');

// ── How many segments fit in one Groq call (~10K token budget) ──
const CHUNK_SIZE = 120;

// ================================================================
// SINGLE CHUNK EXTRACTION
// ================================================================
const extractAllInsights = async (transcriptText, sessionTitle, participants, speakerLabels, chunkLabel = '') => {
  const today = new Date().toISOString().split('T')[0]; // e.g. "2026-04-27"

  const system = `You are an expert meeting analyst. Extract structured insights from this meeting transcript${chunkLabel ? ` (${chunkLabel})` : ''}.
Return ONLY a valid JSON object with NO extra text, NO markdown, NO code fences.
Exact structure required:
{
  "summary": {
    "executive_summary": "2-4 sentence overview of what this section was about",
    "key_decisions": [
      "Update the new hire onboarding doc to include the book 'Inspired'",
      "Complete at least three customer interviews per PM"
    ],
    "open_questions": [
      "Kickoff format changes",
      "Product discovery sprint model"
    ],
    "owners": [
      { "area": "Customer Interviews", "owner": "PM Leads" },
      { "area": "Performance Planning", "owner": "Eng Managers" }
    ],
    "deadlines": [
      { "item": "Customer interviews", "due": "End of Q2" },
      { "item": "Onboarding doc update", "due": "Next sprint" }
    ],
    "sentiment": "positive" | "neutral" | "urgent" | "negative"
  },
  "tasks": [
    {
      "description": "clear description of what needs to be done",
      "assignee": "Speaker 1",
      "deadline": "ISO 8601 date or null",
      "priority": "low" | "normal" | "high" | "urgent"
    }
  ],
  "transactions": [
    {
      "type": "expense" | "income",
      "amount": 1234.56,
      "category": "category name",
      "description": "what this is for"
    }
  ]
}

Rules for summary:
- executive_summary: 2-4 sentence overview of the key discussion topics
- key_decisions: ALL explicit decisions made during the meeting. Be thorough:
  - Include policy changes: "We'll update X to include Y"
  - Include process decisions: "Each PM will do 3 interviews"
  - Include tool/approach decisions: "Use screenshots and lo-fi mockups"
  - Include prioritization decisions: "Performance and scalability to become planning criteria"
  - Include delegation decisions: "Use internal teams as customers for feedback"
  - Even if phrased as suggestions that got agreement, count them as decisions
- open_questions: Unresolved topics that need further discussion or follow-up
  - Things someone said "we need to figure out" or "let's discuss later"
  - Questions raised but not answered in the meeting
- owners: Map responsibility areas to the person/team who owns them
  - Use specific speaker labels or role names mentioned
  - Group by area of responsibility
- deadlines: Extract ALL time references attached to any task or decision
  - Use the exact phrasing from the meeting ("next sprint", "end of Q2", "by Friday")
  - If an ISO date can be inferred, include it. Today is ${today}.
- sentiment: urgent=deadlines/crises, negative=conflicts, positive=wins/celebrations, neutral=everything else

Rules for tasks — EXTRACT AGGRESSIVELY:
- Extract ALL action items, commitments, responsibilities, and follow-up actions
- Include EXPLICIT tasks: "I will do X", "Can you handle Y", "Let's schedule Z"
- Include IMPLIED tasks: "We need to finalize the report" → task for the speaker who said it
- Include RESPONSIBILITIES discussed: "You'll handle the transition" → task for the person addressed
- Include FOLLOW-UPS: "Let's circle back on this", "I'll send you the details" → tasks
- assignee: ALWAYS assign to a speaker. Use the speaker label (e.g. "Speaker 1", "Speaker 2"). NEVER use null.
  - If someone says "I will do X" → assign to THAT speaker
  - If someone says "You need to do X" → assign to the OTHER speaker being addressed
  - If a task is mentioned but nobody explicitly commits → assign to the speaker who brought it up
- deadline: extract any mentioned timeframe and convert to ISO 8601 date. Today is ${today}.
  - "next week" → add 7 days, "in 4 weeks" → add 28 days, "by Friday" → next Friday
  - null only if absolutely no timeframe mentioned
- priority: urgent=ASAP/critical/immediately, high=this week/important/soon, low=eventually/when possible, normal=everything else
- You MUST extract at least 1 task per speaker who discussed any action, responsibility, or commitment
- DO NOT return an empty array unless the conversation is purely social with zero actionable content

Rules for transactions:
- Only REAL monetary amounts explicitly stated (e.g. "$500", "fifty thousand rupees")
- amount must be positive number only
- Empty array [] if no financial amounts mentioned

Known speakers: ${speakerLabels.join(', ') || 'Speaker 1, Speaker 2'}
Known participants: ${participants.join(', ') || 'unknown'}
Meeting title: ${sessionTitle || 'Untitled'}`;

  const user = `Transcript:\n${transcriptText}`;

  const response = await getGroq().chat.completions.create({
    model:       'llama-3.3-70b-versatile',
    temperature: 0.1,
    max_tokens:  2500,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user   },
    ],
  });

  const raw     = response.choices[0]?.message?.content || '';
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[Structuring] JSON parse failed. Raw:', raw.slice(0, 500));
    return null;
  }
};

// ================================================================
// MERGE SUMMARIES — synthesize a final summary from chunk summaries
// ================================================================
const mergeSummaries = async (chunkSummaries, sessionTitle) => {
  if (chunkSummaries.length === 1) return chunkSummaries[0];

  const summaryBullets = chunkSummaries
    .map((s, i) => `Part ${i + 1}: ${s.executive_summary}`)
    .join('\n');

  const allDecisions     = chunkSummaries.flatMap(s => s.key_decisions || []);
  const allOpenQuestions  = chunkSummaries.flatMap(s => s.open_questions || []);
  const allOwners        = chunkSummaries.flatMap(s => s.owners || []);
  const allDeadlines     = chunkSummaries.flatMap(s => s.deadlines || []);
  const sentiments       = chunkSummaries.map(s => s.sentiment).filter(Boolean);

  try {
    const response = await getGroq().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 1200,
      messages: [
        {
          role: 'system',
          content: `You merge partial meeting summaries into one final summary. Return ONLY a valid JSON object with NO extra text:
{
  "executive_summary": "3-5 sentence cohesive overview of the ENTIRE meeting",
  "key_decisions": ["decision 1", "decision 2"],
  "open_questions": ["question 1", "question 2"],
  "owners": [{"area": "...", "owner": "..."}],
  "deadlines": [{"item": "...", "due": "..."}],
  "sentiment": "positive" | "neutral" | "urgent" | "negative"
}
Rules:
- Deduplicate decisions and questions — merge similar ones
- Combine owners by area — don't repeat the same area
- Keep deadlines specific — preserve the original phrasing`
        },
        {
          role: 'user',
          content: `Meeting title: ${sessionTitle || 'Untitled'}

Partial summaries:
${summaryBullets}

All decisions found:
${allDecisions.map((d, i) => `${i + 1}. ${d}`).join('\n') || 'None'}

Open questions:
${allOpenQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n') || 'None'}

Owners:
${allOwners.map(o => `- ${o.area}: ${o.owner}`).join('\n') || 'None'}

Deadlines:
${allDeadlines.map(d => `- ${d.item}: ${d.due}`).join('\n') || 'None'}

Part sentiments: ${sentiments.join(', ')}`
        },
      ],
    });

    const raw = response.choices[0]?.message?.content || '';
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.warn('[Structuring] Summary merge failed, using manual merge:', err.message);
    // Fallback: combine manually
    return {
      executive_summary: chunkSummaries.map(s => s.executive_summary).join(' '),
      key_decisions: allDecisions,
      open_questions: allOpenQuestions,
      owners: allOwners,
      deadlines: allDeadlines,
      sentiment: sentiments.includes('urgent') ? 'urgent' :
                 sentiments.includes('negative') ? 'negative' :
                 sentiments.includes('positive') ? 'positive' : 'neutral',
    };
  }
};

// ================================================================
// MAIN EXPORT
// ================================================================
const structureSession = async (sessionId, userId, segments, sessionTitle, participants) => {
  console.log(`[Structuring] Starting for session ${sessionId} (${segments.length} segments)`);

  if (!segments || segments.length === 0) {
    console.warn('[Structuring] No segments — skipping');
    return;
  }

  if (!process.env.GROQ_API_KEY) {
    console.warn('[Structuring] No GROQ_API_KEY — skipping');
    return;
  }

  const participantList = Array.isArray(participants) ? participants : [];
  const speakerLabels   = [...new Set(segments.map(s => s.speaker_label).filter(Boolean))];

  // ── Chunk the transcript if it's too long ─────────────────────
  const needsChunking = segments.length > CHUNK_SIZE;
  let insights = null;

  if (!needsChunking) {
    // Small meeting — single call
    const transcriptText = buildTranscriptText(segments);
    try {
      insights = await extractAllInsights(transcriptText, sessionTitle, participantList, speakerLabels);
    } catch (err) {
      console.error('[Structuring] Extraction failed:', err.message);
      return;
    }
  } else {
    // Large meeting — chunk, extract, merge
    const numChunks = Math.ceil(segments.length / CHUNK_SIZE);
    console.log(`[Structuring] Transcript too large (${segments.length} segments) — splitting into ${numChunks} chunks of ~${CHUNK_SIZE}`);

    const chunkInsights = [];
    for (let i = 0; i < numChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end   = Math.min(start + CHUNK_SIZE, segments.length);
      const chunk = segments.slice(start, end);
      const chunkText = buildTranscriptText(chunk);
      const label = `part ${i + 1} of ${numChunks}`;

      try {
        console.log(`[Structuring] Extracting chunk ${i + 1}/${numChunks} (segments ${start}–${end - 1})...`);
        const result = await extractAllInsights(chunkText, sessionTitle, participantList, speakerLabels, label);
        if (result) chunkInsights.push(result);
      } catch (err) {
        console.warn(`[Structuring] Chunk ${i + 1} failed: ${err.message}`);
      }

      // Small delay between chunks to respect rate limits
      if (i < numChunks - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (chunkInsights.length === 0) {
      console.warn('[Structuring] All chunks failed — no insights');
      return;
    }

    // Merge chunk results
    const chunkSummaries = chunkInsights.map(c => c.summary).filter(Boolean);
    const mergedSummary  = chunkSummaries.length > 0
      ? await mergeSummaries(chunkSummaries, sessionTitle)
      : null;

    // Wait for rate limit cooldown before the merge call
    await new Promise(r => setTimeout(r, 2000));

    const allTasks        = chunkInsights.flatMap(c => Array.isArray(c.tasks) ? c.tasks : []);
    const allTransactions = chunkInsights.flatMap(c => Array.isArray(c.transactions) ? c.transactions : []);

    insights = {
      summary: mergedSummary,
      tasks: allTasks,
      transactions: allTransactions,
    };

    console.log(`[Structuring] Merged ${chunkInsights.length} chunks → ${allTasks.length} tasks, ${allTransactions.length} transactions`);
  }

  if (!insights) {
    console.warn('[Structuring] No insights returned');
    return;
  }

  // ── Save summary ─────────────────────────────────────────────
  if (insights.summary) {
    const s = insights.summary;
    try {
      await pool.query(
        `INSERT INTO meeting_summaries
           (session_id, executive_summary, key_decisions, open_questions, owners, deadlines, sentiment)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7)
         ON CONFLICT (session_id) DO UPDATE
           SET executive_summary = EXCLUDED.executive_summary,
               key_decisions     = EXCLUDED.key_decisions,
               open_questions    = EXCLUDED.open_questions,
               owners            = EXCLUDED.owners,
               deadlines         = EXCLUDED.deadlines,
               sentiment         = EXCLUDED.sentiment`,
        [
          sessionId,
          s.executive_summary || '',
          JSON.stringify(s.key_decisions || []),
          JSON.stringify(s.open_questions || []),
          JSON.stringify(s.owners || []),
          JSON.stringify(s.deadlines || []),
          ['positive','neutral','urgent','negative'].includes(s.sentiment) ? s.sentiment : 'neutral',
        ]
      );
      console.log(`[Structuring] ✅ Summary saved (${s.sentiment}) — ${(s.key_decisions || []).length} decisions, ${(s.open_questions || []).length} questions`);
    } catch (err) {
      console.error('[Structuring] Summary save failed:', err.message);
    }
  }

  // ── Save tasks ───────────────────────────────────────────────
  const tasks = Array.isArray(insights.tasks) ? insights.tasks : [];
  let savedTasks = 0;
  for (const task of tasks) {
    if (!task.description) continue;
    try {
      await pool.query(
        `INSERT INTO tasks (session_id, user_id, assignee, description, deadline, priority)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          sessionId,
          userId,
          task.assignee || 'Unassigned',
          task.description,
          task.deadline  || null,
          ['low','normal','high','urgent'].includes(task.priority) ? task.priority : 'normal',
        ]
      );
      savedTasks++;
    } catch (err) {
      console.error('[Structuring] Task save failed:', err.message);
    }
  }
  console.log(`[Structuring] ✅ ${savedTasks}/${tasks.length} tasks saved`);

  // ── Save transactions ────────────────────────────────────────
  const transactions = Array.isArray(insights.transactions) ? insights.transactions : [];
  let savedTxns = 0;
  for (const txn of transactions) {
    if (!txn.amount || !txn.category) continue;
    try {
      await pool.query(
        `INSERT INTO transactions (session_id, user_id, type, amount, category, description)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          sessionId,
          userId,
          txn.type === 'income' ? 'income' : 'expense',
          parseFloat(txn.amount),
          txn.category || 'Other',
          txn.description || null,
        ]
      );
      savedTxns++;
    } catch (err) {
      console.error('[Structuring] Transaction save failed:', err.message);
    }
  }
  console.log(`[Structuring] ✅ ${savedTxns}/${transactions.length} transactions saved`);

  console.log(`[Structuring] ✅ Done for session ${sessionId}`);
};

module.exports = { structureSession };
