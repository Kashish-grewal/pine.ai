import axios from 'axios';
import { authStore } from '../store/authStore';

// ================================================================
// API CLIENT
// ================================================================
// Single axios instance used across the entire app.
// Automatically attaches the stored access token to every request.
// ================================================================

const resolvedBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || '/api/v1';
const fallbackBaseUrl = import.meta.env.VITE_API_FALLBACK_BASE_URL?.trim() || 'http://localhost:5001/api/v1';

const isLocalDevHost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const getAltDevBaseUrl = (baseURL) => {
  if (!baseURL) return fallbackBaseUrl;
  if (baseURL.startsWith('/')) return fallbackBaseUrl;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api\/v1\/?$/i.test(baseURL)) return '/api/v1';
  return null;
};

const api = axios.create({
  baseURL: resolvedBaseUrl,
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
    // In local development, browsers can fail requests at network/CORS/proxy level
    // with no HTTP response object. Retry once with the alternate base URL mode.
    if (!err.response && import.meta.env.DEV && isLocalDevHost && err.config && !err.config.__retriedWithAltBaseUrl) {
      const currentBase = err.config.baseURL || resolvedBaseUrl;
      const altBase = getAltDevBaseUrl(currentBase);

      if (altBase && altBase !== currentBase) {
        return api.request({
          ...err.config,
          baseURL: altBase,
          __retriedWithAltBaseUrl: true,
        });
      }
    }

    if (err.response?.status === 401) {
      authStore.clear();
      window.location.href = '/';
    }
    return Promise.reject(err);
  }
);

export default api;
