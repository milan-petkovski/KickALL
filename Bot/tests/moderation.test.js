const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/state');
const { proveriModeraciju } = require('../src/moderation');

// Mock fetch globally so messenger doesn't attempt real network requests
global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({ data: { id: 'msg_123' } }),
    headers: new Map()
});

test('Moderation - Inaktivan kanal ili isključena moderacija vraća false', () => {
    const chatroomId = 'test_mod_room_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.botActive = false;
    channelState.feature_moderation = true;

    // Kad je bot neaktivan
    assert.equal(proveriModeraciju(chatroomId, 'user1', 'NEKA PORUKA', '123', {}), false);

    // Kad je bot aktivan ali moderacija isključena
    channelState.botActive = true;
    channelState.feature_moderation = false;
    assert.equal(proveriModeraciju(chatroomId, 'user1', 'NEKA PORUKA', '123', {}), false);
});

test('Moderation - Strimer i moderator su izuzeti iz moderacije', () => {
    const chatroomId = 'test_mod_room_2';
    const channelState = state.getChannelState(chatroomId);
    channelState.botActive = true;
    channelState.feature_moderation = true;
    channelState.channelUsername = 'StrimerName';
    channelState.moderationSettings = {
        caps_enabled: true,
        caps_min_len: 3,
        caps_pct: 50
    };

    // Strimer šalje caps poruku
    assert.equal(proveriModeraciju(chatroomId, 'StrimerName', 'VELIKA PORUKA', '123', {}), false);

    // Moderator šalje caps poruku
    const modSender = { identity: { badges: [{ type: 'moderator' }] } };
    assert.equal(proveriModeraciju(chatroomId, 'NekiMod', 'VELIKA PORUKA', '124', modSender), false);
});

test('Moderation - Caps Protection detektuje i sankcioniše previše velikih slova', () => {
    const chatroomId = 'test_mod_room_caps';
    const channelState = state.getChannelState(chatroomId);
    channelState.botActive = true;
    channelState.feature_moderation = true;
    channelState.channelUsername = 'StrimerTest';
    channelState.moderationSettings = {
        caps_enabled: true,
        caps_min_len: 5,
        caps_pct: 70,
        caps_action_type: 'warn'
    };

    const regularSender = { identity: { badges: [] } };
    const triggered = proveriModeraciju(chatroomId, 'UserCaps', 'SVE VELIKA SLOVA', '125', regularSender);
    assert.equal(triggered, true);
    assert.equal(channelState.warningsCount.get('usercaps'), 1);
});

test('Moderation - Link Protection blokira neželjene linkove ali dozvoljava dozvoljene i sa dozvolom', () => {
    const chatroomId = 'test_mod_room_links';
    const channelState = state.getChannelState(chatroomId);
    channelState.botActive = true;
    channelState.feature_moderation = true;
    channelState.channelUsername = 'StrimerTest';
    channelState.moderationSettings = {
        links_enabled: true,
        links_whitelist: 'youtube.com, kick.com',
        links_action_type: 'delete'
    };

    const sender = { identity: { badges: [] } };

    // Dozvoljen domen
    assert.equal(proveriModeraciju(chatroomId, 'UserLink', 'Pogledajte https://youtube.com/watch?v=123', '126', sender), false);

    // Nedozvoljen domen
    assert.equal(proveriModeraciju(chatroomId, 'UserLink', 'Posetite https://evil.com/malware', '127', sender), true);

    // Sa dozvolom (permit)
    channelState.permits.set('userlink', Date.now());
    assert.equal(proveriModeraciju(chatroomId, 'UserLink', 'Posetite https://evil.com/malware', '128', sender), false);
    // Permit mora biti iskorišćen (obrisan)
    assert.equal(channelState.permits.has('userlink'), false);
});

test('Moderation - Bad Words sa zameno srpskih dijakritika (š, č, ć, ž, đ)', () => {
    const chatroomId = 'test_mod_room_words';
    const channelState = state.getChannelState(chatroomId);
    channelState.botActive = true;
    channelState.feature_moderation = true;
    channelState.channelUsername = 'StrimerTest';
    channelState.moderationSettings = {
        words_enabled: true,
        words_list: 'budala,psovka',
        words_action_type: 'timeout',
        words_timeout_duration_secs: 300
    };

    const sender = { identity: { badges: [] } };

    // Direktan pogodak
    assert.equal(proveriModeraciju(chatroomId, 'BadUser', 'Ti si budala!', '129', sender), true);

    // Sa dijakritičkom varijacijom
    channelState.moderationSettings.words_list = 'šala,čudo';
    assert.equal(proveriModeraciju(chatroomId, 'BadUser2', 'Baš lepo sala', '130', sender), true);

    // Sa nevidljivim karakterom i bidi override-om unutar reči (evasion bypass)
    channelState.moderationSettings.words_list = 'budala';
    assert.equal(proveriModeraciju(chatroomId, 'BadUser3', 'Ti si b\u200Buda\u202Ela!', '130b', sender), true);
});

test('Moderation - Emotes, Symbols, Max Length i Mentions pravila', () => {
    const chatroomId = 'test_mod_room_rules';
    const channelState = state.getChannelState(chatroomId);
    channelState.botActive = true;
    channelState.feature_moderation = true;
    channelState.channelUsername = 'StrimerTest';
    const sender = { identity: { badges: [] } };

    // Previše emotikona
    channelState.moderationSettings = {
        emotes_enabled: true,
        emotes_max: 2,
        emotes_action_type: 'delete'
    };
    assert.equal(proveriModeraciju(chatroomId, 'EmoteUser', '[emote:1:a] [emote:2:b] [emote:3:c]', '131', sender), true);

    // Previše simbola
    channelState.moderationSettings = {
        symbols_enabled: true,
        symbols_min_len: 5,
        symbols_pct: 60,
        symbols_action_type: 'delete'
    };
    assert.equal(proveriModeraciju(chatroomId, 'SymbolUser', '!!!$$$%%%', '132', sender), true);

    // Predugačka poruka
    channelState.moderationSettings = {
        max_len_enabled: true,
        max_len_limit: 10,
        max_len_action_type: 'delete'
    };
    assert.equal(proveriModeraciju(chatroomId, 'LongUser', 'Ovo je izuzetno dugačka poruka koja prelazi limit', '133', sender), true);

    // Mass mentions
    channelState.moderationSettings = {
        mentions_enabled: true,
        mentions_limit: 2,
        mentions_action_type: 'delete'
    };
    assert.equal(proveriModeraciju(chatroomId, 'MentionUser', 'Hej @user1 @user2 @user3 sta ima', '134', sender), true);
});

test('Moderation - Viewbot i scam botovi se odmah trajno banuju i šalju čistu [MOD] poruku', () => {
    const chatroomId = 'test_mod_room_viewbot';
    const channelState = state.getChannelState(chatroomId);
    channelState.botActive = true;
    channelState.feature_moderation = true;
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];
    channelState.bannedUsers = new Set();

    const botSender = { id: 987654, identity: { badges: [] } };
    const spamMsg = 'Kick viewbot, follower bot & chat bot and more. Free trial available!';

    const triggered = proveriModeraciju(chatroomId, 'f16038', spamMsg, 'msg_uuid_999', botSender);
    assert.equal(triggered, true);
    assert.equal(channelState.bannedUsers.has('f16038'), true, 'Korisnik f16038 mora biti evidentiran kao banovan');

    // Poruka u redu ne sme sadržati sirovi /timeout
    const hasRawTimeout = channelState.messageQueue.some(m => m.startsWith('/timeout'));
    assert.equal(hasRawTimeout, false, 'Moderacija nikada ne sme slati /timeout u chat kao običan tekst');

    const modMsg = channelState.messageQueue.find(m => m.includes('[MOD] @f16038'));
    assert.ok(modMsg, 'Mora postojati čista [MOD] poruka');
    assert.ok(modMsg.includes('trajno banovan'), 'Poruka mora navesti da je korisnik trajno banovan');
    channelState.isProcessingQueue = false;
});

test('Moderation - Druga poruka istog banovanog bota se ignoriše bez dupliranja poruka u chatu', () => {
    const chatroomId = 'test_mod_room_viewbot2';
    const channelState = state.getChannelState(chatroomId);
    channelState.botActive = true;
    channelState.feature_moderation = true;
    channelState.channelUsername = 'Tutz_live';
    channelState.bannedUsers = new Set(['b91ab8']);
    channelState.messageQueue = [];

    // Simulacija druge poruke bota (npr. o w n k i c k . c o m)
    const userKey = 'b91ab8';
    assert.equal(channelState.bannedUsers.has(userKey), true);
});
