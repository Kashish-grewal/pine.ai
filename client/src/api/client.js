import axios from 'axios';
import { authStore } from '../store/authStore';

// ================================================================
// API CLIENT
// ================================================================
// Single axios instance used across the entire app.
// Automatically attaches the stored access token to every request.
// ================================================================

const api = axios.create({
  baseURL: 'http://localhost:5001/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

// Attach Bearer token from store before every request
api.interceptors.request.use((config) => {
  const token = authStore.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401 — clear auth and bounce to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      authStore.clear();
      window.location.href = '/';
    }
    return Promise.reject(err);
  }
);

export default api;
