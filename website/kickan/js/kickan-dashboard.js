(function () {
  'use strict';

  // Supabase Configuration
  const supabaseUrl = window.CONFIG?.SUPABASE?.URL;
  const supabaseAnonKey = window.CONFIG?.SUPABASE?.ANON_KEY;
  const storageKey = window.CONFIG?.SUPABASE?.STORAGE_KEY || 'kickbot-supabase-auth';

  // Core State Variables
  let sb = null;
  let currentUser = null;
  let channelName = '';
  let chatroomId = null;
  let kickWebSocket = null;
  let pingInterval = null;
  let pollInterval = null;
  let gateDismissed = false;

  // Real Analytics State Data Container
  const liveStats = {
    totalMessages: 0,
    avgViewers: 0,
    activeSubs: 0,
    uniqueChattersMap: new Set(),
    totalKicks: 0,
    totalBans: 0,
    totalHosts: 0,
    totalEmotes: 0,
    emotesMap: new Map(), // emote_name -> count
    viewersActivityMap: new Map(), // username -> { count, isSub }
    banLogs: [], // Array of { user, mod, reason, time }
    hourlyCounts: new Array(24).fill(0) // Index matches hours 0-23
  };

  if (window.supabase && supabaseUrl && supabaseAnonKey) {
    sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: storageKey }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    setupUserMenu();
    await checkAuthSession();
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

  function updateHeaderProfileUI(username, avatarUrl) {
    const nameEl = document.getElementById('userNameDisplay');
    const avatarEl = document.getElementById('userAvatarDisplay');
    const cleanName = cleanUsername(username);

    if (nameEl) {
      nameEl.textContent = cleanName || 'Prijavljeni Streamer';
    }
    if (avatarEl) {
      if (avatarUrl && avatarUrl.startsWith('http')) {
        avatarEl.style.backgroundImage = `url('${avatarUrl}')`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.style.border = '2px solid var(--kickan-accent-cyan)';
        avatarEl.textContent = '';
      } else if (cleanName) {
        avatarEl.style.backgroundImage = 'none';
        avatarEl.style.backgroundColor = 'var(--kickan-accent-cyan)';
        avatarEl.style.color = '#000';
        avatarEl.textContent = cleanName.charAt(0).toUpperCase();
      }
    }
  }

  async function checkAuthSession() {
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
      let username = currentUser.user_metadata?.kick_username
        || currentUser.user_metadata?.preferred_username
        || currentUser.user_metadata?.name
        || currentUser.user_metadata?.full_name
        || (currentUser.email ? currentUser.email : '');
      let avatarUrl = currentUser.user_metadata?.avatar_url
        || currentUser.user_metadata?.picture
        || currentUser.user_metadata?.profile_picture;

      // Query user_profiles in Supabase for exact fresh profile data
      try {
        const { data: profile } = await sb.from('user_profiles').select('*').eq('id', currentUser.id).maybeSingle();
        if (profile) {
          if (profile.kick_channels && Array.isArray(profile.kick_channels) && profile.kick_channels.length > 0) {
            const primary = profile.kick_channels.find(c => c.is_primary) || profile.kick_channels[0];
            if (primary.username) username = primary.username;
            if (primary.avatar) avatarUrl = primary.avatar;
            if (primary.chatroom_id) chatroomId = parseInt(primary.chatroom_id, 10);
          }
          if (!username && profile.display_name) username = profile.display_name;
        }
      } catch (e) {
        console.warn('Supabase profile lookup info:', e.message);
      }

      channelName = cleanUsername(username);

      // Update UI
      const channelNameEl = document.getElementById('connectedChannelName');
      if (channelNameEl) channelNameEl.textContent = channelName || 'DemoKanal';

      const slugEl = document.getElementById('kickChannelSlug');
      if (slugEl) slugEl.textContent = channelName || 'Nepovezan Kanal';

      const btnVisit = document.getElementById('btnVisitKickChannel');
      if (btnVisit && channelName) btnVisit.href = `https://kick.com/${channelName}`;

      updateHeaderProfileUI(channelName, avatarUrl);

      if (channelName) {
        loadSavedSessionStats(channelName);
        await loadRealKickChannelData(channelName);

        // Connect to real Kick chat WebSocket automatically
        connectToRealKickChat();

        // Poll Kick API every 30 seconds for live viewer count updates
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(() => {
          loadRealKickChannelData(channelName).catch(() => { });
        }, 30000);
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
    if (gate) {
      gate.classList.add('fade-out');
      setTimeout(() => {
        gate.style.display = 'none';
        gate.style.visibility = 'hidden';
        gate.style.opacity = '0';
        gate.style.pointerEvents = 'none';
      }, 400);
    }
    document.body.classList.remove('auth-loading');
    document.body.style.overflow = '';
  }

  function setupUserMenu() {
    const trigger = document.getElementById('userMenuTrigger');
    const menu = document.getElementById('userMenu');
    const btnLogout = document.getElementById('btnLogout');

    if (menu) menu.classList.add('visible');

    if (trigger && menu) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
      });
      document.addEventListener('click', () => menu.classList.remove('open'));
    }

    if (btnLogout && sb) {
      btnLogout.addEventListener('click', async () => {
        await sb.auth.signOut();
        window.location.href = '../index.html';
      });
    }
  }

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

          if (saved.uniqueChatters && Array.isArray(saved.uniqueChatters)) {
            liveStats.uniqueChattersMap = new Set(saved.uniqueChatters);
          }
          if (saved.emotes && Array.isArray(saved.emotes)) {
            liveStats.emotesMap = new Map(saved.emotes);
          }
          if (saved.viewers && Array.isArray(saved.viewers)) {
            liveStats.viewersActivityMap = new Map(saved.viewers);
          }
          if (saved.banLogs && Array.isArray(saved.banLogs)) {
            liveStats.banLogs = saved.banLogs;
          }
          if (saved.hourlyCounts && Array.isArray(saved.hourlyCounts)) {
            liveStats.hourlyCounts = saved.hourlyCounts;
          }
        }
      }
    } catch (_) {
      console.warn("Failed to load session state.");
    }
  }

  function saveSessionStats(slug) {
    if (!slug) return;
    try {
      const payload = {
        totalMessages: liveStats.totalMessages,
        totalEmotes: liveStats.totalEmotes,
        totalBans: liveStats.totalBans,
        totalHosts: liveStats.totalHosts,
        uniqueChatters: Array.from(liveStats.uniqueChattersMap),
        emotes: Array.from(liveStats.emotesMap.entries()),
        viewers: Array.from(liveStats.viewersActivityMap.entries()),
        banLogs: liveStats.banLogs,
        hourlyCounts: liveStats.hourlyCounts
      };
      localStorage.setItem(`kickan_session_${slug}`, JSON.stringify(payload));
    } catch (_) {
      console.warn("Failed to save session state.");
    }
  }

  async function loadRealKickChannelData(slug) {
    if (!slug) return;
    let channelData = null;

    try {
      const res = await fetch(`https://kick.com/api/v2/channels/${slug}`);
      if (res.ok) {
        channelData = await res.json();
      }
    } catch (_) { }

    if (!channelData) {
      try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://kick.com/api/v2/channels/${slug}`)}`;
        const res = await fetch(proxyUrl);
        if (res.ok) {
          const json = await res.json();
          if (json.contents) channelData = JSON.parse(json.contents);
        }
      } catch (_) { }
    }

    if (channelData) {
      if (channelData.chatroom && channelData.chatroom.id) {
        chatroomId = parseInt(channelData.chatroom.id, 10);
      }

      if (channelData.livestream && channelData.livestream.is_live) {
        liveStats.avgViewers = channelData.livestream.viewer_count || 0;
      } else {
        liveStats.avgViewers = 0;
      }

      if (channelData.followers_count !== undefined) {
        liveStats.activeSubs = channelData.followers_count;
      }

      const channelIdEl = document.getElementById('kickanChannelIdDisplay');
      if (channelIdEl && channelData.id) {
        channelIdEl.textContent = `#${channelData.id}`;
      }
    }

    // Query Supabase Watchtime for real logged stats
    if (sb && currentUser) {
      try {
        const { data: watchLogs } = await sb
          .from('watchtime')
          .select('*')
          .limit(500);
        if (watchLogs && watchLogs.length > 0) {
          watchLogs.forEach(w => {
            if (w.username || w.user_id) liveStats.uniqueChattersMap.add(w.username || w.user_id);
          });
        }
      } catch (_) { }
    }

    updateDashboardStatsUI();
  }

  async function connectToRealKickChat() {
    if (kickWebSocket) {
      try { kickWebSocket.close(); } catch (e) { }
      kickWebSocket = null;
    }

    if (!channelName) return false;

    if (!chatroomId) {
      await loadRealKickChannelData(channelName);
    }

    if (!chatroomId) {
      console.warn(`Nije pronađen Chatroom ID za "${channelName}".`);
      return false;
    }

    const pusherUrl = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.5.0&flash=false';

    try {
      kickWebSocket = new WebSocket(pusherUrl);
    } catch (err) {
      console.warn('WebSocket connection error:', err);
      return false;
    }

    kickWebSocket.onopen = () => {
      console.log(`Kickan Realtime WebSocket Connected to chatroom: ${chatroomId}`);

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
      // Auto-reconnect after 5 seconds if connection is lost
      setTimeout(() => {
        if (channelName) connectToRealKickChat();
      }, 5000);
    };

    kickWebSocket.onmessage = (event) => {
      try {
        const msgData = JSON.parse(event.data);
        const evName = msgData.event || '';

        if (evName.includes('ChatMessageEvent') || evName.includes('ChatMessageSentEvent')) {
          const payload = typeof msgData.data === 'string' ? JSON.parse(msgData.data) : msgData.data;
          processChatMessageEvent(payload);
        } else if (evName.includes('UserBannedEvent') || evName.includes('MessageDeletedEvent')) {
          const payload = typeof msgData.data === 'string' ? JSON.parse(msgData.data) : msgData.data;
          processBanEvent(payload);
        } else if (evName.includes('StreamHostEvent') || evName.includes('SubscriptionEvent') || evName.includes('GiftedSubscriptionsEvent')) {
          liveStats.totalHosts++;
          throttledUpdateUI();
        }
      } catch (err) { }
    };

    return true;
  }

  function processChatMessageEvent(payload) {
    if (!payload || (!payload.sender && !payload.username)) return;

    liveStats.totalMessages++;

    const senderName = payload.sender?.username || payload.sender?.slug || payload.username || 'Gledalac';
    const content = payload.content || payload.message || '';

    let isSub = false;
    const badges = payload.sender?.identity?.badges || payload.sender?.badges || payload.badges || [];
    if (Array.isArray(badges)) {
      isSub = badges.some(b => {
        const t = (typeof b === 'string' ? b : b.type || '').toLowerCase();
        return t.includes('sub') || t.includes('founder');
      });
    }

    liveStats.uniqueChattersMap.add(senderName);

    // Track active viewers map
    const existing = liveStats.viewersActivityMap.get(senderName) || { count: 0, isSub: isSub };
    existing.count++;
    existing.isSub = existing.isSub || isSub;
    liveStats.viewersActivityMap.set(senderName, existing);

    // Parse Kick [emote:123:name] format or text emotes
    const emoteRegex = /\[emote:\d+:(\w+)\]/g;
    let emoteMatches = [];
    let match;
    while ((match = emoteRegex.exec(content)) !== null) {
      emoteMatches.push(match[1]);
    }

    // Fallback: If no kick emotes found, search for colon emotes or common text emotes
    if (emoteMatches.length === 0) {
      const colonMatches = content.match(/:[a-zA-Z0-9_]+:/g);
      if (colonMatches) {
        colonMatches.forEach(m => emoteMatches.push(m.replace(/:/g, '')));
      } else {
        const words = content.split(' ');
        const commonEmotes = ['KEKW', 'LUL', 'PogChamp', 'Kappa', 'Sadge', 'MonkaS', 'Pepega', 'W'];
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

    // Track hourly histogram
    const currentHour = new Date().getHours();
    liveStats.hourlyCounts[currentHour]++;

    throttledUpdateUI();
  }

  function processBanEvent(payload) {
    liveStats.totalBans++;
    const bannedUser = payload.user?.username || payload.banned_user?.username || 'Korisnik';
    const modName = payload.moderator?.username || 'Sistem / Moderator';
    const reason = payload.reason || 'Uklonjena poruka / Timeout';

    liveStats.banLogs.unshift({
      user: bannedUser,
      mod: modName,
      reason: reason,
      time: new Date().toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })
    });

    if (liveStats.banLogs.length > 15) liveStats.banLogs.pop();

    throttledUpdateUI();
  }

  let uiUpdateTimer = null;
  function throttledUpdateUI() {
    if (!uiUpdateTimer) {
      uiUpdateTimer = setTimeout(() => {
        updateDashboardStatsUI();
        uiUpdateTimer = null;
      }, 500); // 500ms debounce for real-time smoothness
    }
  }

  function updateDashboardStatsUI() {
    // Top Key Metrics Grid
    setText('valTotalMessages', liveStats.totalMessages.toLocaleString());
    setText('valAvgViewers', liveStats.avgViewers > 0 ? liveStats.avgViewers.toLocaleString() : 'Offline');
    setText('valActiveSubs', liveStats.activeSubs > 0 ? liveStats.activeSubs.toLocaleString() : '0');
    setText('valUniqueChatters', liveStats.uniqueChattersMap.size.toLocaleString());

    // Secondary Summary Strip
    setText('valTotalKicks', liveStats.totalKicks.toLocaleString());
    setText('valTotalBans', liveStats.totalBans.toLocaleString());
    setText('valTotalHosts', liveStats.totalHosts.toLocaleString());
    setText('valTotalEmotes', liveStats.totalEmotes.toLocaleString());

    renderHourlyActivityChart();
    renderPopularEmotes();
    renderActiveViewersTable();
    renderBanHistoryTable();

    if (channelName) saveSessionStats(channelName);
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function renderHourlyActivityChart() {
    const container = document.getElementById('hourlyChartViewport');
    if (!container) return;

    const maxVal = Math.max(...liveStats.hourlyCounts, 10);
    let peakHour = 0;
    let maxHourCount = 0;
    let html = '';

    // Render 24 hours bar graph
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
    container.innerHTML = html;

    const peakLabel = document.getElementById('hourlyPeakLabel');
    if (peakLabel) {
      if (maxHourCount > 0) {
        const nextHour = (peakHour + 1) % 24;
        peakLabel.textContent = `Najaktivniji period: ${peakHour < 10 ? '0' + peakHour : peakHour}:00 - ${nextHour < 10 ? '0' + nextHour : nextHour}:00 (${maxHourCount} msgs)`;
      } else {
        peakLabel.textContent = 'Čeka se aktivnost chata...';
      }
    }
  }

  function renderPopularEmotes() {
    const container = document.getElementById('popularEmotesContainer');
    const totalEmotesLabel = document.getElementById('emotesTotalLabel');
    if (totalEmotesLabel) {
      totalEmotesLabel.textContent = `Ukupno: ${liveStats.totalEmotes.toLocaleString()} emotea`;
    }
    if (!container) return;

    if (liveStats.emotesMap.size === 0) {
      container.innerHTML = `<div class="empty-list-notice">Emoti će se pojaviti ovde kada ih gledaoci iskoriste u chatu.</div>`;
      return;
    }

    const sortedEmotes = Array.from(liveStats.emotesMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    const maxCount = sortedEmotes[0] ? sortedEmotes[0][1] : 1;

    let html = '';
    sortedEmotes.forEach(([name, count]) => {
      const pct = Math.round((count / maxCount) * 100);
      html += `
        <div class="progress-item-row">
          <div class="progress-item-header">
            <span style="font-weight:700; color:#fff;">${escapeHtml(name)}</span>
            <span style="color:var(--kickan-accent-amber); font-weight:800;">${count.toLocaleString()}x</span>
          </div>
          <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width: ${pct}%;"></div>
          </div>
        </div>
      `;
    });
    container.innerHTML = html;
  }

  function renderActiveViewersTable() {
    const tbody = document.getElementById('tableMostActiveViewers');
    if (!tbody) return;

    if (liveStats.viewersActivityMap.size === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="table-empty-state">Čekamo prve chat poruke sa kanala uživo...</td></tr>`;
      return;
    }

    const sortedViewers = Array.from(liveStats.viewersActivityMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8);

    let html = '';
    sortedViewers.forEach(([user, data], index) => {
      const rank = index + 1;
      let badgeClass = '';
      if (rank === 1) badgeClass = 'rank-1';
      else if (rank === 2) badgeClass = 'rank-2';
      else if (rank === 3) badgeClass = 'rank-3';

      const statusTag = data.isSub
        ? `<span style="color:#c084fc; font-weight:800; background:rgba(147, 51, 234, 0.15); padding:2px 8px; border-radius:6px; font-size:0.75rem;">SUB</span>`
        : `<span style="color:var(--kickan-text-muted); font-size:0.8rem;">Gledalac</span>`;

      html += `
        <tr>
          <td><span class="rank-badge-pill ${badgeClass}">#${rank}</span></td>
          <td style="font-weight:700; color:#fff;">${escapeHtml(user)}</td>
          <td style="color:var(--kickan-accent-green); font-weight:700;">${data.count.toLocaleString()} poruka</td>
          <td>${statusTag}</td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  function renderBanHistoryTable() {
    const tbody = document.getElementById('tableBanHistory');
    if (!tbody) return;

    if (liveStats.banLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="table-empty-state">Nema nedavnih zabranjenih poruka ili banova na kanalu.</td></tr>`;
      return;
    }

    let html = '';
    liveStats.banLogs.forEach(b => {
      html += `
        <tr>
          <td>
            <div style="font-weight:700; color:#fff;">${escapeHtml(b.user)}</div>
            <div style="font-size:0.75rem; color:#f87171; margin-top:2px;">Razlog: ${escapeHtml(b.reason)}</div>
          </td>
          <td style="color:var(--kickan-text-muted); font-size:0.85rem;">${escapeHtml(b.mod)}</td>
          <td style="font-size:0.85rem; color:var(--kickan-text-muted);">${b.time}</td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
  }

})();