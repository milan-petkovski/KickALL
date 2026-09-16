const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/state');
const {
    proveriUlog,
    handleSlots,
    handleWheel,
    handleRoulette,
    handleLimit,
    izracunajKockarskiRizik
} = require('../src/gambling');

test('Gambling - proveriUlog validira opcije uloga', () => {
    const chatroomId = 'test_room_gambling_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'teststreamer';
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];
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
    channelState.channelUsername = 'teststreamer';
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];
    channelState.gamble_enabled = false;

    const res = proveriUlog(chatroomId, 'Kockar', '100');
    assert.equal(res.valid, false);
});

test('Gambling - handleSlots izvršava igru i ažurira balans', () => {
    const chatroomId = 'test_room_gambling_3';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'teststreamer';
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];
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

test('Gambling - handleLimit šalje tačan maxbet u poruci', () => {
    const chatroomId = 'test_room_gambling_limit';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'teststreamer';
    channelState.currency_name = 'Zlatnici';
    channelState.max_gamble_amount = 7500;
    channelState.planLimits = { priority: 2 };
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];

    handleLimit(chatroomId, 'TestUser');

    assert.equal(channelState.messageQueue.length, 1);
    const msg = channelState.messageQueue[0];
    assert.ok(msg.includes('@TestUser'));
    assert.ok(msg.includes('7.500') || msg.includes('7,500') || msg.includes('7500') || msg.replace(/\s+/g, '').includes('7500'));
    assert.ok(msg.includes('Zlatnici'));
    assert.ok(msg.includes('maksimalni'));
});

test('Gambling - izracunajKockarskiRizik dinamički povećava rizik sa veličinom beta', () => {
    const user = { coins: 10000 };
    const maxGamble = 5000;

    const smallRisk = izracunajKockarskiRizik(100, maxGamble, user);
    const midRisk = izracunajKockarskiRizik(2000, maxGamble, user);
    const maxRisk = izracunajKockarskiRizik(5000, maxGamble, user);

    assert.ok(smallRisk < midRisk, 'Mali bet mora imati manji rizik od srednjeg');
    assert.ok(midRisk < maxRisk, 'Srednji bet mora imati manji rizik od maxbeta');
    assert.equal(maxRisk, 1, 'Maxbet mora imati maksimalan rizik');

    // Test streak pojačanja
    const luckyUser = { coins: 10000, gambleWinStreak: 3 };
    const boostedRisk = izracunajKockarskiRizik(1000, maxGamble, luckyUser);
    const normalRisk = izracunajKockarskiRizik(1000, maxGamble, user);
    assert.ok(boostedRisk > normalRisk, 'Korisnik sa serijom pobeda mora imati veći rizik');
});

test('Gambling - tocak i rulet bez argumenata ili sa zamenjenim redosledom daju jasne instrukcije', () => {
    const chatroomId = 'test_room_gambling_args';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'teststreamer';
    channelState.currency_name = 'KickCoins';
    channelState.max_gamble_amount = 5000;
    channelState.planLimits = { priority: 2 };
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];
    channelState.economy['igrac'] = {
        username: 'Igrac',
        coins: 1000
    };

    // 1. !tocak bez argumenata ne sme reći "mora biti pozitivan broj"
    handleWheel(chatroomId, 'Igrac', '');
    assert.equal(channelState.messageQueue.length, 1);
    const tocakMsg = channelState.messageQueue.pop();
    assert.ok(!tocakMsg.includes('mora biti pozitivan broj'), 'Ne sme izbaciti generičku grešku za pozitivan broj');
    assert.ok(tocakMsg.includes('navedi ulog') && tocakMsg.includes('!tocak 100'), 'Mora dati jasnu upotrebu');

    // 2. !rulet bez argumenata
    handleRoulette(chatroomId, 'Igrac', '', '');
    const ruletEmptyMsg = channelState.messageQueue.pop();
    assert.ok(ruletEmptyMsg.includes('upotreba: !rulet'), 'Mora dati uputstvo za rulet');

    // 3. !rulet samo iznos (npr. !rulet 100)
    handleRoulette(chatroomId, 'Igrac', '100', '');
    const ruletAmountOnlyMsg = channelState.messageQueue.pop();
    assert.ok(ruletAmountOnlyMsg.includes('izaberi opciju za rulet'), 'Mora tražiti opciju kada je unet samo iznos');

    // 4. !rulet obrnut redosled (100 crvena)
    handleRoulette(chatroomId, 'Igrac', '100', 'crvena');
    assert.equal(channelState.messageQueue.length, 1);
    const ruletReversedMsg = channelState.messageQueue.pop();
    assert.ok(ruletReversedMsg.includes('Loptica je pala'), 'Mora regularno izvršiti igru ruleta sa obrnutim redosledom');
});

