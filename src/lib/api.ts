const getBackendUrl = (): string => {
  const configured = import.meta.env.VITE_BACKEND_URL?.trim();

  if (configured) {
    return configured.replace(/\/$/, '');
  }

  if (import.meta.env.DEV) {
    return 'https://localhost:3001';
  }

  throw new Error(
    'Admin backend URL is not configured. Please set VITE_BACKEND_URL.'
  );
};

export const BACKEND_URL = getBackendUrl();

export const apiFetch = (
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> => {
  const headers = new Headers(options.headers || {});

  // Required when frontend accesses a free ngrok endpoint.
  headers.set('ngrok-skip-browser-warning', 'true');

  return fetch(`${BACKEND_URL}${endpoint}`, {
    ...options,
    headers,
  });
};