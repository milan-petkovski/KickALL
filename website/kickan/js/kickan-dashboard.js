/* 
 * Kickan Module Dashboard Script - Real Stream Analytics & Channel Intelligence Studio
 * UTF-8 clean encoding without BOM - Serbian Latin: č, ć, š, đ, ž
 * 100% Real Live Analytics & WebSocket Telemetry (No Hardcoded Fake Data)
 */

(function () {
  'use strict';

  const supabaseUrl = window.CONFIG?.SUPABASE?.URL;
  const supabaseAnonKey = window.CONFIG?.SUPABASE?.ANON_KEY;
  const storageKey = window.CONFIG?.SUPABASE?.STORAGE_KEY || 'kickbot-supabase-auth';

  let sb = null;
  let currentUser = null;
  let channelName = '';
  let chatroomId = null;
  let kickWebSocket = null;
  let pingInterval = null;

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
    emotesMap: new Map(),
    viewersActivityMap: new Map(), // username -> { count, isSub }
    banLogs: [],
    hourlyCounts: new Array(24).fill(0)
  };

  if (window.supabase && supabaseUrl && supabaseAnonKey) {
    sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: storageKey }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await checkAuthSession();
    setupUserMenu();
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
    if (!sb) {
      redirectToHome();
      return;
    }

    try {
      const session = window.CONFIG?.getValidSessionWithRetry
        ? await window.CONFIG.getValidSessionWithRetry(sb, 3, 1500)
        : (await sb.auth.getSession())?.data?.session;

      if (!session?.user) {
        redirectToHome();
        return;
      }

      if (window.CONFIG?.setupCrossTabSync && !window._crossTabSyncInitialized) {
        window._crossTabSyncInitialized = true;
        window.CONFIG.setupCrossTabSync(sb, (newSession, eventType) => {
          if (!newSession || eventType === 'GLOBAL_LOGOUT' || eventType === 'SIGNED_OUT') {
            redirectToHome();
          }
        });
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
        const { data: profile } = await sb
          .from('user_profiles')
          .select('*')
          .eq('id', currentUser.id)
          .maybeSingle();

        if (profile) {
          if (profile.kick_channels && Array.isArray(profile.kick_channels) && profile.kick_channels.length > 0) {
            const primary = profile.kick_channels.find(c => c.is_primary) || profile.kick_channels[0];
            if (primary.username) username = primary.username;
            if (primary.avatar) avatarUrl = primary.avatar;
            if (primary.chatroom_id) chatroomId = primary.chatroom_id;
          }
          if (!username && profile.display_name) username = profile.display_name;
        }
      } catch (e) {
        console.log('Supabase profile lookup info:', e.message);
      }

      channelName = cleanUsername(username);
      const slugEl = document.getElementById('kickChannelSlug');
      const btnVisit = document.getElementById('btnVisitKickChannel');

      if (slugEl) slugEl.textContent = channelName || 'Nepovezan Kanal';
      if (btnVisit && channelName) btnVisit.href = `https://kick.com/${channelName}`;

      updateHeaderProfileUI(channelName, avatarUrl);

      if (channelName) {
        await loadRealKickChannelData(channelName);
        connectToRealKickChat();
      }

      dismissAuthGate();
    } catch (err) {
      console.warn('Auth check error:', err);
      redirectToHome();
    }
  }

  function redirectToHome() {
    const msg = document.getElementById('authGateMsg');
    let secondsLeft = 3;

    if (msg) {
      msg.textContent = `Niste prijavljeni. Preusmeravamo vas na početnu stranicu za ${secondsLeft}s...`;
    }

    const timer = setInterval(() => {
      secondsLeft--;
      if (msg && secondsLeft > 0) {
        msg.textContent = `Niste prijavljeni. Preusmeravamo vas na početnu stranicu za ${secondsLeft}s...`;
      }
      if (secondsLeft <= 0) {
        clearInterval(timer);
        window.location.href = '../index.html';
      }
    }, 1000);
  }

  function dismissAuthGate() {
    const gate = document.getElementById('authGate');
    if (gate) {
      gate.classList.add('fade-out');
      setTimeout(() => { gate.style.display = 'none'; }, 450);
    }
    document.body.classList.remove('auth-loading');
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
    } catch (_) {}
  }

  function saveSessionStats(slug) {
    if (!slug) return;
    try {
      const payload = {
        totalMessages: liveStats.totalMessages,
        totalEmotes: liveStats.totalEmotes,
        totalBans: liveStats.totalBans,
        uniqueChatters: Array.from(liveStats.uniqueChattersMap),
        emotes: Array.from(liveStats.emotesMap.entries()),
        viewers: Array.from(liveStats.viewersActivityMap.entries()),
        banLogs: liveStats.banLogs,
        hourlyCounts: liveStats.hourlyCounts
      };
      localStorage.setItem(`kickan_session_${slug}`, JSON.stringify(payload));
    } catch (_) {}
  }

  // ── 1. Fetch Real Kick Channel API Data ─────────────────────
  async function loadRealKickChannelData(slug) {
    loadSavedSessionStats(slug);
    let channelData = null;

    try {
      const res = await fetch(`https://kick.com/api/v2/channels/${slug}`);
      if (res.ok) {
        channelData = await res.json();
      }
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
      if (channelData.chatroom && channelData.chatroom.id) {
        chatroomId = channelData.chatroom.id;
      }
      
      // Update Real Viewers / Followers / Subs from Kick API
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
          liveStats.uniqueChattersMap = new Set(watchLogs.map(w => w.username || w.user_id));
        }
      } catch (_) {}
    }

    updateDashboardStatsUI();
  }

  // ── 2. Real Kick Chat WebSocket Listener ────────────────────
  async function connectToRealKickChat() {
    if (!chatroomId && channelName) {
      await loadRealKickChannelData(channelName);
    }
    if (!chatroomId) {
      console.warn('Kickan WebSocket: Chatroom ID nije dostupan.');
      return;
    }

    if (kickWebSocket) {
      kickWebSocket.close();
    }

    const pusherUrl = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.5.0&flash=false';
    kickWebSocket = new WebSocket(pusherUrl);

    kickWebSocket.onopen = () => {
      console.log(`Kickan Realtime WebSocket Connected to chatroom: ${chatroomId}`);
      const targetChannel = `chatrooms.${chatroomId}.v2`;
      
      kickWebSocket.send(JSON.stringify({
        event: 'pusher:subscribe',
        data: { auth: '', channel: targetChannel }
      }));

      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (kickWebSocket && kickWebSocket.readyState === WebSocket.OPEN) {
          kickWebSocket.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
        }
      }, 25000);
    };

    kickWebSocket.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (!msg || !msg.event) return;

        if (msg.event === 'App\\Events\\ChatMessageEvent') {
          const payload = JSON.parse(msg.data);
          processChatMessageEvent(payload);
        } else if (msg.event === 'App\\Events\\UserBannedEvent' || msg.event === 'App\\Events\\MessageDeletedEvent') {
          const payload = JSON.parse(msg.data);
          processBanEvent(payload);
        } else if (msg.event === 'App\\Events\\StreamHostEvent' || msg.event === 'App\\Events\\SubscriptionEvent' || msg.event === 'App\\Events\\GiftedSubscriptionsEvent') {
          liveStats.totalHosts++;
          updateDashboardStatsUI();
        }
      } catch (_) {}
    };
  }

  function processChatMessageEvent(payload) {
    if (!payload || !payload.sender) return;

    liveStats.totalMessages++;
    const senderName = payload.sender.username || 'Gledalac';
    const isSub = !!(payload.sender.identity && payload.sender.identity.badges && payload.sender.identity.badges.some(b => b.type === 'subscriber'));

    liveStats.uniqueChattersMap.add(senderName);

    // Track active viewers table
    const existing = liveStats.viewersActivityMap.get(senderName) || { count: 0, isSub: isSub };
    existing.count++;
    existing.isSub = isSub;
    liveStats.viewersActivityMap.set(senderName, existing);

    // Track emotes in message content
    const content = payload.content || '';
    const emoteMatches = content.match(/:[a-zA-Z0-9_]+:/g);
    if (emoteMatches) {
      emoteMatches.forEach(emote => {
        liveStats.totalEmotes++;
        const curr = liveStats.emotesMap.get(emote) || 0;
        liveStats.emotesMap.set(emote, curr + 1);
      });
    }

    // Track hourly activity histogram
    const currentHour = new Date().getHours();
    liveStats.hourlyCounts[currentHour]++;

    updateDashboardStatsUI();
  }

  function processBanEvent(payload) {
    liveStats.totalBans++;
    const bannedUser = payload.user?.username || payload.banned_user?.username || 'Korisnik';
    const modName = payload.moderator?.username || 'Moderator';
    const reason = payload.reason || 'Spam / Prekršaj pravila';

    liveStats.banLogs.unshift({
      user: bannedUser,
      mod: modName,
      reason: reason,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    if (liveStats.banLogs.length > 10) liveStats.banLogs.pop();

    updateDashboardStatsUI();
  }

  // ── 3. Render 100% Real UI Metrics ──────────────────────────
  function updateDashboardStatsUI() {
    const elMsgs = document.getElementById('valTotalMessages');
    const elAvg = document.getElementById('valAvgViewers');
    const elSubs = document.getElementById('valActiveSubs');
    const elUnique = document.getElementById('valUniqueChatters');
    const elKicks = document.getElementById('valTotalKicks');
    const elBans = document.getElementById('valTotalBans');
    const elHosts = document.getElementById('valTotalHosts');
    const elEmotes = document.getElementById('valTotalEmotes');

    if (elMsgs) elMsgs.textContent = liveStats.totalMessages.toLocaleString();
    if (elAvg) elAvg.textContent = liveStats.avgViewers > 0 ? liveStats.avgViewers.toLocaleString() : 'Offline';
    if (elSubs) elSubs.textContent = liveStats.activeSubs > 0 ? liveStats.activeSubs.toLocaleString() : '0';
    if (elUnique) elUnique.textContent = liveStats.uniqueChattersMap.size.toLocaleString();
    if (elKicks) elKicks.textContent = liveStats.totalKicks.toLocaleString();
    if (elBans) elBans.textContent = liveStats.totalBans.toLocaleString();
    if (elHosts) elHosts.textContent = liveStats.totalHosts.toLocaleString();
    if (elEmotes) elEmotes.textContent = liveStats.totalEmotes.toLocaleString();

    renderHourlyActivityChart();
    renderPopularEmotes();
    renderActiveViewersTable();
    renderBanHistoryTable();

    if (channelName) saveSessionStats(channelName);
  }

  function renderHourlyActivityChart() {
    const container = document.getElementById('hourlyChartViewport');
    if (!container) return;

    const maxVal = Math.max(...liveStats.hourlyCounts, 1);
    let peakHour = 0;
    let maxHourCount = 0;

    let html = '';
    liveStats.hourlyCounts.forEach((val, hour) => {
      if (val > maxHourCount) {
        maxHourCount = val;
        peakHour = hour;
      }
      const pct = Math.round((val / maxVal) * 100);
      const isPeak = pct >= 80 && val > 0;
      const hourStr = hour < 10 ? `0${hour}h` : `${hour}h`;
      html += `
        <div class="chart-bar-col" title="${hourStr}: ${val} poruka">
          <div class="chart-bar-fill ${isPeak ? 'highlight' : ''}" style="height: ${Math.max(pct, 4)}%;"></div>
          <span class="chart-bar-label">${hour % 4 === 0 ? hourStr : ''}</span>
        </div>
      `;
    });

    container.innerHTML = html;

    const peakLabel = document.getElementById('hourlyPeakLabel');
    if (peakLabel) {
      if (maxHourCount > 0) {
        const nextHour = (peakHour + 1) % 24;
        peakLabel.textContent = `Najaktivniji period: ${peakHour < 10 ? '0' + peakHour : peakHour}:00 - ${nextHour < 10 ? '0' + nextHour : nextHour}:00 (${maxHourCount} msg)`;
      } else {
        peakLabel.textContent = 'Najaktivniji period: Čekanje poruka...';
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
      container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--kickan-text-muted); font-size:0.9rem;">Praćenje emotea uživo... Slanjem poruka u chatu ovde će se prikazati omiljeni emoti.</div>`;
      return;
    }

    const sortedEmotes = Array.from(liveStats.emotesMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const maxCount = sortedEmotes[0] ? sortedEmotes[0][1] : 1;

    let html = '';
    sortedEmotes.forEach(([name, count]) => {
      const pct = Math.round((count / maxCount) * 100);
      html += `
        <div class="progress-item-row">
          <div class="progress-item-header">
            <span style="font-weight:700;">${escapeHtml(name)}</span>
            <span style="color:var(--kickan-accent-cyan); font-weight:700;">${count}x</span>
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
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--kickan-text-muted); padding:20px;">Čekamo prve chat poruke sa kanala uživo...</td></tr>`;
      return;
    }

    const sortedViewers = Array.from(liveStats.viewersActivityMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    let html = '';
    sortedViewers.forEach(([user, data], index) => {
      const rank = index + 1;
      const rankClass = rank <= 3 ? `rank-${rank}` : '';
      html += `
        <tr>
          <td><span class="rank-badge-pill ${rankClass}">#${rank}</span></td>
          <td style="font-weight:700;">${escapeHtml(user)}</td>
          <td style="color:var(--kickan-accent-cyan); font-weight:700;">${data.count} poruka</td>
          <td>${data.isSub ? '<span style="color:#c084fc; font-weight:700;">SUB</span>' : '<span style="color:var(--kickan-text-muted);">Gledalac</span>'}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  }

  function renderBanHistoryTable() {
    const tbody = document.getElementById('tableBanHistory');
    if (!tbody) return;

    if (liveStats.banLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--kickan-text-muted); padding:20px;">Nema nedavnih banova na kanalu.</td></tr>`;
      return;
    }

    let html = '';
    liveStats.banLogs.forEach(b => {
      html += `
        <tr>
          <td style="font-weight:700;">${escapeHtml(b.user)}</td>
          <td style="color:var(--kickan-text-muted);">${escapeHtml(b.mod)}</td>
          <td><span class="ban-tag">${escapeHtml(b.reason)}</span></td>
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
