// ================================================================
// WORKFLOW ROUTES
// ================================================================
// GET /api/v1/workflow/:sessionId
//   → Returns Mermaid flowchart markdown for a session
//   ?refresh=true forces LLM re-generation (bypasses cache)
// ================================================================

const express = require('express');
const router = express.Router();
const { pool } = require('../db/db');
const { protect } = require('../middleware/auth');
const { generateMeetingWorkflow } = require('../services/workflowVisualization');
const { enrichTasksWithCalendarUrls } = require('../services/calendarService');

// ── In-memory cache: sessionId → { mermaid, generatedAt } ────────
// Prevents hitting Groq on every tab click. TTL = 1 hour.
const workflowCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const getCached = (sessionId) => {
  const entry = workflowCache.get(sessionId);
  if (!entry) return null;
  if (Date.now() - entry.generatedAt > CACHE_TTL_MS) {
    workflowCache.delete(sessionId);
    return null;
  }
  return entry.mermaid;
};

const setCache = (sessionId, mermaid) => {
  workflowCache.set(sessionId, { mermaid, generatedAt: Date.now() });
  // Evict oldest entries if cache grows too large
  if (workflowCache.size > 200) {
    const oldest = [...workflowCache.entries()]
      .sort((a, b) => a[1].generatedAt - b[1].generatedAt)[0];
    if (oldest) workflowCache.delete(oldest[0]);
  }
};

// GET /api/v1/workflow/:sessionId
router.get('/:sessionId', protect, async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const forceRefresh = req.query.refresh === 'true';

    // ── Check cache first (skip if ?refresh=true) ─────────────────
    if (!forceRefresh) {
      const cached = getCached(sessionId);
      if (cached) {
        console.log(`[Workflow] Cache hit for session ${sessionId}`);
        // Still need tasks for calendar URLs — fetch from DB quickly
        const [sessionRes, tasksRes] = await Promise.all([
          pool.query('SELECT session_id, title FROM sessions WHERE session_id = $1 AND user_id = $2', [sessionId, req.user.userId]),
          pool.query('SELECT description, assignee, deadline, priority FROM tasks WHERE session_id = $1 ORDER BY created_at ASC', [sessionId]),
        ]);
        if (sessionRes.rows.length === 0)
          return res.status(404).json({ success: false, message: 'Session not found.' });
        const tasks = tasksRes.rows || [];
        const tasksWithCalendar = enrichTasksWithCalendarUrls(tasks, sessionRes.rows[0].title);
        return res.json({
          success: true,
          cached: true,
          data: { mermaid: cached, tasks: tasksWithCalendar, sessionTitle: sessionRes.rows[0].title },
        });
      }
    }

    // ── Verify session ownership ───────────────────────────────────
    const sessionResult = await pool.query(
      `SELECT session_id, title, participants FROM sessions
       WHERE session_id = $1 AND user_id = $2`,
      [sessionId, req.user.userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Session not found.' });
    }

    const session = sessionResult.rows[0];

    // ── Fetch summary, tasks, and transcript in parallel ──────────
    const [summaryResult, tasksResult, transcriptResult] = await Promise.all([
      pool.query(
        `SELECT executive_summary, key_decisions, sentiment FROM meeting_summaries WHERE session_id = $1`,
        [sessionId]
      ),
      pool.query(
        `SELECT description, assignee, deadline, priority FROM tasks WHERE session_id = $1 ORDER BY created_at ASC`,
        [sessionId]
      ),
      pool.query(
        `SELECT speaker_label, text_segment FROM transcripts WHERE session_id = $1 ORDER BY start_time ASC LIMIT 20`,
        [sessionId]
      ),
    ]);

    const summary  = summaryResult.rows[0]  || {};
    const tasks    = tasksResult.rows        || [];
    const segments = transcriptResult.rows   || [];

    // ── Generate Mermaid diagram via LLM ──────────────────────────
    console.log(`[Workflow] Generating diagram for session ${sessionId} via LLM...`);
    const mermaid = await generateMeetingWorkflow({
      title:     session.title,
      summary:   summary.executive_summary,
      decisions: summary.key_decisions || [],
      tasks,
      segments,
    });

    // ── Cache the result ──────────────────────────────────────────
    setCache(sessionId, mermaid);

    const tasksWithCalendar = enrichTasksWithCalendarUrls(tasks, session.title);

    res.json({
      success: true,
      cached: false,
      data: {
        mermaid,
        tasks: tasksWithCalendar,
        sessionTitle: session.title,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
