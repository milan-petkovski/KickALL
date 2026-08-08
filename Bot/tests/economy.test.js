const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/state');
const {
    izracunajNivo,
    xpZaNivo,
    dobijTitulu,
    dobijNazivValute,
    dodajXP
} = require('../src/economy');

test('Economy - izracunajNivo i xpZaNivo', () => {
    assert.equal(izracunajNivo(0), 0);
    assert.equal(izracunajNivo(100), 1);
    assert.equal(izracunajNivo(400), 2);
    assert.equal(izracunajNivo(900), 3);
    assert.equal(izracunajNivo(-50), 0);

    assert.equal(xpZaNivo(0), 0);
    assert.equal(xpZaNivo(1), 100);
    assert.equal(xpZaNivo(2), 400);
    assert.equal(xpZaNivo(5), 2500);
});

test('Economy - dobijTitulu', () => {
    assert.equal(dobijTitulu(1), 'Pijun 👶');
    assert.equal(dobijTitulu(7), 'Redovan Gledalac 📺');
    assert.equal(dobijTitulu(15), 'Čet Majstor 💬');
    assert.equal(dobijTitulu(25), 'VIP Gledalac ⭐');
    assert.equal(dobijTitulu(40), 'Kralj Četa 👑');
    assert.equal(dobijTitulu(60), 'Legenda 🚀🔥');
});

test('Economy - dobijNazivValute', () => {
    assert.equal(dobijNazivValute(null), 'KickCoins');
    assert.equal(dobijNazivValute({ currency_name: 'Dukati' }), 'Dukati');
});

test('Economy - dodajXP dodeljuje poene i XP novom korisniku', () => {
    const chatroomId = 'test_room_econ_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.first_interaction_bonus = 100;
    channelState.level_up_announce = false;

    dodajXP(chatroomId, 'TestUser', 15, 5, false, 'Dobar strim brate!');

    const user = channelState.economy['testuser'];
    assert.ok(user);
    assert.equal(user.username, 'TestUser');
    assert.equal(user.xp, 15);
    // 5 poena za poruku + 100 bonus za prvu interakciju = 105
    assert.equal(user.coins, 105);
});

test('Economy - smart chat validation odbacuje prekratke poruke i spam', () => {
    const chatroomId = 'test_room_econ_2';
    const channelState = state.getChannelState(chatroomId);
    channelState.first_interaction_bonus = 0;
    channelState.smart_chat_validation = true;

    // Prekratka poruka (manje od 2 karaktera)
    dodajXP(chatroomId, 'Spammer1', 15, 5, false, 'a');
    assert.equal(channelState.leaderboard['spammer1'], undefined);

    // Ponavljanje istog karaktera (aaaaaaaa)
    dodajXP(chatroomId, 'Spammer2', 15, 5, false, 'aaaaaaaa');
    assert.equal(channelState.leaderboard['spammer2'], undefined);
});
