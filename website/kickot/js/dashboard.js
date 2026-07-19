/* ═══════════════════════════════════════════════════════════
   Kickot Dashboard — app logic (dashboard.js)
   Supabase CRUD + Real-time + UI
   ═══════════════════════════════════════════════════════════ */

// ── Supabase Init ──────────────────────────────────────────
const SUPABASE_URL = 'https://rcukparptzzyssqdmydt.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjdWtwYXJwdHp6eXNzcWRteWR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0Nzc3NzEsImV4cCI6MjA5OTA1Mzc3MX0.5FLpFchORq6h5O0q5HWWYBiRD6qCPZKGjx3Zo4UhlJc';
const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ─────────────────────────────────────────────────
let currentUser = null;
let currentChannels = [];   // [{id, username, is_primary}]
let managedChannels = [];   // [{id, username, avatar, is_managed: true, owner_id}]
let activeChannel = null; // {id, username}
function getChannelOwnerId() {
  if (activeChannel && activeChannel.is_managed && activeChannel.owner_id) {
    return activeChannel.owner_id;
  }
  return currentUser ? currentUser.id : null;
}
let allCommands = [];   // cached custom commands
let allLeaderboard = [];   // cached leaderboard rows
let allWatchtime = [];   // cached watchtime rows
let allMarriages = [];   // cached marriages
let allLoveStatuses = [];  // cached love modifiers
const avatarCache = {};
let currentModFiltersSettings = {};

async function getOrFetchAvatar(username, elementId) {
  if (!username) return;
  const key = username.toLowerCase();

  if (avatarCache[key] && avatarCache[key] !== 'loading' && avatarCache[key] !== 'none') {
    updateAvatarUI(elementId, avatarCache[key]);
    return;
  }

  const cachedLocal = localStorage.getItem(`avatar-cache-${key}`);
  if (cachedLocal && cachedLocal !== 'none') {
    avatarCache[key] = cachedLocal;
    updateAvatarUI(elementId, cachedLocal);
    return;
  }

  if (avatarCache[key] === 'loading') {
    const interval = setInterval(() => {
      if (avatarCache[key] !== 'loading') {
        clearInterval(interval);
        if (avatarCache[key] && avatarCache[key] !== 'none') {
          updateAvatarUI(elementId, avatarCache[key]);
        }
      }
    }, 500);
    return;
  }

  avatarCache[key] = 'loading';
  const avatarUrl = await fetchKickAvatar(username);
  if (avatarUrl) {
    avatarCache[key] = avatarUrl;
    try {
      localStorage.setItem(`avatar-cache-${key}`, avatarUrl);
    } catch (_) { }
    updateAvatarUI(elementId, avatarUrl);
  } else {
    avatarCache[key] = 'none';
    try {
      localStorage.setItem(`avatar-cache-${key}`, 'none');
    } catch (_) { }
  }
}

function updateAvatarUI(elementId, avatarUrl) {
  const el = document.getElementById(elementId);
  if (el) {
    el.style.backgroundImage = `url("${avatarUrl}")`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.border = '1px solid rgba(255,255,255,0.15)';
    el.textContent = '';
  }
}

function formatPorukeCount(count) {
  const n = Math.abs(count || 0) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) {
    return `${count} poruka`;
  }
  if (n1 === 1) {
    return `${count} poruka`;
  }
  if (n1 >= 2 && n1 <= 4) {
    return `${count} poruke`;
  }
  return `${count} poruka`;
}

let editingCmdId = null; // null = new, UUID = edit
let confirmCallback = null;
let realtimeSub = null;
let configLoaded = false;
let localAnnounces = [];   // cached auto-announce messages
let activeLeaderboardType = localStorage.getItem('active-leaderboard-tab') || 'combined'; // 'chatters', 'watchtime', 'combined'
let activeMiniLbTab = 'combined'; // 'combined', 'chatters', 'watchtime'
let activeCommandsTab = 'custom'; // only custom commands are used now
let liveStatusInterval = null; // polling interval for live status
let leaderboardPage = 1;
let leaderboardLimit = parseInt(localStorage.getItem('lb-items-per-page')) || 15;
let commandsPage = 1;
let commandsLimit = parseInt(localStorage.getItem('cmd-items-per-page')) || 10;

// ═══════════════════════════════════════════════════════════
// AUTH GUARD
// ═══════════════════════════════════════════════════════════
async function initAuth() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const oauthError = urlParams.get('error');

    if (oauthError) {
      document.getElementById('authGateMsg').textContent = 'Kick odbio autorizaciju...';
      showToast('error', `Kick odbio autorizaciju: ${oauthError}`, '❌');
      setTimeout(() => { window.location.href = 'index.html'; }, 2000);
      return;
    }

    if (code) {
      document.getElementById('authGateMsg').textContent = 'Autorizacija u toku...';
      
      const savedState = sessionStorage.getItem('kick_oauth_state') || localStorage.getItem('kick_oauth_state');
      const stateParam = urlParams.get('state');
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      
      if (!isLocalhost && (!stateParam || stateParam !== savedState)) {
        document.getElementById('authGateMsg').textContent = 'Nevalidan state parametar...';
        showToast('error', 'State parametar se ne podudara.', '❌');
        setTimeout(() => { window.location.href = 'index.html'; }, 2000);
        return;
      }

      const codeVerifier = sessionStorage.getItem('kick_code_verifier') || localStorage.getItem('kick_code_verifier') || '';
      const redirectUri = (() => {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
          return `${window.location.origin}/auth/kick/callback/`;
        }
        return `${window.location.origin}/auth/kick/callback`;
      })();

      const kickApiBase = (() => {
        const fromGlobal = (window.KICK_API_BASE || '').trim();
        if (fromGlobal) return fromGlobal.replace(/\/+$/, '');
        if (window.location.hostname.endsWith('netlify.app') || 
            window.location.hostname === 'localhost' || 
            window.location.hostname === '127.0.0.1') {
          return 'https://kickbot-ihzb.onrender.com';
        }
        return `${window.location.origin}`;
      })();

      try {
        const res = await fetch(`${kickApiBase}/api/kick/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri
          }).toString()
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Nepoznata greška' }));
          document.getElementById('authGateMsg').textContent = 'Greška pri autorizaciji...';
          showToast('error', err.detail || err.error || 'Server nedostupan', '❌');
          setTimeout(() => { window.location.href = 'index.html'; }, 3000);
          return;
        }

        const tokenData = await res.json();
        if (!tokenData.access_token) {
          document.getElementById('authGateMsg').textContent = 'Token nije primljen...';
          showToast('error', 'Nije primljen access_token', '❌');
          setTimeout(() => { window.location.href = 'index.html'; }, 3000);
          return;
        }

        sessionStorage.setItem('kick_access_token', tokenData.access_token);
        
        const intent = sessionStorage.getItem('kick_oauth_intent') || 'login';
        const addChannelUid = sessionStorage.getItem('kick_add_channel_uid') || '';

        sessionStorage.removeItem('kick_oauth_state');
        sessionStorage.removeItem('kick_code_verifier');
        sessionStorage.removeItem('kick_oauth_intent');
        sessionStorage.removeItem('kick_add_channel_uid');
        sessionStorage.removeItem('kick_oauth_source');
        localStorage.removeItem('kick_oauth_state');
        localStorage.removeItem('kick_code_verifier');

        if (intent === 'add_channel' && addChannelUid) {
          document.getElementById('authGateMsg').textContent = 'Dodavanje kanala...';

          const { data: { session } } = await sb.auth.getSession();
          if (session) {
            currentUser = session.user;
          } else {
            currentUser = { id: addChannelUid };
          }

          const userRes = await fetch(`${kickApiBase}/api/kick/me`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
          });

          let kickUser = null;
          if (userRes.ok) {
            kickUser = await userRes.json();
          }

          if (!kickUser || (!kickUser.id && !kickUser.chatroom_id)) {
            document.getElementById('authGateMsg').textContent = 'Greška: podaci kanala nedostupni...';
            showToast('error', 'Nije moguće preuzeti podatke kanala sa Kick platforme.', '❌');
            setTimeout(() => { window.location.href = 'dashboard.html?settings=channels'; }, 3000);
            return;
          }

          const { data: profile } = await sb.from('user_profiles')
            .select('kick_channels')
            .eq('id', addChannelUid)
            .maybeSingle();

          const existingChannels = profile?.kick_channels || [];
          const channelId = String(kickUser.chatroom_id || kickUser.id);
          const channelSlug = kickUser.slug || kickUser.username || channelId;

          if (existingChannels.some(c => c.id === channelId)) {
            showToast('info', `@${channelSlug} je već dodat na tvoj profil.`, 'ℹ️');
            const cleanUrl = window.location.pathname + '?settings=channels';
            window.history.replaceState({}, '', cleanUrl);
            await initApp();
            return;
          }

          const newChannel = {
            id: channelId,
            username: channelSlug,
            avatar: kickUser.avatar || kickUser.profile_pic || null,
            is_primary: existingChannels.length === 0,
            kick_access_token: tokenData.access_token
          };

          const updatedChannels = [...existingChannels, newChannel];

          const { error: dbErr } = await sb.from('user_profiles')
            .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
            .eq('id', addChannelUid);

          if (dbErr) {
            document.getElementById('authGateMsg').textContent = 'Greška pri čuvanju u bazu...';
            showToast('error', dbErr.message, '❌');
            setTimeout(() => { window.location.href = 'dashboard.html?settings=channels'; }, 3000);
            return;
          }

          showToast('success', `Kanal @${channelSlug} uspešno dodat!`, '✅');
          const cleanUrl = window.location.pathname + '?settings=channels';
          window.history.replaceState({}, '', cleanUrl);
          await initApp();
          return;
        }

        await handleKickOAuthSession(tokenData.access_token);
        return;
      } catch (err) {
        document.getElementById('authGateMsg').textContent = 'Greška pri autorizaciji...';
        showToast('error', err.message, '❌');
        setTimeout(() => { window.location.href = 'index.html'; }, 3000);
        return;
      }
    }

    // ── Standardna provera tokena ──────────────────────────────────────
    const kickAccessToken = sessionStorage.getItem('kick_access_token');
    const urlParamsOAuth = urlParams.get('kick_oauth') === '1';

    if (urlParamsOAuth && kickAccessToken) {
      document.getElementById('authGateMsg').textContent = 'Učitavamo tvoj Kick profil...';
      try {
        await handleKickOAuthSession(kickAccessToken);
        return;
      } catch (kickErr) {
        console.warn('Kick OAuth sesija nije uspela, proveravamo standardnu sesiju:', kickErr);
      }
    }

    // ── Standardna Supabase sesija ─────────────────────────────────────
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      document.getElementById('authGateMsg').textContent = 'Preusmeravanje na prijavu...';
      setTimeout(() => { window.location.href = 'index.html?login=1'; }, 1200);
      return;
    }
    currentUser = session.user;
    await initApp();
  } catch (err) {
    document.getElementById('authGateMsg').textContent = 'Greška pri proveri sesije.';
    console.error(err);
  }
}

// ── Kick OAuth sesija ─────────────────────────────────────────────────────
async function handleKickOAuthSession(accessToken) {
  const gateMsg = document.getElementById('authGateMsg');

  // 1. Dohvati Kick korisnički profil koristeći access_token
  gateMsg.textContent = 'Dohvatamo podatke sa Kick platforme...';
  const kickUserRes = await fetch('https://api.kick.com/public/v1/users', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  let kickUsername = '';
  let kickUserId   = '';
  let kickAvatar   = '';
  let kickBio      = '';

  if (kickUserRes.ok) {
    const kickData = await kickUserRes.json();
    const kickUser = Array.isArray(kickData?.data) ? kickData.data[0] : kickData?.data || kickData;
    kickUsername = kickUser?.username || kickUser?.name || '';
    kickUserId   = kickUser?.user_id  || kickUser?.id   || '';
    kickAvatar   = kickUser?.profile_picture || kickUser?.profile_pic || '';
    kickBio      = kickUser?.bio || '';
  } else {
    console.warn('Kick users API nije vratio uspeh, pokušavamo alternativni endpoint...');
    // Alternativni endpoint
    const altRes = await fetch('https://id.kick.com/oauth/userinfo', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (altRes.ok) {
      const altData = await altRes.json();
      kickUsername = altData?.preferred_username || altData?.name || altData?.sub || '';
      kickUserId   = altData?.sub || '';
      kickAvatar   = altData?.picture || '';
    }
  }

  if (!kickUsername) {
    throw new Error('Nije moguće dohvatiti Kick korisničko ime.');
  }

  gateMsg.textContent = `Dobrodošao, @${kickUsername}! Priprema naloga...`;

  // 2. Proveri da li u Supabase-u već postoji nalog za ovog Kick korisnika
  const kickEmail = `kick_user_${kickUsername.toLowerCase()}@kickot.com`;

  // Pokušaj prijave sa postojećim nalogom
  const { data: signInData, error: signInError } = await sb.auth.signInWithPassword({
    email: kickEmail,
    password: `kick_oauth_${kickUsername.toLowerCase()}_kickot_2026`
  });

  if (!signInError && signInData?.user) {
    // Postoji nalog — ažuriraj kick_channels i access_token
    currentUser = signInData.user;
    await upsertKickProfile(currentUser.id, kickUsername, kickAvatar, kickUserId, accessToken);
    sessionStorage.removeItem('kick_access_token');
    // Ukloni kick_oauth param iz URL-a
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);
    await initApp();
    return;
  }

  // 3. Novi korisnik — kreiraj Supabase nalog
  gateMsg.textContent = 'Kreiramo nalog...';
  const password = `kick_oauth_${kickUsername.toLowerCase()}_kickot_2026`;

  const { data: signUpData, error: signUpError } = await sb.auth.signUp({
    email: kickEmail,
    password: password,
    options: {
      data: {
        display_name:  kickUsername,
        avatar_url:    kickAvatar,
        kick_username: kickUsername,
        kick_user_id:  kickUserId
      }
    }
  });

  if (signUpError) {
    throw new Error(`Greška pri kreiranju naloga: ${signUpError.message}`);
  }

  const user = signUpData?.user;
  if (!user) {
    throw new Error('Nalog nije kreiran — Supabase nije vratio korisnika.');
  }

  currentUser = user;

  // Kreiraj profil u user_profiles tabeli
  const channelId = String(kickUserId || `kick_${kickUsername.toLowerCase()}`);
  const { error: profileError } = await sb.from('user_profiles').upsert({
    id:           user.id,
    display_name: kickUsername,
    email:        kickEmail,
    plan:         'free',
    kick_channels: [{
      id:         channelId,
      username:   kickUsername,
      avatar:     kickAvatar || null,
      is_primary: true,
      kick_access_token: accessToken
    }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: 'id' });

  if (profileError) {
    console.error('Greška pri kreiranju user_profiles:', profileError);
  }

  // Odmah prijavi novog korisnika
  const { data: loginAfterSignup, error: loginAfterErr } = await sb.auth.signInWithPassword({
    email: kickEmail,
    password: password
  });

  if (!loginAfterErr && loginAfterSignup?.user) {
    currentUser = loginAfterSignup.user;
  }

  sessionStorage.removeItem('kick_access_token');
  const cleanUrl = window.location.pathname;
  window.history.replaceState({}, '', cleanUrl);
  await initApp();
}

// Ažurira Kick profil podatke u Supabase-u
async function upsertKickProfile(userId, kickUsername, kickAvatar, kickUserId, accessToken) {
  try {
    const { data: profile } = await sb.from('user_profiles')
      .select('kick_channels')
      .eq('id', userId)
      .maybeSingle();

    const existingChannels = (profile?.kick_channels) || [];
    const usernameLC = kickUsername.toLowerCase();
    const channelId  = String(kickUserId || `kick_${usernameLC}`);

    const idx = existingChannels.findIndex(ch => (ch.username || '').toLowerCase() === usernameLC);
    if (idx >= 0) {
      existingChannels[idx].avatar = kickAvatar || existingChannels[idx].avatar;
      existingChannels[idx].kick_access_token = accessToken;
    } else {
      existingChannels.push({
        id:         channelId,
        username:   kickUsername,
        avatar:     kickAvatar || null,
        is_primary: existingChannels.length === 0,
        kick_access_token: accessToken
      });
    }

    await sb.from('user_profiles').update({
      kick_channels: existingChannels,
      updated_at:    new Date().toISOString()
    }).eq('id', userId);
  } catch (err) {
    console.warn('Nije moguće ažurirati Kick profil:', err);
  }
}

sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') { window.location.href = 'index.html'; }
});

// ═══════════════════════════════════════════════════════════
// APP INIT
// ═══════════════════════════════════════════════════════════
async function initApp() {
  // Load user profile + channels
  await loadUserProfile();

  // Show app
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('app').style.display = 'grid';

  // Sidebar avatar/name
  const name = currentUser.user_metadata?.display_name || currentUser.email?.split('@')[0] || 'User';
  const avatarVal = currentUser.user_metadata?.avatar_url || name.charAt(0).toUpperCase();
  const sidebarAvEl = document.getElementById('sidebarAvatar');
  if (avatarVal.startsWith('data:image') || avatarVal.startsWith('http')) {
    sidebarAvEl.style.backgroundImage = `url("${avatarVal}")`;
    sidebarAvEl.style.backgroundSize = 'cover';
    sidebarAvEl.style.backgroundPosition = 'center';
    sidebarAvEl.textContent = '';
  } else {
    sidebarAvEl.style.backgroundImage = 'none';
    sidebarAvEl.textContent = avatarVal;
  }
  document.getElementById('sidebarName').textContent = name;

  // Set initial leaderboard tab from state (loaded from localStorage)
  setLeaderboardType(activeLeaderboardType);

  // Load initial panel
  if (activeChannel) {
    loadAllData();
    let lastPanel = 'overview';
    const sessionActive = sessionStorage.getItem('dashboard-session-active');
    if (sessionActive) {
      lastPanel = localStorage.getItem('active-dashboard-panel') || 'overview';
    } else {
      sessionStorage.setItem('dashboard-session-active', 'true');
      localStorage.setItem('active-dashboard-panel', 'overview');
    }
    if (lastPanel === 'no-channel') {
      lastPanel = 'overview';
    }
    switchPanel(lastPanel);
  } else {
    // No channel configured — prompt
    showNoChannelState();
  }

  populateMonthSelector();

  // Proveri da li treba otvoriti settings modal na tabu za kanale
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('settings') === 'channels') {
    openSettingsModal('channels');
    // Ukloni parametre iz URL-a
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);
  }

  setupAutosave();
}

// ── User Profile ──────────────────────────────────────────
async function loadUserProfile() {
  const { data, error } = await sb.from('user_profiles')
    .select('display_name, plan, kick_channels')
    .eq('id', currentUser.id)
    .maybeSingle();

  let myUsername = '';
  if (data) {
    myUsername = data.display_name || '';
    document.getElementById('sidebarPlan').textContent =
      (data.plan || 'free').charAt(0).toUpperCase() + (data.plan || 'free').slice(1);

    currentChannels = data.kick_channels || [];

    // Fetch avatars for channels that don't have one yet
    const needsAvatar = currentChannels.filter(c => !c.avatar);
    if (needsAvatar.length > 0) {
      let updated = false;
      await Promise.all(needsAvatar.map(async (ch) => {
        const resolved = await fetchKickAvatar(ch.username);
        if (resolved) {
          ch.avatar = resolved;
          updated = true;
        }
      }));

      // Save updated channels with avatars back to db
      if (updated) {
        await sb.from('user_profiles')
          .update({ kick_channels: currentChannels })
          .eq('id', currentUser.id);
      }
    }
  }

  // Učitavanje kanala kojima upravljamo (menadžeri)
  managedChannels = [];
  try {
    const { data: allProfiles } = await sb.from('user_profiles').select('*');
    if (allProfiles && myUsername) {
      allProfiles.forEach(p => {
        if (p.id === currentUser.id) return; // preskoči sopstveni profil
        const channels = p.kick_channels || [];
        channels.forEach(ch => {
          if (ch.managers && ch.managers.map(m => m.toLowerCase()).includes(myUsername.toLowerCase())) {
            managedChannels.push({
              ...ch,
              owner_id: p.id,
              is_managed: true
            });
          }
        });
      });
    }
  } catch (err) {
    console.error('Failed to load managed channels:', err);
  }

  if (currentChannels.length > 0) {
    const primary = currentChannels.find(c => c.is_primary) || currentChannels[0];
    setActiveChannel(primary);
  } else if (managedChannels.length > 0) {
    setActiveChannel(managedChannels[0]);
  } else {
    // No channel configured — prompt
    showNoChannelState();
  }

  renderChannelList();
}

async function fetchKickAvatar(username) {
  // 1. Pokušaj preko lokalnog bot API servera (koristi got-scraping, radi 100% bez Cloudflare blokade)
  try {
    const localRes = await fetch(`${getBotApiBase()}/api/avatar?username=${username}`);
    if (localRes.ok) {
      const localData = await localRes.json();
      if (localData?.avatar) {
        return localData.avatar;
      }
    }
  } catch (_) { }

  const apiUrl = `https://kick.com/api/v2/channels/${username}`;

  const proxies = [
    // 1. Allorigins (usually very reliable, has cached copies)
    {
      name: 'allorigins',
      url: `https://api.allorigins.win/get?url=${encodeURIComponent(apiUrl)}`,
      parse: async (res) => {
        const json = await res.json();
        const data = json.contents ? JSON.parse(json.contents) : null;
        return data?.user?.profile_pic || null;
      }
    },
    // 2. Corsproxy.io
    {
      name: 'corsproxy.io',
      url: `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`,
      parse: async (res) => {
        const data = await res.json();
        return data?.user?.profile_pic || null;
      }
    },
    // 3. Codetabs
    {
      name: 'codetabs',
      url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(apiUrl)}`,
      parse: async (res) => {
        const data = await res.json();
        return data?.user?.profile_pic || null;
      }
    },
    // 4. Thingproxy
    {
      name: 'thingproxy',
      url: `https://thingproxy.freeboard.io/fetch/${apiUrl}`,
      parse: async (res) => {
        const data = await res.json();
        return data?.user?.profile_pic || null;
      }
    }
  ];

  return new Promise((resolve) => {
    let completed = 0;
    let resolved = false;

    proxies.forEach(proxy => {
      fetch(proxy.url)
        .then(async (res) => {
          if (res.ok && !resolved) {
            const pic = await proxy.parse(res);
            if (pic && !resolved) {
              resolved = true;
              resolve(pic);
            }
          }
        })
        .catch(() => { })
        .finally(() => {
          completed++;
          if (completed === proxies.length && !resolved) {
            resolve(null);
          }
        });
    });

    // Safeguard timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, 6000);
  });
}

function setActiveChannel(ch) {
  activeChannel = ch;
  document.getElementById('channelNameDisplay').textContent = ch.username;
  updateLiveStatusUI(false); // Resetuj na offline po defaultu kako ne bi flešovalo prethodno stanje

  const avatarEl = document.getElementById('channelAvatar');
  if (avatarEl) {
    if (ch.avatar) {
      avatarEl.style.backgroundImage = `url("${ch.avatar}")`;
      avatarEl.style.backgroundSize = 'cover';
      avatarEl.style.backgroundPosition = 'center';
      avatarEl.textContent = '';
    } else {
      avatarEl.style.backgroundImage = 'none';
      avatarEl.textContent = ch.username.charAt(0).toUpperCase();
    }
  }

  const topbarCh = document.getElementById('topbarChannel');
  if (topbarCh) topbarCh.textContent = `@${ch.username}`;
  const cmdBadge = document.getElementById('cmdPrefixBadge');
  if (cmdBadge) cmdBadge.textContent = '!';

  // Ako je sidebar bio sakriven (showNoChannelState), vrati ga
  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebar.style.display === 'none') {
    sidebar.style.display = '';
  }
  // Vrati mainContent na normalan grid layout
  const mainContent = document.getElementById('mainContent');
  if (mainContent && mainContent.style.gridColumn) {
    mainContent.style.gridColumn = '';
  }
}

function renderChannelList() {
  const list = document.getElementById('channelList');
  if (!list) return;
  list.innerHTML = '';

  // 1. Tvoji kanali (own channels)
  const ownHeader = document.createElement('div');
  ownHeader.style = 'padding: 6px 12px 2px; font-size: 0.7rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid rgba(255,255,255,0.03); margin-bottom: 4px;';
  ownHeader.textContent = 'Tvoji kanali';
  list.appendChild(ownHeader);

  if (currentChannels.length === 0) {
    const emptyOwn = document.createElement('div');
    emptyOwn.style = 'padding: 6px 12px; font-size: 0.8rem; color: var(--text-muted);';
    emptyOwn.textContent = 'Nema dodatih kanala';
    list.appendChild(emptyOwn);
  } else {
    currentChannels.forEach(ch => {
      const div = document.createElement('div');
      div.className = 'channel-option' + (activeChannel?.id === ch.id ? ' selected' : '');

      const avatarHtml = ch.avatar
        ? `<div class="channel-avatar" style="width:22px;height:22px;background-image:url('${ch.avatar}');background-size:cover;background-position:center;border-radius:50%"></div>`
        : `<div class="channel-avatar" style="width:22px;height:22px;font-size:0.65rem;border-radius:50%">${ch.username.charAt(0).toUpperCase()}</div>`;

      div.innerHTML = `
        ${avatarHtml}
        <span class="ch-name">${ch.username}</span>
        ${activeChannel?.id === ch.id ? '<span class="ch-check">✓</span>' : ''}
      `;
      div.onclick = () => selectChannel(ch);
      list.appendChild(div);
    });
  }

  // 2. Kanali kojima upravljaš (managed channels)
  const managedHeader = document.createElement('div');
  managedHeader.style = 'padding: 10px 12px 2px; font-size: 0.7rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid rgba(255,255,255,0.03); margin-bottom: 4px;';
  managedHeader.textContent = 'Kanali kojima upravljaš';
  list.appendChild(managedHeader);

  if (managedChannels.length === 0) {
    const emptyManaged = document.createElement('div');
    emptyManaged.style = 'padding: 6px 12px; font-size: 0.8rem; color: var(--text-muted);';
    emptyManaged.textContent = 'Nema kanala za upravljanje';
    list.appendChild(emptyManaged);
  } else {
    managedChannels.forEach(ch => {
      const div = document.createElement('div');
      div.className = 'channel-option' + (activeChannel?.id === ch.id ? ' selected' : '');

      const avatarHtml = ch.avatar
        ? `<div class="channel-avatar" style="width:22px;height:22px;background-image:url('${ch.avatar}');background-size:cover;background-position:center;border-radius:50%"></div>`
        : `<div class="channel-avatar" style="width:22px;height:22px;font-size:0.65rem;border-radius:50%">${ch.username.charAt(0).toUpperCase()}</div>`;

      div.innerHTML = `
        ${avatarHtml}
        <span class="ch-name" style="display: flex; align-items: center; gap: 4px;">
          ${ch.username} 
          <svg style="width: 13px; height: 13px; fill: none; stroke: #a78bfa; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; display: inline-block;" viewBox="0 0 24 24" title="Menadžer kanala">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
          </svg>
        </span>
        ${activeChannel?.id === ch.id ? '<span class="ch-check">✓</span>' : ''}
      `;
      div.onclick = () => selectChannel(ch);
      list.appendChild(div);
    });
  }
}

async function selectChannel(ch) {
  setActiveChannel(ch);
  renderChannelList();
  toggleChannelMenu();
  await loadAllData();
}

function bindEnterKey(inputId, buttonId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const btn = document.getElementById(buttonId);
        if (btn) btn.click();
      }
    });
  }
}

function showNoChannelState() {
  // Sakrij sidebar kad nema kanala
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.style.display = 'none';

  const mainContent = document.getElementById('mainContent');
  if (mainContent) {
    mainContent.style.gridColumn = '1 / -1'; // zauzmi pun prostor
  }

  // Prebaci panel na no-channel
  switchPanel('no-channel');

  // Poveži dugme
  const addBtn = document.getElementById('noChannelAddBtn');
  if (addBtn) {
    const newBtn = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newBtn, addBtn);
    newBtn.addEventListener('click', () => showAddChannelModal());
  }
}

// ── Channel Management ────────────────────────────────────
function extractKickUsername(input) {
  let val = input.trim();
  // Ukloni URL delove
  val = val.replace(/https?:\/\/(www\.)?kick\.com\//i, '');
  // Ukloni eventualni @ na početku
  val = val.replace(/^@/, '');
  // Uzmi samo prvi deo do sledećeg kosog poteza ili space-a ili upitnika
  val = val.split(/[/?\s]/)[0];
  return val.toLowerCase();
}

async function resolveChatroomId(username) {
  const apiUrl = `https://kick.com/api/v2/channels/${username}`;

  // 1. Pokušavamo preko lokalnog bota
  try {
    const localRes = await fetch(`${getBotApiBase()}/api/avatar?username=${username}`);
    if (localRes.ok) {
      const localData = await localRes.json();
      if (localData && localData.chatroom_id) {
        return {
          id: localData.chatroom_id.toString(),
          username: localData.slug || username,
          avatar: localData.avatar || null,
          bio: localData.bio || ''
        };
      }
    }
  } catch (_) { }

  // 2. Pokušavamo preko corsproxy.io
  try {
    const proxyUrl = `https://corsproxy.io/?` + encodeURIComponent(apiUrl);
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && data.chatroom && data.chatroom.id) {
        return {
          id: data.chatroom.id.toString(),
          username: data.slug || username,
          avatar: data.user?.profile_pic || null,
          bio: data.user?.bio || ''
        };
      }
    }
  } catch (err) {
    console.warn('corsproxy.io failed, trying fallback...', err);
  }

  // 3. Pokušavamo preko allorigins.win
  try {
    const fallbackUrl = `https://api.allorigins.win/get?url=` + encodeURIComponent(apiUrl);
    const res = await fetch(fallbackUrl);
    if (res.ok) {
      const resData = await res.json();
      if (resData && resData.contents) {
        const data = JSON.parse(resData.contents);
        if (data && data.chatroom && data.chatroom.id) {
          return {
            id: data.chatroom.id.toString(),
            username: data.slug || username,
            avatar: data.user?.profile_pic || null,
            bio: data.user?.bio || ''
          };
        }
      }
    }
  } catch (err) {
    console.error('All fallbacks failed for resolving channel:', err);
  }

  return null;
}

// ── Verifikacioni tok za dodavanje kanala ─────────────────
let _addChannelPending = null; // { resolved, verificationCode }

function showAddChannelModal() {
  openSettingsModal('channels');
}

function renderAddChannelStep1(errorMsg = '') {
  const body = document.getElementById('addChannelModalBody');
  if (!body) return;
  body.innerHTML = `
    <div class="form-group" style="margin-bottom:16px;">
      <label class="form-label">Kick username ili URL kanala</label>
      <input type="text" class="form-input" id="newChannelInput"
        placeholder="npr. milan-567 ili https://kick.com/milan-567" />
      <span class="config-hint">Unesi korisničko ime kanala ili puni link do Kick profila</span>
    </div>
    ${errorMsg ? `<div class="form-alert" style="display:block;color:#EF4444;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);padding:10px 14px;border-radius:8px;font-size:0.85rem;margin-bottom:12px;">${errorMsg}</div>` : ''}
    <div class="modal-foot" style="padding:0; margin-top:8px; border:none; background:none; display:flex; gap:10px; justify-content:flex-end;">
      <button class="btn btn-outline" onclick="closeModal('addChannelModal')">Otkaži</button>
      <button class="btn btn-primary" id="addChannelBtn" onclick="addChannelStep1()">
        <span class="btn-spinner" id="addChannelBtnSpinner" style="display:none; width:14px; height:14px; border:2px solid rgba(0,0,0,0.3); border-top-color:#000; border-radius:50%; animation:spin 0.7s linear infinite;"></span>
        <span>Nastavi</span>
      </button>
    </div>
  `;
  const inp = document.getElementById('newChannelInput');
  if (inp) {
    inp.focus();
    bindEnterKey('newChannelInput', 'addChannelBtn');
  }
}

function renderAddChannelStep2(channelName, verificationCode, errorMsg = '') {
  const body = document.getElementById('addChannelModalBody');
  const titleEl = document.getElementById('addChannelModalTitle');
  if (!body) return;
  if (titleEl) titleEl.textContent = 'Verifikuj vlasništvo';
  body.innerHTML = `
    <p style="color:var(--color-text-muted); font-size:0.9rem; line-height:1.6; margin-bottom:14px;">
      Da potvrdimo da si vlasnik kanala <strong style="color:var(--color-text);">@${channelName}</strong>, stavi ovaj kod 
      <strong>bilo gde</strong> u opis (Bio/About) svog Kick profila:
    </p>
    <div style="background:rgba(83,252,24,0.08); border:1px dashed rgba(83,252,24,0.5); padding:14px; border-radius:10px; font-family:monospace; font-size:1.1rem; font-weight:700; color:#53fc18; text-align:center; margin-bottom:16px; letter-spacing:1px; user-select:all;">
      ${verificationCode}
    </div>
    <p style="color:var(--color-text-muted); font-size:0.82rem; line-height:1.5; margin-bottom:16px;">
      💡 Kod možeš staviti uz ostali tekst, npr:<br>
      <em style="color:var(--color-text-secondary);">"Profesionalni streamer 🔥 ${verificationCode}"</em><br>
      Nakon verifikacije možeš ukloniti kod iz opisa.
    </p>
    ${errorMsg ? `<div class="form-alert" style="display:block;color:#EF4444;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);padding:10px 14px;border-radius:8px;font-size:0.85rem;margin-bottom:12px;">${errorMsg}</div>` : ''}
    <div class="modal-foot" style="padding:0; margin-top:8px; border:none; background:none; display:flex; gap:10px; justify-content:flex-end;">
      <button class="btn btn-outline" onclick="renderAddChannelStep1()">Nazad</button>
      <button class="btn btn-primary" id="addChannelVerifyBtn" onclick="addChannelVerify()">
        <span class="btn-spinner" id="addChannelVerifySpinner" style="display:none; width:14px; height:14px; border:2px solid rgba(0,0,0,0.3); border-top-color:#000; border-radius:50%; animation:spin 0.7s linear infinite;"></span>
        <span>Verifikuj i dodaj</span>
      </button>
    </div>
  `;
}

async function addChannelStep1() {
  const inp = document.getElementById('newChannelInput');
  const rawInput = inp ? inp.value.trim() : '';

  if (!rawInput) {
    renderAddChannelStep1('Unesi Kick username ili link kanala.');
    return;
  }

  const username = extractKickUsername(rawInput);
  if (!username) {
    renderAddChannelStep1('Nevalidan unos kanala.');
    return;
  }

  // Loading state
  const btn = document.getElementById('addChannelBtn');
  const spinner = document.getElementById('addChannelBtnSpinner');
  if (btn) btn.disabled = true;
  if (spinner) spinner.style.display = 'inline-block';

  const resolved = await resolveChatroomId(username);

  if (btn) btn.disabled = false;
  if (spinner) spinner.style.display = 'none';

  if (!resolved) {
    renderAddChannelStep1(`Kanal "${username}" nije pronađen na Kick platformi. Proveri ispravnost.`);
    return;
  }

  if (currentChannels.some(c => c.id === resolved.id)) {
    renderAddChannelStep1('Ovaj kanal je već dodat na tvoj nalog.');
    return;
  }

  // Provera da li je ovaj Kick kanal već registrovan na nekom drugom nalogu
  const { data: taken, error: checkErr } = await sb.from('user_profiles')
    .select('id')
    .contains('kick_channels', [{ id: resolved.id }]);

  if (!checkErr && taken && taken.length > 0) {
    renderAddChannelStep1('Ovaj kanal je već povezan sa drugim nalogom.');
    return;
  }

  // Generiši verifikacioni kod i idi na korak 2
  const verificationCode = `kickot-${Math.floor(100000 + Math.random() * 900000)}`;
  _addChannelPending = { resolved, verificationCode };
  renderAddChannelStep2(resolved.username, verificationCode);
}

async function addChannelVerify() {
  if (!_addChannelPending) return;

  const { resolved, verificationCode } = _addChannelPending;
  const { id: channelId, username: channelName } = resolved;

  const btn = document.getElementById('addChannelVerifyBtn');
  const spinner = document.getElementById('addChannelVerifySpinner');
  if (btn) btn.disabled = true;
  if (spinner) spinner.style.display = 'inline-block';

  // Ponovo povuci svež bio da proverimo kod
  const freshResolved = await resolveChatroomId(channelName);
  const freshBio = freshResolved?.bio || '';

  if (btn) btn.disabled = false;
  if (spinner) spinner.style.display = 'none';

  if (!freshBio.toLowerCase().includes(verificationCode.toLowerCase())) {
    renderAddChannelStep2(channelName, verificationCode,
      'Verifikacioni kod nije pronađen u tvom Kick opisu (Bio/About). Stavi kod u bio i pokušaj ponovo.');
    return;
  }

  // Bio proveren — dodaj kanal
  if (btn) btn.disabled = true;
  if (spinner) spinner.style.display = 'inline-block';

  const newChannel = {
    id: channelId,
    username: channelName,
    avatar: resolved.avatar || null,
    is_primary: currentChannels.length === 0
  };

  const updatedChannels = [...currentChannels, newChannel];

  const { error } = await sb.from('user_profiles')
    .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
    .eq('id', currentUser.id);

  if (error) {
    renderAddChannelStep2(channelName, verificationCode,
      'Greška pri čuvanju kanala u bazu. Pokušaj ponovo.');
    return;
  }

  currentChannels = updatedChannels;
  _addChannelPending = null;
  setActiveChannel(newChannel);
  renderChannelList();
  closeModal('addChannelModal');
  showToast('success', `Kanal @${channelName} je uspešno dodat i verifikovan!`, '✅');
  await loadAllData();
  switchPanel('overview');
}

// Legacy wrapper — poziva novi tok
async function addChannel() {
  addChannelStep1();
}


// ═══════════════════════════════════════════════════════════
// DATA LOADERS
// ═══════════════════════════════════════════════════════════
async function loadAllData() {
  if (!activeChannel) return;

  // Pokrećemo učitavanje asinhrono bez blokiranja celog toka (non-blocking)
  loadCommands();
  loadLeaderboard();
  loadWatchtime();
  loadMarriages();
  loadLoveStatuses();
  loadBotConfig();
  loadBotStatus();
  loadChannelLiveStatus();

  setupRealtimeChannels();
  startLiveActivityFeed();
}

async function refreshAllData() {
  if (!activeChannel) return;
  showToast('info', 'Osvežavam podatke...', '🔄');
  await loadAllData();
  showToast('success', 'Podaci osveženi!', '✅');
}

// ── Commands ──────────────────────────────────────────────
// ── Commands ──────────────────────────────────────────────
const defaultBuiltinCommands = [
  { id: 'builtin-iq', command: 'iq, iq @user', response: 'Prikazuje inteligenciju (IQ) korisnika ili ciljanog člana chata.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'iq' },
  { id: 'builtin-samar', command: 'samar @user', response: 'Šalje zabavan šamar odabranom korisniku sa nasumičnim predmetom.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'samar' },
  { id: 'builtin-roll', command: 'roll @user', response: 'Pokreće roll dvoboj (kockice 1-100) protiv tagovanog protivnika.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'roll' },
  { id: 'builtin-duel', command: 'duel @user', response: 'Izazovi drugog člana na pravi ruski rulet dvoboj.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'duel' },
  { id: 'builtin-rulet', command: 'rulet @user', response: 'Igraj ruski rulet sa botom — rizikuj timeout od 10 minuta.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'rulet' },
  { id: 'builtin-love', command: 'love @user, love @user @user', response: 'Izračunaj ljubavnu kompatibilnost sa drugim korisnikom.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'love' },
  { id: 'builtin-marry', command: 'vencaj @user', response: 'Pošalji bračnu ponudu drugom korisniku.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'vencaj' },
  { id: 'builtin-razvod', command: 'razvod @user', response: 'Razvedi se od trenutnog bračnog partnera.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'razvod' },
  { id: 'builtin-brakovi', command: 'brakovi, brak, vencani', response: 'Prikazuje sve venčane parove na ovom kanalu.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'brakovi' },
  { id: 'builtin-posaljiljubav', command: 'posaljiljubav @user', response: 'Pošalji ljubavnu ponudu nekom korisniku.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'posaljiljubav' },
  { id: 'builtin-odbijljubav', command: 'odbijljubav @user', response: 'Odbij ljubavnu ponudu od nekog korisnika.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'odbijljubav' },
  { id: 'builtin-mrzim', command: 'mrzim @user', response: 'Izračunaj procenat mržnje prema drugom korisniku.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'mrzim' },
  { id: 'builtin-prihvati', command: 'prihvati, da, pristajem', response: 'Prihvati bračnu ili ljubavnu ponudu.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'prihvati' },
  { id: 'builtin-odbij', command: 'odbij, ne, odbijam', response: 'Odbij bračnu ili ljubavnu ponudu.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'odbij' },
  { id: 'builtin-igra', command: 'igra', response: 'Prikazuje trenutnu igru na strimu.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'igra' },
  { id: 'builtin-uptime', command: 'uptime, up', response: 'Prikazuje koliko vremena je strim online.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'uptime' },
  { id: 'builtin-vreme', command: 'vreme [grad]', response: 'Prikazuje trenutnu vremensku prognozu za uneti grad.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'vreme' },
  { id: 'builtin-info', command: 'info', response: 'Prikazuje osnovne informacije o botu.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'info' },
  { id: 'builtin-permit', command: 'permit @user', response: 'Dozvoljava korisniku slanje jednog linka.', cooldown_ms: 5000, min_rank: 'moderator', enabled: true, is_default: true, uses_count: 0, db_match_key: 'permit' },
  { id: 'builtin-osvezi', command: 'osvezi', response: 'Osvežava sve podatke iz baze podataka.', cooldown_ms: 5000, min_rank: 'broadcaster', enabled: true, is_default: true, uses_count: 0, db_match_key: 'osvezi' },
  { id: 'builtin-topwatchtime', command: 'top watchtime [broj]', response: 'Prikazuje top listu gledalaca po vremenu gledanja.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'top watchtime' },
  { id: 'builtin-topchat', command: 'top chat [broj]', response: 'Prikazuje top listu najaktivnijih korisnika u četu.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'top chat' },
  { id: 'builtin-watchtime', command: 'watchtime', response: 'Prikazuje vreme gledanja korisnika.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'watchtime' },
  { id: 'builtin-chat', command: 'chat', response: 'Prikazuje broj poslatih poruka korisnika.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'chat' },
  { id: 'builtin-me', command: 'me', response: 'Prikazuje tvoju ličnu chat i watchtime statistiku.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'me' },
  { id: 'builtin-cinjenica', command: 'cinjenica', response: 'Ispisuje nasumičnu zanimljivu činjenicu.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'cinjenica' },
  { id: 'builtin-followage', command: 'followage', response: 'Pokazuje koliko dugo pratiš strimera.', cooldown_ms: 5000, min_rank: 'everyone', enabled: true, is_default: true, uses_count: 0, db_match_key: 'followage' }
];

const RANK_LABELS = {
  'everyone': 'Svi',
  'subscriber': 'Subovi',
  'vip': 'VIP',
  'og': 'OG',
  'moderator': 'Moderatori',
  'broadcaster': 'Strimer'
};

const RANK_COLORS = {
  'everyone': 'rgba(255, 255, 255, 0.4)',
  'subscriber': '#8B5CF6',
  'vip': '#3B82F6',
  'og': '#F59E0B',
  'moderator': '#10B981',
  'broadcaster': '#EF4444'
};

async function loadCommands() {
  if (!activeChannel) return;

  const { data, error } = await sb.from('custom_commands')
    .select('*')
    .eq('user_id', getChannelOwnerId())
    .eq('channel_id', activeChannel.id)
    .order('created_at', { ascending: false });

  if (error) { console.error('Commands:', error); return; }
  const dbData = data || [];

  const dbCustom = dbData.filter(c => !c.is_default);
  const dbDefaults = dbData.filter(c => c.is_default);

  const mergedBuiltins = defaultBuiltinCommands.map(builtin => {
    const dbVer = dbDefaults.find(d => {
      const dbNames = d.command.split(',').map(n => n.trim().toLowerCase());
      const builtinMatchKey = builtin.db_match_key.toLowerCase();
      // Match if database command starts with or matches db_match_key
      return dbNames.some(name => name === builtinMatchKey || name.startsWith(builtinMatchKey));
    });
    if (dbVer) {
      return {
        ...builtin,
        id: dbVer.id,
        cooldown_ms: dbVer.cooldown_ms,
        min_rank: dbVer.min_rank,
        enabled: dbVer.enabled,
        uses_count: dbVer.uses_count,
        db_exists: true
      };
    }
    return builtin;
  });

  allCommands = [...dbCustom, ...mergedBuiltins];
  renderMiniCommands(allCommands);
  const customOnlyCount = allCommands.filter(c => !c.is_default).length;
  const cmdCountEl = document.getElementById('cmdCount');
  if (cmdCountEl) cmdCountEl.textContent = customOnlyCount;
  const statCmdCountEl = document.getElementById('statCmdCount');
  if (statCmdCountEl) statCmdCountEl.textContent = customOnlyCount;

  renderUnifiedCommands();
  renderBuiltinCommandsGrid();
}

function renderUnifiedCommands(customCmds = null) {
  const tbody = document.getElementById('commandsBody');
  if (!tbody) return;

  let rows = customCmds || allCommands.filter(c => !c.is_default);

  updateCmdTableMeta(rows.length);

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Nema komandi za prikaz.</td></tr>';
    const prevBtn = document.getElementById('cmdPrevPageBtn');
    const nextBtn = document.getElementById('cmdNextPageBtn');
    const pageInfo = document.getElementById('cmdPageInfo');
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (pageInfo) pageInfo.textContent = 'Stranica 1 od 1';
    return;
  }

  // Pagination calculation
  const totalPages = Math.ceil(rows.length / commandsLimit) || 1;
  if (commandsPage > totalPages) commandsPage = totalPages;
  if (commandsPage < 1) commandsPage = 1;

  const startIndex = (commandsPage - 1) * commandsLimit;
  const pageRows = rows.slice(startIndex, startIndex + commandsLimit);

  // Update buttons and page info
  const prevBtn = document.getElementById('cmdPrevPageBtn');
  const nextBtn = document.getElementById('cmdNextPageBtn');
  const pageInfo = document.getElementById('cmdPageInfo');
  const limitSelect = document.getElementById('cmdLimitSelect');

  if (limitSelect) limitSelect.value = commandsLimit;
  if (pageInfo) pageInfo.textContent = `Stranica ${commandsPage} od ${totalPages}`;
  if (prevBtn) prevBtn.disabled = commandsPage === 1;
  if (nextBtn) nextBtn.disabled = commandsPage === totalPages;

  tbody.innerHTML = pageRows.map(cmd => {
    const cmdBadges = cmd.command.split(',').map(c => `<span class="td-cmd">!${escapeHtml(c.trim())}</span>`).join(' ');

    let actionsHtml = '';
    let statusHtml = `
      <span class="status-pill ${cmd.enabled ? 'status-active' : 'status-inactive'}">
        <span class="status-dot ${cmd.enabled ? 'status-on' : 'status-off'}"></span>
        ${cmd.enabled ? 'Aktivna' : 'Isključena'}
      </span>
    `;

    const toggleIcon = cmd.enabled
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>`;

    const editIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

    const deleteIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;

    // Onemogući brisanje sistemskih komandi
    const deleteBtnHtml = cmd.is_default
      ? `<button class="action-btn" disabled style="opacity: 0.25; cursor: not-allowed;" title="Sistemska komanda se ne može obrisati">${deleteIcon}</button>`
      : `<button class="action-btn danger" onclick="deleteCommandConfirm('${cmd.id}', '!${escapeHtml(cmd.command)}')" title="Obriši">${deleteIcon}</button>`;

    actionsHtml = `
      <div class="actions-cell">
        <button class="action-btn" onclick="toggleCommand('${cmd.id}', ${cmd.enabled}, ${!!cmd.is_default})" title="${cmd.enabled ? 'Isključi' : 'Uključi'}">
          ${toggleIcon}
        </button>
        <button class="action-btn" onclick="editCommand('${cmd.id}')" title="Izmeni">
          ${editIcon}
        </button>
        ${deleteBtnHtml}
      </div>
    `;

    const rKey = cmd.min_rank || 'everyone';
    const rankLabel = RANK_LABELS[rKey] || 'Svi';
    const rankColor = RANK_COLORS[rKey] || 'var(--text-muted)';
    const rankBadgeHtml = `<span style="background: rgba(255,255,255,0.03); border: 1px solid ${rankColor}33; color: ${rankColor}; font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">${rankLabel}</span>`;

    const displayResponse = cmd.is_default
      ? `<span style="color:var(--text-muted); font-style:italic;" title="${escapeHtml(cmd.response)}">${escapeHtml(cmd.response)}</span>`
      : `<span class="td-response" title="${escapeHtml(cmd.response)}">${escapeHtml(cmd.response)}</span>`;

    return `
      <tr>
        <td><div class="cmd-badge-list">${cmdBadges}</div></td>
        <td>${displayResponse}</td>
        <td>${rankBadgeHtml}</td>
        <td class="td-num">${(cmd.cooldown_ms / 1000).toFixed(0)}s</td>
        <td class="td-num">${cmd.uses_count ?? 0}</td>
        <td>${statusHtml}</td>
        <td>${actionsHtml}</td>
      </tr>
    `;
  }).join('');
}

function changeCommandsPage(dir) {
  commandsPage += dir;
  renderUnifiedCommands();
}

function changeCommandsLimit(limit) {
  commandsLimit = parseInt(limit);
  localStorage.setItem('cmd-items-per-page', limit);
  commandsPage = 1;
  renderUnifiedCommands();
}

function renderMiniCommands(cmds) {
  const el = document.getElementById('miniCommands');
  if (!el) return;

  // Prikaži specijalne i prilagođene komande
  const customOnly = cmds.filter(c => !c.is_builtin);

  if (customOnly.length === 0) {
    el.innerHTML = '<div class="mini-empty">Nema prilagođenih komandi</div>';
    return;
  }

  el.innerHTML = customOnly.map(cmd => {
    const cmdBadges = cmd.command.split(',').map(c => `<span class="td-cmd" style="font-size:0.75rem; padding: 0.1rem 0.25rem;">!${escapeHtml(c.trim())}</span>`).join(' ');
    return `
      <div class="mini-item" style="display:flex; justify-content:space-between; align-items:center;">
        <div class="cmd-badge-list" style="max-width: 40%;">${cmdBadges}</div>
        <span class="mini-username" style="color:var(--text-muted);font-size:0.8rem;flex:1;margin-left:0.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(cmd.response)}</span>
        <span class="status-pill ${cmd.enabled ? 'status-active' : 'status-inactive'}" style="font-size:0.6rem; flex-shrink:0; padding: 0.2rem 0.4rem; display: inline-flex; align-items: center; justify-content: center;">
          <span class="status-dot ${cmd.enabled ? 'status-on' : 'status-off'}" style="width: 5px; height: 5px;"></span>
        </span>
      </div>
    `;
  }).join('');
}

function filterCommands(query) {
  commandsPage = 1;
  const q = query.toLowerCase();
  const customOnly = allCommands.filter(c => !c.is_default);
  const filtered = customOnly.filter(c =>
    c.command.toLowerCase().includes(q) ||
    c.response.toLowerCase().includes(q)
  );
  renderUnifiedCommands(filtered);
}

function updateCmdTableMeta(n) {
  document.getElementById('cmdTableMeta').textContent = `${n} prilagođenih komandi`;
}

function renderBuiltinCommandsGrid(filteredList = null) {
  const grid = document.getElementById('builtinCommandsGrid');
  const meta = document.getElementById('builtinCmdTableMeta');
  if (!grid) return;

  const builtins = filteredList || allCommands.filter(c => c.is_default);
  if (meta) meta.textContent = `${builtins.length} ugrađenih komandi`;

  if (builtins.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 2rem;">Nema pronađenih ugrađenih komandi.</div>';
    return;
  }

  grid.innerHTML = builtins.map(cmd => {
    const rKey = cmd.min_rank || 'everyone';
    const rankLabel = RANK_LABELS[rKey] || 'Svi';
    const rankColor = RANK_COLORS[rKey] || 'var(--text-muted)';
    const dotColor = cmd.enabled ? 'var(--kick-green)' : '#EF4444';

    return `
      <div class="builtin-card" style="position: relative; background: var(--bg-surface); border: 1px solid var(--border-subtle); padding: 20px; border-radius: 12px; display: flex; flex-direction: column; gap: 8px;">
        <button class="action-btn" onclick="editCommand('${cmd.id}')" style="position: absolute; top: 16px; right: 16px; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); color: var(--text-main); cursor: pointer; transition: all var(--transition-fast); z-index: 2; flex-shrink: 0;" onmouseover="this.style.background='var(--app-primary-dim)'; this.style.color='var(--app-primary)'; this.style.borderColor='var(--app-primary-dim)';" onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.color='var(--text-main)'; this.style.borderColor='var(--border-subtle)';">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        
        <div class="builtin-cmd" style="font-family: var(--font-mono); color: var(--app-primary); font-weight: bold; font-size: 1.05rem; display: flex; align-items: center; gap: 8px; padding-right: 40px; word-break: break-word; line-height: 1.3;">
          !${escapeHtml(cmd.command)}
          <span class="status-dot" style="width: 6px; height: 6px; border-radius: 50%; display: inline-block; background: ${dotColor}; flex-shrink: 0;"></span>
        </div>
        
        <div class="builtin-desc" style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.4; flex-grow: 1; margin-top: 4px;">
          ${escapeHtml(cmd.response)}
        </div>
        
        <div style="display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap;">
          <span style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); color: var(--text-muted); font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; font-weight: 500;">
            Cooldown: ${(cmd.cooldown_ms / 1000).toFixed(0)}s
          </span>
          <span style="background: rgba(255,255,255,0.02); border: 1px solid ${rankColor}33; color: ${rankColor}; font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
            ${rankLabel}
          </span>
        </div>
      </div>
    `;
  }).join('');
}

function filterBuiltinCommands(query) {
  const q = query.toLowerCase();
  const builtinsOnly = allCommands.filter(c => c.is_default);
  const filtered = builtinsOnly.filter(c =>
    c.command.toLowerCase().includes(q) ||
    c.response.toLowerCase().includes(q)
  );
  renderBuiltinCommandsGrid(filtered);
}

// ── Leaderboard ───────────────────────────────────────────
function populateMonthSelector() {
  const sel = document.getElementById('lbMonthSelect');
  if (!sel) return;

  const now = new Date();
  const months = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const y = d.getFullYear();
    months.push({ value: `${m}-${y}`, label: `${m}/${y}` });
  }

  sel.innerHTML = months.map(m =>
    `<option value="${m.value}">${m.label}</option>`
  ).join('');
}

async function loadLeaderboard() {
  if (!activeChannel) return;
  leaderboardPage = 1;

  // Clear search input on month reload
  const searchInput = document.getElementById('leaderboardSearchInput');
  if (searchInput) searchInput.value = '';

  const sel = document.getElementById('lbMonthSelect');
  const month = sel?.value || getCurrentMonth();

  const { data, error } = await sb.from('leaderboard')
    .select('*')
    .eq('channel_id', activeChannel.id)
    .eq('month', month)
    .order('points', { ascending: false })
    .limit(200);

  if (error) { console.error('Leaderboard:', error); return; }
  allLeaderboard = data || [];
  renderMiniLeaderboard(allLeaderboard.slice(0, 5));

  // Calculate and display total chat messages with Serbian grammar formatting
  const totalChat = allLeaderboard.reduce((s, r) => s + (r.points || 0), 0);
  const chatStatEl = document.getElementById('statTotalChat');
  if (chatStatEl) {
    const lastDigit = totalChat % 10;
    const lastTwo = totalChat % 100;
    let suffix = 'poruka';
    if (lastTwo < 11 || lastTwo > 14) {
      if (lastDigit === 1) suffix = 'poruka';
      else if (lastDigit >= 2 && lastDigit <= 4) suffix = 'poruke';
    }
    chatStatEl.textContent = `${totalChat} ${suffix}`;
  }

  // "Najaktivniji korisnik" = zbir poruka + watchtime skor, prikazujemo ime korisnika
  if (allLeaderboard.length > 0 || allWatchtime.length > 0) {
    const combined = buildCombinedRows();
    if (combined.length > 0) {
      document.getElementById('statTopPoints').textContent = combined[0].username;
    } else if (allLeaderboard.length > 0) {
      document.getElementById('statTopPoints').textContent = allLeaderboard[0]?.display_name || allLeaderboard[0]?.username || '—';
    }
  }

  // Nakon učitavanja leaderboarda, uvek osvežavamo prikaz tabele
  renderUnifiedLeaderboard();
}

async function loadWatchtime() {
  if (!activeChannel) return;

  const { data, error } = await sb.from('watchtime')
    .select('*')
    .eq('channel_id', activeChannel.id)
    .order('minutes', { ascending: false })
    .limit(200);

  if (error) { console.error('Watchtime:', error); return; }
  allWatchtime = data || [];
  renderMiniWatchtime(allWatchtime.slice(0, 5));

  const totalMins = allWatchtime.reduce((s, r) => s + (r.minutes || 0), 0);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  let watchtimeText = '';
  if (hours > 0) {
    watchtimeText = `${hours}h ${mins}min`;
  } else {
    watchtimeText = `${mins}min`;
  }
  document.getElementById('statTotalWatchtime').textContent = watchtimeText;

  // Nakon učitavanja watchtime-a, ako je aktivni tab 'watchtime' ili 'combined', renderujemo leaderboard
  if (activeLeaderboardType === 'watchtime' || activeLeaderboardType === 'combined') {
    renderUnifiedLeaderboard();
  }
}
function setLeaderboardType(type) {
  activeLeaderboardType = type;
  localStorage.setItem('active-leaderboard-tab', type);
  leaderboardPage = 1;

  // Izmeni klase na tab dugmadima
  const tabChatters = document.getElementById('lbTabChatters');
  const tabWatchtime = document.getElementById('lbTabWatchtime');
  const tabCombined = document.getElementById('lbTabCombined');

  if (tabChatters) tabChatters.className = type === 'chatters' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
  if (tabWatchtime) tabWatchtime.className = type === 'watchtime' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
  if (tabCombined) tabCombined.className = type === 'combined' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';

  // Izmeni klase u sidebar navigaciji
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`[data-panel="leaderboard"]`);
  if (navItem) navItem.classList.add('active');
  updateBreadcrumbs('leaderboard');

  // Izmeni zaglavlje tabele
  const header = document.getElementById('leaderboardTableHeader');
  if (header) {
    if (type === 'chatters') {
      header.innerHTML = `
        <th style="width:60px">#</th>
        <th>Korisnik</th>
        <th>Poruke</th>
        <th>Mesec</th>
        <th>Ažurirano</th>
      `;
    } else if (type === 'watchtime') {
      header.innerHTML = `
        <th style="width:60px">#</th>
        <th>Korisnik</th>
        <th>Ukupno minuta</th>
        <th>Sati gledanja</th>
        <th>Ažurirano</th>
      `;
    } else {
      header.innerHTML = `
        <th style="width:60px">#</th>
        <th>Korisnik</th>
        <th>Watchtime</th>
        <th>Poruke</th>
        <th>Mesec</th>
        <th>Ažurirano</th>
      `;
    }
  }

  // Očisti input za pretragu
  const searchInput = document.getElementById('leaderboardSearchInput');
  if (searchInput) searchInput.value = '';

  renderUnifiedLeaderboard();
}

function buildCombinedRows() {
  const map = {};

  allLeaderboard.forEach(r => {
    const key = (r.username || '').toLowerCase();
    if (!map[key]) {
      map[key] = {
        username: r.username,
        display_name: r.display_name || r.username,
        points: 0,
        minutes: 0,
        month: r.month,
        updated_at: r.updated_at
      };
    }
    map[key].points += r.points || 0;
    if (!map[key].month) map[key].month = r.month;
  });

  const sel = document.getElementById('lbMonthSelect');
  const selectedMonth = sel?.value || getCurrentMonth();

  allWatchtime.forEach(r => {
    // Profiltriši watchtime po izabranom mesecu koristeći updated_at
    if (!r.updated_at) return;
    const date = new Date(r.updated_at);
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    const rowMonth = `${m}-${y}`;
    if (rowMonth !== selectedMonth) return;

    const key = (r.username || '').toLowerCase();
    if (!map[key]) {
      map[key] = {
        username: r.username,
        display_name: r.display_name || r.username,
        points: 0,
        minutes: 0,
        month: selectedMonth,
        updated_at: r.updated_at
      };
    }
    map[key].minutes += r.minutes || 0;
    if (!map[key].updated_at || (r.updated_at && r.updated_at > map[key].updated_at)) {
      map[key].updated_at = r.updated_at;
    }
  });

  // score = messages + (minutes / 6) — normalizacija watchtime-a na uporedivu skalu (1h watchtime = 10 poruka)
  return Object.values(map).sort((a, b) => {
    const scoreA = (a.points || 0) + Math.floor((a.minutes || 0) / 6);
    const scoreB = (b.points || 0) + Math.floor((b.minutes || 0) / 6);
    return scoreB - scoreA;
  });
}

function renderUnifiedLeaderboard(customRows = null) {
  const isChatters = activeLeaderboardType === 'chatters';
  const isWatchtime = activeLeaderboardType === 'watchtime';
  const isCombined = activeLeaderboardType === 'combined';

  let rows;
  if (customRows) {
    rows = customRows;
  } else if (isCombined) {
    rows = buildCombinedRows();
  } else if (isChatters) {
    rows = allLeaderboard;
  } else {
    const sel = document.getElementById('lbMonthSelect');
    const selectedMonth = sel?.value || getCurrentMonth();
    rows = allWatchtime.filter(row => {
      if (!row.updated_at) return false;
      const date = new Date(row.updated_at);
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const y = date.getFullYear();
      return `${m}-${y}` === selectedMonth;
    });
  }

  // Renderovanje podijuma (top 3)
  renderPodium(rows.slice(0, 3));

  const tbody = document.getElementById('leaderboardBody');
  if (!tbody) return;

  const colCount = isCombined ? 6 : 5;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" class="table-empty">Nema podataka za prikaz.</td></tr>`;
    document.getElementById('lbTableMeta').textContent = '0 korisnika';

    // Sakrij paginaciju ako nema korisnika
    const prevBtn = document.getElementById('lbPrevPageBtn');
    const nextBtn = document.getElementById('lbNextPageBtn');
    const pageInfo = document.getElementById('lbPageInfo');
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (pageInfo) pageInfo.textContent = 'Stranica 1 od 1';
    return;
  }

  document.getElementById('lbTableMeta').textContent = `${rows.length} korisnika`;

  // Paginacija proračun
  const totalPages = Math.ceil(rows.length / leaderboardLimit) || 1;
  if (leaderboardPage > totalPages) leaderboardPage = totalPages;
  if (leaderboardPage < 1) leaderboardPage = 1;

  const startIndex = (leaderboardPage - 1) * leaderboardLimit;
  const pageRows = rows.slice(startIndex, startIndex + leaderboardLimit);

  // Ažuriraj dugmad i info o stranici
  const prevBtn = document.getElementById('lbPrevPageBtn');
  const nextBtn = document.getElementById('lbNextPageBtn');
  const pageInfo = document.getElementById('lbPageInfo');
  const limitSelect = document.getElementById('lbLimitSelect');

  if (limitSelect) limitSelect.value = leaderboardLimit;
  if (pageInfo) pageInfo.textContent = `Stranica ${leaderboardPage} od ${totalPages}`;
  if (prevBtn) prevBtn.disabled = leaderboardPage === 1;
  if (nextBtn) nextBtn.disabled = leaderboardPage === totalPages;

  tbody.innerHTML = pageRows.map((row, i) => {
    const globalIndex = startIndex + i;
    const isTop3 = globalIndex < 3;

    let avatarStyle = '';
    let avatarContent = '';

    if (isTop3) {
      const avatarKey = (row.username || '').toLowerCase();
      const cachedUrl = avatarCache[avatarKey];
      const hasAvatar = cachedUrl && cachedUrl !== 'loading' && cachedUrl !== 'none';
      avatarStyle = hasAvatar
        ? `background-image:url('${cachedUrl}'); background-size:cover; background-position:center; border:1px solid rgba(255,255,255,0.15);`
        : '';
      avatarContent = hasAvatar ? '' : (row.display_name || row.username || '?').charAt(0).toUpperCase();

      // Pokreni fetch ako nije keširano i ako imamo username
      if (!hasAvatar && row.username) {
        setTimeout(() => {
          getOrFetchAvatar(row.username, `lb-avatar-${i}`);
        }, 80 * i);
      }
    }

    const userCol = isTop3
      ? `
        <div style="display:flex;align-items:center;gap:0.5rem">
          <div id="lb-avatar-${i}" style="width:24px;height:24px;border-radius:50%;background:var(--app-gradient);display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;flex-shrink:0;${avatarStyle}">
            ${avatarContent}
          </div>
          <span style="font-weight:600">${escapeHtml(row.display_name || row.username)}</span>
        </div>
      `
      : `<span style="font-weight:600">${escapeHtml(row.display_name || row.username)}</span>`;

    const rankDisplay = globalIndex === 0
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="color: #FBBF24; filter: drop-shadow(0 1px 4px rgba(251, 191, 36, 0.4)); display: inline-block; vertical-align: middle; margin-right: 4px;"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/></svg>`
      : `<strong style="color:${rankColor(globalIndex)}">${globalIndex + 1}.</strong>`;

    if (isChatters) {
      return `
        <tr>
          <td>${rankDisplay}</td>
          <td>${userCol}</td>
          <td class="td-num" style="color:${rankColor(globalIndex)}">${formatPorukeCount(row.points)}</td>
          <td style="color:var(--text-muted)">${row.month}</td>
          <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(row.updated_at)}</td>
        </tr>
      `;
    } else if (isWatchtime) {
      const hours = Math.floor((row.minutes || 0) / 60);
      const mins = (row.minutes || 0) % 60;
      return `
        <tr>
          <td>${rankDisplay}</td>
          <td>${userCol}</td>
          <td class="td-num">${row.minutes} min</td>
          <td class="td-num" style="color:var(--kick-green); font-weight: 600;">${hours}h ${mins}min</td>
          <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(row.updated_at)}</td>
        </tr>
      `;
    } else {
      // Combined
      const hours = Math.floor((row.minutes || 0) / 60);
      const mins = (row.minutes || 0) % 60;
      return `
        <tr>
          <td>${rankDisplay}</td>
          <td>${userCol}</td>
          <td class="td-num" style="color:var(--kick-green); font-weight: 600;">${hours}h ${mins}min</td>
          <td class="td-num" style="color:var(--app-primary)">${formatPorukeCount(row.points)}</td>
          <td style="color:var(--text-muted)">${row.month || '—'}</td>
          <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(row.updated_at)}</td>
        </tr>
      `;
    }
  }).join('');
}

function renderPodium(top3) {
  const el = document.getElementById('lbPodium');
  if (!el) return;

  if (top3.length === 0) {
    el.innerHTML = '';
    return;
  }

  const order = [top3[1], top3[0], top3[2]].filter(Boolean);
  const classes = ['podium-2', 'podium-1', 'podium-3'];
  const crownSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style="color: #FBBF24; filter: drop-shadow(0 2px 8px rgba(251, 191, 36, 0.6)); display: inline-block; vertical-align: middle;"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/></svg>`;
  const nums = ['2.', crownSvg, '3.'];
  const isChatters = activeLeaderboardType === 'chatters';
  const isWatchtime = activeLeaderboardType === 'watchtime';

  el.innerHTML = order.map((row, i) => {
    const cls = top3.length > 1 ? classes[i] : 'podium-1';
    const num = top3.length > 1 ? nums[i] : crownSvg;
    let valStr = '';
    if (isChatters) {
      valStr = formatPorukeCount(row.points);
    } else if (isWatchtime) {
      const h = Math.floor((row.minutes || 0) / 60);
      valStr = `${h}h`;
    } else {
      const h = Math.floor((row.minutes || 0) / 60);
      valStr = `${row.points}p / ${h}h`;
    }

    const avatarKey = (row.username || '').toLowerCase();
    const cachedUrl = avatarCache[avatarKey];
    const hasAvatar = cachedUrl && cachedUrl !== 'loading' && cachedUrl !== 'none';
    const avatarStyle = hasAvatar
      ? `background-image:url('${cachedUrl}'); background-size:cover; background-position:center; border:1px solid rgba(255,255,255,0.15);`
      : '';
    const avatarContent = hasAvatar ? '' : (row.display_name || row.username || '?').charAt(0).toUpperCase();

    // Pokreni fetch ako nije keširano i ako imamo username
    if (!hasAvatar && row.username) {
      setTimeout(() => {
        getOrFetchAvatar(row.username, `podium-avatar-${i}`);
      }, 30 * i);
    }

    return `
      <div class="podium-item ${cls}">
        <div class="podium-avatar" id="podium-avatar-${i}" style="${avatarStyle}">${avatarContent}</div>
        <div class="podium-name">${escapeHtml(row.display_name || row.username)}</div>
        <div class="podium-points">${valStr}</div>
        <div class="podium-base">${num}</div>
      </div>
    `;
  }).join('');
}

function renderMiniLeaderboard(rows) {
  const el = document.getElementById('miniLeaderboard');
  if (!el) return;
  if (!rows || rows.length === 0) { el.innerHTML = '<div class="mini-empty">Nema podataka</div>'; return; }
  el.innerHTML = rows.map((row, i) => `
    <div class="mini-item">
      <div class="mini-rank rank-${i < 3 ? i + 1 : 'n'}">${i + 1}</div>
      <span class="mini-username">${escapeHtml(row.display_name || row.username)}</span>
      <span class="mini-value">${formatPorukeCount(row.points)}</span>
    </div>
  `).join('');
}

function filterLeaderboard(q) {
  leaderboardPage = 1;
  const isChatters = activeLeaderboardType === 'chatters';
  const isCombined = activeLeaderboardType === 'combined';
  let source;
  if (isCombined) {
    source = buildCombinedRows();
  } else if (isChatters) {
    source = allLeaderboard;
  } else {
    source = allWatchtime;
  }
  const filtered = source.filter(r =>
    (r.display_name || r.username || r.username || '').toLowerCase().includes(q.toLowerCase())
  );
  renderUnifiedLeaderboard(filtered);
}

function changeLeaderboardPage(dir) {
  leaderboardPage += dir;
  renderUnifiedLeaderboard();
}

function changeLeaderboardLimit(limit) {
  leaderboardLimit = parseInt(limit);
  localStorage.setItem('lb-items-per-page', limit);
  leaderboardPage = 1;
  renderUnifiedLeaderboard();
}

function exportLeaderboard() {
  const type = activeLeaderboardType;
  if (type === 'chatters') {
    if (allLeaderboard.length === 0) { showToast('error', 'Nema podataka za export', '❌'); return; }
    const csv = ['Rank,Username,Poruke,Month,Updated']
      .concat(allLeaderboard.map((r, i) => `${i + 1},${r.display_name || r.username},${r.points},${r.month},${r.updated_at}`))
      .join('\n');
    downloadCsv(csv, `leaderboard_chatters_${activeChannel?.username}_${getCurrentMonth()}.csv`);
  } else if (type === 'watchtime') {
    if (allWatchtime.length === 0) { showToast('error', 'Nema podataka za export', '❌'); return; }
    const csv = ['Rank,Username,Minutes,Hours,Updated']
      .concat(allWatchtime.map((r, i) => `${i + 1},${r.display_name || r.username},${r.minutes},${Math.floor(r.minutes / 60)},${r.updated_at}`))
      .join('\n');
    downloadCsv(csv, `leaderboard_watchtime_${activeChannel?.username}.csv`);
  } else {
    const combined = buildCombinedRows();
    if (combined.length === 0) { showToast('error', 'Nema podataka za export', '❌'); return; }
    const csv = ['Rank,Username,Minutes,Hours,Poruke,Updated']
      .concat(combined.map((r, i) => `${i + 1},${r.username},${r.minutes},${Math.floor((r.minutes || 0) / 60)},${r.points},${r.updated_at}`))
      .join('\n');
    downloadCsv(csv, `leaderboard_zajedno_${activeChannel?.username}.csv`);
  }
}

function renderMiniWatchtime(rows) {
  const el = document.getElementById('miniWatchtime');
  if (!el) return;
  if (rows.length === 0) { el.innerHTML = '<div class="mini-empty">Nema podataka</div>'; return; }
  el.innerHTML = rows.map((row, i) => {
    const h = Math.floor((row.minutes || 0) / 60);
    const m = (row.minutes || 0) % 60;
    const valStr = h > 0 ? `${h}h ${m}min` : `${m}min`;
    return `
      <div class="mini-item">
        <div class="mini-rank rank-${i < 3 ? i + 1 : 'n'}">${i + 1}</div>
        <span class="mini-username">${escapeHtml(row.display_name || row.username)}</span>
        <span class="mini-value">${valStr}</span>
      </div>
    `;
  }).join('');
}

// ── Marriages ─────────────────────────────────────────────
async function loadMarriages() {
  if (!activeChannel) return;

  const { data, error } = await sb.from('marriages')
    .select('*')
    .eq('channel_id', activeChannel.id)
    .order('married_at', { ascending: false });

  if (error) { console.error('Marriages:', error); return; }
  allMarriages = data || [];
  renderMarriages(allMarriages);
  document.getElementById('marriageTableMeta').textContent = `${allMarriages.length} aktivnih brakova`;
  const marriageStatEl = document.getElementById('statMarriages');
  if (marriageStatEl) {
    marriageStatEl.textContent = allMarriages.length;
  }
}

async function loadLoveStatuses() {
  if (!activeChannel) return;

  const { data, error } = await sb.from('love_modifiers')
    .select('*')
    .eq('channel_id', activeChannel.id)
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error) { console.error('Love modifiers:', error); return; }
  allLoveStatuses = data || [];
  renderLoveStatuses(allLoveStatuses);

  const meta = document.getElementById('loveStatusMeta');
  if (meta) meta.textContent = `${allLoveStatuses.length} statusa`;
}

function renderMarriages(rows) {
  const tbody = document.getElementById('marriagesBody');
  if (!tbody) return;

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Nema aktivnih brakova u kanalu.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(row => `
    <tr>
      <td style="font-weight:600">${escapeHtml(row.user1_display || row.user1)}</td>
      <td style="text-align:center;font-size:1.125rem">💍</td>
      <td style="font-weight:600">${escapeHtml(row.user2_display || row.user2)}</td>
      <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(row.married_at)}</td>
      <td>
        <div class="actions-cell">
          <button class="action-btn danger" onclick="divorceConfirm('${row.id}', '${escapeHtml(row.user1)}', '${escapeHtml(row.user2)}')" title="Razvod (Admin)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="9.8" y1="8.2" x2="21" y2="19"/><line x1="9.8" y1="15.8" x2="21" y2="5"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function getLoveStatusLabel(modifier) {
  if (modifier >= 50) return 'Sjajno';
  if (modifier >= 25) return 'Visoko';
  if (modifier >= 1) return 'Pozitivno';
  if (modifier === 0) return 'Neutralno';
  if (modifier > -25) return 'Nestabilno';
  if (modifier > -50) return 'Loše';
  return 'Toksično';
}

function renderLoveStatuses(rows) {
  const tbody = document.getElementById('loveStatusesBody');
  if (!tbody) return;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nema ljubavnih statusa za prikaz.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const modifier = Number(row.modifier || 0);
    const statusClass = modifier > 0 ? 'status-active' : modifier < 0 ? 'status-inactive' : 'status-neutral';
    const displayModifier = modifier >= 0 ? `+${modifier}` : `${modifier}`;

    return `
      <tr>
        <td style="font-weight:600">${escapeHtml(row.user1)}</td>
        <td style="text-align:center;font-size:1.125rem">💞</td>
        <td style="font-weight:600">${escapeHtml(row.user2)}</td>
        <td><span class="status-pill ${statusClass}">${getLoveStatusLabel(modifier)}</span></td>
        <td class="td-num" style="color:${modifier > 0 ? 'var(--kick-green)' : modifier < 0 ? '#FCA5A5' : 'var(--text-muted)'}">${displayModifier}</td>
        <td style="color:var(--text-muted);font-size:0.8rem">${fmtDate(row.updated_at)}</td>
      </tr>
    `;
  }).join('');
}

function filterLoveStatuses(q) {
  const query = (q || '').toLowerCase();
  const filtered = allLoveStatuses.filter(r =>
    (r.user1 || '').toLowerCase().includes(query) ||
    (r.user2 || '').toLowerCase().includes(query)
  );
  renderLoveStatuses(filtered);
}

function filterMarriages(q) {
  const filtered = allMarriages.filter(r =>
    (r.user1 || '').toLowerCase().includes(q.toLowerCase()) ||
    (r.user2 || '').toLowerCase().includes(q.toLowerCase())
  );
  renderMarriages(filtered);
}

async function divorceConfirm(id, u1, u2) {
  confirmCallback = async () => {
    const { error } = await sb.from('marriages').delete().eq('id', id);
    if (error) { showToast('error', 'Greška pri brisanju', '❌'); return; }
    showToast('success', `Brak ${u1} & ${u2} je raskinut`, '✂️');
    await loadMarriages();
  };
  document.getElementById('confirmMsg').textContent = `Admin razvod: ${u1} & ${u2}? Ovo se ne može poništiti.`;
  document.getElementById('confirmDeleteBtn').onclick = () => { closeModal('confirmModal'); confirmCallback(); };
  openModal('confirmModal');
}

// ── Bot Config ────────────────────────────────────────────
async function loadBotConfig() {
  if (!activeChannel) return;

  const { data, error } = await sb.from('bot_config')
    .select('*')
    .eq('user_id', getChannelOwnerId())
    .eq('channel_id', activeChannel.id)
    .maybeSingle();

  if (error) { console.error('Config:', error); return; }

  if (data) {
    document.getElementById('cfgPrefix').value = data.prefix || '!';
    document.getElementById('cfgLanguage').value = data.language || 'sr';
    document.getElementById('cfgCooldown').value = data.cooldown_ms ?? 3000;
    document.getElementById('cfgLeaderboard').checked = data.feature_leaderboard ?? true;
    document.getElementById('cfgWatchtime').checked = data.feature_watchtime ?? true;
    document.getElementById('cfgGames').checked = data.feature_games ?? true;
    document.getElementById('cfgLove').checked = data.feature_love ?? true;
    document.getElementById('cfgModeration').checked = data.feature_moderation ?? false;
    document.getElementById('cfgAutoresponse').checked = data.feature_autoresponse ?? true;
    document.getElementById('cfgSpamThreshold').value = data.spam_threshold ?? 3;
    document.getElementById('cfgSpamWindow').value = data.spam_window_ms ?? 15000;
    document.getElementById('cfgPinMsg').value = data.stream_pin_msg || '';
    document.getElementById('cfgWelcomeMsg').value = data.welcome_message || '';
    document.getElementById('cfgCustomBotName').value = data.custom_bot_name || '';

    // Load chat alerts settings
    const alerts = data.alerts_settings || {};
    document.getElementById('cfgAlertFollowEnabled').checked = alerts.follow_enabled ?? false;
    document.getElementById('cfgAlertFollowMsg').value = alerts.follow_message || 'Thanks for the follow @$(name)!';
    
    document.getElementById('cfgAlertKicksEnabled').checked = alerts.kicks_enabled ?? false;
    document.getElementById('cfgAlertKicksMsg').value = alerts.kicks_message || '@$(name) Thanks for the $(amount) KICKs!';
    document.getElementById('cfgAlertKicksMin').value = alerts.kicks_min_amount ?? 0;
    
    document.getElementById('cfgAlertSubEnabled').checked = alerts.sub_enabled ?? false;
    document.getElementById('cfgAlertSubMsg').value = alerts.sub_message || 'Thanks @$(name) for subscribing for $(months) months!';
    
    document.getElementById('cfgAlertResubEnabled').checked = alerts.resub_enabled ?? false;
    document.getElementById('cfgAlertResubMsg').value = alerts.resub_message || 'Thanks @$(name) for subscribing for $(months) months!';
    
    document.getElementById('cfgAlertGiftsubEnabled').checked = alerts.giftsub_enabled ?? false;
    document.getElementById('cfgAlertGiftsubMsg').value = alerts.giftsub_message || 'Thanks for the gift @$(name)!';
    
    document.getElementById('cfgAlertHostEnabled').checked = alerts.host_enabled ?? false;
    document.getElementById('cfgAlertHostMsg').value = alerts.host_message || '@$(name) Thanks for raiding with $(viewers) viewers!';
    document.getElementById('cfgAlertHostMin').value = alerts.host_min_viewers ?? 0;
    
    document.getElementById('cfgAlertWelcomeEnabled').checked = alerts.welcome_enabled ?? false;
    document.getElementById('cfgAlertWelcomeMsg').value = data.welcome_message || '';

    // Load song request settings
    const songSettings = data.songrequest_settings || {};
    document.getElementById('cfgSongRequestEnabled').checked = data.feature_songrequest ?? false;
    document.getElementById('cfgSongRequestRank').value = songSettings.request_role || 'everyone';
    document.getElementById('cfgSongRequestCost').value = songSettings.cost_points ?? 50;
    document.getElementById('cfgSongRequestMaxDuration').value = songSettings.max_duration_seconds ?? 360;
    
    localSongQueue = Array.isArray(songSettings.queue) ? songSettings.queue : [];
    renderSongQueue();
    updatePlayerUI();

    // Load auto announce interval settings
    document.getElementById('cfgAnnounceInterval').value = data.announce_interval_mins ?? 15;
    document.getElementById('cfgAnnounceThreshold').value = data.announce_message_threshold ?? 30;
    document.getElementById('cfgAnnounceTimeEnabled').checked = data.announce_time_enabled ?? true;
    document.getElementById('cfgAnnounceMsgEnabled').checked = data.announce_msg_enabled ?? true;

    // Load auto announce list
    localAnnounces = Array.isArray(data.auto_announces) ? data.auto_announces : [];
    renderAnnounceList();

    // Load moderation settings
    const modSettings = data.moderation_settings || {};
    currentModFiltersSettings = {
      caps_action_type: modSettings.caps_action_type || '',
      caps_timeout_duration_secs: modSettings.caps_timeout_duration_secs || '',
      links_action_type: modSettings.links_action_type || '',
      links_timeout_duration_secs: modSettings.links_timeout_duration_secs || '',
      emotes_action_type: modSettings.emotes_action_type || '',
      emotes_timeout_duration_secs: modSettings.emotes_timeout_duration_secs || '',
      symbols_action_type: modSettings.symbols_action_type || '',
      symbols_timeout_duration_secs: modSettings.symbols_timeout_duration_secs || '',
      words_action_type: modSettings.words_action_type || '',
      words_timeout_duration_secs: modSettings.words_timeout_duration_secs || '',
      spam_action_type: modSettings.spam_action_type || '',
      spam_timeout_duration_secs: modSettings.spam_timeout_duration_secs || '',
      max_len_action_type: modSettings.max_len_action_type || '',
      max_len_timeout_duration_secs: modSettings.max_len_timeout_duration_secs || '',
      mentions_action_type: modSettings.mentions_action_type || '',
      mentions_timeout_duration_secs: modSettings.mentions_timeout_duration_secs || ''
    };
    document.getElementById('cfgModCapsEnabled').checked = modSettings.caps_enabled ?? false;
    document.getElementById('cfgModCapsPct').value = modSettings.caps_pct ?? 70;
    document.getElementById('lblModCapsPct').textContent = (modSettings.caps_pct ?? 70) + '%';
    document.getElementById('cfgModCapsMinLen').value = modSettings.caps_min_len ?? 5;
    
    document.getElementById('cfgModLinksEnabled').checked = modSettings.links_enabled ?? false;
    document.getElementById('cfgModLinksWhitelist').value = modSettings.links_whitelist || '';
    document.getElementById('cfgModLinksPermitEnabled').checked = modSettings.links_permit_enabled ?? true;
    
    document.getElementById('cfgModEmotesEnabled').checked = modSettings.emotes_enabled ?? false;
    document.getElementById('cfgModEmotesMax').value = modSettings.emotes_max ?? 5;
    
    document.getElementById('cfgModSymbolsEnabled').checked = modSettings.symbols_enabled ?? false;
    document.getElementById('cfgModSymbolsPct').value = modSettings.symbols_pct ?? 60;
    document.getElementById('lblModSymbolsPct').textContent = (modSettings.symbols_pct ?? 60) + '%';
    document.getElementById('cfgModSymbolsMinLen').value = modSettings.symbols_min_len ?? 5;
    
    document.getElementById('cfgModWordsEnabled').checked = modSettings.words_enabled ?? false;
    document.getElementById('cfgModWordsList').value = modSettings.words_list || '';
    
    document.getElementById('cfgModSpamEnabled').checked = modSettings.spam_enabled ?? false;
    document.getElementById('cfgModSpamMaxDuplicates').value = modSettings.spam_max_duplicates ?? 2;
    
    document.getElementById('cfgModMaxLenEnabled').checked = modSettings.max_len_enabled ?? false;
    document.getElementById('cfgModMaxLenLimit').value = modSettings.max_len_limit ?? 300;
    
    document.getElementById('cfgModMentionsEnabled').checked = modSettings.mentions_enabled ?? false;
    document.getElementById('cfgModMentionsLimit').value = modSettings.mentions_limit ?? 3;
    
    document.getElementById('cfgModActionType').value = modSettings.action_type || 'delete';
    document.getElementById('cfgModTimeoutDuration').value = modSettings.timeout_duration_secs ?? 600;
    
    const exemptRoles = modSettings.exempt_roles || ['moderator'];
    document.getElementById('cfgModExemptVip').checked = exemptRoles.includes('vip');
    document.getElementById('cfgModExemptSub').checked = exemptRoles.includes('subscriber');

    toggleModerationPanelState();

    // Update bot status
    updateBotStatusUI(data.bot_active || false);
    document.getElementById('botActiveToggle').checked = data.bot_active || false;
  } else {
    localAnnounces = [];
    renderAnnounceList();
    document.getElementById('cfgAnnounceInterval').value = 15;
    document.getElementById('cfgAnnounceThreshold').value = 30;
    document.getElementById('cfgAnnounceTimeEnabled').checked = true;
    document.getElementById('cfgAnnounceMsgEnabled').checked = true;

    // Reset chat alerts settings
    document.getElementById('cfgAlertFollowEnabled').checked = false;
    document.getElementById('cfgAlertFollowMsg').value = 'Thanks for the follow @$(name)!';
    document.getElementById('cfgAlertKicksEnabled').checked = false;
    document.getElementById('cfgAlertKicksMsg').value = '@$(name) Thanks for the $(amount) KICKs!';
    document.getElementById('cfgAlertKicksMin').value = 0;
    document.getElementById('cfgAlertSubEnabled').checked = false;
    document.getElementById('cfgAlertSubMsg').value = 'Thanks @$(name) for subscribing for $(months) months!';
    document.getElementById('cfgAlertResubEnabled').checked = false;
    document.getElementById('cfgAlertResubMsg').value = 'Thanks @$(name) for subscribing for $(months) months!';
    document.getElementById('cfgAlertGiftsubEnabled').checked = false;
    document.getElementById('cfgAlertGiftsubMsg').value = 'Thanks for the gift @$(name)!';
    document.getElementById('cfgAlertHostEnabled').checked = false;
    document.getElementById('cfgAlertHostMsg').value = '@$(name) Thanks for raiding with $(viewers) viewers!';
    document.getElementById('cfgAlertHostMin').value = 0;
    document.getElementById('cfgAlertWelcomeEnabled').checked = false;
    document.getElementById('cfgAlertWelcomeMsg').value = '';
    document.getElementById('cfgCustomBotName').value = '';

    // Reset song request settings
    document.getElementById('cfgSongRequestEnabled').checked = false;
    document.getElementById('cfgSongRequestRank').value = 'everyone';
    document.getElementById('cfgSongRequestCost').value = 50;
    document.getElementById('cfgSongRequestMaxDuration').value = 360;

    // Reset moderation settings
    currentModFiltersSettings = {};
    document.getElementById('cfgModCapsEnabled').checked = false;
    document.getElementById('cfgModCapsPct').value = 70;
    document.getElementById('lblModCapsPct').textContent = '70%';
    document.getElementById('cfgModCapsMinLen').value = 5;
    document.getElementById('cfgModLinksEnabled').checked = false;
    document.getElementById('cfgModLinksWhitelist').value = '';
    document.getElementById('cfgModLinksPermitEnabled').checked = true;
    document.getElementById('cfgModEmotesEnabled').checked = false;
    document.getElementById('cfgModEmotesMax').value = 5;
    document.getElementById('cfgModSymbolsEnabled').checked = false;
    document.getElementById('cfgModSymbolsPct').value = 60;
    document.getElementById('lblModSymbolsPct').textContent = '60%';
    document.getElementById('cfgModSymbolsMinLen').value = 5;
    document.getElementById('cfgModWordsEnabled').checked = false;
    document.getElementById('cfgModWordsList').value = '';
    document.getElementById('cfgModSpamEnabled').checked = false;
    document.getElementById('cfgModSpamMaxDuplicates').value = 2;
    document.getElementById('cfgModMaxLenEnabled').checked = false;
    document.getElementById('cfgModMaxLenLimit').value = 300;
    document.getElementById('cfgModMentionsEnabled').checked = false;
    document.getElementById('cfgModMentionsLimit').value = 3;
    document.getElementById('cfgModActionType').value = 'delete';
    document.getElementById('cfgModTimeoutDuration').value = 600;
    document.getElementById('cfgModExemptVip').checked = false;
    document.getElementById('cfgModExemptSub').checked = false;

    toggleModerationPanelState();
  }
  configLoaded = true;
  updateOverviewModulesUI();
}

async function saveBotConfig(silent = false) {
  if (!activeChannel) { showToast('error', 'Nema izabranog kanala', '❌'); return; }

  const config = {
    user_id: getChannelOwnerId(),
    channel_id: activeChannel.id,
    channel_name: activeChannel.username,
    prefix: document.getElementById('cfgPrefix').value || '!',
    language: document.getElementById('cfgLanguage').value,
    cooldown_ms: parseInt(document.getElementById('cfgCooldown').value) || 3000,
    feature_leaderboard: document.getElementById('cfgLeaderboard').checked,
    feature_watchtime: document.getElementById('cfgWatchtime').checked,
    feature_games: document.getElementById('cfgGames').checked,
    feature_love: document.getElementById('cfgLove').checked,
    feature_moderation: document.getElementById('cfgModeration').checked,
    feature_autoresponse: document.getElementById('cfgAutoresponse').checked,
    spam_threshold: parseInt(document.getElementById('cfgSpamThreshold').value) || 3,
    spam_window_ms: parseInt(document.getElementById('cfgSpamWindow').value) || 15000,
    stream_pin_msg: document.getElementById('cfgPinMsg').value || null,
    welcome_message: document.getElementById('cfgAlertWelcomeMsg')?.value || document.getElementById('cfgWelcomeMsg')?.value || null,
    custom_bot_name: document.getElementById('cfgCustomBotName').value.trim() || null,
    alerts_settings: {
      follow_enabled: document.getElementById('cfgAlertFollowEnabled').checked,
      follow_message: document.getElementById('cfgAlertFollowMsg').value || 'Thanks for the follow @$(name)!',
      
      kicks_enabled: document.getElementById('cfgAlertKicksEnabled').checked,
      kicks_message: document.getElementById('cfgAlertKicksMsg').value || '@$(name) Thanks for the $(amount) KICKs!',
      kicks_min_amount: parseInt(document.getElementById('cfgAlertKicksMin').value) || 0,
      
      sub_enabled: document.getElementById('cfgAlertSubEnabled').checked,
      sub_message: document.getElementById('cfgAlertSubMsg').value || 'Thanks @$(name) for subscribing for $(months) months!',
      
      resub_enabled: document.getElementById('cfgAlertResubEnabled').checked,
      resub_message: document.getElementById('cfgAlertResubMsg').value || 'Thanks @$(name) for subscribing for $(months) months!',
      
      giftsub_enabled: document.getElementById('cfgAlertGiftsubEnabled').checked,
      giftsub_message: document.getElementById('cfgAlertGiftsubMsg').value || 'Thanks for the gift @$(name)!',
      
      host_enabled: document.getElementById('cfgAlertHostEnabled').checked,
      host_message: document.getElementById('cfgAlertHostMsg').value || '@$(name) Thanks for raiding with $(viewers) viewers!',
      host_min_viewers: parseInt(document.getElementById('cfgAlertHostMin').value) || 0,
      
      welcome_enabled: document.getElementById('cfgAlertWelcomeEnabled').checked
    },
    feature_songrequest: document.getElementById('cfgSongRequestEnabled').checked,
    songrequest_settings: {
      request_role: document.getElementById('cfgSongRequestRank').value,
      cost_points: parseInt(document.getElementById('cfgSongRequestCost').value) || 50,
      max_duration_seconds: parseInt(document.getElementById('cfgSongRequestMaxDuration').value) || 360,
      queue: localSongQueue
    },
    auto_announces: localAnnounces,
    announce_interval_mins: parseInt(document.getElementById('cfgAnnounceInterval').value) || 15,
    announce_message_threshold: parseInt(document.getElementById('cfgAnnounceThreshold').value) || 30,
    announce_time_enabled: document.getElementById('cfgAnnounceTimeEnabled').checked,
    announce_msg_enabled: document.getElementById('cfgAnnounceMsgEnabled').checked,
    updated_at: new Date().toISOString(),
  };

  const btnConfig = document.getElementById('saveConfigBtn');
  const btnConfigBottom = document.getElementById('saveConfigBtnBottom');
  const btnAnnounces = document.getElementById('saveAnnouncesConfigBtn');
  const btnAnnouncesBottom = document.getElementById('saveAnnouncesConfigBtnBottom');
  
  if (!silent) {
    if (btnConfig) setLoading('saveConfigBtn', true);
    if (btnConfigBottom) setLoading('saveConfigBtnBottom', true);
    if (btnAnnounces) setLoading('saveAnnouncesConfigBtn', true);
    if (btnAnnouncesBottom) setLoading('saveAnnouncesConfigBtnBottom', true);
  }

  const { error } = await sb.from('bot_config')
    .upsert(config, { onConflict: 'channel_id' });

  if (!silent) {
    if (btnConfig) setLoading('saveConfigBtn', false);
    if (btnConfigBottom) setLoading('saveConfigBtnBottom', false);
    if (btnAnnounces) setLoading('saveAnnouncesConfigBtn', false);
    if (btnAnnouncesBottom) setLoading('saveAnnouncesConfigBtnBottom', false);
  }

  if (error) { 
    showToast('error', 'Greška pri čuvanju config-a', '❌'); 
    console.error(error); 
    return; 
  }
  
  if (!silent) {
    showToast('success', 'Bot config sačuvan!', '✅');
  }
  notifyBotToReload();
  updateOverviewModulesUI();
}

function toggleModerationPanelState() {
  const container = document.getElementById('modSettingsContainer');
  const notice = document.getElementById('modDisabledNotice');
  const mainToggle = document.getElementById('cfgModeration');
  if (mainToggle) {
    const active = mainToggle.checked;
    if (container) container.style.display = active ? 'flex' : 'none';
    if (notice) notice.style.display = active ? 'none' : 'flex';
  }
}

function getBotApiBase() {
  const fromGlobal = (window.KICK_API_BASE || '').trim();
  if (fromGlobal) return fromGlobal.replace(/\/+$/, '');
  // Ako je pokrenuto na Netlify ili lokalno, koristi Render backend
  if (window.location.hostname.endsWith('netlify.app') || 
      window.location.hostname === 'localhost' || 
      window.location.hostname === '127.0.0.1') {
    return 'https://kickbot-ihzb.onrender.com';
  }
  return window.location.origin;
}

function notifyBotToReload() {
  if (!activeChannel) return;
  fetch(`${getBotApiBase()}/api/kick/reload?chatroom_id=${activeChannel.id}`).catch(() => {});
}

async function saveModerationSettings(silent = false) {
  if (!activeChannel) { showToast('error', 'Nema izabranog kanala', '❌'); return; }

  const featureModeration = document.getElementById('cfgModeration').checked;

  const moderationSettings = {
    caps_enabled: document.getElementById('cfgModCapsEnabled').checked,
    caps_pct: parseInt(document.getElementById('cfgModCapsPct').value) || 70,
    caps_min_len: parseInt(document.getElementById('cfgModCapsMinLen').value) || 5,
    caps_action_type: currentModFiltersSettings.caps_action_type || '',
    caps_timeout_duration_secs: currentModFiltersSettings.caps_timeout_duration_secs ? parseInt(currentModFiltersSettings.caps_timeout_duration_secs) : null,
    
    links_enabled: document.getElementById('cfgModLinksEnabled').checked,
    links_whitelist: document.getElementById('cfgModLinksWhitelist').value,
    links_permit_enabled: document.getElementById('cfgModLinksPermitEnabled').checked,
    links_action_type: currentModFiltersSettings.links_action_type || '',
    links_timeout_duration_secs: currentModFiltersSettings.links_timeout_duration_secs ? parseInt(currentModFiltersSettings.links_timeout_duration_secs) : null,
    
    emotes_enabled: document.getElementById('cfgModEmotesEnabled').checked,
    emotes_max: parseInt(document.getElementById('cfgModEmotesMax').value) || 5,
    emotes_action_type: currentModFiltersSettings.emotes_action_type || '',
    emotes_timeout_duration_secs: currentModFiltersSettings.emotes_timeout_duration_secs ? parseInt(currentModFiltersSettings.emotes_timeout_duration_secs) : null,
    
    symbols_enabled: document.getElementById('cfgModSymbolsEnabled').checked,
    symbols_pct: parseInt(document.getElementById('cfgModSymbolsPct').value) || 60,
    symbols_min_len: parseInt(document.getElementById('cfgModSymbolsMinLen').value) || 5,
    symbols_action_type: currentModFiltersSettings.symbols_action_type || '',
    symbols_timeout_duration_secs: currentModFiltersSettings.symbols_timeout_duration_secs ? parseInt(currentModFiltersSettings.symbols_timeout_duration_secs) : null,
    
    words_enabled: document.getElementById('cfgModWordsEnabled').checked,
    words_list: document.getElementById('cfgModWordsList').value,
    words_action_type: currentModFiltersSettings.words_action_type || '',
    words_timeout_duration_secs: currentModFiltersSettings.words_timeout_duration_secs ? parseInt(currentModFiltersSettings.words_timeout_duration_secs) : null,
    
    spam_enabled: document.getElementById('cfgModSpamEnabled').checked,
    spam_max_duplicates: parseInt(document.getElementById('cfgModSpamMaxDuplicates').value) || 2,
    spam_action_type: currentModFiltersSettings.spam_action_type || '',
    spam_timeout_duration_secs: currentModFiltersSettings.spam_timeout_duration_secs ? parseInt(currentModFiltersSettings.spam_timeout_duration_secs) : null,
    
    max_len_enabled: document.getElementById('cfgModMaxLenEnabled').checked,
    max_len_limit: parseInt(document.getElementById('cfgModMaxLenLimit').value) || 300,
    max_len_action_type: currentModFiltersSettings.max_len_action_type || '',
    max_len_timeout_duration_secs: currentModFiltersSettings.max_len_timeout_duration_secs ? parseInt(currentModFiltersSettings.max_len_timeout_duration_secs) : null,
    
    mentions_enabled: document.getElementById('cfgModMentionsEnabled').checked,
    mentions_limit: parseInt(document.getElementById('cfgModMentionsLimit').value) || 3,
    mentions_action_type: currentModFiltersSettings.mentions_action_type || '',
    mentions_timeout_duration_secs: currentModFiltersSettings.mentions_timeout_duration_secs ? parseInt(currentModFiltersSettings.mentions_timeout_duration_secs) : null,
    
    action_type: document.getElementById('cfgModActionType').value || 'delete',
    timeout_duration_secs: parseInt(document.getElementById('cfgModTimeoutDuration').value) || 600,
    exempt_roles: [
      'moderator',
      document.getElementById('cfgModExemptVip').checked ? 'vip' : null,
      document.getElementById('cfgModExemptSub').checked ? 'subscriber' : null
    ].filter(Boolean)
  };

  const btn = document.getElementById('btnSaveModeration');
  if (!silent && btn) btn.disabled = true;

  const { error } = await sb.from('bot_config')
    .upsert({
      user_id: getChannelOwnerId(),
      channel_id: activeChannel.id,
      channel_name: activeChannel.username,
      feature_moderation: featureModeration,
      moderation_settings: moderationSettings,
      updated_at: new Date().toISOString()
    }, { onConflict: 'channel_id' });

  if (!silent && btn) btn.disabled = false;

  if (error) { 
    showToast('error', 'Greška pri čuvanju podešavanja moderacije', '❌'); 
    console.error(error); 
    return; 
  }

  if (!silent) {
    showToast('success', 'Podešavanja moderacije sačuvana!', '✅');
  }
  notifyBotToReload();
  updateOverviewModulesUI();
}

function openModFilterPenaltyModal(filterKey, filterName) {
  document.getElementById('modFilterKey').value = filterKey;
  document.getElementById('modFilterPenaltyTitle').textContent = `Kazna za: ${filterName}`;
  
  const actionVal = currentModFiltersSettings[`${filterKey}_action_type`] || '';
  const timeoutVal = currentModFiltersSettings[`${filterKey}_timeout_duration_secs`] || '';
  
  document.getElementById('modFilterActionType').value = actionVal;
  document.getElementById('modFilterTimeoutDuration').value = timeoutVal;
  
  openModal('modFilterPenaltyModal');
}

function saveModFilterPenalty() {
  const filterKey = document.getElementById('modFilterKey').value;
  if (!filterKey) return;
  
  const actionVal = document.getElementById('modFilterActionType').value;
  const timeoutVal = document.getElementById('modFilterTimeoutDuration').value;
  
  currentModFiltersSettings[`${filterKey}_action_type`] = actionVal;
  currentModFiltersSettings[`${filterKey}_timeout_duration_secs`] = timeoutVal ? parseInt(timeoutVal) : '';
  
  closeModal('modFilterPenaltyModal');
  showToast('success', 'Pojedinačna kazna privremeno podešena. Kliknite "Sačuvaj podešavanja" na dnu stranice da je trajno sačuvate.', '⚡');
}

function applyGlobalPenaltyToAll() {
  const globalAction = document.getElementById('cfgModActionType').value || 'delete';
  const globalTimeout = parseInt(document.getElementById('cfgModTimeoutDuration').value) || 600;
  
  const keys = ['caps', 'links', 'emotes', 'symbols', 'words', 'spam', 'max_len', 'mentions'];
  keys.forEach(k => {
    currentModFiltersSettings[`${k}_action_type`] = globalAction;
    currentModFiltersSettings[`${k}_timeout_duration_secs`] = globalTimeout;
  });
  
  showToast('info', 'Globalne kazne primenjene na sve pojedinačne filtere. Kliknite "Sačuvaj podešavanja" da sačuvate.', '🔄');
}

function renderAnnounceList() {
  const el = document.getElementById('announceList');
  if (!el) return;

  if (localAnnounces.length === 0) {
    el.innerHTML = '<div class="mini-empty" style="padding:1rem 0;">Nema automatskih najava. Dodaj prvu ispod.</div>';
    return;
  }

  el.innerHTML = localAnnounces.map((msg, i) => `
    <div class="mini-item" style="border: 1px solid var(--border-subtle); padding: 0.625rem 0.875rem; border-radius: var(--radius-md); display: flex; align-items: center; gap: 0.75rem; background: var(--bg-surface);">
      <span class="mini-username" style="font-size:0.875rem; color: var(--text-secondary); line-height: 1.4;">${escapeHtml(msg)}</span>
      <button type="button" class="action-btn danger" onclick="deleteAnnounceMessage(${i})" style="flex-shrink:0; margin-left:auto;" title="Obriši poruku">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
      </button>
    </div>
  `).join('');
}

function addAnnounceMessage() {
  const input = document.getElementById('newAnnounceInput');
  if (!input) return;
  const msg = input.value.trim();

  if (!msg) {
    showToast('error', 'Poruka ne može biti prazna.', '⚠️');
    return;
  }

  if (localAnnounces.includes(msg)) {
    showToast('error', 'Ova poruka već postoji.', '⚠️');
    return;
  }

  localAnnounces.push(msg);
  input.value = '';
  renderAnnounceList();
  saveBotConfig(true); // Instant tihi autosave u bazu
}

function deleteAnnounceMessage(i) {
  localAnnounces.splice(i, 1);
  renderAnnounceList();
  saveBotConfig(true); // Instant tihi autosave u bazu
}

async function loadBotStatus() {
  if (!activeChannel) return;
  const { data } = await sb.from('bot_config')
    .select('bot_active')
    .eq('user_id', getChannelOwnerId())
    .eq('channel_id', activeChannel.id)
    .maybeSingle();
  if (data) updateBotStatusUI(data.bot_active || false);
}

function updateBotStatusUI(active) {
  const label = document.getElementById('botToggleLabel');
  const toggle = document.getElementById('botActiveToggle');

  if (label) { label.textContent = `Bot: ${active ? 'ON' : 'OFF'}`; label.style.color = active ? 'var(--kick-green)' : 'var(--text-muted)'; }
  if (toggle && toggle.checked !== active) { toggle.checked = active; }

  // Control Center updates
  const ctrlStatus = document.getElementById('ctrlBotStatus');
  const ctrlBtn = document.getElementById('ctrlBotToggleBtn');
  if (ctrlStatus) {
    ctrlStatus.innerHTML = active 
      ? '<span style="color: var(--kick-green); font-weight: bold; display: flex; align-items: center; gap: 6px;"><span class="status-dot status-on" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--kick-green); box-shadow:0 0 8px var(--kick-green);"></span> Bot je pokrenut</span>' 
      : '<span style="color: var(--text-muted); font-weight: bold; display: flex; align-items: center; gap: 6px;"><span class="status-dot status-off" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#EF4444; box-shadow:0 0 8px #EF4444;"></span> Bot je zaustavljen</span>';
  }
  if (ctrlBtn) {
    ctrlBtn.textContent = active ? 'Zaustavi bota' : 'Pokreni bota';
    ctrlBtn.className = active ? 'btn btn-outline btn-sm btn-danger' : 'btn btn-primary btn-sm';
  }
}

function toggleBotActiveFromCtrl() {
  const toggle = document.getElementById('botActiveToggle');
  if (toggle) {
    toggle.checked = !toggle.checked;
    toggleBotActive();
  }
}

function testBotConnection() {
  if (!activeChannel) {
    showToast('error', 'Nije izabran nijedan kanal za testiranje.', '❌');
    return;
  }

  showToast('info', 'Testiram vezu i šaljem ping u chat...', '🔄');

  const kickApiBase = getBotApiBase();

  fetch(`${kickApiBase}/api/kick/test-ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ chatroom_id: activeChannel.id }).toString()
  })
  .then(async (res) => {
    if (res.ok) {
      showToast('success', `Uspešno testirano! Ping poruka poslata u @${activeChannel.username} chat.`, '✅');
    } else {
      const err = await res.json().catch(() => ({ error: 'Greška na serveru' }));
      showToast('error', `Greška pri slanju pinga: ${err.detail || err.error || 'Neuspešan HTTP zahtev'}`, '❌');
    }
  })
  .catch((err) => {
    showToast('error', `Nije moguće kontaktirati bot server: ${err.message}`, '❌');
  });
}

function addLocalLog(type, message) {
  const feed = document.getElementById('botLiveFeed');
  if (!feed) return;

  const vreme = new Date().toLocaleTimeString('sr-RS', { hour12: false });
  let badgeColor = 'var(--text-muted)';
  if (type === 'ERR') badgeColor = '#EF4444';
  else if (type === 'WARN') badgeColor = '#F59E0B';
  else if (type === 'INFO') badgeColor = '#3B82F6';
  else if (type === 'BOT') badgeColor = 'var(--kick-green)';
  else if (type === 'CHAT') badgeColor = '#10B981';

  // Obriši praznu poruku ako postoji
  if (feed.innerText.includes('Čekam prve aktivnosti...')) {
    feed.innerHTML = '';
  }

  const logDiv = document.createElement('div');
  logDiv.className = 'log-item';
  logDiv.style = 'display: flex; gap: 8px; align-items: flex-start; text-align: left; font-family: monospace; font-size: 0.78rem; padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,0.02); line-height: 1.4; width: 100%; box-sizing: border-box;';
  logDiv.innerHTML = `
    <span style="color: var(--text-muted); flex-shrink: 0;">[${vreme}]</span>
    <span style="color: ${badgeColor}; font-weight: bold; flex-shrink: 0;">[${type}]</span>
    <span style="color: #E2E8F0; word-break: break-all; flex-grow: 1;">${escapeHtml(message)}</span>
  `;
  const wasAtBottom = (feed.scrollHeight - feed.clientHeight - feed.scrollTop) < 50;
  feed.appendChild(logDiv);
  if (wasAtBottom) {
    feed.scrollTop = feed.scrollHeight;
  }
}

async function toggleBotActive() {
  if (!activeChannel) return;
  const active = document.getElementById('botActiveToggle').checked;
  updateBotStatusUI(active);

  const { error } = await sb.from('bot_config')
    .upsert({
      user_id: getChannelOwnerId(),
      channel_id: activeChannel.id,
      channel_name: activeChannel.username,
      bot_active: active,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'channel_id' });

  if (error) {
    showToast('error', 'Greška pri promeni statusa', '❌');
    document.getElementById('botActiveToggle').checked = !active;
    updateBotStatusUI(!active);
  } else {
    showToast(active ? 'success' : 'info', `Bot ${active ? 'pokrenut' : 'zaustavljen'}`, active ? '🟢' : '⭕');
    addLocalLog('INFO', active ? 'Korisnik je pokrenuo bota' : 'Korisnik je zaustavio bota');
    notifyBotToReload();
  }
}

async function loadChannelLiveStatus() {
  if (!activeChannel) return;

  // Clear any existing polling interval
  if (liveStatusInterval) {
    clearInterval(liveStatusInterval);
    liveStatusInterval = null;
  }

  // Fetch once immediately
  await fetchKickLiveStatus();

  // Then poll every 60 seconds
  liveStatusInterval = setInterval(fetchKickLiveStatus, 60000);
}

async function fetchKickLiveStatus() {
  if (!activeChannel) return;

  // 1. Pokušaj preko našeg lokalnog bot servera (zaobilazi CORS i Cloudflare)
  try {
    const kickApiBase = getBotApiBase();

    const localRes = await fetch(`${kickApiBase}/api/kick/channel?username=${activeChannel.username}`);
    if (localRes.ok) {
      const data = await localRes.json();
      const isLive = data?.livestream !== null && data?.livestream !== undefined;
      updateLiveStatusUI(isLive);
      return;
    }
  } catch (_) {}

  const apiUrl = `https://kick.com/api/v2/channels/${activeChannel.username}`;
  const cacheBust = `&_t=${Date.now()}`;

  // Try allorigins (no caching, fresh response)
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(apiUrl)}${cacheBust}`;
    const res = await fetch(proxyUrl, { cache: 'no-store' });
    if (res.ok) {
      const wrapper = await res.json();
      if (wrapper?.contents) {
        const data = JSON.parse(wrapper.contents);
        // livestream is null when offline, object when live
        const isLive = data?.livestream !== null && data?.livestream !== undefined;
        updateLiveStatusUI(isLive);
        return;
      }
    }
  } catch (_) { }

  // Fallback: try corsproxy with cache-bust header
  try {
    const proxyUrl2 = `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`;
    const res2 = await fetch(proxyUrl2, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
    if (res2.ok) {
      const data = await res2.json();
      const isLive = data?.livestream !== null && data?.livestream !== undefined;
      updateLiveStatusUI(isLive);
      return;
    }
  } catch (_) { }

  // Final fallback to DB
  try {
    const { data } = await sb.from('channels')
      .select('is_active')
      .eq('id', activeChannel.id)
      .maybeSingle();
    updateLiveStatusUI(data ? !!data.is_active : false);
  } catch (_) { }
}

function updateLiveStatusUI(isLive) {
  // Update the sidebar channel status indicator
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  if (statusDot) {
    statusDot.className = isLive ? 'status-dot status-on' : 'status-dot status-off';
  }
  if (statusText) {
    statusText.textContent = isLive ? 'Live' : 'Offline';
    statusText.style.color = isLive ? 'var(--kick-green)' : 'var(--text-muted)';
  }
}

function setupRealtimeChannels() {
  if (realtimeSub) {
    sb.removeChannel(realtimeSub);
  }

  if (!activeChannel) return;

  realtimeSub = sb.channel('public:channels')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'channels',
      filter: `id=eq.${activeChannel.id}`
    }, payload => {
      if (payload.new) {
        updateLiveStatusUI(!!payload.new.is_active);
      }
    })
    .subscribe();
}

// ═══════════════════════════════════════════════════════════
// COMMANDS CRUD
// ═══════════════════════════════════════════════════════════
function openNewCmdModal() {
  editingCmdId = null;
  document.getElementById('cmdModalTitle').textContent = 'Nova komanda';
  document.getElementById('cmdName').value = '';
  document.getElementById('cmdName').disabled = false;
  document.getElementById('cmdResponse').value = '';
  document.getElementById('cmdResponse').disabled = false;
  
  const responseGroup = document.getElementById('cmdResponse').closest('.form-group');
  if (responseGroup) responseGroup.style.display = 'block';

  document.getElementById('cmdCooldown').value = '5000';
  document.getElementById('cmdMinRank').value = 'everyone';
  document.getElementById('cmdEnabled').checked = true;
  document.getElementById('cmdCharCount').textContent = '0';
  document.getElementById('cmdModalError').style.display = 'none';
  document.getElementById('saveCmdBtn').textContent = 'Sačuvaj';

  updateModalPreview();
  updateCooldownLabel();
  openModal('cmdModal');
}

function editCommand(id) {
  const cmd = allCommands.find(c => c.id === id);
  if (!cmd) return;

  editingCmdId = id;
  const isBuiltin = id.startsWith('builtin-') || !!cmd.is_default;
  document.getElementById('cmdModalTitle').textContent = isBuiltin ? 'Izmeni sistemsku komandu' : 'Izmeni komandu';
  document.getElementById('cmdName').value = cmd.command;
  document.getElementById('cmdName').disabled = isBuiltin;
  document.getElementById('cmdResponse').value = cmd.response;
  document.getElementById('cmdResponse').disabled = isBuiltin;

  const responseGroup = document.getElementById('cmdResponse').closest('.form-group');
  if (isBuiltin) {
    if (responseGroup) responseGroup.style.display = 'none';
  } else {
    if (responseGroup) responseGroup.style.display = 'block';
  }

  document.getElementById('cmdCooldown').value = cmd.cooldown_ms;
  document.getElementById('cmdMinRank').value = cmd.min_rank || 'everyone';
  document.getElementById('cmdEnabled').checked = cmd.enabled;
  document.getElementById('cmdCharCount').textContent = cmd.response.length;
  document.getElementById('cmdModalError').style.display = 'none';
  document.getElementById('saveCmdBtn').textContent = 'Sačuvaj izmene';

  updateModalPreview();
  updateCooldownLabel();
  openModal('cmdModal');
}

function updateModalPreview() {
  const response = document.getElementById('cmdResponse').value;
  const charCountEl = document.getElementById('cmdCharCount');
  if (charCountEl) {
    charCountEl.textContent = response.length;
    if (response.length > 500) {
      charCountEl.style.color = '#EF4444';
    } else {
      charCountEl.style.color = 'var(--text-muted)';
    }
  }

  const rawCommand = document.getElementById('cmdName').value.trim();
  const enabled = document.getElementById('cmdEnabled').checked;

  const firstAlias = rawCommand.split(',')[0].trim().replace(/^!/, '').toLowerCase();
  const triggerDisplay = firstAlias ? `!${firstAlias}` : '!komanda';
  const previewTriggerTextEl = document.getElementById('previewTriggerText');
  if (previewTriggerTextEl) previewTriggerTextEl.textContent = triggerDisplay;

  const responseDisplay = response.trim() || 'Bot će poslati ovaj tekst kada neko ukuca komandu...';
  const previewBotResponseTextEl = document.getElementById('previewBotResponseText');
  if (previewBotResponseTextEl) previewBotResponseTextEl.textContent = responseDisplay;

  const botMsgEl = document.getElementById('previewBotMsg');
  if (botMsgEl) {
    botMsgEl.style.opacity = enabled ? '1' : '0.35';
  }
}

function updateCooldownLabel() {
  const val = parseInt(document.getElementById('cmdCooldown').value);
  const labelEl = document.getElementById('cooldownSecondsLabel');
  if (!labelEl) return;
  
  if (isNaN(val) || val < 0) {
    labelEl.textContent = '0 sekundi cooldown-a';
    return;
  }
  if (val === 0) {
    labelEl.textContent = 'Bez cooldown-a';
    return;
  }
  const seconds = (val / 1000).toFixed(1);
  const secondsStr = seconds.endsWith('.0') ? seconds.slice(0, -2) : seconds;
  labelEl.textContent = `${secondsStr} sekundi cooldown-a`;
}

async function saveCommand() {
  const rawCommand = document.getElementById('cmdName').value.trim();
  const response = document.getElementById('cmdResponse').value.trim();
  const cooldown = parseInt(document.getElementById('cmdCooldown').value) || 5000;
  const enabled = document.getElementById('cmdEnabled').checked;
  const minRank = document.getElementById('cmdMinRank').value;
  const errEl = document.getElementById('cmdModalError');
  errEl.style.display = 'none';

  const isBuiltin = editingCmdId && (editingCmdId.startsWith('builtin-') || allCommands.find(c => c.id === editingCmdId)?.is_default);

  if (!rawCommand) { errEl.textContent = 'Unesi naziv komande.'; errEl.style.display = 'block'; return; }
  if (!isBuiltin && !response) { errEl.textContent = 'Unesi odgovor bota.'; errEl.style.display = 'block'; return; }
  if (!isBuiltin && response.length > 500) { errEl.textContent = 'Odgovor ne sme biti duži od 500 karaktera.'; errEl.style.display = 'block'; return; }

  const enteredAliases = rawCommand.split(',')
    .map(c => c.trim().replace(/^!/, '').toLowerCase())
    .filter(Boolean);

  if (enteredAliases.length === 0) {
    errEl.textContent = 'Unesi bar jedan validan alias.';
    errEl.style.display = 'block'; return;
  }

  const command = enteredAliases.join(', ');

  // Check duplicate za svaki uneti alias sa drugim custom komandama
  const otherCmds = allCommands.filter(c => c.id !== editingCmdId);
  let conflictDuplicate = null;
  for (const other of otherCmds) {
    const otherAliases = other.command.split(',').map(c => c.trim().toLowerCase());
    const duplicate = enteredAliases.find(a => otherAliases.includes(a));
    if (duplicate) {
      conflictDuplicate = duplicate;
      break;
    }
  }

  if (conflictDuplicate) {
    errEl.textContent = `Komanda "!${conflictDuplicate}" već postoji u drugoj grupi.`;
    errEl.style.display = 'block'; return;
  }

  if (!activeChannel) { errEl.textContent = 'Nema aktivnog kanala.'; errEl.style.display = 'block'; return; }

  setLoading('saveCmdBtn', true);

  const payload = {
    user_id: getChannelOwnerId(),
    channel_id: activeChannel.id,
    command,
    response,
    cooldown_ms: cooldown,
    min_rank: minRank,
    enabled,
    updated_at: new Date().toISOString(),
  };

  const existsInDb = editingCmdId && !editingCmdId.startsWith('builtin-');

  let error;
  if (existsInDb) {
    ({ error } = await sb.from('custom_commands').update(payload).eq('id', editingCmdId));
  } else {
    ({ error } = await sb.from('custom_commands').insert({
      ...payload,
      is_default: !!isBuiltin,
      created_at: new Date().toISOString()
    }));
  }

  setLoading('saveCmdBtn', false);

  if (error) {
    errEl.textContent = 'Greška pri čuvanju. Pokušaj ponovo.';
    errEl.style.display = 'block';
    console.error(error); return;
  }

  showToast('success', editingCmdId ? 'Komanda uspešno izmenjena' : 'Komanda uspešno kreirana!', '⚡');
  notifyBotToReload();
  closeModal('cmdModal');
  await loadCommands();
}

async function toggleCommand(id, currentEnabled, isDefault) {
  if (id.startsWith('builtin-')) {
    const cmdObj = allCommands.find(c => c.id === id);
    if (!cmdObj) return;

    const payload = {
      user_id: getChannelOwnerId(),
      channel_id: activeChannel.id,
      command: cmdObj.command,
      response: cmdObj.response,
      cooldown_ms: cmdObj.cooldown_ms,
      min_rank: cmdObj.min_rank || 'everyone',
      enabled: !currentEnabled,
      is_default: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { error } = await sb.from('custom_commands').insert(payload);
    if (error) { showToast('error', 'Greška pri čuvanju ugrađene komande', '❌'); console.error(error); return; }
  } else {
    const { error } = await sb.from('custom_commands')
      .update({ enabled: !currentEnabled, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { showToast('error', 'Greška', '❌'); return; }
  }

  showToast('info', !currentEnabled ? 'Komanda uključena' : 'Komanda isključena', !currentEnabled ? '✅' : '⏸');
  notifyBotToReload();
  await loadCommands();
}

function deleteCommandConfirm(id, cmd) {
  confirmCallback = async () => {
    const { error } = await sb.from('custom_commands').delete().eq('id', id);
    if (error) { showToast('error', 'Greška pri brisanju', '❌'); return; }
    showToast('success', `${cmd} je obrisana`, '🗑');
    notifyBotToReload();
    await loadCommands();
  };
  document.getElementById('confirmMsg').textContent = `Da li sigurno želiš da obrišeš komandu ${cmd}? Ovo se ne može poništiti.`;
  document.getElementById('confirmDeleteBtn').onclick = () => { closeModal('confirmModal'); confirmCallback(); };
  openModal('confirmModal');
}

// ── Char counter for cmd response ──────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const resp = document.getElementById('cmdResponse');
  if (resp) {
    resp.addEventListener('input', () => {
      document.getElementById('cmdCharCount').textContent = resp.value.length;
    });
  }
});



// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
const PANEL_NAMES = {
  overview: 'Overview',
  commands: 'Komande',
  leaderboard: 'Leaderboard',
  watchtime: 'Watchtime',
  marriages: 'Ljubav i brakovi',
  minigames: 'Mini igre',
  songs: 'Song Request',
  autoresponse: 'Bot interakcija',
  announces: 'Automatske poruke',
  config: 'Bot Config',
  moderation: 'Moderacija',
};

function updateBreadcrumbs(panelId) {
  const breadcrumb = document.getElementById('breadcrumb');
  if (!breadcrumb) return;

  let html = `<span>Kickot</span>`;

  if (panelId === 'overview') {
    html += `
      <span class="bc-sep">›</span>
      <span id="breadcrumbPage">Dashboard</span>
    `;
  } else if (panelId === 'leaderboard') {
    const subTypeLabel = activeLeaderboardType === 'chatters' ? 'Chatters' : activeLeaderboardType === 'watchtime' ? 'Watchtime' : 'Zajedno';
    html += `
      <span class="bc-sep">›</span>
      <span>Leaderboard</span>
      <span class="bc-sep">›</span>
      <span id="breadcrumbPage">${subTypeLabel}</span>
    `;
  } else {
    html += `
      <span class="bc-sep">›</span>
      <span id="breadcrumbPage">${PANEL_NAMES[panelId] || panelId}</span>
    `;
  }

  breadcrumb.innerHTML = html;
}

function switchPanel(panelId) {
  // Sačuvaj aktivni panel u localStorage
  localStorage.setItem('active-dashboard-panel', panelId);

  // Deactivate all
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Activate target
  const panel = document.getElementById(`panel-${panelId}`);
  const navItem = document.querySelector(`[data-panel="${panelId}"]`);
  if (panel) panel.classList.add('active');
  if (navItem) navItem.classList.add('active');

  // Breadcrumb
  updateBreadcrumbs(panelId);

  // Lazy load panel data
  if (panelId === 'leaderboard') {
    loadLeaderboard();
    loadWatchtime();
  }
  if (panelId === 'marriages') {
    loadMarriages();
    loadLoveStatuses();
  }
  if (panelId === 'autoresponse' && !configLoaded) loadBotConfig();
  if (panelId === 'announces' && !configLoaded) loadBotConfig();
  if (panelId === 'config' && !configLoaded) loadBotConfig();
  if (panelId === 'moderation' && !configLoaded) loadBotConfig();
  if (panelId === 'songs' && !configLoaded) loadBotConfig();
  if (panelId === 'games') renderBuiltinCommandsGrid();

  // Close mobile sidebar
  if (window.innerWidth < 768) {
    document.getElementById('sidebar').classList.remove('mobile-open');
  }
}

// ── Sidebar Toggle ─────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth < 768) {
    sidebar.classList.toggle('mobile-open');
  }
}

// ── Channel Menu ───────────────────────────────────────────
function toggleChannelMenu() {
  const menu = document.getElementById('channelMenu');
  menu.classList.toggle('open');
}

document.addEventListener('click', e => {
  const sw = document.getElementById('channelSwitcher');
  if (sw && !sw.contains(e.target)) {
    document.getElementById('channelMenu')?.classList.remove('open');
  }
  const pill = document.getElementById('userPill');
  if (pill && !pill.contains(e.target)) {
    document.getElementById('userMenuSm')?.classList.remove('open');
  }
});

// ── User Menu ──────────────────────────────────────────────
function toggleUserMenu() {
  document.getElementById('userMenuSm').classList.toggle('open');
}
async function handleSignOut() {
  localStorage.removeItem('active-dashboard-panel');
  sessionStorage.removeItem('dashboard-session-active');
  await sb.auth.signOut();
  window.location.href = 'index.html';
}
function goToSettings() { showToast('info', 'Podešavanja dolaze uskoro', 'ℹ️'); }

// ═══════════════════════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════════════════════
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}
function handleModalBg(e, id) {
  if (e.target.id === id) closeModal(id);
}

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['cmdModal', 'addChannelModal', 'confirmModal', 'feedbackModal', 'modFilterPenaltyModal', 'docsModal'].forEach(id => {
      document.getElementById(id)?.classList.remove('open');
    });
    document.body.style.overflow = '';
  }
});

// ═══════════════════════════════════════════════════════════
// TOASTS
// ═══════════════════════════════════════════════════════════
let toastId = 0;
function showToast(type, msg, iconEmoji = '💬', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const id = ++toastId;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.id = `toast-${id}`;

  let svgIcon = '';
  if (type === 'success') {
    svgIcon = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;
  } else if (type === 'error') {
    svgIcon = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
    `;
  } else if (type === 'info') {
    svgIcon = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>
    `;
  } else {
    svgIcon = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    `;
  }

  el.innerHTML = `
    <div class="toast-icon-wrap">${svgIcon}</div>
    <div class="toast-msg">${msg}</div>
    <button class="toast-close" onclick="removeToast(${id})">✕</button>
  `;

  // Max 3 newest toasts: push the oldest active one up with a smooth slide-up collapse
  const activeToasts = Array.from(container.children).filter(child => !child.classList.contains('toast-leaving'));
  if (activeToasts.length >= 3) {
    const oldest = activeToasts[0];
    oldest.classList.add('toast-leaving');
    const match = oldest.id.match(/toast-(\d+)/);
    if (match) {
      removeToast(parseInt(match[1]));
    } else {
      oldest.remove();
    }
  }

  container.appendChild(el);
  
  // Trigger entry animation in the next paint cycle
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

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════
function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    // Lock dimensions to prevent layout shift
    btn.style.width = btn.offsetWidth + 'px';
    btn.style.height = btn.offsetHeight + 'px';
    btn._originalText = btn.innerHTML;
    btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.25);border-top-color:#fff;border-radius:50%;animation:spin 0.65s linear infinite"></span>';
  } else {
    if (btn._originalText) btn.innerHTML = btn._originalText;
    // Release locked dimensions
    btn.style.width = '';
    btn.style.height = '';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
}

function getCurrentMonth() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
}

function rankColor(i) {
  if (i === 0) return '#FBBF24';
  if (i === 1) return '#94A3B8';
  if (i === 2) return '#92400E';
  return 'var(--text-primary)';
}

function downloadCsv(content, filename) {
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(content);
  a.download = filename;
  a.click();
}

// ── Add spinner keyframe to document ──────────────────────
const style = document.createElement('style');
style.textContent = '@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';
document.head.appendChild(style);

// ── Settings Modal Functions ──────────────────────────────
let settingsUploadedAvatarBase64 = null;

function openSettingsModal(activeTab = 'profile') {
  const userMenuSm = document.getElementById('userMenuSm');
  if (userMenuSm) {
    userMenuSm.classList.remove('open');
  }
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  sb.auth.getUser().then(({ data: { user } }) => {
    if (!user) {
      showToast('error', 'Moraš biti prijavljen da pristupiš podešavanjima.', '⚠️');
      return;
    }

    // Fill in fields
    const name = user.user_metadata?.display_name || user.email?.split('@')[0] || 'User';
    const avatarVal = user.user_metadata?.avatar_url || name.charAt(0).toUpperCase();

    document.getElementById('settingsEmail').value = user.email;
    document.getElementById('settingsName').value = name;
    document.getElementById('settingsPassword').value = '';
    document.getElementById('settingsConfirmPassword').value = '';

    setSettingsAvatarPreview(avatarVal);
    settingsUploadedAvatarBase64 = null;

    modal.classList.add('open');
    switchSettingsTab(activeTab);
  });
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    modal.classList.remove('open');
  }
}

function handleSettingsModalBackdropClick(e) {
  if (e.target.id === 'settingsModal') {
    closeSettingsModal();
  }
}

function setSettingsAvatarPreview(urlOrEmoji) {
  const imgEl = document.getElementById('settingsAvatarPreviewImg');
  if (!imgEl) return;
  if (urlOrEmoji.startsWith('data:image') || urlOrEmoji.startsWith('http')) {
    imgEl.style.backgroundImage = `url("${urlOrEmoji}")`;
    imgEl.style.backgroundSize = 'cover';
    imgEl.style.backgroundPosition = 'center';
    imgEl.textContent = '';
  } else {
    imgEl.style.backgroundImage = 'none';
    imgEl.textContent = urlOrEmoji;
  }
}

function triggerSettingsAvatarUpload() {
  document.getElementById('settingsAvatarFileInput').click();
}

function handleSettingsAvatarFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (evt) {
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement('canvas');
      const maxDim = 128;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxDim) {
          height *= maxDim / width;
          width = maxDim;
        }
      } else {
        if (height > maxDim) {
          width *= maxDim / height;
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.65);
      setSettingsAvatarPreview(compressedBase64);
      settingsUploadedAvatarBase64 = compressedBase64;
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
}

function selectSettingsPresetAvatar(key) {
  const emojis = { robot: '🤖', ninja: '🥷', gamepad: '🎮', star: '⭐' };
  const emoji = emojis[key];
  setSettingsAvatarPreview(emoji);
  settingsUploadedAvatarBase64 = emoji;
}

async function handleSaveSettings() {
  const name = document.getElementById('settingsName').value.trim();
  const password = document.getElementById('settingsPassword').value;
  const confirmPassword = document.getElementById('settingsConfirmPassword').value;

  if (!name) {
    showToast('error', 'Ime ne može biti prazno.', '⚠️');
    return;
  }

  if (password) {
    if (password.length < 8) {
      showToast('error', 'Lozinka mora imati barem 8 karaktera.', '⚠️');
      return;
    }
    if (password !== confirmPassword) {
      showToast('error', 'Lozinke se ne podudaraju.', '⚠️');
      return;
    }
  }

  const btn = document.getElementById('settingsSaveBtn');
  btn.disabled = true;

  try {
    const updateData = { display_name: name };
    if (settingsUploadedAvatarBase64 !== null) {
      updateData.avatar_url = settingsUploadedAvatarBase64;
    }

    const { error: profileError } = await sb.auth.updateUser({ data: updateData });
    if (profileError) throw profileError;

    if (password) {
      const { error: passwordError } = await sb.auth.updateUser({ password: password });
      if (passwordError) throw passwordError;
    }

    showToast('success', 'Podešavanja uspešno sačuvana!', '✅');
    closeSettingsModal();

    // Refresh user state
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      currentUser = user;
      // Update sidebar avatar/name immediately
      const avatarVal = currentUser.user_metadata?.avatar_url || name.charAt(0).toUpperCase();
      const sidebarAvEl = document.getElementById('sidebarAvatar');
      if (avatarVal.startsWith('data:image') || avatarVal.startsWith('http')) {
        sidebarAvEl.style.backgroundImage = `url("${avatarVal}")`;
        sidebarAvEl.style.backgroundSize = 'cover';
        sidebarAvEl.style.backgroundPosition = 'center';
        sidebarAvEl.textContent = '';
      } else {
        sidebarAvEl.style.backgroundImage = 'none';
        sidebarAvEl.textContent = avatarVal;
      }
      document.getElementById('sidebarName').textContent = name;
    }

  } catch (err) {
    showToast('error', err.message || 'Greška pri čuvanju podešavanja.', '❌');
  } finally {
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
function switchSettingsTab(tabName) {
  const tabProfile = document.getElementById('setTabProfile');
  const tabChannels = document.getElementById('setTabChannels');
  const tabManagers = document.getElementById('setTabManagers');
  
  const panelProfile = document.getElementById('settingsProfilePanel');
  const panelChannels = document.getElementById('settingsChannelsPanel');
  const panelManagers = document.getElementById('settingsManagersPanel');

  if (!tabProfile || !tabChannels || !tabManagers || !panelProfile || !panelChannels || !panelManagers) return;

  // Reset active states
  tabProfile.classList.remove('active');
  tabChannels.classList.remove('active');
  tabManagers.classList.remove('active');

  panelProfile.style.display = 'none';
  panelChannels.style.display = 'none';
  panelManagers.style.display = 'none';

  if (tabName === 'profile') {
    tabProfile.classList.add('active');
    panelProfile.style.display = 'block';
  } else if (tabName === 'channels') {
    tabChannels.classList.add('active');
    panelChannels.style.display = 'block';
    renderSettingsChannelList();
  } else if (tabName === 'managers') {
    tabManagers.classList.add('active');
    panelManagers.style.display = 'block';
    renderSettingsManagersList();
  }
}

function renderSettingsManagersList() {
  const listEl = document.getElementById('settingsManagerList');
  const ownerView = document.getElementById('settingsManagersOwnerView');
  const guestView = document.getElementById('settingsManagersGuestView');
  if (!listEl || !ownerView || !guestView) return;

  // Proveri da li smo mi vlasnik ovog kanala
  const isManaged = activeChannel && activeChannel.is_managed === true;
  if (isManaged) {
    ownerView.style.display = 'none';
    guestView.style.display = 'block';
    return;
  }

  ownerView.style.display = 'block';
  guestView.style.display = 'none';
  listEl.innerHTML = '';

  const managers = activeChannel?.managers || [];

  if (managers.length === 0) {
    listEl.innerHTML = '<div style="padding:10px;font-size:0.85rem;color:var(--text-muted);text-align:center;">Nema aktivnih menadžera za ovaj kanal.</div>';
    return;
  }

  managers.forEach(m => {
    const item = document.createElement('div');
    item.className = 'modal-channel-item';
    item.style = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); margin-bottom: 6px;';

    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="manager-avatar" data-username="${m}" style="width:24px;height:24px;border-radius:50%;background:var(--app-gradient);display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;background-size:cover;background-position:center;">
          ${m.charAt(0).toUpperCase()}
        </div>
        <span style="font-weight:600;font-size:0.85rem;">${escapeHtml(m)}</span>
      </div>
      <button class="btn btn-sm btn-danger" onclick="removeChannelManager('${escapeHtml(m)}')" style="padding: 2px 8px; font-size: 0.75rem;">Ukloni</button>
    `;
    listEl.appendChild(item);

    // Dohvati profilnu sliku menadžera u pozadini
    fetchKickAvatar(m).then(avatarUrl => {
      if (avatarUrl) {
        const avatarEl = item.querySelector(`.manager-avatar[data-username="${m}"]`);
        if (avatarEl) {
          avatarEl.style.backgroundImage = `url("${avatarUrl}")`;
          avatarEl.textContent = '';
        }
      }
    }).catch(() => {});
  });
}

async function addNewManager() {
  const input = document.getElementById('settingsNewManagerInput');
  const errEl = document.getElementById('settingsAddManagerError');
  if (!input || !errEl) return;
  
  errEl.style.display = 'none';
  const username = input.value.trim();
  
  if (!username) {
    errEl.textContent = 'Unesi Kick korisničko ime.';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('settingsAddManagerBtn');
  if (btn) btn.disabled = true;

  try {
    // 1. Proveri da li korisnik uopšte postoji na Kick platformi
    const resolved = await resolveChatroomId(username);
    if (!resolved) {
      errEl.textContent = `Korisnik @${username} ne postoji na Kick platformi.`;
      errEl.style.display = 'block';
      if (btn) btn.disabled = false;
      return;
    }

    const kickUsernameResolved = resolved.username; // Pravilno napisano ime sa Kick-a (npr. Milan)
    const kickUsernameLC = kickUsernameResolved.toLowerCase();

    // 2. Dobavi naše korisničko ime iz sopstvenog profila da sprečimo dodavanje samog sebe
    const { data: myProfile } = await sb.from('user_profiles').select('display_name').eq('id', currentUser.id).maybeSingle();
    const myName = myProfile?.display_name || '';

    if (kickUsernameLC === myName.toLowerCase()) {
      errEl.textContent = 'Ne možeš dodati samog sebe kao menadžera.';
      errEl.style.display = 'block';
      if (btn) btn.disabled = false;
      return;
    }

    if (!activeChannel.managers) activeChannel.managers = [];
    
    if (activeChannel.managers.map(m => m.toLowerCase()).includes(kickUsernameLC)) {
      errEl.textContent = 'Korisnik je već menadžer ovog kanala.';
      errEl.style.display = 'block';
      if (btn) btn.disabled = false;
      return;
    }

    // 3. Proveri da li korisnik ima kreiran nalog na našem sajtu
    const { data: profileUser, error: profileErr } = await sb.from('user_profiles')
      .select('id, display_name')
      .ilike('display_name', kickUsernameLC)
      .maybeSingle();

    // Dodajemo menadžera sa njegovim pravim imenom sa Kick-a
    activeChannel.managers.push(kickUsernameResolved);

    const updatedChannels = currentChannels.map(c => {
      if (c.id === activeChannel.id) {
        return { ...c, managers: activeChannel.managers };
      }
      return c;
    });

    const { error: updateErr } = await sb.from('user_profiles')
      .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
      .eq('id', currentUser.id);

    if (updateErr) throw updateErr;

    currentChannels = updatedChannels;
    input.value = '';

    if (!profileUser) {
      showToast('success', `Korisnik @${kickUsernameResolved} je dodat! Nalog na sajtu će mu biti aktiviran čim se prvi put prijavi preko Kick OAuth-a.`, '✅');
    } else {
      showToast('success', `Korisnik @${kickUsernameResolved} je uspešno dodat kao menadžer!`, '✅');
    }
    
    renderSettingsManagersList();

  } catch (err) {
    console.error('Failed to add manager:', err);
    errEl.textContent = 'Greška pri dodavanju menadžera. Pokušaj ponovo.';
    errEl.style.display = 'block';
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function removeChannelManager(username) {
  if (!confirm(`Da li sigurno želiš da ukloniš menadžera @${username}?`)) return;

  try {
    activeChannel.managers = (activeChannel.managers || []).filter(m => m.toLowerCase() !== username.toLowerCase());

    const updatedChannels = currentChannels.map(c => {
      if (c.id === activeChannel.id) {
        return { ...c, managers: activeChannel.managers };
      }
      return c;
    });

    const { error: updateErr } = await sb.from('user_profiles')
      .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
      .eq('id', currentUser.id);

    if (updateErr) throw updateErr;

    currentChannels = updatedChannels;
    showToast('success', `Menadžer @${username} je uklonjen.`, '✅');
    renderSettingsManagersList();

  } catch (err) {
    console.error('Failed to remove manager:', err);
    showToast('error', 'Greška pri uklanjanju menadžera.', '❌');
  }
}

async function makeChannelPrimary(channelId) {
  const updatedChannels = currentChannels.map(c => ({
    ...c,
    is_primary: c.id === channelId
  }));

  const { error } = await sb.from('user_profiles')
    .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
    .eq('id', currentUser.id);

  if (error) {
    showToast('error', 'Greška pri postavljanju glavnog kanala.', '❌');
    return;
  }

  currentChannels = updatedChannels;
  const primary = currentChannels.find(c => c.is_primary);
  if (primary) {
    setActiveChannel(primary);
  }

  renderChannelList();
  renderSettingsChannelList();
  showToast('success', 'Glavni kanal je ažuriran!', '✅');
}

async function deleteConnectedChannel(channelId) {
  const channelToDelete = currentChannels.find(c => c.id === channelId);
  if (!channelToDelete) return;

  const confirmCallback = async () => {
    let updatedChannels = currentChannels.filter(c => c.id !== channelId);

    // If we deleted the primary channel, assign a new primary
    if (channelToDelete.is_primary && updatedChannels.length > 0) {
      updatedChannels[0].is_primary = true;
    }

    const { error } = await sb.from('user_profiles')
      .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
      .eq('id', currentUser.id);

    if (error) {
      showToast('error', 'Greška pri uklanjanju kanala.', '❌');
      return;
    }

    currentChannels = updatedChannels;

    if (activeChannel?.id === channelId) {
      if (currentChannels.length > 0) {
        setActiveChannel(currentChannels.find(c => c.is_primary) || currentChannels[0]);
      } else {
        activeChannel = null;
        const nameDisplay = document.getElementById('channelNameDisplay');
        if (nameDisplay) nameDisplay.textContent = 'Nema kanala';
        const topbarDisplay = document.getElementById('topbarChannel');
        if (topbarDisplay) topbarDisplay.textContent = '—';
      }
    }

    renderChannelList();
    renderSettingsChannelList();
    showToast('success', 'Kanal je uspešno uklonjen.', '🗑️');
  };

  document.getElementById('confirmMsg').textContent = `Da li ste sigurni da želite da uklonite kanal @${channelToDelete.username}? Ovo se ne može poništiti.`;
  document.getElementById('confirmDeleteBtn').onclick = () => { closeModal('confirmModal'); confirmCallback(); };
  openModal('confirmModal');
}

function renderSettingsChannelList() {
  const listEl = document.getElementById('settingsChannelList');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (currentChannels.length === 0) {
    listEl.innerHTML = '<div style="padding:10px;font-size:0.85rem;color:var(--text-muted);text-align:center;">Nema povezanih kanala.</div>';
    return;
  }

  currentChannels.forEach(ch => {
    const item = document.createElement('div');
    item.className = 'modal-channel-item';

    const avatarHtml = ch.avatar
      ? `<div class="modal-channel-avatar" style="background-image:url('${ch.avatar}');background-size:cover;background-position:center;"></div>`
      : `<div class="modal-channel-avatar">${ch.username.charAt(0).toUpperCase()}</div>`;

    const badgeHtml = ch.is_primary
      ? `<span class="modal-ch-badge primary">Glavni</span>`
      : `<button class="btn btn-outline btn-sm" onclick="makeChannelPrimary('${ch.id}')" style="padding:3px 8px;font-size:0.75rem;border-radius:4px;cursor:pointer;">Glavni</button>`;

    item.innerHTML = `
      <div class="modal-channel-info">
        ${avatarHtml}
        <div>
          <div class="modal-channel-name">${ch.username}</div>
          <div style="font-size:0.7rem;color:var(--text-muted)">ID: ${ch.id}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        ${badgeHtml}
        <button class="btn btn-outline btn-sm" onclick="deleteConnectedChannel('${ch.id}')" style="padding:3px 8px;font-size:0.75rem;border-radius:4px;border-color:rgba(239,68,68,0.2);color:#ef4444;cursor:pointer;" title="Ukloni kanal">✕</button>
      </div>
    `;
    listEl.appendChild(item);
  });
}

async function addNewChannel() {
  const input = document.getElementById('settingsNewChannelInput');
  const errEl = document.getElementById('settingsAddChannelError');
  const btn = document.getElementById('settingsAddChannelBtn');
  if (!input || !errEl) return;

  errEl.style.display = 'none';
  const rawVal = input.value.trim();
  if (!rawVal) {
    errEl.textContent = 'Unesite Kick username ili URL kanala.';
    errEl.style.display = 'block';
    return;
  }

  const username = extractKickUsername(rawVal);
  if (currentChannels.some(c => c.username.toLowerCase() === username.toLowerCase())) {
    errEl.textContent = 'Ovaj kanal je već dodat.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  const resolved = await resolveChatroomId(username);
  btn.disabled = false;

  if (!resolved) {
    errEl.textContent = `Kanal "${username}" nije pronađen na Kick platformi.`;
    errEl.style.display = 'block';
    return;
  }

  const newCh = {
    id: resolved.id,
    username: resolved.username,
    avatar: resolved.avatar || null,
    is_primary: currentChannels.length === 0
  };

  const updatedChannels = [...currentChannels, newCh];

  const { error } = await sb.from('user_profiles')
    .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
    .eq('id', currentUser.id);

  if (error) {
    errEl.textContent = 'Greška pri čuvanju kanala.';
    errEl.style.display = 'block';
    return;
  }

  currentChannels = updatedChannels;
  input.value = '';

  if (newCh.is_primary) {
    setActiveChannel(newCh);
  }

  renderChannelList();
  renderSettingsChannelList();
  showToast('success', `Kanal @${newCh.username} je dodat!`, '✅');
}


function updateOverviewModulesUI() {
  const lbActive = document.getElementById('cfgLeaderboard')?.checked ?? true;
  const wtActive = document.getElementById('cfgWatchtime')?.checked ?? true;
  const gmActive = document.getElementById('cfgGames')?.checked ?? true;
  const lvActive = document.getElementById('cfgLove')?.checked ?? true;
  const irActive = document.getElementById('cfgAutoresponse')?.checked ?? true;
  const mdActive = document.getElementById('cfgModeration')?.checked ?? false;
  const srActive = document.getElementById('cfgSongRequestEnabled')?.checked ?? false;
  
  const setStatus = (id, active, name) => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = active 
        ? `${name} ✔` 
        : `${name} ❌`;
      el.style.color = active ? '#10B981' : 'var(--text-muted)';
      el.style.opacity = active ? '1' : '0.65';
    }
  };
  
  setStatus('ovStatusLeaderboard', lbActive, 'Leaderboard');
  setStatus('ovStatusWatchtime', wtActive, 'Watchtime');
  setStatus('ovStatusGames', gmActive, 'Mini igre');
  setStatus('ovStatusLove', lvActive, 'Ljubav');
  setStatus('ovStatusInteraction', irActive, 'Interakcija');
  setStatus('ovStatusModeration', mdActive, 'Moderacija');
  setStatus('ovStatusSongRequest', srActive, 'Song Request');

  // Toggle overlays for disabled panels
  toggleModuleOverlay('panel-leaderboard', lbActive);
  toggleModuleOverlay('panel-minigames', gmActive);
  toggleModuleOverlay('panel-marriages', lvActive);
  toggleModuleOverlay('panel-autoresponse', irActive);
  toggleModuleOverlay('panel-moderation', mdActive);
  toggleModuleOverlay('panel-songs', srActive);
}

function toggleModuleOverlay(panelId, active) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  
  // Ensure relative positioning on the section
  panel.style.position = 'relative';
  
  // Look for existing overlay
  const existingOverlay = panel.querySelector('.module-disabled-overlay');
  
  if (active) {
    if (existingOverlay) {
      existingOverlay.remove();
    }
    panel.style.overflow = '';
    panel.style.height = '';
  } else {
    panel.style.overflow = 'hidden';
    panel.style.height = 'calc(100vh - 120px)'; // Center overlay and prevent scrolling
    if (!existingOverlay) {
      const overlay = document.createElement('div');
      overlay.className = 'module-disabled-overlay';
      overlay.style = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: #0a0614;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        border-radius: var(--radius-lg);
        padding: 40px;
        text-align: center;
        box-sizing: border-box;
      `;
      overlay.innerHTML = `
        <div style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 20px; box-shadow: 0 0 20px rgba(239, 68, 68, 0.15);">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 style="font-family: var(--font-heading); font-size: 1.5rem; font-weight: 700; color: #fff; margin: 0 0 10px 0;">Modul nije aktiviran</h2>
        <p style="color: var(--text-muted); font-size: 0.95rem; line-height: 1.5; max-width: 400px; margin: 0 0 24px 0;">
          Ovaj modul je trenutno isključen. Da biste pristupili podacima i koristili ove opcije, aktivirajte ga u podešavanjima bota.
        </p>
        <button class="btn btn-primary" onclick="switchPanel('config')" style="padding: 10px 24px; font-weight: 600; cursor: pointer;">Aktiviraj u Bot Config</button>
      `;
      panel.appendChild(overlay);
    }
  }
}

let liveFeedInterval = null;
function startLiveActivityFeed() {
  const feed = document.getElementById('botLiveFeed');
  if (!feed) return;

  if (liveFeedInterval) {
    clearInterval(liveFeedInterval);
    liveFeedInterval = null;
  }

  // Omogući autoscroll po defaultu i podešavanje visine za skrolovanje
  feed.style.overflowY = 'auto';
  feed.style.display = 'flex';
  feed.style.flexDirection = 'column';
  feed.style.gap = '2px';

  async function fetchLogs() {
    if (!activeChannel) return;

    try {
      const res = await fetch(`${getBotApiBase()}/api/kick/logs?chatroom_id=${activeChannel.id}`);
      const dot = document.getElementById('botLiveFeedDot');
      if (res.ok) {
        if (dot) {
          dot.style.background = 'var(--kick-green)';
          dot.style.boxShadow = '0 0 8px var(--kick-green)';
        }
        const logs = await res.json();
        if (logs.length === 0) {
          feed.innerHTML = `
            <div style="color: var(--text-muted); text-align: center; padding-top: 60px; font-style: italic; font-size: 0.85rem;">
              Čekam prve aktivnosti...
            </div>
          `;
          return;
        }

        const wasAtBottom = (feed.scrollHeight - feed.clientHeight - feed.scrollTop) < 50;

        // Renderuj logove
        feed.innerHTML = logs.map(log => {
          let badgeColor = 'var(--text-muted)';
          if (log.type === 'ERR') badgeColor = '#EF4444';
          else if (log.type === 'WARN') badgeColor = '#F59E0B';
          else if (log.type === 'INFO') badgeColor = '#3B82F6';
          else if (log.type === 'BOT') badgeColor = 'var(--kick-green)';
          else if (log.type === 'CHAT') badgeColor = '#10B981';

          // Očisti poruku od prefiksa kanala (npr. [KickotBot] ili [Milan_567])
          let cleanMessage = log.message || '';
          if (activeChannel) {
            const prefixRegex = new RegExp(`^\\[${activeChannel.username}\\]\\s*`, 'i');
            cleanMessage = cleanMessage.replace(prefixRegex, '');
            const atPrefixRegex = new RegExp(`^\\[@${activeChannel.username}\\]\\s*`, 'i');
            cleanMessage = cleanMessage.replace(atPrefixRegex, '');
          }

          return `
            <div class="log-item" style="display: flex; gap: 8px; align-items: flex-start; text-align: left; font-family: monospace; font-size: 0.78rem; padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,0.02); line-height: 1.4; width: 100%; box-sizing: border-box;">
              <span style="color: var(--text-muted); flex-shrink: 0;">[${log.timestamp}]</span>
              <span style="color: ${badgeColor}; font-weight: bold; flex-shrink: 0;">[${log.type}]</span>
              <span style="color: #E2E8F0; word-break: break-all; flex-grow: 1;">${escapeHtml(cleanMessage)}</span>
            </div>
          `;
        }).join('');

        // Skroluj na dno da uvek prikazuje najnovije logove ako je bio na dnu
        if (wasAtBottom) {
          feed.scrollTop = feed.scrollHeight;
        }
      } else {
        if (dot) {
          dot.style.background = 'red';
          dot.style.boxShadow = '0 0 8px red';
        }
      }
    } catch (_) {
      const dot = document.getElementById('botLiveFeedDot');
      if (dot) {
        dot.style.background = 'red';
        dot.style.boxShadow = '0 0 8px red';
      }
    }
  }

  // Povuci odmah, pa na svake 3 sekunde
  fetchLogs();
  liveFeedInterval = setInterval(fetchLogs, 3000);
}

// ── Kick OAuth Helperi za dodavanje kanala ─────────────────────────────────
function generateRandomString(length) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let text = '';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest('SHA-256', data);
}

function base64urlencode(a) {
  let str = "";
  const bytes = new Uint8Array(a);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generateCodeChallenge(v) {
  const hashed = await sha256(v);
  return base64urlencode(hashed);
}

function getKickRedirectUri() {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `${window.location.origin}/auth/kick/callback/`;
  }
  return `${window.location.origin}/auth/kick/callback`;
}

async function openKickLoginForChannel() {
  if (!currentUser) return;
  const KICK_CLIENT_ID = '01KXN4YW8GF6DPXSC1JMMJ25QN';
  const KICK_REDIRECT_URI = getKickRedirectUri();
  const KICK_SCOPE = 'user:read';

  const state = generateRandomString(16);
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  sessionStorage.setItem('kick_oauth_state', state);
  sessionStorage.setItem('kick_code_verifier', codeVerifier);
  sessionStorage.setItem('kick_oauth_intent', 'add_channel');
  sessionStorage.setItem('kick_add_channel_uid', currentUser.id);
  sessionStorage.setItem('kick_oauth_source', 'dashboard');

  const authUrl = 'https://id.kick.com/oauth/authorize?' + new URLSearchParams({
    response_type: 'code',
    client_id: KICK_CLIENT_ID,
    redirect_uri: KICK_REDIRECT_URI,
    scope: KICK_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  }).toString();

  window.location.href = authUrl;
}

let autosaveConfigDebounce = null;
let autosaveModDebounce = null;

function triggerAutosaveConfig() {
  if (!configLoaded) return;
  if (autosaveConfigDebounce) clearTimeout(autosaveConfigDebounce);
  autosaveConfigDebounce = setTimeout(() => {
    saveBotConfig(true);
  }, 1000); // 1 sekunda debounce za stabilnost
}

function triggerAutosaveMod() {
  if (!configLoaded) return;
  if (autosaveModDebounce) clearTimeout(autosaveModDebounce);
  autosaveModDebounce = setTimeout(() => {
    saveModerationSettings(true);
  }, 1000); // 1 sekunda debounce za stabilnost
}

function setupAutosave() {
  // 1. Inputs koji okidaju saveBotConfig
  const configInputIds = [
    'cfgPrefix', 'cfgLanguage', 'cfgCooldown', 'cfgLeaderboard', 'cfgWatchtime',
    'cfgGames', 'cfgLove', 'cfgModeration', 'cfgAutoresponse', 'cfgSpamThreshold',
    'cfgSpamWindow', 'cfgPinMsg', 'cfgWelcomeMsg', 'cfgAnnounceInterval',
    'cfgAnnounceThreshold', 'cfgAnnounceTimeEnabled', 'cfgAnnounceMsgEnabled',
    'cfgAlertFollowEnabled', 'cfgAlertFollowMsg',
    'cfgAlertKicksEnabled', 'cfgAlertKicksMsg', 'cfgAlertKicksMin',
    'cfgAlertSubEnabled', 'cfgAlertSubMsg',
    'cfgAlertResubEnabled', 'cfgAlertResubMsg',
    'cfgAlertGiftsubEnabled', 'cfgAlertGiftsubMsg',
    'cfgAlertHostEnabled', 'cfgAlertHostMsg', 'cfgAlertHostMin',
    'cfgAlertWelcomeEnabled', 'cfgAlertWelcomeMsg', 'cfgCustomBotName',
    'cfgSongRequestEnabled', 'cfgSongRequestRank', 'cfgSongRequestCost', 'cfgSongRequestMaxDuration'
  ];

  configInputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        // Instant vizuelni feedback za module
        if (el.type === 'checkbox') {
          updateOverviewModulesUI();
          if (id === 'cfgModeration') {
            toggleModerationPanelState();
          }
        }
        triggerAutosaveConfig();
      });
      el.addEventListener('change', triggerAutosaveConfig);
    }
  });

  // 2. Inputs koji okidaju saveModerationSettings
  const modInputIds = [
    'cfgModCapsEnabled', 'cfgModCapsPct', 'cfgModCapsMinLen',
    'cfgModLinksEnabled', 'cfgModLinksWhitelist', 'cfgModLinksPermitEnabled',
    'cfgModEmotesEnabled', 'cfgModEmotesMax',
    'cfgModSymbolsEnabled', 'cfgModSymbolsPct', 'cfgModSymbolsMinLen',
    'cfgModWordsEnabled', 'cfgModWordsList',
    'cfgModSpamEnabled', 'cfgModSpamMaxDuplicates',
    'cfgModMaxLenEnabled', 'cfgModMaxLenLimit',
    'cfgModMentionsEnabled', 'cfgModMentionsLimit',
    'cfgModActionType', 'cfgModTimeoutDuration',
    'cfgModExemptVip', 'cfgModExemptSub'
  ];

  modInputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        triggerAutosaveMod();
      });
      el.addEventListener('change', triggerAutosaveMod);
    }
  });
}

// ── Notification Center ────────────────────────────────────────────────────
let readNotifs = JSON.parse(localStorage.getItem('read_notif_ids') || '[]');
let notifications = [
  { id: 1, title: 'Bot uspešno pokrenut', desc: 'KickotBot je uspešno povezan na Vaš kanal i spreman je za rad.', time: 'Pre 5 minuta', type: 'info', read: false },
  { id: 2, title: 'Moderator status proveren', desc: 'Uspešno verifikovan moderator status na kanalu. Svi moduli su aktivni.', time: 'Pre 10 minuta', type: 'success', read: false },
  { id: 3, title: 'Upozorenje o moderatorskoj ulozi', desc: 'Ukoliko bot izgubi moderatorsku ulogu na kanalu, poruke i moderacija će automatski biti obustavljeni.', time: 'Pre 1 sat', type: 'warning', read: false }
];
notifications.forEach(n => {
  if (readNotifs.includes(n.id)) n.read = true;
});

let changelogs = [
  { version: 'v1.2.0', date: '19. jul 2026', title: 'Individualne kazne & Uređivanje', details: 'Omogućeno zasebno podešavanje kazni za svaki filter moderacije, i dodate olovkice za direktno uređivanje svih ugrađenih mini igara i bračnih komandi.' },
  { version: 'v1.1.5', date: '19. jul 2026', title: 'Centar za obaveštenja', details: 'Kreirano zvonce u zaglavlju sa notifikacijama o radu bota i changelog-om promena.' },
  { version: 'v1.1.0', date: '19. jul 2026', title: 'Pametno skrolovanje logova', details: 'Fiksiran scroll bug u dashboard feed-u. Skrolovanje na dno se vrši samo ukoliko ste već čitali najnovije logove.' }
];

let activeNotifTab = 'obaveštenja';

function toggleNotifCenter() {
  const popover = document.getElementById('notifPopover');
  if (!popover) return;
  const isHidden = popover.style.display === 'none';
  popover.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    renderNotifContent();
  }
}

// Close popover when clicking outside
document.addEventListener('click', (e) => {
  const popover = document.getElementById('notifPopover');
  const btn = document.getElementById('notifBellBtn');
  if (!popover || !btn) return;
  if (btn.contains(e.target)) return;
  if (!document.body.contains(e.target)) return; // Prevents closing when clicked item is detached during re-render
  if (popover.contains(e.target)) return;
  popover.style.display = 'none';
});

function switchNotifTab(tab) {
  activeNotifTab = tab;
  
  const tabOb = document.getElementById('notifTabObaveštenja');
  const tabCh = document.getElementById('notifTabChangelog');
  
  if (!tabOb || !tabCh) return;
  
  if (tab === 'obaveštenja') {
    tabOb.style.color = '#fff';
    tabOb.style.background = 'rgba(255,255,255,0.05)';
    tabCh.style.color = 'var(--text-muted)';
    tabCh.style.background = 'none';
  } else {
    tabCh.style.color = '#fff';
    tabCh.style.background = 'rgba(255,255,255,0.05)';
    tabOb.style.color = 'var(--text-muted)';
    tabOb.style.background = 'none';
  }
  
  renderNotifContent();
}

function renderNotifContent() {
  const list = document.getElementById('notifContentList');
  if (!list) return;
  
  if (activeNotifTab === 'obaveštenja') {
    if (notifications.length === 0) {
      list.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 24px; font-size: 0.82rem; font-style: italic;">Nema novih obaveštenja.</div>';
      return;
    }
    
    list.innerHTML = notifications.map(n => {
      let color = '#3B82F6';
      if (n.type === 'success') color = '#10B981';
      if (n.type === 'warning') color = '#F59E0B';
      
      const opacityStyle = n.read ? 'opacity: 0.6;' : '';
      const borderStyle = n.read ? '1px solid rgba(255,255,255,0.02)' : '1px solid rgba(139, 92, 246, 0.15)';
      const bgStyle = n.read ? 'transparent' : 'rgba(255,255,255,0.02)';
      
      return `
        <div onclick="markNotifAsRead(${n.id})" style="padding: 10px; border-radius: var(--radius-md); background: ${bgStyle}; border: ${borderStyle}; transition: all 0.2s; cursor: pointer; ${opacityStyle}">
          <div style="display: flex; gap: 8px; align-items: flex-start; text-align: left;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${color}; margin-top: 5px; flex-shrink: 0; box-shadow: 0 0 6px ${color};"></span>
            <div style="flex-grow: 1;">
              <div style="font-size: 0.82rem; font-weight: 700; color: #fff; line-height: 1.3;">${escapeHtml(n.title)}</div>
              <div style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 3px; line-height: 1.4;">${escapeHtml(n.desc)}</div>
              <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 5px;">${n.time}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } else {
    // Changelog tab
    list.innerHTML = changelogs.map(c => `
      <div style="padding: 10px; border-radius: var(--radius-md); background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="font-size: 0.72rem; font-weight: 700; color: var(--app-primary); background: var(--app-primary-dim); padding: 2px 6px; border-radius: 4px;">${c.version}</span>
          <span style="font-size: 0.65rem; color: var(--text-muted);">${c.date}</span>
        </div>
        <div style="font-size: 0.8rem; font-weight: 700; color: #fff; margin-bottom: 3px; text-align: left;">${escapeHtml(c.title)}</div>
        <div style="font-size: 0.76rem; color: var(--text-secondary); line-height: 1.4; text-align: left;">${escapeHtml(c.details)}</div>
      </div>
    `).join('');
  }
}

function markAllNotifsAsRead() {
  notifications.forEach(n => n.read = true);
  
  // Persist to localStorage
  const readIds = notifications.map(n => n.id);
  localStorage.setItem('read_notif_ids', JSON.stringify(readIds));

  const badge = document.getElementById('notifBadge');
  if (badge) {
    badge.style.display = 'none';
  }
  renderNotifContent();
  showToast('success', 'Sva obaveštenja označena kao pročitana.', '✔');
}

function markNotifAsRead(id) {
  const notif = notifications.find(n => n.id === id);
  if (notif && !notif.read) {
    notif.read = true;
    
    // Persist to localStorage
    let readIds = JSON.parse(localStorage.getItem('read_notif_ids') || '[]');
    if (!readIds.includes(id)) {
      readIds.push(id);
      localStorage.setItem('read_notif_ids', JSON.stringify(readIds));
    }
    
    // Check if any unread left
    const hasUnread = notifications.some(n => !n.read);
    if (!hasUnread) {
      const badge = document.getElementById('notifBadge');
      if (badge) {
        badge.style.display = 'none';
      }
    }
    
    renderNotifContent();
  }
}

function openFeedbackModal() {
  openModal('feedbackModal');
}

function openDocsModal() {
  openModal('docsModal');
}

function submitFeedback() {
  const type = document.getElementById('feedbackType')?.value;
  const title = document.getElementById('feedbackTitle')?.value.trim();
  const text = document.getElementById('feedbackText')?.value.trim();
  
  if (!title || !text) {
    showToast('error', 'Molimo popunite sva polja pre slanja.', '⚠️');
    return;
  }
  
  showToast('success', 'Hvala na povratnim informacijama! Milan će to pregledati što pre.', '✅');
  
  // Clear fields
  const titleInput = document.getElementById('feedbackTitle');
  const textInput = document.getElementById('feedbackText');
  if (titleInput) titleInput.value = '';
  if (textInput) textInput.value = '';
  
  closeModal('feedbackModal');
}

// ── Song Request & Music Player Logic ──────────────────────────────────────
let localSongQueue = [
  { title: 'Milanče Radosavljević - Dao bih ovo malo života', requester: 'Strimer (Milan_567)', duration: 215 },
  { title: 'Jašar Ahmedovski - Jednoj ženi za sećanje', requester: 'Gledalac (Marko_99)', duration: 250 },
  { title: 'Šaban Šaulić - Žal', requester: 'Moderator (Zoki)', duration: 310 }
];
let currentSongIndex = 0;
let isPlaying = false;
let playbackInterval = null;
let currentTimeSeconds = 0;
let playerVolume = 80;

function formatDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function renderSongQueue() {
  const queueList = document.getElementById('songQueueList');
  const queueCount = document.getElementById('queueCount');
  if (!queueList) return;

  queueCount.textContent = `${localSongQueue.length} pesama`;

  if (localSongQueue.length === 0) {
    queueList.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px; font-size: 0.8rem; font-style: italic;">Red za puštanje je prazan.</div>';
    return;
  }

  queueList.innerHTML = localSongQueue.map((song, index) => {
    const isActive = index === currentSongIndex;
    const activeBg = isActive ? 'rgba(139, 92, 246, 0.08)' : 'rgba(255,255,255,0.01)';
    const activeBorder = isActive ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid var(--border-subtle)';
    const activeText = isActive ? 'var(--app-primary)' : '#fff';
    
    return `
      <div style="background: ${activeBg}; border: ${activeBorder}; padding: 10px 14px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: space-between; gap: 10px;">
        <div style="flex-grow: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <div style="font-size: 0.82rem; font-weight: 700; color: ${activeText}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(song.title)}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">Zatražio: ${escapeHtml(song.requester)} • ${formatDuration(song.duration)}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${isActive && isPlaying ? '<span style="font-size: 0.75rem; color: var(--kick-green); font-weight: 600; display: flex; align-items: center; gap: 4px;"><span class="status-dot" style="background: var(--kick-green); width:6px; height:6px; box-shadow:0 0 6px var(--kick-green);"></span> Svira</span>' : ''}
          <button class="btn btn-sm btn-text" onclick="removeSong(${index})" style="color: var(--text-muted); cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center;" title="Ukloni pesmu">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function updatePlayerUI() {
  const playerTitle = document.getElementById('playerTitle');
  const playerRequester = document.getElementById('playerRequester');
  const playerProgress = document.getElementById('playerProgress');
  const playerCurrentTime = document.getElementById('playerCurrentTime');
  const playerTotalTime = document.getElementById('playerTotalTime');
  const playerDisk = document.getElementById('playerDisk');
  const playIcon = document.getElementById('playIcon');

  if (!playerTitle) return;

  const currentSong = localSongQueue[currentSongIndex];
  if (!currentSong) {
    playerTitle.textContent = 'Nema pesama u redu';
    playerRequester.textContent = 'Zatražite pesmu ispod';
    if (playerProgress) playerProgress.style.width = '0%';
    if (playerCurrentTime) playerCurrentTime.textContent = '0:00';
    if (playerTotalTime) playerTotalTime.textContent = '0:00';
    if (playerDisk) playerDisk.style.animationPlayState = 'paused';
    if (playIcon) {
      playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3" />';
    }
    return;
  }

  playerTitle.textContent = currentSong.title;
  playerRequester.textContent = `Zatražio: ${currentSong.requester}`;
  if (playerTotalTime) playerTotalTime.textContent = formatDuration(currentSong.duration);
  if (playerCurrentTime) playerCurrentTime.textContent = formatDuration(currentTimeSeconds);
  if (playerProgress) {
    const pct = (currentTimeSeconds / currentSong.duration) * 100;
    playerProgress.style.width = `${pct}%`;
  }

  if (playerDisk) {
    playerDisk.style.animationPlayState = isPlaying ? 'running' : 'paused';
  }

  if (playIcon) {
    if (isPlaying) {
      playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />';
    } else {
      playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3" />';
    }
  }
}

function togglePlayback() {
  if (localSongQueue.length === 0) {
    showToast('info', 'Dodajte najpre neku pesmu u red.', 'ℹ️');
    return;
  }

  isPlaying = !isPlaying;
  
  if (isPlaying) {
    playbackInterval = setInterval(() => {
      const currentSong = localSongQueue[currentSongIndex];
      if (!currentSong) {
        clearInterval(playbackInterval);
        isPlaying = false;
        updatePlayerUI();
        return;
      }

      currentTimeSeconds++;
      if (currentTimeSeconds >= currentSong.duration) {
        skipSong();
      } else {
        updatePlayerUI();
      }
    }, 1000);
  } else {
    if (playbackInterval) {
      clearInterval(playbackInterval);
    }
  }
  
  updatePlayerUI();
  renderSongQueue();
}

function skipSong() {
  if (playbackInterval) {
    clearInterval(playbackInterval);
  }

  currentTimeSeconds = 0;
  
  if (localSongQueue.length > 0) {
    // Remove current song from queue (played)
    localSongQueue.splice(currentSongIndex, 1);
    
    // Wrap around or keep index within bounds
    if (currentSongIndex >= localSongQueue.length) {
      currentSongIndex = 0;
    }
  }

  // Persist queue change
  saveBotConfig(true);

  if (localSongQueue.length === 0) {
    isPlaying = false;
    showToast('info', 'Završeno puštanje svih pesama.', '🎵');
  } else {
    if (isPlaying) {
      // Re-trigger interval for next song
      isPlaying = false;
      togglePlayback();
      return;
    }
  }

  updatePlayerUI();
  renderSongQueue();
}

function requestSong() {
  const input = document.getElementById('songRequestInput');
  if (!input) return;

  const value = input.value.trim();
  if (!value) {
    showToast('error', 'Molimo unesite YouTube link ili naziv pesme.', '⚠️');
    return;
  }

  // Create mock requested song
  let newSongTitle = value;
  if (value.startsWith('http://') || value.startsWith('https://')) {
    newSongTitle = 'YouTube Muzika - ' + value.split('v=')[1]?.substring(0, 8) || 'Pesma iz linka';
  }

  const duration = Math.floor(Math.random() * (300 - 120 + 1)) + 120; // 2 to 5 minutes random
  
  const requester = activeChannel ? `Broadcaster (${activeChannel.username})` : 'Strimer';
  
  localSongQueue.push({
    title: newSongTitle,
    requester: requester,
    duration: duration
  });

  // Save to DB
  saveBotConfig(true);

  input.value = '';
  showToast('success', 'Pesma uspešno dodata u red za puštanje!', '✅');

  renderSongQueue();
  updatePlayerUI();
}

function removeSong(index) {
  const isActive = index === currentSongIndex;
  
  localSongQueue.splice(index, 1);

  if (isActive) {
    if (playbackInterval) {
      clearInterval(playbackInterval);
    }
    currentTimeSeconds = 0;
    isPlaying = false;
  } else if (index < currentSongIndex) {
    currentSongIndex--;
  }

  // Save to DB
  saveBotConfig(true);

  if (localSongQueue.length === 0) {
    isPlaying = false;
  } else if (currentSongIndex >= localSongQueue.length) {
    currentSongIndex = 0;
  }

  showToast('success', 'Pesma je uklonjena iz reda.', '🗑️');
  renderSongQueue();
  updatePlayerUI();
}

function updateVolume(val) {
  playerVolume = val;
  // Simulated volume adjust
}

function seekPlayer(event) {
  const currentSong = localSongQueue[currentSongIndex];
  if (!currentSong) return;

  const progressBar = event.currentTarget;
  const rect = progressBar.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const width = rect.width;
  const pct = clickX / width;
  
  currentTimeSeconds = Math.floor(pct * currentSong.duration);
  updatePlayerUI();
}

// Initial rendering of notification content on page load
window.addEventListener('DOMContentLoaded', () => {
  // Hide notification badge if there are no unread notifications on start
  const hasUnread = notifications.some(n => !n.read);
  const badge = document.getElementById('notifBadge');
  if (badge) {
    badge.style.display = hasUnread ? 'block' : 'none';
  }
  renderNotifContent();
  renderSongQueue();
  updatePlayerUI();
});

initAuth();