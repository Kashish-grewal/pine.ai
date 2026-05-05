const express = require('express');
const router = express.Router();
const { pool } = require('../db/db');
const {
  sendSummaryEmail,
  sendSummaryToMultiple,
  sendPersonalizedEmails,
  getEmailStatus,
  initializeEmailTable,
} = require('../services/emailService');
const { protect } = require('../middleware/auth');

// Initialize email table on startup
initializeEmailTable();

// ================================================================
// POST /email/send — Send meeting summary to participants
// ================================================================
router.post('/send', protect, async (req, res) => {
  try {
    const { sessionId, recipients } = req.body;
    const userId = req.user.userId;

    if (!sessionId || !recipients || !Array.isArray(recipients)) {
      return res.status(400).json({ error: 'sessionId and recipients array required' });
    }

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'At least one recipient required' });
    }

    // Verify user owns this session
    const sessionResult = await pool.query(
      'SELECT session_id, title FROM sessions WHERE session_id = $1 AND user_id = $2',
      [sessionId, userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];

    // Get summary, tasks, transactions
    const summaryResult = await pool.query(
      'SELECT * FROM meeting_summaries WHERE session_id = $1',
      [sessionId]
    );
    const summary = summaryResult.rows[0] || null;

    const tasksResult = await pool.query(
      'SELECT * FROM tasks WHERE session_id = $1 ORDER BY priority DESC',
      [sessionId]
    );
    const tasks = tasksResult.rows;

    const transactionsResult = await pool.query(
      'SELECT * FROM transactions WHERE session_id = $1 ORDER BY created_at DESC',
      [sessionId]
    );
    const transactions = transactionsResult.rows;

    // Get user info for email
    const userResult = await pool.query(
      'SELECT email, full_name FROM users WHERE user_id = $1',
      [userId]
    );
    const user = userResult.rows[0];

    // Send emails
    const results = await sendSummaryToMultiple({
      sessionId,
      recipients,
      userName: user.full_name || 'Pine.AI User',
      summary,
      tasks,
      transactions,
      sessionData: session,
    });

    // Return results
    return res.json(results);
  } catch (err) {
    console.error('[Email Route] Send failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ================================================================
// POST /email/send-to-assignee — Auto-send task to assigned person
// ================================================================
router.post('/send-to-assignee', protect, async (req, res) => {
  try {
    const { taskId } = req.body;
    const userId = req.user.userId;

    if (!taskId) {
      return res.status(400).json({ error: 'taskId required' });
    }

    // Get task
    const taskResult = await pool.query(
      `SELECT t.* FROM tasks t
       WHERE t.task_id = $1 AND t.user_id = $2`,
      [taskId, userId]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = taskResult.rows[0];
    if (!task.assignee) {
      return res.status(400).json({ error: 'Task has no assignee' });
    }

    // Get summary, all tasks, transactions for context
    const summaryResult = await pool.query(
      'SELECT * FROM meeting_summaries WHERE session_id = $1',
      [task.session_id]
    );
    const summary = summaryResult.rows[0] || null;

    const tasksResult = await pool.query(
      'SELECT * FROM tasks WHERE session_id = $1 ORDER BY priority DESC',
      [task.session_id]
    );
    const tasks = tasksResult.rows;

    const transactionsResult = await pool.query(
      'SELECT * FROM transactions WHERE session_id = $1 ORDER BY created_at DESC',
      [task.session_id]
    );
    const transactions = transactionsResult.rows;

    const userResult = await pool.query(
      'SELECT full_name FROM users WHERE user_id = $1',
      [userId]
    );
    const user = userResult.rows[0];

    const sessionResult = await pool.query(
      'SELECT * FROM sessions WHERE session_id = $1',
      [task.session_id]
    );
    const session = sessionResult.rows[0];

    // Send to assignee
    await sendSummaryEmail({
      sessionId: task.session_id,
      toEmail: task.assignee,
      userName: user.full_name || 'Pine.AI User',
      summary,
      tasks,
      transactions,
      sessionData: session,
    });

    return res.json({ success: true, message: `Email sent to ${task.assignee}` });
  } catch (err) {
    console.error('[Email Route] Send to assignee failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ================================================================
// GET /email/status/:resendId — Check email delivery status
// ================================================================
router.get('/status/:resendId', protect, async (req, res) => {
  try {
    const { resendId } = req.params;

    const status = await getEmailStatus(resendId);
    if (!status) {
      return res.status(404).json({ error: 'Email status not found' });
    }

    return res.json({ resendId, status });
  } catch (err) {
    console.error('[Email Route] Status check failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ================================================================
// GET /email/logs/:sessionId — Get email delivery logs for a session
// ================================================================
router.get('/logs/:sessionId', protect, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.userId;

    // Verify user owns session
    const sessionResult = await pool.query(
      'SELECT session_id FROM sessions WHERE session_id = $1 AND user_id = $2',
      [sessionId, userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get email logs
    const logsResult = await pool.query(
      `SELECT recipient_email, status, resend_id, error_detail, sent_at
       FROM email_logs
       WHERE session_id = $1
       ORDER BY sent_at DESC`,
      [sessionId]
    );

    return res.json({ logs: logsResult.rows });
  } catch (err) {
    console.error('[Email Route] Logs failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ================================================================
// POST /email/send-personalized — Personalized email per participant
// Each person gets only THEIR tasks + shared summary + decisions
// ================================================================
router.post('/send-personalized', protect, async (req, res) => {
  try {
    const { sessionId, recipients } = req.body;
    const userId = req.user.userId;

    if (!sessionId || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'sessionId and recipients array required' });
    }

    // Validate each recipient has name + email
    for (const r of recipients) {
      if (!r.name || !r.email) {
        return res.status(400).json({ error: 'Each recipient must have name and email fields' });
      }
    }

    // Verify session ownership
    const sessionResult = await pool.query(
      'SELECT session_id, title FROM sessions WHERE session_id = $1 AND user_id = $2',
      [sessionId, userId]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const session = sessionResult.rows[0];

    // Fetch summary and all tasks
    const [summaryResult, tasksResult] = await Promise.all([
      pool.query('SELECT * FROM meeting_summaries WHERE session_id = $1', [sessionId]),
      pool.query('SELECT * FROM tasks WHERE session_id = $1 ORDER BY priority DESC', [sessionId]),
    ]);

    const summary  = summaryResult.rows[0] || null;
    const allTasks = tasksResult.rows || [];

    // Extract next_meeting if stored in summary
    const nextMeeting = summary?.next_meeting || null;

    const results = await sendPersonalizedEmails({
      sessionId,
      sessionTitle: session.title,
      recipients,
      summary,
      allTasks,
      nextMeeting,
    });

    return res.json({
      success: true,
      sent: results.successful.length,
      failed: results.failed.length,
      successful: results.successful,
      failed: results.failed,
    });
  } catch (err) {
    console.error('[Email Route] Personalized send failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
