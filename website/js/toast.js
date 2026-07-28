/**
 * Toast Notification System
 * Modern, accessible toast notifications to replace alert()
 */

class ToastSystem {
  constructor() {
    this.container = null;
    this.toasts = [];
    this.maxToasts = 5;
    this.defaultDuration = 5000;
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  init() {
    // Try to use existing container, or create one
    this.container = document.getElementById('toastContainer');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      this.container.id = 'toastContainer';
      document.body.appendChild(this.container);
    }
  }

  /**
   * Show a toast notification
   * @param {string} message - The message to display
   * @param {string} type - 'success', 'error', 'warning', or 'info'
   * @param {number} duration - Auto-dismiss duration in ms (0 for no auto-dismiss)
   */
  show(message, type = 'info', duration = this.defaultDuration) {
    if (!this.container) {
      this.init();
    }

    // Remove oldest toast if max limit reached
    if (this.toasts.length >= this.maxToasts) {
      this.dismiss(this.toasts[0].element);
    }

    const toast = this.createToast(message, type, duration);
    this.container.appendChild(toast);
    
    // Force reflow for animation
    toast.offsetHeight;
    
    // Show toast
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // Add to tracking
    const toastData = {
      element: toast,
      timeout: null,
      type: type
    };
    this.toasts.push(toastData);

    // Auto-dismiss if duration > 0
    if (duration > 0) {
      toastData.timeout = setTimeout(() => {
        this.dismiss(toast);
      }, duration);
    }

    return toast;
  }

  createToast(message, type, duration) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');

    const icon = this.getIcon(type);
    
    toast.innerHTML = `
      <div class="toast-content">
        <div class="toast-icon">${icon}</div>
        <div class="toast-message">${this.escapeHtml(message)}</div>
        <button class="toast-close" aria-label="Close" onclick="window.toastSystem.dismiss(this.closest('.toast'))">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      ${duration > 0 ? '<div class="toast-progress" style="animation-duration: ' + duration + 'ms"></div>' : ''}
    `;

    return toast;
  }

  getIcon(type) {
    const icons = {
      success: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>`,
      error: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>`,
      warning: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>`,
      info: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>`
    };
    return icons[type] || icons.info;
  }

  dismiss(toast) {
    if (!toast) return;

    // Find and remove from tracking
    const index = this.toasts.findIndex(t => t.element === toast);
    if (index > -1) {
      clearTimeout(this.toasts[index].timeout);
      this.toasts.splice(index, 1);
    }

    // Hide animation
    toast.classList.remove('show');
    toast.classList.add('hide');

    // Remove from DOM after animation
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  dismissAll() {
    const toastsToRemove = [...this.toasts];
    toastsToRemove.forEach(toastData => {
      this.dismiss(toastData.element);
    });
  }

  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Convenience methods
  success(message, duration) {
    return this.show(message, 'success', duration);
  }

  error(message, duration) {
    return this.show(message, 'error', duration);
  }

  warning(message, duration) {
    return this.show(message, 'warning', duration);
  }

  info(message, duration) {
    return this.show(message, 'info', duration);
  }
}

// Initialize globally
// Initialize toast system when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.toastSystem = new ToastSystem();
  });
} else {
  window.toastSystem = new ToastSystem();
}

// Global convenience functions for backward compatibility
window.showToast = (message, type, duration) => window.toastSystem.show(message, type, duration);
window.showSuccess = (message, duration) => window.toastSystem.success(message, duration);
window.showError = (message, duration) => window.toastSystem.error(message, duration);
window.showWarning = (message, duration) => window.toastSystem.warning(message, duration);
window.showInfo = (message, duration) => window.toastSystem.info(message, duration);

// Replace alert with non-blocking toast notification
if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
  window.alert = function(message) {
    if (window.toastSystem) {
      window.toastSystem.warning(message, 6000);
    }
  };
}