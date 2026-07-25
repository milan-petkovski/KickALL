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

// ── Supabase Init ──────────────────────────────────────────
const SUPABASE_URL = 'https://rcukparptzzyssqdmydt.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjdWtwYXJwdHp6eXNzcWRteWR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0Nzc3NzEsImV4cCI6MjA5OTA1Mzc3MX0.5FLpFchORq6h5O0q5HWWYBiRD6qCPZKGjx3Zo4UhlJc';

const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    storage: window.localStorage,
    storageKey: 'kickbot-supabase-auth'
  }
});

let currentUser = null;

// Track Referral Code from URL
(function checkReferralParam() {
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      localStorage.setItem('kickot_referral_code', ref.trim().toUpperCase());
    }
  } catch (e) {}
})();

// ── Translations ─�async function setLang(lang) {
// ── Translations ──
function t(key) {
  const keys = key.split('.');
  let value = translations[currentLang];
  for (const k of keys) {
    if (value && typeof value === 'object') {
      value = value[k];
    } else {
      return key;
    }
  }
  return value || key;
}

async function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('kickall-lang', lang);
  localStorage.setItem('kickall_lang', lang);
  document.documentElement.lang = lang === 'sr' ? 'sr' : 'en';

  document.body.classList.toggle('lang-sr', lang === 'sr');
  document.body.classList.toggle('lang-en', lang === 'en');

  try {
    const res = await fetch(`locales/${lang}.json`);
    if (res.ok) {
      const data = await res.json();
      translations[lang] = { ...translations[lang], ...data };
      applyJsonTranslations(data);
    }
  } catch (e) {
    console.log('JSON i18n load error in kickot:', e);
  }

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const text = translations[lang] ? translations[lang][key] : undefined;
    if (text !== undefined) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = text;
      } else {
        el.innerHTML = text;
      }
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const text = translations[lang] ? translations[lang][key] : undefined;
    if (text) el.placeholder = text;
  });

  const heroPrimaryBtn = document.getElementById('heroPrimaryBtn');
  const heroPrimaryBtnText = document.getElementById('heroPrimaryBtnText');
  if (heroPrimaryBtn && heroPrimaryBtnText && currentUser) {
    const t = window.translations || {};
    const userProfile = t.userProfile || {};
    heroPrimaryBtnText.textContent = userProfile.goToDashboard || (lang === 'sr' ? 'Idi na Dashboard' : 'Go to Dashboard');
  }

  const btnSr = document.getElementById('btn-sr');
  const btnEn = document.getElementById('btn-en');
  if (btnSr) btnSr.classList.toggle('active', lang === 'sr');
  if (btnEn) btnEn.classList.toggle('active', lang === 'en');

  document.title = t('meta.title');
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = t('meta.desc');
}

function applyJsonTranslations(obj, prefix = '') {
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      applyJsonTranslations(obj[key], fullKey);
    } else {
      const elements = document.querySelectorAll(`[data-i18n="${fullKey}"]`);
      elements.forEach(el => {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.placeholder = obj[key];
        } else {
          el.innerHTML = obj[key];
        }
      });
    }
  }
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
    const target = document.querySelector(a.getAttribute('href'));
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }
  });
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
    console.warn('Audio is blocked or not supported:', e);
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
  const replyText = item.getAttribute('data-reply');
  const previewContainer = document.getElementById('cmdPreviewContent');

  if (previewContainer) {
    previewContainer.innerHTML = `
      <div class="cp-line"><span class="cp-user">Gledalac:</span> <span class="cp-msg">${cmdName}</span></div>
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
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:5500/auth/kick/callback/'; // Use fixed callback URL for consistency
  }
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

  const state = generateRandomString(16);
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  localStorage.setItem('kick_oauth_state', state);
  localStorage.setItem('kick_code_verifier', codeVerifier);
  localStorage.setItem('kick_origin_site', 'kickot');
  sessionStorage.setItem('kick_oauth_state', state);
  sessionStorage.setItem('kick_code_verifier', codeVerifier);
  sessionStorage.setItem('kick_origin_site', 'kickot');

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
        const fromKickAll = sessionStorage.getItem('from_kickall') === 'true';
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
        const fromKickAll = sessionStorage.getItem('from_kickall') === 'true';
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

    const heroPrimaryBtn = document.getElementById('heroPrimaryBtn');
    const heroPrimaryBtnText = document.getElementById('heroPrimaryBtnText');
    if (heroPrimaryBtn && heroPrimaryBtnText) {
      heroPrimaryBtn.onclick = () => { window.location.href = 'dashboard.html'; };
      const t = window.translations || {};
      const userProfile = t.userProfile || {};
      heroPrimaryBtnText.textContent = userProfile.goToDashboard || (currentLang === 'sr' ? 'Idi na Dashboard' : 'Go to Dashboard');
      heroPrimaryBtnText.removeAttribute('data-i18n');
    }
  } else {
    if (guestNav) guestNav.style.display = 'flex';
    if (userMenu) userMenu.classList.remove('visible');

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
        const t = window.translations || {};
        const userProfile = t.userProfile || {};
        ctaPrimaryBtnText.textContent = userProfile.goToDashboard || (currentLang === 'sr' ? 'Idi na Dashboard' : 'Go to Dashboard');
        ctaPrimaryBtnText.removeAttribute('data-i18n');
      } else {
        ctaPrimaryBtn.onclick = () => { openModal('login'); };
        ctaPrimaryBtnText.setAttribute('data-i18n', 'cta.primary');
        ctaPrimaryBtnText.textContent = currentLang === 'sr' ? 'Prijavi se' : 'Login';
      }
    }
}

// ── Toast Notifications ────────────────────────────────────
let toastIdCounter = 0;

function showToast(type, msg, icon = '💬', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const id = ++toastIdCounter;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.id = `toast-${id}`;
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-body"><div class="toast-msg">${msg}</div></div>
    <button class="toast-close" onclick="removeToast(${id})">✕</button>
  `;
  container.appendChild(toast);

  setTimeout(() => removeToast(id), duration);
}

function removeToast(id) {
  const el = document.getElementById(`toast-${id}`);
  if (el) {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 300);
  }
}

// ── Auth Listener & Spotlight ──────────────────────────────
sb.auth.onAuthStateChange((event, session) => {
  onUserChange(session?.user || null);
});

const cards = document.querySelectorAll('.feature-card, .pricing-card');
cards.forEach(card => {
  let cardTimeout = null;
  card.addEventListener('mousemove', e => {
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
    console.error("Logout greška:", e);
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
        if (spotlightTimeout) return;
        spotlightTimeout = setTimeout(() => {
            document.body.style.setProperty('--mouse-x', `${e.clientX}px`);
            document.body.style.setProperty('--mouse-y', `${e.clientY}px`);
            spotlightTimeout = null;
        }, 16); // ~60fps max
    });
})();

// ─────────────────────────────────────────────────────────────
// Lenis Smooth Scroll & Spotlight Glow & Back To Top Integration
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    let lenis = null;
    if (typeof window.Lenis !== 'undefined') {
        lenis = new window.Lenis({
            duration: 1.0,
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
            direction: 'vertical',
            gestureDirection: 'vertical',
            smoothTouch: false,
            smoothWheel: true,
            wheelMultiplier: 1,
            touchMultiplier: 2,
            infinite: false
        });
        window.lenisInstance = lenis;

        function lenisRaf(time) {
            lenis.raf(time);
            requestAnimationFrame(lenisRaf);
        }
        requestAnimationFrame(lenisRaf);
    }

    function scrollToTop() {
        if (window.lenisInstance) {
            window.lenisInstance.scrollTo(0);
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    // Smooth scroll za sve navigacione linkove
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            const href = anchor.getAttribute('href');
            if (!href || href === '#') {
                e.preventDefault();
                scrollToTop();
                return;
            }

            const targetEl = document.querySelector(href);
            if (targetEl) {
                e.preventDefault();
                if (window.lenisInstance) {
                    window.lenisInstance.scrollTo(targetEl, { offset: -80, duration: 1.2 });
                } else {
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
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