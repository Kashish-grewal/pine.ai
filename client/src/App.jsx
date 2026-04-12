import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { authStore } from './store/authStore';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';

// ===================================== ===========================
// APP — Routing
// ================================================================
// /           → AuthPage   (redirects to /dashboard if logged in)
// /dashboard  → DashboardPage (protected — redirects to / if not logged in)
// ================================================================

function AuthGuard() {
  const navigate = useNavigate();
  useEffect(() => {
    if (authStore.isLoggedIn()) navigate('/dashboard', { replace: true });
  }, [navigate]);
  return <AuthPage />;
}

export default function App() {
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
