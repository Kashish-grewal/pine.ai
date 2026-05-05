import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import api from '../api/client';
import { authStore } from '../store/authStore';

// ================================================================
// AUTH PAGE — Login, Register, & Google Sign-In
// ================================================================

export default function AuthPage() {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({ full_name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

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
        // No response at all = server unreachable or CORS
        setError('Cannot connect to server. Make sure the backend is running on port 5001.');
      } else {
        const d = err.response.data;
        // Show first validation field error if present, otherwise the top-level message
        const msg = d?.errors?.[0]?.message || d?.message || `Server error (${err.response.status})`;
        setError(msg);
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

  const toggleMode = () => {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setError('');
    setForm({ full_name: '', email: '', password: '' });
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

        {/* Toggle */}
        <p className="auth-toggle">
          {mode === 'login'
            ? "Don't have an account?"
            : 'Already have an account?'}
          {' '}
          <button type="button" onClick={toggleMode}>
            {mode === 'login' ? 'Register \u2192' : 'Sign in \u2192'}
          </button>
        </p>

      </div>
    </div>
  );
}
