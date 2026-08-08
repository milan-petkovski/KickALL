const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/state');
const config = require('../src/config');
const { spamFilter } = require('../src/spam');

// Mock fetch to prevent network calls from messenger
global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({ data: { id: 'msg_spam_123' } }),
    headers: new Map()
});

test('Spam - Provera limita identičnih poruka', () => {
    const chatroomId = 'test_spam_room_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.SPAM_THRESHOLD = 3;
    channelState.SPAM_WINDOW_MS = 15000;
    channelState.channelUsername = 'TestStreamer';

    const username = 'SpamUser1';
    const msg = 'Identična poruka za test';

    // Prve 2 poruke su dozvoljene (manje od praga 3)
    assert.equal(spamFilter(chatroomId, username, msg), false);
    assert.equal(spamFilter(chatroomId, username, msg), false);

    // 3. poruka dostiže prag (upozorenje i vraća true)
    assert.equal(spamFilter(chatroomId, username, msg), true);

    // 4. poruka prelazi prag (blokada i vraća true)
    assert.equal(spamFilter(chatroomId, username, msg), true);
});

test('Spam - Provera limita brzog kucanja (rapid messaging)', () => {
    const chatroomId = 'test_spam_room_2';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'TestStreamer';

    const username = 'RapidUser1';

    // Slanje poruka do praga za brzo kucanje
    let hitLimit = false;
    for (let i = 1; i <= config.RAPID_MSG_THRESHOLD + 2; i++) {
        const res = spamFilter(chatroomId, username, `Različita poruka br ${i}`);
        if (i >= config.RAPID_MSG_THRESHOLD) {
            hitLimit = res;
        }
    }

    assert.equal(hitLimit, true);
});

test('Spam - Cooldown sprečava višestruko spuštanje poruka u kratkom vremenu', () => {
    const chatroomId = 'test_spam_room_3';
    const channelState = state.getChannelState(chatroomId);
    channelState.SPAM_THRESHOLD = 2;
    channelState.SPAM_WINDOW_MS = 10000;
    channelState.channelUsername = 'TestStreamer';

    const username = 'CooldownUser';
    const msg = 'Spam poruka';

    // Inicijalizuj leaderboard za korisnika
    channelState.leaderboard['cooldownuser'] = { username: 'CooldownUser', count: 10 };

    // Slanje 2 identične poruke aktivira penal
    spamFilter(chatroomId, username, msg);
    spamFilter(chatroomId, username, msg);

    const countAfterFirstPenalty = channelState.leaderboard['cooldownuser'].count;

    // Ponovno slanje odmah u okviru cooldown-a ne bi trebalo da duplira oduzimanje poena
    spamFilter(chatroomId, username, msg);
    const countAfterSecondPenalty = channelState.leaderboard['cooldownuser'].count;

    assert.equal(countAfterFirstPenalty, countAfterSecondPenalty);
});
