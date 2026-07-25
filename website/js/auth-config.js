/**
 * Global OAuth Configuration for KickALL
 * This file provides centralized OAuth settings for all pages
 * Works on both localhost:5500 and kickall.app
 */

(function(window) {
    'use strict';

    const AuthConfig = {
        // Kick OAuth Configuration
        KICK_CLIENT_ID: '01KXN4YW8GF6DPXSC1JMMJ25QN',
        KICK_SCOPE: 'user:read channel:read chat:read chat:write moderation:read moderation:write',
        
        // Dynamic environment detection
        isLocalhost: function() {
            return window.location.hostname === 'localhost' || 
                   window.location.hostname === '127.0.0.1';
        },
        
        // Get the appropriate redirect URI based on current page
        getRedirectUri: function() {
            // Match exact format from Kick Dashboard (with trailing slash)
            // Use /Website/ path since site is served from there and it's in Kick OAuth app
            if (this.isLocalhost()) {
                return 'http://localhost:5500/Website/auth/kick/callback/';
            }
            return 'https://kickall.app/auth/kick/callback/';
        },
        
        // Get the API base URL for token exchange
        getApiBase: function() {
            // For localhost, use Render backend
            if (this.isLocalhost()) {
                return 'https://kickbot-ihzb.onrender.com';
            }
            // For production, use origin (with Netlify redirects)
            return window.location.origin;
        },
        
        // Generate PKCE code challenge
        generateCodeChallenge: function(codeVerifier) {
            return crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
                .then(buffer => {
                    const hash = Array.from(new Uint8Array(buffer))
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join('');
                    return btoa(hash).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                });
        },
        
        // Generate random state for CSRF protection
        generateState: function() {
            return Array.from(crypto.getRandomValues(new Uint8Array(32)))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
        },
        
        // Generate PKCE code verifier
        generateCodeVerifier: function() {
            return Array.from(crypto.getRandomValues(new Uint8Array(32)))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
        },
        
        // Storage keys (consistent across all pages)
        STORAGE_KEYS: {
            ACCESS_TOKEN: 'kick_access_token',
            TOKEN_TYPE: 'kick_token_type',
            SESSION_ACTIVE: 'kick_session_active',
            OAUTH_STATE: 'kick_oauth_state',
            CODE_VERIFIER: 'kick_code_verifier',
            REDIRECT_PAGE: 'kick_redirect_page' // Stores which page to redirect after auth
        },
        
        // Store OAuth data with fallback to localStorage
        storeOAuthData: function(key, value, useSession = false) {
            try {
                if (useSession) {
                    sessionStorage.setItem(key, value);
                }
                localStorage.setItem(key, value);
            } catch (e) {
                console.warn('Storage not available:', e);
            }
        },
        
        // Get OAuth data with session storage fallback
        getOAuthData: function(key) {
            try {
                return sessionStorage.getItem(key) || localStorage.getItem(key);
            } catch (e) {
                console.warn('Storage not available:', e);
                return null;
            }
        },
        
        // Clean up OAuth data
        clearOAuthData: function() {
            try {
                const keys = this.STORAGE_KEYS;
                sessionStorage.removeItem(keys.OAUTH_STATE);
                sessionStorage.removeItem(keys.CODE_VERIFIER);
                sessionStorage.removeItem(keys.REDIRECT_PAGE);
                localStorage.removeItem(keys.OAUTH_STATE);
                localStorage.removeItem(keys.CODE_VERIFIER);
                localStorage.removeItem(keys.REDIRECT_PAGE);
            } catch (e) {
                console.warn('Storage cleanup failed:', e);
            }
        },
        
        // Check if user is logged in
        isLoggedIn: function() {
            const token = this.getOAuthData(this.STORAGE_KEYS.ACCESS_TOKEN);
            const sessionActive = this.getOAuthData(this.STORAGE_KEYS.SESSION_ACTIVE);
            return !!(token && sessionActive === 'true');
        },
        
        // Get access token
        getAccessToken: function() {
            return this.getOAuthData(this.STORAGE_KEYS.ACCESS_TOKEN);
        },
        
        // Get token type
        getTokenType: function() {
            return this.getOAuthData(this.STORAGE_KEYS.TOKEN_TYPE) || 'Bearer';
        },
        
        // Logout user
        logout: function() {
            try {
                const keys = this.STORAGE_KEYS;
                sessionStorage.removeItem(keys.ACCESS_TOKEN);
                sessionStorage.removeItem(keys.TOKEN_TYPE);
                sessionStorage.removeItem(keys.SESSION_ACTIVE);
                localStorage.removeItem(keys.ACCESS_TOKEN);
                localStorage.removeItem(keys.TOKEN_TYPE);
                localStorage.removeItem(keys.SESSION_ACTIVE);
                this.clearOAuthData();
            } catch (e) {
                console.warn('Logout cleanup failed:', e);
            }
        },
        
        // Build Kick OAuth authorization URL
        buildAuthUrl: function(codeChallenge, state) {
            const redirectUri = this.getRedirectUri();
            console.log('Authorization redirect URI:', redirectUri);
            const params = new URLSearchParams({
                response_type: 'code',
                client_id: this.KICK_CLIENT_ID,
                redirect_uri: redirectUri,
                scope: this.KICK_SCOPE,
                state: state,
                code_challenge: codeChallenge,
                code_challenge_method: 'S256'
            });
            const authUrl = `https://id.kick.com/oauth/authorize?${params.toString()}`;
            console.log('Full auth URL:', authUrl);
            return authUrl;
        },
        
        // Initiate OAuth flow
        initiateOAuth: function(redirectPage = '/Website/dashboard.html') {
            const self = this;
            
            // Store the page to redirect after successful auth
            this.storeOAuthData(this.STORAGE_KEYS.REDIRECT_PAGE, redirectPage);
            
            // Generate PKCE values
            const codeVerifier = this.generateCodeVerifier();
            const state = this.generateState();
            
            // Store for verification in callback
            this.storeOAuthData(this.STORAGE_KEYS.CODE_VERIFIER, codeVerifier, true);
            this.storeOAuthData(this.STORAGE_KEYS.OAUTH_STATE, state, true);
            
            // Generate code challenge and redirect
            this.generateCodeChallenge(codeVerifier).then(codeChallenge => {
                const authUrl = this.buildAuthUrl(codeChallenge, state);
                window.location.href = authUrl;
            }).catch(error => {
                console.error('Failed to generate code challenge:', error);
                alert('Authentication initialization failed. Please try again.');
            });
        },
        
        // Handle OAuth callback (can be called from any page)
        handleCallback: function() {
            const params = new URLSearchParams(window.location.search);
            const code = params.get('code');
            const state = params.get('state');
            const error = params.get('error');
            
            if (error) {
                console.error('OAuth error:', error);
                if (error === 'invalid_redirect_uri') {
                    alert('OAuth Error: Invalid redirect URI.\n\nFor localhost development, add your localhost URL to Kick OAuth app redirect URIs.\n\nExample: http://localhost:5500/auth/kick/callback/');
                } else {
                    alert('OAuth Error: ' + error);
                }
                this.clearOAuthData();
                window.history.replaceState({}, document.title, window.location.pathname);
                return false;
            }
            
            if (!code || !state) {
                return false; // Not a callback
            }
            
            const savedState = this.getOAuthData(this.STORAGE_KEYS.OAUTH_STATE);
            const codeVerifier = this.getOAuthData(this.STORAGE_KEYS.CODE_VERIFIER);
            
            if (!this.isLocalhost() && (!savedState || savedState !== state)) {
                console.error('OAuth state mismatch');
                alert('Security error: Invalid OAuth state');
                this.clearOAuthData();
                window.history.replaceState({}, document.title, window.location.pathname);
                return false;
            }
            
            if (!codeVerifier) {
                console.error('Code verifier not found');
                alert('Security error: Code verifier missing');
                this.clearOAuthData();
                window.history.replaceState({}, document.title, window.location.pathname);
                return false;
            }
            
            // Exchange code for token
            this.exchangeCodeForToken(code, codeVerifier);
            return true;
        },
        
        // Exchange authorization code for access token
        exchangeCodeForToken: async function(code, codeVerifier) {
            const redirectUri = this.getRedirectUri();
            const apiBase = this.getApiBase();
            
            try {
                const res = await fetch(`${apiBase}/api/kick/exchange`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        code,
                        code_verifier: codeVerifier,
                        redirect_uri: redirectUri
                    }).toString()
                });
                
                if (!res.ok) {
                    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
                    throw new Error(err.detail || err.error || 'Token exchange failed');
                }
                
                const tokenData = await res.json();
                
                if (!tokenData.access_token) {
                    throw new Error('No access token received');
                }
                
                // Store tokens globally
                this.storeOAuthData(this.STORAGE_KEYS.ACCESS_TOKEN, tokenData.access_token);
                this.storeOAuthData(this.STORAGE_KEYS.TOKEN_TYPE, tokenData.token_type || 'Bearer');
                this.storeOAuthData(this.STORAGE_KEYS.SESSION_ACTIVE, 'true');
                
                // Clean up OAuth-specific data
                this.clearOAuthData();
                
                // Get redirect page or default to dashboard
                const redirectPage = this.getOAuthData(this.STORAGE_KEYS.REDIRECT_PAGE) || '/Website/dashboard.html';
                
                // Clean URL and redirect
                window.history.replaceState({}, document.title, window.location.pathname);
                window.location.href = redirectPage;
                
            } catch (error) {
                console.error('Token exchange error:', error);
                alert('Authentication failed: ' + error.message);
                this.clearOAuthData();
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }
    };
    
    // Export to window
    window.KickAuth = AuthConfig;
    
})(typeof window !== 'undefined' ? window : global);