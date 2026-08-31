/**
 * KICKAJ — Giveaway Studio
 * Kompletna logika: Auth, Plan, Menadzer kanala (Vlasnicki + Managed + Custom sa Kickot integracijom),
 * WebSocket, Animacije, Zvuk, Fullscreen, Sinhronizacija baze (Supabase tabela 'kickaj')
 * i LocalStorage, Trajna trajnost tajmera pobednika.
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
  let currentUserProfile = null;   // Pun red iz user_profiles za ulogovanog korisnika
  let userPlan         = 'free';   // 'free' | 'pro' | 'elite'
  let userChannels     = [];       // [{id, username, avatar, chatroom_id, is_primary, is_managed, role, owner_id, owner_plan}]
  let activeChannelObj = null;     // Trenutno selektovan kanal objekat
  let channelName      = '';       // Slug / username aktivnog kanala
  let channelId        = null;
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
    free:  { maxParticipants: 500,  animations: ['wheel'],                   sound: true,  fullscreen: true  },
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

  function getBotApiBase() {
    return window.KickotConfig ? window.KickotConfig.api.baseUrl : 'https://kickbot-ihzb.onrender.com';
  }

  /* ════════════════════════════════════════
     INIT
  ════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', async () => {
    loadState();
    await checkAuth();
    loadNotifications();
    loadChangelogs();
    setupSidebar();
    setupSettingsForm();
    setupListControls();
    setupFullscreen();
    setupMuteButton();
    setupGlobalClickHandlers();
    initCanvasWheel();
    updateParticipantsUI();
    updateWinnersUI();
    refreshAll();
  });

  /* ════════════════════════════════════════
     STATE PERSISTENCE & DB SYNC
  ════════════════════════════════════════ */
  let dbSaveTimeout = null;

  function getSerializableState() {
    return {
      channel_name: channelName || '',
      channel_id: channelId ? String(channelId) : null,
      chatroom_id: chatroomId ? parseInt(chatroomId, 10) : null,
      settings: { ...settings },
      participants: Array.from(participantsMap.entries()),
      winners: winnersList.map(w => {
        const now = Date.now();
        const initSec = typeof w.initialConfirmSeconds === 'number' ? w.initialConfirmSeconds : (settings.confirmTime || 60);
        let expiresAt = typeof w.expiresAt === 'number' ? w.expiresAt : (w.savedAt || now) + initSec * 1000;
        let isExpired = !!w.isExpired || (now >= expiresAt) || (typeof w.confirmSeconds === 'number' && w.confirmSeconds <= 0);
        let remSec = isExpired ? 0 : Math.max(0, Math.ceil((expiresAt - now) / 1000));

        return {
          username: w.username,
          prize: w.prize || settings.prize || 'Misteriozna Nagrada',
          confirmSeconds: isExpired ? 0 : remSec,
          initialConfirmSeconds: initSec,
          expiresAt: expiresAt,
          savedAt: w.savedAt || now,
          isExpired: isExpired
        };
      }),
      isRunning: !!isRunning,
      wheelAngle: wheelAngle || 0
    };
  }

  function saveState() {
    const payload = getSerializableState();

    // 1. Momentalno cuvanje u LocalStorage (opsti kljuc + per-channel kljuc)
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(payload));
      if (channelName) {
        localStorage.setItem(`${STATE_KEY}_${channelName.toLowerCase()}`, JSON.stringify(payload));
        localStorage.setItem('kickbot_selected_channel_name', channelName);
        if (channelId) localStorage.setItem('kickbot_selected_channel_id', String(channelId));
      }
    } catch (e) { /* silent */ }

    // 2. Debounced cuvanje u Supabase bazi
    syncStateToSupabaseDebounced(payload);
  }

  function syncStateToSupabaseDebounced(payload) {
    if (dbSaveTimeout) clearTimeout(dbSaveTimeout);
    dbSaveTimeout = setTimeout(() => {
      syncStateToSupabase(payload);
    }, 600);
  }

  async function syncStateToSupabase(payload) {
    if (!sb || !currentUser) return;
    try {
      const dataToSave = payload || getSerializableState();
      const cleanName = cleanUsername(channelName);

      if (cleanName && cleanName !== 'Kanal' && cleanName !== 'DemoKanal') {
        const rowData = {
          user_id: currentUser.id,
          channel_name: cleanName,
          channel_id: channelId ? String(channelId) : null,
          chatroom_id: chatroomId ? parseInt(chatroomId, 10) : null,
          settings: dataToSave.settings,
          winners: dataToSave.winners,
          updated_at: new Date().toISOString()
        };

        const { error: kickajErr } = await sb
          .from('kickaj')
          .upsert(rowData, { onConflict: 'user_id,channel_name' });

        if (kickajErr) {
          console.warn('[Kickaj DB] Upsert to kickaj table warning:', kickajErr.message);
        }
      }

      // Rezervni backup u user_profiles
      await sb.from('user_profiles').update({
        kickaj_state: dataToSave
      }).eq('id', currentUser.id);

    } catch (e) {
      console.warn('[Kickaj DB Sync] Error:', e);
    }
  }

  async function syncStateFromSupabase(targetChannel = null) {
    if (!sb || !currentUser) return;
    const targetName = cleanUsername(targetChannel || channelName);
    try {
      let loadedData = null;

      // 1. Primarno: Pokusaj citanja iz tabele 'kickaj' za aktivan kanal
      if (targetName && targetName !== 'Kanal' && targetName !== 'DemoKanal') {
        const { data: kickajRow, error: kErr } = await sb
          .from('kickaj')
          .select('*')
          .eq('user_id', currentUser.id)
          .eq('channel_name', targetName)
          .maybeSingle();

        if (!kErr && kickajRow) {
          loadedData = {
            channel_name: kickajRow.channel_name,
            channel_id: kickajRow.channel_id,
            chatroom_id: kickajRow.chatroom_id,
            settings: kickajRow.settings,
            winners: kickajRow.winners
          };
          if (kickajRow.chatroom_id && !chatroomId) {
            chatroomId = parseInt(kickajRow.chatroom_id, 10);
          }
        }
      }

      // 2. Fallback: Proveri user_profiles.kickaj_state
      if (!loadedData) {
        const { data: profile } = await sb
          .from('user_profiles')
          .select('kickaj_state')
          .eq('id', currentUser.id)
          .maybeSingle();

        if (profile?.kickaj_state) {
          loadedData = profile.kickaj_state;
        }
      }

      if (loadedData) {
        applyLoadedState(loadedData);
        try {
          localStorage.setItem(STATE_KEY, JSON.stringify(getSerializableState()));
          if (targetName) {
            localStorage.setItem(`${STATE_KEY}_${targetName.toLowerCase()}`, JSON.stringify(getSerializableState()));
          }
        } catch (e) { /* silent */ }
      }
    } catch (err) {
      console.warn('[Kickaj DB Sync] Load error:', err);
    }
  }

  function loadState(specificChannel = null) {
    try {
      const chKey = specificChannel ? `${STATE_KEY}_${specificChannel.toLowerCase()}` : null;
      const raw = (chKey && localStorage.getItem(chKey)) || localStorage.getItem(STATE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      applyLoadedState(d);
    } catch (e) { /* silent */ }
  }

  function applyLoadedState(d) {
    if (!d) return;
    if (d.settings) {
      settings = { ...settings, ...d.settings };
      if (settings.prize === 'Misteriozna Nagrada') settings.prize = '';
    }
    if (d.participants && Array.isArray(d.participants)) {
      participantsMap = new Map(d.participants);
    }

    if (d.winners && Array.isArray(d.winners)) {
      winnersList.forEach(w => { if (w.timerId) clearInterval(w.timerId); });
      const now = Date.now();
      winnersList = d.winners.map(w => {
        const initSec = typeof w.initialConfirmSeconds === 'number'
          ? w.initialConfirmSeconds
          : (typeof w.confirmSeconds === 'number' ? w.confirmSeconds : (settings.confirmTime || 60));

        const savedAt = w.savedAt || now;
        let expiresAt = typeof w.expiresAt === 'number'
          ? w.expiresAt
          : (savedAt + (typeof w.confirmSeconds === 'number' ? w.confirmSeconds : initSec) * 1000);

        // Kljucno pravilo: Ako je jednom istekao, trajno ostaje istekao!
        let isExpired = !!w.isExpired || (now >= expiresAt);
        let currSec = 0;

        if (!isExpired) {
          currSec = Math.max(0, Math.ceil((expiresAt - now) / 1000));
          if (currSec <= 0) {
            currSec = 0;
            isExpired = true;
          }
        }

        return {
          username: w.username,
          prize: w.prize || settings.prize || 'Misteriozna Nagrada',
          confirmSeconds: isExpired ? 0 : currSec,
          initialConfirmSeconds: initSec,
          expiresAt: expiresAt,
          savedAt: now,
          isExpired: isExpired,
          timerId: null
        };
      });
    }

    if (typeof d.wheelAngle === 'number') wheelAngle = d.wheelAngle;
    if (d.isRunning) isRunning = false; // safety

    restoreFormInputs();
    updateWinnersUI();
    winnersList.forEach(w => {
      if (!w.isExpired && w.confirmSeconds > 0) {
        startWinnerTimer(w);
      } else {
        updateSingleWinnerTimerUI(w);
      }
    });
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
     AUTH + PLAN + KICKOT CHANNELS SYNC
  ════════════════════════════════════════ */

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
    } catch (_) { }
    return null;
  }

  async function checkAuth() {
    if (!sb) {
      setMsg('authGateMsg', 'Preusmeravanje na prijavu...');
      setTimeout(() => { window.location.href = '../index.html?login=1'; }, 1200);
      return;
    }
    try {
      try {
        sessionStorage.setItem('from_kickall', 'true');
        sessionStorage.setItem('kick_origin_site', 'kickaj');
        localStorage.setItem('kick_origin_site', 'kickaj');
      } catch (e) {
        console.warn('Failed to set origin flags:', e);
      }

      const urlParams = new URLSearchParams(window.location.search);
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
        || (currentUser.email || '');
      let avatarUrl = currentUser.user_metadata?.avatar_url
        || currentUser.user_metadata?.picture
        || currentUser.user_metadata?.profile_picture;

      userChannels = [];

      try {
        let profile = null;
        if (currentUser?.id) {
          const { data: p1 } = await sb.from('user_profiles')
            .select('*').eq('id', currentUser.id).maybeSingle();
          if (p1) profile = p1;
        }
        if (!profile && currentUser?.email) {
          const { data: p2 } = await sb.from('user_profiles')
            .select('*').eq('email', currentUser.email).maybeSingle();
          if (p2) profile = p2;
        }
        if (!profile) {
          const kName = cleanUsername(currentUser?.user_metadata?.kick_username || currentUser?.user_metadata?.preferred_username || currentUser?.user_metadata?.name || username);
          if (kName && kName !== 'Kanal' && kName !== 'DemoKanal') {
            const { data: p3 } = await sb.from('user_profiles')
              .select('*').ilike('kick_username', kName).maybeSingle();
            if (p3) {
              profile = p3;
            } else {
              const { data: p4 } = await sb.from('user_profiles')
                .select('*').ilike('display_name', kName).maybeSingle();
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
          try { localStorage.setItem('kickaj_user_plan', tier); } catch (_) { }

          const myUsername = profile.kick_username || profile.display_name || username;

          // 1. Vlasnički kanali (iz profila)
          if (profile.kick_channels && Array.isArray(profile.kick_channels)) {
            profile.kick_channels.forEach(ch => {
              const uName = cleanUsername(ch.username || ch.slug || ch.display_name || '');
              if (uName) {
                userChannels.push({
                  id: ch.id || null,
                  username: uName,
                  avatar: ch.avatar || ch.avatar_url || '',
                  chatroom_id: ch.chatroom_id || null,
                  is_primary: !!ch.is_primary,
                  is_managed: false,
                  role: 'owner',
                  owner_id: currentUser.id,
                  owner_plan: tier
                });
              }
            });
          }

          if (userChannels.length === 0 && profile.kick_username) {
            userChannels.push({
              id: profile.kick_user_id || null,
              username: cleanUsername(profile.kick_username),
              avatar: profile.avatar_url || '',
              chatroom_id: null,
              is_primary: true,
              is_managed: false,
              role: 'owner',
              owner_id: currentUser.id,
              owner_plan: tier
            });
          }

          // 2. Managed / Dodeljeni kanali iz Kickot ekosistema
          // Napomena: koristi se SECURITY DEFINER RPC (get_managed_kick_channels) umesto
          // select('*') nad celom user_profiles tabelom, jer bi to izlagalo kick_access_token
          // svih korisnika klijentskom kodu. RPC vraća samo kanale gde je myUsername naveden
          // kao manager, bez tokena.
          try {
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
          } catch (rpcErr) { console.warn('[Kickaj] Greška pri učitavanju managed kanala:', rpcErr); }
        }
      } catch (e) { console.warn('[Kickaj] Greška pri učitavanju profila/kanala:', e); }

      // 3. Dodaj sacuvane custom kanale iz LocalStorage ako postoje
      try {
        const savedCustomRaw = localStorage.getItem('kickaj_custom_channels_list');
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
      } catch (_) { }

      // Deduplicate kanale
      const seen = new Set();
      userChannels = userChannels.filter(c => {
        const key = c.username.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Odaberi inicijalni kanal
      const savedId   = localStorage.getItem('kickbot_selected_channel_id');
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

      if (candidate) {
        activeChannelObj = candidate;
        username = candidate.username;
        if (candidate.avatar) avatarUrl = candidate.avatar;
        if (candidate.chatroom_id) chatroomId = candidate.chatroom_id;
        if (candidate.id) channelId = candidate.id;
      }

      channelName = cleanUsername(username);

      if (channelName && !userChannels.some(c => c.username.toLowerCase() === channelName.toLowerCase())) {
        userChannels.unshift({
          id: channelId,
          username: channelName,
          avatar: avatarUrl || '',
          chatroom_id: chatroomId,
          is_primary: true,
          is_managed: false,
          role: 'owner',
          owner_id: currentUser.id,
          owner_plan: userPlan
        });
      }

      updateProfileUI(channelName, avatarUrl);
      applyPlanRestrictions();
      renderChannelDropdown();

      setText('connectedChannelName', channelName || 'DemoKanal');
      setText('wfoChannelName', channelName || 'DemoKanal');

      if (channelName) await resolveKickChatroom(channelName);

      await syncStateFromSupabase(channelName);

      // Asinhrono popuni nedostajuce avatare
      fetchMissingAvatars();

      // Glatka tranzicija identicno kao na Kickot-u
      await new Promise(resolve => setTimeout(resolve, 300));
      hideAuthGate();
    } catch (err) {
      setMsg('authGateMsg', 'Preusmeravanje na prijavu...');
      setTimeout(() => { window.location.href = '../index.html?login=1'; }, 1200);
    }
  }

  async function fetchMissingAvatars() {
    const missing = userChannels.filter(c => !c.avatar && c.username && c.username !== 'DemoKanal');
    if (missing.length === 0) return;

    let updatedAny = false;
    for (const ch of missing) {
      const pic = await fetchKickAvatar(ch.username);
      if (pic) {
        ch.avatar = pic;
        updatedAny = true;
        if (activeChannelObj && activeChannelObj.username.toLowerCase() === ch.username.toLowerCase()) {
          activeChannelObj.avatar = pic;
          updateProfileUI(ch.username, pic);
        }
      }
    }
    if (updatedAny) {
      renderChannelDropdown();
    }
  }

  /* ════════════════════════════════════════
     CHANNEL MANAGER & SWITCHER
  ════════════════════════════════════════ */
  function renderChannelDropdown() {
    const listEl = document.getElementById('cdmChannelList');
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
      const isActive = ch.username.toLowerCase() === (channelName || '').toLowerCase();
      const initial = ch.username.charAt(0).toUpperCase();
      const avatarStyle = ch.avatar ? `background-image: url('${ch.avatar}'); background-size: cover; background-position: center;` : '';

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
        <button type="button" class="cdm-item ${isActive ? 'active' : ''}" onclick="window.selectChannel('${escHtml(ch.username)}')">
          <div class="cdm-item-left">
            <div class="cdm-avatar" style="${avatarStyle}">${ch.avatar ? '' : initial}</div>
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

  async function setActiveChannel(channelInput, reconnectIfRunning = true) {
    if (!channelInput) return;
    let targetName = '';
    let targetObj = null;

    if (typeof channelInput === 'string') {
      targetName = cleanUsername(channelInput);
      targetObj = userChannels.find(c => c.username.toLowerCase() === targetName.toLowerCase()) || {
        username: targetName,
        id: null,
        avatar: '',
        chatroom_id: null,
        is_primary: false,
        is_managed: false,
        role: 'custom',
        owner_id: currentUser?.id,
        owner_plan: userPlan
      };
    } else {
      targetObj = channelInput;
      targetName = cleanUsername(targetObj.username);
    }

    if (!targetName) return;

    if (!userChannels.some(c => c.username.toLowerCase() === targetName.toLowerCase())) {
      userChannels.push(targetObj);
      // Sacuvaj u listu custom kanala
      try {
        const customOnly = userChannels.filter(c => c.role === 'custom');
        localStorage.setItem('kickaj_custom_channels_list', JSON.stringify(customOnly));
      } catch (_) { }
    }

    channelName = targetName;
    activeChannelObj = targetObj;
    channelId = targetObj.id || null;
    chatroomId = targetObj.chatroom_id || null;

    // Prilagodi plan: za menadžerske kanale koristi plan vlasnika, za sopstvene uvek stvarni plan
    if (targetObj.role === 'managed' && targetObj.owner_plan) {
      userPlan = targetObj.owner_plan.includes('elite') ? 'elite' : (targetObj.owner_plan.includes('pro') ? 'pro' : 'free');
    } else {
      const myTier = currentUserProfile ? String(currentUserProfile.plan || currentUserProfile.plan_tier || currentUserProfile.tier || 'free').toLowerCase() : userPlan;
      userPlan = (myTier.includes('elite') || myTier.includes('business')) ? 'elite' : (myTier.includes('pro') ? 'pro' : 'free');
      targetObj.owner_plan = userPlan;
    }

    // Snimi u LocalStorage
    try {
      localStorage.setItem('kickbot_selected_channel_name', channelName);
      if (channelId) localStorage.setItem('kickbot_selected_channel_id', String(channelId));
    } catch (e) { /* silent */ }

    // Azuriraj UI
    setText('connectedChannelName', channelName);
    setText('wfoChannelName', channelName);
    updateProfileUI(channelName, targetObj.avatar);
    applyPlanRestrictions();
    renderChannelDropdown();
    updateStateBadge();

    // Ucitaj sacuvano stanje za ovaj specificni kanal iz localstorage
    loadState(channelName);

    // Razresi Chatroom ID za novi kanal
    await resolveKickChatroom(channelName);

    // Sinhronizuj iz baze za izabrani kanal
    await syncStateFromSupabase(channelName);

    // Ako nema avatar, pokusaj dobaviti
    if (!targetObj.avatar) {
      fetchKickAvatar(channelName).then(pic => {
        if (pic) {
          targetObj.avatar = pic;
          updateProfileUI(channelName, pic);
          renderChannelDropdown();
        }
      });
    }

    // Ako je giveaway aktivan, rekonektuj chatroom na novi kanal
    if (reconnectIfRunning && isRunning) {
      showToast(`Prebacujem chat konekciju na kanal "${channelName}"...`, 'info');
      await connectKickChat();
    }

    saveState();
  }

  window.toggleChannelDropdown = function (event) {
    if (event) event.stopPropagation();
    const pill = document.getElementById('channelStatusPill');
    const menu = document.getElementById('channelDropdownMenu');
    if (!menu) return;

    const isOpen = menu.classList.contains('open');
    if (isOpen) {
      menu.classList.remove('open');
      if (pill) pill.classList.remove('open');
    } else {
      menu.classList.add('open');
      if (pill) pill.classList.add('open');
    }
  };

  window.selectChannel = async function (username) {
    const clean = cleanUsername(username);
    if (!clean) return;

    const pill = document.getElementById('channelStatusPill');
    const menu = document.getElementById('channelDropdownMenu');
    if (menu) menu.classList.remove('open');
    if (pill) pill.classList.remove('open');

    if (clean.toLowerCase() === (channelName || '').toLowerCase()) {
      return;
    }

    await setActiveChannel(clean, true);
    showToast(`Aktivni kanal promenjen na: ${clean}`, 'success');
  };

  window.openCustomChannelModal = function (event) {
    if (event) event.stopPropagation();
    const pill = document.getElementById('channelStatusPill');
    const menu = document.getElementById('channelDropdownMenu');
    if (menu) menu.classList.remove('open');
    if (pill) pill.classList.remove('open');

    const input = document.getElementById('customChannelInput');
    if (input) input.value = channelName || '';
    window.openModal('customChannelModal');
    setTimeout(() => { if (input) input.focus(); }, 150);
  };

  window.saveCustomChannel = async function () {
    const input = document.getElementById('customChannelInput');
    const raw = (input?.value || '').trim();
    const clean = cleanUsername(raw);

    if (!clean || clean === 'Kanal') {
      showToast('Unesite validno Kick korisničko ime.', 'warning');
      return;
    }

    window.closeModal('customChannelModal');

    // Dodaj u custom kanale ako vec nije
    let existing = userChannels.find(c => c.username.toLowerCase() === clean.toLowerCase());
    if (!existing) {
      existing = {
        id: null,
        username: clean,
        avatar: '',
        chatroom_id: null,
        is_primary: false,
        is_managed: false,
        role: 'custom',
        owner_id: currentUser?.id,
        owner_plan: userPlan
      };
      userChannels.push(existing);
      try {
        const customOnly = userChannels.filter(c => c.role === 'custom');
        localStorage.setItem('kickaj_custom_channels_list', JSON.stringify(customOnly));
      } catch (_) { }
    }

    await setActiveChannel(existing, true);
    showToast(`Uspešno povezan kanal: ${clean}`, 'success');
  };

  function setupGlobalClickHandlers() {
    document.addEventListener('click', (e) => {
      const pill = document.getElementById('channelStatusPill');
      const menu = document.getElementById('channelDropdownMenu');
      if (menu && pill && !pill.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.remove('open');
        pill.classList.remove('open');
      }
    });
  }

  function applyPlanRestrictions() {
    const limits = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;

    /* Plan badges */
    const planBadgeEl    = document.getElementById('planBadge');
    const heroPlanBadge  = document.getElementById('heroPlanBadge');
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
    const toggleSound = document.getElementById('toggleSound');
    if (soundLock) soundLock.style.display = limits.sound ? 'none' : 'inline-flex';
    if (!limits.sound) {
      settings.soundEnabled = false;
      if (soundToggleRow) soundToggleRow.style.opacity = '0.4';
      if (volumeGroup)    volumeGroup.style.opacity = '0.4';
      if (toggleSound) { toggleSound.checked = false; toggleSound.disabled = true; }
    } else {
      if (soundToggleRow) soundToggleRow.style.opacity = '1';
      if (volumeGroup)    volumeGroup.style.opacity = '1';
      if (toggleSound) { toggleSound.disabled = false; }
    }

    /* Fullscreen button */
    const fsBtn = document.getElementById('btnOpenFullscreen');
    if (fsBtn) {
      if (!limits.fullscreen) {
        fsBtn.title = 'Fullscreen je dostupan na PRO ili ELITE planu';
        fsBtn.style.opacity = '0.35';
        fsBtn.style.cursor = 'not-allowed';
        fsBtn.disabled = true;
      } else {
        fsBtn.title = 'Prikaži preko celog ekrana (F)';
        fsBtn.style.opacity = '1';
        fsBtn.style.cursor = 'pointer';
        fsBtn.disabled = false;
      }
    }
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

    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout && sb) {
      btnLogout.addEventListener('click', async (e) => {
        e.stopPropagation();
        await sb.auth.signOut();
        window.location.href = '../index.html';
      });
    }

    document.addEventListener('click', (e) => {
      const menu = document.getElementById('userMenuSm');
      const pill = document.getElementById('userPill');
      if (menu && pill && !pill.contains(e.target)) {
        menu.classList.remove('open');
      }
    });
  }

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
        btn.style.borderColor = 'var(--aj-red, #ef4444)';
        btn.style.color       = 'var(--aj-red, #ef4444)';
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
          <div style="color: var(--aj-muted); text-align: center; padding: 28px 14px; font-size: 0.82rem; display: flex; flex-direction: column; align-items: center; gap: 8px;">
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
                  <div style="font-size: 0.68rem; color: var(--aj-muted); white-space: nowrap;">${formattedTime}</div>
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
          <div style="color: var(--aj-muted); text-align: center; padding: 28px 14px; font-size: 0.82rem; display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.5;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span>Trenutno nema novih changelog informacija.</span>
          </div>`;
        return;
      }

      list.innerHTML = changelogs.map(c => `
        <div style="padding: 12px 14px; border-radius: 12px; background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); transition: all 0.2s; margin-bottom: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 0.72rem; font-weight: 800; color: #a78bfa; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); padding: 2px 8px; border-radius: 6px; letter-spacing: 0.5px;">${escHtml(c.version)}</span>
            <span style="font-size: 0.68rem; color: var(--aj-muted); display: flex; align-items: center; gap: 4px;">
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
    window.toastSystem.info('Sva obaveštenja su označena kao pročitana.');
  };

  window.switchNotifTab = function (tabId) {
    activeNotifTab = tabId;
    const btn1 = document.getElementById('notifTabObavestenja');
    const btn2 = document.getElementById('notifTabChangelog');
    if (btn1) btn1.classList.toggle('active', tabId === 'obavestenja');
    if (btn2) btn2.classList.toggle('active', tabId === 'changelog');
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
      await syncStateFromSupabase(channelName);
      await Promise.all([loadNotifications(), loadChangelogs()]);
      window.toastSystem.success('Podaci uspešno sinhronizovani iz baze.');

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
      window.toastSystem.error('Greška pri osvežavanju podataka.');
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
        showToast('Ova animacija nije dostupna na vašem planu.', 'warning');
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

    // Test dugme
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
      if (!confirm('Da li ste sigurni da želite da obrišete sve učesnike?')) return;
      participantsMap.clear();
      updateParticipantsUI();
      drawVisualizerStage();
      refreshAll();
      showToast('Lista učesnika je očišćena.', 'info');
    });

    bindClick('btnClearWinners', () => {
      if (winnersList.length === 0) return;
      if (!confirm('Da li ste sigurni da želite da obrišete sve pobednike?')) return;
      winnersList.forEach(w => { if (w.timerId) clearInterval(w.timerId); });
      winnersList = [];
      updateWinnersUI();
      refreshAll();
      saveState();
      showToast('Lista pobednika je uspešno očišćena.', 'info');
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
    void ov.offsetWidth;
    ov.classList.add('open');
    ov.removeAttribute('aria-hidden');

    setText('wfoPrizeText',        settings.prize || 'Misteriozna Nagrada');
    setText('wfoChannelName',      channelName || 'Kanal');
    setText('wfoParticipantCount', participantsMap.size);
    setText('wfoWinnersCount',     winnersList.length);

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
    if (isSpinning) { badge.textContent = 'Izvlačenje u toku'; badge.classList.add('is-spinning'); }
    else if (isRunning) { badge.textContent = 'Čekam sledeće izvlačenje'; badge.classList.add('is-live'); }
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
      try { spinSoundNode.stop(); } catch (e) { /* */ }
      spinSoundNode = null;
    }
  }

  function playSoundChamp() {
    if (!getVolume()) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
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

    const notes = [523.25, 659.25, 783.99, 1046.5];
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
    if (!channelName) { showToast('Nije izabran Kick kanal!', 'warning'); return false; }

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
      catch (e) { clearTimeout(timeout); showToast('Greška pri kreiranju WebSocket konekcije.', 'error'); resolve(false); return; }

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
        showToast(`Povezan chat za kanal: ${channelName}`, 'success');
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
    const playSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    const pauseSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;

    const startBtn    = document.getElementById('btnStartGiveaway');
    const wfoStartBtn = document.getElementById('wfoBtnStart');

    [startBtn, wfoStartBtn].forEach(btn => {
      if (!btn) return;
      if (isRunning) {
        btn.classList.add('is-active');
        btn.innerHTML = `${pauseSvg}<span>Pauziraj giveaway</span>`;
        btn.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
        btn.style.color = '#07050f';
      } else {
        btn.classList.remove('is-active');
        btn.innerHTML = `${playSvg}<span>Pokreni giveaway</span>`;
        btn.style.background = 'linear-gradient(135deg, #53fc18, #3de810)';
        btn.style.color = '#07050f';
      }
    });
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
    
    // Ukloni stanje za trenutni kanal
    try {
      localStorage.removeItem(STATE_KEY);
      if (channelName) localStorage.removeItem(`${STATE_KEY}_${channelName.toLowerCase()}`);
    } catch (e) { /* */ }

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
     WINNERS UI & TIMER MANAGEMENT
  ════════════════════════════════════════ */
  function addWinner(username) {
    const remainingBefore = participantsMap.size;
    const isTop5 = remainingBefore <= 5;
    const isFinalChamp = remainingBefore === 1;
    
    const prizeName = settings.prize || 'Misteriozna Nagrada';
    const initSec = settings.confirmTime || 60;
    const now = Date.now();
    const expiresAt = now + (initSec * 1000);

    const w = {
      username,
      prize: prizeName,
      confirmSeconds: initSec,
      initialConfirmSeconds: initSec,
      expiresAt: expiresAt,
      savedAt: now,
      isExpired: false,
      timerId: null
    };
    winnersList.unshift(w);
    updateWinnersUI();
    startWinnerTimer(w);
    saveState();
    
    if (isFinalChamp) {
      playSoundChamp();
    } else {
      playSoundWin();
    }
    
    showWinnerOverlay(username, prizeName, initSec, isTop5, isFinalChamp);
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
      if (isFinalChamp) top5Badge.textContent = 'KONAČNI ŠAMPION';
      else if (isTop5)  top5Badge.textContent = 'TOP 5 POBEDNIK';
      else              top5Badge.textContent = 'POBEDNIK GIVEAWAYA';
    }

    ov.classList.remove('is-top5', 'is-final-champ', 'open');
    void ov.offsetWidth;
    if (isFinalChamp) ov.classList.add('is-final-champ');
    else if (isTop5)  ov.classList.add('is-top5');
    ov.classList.add('open');

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

    startParticles(isTop5, isFinalChamp);

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
        y: Math.random() * canvas.height - canvas.height,
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
          p.y = -20 - Math.random() * 100;
          p.x = Math.random() * canvas.width;
          p.vy = Math.random() * 3 + 2;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.scale(Math.cos(p.flip), 1);
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

  /* ── Tajmer potvrde pobednika (Apsolutni expiresAt, nikad se ne resetuje) ── */
  function startWinnerTimer(w) {
    if (w.timerId) clearInterval(w.timerId);

    const now = Date.now();
    const isPastExpires = typeof w.expiresAt === 'number' && now >= w.expiresAt;

    if (w.isExpired || isPastExpires || (typeof w.confirmSeconds === 'number' && w.confirmSeconds <= 0)) {
      w.confirmSeconds = 0;
      w.isExpired = true;
      w.timerId = null;
      updateSingleWinnerTimerUI(w);
      return;
    }

    w.timerId = setInterval(() => {
      const currentNow = Date.now();
      const rem = Math.max(0, Math.ceil((w.expiresAt - currentNow) / 1000));
      w.confirmSeconds = rem;
      w.savedAt = currentNow;

      if (rem <= 0) {
        w.confirmSeconds = 0;
        w.isExpired = true;
        clearInterval(w.timerId);
        w.timerId = null;
        updateSingleWinnerTimerUI(w);
        saveState();
      } else {
        updateSingleWinnerTimerUI(w);
      }
    }, 1000);
  }

  function updateSingleWinnerTimerUI(w) {
    const cleanId = String(w.username).replace(/[^a-zA-Z0-9_-]/g, '');
    const timerEl = document.getElementById(`w-timer-${cleanId}`);
    const barEl   = document.getElementById(`w-bar-${cleanId}`);
    const isExp   = !!w.isExpired || w.confirmSeconds <= 0;

    if (timerEl) {
      timerEl.textContent = isExp ? 'Isteklo' : `${w.confirmSeconds}s`;
      timerEl.classList.toggle('is-expired', isExp);
    }
    if (barEl) {
      const total = w.initialConfirmSeconds || settings.confirmTime || 60;
      const pct   = isExp ? 0 : Math.max(0, (w.confirmSeconds / total) * 100);
      barEl.style.width = pct + '%';
      barEl.classList.toggle('is-expired', isExp);
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
    winnersList.forEach((w, idx) => {
      const cleanId = String(w.username).replace(/[^a-zA-Z0-9_-]/g, '');
      const total = w.initialConfirmSeconds || settings.confirmTime || 60;
      const isExp = !!w.isExpired || w.confirmSeconds <= 0;
      const pct = isExp ? 0 : Math.max(0, (w.confirmSeconds / total) * 100);
      html += `
        <div class="winner-card-item">
          <div class="winner-name-row">
            <div class="winner-name">${trophySvg}<span>${escHtml(w.username)}</span></div>
            <div class="winner-name-right">
              <span class="winner-timer ${isExp ? 'is-expired' : ''}" id="w-timer-${cleanId}">${isExp ? 'Isteklo' : `${w.confirmSeconds}s`}</span>
              <button type="button" class="winner-remove-btn" onclick="window.removeWinner(${idx})" title="Obriši ovog pobednika">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
          <div class="winner-prize-tag">${giftSvg} <span>Nagrada: <strong>${escHtml(w.prize)}</strong></span></div>
          <div class="timer-bar-wrap"><div class="timer-bar-fill ${isExp ? 'is-expired' : ''}" id="w-bar-${cleanId}" style="width:${pct}%;"></div></div>
        </div>`;
    });
    container.innerHTML = html;
  }

  window.removeWinner = function (index) {
    const idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0 || idx >= winnersList.length) return;
    const removed = winnersList[idx];
    if (removed && removed.timerId) {
      clearInterval(removed.timerId);
      removed.timerId = null;
    }
    winnersList.splice(idx, 1);
    updateWinnersUI();
    refreshAll();
    saveState();
    showToast(`Pobednik ${removed?.username || ''} je uklonjen.`, 'info');
  };

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
    show('btnStageDraw', !isWheel);

    // Fullscreen stage
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
      ctx.fillText(isRunning ? 'Čekanje poruka iz chata...' : 'Pokreni giveaway...', cx, cy);
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

    const capRadius = Math.max(28, r * 0.18);
    ctx.beginPath();
    ctx.arc(0, 0, capRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#07050f';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#53fc18';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, capRadius * 0.85, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(83, 252, 24, 0.4)';
    ctx.stroke();

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

  /* ── Slot Draw ── */
  function drawSlotPreview(text = null) {
    const pool = getPoolList();
    const reelSets = [
      [document.getElementById('slotReel1'), document.getElementById('slotReel2'), document.getElementById('slotReel3'), document.getElementById('slotWinText')],
      [document.getElementById('slotReel1Fullscreen'), document.getElementById('slotReel2Fullscreen'), document.getElementById('slotReel3Fullscreen'), document.getElementById('slotWinTextFullscreen')]
    ];

    reelSets.forEach(([r1, r2, r3, wt]) => {
      if (pool.length === 0) {
        [r1, r2, r3].forEach(r => { if (r) r.innerHTML = '<div class="slot-symbol">---</div>'; });
        if (wt) wt.textContent = 'Čekanje učesnika...';
        return;
      }
      const sample = text || pool[0];
      [r1, r2, r3].forEach(r => { if (r) r.innerHTML = `<div class="slot-symbol">${escHtml(sample)}</div>`; });
      if (wt) wt.textContent = text ? `Izvučen: ${text}` : `Spremno (${pool.length} šanse)`;
    });
  }

  /* ── Roulette Draw ── */
  function drawRoulettePreview(highlightName = null) {
    const pool = getPoolList();
    const strips = [document.getElementById('rouletteStrip'), document.getElementById('rouletteStripFullscreen')];

    strips.forEach(strip => {
      if (!strip) return;
      if (pool.length === 0) { strip.innerHTML = '<div class="roulette-card">Čekanje učesnika...</div>'; return; }

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
    if (pool.length === 0) { showToast('Nema učesnika za izvlačenje!', 'error'); return; }
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
    applyPlanRestrictions();
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
    const dot   = document.getElementById('channelDot');
    const nameEl = document.getElementById('connectedChannelName');
    const safe  = escHtml(channelName || 'DemoKanal');

    if (nameEl) nameEl.textContent = safe;

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

    updateStartButtonUI();
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
      <button class="toast-close" onclick="window.removeToast(${id})" aria-label="Zatvori">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>`;

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
    let s = String(raw).trim().replace(/^https?:\/\/(www\.)?kick\.com\//, '').replace(/^kick_user_/, '').replace(/^@/, '');
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