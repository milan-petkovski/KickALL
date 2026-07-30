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

  // Backend API Configuration
  getBackendApiBase: () => {
    return 'https://kickbot-ihzb.onrender.com';
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
  }
};

// Adaptive Keep-Alive Ping for Render free tier (only runs when tab is visible)
if (window.CONFIG.KEEP_ALIVE.ENABLED) {
  let pingTimer = null;
  
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
  pingTimer = setInterval(sendHealthPing, window.CONFIG.KEEP_ALIVE.PING_INTERVAL);

  // Restart ping on tab re-focus
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      sendHealthPing();
    }
  });
}
