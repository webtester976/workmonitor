// ======================================================
// BACKEND URL
// ======================================================

const getBackendUrl = (): string => {
  const configured =
    import.meta.env.VITE_BACKEND_URL?.trim();

  // If a custom backend URL is configured, use it.
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  // Cloudflare production:
  // frontend + API are served from the same domain.
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return '';
};

// ======================================================
// EXPORTED BACKEND URL
// ======================================================

export const BACKEND_URL =
  getBackendUrl();

// ======================================================
// API FETCH HELPER
// ======================================================

export const apiFetch = (
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> => {
  const headers =
    new Headers(
      options.headers || {}
    );

  return fetch(
    `${BACKEND_URL}${endpoint}`,
    {
      ...options,
      headers,
    }
  );
};