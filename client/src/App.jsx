import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { authStore } from './store/authStore';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';

// ================================================================
// APP — Routing + Google OAuth Provider
// ================================================================
// /           → LandingPage (marketing page)
// /auth       → AuthPage    (login / register / token connect)
// /dashboard  → DashboardPage (protected)
// /settings   → SettingsPage  (protected)
// ================================================================

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function AuthGuard() {
  const navigate = useNavigate();
  useEffect(() => {
    if (authStore.isLoggedIn()) navigate('/dashboard', { replace: true });
  }, [navigate]);
  return <AuthPage />;
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"          element={<LandingPage />} />
        <Route path="/auth"      element={<AuthGuard />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/settings"  element={<SettingsPage />} />
        <Route path="*"          element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  if (!GOOGLE_CLIENT_ID) {
    return <AppRoutes />;
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AppRoutes />
    </GoogleOAuthProvider>
  );
}
