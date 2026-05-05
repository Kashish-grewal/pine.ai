const { Resend } = require('resend');
const { pool } = require('../db/db');

const resend = new Resend(process.env.RESEND_API_KEY);

// ================================================================
// EMAIL SERVICE — Send meeting summaries with calendar invites
// ================================================================
// Features:
//   - Send summary + key decisions to participants
//   - Generate iCal calendar files for tasks with deadlines
//   - Track email delivery status
// ================================================================

/**
 * Generate iCal format calendar event
 * @param {Object} task - Task object with id, title, description, deadline_date, assignee
 * @param {string} organizerEmail - Email of the person sending the invite
 * @returns {string} iCal formatted string
 */
const generateICalEvent = (task, organizerEmail) => {
  if (!task.deadline_date && !task.deadline) {
    return null; // No deadline, can't generate calendar event
  }

  const taskId = task.task_id || task.id || 'task-' + Date.now();
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const deadline = new Date(task.deadline || task.deadline_date).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const ical = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Pine.AI//Meeting Tasks//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:${taskId}@pine.ai
DTSTAMP:${now}
DTSTART:${deadline}
SUMMARY:${escapeICalString(task.description || task.title || 'Task')}
DESCRIPTION:${escapeICalString(task.description || '')}
PRIORITY:${task.priority === 'high' ? '1' : task.priority === 'medium' ? '5' : '9'}
STATUS:NEEDS-ACTION
ORGANIZER;CN="Pine.AI":mailto:${organizerEmail}
END:VEVENT
END:VCALENDAR`;

  return ical;
};

/**
 * Escape special characters in iCal strings
 */
const escapeICalString = (str) => {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n')
    .substring(0, 100); // Limit length for iCal compatibility
};

/**
 * Format summary data into a professional HTML email
 */
const formatSummaryEmail = (summary, tasks, transactions, sessionData) => {
  const summaryData = summary || {};
  const taskList = tasks || [];
  const transactionList = transactions || [];

  const sentimentColor = {
    positive: '#10b981',
    neutral: '#6b7280',
    negative: '#ef4444',
  };

  const sentimentBg = sentimentColor[summaryData.sentiment] || '#6b7280';

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1f2937; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${sentimentBg}; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .header h1 { margin: 0; font-size: 24px; }
    .header p { margin: 10px 0 0 0; opacity: 0.9; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #111827; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
    .summary-text { color: #4b5563; line-height: 1.6; margin-bottom: 12px; }
    .decision { background: #f3f4f6; padding: 12px; border-left: 4px solid #3b82f6; margin-bottom: 8px; border-radius: 4px; }
    .decision-title { font-weight: 600; color: #1f2937; }
    .decision-detail { color: #6b7280; font-size: 14px; margin-top: 4px; }
    .task-item { background: #f9fafb; padding: 12px; border-radius: 6px; margin-bottom: 8px; border-left: 4px solid #8b5cf6; }
    .task-title { font-weight: 600; color: #1f2937; }
    .task-meta { font-size: 12px; color: #6b7280; margin-top: 6px; }
    .task-meta span { margin-right: 16px; }
    .transaction-item { background: #f9fafb; padding: 12px; border-radius: 6px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
    .transaction-left { flex: 1; }
    .transaction-label { font-weight: 600; color: #1f2937; }
    .transaction-category { font-size: 12px; color: #6b7280; margin-top: 4px; }
    .transaction-amount { font-weight: 600; font-size: 16px; color: #059669; }
    .transaction-amount.expense { color: #dc2626; }
    .button-group { margin-top: 12px; }
    .calendar-button { background: #3b82f6; color: white; padding: 8px 12px; border-radius: 4px; text-decoration: none; font-size: 12px; display: inline-block; margin-right: 8px; }
    .footer { background: #f3f4f6; padding: 16px; border-radius: 6px; font-size: 12px; color: #6b7280; text-align: center; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📋 Meeting Summary</h1>
      <p>Sentiment: <strong>${(summaryData.sentiment || 'neutral').toUpperCase()}</strong></p>
    </div>

    ${summaryData.executive_summary ? `
      <div class="section">
        <div class="section-title">📝 Overview</div>
        <div class="summary-text">${summaryData.executive_summary}</div>
      </div>
    ` : ''}

    ${summaryData.key_decisions && summaryData.key_decisions.length > 0 ? `
      <div class="section">
        <div class="section-title">✅ Key Decisions</div>
        ${summaryData.key_decisions.map(decision => `
          <div class="decision">
            <div class="decision-title">${decision}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${taskList.length > 0 ? `
      <div class="section">
        <div class="section-title">✔️ Action Items (${taskList.length})</div>
        ${taskList.map(task => `
          <div class="task-item">
            <div class="task-title">${task.description || 'Untitled Task'}</div>
            <div class="task-meta">
              ${task.assignee ? `<span>👤 ${task.assignee}</span>` : ''}
              ${task.deadline ? `<span>📅 ${new Date(task.deadline).toLocaleDateString()}</span>` : ''}
              ${task.priority ? `<span>🎯 ${task.priority.toUpperCase()}</span>` : ''}
            </div>
            ${task.deadline ? `
              <div class="button-group">
                ${(() => { const ical = generateICalEvent(task, 'meetings@pine.ai'); return ical ? `<a href="data:text/calendar;base64,${Buffer.from(ical).toString('base64')}" download="${task.task_id || 'task'}.ics" class="calendar-button">📅 Add to Calendar</a>` : ''; })()}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${transactionList.length > 0 ? `
      <div class="section">
        <div class="section-title">💰 Expenses & Income</div>
        ${transactionList.map(txn => `
          <div class="transaction-item">
            <div class="transaction-left">
              <div class="transaction-label">${txn.description || txn.text_segment || 'Transaction'}</div>
              ${txn.category ? `<div class="transaction-category">${txn.category}</div>` : ''}
            </div>
            <div class="transaction-amount ${txn.type === 'expense' ? 'expense' : ''}">
              ${txn.type === 'expense' ? '-' : '+'}$${(txn.amount || 0).toFixed(2)}
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="footer">
      <p>This summary was automatically generated by Pine.AI from your meeting recording.</p>
      <p>📧 Reply to this email or visit Pine.AI to manage your tasks and expenses.</p>
    </div>
  </div>
</body>
</html>
  `;
};

/**
 * Send meeting summary email to participants
 * @param {Object} options - Email options
 * @param {number} options.sessionId - Session ID (for database tracking)
 * @param {string} options.toEmail - Recipient email address
 * @param {string} options.userName - Name of the person who recorded the meeting
 * @param {Object} options.summary - Summary object from database
 * @param {Array} options.tasks - Array of task objects
 * @param {Array} options.transactions - Array of transaction objects
 * @param {Object} options.sessionData - Original session metadata
 * @returns {Promise<Object>} Resend response
 */
const sendSummaryEmail = async (options) => {
  const {
    sessionId,
    toEmail,
    userName = 'Pine.AI User',
    summary,
    tasks = [],
    transactions = [],
    sessionData = {},
  } = options;

  if (!toEmail) {
    throw new Error('toEmail is required');
  }

  const htmlContent = formatSummaryEmail(summary, tasks, transactions, sessionData);
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@pine.ai';

  try {
    const response = await resend.emails.send({
      from: `Pine.AI <${fromEmail}>`,
      to: toEmail,
      subject: `📋 Meeting Summary from ${userName}`,
      html: htmlContent,
      replyTo: process.env.RESEND_REPLY_TO || 'support@pine.ai',
    });

    // Log email in database for tracking
    if (sessionId) {
      try {
        await pool.query(
          `INSERT INTO email_logs (session_id, recipient_email, status, sent_at)
           VALUES ($1, $2, $3, NOW())`,
          [sessionId, toEmail, 'sent']
        );
      } catch (dbErr) {
        console.warn(`[Email] Failed to log email in database: ${dbErr.message}`);
      }
    }

    console.log(`[Email] Sent summary to ${toEmail} (Resend ID: ${response.id})`);
    return response;
  } catch (err) {
    console.error(`[Email] Failed to send to ${toEmail}: ${err.message}`);

    // Log failure in database
    if (sessionId) {
      try {
        await pool.query(
          `INSERT INTO email_logs (session_id, recipient_email, status, error_detail, sent_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [sessionId, toEmail, 'failed', err.message]
        );
      } catch (dbErr) {
        console.warn(`[Email] Failed to log error in database: ${dbErr.message}`);
      }
    }

    throw err;
  }
};

/**
 * Send summary to multiple participants
 * @param {Object} options
 * @param {number} options.sessionId
 * @param {Array} options.recipients - Array of email addresses or { email, name } objects
 * @param {string} options.userName
 * @param {Object} options.summary
 * @param {Array} options.tasks
 * @param {Array} options.transactions
 * @param {Object} options.sessionData
 * @returns {Promise<Object>} { successful: [], failed: [] }
 */
const sendSummaryToMultiple = async (options) => {
  const { recipients = [], ...rest } = options;

  const results = { successful: [], failed: [] };

  for (const recipient of recipients) {
    const toEmail = typeof recipient === 'string' ? recipient : recipient.email;
    const recipientName = typeof recipient === 'string' ? 'Participant' : recipient.name || 'Participant';

    try {
      await sendSummaryEmail({
        ...rest,
        toEmail,
      });
      results.successful.push(toEmail);
    } catch (err) {
      results.failed.push({ email: toEmail, error: err.message });
    }
  }

  console.log(
    `[Email] Batch send complete: ${results.successful.length} successful, ${results.failed.length} failed`
  );

  return results;
};

/**
 * Get email delivery status from Resend
 * @param {string} resendId - Email ID from Resend
 * @returns {Promise<string>} Status: 'sent', 'delivered', 'bounced', 'complained'
 */
const getEmailStatus = async (resendId) => {
  try {
    const response = await resend.emails.get(resendId);
    return response.status;
  } catch (err) {
    console.error(`[Email] Failed to get status for ${resendId}: ${err.message}`);
    return null;
  }
};

/**
 * Initialize email table — no-op, table is created via schema.sql.
 * Kept for backward compatibility with routes/email.js import.
 */
const initializeEmailTable = async () => {
  console.log('[Email] Email logs table managed by schema.sql');
};

module.exports = {
  sendSummaryEmail,
  sendSummaryToMultiple,
  getEmailStatus,
  generateICalEvent,
  formatSummaryEmail,
  initializeEmailTable,
};
