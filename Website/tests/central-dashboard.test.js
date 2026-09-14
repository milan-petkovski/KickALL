const test = require('node:test');
const assert = require('node:assert/strict');

// ── Setup Browser Mocks for testing dashboard.js ───────────
const mockStorage = {};
const mockSessionStorage = {};
const mockElements = {};

function createMockElement(id) {
  return {
    id,
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    attributes: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    classList: {
      toggle(cls, val) {
        if (val) this.add(cls);
        else this.remove(cls);
      },
      add(cls) {
        const set = new Set(this._classes || []);
        set.add(cls);
        this._classes = Array.from(set);
      },
      remove(cls) {
        const set = new Set(this._classes || []);
        set.delete(cls);
        this._classes = Array.from(set);
      },
      contains(cls) {
        return (this._classes || []).includes(cls);
      }
    },
    setAttribute(key, val) {
      this.attributes[key] = val;
    },
    getAttribute(key) {
      return this.attributes[key] || null;
    }
  };
}

global.window = {
  location: { pathname: '/dashboard.html', search: '', href: '' },
  addEventListener: () => {},
  removeEventListener: () => {},
  localStorage: {
    getItem(k) { return mockStorage[k] || null; },
    setItem(k, v) { mockStorage[k] = String(v); },
    removeItem(k) { delete mockStorage[k]; }
  },
  sessionStorage: {
    getItem(k) { return mockSessionStorage[k] || null; },
    setItem(k, v) { mockSessionStorage[k] = String(v); },
    removeItem(k) { delete mockSessionStorage[k]; }
  }
};

global.document = {
  documentElement: { lang: 'sr' },
  body: { className: '' },
  getElementById(id) {
    if (!mockElements[id]) {
      mockElements[id] = createMockElement(id);
    }
    return mockElements[id];
  },
  querySelectorAll() {
    return [];
  }
};

global.localStorage = global.window.localStorage;
global.sessionStorage = global.window.sessionStorage;

// Load dashboard module
const dashboard = require('../js/dashboard.js');

// ── Relative Luminance & WCAG AA Contrast Calculations ─────
function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return [r, g, b];
}

function getsRGB(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function getRelativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * getsRGB(r) + 0.7152 * getsRGB(g) + 0.0722 * getsRGB(b);
}

function getContrastRatio(hex1, hex2) {
  const l1 = getRelativeLuminance(hex1);
  const l2 = getRelativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── Test Suites ────────────────────────────────────────────

test('Central Dashboard - escapeHtml neutrališe opasne XSS karaktere', () => {
  const payload = '<script>alert("XSS & test")</script>\'';
  const escaped = dashboard.escapeHtml(payload);
  assert.strictEqual(escaped.includes('<script>'), false);
  assert.strictEqual(escaped.includes('&lt;script&gt;'), true);
  assert.strictEqual(escaped.includes('&quot;'), true);
  assert.strictEqual(escaped.includes('&amp;'), true);
  assert.strictEqual(escaped.includes('&#39;'), true);

  // Handles edge cases safely
  assert.strictEqual(dashboard.escapeHtml(null), '');
  assert.strictEqual(dashboard.escapeHtml(undefined), '');
  assert.strictEqual(dashboard.escapeHtml(''), '');
});

test('Central Dashboard - getGreetingTime vraća tačan pozdrav po delu dana na SR i EN', () => {
  // Morning 08:00
  const morning = new Date(2026, 8, 14, 8, 30);
  assert.strictEqual(dashboard.getGreetingTime(morning, 'sr'), 'Dobro jutro');
  assert.strictEqual(dashboard.getGreetingTime(morning, 'en'), 'Good morning');

  // Afternoon 14:00
  const afternoon = new Date(2026, 8, 14, 14, 15);
  assert.strictEqual(dashboard.getGreetingTime(afternoon, 'sr'), 'Dobar dan');
  assert.strictEqual(dashboard.getGreetingTime(afternoon, 'en'), 'Good afternoon');

  // Evening 20:00
  const evening = new Date(2026, 8, 14, 20, 0);
  assert.strictEqual(dashboard.getGreetingTime(evening, 'sr'), 'Dobro veče');
  assert.strictEqual(dashboard.getGreetingTime(evening, 'en'), 'Good evening');

  // Night 02:00
  const night = new Date(2026, 8, 14, 2, 45);
  assert.strictEqual(dashboard.getGreetingTime(night, 'sr'), 'Laku noć');
  assert.strictEqual(dashboard.getGreetingTime(night, 'en'), 'Good night');
});

test('Central Dashboard - updateWelcomeSection personalizuje ime korisnika i sprečava ubacivanje HTML-a', () => {
  const maliciousUser = {
    user_metadata: {
      display_name: '<b>Hacker</b><script>alert(1)</script>'
    }
  };

  dashboard.updateWelcomeSection(maliciousUser, 'sr');
  const greetingEl = document.getElementById('welcomeGreeting');

  assert.strictEqual(greetingEl.innerHTML.includes('<script>'), false);
  assert.strictEqual(greetingEl.innerHTML.includes('&lt;b&gt;Hacker&lt;/b&gt;'), true);
});

test('Central Dashboard - navigateToModule postavlja ispravne cross-site navigacione flegove', () => {
  mockSessionStorage['from_kickall'] = '';
  mockStorage['kick_origin_site'] = '';

  dashboard.navigateToModule('kickot');
  assert.strictEqual(mockSessionStorage['from_kickall'], 'true');
  assert.strictEqual(mockStorage['kick_origin_site'], 'kickall');
  assert.strictEqual(global.window.location.href, '/kickot/dashboard');

  dashboard.navigateToModule('kickaj');
  assert.strictEqual(global.window.location.href, '/kickaj/dashboard');

  dashboard.navigateToModule('kickan');
  assert.strictEqual(global.window.location.href, '/kickan/dashboard');

  dashboard.navigateToModule('kickov');
  assert.strictEqual(global.window.location.href, '/kickov/dashboard');
});

test('Central Dashboard - navigateToModule odbija nepostojeće ili zlonamerne module', () => {
  const originalHref = global.window.location.href;
  dashboard.navigateToModule('malicious-module');
  assert.strictEqual(global.window.location.href, originalHref);
});

test('Central Dashboard - handleModuleKeydown podržava pristupačnost preko tastature (Enter i Space)', () => {
  let spacePrevented = false;
  const spaceEvent = {
    key: ' ',
    preventDefault() { spacePrevented = true; }
  };
  dashboard.handleModuleKeydown(spaceEvent, 'kickaj');
  assert.strictEqual(spacePrevented, true);
  assert.strictEqual(global.window.location.href, '/kickaj/dashboard');

  let enterPrevented = false;
  const enterEvent = {
    key: 'Enter',
    preventDefault() { enterPrevented = true; }
  };
  dashboard.handleModuleKeydown(enterEvent, 'kickan');
  assert.strictEqual(enterPrevented, true);
  assert.strictEqual(global.window.location.href, '/kickan/dashboard');

  // Ignores other keys like Escape
  let escapePrevented = false;
  const escapeEvent = {
    key: 'Escape',
    preventDefault() { escapePrevented = true; }
  };
  dashboard.handleModuleKeydown(escapeEvent, 'kickov');
  assert.strictEqual(escapePrevented, false);
});

test('Central Dashboard - applyModuleStatuses ažurira bedževe, tooltipe i ARIA opise', () => {
  const testStatus = {
    kickot: { state: 'active', text: 'Aktivan', tooltip: 'Povezan kanal: @milan' },
    kickaj: { state: 'active', text: 'Aktivan', tooltip: 'Spreman za darivanja' },
    kickan: { state: 'warning', text: 'Učitavanje', tooltip: 'Osvežavanje metrika' },
    kickov: { state: 'locked', text: 'Zaključano', tooltip: 'Potreban PRO paket' }
  };

  dashboard.applyModuleStatuses(testStatus);

  const pillKickot = document.getElementById('statusPill-kickot');
  const tooltipKickot = document.getElementById('statusTooltip-kickot');
  const cardKickot = document.getElementById('moduleCard-kickot');

  assert.strictEqual(pillKickot.className.includes('status-active'), true);
  assert.strictEqual(tooltipKickot.textContent, 'Povezan kanal: @milan');
  assert.strictEqual(cardKickot.getAttribute('aria-label').includes('Kickot - Aktivan'), true);

  const pillKickan = document.getElementById('statusPill-kickan');
  assert.strictEqual(pillKickan.className.includes('status-warning'), true);

  const pillKickov = document.getElementById('statusPill-kickov');
  assert.strictEqual(pillKickov.className.includes('status-locked'), true);
});

test('Central Dashboard - WCAG AA Contrast Ratio provera (min 4.5:1 za tekst)', () => {
  const darkCardBg = '#080612';

  // 1. Card Title (White #ffffff on dark background)
  const titleRatio = getContrastRatio('#ffffff', darkCardBg);
  assert.ok(titleRatio >= 4.5, `Card title contrast ${titleRatio.toFixed(2)} should be >= 4.5`);
  assert.ok(titleRatio >= 7.0, `Card title contrast ${titleRatio.toFixed(2)} meets WCAG AAA (>= 7.0)`);

  // 2. Card Body Text (#cbd5e1 on dark background)
  const bodyRatio = getContrastRatio('#cbd5e1', darkCardBg);
  assert.ok(bodyRatio >= 4.5, `Card body text contrast ${bodyRatio.toFixed(2)} should be >= 4.5`);

  // 3. Kickot Green button (#53fc18 background, #06040a text)
  const kickotBtnRatio = getContrastRatio('#53fc18', '#06040a');
  assert.ok(kickotBtnRatio >= 4.5, `Kickot button contrast ${kickotBtnRatio.toFixed(2)} should be >= 4.5`);

  // 4. Kickaj Violet button (#7c3aed background, #ffffff text)
  const kickajBtnRatio = getContrastRatio('#7c3aed', '#ffffff');
  assert.ok(kickajBtnRatio >= 4.5, `Kickaj button contrast ${kickajBtnRatio.toFixed(2)} should be >= 4.5`);

  // 5. Kickan Amber button (#f59e0b background, #06040a text)
  const kickanBtnRatio = getContrastRatio('#f59e0b', '#06040a');
  assert.ok(kickanBtnRatio >= 4.5, `Kickan button contrast ${kickanBtnRatio.toFixed(2)} should be >= 4.5`);

  // 6. Kickov Cyan button (#06b6d4 background, #06040a text)
  const kickovBtnRatio = getContrastRatio('#06b6d4', '#06040a');
  assert.ok(kickovBtnRatio >= 4.5, `Kickov button contrast ${kickovBtnRatio.toFixed(2)} should be >= 4.5`);
});

test('Central Dashboard - openDashboard prevodi ne sadrže unicode strelicu (sprečava duple strelice uz SVG)', () => {
  const fs = require('fs');
  const path = require('path');

  const srLocale = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/sr.json'), 'utf8'));
  const enLocale = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/en.json'), 'utf8'));

  assert.strictEqual(srLocale.dashboard.openDashboard.includes('→'), false, 'SR openDashboard ne sme imati strelicu jer kartica ima SVG ikonicu');
  assert.strictEqual(enLocale.dashboard.openDashboard.includes('→'), false, 'EN openDashboard ne sme imati strelicu jer kartica ima SVG ikonicu');
  assert.strictEqual(srLocale.dashboard.openDashboard, 'Otvori Dashboard');
  assert.strictEqual(enLocale.dashboard.openDashboard, 'Open Dashboard');
});

test('Central Dashboard - mobile-toggle i mobile-menu-close su sakriveni na desktopu u CSS-u', () => {
  const fs = require('fs');
  const path = require('path');

  const css = fs.readFileSync(path.join(__dirname, '../css/dashboard.css'), 'utf8');

  // Verify desktop hiding rule exists
  const desktopRuleRegex = /\.mobile-toggle,\s*\.mobile-menu-close\s*\{\s*display:\s*none;/;
  assert.ok(desktopRuleRegex.test(css), 'dashboard.css mora imati display: none za mobile-toggle i mobile-menu-close na desktopu');
});

test('Central Dashboard - Touch targets na mobilnom zadovoljavaju minimum od 44px', () => {
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '../css/dashboard.css'), 'utf8');

  // card-btn minimum height 48px
  assert.ok(css.includes('min-height: 48px'), 'card-btn mora imati min-height od barem 44px (ima 48px)');

  // mobile toggles minimum 44px
  assert.ok(css.includes('min-width: 44px') && css.includes('min-height: 44px'), 'mobilne kontrole moraju imati min 44x44px');
});

test('Central Dashboard - Responzivnost: 1 kolona na mobilnom, 2 na tabletu, 4 na desktopu', () => {
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '../css/dashboard.css'), 'utf8');

  // Base: 1fr (mobile)
  assert.ok(css.includes('grid-template-columns: 1fr;'), 'Mobilni prikaz mora biti 1 kolona');

  // Tablet: repeat(2, 1fr) @ 680px
  assert.ok(css.includes('repeat(2, 1fr)'), 'Tablet prikaz mora biti 2 kolone na min-width 680px');

  // Desktop: repeat(4, 1fr) @ 1025px
  assert.ok(css.includes('repeat(4, 1fr)'), 'Desktop prikaz mora biti 4 kolone na min-width 1025px');
});

test('Central Dashboard - prefers-reduced-motion gasi tranzicije, animacije i transformacije', () => {
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '../css/dashboard.css'), 'utf8');

  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'Mora postojati prefers-reduced-motion blok');
  assert.ok(css.includes('transition: none !important;'), 'Tranzicije moraju biti ugašene');
  assert.ok(css.includes('animation: none !important;'), 'Animacije moraju biti ugašene');
  assert.ok(css.includes('transform: none !important;'), 'Transformacije moraju biti ugašene');
});

test('Central Dashboard - .status-locked stanje ne curenje osetljive podatke kanala', () => {
  const lockedStatus = {
    kickov: { state: 'locked', text: 'Zaključano', tooltip: 'Potrebna nadogradnja plana' }
  };
  dashboard.applyModuleStatuses(lockedStatus);

  const cardKickov = document.getElementById('moduleCard-kickov');
  const ariaLabel = cardKickov.getAttribute('aria-label');

  // Provera da aria-label i tooltip sadrže samo javno vidljiv tekst zaključanosti
  assert.strictEqual(ariaLabel.includes('Zaključano'), true);
  assert.strictEqual(ariaLabel.includes('Potrebna nadogradnja plana'), true);
  assert.strictEqual(ariaLabel.includes('token'), false);
  assert.strictEqual(ariaLabel.includes('secret'), false);
  assert.strictEqual(ariaLabel.includes('undefined'), false);
});
