import React, { useState, useEffect } from 'react';
import client from '../api/client';

const AVATAR_COLORS = [
  ['#FF69B4', '#C71585'], ['#00BFFF', '#0047AB'], ['#FFD700', '#FF8C00'],
  ['#7CFC00', '#228B22'], ['#FF6347', '#B22222'], ['#DA70D6', '#8B008B'],
  ['#40E0D0', '#008080'], ['#FFA500', '#8B4513'],
];

const getColor = (name) => AVATAR_COLORS[(name?.charCodeAt(0) || 0) % AVATAR_COLORS.length];

const EmailDistribution = ({ sessionId, session, summary, tasks, transactions, onClose }) => {
  const [mode, setMode]           = useState('personalized');
  const [assigneeRows, setAssigneeRows] = useState([]);  // from actual task assignees
  const [extraRows, setExtraRows] = useState([]);        // participants with no tasks
  const [broadcastEmails, setBroadcastEmails] = useState('');
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState(null);

  useEffect(() => {
    // ── Build assignee rows from ACTUAL task assignees ─────────────
    // This is the source of truth — not session.participants
    const taskAssignees = {};
    (tasks || []).forEach(t => {
      const key = (t.assignee || 'Unassigned').trim();
      if (!taskAssignees[key]) taskAssignees[key] = [];
      taskAssignees[key].push(t);
    });

    const rows = Object.entries(taskAssignees).map(([name, taskList]) => ({
      name,
      email: '',
      tasks: taskList,
      taskCount: taskList.length,
    }));

    setAssigneeRows(rows);

    // ── Also show session participants who have no tasks (0 tasks) ─
    const sessionNames = Array.isArray(session?.participants) ? session.participants : [];
    const assigneeNames = new Set(rows.map(r => r.name.toLowerCase()));
    const extras = sessionNames
      .filter(n => !assigneeNames.has(n.toLowerCase()))
      .map(name => ({ name, email: '', tasks: [], taskCount: 0 }));
    setExtraRows(extras);
  }, [tasks, session]);

  const updateAssigneeEmail = (idx, email) =>
    setAssigneeRows(prev => prev.map((r, i) => i === idx ? { ...r, email } : r));

  const updateExtraEmail = (idx, email) =>
    setExtraRows(prev => prev.map((r, i) => i === idx ? { ...r, email } : r));

  // ── Personalized send ───────────────────────────────────────────
  const handlePersonalizedSend = async () => {
    setError(null);
    const allRows = [...assigneeRows, ...extraRows];
    const filled  = allRows.filter(r => r.email.trim());

    if (filled.length === 0) {
      setError('Enter at least one email address.'); return;
    }
    const invalid = filled.find(r => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim()));
    if (invalid) {
      setError(`Invalid email for ${invalid.name}: "${invalid.email}"`); return;
    }

    setLoading(true);
    try {
      const res = await client.post('/email/send-personalized', {
        sessionId,
        recipients: filled.map(r => ({ name: r.name, email: r.email.trim() })),
      });
      setResult({ mode: 'personalized', ...res.data });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setLoading(false); }
  };

  // ── Broadcast send ──────────────────────────────────────────────
  const handleBroadcastSend = async () => {
    setError(null);
    const list = broadcastEmails
      .split('\n').map(r => r.trim()).filter(Boolean)
      .map(r => { const m = r.match(/(.+?)\s*<(.+?)>/); return m ? { name: m[1].trim(), email: m[2].trim() } : { name: r, email: r }; });

    if (list.length === 0) { setError('Enter at least one email.'); return; }
    setLoading(true);
    try {
      const res = await client.post('/email/send', { sessionId, recipients: list });
      setResult({ mode: 'broadcast', successful: res.data.successful || [], failed: res.data.failed || [] });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setLoading(false); }
  };

  // ── Success screen ──────────────────────────────────────────────
  if (result) {
    const sentCount = result.sent ?? result.successful?.length ?? 0;
    return (
      <div className="email-distribution">
        <div className="modal-header">
          <h2>📧 Emails Sent</h2>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="email-result">
          <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>✅</div>
          <h3 style={{ textAlign: 'center', margin: '0 0 20px' }}>
            {sentCount} email{sentCount !== 1 ? 's' : ''} sent!
          </h3>
          {result.successful?.length > 0 && (
            <div className="result-section">
              <h4>✓ Delivered:</h4>
              <ul>
                {result.successful.map((r, i) => (
                  <li key={i}>
                    {typeof r === 'string'
                      ? r
                      : <><strong>{r.name}</strong> — {r.email}{r.taskCount !== undefined ? ` (${r.taskCount} task${r.taskCount !== 1 ? 's' : ''})` : ''}</>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.failed?.length > 0 && (
            <div className="result-section failed">
              <h4>✗ Failed:</h4>
              <ul>
                {result.failed.map((r, i) => (
                  <li key={i}>
                    <span className="email-failed">{r.name || r.email || r}</span>
                    {r.error && <span className="error-reason"> — {r.error}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="action-buttons" style={{ marginTop: 20 }}>
            <button className="btn-secondary" onClick={() => setResult(null)}>Send more</button>
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Row renderer ────────────────────────────────────────────────
  const renderRow = (r, idx, onUpdate) => {
    const [fg, border] = getColor(r.name);
    const bg = fg + '22';
    const taskDescriptions = r.tasks.slice(0, 3).map(t => t.description || 'Task');
    return (
      <div key={idx} style={{
        background: '#0f0f1a', borderRadius: 10, padding: '14px 14px 10px',
        border: `1px solid ${r.taskCount > 0 ? border + '44' : '#1e1e2e'}`,
        marginBottom: 10,
      }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
            background: bg, border: `2px solid ${border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 14, color: fg,
          }}>
            {r.name.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 14 }}>{r.name}</span>
              <span style={{
                fontSize: 11, padding: '2px 9px', borderRadius: 10, fontWeight: 700,
                background: r.taskCount > 0 ? bg : '#1a1a2e',
                color: r.taskCount > 0 ? fg : '#4b5563',
                border: `1px solid ${r.taskCount > 0 ? border + '55' : '#2a2a3e'}`,
              }}>
                {r.taskCount} task{r.taskCount !== 1 ? 's' : ''}
              </span>
            </div>
            {/* Task preview */}
            {taskDescriptions.length > 0 && (
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3, lineHeight: 1.4 }}>
                {taskDescriptions.map((d, i) => (
                  <span key={i}>
                    <span style={{ color: fg, marginRight: 4 }}>•</span>
                    {d.length > 45 ? d.slice(0, 45) + '…' : d}
                    {i < taskDescriptions.length - 1 && <br />}
                  </span>
                ))}
                {r.tasks.length > 3 && (
                  <span style={{ color: '#4b5563' }}> +{r.tasks.length - 3} more</span>
                )}
              </div>
            )}
          </div>
        </div>
        {/* Email input */}
        <input
          type="email"
          placeholder={`${r.name.toLowerCase().replace(/\s+/g, '.')}@company.com`}
          value={r.email}
          onChange={e => onUpdate(idx, e.target.value)}
          disabled={loading}
          style={{
            width: '100%', background: '#1a1a2e', border: '1px solid #2a2a3e',
            borderRadius: 6, color: '#e2e8f0', padding: '7px 10px', fontSize: 13,
            outline: 'none', boxSizing: 'border-box',
            transition: 'border-color 0.2s',
          }}
          onFocus={e => e.target.style.borderColor = border}
          onBlur={e => e.target.style.borderColor = '#2a2a3e'}
        />
      </div>
    );
  };

  const filledCount = [...assigneeRows, ...extraRows].filter(r => r.email.trim()).length;

  return (
    <div className="email-distribution">
      <div className="modal-header">
        <h2>📧 Share Meeting Summary</h2>
        <button className="btn-ghost" onClick={onClose}>✕</button>
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, borderBottom: '1px solid #1e1e1e', paddingBottom: 12 }}>
        {[
          { id: 'personalized', label: '🎯 Personalized' },
          { id: 'broadcast',    label: '📢 Broadcast' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setMode(tab.id)} style={{
            padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontWeight: 600, fontSize: 13,
            background: mode === tab.id ? '#6366f1' : '#1a1a2e',
            color: mode === tab.id ? '#fff' : '#9ca3af',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── PERSONALIZED ── */}
      {mode === 'personalized' && (
        <>
          <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 14 }}>
            Each person receives <strong style={{ color: '#e2e8f0' }}>only their own tasks</strong> + shared summary and decisions.
            Enter their email to include them.
          </p>

          {/* Task assignees (have tasks) */}
          {assigneeRows.length > 0 && (
            <>
              {assigneeRows.some(r => r.name !== 'Unassigned') && (
                <div style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  👤 Task Owners
                </div>
              )}
              {assigneeRows.map((r, i) => renderRow(r, i, updateAssigneeEmail))}
            </>
          )}

          {/* Participants with no tasks */}
          {extraRows.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 1, margin: '14px 0 8px' }}>
                👥 Other Participants (no tasks)
              </div>
              {extraRows.map((r, i) => renderRow(r, i, updateExtraEmail))}
            </>
          )}

          {assigneeRows.length === 0 && extraRows.length === 0 && (
            <p style={{ color: '#6b7280', fontSize: 13, fontStyle: 'italic' }}>No participants or tasks found for this session.</p>
          )}

          {error && <p style={{ color: '#f87171', fontSize: 13, margin: '10px 0' }}>{error}</p>}

          <div className="action-buttons" style={{ marginTop: 16 }}>
            <button className="btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
            <button
              className="btn-primary"
              onClick={handlePersonalizedSend}
              disabled={loading || filledCount === 0}
            >
              {loading ? 'Sending…' : `Send ${filledCount > 0 ? filledCount : ''} Personalized Email${filledCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}

      {/* ── BROADCAST ── */}
      {mode === 'broadcast' && (
        <>
          <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 14 }}>
            Send the same full summary to all recipients.
          </p>
          <div className="email-input-section">
            <label>Recipients (one per line)</label>
            <textarea
              value={broadcastEmails}
              onChange={e => setBroadcastEmails(e.target.value)}
              placeholder={`john@example.com\nJane Smith <jane@example.com>\nteam@company.com`}
              rows={5}
              disabled={loading}
            />
            <small>You can also use "Name &lt;email&gt;" format.</small>
          </div>
          {error && <p style={{ color: '#f87171', fontSize: 13, margin: '8px 0' }}>{error}</p>}
          <div className="action-buttons" style={{ marginTop: 12 }}>
            <button className="btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
            <button className="btn-primary" onClick={handleBroadcastSend} disabled={loading || !broadcastEmails.trim()}>
              {loading ? 'Sending…' : 'Send Broadcast'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default EmailDistribution;
