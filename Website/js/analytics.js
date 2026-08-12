/**
 * KickALL Analytics System - Refactored with Data Layer
 * World-class analytics implementation for 2026 standards
 * Now uses Data Layer instead of direct gtag calls
 * 
 * @version 2.0.0
 * @author KickALL Analytics Team
 */

class KickALLAnalytics {
  constructor() {
    this.pageType = this.detectPageType();
    this.userId = null;
    this.userType = 'guest';
    this.moduleAccess = 'none';
    this.language = 'sr';
    this.sessionType = 'new';
    this.activeModulesCount = 0;
    this.botActiveStatus = 0;
    this.sessionStartTime = Date.now();
    this.init();
  }

  detectPageType() {
    const path = window.location.pathname;
    if (path.includes('/kickot/dashboard')) return 'kickot_dashboard';
    if (path.includes('/kickot/')) return 'kickot_landing';
    if (path.includes('/dashboard')) return 'main_dashboard';
    if (path.includes('/auth/')) return 'auth_page';
    if (path.includes('/privacy') || path.includes('/terms')) return 'legal_page';
    return 'main_landing';
  }

  async init() {
    this.setupUserProperties();
    this.trackPageView();
    this.setupPerformanceTracking();
    this.setupErrorTracking();
    this.setupClickTracking();
    this.setupScrollTracking();
    this.setupVisibilityTracking();
  }

  setupUserProperties() {
    // Get user info from localStorage
    const kickToken = localStorage.getItem('kick_access_token');
    const savedLang = localStorage.getItem('kickall_lang') || 'sr';
    
    this.language = savedLang;
    this.userType = kickToken ? 'authenticated' : 'guest';
    this.sessionType = sessionStorage.getItem('analytics_session_type') || 'new';
    
    if (this.sessionType === 'new') {
      sessionStorage.setItem('analytics_session_type', 'returning');
    }

    // Set Data Layer user properties
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.setUserProperties({
        user_type: this.userType,
        language: this.language,
        page_type: this.pageType,
        session_type: this.sessionType,
        session_start: new Date().toISOString()
      });
    }
  }

  trackPageView() {
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.trackPageView({
        page_title: document.title,
        page_location: window.location.href,
        page_path: window.location.pathname,
        user_type: this.userType,
        module_access: this.moduleAccess,
        language: this.language,
        session_type: this.sessionType
      });
    }
  }

  setupPerformanceTracking() {
    if ('PerformanceObserver' in window) {
      const perfObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'largest-contentful-paint') {
            this.trackPerformanceMetric('lcp', entry.startTime);
          } else if (entry.entryType === 'first-input') {
            this.trackPerformanceMetric('fid', entry.processingStart - entry.startTime);
          } else if (entry.entryType === 'layout-shift') {
            if (!entry.hadRecentInput) {
              this.trackPerformanceMetric('cls', entry.value);
            }
          }
        }
      });
      perfObserver.observe({ entryTypes: ['largest-contentful-paint', 'first-input', 'layout-shift'] });
    }

    // Track page load time
    window.addEventListener('load', () => {
      setTimeout(() => {
        const perfData = performance.timing;
        const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
        this.trackPerformanceMetric('page_load_time', pageLoadTime);
      }, 0);
    });
  }

  setupErrorTracking() {
    window.addEventListener('error', (event) => {
      this.trackError('javascript_error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      this.trackError('promise_rejection', {
        reason: event.reason?.toString() || 'Unknown promise rejection'
      });
    });
  }

  setupClickTracking() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest('button, a, .btn, .nav-link, .card');
      if (!target) return;

      const elementData = this.extractElementData(target);
      this.trackClick(elementData);
    }, true);
  }

  setupScrollTracking() {
    let scrollDepth = 0;
    const maxDepth = [25, 50, 75, 90, 100];

    window.addEventListener('scroll', () => {
      const scrollPercent = Math.round(
        (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100
      );

      maxDepth.forEach(depth => {
        if (scrollPercent >= depth && scrollDepth < depth) {
          scrollDepth = depth;
          this.trackScrollDepth(depth);
        }
      });
    });
  }

  setupVisibilityTracking() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.trackSessionEnd();
      } else {
        this.trackSessionResume();
      }
    });

    window.addEventListener('beforeunload', () => {
      this.trackSessionEnd();
    });
  }

  extractElementData(element) {
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      class: element.className || null,
      text: element.textContent?.trim().substring(0, 50) || null,
      href: element.href || null,
      dataAttributes: this.extractDataAttributes(element)
    };
  }

  extractDataAttributes(element) {
    const data = {};
    for (const attr of element.attributes) {
      if (attr.name.startsWith('data-')) {
        data[attr.name.replace('data-', '')] = attr.value;
      }
    }
    return data;
  }

  // Event Tracking Methods
  trackClick(elementData) {
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.trackClick({
        element_tag: elementData.tag,
        element_id: elementData.id,
        element_class: elementData.class,
        element_text: elementData.text,
        element_href: elementData.href,
        custom_attributes: JSON.stringify(elementData.dataAttributes),
        page_type: this.pageType
      });
    }
  }

  trackScrollDepth(depth) {
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.trackEngagement('scroll', {
        scroll_depth_percent: depth,
        page_type: this.pageType
      });
    }
  }

  trackPerformanceMetric(metricName, value) {
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.push({
        event: 'performance_metric',
        metric_name: metricName,
        metric_value: value,
        page_type: this.pageType
      });
    }
  }

  trackError(errorType, errorData) {
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.trackError(errorType, {
        ...errorData,
        page_type: this.pageType
      });
    }
  }

  trackSessionEnd() {
    if (window.KickALLDataLayer) {
      const sessionDuration = Date.now() - this.sessionStartTime;
      
      window.KickALLDataLayer.push({
        event: 'session_end',
        session_duration_ms: sessionDuration,
        page_type: this.pageType
      });
    }
  }

  trackSessionResume() {
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.push({
        event: 'session_resume',
        page_type: this.pageType
      });
    }
  }

  // Module-specific tracking
  trackModuleAccess(moduleName) {
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.trackModuleAccess(moduleName, {
        user_type: this.userType,
        language: this.language
      });
    }
  }

  trackBotActivation(channelName) {
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.trackBotActivation({
        channel_name: channelName,
        user_type: this.userType
      });
    }
  }

  trackBotDeactivation(channelName) {
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.trackBotDeactivation({
        channel_name: channelName,
        user_type: this.userType
      });
    }
  }

  trackCommandUsage(commandName, channelName) {
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.trackCommandUsage(commandName, {
        channel_name: channelName,
        user_type: this.userType
      });
    }
  }

  trackGiveawayCreation(giveawayType) {
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.trackGiveawayCreation({
        giveaway_type: giveawayType,
        user_type: this.userType
      });
    }
  }

  trackLeaderboardInteraction(action, leaderboardType) {
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.trackLeaderboardInteraction({
        action: action,
        leaderboard_type: leaderboardType,
        user_type: this.userType
      });
    }
  }

  trackLanguageChange(oldLang, newLang) {
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.trackLanguageChange(oldLang, newLang);
    }
  }

  // User management
  setUserId(userId) {
    this.userId = userId;
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.setUserId(userId);
    }
  }

  setUserType(userType) {
    this.userType = userType;
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.setUserProperties({
        user_type: userType
      });
    }
  }

  setModuleAccess(moduleAccess) {
    this.moduleAccess = moduleAccess;
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.setUserProperties({
        module_access: moduleAccess
      });
    }
  }

  setLanguage(language) {
    this.language = language;
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.setUserProperties({
        language: language
      });
    }
  }

  setActiveModulesCount(count) {
    this.activeModulesCount = count;
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.setUserProperties({
        active_modules_count: count
      });
    }
  }

  setBotActiveStatus(status) {
    this.botActiveStatus = status;
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.setUserProperties({
        bot_active_status: status
      });
    }
  }
}

// Initialize analytics on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.KickALLAnalytics = new KickALLAnalytics();
  });
} else {
  window.KickALLAnalytics = new KickALLAnalytics();
}