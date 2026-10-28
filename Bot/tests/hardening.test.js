const test = require('node:test');
const assert = require('node:assert/strict');
const audit = require('../src/moderationAudit');
const { withRetry } = require('../src/retry');
const metrics = require('../src/metrics');
const state = require('../src/state');
const { daLiJeBotSpam } = require('../src/spam');

test('ModerationAudit - beleži akcije i vraća najnovije prvo', () => {
    const room = 'test_audit_room_1';
    audit.obrisi(room);
    audit.zabelezi(room, { action: 'ban', username: 'bot1', reason: 'promo' });
    audit.zabelezi(room, { action: 'delete', username: 'bot2', reason: 'caps' });

    const list = audit.dohvati(room, 10);
    assert.equal(list.length, 2);
    assert.equal(list[0].username, 'bot2');
    assert.equal(list[1].username, 'bot1');
});

test('ModerationAudit - ring buffer ne prelazi maksimum', () => {
    const room = 'test_audit_room_2';
    audit.obrisi(room);
    for (let i = 0; i < audit.MAX_ENTRIES_PER_CHANNEL + 50; i++) {
        audit.zabelezi(room, { action: 'delete', username: `u${i}`, reason: 'x' });
    }
    assert.equal(audit.dohvati(room, 1000).length, audit.MAX_ENTRIES_PER_CHANNEL);
});

test('ModerationAudit - dry-run se čita iz moderation_settings', () => {
    const cs = state.getChannelState('test_audit_room_3');
    cs.moderationSettings = { dry_run: true };
    assert.equal(audit.jeDryRun(cs), true);
    cs.moderationSettings = { dry_run: false };
    assert.equal(audit.jeDryRun(cs), false);
    assert.equal(audit.jeDryRun(null), false);
});

test('withRetry - uspeva nakon privremenih grešaka', async () => {
    let calls = 0;
    const res = await withRetry(async () => {
        calls++;
        if (calls < 3) throw new Error('privremeno');
        return 'ok';
    }, { retries: 3, baseDelayMs: 1, maxDelayMs: 5 });
    assert.equal(res, 'ok');
    assert.equal(calls, 3);
});

test('withRetry - baca grešku kada se iscrpe pokušaji ili shouldRetry vrati false', async () => {
    let calls = 0;
    await assert.rejects(withRetry(async () => { calls++; throw new Error('trajno'); }, { retries: 2, baseDelayMs: 1, maxDelayMs: 2 }));
    assert.equal(calls, 3);

    calls = 0;
    await assert.rejects(withRetry(async () => { calls++; throw new Error('stop'); }, { retries: 5, baseDelayMs: 1, shouldRetry: () => false }));
    assert.equal(calls, 1);
});

test('Metrics - brojači i Prometheus izlaz', () => {
    metrics.reset();
    metrics.inc('chat_messages');
    metrics.inc('chat_messages', 4);
    assert.equal(metrics.get('chat_messages'), 5);
    const prom = metrics.toPrometheus({ channels_active: 3 });
    assert.match(prom, /kickot_chat_messages_total 5/);
    assert.match(prom, /kickot_channels_active 3/);
});

test('Spam - veoma dugačka poruka ne usporava detekciju i ne baca grešku', () => {
    const t0 = Date.now();
    const res = daLiJeBotSpam('a'.repeat(200000));
    assert.equal(res, false);
    assert.ok(Date.now() - t0 < 500);
});
