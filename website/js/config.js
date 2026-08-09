/**
 * Configuration Constants
 * Centralized configuration for API endpoints, URLs, and environment-specific values
 * This file must be loaded before app.js and dashboard.js
 */

window.CONFIG = {
  // Supabase Configuration
  // NAPOMENA: Ovo je jedini izvor Supabase URL-a za ceo frontend (browser ne moze citati process.env).
  // Supabase URL i ANON_KEY su dizajnirani da budu javni — pristup podacima kontrolise RLS (Row Level Security).
  // Da promenite projekat, izmenite SAMO ovde — kickot/js/ fajlovi citaju odavde preko window.CONFIG.
  SUPABASE: {
    URL: 'https://rcukparptzzyssqdmydt.supabase.co',
    ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjdWtwYXJwdHp6eXNzcWRteWR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0Nzc3NzEsImV4cCI6MjA5OTA1Mzc3MX0.5FLpFchORq6h5O0q5HWWYBiRD6qCPZKGjx3Zo4UhlJc',
    STORAGE_KEY: 'kickbot-supabase-auth'
  },

  // API Endpoints
  API: {
    KICK_API: 'https://kick.com/api/v2',
    KICK_PUBLIC_API: 'https://api.kick.com/public/v1',
    KICK_OAUTH: 'https://id.kick.com/oauth',
    KICK_OAUTH_AUTHORIZE: 'https://id.kick.com/oauth/authorize',
    KICK_USERINFO: 'https://id.kick.com/oauth/userinfo',
    PROXY_ALLORIGINS: 'https://api.allorigins.win/get',
    PROXY_CORSPROXY: 'https://corsproxy.io/?',

    // CORS-safe fetch wrapper
    async fetchWithCORS(url, options = {}) {
      const backendBase = window.CONFIG ? window.CONFIG.getBackendApiBase() : 'https://kickbot-ihzb.onrender.com';

      try {
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

        const errorData = await proxyResponse.json().catch(() => ({ error: 'Proxy request failed' }));
        throw new Error(errorData.error || 'Proxy request failed');
      } catch (error) {
        if (window.toastSystem) {
          window.toastSystem.error('Network error: ' + (error.message || 'Unable to connect to server'));
        }
        throw error;
      }
    }
  },

  // Paddle Billing Configuration
  PADDLE: {
    ENABLED: true,
    ENVIRONMENT: 'production',
    CLIENT_TOKEN: '',
    BILLING_PORTAL_URL: '',
    PRICE_IDS: {
      pro: {
        monthly: '',
        yearly: ''
      },
      elite: {
        monthly: '',
        yearly: ''
      }
    },
    PRICE_TIER_MAP: {
      '': 'free'
    }
  },

  // Backend API Configuration
  getBackendApiBase: () => {
    const isLocalhost = window.location.hostname === 'localhost' || 
                        window.location.hostname === '127.0.0.1' || 
                        window.location.hostname === '0.0.0.0';
    if (isLocalhost && localStorage.getItem('use_local_bot') === 'true') {
      return 'http://localhost:3000';
    }
    if (isLocalhost) {
      return 'https://kickbot-ihzb.onrender.com';
    }
    return window.location.origin;
  },

  // OAuth Configuration
  OAUTH: {
    CLIENT_ID: '01KXN4YW8GF6DPXSC1JMMJ25QN',
    SCOPE: 'user:read channel:read chat:read chat:write moderation:read moderation:write',
    getRedirectUri: () => {
      return `${window.location.origin}/auth/kick/callback/`;
    }
  },

  // Cross-Domain Communication
  CROSS_DOMAIN_DOMAINS: [
    'https://kickall.app',
    'http://localhost:5500'
  ],

  // Timeouts (in milliseconds) - Optimized for Render free tier cold starts
  TIMEOUTS: {
    API_REQUEST: 30000,  // Increased for Render cold starts (up to 30s)
    COMMANDS_LOAD: 30000,
    LEADERBOARD_LOAD: 30000,
    WATCHTIME_LOAD: 30000,
    MARRIAGES_LOAD: 20000,
    LOVE_STATUS_LOAD: 20000,
    BOT_CONFIG_LOAD: 20000,
    BOT_STATUS_LOAD: 20000,
    NOTIFICATIONS_LOAD: 20000,
    CHANGELOGS_LOAD: 20000,
    OAUTH_EXCHANGE: 25000  // Specific timeout for OAuth token exchange
  },

  // LocalStorage Keys
  STORAGE_KEYS: {
    KICK_ACCESS_TOKEN: 'kick_access_token',
    KICK_TOKEN_TYPE: 'kick_token_type',
    KICK_SESSION_ACTIVE: 'kick_session_active',
    KICK_OAUTH_STATE: 'kick_oauth_state',
    KICK_CODE_VERIFIER: 'kick_code_verifier',
    KICKALL_LANG: 'kickall_lang',
    USER_REFERRAL_CODE: 'user_referral_code',
    KICK_ORIGIN_SITE: 'kick_origin_site',
    FROM_KICKALL: 'from_kickall',
    GLOBAL_LOGOUT: 'kickbot_global_logout'
  },

  // Email Configuration
  CONTACT_EMAIL: 'contact@milanwebportal.com',

  // Default Values
  DEFAULTS: {
    VIEWER_NAME: 'Gledalac',
    BOT_NAME: 'kickot',
    COOLDOWN_TIME: 10000, // 10 seconds
    MIN_WITHDRAWAL_AMOUNT: 5, // EUR
    REFERRAL_PERCENTAGE: 20 // 20%
  },

  // UI Configuration
  UI: {
    SPINNER_SIZE: 36,
    SPINNER_BORDER_WIDTH: 3,
    SPINNER_BORDER_COLOR: 'rgba(139, 92, 246, 0.15)',
    SPINNER_TOP_COLOR: '#8B5CF6',
    AUTH_GATE_BG: '#07070D',
    AUTH_GATE_MSG_COLOR: '#9393B5'
  },

  // Optimized keep-alive configuration for Render & Netlify free tiers
  KEEP_ALIVE: {
    // Ping interval set to 10 minutes (prevents sleeping while tab is active without exceeding free hours)
    PING_INTERVAL: 600000,
    HEALTH_ENDPOINT: '/api/health',
    ENABLED: !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1')
  },

  // Resilient Session Retriever for PC Reboots / Network Cold Starts
  getValidSessionWithRetry: async (sbClient, maxRetries = 3, retryDelayMs = 1500) => {
    if (!sbClient || !sbClient.auth) return null;

    const storageKey = window.CONFIG?.SUPABASE?.STORAGE_KEY || 'kickbot-supabase-auth';
    let hasSavedSession = false;
    try {
      const item = localStorage.getItem(storageKey);
      if (item && item.length > 10) {
        hasSavedSession = true;
      }
    } catch (e) { }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { data, error } = await sbClient.auth.getSession();
        if (data?.session?.user) {
          return data.session;
        }

        if (!hasSavedSession && !error) {
          return null;
        }
      } catch (err) {
        console.warn(`[KickAuth] Session check attempt ${attempt}/${maxRetries} failed:`, err);
      }

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
      }
    }

    try {
      const { data } = await sbClient.auth.getSession();
      return data?.session || null;
    } catch (_) {
      return null;
    }
  },

  // Real-time Crosspage / Cross-Tab Session Sync Helper
  setupCrossTabSync: (sbClient, onSessionChange) => {
    try {
      window.addEventListener('storage', async (event) => {
        const storageKey = window.CONFIG?.SUPABASE?.STORAGE_KEY || 'kickbot-supabase-auth';
        const logoutKey = window.CONFIG?.STORAGE_KEYS?.GLOBAL_LOGOUT || 'kickbot_global_logout';

        if (event.key === logoutKey) {
          if (sbClient && sbClient.auth) {
            try { await sbClient.auth.signOut(); } catch (_) { }
          }
          if (typeof onSessionChange === 'function') {
            onSessionChange(null, 'GLOBAL_LOGOUT');
          }
        } else if (event.key === storageKey) {
          const session = await window.CONFIG.getValidSessionWithRetry(sbClient, 2, 800);
          if (typeof onSessionChange === 'function') {
            onSessionChange(session, session ? 'SESSION_UPDATED' : 'SIGNED_OUT');
          }
        }
      });
    } catch (e) {
      console.warn('[KickAuth] Cross-tab listener error:', e);
    }
  },

  initPaddle: () => {
    try {
      const paddleConfig = window.CONFIG?.PADDLE || {};
      const clientToken = String(paddleConfig.CLIENT_TOKEN || '').trim();
      if (!clientToken || !window.Paddle) return false;
      if (window.__PADDLE_INITIALIZED__) return true;

      if (window.Paddle.Environment && typeof window.Paddle.Environment.set === 'function') {
        window.Paddle.Environment.set(String(paddleConfig.ENVIRONMENT || 'production'));
      }

      if (typeof window.Paddle.Initialize === 'function') {
        window.Paddle.Initialize({ token: clientToken });
      } else if (typeof window.Paddle.Setup === 'function') {
        window.Paddle.Setup({ token: clientToken });
      }

      window.__PADDLE_INITIALIZED__ = true;
      return true;
    } catch (error) {
      console.warn('[Paddle] Initialization failed:', error);
      return false;
    }
  }
};

if (document.readyState === 'complete') {
  window.CONFIG.initPaddle();
} else {
  window.addEventListener('load', () => window.CONFIG.initPaddle(), { once: true });
}

// Adaptive Keep-Alive Ping for Render free tier (only runs when tab is visible)
if (window.CONFIG.KEEP_ALIVE.ENABLED) {
  let _pingTimer = null;

  const sendHealthPing = () => {
    if (document.visibilityState === 'visible') {
      fetch(`${window.CONFIG.getBackendApiBase()}${window.CONFIG.KEEP_ALIVE.HEALTH_ENDPOINT}`, {
        method: 'GET',
        cache: 'no-store'
      }).catch(() => {
        // Silent fail - health check is only to maintain container warm state
      });
    }
  };

  // Trigger initial ping if visible
  sendHealthPing();

  // Set periodic ping
  _pingTimer = setInterval(sendHealthPing, window.CONFIG.KEEP_ALIVE.PING_INTERVAL);

  // Restart ping on tab re-focus
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      sendHealthPing();
    }
  });
}
