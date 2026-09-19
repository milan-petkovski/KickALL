const test = require('node:test');
const assert = require('node:assert/strict');

const state = require('../src/state');
const stats = require('../src/commands/stats');
const watchtime = require('../src/watchtime');
const economy = require('../src/economy');
const music = require('../src/commands/music');
const spam = require('../src/spam');
const utils = require('../src/utils');

test('Command Fixes - Flexible !top parsing in any order', async (t) => {
    const chatroomId = 'test_top_parsing';
    state.channels[chatroomId] = {
        channelUsername: 'StreamerTest',
        feature_watchtime: true,
        feature_leaderboard: true,
        watchtime: {
            user1: { display_name: 'UserOne', minutes: 120 },
            user2: { display_name: 'UserTwo', minutes: 60 }
        },
        economy: {
            user1: { coins: 500, xp: 200, level: 2 },
            user2: { coins: 1500, xp: 800, level: 3 }
        },
        cooldowns: {}
    };

    let watchtimeCalledWith = null;
    const origHandleTopWatchtime = watchtime.handleTopWatchtime;
    watchtime.handleTopWatchtime = (cid, arg) => {
        watchtimeCalledWith = arg;
    };

    let coinsCalledWith = null;
    const origHandleTopCoins = economy.handleTopCoins;
    economy.handleTopCoins = (cid, arg) => {
        coinsCalledWith = arg;
    };

    let levelCalledWith = null;
    const origHandleTopLevel = economy.handleTopLevel;
    economy.handleTopLevel = (cid, arg) => {
        levelCalledWith = arg;
    };

    // 1. "!top 15 watchtime"
    stats.handleTop(chatroomId, '15 watchtime');
    assert.equal(watchtimeCalledWith, '15', 'Should extract 15 and route to watchtime');

    // 2. "!top watchtime 10"
    stats.handleTop(chatroomId, 'watchtime 10');
    assert.equal(watchtimeCalledWith, '10', 'Should extract 10 and route to watchtime');

    // 3. "!top 10 coins"
    stats.handleTop(chatroomId, '10 coins');
    assert.equal(coinsCalledWith, '10', 'Should extract 10 and route to coins');

    // 4. "!top 5 level"
    stats.handleTop(chatroomId, '5 level');
    assert.equal(levelCalledWith, '5', 'Should extract 5 and route to level');

    // Restore
    watchtime.handleTopWatchtime = origHandleTopWatchtime;
    economy.handleTopCoins = origHandleTopCoins;
    economy.handleTopLevel = origHandleTopLevel;
});

test('Command Fixes - Anti-spam exempts VIP and OG badges', (t) => {
    const chatroomId = 'test_spam_exempt';
    state.channels[chatroomId] = {
        channelUsername: 'StreamerTest',
        spamTracker: {},
        rapidTracker: {},
        lastWarned: {},
        lastSpamPenalty: {},
        bannedUsers: new Set()
    };

    // VIP korisnik šalje istu poruku više puta
    const vipSender = { identity: { badges: [{ type: 'vip' }] } };
    for (let i = 0; i < 6; i++) {
        const blocked = spam.spamFilter(chatroomId, 'VipUser', 'haha', vipSender);
        assert.equal(blocked, false, 'VIP user should never be blocked by spam filter');
    }

    // OG korisnik šalje istu poruku više puta
    const ogSender = { identity: { badges: [{ type: 'og' }] } };
    for (let i = 0; i < 6; i++) {
        const blocked = spam.spamFilter(chatroomId, 'OgUser', 'w', ogSender);
        assert.equal(blocked, false, 'OG user should never be blocked by spam filter');
    }
});

test('Command Fixes - Anti-spam higher threshold for short reactions', (t) => {
    const chatroomId = 'test_spam_reactions';
    state.channels[chatroomId] = {
        channelUsername: 'StreamerTest',
        spamTracker: {},
        rapidTracker: {},
        lastWarned: {},
        lastSpamPenalty: {},
        bannedUsers: new Set()
    };

    const regularSender = { identity: { badges: [] } };
    let warnedOn3 = spam.spamFilter(chatroomId, 'NormalUser', 'w', regularSender);
    assert.equal(warnedOn3, false, 'Short reaction 1 should pass');
    warnedOn3 = spam.spamFilter(chatroomId, 'NormalUser', 'w', regularSender);
    assert.equal(warnedOn3, false, 'Short reaction 2 should pass');
    warnedOn3 = spam.spamFilter(chatroomId, 'NormalUser', 'w', regularSender);
    assert.equal(warnedOn3, false, 'Short reaction 3 should pass (threshold elevated for short reactions)');
    warnedOn3 = spam.spamFilter(chatroomId, 'NormalUser', 'w', regularSender);
    assert.equal(warnedOn3, false, 'Short reaction 4 should pass');
});

test('Command Fixes - Music !skip notices voteskip', async (t) => {
    const chatroomId = 'test_music_skip';
    state.channels[chatroomId] = {
        channelUsername: 'StreamerTest',
        feature_songrequest: true,
        isProcessingQueue: true,
        messageQueue: [],
        songrequest_settings: {
            queue: [
                { title: 'Test Song', requester: 'OriginalRequester', artist: 'Artist' }
            ]
        }
    };

    const messenger = require('../src/messenger');
    let sentMsg = '';
    const origPosalji = messenger.posaljiPoruku;
    messenger.posaljiPoruku = (cid, msg) => {
        sentMsg = msg;
    };

    const otherSender = { identity: { badges: [] } };
    await music.handleSkipSong(chatroomId, 'RandomViewer', otherSender);
    const queuedMsg = state.channels[chatroomId].messageQueue[0] || sentMsg;
    assert.match(queuedMsg, /!voteskip/, 'Skip message must instruct non-requester to use !voteskip');
    assert.match(queuedMsg, /@OriginalRequester/, 'Skip message must mention the requester');

    // Drugi moderator koji nije pustio pesmu takođe NE MOŽE da preskoči
    const modSender = { identity: { badges: [{ type: 'moderator' }] } };
    state.channels[chatroomId].messageQueue = [];
    await music.handleSkipSong(chatroomId, 'OtherMod', modSender);
    const modMsg = state.channels[chatroomId].messageQueue[0] || sentMsg;
    assert.match(modMsg, /!voteskip/, 'Moderatori koji nisu pustili pesmu ne mogu preskakati');

    // Naručilac pesme MOŽE da preskoči
    state.channels[chatroomId].messageQueue = [];
    await music.handleSkipSong(chatroomId, 'OriginalRequester', otherSender);
    assert.equal(state.channels[chatroomId].songrequest_settings.queue.length, 0, 'Naručilac mora imati pravo da preskoči');
});

test('Command Fixes - Cooldown queue schedules execution', async (t) => {
    const chatroomId = 'test_cd_queue';
    state.channels[chatroomId] = {
        channelUsername: 'StreamerTest',
        cooldowns: {},
        queuedCommands: {}
    };

    let executed = false;
    const callback = () => {
        executed = true;
    };

    // First call sets cooldown
    const onCooldown1 = utils.proveraKulauna(chatroomId, '!testcmd', 'User1', 200, callback);
    assert.equal(onCooldown1, false, 'First call should not be on cooldown');

    // Second call immediately is on cooldown and schedules queue callback
    const onCooldown2 = utils.proveraKulauna(chatroomId, '!testcmd', 'User1', 200, callback);
    assert.equal(onCooldown2, true, 'Second call should be on cooldown');
    assert.ok(state.channels[chatroomId].queuedCommands['!testcmd::user1'], 'Should have scheduled queued command');

    // Wait for timer to execute callback
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(executed, true, 'Queued command callback should have executed after cooldown elapsed');
});

test('Command Fixes - Ban & Unban bezbednost i zaštita od brisanja poruka', async () => {
    const adminCommands = require('../src/commands/admin');
    const messenger = require('../src/messenger');
    const origBan = messenger.banujKorisnika;
    const origUnban = messenger.unbanujKorisnika;
    messenger.banujKorisnika = async () => true;
    messenger.unbanujKorisnika = async () => true;

    const chatroomId = 'test_ban_safety';
    state.channels[chatroomId] = {
        channelUsername: 'MockChannel',
        bannedUsers: new Set(),
        messageQueue: [],
        isProcessingQueue: true
    };

    const modSender = { identity: { badges: [{ type: 'moderator' }] } };

    try {
        // 1. Moderator ne može banovati sebe
        await adminCommands.handleBan(chatroomId, 'Milan_567', '@Milan_567 test', modSender);
        assert.equal(state.channels[chatroomId].bannedUsers.has('milan_567'), false, 'Moderator ne sme dospeti u listu banovanih');

        // 2. Moderator ne može banovati strimera
        await adminCommands.handleBan(chatroomId, 'Milan_567', '@MockChannel test', modSender);
        assert.equal(state.channels[chatroomId].bannedUsers.has('mockchannel'), false, 'Strimer ne sme dospeti u listu banovanih');

        // 3. Unban komanda uklanja nalog iz liste banovanih
        state.channels[chatroomId].bannedUsers.add('testbot123');
        assert.equal(state.channels[chatroomId].bannedUsers.has('testbot123'), true);

        await adminCommands.handleUnban(chatroomId, 'Milan_567', '@testbot123', modSender);
        assert.equal(state.channels[chatroomId].bannedUsers.has('testbot123'), false, 'Unban mora ukloniti korisnika iz liste banovanih');
    } finally {
        messenger.banujKorisnika = origBan;
        messenger.unbanujKorisnika = origUnban;
    }
});

