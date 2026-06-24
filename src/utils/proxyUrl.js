/**
 * Get the base URL for the proxy server.
 * - Development / localhost: empty string (relative paths, requests go through Vite's dev proxy)
 * - Production (Docker): same origin (requests go through the Node proxy on the same server)
 * - Production (Netlify): Netlify Functions endpoint
 */
export const getProxyBaseUrl = () => {
    const isDev = import.meta.env.DEV || window.location.hostname === 'localhost';
    if (isDev) return '';
    const isNetlify = window.location.hostname.includes('.netlify.app') || window.location.hostname.includes('.netlify.com');
    if (isNetlify) return window.location.origin + '/.netlify/functions/api';
    return window.location.origin + '/importacao';
};
