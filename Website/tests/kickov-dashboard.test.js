const test = require('node:test');
const assert = require('node:assert/strict');

// ── 1. OBS TOKEN EXTRACTION HELPER ──────────────────────────────────────────
function extractObsToken(searchString) {
  const params = new URLSearchParams(searchString || '');
  const token = params.get('token') || params.get('u') || params.get('key');
  if (!token) return null;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ── 2. AUDIO VOLUME CLAMP HELPER ────────────────────────────────────────────
function clampSoundVolume(volume) {
  if (volume === null || volume === undefined || isNaN(Number(volume))) {
    return 0.8;
  }
  const numeric = Number(volume);
  return Math.min(1, Math.max(0, numeric / 100));
}

// ── 3. ALERT MESSAGE TEMPLATE FORMATTER ──────────────────────────────────────
function formatAlertMessage(rawTemplate, alertData) {
  const template = rawTemplate || '{name} je novi pratilac!';
  const name = alertData?.name || 'Korisnik';
  const count = alertData?.count != null ? String(alertData.count) : '1';
  const viewers = alertData?.viewers != null ? String(alertData.viewers) : '10';
  const amount = alertData?.amount != null ? String(alertData.amount) : '5';

  return template
    .replace(/\{name\}/g, name)
    .replace(/\{count\}/g, count)
    .replace(/\{viewers\}/g, viewers)
    .replace(/\{amount\}/g, amount);
}

// ── 4. HTML / XSS SANITIZER HELPER ─────────────────────────────────────────
function sanitizeAlertContent(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── 5. ALERT DURATION CLAMP HELPER ──────────────────────────────────────────
function validateAlertDuration(duration) {
  const parsed = parseInt(duration, 10);
  if (isNaN(parsed)) return 5;
  return Math.max(2, Math.min(60, parsed));
}

// ── 6. ALERT QUEUE LOGIC SIMULATOR ──────────────────────────────────────────
class MockAlertQueue {
  constructor() {
    this.queue = [];
    this.processed = [];
  }

  enqueue(alertPayload) {
    this.queue.push(alertPayload);
  }

  processAll() {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item.config?.enabled !== false) {
        this.processed.push(item);
      }
    }
  }
}

// ── 7. CLEAN USERNAME HELPER (Identical to Kickaj / Kickan) ─────────────────
function cleanUsername(raw, defaultVal = 'Kanal') {
  if (!raw) return defaultVal;
  let s = String(raw).trim()
    .replace(/^https?:\/\/(www\.)?kick\.com\//i, '')
    .replace(/^kick_user_/, '')
    .replace(/^@/, '');
  if (s.includes('@')) s = s.split('@')[0];
  s = s.split(/[/?#\s]/)[0];
  return s || defaultVal;
}

// ── 8. ESCAPE HTML HELPER (Standardized across KickALL) ─────────────────────
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── 9. MODAL & FOCUS MANAGER SIMULATOR ──────────────────────────────────────
class MockModalManager {
  constructor() {
    this.activeStack = [];
    this.triggers = new Map();
    this.appAriaHidden = null;
    this.modals = new Map();
  }

  registerModal(id) {
    this.modals.set(id, { open: false, ariaHidden: 'true' });
  }

  open(id, triggerElement = null) {
    if (!this.modals.has(id)) return;
    if (triggerElement) {
      this.triggers.set(id, triggerElement);
    }
    const m = this.modals.get(id);
    m.open = true;
    m.ariaHidden = 'false';
    this.appAriaHidden = 'true';
    if (!this.activeStack.includes(id)) {
      this.activeStack.push(id);
    }
  }

  close(id) {
    if (!this.modals.has(id)) return;
    const m = this.modals.get(id);
    m.open = false;
    m.ariaHidden = 'true';
    this.activeStack = this.activeStack.filter(item => item !== id);
    if (this.activeStack.length === 0) {
      this.appAriaHidden = null;
    }
    const trigger = this.triggers.get(id);
    if (trigger) {
      trigger.focused = true;
      this.triggers.delete(id);
    }
  }

  handleEscape() {
    if (this.activeStack.length > 0) {
      const topId = this.activeStack[this.activeStack.length - 1];
      this.close(topId);
      return true;
    }
    return false;
  }
}

// ── 10. NOTIFICATION BADGE HELPER ───────────────────────────────────────────
function calculateNotifBadge(notifications, readIds) {
  const unreadCount = (notifications || []).filter(n => !(readIds || []).includes(String(n.id))).length;
  const isActive = unreadCount > 0;
  const displayText = unreadCount > 99 ? '99+' : String(unreadCount);
  return { unreadCount, isActive, displayText };
}

// ── TEST CASES ──────────────────────────────────────────────────────────────

test('Kickov - extractObsToken pravilno prepoznaje tokene iz URL parametara', () => {
  assert.equal(extractObsToken('?token=kickov_sec_12345'), 'kickov_sec_12345');
  assert.equal(extractObsToken('?u=channel_uuid_abc'), 'channel_uuid_abc');
  assert.equal(extractObsToken('?key=obs_overlay_secret'), 'obs_overlay_secret');
  assert.equal(extractObsToken('?other=123'), null);
  assert.equal(extractObsToken(''), null);
  assert.equal(extractObsToken('?token=   '), null);
});

test('Kickov - clampSoundVolume normalizuje nivo zvuka na raspon od 0.0 do 1.0', () => {
  assert.equal(clampSoundVolume(80), 0.8);
  assert.equal(clampSoundVolume(100), 1.0);
  assert.equal(clampSoundVolume(0), 0.0);
  assert.equal(clampSoundVolume(150), 1.0);
  assert.equal(clampSoundVolume(-25), 0.0);
  assert.equal(clampSoundVolume(undefined), 0.8);
  assert.equal(clampSoundVolume('invalid'), 0.8);
});

test('Kickov - formatAlertMessage ispravno zamenjuje sve dinamičke varijable', () => {
  // Follow alert
  const followMsg = formatAlertMessage('{name} je novi pratilac!', { name: 'StreamerFan' });
  assert.equal(followMsg, 'StreamerFan je novi pratilac!');

  // Subscription alert sa brojem meseci
  const subMsg = formatAlertMessage('{name} se pretplatio na {count} meseci!', { name: 'SuperSub', count: 6 });
  assert.equal(subMsg, 'SuperSub se pretplatio na 6 meseci!');

  // Raid alert sa brojem gledalaca
  const raidMsg = formatAlertMessage('{name} stiže sa raidom od {viewers} gledalaca!', { name: 'RaidLeader', viewers: 142 });
  assert.equal(raidMsg, 'RaidLeader stiže sa raidom od 142 gledalaca!');

  // Kicks donacija
  const tipMsg = formatAlertMessage('{name} je poslao {amount} Kicks!', { name: 'Supporter', amount: 50 });
  assert.equal(tipMsg, 'Supporter je poslao 50 Kicks!');
});

test('Kickov - sanitizeAlertContent štiti od XSS i HTML injekcija u porukama i imenima', () => {
  const maliciousName = '<script>alert("xss")</script>';
  const sanitized = sanitizeAlertContent(maliciousName);
  assert.equal(sanitized, '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  assert.equal(sanitized.includes('<script>'), false);

  const maliciousText = 'Hvala & <img src=x onerror=alert(1)>';
  const sanitizedText = sanitizeAlertContent(maliciousText);
  assert.equal(sanitizedText, 'Hvala &amp; &lt;img src=x onerror=alert(1)&gt;');
});

test('Kickov - validateAlertDuration postavlja minimalno trajanje od najmanje 2 sekunde', () => {
  assert.equal(validateAlertDuration(5), 5);
  assert.equal(validateAlertDuration(0), 2);
  assert.equal(validateAlertDuration(-10), 2);
  assert.equal(validateAlertDuration(1), 2);
  assert.equal(validateAlertDuration(120), 60);
  assert.equal(validateAlertDuration('not_a_number'), 5);
});

test('Kickov - AlertQueue zadržava FIFO redosled i filtrira isključene (disabled) alertove', () => {
  const queue = new MockAlertQueue();
  queue.enqueue({ name: 'User1', config: { enabled: true } });
  queue.enqueue({ name: 'User2_Disabled', config: { enabled: false } });
  queue.enqueue({ name: 'User3', config: { enabled: true } });

  queue.processAll();

  assert.equal(queue.processed.length, 2);
  assert.equal(queue.processed[0].name, 'User1');
  assert.equal(queue.processed[1].name, 'User3');
});

test('Kickov - cleanUsername robusno uklanja URL-ove, query parametre, heševe, @ i prefikse', () => {
  assert.equal(cleanUsername('https://kick.com/milan_567/'), 'milan_567');
  assert.equal(cleanUsername('http://www.kick.com/streamer?ref=banner#bio'), 'streamer');
  assert.equal(cleanUsername('@MilanGamer'), 'MilanGamer');
  assert.equal(cleanUsername('kick_user_pro123'), 'pro123');
  assert.equal(cleanUsername('streamer/about/sub'), 'streamer');
  assert.equal(cleanUsername(''), 'Kanal');
  assert.equal(cleanUsername(null), 'Kanal');
  assert.equal(cleanUsername(undefined), 'Kanal');
  assert.equal(cleanUsername(null, 'Streamer'), 'Streamer');
});

test('Kickov - escapeHtml neutrališe opasne karaktere i ispravno podnosi 0, false, null i undefined', () => {
  assert.equal(escapeHtml('<script>alert("XSS")</script>'), '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml('User & Friend <tag> "quote" \'single\''), 'User &amp; Friend &lt;tag&gt; &quot;quote&quot; &#39;single&#39;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(''), '');
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(false), 'false');
});

test('Kickov - ModalManager upravlja aktivnim modalima, aria-hidden i Escape tasterom', () => {
  const mm = new MockModalManager();
  mm.registerModal('helpModal');
  mm.registerModal('customChannelModal');

  const mockTrigger = { focused: false };
  mm.open('helpModal', mockTrigger);

  assert.equal(mm.modals.get('helpModal').open, true);
  assert.equal(mm.modals.get('helpModal').ariaHidden, 'false');
  assert.equal(mm.appAriaHidden, 'true');
  assert.equal(mm.activeStack.length, 1);

  // Otvori drugi modal preko prvog
  mm.open('customChannelModal');
  assert.equal(mm.activeStack.length, 2);

  // Escape zatvara najnoviji modal (LIFO redosled)
  const escaped = mm.handleEscape();
  assert.equal(escaped, true);
  assert.equal(mm.modals.get('customChannelModal').open, false);
  assert.equal(mm.activeStack.length, 1);
  assert.equal(mm.appAriaHidden, 'true'); // helpModal je i dalje otvoren

  // Escape zatvara i helpModal
  mm.handleEscape();
  assert.equal(mm.modals.get('helpModal').open, false);
  assert.equal(mm.activeStack.length, 0);
  assert.equal(mm.appAriaHidden, null); // vraćen fokus na #app
  assert.equal(mockTrigger.focused, true); // fokus vraćen na okidač
});

test('Kickov - Notification Center kalkuliše nepročitana obaveštenja i 99+ format', () => {
  const notifs = [
    { id: '1', title: 'Test 1' },
    { id: '2', title: 'Test 2' },
    { id: '3', title: 'Test 3' }
  ];

  // Ništa nije pročitano
  let res = calculateNotifBadge(notifs, []);
  assert.equal(res.unreadCount, 3);
  assert.equal(res.isActive, true);
  assert.equal(res.displayText, '3');

  // Jedno pročitano
  res = calculateNotifBadge(notifs, ['1']);
  assert.equal(res.unreadCount, 2);
  assert.equal(res.isActive, true);
  assert.equal(res.displayText, '2');

  // Sva pročitana
  res = calculateNotifBadge(notifs, ['1', '2', '3']);
  assert.equal(res.unreadCount, 0);
  assert.equal(res.isActive, false);
  assert.equal(res.displayText, '0');

  // Preko 99
  const manyNotifs = Array.from({ length: 105 }, (_, i) => ({ id: String(i) }));
  res = calculateNotifBadge(manyNotifs, []);
  assert.equal(res.unreadCount, 105);
  assert.equal(res.displayText, '99+');
});

test('Kickov - Generisanje OBS i Tip URL-ova pravilno enkodira parametre', () => {
  function getObsWidgetUrl(origin, token) {
    return `${origin}/kickov/widget.html?token=${encodeURIComponent(token)}`;
  }
  function getTipPageUrl(origin, channel) {
    return `${origin}/kickov/tip.html?user=${encodeURIComponent(channel)}`;
  }

  const origin = 'https://kickall.app';
  assert.equal(getObsWidgetUrl(origin, 'ov_abc123_xyz'), 'https://kickall.app/kickov/widget.html?token=ov_abc123_xyz');
  assert.equal(getObsWidgetUrl(origin, 'token with spaces&symbols'), 'https://kickall.app/kickov/widget.html?token=token%20with%20spaces%26symbols');
  assert.equal(getTipPageUrl(origin, 'streamer_pro'), 'https://kickall.app/kickov/tip.html?user=streamer_pro');
  assert.equal(getTipPageUrl(origin, 'Gamer & Co'), 'https://kickall.app/kickov/tip.html?user=Gamer%20%26%20Co');
});

// ── 12. ROBOTS META TAG SECURITY TESTS ──────────────────────────────────────
// Ovi testovi čitaju stvarne HTML fajlove i verifikuju da su robots meta tagovi
// ispravno postavljeni. Bezbednosni regresioni test — sprečava da se token
// slučajno počne indeksirati od strane pretražača.
const fs = require('node:fs');
const path = require('node:path');

const kickovRoot = path.resolve(__dirname, '../kickov');

test('Kickov BEZBEDNOST — widget.html mora imati noindex,nofollow (sprečava indeksiranje OBS tokena)', () => {
  const filePath = path.join(kickovRoot, 'widget.html');
  assert.ok(fs.existsSync(filePath), 'widget.html mora postojati');

  const html = fs.readFileSync(filePath, 'utf-8');

  // Mora imati noindex
  const hasNoindex = /meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html)
    || /meta[^>]+content=["'][^"']*noindex[^"']*["'][^>]+name=["']robots["']/i.test(html);
  assert.ok(hasNoindex, 'widget.html mora imati <meta name="robots" content="noindex..."> — bez ovoga OBS token se može indeksirati!');

  // Mora imati nofollow
  const hasNofollow = /meta[^>]+name=["']robots["'][^>]+content=["'][^"']*nofollow/i.test(html)
    || /meta[^>]+content=["'][^"']*nofollow[^"']*["'][^>]+name=["']robots["']/i.test(html);
  assert.ok(hasNofollow, 'widget.html mora imati <meta name="robots" content="...nofollow"> — bez ovoga Google može pratiti linkove sa OBS URL-a!');

  // Mora imati referrer no-referrer (sprečava token leakage ka Google Fonts i sl.)
  const hasNoReferrer = /meta[^>]+name=["']referrer["'][^>]+content=["']no-referrer["']/i.test(html)
    || /meta[^>]+content=["']no-referrer["'][^>]+name=["']referrer["']/i.test(html);
  assert.ok(hasNoReferrer, 'widget.html mora imati <meta name="referrer" content="no-referrer"> — bez ovoga token može procuriti ka Google Fonts!');
});

test('Kickov SEO — tip.html mora imati index,follow i OG meta tagove (javna stranica za donacije)', () => {
  const filePath = path.join(kickovRoot, 'tip.html');
  assert.ok(fs.existsSync(filePath), 'tip.html mora postojati');

  const html = fs.readFileSync(filePath, 'utf-8');

  // tip.html je JAVNA stranica — mora biti indexable
  const hasNoindex = /meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html)
    || /meta[^>]+content=["'][^"']*noindex[^"']*["'][^>]+name=["']robots["']/i.test(html);
  assert.ok(!hasNoindex, 'tip.html NE SME imati noindex — ovo je javna stranica za donacije koju gledaoci trebaju pronaći!');

  // Mora imati referrer zaštitu (sprečava leakage query parametara u Referrer headeru)
  const hasNoReferrer = /meta[^>]+name=["']referrer["'][^>]+content=["']no-referrer["']/i.test(html)
    || /meta[^>]+content=["']no-referrer["'][^>]+name=["']referrer["']/i.test(html);
  assert.ok(hasNoReferrer, 'tip.html mora imati <meta name="referrer" content="no-referrer"> radi zaštite query parametara');

  // Mora imati OG tagove za deljenje na socijalnim mrežama
  const hasOgTitle = /meta[^>]+property=["']og:title["']/i.test(html);
  assert.ok(hasOgTitle, 'tip.html mora imati <meta property="og:title"> za deljenje na socijalnim mrežama');

  const hasOgDescription = /meta[^>]+property=["']og:description["']/i.test(html);
  assert.ok(hasOgDescription, 'tip.html mora imati <meta property="og:description"> za deljenje na socijalnim mrežama');

  // Mora imati description meta tag
  const hasDescription = /meta[^>]+name=["']description["']/i.test(html);
  assert.ok(hasDescription, 'tip.html mora imati <meta name="description">');
});

// ── 13. SERVER-SIDE RATE LIMITER DISPATCH FUNCTION TEST ─────────────────────
test('Kickov — kickov-dispatch.js mora postojati i biti ispravno strukturisan (server-side rate limiting)', () => {
  const dispatchPath = path.resolve(__dirname, '../netlify/functions/kickov-dispatch.js');
  assert.ok(fs.existsSync(dispatchPath), 'kickov-dispatch.js mora postojati u netlify/functions/ — bez njega donacije nemaju server-side rate limiting!');

  const src = fs.readFileSync(dispatchPath, 'utf-8');

  // Mora koristiti rate-limiter
  assert.ok(src.includes('rate-limiter'), 'kickov-dispatch.js mora importovati rate-limiter utility');
  assert.ok(src.includes('isRateLimited'), 'kickov-dispatch.js mora pozivati isRateLimited()');

  // Mora vraćati 429 pri prekoračenju
  assert.ok(src.includes('429'), 'kickov-dispatch.js mora vraćati HTTP 429 pri prekoračenju rate limita');

  // Mora validirati iznos
  assert.ok(src.includes('MIN_AMOUNT') || src.includes('parsedAmount'), 'kickov-dispatch.js mora validirati iznos donacije');

  // Mora sanitizovati input
  assert.ok(src.includes('sanitizeInput') || src.includes('escapeHtml'), 'kickov-dispatch.js mora sanitizovati korisnički unos');

  // Mora imati CORS
  assert.ok(src.includes('Access-Control-Allow-Origin'), 'kickov-dispatch.js mora imati CORS headere');
});
