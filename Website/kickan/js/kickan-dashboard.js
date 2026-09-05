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

  // Rolling message timestamps for exact velocity calculation (last 60s)
  let rollingMessageTimes = [];
  let currentVelocity    = 0;
  let peakVelocity       = 0;

  // Real Analytics State
  const liveStats = {
    totalMessages: 0,
    liveViewers: 0,
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
    initVisualizerCanvas();
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

      // Query user_profiles in Supabase
      try {
        const { data: profile } = await sb.from('user_profiles').select('*').eq('id', currentUser.id).maybeSingle();
        if (profile) {
          _currentUserProfile = profile;
          userPlan = (profile.plan || 'free').toLowerCase();

          if (profile.kick_channels && Array.isArray(profile.kick_channels) && profile.kick_channels.length > 0) {
            userChannels = profile.kick_channels;
            const savedId = localStorage.getItem('kickbot_selected_channel_id');
            const savedName = localStorage.getItem('kickbot_selected_channel_name');
            const selectedCh = userChannels.find(c => String(c.id) === String(savedId) || c.username?.toLowerCase() === savedName?.toLowerCase());
            activeChannelObj = selectedCh || userChannels.find(c => c.is_primary) || userChannels[0];

            if (activeChannelObj.username) primaryUsername = activeChannelObj.username;
            if (activeChannelObj.avatar) avatarUrl = activeChannelObj.avatar;
            if (activeChannelObj.id) channelId = activeChannelObj.id;
            if (activeChannelObj.chatroom_id) chatroomId = parseInt(activeChannelObj.chatroom_id, 10);
          }
          if (!primaryUsername && profile.display_name) primaryUsername = profile.display_name;
        }
      } catch (e) {
        console.warn('Supabase profile lookup:', e.message);
      }

      channelName = cleanUsername(primaryUsername) || 'Milan_567';

      // Update Plan badge
      const planBadge = document.getElementById('planBadge');
      if (planBadge) planBadge.textContent = userPlan.toUpperCase();

      updateUserProfileUI(channelName, avatarUrl);
      renderChannelDropdownList();

      if (channelName) {
        loadSavedSessionStats(channelName);
        await loadRealKickChannelData(channelName);
        connectToRealKickChat();

        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(() => {
          if (channelName && isTrackingActive) {
            loadRealKickChannelData(channelName).catch(() => {});
          }
        }, 20000);
      }
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

  function updateUserProfileUI(username, avatarUrl) {
    const clean = cleanUsername(username);
    const nameEl = document.getElementById('userNameDisplay');
    const avatarEl = document.getElementById('userAvatarDisplay');
    const chPillEl = document.getElementById('connectedChannelName');
    const studioNameEl = document.getElementById('studioChannelName');

    if (nameEl) nameEl.textContent = clean || 'Streamer';
    if (chPillEl) chPillEl.textContent = clean || 'Nepovezan';
    if (studioNameEl) studioNameEl.textContent = clean || 'Nepovezan';

    if (avatarEl) {
      if (avatarUrl && avatarUrl.startsWith('http')) {
        avatarEl.style.backgroundImage = `url('${avatarUrl}')`;
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

    if (!userChannels || userChannels.length === 0) {
      list.innerHTML = `
        <button class="cdm-item active" onclick="window.selectChannel('${channelName}', null, null)">
          <span>${escapeHtml(channelName)}</span>
          <span style="font-size:0.7rem; color:var(--an-cyan);">Aktivan</span>
        </button>
      `;
      return;
    }

    let html = '';
    userChannels.forEach(ch => {
      const u = ch.username || ch.slug || 'Kanal';
      const isActive = u.toLowerCase() === channelName.toLowerCase();
      html += `
        <button class="cdm-item ${isActive ? 'active' : ''}" onclick="window.selectChannel('${escapeHtml(u)}', '${ch.id || ''}', '${ch.chatroom_id || ''}')">
          <div style="display:flex; align-items:center; gap:6px;">
            <div style="width:6px; height:6px; border-radius:50%; background:${isActive ? 'var(--an-green)' : 'rgba(255,255,255,0.2)'};"></div>
            <span>${escapeHtml(u)}</span>
          </div>
          ${isActive ? '<span style="font-size:0.7rem; color:var(--an-cyan);">Aktivan</span>' : ''}
        </button>
      `;
    });
    list.innerHTML = html;
  }

  window.selectChannel = async function (newChannelName, id, cId) {
    if (!newChannelName) return;
    channelName = cleanUsername(newChannelName);
    if (id) channelId = id;
    if (cId) chatroomId = parseInt(cId, 10);
    else chatroomId = null;

    localStorage.setItem('kickbot_selected_channel_name', channelName);
    if (channelId) localStorage.setItem('kickbot_selected_channel_id', String(channelId));

    const menu = document.getElementById('channelDropdownMenu');
    if (menu) menu.classList.remove('open');

    updateUserProfileUI(channelName, null);
    renderChannelDropdownList();

    if (window.showToast) window.showToast(`Povezan kanal: ${channelName}`, 'info');

    loadSavedSessionStats(channelName);
    await loadRealKickChannelData(channelName);
    connectToRealKickChat();
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

        // Stream start time
        if (channelData.livestream.created_at) {
          streamStartTime = new Date(channelData.livestream.created_at).getTime();
        }

        updateStreamStatusUI(true, channelData.livestream.session_title, channelData.livestream.categories?.[0]?.name || 'Gaming');
      } else {
        liveStats.liveViewers = 0;
        streamStartTime = null;
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

      if (avatarEl && channelData.user?.profile_pic) {
        avatarEl.style.backgroundImage = `url('${channelData.user.profile_pic}')`;
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
        } else if (evName.includes('KicksGiftedEvent') || evName.includes('KicksGifted')) {
          liveStats.totalKicks += 10;
          playAlertSound('event');
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

  function updateDashboardUI() {
    // Hero Summary Strip
    setText('statTotalMessages', liveStats.totalMessages.toLocaleString());
    setText('statLiveViewers', liveStats.liveViewers.toLocaleString());
    setText('statUniqueChatters', liveStats.uniqueChattersMap.size.toLocaleString());

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

      let statusTag = `<span style="color:var(--an-muted2); font-size:0.75rem;">Gledalac</span>`;
      if (item.isMod) statusTag = `<span style="color:var(--an-green); font-weight:800; font-size:0.75rem;">MOD</span>`;
      else if (item.isSub) statusTag = `<span style="color:var(--an-pink); font-weight:800; font-size:0.75rem;">SUB</span>`;
      else if (item.isVip) statusTag = `<span style="color:var(--an-violet); font-weight:800; font-size:0.75rem;">VIP</span>`;

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
        ? `<span style="color:var(--an-amber); font-size:0.72rem; font-weight:700;">Delete</span>`
        : `<span style="color:var(--an-red); font-size:0.72rem; font-weight:700;">Ban</span>`;

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
    if (btn) btn.style.transform = 'rotate(360deg)';
    await Promise.all([loadRealKickChannelData(channelName), loadNotifications(), loadChangelogs()]);
    setTimeout(() => { if (btn) btn.style.transform = 'none'; }, 400);
    if (window.showToast) window.showToast('Telemetrija i podaci osveženi.', 'info');
  };

  /* ════════════════════════════════════════
     FULLSCREEN STUDIO HUD
  ════════════════════════════════════════ */
  window.openFullscreenStudio = function () {
    const overlay = document.getElementById('kickanFullscreenOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      overlay.setAttribute('aria-hidden', 'false');
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
    window.selectChannel(val, null, null);
  };

  window.openExportModal = function () {
    window.openModal('exportReportModal');
  };

  window.openResetModal = function () {
    window.openModal('resetStatsConfirmModal');
  };

  window.confirmResetStats = function () {
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
     LOCAL STORAGE PERSISTENCE
  ════════════════════════════════════════ */
  function loadSavedSessionStats(slug) {
    if (!slug) return;
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