/* ═══════════════════════════════════════════════════════════
   Kickot - Dynamic Configuration
   Uses KickAll CONFIG for shared settings + Kickot-specific paths
   ═══════════════════════════════════════════════════════════ */

(function() {
    'use strict';

    // Environment Detection
    const isLocalhost = window.location.hostname === 'localhost' || 
                        window.location.hostname === '127.0.0.1' ||
                        window.location.hostname === '0.0.0.0';

    const isDevelopment = isLocalhost || 
                          window.location.hostname.includes('dev') ||
                          window.location.hostname.includes('staging');

    const isProduction = !isDevelopment;

    // Dynamic Base URLs
    const BASE_URL = window.location.origin;
    const CURRENT_PATH = window.location.pathname;

    // Path Configuration - Kickot-specific
    const PATH_CONFIG = {
        get parentPath() {
            const pathParts = CURRENT_PATH.split('/').filter(part => part);
            if (pathParts.length > 0 && pathParts[0] === 'kickot') {
                return '/kickot';
            }
            return '';
        },
        get parentUrl() {
            return BASE_URL + this.parentPath;
        },
        get dashboardUrl() {
            return `${this.parentUrl}/dashboard.html`;
        },
        get indexUrl() {
            return `${this.parentUrl}/index.html`;
        }
    };

    // Expose configuration globally - Uses KickAll CONFIG + Kickot paths
    window.KickotConfig = {
        // Environment flags
        isLocalhost,
        isDevelopment,
        isProduction,

        // URLs
        BASE_URL,
        CURRENT_PATH,

        // Paths - Kickot-specific
        paths: PATH_CONFIG,

        // API Configuration
        api: {
            get baseUrl() {
                return window.CONFIG ? window.CONFIG.getBackendApiBase() : 'https://kickbot-ihzb.onrender.com';
            },
            get kickOAuthRedirect() {
                if (isLocalhost) {
                    return 'http://localhost:5500/auth/kick/callback/';
                }
                return 'https://kickall.app/auth/kick/callback/';
            },
            
            // CORS-safe fetch wrapper
            async fetchWithCORS(url, options = {}) {
                const backendBase = this.baseUrl;
                
                try {
                    // Try direct fetch first (might work in production)
                    if (!isLocalhost) {
                        const directResponse = await fetch(url, options);
                        if (directResponse.ok) return directResponse;
                    }
                    
                    // Fallback to backend proxy
                    const proxyUrl = `${backendBase}/api/proxy`;
                    const proxyResponse = await fetch(proxyUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            targetUrl: url,
                            method: options.method || 'GET',
                            headers: options.headers || {},
                            body: options.body
                        })
                    });
                    
                    if (proxyResponse.ok) {
                        return proxyResponse;
                    }
                    
                    throw new Error('Proxy request failed');
                } catch (error) {
                    console.error('CORS fetch error:', error);
                    throw error;
                }
            }
        },

        // Helper functions - Kickot-specific
        getApiUrl(endpoint) {
            const baseUrl = window.CONFIG ? window.CONFIG.getBackendApiBase() : 'https://kickbot-ihzb.onrender.com';
            return `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
        },

        getAssetPath(asset) {
            return `${this.paths.parentPath}/assets/${asset}`;
        },

        getLocalePath(locale) {
            return `${this.paths.parentPath}/locales/${locale}.json`;
        },

        // KickAll CONFIG fallback - for compatibility
        get CONFIG() {
            return window.CONFIG || null;
        },

        // KickAll storage keys fallback - for compatibility
        get STORAGE_KEYS() {
            return window.CONFIG ? window.CONFIG.STORAGE_KEYS : null;
        },

        // KickAll OAuth fallback - for compatibility
        get OAUTH() {
            return window.CONFIG ? window.CONFIG.OAUTH : null;
        },

        // KickAll Supabase fallback - for compatibility
        get SUPABASE() {
            return window.CONFIG ? window.CONFIG.SUPABASE : null;
        }
    };
})();