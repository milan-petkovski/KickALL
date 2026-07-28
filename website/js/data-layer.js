/**
 * KickALL Data Layer - World-Class GA4 & GTM Implementation
 * GDPR Compliant with Consent Mode v2
 * 
 * @version 2.0.0
 * @author KickALL Analytics Team
 * @license MIT
 */

(function(window) {
  'use strict';

  // ============================================
  // DATA LAYER INITIALIZATION
  // ============================================
  
  window.dataLayer = window.dataLayer || [];
  
  // ============================================
  // CONSENT MODE V2 - GDPR COMPLIANT
  // ============================================
  
  const ConsentState = {
    GRANTED: 'granted',
    DENIED: 'denied'
  };
  
  const ConsentCategories = {
    AD_STORAGE: 'ad_storage',
    ANALYTICS_STORAGE: 'analytics_storage',
    AD_USER_DATA: 'ad_user_data',
    AD_PERSONALIZATION: 'ad_personalization'
  };
  
  /**
   * Initialize Consent Mode v2 with default DENIED state (GDPR compliant)
   */
  function initConsentMode() {
    // Check for existing consent in localStorage
    const savedConsent = localStorage.getItem('kickall_consent');
    
    if (savedConsent) {
      try {
        const consentData = JSON.parse(savedConsent);
        updateConsent(consentData);
      } catch (e) {
        console.warn('Invalid consent data in localStorage, using default denied');
        setDefaultConsent();
      }
    } else {
      // GDPR compliance: default to denied until user consent
      setDefaultConsent();
    }
  }
  
  /**
   * Set default consent state to DENIED (GDPR compliant)
   */
  function setDefaultConsent() {
    const defaultConsent = {
      [ConsentCategories.AD_STORAGE]: ConsentState.DENIED,
      [ConsentCategories.ANALYTICS_STORAGE]: ConsentState.DENIED,
      [ConsentCategories.AD_USER_DATA]: ConsentState.DENIED,
      [ConsentCategories.AD_PERSONALIZATION]: ConsentState.DENIED
    };
    
    window.dataLayer.push({
      event: 'default_consent',
      ...defaultConsent
    });
    
    // Also push to gtag if available
    if (typeof gtag !== 'undefined') {
      gtag('consent', 'default', defaultConsent);
    }
  }
  
  /**
   * Update consent state based on user choice
   */
  function updateConsent(consentData) {
    const consentUpdate = {
      [ConsentCategories.AD_STORAGE]: consentData.adStorage || ConsentState.DENIED,
      [ConsentCategories.ANALYTICS_STORAGE]: consentData.analyticsStorage || ConsentState.DENIED,
      [ConsentCategories.AD_USER_DATA]: consentData.adUserData || ConsentState.DENIED,
      [ConsentCategories.AD_PERSONALIZATION]: consentData.adPersonalization || ConsentState.DENIED
    };
    
    window.dataLayer.push({
      event: 'consent_update',
      ...consentUpdate
    });
    
    // Also update gtag if available
    if (typeof gtag !== 'undefined') {
      gtag('consent', 'update', consentUpdate);
    }
    
    // Save to localStorage
    localStorage.setItem('kickall_consent', JSON.stringify(consentData));
  }
  
  /**
   * Grant all consent (accept all)
   */
  function grantAllConsent() {
    const consentData = {
      adStorage: ConsentState.GRANTED,
      analyticsStorage: ConsentState.GRANTED,
      adUserData: ConsentState.GRANTED,
      adPersonalization: ConsentState.GRANTED
    };
    updateConsent(consentData);
  }
  
  /**
   * Deny all consent (reject all)
   */
  function denyAllConsent() {
    const consentData = {
      adStorage: ConsentState.DENIED,
      analyticsStorage: ConsentState.DENIED,
      adUserData: ConsentState.DENIED,
      adPersonalization: ConsentState.DENIED
    };
    updateConsent(consentData);
  }
  
  /**
   * Grant only essential consent (analytics only, no ads)
   */
  function grantEssentialConsent() {
    const consentData = {
      adStorage: ConsentState.DENIED,
      analyticsStorage: ConsentState.GRANTED,
      adUserData: ConsentState.DENIED,
      adPersonalization: ConsentState.DENIED
    };
    updateConsent(consentData);
  }
  
  // ============================================
  // DATA LAYER PUSH HELPER
  // ============================================
  
  /**
   * Type-safe Data Layer push
   */
  function pushToDataLayer(data) {
    if (!data || typeof data !== 'object') {
      console.warn('Invalid data provided to Data Layer');
      return;
    }
    
    // Add timestamp if not present
    if (!data.timestamp) {
      data.timestamp = new Date().toISOString();
    }
    
    // Add page context if not present
    if (!data.page_location) {
      data.page_location = window.location.href;
    }
    
    if (!data.page_path) {
      data.page_path = window.location.pathname;
    }
    
    window.dataLayer.push(data);
  }
  
  // ============================================
  // STANDARD GA4 EVENTS (snake_case)
  // ============================================
  
  /**
   * Track page view
   */
  function trackPageView(pageData = {}) {
    const data = {
      event: 'page_view',
      page_title: pageData.page_title || document.title,
      page_location: pageData.page_location || window.location.href,
      page_path: pageData.page_path || window.location.pathname,
      ...pageData
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track user engagement
   */
  function trackEngagement(eventName, params = {}) {
    const data = {
      event: eventName,
      engagement_type: params.engagement_type || 'unknown',
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track search
   */
  function trackSearch(searchTerm, params = {}) {
    const data = {
      event: 'search',
      search_term: searchTerm,
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track sign up
   */
  function trackSignUp(params = {}) {
    const data = {
      event: 'sign_up',
      method: params.method || 'unknown',
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track login
   */
  function trackLogin(params = {}) {
    const data = {
      event: 'login',
      method: params.method || 'unknown',
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track logout
   */
  function trackLogout(params = {}) {
    const data = {
      event: 'logout',
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track generate lead
   */
  function trackGenerateLead(params = {}) {
    const data = {
      event: 'generate_lead',
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track add to cart
   */
  function trackAddToCart(params = {}) {
    const data = {
      event: 'add_to_cart',
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track begin checkout
   */
  function trackBeginCheckout(params = {}) {
    const data = {
      event: 'begin_checkout',
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track purchase
   */
  function trackPurchase(params = {}) {
    const data = {
      event: 'purchase',
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track select content
   */
  function trackSelectContent(params = {}) {
    const data = {
      event: 'select_content',
      content_type: params.content_type || 'unknown',
      item_id: params.item_id || null,
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track share
   */
  function trackShare(params = {}) {
    const data = {
      event: 'share',
      content_type: params.content_type || 'unknown',
      method: params.method || 'unknown',
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track click
   */
  function trackClick(params = {}) {
    const data = {
      event: 'click',
      link_text: params.link_text || '',
      link_url: params.link_url || '',
      ...params
    };
    pushToDataLayer(data);
  }
  
  // ============================================
  // KICKALL CUSTOM EVENTS
  // ============================================
  
  /**
   * Track module access
   */
  function trackModuleAccess(moduleName, params = {}) {
    const data = {
      event: 'module_access',
      module_name: moduleName,
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track bot activation
   */
  function trackBotActivation(params = {}) {
    const data = {
      event: 'bot_activation',
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track bot deactivation
   */
  function trackBotDeactivation(params = {}) {
    const data = {
      event: 'bot_deactivation',
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track command usage
   */
  function trackCommandUsage(commandName, params = {}) {
    const data = {
      event: 'command_usage',
      command_name: commandName,
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track giveaway creation
   */
  function trackGiveawayCreation(params = {}) {
    const data = {
      event: 'giveaway_creation',
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track leaderboard interaction
   */
  function trackLeaderboardInteraction(params = {}) {
    const data = {
      event: 'leaderboard_interaction',
      ...params
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track language change
   */
  function trackLanguageChange(oldLang, newLang) {
    const data = {
      event: 'language_change',
      old_language: oldLang,
      new_language: newLang
    };
    pushToDataLayer(data);
  }
  
  /**
   * Track error
   */
  function trackError(errorType, errorData) {
    const data = {
      event: 'error',
      error_type: errorType,
      error_message: errorData.message || 'Unknown error',
      error_file: errorData.filename || '',
      error_line: errorData.lineno || 0,
      ...errorData
    };
    pushToDataLayer(data);
  }
  
  // ============================================
  // USER PROPERTIES
  // ============================================
  
  /**
   * Set user properties
   */
  function setUserProperties(properties) {
    const data = {
      event: 'user_properties_set',
      user_properties: properties
    };
    pushToDataLayer(data);
    
    // Also set via gtag if available
    if (typeof gtag !== 'undefined') {
      gtag('set', 'user_properties', properties);
    }
  }
  
  /**
   * Set user ID
   */
  function setUserId(userId) {
    const data = {
      event: 'user_id_set',
      user_id: userId
    };
    pushToDataLayer(data);
    
    // Also set via gtag if available
    if (typeof gtag !== 'undefined') {
      gtag('set', 'user_id', userId);
    }
  }
  
  // ============================================
  // E-COMMERCE ITEMS
  // ============================================
  
  /**
   * Create item object for e-commerce events
   */
  function createItem(itemData) {
    return {
      item_id: itemData.item_id || '',
      item_name: itemData.item_name || '',
      affiliation: itemData.affiliation || '',
      coupon: itemData.coupon || '',
      currency: itemData.currency || 'USD',
      discount: itemData.discount || 0,
      index: itemData.index || 0,
      item_brand: itemData.item_brand || '',
      item_category: itemData.item_category || '',
      item_category2: itemData.item_category2 || '',
      item_category3: itemData.item_category3 || '',
      item_category4: itemData.item_category4 || '',
      item_category5: itemData.item_category5 || '',
      item_list_id: itemData.item_list_id || '',
      item_list_name: itemData.item_list_name || '',
      item_variant: itemData.item_variant || '',
      location_id: itemData.location_id || '',
      price: itemData.price || 0,
      quantity: itemData.quantity || 1
    };
  }
  
  // ============================================
  // PUBLIC API
  // ============================================
  
  window.KickALLDataLayer = {
    // Consent Management
    initConsentMode,
    updateConsent,
    grantAllConsent,
    denyAllConsent,
    grantEssentialConsent,
    ConsentState,
    ConsentCategories,
    
    // Data Layer Push
    push: pushToDataLayer,
    
    // Standard GA4 Events
    trackPageView,
    trackEngagement,
    trackSearch,
    trackSignUp,
    trackLogin,
    trackLogout,
    trackGenerateLead,
    trackAddToCart,
    trackBeginCheckout,
    trackPurchase,
    trackSelectContent,
    trackShare,
    trackClick,
    
    // Custom Events
    trackModuleAccess,
    trackBotActivation,
    trackBotDeactivation,
    trackCommandUsage,
    trackGiveawayCreation,
    trackLeaderboardInteraction,
    trackLanguageChange,
    trackError,
    
    // User Properties
    setUserProperties,
    setUserId,
    
    // E-commerce
    createItem
  };
  
  // Auto-initialize consent mode
  initConsentMode();
  
})(window);