// ================================================================
// AUTH STORE
// ================================================================
// Stores the access token and user in localStorage.
// Simple key-value store — no external state library needed.
//
// Security note: for production, move accessToken to memory
// (not localStorage) and use httpOnly cookies for refresh tokens.
// For development / MVP, localStorage is acceptable.
// ================================================================

export const authStore = {
  getToken: () => localStorage.getItem('pine_access_token'),

  getUser: () => {
    const raw = localStorage.getItem('pine_user');
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  },

  set: (accessToken, user) => {
    localStorage.setItem('pine_access_token', accessToken);
    localStorage.setItem('pine_user', JSON.stringify(user));
  },

  clear: () => {
    localStorage.removeItem('pine_access_token');
    localStorage.removeItem('pine_user');
  },

  isLoggedIn: () => !!localStorage.getItem('pine_access_token'),
};
