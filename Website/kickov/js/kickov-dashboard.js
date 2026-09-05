/**
 * ================================================================
 * KICKOV ALERT STUDIO — Glavna Klijentska Skripta
 * Integrisano sa Supabase, Realtime WebSocket & OBS Browser Source
 * Ekosistem: KickALL (Kickot, Kickaj, Kickan, Kickov)
 * Auth & Channel Manager: identicno Kickaj / Kickan
 * ================================================================
 */

(function () {
  'use strict';

  /* ── Supabase Konfiguracija ── */
  const supabaseUrl     = window.CONFIG?.SUPABASE?.URL;
  const supabaseAnonKey = window.CONFIG?.SUPABASE?.ANON_KEY;
  const storageKey      = window.CONFIG?.SUPABASE?.STORAGE_KEY || 'kickbot-supabase-auth';

  /* ── Supabase Init ── */
  let sb = null;

  if (window.supabase && supabaseUrl && supabaseAnonKey) {
    sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        storageKey: storageKey
      }
    });

    sb.auth.onAuthStateChange((event, _session) => {
      if (event === 'SIGNED_OUT') {
        const hasSavedToken = !!localStorage.getItem(storageKey);
        if (!hasSavedToken) {
          window.location.href = '../index.html?login=1';
        }
      }
    });

    if (window.CONFIG?.setupCrossTabSync) {
      window.CONFIG.setupCrossTabSync(sb, (newSession, eventType) => {
        if (!newSession || eventType === 'GLOBAL_LOGOUT' || eventType === 'SIGNED_OUT') {
          window.location.href = '../index.html?login=1';
        }
      });
    }
  }

  /* ── Globalno Stanje ── */
  let currentUser        = null;
  let currentUserProfile = null;
  let userPlan           = 'free';
  let userChannels       = []; // [{id, username, avatar, chatroom_id, is_primary, is_managed, role, owner_id, owner_plan}]
  let _activeChannelObj  = null;
  let channelName        = '';

  let obsToken        = '';
  let activeTab       = 'follower';
  let isMuted         = false;
  let testCount       = 0;
  let realtimeChannel = null;

  /* ── Helpers ── */
  function cleanUsername(raw) {
    if (!raw) return '';
    let s = String(raw).trim();
    if (s.startsWith('kick_user_')) s = s.replace(/^kick_user_/, '');
    if (s.includes('@')) s = s.split('@')[0];
    return s || '';
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function setMsg(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function showToast(message, type = 'success') {
    if (window.toastSystem) {
      if (typeof window.toastSystem[type] === 'function') { window.toastSystem[type](message); return; }
      if (typeof window.toastSystem.show === 'function')  { window.toastSystem.show(message, type); return; }
    }
    let c = document.getElementById('toastContainer');
    if (!c) { c = document.createElement('div'); c.id = 'toastContainer'; c.className = 'toast-container'; document.body.appendChild(c); }
    const t    = document.createElement('div');
    t.className = `toast toast-${type} show`;
    const icon  = type === 'error'
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#53fc18" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    t.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#0e0a20;border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-size:0.88rem;"><div>${icon}</div><div>${message}</div></div>`;
    c.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
  }

  /* ════════════════════════════════════════
     DEFAULT ALERT TEMPLATES
  ════════════════════════════════════════ */
  const DEFAULT_ALERT_TEMPLATES = {
    follower: {
      enabled: true, duration: 5, messageTemplate: '{name} je novi pratilac!',
      entryAnim: 'bounceIn', exitAnim: 'bounceOut',
      bgColor: '#120e26', accentColor: '#53fc18', textColor: '#ffffff', highlightColor: '#53fc18',
      mediaUrl: 'https://media.giphy.com/media/26tPplGWjN0xLybiU/giphy.gif',
      soundUrl: 'https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3',
      soundVolume: 80, ttsEnabled: true, ttsVoice: 'sr-RS', ttsVolume: 80, minAmount: 0
    },
    sub: {
      enabled: true, duration: 6, messageTemplate: '{name} se upravo pretplatio na kanal!',
      entryAnim: 'zoomIn', exitAnim: 'zoomOut',
      bgColor: '#150f2e', accentColor: '#9333ea', textColor: '#ffffff', highlightColor: '#c084fc',
      mediaUrl: 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif',
      soundUrl: 'https://assets.mixkit.co/active_storage/sfx/2018/2018-preview.mp3',
      soundVolume: 85, ttsEnabled: true, ttsVoice: 'sr-RS', ttsVolume: 80, minAmount: 0
    },
    gift_sub: {
      enabled: true, duration: 7, messageTemplate: '{name} je poklonio {count} pretplata gledaocima!',
      entryAnim: 'fadeIn', exitAnim: 'fadeOut',
      bgColor: '#10122e', accentColor: '#3b82f6', textColor: '#ffffff', highlightColor: '#60a5fa',
      mediaUrl: 'https://media.giphy.com/media/3o7TKMt1VVNkHV2PaE/giphy.gif',
      soundUrl: 'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3',
      soundVolume: 85, ttsEnabled: true, ttsVoice: 'sr-RS', ttsVolume: 80, minAmount: 1
    },
    host: {
      enabled: true, duration: 6, messageTemplate: '{name} donosi host sa {viewers} gledalaca!',
      entryAnim: 'slideDown', exitAnim: 'slideUp',
      bgColor: '#20160a', accentColor: '#f59e0b', textColor: '#ffffff', highlightColor: '#fbbf24',
      mediaUrl: 'https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif',
      soundUrl: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',
      soundVolume: 85, ttsEnabled: true, ttsVoice: 'sr-RS', ttsVolume: 80, minAmount: 1
    },
    kicks: {
      enabled: true, duration: 6, messageTemplate: '{name} je poslao {amount} KICK-ova!',
      entryAnim: 'bounceIn', exitAnim: 'bounceOut',
      bgColor: '#0e1f14', accentColor: '#53fc18', textColor: '#ffffff', highlightColor: '#53fc18',
      mediaUrl: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
      soundUrl: 'https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3',
      soundVolume: 90, ttsEnabled: true, ttsVoice: 'sr-RS', ttsVolume: 80, minAmount: 10
    },
    donation: {
      enabled: true, duration: 7, messageTemplate: '{name} je donirao {amount} EUR! "{message}"',
      entryAnim: 'flipInX', exitAnim: 'flipOutX',
      bgColor: '#230d1d', accentColor: '#ec4899', textColor: '#ffffff', highlightColor: '#f472b6',
      mediaUrl: 'https://media.giphy.com/media/3o6gDWzmAzrpi5DQU8/giphy.gif',
      soundUrl: 'https://assets.mixkit.co/active_storage/sfx/2018/2018-preview.mp3',
      soundVolume: 90, ttsEnabled: true, ttsVoice: 'sr-RS', ttsVolume: 80, minAmount: 1
    }
  };

  let alertSettings  = JSON.parse(JSON.stringify(DEFAULT_ALERT_TEMPLATES));
  let paypalSettings = { email: '', paypalMe: '' };

  /* ════════════════════════════════════════
     AUDIO & TTS
  ════════════════════════════════════════ */
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audioCtx = new AC(); }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function playSynthBeep(freq = 587.33, type = 'sine', duration = 0.25, volume = 0.15) {
    if (isMuted) return;
    try {
      const ctx = getAudioCtx(); if (!ctx) return;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + duration);
    } catch (_) {}
  }

  function playAlertAudio(soundUrl, volPct = 80) {
    if (isMuted) return;
    if (!soundUrl) { playSynthBeep(523.25, 'triangle', 0.4, 0.2); setTimeout(() => playSynthBeep(659.25, 'triangle', 0.4, 0.2), 150); return; }
    try { const a = new Audio(soundUrl); a.volume = Math.max(0, Math.min(1, volPct / 100)); a.play().catch(() => playSynthBeep()); } catch (_) { playSynthBeep(); }
  }

  function speakTTS(text, lang = 'sr-RS', volPct = 80) {
    if (isMuted || !('speechSynthesis' in window) || !text) return;
    try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = lang; u.volume = Math.max(0, Math.min(1, volPct / 100)); u.rate = 1.0; window.speechSynthesis.speak(u); } catch (_) {}
  }

  /* ════════════════════════════════════════
     INICIJALIZACIJA
  ════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', async () => {
    setupGlobalClickHandlers();
    await checkAuth();
    /* checkAuth postavlja channelName pa tek onda ucitavamo settings */
    loadSettingsFromStorage();
    generateOrLoadObsToken();
    renderConfigForm();
    updateLivePreview();
    updateActiveCardsMetric();
    initRealtimeChannel();
    loadNotifications();
    loadChangelogs();
  });

  /* ════════════════════════════════════════
     AUTH — identicno Kickaj / Kickan
  ════════════════════════════════════════ */
  window.hideAuthGate = function () {
    const gate = document.getElementById('authGate');
    const app  = document.getElementById('app');
    if (gate) { gate.classList.add('fade-out'); setTimeout(() => { gate.style.display = 'none'; }, 400); }
    if (app) app.classList.add('fade-in');
  };

  async function checkAuth() {
    if (!sb) {
      setMsg('authGateMsg', 'Preusmeravanje na prijavu...');
      setTimeout(() => { window.location.href = '../index.html?login=1'; }, 1200);
      return;
    }
    try {
      try {
        sessionStorage.setItem('from_kickall', 'true');
        sessionStorage.setItem('kick_origin_site', 'kickov');
        localStorage.setItem('kick_origin_site', 'kickov');
      } catch (e) { console.warn('Failed to set origin flags:', e); }

      const urlParams  = new URLSearchParams(window.location.search);
      const oauthError = urlParams.get('error');
      if (oauthError) {
        setMsg('authGateMsg', `Kick odbio autorizaciju: ${oauthError}`);
        showToast(`Kick odbio autorizaciju: ${oauthError}`, 'error');
        setTimeout(() => { window.location.href = '../index.html?login=1'; }, 2000);
        return;
      }

      const session = window.CONFIG?.getValidSessionWithRetry
        ? await window.CONFIG.getValidSessionWithRetry(sb, 3, 1500)
        : (await sb.auth.getSession())?.data?.session;

      if (!session?.user) {
        setMsg('authGateMsg', 'Preusmeravanje na prijavu...');
        setTimeout(() => { window.location.href = '../index.html?login=1'; }, 1200);
        return;
      }

      currentUser = session.user;
      let username  = currentUser.user_metadata?.kick_username
        || currentUser.user_metadata?.preferred_username
        || currentUser.user_metadata?.name
        || currentUser.user_metadata?.full_name
        || currentUser.email || '';
      let avatarUrl = currentUser.user_metadata?.avatar_url
        || currentUser.user_metadata?.picture
        || currentUser.user_metadata?.profile_picture;

      userChannels = [];

      try {
        let profile = null;
        if (currentUser?.id) {
          const { data: p1 } = await sb.from('user_profiles').select('*').eq('id', currentUser.id).maybeSingle();
          if (p1) profile = p1;
        }
        if (!profile && currentUser?.email) {
          const { data: p2 } = await sb.from('user_profiles').select('*').eq('email', currentUser.email).maybeSingle();
          if (p2) profile = p2;
        }
        if (!profile) {
          const kName = cleanUsername(currentUser?.user_metadata?.kick_username || currentUser?.user_metadata?.preferred_username || currentUser?.user_metadata?.name || username);
          if (kName && kName !== 'Kanal') {
            const { data: p3 } = await sb.from('user_profiles').select('*').ilike('kick_username', kName).maybeSingle();
            if (p3) profile = p3;
            if (!p3) {
              const { data: p4 } = await sb.from('user_profiles').select('*').ilike('display_name', kName).maybeSingle();
              if (p4) profile = p4;
            }
          }
        }

        if (profile) {
          currentUserProfile = profile;
          const rawPlan = String(profile.plan || profile.plan_tier || profile.subscription_tier || profile.tier || 'free').toLowerCase().trim();
          let tier = 'free';
          if (rawPlan.includes('elite') || rawPlan.includes('business')) tier = 'elite';
          else if (rawPlan.includes('pro')) tier = 'pro';
          userPlan = tier;

          const myUsername = profile.kick_username || profile.display_name || username;

          /* 1. Vlasnicki kanali */
          if (Array.isArray(profile.kick_channels)) {
            profile.kick_channels.forEach(ch => {
              const uName = cleanUsername(ch.username || ch.slug || ch.display_name || '');
              if (uName) {
                userChannels.push({
                  id: ch.id || null, username: uName, avatar: ch.avatar || ch.avatar_url || '',
                  chatroom_id: ch.chatroom_id || null, is_primary: !!ch.is_primary,
                  is_managed: false, role: 'owner', owner_id: currentUser.id, owner_plan: tier
                });
              }
            });
          }
          if (userChannels.length === 0 && profile.kick_username) {
            userChannels.push({
              id: profile.kick_user_id || null, username: cleanUsername(profile.kick_username),
              avatar: profile.avatar_url || '', chatroom_id: null, is_primary: true,
              is_managed: false, role: 'owner', owner_id: currentUser.id, owner_plan: tier
            });
          }

          /* 2. Managed kanali (RPC) */
          try {
            if (myUsername) {
              const { data: managedChannels, error: managedErr } = await sb.rpc('get_managed_kick_channels', { p_username: myUsername });
              if (managedErr) throw managedErr;
              if (Array.isArray(managedChannels)) {
                managedChannels.forEach(ch => {
                  const uName = cleanUsername(ch.username || ch.slug || '');
                  if (!uName) return;
                  userChannels.push({
                    id: ch.id || null, username: uName, avatar: ch.avatar || ch.avatar_url || '',
                    chatroom_id: ch.chatroom_id || null, is_primary: false, is_managed: true,
                    role: 'managed', owner_id: ch.owner_id || null, owner_plan: (ch.owner_plan || 'free').toLowerCase()
                  });
                });
              }
            }
          } catch (rpcErr) { console.warn('[Kickov] Managed RPC greska:', rpcErr); }

          /* Ucitaj settings iz baze ako postoje */
          if (profile.kickov_settings) {
            try {
              const sv = typeof profile.kickov_settings === 'string' ? JSON.parse(profile.kickov_settings) : profile.kickov_settings;
              if (sv && typeof sv === 'object') alertSettings = { ...DEFAULT_ALERT_TEMPLATES, ...sv };
            } catch (_) {}
          }
          if (profile.paypal_settings) {
            try {
              const ps = typeof profile.paypal_settings === 'string' ? JSON.parse(profile.paypal_settings) : profile.paypal_settings;
              if (ps) paypalSettings = { ...paypalSettings, ...ps };
            } catch (_) {}
          }
        }
      } catch (e) { console.warn('[Kickov] Profil greska:', e); }

      /* 3. Custom kanali iz LocalStorage */
      try {
        const customRaw = localStorage.getItem('kickov_custom_channels_list');
        if (customRaw) {
          const customList = JSON.parse(customRaw);
          if (Array.isArray(customList)) {
            customList.forEach(c => {
              const uName = cleanUsername(typeof c === 'string' ? c : c.username);
              if (uName && !userChannels.some(ex => ex.username.toLowerCase() === uName.toLowerCase())) {
                userChannels.push({
                  id: typeof c === 'object' ? c.id : null, username: uName,
                  avatar: typeof c === 'object' ? c.avatar || '' : '', chatroom_id: typeof c === 'object' ? c.chatroom_id : null,
                  is_primary: false, is_managed: false, role: 'custom', owner_id: currentUser?.id, owner_plan: userPlan
                });
              }
            });
          }
        }
      } catch (_) {}

      /* Dedupliciraj */
      const seen = new Set();
      userChannels = userChannels.filter(c => {
        const key = c.username.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });

      /* Odaberi inicijalni kanal */
      const savedId   = localStorage.getItem('kickbot_selected_channel_id');
      const savedName = localStorage.getItem('kickbot_selected_channel_name');
      let candidate   = null;
      if (savedName || savedId) {
        candidate = userChannels.find(c =>
          (savedId   && String(c.id) === String(savedId)) ||
          (savedName && c.username.toLowerCase() === savedName.toLowerCase())
        );
      }
      if (!candidate && userChannels.length > 0) candidate = userChannels.find(c => c.is_primary) || userChannels[0];

      if (candidate) {
        _activeChannelObj = candidate;
        username = candidate.username;
        if (candidate.avatar) avatarUrl = candidate.avatar;
      }

      channelName = cleanUsername(username) || 'Streamer';

      if (channelName && !userChannels.some(c => c.username.toLowerCase() === channelName.toLowerCase())) {
        userChannels.unshift({
          id: null, username: channelName, avatar: avatarUrl || '', chatroom_id: null,
          is_primary: true, is_managed: false, role: 'owner', owner_id: currentUser?.id, owner_plan: userPlan
        });
        _activeChannelObj = userChannels[0];
      }

      updateProfileUI(channelName, avatarUrl);
      updateConnectedChannelPill();
      renderChannelDropdown();

      const planBadge = document.getElementById('planBadge');
      if (planBadge) planBadge.textContent = userPlan.toUpperCase();

      migrateOldGifUrls();

      await new Promise(resolve => setTimeout(resolve, 300));
      window.hideAuthGate();
      document.body.classList.remove('auth-loading');
    } catch (err) {
      console.warn('[Kickov] Auth greska:', err);
      setMsg('authGateMsg', 'Preusmeravanje na prijavu...');
      setTimeout(() => { window.location.href = '../index.html?login=1'; }, 1200);
    }
  }

  /* ── Channel Dropdown Rendering — identicno Kickaj ── */
  function renderChannelDropdown() {
    const listEl  = document.getElementById('cdmChannelList');
    const badgeEl = document.getElementById('cdmCountBadge');
    if (badgeEl) badgeEl.textContent = userChannels.length;
    if (!listEl) return;

    if (userChannels.length === 0) {
      listEl.innerHTML = '<div class="cdm-empty">Nema pronađenih povezanih kanala.</div>';
      return;
    }

    const checkSvg = `<svg class="cdm-active-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
    let html = '';

    userChannels.forEach(ch => {
      const isActive    = ch.username.toLowerCase() === (channelName || '').toLowerCase();
      const initial     = ch.username.charAt(0).toUpperCase();
      const avatarSty   = ch.avatar ? `background-image: url('${ch.avatar}'); background-size: cover; background-position: center;` : '';
      let roleLabel = 'Vlasnik', roleClass = 'cdm-role-owner';
      if (ch.role === 'managed' || ch.is_managed) { roleLabel = 'Menadzer'; roleClass = 'cdm-role-managed'; }
      else if (ch.role === 'custom') { roleLabel = 'Dodat'; roleClass = 'cdm-role-custom'; }

      html += `
        <button type="button" class="cdm-item ${isActive ? 'active' : ''}" onclick="window.selectChannel('${escHtml(ch.username)}')">
          <div class="cdm-item-left">
            <div class="cdm-avatar" style="${avatarSty}">${ch.avatar ? '' : initial}</div>
            <div class="cdm-name-wrap">
              <span class="cdm-name">${escHtml(ch.username)}</span>
              <span class="cdm-role-badge ${roleClass}">${roleLabel}</span>
            </div>
          </div>
          ${isActive ? checkSvg : ''}
        </button>
      `;
    });
    listEl.innerHTML = html;
  }

  /* ── Promjena Aktivnog Kanala ── */
  async function setActiveChannel(channelInput) {
    if (!channelInput) return;
    let targetName = '', targetObj = null;

    if (typeof channelInput === 'string') {
      targetName = cleanUsername(channelInput);
      targetObj  = userChannels.find(c => c.username.toLowerCase() === targetName.toLowerCase()) || {
        username: targetName, id: null, avatar: '', chatroom_id: null,
        is_primary: false, is_managed: false, role: 'custom', owner_id: currentUser?.id, owner_plan: userPlan
      };
    } else {
      targetObj  = channelInput;
      targetName = cleanUsername(targetObj.username);
    }
    if (!targetName) return;

    if (!userChannels.some(c => c.username.toLowerCase() === targetName.toLowerCase())) {
      userChannels.push(targetObj);
      try {
        const customOnly = userChannels.filter(c => c.role === 'custom');
        localStorage.setItem('kickov_custom_channels_list', JSON.stringify(customOnly));
      } catch (_) {}
    }

    channelName = targetName; _activeChannelObj = targetObj;

    /* Prilagodi plan za managed kanale */
    if (targetObj.role === 'managed' && targetObj.owner_plan) {
      const op = targetObj.owner_plan.toLowerCase();
      userPlan = (op.includes('elite') || op.includes('business')) ? 'elite' : op.includes('pro') ? 'pro' : 'free';
    } else {
      const myTier = currentUserProfile
        ? String(currentUserProfile.plan || currentUserProfile.plan_tier || 'free').toLowerCase()
        : userPlan;
      userPlan = (myTier.includes('elite') || myTier.includes('business')) ? 'elite' : myTier.includes('pro') ? 'pro' : 'free';
    }

    try {
      localStorage.setItem('kickbot_selected_channel_name', channelName);
      if (targetObj.id) localStorage.setItem('kickbot_selected_channel_id', String(targetObj.id));
    } catch (_) {}

    updateProfileUI(channelName, targetObj.avatar);
    updateConnectedChannelPill();
    renderChannelDropdown();

    const planBadge = document.getElementById('planBadge');
    if (planBadge) planBadge.textContent = userPlan.toUpperCase();

    /* Reload Kickov-specificnih stvari za novi kanal */
    generateOrLoadObsToken();
    loadSettingsFromStorage();
    renderConfigForm();
    updateLivePreview();
    updateActiveCardsMetric();
    initRealtimeChannel();
  }

  function updateConnectedChannelPill() {
    const el = document.getElementById('connectedChannelName');
    if (el) el.textContent = channelName || 'Nepovezan';
  }

  function updateProfileUI(uname, avatarUrl) {
    const nameEl   = document.getElementById('userNameDisplay');
    const avatarEl = document.getElementById('userAvatarDisplay');
    const clean    = cleanUsername(uname) || 'Streamer';
    if (nameEl) nameEl.textContent = clean;
    if (avatarEl) {
      if (avatarUrl && avatarUrl.startsWith('http')) {
        avatarEl.style.backgroundImage    = `url('${avatarUrl}')`;
        avatarEl.style.backgroundSize     = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.textContent              = '';
      } else {
        avatarEl.style.backgroundImage = 'none';
        avatarEl.style.color           = '#000';
        avatarEl.textContent           = clean.charAt(0).toUpperCase();
      }
    }
  }

  /* ── Javne funkcije za Channel Manager ── */
  window.selectChannel = async function (username) {
    const clean = cleanUsername(username);
    if (!clean) return;
    const pill = document.getElementById('channelStatusPill');
    const menu = document.getElementById('channelDropdownMenu');
    if (menu) menu.classList.remove('open');
    if (pill) pill.classList.remove('open');
    if (clean.toLowerCase() === (channelName || '').toLowerCase()) return;
    await setActiveChannel(clean);
    showToast(`Aktivni kanal promenjen na: ${clean}`, 'success');
  };

  window.toggleChannelDropdown = function (e) {
    if (e) e.stopPropagation();
    const pill = document.getElementById('channelStatusPill');
    const menu = document.getElementById('channelDropdownMenu');
    if (!menu) return;
    const isOpen = menu.classList.contains('open');
    if (isOpen) { menu.classList.remove('open'); if (pill) pill.classList.remove('open'); }
    else         { menu.classList.add('open');    if (pill) pill.classList.add('open'); }
  };

  window.openCustomChannelModal = function (e) {
    if (e) e.stopPropagation();
    closeAllDropdowns();
    const input = document.getElementById('customChannelInput');
    if (input) input.value = channelName || '';
    window.openModal('customChannelModal');
    setTimeout(() => { if (input) input.focus(); }, 150);
  };

  window.saveCustomChannel = async function () {
    const input = document.getElementById('customChannelInput');
    const clean = cleanUsername((input?.value || '').trim());
    if (!clean || clean === 'Kanal') { showToast('Unesite validno Kick korisnicko ime.', 'warning'); return; }
    window.closeModal('customChannelModal');
    let existing = userChannels.find(c => c.username.toLowerCase() === clean.toLowerCase());
    if (!existing) {
      existing = { id: null, username: clean, avatar: '', chatroom_id: null, is_primary: false, is_managed: false, role: 'custom', owner_id: currentUser?.id, owner_plan: userPlan };
      userChannels.push(existing);
      try {
        localStorage.setItem('kickov_custom_channels_list', JSON.stringify(userChannels.filter(c => c.role === 'custom')));
      } catch (_) {}
    }
    await setActiveChannel(existing);
    showToast(`Uspesno prebaceno na kanal: ${clean}`, 'success');
  };

  /* ── Notifications & User Menu ── */
  window.toggleUserMenu = function () {
    const menu = document.getElementById('userMenuSm');
    if (menu) menu.classList.toggle('open');
  };

  /* ── Notifications & Changelog iz Baze (identično Kickot) ── */
  let notifications = [];
  let changelogs    = [];
  let activeNotifTab = 'obavestenja';
  let readNotifIds   = JSON.parse(localStorage.getItem('read_notif_ids') || '[]');

  function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const date      = new Date(isoString);
    const diffSec   = Math.floor((Date.now() - date.getTime()) / 1000);
    const diffMin   = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays  = Math.floor(diffHours / 24);

    if (diffSec < 60)   return 'Upravo sada';
    if (diffMin < 60)   return `Pre ${diffMin} min`;
    if (diffHours < 24) return `Pre ${diffHours} h`;
    return `Pre ${diffDays} d`;
  }

  async function loadNotifications() {
    if (!sb) return;
    try {
      const { data, error } = await sb
        .from('notifications')
        .select('id, created_at, title, description, type')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) return;
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
    } catch (_) {}
  }

  async function loadChangelogs() {
    if (!sb) return;
    try {
      const { data, error } = await sb
        .from('changelog')
        .select('id, created_at, version, title, details')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) return;
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
    } catch (_) {}
  }

  function updateNotifBadgeUI() {
    const unreadCount = notifications.filter(n => !readNotifIds.includes(String(n.id))).length;
    const badge = document.getElementById('notifBadge');
    const btn   = document.getElementById('notifBellBtn');

    if (badge) {
      badge.style.display = unreadCount > 0 ? 'flex' : 'none';
      badge.textContent   = unreadCount > 99 ? '99+' : String(unreadCount);
    }
    if (btn) {
      if (unreadCount > 0) {
        btn.style.borderColor = 'var(--ov-red, #ef4444)';
        btn.style.color       = 'var(--ov-red, #ef4444)';
      } else {
        btn.style.borderColor = '';
        btn.style.color       = '';
      }
    }
  }

  function renderNotifContent() {
    const list = document.getElementById('notifContentList');
    if (!list) return;

    if (activeNotifTab === 'obavestenja') {
      if (notifications.length === 0) {
        list.innerHTML = `
          <div style="color: var(--ov-muted); text-align: center; padding: 28px 14px; font-size: 0.82rem; display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.5;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
            <span>Trenutno nema novih obaveštenja.</span>
          </div>`;
        return;
      }

      const sorted = [...notifications].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      list.innerHTML = sorted.map(n => {
        const isRead = readNotifIds.includes(String(n.id));
        let color = '#3B82F6';
        let iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
        if (n.type === 'success') {
          color = '#10B981';
          iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
        } else if (n.type === 'warning') {
          color = '#F59E0B';
          iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.03 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
        }

        const opacityStyle = isRead ? 'opacity: 0.55;' : '';
        const borderStyle  = isRead ? 'border: 1px solid rgba(255,255,255,0.05);' : `border: 1px solid ${color}40; box-shadow: 0 4px 14px ${color}15;`;
        const bgStyle      = isRead ? 'background: rgba(255,255,255,0.02);' : 'background: rgba(255,255,255,0.04);';
        const formattedTime = formatRelativeTime(n.timestamp);

        return `
          <div onclick="window.markNotifAsRead('${n.id}')" style="padding: 12px 14px; border-radius: 12px; ${bgStyle} ${borderStyle} transition: all 0.2s; cursor: pointer; ${opacityStyle} margin-bottom: 6px;">
            <div style="display: flex; gap: 10px; align-items: flex-start; text-align: left;">
              <div style="width: 24px; height: 24px; border-radius: 50%; background: ${color}20; color: ${color}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; border: 1px solid ${color}35;">
                ${iconSvg}
              </div>
              <div style="flex-grow: 1;">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                  <div style="font-size: 0.83rem; font-weight: 700; color: #fff; line-height: 1.3;">${escHtml(n.title)}</div>
                  <div style="font-size: 0.68rem; color: var(--ov-muted); white-space: nowrap;">${formattedTime}</div>
                </div>
                <div style="font-size: 0.77rem; color: #cbd5e1; margin-top: 4px; line-height: 1.45;">${escHtml(n.desc)}</div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      if (changelogs.length === 0) {
        list.innerHTML = `
          <div style="color: var(--ov-muted); text-align: center; padding: 28px 14px; font-size: 0.82rem; display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.5;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span>Trenutno nema novih changelog informacija.</span>
          </div>`;
        return;
      }

      list.innerHTML = changelogs.map(c => `
        <div style="padding: 12px 14px; border-radius: 12px; background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); transition: all 0.2s; margin-bottom: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 0.72rem; font-weight: 800; color: #a78bfa; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); padding: 2px 8px; border-radius: 6px; letter-spacing: 0.5px;">${escHtml(c.version)}</span>
            <span style="font-size: 0.68rem; color: var(--ov-muted); display: flex; align-items: center; gap: 4px;">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              ${escHtml(c.date)}
            </span>
          </div>
          <div style="font-size: 0.84rem; font-weight: 700; color: #fff; margin-bottom: 4px; text-align: left;">${escHtml(c.title)}</div>
          <div style="font-size: 0.77rem; color: #cbd5e1; line-height: 1.45; text-align: left;">${escHtml(c.details)}</div>
        </div>
      `).join('');
    }
  }

  window.markNotifAsRead = function (id) {
    if (!id) return;
    const strId = String(id);
    if (!readNotifIds.includes(strId)) {
      readNotifIds.push(strId);
      localStorage.setItem('read_notif_ids', JSON.stringify(readNotifIds));
    }
    updateNotifBadgeUI();
    renderNotifContent();
  };

  window.markAllNotifsAsRead = function () {
    notifications.forEach(n => {
      const strId = String(n.id);
      if (!readNotifIds.includes(strId)) readNotifIds.push(strId);
    });
    localStorage.setItem('read_notif_ids', JSON.stringify(readNotifIds));
    updateNotifBadgeUI();
    renderNotifContent();
    showToast('Sva obaveštenja su označena kao pročitana.', 'info');
  };

  window.switchNotifTab = function (tab) {
    activeNotifTab = tab;
    const b1 = document.getElementById('notifTabObavestenja');
    const b2 = document.getElementById('notifTabChangelog');
    if (b1) b1.classList.toggle('active', tab === 'obavestenja');
    if (b2) b2.classList.toggle('active', tab === 'changelog');
    renderNotifContent();
  };

  window.toggleNotifCenter = function () {
    const pop = document.getElementById('notifPopover');
    if (!pop) return;
    const isOpen = pop.classList.toggle('open');
    if (isOpen) {
      renderNotifContent();
    }
  };

  /* ── Refresh & Odjava ── */
  window.refreshDatabase = async function () {
    const btnEl = document.querySelector('.topbar-refresh-btn');
    const svgEl = btnEl ? btnEl.querySelector('svg') : null;
    if (svgEl) svgEl.style.animation = 'spin 1s linear infinite';
    try {
      await checkAuth();
      loadSettingsFromStorage();
      renderConfigForm();
      updateLivePreview();
      updateObsLinkUI();
      updateActiveCardsMetric();
      await Promise.all([loadNotifications(), loadChangelogs()]);
      showToast('Podaci su uspesno sinhronizovani.', 'success');
      if (btnEl) {
        if (svgEl) svgEl.style.animation = '';
        btnEl.classList.add('is-success');
        btnEl.innerHTML = `<svg fill="none" height="16" stroke="#53fc18" stroke-linecap="round" stroke-linejoin="round" stroke-width="3" viewBox="0 0 24 24" width="16"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => {
          btnEl.classList.remove('is-success');
          btnEl.innerHTML = `<svg class="refresh-icon" fill="none" height="16" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="16"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`;
        }, 1800);
      }
    } catch (err) {
      showToast('Greska pri osvezavanju podataka.', 'error');
      if (svgEl) svgEl.style.animation = '';
    }
  };

  window.handleSignOut = async function () {
    if (sb) await sb.auth.signOut();
    window.location.href = '../index.html';
  };

  /* ════════════════════════════════════════
     OBS TOKEN & LINK
  ════════════════════════════════════════ */
  function generateOrLoadObsToken() {
    const key   = `kickov_obs_token_${channelName || 'default'}`;
    let   saved = localStorage.getItem(key);
    if (!saved) {
      saved = 'ov_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem(key, saved);
    }
    obsToken = saved;
    updateObsLinkUI();
  }

  function getObsWidgetUrl() {
    const origin = window.location.origin || (window.location.protocol + '//' + window.location.host);
    return `${origin}/kickov/widget.html?token=${encodeURIComponent(obsToken)}`;
  }

  function getTipPageUrl() {
    const origin = window.location.origin || (window.location.protocol + '//' + window.location.host);
    return `${origin}/kickov/tip.html?user=${encodeURIComponent(channelName)}`;
  }

  function updateObsLinkUI() {
    const obsUrl      = getObsWidgetUrl();
    const obsInput    = document.getElementById('obsUrlInput');
    const sidebarObs  = document.getElementById('sidebarObsInput');

    if (obsInput) {
      obsInput.dataset.realUrl = obsUrl;
      obsInput.value = obsInput.dataset.visible === 'true' ? obsUrl : '••••••••••••••••••••••••••••••••••••••••••••••••';
    }
    if (sidebarObs) {
      sidebarObs.dataset.realUrl = obsUrl;
      sidebarObs.value = sidebarObs.dataset.visible === 'true' ? obsUrl : '••••••••••••••••••••••••••••••••••••••••';
    }

    const pInput = document.getElementById('inputPaypalMe');
    const pEmail = document.getElementById('inputPaypalEmail');
    if (pInput && paypalSettings.paypalMe) pInput.value = paypalSettings.paypalMe;
    if (pEmail && paypalSettings.email)    pEmail.value = paypalSettings.email;
  }

  window.toggleObsLinkVisibility = function () {
    const obsInput   = document.getElementById('obsUrlInput');
    const sidebarObs = document.getElementById('sidebarObsInput');
    const btnTog     = document.getElementById('btnToggleObsText');
    if (!obsInput) return;
    const nextVis = !(obsInput.dataset.visible === 'true');
    obsInput.dataset.visible = nextVis ? 'true' : 'false';
    if (sidebarObs) sidebarObs.dataset.visible = nextVis ? 'true' : 'false';
    const obsUrl = getObsWidgetUrl();
    obsInput.value   = nextVis ? obsUrl : '••••••••••••••••••••••••••••••••••••••••••••••••';
    if (sidebarObs) sidebarObs.value = nextVis ? obsUrl : '••••••••••••••••••••••••••••••••••••••••';
    if (btnTog) btnTog.textContent = nextVis ? 'Sakrij Link' : 'Prikaži Link';
  };

  window.copyObsLink = function () {
    const url = getObsWidgetUrl();
    navigator.clipboard.writeText(url)
      .then(() => showToast('OBS Browser Source link kopiran u clipboard!'))
      .catch(() => showToast('Kopirano: ' + url));
  };

  window.copyTipLink = function () {
    const url = getTipPageUrl();
    navigator.clipboard.writeText(url)
      .then(() => showToast('Javni link za donacije je kopiran u clipboard!'))
      .catch(() => showToast('Kopirano: ' + url));
  };

  /* ════════════════════════════════════════
     ALERT TABOVI & KONFIGURACIJA
  ════════════════════════════════════════ */
  window.switchAlertTab = function (tabKey) {
    if (!alertSettings[tabKey]) return;
    activeTab = tabKey;
    document.querySelectorAll('.kickov-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabKey);
    });
    const labelMap = {
      follower: 'Pratioci', sub: 'Subscriberi', gift_sub: 'Gifted Subs',
      host: 'Host & Raid', kicks: 'KICK-ovi', donation: 'Donacije & PayPal'
    };
    const el = document.getElementById('previewTabLabel');
    if (el) el.textContent = labelMap[tabKey] || tabKey;
    renderConfigForm();
    updateLivePreview();
    updateActiveCardsMetric();
  };

  function renderConfigForm() {
    const container = document.getElementById('tabConfigFormContainer');
    if (!container) return;
    const cfg = alertSettings[activeTab] || DEFAULT_ALERT_TEMPLATES[activeTab];
    const sel = (val, opt) => val === opt ? ' selected' : '';

    container.innerHTML = `
      <div class="sc-form-group">
        <label class="sc-label" for="cfgMsgTemplate">Sablon Poruke Alerta</label>
        <input type="text" id="cfgMsgTemplate" class="sc-input" value="${escHtml(cfg.messageTemplate || '')}" oninput="window.handleConfigChange('messageTemplate', this.value)" />
        <span style="font-size:0.72rem; color:var(--ov-muted);">Tagovi: {name}, {count}, {viewers}, {amount}, {message}</span>
      </div>

      <div class="cfg-grid-2">
        <div class="sc-form-group">
          <label class="sc-label" for="cfgDuration">Trajanje: <strong id="valDuration">${cfg.duration || 5}s</strong></label>
          <input type="range" id="cfgDuration" class="sc-slider" min="3" max="25" value="${cfg.duration || 5}" oninput="window.handleDurationChange(this.value)" />
        </div>
        <div class="sc-form-group">
          <label class="sc-label" for="cfgEntryAnim">Animacija Ulaza</label>
          <select id="cfgEntryAnim" class="sc-input sc-select" onchange="window.handleConfigChange('entryAnim', this.value)">
            <option value="bounceIn"${sel(cfg.entryAnim, 'bounceIn')}>Bounce In</option>
            <option value="fadeIn"${sel(cfg.entryAnim, 'fadeIn')}>Fade In</option>
            <option value="zoomIn"${sel(cfg.entryAnim, 'zoomIn')}>Zoom In</option>
            <option value="slideDown"${sel(cfg.entryAnim, 'slideDown')}>Slide Down</option>
            <option value="flipInX"${sel(cfg.entryAnim, 'flipInX')}>Flip In</option>
          </select>
        </div>
      </div>

      <div class="cfg-grid-2">
        <div class="sc-form-group">
          <label class="sc-label">Boje (Pozadina / Akcent / Ime)</label>
          <div class="cfg-color-row">
            <input type="color" id="cfgBgColor"        class="cfg-color-input" value="${cfg.bgColor || '#120e26'}"    onchange="window.handleConfigChange('bgColor', this.value)"        title="Pozadina" />
            <input type="color" id="cfgAccentColor"    class="cfg-color-input" value="${cfg.accentColor || '#53fc18'}" onchange="window.handleConfigChange('accentColor', this.value)"    title="Akcent" />
            <input type="color" id="cfgHighlightColor" class="cfg-color-input" value="${cfg.highlightColor || '#53fc18'}" onchange="window.handleConfigChange('highlightColor', this.value)" title="Ime" />
          </div>
        </div>
        <div class="sc-form-group">
          <label class="sc-label" for="cfgExitAnim">Animacija Izlaza</label>
          <select id="cfgExitAnim" class="sc-input sc-select" onchange="window.handleConfigChange('exitAnim', this.value)">
            <option value="bounceOut"${sel(cfg.exitAnim, 'bounceOut')}>Bounce Out</option>
            <option value="fadeOut"${sel(cfg.exitAnim, 'fadeOut')}>Fade Out</option>
            <option value="zoomOut"${sel(cfg.exitAnim, 'zoomOut')}>Zoom Out</option>
            <option value="slideUp"${sel(cfg.exitAnim, 'slideUp')}>Slide Up</option>
            <option value="flipOutX"${sel(cfg.exitAnim, 'flipOutX')}>Flip Out</option>
          </select>
        </div>
      </div>

      <div class="sc-form-group">
        <label class="sc-label" for="cfgMediaUrl">Media URL (GIF / WebM / Slika)</label>
        <input type="url" id="cfgMediaUrl" class="sc-input" value="${escHtml(cfg.mediaUrl || '')}" placeholder="https://..." oninput="window.handleConfigChange('mediaUrl', this.value)" />
      </div>

      <div class="sc-form-group">
        <label class="sc-label" for="cfgSoundUrl">Zvuk URL (MP3 / WAV)</label>
        <input type="url" id="cfgSoundUrl" class="sc-input" value="${escHtml(cfg.soundUrl || '')}" placeholder="https://..." oninput="window.handleConfigChange('soundUrl', this.value)" />
      </div>
    `;
  }

  window.handleDurationChange = function (val) {
    const lbl = document.getElementById('valDuration');
    if (lbl) lbl.textContent = `${val}s`;
    window.handleConfigChange('duration', parseInt(val, 10));
  };

  window.handleConfigChange = function (key, val) {
    if (!alertSettings[activeTab]) alertSettings[activeTab] = {};
    alertSettings[activeTab][key] = val;
    updateLivePreview();
  };

  window.toggleCardState = function (cardKey, isChecked) {
    if (!alertSettings[cardKey]) alertSettings[cardKey] = {};
    alertSettings[cardKey].enabled = isChecked;

    // Auto-persist u localStorage za aktivni kanal
    try {
      const key = channelName || 'default';
      localStorage.setItem(`kickov_settings_${key}`, JSON.stringify(alertSettings));
    } catch (_) {}

    updateActiveCardsMetric();
    showToast(`Alert "${cardKey}" je sada ${isChecked ? 'aktivan' : 'pauziran'}.`);
  };

  function updateActiveCardsMetric() {
    const CARD_KEYS = ['follower', 'sub', 'gift_sub', 'host', 'kicks', 'donation'];
    const CHECKBOX_IDS = {
      follower: 'toggleCardFollower',
      sub: 'toggleCardSub',
      gift_sub: 'toggleCardGiftSub',
      host: 'toggleCardHost',
      kicks: 'toggleCardKicks',
      donation: 'toggleCardDonation'
    };

    let enabledCount = 0;

    CARD_KEYS.forEach(key => {
      // Ako polje 'enabled' nije eksplicitno definisano, po defaultu je true
      const isEnabled = alertSettings[key]?.enabled !== false;
      if (isEnabled) enabledCount++;

      // 1. Sinhronizuj checkbox u sidebaru
      const chkId = CHECKBOX_IDS[key];
      const chk   = document.getElementById(chkId);
      if (chk) chk.checked = isEnabled;

      // 2. Sinhronizuj tab dugme i dot u glavnom delu
      const tabBtn = document.querySelector(`.kickov-tab-btn[data-tab="${key}"]`);
      if (tabBtn) {
        tabBtn.classList.toggle('alert-enabled', isEnabled);
        tabBtn.classList.toggle('alert-disabled', !isEnabled);
      }
    });

    const el = document.getElementById('statActiveCardsVal');
    if (el) el.textContent = `${enabledCount} / ${CARD_KEYS.length}`;
  }

  /* ════════════════════════════════════════
     LIVE PREVIEW & TEST
  ════════════════════════════════════════ */
  function updateLivePreview() {
    const viewport = document.getElementById('previewViewport');
    if (!viewport) return;
    const cfg        = alertSettings[activeTab] || DEFAULT_ALERT_TEMPLATES[activeTab];
    const sampleName = 'KickGamer_99';
    let   msg        = (cfg.messageTemplate || '{name}')
      .replace('{name}',    `<span class="alert-preview-highlight" style="color:${cfg.highlightColor || '#53fc18'};">${sampleName}</span>`)
      .replace('{count}',   '5').replace('{viewers}', '240').replace('{amount}', '10').replace('{message}', 'Pozdrav za stream legendo!');

    viewport.innerHTML = `
      <div class="alert-preview-box" id="alertPreviewBox" style="background:${cfg.bgColor || '#120e26'}; border:2px solid ${cfg.accentColor || '#53fc18'}; color:${cfg.textColor || '#fff'};">
        ${cfg.mediaUrl ? `<img src="${escHtml(cfg.mediaUrl)}" alt="Alert GIF" class="alert-preview-media" />` : ''}
        <div class="alert-preview-text">${msg}</div>
      </div>
    `;
  }

  window.triggerStagePreviewTest = function () {
    const cfg = alertSettings[activeTab] || DEFAULT_ALERT_TEMPLATES[activeTab];
    const box = document.getElementById('alertPreviewBox');
    if (box) {
      box.style.transform = 'scale(0.85)'; box.style.opacity = '0.5';
      setTimeout(() => { box.style.transform = 'scale(1)'; box.style.opacity = '1'; }, 150);
    }
    playAlertAudio(cfg.soundUrl, cfg.soundVolume || 80);
    const sampleText = (cfg.messageTemplate || '{name}')
      .replace('{name}', 'KickGamer').replace('{count}', '5').replace('{viewers}', '240').replace('{amount}', '10').replace('{message}', 'Pozdrav za stream');
    const ttsToggle = document.getElementById('toggleGlobalTTS');
    if (ttsToggle && ttsToggle.checked && cfg.ttsEnabled !== false) {
      const voice = document.getElementById('selectTtsVoice')?.value || cfg.ttsVoice || 'sr-RS';
      speakTTS(sampleText, voice, cfg.ttsVolume || 80);
    }
    testCount++;
    const tc = document.getElementById('statTestCountVal');
    if (tc) tc.textContent = String(testCount);
    addAlertToHistory(activeTab, sampleText);
    showToast(`Test za "${activeTab}" je uspesno pokrenut!`);
  };

  window.sendTestAlertToOBS = function () {
    const cfg     = alertSettings[activeTab] || DEFAULT_ALERT_TEMPLATES[activeTab];
    const payload = { type: activeTab, name: 'KickGamer_99', count: 5, viewers: 240, amount: 10, message: 'Pozdrav za stream legendo!', config: cfg, timestamp: Date.now() };
    if (realtimeChannel) {
      realtimeChannel.send({ type: 'broadcast', event: 'alert', payload });
    }
    window.triggerStagePreviewTest();
    showToast(`Test alert "${activeTab}" poslat u OBS Browser Source!`);
  };

  function addAlertToHistory(type, message) {
    const container = document.getElementById('recentAlertsContainer');
    if (!container) return;
    const empty = container.querySelector('.feed-empty-state');
    if (empty) empty.remove();
    const now     = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const row = document.createElement('div');
    row.className = 'feed-msg-row';
    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-family:'JetBrains Mono',monospace; font-size:0.75rem; color:var(--ov-muted2);">${timeStr}</span>
        <span style="font-weight:800; text-transform:uppercase; font-size:0.75rem; color:var(--ov-green); background:rgba(83,252,24,0.12); padding:2px 8px; border-radius:4px;">${type}</span>
        <span style="color:#f1f5f9;">${escHtml(message)}</span>
      </div>
      <span style="color:var(--ov-green); font-size:0.75rem; font-weight:700;">Poslato</span>
    `;
    container.insertBefore(row, container.firstChild);
    while (container.children.length > 20) container.removeChild(container.lastChild);
  }

  window.clearAlertHistory = function () {
    const c = document.getElementById('recentAlertsContainer');
    if (!c) return;
    c.innerHTML = '<div class="feed-empty-state">Dnevnik alertova je ociscen.</div>';
    showToast('Istorija alertova je uspesno ociscena.');
  };

  /* ════════════════════════════════════════
     REALTIME SINHRONIZACIJA
  ════════════════════════════════════════ */
  function initRealtimeChannel() {
    if (!sb || !obsToken) return;
    if (realtimeChannel) { try { sb.removeChannel(realtimeChannel); } catch (_) {} realtimeChannel = null; }
    try {
      realtimeChannel = sb.channel(`kickov_alerts:${obsToken}`);
      realtimeChannel.subscribe(status => {
        const pill = document.getElementById('obsStatusPill');
        if (pill && status === 'SUBSCRIBED') {
          pill.className = 'topbar-live-status-pill live';
          pill.innerHTML = `<span class="stream-pulse-dot" style="background:var(--ov-green);box-shadow:0 0 8px var(--ov-green);"></span><span>OBS Vidzet Spremno</span>`;
        }
      });
    } catch (_) {}
  }

  /* ════════════════════════════════════════
     CUVANJE & RESETOVANJE PODESAVANJA
  ════════════════════════════════════════ */
  window.saveAllKickovSettings = async function () {
    const pmv = document.getElementById('inputPaypalMe')?.value.trim() || '';
    const pev = document.getElementById('inputPaypalEmail')?.value.trim() || '';
    paypalSettings.paypalMe = pmv;
    paypalSettings.email    = pev;

    const key = channelName || 'default';
    localStorage.setItem(`kickov_settings_${key}`, JSON.stringify(alertSettings));
    localStorage.setItem(`kickov_paypal_${key}`,   JSON.stringify(paypalSettings));

    if (sb && currentUser) {
      try {
        await sb.from('user_profiles').update({
          kickov_settings: alertSettings, paypal_settings: paypalSettings,
          updated_at: new Date().toISOString()
        }).eq('id', currentUser.id);
      } catch (_) {}
    }

    if (realtimeChannel) {
      realtimeChannel.send({ type: 'broadcast', event: 'settings_updated', payload: { alertSettings, paypalSettings } });
    }

    showToast('Sva podesavanja su uspesno sacuvana!');
  };

  function loadSettingsFromStorage() {
    const key   = channelName || 'default';
    const saved = localStorage.getItem(`kickov_settings_${key}`);
    if (saved) {
      try {
        const p = JSON.parse(saved);
        if (p && typeof p === 'object') alertSettings = { ...DEFAULT_ALERT_TEMPLATES, ...p };
      } catch (_) {}
    }
    migrateOldGifUrls();
    const savedP = localStorage.getItem(`kickov_paypal_${key}`);
    if (savedP) {
      try { const pp = JSON.parse(savedP); if (pp) paypalSettings = { ...paypalSettings, ...pp }; } catch (_) {}
    }
  }

  function migrateOldGifUrls() {
    const BROKEN = ['l41lT4n6ylgW2hh04'];
    if (alertSettings.sub && (!alertSettings.sub.mediaUrl || BROKEN.some(p => alertSettings.sub.mediaUrl.includes(p)))) {
      alertSettings.sub.mediaUrl = 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif';
    }
  }

  window.openResetModal = function () { window.openModal('resetAlertsModal'); };

  window.confirmResetSettings = function () {
    alertSettings = JSON.parse(JSON.stringify(DEFAULT_ALERT_TEMPLATES));
    renderConfigForm(); updateLivePreview(); updateActiveCardsMetric();
    window.closeModal('resetAlertsModal');
    window.saveAllKickovSettings();
    showToast('Podesavanja su vracena na podrazumevane vrednosti.');
  };

  /* ════════════════════════════════════════
     MODALI
  ════════════════════════════════════════ */
  window.openModal = function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('closing');
    el.classList.add('open');
  };

  window.closeModal = function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('closing');
    setTimeout(() => { el.classList.remove('open', 'closing'); }, 250);
  };

  window.handleModalBg = function (e, modalId) {
    if (e.target.id === modalId) window.closeModal(modalId);
  };

  window.openHelpModal = function () { closeAllDropdowns(); window.openModal('helpModal'); };

  window.toggleMute = function () {
    isMuted = !isMuted;
    const btn = document.getElementById('btnMuteSound');
    if (btn) btn.style.color = isMuted ? 'var(--ov-red, #ef4444)' : '';
    showToast(isMuted ? 'Zvuk je iskljucen' : 'Zvuk je ukljucen');
  };

  /* ════════════════════════════════════════
     GLOBAL CLICK HANDLERS
  ════════════════════════════════════════ */
  function setupGlobalClickHandlers() {
    document.addEventListener('click', e => {
      const pill = document.getElementById('channelStatusPill');
      const menu = document.getElementById('channelDropdownMenu');
      if (menu && pill && !pill.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.remove('open'); pill.classList.remove('open');
      }
      const uMenu = document.getElementById('userMenuSm');
      const uPill = document.getElementById('userPill');
      if (uMenu && uPill && !uPill.contains(e.target)) uMenu.classList.remove('open');
      const pop  = document.getElementById('notifPopover');
      const bell = document.getElementById('notifBellBtn');
      if (pop && bell && !pop.contains(e.target) && !bell.contains(e.target)) pop.classList.remove('open');
    });
  }

  function closeAllDropdowns() {
    document.querySelectorAll('.channel-dropdown-menu, .user-menu-sm, .notif-popover').forEach(el => el.classList.remove('open'));
  }

})();
