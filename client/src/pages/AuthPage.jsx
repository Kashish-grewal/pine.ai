import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import api from '../api/client';
import { authStore } from '../store/authStore';

// ================================================================
// AUTH PAGE — Login, Register, Google Sign-In, & Token Connect
// ================================================================

export default function AuthPage() {
  const [mode, setMode] = useState('token'); // 'login' | 'register' | 'token'
  const [form, setForm] = useState({ full_name: '', email: '', password: '', token: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  // ── Email/Password login or register ─────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const payload = mode === 'login'
        ? { email: form.email, password: form.password }
        : { email: form.email, password: form.password, full_name: form.full_name };

      const res = await api.post(endpoint, payload);
      authStore.set(res.data.data.accessToken, res.data.data.user);
      navigate('/dashboard');
    } catch (err) {
      if (!err.response) {
        setError('Cannot connect to server. Make sure the backend is running on port 5001.');
      } else {
        const d = err.response.data;
        const msg = d?.errors?.[0]?.message || d?.message || `Server error (${err.response.status})`;
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Token-based connect ──────────────────────────────────────────
  const handleTokenConnect = async (e) => {
    e.preventDefault();
    setError('');
    const token = form.token.trim();

    if (!token) {
      setError('Please paste your access token.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/token-login', { token });
      authStore.set(res.data.data.accessToken, res.data.data.user);
      navigate('/dashboard');
    } catch (err) {
      if (!err.response) {
        setError('Cannot connect to server. Make sure the backend is running on port 5001.');
      } else {
        setError(err.response.data?.message || 'Invalid token.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Google OAuth handler ─────────────────────────────────────────
  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/google', {
        credential: credentialResponse.credential,
      });
      authStore.set(res.data.data.accessToken, res.data.data.user);
      navigate('/dashboard');
    } catch (err) {
      if (!err.response) {
        setError('Cannot connect to server.');
      } else {
        setError(err.response.data?.message || 'Google sign-in failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleError = () => {
    setError('Google sign-in was cancelled or failed. Please try again.');
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    setError('');
    setForm({ full_name: '', email: '', password: '', token: '' });
  };

  return (
    <div className="auth-container">
      <div className="auth-card">

        {/* Logo */}
        <div className="auth-logo">
          <span className="logo-text">pine.ai</span>
          <p className="logo-sub">Voice to Structured Intelligence</p>
        </div>

        <div className="auth-divider" />

        {/* Mode Tabs */}
        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === 'token' ? 'active' : ''}`}
            onClick={() => switchMode('token')}
          >
            🔑 Connect
          </button>
          <button
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => switchMode('login')}
          >
            Sign In
          </button>
          <button
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => switchMode('register')}
          >
            Register
          </button>
        </div>

        {/* ── Token Connect Mode ─────────────────────────────────── */}
        {mode === 'token' && (
          <form className="auth-form" onSubmit={handleTokenConnect} noValidate>
            <p className="token-connect-desc">
              Paste your access token to connect instantly — no password needed.
            </p>

            <div className="field">
              <label htmlFor="token">Access Token</label>
              <textarea
                id="token"
                name="token"
                value={form.token}
                onChange={handleChange}
                placeholder="eyJhbGciOiJIUzI1..."
                rows={4}
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  color: 'var(--text)',
                  fontFamily: 'var(--mono)',
                  fontSize: '12px',
                  padding: '11px 14px',
                  outline: 'none',
                  resize: 'vertical',
                  width: '100%',
                }}
              />
            </div>

            {error && <p className="auth-error">{error}</p>}

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Connecting...' : '→ Connect'}
            </button>

            <p className="token-connect-hint">
              Get your token from the <strong>Settings</strong> page after logging in,
              or use the command below:
            </p>
            <code className="token-cmd">
              cd server && node -e "require('dotenv').config(); const jwt=require('jsonwebtoken'); const {'{'} pool {'}'}=require('./db/db'); (async()=&gt;{'{'} const r=await pool.query('SELECT user_id,email FROM users'); r.rows.forEach(u=&gt;console.log(u.email)); process.exit(0); {'}'})();"
            </code>
          </form>
        )}

        {/* ── Login / Register Mode ──────────────────────────────── */}
        {(mode === 'login' || mode === 'register') && (
          <>
            {/* Google Sign-In — only shown when Client ID is configured */}
            {import.meta.env.VITE_GOOGLE_CLIENT_ID && (
              <>
                <div className="google-signin-wrap">
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={handleGoogleError}
                    theme="filled_black"
                    size="large"
                    text={mode === 'login' ? 'signin_with' : 'signup_with'}
                    shape="rectangular"
                  />
                </div>

                {/* OR divider */}
                <div className="auth-or-divider">
                  <span>or</span>
                </div>
              </>
            )}

            {/* Form */}
            <form className="auth-form" onSubmit={handleSubmit} noValidate>

              {mode === 'register' && (
                <div className="field">
                  <label htmlFor="full_name">Full Name</label>
                  <input
                    id="full_name"
                    name="full_name"
                    type="text"
                    value={form.full_name}
                    onChange={handleChange}
                    placeholder="Your name"
                    autoComplete="name"
                    required
                  />
                </div>
              )}

              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />
              </div>

              {error && <p className="auth-error">{error}</p>}

              <button type="submit" className="btn-primary" disabled={loading}>
                {loading
                  ? 'Please wait...'
                  : mode === 'login'
                    ? 'Sign in'
                    : 'Create account'}
              </button>
            </form>
          </>
        )}

      </div>
      <p className="auth-credit">Built by <strong>Kashish</strong></p>
    </div>
  );
}
