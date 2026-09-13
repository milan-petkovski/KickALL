/**
 * KICKAN — Stream Analytics Studio
 * Kompletna logika: Auth, Plan, Menadžer kanala (Vlasnički + Managed + Custom),
 * Real-time Pusher WebSocket, Kick API Telemetrija, Brzinomer chata,
 * 24h Histogram, Emoti, Leaderboard, Moderacija, Zvuk, Fullscreen Studio i Izvoz.
 */
(function () {
  'use strict';

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
    await checkAuth();
  });

  function cleanUsername(raw) {
    if (!raw) return '';
    let s = String(raw).trim();
    if (s.startsWith('kick_user_')) {
      s = s.replace(/^kick_user_/, '');
    }
    if (s.includes('@')) {
      s = s.split('@')[0];
    }
    return s || '';
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

      // 3. Dodaj sačuvane custom kanale iz LocalStorage
      try {
        const savedCustomRaw = localStorage.getItem('kickan_custom_channels_list');
        if (savedCustomRaw) {
          const customList = JSON.parse(savedCustomRaw);
          if (Array.isArray(customList)) {
            customList.forEach(c => {
              const uName = cleanUsername(typeof c === 'string' ? c : c.username);
              if (uName && !userChannels.some(ex => ex.username.toLowerCase() === uName.toLowerCase())) {
                userChannels.push({
                  id: typeof c === 'object' ? c.id : null,
                  username: uName,
                  avatar: typeof c === 'object' ? c.avatar || '' : '',
                  chatroom_id: typeof c === 'object' ? c.chatroom_id : null,
                  is_primary: false,
                  is_managed: false,
                  role: 'custom',
                  owner_id: currentUser.id,
                  owner_plan: userPlan
                });
              }
            });
          }
        }
      } catch (_) {}

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
        await loadSavedSessionStats(channelName);
        await loadRealKickChannelData(channelName);
        connectToRealKickChat();

        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(() => {
          if (channelName && isTrackingActive) {
            loadRealKickChannelData(channelName).catch(() => {});
          }
        }, 20000);

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

  function updateUserProfileUI(username, avatarUrl, role) {
    const clean = cleanUsername(username);
    const nameEl = document.getElementById('userNameDisplay');
    const avatarEl = document.getElementById('userAvatarDisplay');
    const chPillEl = document.getElementById('connectedChannelName');
    const studioNameEl = document.getElementById('studioChannelName');
    const roleBadge = document.getElementById('connectedRoleBadge');
    const studioRoleBadge = document.getElementById('studioRoleBadge');

    if (nameEl) nameEl.textContent = clean || 'Streamer';
    if (chPillEl) chPillEl.textContent = clean || 'Nepovezan';
    if (studioNameEl) studioNameEl.textContent = clean || 'Nepovezan';

    const currentRole = role || activeChannelObj?.role || 'owner';
    let roleLabel = 'Vlasnik';
    let roleClass = 'cdm-role-owner';
    if (currentRole === 'managed' || activeChannelObj?.is_managed) {
      roleLabel = 'Glavni Moderator';
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

    if (avatarEl) {
      if (avatarUrl && /^https?:\/\//i.test(avatarUrl)) {
        const safeUrl = encodeURI(avatarUrl).replace(/["'()<>]/g, '');
        avatarEl.style.backgroundImage = `url("${safeUrl}")`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.textContent = '';
      } else {
        avatarEl.style.backgroundImage = 'none';
        avatarEl.style.backgroundColor = 'var(--an-cyan)';
        avatarEl.style.color = '#000';
        avatarEl.textContent = clean ? clean.charAt(0).toUpperCase() : 'K';
      }
    }
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
        roleLabel = 'Glavni Moderator';
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
        role: role || 'custom',
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
      try {
        const customOnly = userChannels.filter(c => c.role === 'custom');
        localStorage.setItem('kickan_custom_channels_list', JSON.stringify(customOnly));
      } catch (_) {}
    }

    if ((liveStats.totalMessages > 0 || liveStats.peakViewers > 0) && channelName && channelName.toLowerCase() !== targetName.toLowerCase()) {
      saveLiveStreamToDatabase(false).catch(() => {});
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

    const roleMsg = targetObj.role === 'managed' ? ' (Glavni Moderator)' : '';
    if (window.showToast) window.showToast(`Povezan kanal: ${channelName}${roleMsg}`, 'info');

    await loadSavedSessionStats(channelName);
    await loadRealKickChannelData(channelName);
    connectToRealKickChat();
    fetchPastStreams().catch(() => {});
  };

  /* ════════════════════════════════════════
     KICK API & TELEMETRY
  ════════════════════════════════════════ */
  async function loadRealKickChannelData(slug) {
    if (!slug) return;
    let channelData = null;

    try {
      const res = await fetch(`https://kick.com/api/v2/channels/${slug}`);
      if (res.ok) channelData = await res.json();
    } catch (_) {}

    if (!channelData) {
      try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://kick.com/api/v2/channels/${slug}`)}`;
        const res = await fetch(proxyUrl);
        if (res.ok) {
          const json = await res.json();
          if (json.contents) channelData = JSON.parse(json.contents);
        }
      } catch (_) {}
    }

    if (channelData) {
      if (channelData.chatroom?.id) {
        chatroomId = parseInt(channelData.chatroom.id, 10);
      }
      if (channelData.id) {
        channelId = channelData.id;
      }

      if (channelData.livestream && channelData.livestream.is_live) {
        liveStats.liveViewers = channelData.livestream.viewer_count || 0;
        if (liveStats.liveViewers > liveStats.peakViewers) {
          liveStats.peakViewers = liveStats.liveViewers;
        }

        if (!liveStats.viewerSamples) liveStats.viewerSamples = [];
        if (liveStats.liveViewers > 0) {
          liveStats.viewerSamples.push(liveStats.liveViewers);
          if (liveStats.viewerSamples.length > 60) liveStats.viewerSamples.shift();
          const sum = liveStats.viewerSamples.reduce((a, b) => a + b, 0);
          liveStats.avgViewers = Math.round(sum / liveStats.viewerSamples.length);
        } else {
          liveStats.avgViewers = liveStats.liveViewers;
        }

        // Stream start time
        if (channelData.livestream.created_at) {
          streamStartTime = new Date(channelData.livestream.created_at).getTime();
        }

        currentStreamTitle = channelData.livestream.session_title || '';

        // Kalibracija demografije iz naslova, kategorije ili zemlje
        const titleLower = (currentStreamTitle || '').toLowerCase();
        if (/[čćšđž]|(\b(dobro|jutro|vece|dan|igra|balkan|srb|cro|bih|brate|idemo)\b)/i.test(titleLower) || channelData.country === 'RS' || channelData.country === 'BA' || channelData.country === 'HR') {
          balkanChatScore += 4;
          detectedGeoRegion = 'Balkan / Ex-YU (Tier 2)';
          geoMultiplierValue = 0.95;
        }

        updateStreamStatusUI(true, channelData.livestream.session_title, channelData.livestream.categories?.[0]?.name || 'Gaming');
      } else {
        liveStats.liveViewers = 0;
        liveStats.avgViewers = 0;
        liveStats.viewerSamples = [];
        streamStartTime = null;
        currentStreamTitle = '';
        detectedGeoRegion = 'Offline (Čeka se lajv)';
        geoMultiplierValue = 1.00;
        updateStreamStatusUI(false, 'Nema aktivnog strima', 'Offline');
      }

      if (channelData.followers_count !== undefined) {
        liveStats.followersCount = channelData.followers_count;
      }

      // Update Channel Overview Card
      const nameEl = document.getElementById('telemetryChannelName');
      const slugEl = document.getElementById('telemetryKickSlug');
      const linkEl = document.getElementById('telemetryKickLink');
      const avatarEl = document.getElementById('telemetryAvatar');

      if (nameEl) nameEl.textContent = channelData.user?.username || slug;
      if (slugEl) slugEl.textContent = slug;
      if (linkEl) linkEl.href = `https://kick.com/${slug}`;

      if (avatarEl && channelData.user?.profile_pic && /^https?:\/\//i.test(channelData.user.profile_pic)) {
        const safePic = encodeURI(channelData.user.profile_pic).replace(/["'()<>]/g, '');
        avatarEl.style.backgroundImage = `url("${safePic}")`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.textContent = '';
      }
    }

    updateDashboardUI();
  }

  function updateStreamStatusUI(isLive, title, category) {
    const liveBadge = document.getElementById('streamLiveBadge');
    const statusText = document.getElementById('streamStatusText');
    const uptimeText = document.getElementById('streamUptimeText');
    const titleDisplay = document.getElementById('streamTitleDisplay');
    const catDisplay = document.getElementById('streamCategoryDisplay');
    const studioStatus = document.getElementById('studioStreamStatus');

    if (titleDisplay) titleDisplay.textContent = title || 'Nema naslova';
    if (catDisplay) catDisplay.textContent = `Kategorija: ${category || 'Razno'}`;

    if (isLive) {
      if (liveBadge) liveBadge.classList.add('live');
      if (statusText) statusText.textContent = 'LIVE';
      if (uptimeText) uptimeText.style.display = 'inline-block';
      if (studioStatus) studioStatus.textContent = 'LIVE';

      if (!uptimeInterval) {
        uptimeInterval = setInterval(updateUptimeClock, 1000);
      }
    } else {
      if (liveBadge) liveBadge.classList.remove('live');
      if (statusText) statusText.textContent = 'Offline';
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

    try {
      kickWebSocket = new WebSocket(pusherUrl);
    } catch (err) {
      console.warn('WebSocket init greška:', err);
      return;
    }

    kickWebSocket.onopen = () => {
      console.log(`Kickan Realtime Connected: chatroom ${chatroomId}`);

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
      }, 25000);
    };

    kickWebSocket.onclose = () => {
      if (pingInterval) clearInterval(pingInterval);
      setTimeout(() => {
        if (channelName && isTrackingActive) connectToRealKickChat();
      }, 5000);
    };

    kickWebSocket.onmessage = (event) => {
      if (!isTrackingActive) return;

      try {
        const msgData = JSON.parse(event.data);
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
      } catch (err) {}
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
    if (liveStats.recentChatMessages.length > 40) liveStats.recentChatMessages.pop();

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
    if (liveStats.banLogs.length > 30) liveStats.banLogs.pop();

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
    if (liveStats.recentChatMessages.length > 40) liveStats.recentChatMessages.pop();
  }

  /* ════════════════════════════════════════
     CHAT VELOCITY CALCULATOR
  ════════════════════════════════════════ */
  function startVelocityTimer() {
    if (velocityInterval) clearInterval(velocityInterval);
    velocityInterval = setInterval(() => {
      const now = Date.now();
      const cutoff = now - 60000;
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
      }, 400);
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

    // Legacy hidden spans
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

    if (channelName) saveSessionStats(channelName);
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

    liveStats.hourlyCounts.forEach((val, hour) => {
      if (val > maxHourCount) {
        maxHourCount = val;
        peakHour = hour;
      }
      const pct = Math.round((val / maxVal) * 100);
      const isPeak = val > 0 && val === Math.max(...liveStats.hourlyCounts);
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
        peakLabel.textContent = `Peak period: ${pad(peakHour)}:00 - ${pad(nextHour)}:00 (${maxHourCount} msgs)`;
      } else {
        peakLabel.textContent = 'Čeka se aktivnost chata...';
      }
    }
  }

  /* ── Popular Emotes List ── */
  function renderPopularEmotes() {
    const container = document.getElementById('popularEmotesContainer');
    const studioContainer = document.getElementById('studioPopularEmotesContainer');
    const totalLabel = document.getElementById('emotesTotalLabel');

    if (totalLabel) totalLabel.textContent = `Ukupno: ${liveStats.totalEmotes.toLocaleString()} emotea`;

    if (liveStats.emotesMap.size === 0) {
      const emptyHtml = `<div class="empty-list-notice">Emoti će se pojaviti ovde kada ih gledaoci iskoriste u chatu.</div>`;
      if (container) container.innerHTML = emptyHtml;
      if (studioContainer) studioContainer.innerHTML = emptyHtml;
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

    if (liveStats.viewersActivityMap.size === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="table-empty-state">Učitavamo prve chat poruke sa kanala uživo...</td></tr>`;
      return;
    }

    const searchQuery = (document.getElementById('inputSearchChatters')?.value || '').toLowerCase().trim();
    let sorted = Array.from(liveStats.viewersActivityMap.entries())
      .map(([user, data]) => ({ user, ...data }))
      .sort((a, b) => b.count - a.count);

    if (searchQuery) {
      sorted = sorted.filter(item => item.user.toLowerCase().includes(searchQuery));
    }

    const minThreshold = parseInt(document.getElementById('inputMinMsgThreshold')?.value || '1', 10);
    sorted = sorted.filter(item => item.count >= minThreshold);

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

    tbody.innerHTML = html || `<tr><td colspan="5" class="table-empty-state">Nema rezultata za pretragu.</td></tr>`;
  }

  window.filterChattersTable = function () {
    renderChattersLeaderboard();
  };

  /* ── Ban & Moderation History ── */
  function renderBanHistoryTable() {
    const tbody = document.getElementById('tableBanHistory');
    if (!tbody) return;

    if (liveStats.banLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="table-empty-state">Nema nedavnih zabranjenih poruka ili banova.</td></tr>`;
      return;
    }

    const searchQuery = (document.getElementById('inputSearchBans')?.value || '').toLowerCase().trim();
    let logs = liveStats.banLogs;

    if (searchQuery) {
      logs = logs.filter(b => b.user.toLowerCase().includes(searchQuery) || b.mod.toLowerCase().includes(searchQuery) || b.reason.toLowerCase().includes(searchQuery));
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

    tbody.innerHTML = html || `<tr><td colspan="4" class="table-empty-state">Nema rezultata za pretragu.</td></tr>`;
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

  window.toggleMute = function () {
    isMuted = !isMuted;
    const icon = document.getElementById('muteIcon');
    if (icon) {
      icon.style.opacity = isMuted ? '0.4' : '1';
    }
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
    const btn = document.getElementById('btnRefreshDb');
    const originalHtml = btn ? btn.innerHTML : '';

    if (btn) {
      btn.classList.remove('is-success');
      btn.classList.add('is-refreshing');
      btn.disabled = true;
      btn.innerHTML = `
        <svg class="refresh-spin-svg" fill="none" height="16" stroke="var(--an-cyan)" stroke-width="2.5" viewBox="0 0 24 24" width="16">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
      `;
    }

    try {
      await Promise.all([loadRealKickChannelData(channelName), loadNotifications(), loadChangelogs()]);
    } catch (e) {
      console.warn('[Kickan] Greška pri osvežavanju:', e);
    }

    if (btn) {
      btn.classList.remove('is-refreshing');
      btn.classList.add('is-success');
      btn.innerHTML = `
        <svg class="check-bounce-svg" fill="none" height="18" stroke="#53fc18" stroke-width="3" viewBox="0 0 24 24" width="18">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;
    }

    if (window.showToast) {
      window.showToast('Telemetrija i podaci uspešno osveženi.', 'success');
    }

    setTimeout(() => {
      if (btn) {
        btn.classList.remove('is-success');
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    }, 1400);
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
     MODALS & EXPORT
  ════════════════════════════════════════ */
  window.openModal = function (id) {
    const m = document.getElementById(id);
    if (m) m.classList.add('open');
  };

  window.closeModal = function (id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('open');
  };

  window.handleModalBg = function (e, id) {
    if (e.target.id === id) window.closeModal(id);
  };

  window.openCustomChannelModal = function (e) {
    if (e) e.stopPropagation();
    document.getElementById('channelDropdownMenu')?.classList.remove('open');
    window.openModal('customChannelModal');
  };

  window.saveCustomChannel = function () {
    const input = document.getElementById('customChannelInput');
    const val = cleanUsername(input?.value);
    if (!val) {
      if (window.showToast) window.showToast('Unesite ispravno Kick korisničko ime.', 'error');
      return;
    }
    window.closeModal('customChannelModal');
    if (input) input.value = '';
    window.selectChannel(val, null, null, 'custom', userPlan);
  };

  window.openExportModal = function () {
    window.openModal('exportReportModal');
  };

  window.openResetModal = function () {
    window.openModal('resetStatsConfirmModal');
  };

  window.confirmResetStats = function () {
    if ((liveStats.totalMessages > 0 || liveStats.peakViewers > 0) && channelName) {
      saveLiveStreamToDatabase(false).catch(() => {});
    }
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
          if (dbSession.stream_title) {
            currentStreamTitle = dbSession.stream_title;
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
          renderTopLists();
          renderBanLogs();
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

  function saveSessionStats(slug) {
    if (!slug) return;
    try {
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
      let query = sb.from('kickan').select('*').eq('user_id', currentUser.id);
      if (channelName) {
        query = query.eq('channel_name', channelName);
      }
      const { data, error } = await query.order('started_at', { ascending: false }).limit(50);
      if (!error && Array.isArray(data)) {
        pastStreamsList = data;
        updatePastStreamsBadges();
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
    const filterChannelEl = document.getElementById('pastStreamsFilterChannelName');

    if (sidebarCountEl) sidebarCountEl.textContent = count;
    if (modalCountEl) modalCountEl.textContent = `${count} ${count === 1 ? 'lajv' : 'lajvova'}`;
    if (filterChannelEl) filterChannelEl.textContent = channelName || 'Svi';

    if (topbarBadgeEl) {
      topbarBadgeEl.textContent = count;
      topbarBadgeEl.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  }

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
            ${searchTerm ? 'Nema pronađenih lajvova za zadati pojam pretrage.' : 'Nema sačuvanih lajvova u arhivi. Pokrenite praćenje i kliknite na "Sačuvaj trenutni lajv".'}
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

      const payload = {
        user_id: currentUser.id,
        channel_name: channelName || 'Kick Kanal',
        channel_id: channelId ? String(channelId) : null,
        chatroom_id: chatroomId ? parseInt(chatroomId, 10) : null,
        stream_title: currentStreamTitle || 'Kick Live Stream',
        started_at: streamStartTime ? new Date(streamStartTime).toISOString() : now.toISOString(),
        ended_at: now.toISOString(),
        duration_seconds: durationSec,
        peak_viewers: liveStats.peakViewers || 0,
        avg_viewers: liveStats.peakViewers > 0 ? Math.round(liveStats.peakViewers * 0.75) : 0,
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
      } else {
        const { data, error } = await sb.from('kickan').insert([payload]).select('id').maybeSingle();
        if (error) throw error;
        if (data?.id) currentSessionDbId = data.id;
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

  async function deletePastStream(streamId) {
    if (!streamId || !sb) return;
    const confirmDelete = window.confirm('Da li ste sigurni da želite da obrišete ovaj lajv iz arhive?');
    if (!confirmDelete) return;

    try {
      const { error } = await sb.from('kickan').delete().eq('id', streamId);
      if (error) throw error;

      pastStreamsList = pastStreamsList.filter(s => s.id !== streamId);
      if (currentSessionDbId === streamId) currentSessionDbId = null;

      updatePastStreamsBadges();
      renderPastStreamsTable();

      if (window.showToast) {
        window.showToast('Zapis lajva uspešno obrisan iz arhive.', 'info');
      }
    } catch (err) {
      console.error('deletePastStream error:', err);
      if (window.showToast) {
        window.showToast('Greška pri brisanju zapisa: ' + err.message, 'error');
      }
    }
  }

  function viewPastStreamDetail(streamId) {
    const stream = pastStreamsList.find(s => s.id === streamId);
    if (!stream) return;

    const container = document.getElementById('pastStreamDetailContent');
    const titleEl = document.getElementById('pastStreamDetailTitle');
    if (!container) return;

    const dateStr = formatDateTime(stream.started_at);
    const durationStr = formatDuration(stream.duration_seconds);
    const summary = stream.summary || {};
    const topChatters = summary.topChatters || [];
    const topEmotes = summary.topEmotes || [];
    const banLogs = summary.banLogs || [];

    if (titleEl) {
      titleEl.textContent = `Lajv: ${stream.channel_name} (${dateStr})`;
    }

    let chattersHtml = '';
    if (topChatters.length > 0) {
      topChatters.slice(0, 10).forEach((c, i) => {
        chattersHtml += `
          <div class="ps-mini-item">
            <span><strong>#${i + 1}</strong> @${escapeHtml(c.user)} ${c.isSub ? '<span style="color:var(--an-cyan); font-size:0.7rem; font-weight:700;">SUB</span>' : ''}</span>
            <span style="font-family:'JetBrains Mono',monospace; font-weight:700;">${(c.count || 0).toLocaleString()} msg</span>
          </div>
        `;
      });
    } else {
      chattersHtml = '<div style="color:var(--an-muted); font-size:0.8rem; padding:8px 0;">Nema podataka o gledaocima.</div>';
    }

    let emotesHtml = '';
    if (topEmotes.length > 0) {
      topEmotes.slice(0, 10).forEach((e, i) => {
        emotesHtml += `
          <div class="ps-mini-item">
            <span><strong>#${i + 1}</strong> ${escapeHtml(e.name)}</span>
            <span style="font-family:'JetBrains Mono',monospace; font-weight:700; color:var(--an-green);">${(e.count || 0).toLocaleString()}x</span>
          </div>
        `;
      });
    } else {
      emotesHtml = '<div style="color:var(--an-muted); font-size:0.8rem; padding:8px 0;">Nema zabeleženih emotea.</div>';
    }

    container.innerHTML = `
      <!-- Metric Cards Grid -->
      <div class="ps-detail-grid">
        <div class="ps-detail-card">
          <div class="ps-detail-card-label">Trajanje</div>
          <div class="ps-detail-card-val" style="font-size:1rem; color:var(--an-cyan);">${escapeHtml(durationStr)}</div>
        </div>
        <div class="ps-detail-card">
          <div class="ps-detail-card-label">Peak Gledaoci</div>
          <div class="ps-detail-card-val" style="color:var(--an-green);">${(stream.peak_viewers || 0).toLocaleString()}</div>
        </div>
        <div class="ps-detail-card">
          <div class="ps-detail-card-label">Ukupno Poruka</div>
          <div class="ps-detail-card-val">${(stream.total_messages || 0).toLocaleString()}</div>
        </div>
        <div class="ps-detail-card">
          <div class="ps-detail-card-label">Jedinstveni</div>
          <div class="ps-detail-card-val" style="color:#cbd5e1;">${(stream.unique_chatters || 0).toLocaleString()}</div>
        </div>
        <div class="ps-detail-card">
          <div class="ps-detail-card-label">Peak Brzina</div>
          <div class="ps-detail-card-val" style="color:var(--an-amber);">${stream.chat_velocity_peak || 0}/m</div>
        </div>
        <div class="ps-detail-card">
          <div class="ps-detail-card-label">Emoti</div>
          <div class="ps-detail-card-val" style="color:#c084fc;">${(stream.total_emotes || 0).toLocaleString()}</div>
        </div>
        <div class="ps-detail-card">
          <div class="ps-detail-card-label">Moderacija</div>
          <div class="ps-detail-card-val" style="color:var(--an-red);">${stream.moderation_actions || 0}</div>
        </div>
      </div>

      <!-- Detail Subsections -->
      <div class="ps-detail-sections">
        <div class="ps-section-box">
          <div class="ps-section-head">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--an-cyan)" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>Top Gledaoci</span>
          </div>
          <div class="ps-mini-list">
            ${chattersHtml}
          </div>
        </div>

        <div class="ps-section-box">
          <div class="ps-section-head">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--an-green)" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
            <span>Top Emoti</span>
          </div>
          <div class="ps-mini-list">
            ${emotesHtml}
          </div>
        </div>
      </div>

      ${banLogs.length > 0 ? `
        <div class="ps-section-box" style="margin-top:14px;">
          <div class="ps-section-head">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--an-red)" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span>Akcije Moderacije (${banLogs.length})</span>
          </div>
          <div class="ps-mini-list">
            ${banLogs.slice(0, 5).map(b => `
              <div class="ps-mini-item">
                <span><strong>@${escapeHtml(b.user)}</strong> — ${escapeHtml(b.reason || 'Bez razloga')}</span>
                <span style="color:var(--an-red); font-size:0.75rem;">${escapeHtml(b.type || 'BAN')}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Actions footer -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:18px; padding-top:14px; border-top:1px solid var(--an-border);">
        <div style="font-size:0.8rem; color:var(--an-muted);">
          Sačuvano: ${escapeHtml(formatDateTime(stream.updated_at || stream.started_at))}
        </div>
        <div style="display:flex; gap:8px;">
          <button type="button" class="ps-btn ps-btn-export" onclick="window.exportPastStream('${escapeHtml(stream.id)}', 'csv')">
            Preuzmi CSV
          </button>
          <button type="button" class="ps-btn ps-btn-export" onclick="window.exportPastStream('${escapeHtml(stream.id)}', 'json')">
            Preuzmi JSON
          </button>
          <button type="button" class="sc-btn sc-btn-reset" style="padding:6px 14px;" onclick="window.closeModal('pastStreamDetailModal')">
            Zatvori
          </button>
        </div>
      </div>
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
        window.closeFullscreenStudio();
        document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
      }
    });
  }

  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
  }

})();