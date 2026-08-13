/**
 * KICKAJ — Giveaway Studio
 * Kompletna logika: Auth, Plan, WebSocket, Animacije, Zvuk, Fullscreen
 */
(function () {
  'use strict';

  /* ── Supabase Config ── */
  const supabaseUrl    = window.CONFIG?.SUPABASE?.URL;
  const supabaseAnonKey = window.CONFIG?.SUPABASE?.ANON_KEY;
  const storageKey     = window.CONFIG?.SUPABASE?.STORAGE_KEY || 'kickbot-supabase-auth';
  const STATE_KEY      = 'kickaj_studio_state_v3';

  /* ── State ── */
  let sb               = null;
  let currentUser      = null;
  let userPlan         = 'free';   // 'free' | 'pro' | 'elite'
  let channelName      = '';
  let chatroomId       = null;
  let kickWebSocket    = null;
  let pingInterval     = null;
  let isRunning        = false;
  let isConnecting     = false;
  let isSpinning       = false;
  let toastIdCounter   = 0;
  let participantsMap  = new Map();
  let winnersList      = [];
  let wheelAngle       = 0;
  let audioCtx         = null;
  let spinSoundNode    = null;
  let isSidebarOpen    = true;

  /* ── Settings ── */
  let settings = {
    prize:           '',
    keyword:         '',
    numWinners:      1,
    subDuration:     0,
    subMultiplier:   1,
    followDuration:  0,
    subscribersOnly: false,
    confirmTime:     60,
    animation:       'wheel',
    spinTime:        5,
    maxParticipants: 500,
    soundEnabled:    true,
    volume:          0.5
  };

  const PLAN_LIMITS = {
    free:  { maxParticipants: 500,  animations: ['wheel'],               sound: true,  fullscreen: true  },
    pro:   { maxParticipants: 0,    animations: ['wheel','slot','roulette'], sound: true,  fullscreen: true  },
    elite: { maxParticipants: 0,    animations: ['wheel','slot','roulette'], sound: true,  fullscreen: true  }
  };

  const ANIM_LABELS = {
    wheel:    'Točak Sreće',
    slot:     'Slot Mašina',
    roulette: 'Neon Rulet'
  };

  const SLICE_COLORS = [
    '#53fc18','#9333ea','#06b6d4','#f59e0b','#ec4899',
    '#3b82f6','#10b981','#8b5cf6','#f43f5e','#eab308'
  ];

  /* ── Supabase init ── */
  if (window.supabase && supabaseUrl && supabaseAnonKey) {
    sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        storageKey
      }
    });
  }

  /* ════════════════════════════════════════
     INIT
  ════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', async () => {
    loadState();
    await checkAuth();
    setupSidebar();
    setupSettingsForm();
    setupListControls();
    setupFullscreen();
    setupMuteButton();
    initCanvasWheel();
    updateParticipantsUI();
    updateWinnersUI();
    refreshAll();
  });

  /* ════════════════════════════════════════
     STATE PERSISTENCE
  ════════════════════════════════════════ */
  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        settings,
        participants: Array.from(participantsMap.entries()),
        winners: winnersList.map(w => ({ username: w.username, prize: w.prize, confirmSeconds: w.confirmSeconds, savedAt: Date.now() })),
        isRunning,
        wheelAngle
      }));
    } catch (e) { /* silent */ }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.settings) {
        settings = { ...settings, ...d.settings };
        if (settings.prize === 'Misteriozna Nagrada') settings.prize = '';
      }
      if (d.participants)  participantsMap = new Map(d.participants);
      if (d.winners)       winnersList = d.winners.map(w => {
        const elapsed = w.savedAt ? Math.floor((Date.now() - w.savedAt) / 1000) : 0;
        return { username: w.username, prize: w.prize, confirmSeconds: Math.max(0, (w.confirmSeconds || settings.confirmTime) - elapsed), timerId: null };
      });
      if (typeof d.wheelAngle === 'number') wheelAngle = d.wheelAngle;
      if (d.isRunning) isRunning = false; // safety
      restoreFormInputs();
      winnersList.forEach(w => { if (w.confirmSeconds > 0) startWinnerTimer(w); });
    } catch (e) { /* silent */ }
  }

  function restoreFormInputs() {
    setVal('inputPrize',          settings.prize || '');
    setVal('inputKeyword',        settings.keyword);
    setVal('inputNumWinners',     settings.numWinners);
    setVal('inputSubDuration',    settings.subDuration);
    setVal('inputFollowDuration', settings.followDuration);
    setVal('inputConfirmTime',    settings.confirmTime);
    setVal('inputMaxParticipants',settings.maxParticipants);
    setVal('inputSpinTime',       settings.spinTime);
    setVal('inputVolume',         Math.round(settings.volume * 100));
    setChecked('toggleSubscribersOnly', settings.subscribersOnly);
    setChecked('toggleSound',          settings.soundEnabled);
    selectAnimation(settings.animation);
    updateSpinTimeLabel();
    updateVolumeLabel();
    document.querySelectorAll('#multiplierChipsContainer .sc-chip').forEach(chip => {
      chip.classList.toggle('active', parseInt(chip.dataset.mult, 10) === settings.subMultiplier);
    });
  }

  /* ════════════════════════════════════════
     AUTH + PLAN
  ════════════════════════════════════════ */
  async function checkAuth() {
    if (!sb) {
      setMsg('authGateMsg', 'Preusmeravanje na prijavu...');
      setTimeout(() => { window.location.href = '../index.html?login=1'; }, 1200);
      return;
    }
    try {
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
        || (currentUser.email || '');
      let avatarUrl = currentUser.user_metadata?.avatar_url
        || currentUser.user_metadata?.picture
        || currentUser.user_metadata?.profile_picture;

      try {
        const { data: profile } = await sb.from('user_profiles')
          .select('*').eq('id', currentUser.id).maybeSingle();

        if (profile) {
          /* Plan tier from Supabase user_profiles (column: plan) */
          const rawPlan = (profile.plan || profile.plan_tier || 'free').toLowerCase();
          let tier = 'free';
          if (rawPlan.includes('elite')) tier = 'elite';
          else if (rawPlan.includes('pro')) tier = 'pro';
          userPlan = tier;

          /* Channel */
          if (profile.kick_channels?.length > 0) {
            const savedId   = localStorage.getItem('kickbot_selected_channel_id');
            const savedName = localStorage.getItem('kickbot_selected_channel_name');
            const selected  = profile.kick_channels.find(c =>
              String(c.id) === String(savedId) || c.username?.toLowerCase() === savedName?.toLowerCase()
            );
            const primary   = selected || profile.kick_channels.find(c => c.is_primary) || profile.kick_channels[0];
            if (primary.username) username  = primary.username;
            if (primary.avatar)   avatarUrl = primary.avatar;
            if (primary.chatroom_id) chatroomId = primary.chatroom_id;
          }
          if (!username && profile.display_name) username = profile.display_name;
        }
      } catch (e) { /* silent */ }

      channelName = cleanUsername(username);
      updateProfileUI(channelName, avatarUrl);
      applyPlanRestrictions();

      setText('connectedChannelName', channelName || 'DemoKanal');
      if (channelName) await resolveKickChatroom(channelName);

      dismissAuthGate();
    } catch (err) {
      setMsg('authGateMsg', 'Preusmeravanje na prijavu...');
      setTimeout(() => { window.location.href = '../index.html?login=1'; }, 1200);
    }
  }

  function applyPlanRestrictions() {
    const limits = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;

    /* Plan badges */
    const planBadgeEl    = document.getElementById('planBadge');
    const heroPlanBadge  = document.getElementById('heroPlanBadge');
    const userPlanLabel  = document.getElementById('userPlanLabel');
    const planClass      = 'plan-' + userPlan;
    const planText       = userPlan.toUpperCase();

    if (planBadgeEl)   { planBadgeEl.textContent = planText; planBadgeEl.className = 'sidebar-plan-badge ' + planClass; }
    if (heroPlanBadge) { heroPlanBadge.textContent = planText; heroPlanBadge.className = 'hero-plan-badge ' + planClass; }

    /* Animation lock */
    const animLock = document.getElementById('animationLock');
    const animSelect = document.getElementById('selectAnimation');
    if (animLock) animLock.style.display = userPlan === 'free' ? 'inline-flex' : 'none';
    if (animSelect) {
      Array.from(animSelect.options).forEach(opt => {
        opt.disabled = !limits.animations.includes(opt.value);
      });
      if (!limits.animations.includes(settings.animation)) {
        settings.animation = 'wheel';
        animSelect.value = 'wheel';
      }
    }

    /* Max participants lock */
    const mpLock = document.getElementById('maxParticipantsLock');
    const mpInput = document.getElementById('inputMaxParticipants');
    if (mpLock) mpLock.style.display = userPlan === 'free' ? 'inline-flex' : 'none';
    if (mpInput) {
      if (userPlan === 'free') {
        mpInput.max = 500;
        if (settings.maxParticipants > 500) {
          settings.maxParticipants = 500;
          mpInput.value = 500;
        }
      } else {
        mpInput.max = 10000;
      }
    }

    /* Sound lock */
    const soundLock = document.getElementById('soundLock');
    const soundToggleRow = document.getElementById('soundToggleRow');
    const volumeGroup = document.getElementById('volumeGroup');
    if (soundLock) soundLock.style.display = limits.sound ? 'none' : 'inline-flex';
    if (!limits.sound) {
      settings.soundEnabled = false;
      if (soundToggleRow) soundToggleRow.style.opacity = '0.4';
      if (volumeGroup)    volumeGroup.style.opacity = '0.4';
      const toggleSound = document.getElementById('toggleSound');
      if (toggleSound) { toggleSound.checked = false; toggleSound.disabled = true; }
    }

    /* Fullscreen button */
    const fsBtn = document.getElementById('btnOpenFullscreen');
    if (fsBtn) {
      if (!limits.fullscreen) {
        fsBtn.title = 'Fullscreen je dostupan na PRO ili ELITE planu';
        fsBtn.style.opacity = '0.35';
        fsBtn.style.cursor = 'not-allowed';
        fsBtn.disabled = true;
      }
    }
  }

  function dismissAuthGate() {
    const gate = document.getElementById('authGate');
    if (gate) { gate.classList.add('fade-out'); setTimeout(() => { gate.style.display = 'none'; }, 450); }
    document.body.classList.remove('auth-loading');
  }

  /* ════════════════════════════════════════
     SIDEBAR
  ════════════════════════════════════════ */
  function setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const app = document.getElementById('app');
    const btn = document.getElementById('btnSidebarToggle');

    bindClick('btnStartGiveaway', toggleStart);
    bindClick('btnDrawWinner',    triggerDraw);
    bindClick('btnResetGiveaway', resetGiveaway);
    bindClick('btnStageDraw',     triggerDraw);

    // Exclusive sidebar accordion (max 1 open at a time, first open by default)
    const accordions = Array.from(document.querySelectorAll('.sidebar-config details.sc-accordion'));
    accordions.forEach((acc, idx) => {
      acc.open = (idx === 0);
      acc.addEventListener('toggle', () => {
        if (acc.open) {
          accordions.forEach(other => {
            if (other !== acc) other.open = false;
          });
        }
      });
    });

    const isNarrow = () => window.innerWidth <= 1024;

    if (isNarrow()) {
      sidebar.classList.remove('is-open');
      isSidebarOpen = false;
    }

    if (btn) btn.addEventListener('click', () => {
      isSidebarOpen = !isSidebarOpen;
      if (isNarrow()) {
        sidebar.classList.toggle('is-open', isSidebarOpen);
      } else {
        if (isSidebarOpen) {
          app.style.gridTemplateColumns = 'var(--sidebar-w) 1fr';
          sidebar.style.display = '';
        } else {
          app.style.gridTemplateColumns = '0 1fr';
          sidebar.style.display = 'none';
        }
      }
    });

    // Logout dugme je sad unutar dropdown-a
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout && sb) {
      btnLogout.addEventListener('click', async (e) => {
        e.stopPropagation();
        await sb.auth.signOut();
        window.location.href = '../index.html';
      });
    }

    // Zatvori meni kliknuti van
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('userMenuSm');
      const pill = document.getElementById('userPill');
      if (menu && pill && !pill.contains(e.target)) {
        menu.classList.remove('open');
      }
    });
  }

  /* toggleUserMenu — globalna, poziva se iz onclick u HTML-u */
  window.toggleUserMenu = function () {
    const menu = document.getElementById('userMenuSm');
    if (menu) menu.classList.toggle('open');
  };

  /* Notifikacije */
  window.toggleNotifCenter = function () {
    const pop = document.getElementById('notifPopover');
    if (pop) pop.classList.toggle('open');
  };

  window.markAllNotifsAsRead = function () {
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'none';
    const list = document.getElementById('notifContentList');
    if (list) list.innerHTML = '<div class="notif-empty">Nema novih obaveštenja.</div>';
    window.toastSystem.info('Sva obaveštenja označena kao pročitana.');
  };

  window.switchNotifTab = function (tabId) {
    const btn1 = document.getElementById('notifTabObavestenja');
    const btn2 = document.getElementById('notifTabChangelog');
    if (btn1) btn1.classList.toggle('active', tabId === 'obavestenja');
    if (btn2) btn2.classList.toggle('active', tabId === 'changelog');
    
    const list = document.getElementById('notifContentList');
    if (!list) return;

    if (tabId === 'obavestenja') {
      list.innerHTML = '<div class="notif-empty">Nema novih obaveštenja.</div>';
    } else {
      list.innerHTML = `
        <div style="padding: 10px; color: var(--aj-text); font-size: 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.06);">
          <strong style="color: var(--aj-green);">v3.0 - Redizajn</strong><br>
          - Novi Kickot-stil dizajn<br>
          - Integracija Plan sistema (Free/Pro/Elite)<br>
          - Unapređene animacije točka<br>
          - Web Audio API efekti
        </div>
      `;
    }
  };

  // Zatvaranje popovera na klik izvan njega
  document.addEventListener('click', (e) => {
    const pop = document.getElementById('notifPopover');
    const btn = document.getElementById('notifBellBtn');
    if (pop && btn && !pop.contains(e.target) && !btn.contains(e.target)) {
      pop.classList.remove('open');
    }
  });

  window.refreshDatabase = async function() {
    const btnEl = document.querySelector('.topbar-refresh-btn');
    const svgEl = btnEl ? btnEl.querySelector('svg') : null;
    if (svgEl) svgEl.style.animation = 'spin 1s linear infinite';
    try {
      await checkAuth();
      window.toastSystem.success('Podaci uspesno osvezeni iz baze.');

      // Prebaci na zeleni štiklić
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
      window.toastSystem.error('Greška pri osvezavanju podataka.');
      if (svgEl) svgEl.style.animation = '';
    }
  };

  /* ════════════════════════════════════════
     PROFILE UI
  ════════════════════════════════════════ */
  function updateProfileUI(username, avatarUrl) {
    const nameEl   = document.getElementById('userNameDisplay');
    const avatarEl = document.getElementById('userAvatarDisplay');
    const clean    = cleanUsername(username);
    if (nameEl) nameEl.textContent = clean;
    if (avatarEl) {
      if (avatarUrl?.startsWith('http')) {
        avatarEl.style.backgroundImage = `url('${avatarUrl}')`;
        avatarEl.style.backgroundSize  = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.textContent = '';
      } else {
        avatarEl.style.backgroundImage = '';
        // Zadrzi gradient pozadinu iz CSS-a
        avatarEl.style.backgroundColor = '';
        avatarEl.textContent = clean.charAt(0).toUpperCase();
      }
    }
  }

  /* ════════════════════════════════════════
     SETTINGS FORM
  ════════════════════════════════════════ */
  function setupSettingsForm() {
    bindInput('inputPrize', 'input', (v) => {
      settings.prize = v.trim() || 'Misteriozna Nagrada';
      refreshAll();
    }, { maxLen: 45 });

    bindInput('inputKeyword', 'input', (v) => {
      settings.keyword = v.trim();
      refreshAll();
    }, { maxLen: 25 });

    bindInput('inputNumWinners', 'change', (v) => {
      settings.numWinners = Math.min(20, Math.max(1, parseInt(v, 10) || 1));
      setVal('inputNumWinners', settings.numWinners);
      refreshAll();
    });

    bindInput('inputSubDuration', 'change', (v) => {
      settings.subDuration = Math.min(60, Math.max(0, parseInt(v, 10) || 0));
      setVal('inputSubDuration', settings.subDuration);
      refreshAll();
    });

    bindInput('inputFollowDuration', 'change', (v) => {
      settings.followDuration = Math.min(365, Math.max(0, parseInt(v, 10) || 0));
      setVal('inputFollowDuration', settings.followDuration);
      refreshAll();
    });

    bindInput('inputConfirmTime', 'change', (v) => {
      settings.confirmTime = Math.min(300, Math.max(5, parseInt(v, 10) || 30));
      setVal('inputConfirmTime', settings.confirmTime);
      refreshAll();
    });

    const handleMaxPart = (v) => {
      const limits = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
      let val = Math.max(0, parseInt(v, 10) || 0);
      if (limits.maxParticipants > 0) {
        val = Math.min(limits.maxParticipants, val);
      }
      settings.maxParticipants = val;
      refreshAll();
    };

    bindInput('inputMaxParticipants', 'input', handleMaxPart);
    bindInput('inputMaxParticipants', 'change', (v) => {
      handleMaxPart(v);
      setVal('inputMaxParticipants', settings.maxParticipants);
    });

    const spinNum = document.getElementById('inputSpinTimeNum');
    bindInput('inputSpinTime', 'input', (v) => {
      settings.spinTime = Math.min(300, Math.max(1, parseInt(v, 10) || 5));
      if (spinNum) spinNum.value = settings.spinTime;
      updateSpinTimeLabel();
      setText('statSpinTime', formatSpinTime(settings.spinTime));
      saveState();
    });

    if (spinNum) {
      spinNum.addEventListener('input', (e) => {
        let val = Math.min(300, Math.max(1, parseInt(e.target.value, 10) || 1));
        settings.spinTime = val;
        setVal('inputSpinTime', val);
        updateSpinTimeLabel();
        setText('statSpinTime', formatSpinTime(settings.spinTime));
        saveState();
      });
    }

    bindInput('inputVolume', 'input', (v) => {
      settings.volume = parseInt(v, 10) / 100;
      updateVolumeLabel();
      saveState();
    });

    const toggleSub = document.getElementById('toggleSubscribersOnly');
    if (toggleSub) toggleSub.addEventListener('change', (e) => { settings.subscribersOnly = e.target.checked; refreshAll(); });

    const toggleSound = document.getElementById('toggleSound');
    if (toggleSound) toggleSound.addEventListener('change', (e) => {
      const limits = PLAN_LIMITS[userPlan];
      if (!limits.sound) { e.target.checked = false; showToast('Zvuk je dostupan na PRO ili ELITE planu.', 'warning'); return; }
      settings.soundEnabled = e.target.checked;
      saveState();
    });

    const animSelect = document.getElementById('selectAnimation');
    if (animSelect) animSelect.addEventListener('change', (e) => {
      const limits = PLAN_LIMITS[userPlan];
      if (!limits.animations.includes(e.target.value)) {
        e.target.value = settings.animation;
        showToast('Ova animacija nije dostupna na vasem planu.', 'warning');
        return;
      }
      settings.animation = e.target.value;
      selectAnimation(settings.animation);
      refreshAll();
    });

    // Multiplier chips
    document.querySelectorAll('#multiplierChipsContainer .sc-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#multiplierChipsContainer .sc-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        settings.subMultiplier = parseInt(chip.dataset.mult, 10) || 1;
        setText('statSubMultiplierDisplay', `${settings.subMultiplier}x`);
        refreshAll();
      });
    });

    // Test dugme (Start/Draw/Reset se vezuju jednom u setupSidebar, ne ovde — dupli bind je pravio dvostruko okidanje)
    bindClick('btnTestMessage', addTestParticipant);
  }

  function selectAnimation(anim) {
    const select = document.getElementById('selectAnimation');
    if (select) select.value = anim;
    settings.animation = anim;
    updateStageFrames();
    drawVisualizerStage();
  }

  function updateSpinTimeLabel() {
    setText('spinTimeLabelVal', formatSpinTime(settings.spinTime));
    setText('statSpinTime',    formatSpinTime(settings.spinTime));
  }

  function updateVolumeLabel() {
    setText('volumeLabelVal', `${Math.round(settings.volume * 100)}%`);
  }

  function formatSpinTime(sec) {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s === 0 ? `${m}min` : `${m}min ${s}s`;
  }

  /* ════════════════════════════════════════
     LIST CONTROLS
  ════════════════════════════════════════ */
  function setupListControls() {
    const searchInput = document.getElementById('inputSearchParticipants');
    if (searchInput) searchInput.addEventListener('input', () => updateParticipantsUI());

    bindClick('btnClearParticipants', () => {
      if (participantsMap.size === 0) return;
      if (!confirm('Da li ste sigurni da zelite da obrisete sve ucesnike?')) return;
      participantsMap.clear();
      updateParticipantsUI();
      drawVisualizerStage();
      refreshAll();
      showToast('Lista ucesnika je ociscena.', 'info');
    });

    bindClick('btnExportWinners', () => {
      if (winnersList.length === 0) { showToast('Nema pobednika za izvoz.', 'warning'); return; }
      const text = winnersList.map((w, i) => `${i + 1}. ${w.username} — ${w.prize}`).join('\n');
      navigator.clipboard.writeText(text)
        .then(() => showToast('Lista pobednika kopirana u clipboard!', 'success'))
        .catch(() => showToast(`Pobednici: ${text}`, 'info'));
    });
  }

  /* ════════════════════════════════════════
     MUTE BUTTON
  ════════════════════════════════════════ */
  function setupMuteButton() {
    const btn = document.getElementById('btnMuteSound');
    if (!btn) return;
    btn.addEventListener('click', () => {
      settings.soundEnabled = !settings.soundEnabled;
      const toggleSound = document.getElementById('toggleSound');
      if (toggleSound) toggleSound.checked = settings.soundEnabled;
      btn.classList.toggle('is-muted', !settings.soundEnabled);
      updateMuteIcon();
      saveState();
    });
    updateMuteIcon();
  }

  function updateMuteIcon() {
    const icon = document.getElementById('muteIcon');
    if (!icon) return;
    if (settings.soundEnabled) {
      icon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>`;
    } else {
      icon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <line x1="23" y1="9" x2="17" y2="15"/>
        <line x1="17" y1="9" x2="23" y2="15"/>`;
    }
  }

  /* ════════════════════════════════════════
     FULLSCREEN
  ════════════════════════════════════════ */
  function setupFullscreen() {
    bindClick('btnOpenFullscreen', openFullscreen);
    bindClick('btnCloseFullscreen', closeFullscreen);
    bindClick('wfoBtnStart', toggleStart);
    bindClick('wfoBtnDraw', triggerDraw);
    bindClick('wfoBtnReset', resetGiveaway);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const ov = document.getElementById('wheelFullscreenOverlay');
        if (ov && ov.style.display !== 'none') closeFullscreen();
      }
    });
  }

  window.openFullscreen  = openFullscreen;
  window.closeFullscreen = closeFullscreen;
  window.toggleStart     = toggleStart;
  window.triggerDraw     = triggerDraw;
  window.resetGiveaway   = resetGiveaway;

  window.openModal = function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('closing');
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  window.closeModal = function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('closing');
    setTimeout(() => {
      el.classList.remove('open', 'closing');
      document.body.style.overflow = '';
    }, 220);
  };

  window.handleModalBg = function (e, id) {
    if (e.target === e.currentTarget) window.closeModal(id);
  };

  window.openReferralModal = function () { window.openModal('referralModal'); };
  window.openFeedbackModal = function () { window.openModal('feedbackModal'); };
  window.openHelpModal     = function () { window.openModal('helpModal'); };
  window.openDocsModal     = function () { window.openModal('docsModal'); };
  window.openSettingsModal = function () { window.openModal('settingsModal'); };

  window.submitFeedback = function () {
    const txt = (document.getElementById('feedbackText')?.value || '').trim();
    if (!txt) { showToast('Unesite vaš predlog ili ideju.', 'warning'); return; }
    window.closeModal('feedbackModal');
    if (document.getElementById('feedbackText')) document.getElementById('feedbackText').value = '';
    showToast('Hvala na predlogu! Uspešno ste poslali ideju.', 'success');
  };

  window.handleSignOut = async function () {
    if (sb) { try { await sb.auth.signOut(); } catch (e) { /* */ } }
    window.location.href = '../index.html';
  };

  function openFullscreen() {
    const limits = PLAN_LIMITS[userPlan];
    if (!limits.fullscreen) { showToast('Fullscreen je dostupan na PRO ili ELITE planu.', 'warning'); return; }

    const ov = document.getElementById('wheelFullscreenOverlay');
    if (!ov) return;
    ov.style.display = 'flex';
    void ov.offsetWidth; // force reflow for smooth animation
    ov.classList.add('open');
    ov.removeAttribute('aria-hidden');

    setText('wfoPrizeText',        settings.prize || 'Misteriozna Nagrada');
    setText('wfoChannelName',      channelName || 'Kanal');
    setText('wfoParticipantCount', participantsMap.size);
    setText('wfoWinnersCount',     winnersList.length);

    // Prikazi ispravan stage (tocak/slot/rulet) i iscrtaj ga, umesto da uvek forsira tocak
    updateStageFrames();
    if (settings.animation === 'wheel')          drawWheelOnCanvas('wheelCanvasFullscreen');
    else if (settings.animation === 'slot')      drawSlotPreview();
    else if (settings.animation === 'roulette')  drawRoulettePreview();

    updateFullscreenStateBadge();
    updateActionStates();
  }

  function closeFullscreen() {
    const ov = document.getElementById('wheelFullscreenOverlay');
    if (ov) {
      ov.classList.remove('open');
      ov.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        if (!ov.classList.contains('open')) ov.style.display = 'none';
      }, 300);
    }
  }

  function updateFullscreenStateBadge() {
    const badge = document.getElementById('wfoStateBadge');
    if (!badge) return;
    badge.className = 'wfo-state-badge';
    if (isSpinning) { badge.textContent = 'Izvlacenje u toku'; badge.classList.add('is-spinning'); }
    else if (isRunning) { badge.textContent = 'Cekam sledece izvlacenje'; badge.classList.add('is-live'); }
    else { badge.textContent = 'Standby'; }
  }

  /* ════════════════════════════════════════
     WEB AUDIO — Sound System
  ════════════════════════════════════════ */
  function getAudioCtx() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function getVolume() {
    return settings.soundEnabled ? Math.max(0, Math.min(1, settings.volume)) : 0;
  }

  function playSoundSpin(durationMs) {
    if (!settings.soundEnabled || !getVolume()) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    stopSpinSound();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(getVolume() * 0.25, ctx.currentTime);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    // Pitch decreases as spin slows down
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + durationMs / 1000);
    gain.gain.setTargetAtTime(0, ctx.currentTime + durationMs / 1000 * 0.85, 0.1);

    osc.connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durationMs / 1000 + 0.15);
    spinSoundNode = osc;
  }

  function stopSpinSound() {
    if (spinSoundNode) {
      try { spinSoundNode.stop(); } catch (e) { /* already stopped */ }
      spinSoundNode = null;
    }
  }

  function playSoundChamp() {
    if (!getVolume()) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98]; // C5 E5 G5 C6 E6 G6
    notes.forEach((freq, i) => {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.09);
      gain.gain.linearRampToValueAtTime(getVolume() * 0.45, ctx.currentTime + i * 0.09 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.09 + 0.7);
      gain.connect(ctx.destination);

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.09);
      osc.connect(gain);
      osc.start(ctx.currentTime + i * 0.09);
      osc.stop(ctx.currentTime + i * 0.09 + 0.75);
    });
  }

  function playSoundWin() {
    if (!getVolume()) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.12);
      gain.gain.linearRampToValueAtTime(getVolume() * 0.35, ctx.currentTime + i * 0.12 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.5);
      gain.connect(ctx.destination);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
      osc.connect(gain);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.55);
    });
  }

  function playSoundTick() {
    if (!settings.soundEnabled || !getVolume()) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(getVolume() * 0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.07);
  }

  /* ════════════════════════════════════════
     KICK WEBSOCKET
  ════════════════════════════════════════ */
  async function resolveKickChatroom(slug) {
    if (!slug) return;
    let s = String(slug).trim().toLowerCase().replace(/^https?:\/\/(www\.)?kick\.com\//, '').replace(/\/$/, '');
    if (/^\d+$/.test(s)) { chatroomId = parseInt(s, 10); return; }

    const proxies = [
      `https://kick.com/api/v2/channels/${s}`,
      `https://api.allorigins.win/get?url=${encodeURIComponent(`https://kick.com/api/v2/channels/${s}`)}`,
      `https://corsproxy.io/?${encodeURIComponent(`https://kick.com/api/v2/channels/${s}`)}`
    ];

    for (const url of proxies) {
      try {
        const res  = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) continue;
        const text = await res.text();
        let data   = null;
        try { data = JSON.parse(text); if (data?.contents) data = JSON.parse(data.contents); } catch (e) { /* */ }
        const id = data?.chatroom?.id || data?.chatroom_id;
        if (id) { chatroomId = parseInt(id, 10); return; }
        const m = text.match(/"chatroom":\s*\{\s*"id":\s*(\d+)/i) || text.match(/"chatroom_id":\s*(\d+)/i);
        if (m?.[1]) { chatroomId = parseInt(m[1], 10); return; }
      } catch (e) { /* */ }
    }
  }

  async function connectKickChat() {
    if (kickWebSocket) { try { kickWebSocket.close(); } catch (e) { /* */ } kickWebSocket = null; }
    if (!channelName) { showToast('Niste prijavljeni na Kick kanal!', 'warning'); return false; }

    showToast(`Povezivanje sa Kick chatom za kanal "${channelName}"...`, 'info');
    if (!chatroomId) await resolveKickChatroom(channelName);
    if (!chatroomId) { showToast(`Nije pronađen Chatroom ID za "${channelName}".`, 'error'); return false; }

    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { kickWebSocket?.close(); } catch (e) { /* */ }
          kickWebSocket = null;
          showToast('Konekcija sa Kick chatom je istekla.', 'error');
          resolve(false);
        }
      }, 10000);

      try { kickWebSocket = new WebSocket('wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.5.0&flash=false'); }
      catch (e) { clearTimeout(timeout); showToast('Gre\u0161ka pri kreiranju WebSocket konekcije.', 'error'); resolve(false); return; }

      kickWebSocket.onopen = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        kickWebSocket.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${chatroomId}.v2` } }));
        kickWebSocket.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${chatroomId}` } }));
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
          if (kickWebSocket?.readyState === WebSocket.OPEN) kickWebSocket.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
        }, 25000);
        showToast(`Uspešno povezan chat za kanal: ${channelName}`, 'success');
        resolve(true);
      };

      kickWebSocket.onerror = () => { if (!resolved) { resolved = true; clearTimeout(timeout); showToast('Smetnje pri povezivanju sa Kick live chatom.', 'error'); resolve(false); } };

      kickWebSocket.onclose = () => {
        if (pingInterval) clearInterval(pingInterval);
        if (!resolved) { resolved = true; clearTimeout(timeout); resolve(false); }
        else if (isRunning) { isRunning = false; updateStartButtonUI(); refreshAll(); showToast('Veza sa Kick chatom je prekinuta.', 'warning'); }
      };

      kickWebSocket.onmessage = (event) => {
        try {
          const d = JSON.parse(event.data);
          if ((d.event || '').includes('ChatMessage')) {
            const payload = typeof d.data === 'string' ? JSON.parse(d.data) : d.data;
            const sender  = payload?.sender?.username || payload?.sender?.slug || payload?.username;
            const text    = payload?.content || payload?.message;
            if (sender && text) {
              const badges = payload?.sender?.identity?.badges || payload?.sender?.badges || payload?.badges || [];
              const isSub  = Array.isArray(badges) && badges.some(b => { const t = (typeof b === 'string' ? b : b.type || '').toLowerCase(); return t.includes('sub') || t.includes('founder'); });
              processChatMessage({ username: sender, isSub, message: text });
            }
          }
        } catch (e) { /* */ }
      };
    });
  }

  /* ════════════════════════════════════════
     GIVEAWAY CONTROL
  ════════════════════════════════════════ */
  async function toggleStart() {
    if (isConnecting) return;
    if (isRunning) {
      isRunning = false;
      try { kickWebSocket?.close(); } catch (e) { /* */ }
      kickWebSocket = null;
      updateStartButtonUI();
      showToast('Prijave iz chata su pauzirane.', 'info');
    } else {
      isConnecting = true;
      const btn = document.getElementById('btnStartGiveaway');
      if (btn) { btn.disabled = true; btn.innerHTML = '<span>Povezivanje...</span>'; }

      const ok = await connectKickChat();
      isConnecting = false;
      if (btn) btn.disabled = false;

      if (ok) {
        isRunning = true;
        showToast(`Giveaway počeo! Nagrada: ${settings.prize || 'Misteriozna Nagrada'}`, 'success');
      } else {
        isRunning = false;
        showToast('Giveaway NIJE pokrenut jer chat nije povezan.', 'error');
      }
      updateStartButtonUI();
    }
    drawVisualizerStage();
    refreshAll();
  }

  function updateStartButtonUI() {
    const btn = document.getElementById('btnStartGiveaway');
    if (!btn) return;
    if (isRunning) {
      btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>Pauziraj giveaway</span>`;
      btn.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
      btn.style.color = '#07050f';
    } else {
      btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Pokreni giveaway</span>`;
      btn.style.background = 'linear-gradient(135deg, #53fc18, #3de810)';
      btn.style.color = '#07050f';
    }
  }

  function addTestParticipant() {
    if (!isRunning) {
      showToast('Giveaway nije aktivan! Kliknite "Pokreni giveaway" da biste omogućili prijavu.', 'warning');
      return;
    }
    const names   = ['Gamer_SRB','KickMaster99','BalkanStreamer','Legendara','CoolViewer','Watcher_42','TopFan','LiveKing'];
    const name    = names[Math.floor(Math.random() * names.length)] + '_' + Math.floor(Math.random() * 90 + 10);
    const isSub   = Math.random() > 0.4;
    const kw      = settings.keyword ? settings.keyword + ' ' : '';
    processChatMessage({ username: name, isSub, message: kw + 'test' }, true);
    showToast(`Test prijava: ${name} (${isSub ? 'SUB' : 'FREE'})`, 'info');
  }

  function processChatMessage(user, isTest = false) {
    if (!isRunning) return;

    if (settings.keyword && !user.message.toLowerCase().includes(settings.keyword.toLowerCase())) return;
    if (settings.subscribersOnly && !user.isSub) return;

    const key = user.username.toLowerCase();
    if (participantsMap.has(key)) return;

    /* Max participants check */
    const limits = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
    let effectiveMax = 0;
    if (limits.maxParticipants > 0 && settings.maxParticipants > 0) {
      effectiveMax = Math.min(settings.maxParticipants, limits.maxParticipants);
    } else if (limits.maxParticipants > 0) {
      effectiveMax = limits.maxParticipants;
    } else if (settings.maxParticipants > 0) {
      effectiveMax = settings.maxParticipants;
    }

    if (effectiveMax > 0 && participantsMap.size >= effectiveMax) {
      if (isTest) showToast(`Dostignut limit od ${effectiveMax} učesnika.`, 'warning');
      return;
    }

    participantsMap.set(key, { username: user.username, isSub: user.isSub, mult: user.isSub ? settings.subMultiplier : 1 });
    updateParticipantsUI();
    drawVisualizerStage();
    triggerFullscreenParticipantPopin(user);
    refreshAll();
  }

  function triggerFullscreenParticipantPopin(user) {
    const feed = document.getElementById('wfoLiveFeed');
    if (!feed) return;
    const item = document.createElement('div');
    item.className = 'wfo-participant-popin';
    item.innerHTML = `
      <div class="popin-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        </svg>
      </div>
      <div><span>${escHtml(user.username)}</span></div>
      ${user.isSub ? '<span class="popin-sub-badge">SUB</span>' : ''}`;
    feed.appendChild(item);
    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transition = 'opacity 0.4s';
      setTimeout(() => item.remove(), 400);
    }, 3500);
  }

  function resetGiveaway() {
    isRunning = false;
    isSpinning = false;
    stopSpinSound();
    try { kickWebSocket?.close(); } catch (e) { /* */ }
    kickWebSocket = null;
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
    participantsMap.clear();
    winnersList.forEach(w => { if (w.timerId) clearInterval(w.timerId); });
    winnersList = [];
    wheelAngle  = 0;
    settings.prize = '';
    setVal('inputPrize', '');
    updateStartButtonUI();
    localStorage.removeItem(STATE_KEY);
    updateParticipantsUI();
    updateWinnersUI();
    drawVisualizerStage();
    refreshAll();
    showToast('Giveaway je uspešno resetovan.', 'success');
  }

  /* ════════════════════════════════════════
     PARTICIPANTS UI
  ════════════════════════════════════════ */
  function updateParticipantsUI() {
    const container  = document.getElementById('participantsListContainer');
    const total      = participantsMap.size;
    const search     = (document.getElementById('inputSearchParticipants')?.value || '').trim().toLowerCase();

    setText('statParticipantsCount',   total);
    setText('badgeParticipantsCount',  total);
    setText('wfoParticipantCount',     total);

    if (!container) return;
    if (total === 0) { container.innerHTML = '<div class="list-empty">Prijavljeni učesnici će se pojaviti ovde.</div>'; return; }

    let html = '';
    let shown = 0;
    participantsMap.forEach((p, key) => {
      if (search && !p.username.toLowerCase().includes(search)) return;
      shown++;
      html += `
        <div class="participant-row">
          <div class="participant-user"><span>${escHtml(p.username)}</span></div>
          <div class="participant-badges">
            ${p.isSub ? '<span class="sub-badge">SUB</span>' : ''}
            <span class="mult-badge">${p.mult}x</span>
            <button class="participant-remove-btn" onclick="window.removeParticipant('${escHtml(key)}')" title="Ukloni">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>`;
    });

    container.innerHTML = shown === 0 && search
      ? `<div class="list-empty">Nema učesnika koji odgovaraju pretrazi.</div>`
      : html;
  }

  window.removeParticipant = function (key) {
    if (!participantsMap.has(key)) return;
    const p = participantsMap.get(key);
    participantsMap.delete(key);
    updateParticipantsUI();
    drawVisualizerStage();
    refreshAll();
    showToast(`Učesnik ${p.username} je uklonjen.`, 'info');
  };

  /* ════════════════════════════════════════
     WINNERS UI
  ════════════════════════════════════════ */
  function addWinner(username) {
    const remainingBefore = participantsMap.size;
    const isTop5 = remainingBefore <= 5;
    const isFinalChamp = remainingBefore === 1; // Poslednji preostali ucesnik!
    
    const prizeName = settings.prize || 'Misteriozna Nagrada';
    const w = { username, prize: prizeName, confirmSeconds: settings.confirmTime, timerId: null };
    winnersList.unshift(w);
    updateWinnersUI();
    startWinnerTimer(w);
    
    if (isFinalChamp) {
      playSoundChamp();
    } else {
      playSoundWin();
    }
    
    showWinnerOverlay(username, prizeName, settings.confirmTime, isTop5, isFinalChamp);
  }

  /* ── Winner Reveal Overlay ── */
  let overlayTimerId = null;
  let particleAnimId = null;

  function showWinnerOverlay(username, prize, confirmSec, isTop5, isFinalChamp) {
    const ov   = document.getElementById('winnerRevealOverlay');
    const name = document.getElementById('winnerRevealName');
    const pt   = document.getElementById('winnerRevealPrizeText');
    const fill = document.getElementById('winnerRevealTimerFill');
    const lbl  = document.getElementById('winnerRevealTimerLabel');
    const top5Badge = document.getElementById('winnerTop5Badge');
    if (!ov) return;

    const winnerUser = (username || 'Pobednik').trim();
    if (name) {
      name.textContent = winnerUser.startsWith('@') ? winnerUser : '@' + winnerUser;
      name.style.display = 'block';
      name.style.visibility = 'visible';
      name.style.opacity = '1';
      name.style.color = '#ffffff';
    }
    if (pt) pt.textContent = prize || 'Misteriozna Nagrada';
    if (lbl) lbl.textContent = `${confirmSec}s za potvrdu`;
    if (fill) fill.style.width = '100%';

    if (top5Badge) {
      if (isFinalChamp) top5Badge.textContent = '🏆 KONAČNI ŠAMPION 🏆';
      else if (isTop5)  top5Badge.textContent = 'TOP 5 POBEDNIK';
      else              top5Badge.textContent = 'POBEDNIK GIVEAWAYA';
    }

    ov.classList.remove('is-top5', 'is-final-champ', 'open');
    void ov.offsetWidth; // reflow
    if (isFinalChamp) ov.classList.add('is-final-champ');
    else if (isTop5)  ov.classList.add('is-top5');
    ov.classList.add('open');

    // Timer bar animacija
    if (overlayTimerId) { clearInterval(overlayTimerId); overlayTimerId = null; }
    let rem = confirmSec;
    const tick = () => {
      rem--;
      const pct = Math.max(0, (rem / confirmSec) * 100);
      if (fill) fill.style.width = pct + '%';
      if (lbl)  lbl.textContent  = rem > 0 ? `${rem}s za potvrdu` : 'Vreme isteklo';
      if (rem <= 0) { clearInterval(overlayTimerId); overlayTimerId = null; }
    };
    overlayTimerId = setInterval(tick, 1000);

    // Partikule
    startParticles(isTop5, isFinalChamp);

    // ESC zatvara
    const onKey = (e) => { if (e.key === 'Escape') { window.closeWinnerOverlay(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  }

  window.closeWinnerOverlay = function () {
    const ov = document.getElementById('winnerRevealOverlay');
    if (ov) { ov.classList.remove('open'); }
    if (overlayTimerId) { clearInterval(overlayTimerId); overlayTimerId = null; }
    stopParticles();
  };

  /* ── Canvas Particle System ── */
  /* ── Canvas Particle System (3D Fluttering Random Confetti) ── */
  function startParticles(isTop5, isFinalChamp) {
    stopParticles();
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);

    const colors = isFinalChamp
      ? ['#ffd700', '#ff8c00', '#ec4899', '#53fc18', '#06b6d4', '#ffffff', '#c084fc']
      : (isTop5
        ? ['#f59e0b','#fbbf24','#fcd34d','#ec4899','#f43f5e','#ffffff']
        : ['#53fc18','#06b6d4','#9333ea','#ffffff','#53fc18','#3de810']);

    const particles = [];
    const count = isFinalChamp ? 220 : (isTop5 ? 140 : 80);

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height, // staggered random y
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 3 + 2,
        w: Math.random() * 8 + 6,
        h: Math.random() * 6 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.1,
        flip: Math.random() * Math.PI * 2,
        flipSpeed: Math.random() * 0.08 + 0.03,
        oscFreq: Math.random() * 0.03 + 0.01
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.flip += p.flipSpeed;
        p.rotation += p.rotSpeed;
        p.x += p.vx + Math.sin(p.y * p.oscFreq) * 1.2;
        p.y += p.vy;

        if (p.y > canvas.height + 20) {
          p.y = -20 - Math.random() * 100; // staggered reset
          p.x = Math.random() * canvas.width;
          p.vy = Math.random() * 3 + 2;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.scale(Math.cos(p.flip), 1); // 3D flip effect
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      particleAnimId = requestAnimationFrame(draw);
    };
    particleAnimId = requestAnimationFrame(draw);
  }

  function stopParticles() {
    if (particleAnimId) { cancelAnimationFrame(particleAnimId); particleAnimId = null; }
    const canvas = document.getElementById('particleCanvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }


  function startWinnerTimer(w) {
    if (w.timerId) clearInterval(w.timerId);
    w.timerId = setInterval(() => {
      w.confirmSeconds--;
      updateSingleWinnerTimerUI(w);
      saveState();
      if (w.confirmSeconds <= 0) clearInterval(w.timerId);
    }, 1000);
  }

  function updateSingleWinnerTimerUI(w) {
    const cleanId = String(w.username).replace(/[^a-zA-Z0-9_-]/g, '');
    const timerEl = document.getElementById(`w-timer-${cleanId}`);
    const barEl   = document.getElementById(`w-bar-${cleanId}`);
    if (timerEl) timerEl.textContent = w.confirmSeconds > 0 ? `${w.confirmSeconds}s` : 'Isteklo';
    if (barEl) {
      const pct = Math.max(0, (w.confirmSeconds / (settings.confirmTime || 60)) * 100);
      barEl.style.width = pct + '%';
    }
  }

  function updateWinnersUI() {
    const container = document.getElementById('winnersListContainer');
    const count     = winnersList.length;
    setText('statWinnersCount',  count);
    setText('badgeWinnersCount', count);
    setText('wfoWinnersCount',   count);

    if (!container) return;
    if (count === 0) { container.innerHTML = '<div class="list-empty">Pobednici će se pojaviti ovde nakon izvlačenja.</div>'; return; }

    const trophySvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--aj-amber)" stroke-width="2.5"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>`;
    const giftSvg   = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--aj-green)" stroke-width="2"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`;

    let html = '';
    winnersList.forEach(w => {
      const cleanId = String(w.username).replace(/[^a-zA-Z0-9_-]/g, '');
      const pct = Math.max(0, (w.confirmSeconds / (settings.confirmTime || 60)) * 100);
      html += `
        <div class="winner-card-item">
          <div class="winner-name-row">
            <div class="winner-name">${trophySvg}<span>${escHtml(w.username)}</span></div>
            <span class="winner-timer" id="w-timer-${cleanId}">${w.confirmSeconds > 0 ? `${w.confirmSeconds}s` : 'Isteklo'}</span>
          </div>
          <div class="winner-prize-tag">${giftSvg} <span>Nagrada: <strong>${escHtml(w.prize)}</strong></span></div>
          <div class="timer-bar-wrap"><div class="timer-bar-fill" id="w-bar-${cleanId}" style="width:${pct}%;"></div></div>
        </div>`;
    });
    container.innerHTML = html;
  }

  /* ════════════════════════════════════════
     VISUALIZER
  ════════════════════════════════════════ */
  function getPoolList() {
    const pool = [];
    participantsMap.forEach(p => { for (let i = 0; i < p.mult; i++) pool.push(p.username); });
    return pool;
  }

  function updateStageFrames() {
    const show = (id, vis) => { const el = document.getElementById(id); if (el) el.style.display = vis ? 'flex' : 'none'; };
    const isWheel = settings.animation === 'wheel';
    const isSlot  = settings.animation === 'slot';
    const isRoulette = settings.animation === 'roulette';

    // Dashboard stage
    show('wheelStageFrame',    isWheel);
    show('slotStageFrame',     isSlot);
    show('rouletteStageFrame', isRoulette);
    // Dugme "Izvuci pobednika" ispod stage-a — samo kad NIJE tocak (tocak se izvlaci klikom na njega)
    show('btnStageDraw', !isWheel);

    // Fullscreen stage (moze biti otvoren dok se tip menja)
    show('wfoWheelFrame',    isWheel);
    show('wfoSlotFrame',     isSlot);
    show('wfoRouletteFrame', isRoulette);
  }

  function drawVisualizerStage() {
    updateStageFrames();
    if (settings.animation === 'wheel') {
      drawWheelOnCanvas('wheelCanvas');
      drawWheelOnCanvas('wheelCanvasFullscreen');
    } else if (settings.animation === 'slot') {
      drawSlotPreview();
    } else if (settings.animation === 'roulette') {
      drawRoulettePreview();
    }
  }

  function initCanvasWheel() {
    const c1 = document.getElementById('wheelCanvas');
    const c2 = document.getElementById('wheelCanvasFullscreen');
    const f1 = document.getElementById('wheelStageFrame');
    [c1, c2, f1].forEach(c => {
      if (!c) return;
      c.style.cursor = 'pointer';
      c.title = 'Kliknite bilo gde na točak ili u sredinu da izvučete pobednika';
      c.onclick = (e) => {
        e.preventDefault();
        window.triggerDraw();
      };
    });
    drawVisualizerStage();
  }

  /* ── Wheel Draw ── */
  function drawWheelOnCanvas(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx    = canvas.getContext('2d');
    const W      = canvas.width;
    const H      = canvas.height;
    const cx     = W / 2;
    const cy     = H / 2;
    const r      = Math.min(W, H) / 2 - 10;
    const pool   = getPoolList();

    ctx.clearRect(0, 0, W, H);

    if (pool.length === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(18,14,38,0.95)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#53fc18';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(14, r * 0.055)}px 'Space Grotesk', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isRunning ? 'Cekanje poruka iz chata...' : 'Pokreni giveaway...', cx, cy);
      return;
    }

    const n = pool.length;
    const sliceAngle = (Math.PI * 2) / n;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(wheelAngle);

    for (let i = 0; i < n; i++) {
      const a0 = i * sliceAngle;
      const a1 = a0 + sliceAngle;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, a0, a1);
      ctx.fillStyle = SLICE_COLORS[i % SLICE_COLORS.length];
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#07050f';
      ctx.stroke();

      ctx.save();
      ctx.rotate(a0 + sliceAngle / 2);
      ctx.textAlign = 'right';
      const fontSize = Math.max(10, Math.min(15, r * 0.06 - n * 0.1));
      ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
      ctx.fillStyle = '#07050f';
      const label = pool[i].length > 16 ? pool[i].substring(0, 14) + '..' : pool[i];
      ctx.fillText(label, r - 16, 4);
      ctx.restore();
    }

    /* Center cap / IZVUCI Button */
    const capRadius = Math.max(28, r * 0.18);
    ctx.beginPath();
    ctx.arc(0, 0, capRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#07050f';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#53fc18';
    ctx.stroke();

    // Inner subtle ring
    ctx.beginPath();
    ctx.arc(0, 0, capRadius * 0.85, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(83, 252, 24, 0.4)';
    ctx.stroke();

    // Center text "IZVUCI" kept upright
    ctx.save();
    ctx.rotate(-wheelAngle);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#53fc18';
    const fontSz = Math.max(10, Math.round(capRadius * 0.38));
    ctx.font = `800 ${fontSz}px 'Outfit', sans-serif`;
    ctx.fillText('IZVUCI', 0, 1);
    ctx.restore();

    ctx.restore();
  }

  /* ── Slot Draw (azurira dashboard I fullscreen verziju istovremeno) ── */
  function drawSlotPreview(text = null) {
    const pool = getPoolList();
    const reelSets = [
      [document.getElementById('slotReel1'), document.getElementById('slotReel2'), document.getElementById('slotReel3'), document.getElementById('slotWinText')],
      [document.getElementById('slotReel1Fullscreen'), document.getElementById('slotReel2Fullscreen'), document.getElementById('slotReel3Fullscreen'), document.getElementById('slotWinTextFullscreen')]
    ];

    reelSets.forEach(([r1, r2, r3, wt]) => {
      if (pool.length === 0) {
        [r1, r2, r3].forEach(r => { if (r) r.innerHTML = '<div class="slot-symbol">---</div>'; });
        if (wt) wt.textContent = 'Cekanje ucesnika...';
        return;
      }
      const sample = text || pool[0];
      [r1, r2, r3].forEach(r => { if (r) r.innerHTML = `<div class="slot-symbol">${escHtml(sample)}</div>`; });
      if (wt) wt.textContent = text ? `Izvucen: ${text}` : `Spremno (${pool.length} sanse)`;
    });
  }

  /* ── Roulette Draw (azurira dashboard I fullscreen verziju istovremeno) ── */
  function drawRoulettePreview(highlightName = null) {
    const pool = getPoolList();
    const strips = [document.getElementById('rouletteStrip'), document.getElementById('rouletteStripFullscreen')];

    strips.forEach(strip => {
      if (!strip) return;
      if (pool.length === 0) { strip.innerHTML = '<div class="roulette-card">Cekanje ucesnika...</div>'; return; }

      const display = pool.slice(0, 24);
      let html = '';
      display.forEach((name, i) => {
        const isW  = highlightName && name === highlightName;
        const col  = SLICE_COLORS[i % SLICE_COLORS.length];
        html += `<div class="roulette-card ${isW ? 'winner-card-active' : ''}" style="border-top:3px solid ${col}"><span>${escHtml(name)}</span></div>`;
      });
      strip.innerHTML = html;

      if (highlightName) {
        const winCard = strip.querySelector('.winner-card-active');
        if (winCard) winCard.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    });
  }

  /* ════════════════════════════════════════
     DRAW WINNER
  ════════════════════════════════════════ */
  function triggerDraw() {
    const pool = getPoolList();
    if (pool.length === 0) { showToast('Nema ucesnika za izvlacenje!', 'error'); return; }
    if (isSpinning) return;
    isSpinning = true;
    refreshAll();

    const durMs = settings.spinTime * 1000;
    playSoundSpin(durMs);

    if (settings.animation === 'slot')          animateSlotDraw(pool, durMs);
    else if (settings.animation === 'roulette') animateRouletteDraw(pool, durMs);
    else                                         animateWheelDraw(pool, durMs);
  }

  function animateWheelDraw(pool, durMs) {
    const extraSpins = 6 + Math.floor(Math.random() * 3);
    const sliceAngle = (Math.PI * 2) / pool.length;
    // Pre-determine winner index randomly
    const winIdx = Math.floor(Math.random() * pool.length);
    const targetOffset = (Math.PI * 1.5) - (winIdx + 0.5) * sliceAngle;
    const finalNormalized = ((targetOffset % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    const currentNorm = ((wheelAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    let delta = finalNormalized - currentNorm;
    if (delta <= 0) delta += Math.PI * 2;
    const totalRotation = extraSpins * Math.PI * 2 + delta;

    const startAngle = wheelAngle;
    const targetAngle = startAngle + totalRotation;
    const startTime = performance.now();
    let lastTick = 0;

    function frame(now) {
      const t = Math.min((now - startTime) / durMs, 1);
      // Smooth organic S-curve easing: initial acceleration then smooth deceleration
      let ease;
      if (t < 0.15) {
        ease = 0.5 * Math.pow(t / 0.15, 2) * 0.15;
      } else {
        const t2 = (t - 0.15) / 0.85;
        ease = 0.01125 + 0.98875 * (1 - Math.pow(1 - t2, 3.5));
      }

      wheelAngle = startAngle + (targetAngle - startAngle) * ease;
      drawWheelOnCanvas('wheelCanvas');
      drawWheelOnCanvas('wheelCanvasFullscreen');

      if (settings.animation === 'wheel' && pool.length > 1) {
        const tickIndex = Math.floor((((wheelAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / sliceAngle);
        if (tickIndex !== lastTick) { playSoundTick(); lastTick = tickIndex; }
      }

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        wheelAngle = targetAngle;
        drawWheelOnCanvas('wheelCanvas');
        drawWheelOnCanvas('wheelCanvasFullscreen');
        stopSpinSound();
        isSpinning = false;

        const winner = pool[winIdx];
        addWinner(winner);
        participantsMap.delete(winner.toLowerCase());
        updateParticipantsUI();
        drawVisualizerStage();
        refreshAll();
      }
    }
    requestAnimationFrame(frame);
  }

  function animateSlotDraw(pool, durMs) {
    const r1 = document.getElementById('slotReel1');
    const r2 = document.getElementById('slotReel2');
    const r3 = document.getElementById('slotReel3');
    const wt = document.getElementById('slotWinText');
    const winner    = pool[Math.floor(Math.random() * pool.length)];
    const startTime = performance.now();

    function frame(now) {
      const t = Math.min((now - startTime) / durMs, 1);
      if (t < 0.55) {
        [r1, r2, r3].forEach(r => {
          if (r) r.innerHTML = `<div class="slot-symbol spinning">${escHtml(pool[Math.floor(Math.random() * pool.length)])}</div>`;
        });
        if (wt) wt.textContent = 'Slot se vrti...';
        playSoundTick();
      } else if (t < 0.78) {
        if (r1) r1.innerHTML = `<div class="slot-symbol win-reel">${escHtml(winner)}</div>`;
        if (r2) r2.innerHTML = `<div class="slot-symbol win-reel">${escHtml(winner)}</div>`;
        if (r3) r3.innerHTML = `<div class="slot-symbol spinning">${escHtml(pool[Math.floor(Math.random() * pool.length)])}</div>`;
        if (wt) wt.textContent = 'Zaustavljanje...';
      } else {
        [r1, r2, r3].forEach(r => { if (r) r.innerHTML = `<div class="slot-symbol win-reel">${escHtml(winner)}</div>`; });
        if (wt) wt.textContent = `POBEDA: ${winner}!`;
      }

      if (t < 1) requestAnimationFrame(frame);
      else {
        stopSpinSound();
        isSpinning = false;
        addWinner(winner);
        participantsMap.delete(winner.toLowerCase());
        updateParticipantsUI();
        refreshAll();
      }
    }
    requestAnimationFrame(frame);
  }

  function animateRouletteDraw(pool, durMs) {
    const winner    = pool[Math.floor(Math.random() * pool.length)];
    const startTime = performance.now();

    function frame(now) {
      const t = Math.min((now - startTime) / durMs, 1);
      if (t < 1) {
        const rand = pool[Math.floor(Math.random() * pool.length)];
        drawRoulettePreview(rand);
        if (Math.random() < 0.3) playSoundTick();
        requestAnimationFrame(frame);
      } else {
        stopSpinSound();
        isSpinning = false;
        drawRoulettePreview(winner);
        addWinner(winner);
        participantsMap.delete(winner.toLowerCase());
        updateParticipantsUI();
        refreshAll();
      }
    }
    requestAnimationFrame(frame);
  }

  /* ════════════════════════════════════════
     REFRESH ALL
  ════════════════════════════════════════ */
  function refreshAll() {
    updateSummary();
    updateStateBadge();
    updateActionStates();
    updateFullscreenStateBadge();
    saveState();
  }

  function updateSummary() {
    setText('summaryPrize',     settings.prize || 'Misteriozna Nagrada');
    setText('stagePrizeTitle',  settings.prize || 'Misteriozna Nagrada');
    setText('summaryKeyword',   settings.keyword || 'Sve poruke');
    setText('summaryAnimation', ANIM_LABELS[settings.animation] || ANIM_LABELS.wheel);
    setText('stageAnimationLabel', ANIM_LABELS[settings.animation] || ANIM_LABELS.wheel);
    setText('stageEligibilityLabel', getEligibilitySummary());
    setText('wfoPrizeText', settings.prize || 'Misteriozna Nagrada');

    if (isSpinning)   { setText('summaryRunState', 'Izvlačenje u toku'); }
    else if (isRunning) { setText('summaryRunState', 'Giveaway aktivan'); }
    else              { setText('summaryRunState', 'Spremno za pokretanje'); }

    // Also update spin time stat
    setText('statSpinTime', formatSpinTime(settings.spinTime));
  }

  function getEligibilitySummary() {
    const parts = [settings.subscribersOnly ? 'Samo subovi' : 'Otvoreno za sve'];
    if (settings.subDuration > 0) parts.push(`sub ${settings.subDuration}+ mes.`);
    if (settings.followDuration > 0) parts.push(`follow ${settings.followDuration}+ dana`);
    return parts.join(' · ');
  }

  function updateStateBadge() {
    const badge = document.getElementById('stageStateBadge');
    const pill  = document.getElementById('channelStatusPill');
    const dot   = document.getElementById('channelDot');
    const safe  = escHtml(channelName || 'DemoKanal');

    if (!badge) return;
    badge.className = 'stage-state-badge';

    if (isSpinning) {
      badge.textContent = 'Izvlačenje u toku';
      badge.classList.add('is-spinning');
      if (dot) dot.style.background = '#c084fc';
    } else if (isRunning) {
      badge.textContent = 'Live Chat Aktivan';
      badge.classList.add('is-live');
      if (dot) { dot.style.background = 'var(--aj-green)'; dot.style.boxShadow = '0 0 8px var(--aj-green)'; }
    } else if (participantsMap.size > 0 || winnersList.length > 0) {
      badge.textContent = 'Pauzirano';
      badge.classList.add('is-paused');
      if (dot) dot.style.background = 'var(--aj-amber)';
    } else {
      badge.textContent = 'Standby';
    }

    if (pill) pill.innerHTML = `<span class="channel-dot" id="channelDot"></span><span>Kanal: <strong>${safe}</strong></span>`;
  }

  function updateActionStates() {
    const hasParticipants = participantsMap.size > 0;
    const drawBtn         = document.getElementById('btnDrawWinner');
    const resetBtn        = document.getElementById('btnResetGiveaway');
    const startBtn        = document.getElementById('btnStartGiveaway');

    const wfoDrawBtn      = document.getElementById('wfoBtnDraw');
    const wfoResetBtn     = document.getElementById('wfoBtnReset');
    const wfoStartBtn     = document.getElementById('wfoBtnStart');

    if (drawBtn)    drawBtn.disabled    = !hasParticipants || isSpinning;
    if (wfoDrawBtn) wfoDrawBtn.disabled = !hasParticipants || isSpinning;

    const isResetDisabled = !isRunning && participantsMap.size === 0 && winnersList.length === 0;
    if (resetBtn)    resetBtn.disabled    = isResetDisabled;
    if (wfoResetBtn) wfoResetBtn.disabled = isResetDisabled;

    [startBtn, wfoStartBtn].forEach(btn => {
      if (!btn) return;
      const span = btn.querySelector('span');
      if (isRunning) {
        btn.classList.add('is-active');
        if (span) span.textContent = 'PAUZIRAJ GIVEAWAY';
      } else {
        btn.classList.remove('is-active');
        if (span) span.textContent = 'POKRENI GIVEAWAY';
      }
    });
  }

  /* ════════════════════════════════════════
     TOAST
  ════════════════════════════════════════ */
  function showToast(msg, type = 'success', dur = null) {
    const known = ['success','error','info','warning'];
    if (!known.includes(type)) type = 'success';

    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      container.id = 'toastContainer';
      document.body.appendChild(container);
    }

    const textLen = (msg || '').length;
    const base    = Math.max(2500, Math.min(8000, 2200 + textLen * 55));
    if (!dur) dur = (type === 'error' || type === 'warning') ? base + 1000 : base;

    const id  = ++toastIdCounter;
    const el  = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.id = `toast-${id}`;

    const icons = {
      success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#53fc18" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`,
      error:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      info:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
      warning: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="3"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
    };

    el.innerHTML = `
      <div style="flex-shrink:0;">${icons[type]}</div>
      <div class="toast-msg">${escHtml(msg)}</div>
      <button class="toast-close" onclick="window.removeToast(${id})" aria-label="Zatvori">&#x2715;</button>`;

    const active = Array.from(container.children).filter(c => !c.classList.contains('toast-leaving'));
    if (active.length >= 3) {
      const old = active[0];
      old.classList.add('toast-leaving');
      const m = old.id.match(/toast-(\d+)/);
      if (m) window.removeToast(parseInt(m[1], 10)); else old.remove();
    }

    container.appendChild(el);
    setTimeout(() => el.classList.add('toast-show'), 20);
    setTimeout(() => window.removeToast(id), dur);
  }

  window.removeToast = function (id) {
    const el = document.getElementById(`toast-${id}`);
    if (el) { el.classList.remove('toast-show'); el.classList.add('toast-leaving'); setTimeout(() => el.remove(), 250); }
  };

  window.toastSystem = {
    show: showToast,
    success: (m, d) => showToast(m, 'success', d),
    error:   (m, d) => showToast(m, 'error', d),
    warning: (m, d) => showToast(m, 'warning', d),
    info:    (m, d) => showToast(m, 'info', d)
  };

  /* ════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════ */
  function cleanUsername(raw) {
    if (!raw) return 'Kanal';
    let s = String(raw).trim().replace(/^kick_user_/, '');
    if (s.includes('@')) s = s.split('@')[0];
    return s || 'Kanal';
  }

  function escHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[m]);
  }

  function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
  function setMsg(id, val)  { setText(id, val); }
  function setVal(id, val)  { const el = document.getElementById(id); if (el) el.value = val; }
  function setChecked(id, val) { const el = document.getElementById(id); if (el) el.checked = !!val; }

  function bindInput(id, event, cb, opts = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(event, (e) => {
      if (opts.maxLen && e.target.value.length > opts.maxLen) e.target.value = e.target.value.slice(0, opts.maxLen);
      cb(e.target.value);
    });
  }

  function bindClick(id, cb) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', cb);
  }

})();