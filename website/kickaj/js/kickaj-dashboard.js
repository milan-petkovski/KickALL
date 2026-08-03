(function () {
  'use strict';

  // Supabase Configuration
  const supabaseUrl = window.CONFIG?.SUPABASE?.URL;
  const supabaseAnonKey = window.CONFIG?.SUPABASE?.ANON_KEY;
  const storageKey = window.CONFIG?.SUPABASE?.STORAGE_KEY || 'kickbot-supabase-auth';
  const LOCAL_STORAGE_STATE_KEY = 'kickaj_giveaway_studio_state_v2';

  // State Variables
  let sb = null;
  let currentUser = null;
  let channelName = '';
  let chatroomId = null;
  let kickWebSocket = null;
  let pingInterval = null;
  let isRunning = false;
  let isConnecting = false;
  let isSpinning = false;
  let toastId = 0;
  let participantsMap = new Map();
  let winnersList = [];

  // Giveaway Settings Defaults
  let settings = {
    prize: 'Misteriozna Nagrada',
    keyword: '',
    numWinners: 1,
    subDuration: 0,
    subMultiplier: 1,
    followDuration: 0,
    subscribersOnly: false,
    confirmTime: 30,
    animation: 'wheel'
  };

  const animationLabels = {
    wheel: 'Točak sreće',
    slot: 'Slot Mašina',
    roulette: 'Neon Rulet'
  };

  let wheelAngle = 0;
  const sliceColors = [
    '#53fc18', '#9333ea', '#06b6d4', '#f59e0b', '#ec4899',
    '#3b82f6', '#10b981', '#8b5cf6', '#f43f5e', '#eab308'
  ];

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
  }

  document.addEventListener('DOMContentLoaded', async () => {
    loadStateFromLocalStorage();
    await checkAuthSession();
    setupUserMenu();
    initSettingsForm();
    initCanvasWheel();
    updateParticipantsUI();
    updateWinnersUI();
    refreshDashboardState();
  });

  function saveStateToLocalStorage() {
    try {
      const serializableParticipants = Array.from(participantsMap.entries());
      const serializableWinners = winnersList.map(w => ({
        username: w.username,
        prize: w.prize,
        confirmSeconds: w.confirmSeconds,
        savedAt: Date.now()
      }));

      const stateToSave = {
        settings,
        participants: serializableParticipants,
        winners: serializableWinners,
        isRunning,
        wheelAngle
      };

      localStorage.setItem(LOCAL_STORAGE_STATE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
      console.warn('Greška pri čuvanju u LocalStorage:', e);
    }
  }

  function loadStateFromLocalStorage() {
    try {
      const savedData = localStorage.getItem(LOCAL_STORAGE_STATE_KEY);
      if (!savedData) return;

      const parsed = JSON.parse(savedData);

      if (parsed.settings) {
        settings = { ...settings, ...parsed.settings };
        restoreInputsFromSettings();
      }

      if (Array.isArray(parsed.participants)) {
        participantsMap = new Map(parsed.participants);
      }

      if (Array.isArray(parsed.winners)) {
        winnersList = parsed.winners.map(w => {
          const elapsedSec = w.savedAt ? Math.floor((Date.now() - w.savedAt) / 1000) : 0;
          const remainingSec = Math.max(0, (w.confirmSeconds || settings.confirmTime) - elapsedSec);
          return {
            username: w.username,
            prize: w.prize || settings.prize,
            confirmSeconds: remainingSec,
            timerId: null
          };
        });

        // Re-start confirmation timers for existing winners
        winnersList.forEach(w => {
          if (w.confirmSeconds > 0) {
            startWinnerConfirmTimer(w);
          }
        });
      }

      if (typeof parsed.wheelAngle === 'number') {
        wheelAngle = parsed.wheelAngle;
      }

      if (parsed.isRunning) {
        isRunning = false; // Start paused for safety on page refresh
      }
    } catch (e) {
      console.warn('Greška pri učitavanju stanja iz LocalStorage:', e);
    }
  }

  function restoreInputsFromSettings() {
    const inputPrize = document.getElementById('inputPrize');
    const inputKeyword = document.getElementById('inputKeyword');
    const inputNumWinners = document.getElementById('inputNumWinners');
    const inputSubDuration = document.getElementById('inputSubDuration');
    const inputFollowDuration = document.getElementById('inputFollowDuration');
    const toggleSubscribersOnly = document.getElementById('toggleSubscribersOnly');
    const inputConfirmTime = document.getElementById('inputConfirmTime');
    const selectAnimation = document.getElementById('selectAnimation');

    if (inputPrize) inputPrize.value = settings.prize || '';
    if (inputKeyword) inputKeyword.value = settings.keyword || '';
    if (inputNumWinners) inputNumWinners.value = settings.numWinners || 1;
    if (inputSubDuration) inputSubDuration.value = settings.subDuration || 0;
    if (inputFollowDuration) inputFollowDuration.value = settings.followDuration || 0;
    if (toggleSubscribersOnly) toggleSubscribersOnly.checked = !!settings.subscribersOnly;
    if (inputConfirmTime) inputConfirmTime.value = settings.confirmTime || 30;
    if (selectAnimation) selectAnimation.value = settings.animation || 'wheel';

    const multChips = document.querySelectorAll('#multiplierChipsContainer .multiplier-chip');
    multChips.forEach(chip => {
      const val = parseInt(chip.dataset.mult, 10);
      if (val === settings.subMultiplier) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });

    const statSubMult = document.getElementById('statSubMultiplierDisplay');
    if (statSubMult) statSubMult.textContent = `${settings.subMultiplier}x`;
  }

  function cleanUsername(raw) {
    if (!raw) return 'Kanal';
    let s = String(raw).trim();
    if (s.startsWith('kick_user_')) {
      s = s.replace(/^kick_user_/, '');
    }
    if (s.includes('@')) {
      s = s.split('@')[0];
    }
    return s || 'Kanal';
  }

  function updateHeaderProfileUI(username, avatarUrl) {
    const nameEl = document.getElementById('userNameDisplay');
    const avatarEl = document.getElementById('userAvatarDisplay');
    const cleanName = cleanUsername(username);

    if (nameEl) {
      nameEl.textContent = cleanName;
    }

    if (avatarEl) {
      if (avatarUrl && avatarUrl.startsWith('http')) {
        avatarEl.style.backgroundImage = `url('${avatarUrl}')`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.textContent = '';
      } else if (cleanName) {
        avatarEl.style.backgroundImage = 'none';
        avatarEl.style.backgroundColor = 'var(--kickaj-accent-green)';
        avatarEl.style.color = '#000';
        avatarEl.textContent = cleanName.charAt(0).toUpperCase();
      }
    }
  }

  async function checkAuthSession() {
    if (!sb) {
      const gateMsg = document.getElementById('authGateMsg');
      if (gateMsg) gateMsg.textContent = 'Preusmeravanje na prijavu...';
      setTimeout(() => { window.location.href = '../index.html?login=1'; }, 1200);
      return;
    }
    try {
      const session = window.CONFIG?.getValidSessionWithRetry
        ? await window.CONFIG.getValidSessionWithRetry(sb, 3, 1500)
        : (await sb.auth.getSession())?.data?.session;

      if (!session?.user) {
        const gateMsg = document.getElementById('authGateMsg');
        if (gateMsg) gateMsg.textContent = 'Preusmeravanje na prijavu...';
        setTimeout(() => { window.location.href = '../index.html?login=1'; }, 1200);
        return;
      }

      if (session?.user) {
        currentUser = session.user;
        let username = currentUser.user_metadata?.kick_username
          || currentUser.user_metadata?.preferred_username
          || currentUser.user_metadata?.name
          || currentUser.user_metadata?.full_name
          || (currentUser.email ? currentUser.email : '');
        let avatarUrl = currentUser.user_metadata?.avatar_url
          || currentUser.user_metadata?.picture
          || currentUser.user_metadata?.profile_picture;

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
          console.warn('Greska pri dobavljanju profila:', e);
        }

        channelName = cleanUsername(username);
        const channelNameEl = document.getElementById('connectedChannelName');
        if (channelNameEl) channelNameEl.textContent = channelName || 'DemoKanal';

        const stageChannelEl = document.getElementById('stageChannelName');
        if (stageChannelEl) stageChannelEl.textContent = channelName || 'DemoKanal';

        updateHeaderProfileUI(channelName, avatarUrl);

        if (channelName) {
          await resolveKickChatroom(channelName);
        }
      }
      dismissAuthGate();
    } catch (err) {
      const gateMsg = document.getElementById('authGateMsg');
      if (gateMsg) gateMsg.textContent = 'Preusmeravanje na prijavu...';
      setTimeout(() => { window.location.href = '../index.html?login=1'; }, 1200);
    }
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

  function getAnimationLabel(value) {
    return animationLabels[value] || animationLabels.wheel;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function getEligibilitySummary() {
    const parts = [];
    parts.push(settings.subscribersOnly ? 'Samo subovi' : 'Otvoreno za sve');
    if (settings.subDuration > 0) parts.push(`sub ${settings.subDuration}+ mes.`);
    if (settings.followDuration > 0) parts.push(`follow ${settings.followDuration}+ dana`);
    return parts.join(' | ');
  }

  function updateStageState() {
    const badge = document.getElementById('stageStateBadge');
    const pill = document.getElementById('channelStatusPill');
    const safeChannel = escapeHtml(channelName || 'DemoKanal');

    if (!badge) return;

    badge.classList.remove('is-live', 'is-paused', 'is-spinning');

    if (isSpinning) {
      badge.textContent = 'Izvlačenje u toku';
      badge.classList.add('is-spinning');
      if (pill) {
        pill.innerHTML = `<span class="channel-dot" style="background:#a855f7;"></span><span>Izvlačenje u toku na <strong>${safeChannel}</strong></span>`;
      }
      return;
    }

    if (isRunning) {
      badge.textContent = 'Live Chat Aktivan';
      badge.classList.add('is-live');
      if (pill) {
        pill.innerHTML = `<span class="channel-dot"></span><span>Povezan kanal: <strong>${safeChannel}</strong></span>`;
      }
      return;
    }

    if (participantsMap.size > 0 || winnersList.length > 0) {
      badge.textContent = 'Pauzirano';
      badge.classList.add('is-paused');
      if (pill) {
        pill.innerHTML = `<span class="channel-dot" style="background:#f59e0b;"></span><span>Prijave pauzirane na <strong>${safeChannel}</strong></span>`;
      }
      return;
    }

    badge.textContent = 'Standby';
    if (pill) {
      pill.innerHTML = `<span class="channel-dot"></span><span>Povezan kanal: <strong>${safeChannel}</strong></span>`;
    }
  }

  function updateStudioSummary() {
    setText('summaryPrize', settings.prize || 'Misteriozna Nagrada');
    setText('stagePrizeTitle', settings.prize || 'Misteriozna Nagrada');
    setText('summaryKeyword', settings.keyword || 'Sve poruke');
    setText('summaryAnimation', getAnimationLabel(settings.animation));
    setText('summaryConfirmTime', `Potvrda: ${settings.confirmTime}s`);
    setText('stageAnimationLabel', getAnimationLabel(settings.animation));
    setText('stageEligibilityLabel', getEligibilitySummary());

    if (isSpinning) {
      setText('summaryRunState', 'Izvlačenje u toku');
      setText('summaryRunHelp', 'Točak se okreće i bira pobednika.');
      return;
    }

    if (isRunning) {
      setText('summaryRunState', 'Giveaway aktivan');
      setText('summaryRunHelp', 'Poruke iz chata ulaze u točak.');
      return;
    }

    if (participantsMap.size > 0 || winnersList.length > 0) {
      setText('summaryRunState', 'Pauzirano');
      setText('summaryRunHelp', 'Možeš nastaviti ili resetovati rundu.');
      return;
    }

    setText('summaryRunState', 'Spremno');
    setText('summaryRunHelp', 'Poveži chat i započni prijave.');
  }

  function updateActionState() {
    const drawBtn = document.getElementById('btnDrawWinner');
    const resetBtn = document.getElementById('btnResetGiveaway');
    const hasParticipants = participantsMap.size > 0;
    const limitReached = winnersList.length >= settings.numWinners;

    if (drawBtn) {
      drawBtn.disabled = !hasParticipants || isSpinning || limitReached;
    }

    if (resetBtn) {
      resetBtn.disabled = !isRunning && participantsMap.size === 0 && winnersList.length === 0;
    }
  }

  function refreshDashboardState() {
    updateStudioSummary();
    updateStageState();
    updateActionState();
    saveStateToLocalStorage();
  }

  async function resolveKickChatroom(slug) {
    if (!slug) return null;
    let cleanSlug = String(slug).trim().toLowerCase().replace(/^https?:\/\/(www\.)?kick\.com\//, '').replace(/\/$/, '');

    // Check if numeric ID was provided directly
    if (/^\d+$/.test(cleanSlug)) {
      chatroomId = parseInt(cleanSlug, 10);
      return chatroomId;
    }

    const proxyUrls = [
      `https://kick.com/api/v2/channels/${cleanSlug}`,
      `https://api.allorigins.win/get?url=${encodeURIComponent(`https://kick.com/api/v2/channels/${cleanSlug}`)}`,
      `https://corsproxy.io/?${encodeURIComponent(`https://kick.com/api/v2/channels/${cleanSlug}`)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(`https://kick.com/api/v2/channels/${cleanSlug}`)}`
    ];

    for (const url of proxyUrls) {
      try {
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (res.ok) {
          const text = await res.text();
          let data = null;
          try {
            data = JSON.parse(text);
            if (data?.contents) data = JSON.parse(data.contents);
          } catch (e) { }

          const foundId = data?.chatroom?.id || data?.chatroom_id;
          if (foundId) {
            chatroomId = parseInt(foundId, 10);
            return chatroomId;
          }

          const match = text.match(/"chatroom":\s*\{\s*"id":\s*(\d+)/i) || text.match(/"chatroom_id":\s*(\d+)/i);
          if (match && match[1]) {
            chatroomId = parseInt(match[1], 10);
            return chatroomId;
          }
        }
      } catch (e) { }
    }

    return chatroomId;
  }

  async function connectToRealKickChat() {
    if (kickWebSocket) {
      try { kickWebSocket.close(); } catch (e) { }
      kickWebSocket = null;
    }

    const targetChannel = channelName;
    if (!targetChannel) {
      showToast('Niste prijavljeni na Kick kanal! Prijavite se na profilu.', 'warning');
      return false;
    }

    showToast(`Povezivanje sa Kick chatom za kanal "${targetChannel}"...`, 'info');

    if (!chatroomId) {
      await resolveKickChatroom(targetChannel);
    }

    if (!chatroomId) {
      showToast(`Nije pronađen Chatroom ID za "${targetChannel}". Proverite profil ili osvežite stranicu!`, 'error');
      return false;
    }

    return new Promise((resolve) => {
      let isResolved = false;

      const timeoutTimer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          if (kickWebSocket) {
            try { kickWebSocket.close(); } catch (e) { }
            kickWebSocket = null;
          }
          showToast('Konekcija sa Kick chatom je istekla (Timeout). Pokušajte ponovo.', 'error');
          resolve(false);
        }
      }, 10000);

      const pusherUrl = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.5.0&flash=false';
      try {
        kickWebSocket = new WebSocket(pusherUrl);
      } catch (err) {
        clearTimeout(timeoutTimer);
        showToast('Greška pri kreiranju WebSocket konekcije.', 'error');
        resolve(false);
        return;
      }

      kickWebSocket.onopen = () => {
        if (isResolved) return;
        isResolved = true;
        clearTimeout(timeoutTimer);

        // Subscribe to both v2 and base chatroom Pusher channels
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

        showToast(`Uspešno povezan chat za kanal: ${targetChannel}`, 'success');
        resolve(true);
      };

      kickWebSocket.onerror = () => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeoutTimer);
          showToast('Smetnje pri povezivanju sa Kick live chatom.', 'error');
          resolve(false);
        }
      };

      kickWebSocket.onclose = () => {
        if (pingInterval) clearInterval(pingInterval);
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeoutTimer);
          showToast('Veza sa Kick chatom je zatvorena pre uspostavljanja.', 'error');
          resolve(false);
        } else if (isRunning) {
          isRunning = false;
          updateStartButtonUI();
          updateStageState();
          refreshDashboardState();
          showToast('Veza sa Kick chatom je prekinuta.', 'warning');
        }
      };

      kickWebSocket.onmessage = (event) => {
        try {
          const msgData = JSON.parse(event.data);
          const evName = msgData.event || '';

          if (evName.includes('ChatMessageEvent') || evName.includes('ChatMessageSentEvent')) {
            const payload = typeof msgData.data === 'string' ? JSON.parse(msgData.data) : msgData.data;

            const senderName = payload?.sender?.username || payload?.sender?.slug || payload?.username;
            const text = payload?.content || payload?.message;

            if (senderName && text) {
              let isSub = false;
              const badges = payload?.sender?.identity?.badges || payload?.sender?.badges || payload?.badges || [];
              if (Array.isArray(badges)) {
                isSub = badges.some(b => {
                  const t = (typeof b === 'string' ? b : b.type || '').toLowerCase();
                  return t.includes('sub') || t.includes('founder');
                });
              }

              processChatMessage({ username: senderName, isSub: isSub, message: text });
            }
          }
        } catch (err) { }
      };
    });
  }

  function initSettingsForm() {
    const prizeInput = document.getElementById('inputPrize');
    if (prizeInput) {
      prizeInput.addEventListener('input', (e) => {
        if (e.target.value.length > 45) {
          e.target.value = e.target.value.slice(0, 45);
        }
        settings.prize = e.target.value.trim() || 'Misteriozna Nagrada';
        refreshDashboardState();
      });
    }

    const btnTestMsg = document.getElementById('btnTestMessage');
    if (btnTestMsg) {
      btnTestMsg.addEventListener('click', () => {
        const sampleUsers = ['Gamer_SRB', 'KickMaster_99', 'BalkanStreamer', 'Legendara', 'CoolViewer'];
        const randomUser = sampleUsers[Math.floor(Math.random() * sampleUsers.length)] + '_' + Math.floor(Math.random() * 90 + 10);
        const isSub = Math.random() > 0.4;
        const kw = settings.keyword ? settings.keyword : '';

        processChatMessage({
          username: randomUser,
          isSub: isSub,
          message: (kw ? kw + ' ' : '') + 'Pozdrav sa chata!'
        });
        showToast(`Test prijava: ${randomUser} (${isSub ? 'SUB' : 'FREE'})`, 'info');
      });
    }

    const multChips = document.querySelectorAll('#multiplierChipsContainer .multiplier-chip');
    multChips.forEach(chip => {
      chip.addEventListener('click', () => {
        multChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        settings.subMultiplier = parseInt(chip.dataset.mult, 10) || 1;
        document.getElementById('statSubMultiplierDisplay').textContent = `${settings.subMultiplier}x`;
        refreshDashboardState();
      });
    });

    const kwInput = document.getElementById('inputKeyword');
    if (kwInput) {
      kwInput.addEventListener('input', (e) => {
        if (e.target.value.length > 25) {
          e.target.value = e.target.value.slice(0, 25);
        }
        settings.keyword = e.target.value.trim();
        refreshDashboardState();
      });
    }

    const winnersInput = document.getElementById('inputNumWinners');
    if (winnersInput) {
      winnersInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10) || 1;
        val = Math.min(20, Math.max(1, val));
        e.target.value = val;
        settings.numWinners = val;
        refreshDashboardState();
      });
    }

    const subDurInput = document.getElementById('inputSubDuration');
    if (subDurInput) {
      subDurInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10) || 0;
        val = Math.min(60, Math.max(0, val));
        e.target.value = val;
        settings.subDuration = val;
        refreshDashboardState();
      });
    }

    const followDurInput = document.getElementById('inputFollowDuration');
    if (followDurInput) {
      followDurInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10) || 0;
        val = Math.min(365, Math.max(0, val));
        e.target.value = val;
        settings.followDuration = val;
        refreshDashboardState();
      });
    }

    const toggleSub = document.getElementById('toggleSubscribersOnly');
    if (toggleSub) {
      toggleSub.addEventListener('change', (e) => {
        settings.subscribersOnly = e.target.checked;
        refreshDashboardState();
      });
    }

    const confirmInput = document.getElementById('inputConfirmTime');
    if (confirmInput) {
      confirmInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10) || 30;
        val = Math.min(300, Math.max(5, val));
        e.target.value = val;
        settings.confirmTime = val;
        refreshDashboardState();
      });
    }

    const animSelect = document.getElementById('selectAnimation');
    if (animSelect) {
      animSelect.addEventListener('change', (e) => {
        settings.animation = e.target.value;
        refreshDashboardState();
      });
    }

    const btnStart = document.getElementById('btnStartGiveaway');
    if (btnStart) btnStart.addEventListener('click', toggleStartGiveaway);

    const btnDraw = document.getElementById('btnDrawWinner');
    if (btnDraw) btnDraw.addEventListener('click', triggerDrawWinner);

    const btnReset = document.getElementById('btnResetGiveaway');
    if (btnReset) {
      btnReset.addEventListener('click', resetGiveaway);
    }
  }

  function updateStartButtonUI() {
    const btn = document.getElementById('btnStartGiveaway');
    if (!btn) return;
    if (isRunning) {
      btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> <span>Pauziraj giveaway</span>`;
      btn.style.background = '#f59e0b';
    } else {
      btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> <span>Pokreni giveaway</span>`;
      btn.style.background = 'linear-gradient(135deg, #53fc18, #45e010)';
    }
  }

  async function toggleStartGiveaway() {
    const btn = document.getElementById('btnStartGiveaway');
    if (isConnecting) return;

    if (!isRunning) {
      isConnecting = true;
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>⏳ Povezivanje na Kick chat...</span>`;
      }

      const connected = await connectToRealKickChat();
      isConnecting = false;
      if (btn) btn.disabled = false;

      if (connected) {
        isRunning = true;
        updateStartButtonUI();
        showToast(`Giveaway započet! Nagrada: ${settings.prize}`, 'success');
      } else {
        isRunning = false;
        updateStartButtonUI();
        showToast('Giveaway NIJE započet jer chat nije povezan.', 'error');
      }
    } else {
      isRunning = false;
      if (kickWebSocket) {
        try { kickWebSocket.close(); } catch (e) { }
        kickWebSocket = null;
      }
      updateStartButtonUI();
      showToast('Prijave iz chata su pauzirane.', 'info');
    }
    drawWheel();
    refreshDashboardState();
  }

  function processChatMessage(user) {
    if (!isRunning) return;

    if (settings.keyword !== '') {
      if (!user.message.toLowerCase().includes(settings.keyword.toLowerCase())) return;
    }

    if (settings.subscribersOnly && !user.isSub) return;

    const key = user.username.toLowerCase();
    if (participantsMap.has(key)) return;

    participantsMap.set(key, {
      username: user.username,
      isSub: user.isSub,
      mult: user.isSub ? settings.subMultiplier : 1
    });

    updateParticipantsUI();
    drawWheel();
    refreshDashboardState();
  }

  function updateParticipantsUI() {
    const listContainer = document.getElementById('participantsListContainer');
    const countEl = document.getElementById('statParticipantsCount');
    const countBadge = document.getElementById('badgeParticipantsCount');
    const total = participantsMap.size;

    if (countEl) countEl.textContent = total;
    if (countBadge) countBadge.textContent = total;

    if (!listContainer) return;

    if (total === 0) {
      listContainer.innerHTML = `<div class="empty-list-notice">Prijavljeni učesnici će se pojaviti ovde nakon što pokrenete giveaway.</div>`;
      return;
    }

    let html = '';
    participantsMap.forEach((p) => {
      html += `
        <div class="participant-row">
          <div class="participant-user">
            <span>${escapeHtml(p.username)}</span>
          </div>
          <div style="display:flex; gap:6px;">
            ${p.isSub ? '<span class="sub-badge">SUB</span>' : ''}
            <span class="mult-badge">${p.mult}x</span>
          </div>
        </div>
      `;
    });
    listContainer.innerHTML = html;
  }

  function initCanvasWheel() {
    drawWheel();
  }

  function getPoolList() {
    const pool = [];
    participantsMap.forEach((p) => {
      for (let i = 0; i < p.mult; i++) {
        pool.push(p.username);
      }
    });
    return pool;
  }

  function drawWheel() {
    const canvas = document.getElementById('wheelCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = width / 2 - 8;

    ctx.clearRect(0, 0, width, height);
    const pool = getPoolList();

    if (pool.length === 0) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(18, 14, 38, 0.9)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#53fc18';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (!isRunning && participantsMap.size === 0) {
        ctx.fillText('Čekanje pokretanja giveaway-a...', centerX, centerY);
      } else {
        ctx.fillText('Čekanje poruka iz chata...', centerX, centerY);
      }
      return;
    }

    const numSlices = pool.length;
    const sliceAngle = (2 * Math.PI) / numSlices;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(wheelAngle);

    for (let i = 0; i < numSlices; i++) {
      const angleStart = i * sliceAngle;
      const angleEnd = angleStart + sliceAngle;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, angleStart, angleEnd);
      ctx.fillStyle = sliceColors[i % sliceColors.length];
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#07050f';
      ctx.stroke();

      ctx.save();
      ctx.rotate(angleStart + sliceAngle / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#07050f';
      ctx.font = 'bold 14px "Space Grotesk", sans-serif';
      const labelText = pool[i].length > 15 ? pool[i].substring(0, 13) + '..' : pool[i];
      ctx.fillText(labelText, radius - 15, 4);
      ctx.restore();
    }
    ctx.restore();
  }

  function triggerDrawWinner() {
    const pool = getPoolList();
    if (pool.length === 0) {
      showToast('Nema učesnika za izvlačenje!', 'error');
      return;
    }
    if (isSpinning) return;

    isSpinning = true;
    refreshDashboardState();

    const targetSpins = 5 + Math.random() * 3;
    const targetAngle = wheelAngle + targetSpins * 2 * Math.PI + Math.random() * 2 * Math.PI;
    const duration = 4500;
    const startTime = performance.now();
    const startAngle = wheelAngle;

    function animateSpin(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);

      wheelAngle = startAngle + (targetAngle - startAngle) * easeOut;
      drawWheel();

      if (progress < 1) {
        requestAnimationFrame(animateSpin);
      } else {
        isSpinning = false;
        finalizeWinner(pool);
        refreshDashboardState();
      }
    }
    requestAnimationFrame(animateSpin);
  }

  function finalizeWinner(pool) {
    const sliceAngle = (2 * Math.PI) / pool.length;
    const normalizedAngle = (2 * Math.PI - (wheelAngle % (2 * Math.PI)) + 1.5 * Math.PI) % (2 * Math.PI);
    const winningIndex = Math.floor(normalizedAngle / sliceAngle) % pool.length;
    const winner = pool[winningIndex];

    addWinner(winner);
    participantsMap.delete(winner.toLowerCase());
    updateParticipantsUI();
    drawWheel();
  }

  function addWinner(username) {
    const winnerObj = {
      username: username,
      prize: settings.prize,
      confirmSeconds: settings.confirmTime,
      timerId: null
    };

    winnersList.unshift(winnerObj);
    updateWinnersUI();
    startWinnerConfirmTimer(winnerObj);
    showToast(`ČESTITAMO! ${username} je osvojio/la: ${settings.prize}!`, 'success');
  }

  function startWinnerConfirmTimer(w) {
    if (w.timerId) clearInterval(w.timerId);
    w.timerId = setInterval(() => {
      w.confirmSeconds--;
      updateWinnersUI();
      saveStateToLocalStorage();
      if (w.confirmSeconds <= 0) {
        clearInterval(w.timerId);
      }
    }, 1000);
  }

  function updateWinnersUI() {
    const container = document.getElementById('winnersListContainer');
    const countEl = document.getElementById('statWinnersCount');
    const countBadge = document.getElementById('badgeWinnersCount');

    if (countEl) countEl.textContent = winnersList.length;
    if (countBadge) countBadge.textContent = winnersList.length;

    if (!container) return;

    if (winnersList.length === 0) {
      container.innerHTML = `<div class="empty-list-notice">Pobednici će se pojaviti ovde nakon izvlačenja.</div>`;
      return;
    }

    let html = '';
    winnersList.forEach((w) => {
      const pct = Math.max(0, (w.confirmSeconds / settings.confirmTime) * 100);
      html += `
        <div class="winner-card-item">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div class="winner-name-title">
              <span>🏆 ${escapeHtml(w.username)}</span>
            </div>
            <span style="font-size:0.9rem; font-weight:800; color:var(--kickaj-accent-green);">
              ${w.confirmSeconds > 0 ? `${w.confirmSeconds}s` : 'Isteklo'}
            </span>
          </div>
          <div class="winner-prize-tag">🎁 Nagrada: <strong>${escapeHtml(w.prize)}</strong></div>
          <div class="timer-bar-wrap">
            <div class="timer-bar-fill" style="width:${pct}%;"></div>
          </div>
        </div>
      `;
    });
    container.innerHTML = html;
  }

  function resetGiveaway() {
    isRunning = false;
    isSpinning = false;
    if (kickWebSocket) {
      try { kickWebSocket.close(); } catch (e) { }
      kickWebSocket = null;
    }
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }

    participantsMap.clear();
    winnersList.forEach(w => {
      if (w.timerId) clearInterval(w.timerId);
    });
    winnersList = [];
    wheelAngle = 0;

    const btn = document.getElementById('btnStartGiveaway');
    if (btn) {
      btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> <span>Pokreni giveaway</span>`;
      btn.style.background = 'linear-gradient(135deg, #53fc18, #45e010)';
    }

    localStorage.removeItem(LOCAL_STORAGE_STATE_KEY);

    updateParticipantsUI();
    updateWinnersUI();
    drawWheel();
    refreshDashboardState();
    showToast('Giveaway je uspešno resetovan.', 'success');
  }

  function showToast(arg1, arg2, duration = null) {
    let type = 'success';
    let msg = '';
    const knownTypes = ['success', 'error', 'info', 'warning'];

    if (typeof arg1 === 'string' && knownTypes.includes(arg1.toLowerCase())) {
      type = arg1.toLowerCase();
      msg = arg2 || '';
    } else {
      msg = arg1 || '';
      if (typeof arg2 === 'string' && knownTypes.includes(arg2.toLowerCase())) {
        type = arg2.toLowerCase();
      } else {
        type = 'success';
      }
    }

    let container = document.getElementById('toastContainer');
    if (!container || container.parentElement !== document.body) {
      if (container) container.remove();
      container = document.createElement('div');
      container.className = 'toast-container';
      container.id = 'toastContainer';
      document.body.appendChild(container);
    }

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
      svgIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#53fc18" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'error') {
      svgIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    } else if (type === 'info') {
      svgIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    } else {
      svgIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    }

    el.innerHTML = `
      <div class="toast-icon-wrap">${svgIcon}</div>
      <div class="toast-msg">${escapeHtml(msg)}</div>
      <button class="toast-close" onclick="window.removeToast(${id})">✕</button>
    `;

    const activeToasts = Array.from(container.children).filter(child => !child.classList.contains('toast-leaving'));
    if (activeToasts.length >= 3) {
      const oldest = activeToasts[0];
      oldest.classList.add('toast-leaving');
      const match = oldest.id.match(/toast-(\d+)/);
      if (match) {
        removeToast(parseInt(match[1], 10));
      } else {
        oldest.remove();
      }
    }

    container.appendChild(el);
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

  window.removeToast = removeToast;
  window.toastSystem = {
    show: showToast,
    success: (msg, duration) => showToast(msg, 'success', duration),
    error: (msg, duration) => showToast(msg, 'error', duration),
    warning: (msg, duration) => showToast(msg, 'warning', duration),
    info: (msg, duration) => showToast(msg, 'info', duration)
  };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
  }
})();