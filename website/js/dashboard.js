// ── Supabase Configuration ────────────────────────────────
const SUPABASE_URL = 'https://rcukparptzzyssqdmydt.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjdWtwYXJwdHp6eXNzcWRteWR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0Nzc3NzEsImV4cCI6MjA5OTA1Mzc3MX0.5FLpFchORq6h5O0q5HWWYBiRD6qCPZKGjx3Zo4UhlJc';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    storage: window.localStorage,
    storageKey: 'kickbot-supabase-auth'
  }
});

// ── Fetch Kick Channel Data ───────────────────────────────
async function fetchKickChannelData(username) {
  try {
    const localRes = await fetch(`https://kickbot-ihzb.onrender.com/api/avatar?username=${username}`);
    if (localRes.ok) {
      const d = await localRes.json();
      if (d && d.chatroom_id !== undefined) {
        return { chatroom_id: d.chatroom_id || null, slug: d.slug || username, avatar: d.avatar || null };
      }
    }
  } catch (_) { }

  const apiUrl = `https://kick.com/api/v2/channels/${username}`;
  const proxies = [
    {
      url: `https://api.allorigins.win/get?url=${encodeURIComponent(apiUrl)}`,
      parse: async (res) => {
        const json = await res.json();
        const data = json.contents ? JSON.parse(json.contents) : null;
        return data ? {
          chatroom_id: data.chatroom?.id || null,
          slug: data.slug || username,
          avatar: data.user?.profile_pic || null
        } : null;
      }
    },
    {
      url: `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`,
      parse: async (res) => {
        const data = await res.json();
        return data ? {
          chatroom_id: data.chatroom?.id || null,
          slug: data.slug || username,
          avatar: data.user?.profile_pic || null
        } : null;
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
            const result = await proxy.parse(res);
            if (result && !resolved) {
              resolved = true;
              resolve(result);
            }
          }
        })
        .catch(() => { })
        .finally(() => {
          completed++;
          if (completed === proxies.length && !resolved) {
            resolve({ chatroom_id: null, slug: username, avatar: null });
          }
        });
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ chatroom_id: null, slug: username, avatar: null });
      }
    }, 6000);
  });
}

let currentUser = null;
let currentLang = localStorage.getItem('kickall-lang') || localStorage.getItem('kickall_lang') || 'sr';

// Synth Sound Utility
function playSound(freq, type = 'sine', duration = 0.1, gainVal = 0.1) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.frequency.value = freq;
    osc.type = type;
    gainNode.gain.setValueAtTime(gainVal, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (err) {
    console.warn("AudioContext blocked or unsupported", err);
  }
}

// ── Auth Flow & Check ─────────────────────────────────────
async function checkAuth() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');

  if (code) {
    document.getElementById('authGateMsg').textContent = currentLang === 'sr' ? 'Razmenjujemo OAuth kod...' : 'Exchanging OAuth code...';
    
    const codeVerifier = localStorage.getItem('kick_code_verifier') || sessionStorage.getItem('kick_code_verifier') || '';
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
        console.error("Exchange error detail:", err);
        document.getElementById('authGateMsg').textContent = `Greška pri autorizaciji: ${err.detail || err.error || 'nepoznato'}`;
        setTimeout(() => { window.location.href = 'index.html'; }, 5000);
        return;
      }

      const tokenData = await res.json();
      if (tokenData.access_token) {
        localStorage.setItem('kick_access_token', tokenData.access_token);
        sessionStorage.removeItem('kick_oauth_state');
        sessionStorage.removeItem('kick_code_verifier');
        localStorage.removeItem('kick_oauth_state');
        localStorage.removeItem('kick_code_verifier');
        
        // Redirect to itself with kick_oauth=1 to complete login
        window.location.href = window.location.pathname + '?kick_oauth=1';
        return;
      }
    } catch (err) {
      console.error("Code exchange failed:", err);
      document.getElementById('authGateMsg').textContent = 'Greška na serveru...';
      setTimeout(() => { window.location.href = 'index.html'; }, 3000);
      return;
    }
  }

  const isOAuthRedirect = urlParams.get('kick_oauth') === '1';
  const kickAccessToken = localStorage.getItem('kick_access_token');

  if (isOAuthRedirect && kickAccessToken) {
    document.getElementById('authGateMsg').textContent = currentLang === 'sr' ? 'Povezujemo tvoj Kick nalog...' : 'Connecting your Kick account...';
    try {
      await handleKickOAuthSession(kickAccessToken);
      return;
    } catch (err) {
      console.error("Kick OAuth failed:", err);
      document.getElementById('authGateMsg').textContent = `Greška pri prijavi: ${err.message || err}`;
      setTimeout(() => { window.location.href = 'index.html'; }, 5000);
      return;
    }
  }

  // Standard Supabase session check
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
  } else {
    currentUser = session.user;
    initDashboard(currentUser);
  }
}

// Handle Kick OAuth login inside KickAll
async function handleKickOAuthSession(accessToken) {
  const gateMsg = document.getElementById('authGateMsg');
  gateMsg.textContent = currentLang === 'sr' ? 'Preuzimamo profil sa Kick platforme...' : 'Fetching your profile from Kick...';

  let kickUserRes = await fetch('https://api.kick.com/public/v1/users', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  let kickUsername = '';
  let kickUserId = '';
  let kickAvatar = '';

  if (kickUserRes.ok) {
    const kickData = await kickUserRes.json();
    const kickUser = Array.isArray(kickData?.data) ? kickData.data[0] : kickData?.data || kickData;
    kickUsername = kickUser?.username || kickUser?.name || '';
    kickUserId = kickUser?.user_id || kickUser?.id || '';
    kickAvatar = kickUser?.profile_picture || kickUser?.profile_pic || '';
  } else {
    const altRes = await fetch('https://id.kick.com/oauth/userinfo', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (altRes.ok) {
      const altData = await altRes.json();
      kickUsername = altData?.preferred_username || altData?.name || '';
      kickUserId = altData?.sub || '';
      kickAvatar = altData?.picture || '';
    }
  }

  if (!kickUsername) {
    throw new Error('Nije moguće dohvatiti Kick korisničko ime.');
  }

  gateMsg.textContent = `${currentLang === 'sr' ? 'Dobrodošao' : 'Welcome'} @${kickUsername}!`;

  const kickEmail = `kick_user_${kickUsername.toLowerCase()}@kickot.com`;
  const oauthPassword = `kick_oauth_${kickUsername.toLowerCase()}_kickot_2026`;

  // Try login
  const { data: signInData, error: signInError } = await sb.auth.signInWithPassword({
    email: kickEmail,
    password: oauthPassword
  });

  if (!signInError && signInData?.user) {
    currentUser = signInData.user;
    await upsertKickProfile(currentUser.id, kickUsername, kickAvatar, kickUserId, accessToken);
    localStorage.removeItem('kick_access_token');
    cleanQueryParams();
    initDashboard(currentUser);
    return;
  }

  // Create new user if not exists
  gateMsg.textContent = currentLang === 'sr' ? 'Kreiramo nalog...' : 'Creating account...';
  const { data: signUpData, error: signUpError } = await sb.auth.signUp({
    email: kickEmail,
    password: oauthPassword,
    options: {
      data: {
        display_name: kickUsername,
        avatar_url: kickAvatar,
        kick_username: kickUsername,
        kick_user_id: kickUserId
      }
    }
  });

  if (signUpError) {
    throw new Error(signUpError.message);
  }

  currentUser = signUpData.user;

  // Upsert profile in user_profiles
  // Dohvati chatroom_id sa Kick API-ja umesto user_id
  let channelId = kickUserId;
  try {
    const channelData = await fetchKickChannelData(kickUsername);
    if (channelData && channelData.chatroom_id) {
      channelId = String(channelData.chatroom_id);
    }
  } catch (e) {
    channelId = String(kickUserId || `kick_${kickUsername.toLowerCase()}`);
  }
  await sb.from('user_profiles').upsert({
    id: currentUser.id,
    display_name: kickUsername,
    email: kickEmail,
    plan: 'free',
    kick_channels: [{
      id: channelId,
      username: kickUsername,
      avatar: kickAvatar || null,
      is_primary: true,
      kick_access_token: accessToken
    }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  // Login after signup
  await sb.auth.signInWithPassword({
    email: kickEmail,
    password: oauthPassword
  });

  localStorage.removeItem('kick_access_token');
  cleanQueryParams();
  initDashboard(currentUser);
}

async function upsertKickProfile(userId, kickUsername, kickAvatar, kickUserId, accessToken) {
  try {
    const { data: profile } = await sb.from('user_profiles')
      .select('kick_channels')
      .eq('id', userId)
      .maybeSingle();

    const existingChannels = profile?.kick_channels || [];
    
    // Dohvati chatroom_id sa Kick API-ja umesto user_id
    let channelId = kickUserId;
    try {
      const channelData = await fetchKickChannelData(kickUsername);
      if (channelData && channelData.chatroom_id) {
        channelId = String(channelData.chatroom_id);
      }
    } catch (e) {
      channelId = String(kickUserId || `kick_${kickUsername.toLowerCase()}`);
    }

    const alreadyExists = existingChannels.some(c => c.id === channelId);
    if (!alreadyExists) {
      const newChannel = {
        id: channelId,
        username: kickUsername,
        avatar: kickAvatar || null,
        is_primary: existingChannels.length === 0,
        kick_access_token: accessToken
      };
      const updatedChannels = [...existingChannels, newChannel];
      await sb.from('user_profiles')
        .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
        .eq('id', userId);
    }
  } catch (err) {
    console.error("Error upserting channel profile:", err);
  }
}

function cleanQueryParams() {
  const cleanUrl = window.location.pathname;
  window.history.replaceState({}, '', cleanUrl);
}

// ── UI Initialization ─────────────────────────────────────
function initDashboard(user) {
  const name = user.user_metadata?.display_name || user.email?.split('@')[0] || 'User';
  document.getElementById('userName').textContent = name;

  const avatar = document.getElementById('userAvatar');
  const avatarUrl = user.user_metadata?.avatar_url;
  if (avatarUrl && (avatarUrl.startsWith('http') || avatarUrl.startsWith('data:image'))) {
    avatar.style.backgroundImage = `url("${avatarUrl}")`;
    avatar.style.backgroundSize = 'cover';
    avatar.style.backgroundPosition = 'center';
    avatar.textContent = '';
  } else {
    avatar.style.backgroundImage = 'none';
    avatar.textContent = name.charAt(0).toUpperCase();
  }

  // Show profile menu
  const userMenuEl = document.getElementById('userMenu');
  if (userMenuEl) userMenuEl.classList.add('visible');

  // Hide auth gate
  const gate = document.getElementById('authGate');
  if (gate) {
    gate.classList.add('fade-out');
    setTimeout(() => gate.remove(), 400);
  }

  playSound(800, 'sine', 0.15, 0.05);
  setTimeout(() => playSound(1000, 'sine', 0.2, 0.05), 80);
}

// ── Translation Engine ────────────────────────────────────
function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('kickall-lang', lang);
  localStorage.setItem('kickall_lang', lang);
  document.body.className = `lang-${lang}`;
  
  document.getElementById('btn-sr').classList.toggle('active', lang === 'sr');
  document.getElementById('btn-en').classList.toggle('active', lang === 'en');
}

document.getElementById('btn-sr').addEventListener('click', () => setLang('sr'));
document.getElementById('btn-en').addEventListener('click', () => setLang('en'));

// ── User Dropdown Toggle ──────────────────────────────────
const trigger = document.getElementById('userMenuTrigger');
const menu = document.getElementById('userMenu');

if (trigger && menu) {
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    menu.classList.remove('open');
  });
}

// Logout Action
const btnLogout = document.getElementById('btnLogout');
if (btnLogout) {
  btnLogout.addEventListener('click', () => {
    sb.auth.signOut().then(() => {
      notifyGlobalLogout();
      window.location.href = 'index.html';
    });
  });
}

function notifyGlobalLogout() {
  const domains = [
    'https://kickall.netlify.app',
    'https://kickall.milanwebportal.com',
    'http://localhost:5500'
  ];
  
  domains.forEach(domain => {
    try {
      const iframe = document.querySelector(`iframe[src*="${domain}"]`);
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'GLOBAL_LOGOUT' }, domain);
      }
    } catch (e) {
      // Ignore cross-origin errors
    }
  });
  
  localStorage.setItem('kickbot_global_logout', Date.now().toString());
  
  // Notify bot server for global logout
  const { data: { session } } = sb.auth.getSession();
  if (session?.user?.id) {
    fetch('https://kickbot-ihzb.onrender.com/api/global-logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: session.user.id })
    }).catch(() => {});
  }
}

window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GLOBAL_LOGOUT') {
    sb.auth.signOut().then(() => {
      window.location.reload();
    });
  }
});

setInterval(() => {
  const logoutTime = localStorage.getItem('kickbot_global_logout');
  if (logoutTime && Date.now() - parseInt(logoutTime) < 5000) {
    const { data: { session } } = sb.auth.getSession();
    if (session) {
      sb.auth.signOut().then(() => {
        window.location.reload();
      });
    }
    localStorage.removeItem('kickbot_global_logout');
  }
}, 1000);

async function checkServerLogoutStatus() {
  const { data: { session } } = sb.auth.getSession();
  if (session?.user?.id) {
    try {
      const res = await fetch(`https://kickbot-ihzb.onrender.com/api/check-logout?userId=${session.user.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.shouldLogout) {
          await sb.auth.signOut();
          window.location.reload();
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }
}

checkServerLogoutStatus();

// Set Initial Language
setLang(currentLang);

// Run Auth Verification
checkAuth();

// ── Interactive Sneak Peek Previews ─────────────────────
function openSneakPeek(module) {
  playSound(600, 'triangle', 0.1, 0.05);
  const modal = document.getElementById(`modal${module.charAt(0).toUpperCase() + module.slice(1)}`);
  if (modal) modal.classList.add('open');

  if (module === 'kickaj') {
    initWheelCanvas();
  } else if (module === 'kickov') {
    resetOverlayPreview();
  } else if (module === 'kickan') {
    animateAnalyticsBars();
  }
}

function closeSneakPeek(module) {
  playSound(400, 'sine', 0.08, 0.05);
  const modal = document.getElementById(`modal${module.charAt(0).toUpperCase() + module.slice(1)}`);
  if (modal) modal.classList.remove('open');
  
  if (module === 'kickaj') {
    document.getElementById('wheelResult').textContent = '';
    const wheel = document.getElementById('wheelOuter');
    if (wheel) {
      wheel.style.transition = 'none';
      wheel.style.transform = 'rotate(0deg)';
    }
  } else if (module === 'kickan') {
    const viewersEl = document.getElementById('fillViewers');
    const followersEl = document.getElementById('fillFollowers');
    if (viewersEl) viewersEl.style.width = '0%';
    if (followersEl) followersEl.style.width = '0%';
  }
}

// Točak sreće (kickaj demo)
const options = ["VIP status", "Sub gift", "5000 Poena", "1000 Poena", "Moderator", "Timeout 10s"];
const colors = ["#8B5CF6", "#1E1B29", "#53FC18", "#1E1B29", "#EC4899", "#1E1B29"];

function initWheelCanvas() {
  const canvas = document.getElementById('wheelCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const segments = options.length;
  const angle = 2 * Math.PI / segments;

  ctx.clearRect(0,0,240,240);
  
  for(let i=0; i<segments; i++) {
    ctx.beginPath();
    ctx.fillStyle = colors[i];
    ctx.moveTo(120, 120);
    ctx.arc(120, 120, 115, i * angle, (i + 1) * angle);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.translate(120, 120);
    ctx.rotate(i * angle + angle / 2);
    ctx.font = "bold 10px Inter";
    ctx.fillText(options[i], 45, 4);
    ctx.restore();
  }
}

let isSpinning = false;
function spinWheel() {
  if (isSpinning) return;
  isSpinning = true;
  const btnSpin = document.getElementById('btnSpin');
  if (btnSpin) btnSpin.disabled = true;
  document.getElementById('wheelResult').textContent = '';
  
  playSound(300, 'sine', 0.1, 0.08);

  const wheel = document.getElementById('wheelOuter');
  const randomDeg = 1800 + Math.floor(Math.random() * 360);
  if (wheel) {
    wheel.style.transition = 'transform 3.5s cubic-bezier(0.1, 0.8, 0.1, 1)';
    wheel.style.transform = `rotate(${randomDeg}deg)`;
  }

  // Play tick sound effects as it spins
  let ticks = 0;
  const interval = setInterval(() => {
    if(ticks++ < 20) {
      playSound(600 + ticks * 15, 'triangle', 0.05, 0.03);
    } else {
      clearInterval(interval);
    }
  }, 150);

  setTimeout(() => {
    isSpinning = false;
    if (btnSpin) btnSpin.disabled = false;
    
    // Calculate result segment
    const actualDeg = randomDeg % 360;
    const segmentDeg = 360 / options.length;
    // Point is at top (270 degrees)
    const targetIndex = Math.floor(((360 - actualDeg + 270) % 360) / segmentDeg);
    const result = options[targetIndex];

    document.getElementById('wheelResult').textContent = `${currentLang === 'sr' ? 'Dobitak:' : 'Result:'} ${result}`;
    
    playSound(880, 'sine', 0.15, 0.1);
    setTimeout(() => playSound(1100, 'sine', 0.3, 0.1), 100);
  }, 3500);
}

// Stream Overlays Simulator (kickov demo)
function resetOverlayPreview() {
  const alertBox = document.getElementById('mockAlertBox');
  const chatList = document.getElementById('mockChatList');
  if (alertBox) {
    alertBox.style.opacity = '0';
    alertBox.style.transform = 'translate(-50%, -20px)';
  }
  if (chatList) chatList.innerHTML = '';
}

function simulateAlert(type) {
  const alertBox = document.getElementById('mockAlertBox');
  const alertText = document.getElementById('mockAlertText');
  if (!alertBox || !alertText) return;
  
  playSound(900, 'sine', 0.12, 0.08);
  setTimeout(() => playSound(1200, 'sine', 0.15, 0.08), 80);
  
  if (type === 'sub') {
    alertText.innerHTML = currentLang === 'sr' 
      ? '⭐ Novi Pretplatnik!<br><span style="color:#53FC18">milan_fan</span> se pretplatio!' 
      : '⭐ New Subscriber!<br><span style="color:#53FC18">milan_fan</span> subscribed!';
    alertBox.style.borderColor = 'var(--color-green)';
    alertBox.style.boxShadow = '0 0 20px rgba(83, 252, 24, 0.4)';
  } else if (type === 'follow') {
    alertText.innerHTML = currentLang === 'sr' 
      ? '💖 Novi Pratilac!<br><span style="color:#8B5CF6">stefan_bg</span> te prati!' 
      : '💖 New Follower!<br><span style="color:#8B5CF6">stefan_bg</span> followed!';
    alertBox.style.borderColor = 'var(--color-violet)';
    alertBox.style.boxShadow = '0 0 20px rgba(139, 92, 246, 0.4)';
  }
  
  alertBox.style.opacity = '1';
  alertBox.style.transform = 'translate(-50%, 0)';
  
  setTimeout(() => {
    alertBox.style.opacity = '0';
    alertBox.style.transform = 'translate(-50%, -20px)';
  }, 2500);
}

function simulateChatMessage() {
  const chatList = document.getElementById('mockChatList');
  if (!chatList) return;
  const names = ['gamer_99', 'stream_queen', 'kicker', 'lurk_master'];
  const msgs = ['Idemooo!', 'Koji je ovo mod?', 'Bot radi vrhunski.', 'GG WP!'];
  const name = names[Math.floor(Math.random() * names.length)];
  const msg = msgs[Math.floor(Math.random() * msgs.length)];
  
  playSound(600, 'triangle', 0.05, 0.04);
  
  const li = document.createElement('div');
  li.style.fontSize = '0.78rem';
  li.style.marginBottom = '6px';
  li.style.opacity = '0';
  li.style.transform = 'translateY(5px)';
  li.style.transition = 'all 0.2s';
  li.innerHTML = `<strong style="color:var(--color-violet)">${name}:</strong> <span style="color:#fff">${msg}</span>`;
  chatList.appendChild(li);
  
  setTimeout(() => {
    li.style.opacity = '1';
    li.style.transform = 'translateY(0)';
  }, 10);
  
  if (chatList.children.length > 4) {
    chatList.removeChild(chatList.firstChild);
  }
}

// Analytics progress animation (kickan demo)
function animateAnalyticsBars() {
  setTimeout(() => {
    const viewersEl = document.getElementById('fillViewers');
    const followersEl = document.getElementById('fillFollowers');
    if (viewersEl) viewersEl.style.width = '78%';
    if (followersEl) followersEl.style.width = '74%';
    
    playSound(600, 'sine', 0.05, 0.02);
    setTimeout(() => playSound(800, 'sine', 0.05, 0.02), 150);
  }, 100);
}
