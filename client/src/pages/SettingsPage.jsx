import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authStore } from '../store/authStore';

// ================================================================
// SETTINGS PAGE — Extension Token + Account Info
// ================================================================
// This page lets the user:
//  1. View and copy their auth token for the Chrome extension
//  2. See account info
//  3. Navigate back to dashboard
// ================================================================

export default function SettingsPage() {
  const navigate = useNavigate();
  const [copied, setCopied]   = useState(false);
  const [showToken, setShowToken] = useState(false);

  const token = authStore.getToken();
  const user  = authStore.getUser();

  useEffect(() => {
    if (!authStore.isLoggedIn()) navigate('/', { replace: true });
  }, [navigate]);

  const handleCopy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = token;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const maskedToken = token
    ? `${token.slice(0, 12)}${'•'.repeat(20)}${token.slice(-8)}`
    : 'Not logged in';

  return (
    <div className="settings-page">
      <div className="settings-container">

        {/* Header */}
        <div className="settings-header">
          <button className="btn-back" onClick={() => navigate('/dashboard')}>
            ← Dashboard
          </button>
          <h1 className="settings-title">Settings</h1>
          <p className="settings-subtitle">Account & Chrome Extension</p>
        </div>

        {/* Account Card */}
        <div className="settings-card">
          <h2 className="card-title">👤 Account</h2>
          <div className="account-info">
            <div className="account-row">
              <span className="account-label">Email</span>
              <span className="account-value">{user?.email || '—'}</span>
            </div>
            <div className="account-row">
              <span className="account-label">Name</span>
              <span className="account-value">{user?.name || user?.email?.split('@')[0] || '—'}</span>
            </div>
          </div>
        </div>

        {/* Extension Token Card */}
        <div className="settings-card highlight">
          <h2 className="card-title">🔌 Chrome Extension Setup</h2>
          <p className="card-desc">
            Copy your auth token below and paste it into the Pine.AI Chrome extension settings.
          </p>

          <div className="token-steps">
            <div className="step">
              <span className="step-num">1</span>
              <span>Install the Pine.AI Chrome extension</span>
            </div>
            <div className="step">
              <span className="step-num">2</span>
              <span>Click the extension icon → ⚙️ Settings</span>
            </div>
            <div className="step">
              <span className="step-num">3</span>
              <span>Paste the token below into <strong>Auth Token</strong></span>
            </div>
            <div className="step">
              <span className="step-num">4</span>
              <span>Set Server URL to <code>http://localhost:5001</code></span>
            </div>
          </div>

          <label className="token-label">Your Auth Token</label>
          <div className="token-box">
            <code className="token-value">
              {showToken ? token : maskedToken}
            </code>
            <div className="token-actions">
              <button
                className="btn-token-action"
                onClick={() => setShowToken(s => !s)}
                title={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? '🙈' : '👁️'}
              </button>
              <button
                className={`btn-token-action btn-copy ${copied ? 'copied' : ''}`}
                onClick={handleCopy}
                title="Copy to clipboard"
              >
                {copied ? '✅ Copied!' : '📋 Copy'}
              </button>
            </div>
          </div>

          <p className="token-warning">
            ⚠️ Keep this token private. It grants full access to your Pine.AI account.
            Token expires in 7 days — come back here to get a new one.
          </p>
        </div>

        {/* Extension Status Card */}
        <div className="settings-card">
          <h2 className="card-title">📡 Connection Info</h2>
          <div className="account-info">
            <div className="account-row">
              <span className="account-label">API Server</span>
              <span className="account-value"><code>http://localhost:5001</code></span>
            </div>
            <div className="account-row">
              <span className="account-label">Dashboard</span>
              <span className="account-value"><code>http://localhost:5173</code></span>
            </div>
            <div className="account-row">
              <span className="account-label">Token Status</span>
              <span className="account-value" style={{ color: token ? '#4ade80' : '#f87171' }}>
                {token ? '✅ Active' : '❌ Not logged in'}
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
