class ToastSystem {
  constructor() {
    this.container = null;
    this.toasts = [];
    this.maxToasts = 5;
    this.defaultDuration = 5000;
    this.init();
  }

  init() {
    if (this.container) return;
    
    const setupContainer = () => {
      this.container = document.getElementById('toastContainer');
      if (!this.container) {
        this.container = document.createElement('div');
        this.container.className = 'toast-container';
        this.container.id = 'toastContainer';
        document.body.appendChild(this.container);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupContainer);
    } else {
      setupContainer();
    }
  }

  show(message, type = 'info', duration = this.defaultDuration) {
    if (!this.container) {
      this.init();
    }

    if (this.toasts.length >= this.maxToasts) {
      this.dismiss(this.toasts[0].element);
    }

    const toast = this.createToast(message, type, duration);
    if (this.container) {
      this.container.appendChild(toast);
    } else {
      document.body.appendChild(toast);
    }

    toast.offsetHeight;

    requestAnimationFrame(() => {
      toast.classList.add('show');
      toast.classList.add('toast-show');
    });

    const toastData = {
      element: toast,
      timeout: null,
      type: type
    };
    this.toasts.push(toastData);

    if (duration > 0) {
      toastData.timeout = setTimeout(() => {
        this.dismiss(toast);
      }, duration);
    }

    return toast;
  }

  createToast(message, type, duration) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type} ${type}`;
    toast.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');

    const icon = this.getIcon(type);

    toast.innerHTML = `
      <div class="toast-content">
        <div class="toast-icon-wrap toast-icon">${icon}</div>
        <div class="toast-msg toast-message">${this.escapeHtml(message)}</div>
        <button class="toast-close" aria-label="Zatvori" onclick="window.toastSystem.dismiss(this.closest('.toast'))">
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

    const index = this.toasts.findIndex(t => t.element === toast);
    if (index > -1) {
      clearTimeout(this.toasts[index].timeout);
      this.toasts.splice(index, 1);
    }

    toast.classList.remove('show', 'toast-show');
    toast.classList.add('hide');

    setTimeout(() => {
      if (toast && toast.parentNode) {
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

window.toastSystem = new ToastSystem();

window.showToast = (a, b, c) => {
  if (!window.toastSystem) return;

  const types = ['success', 'error', 'warning', 'info'];
  let message = '';
  let type = 'info';
  let duration = 5000;

  if (types.includes(a)) {
    type = a;
    message = b;
    duration = typeof c === 'number' ? c : 5000;
  } else {
    message = a;
    if (types.includes(b)) {
      type = b;
      duration = typeof c === 'number' ? c : 5000;
    } else if (typeof b === 'number') {
      duration = b;
    }
  }

  return window.toastSystem.show(message, type, duration);
};

window.showSuccess = (message, duration) => window.toastSystem.success(message, duration);
window.showError = (message, duration) => window.toastSystem.error(message, duration);
window.showWarning = (message, duration) => window.toastSystem.warning(message, duration);
window.showInfo = (message, duration) => window.toastSystem.info(message, duration);