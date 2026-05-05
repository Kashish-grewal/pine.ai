const { Resend } = require('resend');
const { pool } = require('../db/db');

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

if (!resend) console.warn('[Email] RESEND_API_KEY not set — email sending disabled');

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
 * Format a PERSONALIZED email for a specific participant.
 * They see: their own tasks + shared summary + shared decisions.
 */
const formatPersonalizedEmail = ({
  recipientName,
  myTasks,
  allTasks,
  summary,
  sessionTitle,
  nextMeeting,
}) => {
  const s = summary || {};
  const sentimentColor = { positive: '#10b981', neutral: '#6366f1', negative: '#ef4444', urgent: '#f59e0b' };
  const headerColor = sentimentColor[s.sentiment] || '#6366f1';

  const taskRows = (myTasks || []).map((t, i) => {
    const ical = t.deadline ? generateICalEvent(t, 'meetings@pine.ai') : null;
    const calBtn = ical
      ? `<a href="data:text/calendar;base64,${Buffer.from(ical).toString('base64')}" download="task-${i}.ics" style="background:#3b82f6;color:#fff;padding:4px 10px;border-radius:4px;text-decoration:none;font-size:11px;display:inline-block;margin-top:8px;">📅 Add to Calendar</a>`
      : '';
    const priorityColor = { urgent: '#ef4444', high: '#f59e0b', normal: '#6366f1', low: '#9ca3af' }[t.priority] || '#6366f1';
    return `
      <div style="background:#f9fafb;border-left:4px solid ${priorityColor};border-radius:6px;padding:12px;margin-bottom:10px;">
        <div style="font-weight:600;color:#111827;">${t.description || 'Task'}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;">
          ${t.deadline ? `📅 Due: <strong>${new Date(t.deadline).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}</strong> &nbsp;` : ''}
          <span style="background:${priorityColor}22;color:${priorityColor};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">${(t.priority || 'normal').toUpperCase()}</span>
        </div>
        ${calBtn}
      </div>`;
  }).join('');

  const decisionRows = (s.key_decisions || []).map(d =>
    `<li style="margin-bottom:6px;color:#374151;">${d}</li>`
  ).join('');

  const otherPeople = (allTasks || [])
    .filter(t => t.assignee && t.assignee.toLowerCase() !== (recipientName || '').toLowerCase())
    .reduce((acc, t) => {
      if (!acc[t.assignee]) acc[t.assignee] = [];
      acc[t.assignee].push(t.description || 'Task');
      return acc;
    }, {});

  const teamRows = Object.entries(otherPeople).map(([name, taskDescs]) =>
    `<li style="margin-bottom:6px;"><strong>${name}</strong>: ${taskDescs.join(', ')}</li>`
  ).join('');

  const nextMeetingSection = nextMeeting ? `
    <div style="margin-bottom:24px;">
      <div style="font-size:16px;font-weight:600;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-bottom:12px;">🗓 Next Meeting</div>
      <div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:6px;padding:12px;">
        <div style="font-weight:600;color:#1d4ed8;">${nextMeeting.date || ''} ${nextMeeting.time || ''}</div>
        ${nextMeeting.agenda ? `<div style="color:#374151;font-size:13px;margin-top:4px;">Agenda: ${nextMeeting.agenda}</div>` : ''}
      </div>
    </div>` : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Your Meeting Summary — Pine.AI</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;margin:0;padding:20px;">
  <div style="max-width:600px;margin:0 auto;">

    <!-- Header -->
    <div style="background:${headerColor};border-radius:12px 12px 0 0;padding:24px 28px;">
      <div style="font-size:13px;color:rgba(255,255,255,0.8);margin-bottom:4px;">pine.ai · Meeting Summary</div>
      <h1 style="margin:0;color:#fff;font-size:22px;">${sessionTitle || 'Meeting Summary'}</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">Hi ${recipientName || 'there'} 👋 — here's your personal action plan.</p>
    </div>

    <!-- Body -->
    <div style="background:#fff;border-radius:0 0 12px 12px;padding:28px;">

      <!-- Overview -->
      ${s.executive_summary ? `
      <div style="margin-bottom:24px;">
        <div style="font-size:16px;font-weight:600;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-bottom:12px;">📝 Meeting Overview</div>
        <p style="color:#4b5563;line-height:1.7;margin:0;">${s.executive_summary}</p>
      </div>` : ''}

      <!-- Your Tasks -->
      <div style="margin-bottom:24px;">
        <div style="font-size:16px;font-weight:600;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-bottom:12px;">✅ Your Action Items (${(myTasks || []).length})</div>
        ${myTasks && myTasks.length > 0 ? taskRows : '<p style="color:#9ca3af;font-style:italic;">No tasks assigned to you in this meeting.</p>'}
      </div>

      <!-- Next meeting -->
      ${nextMeetingSection}

      <!-- Key Decisions -->
      ${decisionRows ? `
      <div style="margin-bottom:24px;">
        <div style="font-size:16px;font-weight:600;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-bottom:12px;">🎯 Key Decisions (Team)</div>
        <ul style="margin:0;padding-left:20px;">${decisionRows}</ul>
      </div>` : ''}

      <!-- Team tasks overview -->
      ${teamRows ? `
      <div style="margin-bottom:24px;">
        <div style="font-size:16px;font-weight:600;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-bottom:12px;">👥 Team Tasks Overview</div>
        <ul style="margin:0;padding-left:20px;">${teamRows}</ul>
      </div>` : ''}

      <!-- Footer -->
      <div style="background:#f9fafb;border-radius:8px;padding:16px;font-size:12px;color:#9ca3af;text-align:center;">
        Generated by <strong>Pine.AI</strong> · Reply to this email with any questions.
      </div>
    </div>
  </div>
</body>
</html>`;
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

  if (!resend) {
    throw new Error('Email sending is disabled — RESEND_API_KEY not configured');
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
 * Send PERSONALIZED emails to each participant.
 * Each person gets only their own tasks + shared summary + decisions.
 *
 * @param {Object} opts
 * @param {string} opts.sessionId
 * @param {string} opts.sessionTitle
 * @param {Array}  opts.recipients  - [{ name: "Alice", email: "alice@co.com" }]
 * @param {Object} opts.summary
 * @param {Array}  opts.allTasks    - full task list (we filter per person)
 * @param {Object} opts.nextMeeting - optional { date, time, agenda }
 * @returns {Promise<{ successful: [], failed: [] }>}
 */
const sendPersonalizedEmails = async (opts) => {
  const { sessionId, sessionTitle, recipients = [], summary, allTasks = [], nextMeeting } = opts;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@pine.ai';
  const results = { successful: [], failed: [] };

  for (const recipient of recipients) {
    const { name, email } = recipient;
    if (!email) continue;

    // Filter tasks where assignee matches this participant's name (case-insensitive)
    const myTasks = allTasks.filter(
      (t) => t.assignee && t.assignee.toLowerCase() === name.toLowerCase()
    );

    const html = formatPersonalizedEmail({
      recipientName: name,
      myTasks,
      allTasks,
      summary,
      sessionTitle,
      nextMeeting,
    });

    try {
      const response = await resend.emails.send({
        from: `Pine.AI <${fromEmail}>`,
        to: email,
        subject: `📋 Your action items from "${sessionTitle || 'the meeting'}"`,
        html,
      });

      if (sessionId) {
        await pool.query(
          `INSERT INTO email_logs (session_id, recipient_email, status, sent_at) VALUES ($1, $2, $3, NOW())`,
          [sessionId, email, 'sent']
        ).catch(() => {});
      }

      console.log(`[Email] Personalized email sent to ${name} <${email}>`);
      results.successful.push({ name, email, taskCount: myTasks.length });
    } catch (err) {
      console.error(`[Email] Failed to send to ${name} <${email}>: ${err.message}`);
      if (sessionId) {
        await pool.query(
          `INSERT INTO email_logs (session_id, recipient_email, status, error_detail, sent_at) VALUES ($1, $2, $3, $4, NOW())`,
          [sessionId, email, 'failed', err.message]
        ).catch(() => {});
      }
      results.failed.push({ name, email, error: err.message });
    }
  }

  console.log(`[Email] Personalized batch: ${results.successful.length} sent, ${results.failed.length} failed`);
  return results;
};

/**
 * Send summary to multiple participants (legacy — same email to all)
 */
const sendSummaryToMultiple = async (options) => {
  const { recipients = [], ...rest } = options;
  const results = { successful: [], failed: [] };

  for (const recipient of recipients) {
    const toEmail = typeof recipient === 'string' ? recipient : recipient.email;
    try {
      await sendSummaryEmail({ ...rest, toEmail });
      results.successful.push(toEmail);
    } catch (err) {
      results.failed.push({ email: toEmail, error: err.message });
    }
  }

  console.log(`[Email] Batch send: ${results.successful.length} ok, ${results.failed.length} failed`);
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
  sendPersonalizedEmails,
  getEmailStatus,
  generateICalEvent,
  formatSummaryEmail,
  formatPersonalizedEmail,
  initializeEmailTable,
};
