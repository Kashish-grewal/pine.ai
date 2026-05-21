import { useEffect, useRef, useCallback, createContext, useContext, useState } from 'react';
import { Icons } from './Icons';

// ================================================================
// CONFIRM DIALOG
// ================================================================
// Replaces browser-native window.confirm() with a premium modal.
// Usage:
//   const confirm = useConfirm();
//   const ok = await confirm({
//     title: 'Delete Recording',
//     message: 'This action cannot be undone.',
//     confirmText: 'Delete',
//     variant: 'danger',
//   });
//   if (ok) { ... }
// ================================================================

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        title: opts.title || 'Are you sure?',
        message: opts.message || '',
        confirmText: opts.confirmText || 'Confirm',
        cancelText: opts.cancelText || 'Cancel',
        variant: opts.variant || 'default', // 'default' | 'danger'
      });
    });
  }, []);

  const handleConfirm = () => {
    resolveRef.current?.(true);
    setState(null);
  };

  const handleCancel = () => {
    resolveRef.current?.(false);
    setState(null);
  };

  // Escape key closes dialog
  useEffect(() => {
    if (!state) return;
    const handler = (e) => {
      if (e.key === 'Escape') handleCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="confirm-overlay" onClick={handleCancel}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-header">
              <div className={`confirm-icon-wrap ${state.variant}`}>
                {state.variant === 'danger' ? Icons.warning : Icons.question}
              </div>
              <h3 className="confirm-title">{state.title}</h3>
            </div>
            {state.message && (
              <p className="confirm-message">{state.message}</p>
            )}
            <div className="confirm-actions">
              <button className="confirm-btn-cancel" onClick={handleCancel}>
                {state.cancelText}
              </button>
              <button
                className={`confirm-btn-ok ${state.variant === 'danger' ? 'danger' : ''}`}
                onClick={handleConfirm}
                autoFocus
              >
                {state.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return ctx;
}
