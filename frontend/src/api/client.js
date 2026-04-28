import axios from 'axios';
import { DEFAULT_API_TIMEOUT_MS, resolveApiBaseUrl } from '../config/appConfig';

export const getApiBaseUrl = () => resolveApiBaseUrl();

const STORAGE_KEYS = {
  accessToken: 'access_token',
  refreshToken: 'refresh_token',
};

const AUTH_ROUTES = {
  login: '/login',
  refreshPrimary: '/accounts/refresh/',
  refreshFallback: '/accounts/token/refresh/',
};

const HTTP_STATUS = {
  unauthorized: 401,
  notFound: 404,
};

// Read value from localStorage safely.
function readStorageValue(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

// Save value in localStorage safely.
function writeStorageValue(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    // Ignore localStorage errors to keep app running.
  }
}

// Remove value from localStorage safely.
function removeStorageValue(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    // Ignore localStorage errors to keep app running.
  }
}

function getAccessToken() {
  return readStorageValue(STORAGE_KEYS.accessToken);
}

function getRefreshToken() {
  return readStorageValue(STORAGE_KEYS.refreshToken);
}

function saveAccessToken(token) {
  if (!token) {
    return;
  }
  writeStorageValue(STORAGE_KEYS.accessToken, token);
}

function clearAuthTokens() {
  removeStorageValue(STORAGE_KEYS.accessToken);
  removeStorageValue(STORAGE_KEYS.refreshToken);
}

function redirectToLogin() {
  if (typeof window !== 'undefined') {
    window.location.href = AUTH_ROUTES.login;
  }
}

function attachAuthorizationHeader(config, token) {
  if (!token) {
    return config;
  }

  if (!config.headers) {
    config.headers = {};
  }

  config.headers.Authorization = `Bearer ${token}`;
  return config;
}

function shouldBypassCache(config) {
  const method = String(config?.method || 'get').toLowerCase();
  if (method !== 'get') return false;
  const url = String(config?.url || '');
  return url.includes('/ingestion/latest-analysis/') || url.includes('/ingestion/upload-analysis/');
}

function getRequestBaseUrl(config) {
  if (config && config._forceBaseURL && config.baseURL) {
    return config.baseURL;
  }
  return resolveApiBaseUrl();
}

function isUnauthorizedError(error, originalRequest) {
  if (!error || !originalRequest) {
    return false;
  }

  const status = error.response?.status;
  const alreadyRetried = Boolean(originalRequest._retry);

  if (status !== HTTP_STATUS.unauthorized) {
    return false;
  }

  if (alreadyRetried) {
    return false;
  }

  return true;
}

async function requestNewAccessToken(baseURL, refreshToken) {
  const primaryUrl = `${baseURL}${AUTH_ROUTES.refreshPrimary}`;
  const fallbackUrl = `${baseURL}${AUTH_ROUTES.refreshFallback}`;

  try {
    return await axios.post(primaryUrl, { refresh: refreshToken });
  } catch (error) {
    const status = error?.response?.status;
    if (status !== HTTP_STATUS.notFound) {
      throw error;
    }

    return await axios.post(fallbackUrl, { refresh: refreshToken });
  }
}

async function tryRefreshAndRetry(originalRequest) {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }

  const baseURL = resolveApiBaseUrl();
  const response = await requestNewAccessToken(baseURL, refreshToken);
  const newAccessToken = response?.data?.access;

  if (!newAccessToken) {
    return null;
  }

  saveAccessToken(newAccessToken);
  api.defaults.headers.common.Authorization = `Bearer ${newAccessToken}`;

  originalRequest.baseURL = baseURL;
  attachAuthorizationHeader(originalRequest, newAccessToken);

  return api(originalRequest);
}

const api = axios.create({
  baseURL: resolveApiBaseUrl(),
  timeout: DEFAULT_API_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add a request interceptor to include the JWT token
api.interceptors.request.use(
  (config) => {
    // Keep base URL synced with runtime configuration.
    config.baseURL = getRequestBaseUrl(config);

    const accessToken = getAccessToken();
    attachAuthorizationHeader(config, accessToken);

    if (shouldBypassCache(config)) {
      config.headers = config.headers || {};
      config.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      config.headers.Pragma = 'no-cache';
      config.headers.Expires = '0';
      config.params = { ...(config.params || {}), _rt: Date.now() };
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Add a response interceptor to handle token refresh or logout on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (!isUnauthorizedError(error, originalRequest)) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      const retriedResponse = await tryRefreshAndRetry(originalRequest);
      if (retriedResponse) {
        return retriedResponse;
      }
    } catch (refreshError) {
      // If refresh fails, user must login again.
    }

    clearAuthTokens();
    redirectToLogin();
    return Promise.reject(error);
  }
);

export default api;
