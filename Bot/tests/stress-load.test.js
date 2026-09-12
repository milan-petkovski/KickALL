const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/state');
const messenger = require('../src/messenger');
const { spamFilter } = require('../src/spam');
const { proveriModeraciju } = require('../src/moderation');
const { handleHttpRequest } = require('../bot');

// Mock fetch za Kick API
global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({ data: { id: 'msg_stress_123' } }),
    headers: new Map()
});

test('Stress Test - Obrada masovnog naleta poruka u kratkom vremenskom roku (1000 poruka)', () => {
    const chatroomId = 'stress_test_room_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'StressStreamer';
    channelState.botActive = true;
    channelState.SPAM_THRESHOLD = 3;
    channelState.SPAM_WINDOW_MS = 15000;
    channelState.feature_moderation = true;
    channelState.moderationSettings = {
        caps_enabled: true,
        caps_min_len: 5,
        caps_pct: 70,
        caps_action_type: 'delete',
        links_enabled: true,
        links_allowed: ['kickall.app'],
        links_action_type: 'delete',
        bad_words_enabled: true,
        bad_words: ['nedozvoljenarec', 'prevara'],
        bad_words_action_type: 'delete'
    };

    channelState.isProcessingQueue = true; // Sprečava odloženo slanje poruka i tajmere tokom stres testa

    const startTime = Date.now();
    let spamBlockedCount = 0;
    let moderationBlockedCount = 0;

    // Simuliramo 1,000 poruka od 50 različitih korisnika
    for (let i = 0; i < 1000; i++) {
        const userId = i % 50;
        const username = `viewer_${userId}`;
        let content = `Pozdrav strimeru broj ${i}`;

        if (i % 5 === 0) {
            content = 'SVEEEEE VELIKIM SLOVIMA CAPSLOCKKK';
        } else if (i % 7 === 0) {
            content = 'Posetite https://malicious-site.com odmah';
        } else if (i % 11 === 0) {
            content = 'Ovo je nedozvoljenarec u tekstu';
        } else if (i % 13 === 0) {
            content = 'Identična spam poruka za testiranje';
        }

        const isSpam = spamFilter(chatroomId, username, content);
        if (isSpam) {
            spamBlockedCount++;
        }

        const modResult = proveriModeraciju(chatroomId, username, content);
        if (modResult) {
            moderationBlockedCount++;
        }
    }

    channelState.messageQueue = [];
    channelState.isProcessingQueue = false;

    const duration = Date.now() - startTime;
    assert.ok(duration < 2500, `Obrada 1000 poruka mora trajati manje od 2.5s (trajala: ${duration}ms)`);
    assert.ok(spamBlockedCount > 0, 'Spam filter mora detektovati i blokirati spam u masovnom naletu');
    assert.ok(moderationBlockedCount > 0, 'Moderacija mora detektovati neprikladne poruke');
});

test('Stress Test - Red poruka poštuje maksimalni kapacitet (MAX_QUEUE_SIZE = 50) i primenjuje backpressure', () => {
    const chatroomId = 'stress_test_room_queue';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'QueueStreamer';
    channelState.isProcessingQueue = true; // Simuliramo zauzet red slanja

    // Pokušavamo da ubacimo 100 uzastopnih poruka u red
    for (let i = 0; i < 100; i++) {
        messenger.posaljiPoruku(chatroomId, `Poruka u redu broj ${i}`);
    }

    // Red ne sme preći 50 poruka
    assert.equal(channelState.messageQueue.length, 50, 'Dužina reda poruka mora biti ograničena na tačno 50 (MAX_QUEUE_SIZE)');
    channelState.isProcessingQueue = false;
    channelState.messageQueue = [];
});

test('Security & Stress Test - HTTP server odbija zahteve koji prelaze 50KB limit (HTTP 413)', async () => {
    const { EventEmitter } = require('events');

    const req = new EventEmitter();
    req.method = 'POST';
    req.url = '/api/kick/test-ping';
    req.headers = {
        'x-internal-token': process.env.INTERNAL_API_SECRET || 'test_secret_for_suite_auth_123',
        'content-type': 'application/x-www-form-urlencoded'
    };
    req.destroy = () => {};

    let statusCode = 0;
    let responseBody = '';

    const res = {
        writeHead: (code) => { statusCode = code; },
        setHeader: () => {},
        end: (data) => { responseBody = data || ''; }
    };

    const handlePromise = handleHttpRequest(req, res);

    // Šaljemo chunk veći od 50KB (npr. 55KB)
    const largeChunk = Buffer.alloc(55000, 'a');
    req.emit('data', largeChunk);

    await handlePromise;

    assert.equal(statusCode, 413, 'Preveliki payload mora biti odbijen sa HTTP statusom 413');
    assert.ok(responseBody.includes('Payload too large'), 'Odgovor mora sadržati obaveštenje o prevelikom payload-u');
});
