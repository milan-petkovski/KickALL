/**
 * Global Auth Handler - Include on all pages
 * This script handles OAuth callbacks and login initiation across all pages
 * Works on both localhost:5500 and kickall.app
 */

(function() {
    'use strict';
    
    document.addEventListener('DOMContentLoaded', function() {
        // Skip processing if explicitly disabled (e.g., on callback page)
        if (window.DISABLE_GLOBAL_AUTH) {
            console.log('Global auth handler disabled on this page');
            return;
        }
        
        // Only process if KickAuth is available
        if (!window.KickAuth) {
            console.warn('KickAuth not loaded - global auth handler disabled');
            return;
        }
        
        // Handle OAuth callback if present in URL
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');
        const error = params.get('error');
        
        if (error) {
            // Handle OAuth error
            console.error('OAuth error:', error);
            if (error === 'invalid_redirect_uri') {
                alert('OAuth Error: Invalid redirect URI.\n\nFor localhost development, add your localhost URL to Kick OAuth app redirect URIs.\n\nExample: http://localhost:5500/auth/kick/callback/');
            } else {
                alert('OAuth Error: ' + error);
            }
            window.history.replaceState({}, document.title, window.location.pathname);
            return;
        }
        
        if (code && state) {
            // This is an OAuth callback - let KickAuth handle it
            const isCallback = KickAuth.handleCallback();
            if (isCallback) {
                // OAuth callback is being handled, don't continue with page init
                console.log('OAuth callback handled by global auth system');
                return;
            }
        }
        
        // Update login buttons to use global auth system
        updateLoginButtons();
        
        // Update user interface based on auth state
        updateAuthUI();
    });
    
    function updateLoginButtons() {
        // Find all Kick login buttons and update them to use global auth
        const kickLoginButtons = document.querySelectorAll('[data-kick-login], .kick-login-btn, #authKickLoginBtn, #ctaKickLoginBtn');
        
        kickLoginButtons.forEach(button => {
            // Remove old event listeners by cloning
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);
            
            // Add new event listener using global auth
            newButton.addEventListener('click', function(e) {
                e.preventDefault();
                
                // Add loading state
                newButton.classList.add('loading');
                const btnText = newButton.querySelector('span') || newButton;
                const originalText = btnText.textContent;
                btnText.textContent = 'Preusmeravanje...';
                
                // Small delay to show loading state
                setTimeout(() => {
                    // Determine redirect page based on current location
                    let redirectPage = '/Website/dashboard.html';
                    if (window.location.pathname.includes('/kickot/')) {
                        redirectPage = '/Website/kickot/dashboard.html';
                    }

                    // Use global auth system
                    if (window.KickAuth) {
                        KickAuth.initiateOAuth(redirectPage);
                    } else {
                        console.error('KickAuth not available');
                        btnText.textContent = originalText;
                        newButton.classList.remove('loading');
                        alert('Auth sistem nije dostupan. Molimo osvežite stranicu.');
                    }
                }, 500);
            });
        });
    }
    
    function updateAuthUI() {
        // Show/hide elements based on auth state
        const isLoggedIn = KickAuth.isLoggedIn();
        
        // Show user menu if logged in
        const userMenu = document.getElementById('userMenu');
        const guestNav = document.getElementById('guestNav');
        const navBtnLogin = document.getElementById('navBtnLogin');
        
        if (isLoggedIn) {
            if (userMenu) userMenu.style.display = 'block';
            if (guestNav) guestNav.style.display = 'none';
            if (navBtnLogin) navBtnLogin.style.display = 'none';
        } else {
            if (userMenu) userMenu.style.display = 'none';
            if (guestNav) guestNav.style.display = 'block';
            if (navBtnLogin) navBtnLogin.style.display = 'block';
        }
        
        // Update logout buttons to use global auth
        const logoutButtons = document.querySelectorAll('[data-logout], .logout-btn, #btnLogout');
        logoutButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                if (window.KickAuth) {
                    KickAuth.logout();
                    window.location.href = '/Website/index.html';
                }
            });
        });
    }
    
    // Export functions for use in other scripts
    window.GlobalAuth = {
        updateLoginButtons: updateLoginButtons,
        updateAuthUI: updateAuthUI,
        isLoggedIn: function() {
            return window.KickAuth ? KickAuth.isLoggedIn() : false;
        }
    };
    
})();