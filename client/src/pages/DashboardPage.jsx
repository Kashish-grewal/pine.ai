import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { authStore } from '../store/authStore';

// ================================================================
// DASHBOARD PAGE — Upload audio + view transcript
// ================================================================

export default function DashboardPage() {
  const [dragOver, setDragOver]     = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [session, setSession]       = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [uploadError, setUploadError] = useState('');

  const pollRef     = useRef(null);
  const fileInputRef = useRef(null);
  const navigate    = useNavigate();
  const user        = authStore.getUser();

  // ── Auth guard ───────────────────────────────────────────
  useEffect(() => {
    if (!authStore.isLoggedIn()) navigate('/');
  }, [navigate]);

  // ── Cleanup polling on unmount ───────────────────────────
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // ── Handlers ─────────────────────────────────────────────

  const handleLogout = () => {
    authStore.clear();
    navigate('/');
  };

  const handleFile = async (file) => {
    if (!file) return;
    setUploadError('');
    setSession(null);
    setTranscript([]);
    setUploading(true);

    try {
      const form = new FormData();
      form.append('audio', file);

      const res = await api.post('/sessions/upload', form);

      const { sessionId, title, status, audioFormat, fileSizeBytes, createdAt } = res.data.data;

      setSession({ session_id: sessionId, title, status, audio_format: audioFormat, file_size_bytes: fileSizeBytes, created_at: createdAt });
      startPolling(sessionId);
    } catch (err) {
      if (!err.response) {
        setUploadError('Cannot connect to server. Make sure the backend is running on port 5001.');
      } else {
        setUploadError(err.response?.data?.message || `Upload failed (${err.response.status}).`);
      }
    } finally {
      setUploading(false);
    }
  };

  const startPolling = (sessionId) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get(`/sessions/${sessionId}`);
        const s   = res.data.data.session;
        const t   = res.data.data.transcript;

        setSession(s);

        if (s.status === 'completed') {
          setTranscript(Array.isArray(t) ? t : []);
          clearInterval(pollRef.current);
        } else if (s.status === 'failed') {
          clearInterval(pollRef.current);
        }
      } catch {
        clearInterval(pollRef.current);
      }
    }, 3000);
  };

  // ── Drag & Drop ──────────────────────────────────────────

  const onDragOver  = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = ()  => setDragOver(false);
  const onDrop      = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };
  const onFileChange = (e) => { const f = e.target.files[0]; if (f) handleFile(f); };

  // ── Helpers ──────────────────────────────────────────────

  const formatTime = (secs) => {
    if (secs == null) return '—';
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="dashboard">

      {/* ── Header ── */}
      <header className="header">
        <span className="logo-text">pine.ai</span>
        <div className="header-right">
          <span className="user-email">{user?.email}</span>
          <button className="btn-ghost" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="main-content">

        {/* Upload zone */}
        <section className="upload-section">
          <div
            className={`upload-zone${dragOver ? ' drag-over' : ''}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
              style={{ display: 'none' }}
              onChange={onFileChange}
            />

            {uploading ? (
              <div className="upload-status">
                <div className="spinner" />
                <p>Uploading audio&hellip;</p>
              </div>
            ) : (
              <>
                <div className="upload-icon">&#9672;</div>
                <p className="upload-label">Drop audio file here</p>
                <p className="upload-sub">mp3 &nbsp;&middot;&nbsp; wav &nbsp;&middot;&nbsp; m4a &nbsp;&middot;&nbsp; webm &nbsp;&middot;&nbsp; up to 100 MB</p>
              </>
            )}
          </div>

          {uploadError && <p className="error-text">{uploadError}</p>}
        </section>

        {/* Session + transcript */}
        {session && (
          <section className="session-section">

            {/* Session header */}
            <div className="session-header">
              <div>
                <p className="session-title">{session.title}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <StatusBadge status={session.status} />
                  {session.file_size_bytes && (
                    <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--mono)' }}>
                      {formatBytes(session.file_size_bytes)}
                    </span>
                  )}
                  {session.duration_secs && (
                    <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'var(--mono)' }}>
                      {formatTime(session.duration_secs)}
                    </span>
                  )}
                </div>
              </div>

              {(session.status === 'pending' || session.status === 'processing') && (
                <div className="processing-dots">
                  <span /><span /><span />
                </div>
              )}
            </div>

            {/* Processing message */}
            {(session.status === 'pending' || session.status === 'processing') && (
              <p style={{ fontSize: 13, color: 'var(--text-2)' }}>
                {session.status === 'pending'
                  ? 'Queued for transcription — this will begin in a moment.'
                  : 'Transcribing audio — speaker segments will appear when ready.'}
              </p>
            )}

            {/* Transcript */}
            {session.status === 'completed' && transcript.length > 0 && (
              <div className="transcript-container">
                <p className="transcript-label">
                  Transcript &mdash; {transcript.length} segment{transcript.length !== 1 ? 's' : ''}
                </p>
                <div className="transcript-list">
                  {transcript.map((seg, i) => (
                    <div
                      key={seg.transcript_id || i}
                      className={`transcript-segment${i % 2 === 0 ? ' seg-a' : ' seg-b'}`}
                    >
                      <div className="seg-meta">
                        <span className="seg-speaker">{seg.speaker_label}</span>
                        <span className="seg-time">
                          {formatTime(seg.start_time)} &mdash; {formatTime(seg.end_time)}
                        </span>
                      </div>
                      <p className="seg-text">{seg.text_segment}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Failed */}
            {session.status === 'failed' && (
              <p className="error-text">
                Processing failed: {session.error_message || 'An unknown error occurred.'}
              </p>
            )}

          </section>
        )}

      </main>
    </div>
  );
}

// ── Status Badge ─────────────────────────────────────────────────

function StatusBadge({ status }) {
  const labels = {
    pending:    'Queued',
    processing: 'Transcribing',
    completed:  'Complete',
    failed:     'Failed',
  };
  return (
    <span className={`status-badge status-${status}`}>
      {labels[status] || status}
    </span>
  );
}
