const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/state');
const commands = require('../src/commands');

test('Commands Uniqueness - handleMrzim računa mržnju i šalje unikatnu poruku', () => {
    const chatroomId = 'test_room_mrzim_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'teststreamer';
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];

    commands.handleMrzim(chatroomId, 'UserA', '@UserB');

    assert.equal(channelState.messageQueue.length, 1);
    const msg = channelState.messageQueue[0];
    assert.ok(msg.includes('Kalkulator Mržnje'));
    assert.ok(msg.includes('@UserA'));
    assert.ok(msg.includes('@UserB'));
});

test('Commands Uniqueness - handleAktivnost prikazuje čet aktivnost odvojeno od handleMe', () => {
    const chatroomId = 'test_room_aktivnost_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'teststreamer';
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];

    channelState.leaderboard = {
        'usera': { username: 'UserA', count: 150 }
    };
    channelState.leaderboardDaily = {
        'usera': { username: 'UserA', count: 25 }
    };

    commands.handleAktivnost(chatroomId, 'UserA', '');

    assert.equal(channelState.messageQueue.length, 1);
    const msg = channelState.messageQueue[0];
    assert.ok(msg.includes('Čet aktivnost'));
    assert.ok(msg.includes('25 poruka danas'));
    assert.ok(msg.includes('150 ovog meseca'));
    assert.ok(msg.includes('Rang #1'));
});

test('Commands Uniqueness - Duel vs Brak prihvatanje bez kolizija', () => {
    const chatroomId = 'test_room_duel_brak_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'teststreamer';
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];

    // 1. Postavimo pendingProposal (brak)
    channelState.pendingProposals['partner'] = {
        sender: 'Proposer',
        target: 'Partner',
        expires: Date.now() + 60000,
        procenat: 95
    };

    assert.ok(!channelState.pendingDuels || !channelState.pendingDuels['partner']);
    assert.ok(channelState.pendingProposals['partner']);

    commands.handlePrihvatiBrak(chatroomId, 'partner');

    assert.equal(channelState.pendingProposals['partner'], undefined);
    assert.ok(channelState.messageQueue.some(m => m.includes('ZVANIČNO VENČANI')));
});

test('Commands Uniqueness - Provera unikatnosti svih ugrađenih komandi u dashboard.js', () => {
    const fs = require('fs');
    const path = require('path');
    const dashboardJsPath = path.resolve(__dirname, '../../Website/kickot/js/dashboard.js');
    const content = fs.readFileSync(dashboardJsPath, 'utf8');

    // Izdvajamo defaultBuiltinCommands definiciju
    const match = content.match(/const defaultBuiltinCommands = (\[[\s\S]*?\n\]);/);
    assert.ok(match, 'defaultBuiltinCommands mora postojati u dashboard.js');

    // Evaluacija niza u izolovanom kontekstu
    const list = eval(match[1]);
    assert.ok(Array.isArray(list) && list.length > 0);

    const ids = new Set();
    const dbMatchKeys = new Set();
    const aliasesSeen = new Map();

    for (const item of list) {
        // 1. Provera da je svaki id unikatan
        assert.ok(!ids.has(item.id), `Duplikat ID ugrađene komande: ${item.id}`);
        ids.add(item.id);

        // 2. Provera da je svaki db_match_key unikatan
        assert.ok(!dbMatchKeys.has(item.db_match_key), `Duplikat db_match_key u ugrađenim komandama: ${item.db_match_key}`);
        dbMatchKeys.add(item.db_match_key);

        // 3. Provera primarnih alijasa (provera da dva različita item-a nemaju isti alijas)
        const aliases = new Set((item.command || '')
            .split(',')
            .map(p => p.trim().split(/\s+/)[0].replace(/^!/, '').toLowerCase())
            .filter(Boolean));

        for (const alias of aliases) {
            if (aliasesSeen.has(alias) && aliasesSeen.get(alias) !== item.id) {
                const prev = aliasesSeen.get(alias);
                assert.fail(`Kolizija alijasa komande "!${alias}" između "${prev}" i "${item.id}"`);
            }
            aliasesSeen.set(alias, item.id);
        }
    }
});

