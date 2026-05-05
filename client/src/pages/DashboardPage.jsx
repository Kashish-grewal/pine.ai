import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { authStore } from '../store/authStore';
import EmailDistribution from '../components/EmailDistribution';
import mermaid from 'mermaid';

// ── Calendar URL builder (client-side) ──────────────────────────
const buildCalendarUrl = (task, meetingTitle = '') => {
  if (!task.deadline) return null;
  const title = encodeURIComponent((task.description || 'Task').substring(0, 120));
  const details = encodeURIComponent(
    [task.assignee ? `Assigned to: ${task.assignee}` : '', task.priority ? `Priority: ${task.priority}` : '', meetingTitle ? `From meeting: ${meetingTitle}` : '', '\nCreated by Pine.AI'].filter(Boolean).join('\n')
  );
  const d = new Date(task.deadline);
  const fmt = (dt) => dt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const start = fmt(d);
  const end = fmt(new Date(d.getTime() + 3600000));
  return `https://calendar.google.com/calendar/event?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}`;
};

const LANGUAGE_LOCALE_OPTIONS = [
  { value: 'en-IN', label: 'English (India) — en-IN' },
  { value: 'en-US', label: 'English (US) — en-US' },
  { value: 'en-GB', label: 'English (UK) — en-GB' },
  { value: 'hi-IN', label: 'Hindi (India) — hi-IN' },
  { value: 'es-ES', label: 'Spanish (Spain) — es-ES' },
  { value: 'fr-FR', label: 'French (France) — fr-FR' },
  { value: 'de-DE', label: 'German (Germany) — de-DE' },
  { value: 'pt-BR', label: 'Portuguese (Brazil) — pt-BR' },
];

export default function DashboardPage() {
  const [sessions, setSessions]         = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [sessionDetail, setSessionDetail]     = useState(null); // { session, transcript, summary, tasks, transactions }
  const [loadingDetail, setLoadingDetail]     = useState(false);
  const [showUpload, setShowUpload]     = useState(false);

  // Upload form state
  const [dragOver, setDragOver]         = useState(false);
  const [uploading, setUploading]       = useState(false);
  const [uploadError, setUploadError]   = useState('');
  const [titleInput, setTitleInput]     = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [participantNamesInput, setParticipantNamesInput] = useState('');
  const [expectedSpeakerCount, setExpectedSpeakerCount]   = useState('2');
  const [languageLocale, setLanguageLocale] = useState('en-IN');
  const [userKeywordsInput, setUserKeywordsInput] = useState('');
  const [activeTab, setActiveTab]       = useState('transcript');
  const [workflowData, setWorkflowData] = useState(null);
  const [loadingWorkflow, setLoadingWorkflow] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const mermaidRef = useRef(null);

  const pollRef      = useRef(null);
  const fileInputRef = useRef(null);
  const navigate     = useNavigate();
  const user         = authStore.getUser();

  useEffect(() => { if (!authStore.isLoggedIn()) navigate('/'); }, [navigate]);
  useEffect(() => { fetchSessions(); }, []);
  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  // ── Fetch all sessions for sidebar ───────────────────────────────
  const fetchSessions = async () => {
    try {
      const res = await api.get('/sessions');
      const list = res.data.data.sessions || [];
      setSessions(list);
      // Auto-select most recent session
      if (list.length > 0 && !activeSessionId) {
        selectSession(list[0].session_id);
      }
    } catch { /* ignore */ }
  };

  // ── Load full session detail ──────────────────────────────────────
  const selectSession = async (id) => {
    if (activeSessionId === id) return;
    setActiveSessionId(id);
    setLoadingDetail(true);
    setSessionDetail(null);
    setWorkflowData(null);      // clear stale workflow from previous session
    setActiveTab('transcript');
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      const res = await api.get(`/sessions/${id}`);
      const d   = res.data.data;
      setSessionDetail(d);
      // If still processing, start polling
      if (d.session.status === 'pending' || d.session.status === 'processing') {
        startPolling(id);
      }
    } catch { /* ignore */ }
    finally { setLoadingDetail(false); }
  };

  const pollCountRef = useRef(0);

  const startPolling = (sessionId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollCountRef.current = 0;

    const poll = async () => {
      try {
        const res = await api.get(`/sessions/${sessionId}`);
        const d   = res.data.data;
        setSessionDetail(d);
        // Update status in sidebar list
        setSessions(prev => prev.map(s =>
          s.session_id === sessionId ? { ...s, status: d.session.status, duration_secs: d.session.duration_secs } : s
        ));
        if (d.session.status === 'completed' || d.session.status === 'failed') {
          clearTimeout(pollRef.current);
          pollRef.current = null;
          return;
        }
      } catch {
        clearTimeout(pollRef.current);
        pollRef.current = null;
        return;
      }
      // Exponential backoff: 3s → 5s → 8s → 12s → 15s (cap)
      pollCountRef.current++;
      const delay = Math.min(3000 * Math.pow(1.3, pollCountRef.current), 15000);
      pollRef.current = setTimeout(poll, delay);
    };

    pollRef.current = setTimeout(poll, 3000);
  };

  const handleLogout = () => { authStore.clear(); navigate('/'); };

  const parseList = (value) => {
    const seen = new Set();
    return value.split(',').map(s => s.trim()).filter(s => {
      if (!s || seen.has(s.toLowerCase())) return false;
      seen.add(s.toLowerCase()); return true;
    });
  };

  const handleFile = async (file) => {
    if (!file) return;
    const participantNames = parseList(participantNamesInput);
    const speakerCount     = parseInt(expectedSpeakerCount, 10);
    if (participantNames.length === 0) { setUploadError('Add at least one participant name.'); return; }
    if (!Number.isInteger(speakerCount) || speakerCount < 1 || speakerCount > 20) { setUploadError('Speaker count must be 1–20.'); return; }

    setUploadError(''); setUploading(true);
    try {
      const form = new FormData();
      form.append('audio', file);
      form.append('participant_names', JSON.stringify(participantNames));
      form.append('expected_speaker_count', String(speakerCount));
      form.append('language_locale', languageLocale.trim());
      form.append('user_keywords', JSON.stringify(parseList(userKeywordsInput)));
      if (titleInput.trim())       form.append('title', titleInput.trim());
      if (descriptionInput.trim()) form.append('description', descriptionInput.trim());

      const res = await api.post('/sessions/upload', form);
      const { sessionId, title, status, audioFormat, fileSizeBytes, createdAt } = res.data.data;

      const newSession = { session_id: sessionId, title, status, audio_format: audioFormat, file_size_bytes: fileSizeBytes, created_at: createdAt };
      setSessions(prev => [newSession, ...prev]);
      setShowUpload(false);
      setTitleInput(''); setDescriptionInput(''); setParticipantNamesInput('');
      setExpectedSpeakerCount('2'); setUserKeywordsInput('');

      selectSession(sessionId);
      startPolling(sessionId);
    } catch (err) {
      setUploadError(!err.response ? 'Cannot connect to server.' : err.response?.data?.message || `Upload failed (${err.response.status}).`);
    } finally { setUploading(false); }
  };

  const handleReprocess = async () => {
    if (!activeSessionId) return;
    try {
      await api.post(`/sessions/${activeSessionId}/reprocess`);
      alert('Re-processing started — results update in ~30 seconds.');
    } catch (e) { alert('Failed: ' + (e.response?.data?.message || e.message)); }
  };

  const toggleTask = async (taskId, current) => {
    try {
      await api.patch(`/tasks/${taskId}`, { is_completed: !current });
      setSessionDetail(prev => ({
        ...prev,
        tasks: prev.tasks.map(t => t.task_id === taskId ? { ...t, is_completed: !current } : t)
      }));
    } catch { /* ignore */ }
  };

  const onDragOver  = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop      = (e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); };
  const onFileChange = (e) => { const f = e.target.files[0]; if (f) handleFile(f); };

  const formatTime  = (secs) => { if (secs == null) return '—'; const m = Math.floor(secs/60).toString().padStart(2,'0'); const s = Math.floor(secs%60).toString().padStart(2,'0'); return `${m}:${s}`; };
  const formatBytes = (b) => { if (!b) return ''; return b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`; };
  const formatDate  = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—';
  const formatRelative = (d) => {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs/24)}d ago`;
  };

  const sentimentColor = { positive:'#4ade80', neutral:'#94a3b8', urgent:'#fb923c', negative:'#f87171' };

  const { session, transcript, summary, tasks, transactions } = sessionDetail || {};

  return (
    <div className="app-shell">
      {/* ── Sidebar ───────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="logo-text">pine.ai</span>
          <button className="btn-new" onClick={() => setShowUpload(true)} title="New recording">+</button>
        </div>

        <div className="sidebar-sessions">
          {sessions.length === 0 && (
            <p className="sidebar-empty">No recordings yet.<br />Click + to upload one.</p>
          )}
          {sessions.map(s => (
            <button
              key={s.session_id}
              className={`sidebar-item${activeSessionId === s.session_id ? ' active' : ''}`}
              onClick={() => selectSession(s.session_id)}
            >
              <div className="sidebar-item-title">{s.title}</div>
              <div className="sidebar-item-meta">
                <SidebarStatusDot status={s.status} />
                <span>{formatRelative(s.created_at)}</span>
                {s.duration_secs && <span>{formatTime(s.duration_secs)}</span>}
              </div>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <span className="user-email">{user?.email}</span>
          <button className="btn-ghost" onClick={handleLogout}>Sign out</button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────── */}
      <main className="main-panel">

        {/* Upload modal */}
        {showUpload && (
          <div className="modal-overlay" onClick={() => setShowUpload(false)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>New Recording</h2>
                <button className="btn-ghost" onClick={() => setShowUpload(false)}>✕</button>
              </div>

              <div className="upload-metadata-grid">
                <div className="field">
                  <label>Meeting Title</label>
                  <input type="text" value={titleInput} onChange={e => setTitleInput(e.target.value)} placeholder="Sprint planning" disabled={uploading} />
                </div>
                <div className="field">
                  <label>Description</label>
                  <input type="text" value={descriptionInput} onChange={e => setDescriptionInput(e.target.value)} placeholder="Topics, context, agenda" disabled={uploading} />
                </div>
                <div className="field">
                  <label>Participant Names <span className="required">*</span></label>
                  <input type="text" value={participantNamesInput} onChange={e => setParticipantNamesInput(e.target.value)} placeholder="Alice, Bob, Priya" disabled={uploading} />
                </div>
                <div className="field">
                  <label>Expected Speakers <span className="required">*</span></label>
                  <input type="number" min="1" max="20" value={expectedSpeakerCount} onChange={e => setExpectedSpeakerCount(e.target.value)} disabled={uploading} />
                </div>
                <div className="field">
                  <label>Language</label>
                  <select value={languageLocale} onChange={e => setLanguageLocale(e.target.value)} disabled={uploading}>
                    {LANGUAGE_LOCALE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Keywords</label>
                  <input type="text" value={userKeywordsInput} onChange={e => setUserKeywordsInput(e.target.value)} placeholder="IRMS, Kubernetes, payroll" disabled={uploading} />
                </div>
              </div>

              <div className={`upload-zone${dragOver ? ' drag-over' : ''}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={() => !uploading && fileInputRef.current?.click()}>
                <input ref={fileInputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg" style={{ display:'none' }} onChange={onFileChange} />
                {uploading
                  ? <div className="upload-status"><div className="spinner" /><p>Uploading…</p></div>
                  : <><div className="upload-icon">◈</div><p className="upload-label">Drop audio file here or click to browse</p><p className="upload-sub">mp3 · wav · m4a · webm · up to 100 MB</p></>
                }
              </div>
              {uploadError && <p className="error-text">{uploadError}</p>}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!activeSessionId && !loadingDetail && (
          <div className="empty-main">
            <p className="empty-main-title">No recording selected</p>
            <p className="empty-main-sub">Click + in the sidebar to upload a new recording, or select one from the list.</p>
            <button className="btn-primary" onClick={() => setShowUpload(true)}>Upload recording</button>
          </div>
        )}

        {/* Loading state */}
        {loadingDetail && (
          <div className="empty-main"><div className="spinner" /></div>
        )}

        {/* Session detail */}
        {session && !loadingDetail && (
          <div className="detail-panel">

            {/* Detail header */}
            <div className="detail-header">
              <div>
                <h1 className="detail-title">{session.title}</h1>
                <div className="detail-meta">
                  <StatusBadge status={session.status} />
                  {session.file_size_bytes && <span>{formatBytes(session.file_size_bytes)}</span>}
                  {session.duration_secs   && <span>{formatTime(session.duration_secs)}</span>}
                  <span>{formatRelative(session.created_at)}</span>
                </div>
              </div>
              {session.status === 'completed' && (
                <div className="detail-header-actions">
                  <button className="btn-ghost btn-sm" onClick={() => setShowEmailModal(true)}>📧 Share</button>
                  <button className="btn-ghost btn-sm" onClick={handleReprocess}>Re-process insights</button>
                </div>
              )}
            </div>

            {/* Processing state */}
            {(session.status === 'pending' || session.status === 'processing') && (
              <div className="processing-banner">
                <div className="processing-dots"><span /><span /><span /></div>
                <p>{session.status === 'pending' ? 'Queued for transcription…' : 'Transcribing audio — results will appear when ready.'}</p>
              </div>
            )}

            {/* Failed state */}
            {session.status === 'failed' && (
              <p className="error-text">Processing failed: {session.error_message || 'Unknown error.'}</p>
            )}

            {/* Completed state */}
            {session.status === 'completed' && (
              <>
                {/* Summary banner */}
                {summary && (
                  <div className="summary-banner" style={{ borderLeft:`3px solid ${sentimentColor[summary.sentiment] || '#94a3b8'}` }}>
                    <span className="summary-sentiment" style={{ color: sentimentColor[summary.sentiment] || '#94a3b8' }}>
                      {summary.sentiment?.toUpperCase()}
                    </span>
                    <p className="summary-text">{summary.executive_summary}</p>

                    {/* Key Decisions */}
                    {Array.isArray(summary.key_decisions) && summary.key_decisions.length > 0 && (
                      <div className="summary-decisions">
                        <p className="summary-decisions-label">🎯 Key Decisions</p>
                        <ul>{summary.key_decisions.map((d,i) => <li key={i}>{d}</li>)}</ul>
                      </div>
                    )}

                    {/* Open Questions */}
                    {Array.isArray(summary.open_questions) && summary.open_questions.length > 0 && (
                      <div className="summary-decisions" style={{ borderTop: '1px solid #1e1e1e', marginTop: 12, paddingTop: 12 }}>
                        <p className="summary-decisions-label">❓ Open Questions</p>
                        <ul>{summary.open_questions.map((q,i) => <li key={i}>{q}</li>)}</ul>
                      </div>
                    )}

                    {/* Owners */}
                    {Array.isArray(summary.owners) && summary.owners.length > 0 && (
                      <div className="summary-decisions" style={{ borderTop: '1px solid #1e1e1e', marginTop: 12, paddingTop: 12 }}>
                        <p className="summary-decisions-label">👤 Owners</p>
                        <ul>{summary.owners.map((o,i) => <li key={i}><strong>{o.area}</strong> — {o.owner}</li>)}</ul>
                      </div>
                    )}

                    {/* Deadlines */}
                    {Array.isArray(summary.deadlines) && summary.deadlines.length > 0 && (
                      <div className="summary-decisions" style={{ borderTop: '1px solid #1e1e1e', marginTop: 12, paddingTop: 12 }}>
                        <p className="summary-decisions-label">📅 Deadlines</p>
                        <ul>{summary.deadlines.map((d,i) => <li key={i}><strong>{d.item}</strong> — {d.due}</li>)}</ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Tabs */}
                <div className="result-tabs">
                  {[
                    { id:'transcript',   label:`Transcript (${transcript?.length || 0})` },
                    { id:'tasks',        label:`Tasks (${tasks?.length || 0})` },
                    { id:'transactions', label:`Transactions (${transactions?.length || 0})` },
                    { id:'workflow',     label:'Workflow' },
                  ].map(tab => (
                    <button key={tab.id} className={`result-tab${activeTab === tab.id ? ' active' : ''}`} onClick={() => {
                      setActiveTab(tab.id);
                      // Only fetch when we don't have data yet for this session
                      if (tab.id === 'workflow' && !workflowData && !loadingWorkflow) {
                        setLoadingWorkflow(true);
                        // refresh=true bypasses server cache so each session gets a unique fresh diagram
                        api.get(`/workflow/${activeSessionId}?refresh=true`)
                          .then(res => setWorkflowData(res.data.data))
                          .catch(() => setWorkflowData({ error: 'Failed to generate workflow diagram.' }))
                          .finally(() => setLoadingWorkflow(false));
                      }
                    }}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Transcript */}
                {activeTab === 'transcript' && (
                  <div className="transcript-list">
                    {(transcript || []).map((seg, i) => (
                      <div key={seg.transcript_id || i} className={`transcript-segment${i % 2 === 0 ? ' seg-a' : ' seg-b'}`}>
                        <div className="seg-meta">
                          <SpeakerLabel
                            label={seg.speaker_label}
                            participants={sessionDetail?.session?.participants || []}
                            onRename={async (oldLabel, newLabel) => {
                              try {
                                await api.post(`/sessions/${sessionDetail.session.session_id}/rename-speaker`, { oldLabel, newLabel });
                                setSessionDetail(prev => ({
                                  ...prev,
                                  transcript: prev.transcript.map(s =>
                                    s.speaker_label === oldLabel ? { ...s, speaker_label: newLabel } : s
                                  ),
                                }));
                              } catch (e) { alert('Rename failed: ' + (e.response?.data?.message || e.message)); }
                            }}
                          />
                          <span className="seg-time">{formatTime(seg.start_time)} — {formatTime(seg.end_time)}</span>
                        </div>
                        <p className="seg-text">{seg.text_segment}</p>
                      </div>
                    ))}
                  </div>
                )}


                {/* Tasks — grouped by assignee */}
                {activeTab === 'tasks' && (
                  <div className="tasks-list">
                    {!tasks?.length
                      ? <p className="empty-state">No action items detected in this meeting.</p>
                      : (() => {
                          // Group tasks by assignee
                          const grouped = {};
                          (tasks || []).forEach(task => {
                            const assignee = task.assignee || 'Unassigned';
                            if (!grouped[assignee]) grouped[assignee] = [];
                            grouped[assignee].push(task);
                          });

                          // Color palette for assignee avatars
                          const avatarColors = ['#818cf8', '#f472b6', '#34d399', '#fb923c', '#60a5fa', '#a78bfa', '#fbbf24', '#f87171'];
                          const assignees = Object.keys(grouped);

                          return assignees.map((assignee, groupIdx) => {
                            const groupTasks = grouped[assignee];
                            const completedCount = groupTasks.filter(t => t.is_completed).length;
                            const totalCount = groupTasks.length;
                            const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
                            const color = avatarColors[groupIdx % avatarColors.length];
                            const initials = assignee.replace(/^Speaker\s*/i, 'S').substring(0, 2).toUpperCase();

                            return (
                              <div key={assignee} className="task-assignee-group">
                                <div className="task-assignee-header">
                                  <div className="task-assignee-left">
                                    <div className="task-assignee-avatar" style={{ background: `${color}22`, color, borderColor: `${color}44` }}>
                                      {initials}
                                    </div>
                                    <div className="task-assignee-info">
                                      <span className="task-assignee-name">{assignee}</span>
                                      <span className="task-assignee-count">{completedCount}/{totalCount} completed</span>
                                    </div>
                                  </div>
                                  <div className="task-assignee-progress-wrap">
                                    <div className="task-assignee-progress-bar">
                                      <div className="task-assignee-progress-fill" style={{ width: `${progressPct}%`, background: color }} />
                                    </div>
                                    <span className="task-assignee-pct" style={{ color }}>{progressPct}%</span>
                                  </div>
                                </div>

                                <div className="task-assignee-tasks">
                                  {groupTasks.map(task => (
                                    <div key={task.task_id} className={`task-card${task.is_completed ? ' completed' : ''}`}>
                                      <div className="task-check" onClick={() => toggleTask(task.task_id, task.is_completed)} style={{ borderColor: task.is_completed ? color : undefined, background: task.is_completed ? `${color}22` : undefined, color: task.is_completed ? color : undefined }}>
                                        {task.is_completed ? '✓' : ''}
                                      </div>
                                      <div className="task-body">
                                        <p className="task-desc">{task.description}</p>
                                        <div className="task-meta">
                                          {task.deadline && <span className="task-chip chip-deadline">{formatDate(task.deadline)}</span>}
                                          <span className={`task-chip chip-priority-${task.priority}`}>{task.priority}</span>
                                          {task.deadline && (
                                            <a
                                              href={buildCalendarUrl(task, session?.title)}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="task-chip chip-calendar"
                                              onClick={e => e.stopPropagation()}
                                            >
                                              📅 Add to Calendar
                                            </a>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          });
                        })()
                    }
                  </div>
                )}

                {/* Transactions */}
                {activeTab === 'transactions' && (
                  <div className="transactions-list">
                    {!transactions?.length
                      ? <p className="empty-state">No financial items detected in this meeting.</p>
                      : <>
                          <div className="txn-totals">
                            <div className="txn-total-card income">
                              <span>Total income</span>
                              <strong>₹{(transactions||[]).filter(t=>t.type==='income').reduce((s,t)=>s+parseFloat(t.amount),0).toLocaleString('en-IN')}</strong>
                            </div>
                            <div className="txn-total-card expense">
                              <span>Total expenses</span>
                              <strong>₹{(transactions||[]).filter(t=>t.type==='expense').reduce((s,t)=>s+parseFloat(t.amount),0).toLocaleString('en-IN')}</strong>
                            </div>
                          </div>
                          {(transactions||[]).map(txn => (
                            <div key={txn.transaction_id} className={`txn-row txn-${txn.type}`}>
                              <div className="txn-left">
                                <span className="txn-category">{txn.category}</span>
                                <span className="txn-desc">{txn.description}</span>
                              </div>
                              <span className={`txn-amount ${txn.type}`}>
                                {txn.type==='income' ? '+' : '-'}₹{parseFloat(txn.amount).toLocaleString('en-IN')}
                              </span>
                            </div>
                          ))}
                        </>
                    }
                  </div>
                )}

                {/* Workflow */}
                {activeTab === 'workflow' && (
                  <div className="workflow-panel">
                    {loadingWorkflow && (
                      <div className="empty-main"><div className="spinner" /><p style={{marginTop:12,color:'#7a7a7a',fontSize:13}}>Generating meeting workflow…</p></div>
                    )}
                    {workflowData?.error && (
                      <p className="error-text">{workflowData.error}</p>
                    )}
                    {workflowData?.mermaid && !loadingWorkflow && (
                      <div className="workflow-diagram">
                        <MermaidRenderer code={workflowData.mermaid} />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Email Distribution Modal */}
        {showEmailModal && session && (
          <div className="modal-overlay" onClick={() => setShowEmailModal(false)}>
            <div onClick={e => e.stopPropagation()}>
              <EmailDistribution
                sessionId={session.session_id}
                summary={summary}
                tasks={tasks}
                transactions={transactions}
                onClose={() => setShowEmailModal(false)}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Small components ─────────────────────────────────────────────

function StatusBadge({ status }) {
  const labels = { pending:'Queued', processing:'Transcribing', completed:'Complete', failed:'Failed' };
  return <span className={`status-badge status-${status}`}>{labels[status] || status}</span>;
}

function SidebarStatusDot({ status }) {
  const colors = { pending:'#94a3b8', processing:'#fb923c', completed:'#4ade80', failed:'#f87171' };
  return <span style={{ width:6, height:6, borderRadius:'50%', background: colors[status]||'#94a3b8', display:'inline-block', flexShrink:0 }} />;
}

// ── VoiceProfiles ────────────────────────────────────────────────
function VoiceProfiles() {
  const [profiles, setProfiles]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showForm, setShowForm]       = useState(false);
  const [speakerName, setSpeakerName] = useState('');
  const [recording, setRecording]     = useState(false);
  const [audioBlob, setAudioBlob]     = useState(null);
  const [audioSource, setAudioSource] = useState('');
  const [uploading, setUploading]     = useState(false);
  const [error, setError]             = useState('');
  const [successMsg, setSuccessMsg]   = useState('');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef(null);
  const chunksRef        = useRef([]);
  const timerRef         = useRef(null);
  const fileInputRef     = useRef(null);

  const fetchProfiles = useCallback(async () => {
    try { const res = await api.get('/voice-profiles'); setProfiles(res.data.data.profiles || []); }
    catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchProfiles(); }, [fetchProfiles]);

  const startRecording = async () => {
    setError(''); setSuccessMsg(''); setAudioBlob(null); setAudioSource(''); setRecordSeconds(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
        else mimeType = '';
      }
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        setAudioBlob(new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' }));
        setAudioSource('recorded');
        stream.getTracks().forEach(t => t.stop());
        clearInterval(timerRef.current);
      };
      mediaRecorderRef.current = mr;
      mr.start(1000); setRecording(true);
      timerRef.current = setInterval(() => {
        setRecordSeconds(s => {
          if (s >= 14) { if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop(); setRecording(false); return 15; }
          return s + 1;
        });
      }, 1000);
    } catch { setError('Microphone access denied.'); }
  };

  const stopRecording = () => { if (mediaRecorderRef.current?.state === 'recording') { mediaRecorderRef.current.stop(); setRecording(false); clearInterval(timerRef.current); } };
  const handleFileSelect = (e) => { const f = e.target.files[0]; if (!f) return; setError(''); setSuccessMsg(''); setAudioBlob(f); setAudioSource('uploaded'); setRecordSeconds(0); };
  const clearAudio = () => { setAudioBlob(null); setAudioSource(''); setRecordSeconds(0); if (fileInputRef.current) fileInputRef.current.value = ''; };

  const handleSave = async () => {
    if (!speakerName.trim()) { setError('Enter speaker name.'); return; }
    if (!audioBlob) { setError('Record or upload audio first.'); return; }
    setUploading(true); setError(''); setSuccessMsg('');
    try {
      const form = new FormData();
      const ext = (audioBlob.type || '').includes('mp4') ? '.mp4' : '.webm';
      form.append('voice', audioBlob, audioSource === 'uploaded' && audioBlob.name ? audioBlob.name : `${speakerName.trim()}${ext}`);
      form.append('speaker_name', speakerName.trim());
      await api.post('/voice-profiles', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
      setSuccessMsg(`Voice profile for "${speakerName.trim()}" saved!`);
      setSpeakerName(''); clearAudio(); setShowForm(false); fetchProfiles();
    } catch (err) { setError(err.response?.data?.message || 'Upload failed.'); }
    finally { setUploading(false); }
  };

  const handleDelete = async (id) => {
    try { await api.delete(`/voice-profiles/${id}`); setProfiles(prev => prev.filter(p => p.profile_id !== id)); }
    catch { }
  };

  return (
    <section className="voice-profiles-section">
      <div className="vp-header">
        <div>
          <h3 className="vp-title">Voice Profiles</h3>
          <p className="vp-subtitle">Record or upload a 10–15s voice sample per participant to auto-identify speakers.</p>
        </div>
        <button className="btn-add-profile" onClick={() => { setShowForm(!showForm); setError(''); setSuccessMsg(''); }}>
          {showForm ? '✕ Cancel' : '+ Add Voice'}
        </button>
      </div>
      {!loading && profiles.length > 0 && (
        <div className="vp-list">
          {profiles.map(p => (
            <div key={p.profile_id} className="vp-card">
              <div className="vp-card-info">
                <span className="vp-card-name">{p.speaker_name}</span>
                <span className="vp-card-meta">{p.duration_secs ? `${Number(p.duration_secs).toFixed(0)}s` : '—'} · enrolled</span>
              </div>
              <button className="vp-card-delete" onClick={() => handleDelete(p.profile_id)}>✕</button>
            </div>
          ))}
        </div>
      )}
      {!loading && profiles.length === 0 && !showForm && <p className="vp-empty">No voice profiles yet.</p>}
      {successMsg && <p style={{ fontSize:13, color:'#8eb68e', marginTop:8 }}>{successMsg}</p>}
      {showForm && (
        <div className="vp-form">
          <div className="field">
            <label>Speaker Name</label>
            <input type="text" value={speakerName} onChange={e => setSpeakerName(e.target.value)} placeholder="e.g. Kashish" disabled={uploading} />
          </div>
          {!audioBlob && !recording && (
            <div className="vp-audio-options">
              <button className="btn-record" onClick={startRecording} disabled={uploading}><span className="record-dot" /> Record Voice</button>
              <span className="vp-or">or</span>
              <button className="btn-upload-voice" onClick={() => fileInputRef.current?.click()} disabled={uploading}>Upload Audio</button>
              <input ref={fileInputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg" style={{ display:'none' }} onChange={handleFileSelect} />
            </div>
          )}
          {recording && (
            <div className="vp-recording-active">
              <div className="recording-pulse" />
              <span className="recording-timer">{recordSeconds}s / 15s</span>
              <button className="btn-stop-record" onClick={stopRecording}>■ Stop</button>
            </div>
          )}
          {audioBlob && !recording && (
            <div className="vp-recorded">
              <span className="vp-recorded-badge">{audioSource === 'recorded' ? `✓ Recorded (${recordSeconds}s)` : `✓ ${audioBlob.name || 'audio'}`}</span>
              <button className="btn-re-record" onClick={clearAudio}>Change</button>
            </div>
          )}
          <p className="vp-tip">Speak naturally for 10–15 seconds.</p>
          {error && <p className="error-text">{error}</p>}
          <button className="btn-save-profile" onClick={handleSave} disabled={uploading || !speakerName.trim() || !audioBlob}>
            {uploading ? 'Extracting voiceprint…' : 'Save Voice Profile'}
          </button>
        </div>
      )}
    </section>
  );
}

// ── SpeakerLabel — click to rename (manual fallback) ─────────────────────────
function SpeakerLabel({ label, participants, onRename }) {
  const [open, setOpen]     = useState(false);
  const [custom, setCustom] = useState('');
  const ref                 = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (name) => {
    onRename(label, name);
    setOpen(false);
    setCustom('');
  };

  return (
    <div className="speaker-label-wrap" ref={ref}>
      <span
        className="seg-speaker seg-speaker-clickable"
        onClick={() => setOpen(o => !o)}
        title="Click to rename speaker"
      >
        {label} <span className="speaker-edit-icon">✎</span>
      </span>
      {open && (
        <div className="speaker-dropdown">
          <p className="speaker-dropdown-hint">Rename all "{label}" to:</p>
          {(Array.isArray(participants) ? participants : []).map((name, i) => (
            <button key={i} className="speaker-option" onClick={() => handleSelect(name)}>
              {name}
            </button>
          ))}
          {/* Custom input — human fallback */}
          <div className="speaker-custom">
            <input
              type="text"
              placeholder="Custom name…"
              value={custom}
              onChange={e => setCustom(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) handleSelect(custom.trim()); }}
            />
            <button
              disabled={!custom.trim()}
              onClick={() => { if (custom.trim()) handleSelect(custom.trim()); }}
            >✓</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MermaidRenderer — uses locally installed mermaid package ─────
function MermaidRenderer({ code }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    if (!code) return;
    setStatus('loading');
    let cancelled = false;

    const cleanCode = code
      .replace(/```mermaid\n?/gi, '')
      .replace(/```\n?/g, '')
      .trim();

    const render = async () => {
      try {
        // Always re-initialize so classDef colors (pink/yellow/sky-blue) are never overridden
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          securityLevel: 'loose',
          themeVariables: {
            background:           '#1a1a2e',
            primaryColor:         '#FF69B4',
            primaryTextColor:     '#000000',
            primaryBorderColor:   '#C71585',
            lineColor:            '#c0c0d8',
            secondaryColor:       '#FFD700',
            secondaryTextColor:   '#000000',
            secondaryBorderColor: '#FF8C00',
            tertiaryColor:        '#00BFFF',
            tertiaryTextColor:    '#000000',
            tertiaryBorderColor:  '#0047AB',
            edgeLabelBackground:  '#2a2a4e',
            fontFamily:           'Inter, system-ui, sans-serif',
            fontSize:             '14px',
          },
        });

        if (cancelled) return;

        const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const { svg } = await mermaid.render(id, cleanCode);

        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          const svgEl = containerRef.current.querySelector('svg');
          if (svgEl) {
            svgEl.style.maxWidth = '100%';
            svgEl.style.height   = 'auto';
          }
          setStatus('rendered');
        }
      } catch (err) {
        console.error('[Mermaid] Render error:', err);
        if (!cancelled) setStatus('error');
      }
    };

    render();
    return () => { cancelled = true; };
  }, [code]);

  if (!code) return null;

  return (
    <>
      {/* Spinner — shown while mermaid.render() is working */}
      {status === 'loading' && (
        <div style={{ padding: 24, textAlign: 'center', color: '#7a7a7a', fontSize: 13 }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          Rendering diagram…
        </div>
      )}

      {/* Error fallback */}
      {status === 'error' && (
        <div style={{ padding: 16 }}>
          <p style={{ color: '#f59e0b', fontSize: 12, marginBottom: 8 }}>⚠ Diagram couldn’t render. Raw flowchart:</p>
          <pre style={{
            color: '#ececec', fontSize: 12, whiteSpace: 'pre-wrap',
            padding: 16, background: '#111', borderRadius: 6,
            border: '1px solid #202020', lineHeight: 1.6,
            maxHeight: 500, overflow: 'auto',
          }}>
            {code}
          </pre>
        </div>
      )}

      {/*
        Always mounted so containerRef.current is never null.
        mermaid.render() returns SVG which gets injected here once ready.
        Hidden until render completes.
      */}
      <div
        ref={containerRef}
        className="mermaid-container"
        style={{ padding: 16, overflow: 'auto', display: status === 'rendered' ? 'block' : 'none' }}
      />
    </>
  );
}
