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
