import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { authStore } from '../store/authStore';

// ================================================================
// DASHBOARD PAGE — Upload audio + view transcript
// ================================================================

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
  const [dragOver, setDragOver]     = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [session, setSession]       = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [uploadError, setUploadError] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [participantNamesInput, setParticipantNamesInput] = useState('');
  const [expectedSpeakerCount, setExpectedSpeakerCount] = useState('2');
  const [languageLocale, setLanguageLocale] = useState('en-IN');
  const [userKeywordsInput, setUserKeywordsInput] = useState('');

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

  const parseCommaSeparatedList = (value) => {
    const tokens = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const seen = new Set();
    return tokens.filter((token) => {
      const key = token.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const handleFile = async (file) => {
    if (!file) return;

    const participantNames = parseCommaSeparatedList(participantNamesInput);
    const userKeywords = parseCommaSeparatedList(userKeywordsInput);
    const speakerCount = Number.parseInt(expectedSpeakerCount, 10);
    const trimmedLocale = languageLocale.trim();

    if (participantNames.length === 0) {
      setUploadError('Add at least one participant name before upload.');
      return;
    }

    if (!Number.isInteger(speakerCount) || speakerCount < 1 || speakerCount > 20) {
      setUploadError('Expected speaker count must be a number between 1 and 20.');
      return;
    }

    if (!trimmedLocale) {
      setUploadError('Language locale is required (example: en-IN).');
      return;
    }

    setUploadError('');
    setSession(null);
    setTranscript([]);
    setUploading(true);

    try {
      const form = new FormData();
      form.append('audio', file);
      form.append('participant_names', JSON.stringify(participantNames));
      form.append('expected_speaker_count', String(speakerCount));
      form.append('language_locale', trimmedLocale);
      form.append('user_keywords', JSON.stringify(userKeywords));

      if (titleInput.trim()) {
        form.append('title', titleInput.trim());
      }

      if (descriptionInput.trim()) {
        form.append('description', descriptionInput.trim());
      }

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
          <div className="upload-metadata-grid">
            <div className="field">
              <label htmlFor="meeting-title">Meeting Title (Optional)</label>
              <input
                id="meeting-title"
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                placeholder="Sprint planning"
                disabled={uploading}
              />
            </div>

            <div className="field">
              <label htmlFor="meeting-description">Session Description (Optional)</label>
              <input
                id="meeting-description"
                type="text"
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.target.value)}
                placeholder="Topics, context, agenda"
                disabled={uploading}
              />
            </div>

            <div className="field">
              <label htmlFor="participant-names">Participant Names (Required)</label>
              <input
                id="participant-names"
                type="text"
                value={participantNamesInput}
                onChange={(e) => setParticipantNamesInput(e.target.value)}
                placeholder="Taminder, Monica, Arjun"
                disabled={uploading}
              />
            </div>

            <div className="field">
              <label htmlFor="expected-speakers">Expected Speaker Count (Required)</label>
              <input
                id="expected-speakers"
                type="number"
                min="1"
                max="20"
                value={expectedSpeakerCount}
                onChange={(e) => setExpectedSpeakerCount(e.target.value)}
                disabled={uploading}
              />
            </div>

            <div className="field">
              <label htmlFor="language-locale">Language Locale (Required)</label>
              <select
                id="language-locale"
                value={languageLocale}
                onChange={(e) => setLanguageLocale(e.target.value)}
                disabled={uploading}
              >
                {LANGUAGE_LOCALE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="user-keywords">Keywords (Optional)</label>
              <input
                id="user-keywords"
                type="text"
                value={userKeywordsInput}
                onChange={(e) => setUserKeywordsInput(e.target.value)}
                placeholder="IRMS, Kubernetes, payroll"
                disabled={uploading}
              />
            </div>
          </div>

          <p className="upload-meta-note">
            Keywords are optional. The backend auto-generates a boosted keyword list using names,
            session context, and historical transcripts.
          </p>

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
