import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { authStore } from './store/authStore';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';

// ================================================================
// APP — Routing + Google OAuth Provider
// ================================================================
// /           → AuthPage   (redirects to /dashboard if logged in)
// /dashboard  → DashboardPage (protected — redirects to / if not logged in)
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
        <Route path="/"          element={<AuthGuard />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="*"          element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  // If no Google Client ID configured, render without the provider
  if (!GOOGLE_CLIENT_ID) {
    return <AppRoutes />;
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AppRoutes />
    </GoogleOAuthProvider>
  );
}
