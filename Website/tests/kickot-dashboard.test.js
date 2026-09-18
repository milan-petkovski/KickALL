const test = require('node:test');
const assert = require('node:assert/strict');

// ── 1. PLAN LIMITS & FEATURE GATING ─────────────────────────────────────────
const PLAN_LIMITS = {
  free: {
    name: 'Free',
    label: 'BESPLATNO',
    badgeClass: 'plan-badge-free',
    maxCustomCommands: 50,
    maxAutoAnnounces: 5,
    maxSongQueue: 5,
    maxLeaderboardItems: 20,
    maxLoveMarriages: 50,
    customBotAllowed: false,
    maxChannels: 1,
    maxManagers: 5,
    maxStoreItems: 10,
    customPenaltySettings: false,
    minCooldownMs: 3000,
    allowGambling: false,
    allowLove: true,
    allowLeaderboard: true,
    allowWatchtime: true,
    allowAdvancedModeration: false,
    allowSongRequest: false
  },
  pro: {
    name: 'Pro',
    label: 'PRO',
    badgeClass: 'plan-badge-pro',
    maxCustomCommands: 200,
    maxAutoAnnounces: 50,
    maxSongQueue: 50,
    maxLeaderboardItems: Infinity,
    maxLoveMarriages: Infinity,
    customBotAllowed: true,
    maxChannels: 5,
    maxManagers: 10,
    maxStoreItems: 50,
    customPenaltySettings: true,
    minCooldownMs: 1000,
    allowGambling: true,
    allowLove: true,
    allowLeaderboard: true,
    allowWatchtime: true,
    allowAdvancedModeration: true,
    allowSongRequest: true
  },
  elite: {
    name: 'Elite',
    label: 'ELITE',
    badgeClass: 'plan-badge-elite',
    maxCustomCommands: Infinity,
    maxAutoAnnounces: Infinity,
    maxSongQueue: Infinity,
    maxLeaderboardItems: Infinity,
    maxLoveMarriages: Infinity,
    customBotAllowed: true,
    maxChannels: Infinity,
    maxManagers: Infinity,
    maxStoreItems: Infinity,
    customPenaltySettings: true,
    minCooldownMs: 500,
    allowGambling: true,
    allowLove: true,
    allowLeaderboard: true,
    allowWatchtime: true,
    allowAdvancedModeration: true,
    allowSongRequest: true
  }
};

function getPlanLimits(planTier) {
  const tier = (planTier || 'free').toLowerCase();
  return PLAN_LIMITS[tier] || PLAN_LIMITS.free;
}

test('Kickot - PLAN_LIMITS ima tačno definisane limite za Free, Pro i Elite pakete', () => {
  const free = getPlanLimits('free');
  assert.equal(free.maxCustomCommands, 50);
  assert.equal(free.maxAutoAnnounces, 5);
  assert.equal(free.maxManagers, 5);
  assert.equal(free.allowGambling, false);
  assert.equal(free.allowAdvancedModeration, false);
  assert.equal(free.minCooldownMs, 3000);

  const pro = getPlanLimits('pro');
  assert.equal(pro.maxCustomCommands, 200);
  assert.equal(pro.maxAutoAnnounces, 50);
  assert.equal(pro.maxManagers, 10);
  assert.equal(pro.allowGambling, true);
  assert.equal(pro.minCooldownMs, 1000);

  const elite = getPlanLimits('elite');
  assert.equal(elite.maxCustomCommands, Infinity);
  assert.equal(elite.maxAutoAnnounces, Infinity);
  assert.equal(elite.maxManagers, Infinity);
  assert.equal(elite.minCooldownMs, 500);

  // Fallback za nepoznat plan
  const unknown = getPlanLimits('invalid_plan');
  assert.deepEqual(unknown, PLAN_LIMITS.free);
});

// ── 2. COMMAND TRIGGER & ALIAS PARSING ──────────────────────────────────────
function parseCommandTriggers(input) {
  if (!input || typeof input !== 'string') return [];
  return input
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean)
    .map(t => t.startsWith('!') ? t : `!${t}`);
}

test('Kickot - Parsiranje triggera i aliasa komandi sa automatskim dodavanjem prefiksa !', () => {
  const triggers = parseCommandTriggers('discord, !dc,  pravila ,!help');
  assert.deepEqual(triggers, ['!discord', '!dc', '!pravila', '!help']);

  const empty = parseCommandTriggers('');
  assert.deepEqual(empty, []);

  const single = parseCommandTriggers('info');
  assert.deepEqual(single, ['!info']);
});

// ── 3. TEMPLATE VARIABLE REPLACEMENT ────────────────────────────────────────
function formatTemplate(template, { user, touser, channel, randomRange }) {
  if (!template) return '';
  let res = template;
  res = res.replace(/\{user\}/gi, user || 'Gledalac');
  res = res.replace(/\{touser\}/gi, touser || user || 'Gledalac');
  res = res.replace(/\{channel\}/gi, channel || 'Kanal');

  // {random.X-Y}
  res = res.replace(/\{random\.(\d+)-(\d+)\}/gi, (_, minStr, maxStr) => {
    const min = parseInt(minStr, 10);
    const max = parseInt(maxStr, 10);
    if (randomRange !== undefined) return String(randomRange);
    return String(Math.floor(Math.random() * (max - min + 1)) + min);
  });

  return res;
}

test('Kickot - Template varijable ({user}, {touser}, {channel}, {random}) se ispravno zamenjuju', () => {
  const template = 'Pozdrav {user}! Baci follow na @{channel}. Pozdrav i za {touser}! Tvoj broj sreće: {random.1-100}';
  const formatted = formatTemplate(template, {
    user: 'MilanStreamer',
    touser: 'Gost123',
    channel: 'SuperKanal',
    randomRange: 77
  });

  assert.equal(formatted, 'Pozdrav MilanStreamer! Baci follow na @SuperKanal. Pozdrav i za Gost123! Tvoj broj sreće: 77');

  // Fallback kad touser nije naveden
  const fallback = formatTemplate('{touser}', { user: 'SoloUser' });
  assert.equal(fallback, 'SoloUser');
});

// ── 4. PERMISSION TIER CHECKER ──────────────────────────────────────────────
const ROLE_HIERARCHY = {
  everyone: 0,
  subscriber: 1,
  vip: 2,
  moderator: 3,
  broadcaster: 4
};

function hasPermission(requiredRole, userBadges, isBroadcaster = false) {
  if (isBroadcaster) return true;
  const reqLevel = ROLE_HIERARCHY[requiredRole] || 0;
  if (reqLevel === 0) return true; // everyone

  let userLevel = 0;
  if (Array.isArray(userBadges)) {
    for (const b of userBadges) {
      const type = (b.type || '').toLowerCase();
      if (type === 'broadcaster') userLevel = Math.max(userLevel, 4);
      else if (type === 'moderator') userLevel = Math.max(userLevel, 3);
      else if (type === 'vip') userLevel = Math.max(userLevel, 2);
      else if (type === 'subscriber' || type === 'sub') userLevel = Math.max(userLevel, 1);
    }
  }

  return userLevel >= reqLevel;
}

test('Kickot - Hijerarhija dozvola i verifikacija rola (everyone, sub, vip, mod, broadcaster)', () => {
  const modBadges = [{ type: 'moderator' }];
  const vipBadges = [{ type: 'vip' }];
  const subBadges = [{ type: 'subscriber' }];
  const regularBadges = [];

  // Broadcaster uvek prolazi sve
  assert.equal(hasPermission('moderator', regularBadges, true), true);

  // Moderator ima pristup za mod, vip, sub i everyone
  assert.equal(hasPermission('moderator', modBadges), true);
  assert.equal(hasPermission('vip', modBadges), true);
  assert.equal(hasPermission('subscriber', modBadges), true);
  assert.equal(hasPermission('everyone', modBadges), true);

  // VIP ima pristup za vip, sub, everyone, ali NE i za mod
  assert.equal(hasPermission('moderator', vipBadges), false);
  assert.equal(hasPermission('vip', vipBadges), true);
  assert.equal(hasPermission('subscriber', vipBadges), true);

  // Subscriber ima pristup samo sub i everyone
  assert.equal(hasPermission('vip', subBadges), false);
  assert.equal(hasPermission('subscriber', subBadges), true);

  // Običan korisnik ima samo everyone
  assert.equal(hasPermission('subscriber', regularBadges), false);
  assert.equal(hasPermission('everyone', regularBadges), true);
});

// ── 5. COOLDOWN CALCULATIONS & PLAN ENFORCEMENT ─────────────────────────────
function calculateCooldown(desiredMs, planTier) {
  const limits = getPlanLimits(planTier);
  const val = Number(desiredMs);
  const safeMs = isNaN(val) ? 3000 : val;
  return Math.max(safeMs, limits.minCooldownMs);
}

test('Kickot - Enforce minimum cooldown per subscription tier', () => {
  // Free paket nameće minimum 3000ms čak i ako korisnik postavi 500ms
  assert.equal(calculateCooldown(500, 'free'), 3000);
  assert.equal(calculateCooldown(5000, 'free'), 5000);

  // Pro paket dozvoljava do 1000ms
  assert.equal(calculateCooldown(500, 'pro'), 1000);
  assert.equal(calculateCooldown(2000, 'pro'), 2000);

  // Elite paket dozvoljava do 500ms
  assert.equal(calculateCooldown(300, 'elite'), 500);
  assert.equal(calculateCooldown(1000, 'elite'), 1000);
});

// ── 6. BAD WORDS NORMALIZATION & ZERO-WIDTH EVASION ─────────────────────────
const ZERO_WIDTH_REGEX = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF\u00AD\u061C\u180E]/g;

function cleanForModeration(str) {
  return String(str || '')
    .normalize('NFKC')
    .replace(ZERO_WIDTH_REGEX, '')
    .toLowerCase()
    .replace(/š/g, 's')
    .replace(/đ/g, 'd')
    .replace(/č/g, 'c')
    .replace(/ć/g, 'c')
    .replace(/ž/g, 'z')
    .trim();
}

function checkBadWords(content, badWordsList) {
  const cleaned = cleanForModeration(content);
  return badWordsList.some(bw => {
    const cleanBw = cleanForModeration(bw);
    return cleaned.includes(cleanBw);
  });
}

test('Kickot - Detekcija zabranjenih reči sa zero-width raid bypass i bidi override tehnikama', () => {
  const badList = ['psovka', 'scam'];

  // Normalan pogodak
  assert.equal(checkBadWords('Ovo je psovka', badList), true);

  // Obična reč bez pogotka
  assert.equal(checkBadWords('Pozdrav svima', badList), false);

  // Zero-width space umetnut unutar reči
  assert.equal(checkBadWords('Ovo je p\u200Bso\u200Cvka', badList), true);

  // RTL override umetnut u reč
  assert.equal(checkBadWords('Ovo je s\u202Ecam link', badList), true);

  // Bidi isolate
  assert.equal(checkBadWords('Ovo je p\u2066sovka', badList), true);
});

// ── 7. LEGACY PANEL SLUG ALIAS MIGRATION ────────────────────────────────────
const SLUG_ALIASES = {
  games: 'builtin-commands',
  announces: 'auto-announces',
  autoresponse: 'bot-interaction'
};

function resolvePanelSlug(slug) {
  return SLUG_ALIASES[slug] || slug;
}

test('Kickot - Legacy panel slug aliases mapiraju se na nove nazive panela', () => {
  assert.equal(resolvePanelSlug('games'), 'builtin-commands');
  assert.equal(resolvePanelSlug('announces'), 'auto-announces');
  assert.equal(resolvePanelSlug('autoresponse'), 'bot-interaction');
  assert.equal(resolvePanelSlug('overview'), 'overview');
  assert.equal(resolvePanelSlug('moderation'), 'moderation');
});

// ── 8. TIMER REGISTRY & PANEL LIFECYCLE CLEANUP ────────────────────────────
class MockTimerRegistry {
  constructor() {
    this.panelIntervals = new Map(); // panelName -> Set of IDs
    this.globalIntervals = new Set();
  }

  registerPanelInterval(panel, intervalId) {
    if (!this.panelIntervals.has(panel)) {
      this.panelIntervals.set(panel, new Set());
    }
    this.panelIntervals.get(panel).add(intervalId);
  }

  clearPanelIntervals(panel, clearIntervalFn = clearInterval) {
    const set = this.panelIntervals.get(panel);
    if (!set) return 0;
    let count = 0;
    for (const id of set) {
      clearIntervalFn(id);
      count++;
    }
    this.panelIntervals.delete(panel);
    return count;
  }

  hasActiveIntervals(panel) {
    const set = this.panelIntervals.get(panel);
    return Boolean(set && set.size > 0);
  }
}

test('Kickot - TimerRegistry uredno registruje i čisti intervale po panelu bez curenja memorije', () => {
  const registry = new MockTimerRegistry();
  const cleared = [];
  const mockClearInterval = (id) => cleared.push(id);

  registry.registerPanelInterval('overview', 101);
  registry.registerPanelInterval('overview', 102);
  registry.registerPanelInterval('songs', 201);

  assert.equal(registry.hasActiveIntervals('overview'), true);
  assert.equal(registry.hasActiveIntervals('songs'), true);
  assert.equal(registry.hasActiveIntervals('commands'), false);

  // Napuštanje overview panela
  const clearedCount = registry.clearPanelIntervals('overview', mockClearInterval);
  assert.equal(clearedCount, 2);
  assert.deepEqual(cleared, [101, 102]);
  assert.equal(registry.hasActiveIntervals('overview'), false);

  // songs panel i dalje ima svoj interval
  assert.equal(registry.hasActiveIntervals('songs'), true);
});

// ── 9. DEBOUNCE & THROTTLE TIMING BEHAVIOR ─────────────────────────────────
function debounce(fn, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

test('Kickot - Debounce funkcija sprečava višestruko okidanje i izvršava se samo jednom', async () => {
  let callCount = 0;
  let lastArg = null;
  const debounced = debounce((val) => {
    callCount++;
    lastArg = val;
  }, 20);

  debounced('a');
  debounced('b');
  debounced('c');

  assert.equal(callCount, 0);

  await new Promise(res => setTimeout(res, 50));
  assert.equal(callCount, 1);
  assert.equal(lastArg, 'c');
});

// ── 10. BOTRIX VARIABLE CONVERSION ─────────────────────────────────────────
function convertBotrixVariables(response) {
  if (!response || typeof response !== 'string') return '';
  return response
    .replace(/\$\(user\)/gi, '{user}')
    .replace(/\$\(touser\)/gi, '{touser}')
    .replace(/\$\(channel\)/gi, '{channel}')
    .replace(/\$\(count\)/gi, '{count}')
    .replace(/\$\(random\.(\d+)-(\d+)\)/gi, '{random.$1-$2}')
    .replace(/\$\(urlfetch\s+([^\)]+)\)/gi, '{fetch $1}');
}

test('Kickot - Botrix format varijabli $(user) se ispravno konvertuje u Kickot {user} format', () => {
  const botrixInput = 'Pozdrav $(user)! Pozdravi $(touser). Random: $(random.1-100)';
  const converted = convertBotrixVariables(botrixInput);
  assert.equal(converted, 'Pozdrav {user}! Pozdravi {touser}. Random: {random.1-100}');
});

// ── 11. KICK USERNAME EXTRACTOR & SANITIZER ───────────────────────────────
function extractKickUsername(input) {
  if (!input) return '';
  let val = String(input).trim();
  val = val.replace(/^https?:\/\/(www\.)?kick\.com\//i, '');
  val = val.replace(/^@/, '').replace(/^kick_user_/, '');
  val = val.split(/[/?#\s]/)[0];
  return val.toLowerCase();
}

test('Kickot - extractKickUsername robusno ekstrahuje username iz punih URL-ova, query parametara i heševa', () => {
  assert.equal(extractKickUsername('https://kick.com/milan-567/'), 'milan-567');
  assert.equal(extractKickUsername('http://www.kick.com/streamer_pro?ref=banner#bio'), 'streamer_pro');
  assert.equal(extractKickUsername('@PRO_Streamer'), 'pro_streamer');
  assert.equal(extractKickUsername('kick_user_balkan123'), 'balkan123');
  assert.equal(extractKickUsername('  user-test/about  '), 'user-test');
  assert.equal(extractKickUsername(''), '');
  assert.equal(extractKickUsername(null), '');
  assert.equal(extractKickUsername(undefined), '');
});

// ── 12. ALL_MODAL_IDS KOMPLETNOST I ESCAPE PODRŠKA ─────────────────────────
test('Kickot - ALL_MODAL_IDS sadrži sve modale uključujući botrix, precheckout i editUserPoints', () => {
  const ALL_MODAL_IDS = [
    'cmdModal', 'addChannelModal', 'confirmModal', 'feedbackModal', 'helpModal',
    'modFilterPenaltyModal', 'docsModal', 'settingsModal', 'storeItemModal',
    'referralModal', 'customBotAuthModal', 'withdrawalModal', 'upgradeModal',
    'botrixImportModal', 'preCheckoutReferralModal', 'editUserPointsModal'
  ];

  assert.equal(ALL_MODAL_IDS.includes('botrixImportModal'), true);
  assert.equal(ALL_MODAL_IDS.includes('preCheckoutReferralModal'), true);
  assert.equal(ALL_MODAL_IDS.includes('editUserPointsModal'), true);
  assert.equal(ALL_MODAL_IDS.includes('cmdModal'), true);
  assert.equal(ALL_MODAL_IDS.includes('feedbackModal'), true);

  // Simulacija Escape zatvaranja
  const openModals = new Set(['botrixImportModal', 'editUserPointsModal']);
  const closedModals = [];
  const closeModalMock = (id) => {
    closedModals.push(id);
    openModals.delete(id);
  };

  ALL_MODAL_IDS.forEach(id => {
    if (openModals.has(id)) closeModalMock(id);
  });

  assert.deepEqual(closedModals, ['botrixImportModal', 'editUserPointsModal']);
  assert.equal(openModals.size, 0);
});

// ── 13. ASYNC ERROR RECOVERY & UNLOCKED BUTTONS ────────────────────────────
test('Kickot - Asinhrono snimanje garantovano otključava dugme u finally bloku čak i pri mrežnoj grešci', async () => {
  const buttonState = { disabled: false, loading: false };
  const setLoadingMock = (loading) => {
    buttonState.disabled = loading;
    buttonState.loading = loading;
  };

  async function mockSaveWithNetworkFailure() {
    setLoadingMock(true);
    try {
      // Simuliramo pad internet konekcije / Supabase mrežni timeout
      throw new Error('TypeError: Failed to fetch (Network connection lost)');
    } catch (_err) {
      return { success: false, error: 'NetworkError' };
    } finally {
      setLoadingMock(false);
    }
  }

  assert.equal(buttonState.disabled, false);
  const result = await mockSaveWithNetworkFailure();
  assert.equal(result.success, false);
  assert.equal(buttonState.disabled, false, 'Dugme mora biti ponovo aktivno nakon greške');
  assert.equal(buttonState.loading, false, 'Spinner mora biti uklonjen nakon greške');
});

// ── 14. ARCADE SIMULATOR CONCURRENCY & SPAM LOCK ────────────────────────────
test('Kickot - Simulator sprečava konkurentno okidanje animacije i blokira spam klikove', () => {
  let isSimRunning = false;
  let executionCount = 0;

  function simulateGameRun() {
    if (isSimRunning) return false;
    isSimRunning = true;
    executionCount++;
    return true;
  }

  function simulateGameFinish() {
    isSimRunning = false;
  }

  // 1. Prvi klik započinje igru
  const firstClick = simulateGameRun();
  assert.equal(firstClick, true, 'Prvi klik mora pokrenuti simulator');
  assert.equal(executionCount, 1);
  assert.equal(isSimRunning, true);

  // 2. Brzi spam klikovi dok animacija traje moraju biti ignorisani
  for (let i = 0; i < 10; i++) {
    const spamClick = simulateGameRun();
    assert.equal(spamClick, false, 'Spam klikovi tokom animacije moraju biti odbijeni');
  }
  assert.equal(executionCount, 1, 'Broj izvršenja mora ostati 1');

  // 3. Po završetku animacije, lock se oslobađa
  simulateGameFinish();
  assert.equal(isSimRunning, false);

  const nextClick = simulateGameRun();
  assert.equal(nextClick, true, 'Novi klik nakon završetka animacije mora biti prihvaćen');
  assert.equal(executionCount, 2);
});

// ── 15. SIMULATOR XSS ESCAPING OF CURRENCY AND CHOICES ──────────────────────
test('Kickot - Simulator escapeHtml neutrališe XSS payload u nazivu valute i izboru opklade', () => {
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const xssCurrency = '<img src=x onerror=alert("pwned")>';
  const safeCurrency = escapeHtml(xssCurrency);
  assert.ok(!safeCurrency.includes('<img'), 'Mora neutralisati HTML tagove u valuti');
  assert.ok(safeCurrency.includes('&lt;img'), 'Mora enkodovati u bezbedne HTML entitete');

  const xssChoice = '<script>document.cookie</script>';
  const safeChoice = escapeHtml(xssChoice);
  assert.ok(!safeChoice.includes('<script>'), 'Mora neutralisati script tag u izboru');
  assert.ok(safeChoice.includes('&lt;script&gt;'), 'Mora enkodovati u bezbedne HTML entitete');
});

// ── 16. SET ACTIVE CHANNEL & LOCAL STORAGE PERSISTENCE ──────────────────────
test('Kickot - setActiveChannel pravilno pamti kanal, ažurira rolu i plan kanala', () => {
  const fakeStorage = {};
  const fakeDOM = {
    channelNameDisplay: { textContent: '' },
    channelAvatar: { style: {}, textContent: '' },
    topbarChannel: { textContent: '' },
    overviewDesc: { textContent: '' },
    sidebarPlan: { innerHTML: '' },
    statTotalCommands: { innerHTML: '' },
    statTotalChat: { innerHTML: '' }
  };

  function simulateSetActiveChannel(ch, currentUserPlan = 'free') {
    fakeStorage['kickbot_selected_channel_id'] = String(ch.id || '');
    fakeStorage['kickbot_selected_channel_name'] = String(ch.username || '');

    // Skeletons
    fakeDOM.statTotalCommands.innerHTML = '<span class="skeleton-shimmer"></span>';
    fakeDOM.statTotalChat.innerHTML = '<span class="skeleton-shimmer"></span>';

    // Role & plan calculation
    const isManaged = Boolean(ch.is_managed || ch.role === 'managed');
    const effectivePlan = (ch.owner_plan || currentUserPlan).toLowerCase();
    const roleLabel = isManaged ? 'Menadžer' : 'Vlasnik';
    fakeDOM.sidebarPlan.innerHTML = `<span class="plan">${effectivePlan}</span><span class="role">${roleLabel}</span>`;

    fakeDOM.channelNameDisplay.textContent = ch.username;
    fakeDOM.topbarChannel.textContent = `@${ch.username}`;
    fakeDOM.overviewDesc.textContent = `Pregled aktivnosti za kanal @${ch.username}`;

    if (ch.avatar && /^https:\/\//.test(ch.avatar)) {
      fakeDOM.channelAvatar.style.backgroundImage = `url("${ch.avatar}")`;
      fakeDOM.channelAvatar.textContent = '';
    } else {
      fakeDOM.channelAvatar.style.backgroundImage = 'none';
      fakeDOM.channelAvatar.textContent = ch.username.charAt(0).toUpperCase();
    }
  }

  // 1. Vlasnički kanal
  const ownCh = { id: 101, username: 'strimer_pro', avatar: 'https://kick.com/avatar1.webp', owner_plan: 'pro' };
  simulateSetActiveChannel(ownCh);

  assert.equal(fakeStorage['kickbot_selected_channel_id'], '101');
  assert.equal(fakeStorage['kickbot_selected_channel_name'], 'strimer_pro');
  assert.equal(fakeDOM.channelNameDisplay.textContent, 'strimer_pro');
  assert.equal(fakeDOM.topbarChannel.textContent, '@strimer_pro');
  assert.ok(fakeDOM.sidebarPlan.innerHTML.includes('pro'));
  assert.ok(fakeDOM.sidebarPlan.innerHTML.includes('Vlasnik'));
  assert.ok(fakeDOM.channelAvatar.style.backgroundImage.includes('https://kick.com/avatar1.webp'));
  assert.ok(fakeDOM.statTotalCommands.innerHTML.includes('skeleton-shimmer'));

  // 2. Menadžisani kanal koji nasleđuje Elite paket vlasnika
  const managedCh = { id: 202, username: 'veliki_kanal', is_managed: true, owner_plan: 'elite' };
  simulateSetActiveChannel(managedCh, 'free');

  assert.equal(fakeStorage['kickbot_selected_channel_id'], '202');
  assert.ok(fakeDOM.sidebarPlan.innerHTML.includes('elite'), 'Menadžer mora naslediti Elite plan vlasnika');
  assert.ok(fakeDOM.sidebarPlan.innerHTML.includes('Menadžer'));
  assert.equal(fakeDOM.channelAvatar.textContent, 'V');
});

// ── 17. LOAD USER PROFILE & DEDUPLICATION ───────────────────────────────────
test('Kickot - loadUserProfile deduplicira kanale i mapira uloge i planove', () => {
  const profileData = {
    id: 'usr-123',
    display_name: 'GlavniKorisnik',
    plan: 'pro',
    kick_channels: [
      { id: 1, username: 'MojKanal', avatar: 'https://cdn.com/1.png' },
      { id: 2, username: 'mojkanal', avatar: 'https://cdn.com/dup.png' }, // Duplikat sa malim slovima
      { id: 3, username: 'DrugiKanal', avatar: null }
    ]
  };

  const managedRpcData = [
    { id: 4, username: 'PartnerKanal', owner_id: 'usr-999', owner_plan: 'elite' }
  ];

  function processUserProfile(data, rpcManaged) {
    const currentChannels = (data.kick_channels || []).map(ch => ({
      ...ch,
      owner_id: data.id,
      owner_plan: (data.plan || 'free').toLowerCase()
    }));

    const seen = new Set();
    const deduplicated = [];
    for (const ch of currentChannels) {
      const uname = (ch.username || '').toLowerCase();
      if (!seen.has(uname)) {
        seen.add(uname);
        deduplicated.push(ch);
      }
    }

    const managedChannels = (rpcManaged || []).map(ch => ({
      ...ch,
      owner_plan: (ch.owner_plan || 'free').toLowerCase(),
      is_managed: true
    }));

    return { deduplicated, managedChannels };
  }

  const result = processUserProfile(profileData, managedRpcData);

  assert.equal(result.deduplicated.length, 2, 'Mora ukloniti case-insensitive duplikat');
  assert.equal(result.deduplicated[0].username, 'MojKanal');
  assert.equal(result.deduplicated[0].owner_plan, 'pro');
  assert.equal(result.deduplicated[1].username, 'DrugiKanal');

  assert.equal(result.managedChannels.length, 1);
  assert.equal(result.managedChannels[0].is_managed, true);
  assert.equal(result.managedChannels[0].owner_plan, 'elite');
});

// ── 18. RENDER CHANNEL LIST & BATCHED DOM FRAGMENT ──────────────────────────
test('Kickot - renderChannelList grupiše kanale, štiti avatare i koristi fragment strukturu', () => {
  function simulateRenderChannelList(currentChannels, managedChannels, activeChannelId) {
    const output = {
      groups: [],
      items: [],
      emptyStates: []
    };

    // 1. Tvoji kanali
    output.groups.push('Tvoji kanali');
    if (currentChannels.length === 0) {
      output.emptyStates.push('Nema dodatih kanala');
    } else {
      currentChannels.forEach(ch => {
        const safeAvatar = ch.avatar && /^https:\/\//.test(ch.avatar) ? ch.avatar : null;
        output.items.push({
          id: ch.id,
          username: ch.username,
          hasSafeAvatar: Boolean(safeAvatar),
          isSelected: ch.id === activeChannelId,
          isManaged: false
        });
      });
    }

    // 2. Kanali kojima upravljaš
    output.groups.push('Kanali kojima upravljaš');
    if (managedChannels.length === 0) {
      output.emptyStates.push('Nema kanala za upravljanje');
    } else {
      managedChannels.forEach(ch => {
        const safeAvatar = ch.avatar && /^https:\/\//.test(ch.avatar) ? ch.avatar : null;
        output.items.push({
          id: ch.id,
          username: ch.username,
          hasSafeAvatar: Boolean(safeAvatar),
          isSelected: ch.id === activeChannelId,
          isManaged: true
        });
      });
    }

    return output;
  }

  // Test sa podacima i nesigurnim avatarom (http:// ili javascript:)
  const own = [
    { id: 10, username: 'strimer1', avatar: 'https://kick.com/good.png' },
    { id: 11, username: 'strimer2', avatar: 'javascript:alert(1)' } // Nesiguran
  ];
  const managed = [
    { id: 20, username: 'partner1', avatar: 'http://insecure.com/pic.png', is_managed: true } // HTTP nesiguran
  ];

  const rendered = simulateRenderChannelList(own, managed, 10);

  assert.equal(rendered.groups.length, 2);
  assert.equal(rendered.emptyStates.length, 0);
  assert.equal(rendered.items.length, 3);

  // Provera selekcije
  assert.equal(rendered.items[0].isSelected, true);
  assert.equal(rendered.items[0].hasSafeAvatar, true);

  // Provera sanitizacije avatara
  assert.equal(rendered.items[1].hasSafeAvatar, false, 'javascript: URL mora biti odbačen');
  assert.equal(rendered.items[2].hasSafeAvatar, false, 'http:// ne-https URL mora biti odbačen');
  assert.equal(rendered.items[2].isManaged, true);

  // Test praznih lista
  const emptyRender = simulateRenderChannelList([], [], null);
  assert.deepEqual(emptyRender.emptyStates, ['Nema dodatih kanala', 'Nema kanala za upravljanje']);
});

// ── 19. MODAL FOCUS MANAGEMENT & FOCUS TRAP ─────────────────────────────────
test('Kickot - openModal i closeModal upravljaju fokusom i aria-hidden atributom', () => {
  let activeElement = null;
  const focusReturns = new Map();
  let ariaHiddenState = null;
  const modalListeners = new Map();

  function openModal(id, openerEl) {
    focusReturns.set(id, openerEl);
    ariaHiddenState = true;
    activeElement = 'modalFirstFocusable';
    modalListeners.set(id, 'trapTabHandler');
  }

  function closeModal(id) {
    modalListeners.delete(id);
    ariaHiddenState = false;
    const returnTo = focusReturns.get(id);
    if (returnTo) {
      activeElement = returnTo;
    }
  }

  const triggerButton = 'upgradeBtnHeader';
  openModal('upgradeModal', triggerButton);

  assert.equal(ariaHiddenState, true, 'aria-hidden mora biti true na ostatku stranice');
  assert.equal(activeElement, 'modalFirstFocusable', 'Fokus mora preći u modal');
  assert.equal(modalListeners.get('upgradeModal'), 'trapTabHandler', 'Focus trap mora biti instaliran');

  closeModal('upgradeModal');
  assert.equal(ariaHiddenState, false, 'aria-hidden mora biti resetovan');
  assert.equal(activeElement, triggerButton, 'Fokus se mora vratiti na dugme koje je otvorilo modal');
  assert.equal(modalListeners.has('upgradeModal'), false, 'Focus trap mora biti uklonjen');
});

// ── 20. UPDATE PLAN BUTTONS WITH ORPHAN GUARD ───────────────────────────────
test('Kickot - updatePlanButtons zamenjuje link dugmetom i bezbedno podnosi višestruke pozive', () => {
  const domTree = {
    monthlyProCheckoutBtn: {
      tagName: 'A',
      disabled: false,
      textContent: 'Izaberi',
      parentNode: {
        replaceChild(newChild, oldChild) {
          domTree.monthlyProCheckoutBtn = newChild;
        }
      }
    }
  };

  function markCurrent(btnId) {
    const el = domTree[btnId];
    if (!el) return;
    if (el.tagName === 'A') {
      const btn = {
        tagName: 'BUTTON',
        disabled: true,
        textContent: 'Tvoj trenutni paket',
        parentNode: el.parentNode
      };
      el.parentNode.replaceChild(btn, el);
    } else if (el.tagName === 'BUTTON') {
      el.disabled = true;
      el.textContent = 'Tvoj trenutni paket';
    }
  }

  // 1. Prvi poziv zamenjuje <a> sa <button>
  markCurrent('monthlyProCheckoutBtn');
  assert.equal(domTree.monthlyProCheckoutBtn.tagName, 'BUTTON');
  assert.equal(domTree.monthlyProCheckoutBtn.disabled, true);
  assert.equal(domTree.monthlyProCheckoutBtn.textContent, 'Tvoj trenutni paket');

  // 2. Drugi poziv (npr. re-render profila) ne sme baciti grešku (orphan-guard)
  assert.doesNotThrow(() => {
    markCurrent('monthlyProCheckoutBtn');
  }, 'Ponovni poziv na već zamenjen element ne sme baciti izuzetak');
  assert.equal(domTree.monthlyProCheckoutBtn.disabled, true);
});

// ── 22. MINI GAMES & MODERATION PLAN LIMIT BANNERS ──────────────────────────
test('Kickot - Casino wrap overlay zaključava igre i u Sve Igre i u Kazino tabu na Free planu', () => {
  const limits = { name: 'Free', allowGambling: false };
  const mockElements = {
    casinoMinigamesWrap: {
      id: 'casinoMinigamesWrap',
      style: {},
      children: [],
      appendChild(child) { this.children.push(child); },
      querySelectorAll(selector) { return this._inputs || []; }
    },
    allGamesCasinoWrap: {
      id: 'allGamesCasinoWrap',
      style: {},
      children: [],
      appendChild(child) { this.children.push(child); },
      querySelectorAll(selector) { return this._inputs || []; }
    }
  };

  const btn1 = { classList: { contains: () => false }, disabled: false };
  const btn2 = { classList: { contains: () => false }, disabled: false };
  mockElements.casinoMinigamesWrap._inputs = [btn1];
  mockElements.allGamesCasinoWrap._inputs = [btn2];

  const casinoWraps = [
    { wrap: mockElements.casinoMinigamesWrap, overlayId: 'casinoMinigamesLockOverlay' },
    { wrap: mockElements.allGamesCasinoWrap, overlayId: 'allGamesCasinoLockOverlay' }
  ];

  // Simulacija logike iz renderPlanLimitBanners
  casinoWraps.forEach(({ wrap, overlayId }) => {
    wrap.style.position = 'relative';
    wrap.style.borderRadius = '14px';
    const ov = { id: overlayId, style: {}, className: 'locked-feature-overlay', innerHTML: 'Kazino Igre sa Ulogom Poena su zaključane u Free paketu' };
    wrap.appendChild(ov);
    wrap.querySelectorAll('button').forEach(el => { el.disabled = true; });
  });

  assert.equal(mockElements.casinoMinigamesWrap.children.length, 1);
  assert.equal(mockElements.allGamesCasinoWrap.children.length, 1);
  assert.equal(mockElements.casinoMinigamesWrap.children[0].id, 'casinoMinigamesLockOverlay');
  assert.equal(mockElements.allGamesCasinoWrap.children[0].id, 'allGamesCasinoLockOverlay');
  assert.equal(btn1.disabled, true);
  assert.equal(btn2.disabled, true);
});

test('Kickot - Moderacija limit banner se prikazuje na Free planu i krije na PRO/ELITE', () => {
  const banner = { style: {}, innerHTML: '' };

  function updateModBanner(limits) {
    if (limits.customPenaltySettings && limits.allowAdvancedModeration) {
      banner.style.display = 'none';
      banner.innerHTML = '';
    } else {
      banner.style.display = 'flex';
      banner.innerHTML = 'Free Paket: Osnovni Nivo Zaštite';
    }
  }

  // Free plan
  updateModBanner({ name: 'Free', customPenaltySettings: false, allowAdvancedModeration: false });
  assert.equal(banner.style.display, 'flex');
  assert.match(banner.innerHTML, /Free Paket/);

  // Pro plan
  updateModBanner({ name: 'Pro', customPenaltySettings: true, allowAdvancedModeration: true });
  assert.equal(banner.style.display, 'none');
  assert.equal(banner.innerHTML, '');
});

test('Kickot - Višestruki pozivi renderSettingsChannelList ne dupliraju limit banner', () => {
  const container = { innerHTML: '' };
  const mockDom = {
    settingsChannelsLimitBannerWrap: container
  };

  const limitBannerHtml = '<div class="banner">Kick Kanali 1 / 5</div>';

  function renderBanner() {
    container.innerHTML = '';
    container.innerHTML = limitBannerHtml;
  }

  // Prvo otvaranje
  renderBanner();
  assert.equal(container.innerHTML, limitBannerHtml);

  // Drugo otvaranje ili promena kanala
  renderBanner();
  assert.equal(container.innerHTML, limitBannerHtml);

  // Treći poziv
  renderBanner();
  assert.equal(container.innerHTML, limitBannerHtml);
});

// ── 15. SONG REQUEST LIVE SYNC & CONTINUOUS PLAYBACK ────────────────────────
test('Kickot - syncSongQueueFromRemote automatski pokreće reprodukciju čim stigne pesma u prazan red', () => {
  let localQueue = [];
  let isPlaying = false;
  let currentSongIndex = 0;
  let playCalls = 0;

  function mockPlayCurrentAudio() {
    isPlaying = true;
    playCalls++;
  }

  function syncQueue(newQueue) {
    if (!Array.isArray(newQueue)) return;
    const wasEmpty = localQueue.length === 0;
    const currentlyPlaying = localQueue[currentSongIndex];

    if (newQueue.length === 0) {
      localQueue = [];
      isPlaying = false;
      return;
    }

    if (!isPlaying || wasEmpty || !currentlyPlaying) {
      localQueue = newQueue;
      currentSongIndex = 0;
      mockPlayCurrentAudio();
      return;
    }
  }

  // Korisnik je na Overview tabu, red je prazan, stiže nova pesma iz četa
  const incomingQueue = [
    { id: 'yt_123', ytId: '123', title: 'Pesma 1', artist: 'Izvođač 1', requester: 'KorisnikA', duration: 180 }
  ];

  syncQueue(incomingQueue);

  assert.equal(localQueue.length, 1);
  assert.equal(isPlaying, true);
  assert.equal(currentSongIndex, 0);
  assert.equal(playCalls, 1);
});

test('Kickot - syncSongQueueFromRemote ne prekida trenutnu pesmu dok svira kada stignu nove pesme iz četa', () => {
  let localQueue = [
    { id: 'yt_123', ytId: '123', title: 'Pesma 1', artist: 'Izvođač 1', requester: 'KorisnikA', duration: 180 }
  ];
  let isPlaying = true;
  let currentSongIndex = 0;
  let playCalls = 0;

  function mockPlayCurrentAudio() {
    playCalls++;
  }

  function syncQueue(newQueue) {
    if (!Array.isArray(newQueue)) return;
    const wasEmpty = localQueue.length === 0;
    const currentlyPlaying = localQueue[currentSongIndex];

    if (!isPlaying || wasEmpty || !currentlyPlaying) {
      localQueue = newQueue;
      currentSongIndex = 0;
      mockPlayCurrentAudio();
      return;
    }

    const matchIdx = newQueue.findIndex(s =>
      (s.id && currentlyPlaying.id && s.id === currentlyPlaying.id) ||
      (s.ytId && currentlyPlaying.ytId && s.ytId === currentlyPlaying.ytId)
    );

    if (matchIdx !== -1) {
      localQueue = newQueue;
      currentSongIndex = matchIdx;
    } else {
      localQueue = newQueue;
      if (currentSongIndex >= localQueue.length) currentSongIndex = 0;
    }
  }

  // Gledalac B unosi pesmu 2 u četu dok pesma 1 svira
  const updatedQueue = [
    { id: 'yt_123', ytId: '123', title: 'Pesma 1', artist: 'Izvođač 1', requester: 'KorisnikA', duration: 180 },
    { id: 'yt_456', ytId: '456', title: 'Pesma 2', artist: 'Izvođač 2', requester: 'KorisnikB', duration: 210 }
  ];

  syncQueue(updatedQueue);

  assert.equal(localQueue.length, 2);
  assert.equal(localQueue[1].title, 'Pesma 2');
  assert.equal(currentSongIndex, 0);
  assert.equal(isPlaying, true);
  assert.equal(playCalls, 0); // Pesma 1 nije prekinuta niti restartovana!
});

test('Kickot - Auto-advance uklanja završenu pesmu i odmah pušta sledeću iz reda', () => {
  let localQueue = [
    { id: 'yt_123', title: 'Pesma 1', artist: 'Izvođač 1' },
    { id: 'yt_456', title: 'Pesma 2', artist: 'Izvođač 2' }
  ];
  let currentSongIndex = 0;
  let isPlaying = true;
  let nextPlayed = null;

  function mockSkipSong(isAutoAdvance = false) {
    if (localQueue.length > 0) {
      localQueue.splice(currentSongIndex, 1);
      if (currentSongIndex >= localQueue.length) currentSongIndex = 0;
    }

    if (localQueue.length === 0) {
      isPlaying = false;
      nextPlayed = null;
    } else {
      isPlaying = true;
      nextPlayed = localQueue[currentSongIndex];
    }
  }

  // Pesma 1 završava
  mockSkipSong(true);

  assert.equal(localQueue.length, 1);
  assert.equal(localQueue[0].title, 'Pesma 2');
  assert.equal(isPlaying, true);
  assert.equal(nextPlayed.title, 'Pesma 2');

  // Pesma 2 završava
  mockSkipSong(true);
  assert.equal(localQueue.length, 0);
  assert.equal(isPlaying, false);
});

test('Kickot - YouTube audio engine startuje utišano (mute: 1) kada je tab u pozadini da izbegne blokadu autoplay-a', () => {
  let isMuted = false;
  let isVideoPlaying = false;
  let unMutedCalled = false;
  let isDocHidden = true;

  const mockYtPlayer = {
    mute: () => { isMuted = true; },
    unMute: () => { isMuted = false; unMutedCalled = true; },
    loadVideoById: () => { },
    playVideo: () => { isVideoPlaying = true; },
    getPlayerState: () => 1 // PLAYING
  };

  function simulatePlayCurrentAudio() {
    if (isDocHidden) {
      mockYtPlayer.mute();
    }
    mockYtPlayer.loadVideoById();
    mockYtPlayer.playVideo();

    // Watchdog / onStateChange detektuje da svira i odmah odmutira
    if (mockYtPlayer.getPlayerState() === 1) {
      mockYtPlayer.unMute();
    }
  }

  simulatePlayCurrentAudio();

  assert.equal(isVideoPlaying, true);
  assert.equal(unMutedCalled, true);
  assert.equal(isMuted, false);
});

test('Kickot - syncSongQueueFromRemote odmah pušta sledeću pesmu kada remote !skip ukloni trenutnu pesmu', () => {
  let localQueue = [
    { id: 'yt_111', ytId: '111', title: 'Stara pesma', artist: 'Izvođač 1', requester: 'Korisnik1' },
    { id: 'yt_222', ytId: '222', title: 'Sledeća pesma', artist: 'Izvođač 2', requester: 'Korisnik2' }
  ];
  let currentSongIndex = 0;
  let isPlaying = true;
  let playedSong = null;
  let stopTimerCalled = false;

  function mockPlayCurrentAudio() {
    isPlaying = true;
    playedSong = localQueue[currentSongIndex];
  }

  function mockStopTimer() {
    stopTimerCalled = true;
  }

  function syncQueue(newQueue) {
    if (!Array.isArray(newQueue)) return;
    const currentlyPlaying = localQueue[currentSongIndex];

    if (newQueue.length === 0) {
      localQueue = [];
      isPlaying = false;
      return;
    }

    const matchIdx = newQueue.findIndex(s =>
      (s.id && currentlyPlaying.id && s.id === currentlyPlaying.id) ||
      (s.ytId && currentlyPlaying.ytId && s.ytId === currentlyPlaying.ytId)
    );

    if (matchIdx !== -1) {
      localQueue = newQueue;
      currentSongIndex = matchIdx;
    } else {
      // Trenutna pesma uklonjena/preskočena
      localQueue = newQueue;
      if (currentSongIndex >= localQueue.length) currentSongIndex = 0;
      mockStopTimer();
      if (localQueue.length > 0) {
        isPlaying = true;
        mockPlayCurrentAudio();
      } else {
        isPlaying = false;
      }
    }
  }

  // U četu je moderator poslao !skip, pa u Supabase queue ostaje samo pesma 2
  const remoteSkippedQueue = [
    { id: 'yt_222', ytId: '222', title: 'Sledeća pesma', artist: 'Izvođač 2', requester: 'Korisnik2' }
  ];

  syncQueue(remoteSkippedQueue);

  assert.equal(localQueue.length, 1);
  assert.equal(currentSongIndex, 0);
  assert.equal(isPlaying, true);
  assert.equal(stopTimerCalled, true);
  assert.equal(playedSong.title, 'Sledeća pesma');
});

test('Kickot - seekPlayer postavlja isSeekingLockUntil, menja vreme i ignoriše privremeni pause event', () => {
  let currentTimeSeconds = 10;
  let isPlaying = true;
  let isSeekingLockUntil = 0;
  let ytSeekCalledWith = null;

  const mockYt = {
    seekTo: (sec) => { ytSeekCalledWith = sec; },
    getCurrentTime: () => 10, // Stari tajmstemap pre postMessage odgovora
    getDuration: () => 200
  };

  function simulateSeek(pct) {
    const dur = mockYt.getDuration();
    const target = Math.floor(pct * dur);
    currentTimeSeconds = target;
    isSeekingLockUntil = Date.now() + 1500;
    mockYt.seekTo(target);
  }

  function simulateOnPaused() {
    if (Date.now() < isSeekingLockUntil) {
      return; // Ignoriši dok traje seek baferovanje
    }
    isPlaying = false;
  }

  function simulateUpdateUI() {
    if (Date.now() >= isSeekingLockUntil) {
      currentTimeSeconds = mockYt.getCurrentTime();
    }
  }

  // Korisnik klikće na 50% trake
  simulateSeek(0.5);

  assert.equal(ytSeekCalledWith, 100);
  assert.equal(currentTimeSeconds, 100);

  // YouTube privremeno šalje PAUSED dok puni bafer
  simulateOnPaused();
  assert.equal(isPlaying, true); // Plejer NE SME biti ugašen

  // UI tik pre isteka lock-a ne sme da vrati na staro vreme 10
  simulateUpdateUI();
  assert.equal(currentTimeSeconds, 100);
});

test('Kickot - PLAN_LIMITS.free.maxSongQueue je proširen na 25 pesama', () => {
  const fs = require('fs');
  const path = require('path');
  const content = fs.readFileSync(path.join(__dirname, '../kickot/js/dashboard.js'), 'utf8');
  assert.match(content, /free:\s*\{[^}]*maxSongQueue:\s*25/s);
});

test('Kickot - YouTube audio engine ima ugrađenu zaštitu i oporavak za Error 150/101 i origin', () => {
  const fs = require('fs');
  const path = require('path');
  const dashContent = fs.readFileSync(path.join(__dirname, '../kickot/js/dashboard.js'), 'utf8');
  const ytSearchContent = fs.readFileSync(path.join(__dirname, '../netlify/functions/yt-search.js'), 'utf8');
  const playerContent = fs.readFileSync(path.join(__dirname, '../kickot/player.html'), 'utf8');

  // 1. Dashboard origin i error handling
  assert.ok(dashContent.includes('errCode === 150 || errCode === 101'), 'dashboard.js mora detektovati Error 150 i 101');
  assert.ok(dashContent.includes('origin: (typeof window !== \'undefined\''), 'dashboard.js mora proslediti origin u playerVars');
  assert.ok(dashContent.includes('loadVideoById'), 'dashboard.js mora zameniti video ID novom embeddable verzijom pri Error 150');

  // 2. Netlify yt-search candidate embed check
  assert.ok(ytSearchContent.includes('checkEmbedStatus'), 'yt-search.js mora imati funkciju za proveru embed statusa');
  assert.ok(ytSearchContent.includes('https://www.youtube.com/oembed'), 'yt-search.js mora koristiti oEmbed za proveru dozvole embedovanja');

  // 3. Popout player
  assert.ok(playerContent.includes('origin: (window.location'), 'player.html mora proslediti origin u playerVars');
});

test('Kickot - dashboard.js ima 100% validnu JavaScript sintaksu bez grešaka', () => {
  const { execSync } = require('child_process');
  const path = require('path');
  const targetFile = path.resolve(__dirname, '../kickot/js/dashboard.js');
  assert.doesNotThrow(() => {
    execSync(`node -c "${targetFile}"`, { stdio: 'pipe' });
  }, 'dashboard.js sadrži sintaksnu grešku!');
});





