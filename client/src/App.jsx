import { useEffect, lazy, Suspense, useState } from 'react';
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { authStore } from './store/authStore';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/ConfirmDialog';

// ================================================================
// APP — Routing + Google OAuth Provider
// ================================================================
// /           → LandingPage (marketing page)
// /auth       → AuthPage    (login / register / token connect)
// /dashboard  → DashboardPage (protected)
// /settings   → SettingsPage  (protected)
// ================================================================

// Route-level code splitting — only load pages when navigated to.
// LandingPage visitors don't download the dashboard bundle.
const LandingPage = lazy(() => import('./pages/LandingPage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ExtensionPage = lazy(() => import('./pages/ExtensionPage'));

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Minimal loading fallback for Suspense
const PageLoader = () => (
  <div className="page-loader">
    <div className="spinner" />
  </div>
);

// Error Boundary
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#f87171', fontFamily: 'monospace' }}>
          <h2>⚠ App Error</h2>
          <p style={{ fontSize: 12, marginTop: 8, color: '#ccc' }}>
            {this.state.error?.message || 'Unknown error'}
          </p>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AuthGuard() {
  const navigate = useNavigate();
  useEffect(() => {
    if (authStore.isLoggedIn()) navigate('/dashboard', { replace: true });
  }, [navigate]);
  return (
    <Suspense fallback={<PageLoader />}>
      <AuthPage />
    </Suspense>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/"          element={<LandingPage />} />
        <Route path="/auth"      element={<AuthGuard />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/settings"  element={<SettingsPage />} />
        <Route path="/extension" element={<ExtensionPage />} />
        <Route path="*"          element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  const inner = (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <AppRoutes />
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );

  if (!GOOGLE_CLIENT_ID) {
    return <ErrorBoundary>{inner}</ErrorBoundary>;
  }

  return (
    <ErrorBoundary>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        {inner}
      </GoogleOAuthProvider>
    </ErrorBoundary>
  );
}
