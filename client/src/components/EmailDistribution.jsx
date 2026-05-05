import React, { useState } from 'react';
import client from '../api/client';

const EmailDistribution = ({ sessionId, summary, tasks, transactions, onClose }) => {
  const [recipients, setRecipients] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSendEmails = async () => {
    try {
      setLoading(true);
      setError(null);
      setResult(null);

      // Parse recipients: split by comma and handle both emails and "Name <email>"
      const recipientList = recipients
        .split('\n')
        .map((r) => r.trim())
        .filter((r) => r.length > 0)
        .map((r) => {
          // Handle "Name <email@example.com>" format
          const match = r.match(/(.+?)\s*<(.+?)>/);
          if (match) {
            return { name: match[1].trim(), email: match[2].trim() };
          }
          // Handle plain email
          return r;
        });

      if (recipientList.length === 0) {
        setError('Please enter at least one recipient email');
        return;
      }

      const response = await client.post('/email/send', {
        sessionId,
        recipients: recipientList,
      });

      setResult(response.data);
      setRecipients(''); // Clear input on success
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="email-distribution">
      <div className="modal-header">
        <h2>📧 Share Meeting Summary</h2>
        <button className="close-btn" onClick={onClose}>
          ✕
        </button>
      </div>

      {result ? (
        // Success state
        <div className="email-result">
          <div className="success-icon">✅</div>
          <h3>Emails sent successfully!</h3>

          {result.successful.length > 0 && (
            <div className="result-section">
              <h4>✓ Sent to {result.successful.length} recipient(s):</h4>
              <ul>
                {result.successful.map((email) => (
                  <li key={email}>{email}</li>
                ))}
              </ul>
            </div>
          )}

          {result.failed.length > 0 && (
            <div className="result-section failed">
              <h4>✗ Failed to send to {result.failed.length} recipient(s):</h4>
              <ul>
                {result.failed.map((failure) => (
                  <li key={failure.email}>
                    <span className="email-failed">{failure.email}</span>
                    <span className="error-reason">{failure.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="action-buttons">
            <button className="btn-secondary" onClick={() => setResult(null)}>
              Send to more recipients
            </button>
            <button className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        // Input state
        <>
          <div className="email-preview">
            <div className="preview-section">
              <h3>📋 Summary</h3>
              <p>{summary?.executive_summary ? summary.executive_summary.substring(0, 200) + '...' : 'No summary yet...'}</p>
            </div>

            {tasks?.length > 0 && (
              <div className="preview-section">
                <h3>✔️ {tasks.length} Action Items</h3>
                <ul>
                  {tasks.slice(0, 3).map((task, i) => (
                    <li key={i}>{task.assignee ? `[${task.assignee}] ` : ''}{task.description || 'Task'}</li>
                  ))}
                  {tasks.length > 3 && <li>...and {tasks.length - 3} more</li>}
                </ul>
              </div>
            )}

            {transactions?.length > 0 && (
              <div className="preview-section">
                <h3>💰 {transactions.length} Expenses/Income</h3>
                <p>Total expenses will be included in email</p>
              </div>
            )}
          </div>

          <div className="email-input-section">
            <label>Recipients (one per line)</label>
            <textarea
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder={`john@example.com
Jane Smith <jane@example.com>
team@company.com`}
              rows={5}
              disabled={loading}
            />
            <small>Enter email addresses, one per line. You can also use "Name &lt;email&gt;" format.</small>

            {error && <div className="error-message">{error}</div>}

            <div className="action-buttons">
              <button className="btn-secondary" onClick={onClose} disabled={loading}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleSendEmails}
                disabled={loading || recipients.trim().length === 0}
              >
                {loading ? 'Sending...' : 'Send Summary Email'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default EmailDistribution;
