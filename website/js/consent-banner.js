/**
 * KickALL Consent Banner - GDPR Compliant Cookie Consent
 * Integrates with Data Layer Consent Mode v2
 * 
 * @version 1.0.0
 * @author KickALL Analytics Team
 */

(function(window) {
  'use strict';

  // ============================================
  // CONSENT BANNER UI
  // ============================================
  
  const ConsentBanner = {
    element: null,
    settingsModal: null,
    
    /**
     * Initialize consent banner
     */
    init() {
      // Check if user already made consent decision
      const savedConsent = localStorage.getItem('kickall_consent');
      
      if (!savedConsent) {
        this.showBanner();
      }
      
      this.bindEvents();
      
      // Listen for language changes
      this.setupLanguageChangeListener();
    },
    
    /**
     * Show consent banner
     */
    showBanner() {
      // Remove existing banner if present
      this.removeBanner();
      
      const banner = document.createElement('div');
      banner.id = 'kickall-consent-banner';
      banner.innerHTML = `
        <div class="consent-banner-content">
          <div class="consent-banner-text">
            <h3 data-i18n="title">Privacy & Cookies</h3>
            <p data-i18n="description">We use cookies to enhance your experience and analyze our traffic. By clicking "Accept All", you consent to our use of cookies.</p>
          </div>
          <div class="consent-banner-buttons">
            <button class="consent-btn consent-btn-secondary" id="consent-settings" data-i18n="settings">Settings</button>
            <button class="consent-btn consent-btn-secondary" id="consent-reject" data-i18n="reject">Reject</button>
            <button class="consent-btn consent-btn-primary" id="consent-accept" data-i18n="accept">Accept All</button>
          </div>
        </div>
      `;

      // Apply translations if available
      this.applyTranslations(banner);
      
      // Add styles
      this.injectStyles();
      
      document.body.appendChild(banner);
      this.element = banner;
      
      // Apply translations immediately
      setTimeout(() => {
        this.applyTranslations(banner);
      }, 10);
      
      // Trigger animation
      setTimeout(() => banner.classList.add('visible'), 100);
    },
    
    /**
     * Remove consent banner
     */
    removeBanner() {
      const existing = document.getElementById('kickall-consent-banner');
      if (existing) {
        existing.classList.remove('visible');
        setTimeout(() => existing.remove(), 300);
      }
    },
    
    /**
     * Apply translations to consent banner elements
     */
    applyTranslations(element) {
      const currentLang = document.documentElement.lang || 'sr';
      let consentTranslations = null;
      
      // Check for main translations (KickALL) - direct consent object
      if (window.translations && window.translations.consent) {
        consentTranslations = window.translations.consent;
      }
      // Check for kickot translations structure - nested by language
      else if (window.translations && window.translations[currentLang] && window.translations[currentLang].consent) {
        consentTranslations = window.translations[currentLang].consent;
      }
      // Fallback: check if translations object has language key
      else if (window.translations && window.translations[currentLang]) {
        consentTranslations = window.translations[currentLang].consent;
      }
      
      if (consentTranslations) {
        // Apply translations to elements with data-i18n attribute
        element.querySelectorAll('[data-i18n]').forEach(el => {
          const key = el.getAttribute('data-i18n');
          // Remove 'consent.' prefix if present for nested access
          const cleanKey = key.replace('consent.', '');
          
          if (consentTranslations[cleanKey]) {
            el.textContent = consentTranslations[cleanKey];
          }
        });
      }
    },

    /**
     * Setup language change listener
     */
    setupLanguageChangeListener() {
      // Listen for custom language change events
      document.addEventListener('languageChanged', () => {
        // Update banner if visible
        if (this.element) {
          this.applyTranslations(this.element);
        }
        // Update modal if visible
        if (this.settingsModal) {
          this.applyTranslations(this.settingsModal);
        }
      });
    },

    /**
     * Show settings modal
     */
    showSettingsModal() {
      this.removeSettingsModal();
      
      const modal = document.createElement('div');
      modal.id = 'consent-settings-modal';
      modal.className = 'consent-modal';
      modal.innerHTML = `
        <div class="consent-modal-backdrop"></div>
        <div class="consent-modal-content">
          <div class="consent-modal-header">
            <h3 data-i18n="settingsTitle">Cookie Settings</h3>
            <button class="consent-modal-close" id="consent-modal-close">&times;</button>
          </div>
          <div class="consent-modal-body">
            <div class="consent-option">
              <div class="consent-option-info">
                <h4 data-i18n="essential">Essential Cookies</h4>
                <p data-i18n="essentialDesc">Required for the site to function properly.</p>
              </div>
              <div class="consent-toggle">
                <input type="checkbox" id="consent-essential" checked disabled>
                <label for="consent-essential"></label>
              </div>
            </div>
            <div class="consent-option">
              <div class="consent-option-info">
                <h4 data-i18n="analytics">Analytics Cookies</h4>
                <p data-i18n="analyticsDesc">Help us improve our website by collecting anonymous usage data.</p>
              </div>
              <div class="consent-toggle">
                <input type="checkbox" id="consent-analytics">
                <label for="consent-analytics"></label>
              </div>
            </div>
            <div class="consent-option">
              <div class="consent-option-info">
                <h4 data-i18n="marketing">Marketing Cookies</h4>
                <p data-i18n="marketingDesc">Used to deliver personalized advertisements.</p>
              </div>
              <div class="consent-toggle">
                <input type="checkbox" id="consent-marketing">
                <label for="consent-marketing"></label>
              </div>
            </div>
          </div>
          <div class="consent-modal-footer">
            <button class="consent-btn consent-btn-primary" id="consent-save" data-i18n="save">Save Preferences</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      this.settingsModal = modal;
      
      // Apply translations to modal immediately
      setTimeout(() => {
        this.applyTranslations(modal);
      }, 10);
      
      // Load current consent state
      this.loadCurrentConsent();
      
      // Bind modal events
      this.bindModalEvents();
      
      // Trigger animation
      setTimeout(() => modal.classList.add('visible'), 10);
    },
    
    /**
     * Remove settings modal
     */
    removeSettingsModal() {
      const existing = document.getElementById('consent-settings-modal');
      if (existing) {
        existing.classList.remove('visible');
        setTimeout(() => existing.remove(), 300);
      }
    },
    
    /**
     * Load current consent state into modal
     */
    loadCurrentConsent() {
      const savedConsent = localStorage.getItem('kickall_consent');
      
      if (savedConsent) {
        try {
          const consentData = JSON.parse(savedConsent);
          
          const analyticsCheckbox = document.getElementById('consent-analytics');
          const marketingCheckbox = document.getElementById('consent-marketing');
          
          if (analyticsCheckbox) {
            analyticsCheckbox.checked = consentData.analyticsStorage === 'granted';
          }
          
          if (marketingCheckbox) {
            marketingCheckbox.checked = 
              consentData.adStorage === 'granted' || 
              consentData.adPersonalization === 'granted';
          }
        } catch (e) {
          console.warn('Failed to load consent state:', e);
        }
      }
    },
    
    /**
     * Bind banner events
     */
    bindEvents() {
      document.addEventListener('click', (e) => {
        if (e.target.id === 'consent-accept') {
          this.handleAccept();
        } else if (e.target.id === 'consent-reject') {
          this.handleReject();
        } else if (e.target.id === 'consent-settings') {
          this.showSettingsModal();
        }
      });
    },
    
    /**
     * Bind modal events
     */
    bindModalEvents() {
      const modal = this.settingsModal;
      
      modal.addEventListener('click', (e) => {
        if (e.target.id === 'consent-modal-close' || e.target.classList.contains('consent-modal-backdrop')) {
          this.removeSettingsModal();
        }
      });
      
      modal.addEventListener('click', (e) => {
        if (e.target.id === 'consent-save') {
          this.handleSavePreferences();
        }
      });
    },
    
    /**
     * Handle accept all
     */
    handleAccept() {
      if (window.KickALLDataLayer) {
        window.KickALLDataLayer.grantAllConsent();
      }
      this.removeBanner();
    },
    
    /**
     * Handle reject all
     */
    handleReject() {
      if (window.KickALLDataLayer) {
        window.KickALLDataLayer.denyAllConsent();
      }
      this.removeBanner();
    },
    
    /**
     * Handle save preferences
     */
    handleSavePreferences() {
      const analyticsChecked = document.getElementById('consent-analytics').checked;
      const marketingChecked = document.getElementById('consent-marketing').checked;
      
      if (window.KickALLDataLayer) {
        const consentData = {
          analyticsStorage: analyticsChecked ? 'granted' : 'denied',
          adStorage: marketingChecked ? 'granted' : 'denied',
          adUserData: marketingChecked ? 'granted' : 'denied',
          adPersonalization: marketingChecked ? 'granted' : 'denied'
        };
        
        window.KickALLDataLayer.updateConsent(consentData);
      }
      
      this.removeSettingsModal();
      this.removeBanner();
    },
    
    /**
     * Inject CSS styles
     */
    injectStyles() {
      if (document.getElementById('consent-banner-styles')) return;
      
      const styles = document.createElement('style');
      styles.id = 'consent-banner-styles';
      styles.textContent = `
        #kickall-consent-banner {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(6, 4, 10, 0.95);
          backdrop-filter: blur(10px);
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding: 20px;
          z-index: 90;
          transform: translateY(100%);
          transition: transform 0.3s ease;
          box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3);
        }
        
        #kickall-consent-banner.visible {
          transform: translateY(0);
        }
        
        .consent-banner-content {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
        }
        
        .consent-banner-text h3 {
          color: #fff;
          margin: 0 0 8px 0;
          font-size: 18px;
          font-weight: 600;
        }
        
        .consent-banner-text p {
          color: rgba(255, 255, 255, 0.7);
          margin: 0;
          font-size: 14px;
          line-height: 1.5;
        }
        
        .consent-banner-buttons {
          display: flex;
          gap: 12px;
          flex-shrink: 0;
        }
        
        .consent-btn {
          padding: 10px 20px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .consent-btn-primary {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #fff;
        }
        
        .consent-btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        
        .consent-btn-secondary {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .consent-btn-secondary:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        
        .consent-modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 101;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        
        .consent-modal.visible {
          opacity: 1;
        }
        
        .consent-modal-backdrop {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(4px);
        }
        
        .consent-modal-content {
          position: relative;
          background: #06040A;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          max-width: 500px;
          width: 90%;
          max-height: 90vh;
          overflow-y: auto;
          padding: 24px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }
        
        .consent-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }
        
        .consent-modal-header h3 {
          color: #fff;
          margin: 0;
          font-size: 20px;
          font-weight: 600;
        }
        
        .consent-modal-close {
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.5);
          font-size: 24px;
          cursor: pointer;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          transition: all 0.2s ease;
        }
        
        .consent-modal-close:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }
        
        .consent-option {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          padding: 16px 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .consent-option:last-child {
          border-bottom: none;
        }
        
        .consent-option-info h4 {
          color: #fff;
          margin: 0 0 4px 0;
          font-size: 16px;
          font-weight: 500;
        }
        
        .consent-option-info p {
          color: rgba(255, 255, 255, 0.6);
          margin: 0;
          font-size: 13px;
          line-height: 1.4;
        }
        
        .consent-toggle input[type="checkbox"] {
          display: none;
        }
        
        .consent-toggle label {
          display: block;
          width: 48px;
          height: 24px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          position: relative;
          cursor: pointer;
          transition: background 0.2s ease;
        }
        
        .consent-toggle label::after {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 20px;
          height: 20px;
          background: #fff;
          border-radius: 50%;
          transition: transform 0.2s ease;
        }
        
        .consent-toggle input[type="checkbox"]:checked + label {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        
        .consent-toggle input[type="checkbox"]:checked + label::after {
          transform: translateX(24px);
        }
        
        .consent-toggle input[type="checkbox"]:disabled + label {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .consent-modal-footer {
          margin-top: 24px;
          padding-top: 20px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        @media (max-width: 768px) {
          .consent-banner-content {
            flex-direction: column;
            text-align: center;
          }
          
          .consent-banner-buttons {
            flex-direction: column;
            width: 100%;
          }
          
          .consent-btn {
            width: 100%;
          }
        }
      `;
      
      document.head.appendChild(styles);
    }
  };
  
  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ConsentBanner.init());
  } else {
    ConsentBanner.init();
  }
  
  // Expose to global scope
  window.KickALLConsentBanner = ConsentBanner;
  
})(window);