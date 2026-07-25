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
    const apiBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'https://kickbot-ihzb.onrender.com'
        : window.location.origin;
    const localRes = await fetch(`${apiBase}/api/avatar?username=${username}`);
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
let currentLang = 'sr';
let translations = {};
try {
  currentLang = localStorage.getItem('kickall-lang') || localStorage.getItem('kickall_lang') || 'sr';
} catch (e) {
  console.warn('LocalStorage not available:', e);
}

// Load translations
async function loadTranslations(lang) {
  try {
    const res = await fetch(`locales/${lang}.json`);
    if (res.ok) {
      translations = await res.json();
    } else {
      console.warn(`Failed to load translations for ${lang}: HTTP ${res.status}`);
    }
  } catch (e) {
    console.error('Error loading translations:', e);
  }
}

// Get translation helper
function t(key) {
  const keys = key.split('.');
  let value = translations;
  for (const k of keys) {
    value = value?.[k];
  }
  return value || key;
}

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
      return 'https://kickall.app/auth/kick/callback/';
    })();
    
    const kickApiBase = (() => {
      const fromGlobal = (window.KICK_API_BASE || '').trim();
      if (fromGlobal) return fromGlobal.replace(/\/+$/, '');
      // Lokalno koristi Render backend direktno, produkcija koristi origin (sa Netlify redirect-ima)
      if (window.location.hostname === 'localhost' || 
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
  
  // Use global auth system if available
  let kickAccessToken = null;
  if (window.KickAuth) {
    kickAccessToken = KickAuth.getAccessToken();
  } else {
    kickAccessToken = localStorage.getItem('kick_access_token');
  }

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
    
    // Set origin site for cross-dashboard navigation (always set when authenticated)
    try {
      sessionStorage.setItem('kick_origin_site', 'kickall');
      localStorage.setItem('kick_origin_site', 'kickall');
      sessionStorage.setItem('from_kickall', 'true');
    } catch (e) {
      console.warn('Failed to set origin flags:', e);
    }
    
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

  // Get referral code from URL if present
  const urlParams = new URLSearchParams(window.location.search);
  const referralCode = urlParams.get('ref') || urlParams.get('referral');

  // Try login
  const { data: signInData, error: signInError } = await sb.auth.signInWithPassword({
    email: kickEmail,
    password: oauthPassword
  });

  if (!signInError && signInData?.user) {
    currentUser = signInData.user;
    await upsertKickProfile(currentUser.id, kickUsername, kickAvatar, kickUserId, accessToken);
    
    // If logging in with referral code, process it
    if (referralCode) {
      await processReferralCode(currentUser.id, referralCode);
    }
    
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
        kick_user_id: kickUserId,
        referral_code: referralCode || null
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

// Process referral code when user registers
async function processReferralCode(userId, referralCode) {
  try {
    // Call the database function to create referral entry
    const { error } = await sb.rpc('create_user_referral', {
      p_user_id: userId,
      p_referral_code: referralCode
    });

    if (error) {
      console.error('Error processing referral code:', error);
    } else {
      console.log('Referral code processed successfully');
      // Show notification to user
      showReferralNotification();
    }
  } catch (err) {
    console.error('Error in processReferralCode:', err);
  }
}

// Ensure user has referral code (for existing users)
async function ensureUserHasReferralCode(userId) {
  try {
    // Check if user already has referral stats
    const { data: existingStats, error: checkError } = await sb
      .from('referral_stats')
      .select('referral_code')
      .eq('user_id', userId)
      .maybeSingle();

    if (checkError && !checkError.message.includes('does not exist')) {
      console.error('Error checking referral stats:', checkError);
      return;
    }

    // If user doesn't have referral stats, create them
    if (!existingStats) {
      console.log('Creating referral stats for existing user:', userId);
      const { error: createError } = await sb.rpc('create_user_referral', {
        p_user_id: userId,
        p_referral_code: null
      });

      if (createError) {
        console.error('Error creating referral stats:', createError);
      } else {
        console.log('Referral stats created successfully for existing user');
      }
    }
  } catch (err) {
    console.error('Error in ensureUserHasReferralCode:', err);
  }
}

// Show referral notification
function showReferralNotification() {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, var(--color-green), #10B981);
    color: #0E0E1D;
    padding: 16px 24px;
    border-radius: 12px;
    font-weight: 600;
    z-index: 10000;
    box-shadow: 0 10px 40px rgba(83, 252, 24, 0.3);
    animation: slideIn 0.5s ease-out;
  `;
  notification.innerHTML = currentLang === 'sr' 
    ? '🎉 Referral kod primljen! Dobijaš bonus na prvu kupovinu!'
    : '🎉 Referral code accepted! You get a bonus on your first purchase!';
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.5s ease-in forwards';
    setTimeout(() => notification.remove(), 500);
  }, 5000);
}

// Get user's referral code and stats
async function getReferralStats(userId) {
  try {
    const { data, error } = await sb
      .from('referral_stats')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (error) {
      // Table might not exist yet, return default stats
      if (error.code === '42P01' || error.message.includes('does not exist')) {
        return {
          total_referrals: 0,
          successful_referrals: 0,
          total_earned: 0,
          total_withdrawn: 0,
          available_balance: 0,
          referral_code: null
        };
      }
      throw error;
    }
    return data;
  } catch (err) {
    console.error('Error fetching referral stats:', err);
    // Return default stats if table doesn't exist
    return {
      total_referrals: 0,
      successful_referrals: 0,
      total_earned: 0,
      total_withdrawn: 0,
      available_balance: 0,
      referral_code: null
    };
  }
}

// Get user's referral rewards
async function getReferralRewards(userId) {
  try {
    const { data, error } = await sb
      .from('referral_rewards')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) {
      // Table might not exist yet, return empty array
      if (error.code === '42P01' || error.message.includes('does not exist')) {
        return [];
      }
      throw error;
    }
    return data || [];
  } catch (err) {
    console.error('Error fetching referral rewards:', err);
    // Return empty array if table doesn't exist
    return [];
  }
}

// Generate referral link
function generateReferralLink(referralCode) {
  const baseUrl = window.location.origin;
  return `${baseUrl}/index.html?ref=${referralCode}`;
}

// Award referral reward when purchase is made
async function awardReferralReward(referralCode, planPrice) {
  try {
    const { error } = await sb.rpc('award_referral_reward', {
      p_referral_code: referralCode,
      p_plan_price: planPrice
    });
    
    if (error) {
      console.error('Error awarding referral reward:', error);
    } else {
      console.log('Referral reward awarded successfully');
    }
  } catch (err) {
    console.error('Error in awardReferralReward:', err);
  }
}

// Function to be called when user makes a purchase
// This should be integrated into your payment processing flow
async function processPurchaseWithReferral(userId, planPrice, planName) {
  try {
    // Get user's referral code from their metadata
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    // Check if user was referred
    const { data: referralData } = await sb
      .from('referrals')
      .select('*')
      .eq('referred_id', userId)
      .single();

    if (referralData && referralData.status === 'registered') {
      // Award referral reward to the referrer
      await awardReferralReward(referralData.referral_code, planPrice);
      
      console.log(`Referral reward awarded for ${planName} purchase`);
    }

    // Update user's plan in user_profiles
    const { error: updateError } = await sb
      .from('user_profiles')
      .update({ 
        plan: planName,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating user plan:', updateError);
    }

  } catch (err) {
    console.error('Error processing purchase with referral:', err);
  }
}

// Get user's referral code from URL or storage
function getUserReferralCode() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('ref') || urlParams.get('referral') || localStorage.getItem('user_referral_code');
}

// Store referral code for later use
function storeReferralCode(code) {
  if (code) {
    localStorage.setItem('user_referral_code', code);
  }
}

// Check if user has referral code in storage and apply it
function checkAndApplyReferralCode() {
  const storedCode = localStorage.getItem('user_referral_code');
  if (storedCode && !getUserReferralCode()) {
    // Apply stored referral code to current URL
    const url = new URL(window.location);
    url.searchParams.set('ref', storedCode);
    window.history.replaceState({}, '', url);
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
    document.body.classList.remove('auth-loading');
    setTimeout(() => gate.remove(), 400);
  }

  playSound(800, 'sine', 0.15, 0.05);
  setTimeout(() => playSound(1000, 'sine', 0.2, 0.05), 80);

  // Ensure user has referral code (for existing users)
  ensureUserHasReferralCode(user.id);

  // Load referral data
  loadReferralData(user.id);
}

// Load referral data and update UI
async function loadReferralData(userId) {
  try {
    // Load referral stats
    const stats = await getReferralStats(userId);
    if (stats) {
      updateReferralStats(stats);
    }

    // Load referral rewards
    const rewards = await getReferralRewards(userId);
    updateRewardsList(rewards);

    // Setup copy button
    setupCopyButton();

    // Setup withdrawal modal
    setupWithdrawalModal();
  } catch (err) {
    console.error('Error loading referral data:', err);
  }
}

// Update referral stats in UI
function updateReferralStats(stats) {
  const totalReferrals = document.getElementById('totalReferrals');
  const successfulReferrals = document.getElementById('successfulReferrals');
  const totalEarned = document.getElementById('totalEarned');
  const availableRewards = document.getElementById('availableRewards');
  const referralCodeInput = document.getElementById('referralCodeInput');
  const referralLinkText = document.getElementById('referralLinkText');
  const withdrawalBtn = document.getElementById('withdrawalBtn');

  if (totalReferrals) totalReferrals.textContent = stats.total_referrals || 0;
  if (successfulReferrals) successfulReferrals.textContent = stats.successful_referrals || 0;
  if (totalEarned) totalEarned.textContent = `€${(stats.total_earned || 0).toFixed(2)}`;
  
  // Use available_balance from stats
  const available = stats.available_balance || 0;
  if (availableRewards) availableRewards.textContent = `€${available.toFixed(2)}`;

  // Disable withdrawal button if balance is less than €5
  if (withdrawalBtn) {
    withdrawalBtn.disabled = available < 5;
  }

  // Set referral code and link
  if (stats.referral_code) {
    if (referralCodeInput) referralCodeInput.value = stats.referral_code;
    
    const referralLink = generateReferralLink(stats.referral_code);
    if (referralLinkText) referralLinkText.textContent = referralLink;
  }

  // Store available balance for withdrawal modal
  window.currentAvailableBalance = available;
}

// Update rewards list in UI
function updateRewardsList(rewards) {
  const rewardsList = document.getElementById('rewardsList');
  if (!rewardsList) return;

  if (!rewards || rewards.length === 0) {
    rewardsList.innerHTML = `
      <div class="no-rewards">
        ${t('dashboard.noRewards')}
      </div>
    `;
    return;
  }

  rewardsList.innerHTML = rewards.map(reward => `
    <div class="reward-item">
      <div class="reward-info">
        <div class="reward-type">${reward.reward_description || getRewardTypeLabel(reward.reward_type)}</div>
        <div class="reward-value">€${reward.reward_value.toFixed(2)}</div>
      </div>
      <div class="reward-status ${reward.status}">${getStatusLabel(reward.status)}</div>
    </div>
  `).join('');
}

function getRewardTypeLabel(type) {
  const labels = {
    credit: currentLang === 'sr' ? 'Kredit' : 'Credit',
    free_month: currentLang === 'sr' ? 'Besplatni mesec' : 'Free Month',
    discount: currentLang === 'sr' ? 'Popust' : 'Discount'
  };
  return labels[type] || type;
}

function getStatusLabel(status) {
  const labels = {
    available: currentLang === 'sr' ? 'Dostupno' : 'Available',
    withdrawn: currentLang === 'sr' ? 'Isplaćeno' : 'Withdrawn',
    expired: currentLang === 'sr' ? 'Isteklo' : 'Expired'
  };
  return labels[status] || status;
}

// Setup copy button functionality
function setupCopyButton() {
  const copyBtn = document.getElementById('copyReferralBtn');
  const referralCodeInput = document.getElementById('referralCodeInput');
  const referralLinkText = document.getElementById('referralLinkText');

  if (!copyBtn || !referralCodeInput) return;

  copyBtn.addEventListener('click', async () => {
    const referralCode = referralCodeInput.value;
    const referralLink = referralLinkText.textContent;

    try {
      // Copy both code and link
      const textToCopy = `${t('dashboard.referralCode')}: ${referralCode}\n${t('dashboard.referralLink')}: ${referralLink}`;

      await navigator.clipboard.writeText(textToCopy);

      // Show success feedback
      const originalText = copyBtn.innerHTML;
      copyBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        ${t('copy.copied')}
      `;
      copyBtn.style.background = '#10B981';

      playSound(600, 'sine', 0.1, 0.05);

      setTimeout(() => {
        copyBtn.innerHTML = originalText;
        copyBtn.style.background = '';
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      // Fallback for older browsers
      referralCodeInput.select();
      document.execCommand('copy');
    }
  });
}

// Setup withdrawal modal functionality
function setupWithdrawalModal() {
  const withdrawalBtn = document.getElementById('withdrawalBtn');
  const withdrawalModal = document.getElementById('withdrawalModal');
  const closeWithdrawalModal = document.getElementById('closeWithdrawalModal');
  const withdrawalForm = document.getElementById('withdrawalForm');
  const paymentMethod = document.getElementById('paymentMethod');
  const amountPresets = document.querySelectorAll('.amount-preset-btn');
  const withdrawalAmount = document.getElementById('withdrawalAmount');

  if (!withdrawalBtn || !withdrawalModal) return;

  // Open modal
  withdrawalBtn.addEventListener('click', () => {
    const modalAvailableBalance = document.getElementById('modalAvailableBalance');
    if (modalAvailableBalance) {
      modalAvailableBalance.textContent = `€${(window.currentAvailableBalance || 0).toFixed(2)}`;
    }
    withdrawalModal.classList.add('open');
  });

  // Close modal
  closeWithdrawalModal.addEventListener('click', () => {
    withdrawalModal.classList.remove('open');
    withdrawalForm.reset();
  });

  // Close on backdrop click
  withdrawalModal.addEventListener('click', (e) => {
    if (e.target === withdrawalModal) {
      withdrawalModal.classList.remove('open');
      withdrawalForm.reset();
    }
  });

  // Amount preset buttons
  amountPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      const amount = parseFloat(btn.dataset.amount);
      if (amount <= window.currentAvailableBalance) {
        withdrawalAmount.value = amount;
        amountPresets.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
    });
  });

  // Payment method change
  paymentMethod.addEventListener('change', (e) => {
    const method = e.target.value;
    const label = document.getElementById('paymentDetailsLabel');
    const hint = document.getElementById('paymentDetailsHint');
    const input = document.getElementById('paymentDetails');

    if (!label || !hint || !input) return;

    switch(method) {
      case 'paypal':
        label.innerHTML = `<span class="lang-sr">PayPal Email</span><span class="lang-en">PayPal Email</span>`;
        input.placeholder = 'your@email.com';
        hint.innerHTML = `<span class="lang-sr">Unesi svoj PayPal email adresu</span><span class="lang-en">Enter your PayPal email address</span>`;
        break;
      case 'bank_transfer':
        label.innerHTML = `<span class="lang-sr">Broj računa (IBAN)</span><span class="lang-en">Account Number (IBAN)</span>`;
        input.placeholder = 'RS00 0000 0000 0000 0000 00';
        hint.innerHTML = `<span class="lang-sr">Unesi svoj IBAN broj računa</span><span class="lang-en">Enter your IBAN account number</span>`;
        break;
      case 'crypto':
        label.innerHTML = `<span class="lang-sr">Crypto Wallet Adresa</span><span class="lang-en">Crypto Wallet Address</span>`;
        input.placeholder = '0x... or bc1...';
        hint.innerHTML = `<span class="lang-sr">Unesi svoju crypto wallet adresu</span><span class="lang-en">Enter your crypto wallet address</span>`;
        break;
      default:
        label.innerHTML = `<span class="lang-sr">PayPal Email</span><span class="lang-en">PayPal Email</span>`;
        input.placeholder = 'your@email.com';
        hint.innerHTML = `<span class="lang-sr">Unesi svoj PayPal email adresu</span><span class="lang-en">Enter your PayPal email address</span>`;
    }
  });

  // Form submission
  withdrawalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const amount = parseFloat(withdrawalAmount.value);
    const method = paymentMethod.value;
    const details = document.getElementById('paymentDetails').value;

    if (!amount || amount < 5) {
      alert(t('dashboard.minWithdrawal'));
      return;
    }

    if (amount > window.currentAvailableBalance) {
      alert(t('dashboard.insufficientFunds'));
      return;
    }

    if (!method || !details) {
      alert(t('dashboard.enterWithdrawalDetails'));
      return;
    }

    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) {
        alert(currentLang === 'sr' ? 'Nisi prijavljen' : 'Not logged in');
        return;
      }

      // Create withdrawal request
      const { data: requestId, error } = await sb.rpc('create_withdrawal_request', {
        p_user_id: user.id,
        p_amount: amount,
        p_payment_method: method,
        p_payment_details: details
      });

      if (error) {
        console.error('Withdrawal request error:', error);
        alert(t('dashboard.withdrawalError'));
        return;
      }

      // Success
      alert(t('dashboard.withdrawalSuccess'));
      withdrawalModal.classList.remove('open');
      withdrawalForm.reset();

      // Reload referral data
      await loadReferralData(user.id);

      playSound(800, 'sine', 0.15, 0.05);

    } catch (err) {
      console.error('Withdrawal error:', err);
      alert(t('dashboard.withdrawalError'));
    }
  });
}

// ── Translation Engine ────────────────────────────────────
function setLang(lang) {
  currentLang = lang;
  try {
    localStorage.setItem('kickall-lang', lang);
    localStorage.setItem('kickall_lang', lang);
  } catch (e) {
    console.warn('LocalStorage not available:', e);
  }
  document.body.className = `lang-${lang}`;

  document.getElementById('btn-sr').classList.toggle('active', lang === 'sr');
  document.getElementById('btn-en').classList.toggle('active', lang === 'en');

  // Reload translations
  loadTranslations(lang);
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
  btnLogout.addEventListener('click', (e) => {
    e.preventDefault();
    handleLogout();
  });
}

async function handleLogout() {
  try {
    let userId = null;
    if (typeof sb !== 'undefined' && sb && sb.auth) {
      const { data } = await sb.auth.getSession();
      userId = data?.session?.user?.id;
    }

    if (userId) {
      notifyGlobalLogout(userId);
    }

    // Use global auth system if available
    if (window.KickAuth) {
      KickAuth.logout();
    } else {
      // Fallback to manual cleanup
      try {
        localStorage.removeItem('kick_access_token');
        localStorage.removeItem('kick_token_type');
        localStorage.removeItem('kick_session_active');
        localStorage.removeItem('kick_oauth_state');
        localStorage.removeItem('kick_code_verifier');
        sessionStorage.clear();

        // Obriši sve Supabase auth tokene iz localStorage
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('sb-') || key.includes('auth-token') || key.startsWith('kick_'))) {
            localStorage.removeItem(key);
          }
        }
      } catch (e) {
        console.warn('LocalStorage/sessionStorage not available during logout:', e);
      }
    }

    if (typeof sb !== 'undefined' && sb && sb.auth) {
      await Promise.race([
        sb.auth.signOut(),
        new Promise(resolve => setTimeout(resolve, 400))
      ]);
    }
  } catch (e) {
    console.error("Logout greška:", e);
  } finally {
    window.location.replace('index.html');
  }
}

function notifyGlobalLogout(userId) {
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

  try {
    localStorage.setItem('kickbot_global_logout', Date.now().toString());
  } catch (e) {
    console.warn('LocalStorage not available during global logout:', e);
  }

  if (userId) {
    const apiBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'https://kickbot-ihzb.onrender.com'
        : window.location.origin;
    fetch(`${apiBase}/api/global-logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userId })
    }).catch(() => {});
  }
}

window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GLOBAL_LOGOUT') {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.warn('LocalStorage/sessionStorage not available during message logout:', e);
    }
    window.location.replace('index.html');
  }
});

window.addEventListener('storage', (event) => {
  if (event.key === 'kickbot_global_logout') {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.warn('LocalStorage/sessionStorage not available during storage logout:', e);
    }
    window.location.replace('index.html');
  }
});

// Set Initial Language
setLang(currentLang);

// Load translations
loadTranslations(currentLang);

// Run Auth Verification
checkAuth();

// ── Modal Helpers ─────────────────────────────────────
function openModal(id) {
  const modalEl = document.getElementById(id);
  if (!modalEl) return;
  modalEl.classList.remove('closing');
  modalEl.classList.add('open');
  document.body.style.overflow = 'hidden';
  const body = modalEl.querySelector('.modal-body');
  if (body) body.scrollTop = 0;
}

function closeModal(id) {
  const modalEl = document.getElementById(id);
  if (!modalEl) return;
  modalEl.style.pointerEvents = 'none';
  modalEl.classList.add('closing');
  setTimeout(() => {
    modalEl.classList.remove('open', 'closing');
    modalEl.style.pointerEvents = '';
    document.body.style.overflow = '';
  }, 220);
}

function handleModalBg(e, id) {
  if (e.target.id === id) closeModal(id);
}

const ALL_MODAL_IDS = ['modalKickaj', 'modalKickov', 'modalKickan', 'referralModal', 'withdrawalModal', 'closeWithdrawalModal'];
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ALL_MODAL_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.classList.contains('open')) closeModal(id);
    });
    document.body.style.overflow = '';
  }
});

// ── Referral Modal Functions ─────────────────────────────
async function openReferralModal() {
  openModal('referralModal');

  if (currentUser && currentUser.id) {
    try {
      await ensureUserHasReferralCode(currentUser.id);
      await loadReferralData(currentUser.id);
    } catch (err) {
      console.error('Referral load error:', err);
    }
  }
}


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
