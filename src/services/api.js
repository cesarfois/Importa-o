import axios from 'axios';

const api = axios.create({
    // Use relative path - Vite proxy will forward /DocuWare/* to the DocuWare server
    baseURL: (import.meta.env.BASE_URL || '/') + 'DocuWare/Platform',
    timeout: 30000,
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }
});

// Add request interceptor to include auth token from session storage
api.interceptors.request.use(
    (config) => {
        const authData = sessionStorage.getItem('docuware_auth');
        let targetUrl = null;

        if (authData) {
            try {
                const parsed = JSON.parse(authData);
                if (parsed.token) {
                    config.headers.Authorization = `Bearer ${parsed.token}`;
                }
                if (parsed.url) {
                    targetUrl = parsed.url;
                }
            } catch (error) {
                console.error('Error parsing auth data:', error);
            }
        }

        // Allow overriding target URL via config (useful for login/discovery)
        if (config.headers['x-target-url']) {
            targetUrl = config.headers['x-target-url'];
        }

        // Apply header if we have a target
        if (targetUrl) {
            config.headers['x-target-url'] = targetUrl;
        }

        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Add response interceptor to handle 401 and session-expired 500 errors
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // Detect both 401 (token expired) and 500 from missing x-target-url (session lost)
        const is401 = error.response?.status === 401;
        const isSessionExpired500 = error.response?.status === 500 &&
            error.response?.data?.error?.includes?.('X-Target-URL');

        if ((is401 || isSessionExpired500) && !originalRequest._retry) {
            originalRequest._retry = true;
            console.warn('[api.js] Session error detected. Attempting token refresh...');
            try {
                // Dynamically import to avoid circular dependency
                const { authService } = await import('./authService.js');
                const newToken = await authService.refreshToken();
                originalRequest.headers['Authorization'] = `Bearer ${newToken}`;

                // Re-read auth data to restore x-target-url (may have been missing)
                const authData = sessionStorage.getItem('docuware_auth');
                if (authData) {
                    try {
                        const parsed = JSON.parse(authData);
                        if (parsed.url) originalRequest.headers['x-target-url'] = parsed.url;
                    } catch (_) { }
                }

                return api(originalRequest);
            } catch (refreshError) {
                console.error('[api.js] Token refresh failed.');
                if (!window.location.pathname.includes('workflow-diagram')) {
                    window.location.href = '/login';
                }
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);

export default api;
