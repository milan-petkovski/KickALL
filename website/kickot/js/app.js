/* ═══════════════════════════════════════════════════════════
   KickOt — app.js
   Supabase Auth + Language Switcher + UI Logic
   ═══════════════════════════════════════════════════════════ */

// ── Global Variables ───────────────────────────────────────
let currentLang = 'sr';
const translations = {
  sr: {},
  en: {}
};

// ── Init Language from localStorage ───────────────────────────
try {
  const savedLang = localStorage.getItem('kickall_lang');
  if (savedLang) {
    currentLang = savedLang;
  }
} catch (e) {
  console.warn('LocalStorage not available:', e);
}

// ── Configuration Check & Fallback ────────────────────────────
const CONFIG = window.CONFIG || window.KickotConfig || {};

// Ako je učitan glavni window.CONFIG, dodeljujemo ga i na KickotConfig
if (!window.KickotConfig) {
  window.KickotConfig = CONFIG;
}

// Garancija da getLocalePath metoda postoji za prevode
if (!window.KickotConfig.getLocalePath) {
  window.KickotConfig.getLocalePath = function(lang) {
    return `locales/${lang}.json`;
  };
}

// ── Supabase Init ──────────────────────────────────────────
const { createClient } = window.supabase;

// Supabase konfiguracija dolazi iskljucivo iz js/config.js (window.CONFIG)
// Nikad ne koristiti hardkodovane fallback vrednosti
const supabaseUrl = CONFIG.SUPABASE?.URL;
const supabaseAnonKey = CONFIG.SUPABASE?.ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('[Kickot App] Supabase URL ili ANON_KEY nije dostupan iz window.CONFIG. Proverite da je js/config.js ucitan pre app.js.');
}

// Use same storage key as KickAll for shared auth session
const storageKey = CONFIG.SUPABASE?.STORAGE_KEY || 'kickbot-supabase-auth';

const sb = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      storage: window.localStorage,
      storageKey: storageKey
    }
  }
);

let currentUser = null;

// Track Referral Code from URL - Match KickAll
(function checkReferralParam() {
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref') || params.get('referral');
    if (ref) {
      const referralKey = CONFIG.STORAGE_KEYS ? CONFIG.STORAGE_KEYS.USER_REFERRAL_CODE : 'user_referral_code';
      localStorage.setItem(referralKey, ref.trim().toUpperCase());
    }
  } catch (e) {
    // Silently fail - referral tracking is optional
  }
})();

// Track from_kickall for cross-site navigation
(function checkFromKickAll() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromKickAll = params.get('from_kickall');
    if (fromKickAll === 'true') {
      const fromKickAllKey = CONFIG.STORAGE_KEYS ? CONFIG.STORAGE_KEYS.FROM_KICKALL : 'from_kickall';
      sessionStorage.setItem(fromKickAllKey, 'true');
    }
  } catch (e) {
    // Silently fail
  }
})();

// ── Translations ──
// ── Translations ───────────────────────────────────────────
function t(key) {
  if (!key) return '';
  const keys = key.split('.');
  let value = translations[currentLang];
  
  for (const k of keys) {
    if (value && typeof value === 'object') {
      value = value[k];
    } else {
      return key;
    }
  }
  return value !== undefined ? value : key;
}

function updateDOMTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const text = t(key);

    if (text && text !== key) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = text;
      } else if (el.classList.contains('btn-text')) {
        el.textContent = text;
      } else {
        el.innerHTML = text;
      }
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const text = t(key);
    if (text && text !== key) el.placeholder = text;
  });
}

async function setLang(lang) {
  currentLang = lang;
  const languageKey = CONFIG.STORAGE_KEYS ? CONFIG.STORAGE_KEYS.KICKALL_LANG : 'kickall_lang';
  localStorage.setItem(languageKey, lang);
  document.documentElement.lang = lang === 'sr' ? 'sr' : 'en';

  document.body.classList.toggle('lang-sr', lang === 'sr');
  document.body.classList.toggle('lang-en', lang === 'en');

  // 1. Sačekaj da se prevod učita sa servera
  try {
    const localePath = window.KickotConfig.getLocalePath(lang);
    const res = await fetch(localePath);
    if (res.ok) {
      const data = await res.json();
      translations[lang] = data;
      window.translations = translations;
    } else {
      console.error('Failed to load translations:', res.status);
    }
  } catch (e) {
    console.error('Failed to load translations:', e);
  }

  // 2. Ažuriraj sve DOM elemente TEK NAKON što je JSON učitan
  updateDOMTranslations();

  // 3. Dispatch pricing language change event for pricing period updates
  document.dispatchEvent(new CustomEvent('pricingLanguageChanged', { detail: { language: lang } }));

  // 4. Ažuriranje specifičnih dugmadi i meta oznaka
  const heroPrimaryBtnText = document.getElementById('heroPrimaryBtnText');
  if (heroPrimaryBtnText && currentUser) {
    const text = t('nav.goToDashboard');
    if (text && text !== 'nav.goToDashboard') {
      heroPrimaryBtnText.textContent = text;
    }
  }

  const ctaPrimaryBtnText = document.getElementById('ctaPrimaryBtnText');
  if (ctaPrimaryBtnText && currentUser) {
    const text = t('nav.goToDashboard');
    if (text && text !== 'nav.goToDashboard') {
      ctaPrimaryBtnText.textContent = text;
    }
  }

  const btnSr = document.getElementById('btn-sr');
  const btnEn = document.getElementById('btn-en');
  if (btnSr) btnSr.classList.toggle('active', lang === 'sr');
  if (btnEn) btnEn.classList.toggle('active', lang === 'en');

  const titleText = t('meta.title');
  if (titleText && titleText !== 'meta.title') {
    document.title = titleText;
  }
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    const descText = t('meta.desc');
    if (descText && descText !== 'meta.desc') {
      metaDesc.content = descText;
    }
  }
  
  // Dispatch language change event for consent banner
  document.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lang } }));
}

// ── Navbar Scroll ──────────────────────────────────────────
const navbar = document.getElementById('navbar');
if (navbar) {
  let scrollThrottle = null;
  window.addEventListener('scroll', () => {
    if (scrollThrottle) return;
    scrollThrottle = requestAnimationFrame(() => {
      navbar.classList.toggle('scrolled', window.scrollY > 20);
      scrollThrottle = null;
    });
  }, { passive: true });
}

// ── Scroll Reveal ──────────────────────────────────────────
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('revealed');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });

document.querySelectorAll('[data-reveal]').forEach(el => revealObserver.observe(el));

// ── Smooth scroll ──────────────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const href = a.getAttribute('href');
    
    // Skip empty or invalid hash selectors
    if (!href || href === '#' || href.trim() === '') {
      return;
    }
    
    try {
      const target = document.querySelector(href);
      if (target) { 
        e.preventDefault(); 
        target.scrollIntoView({ behavior: 'smooth' });
        
        // Close mobile menu if open
        const navMenu = document.getElementById('navMenu');
        const mobileToggle = document.getElementById('mobileToggle');
        if (navMenu && navMenu.classList.contains('open')) {
          navMenu.classList.remove('open');
          if (mobileToggle) mobileToggle.classList.remove('active');
          document.body.classList.remove('nav-menu-open');
          document.documentElement.classList.remove('nav-menu-open');
          if (mobileToggle) {
            mobileToggle.querySelectorAll('span').forEach(s => s.style.transform = 'none');
            mobileToggle.querySelectorAll('span')[1].style.opacity = '1';
          }
        }
      }
    } catch (error) {
      // Silent fail for invalid selectors
    }
  });
});

// ── Mobile Menu ─────────────────────────────────────────────
const mobileToggle = document.getElementById('mobileToggle');
const navMenu = document.getElementById('navMenu');
const mobileMenuClose = document.getElementById('mobileMenuClose');
const mobileLoginBtn = document.getElementById('mobileLoginBtn');
const mobileDashboardBtn = document.getElementById('mobileDashboardBtn');

if (mobileToggle && navMenu) {
  mobileToggle.addEventListener('click', () => {
    navMenu.classList.toggle('open');
    mobileToggle.classList.toggle('active');
    document.body.classList.toggle('nav-menu-open');
    document.documentElement.classList.toggle('nav-menu-open');

    // Animacija dugmeta (burger u X)
    const spans = mobileToggle.querySelectorAll('span');
    if (mobileToggle.classList.contains('active')) {
      spans[0].style.transform = 'rotate(45deg) translate(6px, 6px)';
      spans[1].style.opacity = '0';
      spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
    } else {
      spans[0].style.transform = 'none';
      spans[1].style.opacity = '1';
      spans[2].style.transform = 'none';
    }
  });

  // Zatvori meni na klik linka
  navMenu.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      navMenu.classList.remove('open');
      mobileToggle.classList.remove('active');
      document.body.classList.remove('nav-menu-open');
      document.documentElement.classList.remove('nav-menu-open');
      mobileToggle.querySelectorAll('span').forEach(s => s.style.transform = 'none');
      mobileToggle.querySelectorAll('span')[1].style.opacity = '1';
    });
  });
}

// Mobile menu close button
if (mobileMenuClose && navMenu && mobileToggle) {
  mobileMenuClose.addEventListener('click', () => {
    navMenu.classList.remove('open');
    mobileToggle.classList.remove('active');
    document.body.classList.remove('nav-menu-open');
    document.documentElement.classList.remove('nav-menu-open');
    mobileToggle.querySelectorAll('span').forEach(s => s.style.transform = 'none');
    mobileToggle.querySelectorAll('span')[1].style.opacity = '1';
  });
}

// Mobile login button
if (mobileLoginBtn) {
  mobileLoginBtn.addEventListener('click', () => {
    openModal('login');
    // Close mobile menu
    navMenu.classList.remove('open');
    mobileToggle.classList.remove('active');
    document.body.classList.remove('nav-menu-open');
    document.documentElement.classList.remove('nav-menu-open');
    mobileToggle.querySelectorAll('span').forEach(s => s.style.transform = 'none');
    mobileToggle.querySelectorAll('span')[1].style.opacity = '1';
  });
}

// Close mobile menu when clicking outside
document.addEventListener('click', (e) => {
  if (navMenu && navMenu.classList.contains('open')) {
    // Check if click is outside nav menu and mobile toggle
    if (!navMenu.contains(e.target) && !mobileToggle.contains(e.target)) {
      navMenu.classList.remove('open');
      mobileToggle.classList.remove('active');
      document.body.classList.remove('nav-menu-open');
      document.documentElement.classList.remove('nav-menu-open');
      mobileToggle.querySelectorAll('span').forEach(s => s.style.transform = 'none');
      mobileToggle.querySelectorAll('span')[1].style.opacity = '1';
    }
  }
});

// ── Particles ─────────────────────────────────────────────
(function () {
  const canvas = document.getElementById('particlesCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const particles = [];
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize, { passive: true });
  const colors = ['#8B5CF6', '#6366F1', '#53FC18', '#A78BFA'];
  for (let i = 0; i < 50; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      size: Math.random() * 2 + 0.5,
      speedX: (Math.random() - 0.5) * 0.3,
      speedY: (Math.random() - 0.5) * 0.3 - 0.1,
      color: colors[Math.floor(Math.random() * colors.length)],
      opacity: Math.random() * 0.4 + 0.1,
      life: Math.random(),
      lifeSpeed: Math.random() * 0.003 + 0.001,
    });
  }
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.life += p.lifeSpeed;
      if (p.life > 1) { p.life = 0; p.x = Math.random() * canvas.width; p.y = canvas.height + 10; }
      const alpha = Math.sin(p.life * Math.PI) * p.opacity;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color + Math.round(alpha * 255).toString(16).padStart(2, '0');
      ctx.fill();
      p.x += p.speedX;
      p.y += p.speedY;
    });
    requestAnimationFrame(animate);
  }
  animate();
})();

// ── Web Audio API Synth Sound Helper ───────────────────────
let audioCtx = null;
function playSynthSound(frequency = 440, type = 'sine', duration = 0.1, volume = 0.1) {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);

    gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    // Silently fail - audio is blocked or not supported
  }
}

// ── Commands Showcase ─────────────────────────────────────
// Logika za prebacivanje kategorija komandi i interaktivni live preview
document.querySelectorAll('.category-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const category = btn.getAttribute('data-category');

    document.querySelectorAll('.cmd-item').forEach(item => {
      if (item.getAttribute('data-cat') === category) {
        item.style.display = 'flex';
      } else {
        item.style.display = 'none';
      }
    });

    const firstVisible = document.querySelector(`.cmd-item[data-cat="${category}"]`);
    if (firstVisible) {
      document.querySelectorAll('.cmd-item').forEach(i => i.classList.remove('active'));
      firstVisible.classList.add('active');
      updateCommandPreview(firstVisible);
    }
  });
});

document.querySelectorAll('.cmd-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.cmd-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    updateCommandPreview(item);
  });
});

function updateCommandPreview(item) {
    const cmdName = item.querySelector('.cmd-name').textContent.split(' ')[0];
    const replyKey = item.getAttribute('data-reply-key');
    const replyText = replyKey ? t(replyKey) : '';
    const previewContainer = document.getElementById('cmdPreviewContent');

    if (previewContainer) {
        const viewerStr = t('cmd.viewer') !== 'cmd.viewer' ? t('cmd.viewer') : 'Gledalac';
        previewContainer.innerHTML = `
            <div class="cp-line"><span class="cp-user">${viewerStr}:</span> <span class="cp-msg">${cmdName}</span></div>
            <div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:var(--color-green)">${replyText}</span></div>
        `;
        playSynthSound(600, 'sine', 0.15);
        const playground = document.getElementById('mainPlayground');
        if (playground) {
            playground.classList.remove('flash-active');
            void playground.offsetWidth;
            playground.classList.add('flash-active');
        }
    }
}

// ── Auth Helper Functions ──────────────────────────────────
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function clearAllErrors() {
  document.querySelectorAll('.field-error').forEach(el => {
    el.textContent = '';
    el.classList.remove('visible');
  });
  document.querySelectorAll('.form-input').forEach(el => {
    el.classList.remove('error');
  });
  document.querySelectorAll('.form-alert').forEach(el => {
    el.textContent = '';
    el.style.display = 'none';
  });
}

function showFieldError(id, msg) {
  const errEl = document.getElementById(id);
  if (errEl) {
    errEl.textContent = msg;
    errEl.classList.add('visible');
  }
  const inputId = id.replace('Err', '');
  const inputEl = document.getElementById(inputId);
  if (inputEl) {
    inputEl.classList.add('error');
  }
}

function showFormAlert(id, msg, type = 'error') {
  const alertEl = document.getElementById(id);
  if (alertEl) {
    alertEl.textContent = msg;
    alertEl.style.display = 'block';
    if (type === 'success') {
      alertEl.classList.remove('form-alert-error');
      alertEl.classList.add('form-alert-success');
    } else {
      alertEl.classList.remove('form-alert-success');
      alertEl.classList.add('form-alert-error');
    }
  }
}

function setLoading(type, loading) {
  const btnId = type.endsWith('Btn') ? type : `${type}Btn`;
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  const spinner = btn.querySelector('.auth-spinner');
  if (spinner) {
    spinner.style.display = loading ? 'inline-block' : 'none';
  }
}

// ── Modal ─────────────────────────────────────────────────
function openModal(tab = 'login') {
  const modal = document.getElementById('authModal');
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal() {
  const modal = document.getElementById('authModal');
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
  clearAllErrors();
}

function handleModalBackdropClick(e) {
  if (e.target === document.getElementById('authModal')) closeModal();
}

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ── Kick OAuth / Login Flow ────────────────────────────────
function getKickRedirectUri() {
  const hostname = window.location.hostname;
  
  // Localhost development
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:5500/auth/kick/callback/';
  }
  
  // Production - always use kickall.app domain
  return 'https://kickall.app/auth/kick/callback/';
}

function generateRandomString(length) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let text = '';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest('SHA-256', data);
}

function base64urlencode(a) {
  let str = "";
  const bytes = new Uint8Array(a);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generateCodeChallenge(v) {
  const hashed = await sha256(v);
  return base64urlencode(hashed);
}

async function openKickLogin() {
  // Use global auth system if available
  if (window.KickAuth) {
    KickAuth.initiateOAuth('kickot/dashboard.html');
    return;
  }
  
  // Fallback to old system if global auth not available
  const KICK_CLIENT_ID = '01KXN4YW8GF6DPXSC1JMMJ25QN';
  const KICK_REDIRECT_URI = getKickRedirectUri();
  const KICK_SCOPE = 'user:read channel:read chat:read chat:write moderation:read moderation:write';

  const state = `kickot_${generateRandomString(16)}`;
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Use KickAll storage keys for cross-site auth
  const oauthStateKey = CONFIG.STORAGE_KEYS ? CONFIG.STORAGE_KEYS.KICK_OAUTH_STATE : 'kick_oauth_state';
  const codeVerifierKey = CONFIG.STORAGE_KEYS ? CONFIG.STORAGE_KEYS.KICK_CODE_VERIFIER : 'kick_code_verifier';
  const originSiteKey = CONFIG.STORAGE_KEYS ? CONFIG.STORAGE_KEYS.KICK_ORIGIN_SITE : 'kick_origin_site';



  localStorage.setItem(oauthStateKey, state);
  localStorage.setItem(codeVerifierKey, codeVerifier);
  localStorage.setItem(originSiteKey, 'kickot');
  sessionStorage.setItem(oauthStateKey, state);
  sessionStorage.setItem(codeVerifierKey, codeVerifier);
  sessionStorage.setItem(originSiteKey, 'kickot');

  const authUrl = `https://id.kick.com/oauth/authorize?` + new URLSearchParams({
    response_type: 'code',
    client_id: KICK_CLIENT_ID,
    redirect_uri: KICK_REDIRECT_URI,
    scope: KICK_SCOPE,
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  }).toString();

  window.location.href = authUrl;
}

// ── Login ──────────────────────────────────────────────────
async function handleLogin() {
  clearAllErrors();
  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const email = emailInput ? emailInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';
  let valid = true;

  if (!email) { showFieldError('loginEmailErr', t('err.email.required')); valid = false; }
  else if (!validateEmail(email)) { showFieldError('loginEmailErr', t('err.email.invalid')); valid = false; }
  if (!password) { showFieldError('loginPasswordErr', t('err.pw.required')); valid = false; }
  if (!valid) return;

  setLoading('login', true);
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      showFormAlert('loginError', mapAuthError(error));
    } else {
      showToast('success', t('auth.login.success'), '👋');
      closeModal();
      onUserChange(data.user);
      setTimeout(() => {
        const fromKickAllKey = CONFIG.STORAGE_KEYS ? CONFIG.STORAGE_KEYS.FROM_KICKALL : 'from_kickall';
        const fromKickAll = sessionStorage.getItem(fromKickAllKey) === 'true';
        window.location.href = fromKickAll ? '../dashboard.html' : 'dashboard.html';
      }, 800);
    }
  } catch (err) {
    showFormAlert('loginError', t('auth.err.generic'));
  } finally {
    setLoading('login', false);
  }
}

// ── Sign Up ────────────────────────────────────────────────
async function handleSignup() {
  clearAllErrors();
  const nameInput = document.getElementById('signupName');
  const emailInput = document.getElementById('signupEmail');
  const passwordInput = document.getElementById('signupPassword');
  const name = nameInput ? nameInput.value.trim() : '';
  const email = emailInput ? emailInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';
  let valid = true;

  if (!name) { showFieldError('signupNameErr', t('err.name.required')); valid = false; }
  if (!email) { showFieldError('signupEmailErr', t('err.email.required')); valid = false; }
  else if (!validateEmail(email)) { showFieldError('signupEmailErr', t('err.email.invalid')); valid = false; }
  if (!password) { showFieldError('signupPasswordErr', t('err.pw.required')); valid = false; }
  else if (password.length < 8) { showFieldError('signupPasswordErr', t('err.pw.short')); valid = false; }
  if (!valid) return;

  setLoading('signup', true);
  try {
    const { data: signUpData, error: signUpError } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name }
      }
    });

    if (signUpError) {
      showFormAlert('signupError', mapAuthError(signUpError));
      return;
    }

    const user = signUpData.user;
    if (user) {
      const { data: existingProfile } = await sb.from('user_profiles').select('id').eq('id', user.id).maybeSingle();
      if (!existingProfile) {
        await sb.from('user_profiles').insert({
          id: user.id,
          display_name: name,
          email: email,
          plan: 'free',
          kick_channels: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }
    }

    if (signUpData.session) {
      showToast('success', t('auth.signup.success'), '🎉');
      closeModal();
      onUserChange(signUpData.session.user);
      setTimeout(() => {
        const fromKickAllKey = CONFIG.STORAGE_KEYS ? CONFIG.STORAGE_KEYS.FROM_KICKALL : 'from_kickall';
        const fromKickAll = sessionStorage.getItem(fromKickAllKey) === 'true';
        window.location.href = fromKickAll ? '../dashboard.html' : 'dashboard.html';
      }, 800);
    } else {
      showFormAlert('signupSuccess', t('auth.signup.success'), 'success');
    }
  } catch (err) {
    showFormAlert('signupError', t('auth.err.generic'));
  } finally {
    setLoading('signup', false);
  }
}

// ── Forgot Password ────────────────────────────────────────
async function handleForgot() {
  clearAllErrors();
  const emailInput = document.getElementById('forgotEmail');
  const email = emailInput ? emailInput.value.trim() : '';

  if (!email) { showFieldError('forgotEmailErr', t('err.email.required')); return; }
  if (!validateEmail(email)) { showFieldError('forgotEmailErr', t('err.email.invalid')); return; }

  setLoading('forgot', true);
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname + '?reset=true'
    });
    if (error) {
      showFormAlert('forgotError', t('auth.err.generic'));
    } else {
      showFormAlert('forgotSuccess', t('auth.forgot.success'), 'success');
    }
  } catch {
    showFormAlert('forgotError', t('auth.err.generic'));
  } finally {
    setLoading('forgot', false);
  }
}

function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = show
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}

// ── Auth Error Mapper ─────────────────────────────────────
function mapAuthError(error) {
  const code = (error.code || '').toLowerCase();
  const msg = (error.message || '').toLowerCase();

  if (code === 'over_email_send_rate_limit' || error.status === 429 || msg.includes('rate limit')) {
    return t('auth.err.rate_limit');
  }
  if (code === 'email_address_invalid' || msg.includes('is invalid') || msg.includes('invalid email')) {
    return t('auth.err.email_invalid');
  }
  if (msg.includes('already registered') || msg.includes('already exists') || code === 'user_already_exists') {
    return t('auth.err.exists');
  }
  if (msg.includes('invalid login') || msg.includes('invalid credentials') || code === 'invalid_credentials') {
    return t('auth.err.invalid');
  }
  if (msg.includes('email not confirmed') || code === 'email_not_confirmed') {
    return t('auth.err.email.confirm');
  }
  return t('auth.err.generic');
}

// ── User Dropdown & State ──────────────────────────────────
function toggleUserDropdown() {
  const menu = document.getElementById('userMenu');
  if (menu) menu.classList.toggle('open');
}

function closeUserDropdown() {
  const menu = document.getElementById('userMenu');
  if (menu) menu.classList.remove('open');
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('userMenu');
  if (menu && !menu.contains(e.target)) {
    closeUserDropdown();
  }
});

function onUserChange(user) {
  currentUser = user;
  const guestNav = document.getElementById('guestNav');
  const userMenu = document.getElementById('userMenu');
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');

  if (user) {
    if (guestNav) guestNav.style.display = 'none';
    if (userMenu) userMenu.classList.add('visible');
    const name = user.user_metadata?.display_name || user.email?.split('@')[0] || 'User';
    if (userName) userName.textContent = name;

    const avatarVal = user.user_metadata?.avatar_url || name.charAt(0).toUpperCase();
    if (userAvatar) {
      if (avatarVal.startsWith('data:image') || avatarVal.startsWith('http')) {
        userAvatar.style.backgroundImage = `url("${avatarVal}")`;
        userAvatar.style.backgroundSize = 'cover';
        userAvatar.style.backgroundPosition = 'center';
        userAvatar.textContent = '';
      } else {
        userAvatar.style.backgroundImage = 'none';
        userAvatar.textContent = avatarVal;
      }
    }

    // Mobile menu - show dashboard button, hide login button
    if (mobileDashboardBtn) {
      mobileDashboardBtn.style.display = 'inline-flex';
    }
    if (mobileLoginBtn) {
      mobileLoginBtn.style.display = 'none';
    }

    const heroPrimaryBtn = document.getElementById('heroPrimaryBtn');
    const heroPrimaryBtnText = document.getElementById('heroPrimaryBtnText');
    if (heroPrimaryBtn && heroPrimaryBtnText) {
      heroPrimaryBtn.onclick = () => { window.location.href = 'dashboard.html'; };
      heroPrimaryBtnText.textContent = t('nav.goToDashboard');
      heroPrimaryBtnText.removeAttribute('data-i18n');
    }
  } else {
    if (guestNav) guestNav.style.display = 'flex';
    if (userMenu) userMenu.classList.remove('visible');

    // Mobile menu - show login button, hide dashboard button
    if (mobileDashboardBtn) {
      mobileDashboardBtn.style.display = 'none';
    }
    if (mobileLoginBtn) {
      mobileLoginBtn.style.display = 'inline-flex';
    }

    const heroPrimaryBtn = document.getElementById('heroPrimaryBtn');
    const heroPrimaryBtnText = document.getElementById('heroPrimaryBtnText');
    if (heroPrimaryBtn && heroPrimaryBtnText) {
      heroPrimaryBtn.onclick = () => { openModal('login'); };
      heroPrimaryBtnText.setAttribute('data-i18n', 'hero.cta.primary');
      heroPrimaryBtnText.textContent = currentLang === 'sr' ? 'Počni besplatno' : 'Get started free';
    }
  }

  // Dinamičko ažuriranje CTA dugmeta u sekciji za prijavu na dnu stranice
    const ctaPrimaryBtn = document.getElementById('ctaPrimaryBtn');
    const ctaPrimaryBtnText = document.getElementById('ctaPrimaryBtnText');
    if (ctaPrimaryBtn && ctaPrimaryBtnText) {
      if (user) {
        ctaPrimaryBtn.onclick = () => { window.location.href = 'dashboard.html'; };
        ctaPrimaryBtnText.textContent = t('nav.goToDashboard');
        ctaPrimaryBtnText.removeAttribute('data-i18n');
      } else {
        ctaPrimaryBtn.onclick = () => { openModal('login'); };
        ctaPrimaryBtnText.setAttribute('data-i18n', 'cta.login');
        ctaPrimaryBtnText.textContent = t('cta.login');
      }
    }
}

// ── Toast Notifications ────────────────────────────────────
let toastId = 0;
function showToast(type, msg, iconEmoji = '💬', duration = 4000) {
  let container = document.getElementById('toastContainer');
  // Ensure container is a direct child of body (fixes DOM nesting issues)
  if (!container || container.parentElement !== document.body) {
    if (container) container.remove();
    container = document.createElement('div');
    container.className = 'toast-container';
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }

  const id = ++toastId;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.id = `toast-${id}`;

  let svgIcon = '';
  if (type === 'success') {
    svgIcon = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;
  } else if (type === 'error') {
    svgIcon = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
    `;
  } else if (type === 'info') {
    svgIcon = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>
    `;
  } else {
    svgIcon = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    `;
  }

  el.innerHTML = `
    <div class="toast-icon-wrap">${svgIcon}</div>
    <div class="toast-msg">${msg}</div>
    <button class="toast-close" onclick="removeToast(${id})">✕</button>
  `;

  // Max 3 newest toasts: push the oldest active one up with a smooth slide-up collapse
  const activeToasts = Array.from(container.children).filter(child => !child.classList.contains('toast-leaving'));
  if (activeToasts.length >= 3) {
    const oldest = activeToasts[0];
    oldest.classList.add('toast-leaving');
    const match = oldest.id.match(/toast-(\d+)/);
    if (match) {
      removeToast(parseInt(match[1]));
    } else {
      oldest.remove();
    }
  }

  container.appendChild(el);

  // Trigger entry animation in the next paint cycle
  setTimeout(() => {
    el.classList.add('toast-show');
  }, 20);

  setTimeout(() => removeToast(id), duration);
}
function removeToast(id) {
  const el = document.getElementById(`toast-${id}`);
  if (el) {
    el.classList.add('toast-leaving');
    el.classList.remove('toast-show');
    setTimeout(() => el.remove(), 250);
  }
}

// Create ToastSystem interface for compatibility with existing code
window.toastSystem = {
  show: showToast,
  success: (msg, duration) => showToast('success', msg, '✓', duration),
  error: (msg, duration) => showToast('error', msg, '✕', duration),
  warning: (msg, duration) => showToast('info', msg, '⚠', duration),
  info: (msg, duration) => showToast('info', msg, 'ℹ', duration),
  dismiss: (toastElement) => {
    if (toastElement && toastElement.id) {
      const match = toastElement.id.match(/toast-(\d+)/);
      if (match) removeToast(parseInt(match[1]));
    }
  }
};

// ── Auth Listener & Spotlight ──────────────────────────────
sb.auth.onAuthStateChange((event, session) => {
  onUserChange(session?.user || null);
});

// ── Initial Session Check ──────────────────────────────────
(async function checkInitialSession() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {

      onUserChange(session.user);
    }
  } catch (error) {
    console.error('Kickot: Error checking initial session', error);
  }
})();

// ── Kick Login Button with Redirect Animation ─────────────
const authKickLoginBtn = document.getElementById('authKickLoginBtn');
if (authKickLoginBtn) {
  authKickLoginBtn.addEventListener('click', () => {
    // Add loading state
    authKickLoginBtn.classList.add('loading');
    authKickLoginBtn.disabled = true;
    const btnText = authKickLoginBtn.querySelector('span');
    const originalText = btnText.textContent;
    btnText.textContent = 'Preusmeravanje...';

    // Small delay to show loading state before redirect
    setTimeout(() => {
      openKickLogin();
    }, 500);
  });

  // Reset loading state on page visibility change (handles back button)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      authKickLoginBtn.classList.remove('loading');
      authKickLoginBtn.disabled = false;
      const btnText = authKickLoginBtn.querySelector('span');
      if (btnText) {
        btnText.textContent = btnText.getAttribute('data-i18n') ? 
          window.translations?.auth?.login?.kick || 'Prijavi se preko Kicka' : 
          'Prijavi se preko Kicka';
      }
    }
  });

  // Reset loading state on pageshow event (handles back/forward navigation)
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      authKickLoginBtn.classList.remove('loading');
      authKickLoginBtn.disabled = false;
      const btnText = authKickLoginBtn.querySelector('span');
      if (btnText) {
        btnText.textContent = btnText.getAttribute('data-i18n') ? 
          window.translations?.auth?.login?.kick || 'Prijavi se preko Kicka' : 
          'Prijavi se preko Kicka';
      }
    }
  });

  // Reset loading state when modal opens
  const originalOpenModal = openModal;
  window.openModal = function(tab) {
    originalOpenModal(tab);
    authKickLoginBtn.classList.remove('loading');
    authKickLoginBtn.disabled = false;
    const btnText = authKickLoginBtn.querySelector('span');
    if (btnText) {
      btnText.textContent = btnText.getAttribute('data-i18n') ? 
        window.translations?.auth?.login?.kick || 'Prijavi se preko Kicka' : 
        'Prijavi se preko Kicka';
    }
  };
}

const cards = document.querySelectorAll('.feature-card, .pricing-card');
cards.forEach(card => {
  let cardTimeout = null;
  card.addEventListener('mousemove', e => {
    // Disable on mobile/tablet devices (< 1024px)
    if (window.innerWidth < 1024) return;
    
    if (cardTimeout) return;
    cardTimeout = setTimeout(() => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
      cardTimeout = null;
    }, 16); // ~60fps max
  });
});

// ── Enter Key Bindings ─────────────────────────────────────
function bindEnterKey(inputId, buttonId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const btn = document.getElementById(buttonId);
        if (btn) btn.click();
      }
    });
  }
}

bindEnterKey('loginEmail', 'loginBtn');
bindEnterKey('loginPassword', 'loginBtn');
bindEnterKey('signupName', 'signupBtn');
bindEnterKey('signupEmail', 'signupBtn');
bindEnterKey('signupPassword', 'signupBtn');
bindEnterKey('forgotEmail', 'forgotBtn');

// ── Init ──────────────────────────────────────────────────
setLang(currentLang);

if (window.location.search.includes('from=kickall')) {
  sessionStorage.setItem('from_kickall', 'true');
} else if (!window.location.search.includes('action=login') && !window.location.search.includes('action=logout')) {
  sessionStorage.removeItem('from_kickall');
}

if (window.location.search.includes('reset=true')) {
  openModal('login');
  showToast('info', currentLang === 'sr' ? 'Unesi novu lozinku' : 'Enter your new password', '🔑');
} else if (window.location.search.includes('action=login')) {
  openModal('login');
} else if (window.location.search.includes('action=logout')) {
  handleLogout();
}

async function handleLogout() {
  try {
    let userId = null;
    if (typeof sb !== 'undefined' && sb && sb.auth) {
      const { data } = await sb.auth.getSession();
      userId = data?.session?.user?.id;
    }
    localStorage.removeItem('kick_access_token');
    localStorage.removeItem('kick_token_type');
    localStorage.removeItem('kick_session_active');
    localStorage.removeItem('kick_oauth_state');
    localStorage.removeItem('kick_code_verifier');
    sessionStorage.clear();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('sb-') || key.includes('auth-token') || key.startsWith('kick_'))) {
        localStorage.removeItem(key);
      }
    }
    if (typeof sb !== 'undefined' && sb && sb.auth) {
      await Promise.race([
        sb.auth.signOut(),
        new Promise(resolve => setTimeout(resolve, 400))
      ]);
    }
  } catch (e) {
    // Silently fail - logout error
  } finally {
    const cleanUrl = window.location.origin + window.location.pathname;
    window.location.replace(cleanUrl);
  }
}

// ─────────────────────────────────────────────────────────────
// Cursor Glow / Mouse Spotlight Effect (Global - Debounced for performance)
// ─────────────────────────────────────────────────────────────
(function initCursorSpotlight() {
    let spotlightTimeout = null;
    window.addEventListener('mousemove', (e) => {
        // Disable on mobile/tablet devices (< 1024px)
        if (window.innerWidth < 1024) return;
        
        if (spotlightTimeout) return;
        spotlightTimeout = setTimeout(() => {
            document.body.style.setProperty('--mouse-x', `${e.clientX}px`);
            document.body.style.setProperty('--mouse-y', `${e.clientY}px`);
            spotlightTimeout = null;
        }, 16); // ~60fps max
    });
})();

// ─────────────────────────────────────────────────────────────
// Spotlight Glow & Back To Top Integration
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    function scrollToTop() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Re-apply translations when user returns to tab (fixes alt-tab issue)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && currentUser) {
            const heroPrimaryBtnText = document.getElementById('heroPrimaryBtnText');
            const ctaPrimaryBtnText = document.getElementById('ctaPrimaryBtnText');
            if (heroPrimaryBtnText) heroPrimaryBtnText.textContent = t('nav.goToDashboard');
            if (ctaPrimaryBtnText) ctaPrimaryBtnText.textContent = t('nav.goToDashboard');
        }
    });

    // Smooth scroll za sve navigacione linkove
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            const href = anchor.getAttribute('href');
            if (!href || href === '#') {
                e.preventDefault();
                scrollToTop();
                return;
            }

            try {
                const targetEl = document.querySelector(href);
                if (targetEl) {
                    e.preventDefault();
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            } catch (error) {
                // Silent fail for invalid selectors
            }
        });
    });

    // Back to Top dugme
    const backToTopBtn = document.getElementById('backToTopBtn');
    if (backToTopBtn) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) {
                backToTopBtn.classList.add('visible');
            } else {
                backToTopBtn.classList.remove('visible');
            }
        });

        backToTopBtn.addEventListener('click', (e) => {
            e.preventDefault();
            scrollToTop();
        });
    }
});