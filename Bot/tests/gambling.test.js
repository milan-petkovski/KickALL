const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/state');
const {
    proveriUlog,
    handleSlots
} = require('../src/gambling');

test('Gambling - proveriUlog validira opcije uloga', () => {
    const chatroomId = 'test_room_gambling_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.gamble_enabled = true;
    channelState.planLimits = { priority: 2 }; // PRO plan
    channelState.currency_name = 'KickCoins';
    channelState.max_gamble_amount = 5000;
    channelState.economy['kockar'] = {
        username: 'Kockar',
        coins: 1000
    };

    // Nevažeći iznos
    const res1 = proveriUlog(chatroomId, 'Kockar', '0');
    assert.equal(res1.valid, false);

    // Nedovoljno poena
    const res2 = proveriUlog(chatroomId, 'Kockar', '2000');
    assert.equal(res2.valid, false);

    // Ispravan ulog
    const res3 = proveriUlog(chatroomId, 'Kockar', '500');
    assert.equal(res3.valid, true);
    assert.equal(res3.iznos, 500);

    // Ulog "all"
    const res4 = proveriUlog(chatroomId, 'Kockar', 'all');
    assert.equal(res4.valid, true);
    assert.equal(res4.iznos, 1000);
});

test('Gambling - proveriUlog odbija kada je kockanje onemogućeno', () => {
    const chatroomId = 'test_room_gambling_2';
    const channelState = state.getChannelState(chatroomId);
    channelState.gamble_enabled = false;

    const res = proveriUlog(chatroomId, 'Kockar', '100');
    assert.equal(res.valid, false);
});

test('Gambling - handleSlots izvršava igru i ažurira balans', () => {
    const chatroomId = 'test_room_gambling_3';
    const channelState = state.getChannelState(chatroomId);
    channelState.gamble_enabled = true;
    channelState.planLimits = { priority: 2 };
    channelState.economy['igrac'] = {
        username: 'Igrac',
        coins: 500
    };

    const origRandom = Math.random;
    Math.random = () => 0.1; // Fiksirani nasumični broj
    try {
        handleSlots(chatroomId, 'Igrac', '100');
        const noviPoeni = channelState.economy['igrac'].coins;
        assert.ok(typeof noviPoeni === 'number');
        assert.notEqual(noviPoeni, 500);
    } finally {
        Math.random = origRandom;
    }
});
