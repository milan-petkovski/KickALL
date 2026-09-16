const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/state');
const {
    izracunajNivo,
    xpZaNivo,
    dobijTitulu,
    dobijNazivValute,
    dodajXP,
    handleGivePoints
} = require('../src/economy');
const messenger = require('../src/messenger');

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

test('Economy - handleGivePoints podržava oba redosleda i jasna uputstva', () => {
    const chatroomId = 'test_room_econ_give';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'teststreamer';
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];
    channelState.economy = {
        sender1: { username: 'Sender1', xp: 500, level: 2, coins: 1000 },
        receiver1: { username: 'Receiver1', xp: 200, level: 1, coins: 200 }
    };

    // Redosled 1: !give @user 100
    handleGivePoints(chatroomId, 'Sender1', '@Receiver1', '100');
    assert.equal(channelState.economy.sender1.coins, 900);
    assert.equal(channelState.economy.receiver1.coins, 300);
    assert.ok(channelState.messageQueue.pop().includes('uspešno prebacio 100'));

    // Redosled 2: !give 200 @user (obrnut redosled)
    handleGivePoints(chatroomId, 'Sender1', '200', '@Receiver1');
    assert.equal(channelState.economy.sender1.coins, 700);
    assert.equal(channelState.economy.receiver1.coins, 500);
    assert.ok(channelState.messageQueue.pop().includes('uspešno prebacio 200'));

    // Redosled 3: !give 50 Receiver1 (bez @ simbola)
    handleGivePoints(chatroomId, 'Sender1', '50', 'Receiver1');
    assert.equal(channelState.economy.sender1.coins, 650);
    assert.equal(channelState.economy.receiver1.coins, 550);
    assert.ok(channelState.messageQueue.pop().includes('uspešno prebacio 50'));

    // Nedostajući argumenti: samo !give
    handleGivePoints(chatroomId, 'Sender1', '', '');
    assert.ok(channelState.messageQueue.pop().includes('označi korisnika i navedi iznos'));

    // Samo iznos: !give 100
    handleGivePoints(chatroomId, 'Sender1', '100', '');
    assert.ok(channelState.messageQueue.pop().includes('označi korisnika kome šalješ 100'));

    // Samo korisnik: !give @Receiver1
    handleGivePoints(chatroomId, 'Sender1', '@Receiver1', '');
    assert.ok(channelState.messageQueue.pop().includes('želiš da pošalješ korisniku @Receiver1'));
});
