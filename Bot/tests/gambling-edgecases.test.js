const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/state');
const {
    proveriUlog,
    handleRoulette,
    handleCoinflip,
    handleWheel
} = require('../src/gambling');

test('Gambling Edge Cases - proveriUlog napredna pravila i granice', () => {
    const chatroomId = 'test_room_edge_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.gamble_enabled = true;
    channelState.planLimits = { priority: 2 };
    channelState.max_gamble_amount = 5000;
    channelState.leaderboard['hazarder'] = {
        username: 'Hazarder',
        points: 10000
    };

    // 1. Negativan ulog -> mora pasti
    const resNegativan = proveriUlog(chatroomId, 'Hazarder', '-500');
    assert.equal(resNegativan.valid, false);

    // 2. Ne-numeričan unos -> mora pasti
    const resTekst = proveriUlog(chatroomId, 'Hazarder', 'sto_poena');
    assert.equal(resTekst.valid, false);

    // 3. Prekoračenje max_gamble_amount (5000) -> mora pasti
    const resMax = proveriUlog(chatroomId, 'Hazarder', '6000');
    assert.equal(resMax.valid, false);

    // 4. Ulog jednak max_gamble_amount -> mora proći
    const resExactMax = proveriUlog(chatroomId, 'Hazarder', '5000');
    assert.equal(resExactMax.valid, true);
    assert.equal(resExactMax.iznos, 5000);
});

test('Gambling Edge Cases - handleRoulette izvršava igru i ažurira poene', () => {
    const chatroomId = 'test_room_edge_2';
    const channelState = state.getChannelState(chatroomId);
    channelState.gamble_enabled = true;
    channelState.planLimits = { priority: 2 };
    channelState.leaderboard['ruletar'] = {
        username: 'Ruletar',
        points: 1000
    };

    const origRandom = Math.random;
    Math.random = () => 0.0; // Pogođen broj / gubitak
    try {
        handleRoulette(chatroomId, 'Ruletar', 'crna', '200');
        const noviPoeni = channelState.leaderboard['ruletar'].points;
        assert.ok(typeof noviPoeni === 'number');
        assert.notEqual(noviPoeni, 1000);
    } finally {
        Math.random = origRandom;
    }
});

test('Gambling Edge Cases - handleCoinflip i handleWheel izvršavanje', () => {
    const chatroomId = 'test_room_edge_3';
    const channelState = state.getChannelState(chatroomId);
    channelState.gamble_enabled = true;
    channelState.planLimits = { priority: 2 };
    channelState.leaderboard['kockar2'] = {
        username: 'Kockar2',
        points: 2000
    };

    const origRandom = Math.random;
    Math.random = () => 0.1;
    try {
        handleCoinflip(chatroomId, 'Kockar2', 'glava 500');
        assert.ok(channelState.leaderboard['kockar2'].points >= 1500);

        handleWheel(chatroomId, 'Kockar2', '500');
        assert.ok(typeof channelState.leaderboard['kockar2'].points === 'number');
    } finally {
        Math.random = origRandom;
    }
});
