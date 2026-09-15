/**
 * KICKAN — Stream Analytics Studio
 * Kompletna logika: Auth, Plan, Menadžer kanala (Vlasnički + Managed + Custom),
 * Real-time Pusher WebSocket, Kick API Telemetrija, Brzinomer chata,
 * 24h Histogram, Emoti, Leaderboard, Moderacija, Zvuk, Fullscreen Studio i Izvoz.
 */
(function () {
  'use strict';

  /* ── Imenovane konstante (bez magic numbers u kodu) ── */
  const WS_PING_INTERVAL_MS      = 25000; // Pusher keepalive interval
  const WS_RECONNECT_BASE_MS     = 5000;  // Bazni delay za WebSocket reconnect
  const WS_RECONNECT_MAX_RETRIES = 10;    // Maksimalan broj pokušaja reconnecta
  const POLL_INTERVAL_MS         = 15000; // Kick API polling interval
  const UI_THROTTLE_MS           = 400;   // Throttle za updateDashboardUI
  const BOT_API_TIMEOUT_MS       = 6000;  // Timeout za Bot API poziv
  const ALLORIGINS_TIMEOUT_MS    = 3000;  // Timeout za allorigins proxy
  const VELOCITY_WINDOW_MS       = 60000; // Prozor za chat velocity (1 min)
  const VIEWER_SAMPLES_CAP       = 60;    // Maksimalan broj uzoraka gledaoca
  const CHAT_FEED_MAX_MSGS       = 40;    // Maksimalan broj poruka u live feed-u
  const BAN_LOGS_MAX             = 30;    // Maksimalan broj ban logova u memoriji
  const SAVE_DEBOUNCE_MS         = 10000; // Debounce za localStorage čuvanje

  /* ── Global Error Handling for Unhandled Promise Rejections (identično Kickaj/Kickot) ── */
  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event) => {
      console.error('[Kickan] Unhandled promise rejection:', event.reason);
      if (typeof window.showToast === 'function') {
        const msg = event?.reason?.message || '';
        if (!msg.includes('AbortError')) {
          window.showToast('Došlo je do neočekivane mrežne greške.', 'error');
        }
      }
    });
  }

  /* ── Mobile Sidebar Drawer ── */
  window.toggleMobileSidebar = function () {
    const isOpen = document.body.classList.toggle('sidebar-open');
    const toggleBtn = document.getElementById('btnMobileMenuToggle');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(isOpen));
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.setAttribute('aria-hidden', String(!isOpen));
  };

  window.closeMobileSidebar = function () {
    document.body.classList.remove('sidebar-open');
    const toggleBtn = document.getElementById('btnMobileMenuToggle');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.setAttribute('aria-hidden', 'true');
  };

  /* ── Supabase Configuration ── */
  const supabaseUrl     = window.CONFIG?.SUPABASE?.URL;
  const supabaseAnonKey = window.CONFIG?.SUPABASE?.ANON_KEY;
  const storageKey      = window.CONFIG?.SUPABASE?.STORAGE_KEY || 'kickbot-supabase-auth';

  /* ── State ── */
  let sb                 = null;
  let currentUser        = null;
  let _currentUserProfile = null;
  let userPlan           = 'free';
  let userChannels       = [];
  let activeChannelObj   = null;
  let channelName        = '';
  let channelId          = null;
  let chatroomId         = null;
  let kickWebSocket      = null;
  let pingInterval       = null;
  let pollInterval       = null;
  let uptimeInterval     = null;
  let velocityInterval   = null;
  let gateDismissed      = false;
  let isTrackingActive   = true;
  let isMuted            = false;
  let soundVolume        = 0.5;
  let streamStartTime    = null;
  let activeChatFilter   = 'all';
  let pastStreamsList    = [];
  let isSavingStream     = false;
  let currentSessionDbId = null;
  let currentStreamTitle = '';
  let isStreamCurrentlyLive = false;

  // Rolling message timestamps for exact velocity calculation (last 60s)
  let rollingMessageTimes = [];
  let currentVelocity    = 0;
  let peakVelocity       = 0;

  // Real Language & Demographic Telemetry
  let detectedGeoRegion = 'Automatska telemetrija';
  let geoMultiplierValue = 1.00;
  let balkanChatScore = 0;
  let globalChatScore = 0;

  // Real Analytics State
  const liveStats = {
    totalMessages: 0,
    liveViewers: 0,
    avgViewers: 0,
    viewerSamples: [],
    peakViewers: 0,
    activeSubs: 0,
    followersCount: 0,
    uniqueChattersMap: new Set(),
    totalKicks: 0,
    totalBans: 0,
    totalHosts: 0,
    totalEmotes: 0,
    emotesMap: new Map(),           // emoteName -> count
    viewersActivityMap: new Map(),  // username -> { count, isSub, isMod, isVip, firstSeen, lastSeen }
    banLogs: [],                    // Array of { user, mod, reason, time, type }
    recentChatMessages: [],         // Array of { id, author, content, time, isSub, isMod, isEvent }
    hourlyCounts: new Array(24).fill(0) // 0-23h message counts
  };

  /* ── Notifications & Changelog Data iz Baze (identično Kickot) ── */
  let notifications = [];
  let changelogs    = [];
  let activeNotifTab = 'obavestenja';
  let readNotifIds   = JSON.parse(localStorage.getItem('read_notif_ids') || '[]');

  /* ── Supabase Init ── */
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

  /* ════════════════════════════════════════
     INITIALIZATION
  ════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', async () => {
    setupGlobalClickHandlers();
    setupKeyboardShortcuts();
    startVelocityTimer();
    loadNotifications();
    loadChangelogs();
    window.addEventListener('beforeunload', () => {
      if (channelName) saveSessionStats(channelName);
    });
    await checkAuth();
  });

  function cleanUsername(raw, defaultVal = 'Kanal') {
    if (!raw) return defaultVal;
    let s = String(raw).trim()
      .replace(/^https?:\/\/(www\.)?kick\.com\//i, '')
      .replace(/^kick_user_/, '')
      .replace(/^@/, '');
    if (s.includes('@')) s = s.split('@')[0];
    s = s.split(/[/?#\s]/)[0];
    return s || defaultVal;
  }

  function getBotApiBase() {
    if (window.CONFIG && typeof window.CONFIG.getBackendApiBase === 'function') {
      return window.CONFIG.getBackendApiBase();
    }
    return window.KickotConfig ? window.KickotConfig.api.baseUrl : 'https://kickbot-ihzb.onrender.com';
  }

  async function fetchKickAvatar(username) {
    const raw = String(username || '').trim();
    if (!raw) return null;
    try {
      const apiBase = getBotApiBase();
      const res = await fetch(`${apiBase}/api/avatar?username=${encodeURIComponent(raw)}`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        if (data?.avatar) return data.avatar;
      }
    } catch (_) {}
    return null;
  }

  /* ════════════════════════════════════════
     AUTH & CHANNEL MANAGER
  ════════════════════════════════════════ */
  async function checkAuth() {
    const safetyTimeout = setTimeout(() => {
      dismissAuthGate();
    }, 2500);

    if (!sb) {
      clearTimeout(safetyTimeout);
      const gateMsg = document.getElementById('authGateMsg');
      if (gateMsg) gateMsg.textContent = 'Preusmeravanje na prijavu...';
      setTimeout(() => { window.location.href = '../index.html?login=1'; }, 1200);
      return;
    }

    try {
      try {
        sessionStorage.setItem('from_kickall', 'true');
        sessionStorage.setItem('kick_origin_site', 'kickan');
        localStorage.setItem('kick_origin_site', 'kickan');
      } catch (e) {
        console.warn('Failed to set origin flags:', e);
      }

      const session = window.CONFIG?.getValidSessionWithRetry
        ? await window.CONFIG.getValidSessionWithRetry(sb, 3, 1000)
        : (await sb.auth.getSession())?.data?.session;

      if (!session?.user) {
        clearTimeout(safetyTimeout);
        const gateMsg = document.getElementById('authGateMsg');
        if (gateMsg) gateMsg.textContent = 'Preusmeravanje na prijavu...';
        setTimeout(() => { window.location.href = '../index.html?login=1'; }, 1200);
        return;
      }

      currentUser = session.user;
      let primaryUsername = currentUser.user_metadata?.kick_username
        || currentUser.user_metadata?.preferred_username
        || currentUser.user_metadata?.name
        || currentUser.user_metadata?.full_name
        || (currentUser.email ? currentUser.email : '');
      let avatarUrl = currentUser.user_metadata?.avatar_url
        || currentUser.user_metadata?.picture
        || currentUser.user_metadata?.profile_picture;

      userChannels = [];

      // 1. Query user_profiles in Supabase (Vlasnički kanali)
      try {
        const { data: profile } = await sb.from('user_profiles').select('*').eq('id', currentUser.id).maybeSingle();
        if (profile) {
          _currentUserProfile = profile;
          const tier = (profile.plan || profile.plan_tier || profile.tier || 'free').toLowerCase();
          userPlan = (tier.includes('elite') || tier.includes('business')) ? 'elite' : (tier.includes('pro') ? 'pro' : 'free');

          if (Array.isArray(profile.kick_channels)) {
            profile.kick_channels.forEach(ch => {
              const uName = cleanUsername(ch.username || ch.slug);
              if (!uName) return;
              userChannels.push({
                id: ch.id || null,
                username: uName,
                avatar: ch.avatar || ch.avatar_url || '',
                chatroom_id: ch.chatroom_id || null,
                is_primary: !!ch.is_primary,
                is_managed: false,
                role: 'owner',
                owner_id: currentUser.id,
                owner_plan: userPlan
              });
            });
          }

          if (profile.kick_username && !userChannels.some(c => c.username.toLowerCase() === cleanUsername(profile.kick_username).toLowerCase())) {
            userChannels.unshift({
              id: null,
              username: cleanUsername(profile.kick_username),
              avatar: profile.avatar_url || '',
              chatroom_id: null,
              is_primary: true,
              is_managed: false,
              role: 'owner',
              owner_id: currentUser.id,
              owner_plan: userPlan
            });
          }
          if (!primaryUsername && profile.display_name) primaryUsername = profile.display_name;
        }
      } catch (e) {
        console.warn('[Kickan] Supabase profile lookup:', e.message);
      }

      // 2. Managed / Dodeljeni kanali (Glavni Moderator) preko SECURITY DEFINER RPC
      try {
        const myUsername = cleanUsername(primaryUsername || _currentUserProfile?.kick_username || '');
        if (myUsername) {
          const { data: managedChannels, error: managedErr } = await sb.rpc('get_managed_kick_channels', {
            p_username: myUsername
          });
          if (managedErr) throw managedErr;
          if (Array.isArray(managedChannels)) {
            managedChannels.forEach(ch => {
              const uName = cleanUsername(ch.username || ch.slug || '');
              if (!uName) return;
              userChannels.push({
                id: ch.id || null,
                username: uName,
                avatar: ch.avatar || ch.avatar_url || '',
                chatroom_id: ch.chatroom_id || null,
                is_primary: false,
                is_managed: true,
                role: 'managed',
                owner_id: ch.owner_id || null,
                owner_plan: (ch.owner_plan || 'free').toLowerCase()
              });
            });
          }
        }
      } catch (rpcErr) {
        console.warn('[Kickan] Greška pri učitavanju managed kanala:', rpcErr);
      }



      // Deduplicate kanale po korisničkom imenu
      const seen = new Set();
      userChannels = userChannels.filter(c => {
        const key = c.username.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Odaberi aktivni kanal
      const savedId = localStorage.getItem('kickbot_selected_channel_id');
      const savedName = localStorage.getItem('kickbot_selected_channel_name');
      let candidate = null;
      if (savedName || savedId) {
        candidate = userChannels.find(c =>
          (savedId && String(c.id) === String(savedId)) ||
          (savedName && c.username.toLowerCase() === savedName.toLowerCase())
        );
      }
      if (!candidate && userChannels.length > 0) {
        candidate = userChannels.find(c => c.is_primary) || userChannels[0];
      }
      if (!candidate) {
        candidate = {
          id: null,
          username: cleanUsername(primaryUsername) || (currentUser?.email ? currentUser.email.split('@')[0] : 'Kanal'),
          avatar: avatarUrl || '',
          chatroom_id: null,
          is_primary: true,
          is_managed: false,
          role: 'owner',
          owner_id: currentUser.id,
          owner_plan: userPlan
        };
        userChannels.push(candidate);
      }

      activeChannelObj = candidate;
      channelName = cleanUsername(candidate.username);
      if (candidate.avatar) avatarUrl = candidate.avatar;
      if (candidate.id) channelId = candidate.id;
      if (candidate.chatroom_id) chatroomId = parseInt(candidate.chatroom_id, 10);

      // Plan inheritance: za menadžerske kanale (Glavni Moderator) koristi plan vlasnika
      if (candidate.role === 'managed' && candidate.owner_plan) {
        userPlan = candidate.owner_plan.includes('elite') ? 'elite' : (candidate.owner_plan.includes('pro') ? 'pro' : 'free');
      } else {
        const myTier = (_currentUserProfile?.plan || 'free').toLowerCase();
        userPlan = (myTier.includes('elite') || myTier.includes('business')) ? 'elite' : (myTier.includes('pro') ? 'pro' : 'free');
        candidate.owner_plan = userPlan;
      }

      // Update Plan badge
      const planBadge = document.getElementById('planBadge');
      if (planBadge) planBadge.textContent = userPlan.toUpperCase();

      updateUserProfileUI(channelName, avatarUrl, candidate.role);
      renderChannelDropdownList();

      if (channelName) {
        updateStreamStatusUI('loading');
        await loadSavedSessionStats(channelName);
        connectToRealKickChat();
        loadRealKickChannelData(channelName).catch(() => {});

        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(() => {
          if (channelName && isTrackingActive) {
            loadRealKickChannelData(channelName).catch(() => {});
          }
        }, POLL_INTERVAL_MS);

        fetchPastStreams().catch(() => {});
      }

      // Asinhrono popuni nedostajuće avatare
      fetchMissingAvatars();
    } catch (err) {
      console.warn('Auth check error:', err);
      const gateMsg = document.getElementById('authGateMsg');
      if (gateMsg) gateMsg.textContent = 'Preusmeravanje na prijavu...';
      setTimeout(() => { window.location.href = '../index.html?login=1'; }, 1200);
    } finally {
      clearTimeout(safetyTimeout);
      dismissAuthGate();
    }
  }

  async function fetchMissingAvatars() {
    const missing = userChannels.filter(c => !c.avatar && c.username);
    if (missing.length === 0) return;

    let updatedAny = false;
    for (const ch of missing) {
      const pic = await fetchKickAvatar(ch.username);
      if (pic) {
        ch.avatar = pic;
        updatedAny = true;
        if (activeChannelObj && activeChannelObj.username.toLowerCase() === ch.username.toLowerCase()) {
          activeChannelObj.avatar = pic;
          updateUserProfileUI(ch.username, pic, activeChannelObj.role);
        }
      }
    }
    if (updatedAny) {
      renderChannelDropdownList();
    }
  }

  function dismissAuthGate() {
    if (gateDismissed) return;
    gateDismissed = true;

    const gate = document.getElementById('authGate');
    const app = document.getElementById('app');

    if (gate) {
      gate.classList.add('fade-out');
      setTimeout(() => {
        gate.style.display = 'none';
        gate.style.visibility = 'hidden';
      }, 400);
    }
    if (app) app.classList.add('fade-in');
    document.body.classList.remove('auth-loading');
  }

  function updateSidebarUserPlanAndRole() {
    const sidebarPlanEl = document.getElementById('userPlanLabel');
    if (!sidebarPlanEl) return;

    const isManaged = Boolean(activeChannelObj?.is_managed || activeChannelObj?.role === 'managed');
    const roleLabel = isManaged ? 'Menadžer' : 'Vlasnik';
    const roleClass = isManaged ? 'role-badge-managed' : 'role-badge-owner';

    const roleIcon = isManaged
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`
      : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.735H5.81a1 1 0 0 1-.957-.735L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/></svg>`;

    let effectivePlan = userPlan || 'free';
    if (isManaged && activeChannelObj?.owner_plan) {
      effectivePlan = String(activeChannelObj.owner_plan).toLowerCase();
    }
    if (!['free', 'pro', 'elite'].includes(effectivePlan)) {
      effectivePlan = (effectivePlan.includes('elite') || effectivePlan.includes('business')) ? 'elite' : (effectivePlan.includes('pro') ? 'pro' : 'free');
    }

    const planClass = 'plan-badge-' + effectivePlan;
    const planText = effectivePlan.toUpperCase();

    sidebarPlanEl.innerHTML = `
      <span class="plan-badge ${planClass}" id="planBadge">${planText}</span>
      <span class="role-badge ${roleClass}" id="roleBadge">${roleIcon}<span>${roleLabel}</span></span>
    `;

    const heroPlanBadge = document.getElementById('heroPlanBadge');
    if (heroPlanBadge) {
      heroPlanBadge.textContent = planText;
      heroPlanBadge.className = 'hero-plan-badge plan-' + effectivePlan;
    }
  }

  function updateUserProfileUI(username, avatarUrl, role) {
    const clean = cleanUsername(username);
    const nameEl = document.getElementById('userNameDisplay');
    const avatarEl = document.getElementById('userAvatarDisplay');
    const chPillEl = document.getElementById('connectedChannelName');
    const studioNameEl = document.getElementById('studioChannelName');
    const roleBadge = document.getElementById('connectedRoleBadge');
    const studioRoleBadge = document.getElementById('studioRoleBadge');

    // Telemetry Banner Elements
    const telNameEl = document.getElementById('telemetryChannelName');
    const telSlugEl = document.getElementById('telemetryKickSlug');
    const telLinkEl = document.getElementById('telemetryKickLink');
    const telAvatarEl = document.getElementById('telemetryAvatar');

    if (nameEl) nameEl.textContent = clean || 'Streamer';
    if (chPillEl) chPillEl.textContent = clean || 'Nepovezan';
    if (studioNameEl) studioNameEl.textContent = clean || 'Nepovezan';

    if (telNameEl) telNameEl.textContent = clean || 'Kanal';
    if (telSlugEl) telSlugEl.textContent = clean || 'kick';
    if (telLinkEl) telLinkEl.href = clean ? `https://kick.com/${clean}` : '#';

    const currentRole = role || activeChannelObj?.role || 'owner';
    let roleLabel = 'Vlasnik';
    let roleClass = 'cdm-role-owner';
    if (currentRole === 'managed' || activeChannelObj?.is_managed) {
      roleLabel = 'Menadžer';
      roleClass = 'cdm-role-managed';
    } else if (currentRole === 'custom') {
      roleLabel = 'Dodat';
      roleClass = 'cdm-role-custom';
    }

    if (roleBadge) {
      roleBadge.textContent = roleLabel;
      roleBadge.className = `cdm-role-badge ${roleClass}`;
    }
    if (studioRoleBadge) {
      studioRoleBadge.textContent = roleLabel;
      studioRoleBadge.className = `cdm-role-badge ${roleClass}`;
    }

    updateSidebarUserPlanAndRole();

    const applyAvatar = (el) => {
      if (!el) return;
      if (avatarUrl && /^https?:\/\//i.test(avatarUrl)) {
        const safeUrl = encodeURI(avatarUrl).replace(/["'()<>]/g, '');
        el.style.backgroundImage = `url("${safeUrl}")`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.textContent = '';
      } else {
        el.style.backgroundImage = 'none';
        el.style.backgroundColor = 'var(--an-cyan)';
        el.style.color = '#000';
        el.textContent = clean ? clean.charAt(0).toUpperCase() : 'K';
      }
    };

    applyAvatar(avatarEl);
    applyAvatar(telAvatarEl);
  }

  function renderChannelDropdownList() {
    const list = document.getElementById('cdmChannelList');
    const badge = document.getElementById('cdmCountBadge');
    if (!list) return;

    if (badge) badge.textContent = userChannels.length || 1;

    const checkSvg = `<svg class="cdm-active-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;

    if (!userChannels || userChannels.length === 0) {
      list.innerHTML = `
        <button type="button" class="cdm-item active" onclick="window.selectChannel('${escapeHtml(channelName)}')">
          <div class="cdm-item-left">
            <div class="cdm-avatar">${escapeHtml((channelName || 'K').charAt(0).toUpperCase())}</div>
            <div class="cdm-name-wrap">
              <span class="cdm-name">${escapeHtml(channelName)}</span>
              <span class="cdm-role-badge cdm-role-owner">Vlasnik</span>
            </div>
          </div>
          ${checkSvg}
        </button>
      `;
      return;
    }

    let html = '';
    userChannels.forEach(ch => {
      const u = cleanUsername(ch.username || ch.slug || 'Kanal');
      const isActive = u.toLowerCase() === channelName.toLowerCase();
      const initial = u.charAt(0).toUpperCase() || 'K';
      const safeAvatar = ch.avatar && /^https?:\/\//i.test(ch.avatar) ? ch.avatar.replace(/["'<>]/g, '') : '';
      const avatarStyle = safeAvatar ? `background-image: url('${escapeHtml(safeAvatar)}'); background-size: cover; background-position: center;` : '';

      let roleLabel = 'Vlasnik';
      let roleClass = 'cdm-role-owner';
      if (ch.role === 'managed' || ch.is_managed) {
        roleLabel = 'Menadžer';
        roleClass = 'cdm-role-managed';
      } else if (ch.role === 'custom') {
        roleLabel = 'Dodat';
        roleClass = 'cdm-role-custom';
      }

      html += `
        <button type="button" class="cdm-item ${isActive ? 'active' : ''}" onclick="window.selectChannel('${escapeHtml(u)}', '${ch.id || ''}', '${ch.chatroom_id || ''}', '${ch.role || 'owner'}', '${ch.owner_plan || ''}')">
          <div class="cdm-item-left">
            <div class="cdm-avatar" style="${avatarStyle}">${safeAvatar ? '' : initial}</div>
            <div class="cdm-name-wrap">
              <span class="cdm-name">${escapeHtml(u)}</span>
              <span class="cdm-role-badge ${roleClass}">${roleLabel}</span>
            </div>
          </div>
          ${isActive ? checkSvg : ''}
        </button>
      `;
    });
    list.innerHTML = html;
  }

  window.selectChannel = async function (channelInput, id, cId, role, ownerPlan) {
    if (!channelInput) return;

    let targetName = '';
    let targetObj = null;

    if (typeof channelInput === 'string') {
      targetName = cleanUsername(channelInput);
      targetObj = userChannels.find(c => c.username.toLowerCase() === targetName.toLowerCase()) || {
        id: id || null,
        username: targetName,
        avatar: '',
        chatroom_id: cId ? parseInt(cId, 10) : null,
        is_primary: false,
        is_managed: role === 'managed',
        role: role || 'owner',
        owner_id: currentUser ? currentUser.id : null,
        owner_plan: ownerPlan || userPlan
      };
    } else {
      targetObj = channelInput;
      targetName = cleanUsername(targetObj.username);
    }

    if (!targetName) return;

    if (!userChannels.some(c => c.username.toLowerCase() === targetName.toLowerCase())) {
      userChannels.push(targetObj);
    }

    channelName = targetName;
    activeChannelObj = targetObj;
    currentSessionDbId = null;
    channelId = targetObj.id || null;
    chatroomId = targetObj.chatroom_id ? parseInt(targetObj.chatroom_id, 10) : null;

    // Prilagodi plan: za kanale gde je korisnik Glavni Moderator (managed), nasleđuje se plan vlasnika tog kanala
    if (targetObj.role === 'managed' && targetObj.owner_plan) {
      userPlan = targetObj.owner_plan.includes('elite') ? 'elite' : (targetObj.owner_plan.includes('pro') ? 'pro' : 'free');
    } else {
      const myTier = (_currentUserProfile?.plan || 'free').toLowerCase();
      userPlan = (myTier.includes('elite') || myTier.includes('business')) ? 'elite' : (myTier.includes('pro') ? 'pro' : 'free');
      targetObj.owner_plan = userPlan;
    }

    const planBadge = document.getElementById('planBadge');
    if (planBadge) planBadge.textContent = userPlan.toUpperCase();

    localStorage.setItem('kickbot_selected_channel_name', channelName);
    if (channelId) localStorage.setItem('kickbot_selected_channel_id', String(channelId));

    const menu = document.getElementById('channelDropdownMenu');
    if (menu) menu.classList.remove('open');

    updateUserProfileUI(channelName, targetObj.avatar, targetObj.role);
    renderChannelDropdownList();

    updateStreamStatusUI('loading');
    await loadSavedSessionStats(channelName);
    connectToRealKickChat();
    loadRealKickChannelData(channelName).catch(() => {});
    fetchPastStreams().catch(() => {});
  };

  /* ════════════════════════════════════════
     KICK API & TELEMETRY
  ════════════════════════════════════════ */
  async function loadRealKickChannelData(slug) {
    if (!slug) return;
    const cleanSlug = cleanUsername(slug);
    if (!cleanSlug) return;
    let channelData = null;

    // 1. Primarno: Pokušaj preko Bot Backend API-ja (brz, stabilan, bez CORS problema)
    try {
      const apiBase = getBotApiBase();
      const botRes = await fetch(`${apiBase}/api/avatar?username=${encodeURIComponent(cleanSlug)}`, {
        signal: AbortSignal.timeout(BOT_API_TIMEOUT_MS)
      });
      if (botRes.ok) {
        const botData = await botRes.json();
        if (botData && (botData.chatroom_id || botData.avatar || botData.channel || botData.livestream)) {
          channelData = botData.channel || {
            user: { username: botData.username, profile_pic: botData.avatar },
            chatroom: { id: botData.chatroom_id },
            id: botData.id,
            livestream: botData.livestream,
            followers_count: botData.followers_count
          };
          if (botData.chatroom_id) chatroomId = parseInt(botData.chatroom_id, 10);
          if (botData.id) channelId = botData.id;
        }
      }
    } catch (_) {}

    // 2. Sekundarno: Netlify proxy funkcija (samo na produkciji, ne na localhostu)
    if (!channelData && typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      try {
        const targetUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(cleanSlug)}`;
        const netlifyRes = await fetch(`/.netlify/functions/api-proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUrl }),
          signal: AbortSignal.timeout(1500)
        });
        if (netlifyRes.ok) {
          channelData = await netlifyRes.json();
        }
      } catch (_) {}
    }

    // 3. Tercijarno: Allorigins raw & get fallback
    if (!channelData) {
      try {
        const targetUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(cleanSlug)}`;
        const fetchRaw = async () => {
          const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(ALLORIGINS_TIMEOUT_MS)
          });
          if (!res.ok) throw new Error('Raw non-200');
          return await res.json();
        };

        const fetchGet = async () => {
          const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`, {
            signal: AbortSignal.timeout(ALLORIGINS_TIMEOUT_MS)
          });
          if (!res.ok) throw new Error('Get non-200');
          const json = await res.json();
          if (!json.contents) throw new Error('No contents');
          return JSON.parse(json.contents);
        };

        channelData = await Promise.any([fetchRaw(), fetchGet()]);
      } catch (_) {}
    }

    // Ažuriraj vizuelne elemente kanala
    const nameEl = document.getElementById('telemetryChannelName');
    const slugEl = document.getElementById('telemetryKickSlug');
    const linkEl = document.getElementById('telemetryKickLink');
    const avatarEl = document.getElementById('telemetryAvatar');

    if (nameEl) nameEl.textContent = channelData?.user?.username || cleanSlug;
    if (slugEl) slugEl.textContent = cleanSlug;
    if (linkEl) linkEl.href = `https://kick.com/${cleanSlug}`;

    if (avatarEl && channelData?.user?.profile_pic && /^https?:\/\//i.test(channelData.user.profile_pic)) {
      const safePic = encodeURI(channelData.user.profile_pic).replace(/["'()<>]/g, '');
      avatarEl.style.backgroundImage = `url("${safePic}")`;
      avatarEl.style.backgroundSize = 'cover';
      avatarEl.textContent = '';
    }

    if (channelData?.chatroom?.id) {
      chatroomId = parseInt(channelData.chatroom.id, 10);
    }
    if (channelData?.id) {
      channelId = channelData.id;
    }
    if (channelData?.followers_count !== undefined) {
      liveStats.followersCount = channelData.followers_count;
    }

    // Proveri realan status strima sa Kick API-ja
    // Kick API v2 vraća livestream: null kad je offline, a non-null objekat kad je live
    // Nema posebnog is_live flaga na objektu — dovoljno je proveriti da li postoji
    if (channelData?.livestream) {
      isStreamCurrentlyLive = true;
      liveStats.liveViewers = channelData.livestream.viewer_count || 0;
      if (liveStats.liveViewers > liveStats.peakViewers) {
        liveStats.peakViewers = liveStats.liveViewers;
      }

      if (!liveStats.viewerSamples) liveStats.viewerSamples = [];
      if (liveStats.liveViewers > 0) {
        liveStats.viewerSamples.push(liveStats.liveViewers);
        if (liveStats.viewerSamples.length > VIEWER_SAMPLES_CAP) liveStats.viewerSamples.shift();
        const sum = liveStats.viewerSamples.reduce((a, b) => a + b, 0);
        liveStats.avgViewers = Math.round(sum / liveStats.viewerSamples.length);
      } else {
        liveStats.avgViewers = liveStats.liveViewers;
      }

      if (channelData.livestream.created_at) {
        streamStartTime = new Date(channelData.livestream.created_at).getTime();
      }
      currentStreamTitle = channelData.livestream.session_title || '';

      updateStreamStatusUI(true, currentStreamTitle, channelData.livestream.categories?.[0]?.name || 'Gaming');

      if (liveStats.totalMessages > 0 || liveStats.peakViewers > 0) {
        debouncedSaveSessionStats(slug);
      }
    } else {
      // Strim je sigurno OFFLINE
      if (isStreamCurrentlyLive) {
        isStreamCurrentlyLive = false;
        fetchPastStreams().catch(() => {});
      }

      liveStats.liveViewers = 0;
      liveStats.avgViewers = 0;
      liveStats.viewerSamples = [];
      streamStartTime = null;
      currentStreamTitle = '';
      detectedGeoRegion = 'Offline (Čeka se lajv)';
      geoMultiplierValue = 1.00;
      updateStreamStatusUI(false, 'Nema aktivnog strima', 'Offline');
    }

    updateDashboardUI();
  }

  function updateStreamStatusUI(isLive, title, category) {
    const channelDot = document.getElementById('channelDot');
    const statusText = document.getElementById('streamStatusText');
    const uptimeText = document.getElementById('streamUptimeText');
    const titleDisplay = document.getElementById('streamTitleDisplay');
    const catDisplay = document.getElementById('streamCategoryDisplay');
    const studioStatus = document.getElementById('studioStreamStatus');
    const liveBadge = document.getElementById('telemetryLiveBadge');
    const liveStatusText = document.getElementById('telemetryLiveStatusText');

    if (isLive === 'loading') {
      if (channelDot) channelDot.classList.remove('is-live');
      if (liveBadge) liveBadge.classList.remove('is-live');
      if (liveStatusText) liveStatusText.textContent = 'Učitavanje...';
      if (statusText) statusText.textContent = 'Učitavanje...';
      if (uptimeText) uptimeText.style.display = 'none';
      if (studioStatus) studioStatus.textContent = 'Učitavanje...';
      if (titleDisplay) titleDisplay.textContent = 'Učitavanje...';
      if (catDisplay) catDisplay.textContent = 'Kategorija: Učitavanje...';
      return;
    }

    if (titleDisplay) titleDisplay.textContent = title || 'Nema naslova';
    if (catDisplay) catDisplay.textContent = `Kategorija: ${category || 'Razno'}`;

    if (isLive === true) {
      if (channelDot) channelDot.classList.add('is-live');
      if (liveBadge) liveBadge.classList.add('is-live');
      if (liveStatusText) liveStatusText.textContent = 'LIVE';
      if (statusText) statusText.textContent = 'LIVE';
      if (uptimeText) uptimeText.style.display = 'inline-block';
      if (studioStatus) studioStatus.textContent = 'LIVE';

      if (!uptimeInterval) {
        uptimeInterval = setInterval(updateUptimeClock, 1000);
      }
    } else {
      if (channelDot) channelDot.classList.remove('is-live');
      if (liveBadge) liveBadge.classList.remove('is-live');
      if (liveStatusText) liveStatusText.textContent = 'OFFLINE';
      if (statusText) statusText.textContent = 'OFFLINE';
      if (uptimeText) uptimeText.style.display = 'none';
      if (studioStatus) studioStatus.textContent = 'OFFLINE';

      if (uptimeInterval) {
        clearInterval(uptimeInterval);
        uptimeInterval = null;
      }
      setText('streamUptimeDisplay', '--:--:--');
      setText('kcipHoursVal', '--:--:--');
    }
  }

  function updateUptimeClock() {
    if (!streamStartTime) return;
    const diff = Math.max(0, Date.now() - streamStartTime);
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    const formatted = `${pad(hours)}:${pad(mins)}:${pad(secs)}`;

    setText('streamUptimeText', formatted);
    setText('streamUptimeDisplay', formatted);
    setText('studioUptimeVal', formatted);
    setText('kcipHoursVal', formatted);
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  /* ════════════════════════════════════════
     WEBSOCKET REALTIME CHATROOM
  ════════════════════════════════════════ */
  async function connectToRealKickChat() {
    if (kickWebSocket) {
      try { kickWebSocket.close(); } catch (_) {}
      kickWebSocket = null;
    }

    if (!channelName) return;

    if (!chatroomId) {
      await loadRealKickChannelData(channelName);
    }

    if (!chatroomId) {
      console.warn(`Chatroom ID nije dostupan za kanal: ${channelName}`);
      return;
    }

    const pusherUrl = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.5.0&flash=false';

    // Reconnect state — reset pri svakom svesnom pozivu connectToRealKickChat
    if (!connectToRealKickChat._retryCount) connectToRealKickChat._retryCount = 0;

    try {
      kickWebSocket = new WebSocket(pusherUrl);
    } catch (err) {
      console.warn('[Kickan] WebSocket init greška:', err);
      return;
    }

    kickWebSocket.onopen = () => {
      connectToRealKickChat._retryCount = 0; // Reset po uspešnom spajanju
      console.info(`[Kickan] Realtime Connected: chatroom ${chatroomId}`);

      kickWebSocket.send(JSON.stringify({
        event: 'pusher:subscribe',
        data: { auth: '', channel: `chatrooms.${chatroomId}.v2` }
      }));

      kickWebSocket.send(JSON.stringify({
        event: 'pusher:subscribe',
        data: { auth: '', channel: `chatrooms.${chatroomId}` }
      }));

      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (kickWebSocket?.readyState === WebSocket.OPEN) {
          kickWebSocket.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
        }
      }, WS_PING_INTERVAL_MS);
    };

    kickWebSocket.onclose = () => {
      if (pingInterval) clearInterval(pingInterval);
      if (!channelName || !isTrackingActive) return;

      const retries = connectToRealKickChat._retryCount || 0;
      if (retries >= WS_RECONNECT_MAX_RETRIES) {
        console.warn(`[Kickan] WebSocket — dostignut maksimalan broj pokušaja (${WS_RECONNECT_MAX_RETRIES}). Reconnect zaustavljen.`);
        return;
      }
      // Exponential backoff: 5s, 10s, 20s, 40s... max ~80s
      const delay = Math.min(WS_RECONNECT_BASE_MS * Math.pow(2, retries), 80000);
      connectToRealKickChat._retryCount = retries + 1;
      setTimeout(() => {
        if (channelName && isTrackingActive) connectToRealKickChat();
      }, delay);
    };

    kickWebSocket.onmessage = (event) => {
      if (!isTrackingActive) return;

      let msgData;
      try {
        msgData = JSON.parse(event.data);
      } catch (parseErr) {
        console.warn('[Kickan] WS parse greška:', parseErr);
        return;
      }

      try {
        const evName = msgData.event || '';

        if (evName.includes('ChatMessageEvent') || evName.includes('ChatMessageSentEvent')) {
          const payload = typeof msgData.data === 'string' ? JSON.parse(msgData.data) : msgData.data;
          processChatMessageEvent(payload);
        } else if (evName.includes('UserBannedEvent') || evName.includes('MessageDeletedEvent')) {
          const payload = typeof msgData.data === 'string' ? JSON.parse(msgData.data) : msgData.data;
          processBanEvent(payload, evName.includes('MessageDeleted') ? 'Delete' : 'Ban');
        } else if (evName.includes('StreamHostEvent')) {
          liveStats.totalHosts++;
          playAlertSound('event');
          addRecentEventMessage('Stream Host', 'Novi dolazni raid/host na kanalu!');
          throttledUpdateUI();
        } else if (evName.includes('SubscriptionEvent') || evName.includes('GiftedSubscriptionsEvent')) {
          liveStats.activeSubs++;
          playAlertSound('event');
          addRecentEventMessage('Pretplata', 'Novi sub / poklonjena pretplata!');
          throttledUpdateUI();
        } else if (evName.includes('KicksGiftedEvent') || evName.includes('KicksGifted') || evName.includes('GiftedKicks') || evName.includes('KicksEvent')) {
          const payload = typeof msgData.data === 'string' ? JSON.parse(msgData.data) : msgData.data;
          const amount = parseInt(payload?.amount || payload?.kicks || payload?.gift_amount || payload?.kicks_amount || 10, 10) || 10;
          liveStats.totalKicks += amount;
          playAlertSound('event');
          addRecentEventMessage('Kicks Donacija', `${payload?.sender?.username || 'Gledalac'} je donirao ${amount} Kicks!`);
          throttledUpdateUI();
        }
      } catch (err) {
        console.warn('[Kickan] WS event obrada greška:', err);
      }
    };
  }

  function processChatMessageEvent(payload) {
    if (!payload || (!payload.sender && !payload.username)) return;

    liveStats.totalMessages++;
    const now = Date.now();
    rollingMessageTimes.push(now);

    const senderName = payload.sender?.username || payload.sender?.slug || payload.username || 'Gledalac';
    const content = payload.content || payload.message || '';

    if (payload.kicks || payload.gifted_kicks || payload.gift_kicks) {
      const kAmount = parseInt(payload.kicks || payload.gifted_kicks || payload.gift_kicks, 10) || 0;
      if (kAmount > 0) {
        liveStats.totalKicks += kAmount;
      }
    }

    let isSub = false;
    let isMod = false;
    let isVip = false;

    const badges = payload.sender?.identity?.badges || payload.sender?.badges || payload.badges || [];
    if (Array.isArray(badges)) {
      badges.forEach(b => {
        const t = (typeof b === 'string' ? b : b.type || '').toLowerCase();
        if (t.includes('sub') || t.includes('founder')) isSub = true;
        if (t.includes('mod') || t.includes('broadcaster')) isMod = true;
        if (t.includes('vip')) isVip = true;
      });
    }

    liveStats.uniqueChattersMap.add(senderName);

    // Detekcija demografije i jezika iz pravih poruka
    const lowerMsg = String(content || '').toLowerCase();
    const isBalkan = /[čćšđž]|(\b(brate|pozz|poz|cao|dobro|hvala|idemo|kako|sta|gde|ovde|super|igra|strim|nema|moze|jesi|nemoj|hocu|jeste|lepo|balkan|srb|cro|bih)\b)/i.test(lowerMsg);
    if (isBalkan) {
      balkanChatScore++;
      if (balkanChatScore >= 2) {
        detectedGeoRegion = 'Balkan / Ex-YU (Tier 2)';
        geoMultiplierValue = 0.95;
      }
    } else if (/[a-z]{3,}/i.test(lowerMsg)) {
      globalChatScore++;
      if (globalChatScore > balkanChatScore * 3 && globalChatScore > 10) {
        detectedGeoRegion = 'Global / US / EU (Tier 1)';
        geoMultiplierValue = 1.00;
      }
    }

    // Active Viewers Map
    const existing = liveStats.viewersActivityMap.get(senderName) || {
      count: 0,
      isSub: isSub,
      isMod: isMod,
      isVip: isVip,
      firstSeen: new Date().toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' }),
      lastSeen: new Date().toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })
    };
    existing.count++;
    existing.isSub = existing.isSub || isSub;
    existing.isMod = existing.isMod || isMod;
    existing.isVip = existing.isVip || isVip;
    existing.lastSeen = new Date().toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
    liveStats.viewersActivityMap.set(senderName, existing);

    // Emote Extraction
    const emoteRegex = /\[emote:\d+:(\w+)\]/g;
    let emoteMatches = [];
    let match;
    while ((match = emoteRegex.exec(content)) !== null) {
      emoteMatches.push(match[1]);
    }

    if (emoteMatches.length === 0) {
      const colonMatches = content.match(/:[a-zA-Z0-9_]+:/g);
      if (colonMatches) {
        colonMatches.forEach(m => emoteMatches.push(m.replace(/:/g, '')));
      } else {
        const words = content.split(' ');
        const commonEmotes = ['KEKW', 'LUL', 'PogChamp', 'Kappa', 'Sadge', 'MonkaS', 'Pepega', 'W', 'L', 'O7'];
        words.forEach(w => {
          if (commonEmotes.includes(w)) emoteMatches.push(w);
        });
      }
    }

    if (emoteMatches.length > 0) {
      emoteMatches.forEach(emote => {
        liveStats.totalEmotes++;
        const curr = liveStats.emotesMap.get(emote) || 0;
        liveStats.emotesMap.set(emote, curr + 1);
      });
    }

    // Hourly Histogram
    const currentHour = new Date().getHours();
    liveStats.hourlyCounts[currentHour]++;

    // Add to Live Chat Feed
    liveStats.recentChatMessages.unshift({
      id: Date.now() + Math.random(),
      author: senderName,
      content: content,
      time: new Date().toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      isSub: isSub,
      isMod: isMod,
      isEvent: false
    });
    if (liveStats.recentChatMessages.length > CHAT_FEED_MAX_MSGS) liveStats.recentChatMessages.pop();

    throttledUpdateUI();
  }

  function processBanEvent(payload, actionType) {
    liveStats.totalBans++;
    const bannedUser = payload.user?.username || payload.banned_user?.username || 'Korisnik';
    const modName = payload.moderator?.username || 'Sistem / Bot';
    const reason = payload.reason || (actionType === 'Delete' ? 'Obrisana poruka' : 'Privremeni timeout / ban');

    liveStats.banLogs.unshift({
      user: bannedUser,
      mod: modName,
      reason: reason,
      type: actionType,
      time: new Date().toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })
    });
    if (liveStats.banLogs.length > BAN_LOGS_MAX) liveStats.banLogs.pop();

    throttledUpdateUI();
  }

  function addRecentEventMessage(type, text) {
    liveStats.recentChatMessages.unshift({
      id: Date.now() + Math.random(),
      author: type,
      content: text,
      time: new Date().toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' }),
      isSub: true,
      isMod: false,
      isEvent: true
    });
    if (liveStats.recentChatMessages.length > CHAT_FEED_MAX_MSGS) liveStats.recentChatMessages.pop();
  }

  /* ════════════════════════════════════════
     CHAT VELOCITY CALCULATOR
  ════════════════════════════════════════ */
  function startVelocityTimer() {
    if (velocityInterval) clearInterval(velocityInterval);
    velocityInterval = setInterval(() => {
      const now = Date.now();
      const cutoff = now - VELOCITY_WINDOW_MS;
      rollingMessageTimes = rollingMessageTimes.filter(t => t >= cutoff);
      currentVelocity = rollingMessageTimes.length;

      if (currentVelocity > peakVelocity) {
        peakVelocity = currentVelocity;
      }

      // Check spike threshold
      const spikeThreshold = parseInt(document.getElementById('inputSpikeThreshold')?.value || '60', 10);
      const spikeToggle = document.getElementById('toggleSpikeAlert')?.checked;
      if (spikeToggle && currentVelocity >= spikeThreshold && currentVelocity % 20 === 0) {
        playAlertSound('spike');
      }

      setText('topbarVelocityVal', currentVelocity);
      setText('statChatVelocity', `${currentVelocity}/m`);
      setText('studioVelocity', `${currentVelocity}/m`);
      setText('studioStatChatVelocity', `${currentVelocity}/m`);
    }, 1000);
  }

  /* ════════════════════════════════════════
     UI UPDATE RENDERING
  ════════════════════════════════════════ */
  let uiUpdateTimer = null;
  function throttledUpdateUI() {
    if (!uiUpdateTimer) {
      uiUpdateTimer = setTimeout(() => {
        updateDashboardUI();
        uiUpdateTimer = null;
      }, UI_THROTTLE_MS);
    }
  }

  function calculateEstimatedEarnings(customOptions) {
    // KCIP satnica važi isključivo dok je kanal uživo sa aktivnim gledaocima
    let durationHours = 0;
    const stats = customOptions?.liveStats || liveStats;
    const isLive = customOptions?.liveStats
      ? Boolean((stats.liveViewers || 0) > 0)
      : Boolean(liveStats.liveViewers > 0);

    const sStart = customOptions?.streamStartTime !== undefined ? customOptions.streamStartTime : streamStartTime;
    const currentNow = customOptions?.now !== undefined ? customOptions.now : Date.now();
    const velocityVal = customOptions?.currentVelocity !== undefined ? customOptions.currentVelocity : currentVelocity;

    if (isLive && sStart) {
      // Trajanje aktivne sesije ograničeno na max 12h po pojedinačnom lajvu
      durationHours = Math.min(12, Math.max(0, (currentNow - sStart) / 3600000));
    } else {
      durationHours = 0;
    }

    const viewers = stats.avgViewers || stats.liveViewers || 0;
    const uniqueChatters = stats.uniqueChattersMap ? stats.uniqueChattersMap.size : 0;
    const followers = stats.followersCount || liveStats.followersCount || 0;

    // 1. Prosečan broj gledalaca tokom strima (Glavni faktor, satnica raste sa brojem gledalaca)
    let baseHourlyRate = 0;
    let tierLabel = 'OFFLINE';

    if (viewers >= 3000) { baseHourlyRate = 60.00; tierLabel = 'KCIP ELITE'; }
    else if (viewers >= 1500) { baseHourlyRate = 45.00; tierLabel = 'KCIP TIER 1'; }
    else if (viewers >= 1000) { baseHourlyRate = 35.00; tierLabel = 'KCIP TIER 1'; }
    else if (viewers >= 500)  { baseHourlyRate = 25.00; tierLabel = 'KCIP TIER 2'; }
    else if (viewers >= 250)  { baseHourlyRate = 18.00; tierLabel = 'KCIP TIER 2'; }
    else if (viewers >= 100)  { baseHourlyRate = 16.00; tierLabel = 'KCIP CLASS 1'; } // Zvanični KCIP Class 1 ($16/h za ~100)
    else if (viewers >= 50)   { baseHourlyRate = 8.00;  tierLabel = 'KCIP CLASS 2'; }
    else if (viewers >= 25)   { baseHourlyRate = 4.00;  tierLabel = 'KCIP ASPIRING'; }
    else if (viewers >= 10)   { baseHourlyRate = 2.00;  tierLabel = 'COMMUNITY TIER'; }
    else { baseHourlyRate = 0; tierLabel = isLive ? 'MIKRO STRIM' : 'OFFLINE'; }

    // Zaštita od nerealnih bot cifara: ukoliko je procenat aktivnih čatera ekstremno nizak (<5% publike)
    // satnica se normalizuje na realnu verifikovanu publiku sa chata
    let isBotAdjusted = false;
    let verifiedAudience = viewers;
    if (viewers > 100 && uniqueChatters > 0 && uniqueChatters < viewers * 0.05) {
      isBotAdjusted = true;
      verifiedAudience = Math.max(uniqueChatters * 12, Math.round(viewers * 0.25));
      if (verifiedAudience < 100) baseHourlyRate = Math.min(baseHourlyRate, 8.00);
      else if (verifiedAudience < 250) baseHourlyRate = Math.min(baseHourlyRate, 16.00);
      else if (verifiedAudience < 500) baseHourlyRate = Math.min(baseHourlyRate, 22.00);
      else if (verifiedAudience < 1000) baseHourlyRate = Math.min(baseHourlyRate, 30.00);
    }

    // 2. Chat Velocity Multiplikator (koliko brzo i gusto pišu u čatu kao multiplikator angažovanosti)
    let engagementMult = 1.00;
    if (isLive && viewers > 0) {
      const chatterRatio = uniqueChatters / Math.max(viewers, 1);
      if (velocityVal >= 80 || (velocityVal >= 40 && chatterRatio >= 0.12)) {
        engagementMult = 1.25;
      } else if (velocityVal >= 40 || (velocityVal >= 20 && chatterRatio >= 0.08)) {
        engagementMult = 1.15;
      } else if (velocityVal >= 15 || chatterRatio >= 0.05) {
        engagementMult = 1.08;
      } else if (velocityVal > 0) {
        engagementMult = 1.00;
      } else if (uniqueChatters > 0 && uniqueChatters < viewers * 0.03) {
        // Pasivan chat penal
        engagementMult = 0.90;
      } else {
        engagementMult = 1.00;
      }
    }
    if (customOptions?.engagementMult !== undefined) {
      engagementMult = customOptions.engagementMult;
    }

    // 3. Demografija gledalaca (Tier 1 / 2 geo multiplikator iz telemetrije)
    let geoMultiplier = customOptions?.geoMultiplier !== undefined ? customOptions.geoMultiplier : geoMultiplierValue;
    let geoRegion = customOptions?.geoRegion || detectedGeoRegion;
    if (!isLive) {
      geoRegion = 'Offline (Čeka se lajv)';
      geoMultiplier = 1.00;
    }

    // Efektivna satnica sa multiplikatorima
    const effectiveHourlyRate = Number((baseHourlyRate * engagementMult * geoMultiplier).toFixed(2));
    const kcipEst = Number((durationHours * effectiveHourlyRate).toFixed(2));

    // 4. CPM za reklame (cena reklame na 1000 prikaza, prosek ~$3.00 CPM)
    // Prikazi se računaju samo za gledaoce bez pretplate (Subs ne vide reklame)
    const estimatedCpm = 3.00;
    const activeSubsCount = stats.activeSubs || 0;
    const effectiveAdViewers = Math.max(0, (isBotAdjusted ? verifiedAudience : viewers) - activeSubsCount);
    const adImpressions = isLive ? (durationHours * effectiveAdViewers * 1.5) : 0;
    const adRevenueEst = Number(((adImpressions / 1000) * estimatedCpm).toFixed(2));

    // 5. Pretplate (Kick Partner 95/5 split: $4.75 kreatoru po novoj pretplati tokom sesije)
    const subsEst = Number((activeSubsCount * 4.75).toFixed(2));

    // 6. Kicks Donacije (1 Kick = $0.01 direktan prihod kreatora)
    const kicksEst = Number(((stats.totalKicks || 0) * 0.01).toFixed(2));

    // Ukupna procenjena zarada sesije (u fullu - sve 4 komponente)
    const totalEst = Number((kcipEst + subsEst + kicksEst + adRevenueEst).toFixed(2));

    // KCIP Dinamički status kvalifikacije
    let qualificationStatus = 'Offline (Čeka se lajv)';
    let qualificationClass = 'status-offline';
    if (isLive) {
      if (viewers >= 100 && followers >= 300) {
        qualificationStatus = 'Kvalifikovan (Class 1)';
        qualificationClass = 'status-qualified';
      } else if (viewers >= 100) {
        qualificationStatus = 'Kvalifikovan (100 CCV)';
        qualificationClass = 'status-qualified';
      } else if (viewers >= 25) {
        qualificationStatus = `Aspiring (${viewers}/100 CCV)`;
        qualificationClass = 'status-aspiring';
      } else {
        qualificationStatus = `Zajednica (${viewers}/100 CCV)`;
        qualificationClass = 'status-community';
      }
    }

    return {
      kcipEst,
      subsEst,
      kicksEst,
      adRevenueEst,
      totalEst,
      durationHours,
      baseHourlyRate,
      effectiveHourlyRate,
      hourlyRate: baseHourlyRate, // Za backwards kompatibilnost sa testovima
      engagementMult,
      estimatedCpm,
      geoMultiplier,
      geoRegion,
      tierLabel,
      viewers,
      verifiedAudience,
      uniqueChatters,
      currentVelocity: velocityVal,
      isBotAdjusted,
      qualificationStatus,
      qualificationClass
    };
  }
  window.calculateEstimatedEarnings = calculateEstimatedEarnings;

  function updateDashboardUI() {
    // Hero Summary Strip
    setText('statTotalMessages', liveStats.totalMessages.toLocaleString());
    setText('statLiveViewers', liveStats.liveViewers.toLocaleString());
    setText('statUniqueChatters', liveStats.uniqueChattersMap.size.toLocaleString());

    // Kick Partner & KCIP Estimated Earnings
    const earnings = calculateEstimatedEarnings();
    const formattedTotal = '$' + earnings.totalEst.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedKcip = '$' + earnings.kcipEst.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedSubs = '$' + earnings.subsEst.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedKicks = '$' + earnings.kicksEst.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedAdRevenue = '$' + earnings.adRevenueEst.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedSubsAndKicks = '$' + (earnings.subsEst + earnings.kicksEst).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Hero Summary Strip (Top Right)
    setText('statEstimatedEarnings', formattedTotal);

    // Dedicated KCIP Monetization Section - Top Row
    setText('metricEstEarningsHero', formattedTotal);
    setText('kcipRateChip', `~ $${earnings.effectiveHourlyRate.toFixed(2)} / sat`);
    setText('kcipTierPill', earnings.tierLabel);
    setText('kcipEngageMultBadge', `${earnings.engagementMult.toFixed(2)}x`);
    setText('kcipCpmBadge', `$${earnings.estimatedCpm.toFixed(2)}`);

    // Dynamic KCIP Qualification Status Chip
    setText('kcipStatusVal', earnings.qualificationStatus);
    const chipDot = document.getElementById('kcipStatusDot');
    if (chipDot) {
      chipDot.className = `ksc-dot ${earnings.qualificationClass}`;
    }

    // Factor 1: Prosečni Gledaoci
    setText('kcipAvgViewersVal', liveStats.liveViewers > 0 ? (liveStats.avgViewers || liveStats.liveViewers).toLocaleString() : 'Offline');
    const baseRateNotice = earnings.isBotAdjusted ? `$${earnings.baseHourlyRate.toFixed(2)}/h (Zaštićeno)` : `$${earnings.baseHourlyRate.toFixed(2)}/h`;
    setText('kcipBaseRateVal', baseRateNotice);

    // Factor 2: Odstrimovano Vreme
    if (liveStats.liveViewers > 0 && streamStartTime) {
      const diff = Math.max(0, Date.now() - streamStartTime);
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setText('kcipHoursVal', `${pad(hours)}:${pad(mins)}:${pad(secs)}`);
    } else {
      setText('kcipHoursVal', liveStats.liveViewers > 0 ? '00:00:00' : '--:--:--');
    }
    setText('kcipHoursDecimal', `${earnings.durationHours.toFixed(2)} h`);

    // Factor 3: Chat Velocity Multiplikator
    setText('kcipVelocityVal', `${earnings.engagementMult.toFixed(2)}x`);
    setText('kcipVelocitySpeed', `${currentVelocity} msg/min`);

    // Factor 4: CPM za Reklame
    setText('kcipCpmVal', `$${earnings.estimatedCpm.toFixed(2)} CPM`);
    setText('kcipAdRevenueVal', formattedAdRevenue);

    // Factor 5: Demografija & Geo
    setText('kcipGeoVal', earnings.geoRegion);
    setText('kcipGeoMultVal', `${earnings.geoMultiplier.toFixed(2)}x`);

    // Factor 6: Ukupna Angažovanost (Subs, Kicks, KCIP)
    setText('kcipSubsKicksVal', formattedSubsAndKicks);
    setText('kcipSubsCountVal', `${(liveStats.activeSubs || 0)} Subs (${formattedSubs})`);
    setText('kcipKicksCountVal', `${(liveStats.totalKicks || 0)} Kicks (${formattedKicks})`);
    setText('mbKcipHourlyEst', formattedKcip);
    setText('mbSubsEst', formattedSubs);
    setText('mbKicksEst', formattedKicks);

    // Overview Card Stats
    setText('statPeakViewers', liveStats.peakViewers.toLocaleString());
    setText('statFollowersCount', liveStats.followersCount.toLocaleString());
    setText('statChatroomId', chatroomId ? `#${chatroomId}` : '#---');

    // 8 Bento Metrics
    setText('metricTotalMessages', liveStats.totalMessages.toLocaleString());
    setText('metricAvgViewers', liveStats.liveViewers > 0 ? liveStats.liveViewers.toLocaleString() : 'Offline');
    setText('metricUniqueChatters', liveStats.uniqueChattersMap.size.toLocaleString());
    setText('metricTotalEmotes', liveStats.totalEmotes.toLocaleString());
    setText('metricTotalKicks', liveStats.totalKicks.toLocaleString());
    setText('metricTotalBans', liveStats.totalBans.toLocaleString());
    setText('metricTotalHosts', liveStats.totalHosts.toLocaleString());
    setText('metricActiveSubs', liveStats.activeSubs.toLocaleString());

    // Fullscreen Studio Sync
    setText('studioTotalMessages', liveStats.totalMessages.toLocaleString());
    setText('studioLiveViewers', liveStats.liveViewers.toLocaleString());
    setText('studioVelocity', `${currentVelocity}/m`);
    setText('studioTopUniqueChatters', liveStats.uniqueChattersMap.size.toLocaleString());
    setText('studioTopKicks', liveStats.totalKicks.toLocaleString());

    // Fullscreen Studio Stats Card (dole u praznom)
    setText('studioStatTotalMessages', liveStats.totalMessages.toLocaleString());
    setText('studioStatUniqueChatters', liveStats.uniqueChattersMap.size.toLocaleString());
    setText('studioStatTotalKicks', liveStats.totalKicks.toLocaleString());
    setText('studioStatEstEarnings', formattedTotal);
    setText('studioStatPeakViewers', liveStats.peakViewers.toLocaleString());
    setText('studioStatTotalEmotes', liveStats.totalEmotes.toLocaleString());
    setText('studioStatChatVelocity', `${currentVelocity}/m`);
    setText('studioStatActiveSubs', (liveStats.activeSubs || 0).toLocaleString());

    renderHourlyBarChart();
    renderPopularEmotes();
    renderLiveChatFeed();
    renderChattersLeaderboard();
    renderBanHistoryTable();

    if (channelName) debouncedSaveSessionStats(channelName);
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  /* ── 24h Hourly Bar Chart ── */
  function renderHourlyBarChart() {
    const container = document.getElementById('hourlyChartViewport');
    const studioContainer = document.getElementById('studioHourlyChartViewport');
    if (!container && !studioContainer) return;

    const maxVal = Math.max(...liveStats.hourlyCounts, 10);
    let peakHour = 0;
    let maxHourCount = 0;
    let html = '';

    // maxVal izračunat jednom gore — ne ponavljamo Math.max unutar petlje
    liveStats.hourlyCounts.forEach((val, hour) => {
      if (val > maxHourCount) {
        maxHourCount = val;
        peakHour = hour;
      }
      const pct = Math.round((val / maxVal) * 100);
      const isPeak = val > 0 && val === maxVal;
      const hourStr = hour < 10 ? `0${hour}h` : `${hour}h`;

      html += `
        <div class="chart-bar-col" title="${hourStr}: ${val} poruka">
          <div class="chart-bar-fill ${isPeak ? 'highlight' : ''}" style="height: ${Math.max(pct, 3)}%;"></div>
          <span class="chart-bar-label">${hour % 4 === 0 ? hourStr : ''}</span>
        </div>
      `;
    });

    if (container) container.innerHTML = html;
    if (studioContainer) studioContainer.innerHTML = html;

    const peakLabel = document.getElementById('hourlyPeakLabel');
    if (peakLabel) {
      if (maxHourCount > 0) {
        const nextHour = (peakHour + 1) % 24;
        peakLabel.textContent = `Peak: ${pad(peakHour)}:00 - ${pad(nextHour)}:00 (${maxHourCount} msgs)`;
        peakLabel.style.display = 'inline-block';
      } else {
        peakLabel.textContent = '';
        peakLabel.style.display = 'none';
      }
    }
  }

  /* ── Popular Emotes List ── */
  function renderPopularEmotes() {
    const container = document.getElementById('popularEmotesContainer');
    const studioContainer = document.getElementById('studioPopularEmotesContainer');
    const totalLabel = document.getElementById('emotesTotalLabel');

    if (totalLabel) {
      if (liveStats.totalEmotes > 0) {
        totalLabel.textContent = `Ukupno: ${liveStats.totalEmotes.toLocaleString()} emotea`;
        totalLabel.style.display = 'inline-block';
      } else {
        totalLabel.textContent = '';
        totalLabel.style.display = 'none';
      }
    }

    if (liveStats.emotesMap.size === 0) {
      if (container) container.innerHTML = '';
      if (studioContainer) studioContainer.innerHTML = '';
      return;
    }

    const sortedEmotes = Array.from(liveStats.emotesMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    const maxCount = sortedEmotes[0] ? sortedEmotes[0][1] : 1;
    let html = '';

    sortedEmotes.forEach(([name, count], index) => {
      const pct = Math.round((count / maxCount) * 100);
      html += `
        <div class="progress-item-row">
          <div class="progress-item-header">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:0.75rem; color:var(--an-muted); font-weight:800;">#${index + 1}</span>
              <strong style="color:#fff;">${escapeHtml(name)}</strong>
            </div>
            <span style="color:var(--an-amber); font-weight:800; font-family:'JetBrains Mono',monospace;">${count.toLocaleString()}x</span>
          </div>
          <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width: ${pct}%;"></div>
          </div>
        </div>
      `;
    });

    if (container) container.innerHTML = html;
    if (studioContainer) studioContainer.innerHTML = html;
  }

  /* ── Live Chat Feed ── */
  function renderLiveChatFeed() {
    const container = document.getElementById('liveChatFeedContainer');
    const studioContainer = document.getElementById('studioLiveFeedContainer');
    if (!container && !studioContainer) return;

    let filtered = liveStats.recentChatMessages;
    if (activeChatFilter === 'subs') {
      filtered = filtered.filter(m => m.isSub);
    } else if (activeChatFilter === 'mods') {
      filtered = filtered.filter(m => m.isMod);
    } else if (activeChatFilter === 'events') {
      filtered = filtered.filter(m => m.isEvent);
    }

    if (filtered.length === 0) {
      const emptyHtml = `<div class="feed-empty-state">Nema poruka za izabrani filter.</div>`;
      if (container) container.innerHTML = emptyHtml;
      if (studioContainer) studioContainer.innerHTML = emptyHtml;
      return;
    }

    let html = '';
    filtered.slice(0, 25).forEach(m => {
      const badgeHtml = m.isSub
        ? `<span style="background:rgba(236,72,153,0.2); color:var(--an-pink); font-size:0.65rem; font-weight:800; padding:1px 5px; border-radius:4px;">SUB</span>`
        : (m.isMod ? `<span style="background:rgba(83,252,24,0.2); color:var(--an-green); font-size:0.65rem; font-weight:800; padding:1px 5px; border-radius:4px;">MOD</span>` : '');

      html += `
        <div class="feed-msg-row">
          <span class="feed-msg-time">${m.time}</span>
          <span class="feed-msg-author">${escapeHtml(m.author)}</span>
          ${badgeHtml}
          <span class="feed-msg-content">${escapeHtml(m.content)}</span>
        </div>
      `;
    });

    if (container) container.innerHTML = html;
    if (studioContainer) studioContainer.innerHTML = html;
  }

  window.setChatFilter = function (filterType) {
    activeChatFilter = filterType;
    document.querySelectorAll('.feed-filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === filterType);
    });
    renderLiveChatFeed();
  };

  /* ── Chatters Leaderboard ── */
  function renderChattersLeaderboard() {
    const tbody = document.getElementById('tableMostActiveViewers');
    if (!tbody) return;

    if (!liveStats.viewersActivityMap || liveStats.viewersActivityMap.size === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="5" class="table-empty-state">Nema aktivnih gledalaca</td></tr>`;
      return;
    }

    const searchQuery = (document.getElementById('inputSearchChatters')?.value || '').toLowerCase().trim();
    let sorted = Array.from(liveStats.viewersActivityMap.entries())
      .map(([user, data]) => ({ user, ...data }))
      .sort((a, b) => b.count - a.count);

    if (searchQuery) {
      sorted = sorted.filter(item => item.user.toLowerCase().includes(searchQuery));
    }

    const minThreshold = parseInt(document.getElementById('inputMinMsgThreshold')?.value || '50', 10);
    sorted = sorted.filter(item => item.count >= minThreshold);

    if (sorted.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="5" class="table-empty-state">Nema aktivnih gledalaca</td></tr>`;
      return;
    }

    const totalMsgs = Math.max(liveStats.totalMessages, 1);
    let html = '';

    sorted.slice(0, 30).forEach((item, index) => {
      const rank = index + 1;
      let badgeClass = '';
      if (rank === 1) badgeClass = 'rank-1';
      else if (rank === 2) badgeClass = 'rank-2';
      else if (rank === 3) badgeClass = 'rank-3';

      const sharePct = ((item.count / totalMsgs) * 100).toFixed(1);

      let statusTag = `<span class="table-status-pill pill-viewer">Gledalac</span>`;
      if (item.isMod) statusTag = `<span class="table-status-pill pill-mod">MOD</span>`;
      else if (item.isSub) statusTag = `<span class="table-status-pill pill-sub">SUB</span>`;
      else if (item.isVip) statusTag = `<span class="table-status-pill pill-vip">VIP</span>`;

      html += `
        <tr>
          <td><span class="rank-badge-pill ${badgeClass}">#${rank}</span></td>
          <td><strong style="color:#fff;">${escapeHtml(item.user)}</strong></td>
          <td style="color:var(--an-cyan); font-weight:800; font-family:'JetBrains Mono',monospace;">${item.count.toLocaleString()}</td>
          <td style="font-family:'JetBrains Mono',monospace; font-size:0.8rem; color:var(--an-muted);">${sharePct}%</td>
          <td>${statusTag}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  }

  window.filterChattersTable = function () {
    renderChattersLeaderboard();
  };

  /* ── Ban & Moderation History ── */
  function renderBanHistoryTable() {
    const tbody = document.getElementById('tableBanHistory');
    if (!tbody) return;

    if (!liveStats.banLogs || liveStats.banLogs.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="4" class="table-empty-state">Nema zabeleženih akcija</td></tr>`;
      return;
    }

    const searchQuery = (document.getElementById('inputSearchBans')?.value || '').toLowerCase().trim();
    let logs = liveStats.banLogs;

    if (searchQuery) {
      logs = logs.filter(b => b.user.toLowerCase().includes(searchQuery) || b.mod.toLowerCase().includes(searchQuery) || b.reason.toLowerCase().includes(searchQuery));
    }

    if (logs.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="4" class="table-empty-state">Nema zabeleženih akcija</td></tr>`;
      return;
    }

    let html = '';
    logs.slice(0, 20).forEach(b => {
      const typeBadge = b.type === 'Delete'
        ? `<span class="table-status-pill pill-delete">Delete</span>`
        : `<span class="table-status-pill pill-ban">Ban</span>`;

      html += `
        <tr>
          <td>
            <div style="font-weight:700; color:#fff;">${escapeHtml(b.user)}</div>
            <div style="font-size:0.72rem; color:var(--an-muted); margin-top:2px;">${escapeHtml(b.reason)}</div>
          </td>
          <td style="color:var(--an-muted); font-size:0.82rem;">${escapeHtml(b.mod)}</td>
          <td>${typeBadge}</td>
          <td style="font-size:0.8rem; color:var(--an-muted2); font-family:'JetBrains Mono',monospace;">${b.time}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  }

  window.filterBansTable = function () {
    renderBanHistoryTable();
  };

  window.clearBanHistory = function () {
    liveStats.banLogs = [];
    renderBanHistoryTable();
    if (window.showToast) window.showToast('Istorija moderacije očišćena.', 'info');
  };

  /* ════════════════════════════════════════
     AUDIO SYNTHESIZER ALERTS
  ════════════════════════════════════════ */
  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playAlertSound(type) {
    if (isMuted) return;
    const soundToggle = document.getElementById('toggleSoundAlerts')?.checked;
    if (!soundToggle) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const volNode = ctx.createGain();
      volNode.gain.setValueAtTime(soundVolume, now);
      volNode.connect(ctx.destination);

      if (type === 'event') {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.15);
        osc.connect(volNode);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'spike') {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
        osc.connect(volNode);
        osc.start(now);
        osc.stop(now + 0.15);
      }
    } catch (_) {}
  }

  /* ════════════════════════════════════════
     SIDEBAR CONTROLS & ACTIONS
  ════════════════════════════════════════ */
  window.toggleLiveTracking = function () {
    isTrackingActive = !isTrackingActive;
    const btn = document.getElementById('btnToggleTracking');
    const label = document.getElementById('btnTrackingLabel');

    if (btn) btn.classList.toggle('active', isTrackingActive);
    if (label) label.textContent = isTrackingActive ? 'Praćenje je aktivno' : 'Praćenje je pauzirano';

    if (window.showToast) {
      window.showToast(isTrackingActive ? 'Praćenje chata aktivirano' : 'Praćenje chata pauzirano', 'info');
    }
  };

  function updateMuteIcon() {
    const icon = document.getElementById('muteIcon');
    if (!icon) return;
    if (!isMuted) {
      icon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>`;
      icon.style.opacity = '1';
    } else {
      icon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <line x1="23" y1="9" x2="17" y2="15"/>
        <line x1="17" y1="9" x2="23" y2="15"/>`;
      icon.style.opacity = '0.7';
    }
  }

  window.toggleMute = function () {
    isMuted = !isMuted;
    const btn = document.getElementById('btnMuteSound');
    if (btn) btn.classList.toggle('is-muted', isMuted);
    updateMuteIcon();
    if (window.showToast) {
      window.showToast(isMuted ? 'Zvukovi isključeni' : 'Zvukovi uključeni', 'info');
    }
  };

  window.toggleUserMenu = function () {
    const menu = document.getElementById('userMenuSm');
    if (menu) menu.classList.toggle('open');
  };

  window.toggleChannelDropdown = function (e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('channelDropdownMenu');
    if (menu) menu.classList.toggle('open');
  };

  /* ── Notifications & Changelog iz Baze (identično Kickot) ── */
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
        btn.style.borderColor = 'var(--an-red, #ef4444)';
        btn.style.color       = 'var(--an-red, #ef4444)';
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
          <div style="color: var(--an-muted); text-align: center; padding: 28px 14px; font-size: 0.82rem; display: flex; flex-direction: column; align-items: center; gap: 8px;">
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
          iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
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
                  <div style="font-size: 0.83rem; font-weight: 700; color: #fff; line-height: 1.3;">${escapeHtml(n.title)}</div>
                  <div style="font-size: 0.68rem; color: var(--an-muted); white-space: nowrap;">${formattedTime}</div>
                </div>
                <div style="font-size: 0.77rem; color: #cbd5e1; margin-top: 4px; line-height: 1.45;">${escapeHtml(n.desc)}</div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      if (changelogs.length === 0) {
        list.innerHTML = `
          <div style="color: var(--an-muted); text-align: center; padding: 28px 14px; font-size: 0.82rem; display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.5;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span>Trenutno nema novih changelog informacija.</span>
          </div>`;
        return;
      }

      list.innerHTML = changelogs.map(c => `
        <div style="padding: 12px 14px; border-radius: 12px; background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); transition: all 0.2s; margin-bottom: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 0.72rem; font-weight: 800; color: #a78bfa; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); padding: 2px 8px; border-radius: 6px; letter-spacing: 0.5px;">${escapeHtml(c.version)}</span>
            <span style="font-size: 0.68rem; color: var(--an-muted); display: flex; align-items: center; gap: 4px;">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              ${escapeHtml(c.date)}
            </span>
          </div>
          <div style="font-size: 0.84rem; font-weight: 700; color: #fff; margin-bottom: 4px; text-align: left;">${escapeHtml(c.title)}</div>
          <div style="font-size: 0.77rem; color: #cbd5e1; line-height: 1.45; text-align: left;">${escapeHtml(c.details)}</div>
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
    if (window.showToast) window.showToast('Sva obaveštenja su označena kao pročitana.', 'info');
  };

  window.switchNotifTab = function (tab) {
    activeNotifTab = tab;
    document.getElementById('notifTabObavestenja')?.classList.toggle('active', tab === 'obavestenja');
    document.getElementById('notifTabChangelog')?.classList.toggle('active', tab === 'changelog');
    renderNotifContent();
  };

  window.toggleNotifCenter = function () {
    const popover = document.getElementById('notifPopover');
    if (!popover) return;
    const isOpen = popover.classList.toggle('open');
    if (isOpen) {
      renderNotifContent();
    }
  };

  window.refreshDatabase = async function () {
    const btnEl = document.querySelector('.topbar-refresh-btn');
    const svgEl = btnEl ? btnEl.querySelector('svg') : null;
    if (svgEl) svgEl.style.animation = 'spin 1s linear infinite';
    try {
      await Promise.all([
        loadRealKickChannelData(channelName),
        loadSavedSessionStats(channelName),
        loadNotifications(),
        loadChangelogs()
      ]);
      if (window.showToast) {
        window.showToast('Podaci uspešno sinhronizovani iz baze.', 'success');
      }

      if (btnEl) {
        if (svgEl) svgEl.style.animation = '';
        btnEl.classList.add('is-success');
        btnEl.innerHTML = `
          <svg fill="none" height="16" stroke="#53fc18" stroke-linecap="round" stroke-linejoin="round" stroke-width="3" viewBox="0 0 24 24" width="16">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;
        setTimeout(() => {
          btnEl.classList.remove('is-success');
          btnEl.innerHTML = `
            <svg class="refresh-icon" fill="none" height="16" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="16">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          `;
        }, 1800);
      }
    } catch (err) {
      console.warn('[Kickan] Greška pri osvežavanju:', err);
      if (window.showToast) {
        window.showToast('Greška pri osvežavanju podataka.', 'error');
      }
      if (svgEl) svgEl.style.animation = '';
    }
  };

  /* ════════════════════════════════════════
     FULLSCREEN STUDIO HUD
  ════════════════════════════════════════ */
  window.openFullscreenStudio = function () {
    const overlay = document.getElementById('kickanFullscreenOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      overlay.setAttribute('aria-hidden', 'false');
      updateDashboardUI();
      renderHourlyBarChart();
      renderPopularEmotes();
      renderLiveChatFeed();
    }
  };

  window.closeFullscreenStudio = function () {
    const overlay = document.getElementById('kickanFullscreenOverlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
    }
  };

  /* ════════════════════════════════════════
     MODALS & EXPORT (Accessible Focus Trap & Aria-Hidden)
  ════════════════════════════════════════ */
  let activeModalStack = [];
  const modalTriggerElements = new Map();

  function getFocusableElements(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll(
      'button:not([disabled]):not([tabindex="-1"]), [href]:not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
    ));
  }

  window.openModal = function (id) {
    const m = document.getElementById(id);
    if (!m) return;
    if (document.activeElement && !m.contains(document.activeElement)) {
      modalTriggerElements.set(id, document.activeElement);
    }
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    const appEl = document.getElementById('app');
    if (appEl) appEl.setAttribute('aria-hidden', 'true');

    if (!activeModalStack.includes(id)) {
      activeModalStack.push(id);
    }

    setTimeout(() => {
      const focusable = getFocusableElements(m);
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }, 40);
  };

  window.closeModal = function (id) {
    const m = document.getElementById(id);
    if (m) {
      m.classList.remove('open');
      m.setAttribute('aria-hidden', 'true');
    }
    activeModalStack = activeModalStack.filter(item => item !== id);
    if (activeModalStack.length === 0) {
      const appEl = document.getElementById('app');
      if (appEl) appEl.removeAttribute('aria-hidden');
    }

    const triggerEl = modalTriggerElements.get(id);
    if (triggerEl && typeof triggerEl.focus === 'function') {
      try { triggerEl.focus(); } catch (_) {}
      modalTriggerElements.delete(id);
    }
  };

  window.handleModalBg = function (e, id) {
    if (e.target.id === id) window.closeModal(id);
  };



  window.openExportModal = function () {
    window.openModal('exportReportModal');
  };

  window.openResetModal = function () {
    window.openModal('resetStatsConfirmModal');
  };

  window.confirmResetStats = function () {
    currentSessionDbId = null;

    liveStats.totalMessages = 0;
    liveStats.totalEmotes = 0;
    liveStats.totalBans = 0;
    liveStats.totalHosts = 0;
    liveStats.totalKicks = 0;
    liveStats.peakViewers = 0;
    liveStats.uniqueChattersMap.clear();
    liveStats.emotesMap.clear();
    liveStats.viewersActivityMap.clear();
    liveStats.banLogs = [];
    liveStats.recentChatMessages = [];
    liveStats.hourlyCounts.fill(0);
    rollingMessageTimes = [];

    if (channelName) localStorage.removeItem(`kickan_session_${channelName}`);

    updateDashboardUI();
    window.closeModal('resetStatsConfirmModal');
    if (window.showToast) window.showToast('Statistika sesije uspešno resetovana.', 'info');
  };

  window.openHelpModal = function () {
    window.openModal('helpModal');
  };

  window.handleSignOut = async function () {
    if (sb) {
      await sb.auth.signOut();
      window.location.href = '../index.html';
    }
  };

  /* ── Download Reports ── */
  window.downloadReport = function (format) {
    const reportData = {
      channel: channelName,
      generatedAt: new Date().toISOString(),
      summary: {
        totalMessages: liveStats.totalMessages,
        uniqueChatters: liveStats.uniqueChattersMap.size,
        liveViewers: liveStats.liveViewers,
        peakViewers: liveStats.peakViewers,
        totalEmotes: liveStats.totalEmotes,
        totalBans: liveStats.totalBans,
        totalHosts: liveStats.totalHosts,
        totalKicks: liveStats.totalKicks,
        chatVelocity: currentVelocity
      },
      topChatters: Array.from(liveStats.viewersActivityMap.entries()).map(([user, d]) => ({ user, ...d })),
      topEmotes: Array.from(liveStats.emotesMap.entries()).map(([name, count]) => ({ name, count })),
      banLogs: liveStats.banLogs
    };

    let mimeType = 'text/plain';
    let fileContent = '';
    let fileName = `kickan_analytics_${channelName}_${Date.now()}.${format}`;

    if (format === 'json') {
      mimeType = 'application/json';
      fileContent = JSON.stringify(reportData, null, 2);
    } else if (format === 'csv') {
      mimeType = 'text/csv;charset=utf-8;';
      let csv = 'Tip,Korisnik/Emote,Broj/Vrednost,Status/Razlog,Vreme\n';
      csv += `Statistika,Ukupno Poruka,${liveStats.totalMessages},--,--\n`;
      csv += `Statistika,Jedinstveni Chatters,${liveStats.uniqueChattersMap.size},--,--\n`;
      csv += `Statistika,Peak Gledaoci,${liveStats.peakViewers},--,--\n`;

      reportData.topChatters.forEach((c, idx) => {
        csv += `Top Gledalac #${idx + 1},${c.user},${c.count},${c.isSub ? 'SUB' : 'Gledalac'},${c.lastSeen}\n`;
      });

      reportData.topEmotes.forEach(e => {
        csv += `Emote,${e.name},${e.count},--,--\n`;
      });

      fileContent = csv;
    }

    const blob = new Blob([fileContent], { type: mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.closeModal('exportReportModal');
    if (window.showToast) window.showToast(`Izveštaj uspešno preuzet (${format.toUpperCase()}).`, 'info');
  };

  window.copySummaryToClipboard = function () {
    const summary = `[KICKAN STREAM ANALYTICS] — ${channelName}
- Ukupno poruka: ${liveStats.totalMessages}
- Jedinstveni chatters: ${liveStats.uniqueChattersMap.size}
- Peak gledaoci: ${liveStats.peakViewers}
- Brzina chata: ${currentVelocity} msg/min
- Korisceno emotea: ${liveStats.totalEmotes}
- Sankcije moderacije: ${liveStats.totalBans}
Generisano u Kickan Studio.`;

    navigator.clipboard.writeText(summary).then(() => {
      if (window.showToast) window.showToast('Sažetak kopiran u clipboard!', 'info');
    });
  };

  window.copyChattersLeaderboard = function () {
    const sorted = Array.from(liveStats.viewersActivityMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);

    let text = `TOP 10 NAJAKTIVNIJIH GLEDALACA — ${channelName}\n`;
    sorted.forEach(([u, d], idx) => {
      text += `${idx + 1}. @${u} — ${d.count} poruka (${d.isSub ? 'SUB' : 'Gledalac'})\n`;
    });

    navigator.clipboard.writeText(text).then(() => {
      if (window.showToast) window.showToast('Leaderboard kopiran u clipboard!', 'info');
    });
  };

  /* ════════════════════════════════════════
     AUTONOMOUS SESSION PERSISTENCE (SUPABASE + LOCALSTORAGE)
  ════════════════════════════════════════ */
  async function loadSavedSessionStats(slug) {
    if (!slug) return;

    // 1. Prioritet: Obnovi aktivnu sesiju koju je Kickot Bot pratio 24/7 na serveru
    if (sb) {
      try {
        const { data: dbSession, error } = await sb
          .from('kickan')
          .select('*')
          .ilike('channel_name', slug)
          .is('ended_at', null)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && dbSession) {
          currentSessionDbId = dbSession.id;
          if (dbSession.started_at) {
            streamStartTime = new Date(dbSession.started_at).getTime();
          }
          if (dbSession.chatroom_id) {
            chatroomId = parseInt(dbSession.chatroom_id, 10);
          }
          if (dbSession.channel_id) {
            channelId = dbSession.channel_id;
          }
          liveStats.totalMessages = dbSession.total_messages || 0;
          liveStats.totalEmotes = dbSession.total_emotes || 0;
          liveStats.peakViewers = dbSession.peak_viewers || 0;
          if (dbSession.chat_velocity_peak) {
            peakVelocity = dbSession.chat_velocity_peak;
          }

          if (dbSession.summary) {
            const sum = dbSession.summary;
            if (Array.isArray(sum.topChatters)) {
              sum.topChatters.forEach(c => {
                liveStats.uniqueChattersMap.add(c.user);
                liveStats.viewersActivityMap.set(c.user, {
                  count: c.count || 0,
                  isSub: !!c.isSub,
                  isMod: !!c.isMod,
                  isVip: !!c.isVip,
                  lastSeen: c.lastSeen || '--'
                });
              });
            }
            if (Array.isArray(sum.topEmotes)) {
              sum.topEmotes.forEach(e => {
                liveStats.emotesMap.set(e.name, e.count || 0);
              });
            }
            if (Array.isArray(sum.banLogs)) {
              liveStats.banLogs = sum.banLogs;
              liveStats.totalBans = sum.banLogs.length;
            }
            if (Array.isArray(sum.hourlyCounts) && sum.hourlyCounts.length === 24) {
              liveStats.hourlyCounts = sum.hourlyCounts;
            }
          }

          updateDashboardUI();
          renderChattersLeaderboard();
          renderBanHistoryTable();
          renderPopularEmotes();
          renderHourlyBarChart();
          return;
        }
      } catch (dbErr) {
        console.warn('[Kickan] Greška pri preuzimanju aktivne autonomne sesije iz baze:', dbErr);
      }
    }

    // 2. Fallback: Lokalno sačuvana sesija iz LocalStorage-a
    try {
      const raw = localStorage.getItem(`kickan_session_${slug}`);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved) {
          if (saved.totalMessages) liveStats.totalMessages = saved.totalMessages;
          if (saved.totalEmotes) liveStats.totalEmotes = saved.totalEmotes;
          if (saved.totalBans) liveStats.totalBans = saved.totalBans;
          if (saved.totalHosts) liveStats.totalHosts = saved.totalHosts;
          if (saved.totalKicks) liveStats.totalKicks = saved.totalKicks;
          if (saved.peakViewers) liveStats.peakViewers = saved.peakViewers;

          if (Array.isArray(saved.uniqueChatters)) {
            liveStats.uniqueChattersMap = new Set(saved.uniqueChatters);
          }
          if (Array.isArray(saved.emotes)) {
            liveStats.emotesMap = new Map(saved.emotes);
          }
          if (Array.isArray(saved.viewers)) {
            liveStats.viewersActivityMap = new Map(saved.viewers);
          }
          if (Array.isArray(saved.banLogs)) {
            liveStats.banLogs = saved.banLogs;
          }
          if (Array.isArray(saved.hourlyCounts)) {
            liveStats.hourlyCounts = saved.hourlyCounts;
          }
        }
      }
    } catch (_) {}
  }

  let saveSessionTimeout = null;
  function debouncedSaveSessionStats(slug) {
    if (!slug) return;
    if (saveSessionTimeout) return;
    saveSessionTimeout = setTimeout(() => {
      saveSessionTimeout = null;
      saveSessionStats(slug);
    }, 10000);
  }

  function saveSessionStats(slug) {
    if (!slug) return;
    try {
      if (liveStats.viewerSamples && liveStats.viewerSamples.length > 500) {
        liveStats.viewerSamples = liveStats.viewerSamples.slice(-500);
      }
      const payload = {
        totalMessages: liveStats.totalMessages,
        totalEmotes: liveStats.totalEmotes,
        totalBans: liveStats.totalBans,
        totalHosts: liveStats.totalHosts,
        totalKicks: liveStats.totalKicks,
        peakViewers: liveStats.peakViewers,
        uniqueChatters: Array.from(liveStats.uniqueChattersMap),
        emotes: Array.from(liveStats.emotesMap.entries()),
        viewers: Array.from(liveStats.viewersActivityMap.entries()),
        banLogs: liveStats.banLogs,
        hourlyCounts: liveStats.hourlyCounts
      };
      localStorage.setItem(`kickan_session_${slug}`, JSON.stringify(payload));
    } catch (_) {}
  }

  /* ════════════════════════════════════════
     PAST STREAMS ARCHIVE (SUPABASE)
  ════════════════════════════════════════ */
  function formatDuration(totalSeconds) {
    const s = Math.max(0, parseInt(totalSeconds, 10) || 0);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    return `${String(hrs).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }

  function formatDateTime(isoString) {
    if (!isoString) return '--';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('sr-Latn-RS', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return String(isoString);
    }
  }

  async function fetchPastStreams() {
    if (!sb || !currentUser) return;
    try {
      let query = sb.from('kickan').select('*');
      if (channelName) {
        query = query.ilike('channel_name', channelName);
      } else {
        query = query.eq('user_id', currentUser.id);
      }
      const { data, error } = await query.order('started_at', { ascending: false }).limit(50);
      if (!error && Array.isArray(data)) {
        pastStreamsList = data;
        updatePastStreamsBadges();
        renderPastStreamsCarousel();
        renderPastStreamsTable();
      }
    } catch (err) {
      console.warn('fetchPastStreams error:', err.message);
    }
  }

  function updatePastStreamsBadges() {
    const count = pastStreamsList.length;
    const sidebarCountEl = document.getElementById('sidebarPastStreamsCount');
    const topbarBadgeEl = document.getElementById('pastStreamsCountBadge');
    const modalCountEl = document.getElementById('pastStreamsModalCount');
    const carouselBadgeEl = document.getElementById('carouselStreamsCountBadge');
    const filterChannelEl = document.getElementById('pastStreamsFilterChannelName');

    if (sidebarCountEl) sidebarCountEl.textContent = count;
    if (modalCountEl) modalCountEl.textContent = `${count} ${count === 1 ? 'lajv' : 'lajvova'}`;
    if (carouselBadgeEl) carouselBadgeEl.textContent = `${count} ${count === 1 ? 'snimak' : 'snimaka'}`;
    if (filterChannelEl) filterChannelEl.textContent = channelName || 'Svi';

    if (topbarBadgeEl) {
      topbarBadgeEl.textContent = count;
      topbarBadgeEl.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  }

  function renderPastStreamsCarousel() {
    const track = document.getElementById('pastStreamsCarouselTrack');
    if (!track) return;

    if (!pastStreamsList || pastStreamsList.length === 0) {
      track.innerHTML = `
        <div class="psc-empty">
          Nema sačuvanih lajvova u arhivi za kanal <strong>@${escapeHtml(channelName || 'Kick')}</strong>. 
          Sesije se automatski arhiviraju nakon svakog završenog strima.
        </div>
      `;
      return;
    }

    let cardsHtml = '';
    pastStreamsList.forEach(s => {
      const dateStr = formatDateTime(s.started_at);
      const title = s.stream_title || 'Kick Live Stream';
      const durationStr = formatDuration(s.duration_seconds);
      const peakViewers = s.peak_viewers || 0;
      const msgs = s.total_messages || 0;

      cardsHtml += `
        <div class="psc-card" onclick="window.viewPastStreamDetail('${escapeHtml(String(s.id))}')" title="Kliknite za kompletan izveštaj">
          <div class="psc-card-top">
            <span class="psc-card-date">${escapeHtml(dateStr)}</span>
            <span class="psc-card-duration">${escapeHtml(durationStr)}</span>
          </div>
          <div class="psc-card-title">${escapeHtml(title)}</div>
          <div class="psc-card-metrics">
            <span>Peak: <strong style="color:var(--an-green);">${peakViewers.toLocaleString()}</strong></span>
            <span>Poruke: <strong>${msgs.toLocaleString()}</strong></span>
          </div>
        </div>
      `;
    });

    track.innerHTML = cardsHtml;
  }

  window.scrollStreamsCarousel = function (direction) {
    const track = document.getElementById('pastStreamsCarouselTrack');
    if (!track) return;
    const scrollAmount = 280 * direction;
    track.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  };

  function renderPastStreamsTable(searchTerm = '') {
    const tbody = document.getElementById('pastStreamsTableBody');
    if (!tbody) return;

    let filtered = pastStreamsList;
    if (searchTerm) {
      const term = searchTerm.toLowerCase().trim();
      filtered = pastStreamsList.filter(s =>
        (s.channel_name && s.channel_name.toLowerCase().includes(term)) ||
        (s.stream_title && s.stream_title.toLowerCase().includes(term)) ||
        (s.started_at && s.started_at.toLowerCase().includes(term))
      );
    }

    if (!filtered || filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="table-empty-state">
            ${searchTerm ? 'Nema pronađenih lajvova za zadati pojam pretrage.' : 'Nema sačuvanih lajvova u arhivi. Sesije se automatski prate i arhiviraju 24/7 po završetku svakog strima.'}
          </td>
        </tr>
      `;
      return;
    }

    let rows = '';
    filtered.forEach(s => {
      const dateStr = formatDateTime(s.started_at);
      const title = s.stream_title || 'Kick Live Stream';
      const chName = s.channel_name || channelName;
      const durationStr = formatDuration(s.duration_seconds);
      const peakViewers = s.peak_viewers || 0;
      const msgs = s.total_messages || 0;
      const unique = s.unique_chatters || 0;
      const vel = s.chat_velocity_peak || 0;

      rows += `
        <tr>
          <td>
            <div style="font-weight:700; color:#fff;">${escapeHtml(dateStr)}</div>
            <div style="font-size:0.75rem; color:var(--an-muted);">ID: ${escapeHtml(String(s.id).slice(0, 8))}</div>
          </td>
          <td>
            <div style="font-weight:700; color:var(--an-cyan);">@${escapeHtml(chName)}</div>
            <div style="font-size:0.75rem; color:#cbd5e1; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(title)}">
              ${escapeHtml(title)}
            </div>
          </td>
          <td>
            <span style="font-family:'JetBrains Mono',monospace; font-size:0.8rem; color:#fff;">${escapeHtml(durationStr)}</span>
          </td>
          <td>
            <span style="color:var(--an-green); font-weight:800; font-family:'JetBrains Mono',monospace;">${peakViewers.toLocaleString()}</span>
          </td>
          <td>
            <span style="font-weight:700;">${msgs.toLocaleString()}</span>
          </td>
          <td>
            <span style="color:#cbd5e1;">${unique.toLocaleString()}</span>
          </td>
          <td>
            <span style="color:var(--an-amber); font-weight:700;">${vel} msg/m</span>
          </td>
          <td style="text-align:right;">
            <div class="ps-action-btns">
              <button type="button" class="ps-btn ps-btn-view" onclick="window.viewPastStreamDetail('${escapeHtml(String(s.id))}')" title="Prikaži kompletan sažetak">
                Detalji
              </button>
              <button type="button" class="ps-btn ps-btn-export" onclick="window.exportPastStream('${escapeHtml(String(s.id))}', 'csv')" title="Preuzmi CSV">
                CSV
              </button>
              <button type="button" class="ps-btn ps-btn-export" onclick="window.exportPastStream('${escapeHtml(String(s.id))}', 'json')" title="Preuzmi JSON">
                JSON
              </button>
              <button type="button" class="ps-btn ps-btn-delete" onclick="window.deletePastStream('${escapeHtml(String(s.id))}')" title="Obriši iz baze">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = rows;
  }

  function filterPastStreamsTable() {
    const input = document.getElementById('pastStreamsSearchInput');
    const val = input ? input.value : '';
    renderPastStreamsTable(val);
  }

  function openPastStreamsModal() {
    fetchPastStreams();
    window.openModal('pastStreamsModal');
  }

  async function saveLiveStreamToDatabase(manual = false) {
    if (!sb || !currentUser) {
      if (manual && window.showToast) {
        window.showToast('Morate biti prijavljeni da biste sačuvali lajv u bazu.', 'error');
      }
      return;
    }

    if (isSavingStream) return;

    // Don't save empty session unless user explicitly requested
    if (liveStats.totalMessages === 0 && liveStats.peakViewers === 0 && !streamStartTime) {
      if (manual && window.showToast) {
        window.showToast('Trenutna sesija nema zabeležene aktivnosti za čuvanje.', 'warn');
      }
      return;
    }

    isSavingStream = true;
    try {
      const now = new Date();
      const durationSec = streamStartTime ? Math.max(0, Math.floor((now.getTime() - streamStartTime) / 1000)) : 0;

      // Extract top chatters
      const topChatters = Array.from(liveStats.viewersActivityMap.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 25)
        .map(([user, data]) => ({ user, ...data }));

      // Extract top emotes
      const topEmotes = Array.from(liveStats.emotesMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([name, count]) => ({ name, count }));

      const summaryPayload = {
        topChatters,
        topEmotes,
        banLogs: (liveStats.banLogs || []).slice(0, 50),
        hourlyCounts: Array.from(liveStats.hourlyCounts),
        uniqueChattersCount: liveStats.uniqueChattersMap.size,
        chatVelocity: currentVelocity,
        peakVelocity: peakVelocity,
        savedAt: now.toISOString()
      };

      const realAvgViewers = (liveStats.avgViewers && liveStats.avgViewers > 0)
        ? liveStats.avgViewers
        : (liveStats.peakViewers || 0);

      const targetUserId = activeChannelObj?.owner_id || currentUser.id;

      const payload = {
        user_id: targetUserId,
        channel_name: channelName || 'Kick Kanal',
        channel_id: channelId ? String(channelId) : null,
        chatroom_id: chatroomId ? parseInt(chatroomId, 10) : null,
        stream_title: currentStreamTitle || 'Kick Live Stream',
        started_at: streamStartTime ? new Date(streamStartTime).toISOString() : now.toISOString(),
        ended_at: now.toISOString(),
        duration_seconds: durationSec,
        peak_viewers: liveStats.peakViewers || 0,
        avg_viewers: realAvgViewers,
        total_messages: liveStats.totalMessages || 0,
        total_emotes: liveStats.totalEmotes || 0,
        unique_chatters: liveStats.uniqueChattersMap.size || 0,
        chat_velocity_peak: peakVelocity || 0,
        moderation_actions: (liveStats.totalBans || 0) + (liveStats.totalKicks || 0),
        summary: summaryPayload,
        updated_at: now.toISOString()
      };

      if (currentSessionDbId) {
        const { error } = await sb.from('kickan').update(payload).eq('id', currentSessionDbId);
        if (error) throw error;
      } else if (activeChannelObj?.role !== 'managed' || activeChannelObj?.owner_id === currentUser.id) {
        // Samo vlasnik kanala može kreirati novi zapis kroz frontend klijent; menadžeri se oslanjaju na 24/7 server bot
        const { data, error } = await sb.from('kickan').insert([payload]).select('id').maybeSingle();
        if (error) throw error;
        if (data?.id) currentSessionDbId = data.id;
      } else {
        console.info('[Kickan] Kanonski zapis za ovaj kanal kreira 24/7 server bot; klijent menadžera čita ažurno stanje.');
      }

      await fetchPastStreams();

      if (manual && window.showToast) {
        window.showToast('Lajv sesija je uspešno sačuvana u Kickan arhivu!', 'success');
      }
    } catch (err) {
      console.error('saveLiveStreamToDatabase error:', err);
      if (manual && window.showToast) {
        window.showToast('Greška pri čuvanju sesije u bazu: ' + err.message, 'error');
      }
    } finally {
      isSavingStream = false;
    }
  }

  function deletePastStream(streamId) {
    if (!streamId || !sb || !currentUser) return;
    const stream = pastStreamsList.find(s => s.id === streamId);
    const title = stream ? (stream.stream_title || 'Kick Live Stream') : 'ovaj lajv';
    const dateStr = stream ? formatDateTime(stream.started_at) : '';

    const descEl = document.getElementById('deleteConfirmDesc');
    if (descEl) {
      descEl.textContent = `"${title}"${dateStr ? ' (' + dateStr + ')' : ''} — zapis ce biti trajno uklonjen iz arhive. Ova akcija se ne moze ponistiti.`;
    }

    const btn = document.getElementById('deleteConfirmBtn');
    if (btn) {
      btn.onclick = async () => {
        window.closeModal('deleteStreamConfirmModal');
        try {
          const { error } = await sb.from('kickan').delete().eq('id', streamId);
          if (error) throw error;
          pastStreamsList = pastStreamsList.filter(s => s.id !== streamId);
          if (currentSessionDbId === streamId) currentSessionDbId = null;
          updatePastStreamsBadges();
          renderPastStreamsCarousel();
          renderPastStreamsTable();
          if (window.showToast) window.showToast('Zapis lajva uspešno obrisan iz arhive.', 'info');
        } catch (err) {
          console.error('deletePastStream error:', err);
          if (window.showToast) window.showToast('Greška pri brisanju zapisa: ' + err.message, 'error');
        }
      };
    }

    window.openModal('deleteStreamConfirmModal');
  }

  function viewPastStreamDetail(streamId) {
    const stream = pastStreamsList.find(s => s.id === streamId);
    if (!stream) return;

    const container = document.getElementById('pastStreamDetailContent');
    const titleEl = document.getElementById('pastStreamDetailTitle');
    const channelEl = document.getElementById('pastStreamDetailChannel');
    if (!container) return;

    const dateStr = formatDateTime(stream.started_at);
    const dateEndStr = stream.ended_at ? formatDateTime(stream.ended_at) : 'Aktivno';
    const durationStr = formatDuration(stream.duration_seconds);
    const summary = stream.summary || {};
    const topChatters = summary.topChatters || [];
    const topEmotes = summary.topEmotes || [];
    const banLogs = summary.banLogs || [];
    const hourlyCounts = summary.hourlyCounts || [];

    if (titleEl) titleEl.textContent = stream.stream_title || 'Kick Live Stream';
    if (channelEl) channelEl.textContent = '@' + (stream.channel_name || 'kanal');

    // Wire up export buttons
    const csvBtn = document.getElementById('psdExportCsvBtn');
    const jsonBtn = document.getElementById('psdExportJsonBtn');
    if (csvBtn) csvBtn.onclick = () => window.exportPastStream(streamId, 'csv');
    if (jsonBtn) jsonBtn.onclick = () => window.exportPastStream(streamId, 'json');

    // Hourly chart mini
    let hourlyHtml = '';
    if (hourlyCounts.length === 24) {
      const maxH = Math.max(...hourlyCounts, 1);
      hourlyHtml = hourlyCounts.map((v, h) => {
        const pct = Math.round((v / maxH) * 100);
        return `<div class="psd-hour-bar" title="${h}:00 — ${v} msg" style="--psd-bar-h:${pct}%"><span class="psd-hour-label">${h}</span></div>`;
      }).join('');
    }

    // Top chatters
    let chattersHtml = '';
    if (topChatters.length > 0) {
      chattersHtml = topChatters.slice(0, 10).map((c, i) => {
        const badges = [
          c.isSub ? '<span class="psd-badge psd-badge-sub">SUB</span>' : '',
          c.isMod ? '<span class="psd-badge psd-badge-mod">MOD</span>' : '',
          c.isVip ? '<span class="psd-badge psd-badge-vip">VIP</span>' : ''
        ].join('');
        const rankClass = i === 0 ? 'psd-rank-gold' : i === 1 ? 'psd-rank-silver' : i === 2 ? 'psd-rank-bronze' : '';
        return `
          <div class="psd-leaderboard-row">
            <span class="psd-rank ${rankClass}">#${i + 1}</span>
            <span class="psd-leaderboard-name">@${escapeHtml(c.user)}${badges}</span>
            <span class="psd-leaderboard-val">${(c.count || 0).toLocaleString()} msg</span>
          </div>`;
      }).join('');
    } else {
      chattersHtml = '<div class="psd-empty-notice">Nema podataka o gledaocima.</div>';
    }

    // Top emotes
    let emotesHtml = '';
    if (topEmotes.length > 0) {
      emotesHtml = topEmotes.slice(0, 8).map((e, i) => {
        const pct = topEmotes[0].count > 0 ? Math.round((e.count / topEmotes[0].count) * 100) : 0;
        return `
          <div class="psd-emote-row">
            <span class="psd-emote-rank">#${i + 1}</span>
            <span class="psd-emote-name">${escapeHtml(e.name)}</span>
            <div class="psd-emote-bar"><div style="width:${pct}%"></div></div>
            <span class="psd-emote-count">${(e.count || 0).toLocaleString()}x</span>
          </div>`;
      }).join('');
    } else {
      emotesHtml = '<div class="psd-empty-notice">Nema zabeleženih emotea.</div>';
    }

    // Ban logs
    let bansHtml = '';
    if (banLogs.length > 0) {
      bansHtml = banLogs.slice(0, 6).map(b => `
        <div class="psd-ban-row">
          <span class="psd-ban-type ${b.type === 'BAN' ? 'psd-ban-type-ban' : 'psd-ban-type-del'}">${escapeHtml(b.type || 'BAN')}</span>
          <span class="psd-ban-user">@${escapeHtml(b.user)}</span>
          <span class="psd-ban-reason">${escapeHtml(b.reason || 'Bez razloga')}</span>
          <span class="psd-ban-time">${escapeHtml(b.time || '')}</span>
        </div>`).join('');
    }

    container.innerHTML = `
      <!-- Meta info strip -->
      <div class="psd-meta-strip">
        <span class="psd-meta-item">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${escapeHtml(dateStr)}
        </span>
        <span class="psd-meta-dot"></span>
        <span class="psd-meta-item">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${escapeHtml(durationStr)}
        </span>
        <span class="psd-meta-dot"></span>
        <span class="psd-meta-item" style="color:var(--an-muted);">Arhivovano: ${escapeHtml(formatDateTime(stream.updated_at || stream.started_at))}</span>
      </div>

      <!-- Stat cards -->
      <div class="psd-stats-grid">
        <div class="psd-stat-card psd-stat-viewers">
          <svg class="psd-stat-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <div class="psd-stat-val">${(stream.peak_viewers || 0).toLocaleString()}</div>
          <div class="psd-stat-label">Peak Gledaoci</div>
        </div>
        <div class="psd-stat-card psd-stat-messages">
          <svg class="psd-stat-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <div class="psd-stat-val">${(stream.total_messages || 0).toLocaleString()}</div>
          <div class="psd-stat-label">Ukupno Poruka</div>
        </div>
        <div class="psd-stat-card psd-stat-chatters">
          <svg class="psd-stat-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <div class="psd-stat-val">${(stream.unique_chatters || 0).toLocaleString()}</div>
          <div class="psd-stat-label">Jedinstveni</div>
        </div>
        <div class="psd-stat-card psd-stat-velocity">
          <svg class="psd-stat-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <div class="psd-stat-val">${stream.chat_velocity_peak || 0}<span style="font-size:0.7em;font-weight:500;">/m</span></div>
          <div class="psd-stat-label">Peak Brzina</div>
        </div>
        <div class="psd-stat-card psd-stat-emotes">
          <svg class="psd-stat-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
          <div class="psd-stat-val">${(stream.total_emotes || 0).toLocaleString()}</div>
          <div class="psd-stat-label">Emoti</div>
        </div>
        <div class="psd-stat-card psd-stat-mod">
          <svg class="psd-stat-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <div class="psd-stat-val">${stream.moderation_actions || 0}</div>
          <div class="psd-stat-label">Moderacija</div>
        </div>
      </div>

      <!-- Body: three columns -->
      <div class="psd-body-cols">

        <!-- Top Chatters -->
        <div class="psd-col-box">
          <div class="psd-col-head">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--an-cyan)" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            Top Gledaoci
          </div>
          <div class="psd-leaderboard">${chattersHtml}</div>
        </div>

        <!-- Top Emotes -->
        <div class="psd-col-box">
          <div class="psd-col-head">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--an-green)" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
            Top Emoti
          </div>
          <div class="psd-emote-list">${emotesHtml}</div>
        </div>

        ${bansHtml ? `
        <!-- Moderacija -->
        <div class="psd-col-box">
          <div class="psd-col-head">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--an-red)" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Moderacija (${banLogs.length})
          </div>
          <div class="psd-ban-list">${bansHtml}</div>
        </div>` : ''}
      </div>

      ${hourlyHtml ? `
      <!-- Hourly chart -->
      <div class="psd-col-box psd-hourly-box">
        <div class="psd-col-head">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--an-amber)" stroke-width="2.5"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
          Aktivnost po satima
        </div>
        <div class="psd-hourly-chart">${hourlyHtml}</div>
      </div>` : ''}
    `;

    window.openModal('pastStreamDetailModal');
  }

  function exportPastStream(streamId, format) {
    const stream = pastStreamsList.find(s => s.id === streamId);
    if (!stream) return;

    const summary = stream.summary || {};
    const topChatters = summary.topChatters || [];
    const topEmotes = summary.topEmotes || [];
    const banLogs = summary.banLogs || [];

    const exportData = {
      id: stream.id,
      channel: stream.channel_name,
      streamTitle: stream.stream_title,
      startedAt: stream.started_at,
      endedAt: stream.ended_at,
      durationSeconds: stream.duration_seconds,
      durationFormatted: formatDuration(stream.duration_seconds),
      metrics: {
        peakViewers: stream.peak_viewers,
        totalMessages: stream.total_messages,
        uniqueChatters: stream.unique_chatters,
        chatVelocityPeak: stream.chat_velocity_peak,
        totalEmotes: stream.total_emotes,
        moderationActions: stream.moderation_actions
      },
      topChatters,
      topEmotes,
      banLogs
    };

    let mimeType = 'text/plain';
    let fileContent = '';
    const fileName = `kickan_archive_${stream.channel_name}_${String(stream.id).slice(0, 8)}.${format}`;

    if (format === 'json') {
      mimeType = 'application/json';
      fileContent = JSON.stringify(exportData, null, 2);
    } else if (format === 'csv') {
      mimeType = 'text/csv;charset=utf-8;';
      let csv = 'Tip,Naziv/Korisnik,Broj/Vrednost,Status/Detalj,Vreme\n';
      csv += `Lajv Sesija,Kanal,${stream.channel_name},--,${stream.started_at}\n`;
      csv += `Lajv Sesija,Naslov,${(stream.stream_title || '').replace(/,/g, ' ')},--,--\n`;
      csv += `Lajv Sesija,Trajanje,${formatDuration(stream.duration_seconds)},${stream.duration_seconds}s,--\n`;
      csv += `Lajv Sesija,Peak Gledaoci,${stream.peak_viewers},--,--\n`;
      csv += `Lajv Sesija,Ukupno Poruka,${stream.total_messages},--,--\n`;
      csv += `Lajv Sesija,Jedinstveni Chatters,${stream.unique_chatters},--,--\n`;
      csv += `Lajv Sesija,Peak Brzina,${stream.chat_velocity_peak} msg/min,--,--\n`;

      topChatters.forEach((c, idx) => {
        csv += `Top Gledalac #${idx + 1},${c.user},${c.count},${c.isSub ? 'SUB' : 'Gledalac'},${c.lastSeen || '--'}\n`;
      });

      topEmotes.forEach(e => {
        csv += `Top Emote,${e.name},${e.count},--,--\n`;
      });

      fileContent = csv;
    }

    const blob = new Blob([fileContent], { type: mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (window.showToast) {
      window.showToast(`Arhivirani lajv uspešno preuzet (${format.toUpperCase()}).`, 'info');
    }
  }

  // Export to window
  window.openPastStreamsModal = openPastStreamsModal;
  window.fetchPastStreams = fetchPastStreams;
  window.filterPastStreamsTable = filterPastStreamsTable;
  window.saveLiveStreamToDatabase = saveLiveStreamToDatabase;
  window.deletePastStream = deletePastStream;
  window.viewPastStreamDetail = viewPastStreamDetail;
  window.exportPastStream = exportPastStream;

  /* ════════════════════════════════════════
     HELPERS & EVENT LISTENERS
  ════════════════════════════════════════ */
  function setupGlobalClickHandlers() {
    document.addEventListener('click', (e) => {
      // Close channel dropdown if clicked outside
      if (!e.target.closest('.topbar-channel-wrap')) {
        document.getElementById('channelDropdownMenu')?.classList.remove('open');
      }
      // Close notifications popover if clicked outside
      if (!e.target.closest('.topbar-notif-wrap')) {
        document.getElementById('notifPopover')?.classList.remove('open');
      }
      // Close user menu if clicked outside
      if (!e.target.closest('.user-pill')) {
        document.getElementById('userMenuSm')?.classList.remove('open');
      }
    });

    const volSlider = document.getElementById('inputVolume');
    if (volSlider) {
      volSlider.addEventListener('input', (e) => {
        soundVolume = parseInt(e.target.value, 10) / 100;
        setText('volumeLabelVal', `${e.target.value}%`);
      });
    }
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (activeModalStack.length > 0) {
          const topModalId = activeModalStack[activeModalStack.length - 1];
          window.closeModal(topModalId);
          return;
        }
        const fullscreenOverlay = document.getElementById('kickanFullscreenOverlay');
        if (fullscreenOverlay && fullscreenOverlay.style.display === 'flex') {
          window.closeFullscreenStudio();
          return;
        }
        document.getElementById('channelDropdownMenu')?.classList.remove('open');
        document.getElementById('notifPopover')?.classList.remove('open');
        window.closeMobileSidebar();
      } else if (e.key === 'Tab' && activeModalStack.length > 0) {
        const topModalId = activeModalStack[activeModalStack.length - 1];
        const modalEl = document.getElementById(topModalId);
        if (modalEl) {
          const focusable = getFocusableElements(modalEl);
          if (focusable.length === 0) return;
          const firstEl = focusable[0];
          const lastEl = focusable[focusable.length - 1];

          if (e.shiftKey && document.activeElement === firstEl) {
            e.preventDefault();
            lastEl.focus();
          } else if (!e.shiftKey && document.activeElement === lastEl) {
            e.preventDefault();
            firstEl.focus();
          }
        }
      }
    });
  }

  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
  }

})();