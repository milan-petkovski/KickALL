/* 
 * Kickaj Module Dashboard Script - Real Kick Chatroom WebSocket Engine
 * UTF-8 clean encoding without BOM - Serbian Latin: č, ć, š, đ, ž
 * 100% Real Live Chat Integration (No Fake / Simulated Data)
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

  let isRunning = false;
  let isSpinning = false;
  let participantsMap = new Map();
  let winnersList = [];

  let settings = {
    keyword: '',
    numWinners: 1,
    subDuration: 0,
    subMultiplier: 1,
    followDuration: 0,
    subscribersOnly: false,
    confirmTime: 30,
    animation: 'wheel'
  };

  let wheelAngle = 0;
  let audioCtx = null;
  const sliceColors = [
    '#53fc18', '#9333ea', '#06b6d4', '#f59e0b', '#ec4899', 
    '#3b82f6', '#10b981', '#8b5cf6', '#f43f5e', '#eab308'
  ];

  if (window.supabase && supabaseUrl && supabaseAnonKey) {
    sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: storageKey }
    });
  }

  // ── 1. Init & Auth Session ──────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    await checkAuthSession();
    setupUserMenu();
    initSettingsForm();
    initCanvasWheel();
  });

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
        avatarEl.style.border = '2px solid var(--kickaj-accent-green)';
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
      document.getElementById('connectedChannelName').textContent = channelName || 'Nepovezan Kanal';
      updateHeaderProfileUI(channelName, avatarUrl);

      if (channelName) {
        await resolveKickChatroom(channelName);
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


  // ── 2. Real Kick Chatroom Resolver & WebSocket ────────
  async function resolveKickChatroom(slug) {
    if (chatroomId) return;

    try {
      const res = await fetch(`https://kick.com/api/v2/channels/${slug}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.chatroom && data.chatroom.id) {
          chatroomId = data.chatroom.id;
          console.log(`Pronađen Kick Chatroom ID za ${slug}: ${chatroomId}`);
          return;
        }
      }
    } catch (e) {
      console.log('Direct Kick API fetch info:', e.message);
    }

    // CORS Proxy fallback resolution
    try {
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://kick.com/api/v2/channels/${slug}`)}`;
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const json = await res.json();
        const data = json.contents ? JSON.parse(json.contents) : null;
        if (data && data.chatroom && data.chatroom.id) {
          chatroomId = data.chatroom.id;
          console.log(`Proxy pronašao Kick Chatroom ID: ${chatroomId}`);
          return;
        }
      }
    } catch (_) {}

    // Fallback resolution attempt via alternative public proxy if main fails
    try {
      const proxyUrl2 = `https://corsproxy.io/?${encodeURIComponent(`https://kick.com/api/v2/channels/${slug}`)}`;
      const res = await fetch(proxyUrl2);
      if (res.ok) {
        const data = await res.json();
        if (data && data.chatroom && data.chatroom.id) {
          chatroomId = data.chatroom.id;
          console.log(`Alternativni proxy pronašao Kick Chatroom ID: ${chatroomId}`);
          return;
        }
      }
    } catch (_) {}

    if (!chatroomId) {
      console.warn(`Nije bilo moguće pronaći chatroom ID za kanal: ${slug}`);
    }
  }

  function connectToRealKickChat() {
    if (kickWebSocket) {
      kickWebSocket.close();
    }

    if (!chatroomId) {
      showToast('Greška: Chatroom ID kanala nije pronađen. Proverite naziv Kick kanala.', 'error');
      return;
    }

    const pusherUrl = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.5.0&flash=false';
    kickWebSocket = new WebSocket(pusherUrl);

    kickWebSocket.onopen = () => {
      console.log(`Real Kick Chat WebSocket Connected for chatroom: ${chatroomId}`);
      const targetChannel = `chatrooms.${chatroomId}.v2`;
      
      const subMsg = {
        event: 'pusher:subscribe',
        data: { auth: '', channel: targetChannel }
      };

      kickWebSocket.send(JSON.stringify(subMsg));

      // Keepalive ping timer
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (kickWebSocket && kickWebSocket.readyState === WebSocket.OPEN) {
          kickWebSocket.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
        }
      }, 25000);
    };

    kickWebSocket.onmessage = (event) => {
      try {
        const msgData = JSON.parse(event.data);

        if (msgData.event === 'App\\Events\\ChatMessageEvent') {
          const payload = typeof msgData.data === 'string' ? JSON.parse(msgData.data) : msgData.data;

          if (payload && payload.sender && payload.content) {
            const senderName = payload.sender.username || payload.sender.slug;
            const text = payload.content;

            // Check badges for subscriber status
            let isSub = false;
            if (payload.sender.identity && Array.isArray(payload.sender.identity.badges)) {
              isSub = payload.sender.identity.badges.some(b => 
                b.type === 'subscriber' || b.type === 'sub_gifter' || b.type === 'founder'
              );
            }

            processChatMessage({
              username: senderName,
              isSub: isSub,
              message: text
            });
          }
        }
      } catch (err) {
        console.error('WS Message Parse Error:', err);
      }
    };

    kickWebSocket.onerror = (err) => {
      console.warn('Kick WebSocket Error:', err);
    };

    kickWebSocket.onclose = () => {
      console.log('Kick WebSocket Connection Closed');
      if (pingInterval) clearInterval(pingInterval);
    };
  }

  // ── 3. Settings Form & Multiplier Chips ─────────────────
  function initSettingsForm() {
    // Multiplier chips
    const multChips = document.querySelectorAll('#multiplierChipsContainer .multiplier-chip');
    multChips.forEach(chip => {
      chip.addEventListener('click', () => {
        multChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        settings.subMultiplier = parseInt(chip.dataset.mult, 10) || 1;
        document.getElementById('statSubMultiplierDisplay').textContent = `${settings.subMultiplier}x`;
      });
    });

    // Inputs
    document.getElementById('inputKeyword').addEventListener('input', (e) => { settings.keyword = e.target.value.trim(); });
    document.getElementById('inputNumWinners').addEventListener('change', (e) => { settings.numWinners = Math.max(1, parseInt(e.target.value, 10) || 1); });
    document.getElementById('inputSubDuration').addEventListener('change', (e) => { settings.subDuration = parseInt(e.target.value, 10) || 0; });
    document.getElementById('inputFollowDuration').addEventListener('change', (e) => { settings.followDuration = parseInt(e.target.value, 10) || 0; });
    document.getElementById('toggleSubscribersOnly').addEventListener('change', (e) => { settings.subscribersOnly = e.target.checked; });
    document.getElementById('inputConfirmTime').addEventListener('change', (e) => { settings.confirmTime = Math.max(5, parseInt(e.target.value, 10) || 30); });
    document.getElementById('selectAnimation').addEventListener('change', (e) => { settings.animation = e.target.value; });

    // Action Buttons
    document.getElementById('btnStartGiveaway').addEventListener('click', toggleStartGiveaway);
    document.getElementById('btnDrawWinner').addEventListener('click', triggerDrawWinner);
    document.getElementById('btnResetGiveaway').addEventListener('click', resetGiveaway);
  }

  // ── 4. Start / Stop Giveaway & Real Message Listener ─────
  function toggleStartGiveaway() {
    const btn = document.getElementById('btnStartGiveaway');
    const pill = document.getElementById('channelStatusPill');

    if (!isRunning) {
      isRunning = true;
      connectToRealKickChat();

      btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause Giveaway`;
      btn.style.background = '#f59e0b';
      btn.style.color = '#07050f';

      if (pill) {
        pill.style.borderColor = 'rgba(83, 252, 24, 0.6)';
        pill.innerHTML = `<span class="channel-dot"></span><span>Uživo konektovan na chat <strong>${channelName}</strong></span>`;
      }

      showToast(`Giveaway započet! Sakupljaju se stvarne poruke iz chata (${channelName}).`);
    } else {
      isRunning = false;
      if (kickWebSocket) kickWebSocket.close();

      btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Nastavi Giveaway`;
      btn.style.background = 'linear-gradient(135deg, #53fc18, #45e010)';

      if (pill) {
        pill.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        pill.innerHTML = `<span class="channel-dot" style="background:#f59e0b; box-shadow:0 0 10px #f59e0b;"></span><span>Prijave pauzirane za <strong>${channelName}</strong></span>`;
      }

      showToast(`Prijave iz chata su pauzirane.`);
    }
  }

  // Real Chat Message Parser
  function processChatMessage(user) {
    if (!isRunning) return;

    // Check keyword
    if (settings.keyword !== '') {
      if (!user.message.toLowerCase().includes(settings.keyword.toLowerCase())) {
        return;
      }
    }

    // Check subscribers only rule
    if (settings.subscribersOnly && !user.isSub) {
      return;
    }

    // Prevent duplicate entries
    if (participantsMap.has(user.username)) {
      return;
    }

    const entry = {
      username: user.username,
      isSub: user.isSub,
      mult: user.isSub ? settings.subMultiplier : 1,
      timestamp: new Date()
    };

    participantsMap.set(user.username, entry);
    updateParticipantsUI();
    drawWheel();
  }

  function updateParticipantsUI() {
    const listContainer = document.getElementById('participantsListContainer');
    const countEl = document.getElementById('statParticipantsCount');
    const countBadge = document.getElementById('badgeParticipantsCount');

    const total = participantsMap.size;
    if (countEl) countEl.textContent = total;
    if (countBadge) countBadge.textContent = total;

    if (total === 0) {
      listContainer.innerHTML = `
        <div style="text-align:center; padding:30px 10px; color:var(--kickaj-text-muted); font-size:0.9rem;">
          Nema prijavljenih učesnika.<br>Klikni <strong>"Start Giveaway"</strong> da se povežeš na svoj chat i primaš poruke.
        </div>
      `;
      return;
    }

    let html = '';
    participantsMap.forEach((p) => {
      html += `
        <div class="participant-row">
          <div class="participant-user">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span>${escapeHtml(p.username)}</span>
          </div>
          <div style="display:flex; gap:6px;">
            ${p.isSub ? '<span class="sub-badge">SUB</span>' : ''}
            <span class="mult-badge">${p.mult}x Šansa</span>
          </div>
        </div>
      `;
    });

    listContainer.innerHTML = html;
  }

  // ── 5. Canvas Wheel of Fortune Renderer ────────────────
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
    const radius = width / 2 - 10;

    ctx.clearRect(0, 0, width, height);

    const pool = getPoolList();

    if (pool.length === 0) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(18, 14, 38, 0.9)';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#53fc18';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Čekanje Poruka iz Chata...', centerX, centerY);
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
      ctx.closePath();

      ctx.fillStyle = sliceColors[i % sliceColors.length];
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#07050f';
      ctx.stroke();

      ctx.save();
      ctx.rotate(angleStart + sliceAngle / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#07050f';
      ctx.font = 'bold 15px "Space Grotesk", sans-serif';
      ctx.fillText(pool[i], radius - 20, 5);
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 2 * Math.PI);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#53fc18';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 36, 0, 2 * Math.PI);
    ctx.fillStyle = '#07050f';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#53fc18';
    ctx.stroke();

    ctx.fillStyle = '#53fc18';
    ctx.font = 'bold 13px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('KICKAJ', 0, 0);

    ctx.restore();
  }

  // ── 6. Draw Winner & Rotation Physics ───────────────────
  function triggerDrawWinner() {
    const pool = getPoolList();
    if (pool.length === 0) {
      showToast('Nema prijavljenih učesnika! Klikni "Start Giveaway" za prijem poruka iz chata.', 'error');
      return;
    }

    if (isSpinning) return;
    isSpinning = true;

    playTickSound();

    const targetSpins = 5 + Math.random() * 4;
    const targetAngle = wheelAngle + targetSpins * 2 * Math.PI + Math.random() * 2 * Math.PI;
    const duration = 6000;
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
      }
    }

    requestAnimationFrame(animateSpin);
  }

  function finalizeWinner(pool) {
    const sliceAngle = (2 * Math.PI) / pool.length;
    const normalizedAngle = (2 * Math.PI - (wheelAngle % (2 * Math.PI)) + 1.5 * Math.PI) % (2 * Math.PI);
    const winningIndex = Math.floor(normalizedAngle / sliceAngle) % pool.length;
    const winningUsername = pool[winningIndex];

    addWinner(winningUsername);
    triggerConfettiEffect();
  }

  function addWinner(username) {
    const winnerObj = {
      username: username,
      drawnAt: new Date(),
      confirmSeconds: settings.confirmTime,
      confirmed: false,
      timerId: null
    };

    winnersList.unshift(winnerObj);
    updateWinnersUI();
    startWinnerConfirmTimer(winnerObj);
    showToast(`ČESTITAMO! Pobednik je ${username}!`, 'success');
  }

  function startWinnerConfirmTimer(w) {
    w.timerId = setInterval(() => {
      w.confirmSeconds--;
      updateWinnersUI();
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

    if (winnersList.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:30px 10px; color:var(--kickaj-text-muted); font-size:0.9rem;">
          Pobednici će se pojaviti ovde nakon klikom na <strong>"Draw Winner"</strong>.
        </div>
      `;
      return;
    }

    let html = '';
    winnersList.forEach((w) => {
      const pct = Math.max(0, (w.confirmSeconds / settings.confirmTime) * 100);
      html += `
        <div class="winner-card-item">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div class="winner-name-title">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
              <span>${escapeHtml(w.username)}</span>
            </div>
            <span style="font-size:0.85rem; font-weight:700; color:var(--kickaj-accent-green);">
              ${w.confirmSeconds > 0 ? `${w.confirmSeconds}s za potvrdu` : 'Vreme Isteklo'}
            </span>
          </div>

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
    if (kickWebSocket) kickWebSocket.close();
    participantsMap.clear();
    winnersList.forEach(w => clearInterval(w.timerId));
    winnersList = [];
    wheelAngle = 0;

    const btn = document.getElementById('btnStartGiveaway');
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Giveaway`;
    btn.style.background = 'linear-gradient(135deg, #53fc18, #45e010)';

    updateParticipantsUI();
    updateWinnersUI();
    drawWheel();
    showToast('Giveaway je uspešno resetovan!');
  }

  // ── 7. Single Fixed Toast Notification Handler ─────────
  function showToast(message, type = 'success') {
    if (window.toastSystem) {
      if (typeof window.toastSystem[type] === 'function') {
        window.toastSystem[type](message);
        return;
      } else if (typeof window.toastSystem.show === 'function') {
        window.toastSystem.show(message, type);
        return;
      }
    }

    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} show`;
    const isErr = type === 'error';
    const iconSvg = isErr
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#53fc18" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

    toast.innerHTML = `
      <div class="toast-content">
        <div class="toast-icon-wrap">${iconSvg}</div>
        <div class="toast-msg">${escapeHtml(message)}</div>
      </div>
      <div class="toast-progress" style="animation: toastProgress 4000ms linear forwards;"></div>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 350);
    }, 4000);
  }

  // ── Helpers ─────────────────────────────────────────────
  function playTickSound() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } catch (e) {}
  }

  function triggerConfettiEffect() {
    for (let i = 0; i < 45; i++) {
      const p = document.createElement('div');
      p.style.cssText = `
        position: fixed;
        top: 35%;
        left: 65%;
        width: 10px;
        height: 10px;
        background: ${sliceColors[i % sliceColors.length]};
        border-radius: 50%;
        pointer-events: none;
        z-index: 99999;
        transform: translate(${Math.random() * 320 - 160}px, ${Math.random() * 320 - 160}px);
        transition: all 1s ease-out;
        opacity: 1;
      `;
      document.body.appendChild(p);
      setTimeout(() => {
        p.style.opacity = '0';
        p.style.transform += ' translateY(120px)';
        setTimeout(() => p.remove(), 1000);
      }, 50);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
  }

})();
