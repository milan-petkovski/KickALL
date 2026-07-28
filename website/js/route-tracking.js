/**
 * KickALL Route Tracking - Global Page View Tracking
 * Handles page view tracking for multi-page navigation
 * 
 * @version 1.0.0
 * @author KickALL Analytics Team
 */

(function(window) {
  'use strict';

  /**
   * Initialize route tracking
   */
  function initRouteTracking() {
    // Track initial page view
    trackPageView();
    
    // Track navigation events (for SPA-like behavior within pages)
    trackNavigationChanges();
    
    // Track back/forward button navigation
    trackHistoryNavigation();
  }
  
  /**
   * Track page view with full context
   */
  function trackPageView() {
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.trackPageView({
        page_title: document.title,
        page_location: window.location.href,
        page_path: window.location.pathname,
        page_referrer: document.referrer || '',
        page_search: window.location.search || ''
      });
    }
  }
  
  /**
   * Track navigation changes (hash changes, query params)
   */
  function trackNavigationChanges() {
    // Track hash changes (for single-page sections)
    window.addEventListener('hashchange', () => {
      if (window.KickALLDataLayer) {
        window.KickALLDataLayer.trackPageView({
          page_title: document.title,
          page_location: window.location.href,
          page_path: window.location.pathname,
          page_hash: window.location.hash,
          navigation_type: 'hash_change'
        });
      }
    });
    
    // Track custom navigation events (for tab switching, etc.)
    document.addEventListener('navigation', (event) => {
      if (event.detail && window.KickALLDataLayer) {
        window.KickALLDataLayer.trackPageView({
          page_title: event.detail.title || document.title,
          page_path: event.detail.path || window.location.pathname,
          navigation_type: 'custom_navigation',
          navigation_detail: event.detail.detail || ''
        });
      }
    });
  }
  
  /**
   * Track history navigation (back/forward buttons)
   */
  function trackHistoryNavigation() {
    window.addEventListener('pageshow', (event) => {
      // Check if page is being loaded from cache (back/forward navigation)
      if (event.persisted) {
        if (window.KickALLDataLayer) {
          window.KickALLDataLayer.trackPageView({
            page_title: document.title,
            page_location: window.location.href,
            page_path: window.location.pathname,
            navigation_type: 'back_forward'
          });
        }
      }
    });
  }
  
  /**
   * Track outbound links
   */
  function trackOutboundLinks() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest('a');
      if (!target) return;
      
      const href = target.getAttribute('href');
      if (!href) return;
      
      // Check if it's an external link
      const isExternal = 
        href.startsWith('http') && 
        !href.includes(window.location.hostname);
      
      if (isExternal && window.KickALLDataLayer) {
        window.KickALLDataLayer.trackClick({
          link_url: href,
          link_text: target.textContent?.trim().substring(0, 50) || '',
          link_type: 'outbound',
          outbound_destination: href
        });
      }
    });
  }
  
  /**
   * Track file downloads
   */
  function trackFileDownloads() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest('a');
      if (!target) return;
      
      const href = target.getAttribute('href');
      if (!href) return;
      
      // Check if it's a file download
      const fileExtensions = ['.pdf', '.zip', '.rar', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'];
      const isFileDownload = fileExtensions.some(ext => href.toLowerCase().endsWith(ext));
      
      if (isFileDownload && window.KickALLDataLayer) {
        window.KickALLDataLayer.trackClick({
          link_url: href,
          link_text: target.textContent?.trim().substring(0, 50) || '',
          link_type: 'file_download',
          file_name: href.split('/').pop(),
          file_extension: fileExtensions.find(ext => href.toLowerCase().endsWith(ext))
        });
      }
    });
  }
  
  /**
   * Track email links
   */
  function trackEmailLinks() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest('a');
      if (!target) return;
      
      const href = target.getAttribute('href');
      if (!href) return;
      
      // Check if it's an email link
      if (href.startsWith('mailto:') && window.KickALLDataLayer) {
        window.KickALLDataLayer.trackClick({
          link_url: href,
          link_text: target.textContent?.trim().substring(0, 50) || '',
          link_type: 'email',
          email_address: href.replace('mailto:', '')
        });
      }
    });
  }
  
  /**
   * Track telephone links
   */
  function trackTelephoneLinks() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest('a');
      if (!target) return;
      
      const href = target.getAttribute('href');
      if (!href) return;
      
      // Check if it's a telephone link
      if (href.startsWith('tel:') && window.KickALLDataLayer) {
        window.KickALLDataLayer.trackClick({
          link_url: href,
          link_text: target.textContent?.trim().substring(0, 50) || '',
          link_type: 'telephone',
          phone_number: href.replace('tel:', '')
        });
      }
    });
  }
  
  // Initialize all tracking
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initRouteTracking();
      trackOutboundLinks();
      trackFileDownloads();
      trackEmailLinks();
      trackTelephoneLinks();
    });
  } else {
    initRouteTracking();
    trackOutboundLinks();
    trackFileDownloads();
    trackEmailLinks();
    trackTelephoneLinks();
  }
  
  // Expose to global scope
  window.KickALLRouteTracking = {
    trackPageView,
    trackNavigationChanges,
    trackHistoryNavigation
  };
  
})(window);