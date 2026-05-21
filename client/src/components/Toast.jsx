import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Icons } from './Icons';

// ================================================================
// TOAST NOTIFICATION SYSTEM
// ================================================================
// Replaces browser-native alert() with premium, animated toasts.
// Usage:
//   const toast = useToast();
//   toast.success('Session deleted!');
//   toast.error('Upload failed.');
//   toast.info('Processing started.');
// ================================================================

const ToastContext = createContext(null);

let toastIdCounter = 0;

const ICONS = {
  success: Icons.check,
  error: Icons.x,
  info: Icons.sparkle,
  warning: Icons.warning,
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  const addToast = useCallback((type, message, duration = 4000) => {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, type, message, exiting: false }]);
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
    return id;
  }, [removeToast]);

  const toast = {
    success: (msg, dur) => addToast('success', msg, dur),
    error: (msg, dur) => addToast('error', msg, dur ?? 6000),
    info: (msg, dur) => addToast('info', msg, dur),
    warning: (msg, dur) => addToast('warning', msg, dur ?? 5000),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.type}${t.exiting ? ' toast-exit' : ''}`}
            onClick={() => removeToast(t.id)}
          >
            <span className="toast-icon">{ICONS[t.type]}</span>
            <span className="toast-message">{t.message}</span>
            <button className="toast-close" aria-label="Dismiss">
              {Icons.x}
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
