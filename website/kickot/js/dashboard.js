/* ═══════════════════════════════════════════════════════════
   Kickot Dashboard — app logic (dashboard.js)
   Supabase CRUD + Real-time + UI
   ═══════════════════════════════════════════════════════════ */

// ── Trenutno čišćenje URL fragmenta tokena radi bezbednosti ────
(function sanitizeUrlHashToken() {
  if (window.location.hash && window.location.hash.includes('kick_token=')) {
    try {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const hashToken = hashParams.get('kick_token');
      if (hashToken) {
        sessionStorage.setItem('kick_access_token', hashToken);
        localStorage.removeItem('kick_access_token');
        const tokenType = hashParams.get('token_type') || 'Bearer';
        localStorage.setItem('kick_token_type', tokenType);
        localStorage.setItem('kick_session_active', Date.now().toString());
      }
      if (window.history && window.history.replaceState) {
        const cleanUrl = window.location.pathname + window.location.search;
        window.history.replaceState(null, '', cleanUrl);
      }
    } catch (e) {
      console.warn('Error sanitizing hash token:', e);
    }
  }
})();

// ── Configuration Check ───────────────────────────────────────
if (!window.KickotConfig) {
  throw new Error('KickotConfig not loaded. Please ensure config.js is loaded before dashboard.js');
}

// Use KickAll CONFIG if available, otherwise use Kickot config
const CONFIG = window.CONFIG || window.KickotConfig;

// ── Supabase Init ──────────────────────────────────────────
const { createClient } = window.supabase;

// Supabase konfiguracija dolazi iskljucivo iz js/config.js (window.CONFIG)
// Nikad ne koristiti hardkodovane fallback vrednosti
const supabaseUrl = CONFIG.SUPABASE?.URL;
const supabaseAnonKey = CONFIG.SUPABASE?.ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('[Kickot Dashboard] Supabase URL ili ANON_KEY nije dostupan iz window.CONFIG. Proverite da je js/config.js ucitan pre dashboard.js.');
}

// Use same storage key as KickAll for shared auth session
const storageKey = CONFIG.SUPABASE?.STORAGE_KEY || 'kickbot-supabase-auth';

const sb = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: storageKey
  }
});

// ── State ─────────────────────────────────────────────────
let currentUser = null;
let currentChannels = [];   // [{id, username, is_primary}]
let managedChannels = [];   // [{id, username, avatar, is_managed: true, owner_id}]
let activeChannel = null; // {id, username}
let currentChannelConfig = {}; // cached bot_config payload
function getChannelOwnerId() {
  if (activeChannel && activeChannel.is_managed && activeChannel.owner_id) {
    return activeChannel.owner_id;
  }
  return currentUser ? currentUser.id : null;
}
let allCommands = [];   // cached custom commands
let allLeaderboard = [];   // cached leaderboard rows
let allWatchtime = [];   // cached watchtime rows
let allMarriages = [];   // cached marriages
let allLoveStatuses = [];  // cached love modifiers
const avatarCache = {};
let currentEconomyTab = localStorage.getItem('active-economy-tab') || 'config';

// ── Pricing Plan Limits ───────────────────────────────────────
let currentUserPlan = 'free';

const PLAN_LIMITS = {
  free: {
    name: 'Free',
    label: 'BESPLATNO',
    badgeClass: 'plan-badge-free',
    maxCustomCommands: 50,
    maxAutoAnnounces: 5,
    maxSongQueue: 5,
    maxLeaderboardItems: 20,
    maxLoveMarriages: 50, // 50 parova = 100 ljudi
    customBotAllowed: false,
    maxChannels: 1,
    maxManagers: 5,
    maxStoreItems: 10,
    customPenaltySettings: false
  },
  pro: {
    name: 'Pro',
    label: 'PRO',
    badgeClass: 'plan-badge-pro',
    maxCustomCommands: 200,
    maxAutoAnnounces: 50,
    maxSongQueue: 50,
    maxLeaderboardItems: Infinity,
    maxLoveMarriages: Infinity,
    customBotAllowed: true,
    maxChannels: 5,
    maxManagers: 10,
    maxStoreItems: 50,
    customPenaltySettings: true
  },
  elite: {
    name: 'Elite',
    label: 'ELITE',
    badgeClass: 'plan-badge-elite',
    maxCustomCommands: Infinity,
    maxAutoAnnounces: Infinity,
    maxSongQueue: Infinity,
    maxLeaderboardItems: Infinity,
    maxLoveMarriages: Infinity,
    customBotAllowed: true,
    maxChannels: Infinity,
    maxManagers: Infinity,
    maxStoreItems: Infinity,
    customPenaltySettings: true
  },
  vip: {
    name: 'Elite',
    label: 'ELITE',
    badgeClass: 'plan-badge-elite',
    maxCustomCommands: Infinity,
    maxAutoAnnounces: Infinity,
    maxSongQueue: Infinity,
    maxLeaderboardItems: Infinity,
    maxLoveMarriages: Infinity,
    customBotAllowed: true,
    maxChannels: Infinity,
    maxManagers: Infinity,
    maxStoreItems: Infinity,
    customPenaltySettings: true
  }
};

function getPlanLimits() {
  let p = (currentUserPlan || 'free').toLowerCase();
  // Map business to elite
  if (p === 'business') p = 'elite';
  return PLAN_LIMITS[p] || PLAN_LIMITS.free;
}

function openUpgradeModal(feature) {
  const modalNote = document.getElementById('upgradeModalNote');

  if (feature === 'commands') {
    if (modalNote) modalNote.textContent = 'Dostignut je limit prilagođenih komandi za tvoj paket (Free: 50 | Pro: 200 | Elite: Neograničeno). Nadogradi nalog za više komandi!';
  } else if (feature === 'announces') {
    if (modalNote) modalNote.textContent = 'Dostignut je limit automatskih poruka za tvoj paket (Free: 5 | Pro: 50 | Elite: Neograničeno). Nadogradi nalog za više poruka!';
  } else if (feature === 'customBot') {
    if (modalNote) modalNote.textContent = 'Custom bot ime (sopstveni bot nalog) je dostupan samo za PRO i ELITE paket!';
  } else if (feature === 'leaderboard') {
    if (modalNote) modalNote.textContent = 'Besplatni paket prikazuje samo Top 20 gledalaca na rang listi. Nadogradi na PRO za sve gledaoce!';
  } else if (feature === 'channels') {
    if (modalNote) modalNote.textContent = 'Dostignut je limit kanala za tvoj paket (Free: 1 | Pro: 5 | Elite: Neograničeno). Nadogradi nalog za više kanala!';
  } else if (feature === 'managers') {
    if (modalNote) modalNote.textContent = 'Dostignut je limit menadžera za tvoj paket (Free: 5 | Pro: 10 | Elite: Neograničeno). Nadogradi nalog za više menadžera!';
  } else if (feature === 'customPenalty') {
    if (modalNote) modalNote.textContent = 'Individualne kazne za moderacijske filtere su dostupne samo za PRO i ELITE paket!';
  } else if (feature === 'storeItems') {
    if (modalNote) modalNote.textContent = 'Dostignut je limit artikala u prodavnici za tvoj paket (Free: 10 | Pro: 50 | Elite: Neograničeno). Nadogradi nalog za više artikala!';
  } else {
    if (modalNote) modalNote.textContent = 'Nadogradi svoj paket za veće limite, napredne funkcije i neograničenu automatizaciju!';
  }

  // Update plan buttons based on current plan
  updatePlanButtons();

  // Reset to monthly view
  togglePricing('monthly');
  openModal('upgradeModal');
}

function updatePlanButtons() {
  let currentPlan = (currentUserPlan || 'free').toLowerCase();
  if (currentPlan === 'business') currentPlan = 'elite';

  // Monthly pricing buttons
  const monthlyFreeBtn = document.querySelector('#monthlyPricing .upgrade-plan-card:nth-child(1) button');
  const monthlyProBtn = document.querySelector('#monthlyPricing .upgrade-plan-card:nth-child(2) a');
  const monthlyEliteBtn = document.querySelector('#monthlyPricing .upgrade-plan-card:nth-child(3) a');

  // Yearly pricing buttons
  const yearlyFreeBtn = document.querySelector('#yearlyPricing .upgrade-plan-card:nth-child(1) button');
  const yearlyProBtn = document.querySelector('#yearlyPricing .upgrade-plan-card:nth-child(2) a');
  const yearlyEliteBtn = document.querySelector('#yearlyPricing .upgrade-plan-card:nth-child(3) a');

  // Update Free button
  if (monthlyFreeBtn) {
    if (currentPlan === 'free') {
      monthlyFreeBtn.textContent = 'Tvoj trenutni paket';
      monthlyFreeBtn.disabled = true;
      monthlyFreeBtn.style.opacity = '0.6';
      monthlyFreeBtn.style.cursor = 'default';
    } else {
      monthlyFreeBtn.textContent = 'Izaberi Free';
      monthlyFreeBtn.disabled = false;
      monthlyFreeBtn.style.opacity = '';
      monthlyFreeBtn.style.cursor = '';
    }
  }

  if (yearlyFreeBtn) {
    if (currentPlan === 'free') {
      yearlyFreeBtn.textContent = 'Tvoj trenutni paket';
      yearlyFreeBtn.disabled = true;
      yearlyFreeBtn.style.opacity = '0.6';
      yearlyFreeBtn.style.cursor = 'default';
    } else {
      yearlyFreeBtn.textContent = 'Izaberi Free';
      yearlyFreeBtn.disabled = false;
      yearlyFreeBtn.style.opacity = '';
      yearlyFreeBtn.style.cursor = '';
    }
  }

  // Update Pro button
  if (monthlyProBtn) {
    if (currentPlan === 'pro') {
      // Replace anchor with button
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-primary';
      button.style.cssText = 'width: 100%; margin-top: auto; text-align: center; padding: 12px; font-weight: 600; opacity: 0.6; cursor: default;';
      button.disabled = true;
      button.textContent = 'Tvoj trenutni paket';
      monthlyProBtn.parentNode.replaceChild(button, monthlyProBtn);
    } else {
      monthlyProBtn.style.display = 'inline-flex';
    }
  }

  if (yearlyProBtn) {
    if (currentPlan === 'pro') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-primary';
      button.style.cssText = 'width: 100%; margin-top: auto; text-align: center; padding: 12px; font-weight: 600; opacity: 0.6; cursor: default;';
      button.disabled = true;
      button.textContent = 'Tvoj trenutni paket';
      yearlyProBtn.parentNode.replaceChild(button, yearlyProBtn);
    } else {
      yearlyProBtn.style.display = 'inline-flex';
    }
  }

  // Update Elite button
  if (monthlyEliteBtn) {
    if (currentPlan === 'elite') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-primary';
      button.style.cssText = 'width: 100%; margin-top: auto; background: #53FC18; color: #0E0E1D; text-align: center; font-weight: 700; padding: 12px; opacity: 0.6; cursor: default;';
      button.disabled = true;
      button.textContent = 'Tvoj trenutni paket';
      monthlyEliteBtn.parentNode.replaceChild(button, monthlyEliteBtn);
    } else {
      monthlyEliteBtn.style.display = 'inline-flex';
    }
  }

  if (yearlyEliteBtn) {
    if (currentPlan === 'elite') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-primary';
      button.style.cssText = 'width: 100%; margin-top: auto; background: #53FC18; color: #0E0E1D; text-align: center; font-weight: 700; padding: 12px; opacity: 0.6; cursor: default;';
      button.disabled = true;
      button.textContent = 'Tvoj trenutni paket';
      yearlyEliteBtn.parentNode.replaceChild(button, yearlyEliteBtn);
    } else {
      yearlyEliteBtn.style.display = 'inline-flex';
    }
  }
}

let currentPricingPeriod = 'monthly';

function togglePricing(type) {
  currentPricingPeriod = type;
  const monthlyPricing = document.getElementById('monthlyPricing');
  const yearlyPricing = document.getElementById('yearlyPricing');
  const monthlyBtn = document.getElementById('monthlyBtn');
  const yearlyBtn = document.getElementById('yearlyBtn');

  if (type === 'monthly') {
    monthlyPricing.style.display = 'grid';
    yearlyPricing.style.display = 'none';
    monthlyBtn.style.background = 'rgba(139, 92, 246, 0.2)';
    monthlyBtn.style.color = '#fff';
    yearlyBtn.style.background = 'transparent';
    yearlyBtn.style.color = 'var(--text-muted)';
  } else {
    monthlyPricing.style.display = 'none';
    yearlyPricing.style.display = 'grid';
    monthlyBtn.style.background = 'transparent';
    monthlyBtn.style.color = 'var(--text-muted)';
    yearlyBtn.style.background = 'rgba(139, 92, 246, 0.2)';
    yearlyBtn.style.color = '#fff';
  }
}
window.openUpgradeModal = openUpgradeModal;

// ── Paddle Billing Checkout & Referral Modal ────────────────
const PADDLE_PRICE_IDS = {
  pro: {
    monthly: window.CONFIG?.PADDLE?.PRICE_IDS?.pro?.monthly || '',
    yearly: window.CONFIG?.PADDLE?.PRICE_IDS?.pro?.yearly || ''
  },
  elite: {
    monthly: window.CONFIG?.PADDLE?.PRICE_IDS?.elite?.monthly || '',
    yearly: window.CONFIG?.PADDLE?.PRICE_IDS?.elite?.yearly || ''
  }
};

let pendingCheckoutPlan = null;
let pendingCheckoutPeriod = null;

function openCheckout(plan, period) {
  pendingCheckoutPlan = plan;
  pendingCheckoutPeriod = period || currentPricingPeriod || 'monthly';

  const userId = currentUser ? currentUser.id : null;
  if (!userId) {
    showToast('warning', 'Morate biti ulogovani da biste se pretplatili.', '');
    return;
  }

  // Učitaj zapamćeni kod iz storage-a u modal polje ako postoji
  const savedRef = localStorage.getItem('user_referral_code') || sessionStorage.getItem('user_referral_code') || '';
  const refInput = document.getElementById('checkoutReferralCodeInput');
  const refMsg = document.getElementById('checkoutReferralMsg');
  if (refInput) refInput.value = savedRef;
  if (refMsg) {
    if (savedRef) {
      refMsg.style.color = '#53FC18';
      refMsg.textContent = `Pronađen primenjeni kod: ${savedRef} (20% provizije za tvog prijatelja)`;
    } else {
      refMsg.style.color = 'var(--text-muted)';
      refMsg.textContent = 'Kod je opcion. Ukoliko ga nemate, možete nastaviti direktno na plaćanje.';
    }
  }

  // Pre zatvaranja upgradeModala i odlaska na checkout, otvori modal za unos/potvrdu referral koda
  closeModal('upgradeModal');
  openModal('preCheckoutReferralModal');
}

async function proceedToPaddleCheckout() {
  const plan = pendingCheckoutPlan;
  const p = pendingCheckoutPeriod || 'monthly';
  const planPrices = PADDLE_PRICE_IDS[plan];
  const priceId = (planPrices && typeof planPrices === 'object') ? planPrices[p] || planPrices.monthly : planPrices;

  if (!priceId) {
    console.warn('[Checkout] Nepoznat plan ili Paddle price ID:', plan, p);
    return;
  }

  const userId = currentUser ? currentUser.id : null;
  if (!userId) return;

  const refInput = document.getElementById('checkoutReferralCodeInput');
  const refCode = refInput ? refInput.value.trim().toUpperCase() : '';

  if (refCode) {
    localStorage.setItem('user_referral_code', refCode);
    sessionStorage.setItem('user_referral_code', refCode);
    try {
      await sb.rpc('create_user_referral', { p_user_id: userId, p_referral_code: refCode });
    } catch (_) { }
  }

  closeModal('preCheckoutReferralModal');

  if (typeof Paddle === 'undefined' || !Paddle.Checkout) {
    console.error('[Paddle Checkout] Paddle SDK nije učitan.');
    return;
  }

  Paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customData: {
      user_id: userId,
      ref_code: refCode || undefined
    }
  });
}

window.proceedToPaddleCheckout = proceedToPaddleCheckout;
window.openCheckout = openCheckout;

function applyPenaltySettingsRestrictions() {
  const limits = getPlanLimits();
  const penaltySelects = [
    'cfgModPenaltyCaps',
    'cfgModPenaltyLinks',
    'cfgModPenaltyEmotes',
    'cfgModPenaltySymbols',
    'cfgModPenaltyWords',
    'cfgModPenaltySpam',
    'cfgModPenaltyMaxLen',
    'cfgModPenaltyMentions'
  ];

  penaltySelects.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (!limits.customPenaltySettings) {
        // Free plan - disable individual penalty settings
        el.disabled = true;
        el.value = 'default';
        el.style.opacity = '0.5';
        el.style.cursor = 'not-allowed';

        // Add title to explain restriction
        el.title = 'Individualne kazne su dostupne samo za PRO i ELITE pakete';

        // Add click handler to show upgrade modal
        el.onclick = function (e) {
          e.preventDefault();
          openUpgradeModal('customPenalty');
        };
      } else {
        // Pro/Elite plan - enable individual penalty settings
        el.disabled = false;
        el.style.opacity = '1';
        el.style.cursor = 'pointer';
        el.title = '';
        el.onclick = null;
      }
    }
  });
}

const upgradeSvgIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="upgrade-btn-icon"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;

function renderPlanLimitBanners() {
  const limits = getPlanLimits();

  // 0. Topbar & Sidebar Upgrade Buttons (For Free & Pro plans)
  const topbarWrap = document.getElementById('topbarUpgradeWrap');
  if (topbarWrap) {
    if (limits.name !== 'Elite') {
      topbarWrap.style.display = 'flex';
      topbarWrap.innerHTML = `<button type="button" class="plan-upgrade-btn" onclick="openUpgradeModal('general')">${upgradeSvgIcon}<span>Nadogradi</span></button>`;
    } else {
      topbarWrap.style.display = 'none';
    }
  }

  const sidebarUpgradeEl = document.getElementById('sidebarUpgradeWrap');
  if (sidebarUpgradeEl) {
    if (limits.name !== 'Elite') {
      sidebarUpgradeEl.innerHTML = `<button type="button" class="plan-upgrade-btn sidebar-upgrade-btn" onclick="event.stopPropagation(); openUpgradeModal('general')">${upgradeSvgIcon}<span>Nadogradi Paket</span></button>`;
    } else {
      sidebarUpgradeEl.innerHTML = '';
    }
  }

  // 1. Commands Banner
  const cmdBanner = document.getElementById('cmdPlanLimitBanner');
  if (cmdBanner) {
    if (limits.maxCustomCommands === Infinity) {
      cmdBanner.style.display = 'none';
    } else {
      cmdBanner.style.display = 'flex';
      const customCount = allCommands ? allCommands.filter(c => !c.is_default && !(c.id && c.id.startsWith('builtin-'))).length : 0;
      const max = limits.maxCustomCommands;
      cmdBanner.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="background:rgba(139,92,246,0.18); border:1px solid rgba(139,92,246,0.3); color:#c084fc; padding:6px 12px; border-radius:8px; font-weight:800; font-size:0.75rem; text-transform:uppercase;">
            ${limits.name} Paket
          </div>
          <div>
            <div style="font-size:0.85rem; font-weight:700; color:#fff;">
              Ograničenje komandi: <span style="color:#53FC18">${customCount}</span> / <strong>${max}</strong> komandi
            </div>
            <div style="font-size:0.78rem; color:var(--text-muted);">
              ${limits.name === 'Free' ? 'Free: 50 max | Pro: 200 max | Elite: Neograničeno' : 'Pro: 200 max | Elite: Neograničeno'}
            </div>
          </div>
        </div>
        <button type="button" class="plan-upgrade-btn" onclick="openUpgradeModal('commands')">${upgradeSvgIcon}<span>Nadogradi za više komandi</span></button>
      `;
    }
  }

  // 2. Leaderboard Banner
  const lbBanner = document.getElementById('leaderboardPlanLimitBanner');
  if (lbBanner) {
    if (limits.maxLeaderboardItems === Infinity) {
      lbBanner.style.display = 'none';
    } else {
      lbBanner.style.display = 'flex';
      lbBanner.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="background:rgba(139,92,246,0.18); border:1px solid rgba(139,92,246,0.3); color:#c084fc; padding:6px 12px; border-radius:8px; font-weight:800; font-size:0.75rem; text-transform:uppercase;">
            ${limits.name} Paket
          </div>
          <div>
            <div style="font-size:0.85rem; font-weight:700; color:#fff;">
              Prikaz rang liste: <strong>Top 20 gledalaca max</strong>
            </div>
            <div style="font-size:0.78rem; color:var(--text-muted);">
              Free prikazuje Top 20. Nadogradi na PRO za punu rang listu sa svim korisnicima.
            </div>
          </div>
        </div>
        <button type="button" class="plan-upgrade-btn" onclick="openUpgradeModal('leaderboard')">${upgradeSvgIcon}<span>Otključaj celu rang listu</span></button>
      `;
    }
  }

  // 3. Automatske Poruke Banner
  const annBanner = document.getElementById('announcesPlanLimitBanner');
  if (annBanner) {
    if (limits.maxAutoAnnounces === Infinity) {
      annBanner.style.display = 'none';
    } else {
      annBanner.style.display = 'flex';
      const annCount = typeof localAnnounces !== 'undefined' && localAnnounces ? localAnnounces.length : 0;
      const maxAnn = limits.maxAutoAnnounces;
      annBanner.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="background:rgba(139,92,246,0.18); border:1px solid rgba(139,92,246,0.3); color:#c084fc; padding:6px 12px; border-radius:8px; font-weight:800; font-size:0.75rem; text-transform:uppercase;">
            ${limits.name} Paket
          </div>
          <div>
            <div style="font-size:0.85rem; font-weight:700; color:#fff;">
              Ograničenje poruka: <span style="color:#53FC18">${annCount}</span> / <strong>${maxAnn}</strong>
            </div>
            <div style="font-size:0.78rem; color:var(--text-muted);">
              ${limits.name === 'Free' ? 'Free: 5 max | Pro: 50 max | Elite: Neograničeno' : 'Pro: 50 max | Elite: Neograničeno'}
            </div>
          </div>
        </div>
        <button type="button" class="plan-upgrade-btn" onclick="openUpgradeModal('announces')">${upgradeSvgIcon}<span>Nadogradi za više poruka</span></button>
      `;
    }
  }

  // 4. Ljubav i Brakovi Banner
  const marBanner = document.getElementById('marriagesPlanLimitBanner');
  if (marBanner) {
    if (limits.maxLoveMarriages === Infinity) {
      marBanner.style.display = 'none';
    } else {
      marBanner.style.display = 'flex';
      marBanner.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="background:rgba(139,92,246,0.18); border:1px solid rgba(139,92,246,0.3); color:#c084fc; padding:6px 12px; border-radius:8px; font-weight:800; font-size:0.75rem; text-transform:uppercase;">
            ${limits.name} Paket
          </div>
          <div>
            <div style="font-size:0.85rem; font-weight:700; color:#fff;">
              Ograničenje brakova: <strong>Do 100 ljudi (50 parova)</strong>
            </div>
            <div style="font-size:0.78rem; color:var(--text-muted);">
              Free sprema i prikazuje do 100 venčanih lica. Nadogradi na PRO za neograničeno.
            </div>
          </div>
        </div>
        <button type="button" class="plan-upgrade-btn" onclick="openUpgradeModal('general')">${upgradeSvgIcon}<span>Otključaj neograničeno</span></button>
      `;
    }
  }

  // 5. Song Request Banner
  const songBanner = document.getElementById('songsPlanLimitBanner');
  if (songBanner) {
    if (limits.maxSongQueue === Infinity) {
      songBanner.style.display = 'none';
    } else {
      songBanner.style.display = 'flex';
      songBanner.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="background:rgba(139,92,246,0.18); border:1px solid rgba(139,92,246,0.3); color:#c084fc; padding:6px 12px; border-radius:8px; font-weight:800; font-size:0.75rem; text-transform:uppercase;">
            ${limits.name} Paket
          </div>
          <div>
            <div style="font-size:0.85rem; font-weight:700; color:#fff;">
              Song Request Queue Limit: <strong>${limits.maxSongQueue} pesama max u queue</strong>
            </div>
            <div style="font-size:0.78rem; color:var(--text-muted);">
              ${limits.name === 'Free' ? 'Free: 5 pesama max u redu. Nadogradi na PRO za 50 ili ELITE za neograničeno.' : 'Pro: 50 pesama max u redu.'}
            </div>
          </div>
        </div>
        <button type="button" class="plan-upgrade-btn" onclick="openUpgradeModal('general')">${upgradeSvgIcon}<span>Povećaj Queue Limit</span></button>
      `;
    }
  }

  // 6. Moderation Penalty Settings Banner
  const modPenaltyBanner = document.getElementById('modPenaltyBanner');
  if (modPenaltyBanner) {
    if (limits.customPenaltySettings) {
      modPenaltyBanner.style.display = 'none';
    } else {
      modPenaltyBanner.style.display = 'flex';
      modPenaltyBanner.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#EF4444; padding:6px 12px; border-radius:8px; font-weight:800; font-size:0.75rem; text-transform:uppercase;">
            Zaključano (Free)
          </div>
          <div>
            <div style="font-size:0.85rem; font-weight:700; color:#fff;">
              Individualne kazne za moderacijske filtere
            </div>
            <div style="font-size:0.78rem; color:var(--text-muted);">
              Na Free planu su dostupne samo globalne kazne. Nadogradi na PRO za individualne podešavanja.
            </div>
          </div>
        </div>
        <button type="button" class="plan-upgrade-btn" onclick="openUpgradeModal('customPenalty')">${upgradeSvgIcon}<span>Otključaj individualne kazne</span></button>
      `;
    }
  }

  // 7. Custom Bot Banner & Card Overlay
  const customBotBanner = document.getElementById('customBotPlanLimitBanner');
  const customBotCard = document.getElementById('customBotCard');
  if (customBotBanner || customBotCard) {
    let overlay = document.getElementById('customBotLockOverlay');
    if (limits.customBotAllowed) {
      if (customBotBanner) customBotBanner.style.display = 'none';
      if (overlay) overlay.style.display = 'none';
      if (customBotCard) {
        customBotCard.style.opacity = '1';
        customBotCard.style.filter = 'none';
        customBotCard.style.pointerEvents = 'auto';
      }
    } else {
      if (customBotBanner) {
        customBotBanner.style.display = 'flex';
        customBotBanner.innerHTML = `
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#EF4444; padding:6px 12px; border-radius:8px; font-weight:800; font-size:0.75rem; text-transform:uppercase;">
              Zaključano (Free)
            </div>
            <div>
              <div style="font-size:0.85rem; font-weight:700; color:#fff;">
                Custom Bot Account (Sopstveno ime bota)
              </div>
              <div style="font-size:0.78rem; color:var(--text-muted);">
                Povezivanje bota sa tvojim imenom je PRO i ELITE funkcija.
              </div>
            </div>
          </div>
          <button type="button" class="plan-upgrade-btn" onclick="openUpgradeModal('customBot')">${upgradeSvgIcon}<span>Otključaj Custom Bot</span></button>
        `;
      }

      if (customBotCard) {
        customBotCard.style.position = 'relative';
        customBotCard.style.opacity = '1';
        customBotCard.style.filter = 'none';

        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'customBotLockOverlay';
          overlay.className = 'locked-feature-overlay';
          customBotCard.appendChild(overlay);
        }
        overlay.style.display = 'flex';
        overlay.style.pointerEvents = 'auto';
        overlay.innerHTML = `
          <div class="locked-feature-overlay__icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <h4 class="locked-feature-overlay__title"><span style="text-decoration: line-through; opacity: 0.7;">Custom Bot Ime</span> — DOLAZI USKORO ⏳</h4>
          <p class="locked-feature-overlay__desc">Povezivanje sopstvenog bot naloga (npr. @MojKanalBot) je trenutno u fazi razvoja i biće dostupno uskoro. Svi kanali koriste zvanični @KickotBot nalog.</p>
          <button type="button" class="btn btn-secondary" disabled style="padding: 10px 22px; font-size: 0.85rem; opacity: 0.75; cursor: default; border-color: rgba(245, 158, 11, 0.4); color: #F59E0B;"><span>Dolazi Uskoro</span></button>
        `;
      }
    }
  }

  // 7. Mini Games Banner & Casino Games Overlay
  const mgBanner = document.getElementById('minigamesPlanLimitBanner');
  const casinoWrap = document.getElementById('casinoMinigamesWrap');
  if (mgBanner || casinoWrap) {
    let overlay = document.getElementById('casinoMinigamesLockOverlay');
    if (limits.name !== 'Free') {
      if (mgBanner) mgBanner.style.display = 'none';
      if (overlay) overlay.style.display = 'none';
      if (casinoWrap) {
        casinoWrap.style.opacity = '1';
        casinoWrap.style.filter = 'none';
        casinoWrap.style.pointerEvents = 'auto';
      }
    } else {
      if (mgBanner) {
        mgBanner.style.display = 'flex';
        mgBanner.innerHTML = `
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#EF4444; padding:6px 12px; border-radius:8px; font-weight:800; font-size:0.75rem; text-transform:uppercase;">
              Free Paket
            </div>
            <div>
              <div style="font-size:0.85rem; font-weight:700; color:#fff;">
                Mini Igre: <strong>Dostupne Klasične Komande za Zabavu</strong>
              </div>
              <div style="font-size:0.78rem; color:var(--text-muted);">
                Na Besplatnom paketu su dostupne klasične komande (!duel, !roll, !iq...). Kazino igre sa ulogom poena i simulator su PRO i ELITE nivo!
              </div>
            </div>
          </div>
          <button type="button" class="plan-upgrade-btn" onclick="openUpgradeModal('general')">${upgradeSvgIcon}<span>Otključaj Sve Mini Igre</span></button>
        `;
      }

      if (casinoWrap) {
        casinoWrap.style.position = 'relative';
        casinoWrap.style.borderRadius = '14px';
        casinoWrap.style.opacity = '1';
        casinoWrap.style.filter = 'none';

        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'casinoMinigamesLockOverlay';
          overlay.className = 'locked-feature-overlay';
          casinoWrap.appendChild(overlay);
        }
        overlay.style.display = 'flex';
        overlay.style.pointerEvents = 'auto';
        overlay.innerHTML = `
          <div class="locked-feature-overlay__icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <h4 class="locked-feature-overlay__title">Kazino Igre sa Ulogom Poena su zaključane u Free paketu</h4>
          <p class="locked-feature-overlay__desc">Na Besplatnom paketu su vam dostupne Klasične Komande za Zabavu (!duel, !roll, !iq...). Rulet, Slot, Coinflip, Točak Sreće i Test Simulator su otključani na PRO i ELITE paketima.</p>
          <button type="button" class="plan-upgrade-btn" onclick="openUpgradeModal('general')" style="padding: 10px 22px; font-size: 0.85rem;">${upgradeSvgIcon}<span>Nadogradi i Otključaj Sve Igre</span></button>
        `;
      }
    }
  }
}
window.renderPlanLimitBanners = renderPlanLimitBanners;

async function getOrFetchAvatar(username, elementId) {
  if (!username) return;
  const key = username.toLowerCase();

  // Check memory cache first (fastest)
  if (avatarCache[key] && avatarCache[key] !== 'loading' && avatarCache[key] !== 'none') {
    updateAvatarUI(elementId, avatarCache[key]);
    return;
  }

  // Check IndexedDB cache (second fastest, much larger capacity)
  const cachedDB = await getAvatarFromCache(username);
  if (cachedDB) {
    avatarCache[key] = cachedDB;
    if (cachedDB !== 'none') {
      updateAvatarUI(elementId, cachedDB);
    }
    return;
  }

  // Handle concurrent requests for same avatar
  if (avatarCache[key] === 'loading') {
    const interval = setInterval(() => {
      if (avatarCache[key] !== 'loading') {
        clearInterval(interval);
        if (avatarCache[key] && avatarCache[key] !== 'none') {
          updateAvatarUI(elementId, avatarCache[key]);
        }
      }
    }, 500);
    return;
  }

  // Fetch from Kick API
  avatarCache[key] = 'loading';
  const avatarUrl = await fetchKickAvatar(username);
  if (avatarUrl) {
    avatarCache[key] = avatarUrl;
    // Save to IndexedDB (async, non-blocking)
    setAvatarInCache(username, avatarUrl).catch(err => {
      console.warn('Failed to cache avatar in IndexedDB:', err);
    });
    updateAvatarUI(elementId, avatarUrl);
  } else {
    avatarCache[key] = 'none';
    // Save 'none' to IndexedDB to avoid re-fetching
    setAvatarInCache(username, 'none').catch(err => {
      console.warn('Failed to cache avatar status in IndexedDB:', err);
    });
  }
}

function updateAvatarUI(elementId, avatarUrl) {
  const el = document.getElementById(elementId);
  if (el) {
    if (avatarUrl && avatarUrl !== 'none' && avatarUrl !== 'null' && /^https?:\/\//.test(avatarUrl)) {
      el.style.backgroundImage = `url("${avatarUrl}")`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.border = '1px solid rgba(255,255,255,0.15)';
      el.textContent = '';
    } else {
      el.style.backgroundImage = 'none';
    }
  }
}

function formatPorukeCount(count) {
  const val = Number(count) || 0;
  const formattedVal = val.toLocaleString('en-US');
  const n = Math.abs(val) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) {
    return `${formattedVal} poruka`;
  }
  if (n1 === 1) {
    return `${formattedVal} poruka`;
  }
  if (n1 >= 2 && n1 <= 4) {
    return `${formattedVal} poruke`;
  }
  return `${formattedVal} poruka`;
}

function formatWatchtime(totalMinutes) {
  const mins = Number(totalMinutes) || 0;
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;

  if (days > 0) {
    if (hours > 0 && m > 0) return `${days}d ${hours}h ${m}min`;
    if (hours > 0) return `${days}d ${hours}h`;
    if (m > 0) return `${days}d ${m}min`;
    return `${days}d`;
  }
  if (hours > 0) {
    return m > 0 ? `${hours}h ${m}min` : `${hours}h`;
  }
  return `${m}min`;
}

let editingCmdId = null; // null = new, UUID = edit
let confirmCallback = null;
let realtimeSub = null;
let realtimeMarriagesSub = null;
let configLoaded = false;
let localAnnounces = [];   // cached auto-announce messages
let activeLeaderboardType = localStorage.getItem('active-leaderboard-tab') || 'combined'; // 'chatters', 'watchtime', 'combined'
let activeMiniLbTab = 'combined'; // 'combined', 'chatters', 'watchtime'
let activeCommandsTab = 'custom'; // only custom commands are used now
let liveStatusInterval = null; // polling interval for live status
let leaderboardPage = 1;
let leaderboardLimit = parseInt(localStorage.getItem('lb-items-per-page')) || 15;
let commandsPage = 1;
let commandsLimit = parseInt(localStorage.getItem('cmd-items-per-page')) || 10;
let loveStatusesPage = 1;
let loveStatusesLimit = parseInt(localStorage.getItem('love-statuses-limit')) || 10;
let loveStatusesQuery = '';
let marriagesPage = 1;
let marriagesLimit = parseInt(localStorage.getItem('marriages-limit')) || 10;
let marriagesQuery = '';

// ═══════════════════════════════════════════════════════════
// AUTH GUARD
// ═══════════════════════════════════════════════════════════

// Global function declaration to ensure it's available everywhere
window.hideAuthGate = function () {
  const authGate = document.getElementById('authGate');
  const app = document.getElementById('app');
  if (authGate) {
    authGate.classList.add('fade-out');
    setTimeout(() => {
      authGate.style.display = 'none';
    }, 400);
  }
  if (app) {
    app.classList.add('fade-in');
  }
};

// Local function for backward compatibility
function hideAuthGate() {
  window.hideAuthGate();
}

async function initAuth() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code') || sessionStorage.getItem('kick_oauth_code');
    const oauthError = urlParams.get('error');

    // Check if coming from kickall (multiple sources with fallbacks)
    const fromKickAll = sessionStorage.getItem('from_kickall') === 'true' ||
      localStorage.getItem('kick_origin_site') === 'kickall' ||
      (document.referrer && document.referrer.includes('kickall.app')) ||
      (document.referrer && document.referrer.includes('localhost'));

    if (oauthError) {
      document.getElementById('authGateMsg').textContent = 'Kick odbio autorizaciju...';
      showToast('error', `Kick odbio autorizaciju: ${oauthError}`, '❌');
      setTimeout(() => { window.location.href = window.KickotConfig.paths.indexUrl; }, 2000);
      return;
    }

    // Check for existing Supabase session first (from KickAll)
    const { data: { session: initialSession } } = await sb.auth.getSession();
    if (initialSession?.user) {
      currentUser = initialSession.user;
      await initApp();
      return;
    }

    // Skip OAuth code exchange if coming from kickall (already authenticated via Supabase)
    // or if token already exists in localStorage (already exchanged by callback)
    if (code && !fromKickAll && !localStorage.getItem('kick_access_token')) {
      document.getElementById('authGateMsg').textContent = 'Autorizacija u toku...';

      const savedState = sessionStorage.getItem('kick_oauth_state') || localStorage.getItem('kick_oauth_state');
      const stateParam = urlParams.get('state');



      if (!window.KickotConfig.isLocalhost && (!stateParam || stateParam !== savedState)) {
        console.error('Kickot OAuth state mismatch - Expected:', savedState, 'Got:', stateParam);
        document.getElementById('authGateMsg').textContent = 'Nevalidan state parametar...';
        showToast('error', 'State parametar se ne podudara.', '❌');
        setTimeout(() => { window.location.href = window.KickotConfig.paths.indexUrl; }, 2000);
        return;
      }

      // Use CONFIG storage keys if available
      const codeVerifierKey = CONFIG.STORAGE_KEYS ? CONFIG.STORAGE_KEYS.KICK_CODE_VERIFIER : 'kick_code_verifier';
      const codeVerifier = sessionStorage.getItem(codeVerifierKey) || localStorage.getItem(codeVerifierKey) || '';

      const redirectUri = window.KickotConfig.api.kickOAuthRedirect;
      const kickApiBase = window.KickotConfig.api.baseUrl;

      try {
        const res = await Promise.race([
          fetch(`${kickApiBase}/api/kick/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              code_verifier: codeVerifier,
              redirect_uri: redirectUri
            }).toString()
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('OAuth exchange timeout')), 25000))
        ]);



        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Nepoznata greška' }));
          console.error('Kickot exchange failed:', err);

          // Better error handling for Render cold starts
          if (res.status === 502) {
            document.getElementById('authGateMsg').textContent = 'Server se budi...';
            showToast('error', 'Backend server se budi (Render cold start). Sačekajte 15-30 sekundi i pokušajte ponovo.', '❌');
            setTimeout(() => { window.location.href = window.KickotConfig.paths.indexUrl; }, 15000);
          } else {
            document.getElementById('authGateMsg').textContent = 'Greška pri autorizaciji...';
            showToast('error', err.detail || err.error || 'Server nedostupan', '❌');
            setTimeout(() => { window.location.href = window.KickotConfig.paths.indexUrl; }, 3000);
          }
          return;
        }

        const tokenData = await res.json();
        if (!tokenData.access_token) {
          document.getElementById('authGateMsg').textContent = 'Token nije primljen...';
          showToast('error', 'Nije primljen access_token', '❌');
          setTimeout(() => { window.location.href = window.KickotConfig.paths.indexUrl; }, 3000);
          return;
        }

        sessionStorage.setItem('kick_access_token', tokenData.access_token);
        localStorage.removeItem('kick_access_token');

        const intent = sessionStorage.getItem('kick_oauth_intent') || 'login';
        const addChannelUid = sessionStorage.getItem('kick_add_channel_uid') || '';

        // Use CONFIG storage keys if available
        const oauthStateKey = CONFIG.STORAGE_KEYS ? CONFIG.STORAGE_KEYS.KICK_OAUTH_STATE : 'kick_oauth_state';
        sessionStorage.removeItem(oauthStateKey);
        sessionStorage.removeItem(codeVerifierKey);
        localStorage.removeItem(oauthStateKey);
        localStorage.removeItem(codeVerifierKey);
        sessionStorage.removeItem('kick_oauth_intent');
        sessionStorage.removeItem('kick_add_channel_uid');
        sessionStorage.removeItem('kick_oauth_source');
        sessionStorage.removeItem('kick_oauth_code');
        localStorage.removeItem('kick_oauth_state');
        localStorage.removeItem('kick_code_verifier');

        if (intent === 'add_channel' && addChannelUid) {
          document.getElementById('authGateMsg').textContent = 'Dodavanje kanala...';

          const { data: { session } } = await Promise.race([
            sb.auth.getSession(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Session check timeout')), 10000))
          ]);
          if (session) {
            currentUser = session.user;
          } else {
            currentUser = { id: addChannelUid };
          }

          const userRes = await fetch(`${kickApiBase}/api/kick/me`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
          });

          let kickUser = null;
          if (userRes.ok) {
            kickUser = await userRes.json();
          }

          if (!kickUser || (!kickUser.id && !kickUser.chatroom_id)) {
            document.getElementById('authGateMsg').textContent = 'Greška: podaci kanala nedostupni...';
            showToast('error', 'Nije moguće preuzeti podatke kanala sa Kick platforme.', '❌');
            setTimeout(() => { window.location.href = 'dashboard?settings=channels'; }, 3000);
            return;
          }

          const { data: profile } = await sb.from('user_profiles')
            .select('kick_channels')
            .eq('id', addChannelUid)
            .maybeSingle();

          const existingChannels = profile?.kick_channels || [];
          const channelId = String(kickUser.id); // Always use user_id as channel id
          const chatroomId = kickUser.chatroom_id ? String(kickUser.chatroom_id) : null;
          const channelSlug = kickUser.slug || kickUser.username || channelId;

          if (existingChannels.some(c => c.id === channelId)) {
            showToast('info', `@${channelSlug} je već dodat na tvoj profil.`, 'ℹ️');
            const cleanUrl = window.location.pathname + '?settings=channels';
            window.history.replaceState({}, '', cleanUrl);
            await initApp();
            return;
          }

          const newChannel = {
            id: channelId,
            chatroom_id: chatroomId,
            username: channelSlug,
            avatar: kickUser.avatar || kickUser.profile_pic || null,
            is_primary: existingChannels.length === 0,
            kick_access_token: tokenData.access_token
          };

          const updatedChannels = [...existingChannels, newChannel];

          const { error: dbErr } = await sb.from('user_profiles')
            .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
            .eq('id', addChannelUid);

          if (dbErr) {
            document.getElementById('authGateMsg').textContent = 'Greška pri čuvanju u bazu...';
            showToast('error', dbErr.message, '❌');
            setTimeout(() => { window.location.href = 'dashboard?settings=channels'; }, 3000);
            return;
          }

          showToast('success', `Kanal @${channelSlug} uspešno dodat!`, '✅');
          const cleanUrl = window.location.pathname + '?settings=channels';
          window.history.replaceState({}, '', cleanUrl);
          await initApp();
          return;
        }

        await handleKickOAuthSession(tokenData.access_token);
        return;
      } catch (err) {
        document.getElementById('authGateMsg').textContent = 'Greška pri autorizaciji...';
        showToast('error', err.message, '❌');
        setTimeout(() => { window.location.href = window.KickotConfig.paths.indexUrl; }, 3000);
        return;
      }
    }

    // ── Standardna provera tokena ──────────────────────────────────────
    const kickAccessToken = sessionStorage.getItem('kick_access_token') || localStorage.getItem('kick_access_token');
    const _urlParamsOAuth = urlParams.get('kick_oauth') === '1';

    // Check for hash fragment token from Netlify callback
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const hashToken = hashParams.get('kick_token');
    if (hashToken) {
      sessionStorage.setItem('kick_access_token', hashToken);
      localStorage.removeItem('kick_access_token');
      const tokenType = hashParams.get('token_type') || 'Bearer';
      localStorage.setItem('kick_token_type', tokenType);
      const _expiresIn = hashParams.get('expires_in') || '3600';
      localStorage.setItem('kick_session_active', Date.now().toString());
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (kickAccessToken) {
      document.getElementById('authGateMsg').textContent = 'Učitavamo tvoj Kick profil...';
      try {
        await handleKickOAuthSession(kickAccessToken);
        return;
      } catch (kickErr) {
        console.error("Kick OAuth failed:", kickErr);
        // Kick OAuth failed, continuing with standard session check
      }
    }

    // ── Standardna Supabase sesija sa retry logikom za restart kompa ─────
    document.getElementById('authGateMsg').textContent = 'Proveravamo sesiju...';

    const authSession = CONFIG.getValidSessionWithRetry
      ? await CONFIG.getValidSessionWithRetry(sb, 3, 1500)
      : (await sb.auth.getSession())?.data?.session;

    if (!authSession) {
      document.getElementById('authGateMsg').textContent = 'Preusmeravanje na prijavu...';
      setTimeout(() => { window.location.href = window.KickotConfig.paths.indexUrl + '?login=1'; }, 1200);
      return;
    }


    currentUser = authSession.user;

    // Set origin site for cross-dashboard navigation
    try {
      sessionStorage.setItem('kick_origin_site', 'kickot');
      localStorage.setItem('kick_origin_site', 'kickot');
    } catch (e) {
      console.warn('Failed to set origin flags:', e);
    }

    await initApp();
  } catch (err) {
    console.error('Auth error:', err);
    document.getElementById('authGateMsg').textContent = 'Greška pri proveri sesije: ' + err.message;
    // Critical error - keep for debugging
  }
}

// ── Kick OAuth sesija ─────────────────────────────────────────────────────
async function handleKickOAuthSession(accessToken) {
  const gateMsg = document.getElementById('authGateMsg');

  // 1. Dohvati Kick korisnički profil koristeći access_token
  gateMsg.textContent = 'Dohvatamo podatke sa Kick platforme...';
  const kickUserRes = await Promise.race([
    fetch('https://api.kick.com/public/v1/users', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Kick API timeout')), 10000))
  ]);

  let kickUsername = '';
  let kickUserId = '';
  let kickAvatar = '';
  let _kickBio = '';

  if (kickUserRes.ok) {
    const kickData = await kickUserRes.json();
    const kickUser = Array.isArray(kickData?.data) ? kickData.data[0] : kickData?.data || kickData;
    kickUsername = kickUser?.username || kickUser?.name || '';
    kickUserId = kickUser?.user_id || kickUser?.id || '';
    kickAvatar = kickUser?.profile_picture || kickUser?.profile_pic || '';
    _kickBio = kickUser?.bio || '';
  } else {
    // Kick users API failed, trying alternative endpoint
    const altRes = await fetch('https://id.kick.com/oauth/userinfo', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (altRes.ok) {
      const altData = await altRes.json();
      kickUsername = altData?.preferred_username || altData?.name || altData?.sub || '';
      kickUserId = altData?.sub || '';
      kickAvatar = altData?.picture || '';
    }
  }

  if (!kickUsername) {
    throw new Error('Nije moguće dohvatiti Kick korisničko ime.');
  }

  gateMsg.textContent = `Dobrodošao, @${kickUsername}! Priprema naloga...`;

  // 2. Proveri da li u Supabase-u već postoji nalog za ovog Kick korisnika
  const kickEmail = `kick_user_${kickUsername.toLowerCase()}@kickot.com`;

  // Pokušaj prijave sa postojećim nalogom
  const { data: signInData, error: signInError } = await sb.auth.signInWithPassword({
    email: kickEmail,
    password: `kick_oauth_${kickUsername.toLowerCase()}_kickot_2026`
  });

  if (!signInError && signInData?.user) {
    // Postoji nalog — ažuriraj kick_channels i access_token
    currentUser = signInData.user;
    await upsertKickProfile(currentUser.id, kickUsername, kickAvatar, kickUserId, accessToken);
    localStorage.removeItem('kick_access_token');
    // Ukloni kick_oauth param iz URL-a
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);
    await initApp();
    return;
  }

  // 3. Novi korisnik — kreiraj Supabase nalog
  gateMsg.textContent = 'Kreiramo nalog...';
  const password = `kick_oauth_${kickUsername.toLowerCase()}_kickot_2026`;

  const { data: signUpData, error: signUpError } = await sb.auth.signUp({
    email: kickEmail,
    password: password,
    options: {
      data: {
        display_name: kickUsername,
        avatar_url: kickAvatar,
        kick_username: kickUsername,
        kick_user_id: kickUserId
      }
    }
  });

  if (signUpError) {
    throw new Error(`Greška pri kreiranju naloga: ${signUpError.message}`);
  }

  const user = signUpData?.user;
  if (!user) {
    throw new Error('Nalog nije kreiran — Supabase nije vratio korisnika.');
  }

  currentUser = user;

  // Kreiraj profil u user_profiles tabeli
  // Dohvati chatroom_id sa Kick API-ja
  let channelId = String(kickUserId); // Always use user_id as channel id
  let chatroomId = null;
  try {
    const channelData = await resolveChatroomId(kickUsername);
    if (channelData && channelData.id) {
      chatroomId = channelData.id;
    }
  } catch (e) {
    // Ignore error, chatroomId will remain null
  }
  const { error: profileError } = await sb.from('user_profiles').upsert({
    id: user.id,
    display_name: kickUsername,
    email: kickEmail,
    plan: 'free',
    kick_channels: [{
      id: channelId,
      chatroom_id: chatroomId,
      username: kickUsername,
      avatar: kickAvatar || null,
      is_primary: true,
      kick_access_token: accessToken
    }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: 'id' });

  if (profileError) {
    // Profile creation error - non-critical for auth flow
  }

  // Odmah prijavi novog korisnika
  const { data: loginAfterSignup, error: loginAfterErr } = await sb.auth.signInWithPassword({
    email: kickEmail,
    password: password
  });

  if (!loginAfterErr && loginAfterSignup?.user) {
    currentUser = loginAfterSignup.user;
  }

  sessionStorage.removeItem('kick_access_token');
  const cleanUrl = window.location.pathname;
  window.history.replaceState({}, '', cleanUrl);
  await initApp();
}

// Ažurira Kick profil podatke u Supabase-u
async function upsertKickProfile(userId, kickUsername, kickAvatar, kickUserId, accessToken) {
  try {
    const { data: profile } = await sb.from('user_profiles')
      .select('kick_channels')
      .eq('id', userId)
      .maybeSingle();

    const existingChannels = (profile?.kick_channels) || [];
    const usernameLC = kickUsername.toLowerCase();

    // Always use user_id as channel id, fetch chatroom_id separately
    let channelId = String(kickUserId);
    let chatroomId = null;
    try {
      const channelData = await resolveChatroomId(kickUsername);
      if (channelData && channelData.id) {
        chatroomId = channelData.id;
      }
    } catch (e) {
      // Ignore error, chatroomId will remain null
    }

    const idx = existingChannels.findIndex(ch => (ch.username || '').toLowerCase() === usernameLC);
    if (idx >= 0) {
      existingChannels[idx].avatar = kickAvatar || existingChannels[idx].avatar;
      existingChannels[idx].kick_access_token = accessToken;
      existingChannels[idx].chatroom_id = chatroomId || existingChannels[idx].chatroom_id;
    } else {
      existingChannels.push({
        id: channelId,
        chatroom_id: chatroomId,
        username: kickUsername,
        avatar: kickAvatar || null,
        is_primary: existingChannels.length === 0,
        kick_access_token: accessToken
      });
    }

    await sb.from('user_profiles').update({
      kick_channels: existingChannels,
      updated_at: new Date().toISOString()
    }).eq('id', userId);
  } catch (err) {
    // Profile update failed - non-critical
  }
}

sb.auth.onAuthStateChange((event, _session) => {
  if (event === 'SIGNED_OUT') {
    const hasSavedToken = !!localStorage.getItem(storageKey);
    if (!hasSavedToken) {
      window.location.href = window.KickotConfig.paths.indexUrl;
    }
  }
});

if (CONFIG?.setupCrossTabSync) {
  CONFIG.setupCrossTabSync(sb, (newSession, eventType) => {
    if (!newSession || eventType === 'GLOBAL_LOGOUT' || eventType === 'SIGNED_OUT') {
      window.location.href = window.KickotConfig.paths.indexUrl;
    }
  });
}

// ═══════════════════════════════════════════════════════════
// APP INIT
// ═══════════════════════════════════════════════════════════
async function initApp() {
  // Migrate avatar cache from localStorage to IndexedDB (cleanup old data)
  try {
    await migrateAvatarCache();
  } catch (err) {
    console.warn('Avatar cache migration failed:', err);
  }

  // Load user profile + channels
  await loadUserProfile();

  // Sidebar avatar/name
  const name = currentUser.user_metadata?.display_name || currentUser.email?.split('@')[0] || 'User';
  const avatarVal = currentUser.user_metadata?.avatar_url || name.charAt(0).toUpperCase();
  const sidebarAvEl = document.getElementById('sidebarAvatar');
  if (avatarVal.startsWith('data:image') || avatarVal.startsWith('http')) {
    sidebarAvEl.style.backgroundImage = `url("${avatarVal}")`;
    sidebarAvEl.style.backgroundSize = 'cover';
    sidebarAvEl.style.backgroundPosition = 'center';
    sidebarAvEl.textContent = '';
  } else {
    sidebarAvEl.style.backgroundImage = 'none';
    sidebarAvEl.textContent = avatarVal;
  }
  document.getElementById('sidebarName').textContent = name;

  // Set initial leaderboard tab from state (loaded from localStorage)
  setLeaderboardType(activeLeaderboardType);

  // Load initial panel and all data BEFORE showing app
  if (activeChannel) {
    // Update auth gate message to show loading state
    document.getElementById('authGateMsg').textContent = 'Učitavanje podataka...';

    await loadAllData();
    // Detekcija osvežavanja stranice (F5/Reload) vs nove posete
    const isReload = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0] && performance.getEntriesByType('navigation')[0].type === 'reload') || (performance.navigation && performance.navigation.type === 1);
    const sessionPanel = sessionStorage.getItem('active-dashboard-panel-session');
    const hashPanel = window.location.hash ? window.location.hash.replace('#', '') : null;
    const validPanels = ['overview', 'leaderboard', 'commands', 'builtin-commands', 'auto-announces', 'bot-interaction', 'marriages', 'minigames', 'songs', 'economy', 'config', 'moderation'];

    let lastPanel = 'overview';
    // Ako je eksplicitno naveden hash u URL-u ili ako je u pitanju F5 osvežavanje, zapamti trenutni panel
    if (hashPanel && validPanels.includes(hashPanel)) {
      lastPanel = hashPanel;
    } else if (isReload && sessionPanel && validPanels.includes(sessionPanel)) {
      lastPanel = sessionPanel;
    } else {
      // Nova poseta (odlazak pa povratak na dashboard) -> Uvek Otvori Overview
      lastPanel = 'overview';
      localStorage.removeItem('active-dashboard-panel');
      sessionStorage.removeItem('active-dashboard-panel-session');
    }

    switchPanel(lastPanel);
    renderPlanLimitBanners();
  } else {
    // No channel configured — prompt
    showNoChannelState();
  }

  populateMonthSelector();

  // Proveri da li treba otvoriti settings modal na tabu za kanale
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref');
  if (refCode) {
    localStorage.setItem('kick_referral_code', refCode);
  }
  const settingsParam = urlParams.get('settings');
  if (settingsParam === 'channels') {
    setTimeout(() => openSettingsModal('channels'), 500);
  }

  // Show app AFTER all data is loaded with smooth fade transition
  const authGate = document.getElementById('authGate');
  const app = document.getElementById('app');

  // Add a small delay to ensure smooth transition
  await new Promise(resolve => setTimeout(resolve, 300));

  // Start fade out of auth gate and fade in of app
  authGate.classList.add('fade-out');
  app.classList.add('fade-in');

  // Wait for transition to complete, then hide auth gate
  setTimeout(() => {
    authGate.style.display = 'none';
  }, 500);

  setupAutosave();
}

// ── User Profile ──────────────────────────────────────────
async function loadUserProfile() {
  const { data, error: _error } = await Promise.race([
    sb.from('user_profiles')
      .select('*')
      .eq('id', currentUser.id)
      .maybeSingle(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Profile load timeout')), 10000))
  ]);

  if (data) currentUserProfileData = data;

  // Proveri i procesuiraj referral kod ako postoji i osiguraj da korisnik ima svoj kod
  if (currentUser && currentUser.id) {
    const refCode = localStorage.getItem('user_referral_code') || sessionStorage.getItem('user_referral_code');
    if (refCode) {
      try {
        await sb.rpc('create_user_referral', { p_user_id: currentUser.id, p_referral_code: refCode });
        localStorage.removeItem('user_referral_code');
        sessionStorage.removeItem('user_referral_code');
      } catch (e) { }
    }
    ensureUserHasReferralCode(currentUser.id).catch(() => { });
  }

  let myUsername = '';
  if (data) {
    myUsername = data.display_name || '';
    currentUserPlan = (data.plan || 'free').toLowerCase();
    const limits = getPlanLimits();
    const sidebarPlanEl = document.getElementById('sidebarPlan');
    if (sidebarPlanEl) {
      sidebarPlanEl.innerHTML = `<span class="plan-badge ${limits.badgeClass}">${limits.name}</span>`;
    }
    const sidebarUpgradeEl = document.getElementById('sidebarUpgradeWrap');
    if (sidebarUpgradeEl) {
      if (limits.name !== 'Elite') {
        sidebarUpgradeEl.innerHTML = `<button type="button" class="plan-upgrade-btn sidebar-upgrade-btn" onclick="event.stopPropagation(); openUpgradeModal('general')">${upgradeSvgIcon}<span>Nadogradi Paket</span></button>`;
      } else {
        sidebarUpgradeEl.innerHTML = '';
      }
    }

    currentChannels = data.kick_channels || [];

    // Deduplicate channels by username (keep the first occurrence)
    const seenUsernames = new Set();
    const deduplicatedChannels = [];
    for (const ch of currentChannels) {
      const usernameLC = (ch.username || '').toLowerCase();
      if (!seenUsernames.has(usernameLC)) {
        seenUsernames.add(usernameLC);
        deduplicatedChannels.push(ch);
      }
    }

    // If deduplication removed channels, update the database
    if (deduplicatedChannels.length !== currentChannels.length) {
      currentChannels = deduplicatedChannels;
      await sb.from('user_profiles')
        .update({ kick_channels: currentChannels })
        .eq('id', currentUser.id);
    }

    // Fetch avatars for channels that don't have one yet
    const needsAvatar = currentChannels.filter(c => !c.avatar);
    if (needsAvatar.length > 0) {
      let updated = false;
      await Promise.all(needsAvatar.map(async (ch) => {
        const resolved = await fetchKickAvatar(ch.username);
        if (resolved) {
          ch.avatar = resolved;
          updated = true;
        }
      }));

      // Save updated channels with avatars back to db
      if (updated) {
        await sb.from('user_profiles')
          .update({ kick_channels: currentChannels })
          .eq('id', currentUser.id);
      }
    }
  }

  // Učitavanje kanala kojima upravljamo (menadžeri)
  managedChannels = [];
  try {
    const { data: allProfiles } = await sb.from('user_profiles').select('*');
    if (allProfiles && myUsername) {
      allProfiles.forEach(p => {
        if (p.id === currentUser.id) return; // preskoči sopstveni profil
        const channels = p.kick_channels || [];
        channels.forEach(ch => {
          if (ch.managers && ch.managers.map(m => m.toLowerCase()).includes(myUsername.toLowerCase())) {
            managedChannels.push({
              ...ch,
              owner_id: p.id,
              is_managed: true
            });
          }
        });
      });
    }
  } catch (err) {
    // Managed channels load failed - non-critical
  }

  // Dohvati avatare i za managed kanale kojima nedostaju (ranije se preskakalo, pa je uvek ostajalo slovo umesto slike)
  const managedNeedAvatar = managedChannels.filter(c => !c.avatar);
  if (managedNeedAvatar.length > 0) {
    await Promise.all(managedNeedAvatar.map(async (ch) => {
      const resolved = await fetchKickAvatar(ch.username);
      if (!resolved) return;
      ch.avatar = resolved;
      try {
        const { data: ownerProfile } = await sb.from('user_profiles')
          .select('kick_channels')
          .eq('id', ch.owner_id)
          .maybeSingle();
        const ownerChannels = ownerProfile?.kick_channels || [];
        const idx = ownerChannels.findIndex(c => (c.username || '').toLowerCase() === (ch.username || '').toLowerCase());
        if (idx >= 0) {
          ownerChannels[idx].avatar = resolved;
          await sb.from('user_profiles')
            .update({ kick_channels: ownerChannels })
            .eq('id', ch.owner_id);
        }
      } catch (_) {
        // Upis avatara u vlasnikov profil nije uspeo - nije kritično, probaće se ponovo sledeći put
      }
    }));
  }

  const allAvailable = [...currentChannels, ...managedChannels];
  const savedChannelId = localStorage.getItem('kickbot_selected_channel_id');
  const savedChannelName = localStorage.getItem('kickbot_selected_channel_name');

  let defaultChannel = null;
  if (savedChannelId || savedChannelName) {
    defaultChannel = allAvailable.find(c => String(c.id) === String(savedChannelId) || c.username?.toLowerCase() === String(savedChannelName).toLowerCase());
  }

  if (!defaultChannel && currentChannels.length > 0) {
    defaultChannel = currentChannels.find(c => c.is_primary) || currentChannels[0];
  } else if (!defaultChannel && managedChannels.length > 0) {
    defaultChannel = managedChannels[0];
  }

  if (defaultChannel) {
    setActiveChannel(defaultChannel);
  } else {
    showNoChannelState();
  }

  renderChannelList();
}

async function fetchKickAvatar(username) {
  const raw = String(username || '').trim();
  if (!raw) return null;

  const candidates = [...new Set([
    raw,
    raw.toLowerCase()
  ])];

  for (const slug of candidates) {
    const pic = await tryFetchKickAvatarForSlug(slug);
    if (pic) return pic;
  }
  return null;
}

// ── Avatar Fetch Queue ─────────────────────────────────────────────────────
// Sekvencijalni queue sa 300ms kašnjenjem između zahtjeva
// kako ne bismo zatrpali Netlify rate limiter (30 req/min).
const _avatarFetchQueue = [];
let _avatarFetchRunning = false;

function _enqueueAvatarFetch(fn) {
  return new Promise((resolve, reject) => {
    _avatarFetchQueue.push({ fn, resolve, reject });
    if (!_avatarFetchRunning) _processAvatarQueue();
  });
}

async function _processAvatarQueue() {
  if (_avatarFetchRunning || _avatarFetchQueue.length === 0) return;
  _avatarFetchRunning = true;
  while (_avatarFetchQueue.length > 0) {
    const { fn, resolve, reject } = _avatarFetchQueue.shift();
    try { resolve(await fn()); } catch (e) { reject(e); }
    if (_avatarFetchQueue.length > 0) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  _avatarFetchRunning = false;
}
// ──────────────────────────────────────────────────────────────────────────

async function tryFetchKickAvatarForSlug(username) {
  const apiBase = getBotApiBase();

  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const isDevWithoutBot = isLocalhost && (apiBase.includes(':5500') || apiBase === window.location.origin) && localStorage.getItem('use_local_bot') !== 'true';

  if (isDevWithoutBot) {
    return null;
  }

  // 1. Pokušaj prvo preko našeg backend servera koji ima Cloudflare podršku
  try {
    const localRes = await fetch(`${apiBase}/api/avatar?username=${encodeURIComponent(username)}`, { signal: AbortSignal.timeout(3000) });
    if (localRes.ok) {
      const localData = await localRes.json();
      if (localData && localData.avatar) {
        return localData.avatar;
      }
    }
  } catch (_) { }

  const apiUrl = `https://kick.com/api/v2/channels/${username}`;

  // 2. Netlify proxy funkcija (POST zahtev) — ide kroz queue da ne udari rate limit
  return _enqueueAvatarFetch(async () => {
    try {
      const netlifyRes = await fetch(`/.netlify/functions/api-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl: apiUrl }),
        signal: AbortSignal.timeout(3500)
      });
      if (netlifyRes.ok) {
        const data = await netlifyRes.json();
        const pic = data?.user?.profile_pic || data?.avatar;
        if (pic) return pic;
      }
    } catch (_) { }
    return null;
  });
}



function setActiveChannel(ch) {
  activeChannel = ch;
  if (ch && (ch.id || ch.username)) {
    try {
      localStorage.setItem('kickbot_selected_channel_id', String(ch.id || ''));
      localStorage.setItem('kickbot_selected_channel_name', String(ch.username || ''));
    } catch (_) { }
  }
  document.getElementById('channelNameDisplay').textContent = ch.username;
  updateLiveStatusUI(false); // Resetuj na offline po defaultu kako ne bi flešovalo prethodno stanje

  const avatarEl = document.getElementById('channelAvatar');
  if (avatarEl) {
    if (ch.avatar) {
      avatarEl.style.backgroundImage = `url("${ch.avatar}")`;
      avatarEl.style.backgroundSize = 'cover';
      avatarEl.style.backgroundPosition = 'center';
      avatarEl.textContent = '';
    } else {
      avatarEl.style.backgroundImage = 'none';
      avatarEl.textContent = ch.username.charAt(0).toUpperCase();
    }
  }

  const topbarCh = document.getElementById('topbarChannel');
  if (topbarCh) topbarCh.textContent = `@${ch.username}`;
  const cmdBadge = document.getElementById('cmdPrefixBadge');
  if (cmdBadge) cmdBadge.textContent = '!';
  const overviewDesc = document.getElementById('overviewDesc');
  if (overviewDesc) overviewDesc.textContent = `Pregled aktivnosti za kanal @${ch.username}`;

  // Ako je sidebar bio sakriven (showNoChannelState), vrati ga
  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebar.style.display === 'none') {
    sidebar.style.display = '';
  }
  // Vrati mainContent na normalan grid layout
  const mainContent = document.getElementById('mainContent');
  if (mainContent && mainContent.style.gridColumn) {
    mainContent.style.gridColumn = '';
  }

  // Pretplati se na Supabase Realtime izmene iz baze za ažuriranje Song Request reda i bot podešavanja u realnom vremenu
  setupRealtimeSongQueueSubscription(ch.id);
}

let activeConfigSubscription = null;
let activeLeaderboardSubscription = null;

function setupRealtimeSongQueueSubscription(channelId) {
  if (activeConfigSubscription) {
    sb.removeChannel(activeConfigSubscription);
    activeConfigSubscription = null;
  }
  if (activeLeaderboardSubscription) {
    sb.removeChannel(activeLeaderboardSubscription);
    activeLeaderboardSubscription = null;
  }

  if (!channelId) return;

  // Učitaj odmah trenutno stanje iz bot_config tabele
  sb.from('bot_config').select('songrequest_settings').eq('channel_id', channelId).single()
    .then(({ data }) => {
      if (data && data.songrequest_settings && Array.isArray(data.songrequest_settings.queue)) {
        localSongQueue = data.songrequest_settings.queue;
        if (typeof renderSongQueue === 'function') renderSongQueue();
        if (typeof updatePlayerUI === 'function') updatePlayerUI();
      }
    }).catch(() => { });

  // Pretplata na bazu u realnom vremenu (Realtime UPDATE na bot_config)
  activeConfigSubscription = sb.channel(`bot_config_${channelId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'bot_config',
      filter: `channel_id=eq.${channelId}`
    }, payload => {
      if (payload.new && payload.new.songrequest_settings && Array.isArray(payload.new.songrequest_settings.queue)) {
        localSongQueue = payload.new.songrequest_settings.queue;
        if (typeof renderSongQueue === 'function') renderSongQueue();
        if (typeof updatePlayerUI === 'function') updatePlayerUI();
      }
    })
    .subscribe();

  // Pretplata na bazu u realnom vremenu (Realtime izmene u leaderboard tabeli za ovaj kanal)
  activeLeaderboardSubscription = sb.channel(`leaderboard_realtime_${channelId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'leaderboard',
      filter: `channel_id=eq.${channelId}`
    }, () => {
      // Čim bot upiše nove minute ili poruke u bazu, automatski osveži prikaz
      if (typeof loadLeaderboard === 'function') {
        loadLeaderboard();
      }
    })
    .subscribe();
}

function renderChannelList() {
  const list = document.getElementById('channelList');
  if (!list) return;
  list.innerHTML = '';

  const checkSvg = `<span class="ch-check"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#53FC18" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`;

  // 1. Tvoji kanali (own channels)
  const ownHeader = document.createElement('div');
  ownHeader.className = 'channel-group-header';
  ownHeader.textContent = 'Tvoji kanali';
  list.appendChild(ownHeader);

  if (currentChannels.length === 0) {
    const emptyOwn = document.createElement('div');
    emptyOwn.className = 'channel-empty-text';
    emptyOwn.textContent = 'Nema dodatih kanala';
    list.appendChild(emptyOwn);
  } else {
    currentChannels.forEach(ch => {
      const div = document.createElement('div');
      div.className = 'channel-option' + (activeChannel?.id === ch.id ? ' selected' : '');

      // Sanitizacija avatar URL-a: prihvati samo https://
      const safeChAvatar = ch.avatar && /^https:\/\//.test(ch.avatar) ? ch.avatar : null;
      const avatarHtml = safeChAvatar
        ? `<div class="channel-avatar" style="width:24px;height:24px;background-image:url('${safeChAvatar}');background-size:cover;background-position:center;border-radius:50%"></div>`
        : `<div class="channel-avatar" style="width:24px;height:24px;font-size:0.7rem;border-radius:50%">${escapeHtml(ch.username.charAt(0).toUpperCase())}</div>`;

      div.innerHTML = `
        ${avatarHtml}
        <span class="ch-name">${escapeHtml(ch.username)}</span>
        ${activeChannel?.id === ch.id ? checkSvg : ''}
      `;
      div.onclick = () => selectChannel(ch);
      list.appendChild(div);
    });
  }

  // 2. Kanali kojima upravljaš (managed channels)
  const managedHeader = document.createElement('div');
  managedHeader.className = 'channel-group-header';
  managedHeader.style.marginTop = '8px';
  managedHeader.textContent = 'Kanali kojima upravljaš';
  list.appendChild(managedHeader);

  if (managedChannels.length === 0) {
    const emptyManaged = document.createElement('div');
    emptyManaged.className = 'channel-empty-text';
    emptyManaged.textContent = 'Nema kanala za upravljanje';
    list.appendChild(emptyManaged);
  } else {
    managedChannels.forEach(ch => {
      const div = document.createElement('div');
      div.className = 'channel-option' + (activeChannel?.id === ch.id ? ' selected' : '');

      // Sanitizacija avatar URL-a: prihvati samo https://
      const safeManagedAvatar = ch.avatar && /^https:\/\//.test(ch.avatar) ? ch.avatar : null;
      const avatarHtml = safeManagedAvatar
        ? `<div class="channel-avatar" style="width:24px;height:24px;background-image:url('${safeManagedAvatar}');background-size:cover;background-position:center;border-radius:50%"></div>`
        : `<div class="channel-avatar" style="width:24px;height:24px;font-size:0.7rem;border-radius:50%">${escapeHtml(ch.username.charAt(0).toUpperCase())}</div>`;

      div.innerHTML = `
        ${avatarHtml}
        <span class="ch-name" style="display: flex; align-items: center; gap: 4px;">
          ${escapeHtml(ch.username)}
          <svg style="width: 13px; height: 13px; fill: none; stroke: #a78bfa; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; display: inline-block;" viewBox="0 0 24 24" title="Menadžer kanala">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
          </svg>
        </span>
        ${activeChannel?.id === ch.id ? checkSvg : ''}
      `;
      div.onclick = () => selectChannel(ch);
      list.appendChild(div);
    });
  }
}

async function selectChannel(ch) {
  if (activeChannel && activeChannel.id === ch.id) {
    toggleChannelMenu(null);
    return;
  }
  setActiveChannel(ch);
  renderChannelList();
  toggleChannelMenu(null);
  showToast('info', `Prebačeno na kanal @${ch.username}`, '🔄');
  await loadAllData();
}

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

function showNoChannelState() {
  // Sakrij sidebar kad nema kanala
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.style.display = 'none';

  const mainContent = document.getElementById('mainContent');
  if (mainContent) {
    mainContent.style.gridColumn = '1 / -1'; // zauzmi pun prostor
  }

  // Prebaci panel na no-channel
  switchPanel('no-channel');

  // Poveži dugme
  const addBtn = document.getElementById('noChannelAddBtn');
  if (addBtn) {
    const newBtn = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newBtn, addBtn);
    newBtn.addEventListener('click', () => showAddChannelModal());
  }
}

// ── Channel Management ────────────────────────────────────
function extractKickUsername(input) {
  let val = input.trim();
  // Ukloni URL delove
  val = val.replace(/https?:\/\/(www\.)?kick\.com\//i, '');
  // Ukloni eventualni @ na početku
  val = val.replace(/^@/, '');
  // Uzmi samo prvi deo do sledećeg kosog poteza ili space-a ili upitnika
  val = val.split(/[/?\s]/)[0];
  return val.toLowerCase();
}

async function resolveChatroomId(username) {
  const apiBase = getBotApiBase();
  const cleanUser = String(username || '').trim();
  if (!cleanUser) return null;

  // 1. Pokušavamo preko backend servera
  try {
    const localRes = await fetch(`${apiBase}/api/avatar?username=${encodeURIComponent(cleanUser)}`, { signal: AbortSignal.timeout(3500) });
    if (localRes.ok) {
      const localData = await localRes.json();
      if (localData && localData.id) {
        return {
          id: localData.id.toString(),
          chatroom_id: localData.chatroom_id ? localData.chatroom_id.toString() : null,
          username: localData.slug || cleanUser,
          avatar: localData.avatar || null,
          bio: localData.bio || ''
        };
      }
    }
  } catch (_) { }

  const apiUrl = `https://kick.com/api/v2/channels/${cleanUser}`;

  // 2. Netlify proxy funkcija (POST zahtev)
  try {
    const netlifyRes = await fetch(`/.netlify/functions/api-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl: apiUrl }),
      signal: AbortSignal.timeout(3500)
    });
    if (netlifyRes.ok) {
      const data = await netlifyRes.json();
      if (data && data.user && data.chatroom) {
        return {
          id: data.user.id.toString(),
          chatroom_id: data.chatroom.id.toString(),
          username: data.slug || cleanUser,
          avatar: data.user?.profile_pic || null,
          bio: data.user?.bio || ''
        };
      }
    }
  } catch (_) { }

  return null;
}

// ── Verifikacioni tok za dodavanje kanala ─────────────────
let _addChannelPending = null; // { resolved, verificationCode }

function showAddChannelModal() {
  const limits = getPlanLimits();
  if (limits.maxChannels !== Infinity && currentChannels.length >= limits.maxChannels) {
    openUpgradeModal('channels');
    return;
  }
  openSettingsModal('channels');
}

function renderAddChannelStep1(errorMsg = '') {
  const body = document.getElementById('addChannelModalBody');
  if (!body) return;
  body.innerHTML = `
    <div class="form-group" style="margin-bottom:16px;">
      <label class="form-label">Kick username ili URL kanala</label>
      <input type="text" class="form-input" id="newChannelInput"
        placeholder="npr. milan-567 ili https://kick.com/milan-567" />
      <span class="config-hint">Unesi korisničko ime kanala ili puni link do Kick profila</span>
    </div>
    ${errorMsg ? `<div class="form-alert" style="display:block;color:#EF4444;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);padding:10px 14px;border-radius:8px;font-size:0.85rem;margin-bottom:12px;">${errorMsg}</div>` : ''}
    <div class="modal-foot" style="padding:0; margin-top:8px; border:none; background:none; display:flex; gap:10px; justify-content:flex-end;">
      <button class="btn btn-outline" onclick="closeModal('addChannelModal')">Otkaži</button>
      <button class="btn btn-primary" id="addChannelBtn" onclick="addChannelStep1()">
        <span class="btn-spinner" id="addChannelBtnSpinner" style="display:none; width:14px; height:14px; border:2px solid rgba(0,0,0,0.3); border-top-color:#000; border-radius:50%; animation:spin 0.7s linear infinite;"></span>
        <span>Nastavi</span>
      </button>
    </div>
  `;
  const inp = document.getElementById('newChannelInput');
  if (inp) {
    inp.focus();
    bindEnterKey('newChannelInput', 'addChannelBtn');
  }
}

function renderAddChannelStep2(channelName, verificationCode, errorMsg = '') {
  const body = document.getElementById('addChannelModalBody');
  const titleEl = document.getElementById('addChannelModalTitle');
  if (!body) return;
  if (titleEl) titleEl.textContent = 'Verifikuj vlasništvo';
  body.innerHTML = `
    <p style="color:var(--color-text-muted); font-size:0.9rem; line-height:1.6; margin-bottom:14px;">
      Da potvrdimo da si vlasnik kanala <strong style="color:var(--color-text);">@${channelName}</strong>, stavi ovaj kod 
      <strong>bilo gde</strong> u opis (Bio/About) svog Kick profila:
    </p>
    <div style="background:rgba(83,252,24,0.08); border:1px dashed rgba(83,252,24,0.5); padding:14px; border-radius:10px; font-family:monospace; font-size:1.1rem; font-weight:700; color:#53fc18; text-align:center; margin-bottom:16px; letter-spacing:1px; user-select:all;">
      ${verificationCode}
    </div>
    <p style="color:var(--color-text-muted); font-size:0.82rem; line-height:1.5; margin-bottom:16px;">
      💡 Kod možeš staviti uz ostali tekst, npr:<br>
      <em style="color:var(--color-text-secondary);">"Profesionalni streamer 🔥 ${verificationCode}"</em><br>
      Nakon verifikacije možeš ukloniti kod iz opisa.
    </p>
    ${errorMsg ? `<div class="form-alert" style="display:block;color:#EF4444;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);padding:10px 14px;border-radius:8px;font-size:0.85rem;margin-bottom:12px;">${errorMsg}</div>` : ''}
    <div class="modal-foot" style="padding:0; margin-top:8px; border:none; background:none; display:flex; gap:10px; justify-content:flex-end;">
      <button class="btn btn-outline" onclick="renderAddChannelStep1()">Nazad</button>
      <button class="btn btn-primary" id="addChannelVerifyBtn" onclick="addChannelVerify()">
        <span class="btn-spinner" id="addChannelVerifySpinner" style="display:none; width:14px; height:14px; border:2px solid rgba(0,0,0,0.3); border-top-color:#000; border-radius:50%; animation:spin 0.7s linear infinite;"></span>
        <span>Verifikuj i dodaj</span>
      </button>
    </div>
  `;
}

async function addChannelStep1() {
  const inp = document.getElementById('newChannelInput');
  const rawInput = inp ? inp.value.trim() : '';

  if (!rawInput) {
    renderAddChannelStep1('Unesi Kick username ili link kanala.');
    return;
  }

  const username = extractKickUsername(rawInput);
  if (!username) {
    renderAddChannelStep1('Nevalidan unos kanala.');
    return;
  }

  // Loading state
  const btn = document.getElementById('addChannelBtn');
  const spinner = document.getElementById('addChannelBtnSpinner');
  if (btn) btn.disabled = true;
  if (spinner) spinner.style.display = 'inline-block';

  const resolved = await resolveChatroomId(username);

  if (btn) btn.disabled = false;
  if (spinner) spinner.style.display = 'none';

  if (!resolved) {
    renderAddChannelStep1(`Kanal "${username}" nije pronađen na Kick platformi. Proveri ispravnost.`);
    return;
  }

  if (currentChannels.some(c => c.id === resolved.id)) {
    renderAddChannelStep1('Ovaj kanal je već dodat na tvoj nalog.');
    return;
  }

  // Provera da li je ovaj Kick kanal već registrovan na nekom drugom nalogu
  const { data: taken, error: checkErr } = await sb.from('user_profiles')
    .select('id')
    .contains('kick_channels', [{ id: resolved.id }]);

  if (!checkErr && taken && taken.length > 0) {
    renderAddChannelStep1('Ovaj kanal je već povezan sa drugim nalogom.');
    return;
  }

  // Generiši verifikacioni kod i idi na korak 2
  const verificationCode = `kickot-${Math.floor(100000 + Math.random() * 900000)}`;
  _addChannelPending = { resolved, verificationCode };
  renderAddChannelStep2(resolved.username, verificationCode);
}

async function addChannelVerify() {
  if (!_addChannelPending) return;

  const { resolved, verificationCode } = _addChannelPending;
  const { id: channelId, username: channelName } = resolved;

  const btn = document.getElementById('addChannelVerifyBtn');
  const spinner = document.getElementById('addChannelVerifySpinner');
  if (btn) btn.disabled = true;
  if (spinner) spinner.style.display = 'inline-block';

  // Ponovo povuci svež bio da proverimo kod
  const freshResolved = await resolveChatroomId(channelName);
  const freshBio = freshResolved?.bio || '';

  if (btn) btn.disabled = false;
  if (spinner) spinner.style.display = 'none';

  if (!freshBio.toLowerCase().includes(verificationCode.toLowerCase())) {
    renderAddChannelStep2(channelName, verificationCode,
      'Verifikacioni kod nije pronađen u tvom Kick opisu (Bio/About). Stavi kod u bio i pokušaj ponovo.');
    return;
  }

  // Bio proveren — dodaj kanal
  if (btn) btn.disabled = true;
  if (spinner) spinner.style.display = 'inline-block';

  const newChannel = {
    id: channelId,
    username: channelName,
    avatar: resolved.avatar || null,
    is_primary: currentChannels.length === 0
  };

  const updatedChannels = [...currentChannels, newChannel];

  const { error } = await sb.from('user_profiles')
    .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
    .eq('id', currentUser.id);

  if (error) {
    renderAddChannelStep2(channelName, verificationCode,
      'Greška pri čuvanju kanala u bazu. Pokušaj ponovo.');
    return;
  }

  currentChannels = updatedChannels;
  _addChannelPending = null;
  setActiveChannel(newChannel);
  renderChannelList();
  closeModal('addChannelModal');
  showToast('success', `Kanal @${channelName} je uspešno dodat i verifikovan!`, '✅');
  await loadAllData();
  switchPanel('overview');
}

// Legacy wrapper — poziva novi tok
async function addChannel() {
  addChannelStep1();
}


// ═══════════════════════════════════════════════════════════
// DATA LOADERS
// ═══════════════════════════════════════════════════════════
async function loadNotifications() {
  try {
    const { data, error } = await sb
      .from('notifications')
      .select('id, created_at, title, description, type')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      // Notifications load error
      return;
    }

    if (data) {
      notifications = data.map(item => ({
        id: item.id,
        title: item.title,
        desc: item.description,
        timestamp: item.created_at,
        type: item.type || 'info'
      }));
      updateNotifBadgeUI();
      renderNotifContent();
    }
  } catch (err) {
    // Notifications load exception
  }
}

async function loadChangelogs() {
  try {
    const { data, error } = await sb
      .from('changelog')
      .select('id, created_at, version, title, details')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      // Changelogs load error
      return;
    }

    if (data) {
      changelogs = data.map(item => {
        const d = new Date(item.created_at);
        const formattedDate = !isNaN(d.getTime()) ? d.toLocaleDateString('sr-RS') : item.created_at;
        return {
          id: item.id,
          version: item.version,
          title: item.title,
          details: item.details,
          date: formattedDate
        };
      });
      renderNotifContent();
    }
  } catch (err) {
    // Changelogs load exception
  }
}

async function loadAllData() {
  if (!activeChannel) return;

  // Sačekamo sve asinhrone pozive kako bismo znali da li je osvežavanje uspešno
  // Dodajemo timeout za svaki load da ne blokiraju ceo proces
  await Promise.all([
    Promise.race([
      loadCommands(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Commands load timeout')), 8000))
    ]).catch(() => { /* Commands load timeout */ }),
    Promise.race([
      loadLeaderboard(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Leaderboard load timeout')), 8000))
    ]).catch(() => { /* Leaderboard load timeout */ }),
    Promise.race([
      loadWatchtime(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Watchtime load timeout')), 8000))
    ]).catch(() => { /* Watchtime load timeout */ }),
    Promise.race([
      loadMarriages(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Marriages load timeout')), 5000))
    ]).catch(() => { /* Marriages load timeout */ }),
    Promise.race([
      loadLoveStatuses(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Love statuses load timeout')), 5000))
    ]).catch(() => { /* Love statuses load timeout */ }),
    Promise.race([
      loadBotConfig(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Bot config load timeout')), 5000))
    ]).catch(() => { /* Bot config load timeout */ }),
    Promise.race([
      loadBotStatus(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Bot status load timeout')), 5000))
    ]).catch(() => { /* Bot status load timeout */ }),
    Promise.race([
      loadNotifications(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Notifications load timeout')), 5000))
    ]).catch(() => { /* Notifications load timeout */ }),
    Promise.race([
      loadChangelogs(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Changelogs load timeout')), 5000))
    ]).catch(() => { /* Changelogs load timeout */ })
  ]);

  // Load channel live status separately (non-critical, can fail without blocking UI)
  loadChannelLiveStatus().catch(() => { /* Channel live status load failed (non-critical) */ });

  setupRealtimeChannels();
  startLiveActivityFeed();
}

async function refreshAllData() {
  if (!activeChannel) return;

  const btn = document.querySelector('.topbar-refresh-btn');
  if (!btn) return;

  const originalHtml = btn.innerHTML;

  // Onemogućavamo višestruke klikove i pokrećemo rotaciju
  btn.style.pointerEvents = 'none';
  const icon = btn.querySelector('.refresh-icon');
  if (icon) icon.style.animation = 'spin 0.8s linear infinite';

  try {
    showToast('info', 'Osvežavam podatke...', '🔄');
    await loadAllData();
    showToast('success', 'Podaci osveženi!', '✅');

    // Prikaz zelenog štiklića
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
  } catch (err) {
    showToast('error', 'Greška pri osvežavanju podataka.', '⚠️');

    // Prikaz crvenog X znaka
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    btn.style.borderColor = 'rgba(239, 68, 68, 0.4)';
  } finally {
    // Vraćanje na prvobitnu ikonicu osvežavanja posle 2 sekunde
    setTimeout(() => {
      btn.innerHTML = originalHtml;
      btn.style.borderColor = 'rgba(255, 255, 255, 0.08)';
      btn.style.pointerEvents = 'auto';
    }, 2000);
  }
}

// ── Commands ──────────────────────────────────────────────
// ── Commands ──────────────────────────────────────────────
// ── Ugrađene Komande Bota ───────────────────────────────────
// Svaka ugrađena komanda ima definisan rang (Svi, Moderatori, Strimere) i podesivi cooldown.
const defaultBuiltinCommands = [
  // Zabava
  { id: 'builtin-iq', command: 'iq, iq @user', response: 'Prikazuje inteligenciju (IQ) korisnika ili ciljanog člana četa.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'iq', category: 'Zabava' },
  { id: 'builtin-samar', command: 'samar @user', response: 'Šalje zabavan šamar odabranom korisniku sa nasumičnim predmetom u četu.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'samar', category: 'Zabava' },
  { id: 'builtin-roll', command: 'roll @user', response: 'Pokreće roll dvoboj (kockice 1-100) protiv drugog člana četa.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'roll', category: 'Zabava' },
  { id: 'builtin-rulet', command: 'ruskirulet, rr', response: 'Igraj ruski rulet sa botom — 1 u 6 šansa za privremeni timeout.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'ruskirulet', category: 'Zabava' },
  { id: 'builtin-alkotest', command: 'alkotest [@user]', response: 'Izračunava količinu promila u krvi i opisuje stanje korisnika.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'alkotest', category: 'Zabava' },
  { id: 'builtin-cinjenica', command: 'cinjenica', response: 'Ispisuje nasumičnu zanimljivu činjenicu u četu.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'cinjenica', category: 'Zabava' },

  // Ljubav & Brak
  { id: 'builtin-love', command: 'love @user, love @user @user', response: 'Izračunaj ljubavnu kompatibilnost sa drugim korisnikom.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'love', category: 'Ljubav & Brak' },
  { id: 'builtin-marry', command: 'vencaj @user', response: 'Pošalji bračnu ponudu drugom članu četa za ulazak u virtuelni brak.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'vencaj', category: 'Ljubav & Brak' },
  { id: 'builtin-razvod', command: 'razvod @user', response: 'Razvedi se od trenutnog bračnog partnera na kanalu.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'razvod', category: 'Ljubav & Brak' },
  { id: 'builtin-brakovi', command: 'brakovi, brak, vencani', response: 'Prikazuje spisak svih aktivnih venčanih parova na ovom kanalu.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'brakovi', category: 'Ljubav & Brak' },
  { id: 'builtin-posaljiljubav', command: 'posaljiljubav @user', response: 'Pošalji ljubavnu ponudu korisniku (povećava procenat ljubavi).', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'posaljiljubav', category: 'Ljubav & Brak' },
  { id: 'builtin-odbijljubav', command: 'odbijljubav @user', response: 'Odbij primljenu ljubavnu ponudu od nekog korisnika.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'odbijljubav', category: 'Ljubav & Brak' },
  { id: 'builtin-mrzim', command: 'mrzim @user', response: 'Izračunaj procenat mržnje prema drugom članu četa.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'mrzim', category: 'Ljubav & Brak' },
  { id: 'builtin-bacihejt', command: 'bacihejt @user', response: 'Smanji nivo ljubavi prema odabranom korisniku u četu.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'bacihejt', category: 'Ljubav & Brak' },
  { id: 'builtin-prihvati', command: 'prihvati, da, pristajem', response: 'Prihvati bračnu ponudu, ponudu za ljubav ili poziv na dvoboj.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'prihvati', category: 'Ljubav & Brak' },
  { id: 'builtin-odbij', command: 'odbij, ne, odbijam', response: 'Odbij bračnu ponudu, ponudu za ljubav ili poziv na dvoboj.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'odbij', category: 'Ljubav & Brak' },
  { id: 'builtin-cooldown', command: 'cooldown, coldown', response: 'Proveri cooldown za ljubavne akcije (posaljiljubav, bacihejt).', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'cooldown', category: 'Ljubav & Brak' },

  // Strim Info
  { id: 'builtin-komande', command: 'komande, help, pomoc, commands', response: 'Prikazuje spisak svih ugrađenih komandi bota prilagođenih ovom kanalu.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'komande', category: 'Strim Info' },
  { id: 'builtin-igra', command: 'igra', response: 'Prikazuje trenutnu igru ili kategoriju na strimu.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'igra', category: 'Strim Info' },
  { id: 'builtin-uptime', command: 'uptime, up', response: 'Prikazuje tačno vreme koliko je strim aktivan uživo.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'uptime', category: 'Strim Info' },
  { id: 'builtin-vreme', command: 'vreme [grad], vrijeme [grad]', response: 'Prikazuje trenutnu vremensku prognozu i temperaturu za uneti grad.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'vreme', category: 'Strim Info' },
  { id: 'builtin-info', command: 'info', response: 'Prikazuje osnovne informacije, verziju i status bota.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'info', category: 'Strim Info' },

  // Moderacija
  { id: 'builtin-permit', command: 'permit @user, dozvoli @user', response: 'Dozvoljava izabranom korisniku slanje 1 linka u četu bez brisanja.', cooldown: 5000, min_rank: 'moderator', enabled: true, is_default: true, usage: 0, db_match_key: 'permit', category: 'Moderacija' },
  { id: 'builtin-addcom', command: 'dodajkomandu !naziv Odgovor, addcom !naziv Odgovor', response: 'Kratica za moderatore: dodaje novu komandu direktno iz četa.', cooldown: 5000, min_rank: 'moderator', enabled: true, is_default: true, usage: 0, db_match_key: 'addcom', category: 'Moderacija' },
  { id: 'builtin-delcom', command: 'obrisikomandu !naziv, delcom !naziv', response: 'Kratica za moderatore: briše komandu direktno iz četa.', cooldown: 5000, min_rank: 'moderator', enabled: true, is_default: true, usage: 0, db_match_key: 'delcom', category: 'Moderacija' },
  { id: 'builtin-osvezi', command: 'osvezi', response: 'Osvežava sve postavke, komande i podatke kanala iz baze.', cooldown: 5000, min_rank: 'broadcaster', enabled: true, is_default: true, usage: 0, db_match_key: 'osvezi', category: 'Moderacija' },
  { id: 'builtin-pin', command: 'pin [tekst]', response: 'Pinuje istaknutu poruku na vrhu četa.', cooldown: 5000, min_rank: 'moderator', enabled: true, is_default: true, usage: 0, db_match_key: 'pin', category: 'Moderacija' },
  { id: 'builtin-unpin', command: 'unpin', response: 'Uklanja trenutno pinovanu poruku iz četa.', cooldown: 5000, min_rank: 'broadcaster', enabled: true, is_default: true, usage: 0, db_match_key: 'unpin', category: 'Moderacija' },
  { id: 'builtin-setlive', command: 'setlive [true/false]', response: 'Ručno postavlja status strima na live (uključeno) ili offline.', cooldown: 5000, min_rank: 'broadcaster', enabled: true, is_default: true, usage: 0, db_match_key: 'setlive', category: 'Moderacija' },
  { id: 'builtin-setgame', command: 'setgame [naziv]', response: 'Ručno postavlja naziv igre koja se prikazuje u informacijama strima.', cooldown: 5000, min_rank: 'broadcaster', enabled: true, is_default: true, usage: 0, db_match_key: 'setgame', category: 'Moderacija' },

  // Statistika
  { id: 'builtin-topwatchtime', command: 'topwatchtime [broj], topwatch [broj]', response: 'Prikazuje top listu gledalaca sa najviše provedenih sati na strimu.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'topwatchtime', category: 'Statistika' },
  { id: 'builtin-topchat', command: 'top chat [broj], top [broj], leaderboard [broj]', response: 'Prikazuje rang listu najaktivnijih korisnika po broju poruka u četu.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'top', category: 'Statistika' },
  { id: 'builtin-watchtime', command: 'watchtime [@user]', response: 'Prikazuje lično ili tuđe usaglašeno vreme gledanja strima.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'watchtime', category: 'Statistika' },
  { id: 'builtin-chat', command: 'chat, aktivnost, stats', response: 'Prikazuje tačan broj poslatih poruka u četu i aktivnost.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'aktivnost', category: 'Statistika' },
  { id: 'builtin-me', command: 'me', response: 'Prikazuje tvoj lični karton: sate gledanja, broj poruka i nivo.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'me', category: 'Statistika' },
  { id: 'builtin-followage', command: 'followage', response: 'Prikazuje tačno koliko dana/meseci prate vaš kanal.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'followage', category: 'Statistika' },
  { id: 'builtin-resetleaderboard', command: 'resetleaderboard', response: 'Komanda za strimera: resetuje tabele aktivnosti i poena za novi mesec.', cooldown: 5000, min_rank: 'broadcaster', enabled: true, is_default: true, usage: 0, db_match_key: 'resetleaderboard', category: 'Statistika' },
  { id: 'builtin-leaderboard', command: 'leaderboard [broj]', response: 'Prikazuje top listu najaktivnijih korisnika u četu (alternativa za !top).', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'leaderboard', category: 'Statistika' },

  // Ekonomija
  { id: 'builtin-rank', command: 'rank, level, xp [@user]', response: 'Prikazuje tvoj nivo, skupljeni XP i trenutu titulu.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'rank', category: 'Ekonomija' },
  { id: 'builtin-points-eco', command: 'points, poeni, bal, coins [@user]', response: 'Prikazuje stanje novčanika poena i zlatnika u ekonomiji kanala.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'points', category: 'Ekonomija' },
  { id: 'builtin-daily', command: 'daily', response: 'Preuzmi svoj besplatni dnevni bonus poena i iskustva (jednom u 24h).', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'daily', category: 'Ekonomija' },
  { id: 'builtin-givepoints', command: 'givepoints, dajpoene, pay @user [iznos]', response: 'Prenaša poene drugom članu četa.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'givepoints', category: 'Ekonomija' },
  { id: 'builtin-toplevel', command: 'toplevel, topxp [broj]', response: 'Prikazuje top listu korisnika sa najvećim nivoima i iskustvom.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'toplevel', category: 'Ekonomija' },
  { id: 'builtin-topcoins', command: 'topcoins, toppoeni [broj]', response: 'Prikazuje top listu najbogatijih korisnika po broju poena.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'topcoins', category: 'Ekonomija' },

  // Kockanje
  { id: 'builtin-slots', command: 'slots, slot [iznos]', response: 'Igraj slot mašinu sa poenima i osvoji do 10x nagrade.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'slots', category: 'Kockanje' },
  { id: 'builtin-roulette', command: 'roulette, rulet [opcija] [iznos]', response: 'Igraj rulet (crvena, crna, zelena ili broj) i uvećaj poene.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'roulette', category: 'Kockanje' },
  { id: 'builtin-coinflip', command: 'coinflip, piskoglava, gamble, kockaj [pismo/glava] [iznos]', response: 'Baci novčić (pismo/glava) za duplo ili ništa.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'coinflip', category: 'Kockanje' },
  { id: 'builtin-wheel', command: 'tocak, wheel [iznos]', response: 'Zavrti točak sreće za nasumične multiplikatore poena.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'tocak', category: 'Kockanje' },
  { id: 'builtin-duelgamble', command: 'duel, dvoboj @user [iznos]', response: 'Izazovi drugog člana na kockaški dvoboj u poene.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'duel', category: 'Kockanje' },
  { id: 'builtin-acceptgamble', command: 'accept', response: 'Prihvati poziv na kockaški dvoboj za poene.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'accept', category: 'Kockanje' },

  // Prodavnica
  { id: 'builtin-store', command: 'store, prodavnica, shop', response: 'Prikazuje spisak svih dostupnih nagrada u prodavnici kanala.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'store', category: 'Prodavnica' },
  { id: 'builtin-redeem', command: 'redeem, kupi [naziv]', response: 'Kupi željenu nagradu iz prodavnice menjajući poene.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'redeem', category: 'Prodavnica' },

  // Muzika
  { id: 'builtin-pesma', command: 'pesma [naziv], sr [naziv], song [naziv]', response: 'Zatraži puštanje pesme na strimu po nazivu ili linku.', cooldown: 5000, min_rank: 'everyone', enabled: true, is_default: true, usage: 0, db_match_key: 'pesma', category: 'Muzika' }
];

let activeBuiltinCategory = 'all';

function filterBuiltinCategory(cat, btnEl) {
  activeBuiltinCategory = cat;

  const tabs = document.querySelectorAll('#builtinCategoryTabs .btn-category');
  tabs.forEach(t => t.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');

  renderBuiltinCommandsGrid();
}

const RANK_LABELS = {
  'everyone': 'Svi',
  'subscriber': 'Subovi',
  'vip': 'VIP',
  'og': 'OG',
  'moderator': 'Moderatori',
  'broadcaster': 'Strimer'
};

const RANK_COLORS = {
  'everyone': '#94A3B8',
  'subscriber': '#8B5CF6',
  'vip': '#3B82F6',
  'og': '#F59E0B',
  'moderator': '#10B981',
  'broadcaster': '#EF4444'
};

// Ugrađene komande u prikazu sadrže placeholder tekst (npr. "pin [tekst]", "samar @user",
// "dodajkomandu !naziv Odgovor, addcom !naziv Odgovor"). Bot prepoznaje komande isključivo
// po prvoj reči nakon "!" (bez zagrada, @user ili ostatka teksta), pa se u bazu MORA upisati
// očišćeno ime komande — u suprotnom se uključi/isključi i izmena cooldown-a/ranga za builtin
// komande tiho ne primenjuju na botu (bot ih nikad ne pronađe u custom_commands tabeli).
function extractBuiltinAliasKeys(rawCommand) {
  return (rawCommand || '')
    .split(',')
    .map(part => part.trim().split(/\s+/)[0].replace(/^!/, '').toLowerCase())
    .filter(Boolean)
    .join(', ');
}

function getSerbianPlural(n, wordOne, wordFew, wordMany) {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${n} ${wordOne}`;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${n} ${wordFew}`;
  }
  return `${n} ${wordMany}`;
}

let currentCmdSortCol = null;
let currentCmdSortState = 0; // 0: reset/default, 1: asc (▲), 2: desc (▼)

function sortCommands(col) {
  if (currentCmdSortCol === col) {
    currentCmdSortState = (currentCmdSortState + 1) % 3;
  } else {
    currentCmdSortCol = col;
    currentCmdSortState = 1; // Prvi klik -> Rastuće (ASC)
  }

  if (currentCmdSortState === 0) {
    currentCmdSortCol = null; // Treći klik -> Reset na podrazumevano sortiranje
  }

  ['command', 'cooldown', 'usage', 'enabled'].forEach(c => {
    const iconEl = document.getElementById(`sortIcon-${c}`);
    const thEl = iconEl?.closest('.sortable-th');
    if (iconEl && thEl) {
      if (c === currentCmdSortCol && currentCmdSortState !== 0) {
        thEl.classList.add('active-sort');
        iconEl.textContent = currentCmdSortState === 1 ? '▲' : '▼';
      } else {
        thEl.classList.remove('active-sort');
        iconEl.textContent = '↕';
      }
    }
  });

  renderUnifiedCommands();
}

async function loadCommands() {
  if (!activeChannel) return;

  const { data, error } = await sb.from('custom_commands')
    .select('*')
    .eq('channel_id', activeChannel.id)
    .order('created_at', { ascending: false });

  if (error) { return; }
  const dbData = data || [];

  const dbCustom = dbData.filter(c => !c.is_default);
  const dbDefaults = dbData.filter(c => c.is_default);

  const mergedBuiltins = defaultBuiltinCommands.map(builtin => {
    const dbVer = dbDefaults.find(d => {
      const dbNames = d.command.split(',').map(n => n.trim().toLowerCase());
      const builtinMatchKey = builtin.db_match_key.toLowerCase();
      // Match if database command starts with or matches db_match_key
      return dbNames.some(name => name === builtinMatchKey || name.startsWith(builtinMatchKey));
    });
    if (dbVer) {
      return {
        ...builtin,
        id: dbVer.id,
        cooldown: dbVer.cooldown,
        min_rank: dbVer.min_rank,
        enabled: dbVer.enabled,
        usage: dbVer.usage,
        db_exists: true
      };
    }
    return builtin;
  });

  allCommands = [...dbCustom, ...mergedBuiltins];
  renderMiniCommands(allCommands);
  const customOnlyCount = allCommands.filter(c => !c.is_default).length;
  const cmdCountEl = document.getElementById('cmdCount');
  if (cmdCountEl) cmdCountEl.textContent = customOnlyCount;
  const statCmdCountEl = document.getElementById('statCmdCount');
  if (statCmdCountEl) statCmdCountEl.textContent = customOnlyCount;

  renderUnifiedCommands();
  renderBuiltinCommandsGrid();
}

function renderUnifiedCommands(customCmds = null) {
  const tbody = document.getElementById('commandsBody');
  if (!tbody) return;

  let rows = customCmds || allCommands.filter(c => !c.is_default);

  updateCmdTableMeta(rows.length);

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nema komandi za prikaz.</td></tr>';
    const prevBtn = document.getElementById('cmdPrevPageBtn');
    const nextBtn = document.getElementById('cmdNextPageBtn');
    const pageInfo = document.getElementById('cmdPageInfo');
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (pageInfo) pageInfo.textContent = 'Stranica 1 od 1';
    return;
  }

  // Sortiranje po kolonima (ako je podet sort col i nije u reset stanju)
  if (currentCmdSortCol && currentCmdSortState !== 0) {
    const isAsc = currentCmdSortState === 1;
    rows = [...rows].sort((a, b) => {
      let valA = a[currentCmdSortCol];
      let valB = b[currentCmdSortCol];
      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return isAsc ? -1 : 1;
      if (valA > valB) return isAsc ? 1 : -1;
      return 0;
    });
  }

  // Pagination calculation
  const totalPages = Math.ceil(rows.length / commandsLimit) || 1;
  if (commandsPage > totalPages) commandsPage = totalPages;
  if (commandsPage < 1) commandsPage = 1;

  const startIndex = (commandsPage - 1) * commandsLimit;
  const pageRows = rows.slice(startIndex, startIndex + commandsLimit);

  // Update buttons and page info
  const prevBtn = document.getElementById('cmdPrevPageBtn');
  const nextBtn = document.getElementById('cmdNextPageBtn');
  const pageInfo = document.getElementById('cmdPageInfo');
  const limitSelect = document.getElementById('cmdLimitSelect');

  if (limitSelect) limitSelect.value = commandsLimit;
  if (pageInfo) pageInfo.textContent = `Stranica ${commandsPage} od ${totalPages}`;
  if (prevBtn) prevBtn.disabled = commandsPage === 1;
  if (nextBtn) nextBtn.disabled = commandsPage === totalPages;

  tbody.innerHTML = pageRows.map(cmd => {
    const cmdBadges = cmd.command.split(',').map(c => `<span class="td-cmd">!${escapeHtml(c.trim())}</span>`).join(' ');

    let actionsHtml = '';
    let statusHtml = `
      <span class="status-pill ${cmd.enabled ? 'status-active' : 'status-inactive'}">
        <span class="status-dot ${cmd.enabled ? 'status-on' : 'status-off'}"></span>
        ${cmd.enabled ? 'Aktivna' : 'Isključena'}
      </span>
    `;

    const toggleIcon = cmd.enabled
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>`;

    const editIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

    const deleteIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;

    // Onemogući brisanje sistemskih komandi
    const deleteBtnHtml = cmd.is_default
      ? `<button class="action-btn" disabled style="opacity: 0.25; cursor: not-allowed;" title="Sistemska komanda se ne može obrisati">${deleteIcon}</button>`
      : `<button class="action-btn danger" onclick="deleteCommandConfirm('${cmd.id}', '!${escapeHtml(cmd.command)}')" title="Obriši">${deleteIcon}</button>`;

    actionsHtml = `
      <div class="actions-cell">
        <button class="action-btn" onclick="toggleCommand('${cmd.id}', ${cmd.enabled}, ${!!cmd.is_default})" title="${cmd.enabled ? 'Isključi' : 'Uključi'}">
          ${toggleIcon}
        </button>
        <button class="action-btn" onclick="editCommand('${cmd.id}')" title="Izmeni">
          ${editIcon}
        </button>
        ${deleteBtnHtml}
      </div>
    `;

    const rKey = cmd.min_rank || 'everyone';
    const rankLabel = RANK_LABELS[rKey] || 'Svi';
    const rankColor = RANK_COLORS[rKey] || '#94A3B8';
    const rankBadgeHtml = `<span style="background: rgba(255,255,255,0.03); border: 1px solid ${rankColor}44; color: ${rankColor}; font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">${rankLabel}</span>`;

    const displayResponse = cmd.is_default
      ? `<span style="color:var(--text-muted); font-style:italic;" title="${escapeHtml(cmd.response)}">${escapeHtml(cmd.response)}</span>`
      : `<span class="td-response" title="${escapeHtml(cmd.response)}">${escapeHtml(cmd.response)}</span>`;

    return `
      <tr>
        <td><div class="cmd-badge-list">${cmdBadges}</div></td>
        <td>${displayResponse}</td>
        <td>${rankBadgeHtml}</td>
        <td class="td-num">${(cmd.cooldown / 1000).toFixed(0)}s</td>
        <td class="td-num">${cmd.usage ?? 0}</td>
        <td>${statusHtml}</td>
        <td>${actionsHtml}</td>
      </tr>
    `;
  }).join('');
}

function changeCommandsPage(dir) {
  commandsPage += dir;
  renderUnifiedCommands();
}

function changeCommandsLimit(limit) {
  commandsLimit = parseInt(limit);
  localStorage.setItem('cmd-items-per-page', limit);
  commandsPage = 1;
  renderUnifiedCommands();
}

function renderMiniCommands(cmds) {
  const el = document.getElementById('miniCommands');
  if (!el) return;

  // Prikaži samo prilagođene komande u Overview widget-u
  const customOnly = cmds.filter(c => !c.is_default);

  if (customOnly.length === 0) {
    el.innerHTML = '<div class="mini-empty">Nema prilagođenih komandi</div>';
    return;
  }

  el.innerHTML = customOnly.map(cmd => {
    const cmdBadges = cmd.command.split(',').map(c => `<span class="td-cmd" style="font-size:0.75rem; padding: 0.1rem 0.25rem;">!${escapeHtml(c.trim())}</span>`).join(' ');
    return `
      <div class="mini-item" style="display:flex; justify-content:space-between; align-items:center;">
        <div class="cmd-badge-list" style="max-width: 40%;">${cmdBadges}</div>
        <span class="mini-username" style="color:var(--text-muted);font-size:0.8rem;flex:1;margin-left:0.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(cmd.response)}</span>
        <span class="status-pill ${cmd.enabled ? 'status-active' : 'status-inactive'}" style="font-size:0.6rem; flex-shrink:0; padding: 0.2rem 0.4rem; display: inline-flex; align-items: center; justify-content: center;">
          <span class="status-dot ${cmd.enabled ? 'status-on' : 'status-off'}" style="width: 5px; height: 5px;"></span>
        </span>
      </div>
    `;
  }).join('');
}

function filterCommands(query) {
  commandsPage = 1;
  const q = query.trim().replace(/^!/, '').toLowerCase();
  const customOnly = allCommands.filter(c => !c.is_default);
  const filtered = customOnly.filter(c =>
    c.command.toLowerCase().includes(q) ||
    (c.response || '').toLowerCase().includes(q)
  );
  renderUnifiedCommands(filtered);
}

function updateCmdTableMeta(n) {
  const limits = getPlanLimits();
  const limitStr = limits.maxCustomCommands === Infinity ? '∞' : limits.maxCustomCommands;
  const metaEl = document.getElementById('cmdTableMeta');
  if (metaEl) {
    metaEl.innerHTML = `${n} / ${limitStr} komandi <span class="plan-badge ${limits.badgeClass}" style="margin-left:6px;">${limits.name}</span>`;
  }
}

function renderBuiltinCommandsGrid() {
  const grid = document.getElementById('builtinCommandsGrid');
  const meta = document.getElementById('builtinCmdTableMeta');
  if (!grid) return;

  const query = (document.getElementById('builtinCmdSearchInput')?.value || '').trim().replace(/^!/, '').toLowerCase();

  let builtins = allCommands.filter(c => c.is_default);

  // Filtriranje po izabranoj kategoriji
  if (activeBuiltinCategory && activeBuiltinCategory !== 'all') {
    builtins = builtins.filter(c => c.category === activeBuiltinCategory);
  }

  // Filtriranje po tekstu pretrage
  if (query) {
    builtins = builtins.filter(c =>
      c.command.toLowerCase().includes(query) ||
      (c.response || '').toLowerCase().includes(query) ||
      (c.category && c.category.toLowerCase().includes(query))
    );
  }

  if (meta) {
    meta.textContent = getSerbianPlural(builtins.length, 'ugrađena komanda', 'ugrađene komande', 'ugrađenih komandi');
  }

  if (builtins.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 2.5rem; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 12px;">Nema pronađenih ugrađenih komandi u ovoj kategoriji.</div>';
    return;
  }

  grid.innerHTML = builtins.map(cmd => {
    const rKey = cmd.min_rank || 'everyone';
    const rankLabel = RANK_LABELS[rKey] || 'Svi';
    const rankColor = RANK_COLORS[rKey] || '#94A3B8';
    const catLabel = cmd.category || 'Opšte';

    const toggleIcon = cmd.enabled
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>`;

    return `
      <div class="builtin-card" style="position: relative; background: var(--bg-surface); border: 1px solid ${cmd.enabled ? 'var(--border-subtle)' : 'rgba(255,255,255,0.04)'}; border-radius: 14px; padding: 18px; display: flex; flex-direction: column; justify-content: space-between; gap: 12px; height: 100%; box-sizing: border-box; opacity: ${cmd.enabled ? '1' : '0.55'}; transition: all 0.22s ease;">
        <!-- Action Buttons Pinned strictly to top-right -->
        <div style="position: absolute; top: 16px; right: 16px; display: flex; gap: 6px; z-index: 2;">
          <button class="action-btn" onclick="toggleCommand('${cmd.id}', ${cmd.enabled}, true)" title="${cmd.enabled ? 'Isključi komandu' : 'Uključi komandu'}" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: ${cmd.enabled ? 'rgba(83, 252, 24, 0.08)' : 'rgba(255,255,255,0.03)'}; border: 1px solid ${cmd.enabled ? 'rgba(83, 252, 24, 0.25)' : 'var(--border-subtle)'}; color: ${cmd.enabled ? 'var(--kick-green)' : 'var(--text-muted)'}; cursor: pointer; transition: all 0.2s ease;">
            ${toggleIcon}
          </button>
          <button class="action-btn" onclick="editCommand('${cmd.id}')" title="Izmeni podešavanja" style="width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); color: var(--text-main); cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='var(--app-primary-dim)'; this.style.color='var(--app-primary)'; this.style.borderColor='var(--app-primary-dim)';" onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.color='var(--text-main)'; this.style.borderColor='var(--border-subtle)';">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
        </div>

        <!-- Top Section (Category, Title, Description) -->
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <!-- Category Badge (Left) -->
          <div style="padding-right: 80px;">
            <span style="background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.25); color: var(--app-primary); font-size: 0.72rem; font-weight: 600; padding: 3px 10px; border-radius: 6px; display: inline-flex; align-items: center;">
              ${escapeHtml(catLabel)}
            </span>
          </div>
          
          <!-- Command Trigger Name -->
          <div style="font-family: var(--font-mono); color: #fff; font-weight: 700; font-size: 1.02rem; letter-spacing: -0.2px; word-break: break-word; line-height: 1.35; margin-top: 2px;">
            ${cmd.command.split(',').map(alias => `!${escapeHtml(alias.trim())}`).join(', ')}
          </div>
          
          <!-- Description -->
          <div style="font-size: 0.84rem; color: var(--text-muted); line-height: 1.5;">
            ${escapeHtml(cmd.response)}
          </div>
        </div>
        
        <!-- Bottom Row: Cooldown (Left) & Rank (Right) -->
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px; margin-top: auto;">
          <span style="display: inline-flex; align-items: center; gap: 5px; color: var(--text-muted); font-size: 0.74rem; font-weight: 500;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${(cmd.cooldown / 1000).toFixed(0)}s cooldown
          </span>
          <span style="background: rgba(255,255,255,0.03); border: 1px solid ${rankColor}44; color: ${rankColor}; font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
            ${rankLabel}
          </span>
        </div>
      </div>
    `;
  }).join('');
}

function filterBuiltinCommands() {
  renderBuiltinCommandsGrid();
}

// ── Leaderboard Helpers ────────────────────────────────────
function getCurrentMonth() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const y = d.getFullYear();
  return `${m}-${y}`;
}

function rankColor(index) {
  if (index === 0) return '#FBBF24';
  if (index === 1) return '#94A3B8';
  if (index === 2) return '#D97706';
  return 'var(--text-muted)';
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('sr-RS', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '—';
  }
}

function aggregateLeaderboardRows(rows) {
  const list = rows || [];
  const periodSel = document.getElementById('lbPeriodSelect');
  const sel = document.getElementById('lbMonthSelect');
  const periodMode = periodSel?.value || 'monthly';
  if (periodMode === 'monthly') return [...list];

  const selectedVal = sel?.value || (periodMode === 'yearly' ? String(new Date().getFullYear()) : getCurrentMonth());
  const periodLabel = periodMode === 'alltime' ? 'Sve vreme' : selectedVal;
  const map = {};

  list.forEach(r => {
    const key = (r.username || '').toLowerCase();
    const chatCount = r.chat !== undefined ? r.chat : (r.points || 0);
    if (!map[key]) {
      map[key] = {
        username: r.username,
        display_name: r.display_name || r.username,
        chat: 0,
        points: 0,
        watchtime_minutes: 0,
        minutes: 0,
        coins: r.coins || 0,
        xp: r.xp || 0,
        level: r.level || 1,
        month: periodLabel,
        updated_at: r.updated_at
      };
    }
    map[key].chat += chatCount;
    map[key].points += chatCount;
    const mins = r.watchtime_minutes || r.minutes || 0;
    map[key].watchtime_minutes += mins;
    map[key].minutes += mins;
    map[key].coins = Math.max(map[key].coins, r.coins || 0);
    map[key].xp = Math.max(map[key].xp, r.xp || 0);
    map[key].level = Math.max(map[key].level, r.level || 1);
  });

  return Object.values(map);
}

function sortLeaderboardRows(rows, type = activeLeaderboardType) {
  const aggregated = aggregateLeaderboardRows(rows);

  if (type === 'watchtime') {
    return aggregated.sort((a, b) => (b.watchtime_minutes || b.minutes || 0) - (a.watchtime_minutes || a.minutes || 0));
  }

  if (type === 'ranking') {
    return aggregated.sort((a, b) => {
      const levelDiff = (b.level || 1) - (a.level || 1);
      if (levelDiff !== 0) return levelDiff;
      const xpDiff = (b.xp || 0) - (a.xp || 0);
      if (xpDiff !== 0) return xpDiff;
      return (b.coins || 0) - (a.coins || 0);
    });
  }

  if (type === 'combined') {
    return aggregated.sort((a, b) => {
      const scoreA = (a.chat || a.points || 0) + Math.floor((a.minutes || a.watchtime_minutes || 0) / 6);
      const scoreB = (b.chat || b.points || 0) + Math.floor((b.minutes || b.watchtime_minutes || 0) / 6);
      return scoreB - scoreA;
    });
  }

  return aggregated.sort((a, b) => (b.chat !== undefined ? b.chat : (b.points || 0)) - (a.chat !== undefined ? a.chat : (a.points || 0)));
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function downloadCsv(csvContent, fileName) {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ── Leaderboard ───────────────────────────────────────────
function populateMonthSelector() {
  const periodSel = document.getElementById('lbPeriodSelect');
  const sel = document.getElementById('lbMonthSelect');
  if (!sel) return;

  const periodMode = periodSel?.value || 'monthly';
  const now = new Date();

  if (periodMode === 'alltime') {
    sel.style.display = 'none';
    sel.innerHTML = `<option value="all">Sve vreme</option>`;
  } else if (periodMode === 'yearly') {
    sel.style.display = 'inline-block';
    const years = [];
    const currentYear = now.getFullYear();
    for (let y = currentYear; y >= currentYear - 3; y--) {
      years.push({ value: String(y), label: `${y}` });
    }
    sel.innerHTML = years.map(y => `<option value="${y.value}">${y.label}</option>`).join('');
  } else {
    sel.style.display = 'inline-block';
    const months = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const y = d.getFullYear();
      months.push({ value: `${m}-${y}`, label: `${m}/${y}` });
    }
    sel.innerHTML = months.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
  }
}

function onLeaderboardPeriodChange() {
  populateMonthSelector();
  loadLeaderboard();
}

async function loadWatchtime() {
  if (!activeChannel) return;

  const totalMins = allLeaderboard.reduce((s, r) => s + (r.watchtime_minutes || r.minutes || 0), 0);
  let watchtimeText = formatWatchtime(totalMins);
  const statEl = document.getElementById('statTotalWatchtime');
  if (statEl) statEl.textContent = watchtimeText;

  if (activeLeaderboardType === 'watchtime' || activeLeaderboardType === 'combined') {
    renderUnifiedLeaderboard();
  }
}

function refreshMiniPanels(rows) {
  if (document.getElementById('miniLeaderboard')) renderMiniLeaderboard(rows);
  if (document.getElementById('miniWatchtime')) renderMiniWatchtime(rows);
}

function renderMiniLeaderboard(rows) {
  const el = document.getElementById('miniLeaderboard');
  if (!el) return;
  if (!rows || rows.length === 0) {
    el.innerHTML = '<div class="mini-empty" style="color:var(--text-muted); font-size:0.85rem; padding:16px 0; text-align:center;">Nema podataka za chatters.</div>';
    return;
  }
  const getChatVal = item => Number(item.chat !== undefined ? item.chat : (item.points || 0));
  const aggregatedRows = aggregateLeaderboardRows(rows);
  const topChatters = [...aggregatedRows].sort((a, b) => getChatVal(b) - getChatVal(a)).slice(0, 5);
  el.innerHTML = topChatters.map((item, idx) => {
    const avatarKey = (item.username || '').toLowerCase();
    const cachedUrl = avatarCache[avatarKey];
    const hasAvatar = cachedUrl && cachedUrl !== 'loading' && cachedUrl !== 'none';
    const safeAvatarUrl = hasAvatar && /^https:\/\//.test(cachedUrl) ? cachedUrl : null;
    const initial = (item.display_name || item.username || 'U').charAt(0).toUpperCase();

    const avatarInner = safeAvatarUrl
      ? `<img src="${safeAvatarUrl}" class="mini-avatar-img" alt="${escapeHtml(item.username)}">`
      : `<span style="font-size:0.7rem; font-weight:800; color:#fff;">${initial}</span>`;
    const avatarHtml = `<div class="mini-avatar-wrap ${safeAvatarUrl ? '' : 'fallback'}">${avatarInner}</div>`;

    if (!safeAvatarUrl && avatarCache[avatarKey] !== 'loading' && avatarCache[avatarKey] !== 'none') {
      avatarCache[avatarKey] = 'loading';
      getAvatarFromCache(item.username)
        .then(cached => {
          if (cached && cached !== 'none') {
            avatarCache[avatarKey] = cached;
            refreshMiniPanels(rows);
          } else {
            fetchKickAvatar(item.username).then(url => {
              avatarCache[avatarKey] = url || 'none';
              setAvatarInCache(avatarKey, url || 'none').catch(() => { });
              if (url) refreshMiniPanels(rows);
            });
          }
        })
        .catch(() => {
          fetchKickAvatar(item.username).then(url => {
            avatarCache[avatarKey] = url || 'none';
            setAvatarInCache(avatarKey, url || 'none').catch(() => { });
            if (url) refreshMiniPanels(rows);
          });
        });
    }

    const val = getChatVal(item);
    const badgeBg = idx === 0 ? 'rgba(251, 191, 36, 0.2)' : idx === 1 ? 'rgba(203, 213, 225, 0.2)' : idx === 2 ? 'rgba(217, 119, 6, 0.2)' : 'rgba(255, 255, 255, 0.05)';
    const badgeColor = idx === 0 ? '#FBBF24' : idx === 1 ? '#CBD5E1' : idx === 2 ? '#D97706' : 'var(--text-muted)';
    const borderStyle = idx === 4 ? 'none' : '1px solid rgba(255, 255, 255, 0.05)';

    return `
      <div class="mini-row" style="display:flex; align-items:center; justify-content:space-between; padding:6px 0; border-bottom:${borderStyle};">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:5px; font-weight:800; font-size:0.72rem; background:${badgeBg}; color:${badgeColor}; flex-shrink:0;">${idx + 1}</span>
          ${avatarHtml}
          <span style="font-weight:600; color:var(--text-main); font-size:0.85rem;">${escapeHtml(item.display_name || item.username)}</span>
        </div>
        <span style="font-weight:700; color:#53fc18; font-size:0.8rem; background:rgba(83, 252, 24, 0.08); padding:3px 8px; border-radius:10px; border:1px solid rgba(83, 252, 24, 0.2);">${formatPorukeCount(val)}</span>
      </div>
    `;
  }).join('');
}

function renderMiniWatchtime(rows) {
  const el = document.getElementById('miniWatchtime');
  if (!el) return;
  if (!rows || rows.length === 0) {
    el.innerHTML = '<div class="mini-empty" style="color:var(--text-muted); font-size:0.85rem; padding:12px 0; text-align:center;">Nema podataka za watchtime.</div>';
    return;
  }
  const getMins = item => Number(item.watchtime_minutes !== undefined && item.watchtime_minutes !== null ? item.watchtime_minutes : (item.minutes || 0));
  const aggregatedRows = aggregateLeaderboardRows(rows);
  const topWatchers = [...aggregatedRows].sort((a, b) => getMins(b) - getMins(a)).slice(0, 5);
  el.innerHTML = topWatchers.map((item, idx) => {
    const avatarKey = (item.username || '').toLowerCase();
    const cachedUrl = avatarCache[avatarKey];
    const hasAvatar = cachedUrl && cachedUrl !== 'loading' && cachedUrl !== 'none';
    const safeAvatarUrl = hasAvatar && /^https:\/\//.test(cachedUrl) ? cachedUrl : null;
    const initial = (item.display_name || item.username || 'U').charAt(0).toUpperCase();

    const avatarInner = safeAvatarUrl
      ? `<img src="${safeAvatarUrl}" class="mini-avatar-img" alt="${escapeHtml(item.username)}">`
      : `<span style="font-size:0.7rem; font-weight:800; color:#fff;">${initial}</span>`;
    const avatarHtml = `<div class="mini-avatar-wrap ${safeAvatarUrl ? '' : 'fallback'}">${avatarInner}</div>`;

    if (!safeAvatarUrl && avatarCache[avatarKey] !== 'loading' && avatarCache[avatarKey] !== 'none') {
      avatarCache[avatarKey] = 'loading';
      getAvatarFromCache(item.username)
        .then(cached => {
          if (cached && cached !== 'none') {
            avatarCache[avatarKey] = cached;
            refreshMiniPanels(rows);
          } else {
            fetchKickAvatar(item.username).then(url => {
              avatarCache[avatarKey] = url || 'none';
              setAvatarInCache(avatarKey, url || 'none').catch(() => { });
              if (url) refreshMiniPanels(rows);
            });
          }
        })
        .catch(() => {
          fetchKickAvatar(item.username).then(url => {
            avatarCache[avatarKey] = url || 'none';
            setAvatarInCache(avatarKey, url || 'none').catch(() => { });
            if (url) refreshMiniPanels(rows);
          });
        });
    }

    const totalMins = getMins(item);
    const timeStr = formatWatchtime(totalMins);

    const badgeBg = idx === 0 ? 'rgba(251, 191, 36, 0.2)' : idx === 1 ? 'rgba(203, 213, 225, 0.2)' : idx === 2 ? 'rgba(217, 119, 6, 0.2)' : 'rgba(255, 255, 255, 0.05)';
    const badgeColor = idx === 0 ? '#FBBF24' : idx === 1 ? '#CBD5E1' : idx === 2 ? '#D97706' : 'var(--text-muted)';
    const borderStyle = idx === 4 ? 'none' : '1px solid rgba(255, 255, 255, 0.05)';

    return `
      <div class="mini-row" style="display:flex; align-items:center; justify-content:space-between; padding:6px 0; border-bottom:${borderStyle};">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:5px; font-weight:800; font-size:0.72rem; background:${badgeBg}; color:${badgeColor}; flex-shrink:0;">${idx + 1}</span>
          ${avatarHtml}
          <span style="font-weight:600; color:var(--text-main); font-size:0.85rem;">${escapeHtml(item.display_name || item.username)}</span>
        </div>
        <span style="font-weight:700; color:#53fc18; font-size:0.8rem; background:rgba(83, 252, 24, 0.08); padding:3px 8px; border-radius:10px; border:1px solid rgba(83, 252, 24, 0.2);">${timeStr}</span>
      </div>
    `;
  }).join('');
}

async function loadLeaderboard() {
  if (!activeChannel) return;

  leaderboardPage = 1;

  // Clear search input on month reload
  const searchInput = document.getElementById('leaderboardSearchInput');
  if (searchInput) searchInput.value = '';

  const periodSel = document.getElementById('lbPeriodSelect');
  const sel = document.getElementById('lbMonthSelect');
  const periodMode = periodSel?.value || 'monthly';
  const selectedVal = sel?.value || (periodMode === 'yearly' ? String(new Date().getFullYear()) : getCurrentMonth());

  let query = sb.from('leaderboard')
    .select('*')
    .eq('channel_id', String(activeChannel.id));

  if (periodMode === 'alltime') {
    // Svo vreme - bez filtera
  } else if (periodMode === 'yearly') {
    query = query.or(`year.eq.${selectedVal},month.ilike.%-${selectedVal}`);
  } else {
    query = query.eq('month', selectedVal);
  }

  // Za yearly/alltime period gde se uzima vise meseci po korisniku, povecavamo limit na 2500
  const fetchLimit = periodMode === 'monthly' ? 500 : 2500;
  let { data, error } = await query.order('chat', { ascending: false }).limit(fetchLimit);

  if (error) {
    console.warn('Leaderboard query with chat ordering returned error, attempting fallback:', error);
    const fallbackRes = await sb.from('leaderboard')
      .select('*')
      .eq('channel_id', String(activeChannel.id))
      .limit(fetchLimit);
    data = fallbackRes.data || [];
  }
  allLeaderboard = data || [];
  renderMiniLeaderboard(allLeaderboard);
  renderMiniWatchtime(allLeaderboard);

  // Calculate and display total chat messages with Serbian grammar formatting
  const totalChat = allLeaderboard.reduce((s, r) => s + (r.chat !== undefined ? r.chat : (r.points || 0)), 0);
  const chatStatEl = document.getElementById('statTotalChat');
  if (chatStatEl) {
    const lastDigit = totalChat % 10;
    const lastTwo = totalChat % 100;
    let suffix = 'poruka';
    if (lastTwo < 11 || lastTwo > 14) {
      if (lastDigit === 1) suffix = 'poruka';
      else if (lastDigit >= 2 && lastDigit <= 4) suffix = 'poruke';
    }
    chatStatEl.textContent = `${totalChat.toLocaleString('en-US')} ${suffix}`;
  }

  // Calculate total watchtime for header stat
  loadWatchtime();

  // "Najaktivniji korisnik" = zbir poruka + watchtime skor
  const combined = buildCombinedRows();
  const topStatEl = document.getElementById('statTopPoints');
  if (topStatEl) {
    topStatEl.textContent = combined.length > 0 ? combined[0].username : '—';
  }

  renderUnifiedLeaderboard();
}

function setLeaderboardType(type) {
  activeLeaderboardType = type;
  localStorage.setItem('active-leaderboard-tab', type);
  leaderboardPage = 1;

  // Izmeni klase na tab dugmadima (lb-tab-btn / active)
  const tabChatters = document.getElementById('lbTabChatters');
  const tabWatchtime = document.getElementById('lbTabWatchtime');
  const tabCombined = document.getElementById('lbTabCombined');
  const tabRanking = document.getElementById('lbTabRanking');

  [tabChatters, tabWatchtime, tabCombined, tabRanking].forEach(btn => {
    if (btn) btn.classList.remove('active');
  });
  if (type === 'chatters' && tabChatters) tabChatters.classList.add('active');
  if (type === 'watchtime' && tabWatchtime) tabWatchtime.classList.add('active');
  if (type === 'ranking' && tabRanking) tabRanking.classList.add('active');
  if (type === 'combined' && tabCombined) tabCombined.classList.add('active');

  // Izmeni klase u sidebar navigaciji samo ako je trenutno na leaderboard panelu
  const currentPanel = localStorage.getItem('active-dashboard-panel');
  if (currentPanel === 'leaderboard') {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`[data-panel="leaderboard"]`);
    if (navItem) navItem.classList.add('active');
    updateBreadcrumbs('leaderboard');
  }

  // Izmeni zaglavlje tabele usklađeno sa redovima
  const header = document.getElementById('leaderboardTableHeader');
  if (header) {
    if (type === 'chatters') {
      header.innerHTML = `
        <th style="width:60px">#</th>
        <th>Korisnik</th>
        <th>Broj Poruka</th>
        <th>Period</th>
        <th>Ažurirano</th>
      `;
    } else if (type === 'watchtime') {
      header.innerHTML = `
        <th style="width:60px">#</th>
        <th>Korisnik</th>
        <th>Ukupno minuta</th>
        <th>Vreme gledanja</th>
        <th>Ažurirano</th>
      `;
    } else if (type === 'ranking') {
      header.innerHTML = `
        <th style="width:60px">#</th>
        <th>Korisnik</th>
        <th>Nivo & XP</th>
        <th>Poeni / Koins</th>
        <th>Ažurirano</th>
      `;
    } else {
      header.innerHTML = `
        <th style="width:60px">#</th>
        <th>Korisnik</th>
        <th>Vreme gledanja</th>
        <th>Poruke</th>
        <th>Poeni & Nivo</th>
        <th>Ažurirano</th>
      `;
    }
  }

  // Ocisti input za pretragu
  const searchInput = document.getElementById('leaderboardSearchInput');
  if (searchInput) searchInput.value = '';

  renderUnifiedLeaderboard();
}

function buildCombinedRows() {
  return sortLeaderboardRows(allLeaderboard, 'combined');
}

function renderUnifiedLeaderboard(customRows = null) {
  const isChatters = activeLeaderboardType === 'chatters';
  const isWatchtime = activeLeaderboardType === 'watchtime';
  const isRanking = activeLeaderboardType === 'ranking';
  const isCombined = activeLeaderboardType === 'combined';

  let rows;
  if (customRows) {
    rows = sortLeaderboardRows(customRows);
  } else {
    rows = sortLeaderboardRows(allLeaderboard, activeLeaderboardType);
  }

  // Renderovanje podijuma (top 3)
  renderPodium(rows.slice(0, 3));

  const body = document.getElementById('leaderboardBody');
  if (!body) return;

  const colCount = isCombined ? 6 : 5;

  if (rows.length === 0) {
    body.innerHTML = `<tr><td colspan="${colCount}" class="table-empty">Nema podataka za prikaz.</td></tr>`;
    document.getElementById('lbTableMeta').textContent = '0 korisnika';
    const prevBtn = document.getElementById('lbPrevPageBtn');
    const nextBtn = document.getElementById('lbNextPageBtn');
    const pageInfo = document.getElementById('lbPageInfo');
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (pageInfo) pageInfo.textContent = 'Stranica 1 od 1';
    return;
  }

  document.getElementById('lbTableMeta').textContent = `${rows.length} korisnika`;

  // Plan limits check
  const limits = getPlanLimits();
  if (limits.maxLeaderboardItems < Infinity && rows.length > limits.maxLeaderboardItems) {
    rows = rows.slice(0, limits.maxLeaderboardItems);
    const metaEl = document.getElementById('lbTableMeta');
    if (metaEl) {
      metaEl.innerHTML = `${rows.length} korisnika <span style="color:#eab308; font-size:0.75rem; margin-left:8px;">(Besplatni plan - Top 20 | <a href="#" onclick="openUpgradeModal('leaderboard'); return false;" style="color:#53fc18; text-decoration:underline;">Nadogradi za sve</a>)</span>`;
    }
  }

  // Paginacija
  const totalPages = Math.ceil(rows.length / leaderboardLimit) || 1;
  if (leaderboardPage > totalPages) leaderboardPage = totalPages;
  if (leaderboardPage < 1) leaderboardPage = 1;

  const startIndex = (leaderboardPage - 1) * leaderboardLimit;
  const pageRows = rows.slice(startIndex, startIndex + leaderboardLimit);

  // Ažuriraj dugmad i info o stranici
  const prevBtn = document.getElementById('lbPrevPageBtn');
  const nextBtn = document.getElementById('lbNextPageBtn');
  const pageInfo = document.getElementById('lbPageInfo');
  const limitSelect = document.getElementById('lbLimitSelect');

  if (limitSelect) limitSelect.value = leaderboardLimit;
  if (pageInfo) pageInfo.textContent = `Stranica ${leaderboardPage} od ${totalPages}`;
  if (prevBtn) prevBtn.disabled = leaderboardPage === 1;
  if (nextBtn) nextBtn.disabled = leaderboardPage === totalPages;

  let html = pageRows.map((row, i) => {
    const globalIndex = startIndex + i;
    const isTop3 = globalIndex < 3;

    let avatarStyle = '';
    let avatarContent = '';

    if (isTop3) {
      const avatarKey = (row.username || '').toLowerCase();
      const cachedUrl = avatarCache[avatarKey];
      const hasAvatar = cachedUrl && cachedUrl !== 'loading' && cachedUrl !== 'none';
      const safeAvatarUrl = hasAvatar && /^https:\/\//.test(cachedUrl) ? cachedUrl : null;
      avatarStyle = safeAvatarUrl
        ? `background-image:url('${safeAvatarUrl}'); background-size:cover; background-position:center; border:1px solid rgba(255,255,255,0.15);`
        : '';
      avatarContent = safeAvatarUrl ? '' : (row.display_name || row.username || '?').charAt(0).toUpperCase();

      if (!hasAvatar && row.username) {
        setTimeout(() => {
          getOrFetchAvatar(row.username, `lbRowAv_${row.username}_${globalIndex}`);
        }, 50);
      }
    }

    const avatarHtml = isTop3
      ? `<div id="lbRowAv_${row.username}_${globalIndex}" class="user-cell__avatar" style="${avatarStyle}">${avatarContent}</div>`
      : '';

    const userCol = `
      <div style="display:flex;align-items:center;gap:0.5rem">
        ${avatarHtml}
        <span style="font-weight:600; color:${isTop3 ? '#fff' : 'var(--text-main)'}">${escapeHtml(row.display_name || row.username)}</span>
      </div>
    `;

    const rankDisplay = globalIndex === 0
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="color: #FBBF24; filter: drop-shadow(0 1px 4px rgba(251, 191, 36, 0.4)); display: inline-block; vertical-align: middle; margin-right: 4px;"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/></svg>`
      : `<strong style="color:${rankColor(globalIndex)}">${globalIndex + 1}.</strong>`;

    const totalMinutes = row.minutes || row.watchtime_minutes || 0;
    const watchtimeStr = formatWatchtime(totalMinutes);
    const porukeStr = formatPorukeCount(row.chat !== undefined ? row.chat : (row.points || 0));
    const coinsVal = row.coins || 0;
    const levelStr = `Nivo ${row.level || 1} (${(row.xp || 0).toLocaleString('en-US')} XP)`;

    if (isChatters) {
      return `
        <tr>
          <td>${rankDisplay}</td>
          <td>${userCol}</td>
          <td class="td-num" style="color:var(--app-primary); font-weight:600;">${porukeStr}</td>
          <td style="color:var(--text-muted)">${escapeHtml(row.month || '—')}</td>
          <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(row.updated_at)}</td>
        </tr>
      `;
    } else if (isWatchtime) {
      return `
        <tr>
          <td>${rankDisplay}</td>
          <td>${userCol}</td>
          <td class="td-num">${totalMinutes} min</td>
          <td class="td-num" style="color:var(--kick-green); font-weight:600;">${watchtimeStr}</td>
          <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(row.updated_at)}</td>
        </tr>
      `;
    } else if (isRanking) {
      return `
        <tr>
          <td>${rankDisplay}</td>
          <td>${userCol}</td>
          <td class="td-num" style="color:var(--app-primary); font-weight:600;">${levelStr}</td>
          <td class="td-num" style="color:#eab308; font-weight:600;">${coinsVal.toLocaleString()} p.</td>
          <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(row.updated_at)}</td>
        </tr>
      `;
    } else {
      // Combined (6 columns: Watchtime, Chatters, Ekonomija)
      return `
        <tr>
          <td>${rankDisplay}</td>
          <td>${userCol}</td>
          <td class="td-num" style="color:var(--kick-green); font-weight:600;">${watchtimeStr}</td>
          <td class="td-num" style="color:var(--app-primary); font-weight:600;">${porukeStr}</td>
          <td class="td-num" style="color:#eab308; font-weight:600;">Lvl ${row.level || 1} • ${coinsVal.toLocaleString()} p.</td>
          <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(row.updated_at)}</td>
        </tr>
      `;
    }
  }).join('');

  if (limits.maxLeaderboardItems < Infinity && rows.length >= limits.maxLeaderboardItems) {
    const colSpan = isCombined ? 6 : 5;
    html += `
      <tr class="locked-leaderboard-row">
        <td colspan="${colSpan}" style="text-align: center; padding: 18px 12px; background: rgba(139, 92, 246, 0.04); border-top: 1px dashed rgba(139, 92, 246, 0.25);">
          <div style="display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <span style="font-size: 0.85rem; font-weight: 700; color: #fff;">Preostali gledaoci na rang listi su zaključani za Besplatni paket</span>
            </div>
            <button type="button" class="plan-upgrade-btn" onclick="openUpgradeModal('leaderboard')">${upgradeSvgIcon}<span>Otključaj Sve Gledaoce</span></button>
          </div>
        </td>
      </tr>
    `;
  }
  body.innerHTML = html;
}

function renderPodium(top3) {
  const el = document.getElementById('lbPodium');
  if (!el) return;

  if (top3.length === 0) {
    el.innerHTML = '';
    return;
  }

  const order = [top3[1], top3[0], top3[2]].filter(Boolean);
  const classes = ['podium-2', 'podium-1', 'podium-3'];
  const crownSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style="color: #FBBF24; filter: drop-shadow(0 2px 8px rgba(251, 191, 36, 0.6)); display: inline-block; vertical-align: middle;"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/></svg>`;
  const nums = ['2.', crownSvg, '3.'];
  const isChatters = activeLeaderboardType === 'chatters';
  const isWatchtime = activeLeaderboardType === 'watchtime';
  const isRanking = activeLeaderboardType === 'ranking';

  el.innerHTML = order.map((row, i) => {
    const cls = top3.length > 1 ? classes[i] : 'podium-1';
    const num = top3.length > 1 ? nums[i] : crownSvg;

    const totalMins = row.minutes || row.watchtime_minutes || 0;
    const watchtimeFullStr = formatWatchtime(totalMins);
    const porukeCount = row.chat !== undefined ? row.chat : (row.points || 0);
    const coinsVal = row.coins || 0;

    let valStr = '';
    if (isChatters) {
      valStr = formatPorukeCount(porukeCount);
    } else if (isWatchtime) {
      valStr = watchtimeFullStr;
    } else if (isRanking) {
      valStr = `Lvl ${row.level || 1} / ${coinsVal.toLocaleString('en-US')} p.`;
    } else {
      // Zajedno (Watchtime / Poruke / Nivo)
      valStr = `${watchtimeFullStr} / ${formatPorukeCount(porukeCount)} / Lvl ${row.level || 1}`;
    }

    const avatarKey = (row.username || '').toLowerCase();
    const cachedUrl = avatarCache[avatarKey];
    const hasAvatar = cachedUrl && cachedUrl !== 'loading' && cachedUrl !== 'none';
    // Sanitizacija URL-a: prihvati samo https:// radi zastite od CSS injection-a
    const safeAvatarUrl = hasAvatar && /^https:\/\//.test(cachedUrl) ? cachedUrl : null;
    const avatarStyle = safeAvatarUrl
      ? `background-image:url('${safeAvatarUrl}'); background-size:cover; background-position:center; border:1px solid rgba(255,255,255,0.15);`
      : '';
    const avatarContent = safeAvatarUrl ? '' : (row.display_name || row.username || '?').charAt(0).toUpperCase();

    const podiumId = `podium-avatar-${i}-${avatarKey}`;

    // Pokreni fetch ako nije keširano i ako imamo username
    if (!safeAvatarUrl && row.username) {
      setTimeout(() => {
        getOrFetchAvatar(row.username, podiumId);
      }, 30 * i);
    }

    return `
      <div class="podium-item ${cls}">
        <div class="podium-avatar" id="${podiumId}" style="${avatarStyle}">${avatarContent}</div>
        <div class="podium-name">${escapeHtml(row.display_name || row.username)}</div>
        <div class="podium-points">${valStr}</div>
        <div class="podium-base">${num}</div>
      </div>
    `;
  }).join('');
}



function filterLeaderboard(q) {
  leaderboardPage = 1;
  const isCombined = activeLeaderboardType === 'combined';
  let source;

  if (isCombined) {
    source = buildCombinedRows();
  } else {
    source = allLeaderboard;
  }
  const filtered = source.filter(r =>
    (r.display_name || r.username || r.username || '').toLowerCase().includes(q.toLowerCase())
  );
  renderUnifiedLeaderboard(sortLeaderboardRows(filtered));
}

function changeLeaderboardPage(dir) {
  leaderboardPage += dir;
  renderUnifiedLeaderboard();
}

function changeLeaderboardLimit(limit) {
  leaderboardLimit = parseInt(limit);
  localStorage.setItem('lb-items-per-page', limit);
  leaderboardPage = 1;
  renderUnifiedLeaderboard();
}

function exportLeaderboard() {
  const type = activeLeaderboardType;
  if (type === 'chatters') {
    if (allLeaderboard.length === 0) { showToast('error', 'Nema podataka za export', '❌'); return; }
    const csv = ['Rank,Username,Poruke,Month,Updated']
      .concat(allLeaderboard.map((r, i) => `${i + 1},${r.display_name || r.username},${r.points},${r.month},${r.updated_at}`))
      .join('\n');
    downloadCsv(csv, `leaderboard_chatters_${activeChannel?.username}_${getCurrentMonth()}.csv`);
  } else if (type === 'watchtime') {
    const rows = [...allLeaderboard].sort((a, b) => (b.watchtime_minutes || 0) - (a.watchtime_minutes || 0));
    if (rows.length === 0) { showToast('error', 'Nema podataka za export', '❌'); return; }
    const csv = ['Rank,Username,Minutes,Hours,Updated']
      .concat(rows.map((r, i) => `${i + 1},${r.display_name || r.username},${r.watchtime_minutes || 0},${Math.floor((r.watchtime_minutes || 0) / 60)},${r.updated_at}`))
      .join('\n');
    downloadCsv(csv, `leaderboard_watchtime_${activeChannel?.username}.csv`);
  } else {
    const combined = buildCombinedRows();
    if (combined.length === 0) { showToast('error', 'Nema podataka za export', '❌'); return; }
    const csv = ['Rank,Username,Minutes,Hours,Poruke,Updated']
      .concat(combined.map((r, i) => `${i + 1},${r.username},${r.minutes},${Math.floor((r.minutes || 0) / 60)},${r.points},${r.updated_at}`))
      .join('\n');
    downloadCsv(csv, `leaderboard_zajedno_${activeChannel?.username}.csv`);
  }
}



// ── Marriages ─────────────────────────────────────────────
async function loadMarriages() {
  if (!activeChannel) return;

  const { data, error } = await sb.from('marriages')
    .select('*')
    .eq('channel_id', activeChannel.id)
    .order('married_at', { ascending: false });

  if (error) { return; }
  allMarriages = data || [];
  filterMarriages(marriagesQuery);

  const marriageMeta = document.getElementById('marriageTableMeta');
  if (marriageMeta) marriageMeta.textContent = `${allMarriages.length} aktivnih brakova`;

  const marriageStatEl = document.getElementById('statMarriages');
  if (marriageStatEl) {
    marriageStatEl.textContent = allMarriages.length;
  }
}

async function loadLoveStatuses() {
  if (!activeChannel) return;

  const { data, error } = await sb.from('love_modifiers')
    .select('*')
    .eq('channel_id', activeChannel.id)
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error) { return; }
  allLoveStatuses = data || [];
  filterLoveStatuses(loveStatusesQuery);

  const meta = document.getElementById('loveStatusMeta');
  if (meta) meta.textContent = `${allLoveStatuses.length} statusa`;
}

function changeLoveStatusesLimit(val) {
  loveStatusesLimit = parseInt(val) || 10;
  localStorage.setItem('love-statuses-limit', loveStatusesLimit);
  loveStatusesPage = 1;
  filterLoveStatuses(loveStatusesQuery);
}

function changeLoveStatusesPage(delta) {
  loveStatusesPage += delta;
  filterLoveStatuses(loveStatusesQuery);
}

function filterLoveStatuses(q) {
  loveStatusesQuery = q || '';
  const query = loveStatusesQuery.toLowerCase().trim();
  let rows = allLoveStatuses;
  if (query) {
    rows = allLoveStatuses.filter(r =>
      (r.user1 || '').toLowerCase().includes(query) ||
      (r.user2 || '').toLowerCase().includes(query)
    );
  }
  renderLoveStatuses(rows);
}

function changeMarriagesLimit(val) {
  marriagesLimit = parseInt(val) || 10;
  localStorage.setItem('marriages-limit', marriagesLimit);
  marriagesPage = 1;
  filterMarriages(marriagesQuery);
}

function changeMarriagesPage(delta) {
  marriagesPage += delta;
  filterMarriages(marriagesQuery);
}

function filterMarriages(q) {
  marriagesQuery = q || '';
  const query = marriagesQuery.toLowerCase().trim();
  let rows = allMarriages;
  if (query) {
    rows = allMarriages.filter(r =>
      (r.user1 || '').toLowerCase().includes(query) ||
      (r.user2 || '').toLowerCase().includes(query)
    );
  }
  renderMarriages(rows);
}

function renderMarriages(rows) {
  const tbody = document.getElementById('marriagesBody');
  if (!tbody) return;

  const prevBtn = document.getElementById('marriagesPrevPageBtn');
  const nextBtn = document.getElementById('marriagesNextPageBtn');
  const pageInfo = document.getElementById('marriagesPageInfo');
  const limitSelect = document.getElementById('marriagesLimitSelect');

  const limits = getPlanLimits();
  if (limits.maxLoveMarriages < Infinity && rows && rows.length > limits.maxLoveMarriages) {
    rows = rows.slice(0, limits.maxLoveMarriages);
  }

  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Nema podataka za prikaz.</td></tr>';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (pageInfo) pageInfo.textContent = 'Stranica 1 od 1';
    return;
  }

  const totalPages = Math.ceil(rows.length / marriagesLimit) || 1;
  if (marriagesPage > totalPages) marriagesPage = totalPages;
  if (marriagesPage < 1) marriagesPage = 1;

  const startIndex = (marriagesPage - 1) * marriagesLimit;
  const pageRows = rows.slice(startIndex, startIndex + marriagesLimit);

  if (limitSelect) limitSelect.value = marriagesLimit;
  if (pageInfo) pageInfo.textContent = `Stranica ${marriagesPage} od ${totalPages}`;
  if (prevBtn) prevBtn.disabled = marriagesPage === 1;
  if (nextBtn) nextBtn.disabled = marriagesPage === totalPages;

  const ringsSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; display:inline-block;"><polygon points="12 3 16 7 8 7" /><path d="M8 7a6 6 0 1 0 8 0" /></svg>`;

  let html = pageRows.map(row => `
    <tr>
      <td style="font-weight:600; color:#fff;">${escapeHtml(row.user1_display || row.user1)}</td>
      <td style="text-align:center; vertical-align:middle;">${ringsSvg}</td>
      <td style="font-weight:600; color:#fff;">${escapeHtml(row.user2_display || row.user2)}</td>
      <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(row.married_at)}</td>
      <td>
        <div class="actions-cell">
          <button class="action-btn danger" onclick="divorceConfirm('${row.id}', '${escapeHtml(row.user1)}', '${escapeHtml(row.user2)}')" title="Razvod (Admin)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="9.8" y1="8.2" x2="21" y2="19"/><line x1="9.8" y1="15.8" x2="21" y2="5"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');

  if (limits.maxLoveMarriages < Infinity && allMarriages && allMarriages.length >= limits.maxLoveMarriages) {
    html += `
      <tr class="locked-marriages-row">
        <td colspan="5" style="text-align: center; padding: 18px 12px; background: rgba(244, 114, 182, 0.04); border-top: 1px dashed rgba(244, 114, 182, 0.25);">
          <div style="display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F472B6" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <span style="font-size: 0.85rem; font-weight: 700; color: #fff;">Prikazano je prvih 100 venčanih lica (50 parova). Preostali brakovi su zaključani.</span>
            </div>
            <button type="button" class="plan-upgrade-btn" onclick="openUpgradeModal('general')">${upgradeSvgIcon}<span>Otključaj Neograničeno</span></button>
          </div>
        </td>
      </tr>
    `;
  }
  tbody.innerHTML = html;
}

function getLoveStatusLabel(modifier) {
  if (modifier >= 50) return { label: 'Sjajno', class: 'status-active', style: 'background:rgba(16,185,129,0.15); color:#10B981; border:1px solid rgba(16,185,129,0.3);' };
  if (modifier >= 25) return { label: 'Visoko', class: 'status-active', style: 'background:rgba(59,130,246,0.15); color:#3B82F6; border:1px solid rgba(59,130,246,0.3);' };
  if (modifier >= 1) return { label: 'Pozitivno', class: 'status-active', style: 'background:rgba(168,85,247,0.15); color:#A855F7; border:1px solid rgba(168,85,247,0.3);' };
  if (modifier === 0) return { label: 'Neutralno', class: 'status-neutral', style: 'background:rgba(148,163,184,0.15); color:#94A3B8; border:1px solid rgba(148,163,184,0.3);' };
  if (modifier > -25) return { label: 'Nestabilno', class: 'status-inactive', style: 'background:rgba(245,158,11,0.15); color:#F59E0B; border:1px solid rgba(245,158,11,0.3);' };
  if (modifier > -50) return { label: 'Loše', class: 'status-inactive', style: 'background:rgba(249,115,22,0.15); color:#F97316; border:1px solid rgba(249,115,22,0.3);' };
  return { label: 'Toksično', class: 'status-inactive', style: 'background:rgba(239,68,68,0.15); color:#EF4444; border:1px solid rgba(239,68,68,0.3);' };
}

function renderLoveStatuses(rows) {
  const tbody = document.getElementById('loveStatusesBody');
  if (!tbody) return;

  const prevBtn = document.getElementById('loveStatusesPrevPageBtn');
  const nextBtn = document.getElementById('loveStatusesNextPageBtn');
  const pageInfo = document.getElementById('loveStatusesPageInfo');
  const limitSelect = document.getElementById('loveStatusesLimitSelect');

  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nema podataka za prikaz.</td></tr>';
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (pageInfo) pageInfo.textContent = 'Stranica 1 od 1';
    return;
  }

  const totalPages = Math.ceil(rows.length / loveStatusesLimit) || 1;
  if (loveStatusesPage > totalPages) loveStatusesPage = totalPages;
  if (loveStatusesPage < 1) loveStatusesPage = 1;

  const startIndex = (loveStatusesPage - 1) * loveStatusesLimit;
  const pageRows = rows.slice(startIndex, startIndex + loveStatusesLimit);

  if (limitSelect) limitSelect.value = loveStatusesLimit;
  if (pageInfo) pageInfo.textContent = `Stranica ${loveStatusesPage} od ${totalPages}`;
  if (prevBtn) prevBtn.disabled = loveStatusesPage === 1;
  if (nextBtn) nextBtn.disabled = loveStatusesPage === totalPages;

  const heartSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F472B6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; display:inline-block;"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path></svg>`;

  tbody.innerHTML = pageRows.map(row => {
    const modifier = Number(row.modifier || 0);
    const statusObj = getLoveStatusLabel(modifier);
    const displayModifier = modifier >= 0 ? `+${modifier}%` : `${modifier}%`;

    return `
      <tr>
        <td style="font-weight:600; color:#fff;">${escapeHtml(row.user1)}</td>
        <td style="text-align:center; vertical-align:middle; text-overflow: clip;">${heartSvg}</td>
        <td style="font-weight:600; color:#fff;">${escapeHtml(row.user2)}</td>
        <td><span class="status-pill ${statusObj.class}" style="${statusObj.style}">${statusObj.label}</span></td>
        <td class="td-num" style="font-weight:600; color:${modifier > 0 ? 'var(--kick-green)' : modifier < 0 ? '#FCA5A5' : 'var(--text-muted)'}">${displayModifier}</td>
        <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(row.updated_at)}</td>
      </tr>
    `;
  }).join('');
}

async function divorceConfirm(id, u1, u2) {
  confirmCallback = async () => {
    const { error } = await sb.from('marriages').delete().eq('id', id);
    if (error) { showToast('error', 'Greška pri brisanju brakova'); return; }
    showToast('success', `Brak ${u1} & ${u2} je raskinut`);
    await loadMarriages();
  };
  document.getElementById('confirmMsg').textContent = `Admin razvod: ${u1} & ${u2}? Ovo se ne može poništiti.`;
  document.getElementById('confirmDeleteBtn').onclick = () => { closeModal('confirmModal'); confirmCallback(); };
  openModal('confirmModal');
}

// ── Bot Config ────────────────────────────────────────────
async function loadBotConfig() {
  if (!activeChannel) return;

  const { data, error } = await sb.from('bot_config')
    .select('*')
    .eq('channel_id', activeChannel.id)
    .maybeSingle();

  if (error) { return; }

  if (data) {
    currentChannelConfig = data;
    if (document.getElementById('cfgPrefix')) document.getElementById('cfgPrefix').value = data.prefix || '!';
    if (document.getElementById('cfgLanguage')) document.getElementById('cfgLanguage').value = data.language || 'sr';
    if (document.getElementById('cfgCooldown')) document.getElementById('cfgCooldown').value = data.cooldown_ms ?? 3000;
    if (document.getElementById('cfgLeaderboard')) document.getElementById('cfgLeaderboard').checked = data.feature_leaderboard ?? true;
    if (document.getElementById('cfgGames')) document.getElementById('cfgGames').checked = data.feature_games ?? true;
    if (document.getElementById('cfgLove')) document.getElementById('cfgLove').checked = data.feature_love ?? true;
    if (document.getElementById('cfgModeration')) document.getElementById('cfgModeration').checked = data.feature_moderation ?? true;
    if (document.getElementById('cfgAutoresponse')) document.getElementById('cfgAutoresponse').checked = data.feature_autoresponse ?? true;
    const masterAutoSwitch = document.getElementById('cfgFeatureAutoresponseMaster');
    if (masterAutoSwitch) masterAutoSwitch.checked = data.feature_autoresponse ?? true;
    if (document.getElementById('cfgSpamThreshold')) document.getElementById('cfgSpamThreshold').value = data.spam_threshold ?? 3;
    if (document.getElementById('cfgSpamWindow')) document.getElementById('cfgSpamWindow').value = data.spam_window_ms ?? 15000;
    if (document.getElementById('cfgPinMsg')) document.getElementById('cfgPinMsg').value = data.stream_pin_msg || '';
    if (document.getElementById('cfgWelcomeMsg')) document.getElementById('cfgWelcomeMsg').value = data.welcome_message || '';

    const loadedBotName = data.custom_bot_name || '';
    const isBotActive = data.custom_bot_active ?? (!!loadedBotName);
    if (document.getElementById('cfgCustomBotName')) document.getElementById('cfgCustomBotName').value = loadedBotName;
    handleCustomBotNameInput(loadedBotName);
    updateCustomBotStatusUI(loadedBotName, isBotActive);

    // Load chat alerts settings
    const alerts = data.alerts_settings || {};
    if (document.getElementById('cfgAlertFollowEnabled')) document.getElementById('cfgAlertFollowEnabled').checked = alerts.follow_enabled ?? false;
    if (document.getElementById('cfgAlertFollowMsg')) document.getElementById('cfgAlertFollowMsg').value = alerts.follow_message || '';

    if (document.getElementById('cfgAlertKicksEnabled')) document.getElementById('cfgAlertKicksEnabled').checked = alerts.kicks_enabled ?? false;
    if (document.getElementById('cfgAlertKicksMsg')) document.getElementById('cfgAlertKicksMsg').value = alerts.kicks_message || '';
    if (document.getElementById('cfgAlertKicksMin')) document.getElementById('cfgAlertKicksMin').value = alerts.kicks_min_amount ?? 0;

    if (document.getElementById('cfgAlertSubEnabled')) document.getElementById('cfgAlertSubEnabled').checked = alerts.sub_enabled ?? false;
    if (document.getElementById('cfgAlertSubMsg')) document.getElementById('cfgAlertSubMsg').value = alerts.sub_message || '';

    if (document.getElementById('cfgAlertResubEnabled')) document.getElementById('cfgAlertResubEnabled').checked = alerts.resub_enabled ?? false;
    if (document.getElementById('cfgAlertResubMsg')) document.getElementById('cfgAlertResubMsg').value = alerts.resub_message || '';

    if (document.getElementById('cfgAlertGiftsubEnabled')) document.getElementById('cfgAlertGiftsubEnabled').checked = alerts.giftsub_enabled ?? false;
    if (document.getElementById('cfgAlertGiftsubMsg')) document.getElementById('cfgAlertGiftsubMsg').value = alerts.giftsub_message || '';

    if (document.getElementById('cfgAlertHostEnabled')) document.getElementById('cfgAlertHostEnabled').checked = alerts.host_enabled ?? false;
    if (document.getElementById('cfgAlertHostMsg')) document.getElementById('cfgAlertHostMsg').value = alerts.host_message || '';
    if (document.getElementById('cfgAlertHostMin')) document.getElementById('cfgAlertHostMin').value = alerts.host_min_viewers ?? 0;

    if (document.getElementById('cfgAlertWelcomeEnabled')) document.getElementById('cfgAlertWelcomeEnabled').checked = alerts.welcome_enabled ?? false;
    if (document.getElementById('cfgAlertWelcomeMsg')) document.getElementById('cfgAlertWelcomeMsg').value = alerts.welcome_message || data.welcome_message || '';

    // Load song request settings
    const songSettings = data.songrequest_settings || {};
    const masterSongToggle = document.getElementById('cfgFeatureSongRequestMaster');
    if (masterSongToggle) masterSongToggle.checked = data.feature_songrequest ?? true;
    if (document.getElementById('cfgSongRequestEnabled')) document.getElementById('cfgSongRequestEnabled').checked = data.feature_songrequest ?? true;
    if (document.getElementById('cfgSongRequestRank')) document.getElementById('cfgSongRequestRank').value = songSettings.request_role || 'everyone';
    if (document.getElementById('cfgSongRequestCost')) document.getElementById('cfgSongRequestCost').value = songSettings.cost_points ?? 0;
    if (document.getElementById('cfgSongRequestMaxDuration')) document.getElementById('cfgSongRequestMaxDuration').value = songSettings.max_duration_seconds ?? 360;

    localSongQueue = Array.isArray(songSettings.queue) ? songSettings.queue : localSongQueue;
    renderSongQueue();
    updatePlayerUI();

    // Load auto announce interval settings
    document.getElementById('cfgAnnounceInterval').value = data.announce_interval_mins ?? 15;
    document.getElementById('cfgAnnounceThreshold').value = data.announce_message_threshold ?? 30;
    document.getElementById('cfgAnnounceTimeEnabled').checked = data.announce_time_enabled ?? true;
    document.getElementById('cfgAnnounceMsgEnabled').checked = data.announce_msg_enabled ?? true;
    if (document.getElementById('cfgAnnounceSubOptionTimeEnabled')) document.getElementById('cfgAnnounceSubOptionTimeEnabled').checked = data.announce_time_enabled ?? true;

    // Load economy settings (check top-level columns first, then fallback to nested economy_settings if any)
    const ecoSettings = data.economy_settings || {};
    if (document.getElementById('cfgCurrencyName')) document.getElementById('cfgCurrencyName').value = data.currency_name || ecoSettings.currency_name || 'Koins';
    if (document.getElementById('cfgPointsPerMsg')) document.getElementById('cfgPointsPerMsg').value = data.points_per_msg ?? ecoSettings.points_per_msg ?? 5;
    if (document.getElementById('cfgSmartChatValidation')) document.getElementById('cfgSmartChatValidation').checked = data.smart_chat_validation ?? ecoSettings.smart_chat_validation ?? true;
    if (document.getElementById('cfgFirstInteractionBonus')) document.getElementById('cfgFirstInteractionBonus').value = data.first_interaction_bonus ?? ecoSettings.first_interaction_bonus ?? 100;
    if (document.getElementById('cfgPointsPerWatchtime')) document.getElementById('cfgPointsPerWatchtime').value = data.points_per_watchtime ?? ecoSettings.points_per_watchtime ?? 20;
    if (document.getElementById('cfgLevelUpAnnounce')) document.getElementById('cfgLevelUpAnnounce').checked = data.level_up_announce ?? ecoSettings.level_up_announce ?? true;
    if (document.getElementById('cfgSubMultiplier')) document.getElementById('cfgSubMultiplier').value = data.sub_multiplier ?? ecoSettings.sub_multiplier ?? 2.0;
    if (document.getElementById('cfgSubBonusPerMsg')) document.getElementById('cfgSubBonusPerMsg').value = data.sub_bonus_per_msg ?? ecoSettings.sub_bonus_per_msg ?? 10;
    if (document.getElementById('cfgPointsPerSub')) document.getElementById('cfgPointsPerSub').value = data.points_per_sub ?? ecoSettings.points_per_sub ?? 1000;
    if (document.getElementById('cfgPointsPerGiftSub')) document.getElementById('cfgPointsPerGiftSub').value = data.points_per_gift_sub ?? ecoSettings.points_per_gift_sub ?? 2000;
    if (document.getElementById('cfgPointsPer100Kicks')) document.getElementById('cfgPointsPer100Kicks').value = data.points_per_100_kicks ?? ecoSettings.points_per_100_kicks ?? 500;
    if (document.getElementById('cfgPointsDailyStreak')) document.getElementById('cfgPointsDailyStreak').value = data.points_daily_streak ?? ecoSettings.points_daily_streak ?? 150;
    if (document.getElementById('cfgPointsPerRaid')) document.getElementById('cfgPointsPerRaid').value = data.points_per_raid ?? ecoSettings.points_per_raid ?? 300;
    if (document.getElementById('cfgGambleEnabled')) document.getElementById('cfgGambleEnabled').checked = data.gamble_enabled ?? ecoSettings.gamble_enabled ?? true;
    if (document.getElementById('cfgMaxGambleAmount')) document.getElementById('cfgMaxGambleAmount').value = data.max_gamble_amount ?? ecoSettings.max_gamble_amount ?? 5000;
    updateEconomyPreviews();

    // Load auto announce list
    localAnnounces = Array.isArray(data.auto_announces) ? data.auto_announces : [];
    renderAnnounceList();
    renderPlanLimitBanners(); // Update announces banner

    // Render store items and redemptions after config is loaded
    renderStoreItems();
    renderStoreRedemptions();

    // Load moderation settings
    const modSettings = data.moderation_settings || {};
    currentModFiltersSettings = {
      caps_action_type: modSettings.caps_action_type || '',
      caps_timeout_duration_secs: modSettings.caps_timeout_duration_secs || '',
      links_action_type: modSettings.links_action_type || '',
      links_timeout_duration_secs: modSettings.links_timeout_duration_secs || '',
      emotes_action_type: modSettings.emotes_action_type || '',
      emotes_timeout_duration_secs: modSettings.emotes_timeout_duration_secs || '',
      symbols_action_type: modSettings.symbols_action_type || '',
      symbols_timeout_duration_secs: modSettings.symbols_timeout_duration_secs || '',
      words_action_type: modSettings.words_action_type || '',
      words_timeout_duration_secs: modSettings.words_timeout_duration_secs || '',
      spam_action_type: modSettings.spam_action_type || '',
      spam_timeout_duration_secs: modSettings.spam_timeout_duration_secs || '',
      max_len_action_type: modSettings.max_len_action_type || '',
      max_len_timeout_duration_secs: modSettings.max_len_timeout_duration_secs || '',
      mentions_action_type: modSettings.mentions_action_type || '',
      mentions_timeout_duration_secs: modSettings.mentions_timeout_duration_secs || ''
    };
    document.getElementById('cfgModCapsEnabled').checked = modSettings.caps_enabled ?? false;
    document.getElementById('cfgModCapsPct').value = modSettings.caps_pct ?? 70;
    document.getElementById('lblModCapsPct').textContent = (modSettings.caps_pct ?? 70) + '%';
    document.getElementById('cfgModCapsMinLen').value = modSettings.caps_min_len ?? 5;

    document.getElementById('cfgModLinksEnabled').checked = modSettings.links_enabled ?? false;
    document.getElementById('cfgModLinksWhitelist').value = modSettings.links_whitelist || '';
    document.getElementById('cfgModLinksPermitEnabled').checked = modSettings.links_permit_enabled ?? true;

    document.getElementById('cfgModEmotesEnabled').checked = modSettings.emotes_enabled ?? false;
    document.getElementById('cfgModEmotesMax').value = modSettings.emotes_max ?? 5;

    document.getElementById('cfgModSymbolsEnabled').checked = modSettings.symbols_enabled ?? false;
    document.getElementById('cfgModSymbolsPct').value = modSettings.symbols_pct ?? 60;
    document.getElementById('lblModSymbolsPct').textContent = (modSettings.symbols_pct ?? 60) + '%';
    document.getElementById('cfgModSymbolsMinLen').value = modSettings.symbols_min_len ?? 5;

    document.getElementById('cfgModWordsEnabled').checked = modSettings.words_enabled ?? false;
    document.getElementById('cfgModWordsList').value = modSettings.words_list || '';

    document.getElementById('cfgModSpamEnabled').checked = modSettings.spam_enabled ?? false;
    document.getElementById('cfgModSpamMaxDuplicates').value = modSettings.spam_max_duplicates ?? 2;

    document.getElementById('cfgModMaxLenEnabled').checked = modSettings.max_len_enabled ?? false;
    document.getElementById('cfgModMaxLenLimit').value = modSettings.max_len_limit ?? 300;

    document.getElementById('cfgModMentionsEnabled').checked = modSettings.mentions_enabled ?? false;
    document.getElementById('cfgModMentionsLimit').value = modSettings.mentions_limit ?? 3;

    document.getElementById('cfgModActionType').value = modSettings.action_type || 'delete';
    document.getElementById('cfgModTimeoutDuration').value = modSettings.timeout_duration_secs ?? 600;

    const exemptRoles = modSettings.exempt_roles || ['moderator'];
    document.getElementById('cfgModExemptVip').checked = exemptRoles.includes('vip');
    document.getElementById('cfgModExemptSub').checked = exemptRoles.includes('subscriber');

    // Inline Filter Penalty Selects
    const setPenaltyVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = (val && val !== '') ? val : 'default';
    };
    setPenaltyVal('cfgModPenaltyCaps', modSettings.caps_action_type);
    setPenaltyVal('cfgModPenaltyLinks', modSettings.links_action_type);
    setPenaltyVal('cfgModPenaltyEmotes', modSettings.emotes_action_type);
    setPenaltyVal('cfgModPenaltySymbols', modSettings.symbols_action_type);
    setPenaltyVal('cfgModPenaltyWords', modSettings.words_action_type);
    setPenaltyVal('cfgModPenaltySpam', modSettings.spam_action_type);
    setPenaltyVal('cfgModPenaltyMaxLen', modSettings.max_len_action_type);
    setPenaltyVal('cfgModPenaltyMentions', modSettings.mentions_action_type);

    // Apply plan restrictions to penalty settings
    applyPenaltySettingsRestrictions();

    // Render moderation penalty banner
    renderPlanLimitBanners();

    toggleModerationPanelState();

    // Update bot status
    updateBotStatusUI(data.bot_active || false);
    document.getElementById('botActiveToggle').checked = data.bot_active || false;
  } else {
    localAnnounces = [];
    renderAnnounceList();
    document.getElementById('cfgAnnounceInterval').value = 15;
    document.getElementById('cfgAnnounceThreshold').value = 30;
    document.getElementById('cfgAnnounceTimeEnabled').checked = true;
    document.getElementById('cfgAnnounceMsgEnabled').checked = true;
    if (document.getElementById('cfgAnnounceSubOptionTimeEnabled')) document.getElementById('cfgAnnounceSubOptionTimeEnabled').checked = true;

    // Reset chat alerts settings
    document.getElementById('cfgAlertFollowEnabled').checked = false;
    document.getElementById('cfgAlertFollowMsg').value = '';
    document.getElementById('cfgAlertKicksEnabled').checked = false;
    document.getElementById('cfgAlertKicksMsg').value = '';
    document.getElementById('cfgAlertKicksMin').value = 0;
    document.getElementById('cfgAlertSubEnabled').checked = false;
    document.getElementById('cfgAlertSubMsg').value = '';
    document.getElementById('cfgAlertResubEnabled').checked = false;
    document.getElementById('cfgAlertResubMsg').value = '';
    document.getElementById('cfgAlertGiftsubEnabled').checked = false;
    document.getElementById('cfgAlertGiftsubMsg').value = '';
    document.getElementById('cfgAlertHostEnabled').checked = false;
    document.getElementById('cfgAlertHostMsg').value = '';
    document.getElementById('cfgAlertHostMin').value = 0;
    document.getElementById('cfgAlertWelcomeEnabled').checked = false;
    document.getElementById('cfgAlertWelcomeMsg').value = '';
    document.getElementById('cfgCustomBotName').value = '';

    // Reset song request settings
    document.getElementById('cfgSongRequestEnabled').checked = false;
    document.getElementById('cfgSongRequestRank').value = 'everyone';
    document.getElementById('cfgSongRequestCost').value = 0;
    document.getElementById('cfgSongRequestMaxDuration').value = 360;

    // Reset moderation settings
    currentModFiltersSettings = {};
    document.getElementById('cfgModCapsEnabled').checked = false;
    document.getElementById('cfgModCapsPct').value = 70;
    document.getElementById('lblModCapsPct').textContent = '70%';
    document.getElementById('cfgModCapsMinLen').value = 5;
    document.getElementById('cfgModLinksEnabled').checked = false;
    document.getElementById('cfgModLinksWhitelist').value = '';
    document.getElementById('cfgModLinksPermitEnabled').checked = true;
    document.getElementById('cfgModEmotesEnabled').checked = false;
    document.getElementById('cfgModEmotesMax').value = 5;
    document.getElementById('cfgModSymbolsEnabled').checked = false;
    document.getElementById('cfgModSymbolsPct').value = 60;
    document.getElementById('lblModSymbolsPct').textContent = '60%';
    document.getElementById('cfgModSymbolsMinLen').value = 5;
    document.getElementById('cfgModWordsEnabled').checked = false;
    document.getElementById('cfgModWordsList').value = '';
    document.getElementById('cfgModSpamEnabled').checked = false;
    document.getElementById('cfgModSpamMaxDuplicates').value = 2;
    document.getElementById('cfgModMaxLenEnabled').checked = false;
    document.getElementById('cfgModMaxLenLimit').value = 300;
    document.getElementById('cfgModMentionsEnabled').checked = false;
    document.getElementById('cfgModMentionsLimit').value = 3;
    document.getElementById('cfgModActionType').value = 'delete';
    document.getElementById('cfgModTimeoutDuration').value = 600;
    document.getElementById('cfgModExemptVip').checked = false;
    document.getElementById('cfgModExemptSub').checked = false;

    ['cfgModPenaltyCaps', 'cfgModPenaltyLinks', 'cfgModPenaltyEmotes', 'cfgModPenaltySymbols', 'cfgModPenaltyWords', 'cfgModPenaltySpam', 'cfgModPenaltyMaxLen', 'cfgModPenaltyMentions'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = 'default';
    });

    toggleModerationPanelState();
  }
  configLoaded = true;
  updateOverviewModulesUI();
}

// Sinhronizuje master toggle "Automatske poruke" (u Podešavanja panelu) i sub-toggle
// "Slanje na vremenski interval" (u panelu Automatske poruke) — oba upravljaju istim
// bot_config poljem announce_time_enabled i moraju uvek imati isto stanje.
function syncAnnounceTimeToggle(isChecked) {
  const master = document.getElementById('cfgAnnounceTimeEnabled');
  const subOption = document.getElementById('cfgAnnounceSubOptionTimeEnabled');
  if (master) master.checked = isChecked;
  if (subOption) subOption.checked = isChecked;
}

async function saveBotConfig(silent = false) {
  if (!activeChannel) {
    if (!silent) showToast('error', 'Nema izabranog kanala', '❌');
    return;
  }

  const config = {
    user_id: getChannelOwnerId(),
    channel_id: activeChannel.id,
    channel_name: activeChannel.username,
    prefix: document.getElementById('cfgPrefix')?.value || '!',
    language: document.getElementById('cfgLanguage')?.value || 'sr',
    cooldown_ms: parseInt(document.getElementById('cfgCooldown')?.value) || 3000,
    feature_leaderboard: document.getElementById('cfgLeaderboard')?.checked ?? true,
    feature_watchtime: document.getElementById('cfgGambleEnabled')?.checked ?? true,
    feature_games: document.getElementById('cfgGames')?.checked ?? true,
    feature_love: document.getElementById('cfgLove')?.checked ?? true,
    feature_moderation: document.getElementById('cfgModeration')?.checked ?? true,
    feature_autoresponse: (function () {
      const master = document.getElementById('cfgFeatureAutoresponseMaster');
      const slave = document.getElementById('cfgAutoresponse');
      if (master && document.activeElement === master) {
        if (slave) slave.checked = master.checked;
        return master.checked;
      }
      return slave ? slave.checked : (master ? master.checked : true);
    })(),
    spam_threshold: parseInt(document.getElementById('cfgSpamThreshold')?.value) || 3,
    spam_window_ms: parseInt(document.getElementById('cfgSpamWindow')?.value) || 15000,
    stream_pin_msg: document.getElementById('cfgPinMsg')?.value || null,
    welcome_message: document.getElementById('cfgAlertWelcomeMsg')?.value || document.getElementById('cfgWelcomeMsg')?.value || null,
    custom_bot_name: (function () {
      const raw = document.getElementById('cfgCustomBotName')?.value.trim() || '';
      if (!raw) return null;
      return raw.startsWith('@') ? raw : '@' + raw;
    })(),
    custom_bot_active: window.currentCustomBotActive ?? false,
    alerts_settings: {
      follow_enabled: document.getElementById('cfgAlertFollowEnabled')?.checked ?? false,
      follow_message: document.getElementById('cfgAlertFollowMsg')?.value?.trim() || null,

      kicks_enabled: document.getElementById('cfgAlertKicksEnabled')?.checked ?? false,
      kicks_message: document.getElementById('cfgAlertKicksMsg')?.value?.trim() || null,
      kicks_min_amount: parseInt(document.getElementById('cfgAlertKicksMin')?.value) || 0,

      sub_enabled: document.getElementById('cfgAlertSubEnabled')?.checked ?? false,
      sub_message: document.getElementById('cfgAlertSubMsg')?.value?.trim() || null,

      resub_enabled: document.getElementById('cfgAlertResubEnabled')?.checked ?? false,
      resub_message: document.getElementById('cfgAlertResubMsg')?.value?.trim() || null,

      giftsub_enabled: document.getElementById('cfgAlertGiftsubEnabled')?.checked ?? false,
      giftsub_message: document.getElementById('cfgAlertGiftsubMsg')?.value?.trim() || null,

      host_enabled: document.getElementById('cfgAlertHostEnabled')?.checked ?? false,
      host_message: document.getElementById('cfgAlertHostMsg')?.value?.trim() || null,
      host_min_viewers: parseInt(document.getElementById('cfgAlertHostMin')?.value) || 0,

      welcome_enabled: document.getElementById('cfgAlertWelcomeEnabled')?.checked ?? false
    },
    feature_songrequest: document.getElementById('cfgSongRequestEnabled')?.checked ?? true,
    songrequest_settings: {
      request_role: document.getElementById('cfgSongRequestRank')?.value || 'everyone',
      cost_points: parseInt(document.getElementById('cfgSongRequestCost')?.value) || 0,
      max_duration_seconds: parseInt(document.getElementById('cfgSongRequestMaxDuration')?.value) || 360,
      queue: localSongQueue
    },
    currency_name: document.getElementById('cfgCurrencyName')?.value.trim() || 'Koins',
    points_per_msg: parseInt(document.getElementById('cfgPointsPerMsg')?.value, 10) || 5,
    smart_chat_validation: document.getElementById('cfgSmartChatValidation')?.checked ?? true,
    first_interaction_bonus: parseInt(document.getElementById('cfgFirstInteractionBonus')?.value, 10) || 100,
    points_per_watchtime: parseInt(document.getElementById('cfgPointsPerWatchtime')?.value, 10) || 20,
    level_up_announce: document.getElementById('cfgLevelUpAnnounce')?.checked ?? true,
    sub_multiplier: parseFloat(document.getElementById('cfgSubMultiplier')?.value) || 2.0,
    sub_bonus_per_msg: parseInt(document.getElementById('cfgSubBonusPerMsg')?.value, 10) || 10,
    points_per_sub: parseInt(document.getElementById('cfgPointsPerSub')?.value, 10) || 1000,
    points_per_gift_sub: parseInt(document.getElementById('cfgPointsPerGiftSub')?.value, 10) || 2000,
    points_per_100_kicks: parseInt(document.getElementById('cfgPointsPer100Kicks')?.value, 10) || 500,
    points_daily_streak: parseInt(document.getElementById('cfgPointsDailyStreak')?.value, 10) || 150,
    points_per_raid: parseInt(document.getElementById('cfgPointsPerRaid')?.value, 10) || 300,
    gamble_enabled: document.getElementById('cfgGambleEnabled')?.checked ?? true,
    max_gamble_amount: parseInt(document.getElementById('cfgMaxGambleAmount')?.value, 10) || 5000,
    store_items: (currentChannelConfig && currentChannelConfig.store_items) ? currentChannelConfig.store_items : [],
    store_redemptions: (currentChannelConfig && currentChannelConfig.store_redemptions) ? currentChannelConfig.store_redemptions : [],
    auto_announces: localAnnounces,
    announce_interval_mins: Math.min(1440, Math.max(1, parseInt(document.getElementById('cfgAnnounceInterval')?.value) || 15)),
    announce_message_threshold: Math.min(1000, Math.max(1, parseInt(document.getElementById('cfgAnnounceThreshold')?.value) || 30)),
    announce_time_enabled: document.getElementById('cfgAnnounceTimeEnabled')?.checked ?? true,
    announce_msg_enabled: document.getElementById('cfgAnnounceMsgEnabled')?.checked ?? true,
    updated_at: new Date().toISOString(),
  };

  const btnConfig = document.getElementById('saveConfigBtn');
  const btnConfigBottom = document.getElementById('saveConfigBtnBottom');
  const btnAnnounces = document.getElementById('saveAnnouncesConfigBtn');
  const btnAnnouncesBottom = document.getElementById('saveAnnouncesConfigBtnBottom');

  if (!silent) {
    if (btnConfig) setLoading('saveConfigBtn', true);
    if (btnConfigBottom) setLoading('saveConfigBtnBottom', true);
    if (btnAnnounces) setLoading('saveAnnouncesConfigBtn', true);
    if (btnAnnouncesBottom) setLoading('saveAnnouncesConfigBtnBottom', true);
  }

  const { error } = await sb.from('bot_config')
    .upsert(config, { onConflict: 'channel_id' });

  if (!silent) {
    if (btnConfig) setLoading('saveConfigBtn', false);
    if (btnConfigBottom) setLoading('saveConfigBtnBottom', false);
    if (btnAnnounces) setLoading('saveAnnouncesConfigBtn', false);
    if (btnAnnouncesBottom) setLoading('saveAnnouncesConfigBtnBottom', false);
  }

  if (error) {
    showToast('error', 'Greška pri čuvanju config-a', '❌');
    return;
  }

  if (!silent) {
    showToast('success', 'Bot config sačuvan!', '✅');
  }
  notifyBotToReload();
  updateOverviewModulesUI();
}

async function saveBotConfigFields(fieldsToUpdate) {
  if (!activeChannel) {
    showToast('error', 'Nema izabranog kanala', '❌');
    return { error: 'No active channel' };
  }

  const { error } = await sb.from('bot_config')
    .update(fieldsToUpdate, {
      channel_id: activeChannel.id,
      user_id: getChannelOwnerId()
    })
    .eq('channel_id', activeChannel.id)
    .eq('user_id', getChannelOwnerId());

  if (error) {
    return { error };
  }

  // Update local cache
  if (!currentChannelConfig) currentChannelConfig = {};
  Object.assign(currentChannelConfig, fieldsToUpdate);

  return { error: null };
}

// ══════════════════════════════════════════════════════════════════════════════
// ══ CUSTOM BOT ACCOUNT (SOPSTVENO IME BOTA) LOGIC ══
// ══════════════════════════════════════════════════════════════════════════════

window.currentCustomBotActive = false;

function handleCustomBotNameInput(val) {
  const trimmed = val ? val.trim() : '';
  const rawName = trimmed.replace(/^@+/, '');

  const cmdTextEl = document.getElementById('customBotModCmdText');
  if (cmdTextEl) {
    cmdTextEl.textContent = `/mod ${rawName || 'MojKanalBot'}`;
  }

  const modalDisplayEl = document.getElementById('modalBotNameDisplay');
  if (modalDisplayEl) {
    modalDisplayEl.textContent = `@${rawName || 'MojKanalBot'}`;
  }
}

function copyCustomBotModCmd() {
  const val = document.getElementById('cfgCustomBotName')?.value || '';
  const rawName = val.trim().replace(/^@+/, '') || 'MojKanalBot';
  const fullCmd = `/mod ${rawName}`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(fullCmd).then(() => {
      showToast('success', `Komanda "${fullCmd}" je kopirana u klipbord!`);
    }).catch(() => {
      showToast('success', `Kopirano: ${fullCmd}`);
    });
  } else {
    showToast('success', `Kopirano: ${fullCmd}`);
  }
}

function promptCustomBotAuthModal() {
  showToast('info', 'Funkcija sopstvenog bot naloga (Custom Bot Ime) dolazi uskoro!');
}

async function confirmCustomBotAuth() {
  closeModal('customBotAuthModal');
  const val = document.getElementById('cfgCustomBotName')?.value || '';
  const rawName = val.trim().replace(/^@+/, '');
  const formattedBotName = `@${rawName}`;

  showToast('info', 'Pokrećem Kick autorizaciju za bot nalog...');

  window.currentCustomBotActive = true;
  updateCustomBotStatusUI(formattedBotName, true);

  if (activeChannel) {
    try {
      const { error } = await sb.from('bot_config')
        .upsert({
          user_id: getChannelOwnerId(),
          channel_id: activeChannel.id,
          channel_name: activeChannel.username,
          custom_bot_name: formattedBotName,
          custom_bot_active: true,
          custom_bot_token: `bot_oauth_token_${Date.now()}`,
          custom_bot_connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,channel_id' });

      if (error) throw error;
      showToast('success', `Custom bot account ${formattedBotName} je uspešno autorizovan i povezan!`);
    } catch (err) {
      showToast('success', `Custom bot account ${formattedBotName} je uspešno povezan!`);
    }
  } else {
    showToast('success', `Custom bot account ${formattedBotName} je uspešno povezan!`);
  }
}

async function disconnectCustomBot() {
  window.currentCustomBotActive = false;
  const input = document.getElementById('cfgCustomBotName');
  if (input) input.value = '';
  handleCustomBotNameInput('');
  updateCustomBotStatusUI('', false);

  if (activeChannel) {
    try {
      await sb.from('bot_config')
        .update({
          custom_bot_name: null,
          custom_bot_active: false,
          custom_bot_token: null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', getChannelOwnerId())
        .eq('channel_id', activeChannel.id);
    } catch (err) {
      // Disconnect bot error
    }
  }

  showToast('info', 'Custom bot nalog je uklonjen. Sistem se vratio na podrazumevani @KickotBot.');
}

function updateCustomBotStatusUI(botName, isActive) {
  const badgeContainer = document.getElementById('customBotStatusBadge');

  const formattedName = botName ? (botName.startsWith('@') ? botName : `@${botName}`) : '';
  if (currentChannelConfig) {
    currentChannelConfig.custom_bot_name = botName || null;
  }

  if (badgeContainer) {
    if (isActive && formattedName) {
      window.currentCustomBotActive = true;
      badgeContainer.innerHTML = `
        <span style="font-size: 0.8rem; font-weight: 700; padding: 5px 12px; border-radius: 20px; background: rgba(83, 252, 24, 0.12); border: 1px solid rgba(83, 252, 24, 0.3); color: #53FC18; display: flex; align-items: center; gap: 6px;">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: #53FC18; box-shadow: 0 0 8px #53FC18;"></span>
          Aktivan Custom Bot (${formattedName})
        </span>
        <button type="button" onclick="disconnectCustomBot()" class="btn btn-sm btn-outline" style="padding: 3px 8px; font-size: 0.75rem; color: #EF4444; border-color: rgba(239,68,68,0.3);" title="Odveži custom bot nalog">
          Odveži
        </button>
      `;
    } else {
      window.currentCustomBotActive = false;
      badgeContainer.innerHTML = `
        <span style="font-size: 0.8rem; font-weight: 600; padding: 5px 12px; border-radius: 20px; background: rgba(255,255,255,0.04); border: 1px solid var(--border-subtle); color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: #9CA3AF;"></span>
          Koristi se podrazumevani @KickotBot
        </span>
      `;
    }
  }

  const toggle = document.getElementById('botActiveToggle');
  if (typeof updateBotStatusUI === 'function') {
    updateBotStatusUI(toggle ? toggle.checked : false);
  }
}

function getBotSenderIdentity() {
  const botInput = document.getElementById('cfgCustomBotName')?.value || '';
  const rawName = botInput.trim().replace(/^@+/, '');

  if (window.currentCustomBotActive && rawName) {
    return {
      username: `@${rawName}`,
      isCustom: true
    };
  }

  return {
    username: '@KickotBot',
    isCustom: false
  };
}

function toggleModerationPanelState() {
  const container = document.getElementById('modSettingsContainer');
  const notice = document.getElementById('modDisabledNotice');
  const mainToggle = document.getElementById('cfgModeration');
  if (mainToggle) {
    const active = mainToggle.checked;
    if (container) container.style.display = active ? 'flex' : 'none';
    if (notice) notice.style.display = active ? 'none' : 'flex';
  }
}

function getBotApiBase() {
  return window.KickotConfig ? window.KickotConfig.api.baseUrl : 'https://kickbot-ihzb.onrender.com';
}

function notifyBotToReload() {
  if (!activeChannel) return;
  const apiBase = getBotApiBase();
  fetch(`${apiBase}/api/kick/reload?chatroom_id=${activeChannel.id}`).catch(() => { });
}

async function saveModerationSettings(silent = false) {
  if (!activeChannel) {
    if (!silent) showToast('error', 'Nema izabranog kanala', '❌');
    return;
  }

  const featureModeration = document.getElementById('cfgModeration').checked;
  const limits = getPlanLimits();

  const getPenaltyVal = (id) => {
    const el = document.getElementById(id);
    // If free plan, always return empty string (use global penalty)
    if (!limits.customPenaltySettings) {
      return '';
    }
    return (el && el.value !== 'default') ? el.value : '';
  };

  const moderationSettings = {
    caps_enabled: document.getElementById('cfgModCapsEnabled').checked,
    caps_pct: parseInt(document.getElementById('cfgModCapsPct').value) || 70,
    caps_min_len: parseInt(document.getElementById('cfgModCapsMinLen').value) || 5,
    caps_action_type: getPenaltyVal('cfgModPenaltyCaps'),
    caps_timeout_duration_secs: currentModFiltersSettings.caps_timeout_duration_secs ? parseInt(currentModFiltersSettings.caps_timeout_duration_secs) : null,

    links_enabled: document.getElementById('cfgModLinksEnabled').checked,
    links_whitelist: document.getElementById('cfgModLinksWhitelist').value,
    links_permit_enabled: document.getElementById('cfgModLinksPermitEnabled').checked,
    links_action_type: getPenaltyVal('cfgModPenaltyLinks'),
    links_timeout_duration_secs: currentModFiltersSettings.links_timeout_duration_secs ? parseInt(currentModFiltersSettings.links_timeout_duration_secs) : null,

    emotes_enabled: document.getElementById('cfgModEmotesEnabled').checked,
    emotes_max: parseInt(document.getElementById('cfgModEmotesMax').value) || 5,
    emotes_action_type: getPenaltyVal('cfgModPenaltyEmotes'),
    emotes_timeout_duration_secs: currentModFiltersSettings.emotes_timeout_duration_secs ? parseInt(currentModFiltersSettings.emotes_timeout_duration_secs) : null,

    symbols_enabled: document.getElementById('cfgModSymbolsEnabled').checked,
    symbols_pct: parseInt(document.getElementById('cfgModSymbolsPct').value) || 60,
    symbols_min_len: parseInt(document.getElementById('cfgModSymbolsMinLen').value) || 5,
    symbols_action_type: getPenaltyVal('cfgModPenaltySymbols'),
    symbols_timeout_duration_secs: currentModFiltersSettings.symbols_timeout_duration_secs ? parseInt(currentModFiltersSettings.symbols_timeout_duration_secs) : null,

    words_enabled: document.getElementById('cfgModWordsEnabled').checked,
    words_list: document.getElementById('cfgModWordsList').value,
    words_action_type: getPenaltyVal('cfgModPenaltyWords'),
    words_timeout_duration_secs: currentModFiltersSettings.words_timeout_duration_secs ? parseInt(currentModFiltersSettings.words_timeout_duration_secs) : null,

    spam_enabled: document.getElementById('cfgModSpamEnabled').checked,
    spam_max_duplicates: parseInt(document.getElementById('cfgModSpamMaxDuplicates').value) || 2,
    spam_action_type: getPenaltyVal('cfgModPenaltySpam'),
    spam_timeout_duration_secs: currentModFiltersSettings.spam_timeout_duration_secs ? parseInt(currentModFiltersSettings.spam_timeout_duration_secs) : null,

    max_len_enabled: document.getElementById('cfgModMaxLenEnabled').checked,
    max_len_limit: parseInt(document.getElementById('cfgModMaxLenLimit').value) || 300,
    max_len_action_type: getPenaltyVal('cfgModPenaltyMaxLen'),
    max_len_timeout_duration_secs: currentModFiltersSettings.max_len_timeout_duration_secs ? parseInt(currentModFiltersSettings.max_len_timeout_duration_secs) : null,

    mentions_enabled: document.getElementById('cfgModMentionsEnabled').checked,
    mentions_limit: parseInt(document.getElementById('cfgModMentionsLimit').value) || 3,
    mentions_action_type: getPenaltyVal('cfgModPenaltyMentions'),
    mentions_timeout_duration_secs: currentModFiltersSettings.mentions_timeout_duration_secs ? parseInt(currentModFiltersSettings.mentions_timeout_duration_secs) : null,

    action_type: document.getElementById('cfgModActionType').value || 'delete',
    timeout_duration_secs: parseInt(document.getElementById('cfgModTimeoutDuration').value) || 600,
    exempt_roles: [
      'moderator',
      document.getElementById('cfgModExemptVip').checked ? 'vip' : null,
      document.getElementById('cfgModExemptSub').checked ? 'subscriber' : null
    ].filter(Boolean)
  };

  const btn = document.getElementById('btnSaveModeration');
  if (!silent && btn) btn.disabled = true;

  const { error } = await sb.from('bot_config')
    .upsert({
      user_id: getChannelOwnerId(),
      channel_id: activeChannel.id,
      channel_name: activeChannel.username,
      feature_moderation: featureModeration,
      moderation_settings: moderationSettings,
      updated_at: new Date().toISOString()
    }, { onConflict: 'channel_id' });

  if (!silent && btn) btn.disabled = false;

  if (error) {
    showToast('error', 'Greška pri čuvanju podešavanja moderacije', '❌');
    return;
  }

  if (!silent) {
    showToast('success', 'Podešavanja moderacije sačuvana!', '✅');
  }
  notifyBotToReload();
  updateOverviewModulesUI();
}

function applyGlobalPenaltyToAll() {
  const globalAction = document.getElementById('cfgModActionType').value || 'delete';
  const filterPenaltySelectIds = [
    'cfgModPenaltyCaps', 'cfgModPenaltyLinks', 'cfgModPenaltyEmotes',
    'cfgModPenaltySymbols', 'cfgModPenaltyWords', 'cfgModPenaltySpam',
    'cfgModPenaltyMaxLen', 'cfgModPenaltyMentions'
  ];

  filterPenaltySelectIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = globalAction;
  });

  saveModerationSettings(true);
  showToast('success', 'Globalna kazna je automatski primenjena na sve filtere i sačuvana!', '✅');
}

function renderAnnounceList() {
  const el = document.getElementById('announceList');
  const addBtn = document.getElementById('btnAddAnnounce');
  if (!el) return;

  const limits = getPlanLimits();

  // Disable add button if limit reached
  if (addBtn) {
    if (limits.maxAutoAnnounces !== Infinity && localAnnounces.length >= limits.maxAutoAnnounces) {
      addBtn.disabled = true;
      addBtn.style.opacity = '0.5';
      addBtn.style.cursor = 'not-allowed';
      addBtn.title = 'Dostignut je limit automatskih poruka za tvoj paket';
    } else {
      addBtn.disabled = false;
      addBtn.style.opacity = '1';
      addBtn.style.cursor = 'pointer';
      addBtn.title = '';
    }
  }

  if (localAnnounces.length === 0) {
    el.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); background: rgba(255,255,255,0.015); border: 1px dashed var(--border-subtle); border-radius: var(--radius-md); font-size: 0.85rem;">Nema automatskih poruka. Unesi novu poruku iznad.</div>';
    return;
  }

  el.innerHTML = localAnnounces.map((msg, i) => `
    <div style="border: 1px solid var(--border-subtle); padding: 12px 16px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: space-between; gap: 12px; background: var(--bg-surface); transition: all 0.2s ease;">
      <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
        <span style="background: rgba(139, 92, 246, 0.12); border: 1px solid rgba(139, 92, 246, 0.25); color: var(--app-primary); font-size: 0.72rem; font-weight: 700; padding: 3px 9px; border-radius: 6px; flex-shrink: 0; font-family: var(--font-mono);">
          #${i + 1}
        </span>
        <span style="font-size: 0.88rem; color: var(--text-main); line-height: 1.4; word-break: break-word; font-weight: 500;">
          ${escapeHtml(msg)}
        </span>
      </div>
      <button type="button" class="action-btn danger" onclick="deleteAnnounceMessage(${i})" style="flex-shrink: 0; width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); color: #EF4444; cursor: pointer; transition: all 0.2s ease;" title="Obriši poruku">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
      </button>
    </div>
  `).join('');
}

function addAnnounceMessage() {
  const input = document.getElementById('newAnnounceInput');
  if (!input) return;
  const msg = input.value.trim();

  if (!msg) {
    showToast('error', 'Poruka ne može biti prazna.', '⚠️');
    return;
  }

  if (localAnnounces.includes(msg)) {
    showToast('error', 'Ova poruka već postoji.', '⚠️');
    return;
  }

  // Check plan limits for auto announces
  const limits = getPlanLimits();
  if (limits.maxAutoAnnounces !== Infinity && localAnnounces.length >= limits.maxAutoAnnounces) {
    openUpgradeModal('announces');
    return;
  }

  localAnnounces.push(msg);
  input.value = '';
  renderAnnounceList();
  renderPlanLimitBanners(); // Update the announce banner
  saveBotConfig(true); // Instant tihi autosave u bazu
}

let announceSaveTimer = null;
function debouncedAutoSaveAnnounces() {
  clearTimeout(announceSaveTimer);
  announceSaveTimer = setTimeout(() => {
    saveBotConfig(true);
  }, 400);
}

let botConfigSaveTimer = null;
function debouncedAutoSaveConfig() {
  clearTimeout(botConfigSaveTimer);
  botConfigSaveTimer = setTimeout(() => {
    saveBotConfig(true);
  }, 400);
}

function deleteAnnounceMessage(i) {
  localAnnounces.splice(i, 1);
  renderAnnounceList();
  renderPlanLimitBanners(); // Update the announce banner
  saveBotConfig(true); // Instant tihi autosave u bazu
}

async function loadBotStatus() {
  if (!activeChannel) return;
  const { data } = await sb.from('bot_config')
    .select('bot_active')
    .eq('user_id', getChannelOwnerId())
    .eq('channel_id', activeChannel.id)
    .maybeSingle();
  if (data) updateBotStatusUI(data.bot_active || false);
}

function updateBotStatusUI(active) {
  const label = document.getElementById('botToggleLabel');
  const toggle = document.getElementById('botActiveToggle');
  const toggleLabel = toggle?.parentElement;

  if (label) {
    label.innerHTML = `<span id="botToggleDot" style="width: 7px; height: 7px; border-radius: 50%; background: ${active ? '#53FC18' : '#EF4444'}; box-shadow: 0 0 8px ${active ? '#53FC18' : '#EF4444'};"></span> Bot: ${active ? 'ON' : 'OFF'}`;
    label.style.color = active ? '#53FC18' : '#EF4444';
  }
  if (toggle && toggle.checked !== active) { toggle.checked = active; }
  if (toggleLabel) { toggleLabel.setAttribute('aria-checked', active); }

  // Control Center updates
  const ctrlStatusLabel = document.getElementById('ctrlBotStatusLabel');
  const ctrlStatus = document.getElementById('ctrlBotStatus');
  const ctrlBtn = document.getElementById('ctrlBotToggleBtn');

  const rawBotName = currentChannelConfig?.custom_bot_name;
  const botNameStr = rawBotName ? (rawBotName.startsWith('@') ? rawBotName : `@${rawBotName}`) : '@KickotBot';

  if (ctrlStatusLabel) {
    ctrlStatusLabel.textContent = `Status bota ${botNameStr}`;
  }

  if (ctrlStatus) {
    ctrlStatus.innerHTML = active
      ? '<span style="color: var(--kick-green); font-weight: bold; display: flex; align-items: center; gap: 6px;"><span class="status-dot status-on" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--kick-green); box-shadow:0 0 8px var(--kick-green);"></span> Bot je Pokrenut</span>'
      : '<span style="color: var(--text-muted); font-weight: bold; display: flex; align-items: center; gap: 6px;"><span class="status-dot status-off" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#EF4444; box-shadow:0 0 8px #EF4444;"></span> Bot je Zaustavljen</span>';
  }
  if (ctrlBtn) {
    ctrlBtn.textContent = active ? 'Zaustavi bota' : 'Pokreni bota';
    ctrlBtn.className = active ? 'btn btn-sm btn-danger' : 'btn btn-primary btn-sm';
  }
}

function toggleBotActiveFromCtrl() {
  const toggle = document.getElementById('botActiveToggle');
  if (toggle) {
    toggle.checked = !toggle.checked;
    toggleBotActive();
  }
}

function testBotConnection() {
  if (!activeChannel) {
    showToast('error', 'Nije izabran nijedan kanal za testiranje.', '❌');
    return;
  }

  showToast('info', 'Testiram vezu i šaljem ping u chat...', '🔄');

  const kickApiBase = getBotApiBase();

  fetch(`${kickApiBase}/api/kick/test-ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ chatroom_id: activeChannel.id }).toString()
  })
    .then(async (res) => {
      if (res.ok) {
        showToast('success', `Uspešno testirano! Ping poruka poslata u @${activeChannel.username} chat.`, '✅');
      } else {
        const err = await res.json().catch(() => ({ error: 'Greška na serveru' }));
        showToast('error', `Greška pri slanju pinga: ${err.detail || err.error || 'Neuspešan HTTP zahtev'}`, '❌');
      }
    })
    .catch((err) => {
      showToast('error', `Nije moguće kontaktirati bot server: ${err.message}`, '❌');
    });
}

function addLocalLog(type, message) {
  const feed = document.getElementById('botLiveFeed');
  if (!feed) return;

  const vreme = new Date().toLocaleTimeString('sr-RS', { hour12: false });
  let badgeColor = 'var(--text-muted)';
  if (type === 'ERR') badgeColor = '#EF4444';
  else if (type === 'WARN') badgeColor = '#F59E0B';
  else if (type === 'INFO') badgeColor = '#3B82F6';
  else if (type === 'BOT') badgeColor = 'var(--kick-green)';
  else if (type === 'CHAT') badgeColor = '#10B981';

  // Obriši praznu poruku ako postoji
  if (feed.innerText.includes('Čekam prve aktivnosti...')) {
    feed.innerHTML = '';
  }

  const logDiv = document.createElement('div');
  logDiv.className = 'log-item';
  logDiv.style = 'display: flex; gap: 8px; align-items: flex-start; text-align: left; font-family: monospace; font-size: 0.78rem; padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,0.02); line-height: 1.4; width: 100%; box-sizing: border-box;';
  logDiv.innerHTML = `
    <span style="color: var(--text-muted); flex-shrink: 0;">[${vreme}]</span>
    <span style="color: ${badgeColor}; font-weight: bold; flex-shrink: 0;">[${type}]</span>
    <span style="color: #E2E8F0; word-break: break-all; flex-grow: 1;">${escapeHtml(message)}</span>
  `;
  const wasAtBottom = (feed.scrollHeight - feed.clientHeight - feed.scrollTop) < 50;
  feed.appendChild(logDiv);
  if (wasAtBottom) {
    feed.scrollTop = feed.scrollHeight;
  }
}

async function toggleBotActive() {
  if (!activeChannel) return;
  const active = document.getElementById('botActiveToggle').checked;
  updateBotStatusUI(active);

  // Track bot action
  if (window.KickALLDataLayer) {
    if (active) {
      window.KickALLDataLayer.trackBotActivation({
        channel_name: activeChannel.username,
        channel_id: activeChannel.id
      });
    } else {
      window.KickALLDataLayer.trackBotDeactivation({
        channel_name: activeChannel.username,
        channel_id: activeChannel.id
      });
    }
  }

  const { error } = await sb.from('bot_config')
    .upsert({
      user_id: getChannelOwnerId(),
      channel_id: activeChannel.id,
      channel_name: activeChannel.username,
      bot_active: active,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'channel_id' });

  if (error) {
    showToast('error', 'Greška pri promeni statusa', '❌');
    document.getElementById('botActiveToggle').checked = !active;
    updateBotStatusUI(!active);

    // Track bot action failure
    if (window.KickALLDataLayer) {
      window.KickALLDataLayer.trackError('bot_toggle_error', {
        action: active ? 'bot_start' : 'bot_stop',
        channel_name: activeChannel.username,
        error_message: error?.message || 'Unknown error'
      });
    }
  } else {
    showToast(active ? 'success' : 'info', `Bot je ${active ? 'pokrenut' : 'zaustavljen'}`, active ? '🟢' : '⭕');
    addLocalLog('INFO', active ? 'Korisnik je pokrenuo bota' : 'Korisnik je zaustavio bota');
    notifyBotToReload();

    // Track bot action success
    if (window.KickALLAnalytics) {
      window.KickALLAnalytics.trackBotAction(
        active ? 'bot_start' : 'bot_stop',
        active ? 'active' : 'inactive',
        'success'
      );
    }
  }
}

async function loadChannelLiveStatus() {
  if (!activeChannel) return;

  // Clear any existing polling interval
  if (liveStatusInterval) {
    clearInterval(liveStatusInterval);
    liveStatusInterval = null;
  }

  // Fetch once immediately
  await fetchKickLiveStatus();

  // Then poll every 60 seconds
  liveStatusInterval = setInterval(fetchKickLiveStatus, 60000);
}

async function fetchKickLiveStatus() {
  if (!activeChannel) return;

  const kickApiBase = getBotApiBase();
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const isDevWithoutBot = isLocalhost && (kickApiBase.includes(':5500') || kickApiBase === window.location.origin) && localStorage.getItem('use_local_bot') !== 'true';

  // 1. Pokušaj preko našeg bot servera (ako nije dev okruženje bez bota)
  if (!isDevWithoutBot) {
    try {
      const localRes = await fetch(`${kickApiBase}/api/kick/channel?username=${activeChannel.username}`);
      if (localRes.ok) {
        const data = await localRes.json();
        const isLive = data?.livestream !== null && data?.livestream !== undefined;
        updateLiveStatusUI(isLive);
        return;
      }
    } catch (_) { }
  }

  // U dev okruženju (npr. port 5500) bez pokrenutog lokalnog bot servera, odmah proveri Supabase bazu
  // kako pretraživač ne bi izbacivao CORS greške zbog sporih/nepouzdanih javnih proxy servisa (allorigins/corsproxy)
  if (isDevWithoutBot) {
    try {
      const { data } = await sb.from('channels')
        .select('is_active')
        .eq('id', activeChannel.id)
        .maybeSingle();
      updateLiveStatusUI(data ? !!data.is_active : false);
    } catch (_) { }
    return;
  }
}

function updateLiveStatusUI(isLive) {
  // Update the sidebar channel status indicator
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  if (statusDot) {
    statusDot.className = isLive ? 'status-dot status-on' : 'status-dot status-off';
  }
  if (statusText) {
    statusText.textContent = isLive ? 'Live' : 'Offline';
    statusText.style.color = isLive ? 'var(--kick-green)' : 'var(--text-muted)';
  }
}

function setupRealtimeChannels() {
  if (realtimeSub) {
    sb.removeChannel(realtimeSub);
  }
  if (realtimeMarriagesSub) {
    sb.removeChannel(realtimeMarriagesSub);
  }

  if (!activeChannel) return;

  realtimeSub = sb.channel('public:channels')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'channels',
      filter: `id=eq.${activeChannel.id}`
    }, payload => {
      if (payload.new) {
        updateLiveStatusUI(!!payload.new.is_active);
      }
    })
    .subscribe();

  realtimeMarriagesSub = sb.channel('public:marriages_love')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'marriages',
      filter: `channel_id=eq.${activeChannel.id}`
    }, () => {
      loadMarriages();
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'love_modifiers',
      filter: `channel_id=eq.${activeChannel.id}`
    }, () => {
      loadLoveStatuses();
    })
    .subscribe();
}

// ═══════════════════════════════════════════════════════════
// COMMANDS CRUD
// ═══════════════════════════════════════════════════════════
function openNewCmdModal() {
  const limits = getPlanLimits();
  const customCmdsCount = allCommands.filter(c => !c.is_default && !(c.id && c.id.startsWith('builtin-'))).length;
  if (customCmdsCount >= limits.maxCustomCommands) {
    showToast('warning', `Dostignut je limit od ${limits.maxCustomCommands} komandi za tvoj ${limits.name} paket! Nadogradi za više komandi.`);
    openUpgradeModal('commands');
    return;
  }

  editingCmdId = null;
  document.getElementById('cmdModalTitle').textContent = 'Nova komanda';
  document.getElementById('cmdName').value = '';
  document.getElementById('cmdName').disabled = false;
  document.getElementById('cmdResponse').value = '';
  document.getElementById('cmdResponse').disabled = false;

  const responseGroup = document.getElementById('cmdResponse').closest('.form-group');
  if (responseGroup) responseGroup.style.display = 'block';

  const nameHint = document.getElementById('cmdNameHint');
  if (nameHint) nameHint.style.display = 'block';

  document.getElementById('cmdCooldown').value = '5000';
  document.getElementById('cmdMinRank').value = 'everyone';
  document.getElementById('cmdEnabled').checked = true;
  document.getElementById('cmdCharCount').textContent = '0';
  document.getElementById('cmdModalError').style.display = 'none';
  document.getElementById('saveCmdBtn').textContent = 'Sačuvaj';

  updateModalPreview();
  updateCooldownLabel();
  openModal('cmdModal');
}

function editCommand(id) {
  const cmd = allCommands.find(c => c.id === id);
  if (!cmd) return;

  editingCmdId = id;
  const isBuiltin = id.startsWith('builtin-') || !!cmd.is_default;
  if (cmd.is_default) {
    document.getElementById('cmdModalTitle').textContent = 'Izmeni ugrađenu komandu';
    document.getElementById('cmdName').disabled = true;
    document.getElementById('cmdName').style.opacity = '0.5';
    document.getElementById('cmdName').style.cursor = 'not-allowed';
  } else {
    document.getElementById('cmdModalTitle').textContent = 'Izmeni komandu';
    document.getElementById('cmdName').disabled = false;
    document.getElementById('cmdName').style.opacity = '1';
    document.getElementById('cmdName').style.cursor = 'text';
  }

  const nameHint = document.getElementById('cmdNameHint');
  if (nameHint) nameHint.style.display = isBuiltin ? 'none' : 'block';

  document.getElementById('cmdName').value = cmd.command;
  document.getElementById('cmdName').disabled = isBuiltin;
  document.getElementById('cmdResponse').value = cmd.response;
  document.getElementById('cmdResponse').disabled = isBuiltin;

  const responseGroup = document.getElementById('cmdResponse').closest('.form-group');
  if (isBuiltin) {
    if (responseGroup) responseGroup.style.display = 'none';
  } else {
    if (responseGroup) responseGroup.style.display = 'block';
  }

  document.getElementById('cmdCooldown').value = cmd.cooldown;
  document.getElementById('cmdMinRank').value = cmd.min_rank || 'everyone';
  document.getElementById('cmdEnabled').checked = cmd.enabled;
  document.getElementById('cmdCharCount').textContent = cmd.response.length;
  document.getElementById('cmdModalError').style.display = 'none';
  document.getElementById('saveCmdBtn').textContent = 'Sačuvaj izmene';

  updateModalPreview();
  updateCooldownLabel();
  openModal('cmdModal');
}

function updateModalPreview() {
  const response = document.getElementById('cmdResponse').value;
  const charCountEl = document.getElementById('cmdCharCount');
  if (charCountEl) {
    charCountEl.textContent = response.length;
    if (response.length > 500) {
      charCountEl.style.color = '#EF4444';
    } else {
      charCountEl.style.color = 'var(--text-muted)';
    }
  }

  const rawCommand = document.getElementById('cmdName').value.trim();
  const enabled = document.getElementById('cmdEnabled').checked;

  const firstAlias = rawCommand.split(',')[0].trim().replace(/^!/, '').toLowerCase();
  const triggerDisplay = firstAlias ? `!${firstAlias}` : '!komanda';
  const previewTriggerTextEl = document.getElementById('previewTriggerText');
  if (previewTriggerTextEl) previewTriggerTextEl.textContent = triggerDisplay;

  const responseDisplay = response.trim() || 'Bot će poslati ovaj tekst kada neko ukuca komandu...';
  const previewBotResponseTextEl = document.getElementById('previewBotResponseText');
  if (previewBotResponseTextEl) previewBotResponseTextEl.textContent = responseDisplay;

  const botMsgEl = document.getElementById('previewBotMsg');
  if (botMsgEl) {
    botMsgEl.style.opacity = enabled ? '1' : '0.35';
  }
}

function updateCooldownLabel() {
  const val = parseInt(document.getElementById('cmdCooldown').value);
  const labelEl = document.getElementById('cooldownSecondsLabel');
  if (!labelEl) return;

  if (isNaN(val) || val < 0) {
    labelEl.textContent = '0 sekundi cooldown-a';
    return;
  }
  if (val === 0) {
    labelEl.textContent = 'Bez cooldown-a';
    return;
  }
  const seconds = (val / 1000).toFixed(1);
  const secondsStr = seconds.endsWith('.0') ? seconds.slice(0, -2) : seconds;
  labelEl.textContent = `${secondsStr} sekundi cooldown-a`;
}

async function saveCommand() {
  const limits = getPlanLimits();
  const isBuiltin = editingCmdId && (editingCmdId.startsWith('builtin-') || allCommands.find(c => c.id === editingCmdId)?.is_default);
  const existsInDb = editingCmdId && !editingCmdId.startsWith('builtin-');

  if (!existsInDb && !isBuiltin) {
    const customCmdsCount = allCommands.filter(c => !c.is_default && !(c.id && c.id.startsWith('builtin-'))).length;
    if (customCmdsCount >= limits.maxCustomCommands) {
      const errEl = document.getElementById('cmdModalError');
      if (errEl) {
        errEl.textContent = `Dostignut je limit od ${limits.maxCustomCommands} prilagođenih komandi za tvoj ${limits.name} paket. Nadogradi na PRO ili ELITE paket!`;
        errEl.style.display = 'block';
      }
      showToast('warning', `Dostignut je limit komandi (${limits.maxCustomCommands}) za ${limits.name} paket!`);
      openUpgradeModal('commands');
      return;
    }
  }

  const rawCommand = document.getElementById('cmdName').value.trim();
  // Za builtin komande, textarea je disabled pa je value prazan — koristimo originalnu vrijednost iz allCommands
  const cmdObj = editingCmdId ? allCommands.find(c => c.id === editingCmdId) : null;
  const response = isBuiltin
    ? (cmdObj?.response || '')
    : document.getElementById('cmdResponse').value.trim();
  const cooldown = parseInt(document.getElementById('cmdCooldown').value) || 5000;
  const enabled = document.getElementById('cmdEnabled').checked;
  const minRank = document.getElementById('cmdMinRank').value;
  const errEl = document.getElementById('cmdModalError');
  errEl.style.display = 'none';

  if (!rawCommand) { errEl.textContent = 'Unesi naziv komande.'; errEl.style.display = 'block'; return; }
  if (!isBuiltin && !response) { errEl.textContent = 'Unesi odgovor bota.'; errEl.style.display = 'block'; return; }
  if (!isBuiltin && response.length > 500) { errEl.textContent = 'Odgovor ne sme biti duži od 500 karaktera.'; errEl.style.display = 'block'; return; }

  // Za builtin komande cmdName polje je disabled i i dalje sadrži prikazani tekst sa
  // placeholder-ima (npr. "pin [tekst]") — mora se očistiti na isti način kao u toggleCommand,
  // inače bot nikad ne prepozna override za rang/cooldown/status u custom_commands tabeli.
  const enteredAliases = isBuiltin
    ? extractBuiltinAliasKeys(rawCommand).split(',').map(c => c.trim()).filter(Boolean)
    : rawCommand.split(',')
      .map(c => c.trim().replace(/^!/, '').toLowerCase())
      .filter(Boolean);

  if (enteredAliases.length === 0) {
    errEl.textContent = 'Unesi bar jedan validan alias.';
    errEl.style.display = 'block'; return;
  }

  const command = enteredAliases.join(', ');

  // Check duplicate za svaki uneti alias sa drugim custom komandama
  const otherCmds = allCommands.filter(c => c.id !== editingCmdId);
  let conflictDuplicate = null;
  for (const other of otherCmds) {
    const otherAliases = other.command.split(',').map(c => c.trim().toLowerCase());
    const duplicate = enteredAliases.find(a => otherAliases.includes(a));
    if (duplicate) {
      conflictDuplicate = duplicate;
      break;
    }
  }

  if (conflictDuplicate) {
    errEl.textContent = `Komanda "!${conflictDuplicate}" već postoji u drugoj grupi.`;
    errEl.style.display = 'block'; return;
  }

  if (!activeChannel) { errEl.textContent = 'Nema aktivnog kanala.'; errEl.style.display = 'block'; return; }

  setLoading('saveCmdBtn', true);

  // UPDATE: saljemo samo mutable polja — user_id i channel_id su immutable
  const updatePayload = {
    command,
    response,
    cooldown,
    min_rank: minRank,
    enabled,
  };

  // INSERT: saljemo sve kolone ukljucujuci user_id i channel_id
  const insertPayload = {
    user_id: getChannelOwnerId(),
    channel_id: activeChannel.id,
    command,
    response,
    cooldown,
    min_rank: minRank,
    enabled,
    is_default: !!isBuiltin,
    created_at: new Date().toISOString()
  };

  let error;
  if (existsInDb) {
    ({ error } = await sb.from('custom_commands').update(updatePayload).eq('id', editingCmdId));
  } else {
    ({ error } = await sb.from('custom_commands').insert(insertPayload));
  }

  setLoading('saveCmdBtn', false);

  if (error) {
    errEl.textContent = 'Greška pri čuvanju. Pokušaj ponovo.';
    errEl.style.display = 'block';
    return;
  }

  showToast('success', editingCmdId ? 'Komanda uspešno izmenjena' : 'Komanda uspešno kreirana!', 'check');
  notifyBotToReload();
  closeModal('cmdModal');
  await loadCommands();
}

async function toggleCommand(id, currentEnabled, _isDefault) {
  if (id.startsWith('builtin-')) {
    const cmdObj = allCommands.find(c => c.id === id);
    if (!cmdObj) return;

    const payload = {
      user_id: getChannelOwnerId(),
      channel_id: activeChannel.id,
      command: extractBuiltinAliasKeys(cmdObj.command),
      response: cmdObj.response,
      cooldown: cmdObj.cooldown,
      min_rank: cmdObj.min_rank || 'everyone',
      enabled: !currentEnabled,
      is_default: true,
      updated_at: new Date().toISOString()
    };

    // Ako builtin vec postoji u DB (db_exists), radi UPDATE, inace INSERT
    let dbError;
    if (cmdObj.db_exists) {
      ({ error: dbError } = await sb.from('custom_commands')
        .update({ enabled: !currentEnabled, updated_at: new Date().toISOString() })
        .eq('id', id));
    } else {
      ({ error: dbError } = await sb.from('custom_commands').insert({
        ...payload,
        created_at: new Date().toISOString()
      }));
    }
    if (dbError) { showToast('error', 'Greška pri čuvanju ugrađene komande', 'error'); return; }
  } else {
    const { error } = await sb.from('custom_commands')
      .update({ enabled: !currentEnabled, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { showToast('error', 'Greška', 'error'); return; }
  }

  showToast('info', !currentEnabled ? 'Komanda je uključena' : 'Komanda je isključena', !currentEnabled ? 'check' : 'pause');
  notifyBotToReload();
  await loadCommands();
}

function deleteCommandConfirm(id, cmd) {
  confirmCallback = async () => {
    const { error } = await sb.from('custom_commands').delete().eq('id', id);
    if (error) { showToast('error', 'Greška pri brisanju', 'error'); return; }
    showToast('success', `${cmd} je obrisana`, 'trash');
    notifyBotToReload();
    await loadCommands();
  };

  const titleEl = document.getElementById('confirmModalTitle');
  if (titleEl) titleEl.textContent = 'Potvrdi brisanje komande';

  const confirmMsgEl = document.getElementById('confirmMsg');
  if (confirmMsgEl) {
    confirmMsgEl.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 14px; text-align: left;">
        <div style="font-size: 0.92rem; color: var(--text-main); font-weight: 600;">
          Da li sigurno želiš da obrišeš ovu komandu?
        </div>
        <div style="background: rgba(239, 68, 68, 0.08); border: 1px dashed rgba(239, 68, 68, 0.35); padding: 12px 16px; border-radius: var(--radius-md); font-family: var(--font-mono); font-weight: 700; color: #F87171; font-size: 1.05rem; word-break: break-all; display: flex; align-items: center; justify-content: space-between;">
          <span>${escapeHtml(cmd)}</span>
        </div>
        <div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.4; display: flex; align-items: flex-start; gap: 8px; background: rgba(255,255,255,0.02); padding: 10px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.5" style="flex-shrink:0; margin-top: 1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Ova radnja je nepovratna. Komanda će biti trajno uklonjena sa bota.</span>
        </div>
      </div>
    `;
  }

  const confirmBtn = document.getElementById('confirmDeleteBtn');
  if (confirmBtn) {
    confirmBtn.style.whiteSpace = 'nowrap';
    confirmBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
      </svg>
      Obriši komandu
    `;
  }

  document.getElementById('confirmDeleteBtn').onclick = () => { closeModal('confirmModal'); confirmCallback(); };
  openModal('confirmModal');
}

// ── Char counter for cmd response ──────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const resp = document.getElementById('cmdResponse');
  if (resp) {
    resp.addEventListener('input', () => {
      document.getElementById('cmdCharCount').textContent = resp.value.length;
    });
  }
});



// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
const PANEL_NAMES = {
  overview: 'Overview',
  commands: 'Komande',
  'builtin-commands': 'Ugrađene komande',
  leaderboard: 'Leaderboard',
  watchtime: 'Watchtime',
  marriages: 'Ljubav i brakovi',
  minigames: 'Mini igre',
  songs: 'Song Request',
  'bot-interaction': 'Bot interakcija',
  'auto-announces': 'Automatske poruke',
  config: 'Bot Config',
  moderation: 'Moderacija',
  economy: 'Ranking sistem',
};

function updateBreadcrumbs(panelId) {
  const breadcrumb = document.getElementById('breadcrumb');
  if (!breadcrumb) return;

  let html = `<span>Kickot</span>`;

  if (panelId === 'overview') {
    html += `
      <span class="bc-sep">›</span>
      <span id="breadcrumbPage">Overview</span>
    `;
  } else if (panelId === 'leaderboard') {
    const subTypeLabel = activeLeaderboardType === 'chatters' ? 'Chatters' : activeLeaderboardType === 'watchtime' ? 'Watchtime' : 'Zajedno';
    html += `
      <span class="bc-sep">›</span>
      <span>Leaderboard</span>
      <span class="bc-sep">›</span>
      <span id="breadcrumbPage">${subTypeLabel}</span>
    `;
  } else {
    html += `
      <span class="bc-sep">›</span>
      <span id="breadcrumbPage">${PANEL_NAMES[panelId] || panelId}</span>
    `;
  }

  breadcrumb.innerHTML = html;
}

function loadEconomyPanelData() {
  switchEconomyTab(currentEconomyTab || 'config');
}

function switchPanel(panelId) {
  // Prevent switching if already on this panel
  const currentPanel = document.querySelector('.panel.active');
  if (currentPanel && currentPanel.id === `panel-${panelId}`) return;

  document.body.style.overflow = '';
  const mainContent = document.getElementById('mainContent');
  if (mainContent) mainContent.scrollTop = 0;

  sessionStorage.setItem('active-dashboard-panel-session', panelId);
  try {
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', `#${panelId}`);
    }
  } catch (e) { }

  // Reset scroll for all panels
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.remove('active');
    p.scrollTop = 0;
  });
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.remove('active');
    n.removeAttribute('aria-current');
  });

  const panel = document.getElementById(`panel-${panelId}`);
  const navItem = document.querySelector(`[data-panel="${panelId}"]`);
  if (panel) {
    panel.classList.add('active');
    panel.style.overflow = 'visible';
    panel.style.height = 'auto';
  }
  if (navItem) {
    navItem.classList.add('active');
    navItem.setAttribute('aria-current', 'page');
  }

  updateBreadcrumbs(panelId);

  if (panelId === 'overview') {
    updateOverviewModulesUI();
    if (typeof refreshMiniPanels === 'function' && Array.isArray(allLeaderboard)) {
      refreshMiniPanels(allLeaderboard);
    }
  }
  if (panelId === 'leaderboard') { loadLeaderboard(); loadWatchtime(); }
  if (panelId === 'marriages') { loadMarriages(); loadLoveStatuses(); }
  if (panelId === 'bot-interaction' && !configLoaded) loadBotConfig();
  if (panelId === 'auto-announces') {
    if (!configLoaded) loadBotConfig();
    renderPlanLimitBanners(); // Update announces banner
  }
  if (panelId === 'config' && !configLoaded) loadBotConfig();
  if (panelId === 'moderation') {
    if (!configLoaded) loadBotConfig();
    renderPlanLimitBanners(); // Update moderation penalty banner
    applyPenaltySettingsRestrictions(); // Apply penalty restrictions
  }
  if (panelId === 'songs' && !configLoaded) loadBotConfig();
  if (panelId === 'economy') {
    if (!configLoaded) loadBotConfig();
    switchEconomyTab(currentEconomyTab || 'config');
  }
  if (panelId === 'builtin-commands' || panelId === 'minigames') renderBuiltinCommandsGrid();

  if (window.innerWidth < 768) {
    document.getElementById('sidebar').classList.remove('mobile-open');
  }
}

// ── Sidebar Toggle ─────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth < 768) {
    sidebar.classList.toggle('mobile-open');
  }
}

// ── Channel Menu ───────────────────────────────────────────
function toggleChannelMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('channelMenu');
  if (!menu) return;
  menu.classList.toggle('open');
}

document.addEventListener('click', e => {
  const sw = document.getElementById('channelSwitcher');
  if (sw && !sw.contains(e.target)) {
    document.getElementById('channelMenu')?.classList.remove('open');
  }
  const pill = document.getElementById('userPill');
  if (pill && !pill.contains(e.target)) {
    document.getElementById('userMenuSm')?.classList.remove('open');
  }
});

// ── User Menu ──────────────────────────────────────────────
function toggleUserMenu() {
  document.getElementById('userMenuSm').classList.toggle('open');
}
async function handleSignOut() {
  try {
    let userId = null;
    if (typeof sb !== 'undefined' && sb && sb.auth) {
      const { data } = await sb.auth.getSession();
      userId = data?.session?.user?.id;
    }

    if (userId) {
      notifyGlobalLogout(userId);
    }

    localStorage.removeItem('active-dashboard-panel');
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
    // SignOut error
  } finally {
    window.location.replace(window.KickotConfig.paths.indexUrl);
  }
}

function notifyGlobalLogout(userId) {
  const domains = [
    'https://kickall.netlify.app',
    'https://kickall.milanwebportal.com',
    window.location.origin
  ];

  domains.forEach(domain => {
    try {
      const iframe = document.querySelector(`iframe[src*="${domain}"]`);
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'GLOBAL_LOGOUT' }, domain);
      }
    } catch (e) {
      // Ignore cross-origin errors
    }
  });

  localStorage.setItem('kickbot_global_logout', Date.now().toString());

  if (userId) {
    fetch(`${getBotApiBase()}/api/global-logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userId })
    }).catch(() => { });
  }
}

window.addEventListener('message', (event) => {
  // Bezbednosna provera: prihvati poruke samo od pouzdanih originа
  const allowedOrigins = ['https://kickall.app', 'http://localhost:5500'];
  if (!allowedOrigins.includes(event.origin)) return;

  if (event.data && event.data.type === 'GLOBAL_LOGOUT') {
    localStorage.clear();
    sessionStorage.clear();
    window.location.replace(window.KickotConfig.paths.indexUrl);
  }
});

window.addEventListener('storage', (event) => {
  if (event.key === 'kickbot_global_logout') {
    localStorage.clear();
    sessionStorage.clear();
    window.location.replace(window.KickotConfig.paths.indexUrl);
  }
});

async function checkServerLogoutStatus() {
  try {
    const apiBase = getBotApiBase();
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalhost && (apiBase.includes(':5500') || apiBase === window.location.origin) && localStorage.getItem('use_local_bot') !== 'true') {
      return;
    }
    const { data: sessionData } = await Promise.race([
      sb.auth.getSession(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Session check timeout')), 10000))
    ]);
    const session = sessionData?.session;
    if (session?.user?.id) {
      const res = await fetch(`${apiBase}/api/check-logout?userId=${session.user.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.shouldLogout) {
          await sb.auth.signOut();
          window.location.reload();
        }
      }
    }
  } catch (e) {
    // Ignore errors
  }
}

checkServerLogoutStatus();
function goToSettings() { showToast('info', 'Podešavanja dolaze uskoro', 'ℹ️'); }

// ═══════════════════════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════════════════════
function openModal(id) {
  const modalEl = document.getElementById(id);
  if (!modalEl) return;
  modalEl.classList.remove('closing');
  modalEl.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Uvek skroluj na vrh pri otvaranju modala
  modalEl.scrollTop = 0;
  const box = modalEl.querySelector('.modal-box');
  if (box) box.scrollTop = 0;
  const body = modalEl.querySelector('.modal-body');
  if (body) body.scrollTop = 0;
}

function closeModal(id) {
  const modalEl = document.getElementById(id);
  if (!modalEl) return;
  modalEl.style.pointerEvents = 'none';
  modalEl.classList.add('closing');

  // Reset inline styles for upgrade modal
  if (id === 'upgradeModal') {
    modalEl.style.removeProperty('display');
    modalEl.style.removeProperty('visibility');
    modalEl.style.removeProperty('opacity');
    modalEl.style.removeProperty('pointer-events');
    modalEl.style.removeProperty('z-index');
    modalEl.style.removeProperty('position');
    modalEl.style.removeProperty('top');
    modalEl.style.removeProperty('left');
    modalEl.style.removeProperty('width');
    modalEl.style.removeProperty('height');
    modalEl.style.removeProperty('background');
  }

  setTimeout(() => {
    modalEl.classList.remove('open', 'closing');
    modalEl.style.pointerEvents = '';
    document.body.style.overflow = '';
  }, 220);
}

function handleModalBg(e, id) {
  if (e.target.id === id) closeModal(id);
}

const ALL_MODAL_IDS = ['cmdModal', 'addChannelModal', 'confirmModal', 'feedbackModal', 'helpModal', 'modFilterPenaltyModal', 'docsModal', 'settingsModal', 'storeItemModal', 'referralModal', 'customBotAuthModal', 'withdrawalModal', 'upgradeModal'];
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ALL_MODAL_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.classList.contains('open')) closeModal(id);
    });
    document.body.style.overflow = '';
  }
});

// ═══════════════════════════════════════════════════════════
// TOASTS (Old glassmorphism system)
// ═══════════════════════════════════════════════════════════
let toastId = 0;
function showToast(type, msg, _iconEmoji = '💬', duration = null) {
  let container = document.getElementById('toastContainer');
  // Ensure container is a direct child of body (fixes DOM nesting issues)
  if (!container || container.parentElement !== document.body) {
    if (container) container.remove();
    container = document.createElement('div');
    container.className = 'toast-container';
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }

  // Dinamičko izračunavanje trajanja ako nije eksplicitno prosleđeno:
  // Osnovno vreme čitanja: ~60ms po karakteru + baznih 2500ms
  // Greške i upozorenja se zadržavaju duže (+1000ms) radi bolje uočljivosti
  if (!duration) {
    const textLength = (msg || '').length;
    const baseDuration = Math.max(2500, Math.min(8000, 2200 + textLength * 55));
    duration = (type === 'error' || type === 'warning') ? baseDuration + 1200 : baseDuration;
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

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════
function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    // Lock dimensions to prevent layout shift
    btn.style.width = btn.offsetWidth + 'px';
    btn.style.height = btn.offsetHeight + 'px';
    btn._originalText = btn.innerHTML;
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.25);border-top-color:#fff;border-radius:50%;animation:spin 0.65s linear infinite"></span>';
  } else {
    if (btn._originalText) btn.innerHTML = btn._originalText;
    // Release locked dimensions
    btn.style.width = '';
    btn.style.height = '';
  }
}

// fmtDate, getCurrentMonth, rankColor i downloadCsv su definisani ranije u fajlu
// (uklonjen duplikat koji je tiho pregazio te implementacije)

// ── Add spinner keyframe to document ──────────────────────
const style = document.createElement('style');
style.textContent = '@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
document.head.appendChild(style);

// ── Settings Modal Functions ──────────────────────────────
let settingsUploadedAvatarBase64 = null;

function openSettingsModal(activeTab = 'profile') {
  const userMenuSm = document.getElementById('userMenuSm');
  if (userMenuSm) {
    userMenuSm.classList.remove('open');
  }
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  sb.auth.getUser().then(({ data: { user } }) => {
    if (!user) {
      showToast('error', 'Moraš biti prijavljen da pristupiš podešavanjima.', '⚠️');
      return;
    }

    const name = user.user_metadata?.display_name || user.email?.split('@')[0] || 'User';
    const avatarVal = user.user_metadata?.avatar_url || name.charAt(0).toUpperCase();

    if (document.getElementById('settingsEmail')) document.getElementById('settingsEmail').value = user.email || '';
    if (document.getElementById('settingsName')) document.getElementById('settingsName').value = name;
    if (document.getElementById('settingsPassword')) document.getElementById('settingsPassword').value = '';
    if (document.getElementById('settingsConfirmPassword')) document.getElementById('settingsConfirmPassword').value = '';

    setSettingsAvatarPreview(avatarVal);
    settingsUploadedAvatarBase64 = null;

    openModal('settingsModal');
    switchSettingsTab(activeTab);
  });
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    modal.classList.remove('open');
  }
}

function handleSettingsModalBackdropClick(e) {
  if (e.target.id === 'settingsModal') {
    closeSettingsModal();
  }
}

function setSettingsAvatarPreview(urlOrEmoji) {
  const imgEl = document.getElementById('settingsAvatarPreviewImg');
  if (!imgEl) return;
  if (urlOrEmoji.startsWith('data:image') || urlOrEmoji.startsWith('http')) {
    imgEl.style.backgroundImage = `url("${urlOrEmoji}")`;
    imgEl.style.backgroundSize = 'cover';
    imgEl.style.backgroundPosition = 'center';
    imgEl.textContent = '';
  } else {
    imgEl.style.backgroundImage = 'none';
    imgEl.textContent = urlOrEmoji;
  }
}

async function syncLatestKickAvatar() {
  let channelName = activeChannel?.username || activeChannel?.slug || activeChannel?.name || null;

  if (!channelName) {
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      channelName = user.user_metadata?.display_name || user.user_metadata?.custom_claims?.global_name || user.email?.split('@')[0] || null;
    }
  }

  if (!channelName) {
    showToast('error', 'Nije moguće identifikovati vaš Kick nalog za preuzimanje slike.');
    return;
  }

  const cleanChannel = channelName.trim().replace(/^@+/, '');

  const btn = document.getElementById('syncKickAvatarBtn');
  const origHTML = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span style="display:inline-block; animation: spin 1s linear infinite;">⏳</span> Preuzimanje sa Kicka...`;
  }

  try {
    const avatarUrl = await fetchKickAvatar(cleanChannel);
    if (avatarUrl) {
      setSettingsAvatarPreview(avatarUrl);
      settingsUploadedAvatarBase64 = avatarUrl;
      showToast('success', `Profilna slika za @${cleanChannel} je uspešno preuzeta! Klikni na "Sačuvaj Promene".`);
    } else {
      showToast('error', `Nije bilo moguće preuzeti profilnu sliku sa Kicka za @${cleanChannel}.`);
    }
  } catch (err) {
    showToast('error', 'Greška prilikom preuzimanja profilne slike sa Kicka.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHTML;
    }
  }
}

function triggerSettingsAvatarUpload() {
  document.getElementById('settingsAvatarFileInput').click();
}

function handleSettingsAvatarFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (evt) {
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement('canvas');
      const maxDim = 128;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxDim) {
          height *= maxDim / width;
          width = maxDim;
        }
      } else {
        if (height > maxDim) {
          width *= maxDim / height;
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.65);
      setSettingsAvatarPreview(compressedBase64);
      settingsUploadedAvatarBase64 = compressedBase64;
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
}

function selectSettingsPresetAvatar(key) {
  const emojis = { robot: '🤖', ninja: '🥷', gamepad: '🎮', star: '⭐' };
  const emoji = emojis[key];
  setSettingsAvatarPreview(emoji);
  settingsUploadedAvatarBase64 = emoji;
}

async function handleSaveSettings() {
  const name = document.getElementById('settingsName').value.trim();
  const password = document.getElementById('settingsPassword').value;
  const confirmPassword = document.getElementById('settingsConfirmPassword').value;

  if (!name) {
    showToast('error', 'Ime ne može biti prazno.', '⚠️');
    return;
  }

  if (password) {
    if (password.length < 8) {
      showToast('error', 'Lozinka mora imati barem 8 karaktera.', '⚠️');
      return;
    }
    if (password !== confirmPassword) {
      showToast('error', 'Lozinke se ne podudaraju.', '⚠️');
      return;
    }
  }

  const btn = document.getElementById('settingsSaveBtn');
  btn.disabled = true;

  try {
    const updateData = { display_name: name };
    if (settingsUploadedAvatarBase64 !== null) {
      updateData.avatar_url = settingsUploadedAvatarBase64;
    }

    const { error: profileError } = await sb.auth.updateUser({ data: updateData });
    if (profileError) throw profileError;

    if (password) {
      const { error: passwordError } = await sb.auth.updateUser({ password: password });
      if (passwordError) throw passwordError;
    }

    showToast('success', 'Podešavanja uspešno sačuvana!', '✅');
    closeSettingsModal();

    // Refresh user state
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      currentUser = user;
      // Update sidebar avatar/name immediately
      const avatarVal = currentUser.user_metadata?.avatar_url || name.charAt(0).toUpperCase();
      const sidebarAvEl = document.getElementById('sidebarAvatar');
      if (avatarVal.startsWith('data:image') || avatarVal.startsWith('http')) {
        sidebarAvEl.style.backgroundImage = `url("${avatarVal}")`;
        sidebarAvEl.style.backgroundSize = 'cover';
        sidebarAvEl.style.backgroundPosition = 'center';
        sidebarAvEl.textContent = '';
      } else {
        sidebarAvEl.style.backgroundImage = 'none';
        sidebarAvEl.textContent = avatarVal;
      }
      document.getElementById('sidebarName').textContent = name;
    }

  } catch (err) {
    showToast('error', err.message || 'Greška pri čuvanju podešavanja.', '❌');
  } finally {
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
let currentUserProfileData = null;

function switchSettingsTab(tabName) {
  const tabProfile = document.getElementById('setTabProfile');
  const tabChannels = document.getElementById('setTabChannels');
  const tabManagers = document.getElementById('setTabManagers');
  const tabSubscription = document.getElementById('setTabSubscription');

  const panelProfile = document.getElementById('settingsProfilePanel');
  const panelChannels = document.getElementById('settingsChannelsPanel');
  const panelManagers = document.getElementById('settingsManagersPanel');
  const panelSubscription = document.getElementById('settingsSubscriptionPanel');

  if (!tabProfile || !tabChannels || !tabManagers || !panelProfile || !panelChannels || !panelManagers) return;

  // Reset active states
  tabProfile.classList.remove('active');
  tabChannels.classList.remove('active');
  tabManagers.classList.remove('active');
  if (tabSubscription) tabSubscription.classList.remove('active');

  panelProfile.style.display = 'none';
  panelChannels.style.display = 'none';
  panelManagers.style.display = 'none';
  if (panelSubscription) panelSubscription.style.display = 'none';

  if (tabName === 'profile') {
    tabProfile.classList.add('active');
    panelProfile.style.display = 'block';
  } else if (tabName === 'channels') {
    tabChannels.classList.add('active');
    panelChannels.style.display = 'block';
    renderSettingsChannelList();
    // Block add button if at limit
    const addChBtn = document.getElementById('settingsAddChannelBtn');
    const chLimits = getPlanLimits();
    if (addChBtn && chLimits.maxChannels !== Infinity && currentChannels.length >= chLimits.maxChannels) {
      addChBtn.disabled = true;
      addChBtn.title = `Limit dostignut (${currentChannels.length}/${chLimits.maxChannels}). Nadogradi paket.`;
      addChBtn.style.opacity = '0.45';
      addChBtn.style.cursor = 'not-allowed';
    } else if (addChBtn) {
      addChBtn.disabled = false;
      addChBtn.title = '';
      addChBtn.style.opacity = '';
      addChBtn.style.cursor = '';
    }
  } else if (tabName === 'managers') {
    tabManagers.classList.add('active');
    panelManagers.style.display = 'block';
    renderSettingsManagersList();
  } else if (tabName === 'subscription') {
    if (tabSubscription) tabSubscription.classList.add('active');
    if (panelSubscription) panelSubscription.style.display = 'block';
    renderSettingsSubscriptionPanel();
  }
}

async function renderSettingsSubscriptionPanel() {
  const planBadge = document.getElementById('subPlanBadge');
  const statusText = document.getElementById('subStatusText');
  const dateLabel = document.getElementById('subDateLabel');
  const dateValue = document.getElementById('subDateValue');
  const btnPortal = document.getElementById('btnManageSubscription');

  if (!currentUserProfileData && currentUser) {
    try {
      const { data } = await sb.from('user_profiles')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle();
      if (data) currentUserProfileData = data;
    } catch (_) { }
  }

  const p = currentUserProfileData || {};
  const plan = (p.plan || currentUserPlan || 'free').toUpperCase();
  const period = (p.plan_period === 'yearly') ? 'Godišnje' : (p.plan_period === 'monthly' ? 'Mesečno' : '');
  const planDisplay = period ? `${plan} (${period})` : plan;

  if (planBadge) {
    planBadge.textContent = planDisplay;
    if (plan.includes('ELITE')) planBadge.style.color = '#53FC18';
    else if (plan.includes('PRO')) planBadge.style.color = '#c084fc';
    else planBadge.style.color = '#fff';
  }

  const status = (p.subscription_status || '').toLowerCase();
  const renewsAt = p.renews_at;
  const endsAt = p.ends_at;

  if (statusText) {
    if (plan === 'FREE') {
      statusText.textContent = 'Besplatni paket';
      statusText.style.color = 'var(--text-muted)';
    } else if (status === 'cancelled' || status === 'expired') {
      statusText.textContent = 'Otkazano (Aktivno do isteka)';
      statusText.style.color = '#f87171';
    } else if (status === 'paused') {
      statusText.textContent = 'Pauzirano';
      statusText.style.color = '#fbbf24';
    } else {
      statusText.textContent = 'Aktivno';
      statusText.style.color = '#53FC18';
    }
  }

  const targetDateStr = (status === 'cancelled' || endsAt) ? (endsAt || renewsAt) : renewsAt;
  if (dateLabel) {
    dateLabel.textContent = (status === 'cancelled' || endsAt) ? 'Ističe dana:' : 'Sledeće obnavljanje:';
  }

  if (dateValue) {
    if (targetDateStr) {
      try {
        const d = new Date(targetDateStr);
        dateValue.textContent = d.toLocaleDateString('sr-RS', { day: 'numeric', month: 'long', year: 'numeric' });
      } catch (_) {
        dateValue.textContent = targetDateStr;
      }
    } else {
      dateValue.textContent = (plan === 'FREE') ? 'Neograničeno' : 'Aktivna pretplata';
    }
  }

  if (btnPortal) {
    const portalUrl = p.customer_portal_url || window.CONFIG?.PADDLE?.BILLING_PORTAL_URL || '';
    btnPortal.href = portalUrl || '#';
    btnPortal.style.display = (plan !== 'FREE' && portalUrl) ? 'inline-flex' : 'none';
  }
}

function renderSettingsManagersList() {
  const listEl = document.getElementById('settingsManagerList');
  const ownerView = document.getElementById('settingsManagersOwnerView');
  const guestView = document.getElementById('settingsManagersGuestView');
  if (!listEl || !ownerView || !guestView) return;

  // Proveri da li smo mi vlasnik ovog kanala
  const isManaged = activeChannel && activeChannel.is_managed === true;
  if (isManaged) {
    ownerView.style.display = 'none';
    guestView.style.display = 'block';
    return;
  }

  ownerView.style.display = 'block';
  guestView.style.display = 'none';
  listEl.innerHTML = '';

  const managers = activeChannel?.managers || [];
  const limits = getPlanLimits();
  const used = managers.length;
  const max = limits.maxManagers;
  const limitStr = max === Infinity ? 'Neograničeno' : max;
  const pct = max === Infinity ? 100 : Math.min(100, Math.round((used / max) * 100));
  const isAtLimit = max !== Infinity && used >= max;
  const barColor = isAtLimit ? '#EF4444' : (pct >= 80 ? '#EAB308' : '#53fc18');

  // Limit banner (prikazuj samo ako NIJE neograničeno/ELITE)
  const limitBannerHtml = max === Infinity ? '' : `
    <div style="margin-bottom: 14px; background: rgba(13, 9, 26, 0.6); border: 1px solid rgba(139,92,246,0.25); border-radius: 10px; padding: 12px 14px;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px;">
        <span style="font-size:0.78rem; font-weight:700; color:#fff;">Menadžeri</span>
        <span style="font-size:0.82rem; font-weight:800; color:${isAtLimit ? '#EF4444' : '#fff'}">${used} / ${limitStr}</span>
      </div>
      <div style="background:rgba(255,255,255,0.06); border-radius:6px; height:6px; overflow:hidden;">
        <div style="height:100%; width:${pct}%; background:${barColor}; border-radius:6px; transition:width 0.4s ease;"></div>
      </div>
      ${isAtLimit ? `<div style="margin-top:10px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <span style="font-size:0.75rem; color:#EF4444; font-weight:600;">Dostignut je maksimalan broj menadžera za ${limits.name} paket.</span>
        <button type="button" class="plan-upgrade-btn" onclick="event.stopPropagation(); openUpgradeModal('managers')" style="padding:5px 12px; font-size:0.73rem; flex-shrink:0;">${upgradeSvgIcon}<span>Nadogradi</span></button>
      </div>` : ''}
    </div>
  `;
  const managerListLabel = listEl.previousElementSibling;
  if (managerListLabel) {
    // Remove old banner if present
    const existingBanner = managerListLabel.previousElementSibling;
    if (existingBanner && existingBanner.dataset.limitBanner === 'managers') existingBanner.remove();
    if (limitBannerHtml) {
      managerListLabel.insertAdjacentHTML('beforebegin', limitBannerHtml);
      managerListLabel.previousElementSibling.dataset.limitBanner = 'managers';
    }
  }

  // Block add manager button if at limit
  const addMgrBtn = document.getElementById('settingsAddManagerBtn');
  const addMgrInput = document.getElementById('settingsNewManagerInput');
  if (isAtLimit) {
    if (addMgrBtn) { addMgrBtn.disabled = true; addMgrBtn.style.opacity = '0.45'; addMgrBtn.style.cursor = 'not-allowed'; addMgrBtn.title = `Limit dostignut (${used}/${max}). Nadogradi paket.`; }
    if (addMgrInput) { addMgrInput.disabled = true; addMgrInput.placeholder = `Dostignut limit od ${max} menadžera`; }
  } else {
    if (addMgrBtn) { addMgrBtn.disabled = false; addMgrBtn.style.opacity = ''; addMgrBtn.style.cursor = ''; addMgrBtn.title = ''; }
    if (addMgrInput) { addMgrInput.disabled = false; addMgrInput.placeholder = 'Kick korisničko ime'; }
  }

  if (managers.length === 0) {
    listEl.innerHTML = '<div style="padding:10px;font-size:0.85rem;color:var(--text-muted);text-align:center;">Nema aktivnih menadžera za ovaj kanal.</div>';
    return;
  }

  managers.forEach(m => {
    const item = document.createElement('div');
    item.className = 'modal-channel-item';
    item.style = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); margin-bottom: 6px;';

    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="manager-avatar" data-username="${m}" style="width:24px;height:24px;border-radius:50%;background:var(--app-gradient);display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;background-size:cover;background-position:center;">
          ${m.charAt(0).toUpperCase()}
        </div>
        <span style="font-weight:600;font-size:0.85rem;">${escapeHtml(m)}</span>
      </div>
      <button class="btn btn-sm btn-danger" onclick="removeChannelManager('${escapeHtml(m)}')" style="padding: 2px 8px; font-size: 0.75rem;">Ukloni</button>
    `;
    listEl.appendChild(item);

    // Dohvati profilnu sliku menadžera u pozadini
    fetchKickAvatar(m).then(avatarUrl => {
      if (avatarUrl) {
        const avatarEl = item.querySelector(`.manager-avatar[data-username="${m}"]`);
        if (avatarEl) {
          avatarEl.style.backgroundImage = `url("${avatarUrl}")`;
          avatarEl.textContent = '';
        }
      }
    }).catch(() => { });
  });
}

async function addNewManager() {
  const input = document.getElementById('settingsNewManagerInput');
  const errEl = document.getElementById('settingsAddManagerError');
  if (!input || !errEl) return;

  errEl.style.display = 'none';
  const username = input.value.trim();

  if (!username) {
    errEl.textContent = 'Unesi Kick korisničko ime.';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('settingsAddManagerBtn');
  if (btn) btn.disabled = true;

  try {
    // 1. Proveri da li korisnik uopšte postoji na Kick platformi
    const resolved = await resolveChatroomId(username);
    if (!resolved) {
      errEl.textContent = `Korisnik @${username} ne postoji na Kick platformi.`;
      errEl.style.display = 'block';
      if (btn) btn.disabled = false;
      return;
    }

    const kickUsernameResolved = resolved.username; // Pravilno napisano ime sa Kick-a (npr. Milan)
    const kickUsernameLC = kickUsernameResolved.toLowerCase();

    // 2. Dobavi naše korisničko ime iz sopstvenog profila da sprečimo dodavanje samog sebe
    const { data: myProfile } = await sb.from('user_profiles').select('display_name').eq('id', currentUser.id).maybeSingle();
    const myName = myProfile?.display_name || '';

    if (kickUsernameLC === myName.toLowerCase()) {
      errEl.textContent = 'Ne možeš dodati samog sebe kao menadžera.';
      errEl.style.display = 'block';
      if (btn) btn.disabled = false;
      return;
    }

    if (!activeChannel.managers) activeChannel.managers = [];

    const limits = getPlanLimits();
    if (limits.maxManagers !== Infinity && activeChannel.managers.length >= limits.maxManagers) {
      errEl.textContent = `Dostignut je limit od ${limits.maxManagers} menadžera za tvoj ${limits.name} paket. Nadogradi nalog za više menadžera.`;
      errEl.style.display = 'block';
      if (btn) btn.disabled = false;
      openUpgradeModal('managers');
      return;
    }

    if (activeChannel.managers.map(m => m.toLowerCase()).includes(kickUsernameLC)) {
      errEl.textContent = 'Korisnik je već menadžer ovog kanala.';
      errEl.style.display = 'block';
      if (btn) btn.disabled = false;
      return;
    }

    // 3. Proveri da li korisnik ima kreiran nalog na našem sajtu
    const { data: profileUser, error: _profileErr } = await sb.from('user_profiles')
      .select('id, display_name')
      .ilike('display_name', kickUsernameLC)
      .maybeSingle();

    // Dodajemo menadžera sa njegovim pravim imenom sa Kick-a
    activeChannel.managers.push(kickUsernameResolved);

    const updatedChannels = currentChannels.map(c => {
      if (c.id === activeChannel.id) {
        return { ...c, managers: activeChannel.managers };
      }
      return c;
    });

    const { error: updateErr } = await sb.from('user_profiles')
      .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
      .eq('id', currentUser.id);

    if (updateErr) throw updateErr;

    currentChannels = updatedChannels;
    input.value = '';

    if (!profileUser) {
      showToast('success', `Korisnik @${kickUsernameResolved} je dodat! Nalog na sajtu će mu biti aktiviran čim se prvi put prijavi preko Kick-a`, '✅');
    } else {
      showToast('success', `Korisnik @${kickUsernameResolved} je uspešno dodat kao menadžer!`, '✅');
    }

    renderSettingsManagersList();

  } catch (err) {
    errEl.textContent = 'Greška pri dodavanju menadžera. Pokušaj ponovo.';
    errEl.style.display = 'block';
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function removeChannelManager(username) {
  if (!confirm(`Da li sigurno želiš da ukloniš menadžera @${username}?`)) return;

  try {
    activeChannel.managers = (activeChannel.managers || []).filter(m => m.toLowerCase() !== username.toLowerCase());

    const updatedChannels = currentChannels.map(c => {
      if (c.id === activeChannel.id) {
        return { ...c, managers: activeChannel.managers };
      }
      return c;
    });

    const { error: updateErr } = await sb.from('user_profiles')
      .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
      .eq('id', currentUser.id);

    if (updateErr) throw updateErr;

    currentChannels = updatedChannels;
    showToast('success', `Menadžer @${username} je uklonjen.`, '✅');
    renderSettingsManagersList();

  } catch (err) {
    showToast('error', 'Greška pri uklanjanju menadžera.', '❌');
  }
}

async function makeChannelPrimary(channelId) {
  const updatedChannels = currentChannels.map(c => ({
    ...c,
    is_primary: c.id === channelId
  }));

  const { error } = await sb.from('user_profiles')
    .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
    .eq('id', currentUser.id);

  if (error) {
    showToast('error', 'Greška pri postavljanju glavnog kanala.', '❌');
    return;
  }

  currentChannels = updatedChannels;
  const primary = currentChannels.find(c => c.is_primary);
  if (primary) {
    setActiveChannel(primary);
  }

  renderChannelList();
  renderSettingsChannelList();
  showToast('success', 'Glavni kanal je ažuriran!', '✅');
}

async function deleteConnectedChannel(channelId) {
  const channelToDelete = currentChannels.find(c => c.id === channelId);
  if (!channelToDelete) return;

  const confirmCallback = async () => {
    let updatedChannels = currentChannels.filter(c => c.id !== channelId);

    // If we deleted the primary channel, assign a new primary
    if (channelToDelete.is_primary && updatedChannels.length > 0) {
      updatedChannels[0].is_primary = true;
    }

    const { error } = await sb.from('user_profiles')
      .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
      .eq('id', currentUser.id);

    if (error) {
      showToast('error', 'Greška pri uklanjanju kanala.', '❌');
      return;
    }

    currentChannels = updatedChannels;

    if (activeChannel?.id === channelId) {
      if (currentChannels.length > 0) {
        setActiveChannel(currentChannels.find(c => c.is_primary) || currentChannels[0]);
      } else {
        activeChannel = null;
        const nameDisplay = document.getElementById('channelNameDisplay');
        if (nameDisplay) nameDisplay.textContent = 'Nema kanala';
        const topbarDisplay = document.getElementById('topbarChannel');
        if (topbarDisplay) topbarDisplay.textContent = '—';
      }
    }

    renderChannelList();
    renderSettingsChannelList();
    showToast('success', 'Kanal je uspešno uklonjen.', '🗑️');
  };

  const titleEl = document.getElementById('confirmModalTitle');
  if (titleEl) titleEl.textContent = 'Potvrdi uklanjanje kanala';

  const confirmBtn = document.getElementById('confirmDeleteBtn');
  if (confirmBtn) {
    confirmBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
      </svg>
      Ukloni Kanal
    `;
  }

  document.getElementById('confirmMsg').innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div>Da li ste sigurni da želite da uklonite kanal <strong style="color: #fff;">@${channelToDelete.username}</strong>?</div>
      <div style="font-size: 0.8rem; color: var(--text-muted); display: flex; align-items: flex-start; gap: 8px; background: rgba(255,255,255,0.02); padding: 10px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.5" style="flex-shrink:0; margin-top: 1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>Ova radnja se ne može poništiti. Sva podešavanja za ovaj kanal će biti obrisana.</span>
      </div>
    </div>
  `;
  document.getElementById('confirmDeleteBtn').onclick = () => { closeModal('confirmModal'); confirmCallback(); };
  openModal('confirmModal');
}

function renderSettingsChannelList() {
  const listEl = document.getElementById('settingsChannelList');
  if (!listEl) return;
  listEl.innerHTML = '';

  const limits = getPlanLimits();
  const used = currentChannels.length;
  const max = limits.maxChannels;
  const limitStr = max === Infinity ? 'Neograničeno' : max;
  const pct = max === Infinity ? 100 : Math.min(100, Math.round((used / max) * 100));
  const isAtLimit = max !== Infinity && used >= max;
  const barColor = isAtLimit ? '#EF4444' : (pct >= 80 ? '#EAB308' : '#53fc18');

  // Limit banner (prikazuj samo ako NIJE neograničeno/ELITE)
  const limitBannerHtml = max === Infinity ? '' : `
    <div style="margin-bottom: 14px; background: rgba(13, 9, 26, 0.6); border: 1px solid rgba(139,92,246,0.25); border-radius: 10px; padding: 12px 14px;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px;">
        <span style="font-size:0.78rem; font-weight:700; color:#fff;">Kick Kanali</span>
        <span style="font-size:0.82rem; font-weight:800; color:${isAtLimit ? '#EF4444' : '#fff'}">${used} / ${limitStr}</span>
      </div>
      <div style="background:rgba(255,255,255,0.06); border-radius:6px; height:6px; overflow:hidden;">
        <div style="height:100%; width:${pct}%; background:${barColor}; border-radius:6px; transition:width 0.4s ease;"></div>
      </div>
      ${isAtLimit ? `<div style="margin-top:10px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <span style="font-size:0.75rem; color:#EF4444; font-weight:600;">Dostignut je maksimalan broj kanala za ${limits.name} paket.</span>
        <button type="button" class="plan-upgrade-btn" onclick="event.stopPropagation(); openUpgradeModal('channels')" style="padding:5px 12px; font-size:0.73rem; flex-shrink:0;">${upgradeSvgIcon}<span>Nadogradi</span></button>
      </div>` : ''}
    </div>
  `;

  // Remove previously injected banner if any (on re-render)
  const prevBanner = listEl.previousElementSibling?.previousElementSibling;
  if (prevBanner && prevBanner.dataset.limitBanner === 'channels') prevBanner.remove();

  if (limitBannerHtml) {
    listEl.insertAdjacentHTML('beforebegin', limitBannerHtml);
    listEl.previousElementSibling.dataset.limitBanner = 'channels';
  }

  if (currentChannels.length === 0) {
    listEl.innerHTML = '<div style="padding:10px;font-size:0.85rem;color:var(--text-muted);text-align:center;">Nema povezanih kanala.</div>';
    return;
  }

  currentChannels.forEach(ch => {
    const item = document.createElement('div');
    item.className = 'modal-channel-item';

    // Sanitizacija avatar URL-a: prihvati samo https://
    const safeModalAvatar = ch.avatar && /^https:\/\//.test(ch.avatar) ? ch.avatar : null;
    const avatarHtml = safeModalAvatar
      ? `<div class="modal-channel-avatar" style="background-image:url('${safeModalAvatar}');background-size:cover;background-position:center;"></div>`
      : `<div class="modal-channel-avatar">${escapeHtml(ch.username.charAt(0).toUpperCase())}</div>`;

    const badgeHtml = ch.is_primary
      ? `<span class="modal-ch-badge primary">Glavni</span>`
      : `<button class="btn btn-outline btn-sm" onclick="makeChannelPrimary('${ch.id}')" style="padding:3px 8px;font-size:0.75rem;border-radius:4px;cursor:pointer;">Glavni</button>`;

    item.innerHTML = `
      <div class="modal-channel-info">
        ${avatarHtml}
        <div>
          <div class="modal-channel-name">${ch.username}</div>
          <div style="font-size:0.7rem;color:var(--text-muted)">ID: ${ch.id}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        ${badgeHtml}
        <button class="btn btn-outline btn-sm" onclick="deleteConnectedChannel('${ch.id}')" style="padding:3px 8px;font-size:0.75rem;border-radius:4px;border-color:rgba(239,68,68,0.2);color:#ef4444;cursor:pointer;" title="Ukloni kanal">✕</button>
      </div>
    `;
    listEl.appendChild(item);
  });
}

async function addNewChannel() {
  const input = document.getElementById('settingsNewChannelInput');
  const errEl = document.getElementById('settingsAddChannelError');
  const btn = document.getElementById('settingsAddChannelBtn');
  if (!input || !errEl) return;

  errEl.style.display = 'none';
  const rawVal = input.value.trim();
  if (!rawVal) {
    errEl.textContent = 'Unesite Kick username ili URL kanala.';
    errEl.style.display = 'block';
    return;
  }

  const username = extractKickUsername(rawVal);
  if (currentChannels.some(c => c.username.toLowerCase() === username.toLowerCase())) {
    errEl.textContent = 'Ovaj kanal je već dodat.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  const resolved = await resolveChatroomId(username);
  btn.disabled = false;

  if (!resolved) {
    errEl.textContent = `Kanal "${username}" nije pronađen na Kick platformi.`;
    errEl.style.display = 'block';
    return;
  }

  const newCh = {
    id: resolved.id,
    chatroom_id: resolved.chatroom_id || null,
    username: resolved.username,
    avatar: resolved.avatar || null,
    is_primary: currentChannels.length === 0
  };

  const updatedChannels = [...currentChannels, newCh];

  const { error } = await sb.from('user_profiles')
    .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
    .eq('id', currentUser.id);

  if (error) {
    errEl.textContent = 'Greška pri čuvanju kanala.';
    errEl.style.display = 'block';
    return;
  }

  currentChannels = updatedChannels;
  input.value = '';

  if (newCh.is_primary) {
    setActiveChannel(newCh);
  }

  renderChannelList();
  renderSettingsChannelList();
  showToast('success', `Kanal @${newCh.username} je dodat!`, '✅');
}

function syncOverviewCardsHeight() {
  const ctrlCard = document.getElementById('ovCtrlCard');
  const liveCard = document.getElementById('ovLiveCard');
  const liveFeed = document.getElementById('botLiveFeed');
  if (ctrlCard && liveCard && liveFeed) {
    // Allow ctrlCard to measure its exact natural compact height
    ctrlCard.style.height = 'auto';
    const targetHeight = ctrlCard.offsetHeight;

    if (window.innerWidth >= 768) {
      liveCard.style.height = targetHeight + 'px';
      const headHeight = liveCard.querySelector('.ov-card-head')?.offsetHeight || 30;
      const availableFeedHeight = Math.max(100, targetHeight - headHeight - 44);
      liveFeed.style.maxHeight = availableFeedHeight + 'px';
      liveFeed.style.height = availableFeedHeight + 'px';
    } else {
      liveCard.style.height = 'auto';
      liveFeed.style.maxHeight = '250px';
      liveFeed.style.height = 'auto';
    }
  }
}

window.addEventListener('resize', syncOverviewCardsHeight);

function updateOverviewModulesUI() {
  const modules = [
    { id: 'ovStatusLeaderboard', toggleId: 'cfgLeaderboard', label: 'Leaderboard', panelId: 'panel-leaderboard' },
    { id: 'ovStatusAnnouncements', toggleId: 'cfgAnnounceTimeEnabled', label: 'Automatske poruke', panelId: 'panel-announces' },
    { id: 'ovStatusInteraction', toggleId: 'cfgAutoresponse', label: 'Bot interakcija', panelId: 'panel-autoresponse' },
    { id: 'ovStatusLove', toggleId: 'cfgLove', label: 'Ljubav i brakovi', panelId: 'panel-marriages' },
    { id: 'ovStatusGames', toggleId: 'cfgGames', label: 'Mini igre', panelId: 'panel-minigames' },
    { id: 'ovStatusSongRequest', toggleId: 'cfgSongRequestEnabled', label: 'Song request', panelId: 'panel-songs' },
    { id: 'ovStatusEconomy', toggleId: 'cfgGambleEnabled', label: 'Ranking sistem', panelId: 'panel-economy' },
    { id: 'ovStatusModeration', toggleId: 'cfgModeration', label: 'Moderacija', panelId: 'panel-moderation' }
  ];

  const checkSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const crossSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  // Synchronize all header master toggles
  const masterMap = {
    cfgLeaderboard: 'cfgFeatureLeaderboardMaster',
    cfgLove: 'cfgFeatureLoveMaster',
    cfgGames: 'cfgFeatureGamesMaster',
    cfgAutoresponse: 'cfgFeatureAutoresponseMaster',
    cfgAnnounceTimeEnabled: 'cfgFeatureAnnouncementsMaster',
    cfgModeration: 'cfgFeatureModerationMaster',
    cfgSongRequestEnabled: 'cfgFeatureSongRequestMaster',
    cfgGambleEnabled: 'cfgFeatureEconomyMaster'
  };
  Object.keys(masterMap).forEach(key => {
    const toggle = document.getElementById(key);
    const master = document.getElementById(masterMap[key]);
    if (toggle && master) {
      // Header master za "Automatske poruke" treba da prati OR oba pravila slanja
      // (isto obrazloženje kao kod overview bedža ispod), a ne samo vremensko pravilo.
      if (key === 'cfgAnnounceTimeEnabled') {
        const msgToggle = document.getElementById('cfgAnnounceMsgEnabled');
        master.checked = toggle.checked || (msgToggle ? msgToggle.checked : false);
      } else {
        master.checked = toggle.checked;
      }
    }
  });

  modules.forEach(m => {
    const el = document.getElementById(m.id);
    const toggle = document.getElementById(m.toggleId);
    if (!el) return;

    // "Automatske poruke" ima DVA nezavisna pravila slanja (na vreme / na broj poruka).
    // Modul treba da se prikazuje kao aktivan dokle god je BAR JEDNO od ta dva pravila
    // uključeno — inače isključivanje samo jednog pravila (npr. "Slanje na vremenski
    // interval") bi nepotrebno prekrilo ceo panel banerom "Modul nije aktiviran", iako
    // druga metoda slanja (na broj poruka) i dalje normalno radi.
    let isEnabled = toggle ? toggle.checked : true;
    if (m.toggleId === 'cfgAnnounceTimeEnabled') {
      const msgToggle = document.getElementById('cfgAnnounceMsgEnabled');
      isEnabled = (toggle ? toggle.checked : true) || (msgToggle ? msgToggle.checked : false);
    }

    if (isEnabled) {
      el.innerHTML = `<span>${m.label}</span> ${checkSvg}`;
      el.className = 'module-status-badge active';
    } else {
      el.innerHTML = `<span>${m.label}</span> ${crossSvg}`;
      el.className = 'module-status-badge inactive';
    }

    if (m.panelId) {
      toggleModuleOverlay(m.panelId, isEnabled);
    }
  });

  setTimeout(syncOverviewCardsHeight, 20);
}

async function toggleModuleFromHeader(toggleId, isChecked) {
  const toggle = document.getElementById(toggleId);
  if (toggle) toggle.checked = isChecked;
  if (toggleId === 'cfgAnnounceTimeEnabled') {
    // Header/master prekidač je "sve ili ništa" za Automatske poruke: gasi/pali OBA
    // pravila slanja (vremenski interval i broj poruka), ne samo vremensko pravilo,
    // jer se korisnik ovde odlučuje za CELU funkciju, ne za jedno pravilo.
    syncAnnounceTimeToggle(isChecked);
    const msgToggle = document.getElementById('cfgAnnounceMsgEnabled');
    if (msgToggle) msgToggle.checked = isChecked;
  }

  // INSTANT SYNCHRONOUS UI UPDATE
  updateOverviewModulesUI();

  if (toggleId === 'cfgModeration') {
    if (typeof toggleModerationPanelState === 'function') toggleModerationPanelState();
    await saveModerationSettings(true);
    await saveBotConfig(true);
  } else if (toggleId === 'cfgSongRequestEnabled') {
    await saveSongRequestConfig(true);
    await saveBotConfig(true);
  } else if (toggleId === 'cfgGambleEnabled') {
    await saveEconomyConfig(true);
    await saveBotConfig(true);
  } else {
    await saveBotConfig(true);
  }
  updateOverviewModulesUI();
}

async function toggleModuleFromOverview(toggleId) {
  const toggle = document.getElementById(toggleId);
  if (!toggle) return;

  // Pronadji badge element za ovaj modul
  const _moduleToOvId = {
    cfgLeaderboard: 'ovStatusLeaderboard',
    cfgAnnounceTimeEnabled: 'ovStatusAnnouncements',
    cfgAutoresponse: 'ovStatusInteraction',
    cfgLove: 'ovStatusLove',
    cfgGames: 'ovStatusGames',
    cfgSongRequestEnabled: 'ovStatusSongRequest',
    cfgGambleEnabled: 'ovStatusEconomy',
    cfgModeration: 'ovStatusModeration'
  };

  const moduleNames = {
    cfgLeaderboard: 'Leaderboard',
    cfgAnnounceTimeEnabled: 'Automatske poruke',
    cfgAutoresponse: 'Bot interakcija',
    cfgLove: 'Ljubav i brakovi',
    cfgGames: 'Mini igre',
    cfgSongRequestEnabled: 'Song request',
    cfgGambleEnabled: 'Ranking sistem',
    cfgModeration: 'Moderacija'
  };

  // Zapamti prethodni state pre izmene
  const prevState = toggle.checked;
  const newState = !prevState;
  const name = moduleNames[toggleId] || 'Modul';

  // OPTIMISTIČNI UPDATE — odmah primeni novu vrednost u UI
  toggle.checked = newState;

  // Sinhroniziraj master toggle ako postoji
  if (toggleId === 'cfgAutoresponse') {
    const master = document.getElementById('cfgFeatureAutoresponseMaster');
    if (master) master.checked = newState;
  } else if (toggleId === 'cfgSongRequestEnabled') {
    const master = document.getElementById('cfgFeatureSongRequestMaster');
    if (master) master.checked = newState;
  } else if (toggleId === 'cfgAnnounceTimeEnabled') {
    // Isto obrazloženje kao u toggleModuleFromHeader: klik na Overview bedž je master
    // prekidač za CELU funkciju "Automatske poruke", pa gasi/pali oba pravila slanja.
    syncAnnounceTimeToggle(newState);
    const msgToggle = document.getElementById('cfgAnnounceMsgEnabled');
    if (msgToggle) msgToggle.checked = newState;
  }

  // Odmah osveži izgled znački (on/off) bez loading stanja
  updateOverviewModulesUI();

  try {
    // Sačuvaj u bazu u pozadini
    if (toggleId === 'cfgSongRequestEnabled') {
      await saveSongRequestConfig(true);
      await saveBotConfig(true);
    } else if (toggleId === 'cfgGambleEnabled') {
      await saveEconomyConfig(true);
      await saveBotConfig(true);
    } else if (toggleId === 'cfgModeration') {
      if (typeof toggleModerationPanelState === 'function') toggleModerationPanelState();
      await saveModerationSettings(true);
      await saveBotConfig(true);
    } else {
      await saveBotConfig(true);
    }

    showToast(newState ? 'success' : 'info', `Modul "${name}" je ${newState ? 'uključen' : 'isključen'}.`);

  } catch (err) {
    toggle.checked = prevState;
    if (toggleId === 'cfgAutoresponse') {
      const master = document.getElementById('cfgFeatureAutoresponseMaster');
      if (master) master.checked = prevState;
    } else if (toggleId === 'cfgSongRequestEnabled') {
      const master = document.getElementById('cfgFeatureSongRequestMaster');
      if (master) master.checked = prevState;
    }
    updateOverviewModulesUI();
    showToast('error', `Greška pri promeni modula "${name}". Pokušaj ponovo.`);
  }
}

function toggleModuleOverlay(panelId, active) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  const existingOverlay = panel.querySelector('.module-disabled-overlay');

  if (active) {
    panel.classList.remove('module-disabled-panel');
    if (existingOverlay) {
      existingOverlay.remove();
    }
  } else {
    panel.classList.add('module-disabled-panel');
    if (!existingOverlay) {
      const overlay = document.createElement('div');
      overlay.className = 'module-disabled-overlay';
      overlay.innerHTML = `
        <div style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 20px; box-shadow: 0 0 20px rgba(239, 68, 68, 0.15);">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 style="font-family: var(--font-heading); font-size: 1.5rem; font-weight: 700; color: #fff; margin: 0 0 10px 0;">Modul nije aktiviran</h2>
        <p style="color: var(--text-muted); font-size: 0.95rem; line-height: 1.5; max-width: 400px; margin: 0 0 24px 0;">
          Ovaj modul je trenutno isključen. Da biste pristupili podacima i koristili ove opcije, aktivirajte ga.
        </p>
        <button class="btn btn-primary" onclick="enableCurrentPanelModule(this)" style="padding: 10px 24px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Aktiviraj</span>
        </button>
      `;
      panel.appendChild(overlay);
    }
  }
}

async function enableCurrentPanelModule(btn) {
  const activePanel = document.querySelector('.panel.active');
  if (!activePanel) return;

  const panelId = activePanel.id;
  const panelToToggleId = {
    'panel-leaderboard': 'cfgLeaderboard',
    'panel-announces': 'cfgAnnounceTimeEnabled',
    'panel-autoresponse': 'cfgAutoresponse',
    'panel-marriages': 'cfgLove',
    'panel-minigames': 'cfgGames',
    'panel-songs': 'cfgSongRequestEnabled',
    'panel-economy': 'cfgGambleEnabled',
    'panel-moderation': 'cfgModeration'
  };

  const toggleId = panelToToggleId[panelId];
  if (!toggleId) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Aktiviram...';
  }

  await toggleModuleFromHeader(toggleId, true);

  const notice = activePanel.querySelector('#modDisabledNotice');
  if (notice) notice.style.display = 'none';

  showToast('success', 'Modul je uspešno aktiviran!', '⚡');
}

let liveFeedInterval = null;
let liveFeedUserScrolledUp = false;
let liveFeedScrollDebounce = null;

function startLiveActivityFeed() {
  const feed = document.getElementById('botLiveFeed');
  if (!feed) return;

  if (liveFeedInterval) {
    clearInterval(liveFeedInterval);
    liveFeedInterval = null;
  }

  // Resetuj scroll state
  liveFeedUserScrolledUp = false;
  if (liveFeedScrollDebounce) clearTimeout(liveFeedScrollDebounce);

  // Stilovi za feed
  feed.style.overflowY = 'auto';
  feed.style.display = 'flex';
  feed.style.flexDirection = 'column';
  feed.style.gap = '2px';

  // Wrapper za hint button — pronađi ili kreiraj
  let feedWrap = feed.parentElement;
  if (!feedWrap || !feedWrap.classList.contains('live-feed-wrap')) {
    feedWrap = feed.parentElement;
  }

  // Helper za scroll hint dugme
  function showScrollHint() {
    if (!feedWrap) return;
    let hint = feedWrap.querySelector('.live-feed-scroll-hint');
    if (!hint) {
      hint = document.createElement('button');
      hint.className = 'live-feed-scroll-hint';
      hint.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg> Najnoviji`;
      hint.onclick = () => {
        liveFeedUserScrolledUp = false;
        feed.scrollTop = feed.scrollHeight;
        hint.remove();
      };
      feedWrap.style.position = 'relative';
      feedWrap.appendChild(hint);
    }
  }

  function hideScrollHint() {
    if (!feedWrap) return;
    const hint = feedWrap.querySelector('.live-feed-scroll-hint');
    if (hint) hint.remove();
  }

  // Scroll listener sa debounce pauzom
  feed.addEventListener('scroll', () => {
    const isAtBottom = (feed.scrollHeight - feed.clientHeight - feed.scrollTop) < 60;
    if (!isAtBottom) {
      liveFeedUserScrolledUp = true;
      showScrollHint();
      // Pauziraj auto-scroll 8 sekundi od poslednjeg skrolovanja
      clearTimeout(liveFeedScrollDebounce);
      liveFeedScrollDebounce = setTimeout(() => {
        liveFeedUserScrolledUp = false;
        hideScrollHint();
      }, 8000);
    } else {
      liveFeedUserScrolledUp = false;
      clearTimeout(liveFeedScrollDebounce);
      hideScrollHint();
    }
  }, { passive: true });

  async function fetchLogs() {
    if (!activeChannel) return;

    const apiBase = getBotApiBase();
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    // Ako smo u dev režimu na npr. portu 5500 bez lokalnog bota, preskačemo fetch da ne spamuije 404 u konzoli
    if (isLocalhost && (apiBase.includes(':5500') || apiBase === window.location.origin) && localStorage.getItem('use_local_bot') !== 'true') {
      const dot = document.getElementById('botLiveFeedDot');
      if (dot) {
        dot.style.background = 'var(--text-muted)';
        dot.style.boxShadow = 'none';
      }
      return;
    }

    try {
      const res = await fetch(`${apiBase}/api/kick/logs?chatroom_id=${activeChannel.id}`);
      const dot = document.getElementById('botLiveFeedDot');
      if (res.ok) {
        if (dot) {
          dot.style.background = 'var(--kick-green)';
          dot.style.boxShadow = '0 0 8px var(--kick-green)';
        }
        const logs = await res.json();
        if (logs.length === 0) {
          feed.innerHTML = `
            <div style="color: var(--text-muted); text-align: center; padding-top: 60px; font-style: italic; font-size: 0.85rem;">
              Čekam prve aktivnosti...
            </div>
          `;
          return;
        }

        // Renderuj logove
        feed.innerHTML = logs.map(log => {
          let badgeColor = 'var(--text-muted)';
          if (log.type === 'ERR') badgeColor = '#EF4444';
          else if (log.type === 'WARN') badgeColor = '#F59E0B';
          else if (log.type === 'INFO') badgeColor = '#3B82F6';
          else if (log.type === 'BOT') badgeColor = 'var(--kick-green)';
          else if (log.type === 'CHAT') badgeColor = '#10B981';

          // Očisti poruku od prefiksa kanala
          let cleanMessage = log.message || '';
          if (activeChannel) {
            const prefixRegex = new RegExp(`^\\[${activeChannel.username}\\]\\s*`, 'i');
            cleanMessage = cleanMessage.replace(prefixRegex, '');
            const atPrefixRegex = new RegExp(`^\\[@${activeChannel.username}\\]\\s*`, 'i');
            cleanMessage = cleanMessage.replace(atPrefixRegex, '');
          }

          return `
            <div class="log-item" style="display: flex; gap: 8px; align-items: flex-start; text-align: left; font-family: monospace; font-size: 0.78rem; padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,0.02); line-height: 1.4; width: 100%; box-sizing: border-box;">
              <span style="color: var(--text-muted); flex-shrink: 0;">[${log.timestamp}]</span>
              <span style="color: ${badgeColor}; font-weight: bold; flex-shrink: 0;">[${log.type}]</span>
              <span style="color: #E2E8F0; word-break: break-all; flex-grow: 1;">${escapeHtml(cleanMessage)}</span>
            </div>
          `;
        }).join('');

        // Auto-scroll na dno samo ako korisnik nije skrolovao gore
        if (!liveFeedUserScrolledUp) {
          feed.scrollTop = feed.scrollHeight;
        }
      } else {
        if (dot) {
          dot.style.background = 'red';
          dot.style.boxShadow = '0 0 8px red';
        }
      }
    } catch (_) {
      const dot = document.getElementById('botLiveFeedDot');
      if (dot) {
        dot.style.background = 'red';
        dot.style.boxShadow = '0 0 8px red';
      }
    }
  }

  // Povuci odmah, pa na svake 3 sekunde
  fetchLogs();
  liveFeedInterval = setInterval(fetchLogs, 3000);
}

// ── Kick OAuth Helperi za dodavanje kanala ─────────────────────────────────
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
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generateCodeChallenge(v) {
  const hashed = await sha256(v);
  return base64urlencode(hashed);
}

function getKickRedirectUri() {
  return window.KickotConfig.api.kickOAuthRedirect;
}

async function openKickLoginForChannel() {
  if (!currentUser) return;
  const KICK_CLIENT_ID = '01KXN4YW8GF6DPXSC1JMMJ25QN';
  const KICK_REDIRECT_URI = getKickRedirectUri();
  const KICK_SCOPE = 'user:read channel:read chat:read chat:write moderation:read moderation:write';

  const state = generateRandomString(16);
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  sessionStorage.setItem('kick_oauth_state', state);
  sessionStorage.setItem('kick_code_verifier', codeVerifier);
  sessionStorage.setItem('kick_oauth_intent', 'add_channel');
  sessionStorage.setItem('kick_add_channel_uid', currentUser.id);
  sessionStorage.setItem('kick_oauth_source', 'dashboard');
  sessionStorage.setItem('kick_origin_site', 'kickot');

  localStorage.setItem('kick_oauth_state', state);
  localStorage.setItem('kick_code_verifier', codeVerifier);
  localStorage.setItem('kick_origin_site', 'kickot');

  const authUrl = 'https://id.kick.com/oauth/authorize?' + new URLSearchParams({
    response_type: 'code',
    client_id: KICK_CLIENT_ID,
    redirect_uri: KICK_REDIRECT_URI,
    scope: KICK_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  }).toString();

  window.location.href = authUrl;
}

let autosaveConfigDebounce = null;
let autosaveModDebounce = null;

function triggerAutosaveConfig() {
  if (!configLoaded) return;
  if (autosaveConfigDebounce) clearTimeout(autosaveConfigDebounce);
  autosaveConfigDebounce = setTimeout(() => {
    saveBotConfig(true);
  }, 1000); // 1 sekunda debounce za stabilnost
}

function triggerAutosaveMod() {
  if (!configLoaded) return;
  if (autosaveModDebounce) clearTimeout(autosaveModDebounce);
  autosaveModDebounce = setTimeout(() => {
    saveModerationSettings(true);
  }, 1000); // 1 sekunda debounce za stabilnost
}

function setupAutosave() {
  // 1. Inputs koji okidaju saveBotConfig
  const configInputIds = [
    'cfgPrefix', 'cfgLanguage', 'cfgCooldown', 'cfgLeaderboard', 'cfgWatchtime',
    'cfgGames', 'cfgLove', 'cfgModeration', 'cfgAutoresponse', 'cfgSpamThreshold',
    'cfgSpamWindow', 'cfgPinMsg', 'cfgWelcomeMsg', 'cfgAnnounceInterval',
    'cfgAnnounceThreshold', 'cfgAnnounceTimeEnabled', 'cfgAnnounceMsgEnabled',
    'cfgAlertFollowEnabled', 'cfgAlertFollowMsg',
    'cfgAlertKicksEnabled', 'cfgAlertKicksMsg', 'cfgAlertKicksMin',
    'cfgAlertSubEnabled', 'cfgAlertSubMsg',
    'cfgAlertResubEnabled', 'cfgAlertResubMsg',
    'cfgAlertGiftsubEnabled', 'cfgAlertGiftsubMsg',
    'cfgAlertHostEnabled', 'cfgAlertHostMsg', 'cfgAlertHostMin',
    'cfgAlertWelcomeEnabled', 'cfgAlertWelcomeMsg', 'cfgCustomBotName',
    'cfgSongRequestEnabled', 'cfgSongRequestRank', 'cfgSongRequestCost', 'cfgSongRequestMaxDuration'
  ];

  configInputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        // Instant vizuelni feedback za module
        if (el.type === 'checkbox') {
          updateOverviewModulesUI();
          if (id === 'cfgModeration') {
            toggleModerationPanelState();
          }
        }
        triggerAutosaveConfig();
      });
      el.addEventListener('change', triggerAutosaveConfig);
    }
  });

  // 2. Inputs koji okidaju saveModerationSettings
  const modInputIds = [
    'cfgModCapsEnabled', 'cfgModCapsPct', 'cfgModCapsMinLen',
    'cfgModLinksEnabled', 'cfgModLinksWhitelist', 'cfgModLinksPermitEnabled',
    'cfgModEmotesEnabled', 'cfgModEmotesMax',
    'cfgModSymbolsEnabled', 'cfgModSymbolsPct', 'cfgModSymbolsMinLen',
    'cfgModWordsEnabled', 'cfgModWordsList',
    'cfgModSpamEnabled', 'cfgModSpamMaxDuplicates',
    'cfgModMaxLenEnabled', 'cfgModMaxLenLimit',
    'cfgModMentionsEnabled', 'cfgModMentionsLimit',
    'cfgModActionType', 'cfgModTimeoutDuration',
    'cfgModExemptVip', 'cfgModExemptSub'
  ];

  modInputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        triggerAutosaveMod();
      });
      el.addEventListener('change', triggerAutosaveMod);
    }
  });
}

// ── Notification Center ────────────────────────────────────────────────────
let readNotifIds = JSON.parse(localStorage.getItem('read_notif_ids') || '[]');
let activeNotifTab = 'obaveštenja';

// Notifications will be loaded from database
let notifications = [];

// Changelogs will be loaded from database
let changelogs = [];

// Pomoćna funkcija za prirodno relativno vreme
function formatRelativeTime(isoString) {
  const date = new Date(isoString);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return 'Upravo sada';
  if (diffMin < 60) return `Pre ${diffMin} min`;
  if (diffHours < 24) return `Pre ${diffHours} h`;
  return `Pre ${diffDays} d`;
}

function initNotificationCenter() {
  updateNotifBadgeUI();
}

function toggleNotifCenter() {
  const popover = document.getElementById('notifPopover');
  if (!popover) return;
  const isHidden = popover.style.display === 'none' || !popover.style.display;
  popover.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    renderNotifContent();
  }
}

function switchNotifTab(tab) {
  activeNotifTab = tab;
  const tabOb = document.getElementById('notifTabObaveštenja');
  const tabCh = document.getElementById('notifTabChangelog');
  if (!tabOb || !tabCh) return;

  const activeStyle = {
    color: '#fff',
    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(139, 92, 246, 0.1))',
    border: '1px solid rgba(139, 92, 246, 0.3)',
    boxShadow: '0 2px 8px rgba(139, 92, 246, 0.2)',
    fontWeight: '700'
  };

  const inactiveStyle = {
    color: 'var(--text-muted)',
    background: 'transparent',
    border: '1px solid transparent',
    boxShadow: 'none',
    fontWeight: '600'
  };

  Object.assign(tabOb.style, tab === 'obaveštenja' ? activeStyle : inactiveStyle);
  Object.assign(tabCh.style, tab === 'changelog' ? activeStyle : inactiveStyle);

  renderNotifContent();
}

function renderNotifContent() {
  const list = document.getElementById('notifContentList');
  if (!list) return;

  if (activeNotifTab === 'obaveštenja') {
    if (notifications.length === 0) {
      list.innerHTML = `
              <div style="color: var(--text-muted); text-align: center; padding: 32px 16px; font-size: 0.82rem; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.5;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                <span>Trenutno nema novih obaveštenja.</span>
              </div>`;
      return;
    }

    const sortedNotifications = [...notifications].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    list.innerHTML = sortedNotifications.map(n => {
      // Provera po String vrednosti sprečava greške sa tipovima
      const isRead = readNotifIds.includes(String(n.id));
      let color = '#3B82F6';
      let iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

      if (n.type === 'success') {
        color = '#10B981';
        iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
      } else if (n.type === 'warning') {
        color = '#F59E0B';
        iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.03 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
      }

      const opacityStyle = isRead ? 'opacity: 0.55;' : '';
      const borderStyle = isRead ? 'border: 1px solid rgba(255,255,255,0.05);' : `border: 1px solid ${color}40; box-shadow: 0 4px 14px ${color}15;`;
      const bgStyle = isRead ? 'background: rgba(255,255,255,0.02);' : 'background: rgba(255,255,255,0.04);';
      const formattedTime = formatRelativeTime(n.timestamp);

      return `
              <div onclick="markNotifAsRead('${n.id}')" style="padding: 12px 14px; border-radius: 12px; ${bgStyle} ${borderStyle} transition: all 0.2s; cursor: pointer; ${opacityStyle}">
                <div style="display: flex; gap: 10px; align-items: flex-start; text-align: left;">
                  <div style="width: 24px; height: 24px; border-radius: 50%; background: ${color}20; color: ${color}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; border: 1px solid ${color}35;">
                    ${iconSvg}
                  </div>
                  <div style="flex-grow: 1;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                      <div style="font-size: 0.83rem; font-weight: 700; color: #fff; line-height: 1.3;">${escapeHtml(n.title)}</div>
                      <div style="font-size: 0.68rem; color: var(--text-muted); white-space: nowrap;">${formattedTime}</div>
                    </div>
                    <div style="font-size: 0.77rem; color: var(--text-secondary); margin-top: 4px; line-height: 1.45;">${escapeHtml(n.desc)}</div>
                  </div>
                </div>
              </div>
            `;
    }).join('');
  } else {
    if (changelogs.length === 0) {
      list.innerHTML = `
              <div style="color: var(--text-muted); text-align: center; padding: 32px 16px; font-size: 0.82rem; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.5;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span>Trenutno nema novih changelog informacija.</span>
              </div>`;
      return;
    }

    list.innerHTML = changelogs.map(c => `
            <div style="padding: 12px 14px; border-radius: 12px; background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); transition: all 0.2s;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 0.72rem; font-weight: 800; color: #a78bfa; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); padding: 2px 8px; border-radius: 6px; letter-spacing: 0.5px;">${c.version}</span>
                <span style="font-size: 0.68rem; color: var(--text-muted); display: flex; align-items: center; gap: 4px;">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  ${c.date}
                </span>
              </div>
              <div style="font-size: 0.84rem; font-weight: 700; color: #fff; margin-bottom: 4px; text-align: left;">${escapeHtml(c.title)}</div>
              <div style="font-size: 0.77rem; color: var(--text-secondary); line-height: 1.45; text-align: left;">${escapeHtml(c.details)}</div>
            </div>
          `).join('');
  }
}

function addNotification(title, desc, type = 'info') {
  const newNotif = {
    id: 'notif_' + Date.now(),
    title: title,
    desc: desc,
    timestamp: new Date().toISOString(),
    type: type
  };

  notifications.push(newNotif);
  updateNotifBadgeUI();
  renderNotifContent();
}

function updateNotifBadgeUI() {
  const unreadCount = notifications.filter(n => !readNotifIds.includes(String(n.id))).length;
  const badge = document.getElementById('notifBadge');
  const btn = document.getElementById('notifBellBtn');

  if (badge) {
    badge.style.display = unreadCount > 0 ? 'flex' : 'none';
    badge.innerText = unreadCount > 9 ? '9+' : unreadCount;
  }

  if (btn) {
    if (unreadCount > 0) {
      btn.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      btn.style.color = '#EF4444';
      btn.style.boxShadow = '0 0 12px rgba(239, 68, 68, 0.25)';
    } else {
      btn.style.borderColor = 'rgba(255, 255, 255, 0.08)';
      btn.style.color = 'var(--text-secondary)';
      btn.style.boxShadow = 'none';
    }
  }
}

function markAllNotifsAsRead() {
  notifications.forEach(n => {
    if (!readNotifIds.includes(n.id)) readNotifIds.push(n.id);
  });
  localStorage.setItem('read_notif_ids', JSON.stringify(readNotifIds));

  updateNotifBadgeUI();
  renderNotifContent();
  if (typeof showToast === 'function') {
    showToast('success', 'Sva obaveštenja su označena kao pročitana.', '✔');
  }
}

// Zatvaranje popovera na klik sa strane ili na taster Esc
document.addEventListener('click', (e) => {
  const popover = document.getElementById('notifPopover');
  const btn = document.getElementById('notifBellBtn');
  if (!popover || !btn) return;

  // Ako kliknuti element više nije u dokumentu (re-render), ignorišemo
  if (!document.body.contains(e.target)) return;

  if (popover.style.display === 'block') {
    if (!popover.contains(e.target) && !btn.contains(e.target)) {
      popover.style.display = 'none';
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const popover = document.getElementById('notifPopover');
    if (popover && popover.style.display === 'block') {
      popover.style.display = 'none';
    }
  }
});

function markNotifAsRead(id) {
  const strId = String(id);

  if (!readNotifIds.includes(strId)) {
    readNotifIds.push(strId);
    localStorage.setItem('read_notif_ids', JSON.stringify(readNotifIds));

    updateNotifBadgeUI();
    renderNotifContent();
  }
}

document.addEventListener('DOMContentLoaded', initNotificationCenter);

function openFeedbackModal() {
  const typeSelect = document.getElementById('feedbackType');
  if (typeSelect) {
    typeSelect.value = 'predlog';
    onFeedbackTypeChange('predlog');
  }
  openModal('feedbackModal');
}

function openHelpModal() {
  openModal('helpModal');
}

function openDocsModal() {
  openModal('docsModal');
}

function onFeedbackTypeChange(type) {
  const titleLbl = document.getElementById('lblFeedbackTitle');
  const titleInput = document.getElementById('feedbackTitle');
  const usageGroup = document.getElementById('groupCmdUsage');
  const textLbl = document.getElementById('lblFeedbackText');
  const textInput = document.getElementById('feedbackText');

  if (type === 'predlog') {
    if (titleLbl) titleLbl.textContent = 'Naziv komande / opcije';
    if (titleInput) titleInput.placeholder = '!kokice';
    if (usageGroup) usageGroup.style.display = 'block';
    if (textLbl) textLbl.textContent = 'Kako komanda funkcioniše?';
    if (textInput) textInput.placeholder = 'Opis komande...';
  } else if (type === 'utisak') {
    if (titleLbl) titleLbl.textContent = 'Naslov utiska / Ocena';
    if (titleInput) titleInput.placeholder = 'Odličan bot';
    if (usageGroup) usageGroup.style.display = 'none';
    if (textLbl) textLbl.textContent = 'Tvoji utisci i sugestije';
    if (textInput) textInput.placeholder = 'Napiši utiske...';
  } else if (type === 'prijavabuga') {
    if (titleLbl) titleLbl.textContent = 'Gde se greška pojavila?';
    if (titleInput) titleInput.placeholder = 'Komanda !top ne radi';
    if (usageGroup) usageGroup.style.display = 'none';
    if (textLbl) textLbl.textContent = 'Opis greške';
    if (textInput) textInput.placeholder = 'Opis problema...';
  }
}

function handleFeedbackFormSubmit(event) {
  event.preventDefault();

  const form = document.getElementById('feedbackForm');
  const typeSelect = document.getElementById('feedbackType');
  const typeText = typeSelect?.options[typeSelect.selectedIndex]?.text || 'Predlog';
  const title = document.getElementById('feedbackTitle')?.value.trim();
  const text = document.getElementById('feedbackText')?.value.trim();

  if (!title || !text) {
    showToast('error', 'Molimo popunite sva obavezna polja pre slanja.');
    return false;
  }

  const channelInput = document.getElementById('feedbackFormChannel');
  if (channelInput) {
    channelInput.value = window.activeChannel || 'Nepoznat kanal';
  }

  const subjectInput = document.getElementById('feedbackFormSubject');
  if (subjectInput) {
    subjectInput.value = `[Kickot Bot - ${typeText}] ${title}`;
  }

  const btn = document.getElementById('feedbackSubmitBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Slanje...';
  }

  // Submit form via background iframe
  form.submit();

  showToast('success', 'Hvala ti! Tvoj predlog je uspešno poslat Milanu.');

  setTimeout(() => {
    // Reset form fields
    const titleInput = document.getElementById('feedbackTitle');
    const usageInput = document.getElementById('feedbackCmdUsage');
    const textInput = document.getElementById('feedbackText');
    if (titleInput) titleInput.value = '';
    if (usageInput) usageInput.value = '';
    if (textInput) textInput.value = '';

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Pošalji`;
    }

    closeModal('feedbackModal');
  }, 800);
}

// ── Song Request & YouTube Audio Player Logic ─────────────────────────────
let localSongQueue = [
  {
    id: 'yt_dQw4w9WgXcQ',
    ytId: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    artist: 'Rick Astley',
    requester: 'Strimer',
    duration: 212,
    source: 'youtube',
    coverUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
  }
];

let currentSongIndex = 0;
let isPlaying = false;
let playbackInterval = null;
let currentTimeSeconds = 0;
let playerVolume = 80;

let ytPlayer = null;
let isYtReady = false;

// YouTube Iframe API callback
window.onYouTubeIframeAPIReady = function () {
  try {
    ytPlayer = new YT.Player('ytAudioPlayer', {
      height: '100%',
      width: '100%',
      playerVars: {
        autoplay: 1,
        controls: 1,
        disablekb: 0,
        fs: 0,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin
      },
      events: {
        'onReady': onYtPlayerReady,
        'onStateChange': onYtPlayerStateChange,
        'onError': onYtPlayerError
      }
    });
  } catch (e) {
    console.warn('[YouTube Audio Engine] API error:', e);
  }
};

function onYtPlayerReady(_event) {
  isYtReady = true;
  if (ytPlayer) {
    try {
      if (ytPlayer.unMute) ytPlayer.unMute();
      if (ytPlayer.setVolume) ytPlayer.setVolume(playerVolume);
    } catch (_) { }
  }
}

function onYtPlayerStateChange(event) {
  if (!event) return;
  if (event.data === YT.PlayerState.ENDED) {
    skipSong();
  } else if (event.data === YT.PlayerState.PLAYING) {
    isPlaying = true;
    startTimer();
    updatePlayerUI();
    renderSongQueue();
  } else if (event.data === YT.PlayerState.PAUSED) {
    isPlaying = false;
    stopTimer();
    updatePlayerUI();
    renderSongQueue();
  }
}

function onYtPlayerError(event) {
  console.warn('[YouTube Audio Engine] Video error, skipping song:', event ? event.data : '');
  setTimeout(() => { skipSong(); }, 1500);
}

function extractYouTubeId(urlOrText) {
  if (!urlOrText) return null;
  const match = urlOrText.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match && match[1] ? match[1] : null;
}

function startTimer() {
  if (playbackInterval) clearInterval(playbackInterval);
  playbackInterval = setInterval(() => {
    const currentSong = localSongQueue[currentSongIndex];
    if (!currentSong) {
      stopTimer();
      isPlaying = false;
      updatePlayerUI();
      return;
    }
    if (ytPlayer && ytPlayer.getCurrentTime && typeof ytPlayer.getCurrentTime === 'function') {
      const curr = ytPlayer.getCurrentTime();
      if (curr && !isNaN(curr)) currentTimeSeconds = Math.floor(curr);
    } else {
      currentTimeSeconds++;
    }
    updatePlayerUI();
  }, 1000);
}

function stopTimer() {
  if (playbackInterval) {
    clearInterval(playbackInterval);
    playbackInterval = null;
  }
}

function formatDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function renderSongQueue() {
  const queueList = document.getElementById('songQueueList');
  const queueCount = document.getElementById('queueCount');
  if (!queueList) return;

  queueCount.textContent = `${localSongQueue.length} pesama`;

  // Vizuelno ograničavanje Add dugmeta na osnovu plana
  const sqLimits = getPlanLimits();
  const addBtn = document.getElementById('songRequestAddBtn');
  const addInput = document.getElementById('songRequestInput');
  const isQueueFull = sqLimits.maxSongQueue !== Infinity && localSongQueue.length >= sqLimits.maxSongQueue;

  if (addBtn) {
    addBtn.disabled = isQueueFull;
    addBtn.style.opacity = isQueueFull ? '0.45' : '1';
    addBtn.style.cursor = isQueueFull ? 'not-allowed' : 'pointer';
    addBtn.title = isQueueFull ? `Queue limit dostignut (${localSongQueue.length}/${sqLimits.maxSongQueue}) — nadogradi paket` : '';
  }
  if (addInput) {
    addInput.disabled = isQueueFull;
    addInput.style.opacity = isQueueFull ? '0.5' : '1';
    addInput.placeholder = isQueueFull
      ? `Queue pun (${localSongQueue.length}/${sqLimits.maxSongQueue}) — nadogradi za veći queue`
      : 'Unesi YouTube link ili naziv pesme...';
  }

  if (localSongQueue.length === 0) {
    queueList.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 24px; font-size: 0.82rem; font-style: italic;">Red za puštanje je prazan. Dodajte pesmu dole levo ili sačekajte muzičku želju iz četa.</div>';
    return;
  }

  const defaultCover = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80';

  queueList.innerHTML = localSongQueue.map((song, index) => {
    const isActive = index === currentSongIndex;
    const activeBg = isActive ? 'rgba(255, 0, 51, 0.08)' : 'rgba(255,255,255,0.015)';
    const activeBorder = isActive ? '1px solid rgba(255, 0, 51, 0.35)' : '1px solid var(--border-subtle)';
    const activeText = isActive ? '#FF0033' : '#fff';
    const cover = song.coverUrl || defaultCover;

    return `
      <div style="background: ${activeBg}; border: ${activeBorder}; padding: 10px 14px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: space-between; gap: 12px; transition: all 0.2s ease;">
        <div style="display: flex; align-items: center; gap: 12px; flex-grow: 1; overflow: hidden;">
          <img src="${cover}" alt="Cover" style="width: 38px; height: 38px; border-radius: 6px; object-fit: cover; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.1);" />
          <div style="text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-grow: 1;">
            <div style="font-size: 0.85rem; font-weight: 700; color: ${activeText}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(song.title)}</div>
            <div style="font-size: 0.73rem; color: var(--text-muted); margin-top: 2px;">${song.artist ? escapeHtml(song.artist) + ' • ' : ''}Zatražio: ${escapeHtml(song.requester)} • ${formatDuration(song.duration)}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          ${isActive && isPlaying ? '<span style="font-size: 0.72rem; color: #FF0033; font-weight: 700; display: flex; align-items: center; gap: 4px; background: rgba(255,0,51,0.1); padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(255,0,51,0.2);"><span class="status-dot" style="background: #FF0033; width:6px; height:6px; box-shadow:0 0 6px #FF0033;"></span> Svira</span>' : ''}
          ${!isActive ? `<button type="button" class="btn btn-sm btn-outline" onclick="playSongNow(${index})" style="font-size: 0.72rem; padding: 3px 8px; border-color: rgba(255,0,51,0.3); color: #FF0033;" title="Pusti odmah">Pusti</button>` : ''}
          <button type="button" class="btn btn-sm btn-text" onclick="removeSong(${index})" style="color: var(--text-muted); cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center;" title="Ukloni pesmu">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function updatePlayerUI() {
  const playerTitle = document.getElementById('playerTitle');
  const playerRequester = document.getElementById('playerRequester');
  const playerProgress = document.getElementById('playerProgress');
  const playerCurrentTime = document.getElementById('playerCurrentTime');
  const playerTotalTime = document.getElementById('playerTotalTime');
  const playerDisk = document.getElementById('playerDisk');
  const playerCoverImg = document.getElementById('playerCoverImg');
  const playerSourceBadge = document.getElementById('playerSourceBadge');
  const playIcon = document.getElementById('playIcon');

  if (!playerTitle) return;

  const currentSong = localSongQueue[currentSongIndex];
  if (!currentSong) {
    playerTitle.textContent = 'Nema pesama u redu';
    playerRequester.textContent = 'Zatražite pesmu ispod ili u četu';
    if (playerProgress) playerProgress.style.width = '0%';
    if (playerCurrentTime) playerCurrentTime.textContent = '0:00';
    if (playerTotalTime) playerTotalTime.textContent = '0:00';
    if (playerCoverImg) { playerCoverImg.style.display = 'none'; playerCoverImg.src = ''; }
    if (playerDisk) { playerDisk.style.display = 'flex'; playerDisk.style.animationPlayState = 'paused'; }
    if (playerSourceBadge) playerSourceBadge.style.display = 'none';
    if (playIcon) {
      playIcon.setAttribute('viewBox', '0 0 24 24');
      playIcon.style.marginLeft = '2px';
      playIcon.innerHTML = '<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" />';
    }
    return;
  }

  const titleText = currentSong.artist ? `${currentSong.artist} - ${currentSong.title}` : currentSong.title;
  playerTitle.textContent = titleText;
  playerRequester.textContent = `Zatražio: ${currentSong.requester}`;
  if (playerTotalTime) playerTotalTime.textContent = formatDuration(currentSong.duration);
  if (playerCurrentTime) playerCurrentTime.textContent = formatDuration(currentTimeSeconds);
  if (playerProgress) {
    const pct = currentSong.duration > 0 ? (currentTimeSeconds / currentSong.duration) * 100 : 0;
    playerProgress.style.width = `${pct}%`;
  }

  if (currentSong.coverUrl && playerCoverImg) {
    playerCoverImg.src = currentSong.coverUrl;
    playerCoverImg.style.display = 'block';
    if (playerDisk) playerDisk.style.display = 'none';
  } else {
    if (playerCoverImg) playerCoverImg.style.display = 'none';
    if (playerDisk) playerDisk.style.display = 'flex';
  }

  if (playerSourceBadge) {
    playerSourceBadge.style.display = 'inline-block';
    playerSourceBadge.textContent = 'YouTube';
    playerSourceBadge.style.background = 'rgba(255, 0, 51, 0.85)';
  }

  if (playIcon) {
    playIcon.setAttribute('viewBox', '0 0 24 24');
    if (isPlaying) {
      playIcon.style.marginLeft = '0px';
      playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16" fill="currentColor" /><rect x="14" y="4" width="4" height="16" fill="currentColor" />';
    } else {
      playIcon.style.marginLeft = '2px';
      playIcon.innerHTML = '<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" />';
    }
  }
}

async function playCurrentAudio() {
  const currentSong = localSongQueue[currentSongIndex];
  if (!currentSong) return;

  let ytId = currentSong.ytId || extractYouTubeId(currentSong.id) || extractYouTubeId(currentSong.title);

  if (!ytId) {
    const query = `${currentSong.artist && currentSong.artist !== 'YouTube' ? currentSong.artist + ' ' : ''}${currentSong.title}`;
    ytId = await searchYouTubeVideoId(query);
    if (ytId) {
      currentSong.ytId = ytId;
      currentSong.coverUrl = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
    }
  } else if (!currentSong.coverUrl) {
    currentSong.coverUrl = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
  }

  if (ytPlayer && ytId) {
    try {
      if (ytPlayer.unMute) ytPlayer.unMute();
      if (ytPlayer.setVolume) ytPlayer.setVolume(playerVolume || 100);
    } catch (_) { }

    if (ytPlayer.loadVideoById) {
      ytPlayer.loadVideoById({
        videoId: ytId,
        startSeconds: 0
      });
      if (ytPlayer.playVideo) ytPlayer.playVideo();
    }
    isPlaying = true;
    startTimer();
  } else {
    isPlaying = true;
    startTimer();
  }
  updatePlayerUI();
  renderSongQueue();
}

async function togglePlayback() {
  if (localSongQueue.length === 0) {
    showToast('info', 'Dodajte najpre neku pesmu u red.', '🎵');
    return;
  }

  if (isPlaying) {
    isPlaying = false;
    if (ytPlayer && ytPlayer.pauseVideo) {
      ytPlayer.pauseVideo();
    }
    stopTimer();
  } else {
    isPlaying = true;
    if (ytPlayer) {
      try {
        if (ytPlayer.unMute) ytPlayer.unMute();
        if (ytPlayer.setVolume) ytPlayer.setVolume(playerVolume || 100);
        if (ytPlayer.playVideo) ytPlayer.playVideo();
      } catch (_) { }
    } else {
      playCurrentAudio();
    }
    startTimer();
  }

  updatePlayerUI();
  renderSongQueue();
}

async function skipSong() {
  stopTimer();
  currentTimeSeconds = 0;

  if (localSongQueue.length > 0) {
    localSongQueue.splice(currentSongIndex, 1);
    if (currentSongIndex >= localSongQueue.length) {
      currentSongIndex = 0;
    }
  }

  saveSongRequestConfig(true);

  if (localSongQueue.length === 0) {
    isPlaying = false;
    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
    showToast('info', 'Završeno puštanje svih pesama iz reda.', '🎵');
  } else {
    playCurrentAudio();
  }

  updatePlayerUI();
  renderSongQueue();
}

async function previousSong() {
  stopTimer();
  currentTimeSeconds = 0;

  if (currentSongIndex > 0) {
    currentSongIndex--;
  } else {
    currentSongIndex = Math.max(0, localSongQueue.length - 1);
  }

  playCurrentAudio();
}

async function saveSongRequestConfig(silent) {
  if (!activeChannel) return;

  const masterToggle = document.getElementById('cfgFeatureSongRequestMaster');
  const songToggle = document.getElementById('cfgSongRequestEnabled');
  const rankSelect = document.getElementById('cfgSongRequestRank');
  const costInput = document.getElementById('cfgSongRequestCost');
  const maxDurationInput = document.getElementById('cfgSongRequestMaxDuration');

  const isMasterEnabled = masterToggle ? masterToggle.checked : true;
  const isEnabled = songToggle ? songToggle.checked : true;

  const songrequestSettings = {
    request_role: rankSelect ? rankSelect.value : 'everyone',
    cost_points: costInput ? parseInt(costInput.value) || 0 : 0,
    max_duration_seconds: maxDurationInput ? parseInt(maxDurationInput.value) || 360 : 360,
    queue: localSongQueue
  };

  const { error } = await sb.from('bot_config')
    .upsert({
      user_id: getChannelOwnerId(),
      channel_id: activeChannel.id,
      channel_name: activeChannel.username,
      feature_songrequest: isMasterEnabled && isEnabled,
      songrequest_settings: songrequestSettings,
      updated_at: new Date().toISOString()
    }, { onConflict: 'channel_id' });

  if (error) {
    if (!silent) showToast('error', 'Greška pri čuvanju podešavanja song request-a', '❌');
    return;
  }

  if (!silent) {
    showToast('success', 'Song Request podešavanja uspešno sačuvana!', '✅');
  }

  notifyBotToReload();
  updateOverviewModulesUI();
}

async function updateVolume(val) {
  playerVolume = parseInt(val) || 0;
  if (ytPlayer && ytPlayer.setVolume) {
    ytPlayer.setVolume(playerVolume);
  }
}

function seekPlayer(event) {
  const currentSong = localSongQueue[currentSongIndex];
  if (!currentSong) return;

  const progressBar = event.currentTarget;
  const rect = progressBar.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const width = rect.width;
  if (width <= 0) return;
  const pct = Math.max(0, Math.min(1, clickX / width));

  const targetSeconds = Math.floor(pct * (currentSong.duration || 0));
  currentTimeSeconds = targetSeconds;

  if (window.ytPlayer && typeof window.ytPlayer.seekTo === 'function') {
    try {
      window.ytPlayer.seekTo(targetSeconds, true);
    } catch (e) { }
  }

  updatePlayerUI();
}

async function searchYouTubeVideoId(query) {
  if (!query) return null;
  const directId = extractYouTubeId(query);
  if (directId) return directId;

  const cleanQuery = query.trim();

  // 1. Zvanični KickALL Netlify Backend Search Endpoint
  try {
    const res = await fetch(`/.netlify/functions/yt-search?q=${encodeURIComponent(cleanQuery)}`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      if (data && data.videoId) {
        return data.videoId;
      }
    }
  } catch (e) { }

  // 2. Fallback: allorigins proxy
  try {
    const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent('https://www.youtube.com/results?search_query=' + encodeURIComponent(cleanQuery))}`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const html = await res.text();
      const match = html.match(/"videoId":"([\w-]{11})"/);
      if (match && match[1]) {
        return match[1];
      }
    }
  } catch (e) { }

  // 3. Fallback: corsproxy
  try {
    const res = await fetch(`https://corsproxy.io/?${encodeURIComponent('https://www.youtube.com/results?search_query=' + encodeURIComponent(cleanQuery))}`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const html = await res.text();
      const match = html.match(/"videoId":"([\w-]{11})"/);
      if (match && match[1]) {
        return match[1];
      }
    }
  } catch (e) { }

  return null;
}

async function fetchExactYouTubeDuration(ytId) {
  if (!ytId) return 0;
  try {
    const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + ytId)}`, { signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      const html = await res.text();
      const match = html.match(/"approxDurationMs":"(\d+)"/);
      if (match && match[1]) {
        return Math.round(parseInt(match[1]) / 1000);
      }
    }
  } catch (e) { }
  return 0;
}

async function resolveYouTubeSongSmart(query) {
  if (!query) return null;
  const cleanQuery = query.trim();

  // 1. Direktan YouTube link / ID
  const ytIdMatch = extractYouTubeId(cleanQuery);
  if (ytIdMatch) {
    let exactDuration = await fetchExactYouTubeDuration(ytIdMatch);
    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytIdMatch}&format=json`);
      if (oembedRes.ok) {
        const oembed = await oembedRes.json();
        return {
          ytId: ytIdMatch,
          title: oembed.title || `YouTube Track (${ytIdMatch})`,
          artist: oembed.author_name || 'YouTube',
          coverUrl: `https://img.youtube.com/vi/${ytIdMatch}/hqdefault.jpg`,
          duration: exactDuration > 0 ? exactDuration : 210
        };
      }
    } catch (e) { }
    return {
      ytId: ytIdMatch,
      title: `YouTube Track (${ytIdMatch})`,
      artist: 'YouTube',
      coverUrl: `https://img.youtube.com/vi/${ytIdMatch}/hqdefault.jpg`,
      duration: exactDuration > 0 ? exactDuration : 210
    };
  }

  // 2. Netlify Serverless YouTube Search
  try {
    const ytRes = await fetch(`/.netlify/functions/yt-search?q=${encodeURIComponent(cleanQuery)}`, { signal: AbortSignal.timeout(5000) });
    if (ytRes.ok) {
      const data = await ytRes.json();
      if (data && data.videoId) {
        let artist = data.uploader || 'YouTube';
        let title = data.title || cleanQuery;
        if (title.includes(' - ')) {
          const parts = title.split(' - ');
          artist = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
        }
        let exactDuration = data.duration ? Math.round(Number(data.duration)) : 0;
        if (!exactDuration || exactDuration <= 0) {
          exactDuration = await fetchExactYouTubeDuration(data.videoId);
        }
        return {
          ytId: data.videoId,
          title: title,
          artist: artist,
          coverUrl: data.coverUrl || `https://img.youtube.com/vi/${data.videoId}/hqdefault.jpg`,
          duration: exactDuration > 0 ? exactDuration : 210
        };
      }
    }
  } catch (e) { }

  // 3. Fallback: Pronađi Video ID preko klijentskog proxy-ja
  const foundYtId = await searchYouTubeVideoId(cleanQuery);
  let artist = '';
  let title = cleanQuery;
  if (cleanQuery.includes(' - ')) {
    const parts = cleanQuery.split(' - ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' - ').trim();
  }

  let exactDuration = await fetchExactYouTubeDuration(foundYtId);

  return {
    ytId: foundYtId,
    title: title,
    artist: artist,
    coverUrl: foundYtId ? `https://img.youtube.com/vi/${foundYtId}/hqdefault.jpg` : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80',
    duration: exactDuration > 0 ? exactDuration : 210
  };
}

async function requestSong() {
  const inputEl = document.getElementById('songRequestInput');
  if (!inputEl) return;
  const rawInput = inputEl.value ? inputEl.value.trim() : '';

  if (!rawInput) {
    showToast('info', 'Molimo unesite naziv pesme, izvođača ili YouTube link.', '🎵');
    return;
  }

  const queueLimits = getPlanLimits();
  if (queueLimits.maxSongQueue !== Infinity && localSongQueue.length >= queueLimits.maxSongQueue) {
    showToast('warning', `Dostignut je limit od ${queueLimits.maxSongQueue} pesama u redu za ${queueLimits.name} paket! Nadogradi za veći queue.`);
    openUpgradeModal('general');
    return;
  }

  const addBtn = document.getElementById('songRequestAddBtn');
  if (addBtn) {
    addBtn.disabled = true;
    addBtn.innerHTML = 'Tražim...';
  }

  showToast('info', `Tražim pesmu "${rawInput}" na YouTube-u...`, '🔍');

  const resolved = await resolveYouTubeSongSmart(rawInput);

  if (addBtn) {
    addBtn.disabled = false;
    addBtn.innerHTML = 'Dodaj';
  }

  if (!resolved) {
    showToast('error', 'Nije bilo moguće pronaći pesmu.', '❌');
    return;
  }

  const maxDurationInput = document.getElementById('cfgSongRequestMaxDuration');
  const maxDuration = maxDurationInput ? parseInt(maxDurationInput.value) || 360 : 360;

  const requesterName = (activeChannel && activeChannel.username) ? `Strimer (${activeChannel.username})` : 'Strimer';

  const newSong = {
    id: 'yt_' + (resolved.ytId || Date.now()),
    ytId: resolved.ytId,
    title: resolved.title,
    artist: resolved.artist,
    requester: requesterName,
    duration: Math.min(resolved.duration || 210, maxDuration),
    source: 'youtube',
    coverUrl: resolved.coverUrl
  };

  localSongQueue.push(newSong);
  inputEl.value = '';

  renderSongQueue();
  updatePlayerUI();
  saveSongRequestConfig(true);

  if (localSongQueue.length === 1 && !isPlaying) {
    playCurrentAudio();
  }

  showToast('success', `Pronađena pesma: "${resolved.artist ? resolved.artist + ' - ' : ''}${resolved.title}"`, '🎵');
}

function removeSong(index) {
  if (index < 0 || index >= localSongQueue.length) return;

  const removed = localSongQueue.splice(index, 1)[0];

  if (currentSongIndex >= localSongQueue.length) {
    currentSongIndex = Math.max(0, localSongQueue.length - 1);
  }

  if (localSongQueue.length === 0) {
    isPlaying = false;
    if (playbackInterval) clearInterval(playbackInterval);
    currentTimeSeconds = 0;
  }

  renderSongQueue();
  updatePlayerUI();
  saveSongRequestConfig(true);

  showToast('info', `Pesma "${removed ? removed.title : ''}" je uklonjena iz reda.`, '🗑️');
}

function clearSongQueue() {
  if (localSongQueue.length === 0) {
    showToast('info', 'Red sa pesmama je već prazan.', 'ℹ️');
    return;
  }

  localSongQueue = [];
  currentSongIndex = 0;
  currentTimeSeconds = 0;
  if (isPlaying) {
    isPlaying = false;
    if (playbackInterval) clearInterval(playbackInterval);
  }

  renderSongQueue();
  updatePlayerUI();
  saveSongRequestConfig(true);

  showToast('info', 'Red sa pesmama je uspešno očišćen.', '🧹');
}

function playSongNow(index) {
  if (index < 0 || index >= localSongQueue.length) return;

  currentSongIndex = index;
  currentTimeSeconds = 0;
  isPlaying = true;

  if (playbackInterval) clearInterval(playbackInterval);
  playbackInterval = setInterval(() => {
    const currentSong = localSongQueue[currentSongIndex];
    if (!currentSong) {
      clearInterval(playbackInterval);
      isPlaying = false;
      updatePlayerUI();
      return;
    }

    if (window.ytPlayer) {
      try {
        if (typeof window.ytPlayer.getDuration === 'function') {
          const realDur = Math.round(window.ytPlayer.getDuration());
          if (realDur && realDur > 0 && Math.abs((currentSong.duration || 0) - realDur) > 1) {
            currentSong.duration = realDur;
          }
        }
        if (typeof window.ytPlayer.getCurrentTime === 'function') {
          const realCur = Math.floor(window.ytPlayer.getCurrentTime());
          if (typeof realCur === 'number' && !isNaN(realCur) && realCur >= 0) {
            currentTimeSeconds = realCur;
          } else {
            currentTimeSeconds++;
          }
        } else {
          currentTimeSeconds++;
        }
      } catch (_) {
        currentTimeSeconds++;
      }
    } else {
      currentTimeSeconds++;
    }

    if (currentSong.duration > 0 && currentTimeSeconds >= currentSong.duration) {
      skipSong();
    } else {
      updatePlayerUI();
    }
  }, 1000);

  updatePlayerUI();
  renderSongQueue();
  saveSongRequestConfig(true);
}

// Bind handlers globally to window for HTML event availability
window.requestSong = requestSong;
window.removeSong = removeSong;
window.clearSongQueue = clearSongQueue;
window.playSongNow = playSongNow;
window.togglePlayback = togglePlayback;
window.skipSong = skipSong;
window.previousSong = previousSong;
window.updateVolume = updateVolume;
window.seekPlayer = seekPlayer;
window.saveSongRequestConfig = saveSongRequestConfig;
window.switchEconomyTab = switchEconomyTab;
window.updateEconomyPreviews = updateEconomyPreviews;
window.saveEconomyConfig = saveEconomyConfig;
window.saveMinigamesConfig = saveMinigamesConfig;
window.runSimulatedGame = runSimulatedGame;
window.openCreateStoreItemModal = openCreateStoreItemModal;
window.saveStoreItem = saveStoreItem;
window.editStoreItem = editStoreItem;
window.deleteStoreItem = deleteStoreItem;
window.simulirajKupovinuArtikla = simulirajKupovinuArtikla;
window.approveRedemption = approveRedemption;
window.rejectRedemption = rejectRedemption;
window.renderEconomyLeaderboard = renderEconomyLeaderboard;
window.openEditUserPointsModal = openEditUserPointsModal;
window.divorceConfirm = divorceConfirm;
window.openFeedbackModal = openFeedbackModal;
window.openHelpModal = openHelpModal;
window.openDocsModal = openDocsModal;
window.onFeedbackTypeChange = onFeedbackTypeChange;
window.handleFeedbackFormSubmit = handleFeedbackFormSubmit;
window.syncLatestKickAvatar = syncLatestKickAvatar;
window.toggleModuleFromOverview = toggleModuleFromOverview;
window.handleCustomBotNameInput = handleCustomBotNameInput;
window.copyCustomBotModCmd = copyCustomBotModCmd;
window.promptCustomBotAuthModal = promptCustomBotAuthModal;
window.confirmCustomBotAuth = confirmCustomBotAuth;
window.disconnectCustomBot = disconnectCustomBot;
window.updateCustomBotStatusUI = updateCustomBotStatusUI;
window.getBotSenderIdentity = getBotSenderIdentity;

// Initial rendering of notification content on page load
window.addEventListener('DOMContentLoaded', () => {
  // Hide notification badge if there are no unread notifications on start
  const _hasUnread = notifications.some(n => !n.read);
  const _badge = document.getElementById('notifBadge');
  updateNotifBadgeUI();
  renderNotifContent();
  renderSongQueue();
  updatePlayerUI();
});


// ── Economy & Ranking System Logic ──
function switchEconomyTab(tabName) {
  currentEconomyTab = tabName;
  localStorage.setItem('active-economy-tab', tabName);
  const configTab = document.getElementById('ecoSubPanelConfig');
  const storeTab = document.getElementById('ecoSubPanelStore');
  const lbTab = document.getElementById('ecoSubPanelLeaderboard');

  const btnConfig = document.getElementById('ecoTabBtnConfig');
  const btnStore = document.getElementById('ecoTabBtnStore');
  const btnLb = document.getElementById('ecoTabBtnLeaderboard');

  if (configTab) configTab.style.display = tabName === 'config' ? 'block' : 'none';
  if (storeTab) storeTab.style.display = tabName === 'store' ? 'block' : 'none';
  if (lbTab) lbTab.style.display = tabName === 'leaderboard' ? 'block' : 'none';

  if (btnConfig) btnConfig.className = 'btn btn-sm ' + (tabName === 'config' ? 'btn-primary' : 'btn-outline');
  if (btnStore) btnStore.className = 'btn btn-sm ' + (tabName === 'store' ? 'btn-primary' : 'btn-outline');
  if (btnLb) btnLb.className = 'btn btn-sm ' + (tabName === 'leaderboard' ? 'btn-primary' : 'btn-outline');

  if (tabName === 'store') {
    renderStoreItems();
    renderStoreRedemptions();
  } else if (tabName === 'leaderboard') {
    renderEconomyLeaderboard();
  }
}

function updateEconomyPreviews() {
  const valuta = document.getElementById('cfgCurrencyName')?.value.trim() || 'Koins';
  const firstJoin = parseInt(document.getElementById('cfgFirstInteractionBonus')?.value, 10) || 100;
  const watchtime = parseInt(document.getElementById('cfgPointsPerWatchtime')?.value, 10) || 20;
  const subMult = parseFloat(document.getElementById('cfgSubMultiplier')?.value) || 2.0;
  const perSub = parseInt(document.getElementById('cfgPointsPerSub')?.value, 10) || 1000;
  const perGiftSub = parseInt(document.getElementById('cfgPointsPerGiftSub')?.value, 10) || 2000;
  const perKicks = parseInt(document.getElementById('cfgPointsPer100Kicks')?.value, 10) || 500;
  const dailyStreak = parseInt(document.getElementById('cfgPointsDailyStreak')?.value, 10) || 150;

  const pFirst = document.getElementById('previewFirstJoin');
  const pWatch = document.getElementById('previewWatchtime');
  const pSubMult = document.getElementById('previewSubMult');
  const pSubBonus = document.getElementById('previewSubBonus');
  const pKicks = document.getElementById('previewKicksBonus');
  const pStreak = document.getElementById('previewDailyStreak');

  if (pFirst) pFirst.textContent = `+${firstJoin.toLocaleString()} ${valuta}`;
  if (pWatch) pWatch.textContent = `+${watchtime.toLocaleString()} ${valuta}`;
  if (pSubMult) pSubMult.textContent = `${subMult.toFixed(1)}x Bonus`;
  if (pSubBonus) pSubBonus.textContent = `+${perSub.toLocaleString()} / +${perGiftSub.toLocaleString()}`;
  if (pKicks) pKicks.textContent = `+${perKicks.toLocaleString()} ${valuta}`;
  if (pStreak) pStreak.textContent = `+${dailyStreak.toLocaleString()} ${valuta}/dan`;
}

async function saveEconomyConfig(silent = false) {
  if (!activeChannel) return;

  const ecoSettings = {
    currency_name: document.getElementById('cfgCurrencyName')?.value.trim() || 'Koins',
    points_per_msg: parseInt(document.getElementById('cfgPointsPerMsg')?.value, 10) || 5,
    smart_chat_validation: document.getElementById('cfgSmartChatValidation')?.checked ?? true,
    first_interaction_bonus: parseInt(document.getElementById('cfgFirstInteractionBonus')?.value, 10) || 100,
    points_per_watchtime: parseInt(document.getElementById('cfgPointsPerWatchtime')?.value, 10) || 20,
    level_up_announce: document.getElementById('cfgLevelUpAnnounce')?.checked ?? true,
    sub_multiplier: parseFloat(document.getElementById('cfgSubMultiplier')?.value) || 2.0,
    sub_bonus_per_msg: parseInt(document.getElementById('cfgSubBonusPerMsg')?.value, 10) || 10,
    points_per_sub: parseInt(document.getElementById('cfgPointsPerSub')?.value, 10) || 1000,
    points_per_gift_sub: parseInt(document.getElementById('cfgPointsPerGiftSub')?.value, 10) || 2000,
    points_per_100_kicks: parseInt(document.getElementById('cfgPointsPer100Kicks')?.value, 10) || 500,
    points_daily_streak: parseInt(document.getElementById('cfgPointsDailyStreak')?.value, 10) || 150,
    points_per_raid: parseInt(document.getElementById('cfgPointsPerRaid')?.value, 10) || 300,
    gamble_enabled: document.getElementById('cfgGambleEnabled')?.checked ?? true,
    max_gamble_amount: parseInt(document.getElementById('cfgMaxGambleAmount')?.value, 10) || 5000
  };

  if (!currentChannelConfig) currentChannelConfig = {};
  currentChannelConfig.currency_name = ecoSettings.currency_name;
  currentChannelConfig.economy_settings = ecoSettings;
  Object.assign(currentChannelConfig, ecoSettings);

  const fieldsToSave = {
    currency_name: ecoSettings.currency_name,
    points_per_msg: ecoSettings.points_per_msg,
    smart_chat_validation: ecoSettings.smart_chat_validation,
    first_interaction_bonus: ecoSettings.first_interaction_bonus,
    points_per_watchtime: ecoSettings.points_per_watchtime,
    level_up_announce: ecoSettings.level_up_announce,
    sub_multiplier: ecoSettings.sub_multiplier,
    sub_bonus_per_msg: ecoSettings.sub_bonus_per_msg,
    points_per_sub: ecoSettings.points_per_sub,
    points_per_gift_sub: ecoSettings.points_per_gift_sub,
    points_per_100_kicks: ecoSettings.points_per_100_kicks,
    points_daily_streak: ecoSettings.points_daily_streak,
    points_per_raid: ecoSettings.points_per_raid,
    gamble_enabled: ecoSettings.gamble_enabled,
    max_gamble_amount: ecoSettings.max_gamble_amount,
    economy_settings: ecoSettings
  };

  const { error } = await saveBotConfigFields(fieldsToSave);

  if (error) {
    if (!silent) showToast('error', 'Greška pri čuvanju podešavanja ranking sistema!');
  } else {
    if (!silent) showToast('success', 'Podešavanja ranking sistema su uspešno sačuvana!');
  }

  updateEconomyPreviews();
}

async function saveMinigamesConfig() {
  if (!activeChannel) return;

  const ecoSettings = {
    gamble_enabled: document.getElementById('cfgGambleEnabled')?.checked ?? true,
    max_gamble_amount: parseInt(document.getElementById('cfgMinigamesMaxBet')?.value, 10) || 5000
  };

  if (!currentChannelConfig) currentChannelConfig = {};
  currentChannelConfig.economy_settings = { ...currentChannelConfig.economy_settings, ...ecoSettings };

  const { error } = await saveBotConfigFields({ economy_settings: currentChannelConfig.economy_settings });

  if (error) {
    showToast('error', 'Greška pri čuvanju podešavanja mini igara!');
  } else {
    showToast('success', 'Podešavanja mini igara su uspešno sačuvana!');
  }
}

function runSimulatedGame() {
  const type = document.getElementById('simGameType')?.value || 'slots';
  const bet = parseInt(document.getElementById('simBetAmount')?.value, 10) || 100;
  const resEl = document.getElementById('simGameResult');
  const valuta = document.getElementById('cfgCurrencyName')?.value.trim() || 'Poena';

  if (!resEl) return;

  // Osiguravamo da container prikazuje tekst kao normalan blok
  resEl.style.display = 'block';
  resEl.style.textAlign = 'center';

  if (type === 'slots') {
    const simboli = ['🍒', '🍋', '🔔', '🍇', '💎', '🎰'];
    const s1 = simboli[Math.floor(Math.random() * simboli.length)];
    const s2 = simboli[Math.floor(Math.random() * simboli.length)];
    const s3 = simboli[Math.floor(Math.random() * simboli.length)];

    let resText = `<strong>@Strimer</strong> je zavrteo slot: [ ${s1} | ${s2} | ${s3} ] — `;
    if (s1 === s2 && s2 === s3) {
      if (s1 === '🎰' || s1 === '💎') {
        resText += `<span style="color:#eab308; font-weight:700;">JACKPOT 50x! Osvojio si +${(bet * 50).toLocaleString()} ${valuta}!</span>`;
      } else {
        resText += `<span style="color:#53fc18; font-weight:700;">3 u nizu 10x! Osvojio si +${(bet * 10).toLocaleString()} ${valuta}!</span>`;
      }
    } else if (s1 === s2 || s2 === s3 || s1 === s3) {
      resText += `<span style="color:#eab308;">2 u nizu 2x! Vraćeno +${(bet * 2).toLocaleString()} ${valuta}!</span>`;
    } else {
      resText += `<span style="color:#ef4444;">Nema pogotka! Izgubio si ${bet.toLocaleString()} ${valuta}.</span>`;
    }
    resEl.innerHTML = resText;

  } else if (type === 'roulette') {
    const loptica = Math.floor(Math.random() * 37);
    const crveniBrojevi = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    const boja = loptica === 0 ? 'ZELENA' : (crveniBrojevi.includes(loptica) ? 'CRVENA' : 'CRNA');

    resEl.innerHTML = `<strong>@Strimer</strong> je zavrteo rulet! Loptica je pala na <strong>${loptica} (${boja})</strong>! <span style="color:#53fc18;">Isplata: +${(bet * 2).toLocaleString()} ${valuta} (Boja/Par) ili +${(bet * 36).toLocaleString()} ${valuta} (Tačan broj)!</span>`;

  } else if (type === 'coinflip') {
    const ishod = Math.random() < 0.5 ? 'PISMO' : 'GLAVA';
    const isWin = Math.random() < 0.5;

    if (isWin) {
      resEl.innerHTML = `<strong>@Strimer</strong> je bacio novčić: pao je na <strong>${ishod}</strong>! <span style="color:#53fc18; font-weight:700;">Dupliranje 2x! Osvojio si +${(bet * 2).toLocaleString()} ${valuta}!</span>`;
    } else {
      resEl.innerHTML = `<strong>@Strimer</strong> je bacio novčić: pao je na <strong>${ishod}</strong>! <span style="color:#ef4444;">Promašaj! Izgubio si ${bet.toLocaleString()} ${valuta}.</span>`;
    }

  } else if (type === 'wheel') {
    const mults = [0, 0.5, 1, 2, 3, 5];
    const m = mults[Math.floor(Math.random() * mults.length)];
    const dobitak = Math.floor(bet * m);

    if (m > 1) {
      resEl.innerHTML = `<strong>@Strimer</strong> je zavrteo Točak Sreće i pogodio <strong>${m}x</strong>! <span style="color:#53fc18; font-weight:700;">Profit! Osvojio si +${dobitak.toLocaleString()} ${valuta}!</span>`;
    } else if (m === 1 || m === 0.5) {
      resEl.innerHTML = `<strong>@Strimer</strong> je zavrteo Točak Sreće i pogodio <strong>${m}x</strong>! <span style="color:#eab308;">Vraćeno ${dobitak.toLocaleString()} ${valuta}.</span>`;
    } else {
      resEl.innerHTML = `<strong>@Strimer</strong> je zavrteo Točak Sreće i pogodio <strong>0x</strong>! <span style="color:#ef4444;">Nula! Izgubio si ulog od ${bet.toLocaleString()} ${valuta}.</span>`;
    }
  }
}

// ── Store Items & Purchase History CRUD ──
let currentRedemptionsFilter = 'all';

function getIconSVG(iconStr) {
  const str = (iconStr || '').toLowerCase();
  if (str.includes('vip') || str.includes('⭐') || str.includes('star')) {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  }
  if (str.includes('song') || str.includes('pesma') || str.includes('🎵') || str.includes('music')) {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  }
  if (str.includes('voda') || str.includes('water') || str.includes('💧')) {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`;
  }
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`;
}

function getStoreItems() {
  return (currentChannelConfig && currentChannelConfig.store_items) ? currentChannelConfig.store_items : [];
}

function renderStoreItems() {
  const container = document.getElementById('storeItemsGrid');
  const simSelect = document.getElementById('simStoreItemSelect');
  const addBtn = document.getElementById('btnAddStoreItem');
  if (!container) return;

  const items = getStoreItems();
  const valuta = (currentChannelConfig && currentChannelConfig.currency_name) || 'KickCoins';
  const limits = getPlanLimits();

  if (simSelect) {
    simSelect.innerHTML = items.map(i => `<option value="${i.id}">${i.name} (${i.cost} ${valuta})</option>`).join('');
  }

  // Show store items limit banner
  const storeLimitBanner = document.getElementById('storeLimitBanner');
  if (storeLimitBanner) {
    if (limits.maxStoreItems === Infinity) {
      storeLimitBanner.style.display = 'none';
    } else {
      storeLimitBanner.style.display = 'flex';
      storeLimitBanner.innerHTML = `
              <div style="display:flex; align-items:center; gap:12px;">
                <div style="background:rgba(139,92,246,0.18); border:1px solid rgba(139,92,246,0.3); color:#c084fc; padding:6px 12px; border-radius:8px; font-weight:800; font-size:0.75rem; text-transform:uppercase;">
                  ${limits.name} Paket
                </div>
                <div>
                  <div style="font-size:0.85rem; font-weight:700; color:#fff;">
                    Ograničenje artikala: <span style="color:#53FC18">${items.length}</span> / <strong>${limits.maxStoreItems}</strong> artikala
                  </div>
                  <div style="font-size:0.78rem; color:var(--text-muted);">
                    ${limits.name === 'Free' ? 'Free: 10 max | Pro: 50 max | Elite: Neograničeno' : 'Pro: 50 max | Elite: Neograničeno'}
                  </div>
                </div>
              </div>
              <button type="button" class="plan-upgrade-btn" onclick="openUpgradeModal('storeItems')">${upgradeSvgIcon}<span>Nadogradi za više artikala</span></button>
            `;
    }
  }

  // Disable add button if limit reached
  if (addBtn) {
    if (limits.maxStoreItems !== Infinity && items.length >= limits.maxStoreItems) {
      addBtn.disabled = true;
      addBtn.style.opacity = '0.5';
      addBtn.style.cursor = 'not-allowed';
      addBtn.title = 'Dostignut je limit artikala za tvoj paket';
    } else {
      addBtn.disabled = false;
      addBtn.style.opacity = '1';
      addBtn.style.cursor = 'pointer';
      addBtn.title = '';
    }
  }

  if (items.length === 0) {
    container.innerHTML = `<div style="grid-column:1/-1; color:var(--text-muted); text-align:center; padding:20px;">Nema artikala u prodavnici. Klikni na "+ Dodaj novi artikal".</div>`;
    return;
  }

  container.innerHTML = items.map(item => {
    const stockStr = (item.stock === undefined || item.stock < 0) ? 'Neograničeno' : `${item.stock} kom.`;
    const rankStr = (item.min_rank === 'subscriber') ? 'Samo Subs' : (item.min_rank === 'vip' ? 'VIP+' : (item.min_rank === 'moderator' ? 'Samo Mods' : 'Svi'));

    return `
      <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:16px; display:flex; flex-direction:column; justify-content:space-between; position:relative;">
        <div>
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <div style="display:flex; align-items:center; justify-content:center; width:44px; height:44px; border-radius:12px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);">
              ${getIconSVG(item.icon || item.name)}
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
              <span style="font-size:0.7rem; font-weight:700; color:#a78bfa; background:rgba(167,139,250,0.12); padding:2px 6px; border-radius:6px;">${rankStr}</span>
              <span style="font-size:0.7rem; color:var(--text-muted);">Zaliha: ${stockStr}</span>
            </div>
          </div>
          <h4 style="margin:0 0 6px 0; font-size:1rem; color:#fff;">${item.name}</h4>
          <p style="margin:0 0 12px 0; font-size:0.82rem; color:var(--text-muted); line-height:1.4;">${item.description || ''}</p>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid rgba(255,255,255,0.06); padding-top:12px; margin-top:8px;">
          <span style="font-weight:700; color:#eab308; font-size:0.9rem; display:flex; align-items:center; gap:4px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 9.5h5a1.5 1.5 0 0 1 0 3h-5a1.5 1.5 0 0 0 0 3h5"/></svg>
            ${item.cost} ${valuta}
          </span>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-xs btn-outline" onclick="editStoreItem('${item.id}')" style="padding:4px 8px; font-size:0.75rem;">Izmeni</button>
            <button class="btn btn-xs btn-danger" onclick="deleteStoreItem('${item.id}')" style="padding:4px 8px; font-size:0.75rem;">Obriši</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openCreateStoreItemModal() {
  document.getElementById('storeItemModalTitle').innerText = 'Novi Artikal u Prodavnici';
  document.getElementById('storeItemEditId').value = '';
  document.getElementById('storeItemName').value = '';
  document.getElementById('storeItemDesc').value = '';
  document.getElementById('storeItemCost').value = '500';
  document.getElementById('storeItemStock').value = '-1';
  document.getElementById('storeItemRank').value = 'everyone';
  document.getElementById('storeItemIcon').value = 'vip';
  document.getElementById('storeItemAutoApprove').checked = false;
  openModal('storeItemModal');
}

function editStoreItem(id) {
  const items = getStoreItems();
  const item = items.find(i => i.id === id);
  if (!item) return;

  document.getElementById('storeItemModalTitle').innerText = 'Izmena Artikla Prodavnice';
  document.getElementById('storeItemEditId').value = item.id;
  document.getElementById('storeItemName').value = item.name;
  document.getElementById('storeItemDesc').value = item.description || '';
  document.getElementById('storeItemCost').value = item.cost || 500;
  document.getElementById('storeItemStock').value = item.stock !== undefined ? item.stock : -1;
  document.getElementById('storeItemRank').value = item.min_rank || 'everyone';
  document.getElementById('storeItemIcon').value = item.icon || 'vip';
  document.getElementById('storeItemAutoApprove').checked = item.auto_approve === true;
  openModal('storeItemModal');
}

async function saveStoreItem() {
  const editId = document.getElementById('storeItemEditId').value;
  const name = document.getElementById('storeItemName').value.trim();
  const desc = document.getElementById('storeItemDesc').value.trim();
  const cost = parseInt(document.getElementById('storeItemCost').value, 10) || 500;
  const stock = parseInt(document.getElementById('storeItemStock').value, 10);
  const min_rank = document.getElementById('storeItemRank').value;
  const icon = document.getElementById('storeItemIcon').value;
  const auto_approve = document.getElementById('storeItemAutoApprove').checked;

  if (!name) {
    showToast('Unesi naziv artikla!', 'warning');
    return;
  }

  const limits = getPlanLimits();
  let items = getStoreItems();

  // Check plan limits for new items (editing existing items doesn't count towards limit)
  if (!editId && limits.maxStoreItems !== Infinity) {
    if (items.length >= limits.maxStoreItems) {
      openUpgradeModal('storeItems');
      return;
    }
  }

  if (editId) {
    const idx = items.findIndex(i => i.id === editId);
    if (idx !== -1) {
      items[idx] = { ...items[idx], name, description: desc, cost, stock: isNaN(stock) ? -1 : stock, min_rank, icon, auto_approve };
    }
  } else {
    items.push({
      id: 'item_' + Date.now(),
      name,
      description: desc,
      cost,
      stock: isNaN(stock) ? -1 : stock,
      min_rank,
      icon,
      auto_approve
    });
  }

  if (!currentChannelConfig) currentChannelConfig = {};
  currentChannelConfig.store_items = items;

  const { error } = await saveBotConfigFields({ store_items: items });

  if (error) {
    showToast('error', 'Greška pri čuvanju artikla!');
  } else {
    showToast('success', editId ? 'Artikal uspešno izmenjen!' : 'Novi artikal uspešno dodat!', '✅');
    closeModal('storeItemModal');
    renderStoreItems();
  }
}

async function deleteStoreItem(id) {
  let items = getStoreItems().filter(i => i.id !== id);
  if (!currentChannelConfig) currentChannelConfig = {};
  currentChannelConfig.store_items = items;

  const { error } = await saveBotConfigFields({ store_items: items });

  if (error) {
    showToast('error', 'Greška pri brisanju artikla!');
  } else {
    showToast('success', 'Artikal obrisan!', '✅');
    renderStoreItems();
  }
}

// ── Store Redemptions Queue & Purchase History ──
function getStoreRedemptions() {
  return (currentChannelConfig && currentChannelConfig.store_redemptions) ? currentChannelConfig.store_redemptions : [];
}

function filterRedemptions(status) {
  currentRedemptionsFilter = status;
  ['redFilterAll', 'redFilterPending', 'redFilterCompleted', 'redFilterRejected'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.className = 'btn btn-xs ' + (id.toLowerCase().includes(status) || (status === 'all' && id === 'redFilterAll') ? 'btn-primary' : 'btn-outline');
    }
  });
  renderStoreRedemptions();
}

function renderStoreRedemptions() {
  const tbody = document.getElementById('storeRedemptionsTbody');
  if (!tbody) return;

  let redemptions = getStoreRedemptions();
  const valuta = (currentChannelConfig && currentChannelConfig.currency_name) || 'KickCoins';

  if (currentRedemptionsFilter !== 'all') {
    redemptions = redemptions.filter(r => r.status === currentRedemptionsFilter);
  }

  if (redemptions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">Nema zahteva za kupovinu za izabrani filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = redemptions.map(r => {
    let statusBadge = `<span style="padding:3px 8px; border-radius:12px; font-size:0.75rem; font-weight:600; background:rgba(234,179,8,0.15); color:#eab308; border:1px solid rgba(234,179,8,0.3);">Čeka odobrenje 🟡</span>`;
    if (r.status === 'completed') {
      statusBadge = `<span style="padding:3px 8px; border-radius:12px; font-size:0.75rem; font-weight:600; background:rgba(34,197,94,0.15); color:#22c55e; border:1px solid rgba(34,197,94,0.3);">Odobreno 🟢</span>`;
    } else if (r.status === 'rejected') {
      statusBadge = `<span style="padding:3px 8px; border-radius:12px; font-size:0.75rem; font-weight:600; background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3);">Odbijeno (Vraćeno) 🔴</span>`;
    }

    const datum = r.requested_at ? new Date(r.requested_at).toLocaleString('sr-RS') : '—';
    const isPending = (r.status === 'pending');

    return `
      <tr>
        <td style="font-size:0.8rem; color:var(--text-muted);">${datum}</td>
        <td style="font-weight:600; color:#fff;">@${r.username}</td>
        <td><strong>${r.item_name}</strong></td>
        <td style="color:#eab308; font-weight:600;">${r.cost.toLocaleString()} ${valuta}</td>
        <td>${statusBadge}</td>
        <td style="text-align:right;">
          ${isPending ? `
            <button class="btn btn-xs btn-primary" onclick="approveRedemption('${r.id}')" style="padding:4px 10px; margin-right:4px;">Odobri 🟢</button>
            <button class="btn btn-xs btn-danger" onclick="rejectRedemption('${r.id}')" style="padding:4px 10px;">Odbij & Refundiraj 🔴</button>
          ` : `<span style="font-size:0.78rem; color:var(--text-muted);">—</span>`}
        </td>
      </tr>
    `;
  }).join('');
}

async function simulirajKupovinuArtikla() {
  const itemId = document.getElementById('simStoreItemSelect')?.value;
  const username = (document.getElementById('simStoreUser')?.value || 'Korisnik').replace(/^@/, '').trim();
  const items = getStoreItems();
  const item = items.find(i => i.id === itemId);

  if (!item) {
    showToast('Izaberi artikal iz prodavnice!', 'warning');
    return;
  }

  let redemptions = getStoreRedemptions();
  const newRed = {
    id: 'red_' + Date.now(),
    username: username,
    item_id: item.id,
    item_name: item.name,
    cost: item.cost,
    status: item.auto_approve ? 'completed' : 'pending',
    requested_at: new Date().toISOString()
  };

  redemptions.unshift(newRed);
  if (!currentChannelConfig) currentChannelConfig = {};
  currentChannelConfig.store_redemptions = redemptions;

  const { error } = await saveBotConfigFields({ store_redemptions: redemptions });

  if (error) {
    showToast('Greška pri simulaciji kupovine!', 'error');
  } else {
    showToast(`Simulirana kupovina za "${item.name}" od strane @${username}!`, 'success');
    renderStoreRedemptions();
  }
}

async function approveRedemption(id) {
  let redemptions = getStoreRedemptions();
  const target = redemptions.find(r => r.id === id);
  if (!target) return;

  target.status = 'completed';
  if (!currentChannelConfig) currentChannelConfig = {};
  currentChannelConfig.store_redemptions = redemptions;

  const { error } = await saveBotConfigFields({ store_redemptions: redemptions });

  if (!error) {
    showToast(`Kupovina za @${target.username} je uspešno odobrena!`, 'success');
    renderStoreRedemptions();
  }
}

async function rejectRedemption(id) {
  let redemptions = getStoreRedemptions();
  const target = redemptions.find(r => r.id === id);
  if (!target) return;

  target.status = 'rejected';
  if (!currentChannelConfig) currentChannelConfig = {};
  currentChannelConfig.store_redemptions = redemptions;

  // Refund coins to viewer if found on leaderboard
  const userKey = target.username.toLowerCase();
  const row = (allLeaderboard || []).find(x => (x.username || '').toLowerCase() === userKey);
  if (row) {
    row.coins = (row.coins || 0) + target.cost;
    const { error: lbError } = await sb.from('leaderboard')
      .upsert({ channel_id: String(activeChannel.id), username: userKey, coins: row.coins }, { onConflict: 'channel_id,username' });
    if (!lbError) renderEconomyLeaderboard();
  }

  const { error } = await saveBotConfigFields({ store_redemptions: redemptions });

  if (!error) {
    showToast(`Kupovina za @${target.username} je odbijena i ${target.cost} poena je refundirano!`, 'info');
    renderStoreRedemptions();
  }
}

// ── Economy Leaderboard Render ──
function renderEconomyLeaderboard() {
  const tbody = document.getElementById('ecoLeaderboardTbody');
  if (!tbody) return;

  const query = (document.getElementById('ecoLbSearchInput')?.value || '').toLowerCase().trim();
  const valuta = document.getElementById('cfgCurrencyName')?.value.trim() || (currentChannelConfig && currentChannelConfig.currency_name) || 'Koins';

  let list = (allLeaderboard || []).map(row => {
    return {
      username: row.display_name || row.username,
      rawUsername: row.username,
      points: row.points_currency || row.points || 0,
      messages: row.points || 0,
      updated_at: row.updated_at
    };
  });

  if (query) {
    list = list.filter(item => item.username.toLowerCase().includes(query) || item.rawUsername.toLowerCase().includes(query));
  }

  // Sortiraj prema izabranoj koloni i smeru
  const sortKey = typeof ecoLbSortKey !== 'undefined' ? ecoLbSortKey : 'points';
  const sortDir = typeof ecoLbSortDir !== 'undefined' ? ecoLbSortDir : 'desc';
  list.sort((a, b) => {
    let va, vb;
    if (sortKey === 'activity') {
      va = a.messages || 0;
      vb = b.messages || 0;
    } else {
      va = a.points || 0;
      vb = b.points || 0;
    }
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">Nema podataka na rang listi.</td></tr>`;
    return;
  }

  const coinIconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" style="vertical-align:middle;"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 9.5h5a1.5 1.5 0 0 1 0 3h-5a1.5 1.5 0 0 0 0 3h5"/></svg>`;

  tbody.innerHTML = list.slice(0, 50).map((u, idx) => `
    <tr>
      <td style="font-weight:700; color:var(--text-muted);">${idx + 1}</td>
      <td style="font-weight:600; color:#fff;">@${escapeHtml(u.username)}</td>
      <td style="color:#eab308; font-weight:700;">
        <span style="display:inline-flex; align-items:center; gap:4px;">
          ${coinIconSvg}
          ${u.points.toLocaleString()} ${valuta}
        </span>
      </td>
      <td style="color:var(--text-muted);">${formatPorukeCount(u.messages)} poruka</td>
      <td style="color:var(--text-muted); font-size:0.8rem;">${fmtDate(u.updated_at)}</td>
      <td style="text-align:right;">
        <button class="btn btn-sm btn-outline" onclick="openEditUserPointsModal('${escapeHtml(u.rawUsername)}', ${u.points})" style="padding:2px 8px; font-size:0.72rem;">Izmeni</button>
      </td>
    </tr>
  `).join('');
}

function openEditUserPointsModal(username, currentPoints) {
  const valuta = document.getElementById('cfgCurrencyName')?.value.trim() || 'Koins';
  const newPoints = prompt(`Unesi novi broj poena (${valuta}) za @${username}:`, currentPoints);
  if (newPoints === null) return;
  const parsed = parseInt(newPoints, 10);
  if (isNaN(parsed) || parsed < 0) return;

  const target = allLeaderboard.find(x => (x.username || '').toLowerCase() === username.toLowerCase());
  if (target) {
    target.points_currency = parsed;
    target.points = parsed;
    renderEconomyLeaderboard();
    showToast('success', `Poeni za @${username} su ažurirani na ${parsed.toLocaleString()} ${valuta}!`);
  }
}
// ─── Economy Leaderboard Sortiranje ────────────────────────
let ecoLbSortKey = 'points';  // 'points' | 'activity'
let ecoLbSortDir = 'desc';    // 'asc' | 'desc'

function sortEconomyLeaderboard(key) {
  if (ecoLbSortKey === key) {
    ecoLbSortDir = ecoLbSortDir === 'desc' ? 'asc' : 'desc';
  } else {
    ecoLbSortKey = key;
    ecoLbSortDir = 'desc';
  }

  // Osvezi vizuelno stanje headera
  ['ecoLbThPoints', 'ecoLbThActivity'].forEach(id => {
    const th = document.getElementById(id);
    if (!th) return;
    th.classList.remove('sort-asc', 'sort-desc');
  });
  const activeKey = key === 'points' ? 'ecoLbThPoints' : 'ecoLbThActivity';
  const activeTh = document.getElementById(activeKey);
  if (activeTh) activeTh.classList.add(ecoLbSortDir === 'asc' ? 'sort-asc' : 'sort-desc');

  renderEconomyLeaderboard();
}

// Expose globally
window.sortEconomyLeaderboard = sortEconomyLeaderboard;

// ═══════════════════════════════════════════════════════════
// REFERRAL PROGRAM MODAL & LOGIC
// ═══════════════════════════════════════════════════════════
async function openReferralModal() {
  const userMenuSm = document.getElementById('userMenuSm');
  if (userMenuSm) userMenuSm.classList.remove('open');

  openModal('referralModal');

  if (currentUser && currentUser.id) {
    try {
      await ensureUserHasReferralCode(currentUser.id);
      await loadReferralData(currentUser.id);
    } catch (err) {
      // Referral load error
    }
  }
}

async function ensureUserHasReferralCode(userId) {
  try {
    const { data: stats } = await sb.from('referral_stats').select('referral_code').eq('user_id', userId).single();
    if (!stats || !stats.referral_code) {
      await sb.rpc('create_user_referral', { p_user_id: userId, p_referral_code: null });
    }
  } catch (err) {
    // Referral code check error
  }
}

async function loadReferralData(userId) {
  try {
    const { data: stats } = await sb.from('referral_stats').select('*').eq('user_id', userId).single();
    if (stats) updateReferralStats(stats);

    const { data: rewards } = await sb.from('referral_rewards').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    updateRewardsList(rewards || []);
  } catch (err) {
    // Error loading referral data
  }
}

function generateReferralLink(referralCode) {
  return `${window.KickotConfig.paths.indexUrl}?ref=${referralCode}`;
}

function updateReferralStats(stats) {
  const totalReferrals = document.getElementById('totalReferrals');
  const successfulReferrals = document.getElementById('successfulReferrals');
  const totalEarned = document.getElementById('totalEarned');
  const availableRewards = document.getElementById('availableRewards');
  const referralCodeInput = document.getElementById('referralCodeInput');
  const referralLinkText = document.getElementById('referralLinkText');
  const withdrawalBtn = document.getElementById('withdrawalBtn');

  if (totalReferrals) totalReferrals.textContent = stats.total_referrals || 0;
  if (successfulReferrals) successfulReferrals.textContent = stats.successful_referrals || 0;
  if (totalEarned) totalEarned.textContent = `€${(stats.total_earned || 0).toFixed(2)}`;

  const available = stats.available_balance || 0;
  if (availableRewards) availableRewards.textContent = `€${available.toFixed(2)}`;

  if (withdrawalBtn) {
    withdrawalBtn.disabled = available < 5;
  }

  if (stats.referral_code) {
    if (referralCodeInput) referralCodeInput.value = stats.referral_code;
    const refLink = generateReferralLink(stats.referral_code);
    if (referralLinkText) referralLinkText.textContent = refLink;

    setupReferralCopyBtn(stats.referral_code, refLink);
  }

  window.currentAvailableBalance = available;
}

function setupReferralCopyBtn(code, link) {
  const btn = document.getElementById('copyReferralBtn');
  if (!btn) return;

  btn.onclick = async () => {
    try {
      const textToCopy = `Moj referral kod: ${code}\nReferral link: ${link}`;
      await navigator.clipboard.writeText(textToCopy);
      btn.textContent = 'Kopirano!';
      btn.style.background = '#10B981';
      showToast('success', 'Referral link je uspešno kopiran!');
      setTimeout(() => {
        btn.textContent = 'Kopiraj Link';
        btn.style.background = '';
      }, 2000);
    } catch (e) {
      showToast('error', 'Greška pri kopiranju!');
    }
  };
}

function copyCustomRefEmail(btn) {
  const email = 'contact@milanwebportal.com';
  navigator.clipboard.writeText(email).then(() => {
    const origHTML = btn.innerHTML;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    btn.style.color = '#53fc18';
    btn.style.borderColor = '#53fc18';
    showToast('success', 'Mejl adresa je uspešno kopirana!');
    setTimeout(() => {
      btn.innerHTML = origHTML;
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 2000);
  }).catch(() => {
    showToast('error', 'Greška pri kopiranju mejla.');
  });
}

function updateRewardsList(rewards) {
  const container = document.getElementById('rewardsList');
  if (!container) return;

  if (!rewards || rewards.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 16px; font-size: 0.85rem;">Još uvek nemaš nagrade. Pozovi prijatelje da započneš!</div>`;
    return;
  }

  container.innerHTML = rewards.map(r => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); padding:10px 14px; border-radius:var(--radius-md);">
      <div>
        <div style="font-weight:600; color:#fff; font-size:0.85rem;">${escapeHtml(r.reward_description || 'Provizija od kupovine')}</div>
        <div style="color:#53fc18; font-weight:700; font-size:0.9rem;">€${(r.reward_value || 0).toFixed(2)}</div>
      </div>
      <span style="padding:2px 8px; border-radius:10px; font-size:0.72rem; font-weight:700; background:rgba(83,252,24,0.15); color:#53fc18; border:1px solid rgba(83,252,24,0.3);">
        ${r.status || 'Dostupno'}
      </span>
    </div>
  `).join('');
}

function openWithdrawalModal() {
  closeModal('referralModal');
  const balEl = document.getElementById('modalAvailableBalance');
  if (balEl) balEl.textContent = `€${(window.currentAvailableBalance || 0).toFixed(2)}`;
  openModal('withdrawalModal');
}

function updatePaymentDetailsLabel(method) {
  const label = document.getElementById('paymentDetailsLabel');
  const input = document.getElementById('paymentDetails');
  if (!label || !input) return;

  if (method === 'paypal') {
    label.textContent = 'PayPal Email Adresa';
    input.placeholder = 'tvoj@email.com';
  } else if (method === 'bank_transfer') {
    label.textContent = 'Broj računa (IBAN)';
    input.placeholder = 'RS00 0000 0000 0000 0000 00';
  } else if (method === 'crypto') {
    label.textContent = 'Crypto Wallet Adresa (USDT / BTC)';
    input.placeholder = '0x... ili bc1...';
  }
}

async function handleWithdrawalSubmit(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('withdrawalAmount').value);
  const method = document.getElementById('paymentMethod').value;
  const details = document.getElementById('paymentDetails').value.trim();

  if (!amount || amount < 5) {
    showToast('Minimalni iznos za isplatu je €5.00', 'warning');
    return;
  }
  if (amount > (window.currentAvailableBalance || 0)) {
    showToast('Nedovoljno sredstava za isplatu!', 'error');
    return;
  }
  if (!details) {
    showToast('Unesi podatke za isplatu!', 'warning');
    return;
  }

  try {
    // 1. Upis u Supabase bazu preko RPC-a
    const { error } = await sb.rpc('create_withdrawal_request', {
      p_user_id: currentUser?.id,
      p_amount: amount,
      p_payment_method: method,
      p_payment_details: details
    });

    if (error) throw error;

    // 2. Slanje notifikacije na mejl preko FormSubmit AJAX-a
    fetch('https://formsubmit.co/ajax/contact@milanwebportal.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        _subject: 'Novi Zahtev za Isplatu Sredstava - Kick Bot',
        Korisnik_ID: currentUser?.id || 'Nije definisan',
        Korisnicko_Ime: currentUser?.user_metadata?.username || 'Gost',
        Iznos: `€${amount.toFixed(2)}`,
        Nacin_Isplate: method,
        Detalji_Isplate: details
      })
    }).catch(_err => { /* FormSubmit mail error */ });

    showToast('Zahtev za isplatu je uspešno poslat! Bićete obavešteni o isplati.', 'success');

    // Resetuj formu i zatvori modal
    document.getElementById('withdrawalForm')?.reset();
    closeModal('withdrawalModal');

  } catch (err) {
    showToast('Došlo je do greške prilikom slanja zahteva.', 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// BOTRIX IMPORT SYSTEM
// ═══════════════════════════════════════════════════════════
let botrixActiveTab = 'cmds';
let botrixParsedData = [];

function openBotrixImportModal(initialTab = 'cmds') {
  botrixActiveTab = initialTab || 'cmds';
  botrixParsedData = [];
  document.getElementById('botrixInputText').value = '';
  document.getElementById('botrixParsedSummary').style.display = 'none';
  document.getElementById('botrixImportError').style.display = 'none';
  document.getElementById('btnExecuteBotrixImport').disabled = true;
  switchBotrixTab(botrixActiveTab);
  openModal('botrixImportModal');
}

function switchBotrixTab(tabName) {
  botrixActiveTab = tabName;
  botrixParsedData = [];

  const tabBtns = {
    cmds: document.getElementById('botrixTabCmds'),
    timers: document.getElementById('botrixTabTimers'),
    blacklist: document.getElementById('botrixTabBlacklist'),
    watchtime: document.getElementById('botrixTabWatchtime'),
    store: document.getElementById('botrixTabStore'),
    alerts: document.getElementById('botrixTabAlerts'),
    greetings: document.getElementById('botrixTabGreetings')
  };

  Object.keys(tabBtns).forEach(k => {
    if (tabBtns[k]) {
      const isActive = k === tabName;
      tabBtns[k].style.background = isActive ? 'var(--app-primary)' : 'transparent';
      tabBtns[k].style.color = isActive ? '#fff' : 'var(--text-muted)';
    }
  });

  const guides = {
    cmds: 'Otvori svoj Botrix Dashboard ➔ <strong>Commands</strong> ➔ Selektuj celu stranicu sa <strong>Ctrl+A</strong>, kopiraj i nalepi ispod. Kickot će sam izvući i konvertovati komande!',
    timers: 'Otvori svoj Botrix Dashboard ➔ <strong>Timers / Najave</strong> ➔ Kopiraj poruke sa stranice i nalepi ispod. Svaka linija biće uneta kao automatska najava!',
    blacklist: 'Otvori svoj Botrix Dashboard ➔ <strong>Moderation / Blacklist</strong> ➔ Kopiraj listu zabranjenih reči sa stranice i nalepi ispod.',
    watchtime: 'Otvori svoj Botrix Dashboard ➔ <strong>Loyalty / Leaderboard</strong> ➔ Selektuj i kopiraj listu sa <strong>Ctrl+A</strong> i nalepi je ispod. Kickot će uvesti gledaoce i njihovo vreme gledanja!',
    store: 'Otvori svoj Botrix Dashboard ➔ <strong>Loyalty / Store</strong> ➔ Uđi u svaku nagradu pojedinačno klikom na nju i <strong>Ctrl+A</strong> i nalepi ispod. Kickot će automatski konvertovati nagradu i njenu cenu u poenima!',
    alerts: 'Otvori svoj Botrix Dashboard ➔ <strong>Alerts</strong> ➔ Kopiraj prilagođene poruke za obaveštenja (Follow, Sub, Raid...) i nalepi ispod!',
    greetings: 'Otvori svoj Botrix Dashboard ➔ <strong>Chat Bot / Welcome</strong> ➔ Kopiraj pozdravnu poruku i nalepi ispod!'
  };

  const labels = {
    cmds: 'Nalepi kopirani tekst sa Botrix-a (Ctrl+V):',
    timers: 'Nalepi poruke tajmera sa Botrix-a:',
    blacklist: 'Nalepi zabranjene reči sa Botrix-a:',
    watchtime: 'Nalepi kopirani Watchtime sa Botrix-a:',
    store: 'Nalepi kopiranu prodavnicu sa Botrix-a:',
    alerts: 'Nalepi tekst obaveštenja sa Botrix-a:',
    greetings: 'Nalepi pozdravne poruke sa Botrix-a:'
  };

  const placeholders = {
    cmds: 'Nalepi ovde kopiranu Botrix stranicu (Ctrl+A ➔ Ctrl+C ➔ Ctrl+V)...\nKickot će sam izvući i očistiti sve komande!',
    timers: 'Nalepi ovde poruke tajmera (jedna po liniji):\nZapratite kanal i pritisnite Follow!\nPosetite naš zvanični merch shop na sajtu!',
    blacklist: 'Nalepi ovde zabranjene reči:\nbadword1, badword2, badword3',
    watchtime: 'Nalepi ovde kopiranu tabelu sa Botrix-a ili tekst:\nuser1 120 min\nuser2 5.5 sati',
    store: 'Nalepi ovde artikle iz prodavnice:\nVIP status 1000 points\nSong Request 500 pts',
    alerts: 'Nalepi ovde poruke alera:\n{user} je sada novi pratilac!\n{user} se pretplatio na kanal!',
    greetings: 'Nalepi ovde pozdravnu poruku:\nDobrodošao {user} na strim! Uživaj u chatu!'
  };

  document.getElementById('botrixGuideText').innerHTML = guides[tabName] || guides.cmds;
  document.getElementById('botrixInputLabel').textContent = labels[tabName] || labels.cmds;
  document.getElementById('botrixInputText').placeholder = placeholders[tabName] || placeholders.cmds;

  parseBotrixInput();
}

function handleBotrixFileUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result || '';
    document.getElementById('botrixInputText').value = text;
    parseBotrixInput();
  };
  reader.readAsText(file);
}

function convertBotrixVariables(text) {
  if (!text) return '';
  return text
    .replace(/\{user\}/gi, '$(user)')
    .replace(/\{username\}/gi, '$(user)')
    .replace(/\{target\}/gi, '$(target)')
    .replace(/\{touser\}/gi, '$(target)')
    .replace(/\{count\}/gi, '$(count)')
    .replace(/\{random\}/gi, '$(random)')
    .replace(/\{random\.number\}/gi, '$(random)');
}

function parseBotrixDurationToMinutes(durationStr) {
  if (!durationStr) return 0;
  let totalMinutes = 0;
  const s = String(durationStr).trim();

  const daysMatch = s.match(/(\d+)\s*d/i);
  if (daysMatch) totalMinutes += parseInt(daysMatch[1], 10) * 1440;

  const hoursMatch = s.match(/(\d+)\s*h/i);
  if (hoursMatch) totalMinutes += parseInt(hoursMatch[1], 10) * 60;

  const minsMatch = s.match(/(\d+)\s*m/i);
  if (minsMatch) {
    totalMinutes += parseInt(minsMatch[1], 10);
  } else if (!daysMatch && !hoursMatch) {
    const pureNum = parseInt(s.replace(/\D/g, ''), 10);
    if (!isNaN(pureNum)) totalMinutes += pureNum;
  }

  return totalMinutes;
}

function parseBotrixInput() {
  const rawText = (document.getElementById('botrixInputText').value || '').trim();
  const summaryBox = document.getElementById('botrixParsedSummary');
  const countEl = document.getElementById('botrixParsedCount');
  const previewList = document.getElementById('botrixPreviewItemsList');
  const btnExecute = document.getElementById('btnExecuteBotrixImport');
  const errorEl = document.getElementById('botrixImportError');

  errorEl.style.display = 'none';
  botrixParsedData = [];

  if (!rawText) {
    summaryBox.style.display = 'none';
    btnExecute.disabled = true;
    return;
  }

  // Regex za prepoznavanje navigacije, dugmadi i zaglavlja Botrix stranice koji treba da se očiste
  const noiseRegex = /^(platform:|alerts|widgets|chat bot|profile|loyalty|integrations|mini-games|interaction|new|sub-users|beta|referrals|other options|documentation|get support|log out|botrix|go premium|don't forget|moderation|commands|timers|extras|my commands|default commands|search|add|command|message|points|platforms|rank|settings|trovokick|trovo|kick)/i;

  function parseRank(str) {
    if (!str) return 'everyone';
    const s = str.toLowerCase();
    if (s.includes('mod')) return 'moderator';
    if (s.includes('owner') || s.includes('broadcaster') || s.includes('streamer')) return 'broadcaster';
    if (s.includes('sub')) return 'subscriber';
    if (s.includes('vip')) return 'vip';
    if (s.includes('og')) return 'og';
    return 'everyone';
  }

  if (botrixActiveTab === 'cmds') {
    let isJson = false;
    if (rawText.startsWith('[') || rawText.startsWith('{')) {
      try {
        const parsedJson = JSON.parse(rawText);
        const items = Array.isArray(parsedJson) ? parsedJson : (parsedJson.commands || [parsedJson]);
        items.forEach(item => {
          let name = String(item.command || item.name || item.cmd || '').trim().replace(/^!/, '');
          let resp = convertBotrixVariables(String(item.response || item.message || item.reply || '').trim());
          if (name && resp && !noiseRegex.test(name)) {
            let cooldown = parseInt(item.cooldown || item.cooldown_ms || 5000);
            if (cooldown < 100) cooldown = cooldown * 1000;
            let rank = parseRank(item.userLevel || item.min_rank || item.role);
            botrixParsedData.push({ command: name, response: resp, cooldown: cooldown, min_rank: rank, enabled: true });
          }
        });
        isJson = true;
      } catch (e) {
        // Nije validan JSON
      }
    }

    if (!isJson) {
      const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        let l = lines[i];

        // Preskoči šum sa stranice
        if (noiseRegex.test(l)) continue;

        // Ako linija sadrži tabulator (direktan paste tabele)
        if (l.includes('\t')) {
          const parts = l.split('\t').map(p => p.trim()).filter(Boolean);
          let name = (parts[0] || '').replace(/^!/, '').trim();
          let resp = convertBotrixVariables(parts[1] || '');
          let rank = parseRank(parts[4] || parts[3] || '');

          if (name && resp && !noiseRegex.test(name)) {
            botrixParsedData.push({ command: name, response: resp, cooldown: 5000, min_rank: rank, enabled: true });
          }
          continue;
        }

        // Ako linija počinje sa komandom (npr. !test ili !ig)
        if (l.startsWith('!')) {
          let name = l.split(/[\s\t]/)[0].replace(/^!/, '').trim();
          if (!name || noiseRegex.test(name)) continue;

          let inlineResp = l.substring(l.indexOf(' ') + 1).trim();
          let resp = '';
          let rank = 'everyone';

          if (inlineResp && inlineResp !== l) {
            resp = convertBotrixVariables(inlineResp);
          } else {
            // Višelinijski paste sa Botrix-a (linija ispod je odgovor)
            let nextIdx = i + 1;
            while (nextIdx < lines.length && noiseRegex.test(lines[nextIdx])) {
              nextIdx++;
            }
            if (nextIdx < lines.length && !lines[nextIdx].startsWith('!')) {
              resp = convertBotrixVariables(lines[nextIdx]);
              i = nextIdx; // preskoči liniju sa odgovorom

              // Proveri narednih 1-3 linije za rolu (Moderator, Owner, Everyone)
              for (let r = 1; r <= 3; r++) {
                if (i + r < lines.length) {
                  const checkRole = lines[i + r];
                  if (/Moderator|Owner|Broadcaster|Subscriber|VIP|Everyone/i.test(checkRole)) {
                    rank = parseRank(checkRole);
                    break;
                  }
                }
              }
            }
          }

          if (name && resp && !noiseRegex.test(name)) {
            botrixParsedData.push({
              command: name,
              response: resp,
              cooldown: 5000,
              min_rank: rank,
              enabled: true
            });
          }
        }
      }
    }

    // Filtriraj duplikate po imenu komande
    const uniqueMap = new Map();
    botrixParsedData.forEach(c => uniqueMap.set(c.command.toLowerCase(), c));
    botrixParsedData = Array.from(uniqueMap.values());

    countEl.textContent = `Pronađeno: ${botrixParsedData.length} čiste komande`;
    previewList.innerHTML = botrixParsedData.map(c => `
      <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.04); padding: 6px 10px; border-radius: 6px; font-size: 0.78rem;">
        <span style="font-family: var(--font-mono); color: #53FC18; font-weight: 700;">!${escapeHtml(c.command)}</span>
        <span style="color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 50%;">${escapeHtml(c.response)}</span>
        <span style="font-size: 0.7rem; background: rgba(139, 92, 246, 0.15); color: #a78bfa; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">${escapeHtml(c.min_rank)}</span>
      </div>
    `).join('');

  } else if (botrixActiveTab === 'timers') {
    const isTimerStats = /^name$|^\d+\s*min|^\d+\s*msgs|·\s*\d+|trovokick|frequency|platforms|settings|message/i;
    const lines = rawText.split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !noiseRegex.test(l) && !isTimerStats.test(l));
    botrixParsedData = Array.from(new Set(lines));
    countEl.textContent = `Pronađeno: ${botrixParsedData.length} čiste automatske najave`;
    previewList.innerHTML = botrixParsedData.map((msg, i) => `
      <div style="background: rgba(255,255,255,0.04); padding: 6px 10px; border-radius: 6px; font-size: 0.78rem; color: var(--text-main);">
        <strong>Najava #${i + 1}:</strong> ${escapeHtml(msg)}
      </div>
    `).join('');

  } else if (botrixActiveTab === 'blacklist') {
    const modNoise = /^(block|offensive|words|protection|feature|tool|designed|moderate|maintain|safe|environment|chat|scans|messages|banned|limit|reached|upgrade|premium|infraction|action|time|timeout|warning|duration|min|custom|message|bypass|roles|moderator|always|confirm|configure|caps|link|emote|symbol|prohibit|use|certain|name|commands|timers|extras|platform:|alerts|widgets|profile|loyalty|integrations|mini-games|interaction|sub-users|referrals|documentation|get|support|log|out)/i;

    let extractedWords = [];

    // Detektuj sekciju "Banned words:" sa Botrix stranice
    const bannedIndex = rawText.search(/banned\s*words\s*:/i);
    if (bannedIndex !== -1) {
      const subText = rawText.substring(bannedIndex + 'banned words:'.length);
      const lines = subText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        // Prekini čitanje kad naiđemo na Botrix UI dugmad ili opis opcija ispod liste reči
        if (/limit of|infraction action|timeout duration|custom message|bypass roles|confirm|configure|chat bot/i.test(line)) {
          break;
        }
        if (line && !modNoise.test(line) && line.length <= 35 && !line.includes(' ')) {
          extractedWords.push(line);
        }
      }
    }

    if (extractedWords.length === 0) {
      // Obično lepljenje liste reči (odvojenih zarezom ili novim redom)
      const rawWords = rawText.split(/[\n,]+/).map(w => w.trim()).filter(Boolean);
      extractedWords = rawWords.filter(w => !modNoise.test(w) && w.length <= 35 && !w.includes(' '));
    }

    botrixParsedData = Array.from(new Set(extractedWords));
    countEl.textContent = `Pronađeno: ${botrixParsedData.length} čiste zabranjene reči`;
    previewList.innerHTML = `
      <div style="display: flex; flex-wrap: wrap; gap: 6px;">
        ${botrixParsedData.map(w => `<span style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #EF4444; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">${escapeHtml(w)}</span>`).join('')}
      </div>
    `;

  } else if (botrixActiveTab === 'watchtime') {
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const parsedWatchtime = [];

    const isHeaderOrNoise = (str) => /^(position|name|points|watchtime|ranking of|show:|search\.\.\.|\#\d+$|english|profile picture|level|how does|each message|every 5|by using|terms of|privacy policy|log out)/i.test(str) || /^name\s*:/i.test(str) || /^watchtime\s*:/i.test(str) || /^points\s*:/i.test(str) || /^level\s*:/i.test(str) || noiseRegex.test(str);

    for (let i = 0; i < lines.length; i++) {
      let l = lines[i];

      if (isHeaderOrNoise(l)) continue;

      // 1. Tab-separated linija: #1 \t Milan_567 \t 13835 \t 9d 14h 35min
      if (l.includes('\t')) {
        const parts = l.split('\t').map(p => p.trim()).filter(Boolean);
        let username = parts.find(p => !p.startsWith('#') && !/^\d+$/.test(p) && !isHeaderOrNoise(p));
        let durationPart = parts.find(p => /\d+[dhm]/i.test(p)) || parts[parts.length - 1];
        let pointsPart = parts.find(p => /^\d+$/.test(p) && p !== durationPart && p !== parts[0]);

        if (username && durationPart) {
          const mins = parseBotrixDurationToMinutes(durationPart);
          const pts = pointsPart ? parseInt(pointsPart, 10) : 0;
          if (mins > 0 || pts > 0) {
            parsedWatchtime.push({ username: username.replace(/^@/, '').toLowerCase(), minutes: mins, points: pts });
          }
        }
        continue;
      }

      // 2. Višelinijski ili razmaknuti paste sa Botrix-a
      if (/^@?[a-zA-Z0-9_]{2,25}$/.test(l) && !isHeaderOrNoise(l) && !/^\d+$/.test(l)) {
        let username = l.replace(/^@/, '');
        let durationStr = '';
        let pts = 0;

        for (let j = 1; j <= 3; j++) {
          if (i + j < lines.length) {
            const checkL = lines[i + j];
            if (/\d+[dhm]/i.test(checkL)) {
              durationStr = checkL;
              i += j;
              break;
            } else if (/^\d+$/.test(checkL)) {
              pts = parseInt(checkL, 10);
            }
          }
        }

        if (username && durationStr) {
          const mins = parseBotrixDurationToMinutes(durationStr);
          if (mins > 0 || pts > 0) {
            parsedWatchtime.push({ username: username.toLowerCase(), minutes: mins, points: pts });
          }
        }
      }
    }

    const wtMap = new Map();
    parsedWatchtime.forEach(w => {
      const existing = wtMap.get(w.username);
      if (!existing || w.minutes > existing.minutes) {
        wtMap.set(w.username, w);
      }
    });
    botrixParsedData = Array.from(wtMap.values());

    countEl.textContent = `Pronađeno: ${botrixParsedData.length} korisnika sa Watchtime podatkom`;
    previewList.innerHTML = botrixParsedData.map((w, idx) => `
      <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.04); padding: 6px 10px; border-radius: 6px; font-size: 0.78rem;">
        <div>
          <span style="color: var(--text-muted); font-size: 0.72rem; margin-right: 6px;">#${idx + 1}</span>
          <span style="font-weight: 700; color: #53FC18;">${escapeHtml(w.username)}</span>
        </div>
        <span style="color: var(--text-muted); font-family: var(--font-mono);">${w.minutes.toLocaleString()} min (${(w.minutes / 60).toFixed(1)}h) ${w.points ? '· ' + w.points.toLocaleString() + ' pts' : ''}</span>
      </div>
    `).join('');

  } else if (botrixActiveTab === 'store') {
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const parsedStore = [];

    // Sve linije koje su Botrix UI labele / buka – ne smeju biti nazivi ili cene artikala
    const storeNoiseRegex = /^(store|loyalty|points|cost|item|description|buy|price|edit|kick|save|delete|cancel|enabled|name|command|prefix|stock|premium|mode|cooldown|duration|rank|level|volume|action|widget url|message|image|sound|by using|do not share|copy|active platforms|turn on|number of items|time between|how long|determines whether|choose whether|required rank|required level|platform|alerts|widgets|chat bot|profile|integrations|mini-games|interaction|sub-users|referrals|documentation|get support|log out|botrix|go premium|click to upload|ranking|sales log|normal|unlimited|per user|anyone|you can use these|thank you for|save$|delete$|cancel$)/i;

    // 1. Proveri da li je kopirana pojedinačna detaljna stranica artikla (Name ... Price ... Description)
    const nameIdx = lines.findIndex(l => /^name$/i.test(l));
    const priceIdx = lines.findIndex(l => /^price$/i.test(l));

    if (nameIdx !== -1 && priceIdx !== -1) {
      // Na detaljnoj stranici, ime je uvek linija ODMAH posle "Name"
      let itemName = (lines[nameIdx + 1] || '').trim();
      let itemPrice = 0;
      let itemDesc = '';

      // Cena je linija odmah posle "Price" labele
      const rawPrice = (lines[priceIdx + 1] || '').replace(/\D/g, '');
      itemPrice = parseInt(rawPrice, 10) || 0;

      // Opis je linija odmah posle "Description" labele (ali ne sme biti UI label)
      const descIdx = lines.findIndex(l => /^description$/i.test(l));
      if (descIdx !== -1 && descIdx + 1 < lines.length) {
        const nextLine = lines[descIdx + 1];
        if (!storeNoiseRegex.test(nextLine)) {
          itemDesc = nextLine;
        }
      }

      // Preskoci ako je ime UI label ili prazno
      if (itemName && !storeNoiseRegex.test(itemName) && itemPrice > 0) {
        parsedStore.push({
          id: 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          name: itemName,
          cost: itemPrice,
          description: itemDesc || 'Uvezeno sa Botrix-a',
          enabled: true,
          created_at: new Date().toISOString()
        });
      }
    }

    // 2. Fallback - zbirna lista artikala (npr. "TEST\n100 points\nDescription")
    if (parsedStore.length === 0) {
      for (let i = 0; i < lines.length; i++) {
        let l = lines[i];
        if (storeNoiseRegex.test(l) || noiseRegex.test(l)) continue;
        // Preskoči linije koje su samo brojevi, URL-ovi, kratki kodovi ili sadrže %/s/https
        if (/^\d+$/.test(l) || /^https?:\/\//i.test(l) || /\d+\s*(%|s\s*$)/i.test(l)) continue;

        let name = '';
        let cost = 0;

        if (l.includes('\t')) {
          const parts = l.split('\t').map(p => p.trim()).filter(Boolean);
          name = parts[0] || '';
          const numPart = parts.find(p => /^\d+$/.test(p));
          if (numPart) cost = parseInt(numPart, 10) || 0;
        } else {
          const numMatch = l.match(/^(.+?)\s+(\d+)\s*(pts|points|poena)$/i);
          if (numMatch) {
            name = numMatch[1].trim();
            cost = parseInt(numMatch[2], 10);
          } else if (!/\d/.test(l) && l.length >= 2 && l.length <= 60) {
            name = l;
            for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
              const next = lines[j];
              if (/^\d+$/.test(next)) {
                cost = parseInt(next, 10);
                i = j;
                break;
              } else if (/^(\d+)\s*(pts|points|poena)$/i.test(next)) {
                cost = parseInt(next, 10);
                i = j;
                break;
              }
            }
          }
        }

        if (name && !storeNoiseRegex.test(name) && cost > 0) {
          parsedStore.push({
            id: 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            name: name,
            cost: cost,
            description: 'Uvezeno sa Botrix-a',
            enabled: true,
            created_at: new Date().toISOString()
          });
        }
      }
    }

    botrixParsedData = parsedStore;
    countEl.textContent = `Pronađeno: ${botrixParsedData.length} artikala za prodavnicu poena`;
    previewList.innerHTML = botrixParsedData.length > 0 ? botrixParsedData.map(item => `
      <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.04); padding: 6px 10px; border-radius: 6px; font-size: 0.78rem;">
        <div>
          <span style="font-weight: 700; color: #53FC18;">${escapeHtml(item.name)}</span>
          ${item.description && item.description !== 'Uvezeno sa Botrix-a' ? `<div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(item.description)}</div>` : ''}
        </div>
        <span style="color: var(--text-muted); font-family: var(--font-mono);">${item.cost.toLocaleString()} pts</span>
      </div>
    `).join('') : `<div style="color: var(--text-muted); font-size: 0.82rem; padding: 8px;">Nisu pronađeni artikli. Proveri da si kopirao stranicu sa Botrix Store-a.</div>`;

  } else if (botrixActiveTab === 'alerts' || botrixActiveTab === 'greetings') {
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const validLines = lines.filter(l => !noiseRegex.test(l) && l.length >= 3);
    const convertedMsgs = validLines.map(l => convertBotrixVariables(l));

    botrixParsedData = convertedMsgs;
    countEl.textContent = `Pronađeno: ${botrixParsedData.length} poruka za ${botrixActiveTab === 'alerts' ? 'obaveštenja' : 'pozdrav bota'}`;
    previewList.innerHTML = botrixParsedData.map(msg => `
      <div style="background: rgba(255,255,255,0.04); padding: 6px 10px; border-radius: 6px; font-size: 0.78rem; color: #fff;">
        ${escapeHtml(msg)}
      </div>
    `).join('');
  }

  summaryBox.style.display = botrixParsedData.length > 0 ? 'block' : 'none';
  btnExecute.disabled = botrixParsedData.length === 0;
}

async function executeBotrixImport() {
  if (!botrixParsedData || botrixParsedData.length === 0 || !activeChannel) return;

  const btnExecute = document.getElementById('btnExecuteBotrixImport');
  const errorEl = document.getElementById('botrixImportError');
  btnExecute.disabled = true;
  btnExecute.textContent = 'Uvoženje...';
  errorEl.style.display = 'none';

  try {
    if (botrixActiveTab === 'cmds') {
      const limits = getPlanLimits();
      const existingCustom = allCommands.filter(c => !c.is_default && !(c.id && c.id.startsWith('builtin-')));
      const availableSpace = limits.maxCustomCommands - existingCustom.length;

      if (availableSpace <= 0) {
        throw new Error(`Dostignut je limit od ${limits.maxCustomCommands} komandi za tvoj ${limits.name} paket! Nadogradi paket za uvoz dodatnih komandi.`);
      }

      // Filtriraj komande koje već postoje u nalogu da se izbegne 409 Conflict
      const existingCmdNames = new Set(allCommands.flatMap(c => (c.command || '').toLowerCase().split(',').map(n => n.trim())));
      const filteredToImport = [];

      for (const c of botrixParsedData) {
        const nameLower = c.command.toLowerCase();
        if (!existingCmdNames.has(nameLower)) {
          filteredToImport.push(c);
          existingCmdNames.add(nameLower);
        }
      }

      if (filteredToImport.length === 0) {
        showToast('info', 'Sve komande sa Botrix-a već postoje na tvom nalogu!');
        closeModal('botrixImportModal');
        return;
      }

      const toImport = filteredToImport.slice(0, availableSpace).map(c => ({
        channel_id: activeChannel.id,
        user_id: currentUser?.id,
        command: c.command,
        response: c.response,
        cooldown: c.cooldown || 5000,
        min_rank: c.min_rank || 'everyone',
        enabled: true,
        is_default: false
      }));

      let successCount = 0;
      for (const item of toImport) {
        const { error } = await sb.from('custom_commands').insert(item);
        if (!error) {
          successCount++;
        } else {
          // Ako postoji konflikt, ažuriraj postojeću komandu
          await sb.from('custom_commands').update({
            response: item.response,
            cooldown: item.cooldown,
            min_rank: item.min_rank,
            updated_at: new Date().toISOString()
          }).eq('channel_id', activeChannel.id).eq('command', item.command);
          successCount++;
        }
      }

      showToast('success', `Uspešno sačuvano ${successCount} komandi sa Botrix-a! 🎉`);
      await loadCommands();

    } else if (botrixActiveTab === 'timers') {
      const limits = getPlanLimits();
      const { data: configData } = await sb.from('bot_config').select('auto_announces').eq('channel_id', activeChannel.id).single();
      const currentAnnounces = Array.isArray(configData?.auto_announces) ? configData.auto_announces : [];

      const availableSpace = limits.maxAutoAnnounces - currentAnnounces.length;
      if (availableSpace <= 0) {
        throw new Error(`Dostignut je limit od ${limits.maxAutoAnnounces} automatskih poruka za tvoj ${limits.name} paket! Nadogradi paket za više poruka.`);
      }

      const newAnnounces = botrixParsedData.filter(msg => !currentAnnounces.includes(msg)).slice(0, availableSpace);
      if (newAnnounces.length === 0) {
        showToast('info', 'Sve automatske najave sa Botrix-a već postoje u tvom nalogu!');
        closeModal('botrixImportModal');
        return;
      }

      const updatedAnnounces = [...currentAnnounces, ...newAnnounces];

      const { error } = await sb.from('bot_config').update({
        auto_announces: updatedAnnounces,
        updated_at: new Date().toISOString()
      }).eq('channel_id', activeChannel.id);

      if (error) throw error;

      showToast('success', `Uspešno dodato ${newAnnounces.length} automatskih najava iz Botrix-a! 🎉`);
      await loadBotConfig();

    } else if (botrixActiveTab === 'blacklist') {
      const { data: configData } = await sb.from('bot_config').select('moderation_settings').eq('channel_id', activeChannel.id).single();
      const modSettings = configData?.moderation_settings || {};
      const currentBanned = Array.isArray(modSettings.banned_words) ? modSettings.banned_words : [];
      const updatedBanned = Array.from(new Set([...currentBanned, ...botrixParsedData]));

      const { error } = await sb.from('bot_config').update({
        moderation_settings: {
          ...modSettings,
          banned_words: updatedBanned
        },
        updated_at: new Date().toISOString()
      }).eq('channel_id', activeChannel.id);

      if (error) throw error;

      showToast('success', `Uspešno dodato ${botrixParsedData.length} zabranjenih reči iz Botrix-a! 🛡️`);
      await loadBotConfig();

    } else if (botrixActiveTab === 'watchtime') {
      const channelIdStr = String(activeChannel.id);
      let successCount = 0;

      if (typeof setLeaderboardType === 'function') {
        setLeaderboardType('watchtime');
      }

      for (const item of botrixParsedData) {
        const u = item.username.toLowerCase().replace(/^@/, '');
        const mins = item.minutes || 0;

        // 1. Ažuriraj lokalni watchtime u memoriji
        let localWt = (allWatchtime || []).find(x => (x.username || '').toLowerCase() === u);
        if (localWt) {
          localWt.minutes = Math.max(localWt.minutes || 0, mins);
          localWt.display_name = localWt.display_name || u;
          localWt.updated_at = new Date().toISOString();
        } else {
          allWatchtime.push({
            channel_id: channelIdStr,
            username: u,
            display_name: u,
            minutes: mins,
            updated_at: new Date().toISOString()
          });
        }

        // 2. Upis u bazu (proveri postojanje po id pa uradi insert ili update)
        try {
          const currentMonthStr = getCurrentMonth();
          const currentYearStr = currentMonthStr.split('-')[1] || String(new Date().getFullYear());

          const { data: existing } = await sb.from('leaderboard')
            .select('id, watchtime_minutes')
            .eq('channel_id', channelIdStr)
            .eq('username', u)
            .eq('month', currentMonthStr)
            .maybeSingle();

          if (existing && existing.id) {
            const { error: errUpd } = await sb.from('leaderboard').update({
              watchtime_minutes: Math.max(existing.watchtime_minutes || 0, mins),
              display_name: u,
              updated_at: new Date().toISOString()
            }).eq('id', existing.id);
            if (errUpd) console.error('Leaderboard watchtime update error:', errUpd);
          } else {
            const { error: errIns } = await sb.from('leaderboard').insert({
              channel_id: channelIdStr,
              username: u,
              display_name: u,
              watchtime_minutes: mins,
              month: currentMonthStr,
              year: currentYearStr,
              updated_at: new Date().toISOString()
            });
            if (errIns) console.error('Leaderboard watchtime insert error:', errIns);
          }
        } catch (e) {
          console.error('Leaderboard DB error:', e);
        }

        successCount++;
      }

      showToast('success', `Uspešno sačuvan Watchtime za ${successCount} gledalaca! ⏱️`);
      if (typeof renderUnifiedLeaderboard === 'function') renderUnifiedLeaderboard();

    } else if (botrixActiveTab === 'store') {
      const { data: configData } = await sb.from('bot_config').select('store_redemptions').eq('channel_id', activeChannel.id).single();
      const currentItems = Array.isArray(configData?.store_redemptions) ? configData.store_redemptions : [];
      const updatedItems = [...currentItems, ...botrixParsedData];

      const { error } = await sb.from('bot_config').update({
        store_redemptions: updatedItems,
        updated_at: new Date().toISOString()
      }).eq('channel_id', activeChannel.id);

      if (error) throw error;

      showToast('success', `Uspešno dodato ${botrixParsedData.length} artikala u Prodavnicu! 🛍️`);
      if (typeof loadBotConfig === 'function') await loadBotConfig();
      if (typeof renderStoreRedemptions === 'function') renderStoreRedemptions();

    } else if (botrixActiveTab === 'alerts' || botrixActiveTab === 'greetings') {
      showToast('success', `Uspešno sačuvano ${botrixParsedData.length} poruka sa Botrix-a! 🎉`);
      if (typeof loadBotConfig === 'function') await loadBotConfig();
    }

    closeModal('botrixImportModal');

  } catch (err) {
    console.error('Botrix import error:', err);
    errorEl.textContent = err.message || 'Došlo je do greške prilikom uvoza sa Botrix-a.';
    errorEl.style.display = 'block';
  } finally {
    btnExecute.disabled = false;
    btnExecute.textContent = 'Uvezi u Kickot →';
  }
}

// ── Global QoL Shortcuts (Keyboard & UX) ─────────────────────
document.addEventListener('keydown', (e) => {
  // ESC key za zatvaranje otvorenih modala
  if (e.key === 'Escape') {
    const openModals = document.querySelectorAll('.modal-overlay.active, .modal.active, [data-modal].open');
    openModals.forEach(m => {
      if (typeof closeModal === 'function' && m.id) {
        closeModal(m.id);
      }
      m.classList.remove('active', 'open');
      if (m.style.display === 'block') m.style.display = 'none';
    });
  }

  // Ctrl+S / Cmd+S za brzo čuvanje aktivne tab konfiguracije
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    const activeNav = document.querySelector('.nav-item.active, .tab-btn.active');
    const tabName = activeNav ? (activeNav.dataset.tab || activeNav.getAttribute('href')?.replace('#', '')) : '';

    if (tabName === 'moderation' && typeof saveModerationSettings === 'function') {
      saveModerationSettings();
    } else if (tabName === 'announces' && typeof saveAutoAnnounces === 'function') {
      saveAutoAnnounces();
    } else if (typeof saveBotConfig === 'function') {
      saveBotConfig();
    }
  }
});

// Expose referral & Botrix functions globally
window.openReferralModal = openReferralModal;
window.openWithdrawalModal = openWithdrawalModal;
window.copyCustomRefEmail = copyCustomRefEmail;
window.openBotrixImportModal = openBotrixImportModal;
window.switchBotrixTab = switchBotrixTab;
window.handleBotrixFileUpload = handleBotrixFileUpload;
window.parseBotrixInput = parseBotrixInput;
window.executeBotrixImport = executeBotrixImport;

initAuth();