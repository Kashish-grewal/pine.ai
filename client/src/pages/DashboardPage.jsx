import { useState, useEffect, useRef, useCallback } from 'react';
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

        {/* Voice Profiles */}
        <VoiceProfiles />

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

// ── Voice Profiles ──────────────────────────────────────────────────

function VoiceProfiles() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [speakerName, setSpeakerName] = useState('');
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioSource, setAudioSource] = useState(''); // 'recorded' or 'uploaded'
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await api.get('/voice-profiles');
      setProfiles(res.data.data.profiles || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProfiles(); }, [fetchProfiles]);

  // ── Recording ───────────────────────────────
  const startRecording = async () => {
    setError('');
    setSuccessMsg('');
    setAudioBlob(null);
    setAudioSource('');
    setRecordSeconds(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Pick a supported mimeType
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
        else if (MediaRecorder.isTypeSupported('video/webm')) mimeType = 'video/webm';
        else mimeType = ''; // let browser pick
      }

      const mrOptions = mimeType ? { mimeType } : {};
      const mr = new MediaRecorder(stream, mrOptions);
      chunksRef.current = [];

      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        setAudioBlob(blob);
        setAudioSource('recorded');
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timerRef.current);
      };

      mediaRecorderRef.current = mr;
      mr.start(1000); // collect data every 1s
      setRecording(true);

      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s >= 14) {
            if (mediaRecorderRef.current?.state === 'recording') {
              mediaRecorderRef.current.stop();
            }
            setRecording(false);
            return 15;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      setError('Microphone access denied. Please allow microphone permission.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setRecording(false);
      clearInterval(timerRef.current);
    }
  };

  // ── File upload ─────────────────────────────
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    setSuccessMsg('');
    setAudioBlob(file);
    setAudioSource('uploaded');
    setRecordSeconds(0);
  };

  const clearAudio = () => {
    setAudioBlob(null);
    setAudioSource('');
    setRecordSeconds(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Save ────────────────────────────────────
  const handleSave = async () => {
    if (!speakerName.trim()) { setError('Enter the speaker\'s name.'); return; }
    if (!audioBlob) { setError('Record or upload a voice sample first.'); return; }

    setUploading(true);
    setError('');
    setSuccessMsg('');

    try {
      const form = new FormData();

      // Determine filename and append
      if (audioSource === 'uploaded' && audioBlob.name) {
        form.append('voice', audioBlob, audioBlob.name);
      } else {
        const ext = (audioBlob.type || '').includes('mp4') ? '.mp4' : '.webm';
        form.append('voice', audioBlob, `${speakerName.trim()}${ext}`);
      }
      form.append('speaker_name', speakerName.trim());

      const res = await api.post('/voice-profiles', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000, // 2 min — embedding extraction takes time
      });

      setSuccessMsg(`Voice profile for "${speakerName.trim()}" saved!`);
      setSpeakerName('');
      clearAudio();
      setShowForm(false);
      fetchProfiles();
    } catch (err) {
      console.error('Voice profile upload error:', err);
      const msg = err.response?.data?.message || err.message || 'Upload failed.';
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/voice-profiles/${id}`);
      setProfiles((prev) => prev.filter((p) => p.profile_id !== id));
    } catch {
      // ignore
    }
  };

  return (
    <section className="voice-profiles-section">
      <div className="vp-header">
        <div>
          <h3 className="vp-title">🎤 Voice Profiles</h3>
          <p className="vp-subtitle">
            Record or upload a 10–15 second voice sample per participant to
            automatically identify who's speaking in your meetings.
          </p>
        </div>
        <button
          className="btn-add-profile"
          onClick={() => { setShowForm(!showForm); setError(''); setSuccessMsg(''); }}
        >
          {showForm ? '✕ Cancel' : '+ Add Voice'}
        </button>
      </div>

      {/* Existing profiles */}
      {!loading && profiles.length > 0 && (
        <div className="vp-list">
          {profiles.map((p) => (
            <div key={p.profile_id} className="vp-card">
              <div className="vp-card-info">
                <span className="vp-card-name">{p.speaker_name}</span>
                <span className="vp-card-meta">
                  {p.duration_secs ? `${Number(p.duration_secs).toFixed(0)}s` : '—'} • enrolled
                </span>
              </div>
              <button className="vp-card-delete" onClick={() => handleDelete(p.profile_id)} title="Delete profile">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && profiles.length === 0 && !showForm && (
        <p className="vp-empty">No voice profiles yet. Add one to improve speaker identification.</p>
      )}

      {successMsg && <p style={{ fontSize: 13, color: '#8eb68e', marginTop: 8 }}>{successMsg}</p>}

      {/* Add profile form */}
      {showForm && (
        <div className="vp-form">
          <div className="field">
            <label htmlFor="vp-speaker-name">Speaker Name</label>
            <input
              id="vp-speaker-name"
              type="text"
              value={speakerName}
              onChange={(e) => setSpeakerName(e.target.value)}
              placeholder="e.g. Kashish"
              disabled={uploading}
            />
          </div>

          {/* Audio source - record OR upload */}
          {!audioBlob && !recording && (
            <div className="vp-audio-options">
              <button className="btn-record" onClick={startRecording} disabled={uploading}>
                <span className="record-dot" /> Record Voice
              </button>
              <span className="vp-or">or</span>
              <button
                className="btn-upload-voice"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                📁 Upload Audio File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
            </div>
          )}

          {/* Recording in progress */}
          {recording && (
            <div className="vp-recording-active">
              <div className="recording-pulse" />
              <span className="recording-timer">{recordSeconds}s / 15s</span>
              <button className="btn-stop-record" onClick={stopRecording}>
                ■ Stop
              </button>
            </div>
          )}

          {/* Audio ready */}
          {audioBlob && !recording && (
            <div className="vp-recorded">
              <span className="vp-recorded-badge">
                {audioSource === 'recorded'
                  ? `✓ Recorded (${recordSeconds}s)`
                  : `✓ File: ${audioBlob.name || 'audio'}`}
              </span>
              <button className="btn-re-record" onClick={clearAudio}>
                Change
              </button>
            </div>
          )}

          <p className="vp-tip">
            💡 Speak naturally for 10-15 seconds — say your name and something you typically discuss in meetings.
          </p>

          {error && <p className="error-text">{error}</p>}

          <button
            className="btn-save-profile"
            onClick={handleSave}
            disabled={uploading || !speakerName.trim() || !audioBlob}
          >
            {uploading ? 'Extracting voiceprint…' : 'Save Voice Profile'}
          </button>
        </div>
      )}
    </section>
  );
}
