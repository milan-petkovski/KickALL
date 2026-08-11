const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/state');
const config = require('../src/config');
const { spamFilter, normalizujZaPoredjenje } = require('../src/spam');

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

test('Spam - Zero-width karakteri se skidaju pre poređenja (raid bypass fix)', () => {
    const chatroomId = 'test_spam_room_4';
    const channelState = state.getChannelState(chatroomId);
    channelState.SPAM_THRESHOLD = 3;
    channelState.SPAM_WINDOW_MS = 15000;
    channelState.channelUsername = 'TestStreamer';

    const username = 'RaidUser1';
    const baseMsg = 'kicks and subs? telegram gokhanusta_bot';

    // Ista poruka, ali svaki put sa drugim nevidljivim (zero-width) karakterom na kraju,
    // tačno kao u zabeleženom raid scenariju. Bez normalizacije bi svaka od ovih bila
    // tretirana kao "drugačija" poruka i nijedna ne bi dostigla prag za identične poruke.
    assert.equal(spamFilter(chatroomId, username, baseMsg + '\u200B'), false);
    assert.equal(spamFilter(chatroomId, username, baseMsg + '\u200C'), false);
    // 3. varijanta (sa word joiner karakterom) dostiže prag i treba da bude uhvaćena
    assert.equal(spamFilter(chatroomId, username, baseMsg + '\u2060'), true);
});

test('normalizujZaPoredjenje uklanja zero-width karaktere i normalizuje case/whitespace', () => {
    const a = normalizujZaPoredjenje('Zdravo Svima\u200B');
    const b = normalizujZaPoredjenje('  zdravo svima');
    assert.equal(a, b);
});
