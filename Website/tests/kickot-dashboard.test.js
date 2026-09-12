const test = require('node:test');
const assert = require('node:assert/strict');

// ── 1. PLAN LIMITS & FEATURE GATING ─────────────────────────────────────────
const PLAN_LIMITS = {
  free: {
    name: 'FREE',
    badgeClass: 'badge-free',
    maxCustomCommands: 10,
    maxAutoAnnounces: 2,
    maxManagers: 0,
    minCooldownMs: 3000,
    allowGambling: false,
    allowLove: true,
    allowLeaderboard: true,
    allowWatchtime: true,
    allowAdvancedModeration: false,
    allowSongRequest: false
  },
  pro: {
    name: 'PRO',
    badgeClass: 'badge-pro',
    maxCustomCommands: 100,
    maxAutoAnnounces: 20,
    maxManagers: 3,
    minCooldownMs: 1000,
    allowGambling: true,
    allowLove: true,
    allowLeaderboard: true,
    allowWatchtime: true,
    allowAdvancedModeration: true,
    allowSongRequest: true
  },
  elite: {
    name: 'ELITE',
    badgeClass: 'badge-elite',
    maxCustomCommands: Infinity,
    maxAutoAnnounces: Infinity,
    maxManagers: Infinity,
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
  assert.equal(free.maxCustomCommands, 10);
  assert.equal(free.maxAutoAnnounces, 2);
  assert.equal(free.maxManagers, 0);
  assert.equal(free.allowGambling, false);
  assert.equal(free.allowAdvancedModeration, false);
  assert.equal(free.minCooldownMs, 3000);

  const pro = getPlanLimits('pro');
  assert.equal(pro.maxCustomCommands, 100);
  assert.equal(pro.maxAutoAnnounces, 20);
  assert.equal(pro.maxManagers, 3);
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
