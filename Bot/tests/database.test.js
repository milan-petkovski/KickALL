const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/state');
const {
    ucitajUserPlan,
    evidentirajPoruku,
    smanjiPoruku,
    proveriIResetujMesec
} = require('../src/database');

test('Database - ucitajUserPlan vraća free plan po default-u kad nema Supabase klijenta', async () => {
    const chatroomId = 'test_db_room_1';
    const limits = await ucitajUserPlan(null, chatroomId);
    
    assert.ok(limits);
    assert.equal(limits.name, 'FREE');
    assert.equal(limits.maxCustomCommands, 50);

    const channelState = state.getChannelState(chatroomId);
    assert.equal(channelState.userPlan, 'free');
});

test('Database - evidentirajPoruku uvećava broj poruka na leaderboard-u i dodeljuje XP/poene', () => {
    const chatroomId = 'test_db_room_2';
    const channelState = state.getChannelState(chatroomId);
    channelState.first_interaction_bonus = 0;
    channelState.lastPointEarned = {};

    evidentirajPoruku(chatroomId, 'DbTester', 'Ovo je važeća poruka za testiranje');

    const user = channelState.leaderboard['dbtester'];
    assert.ok(user);
    assert.equal(user.username, 'DbTester');
    assert.equal(user.count, 1);

    if (channelState.leaderboardSaveTimer) {
        clearTimeout(channelState.leaderboardSaveTimer);
        channelState.leaderboardSaveTimer = null;
    }
});

test('Database - smanjiPoruku smanjuje count na leaderboard-u bez padanja u minus', () => {
    const chatroomId = 'test_db_room_3';
    const channelState = state.getChannelState(chatroomId);
    channelState.leaderboard['dbtester2'] = { username: 'DbTester2', count: 5 };

    smanjiPoruku(chatroomId, 'DbTester2', 2);
    assert.equal(channelState.leaderboard['dbtester2'].count, 3);

    // Oduzmi više nego što ima
    smanjiPoruku(chatroomId, 'DbTester2', 10);
    assert.equal(channelState.leaderboard['dbtester2'].count, 0);

    if (channelState.leaderboardSaveTimer) {
        clearTimeout(channelState.leaderboardSaveTimer);
        channelState.leaderboardSaveTimer = null;
    }
});

test('Database - proveriIResetujMesec detektuje promenu meseca i resetuje leaderboard', () => {
    const chatroomId = 'test_db_room_4';
    const channelState = state.getChannelState(chatroomId);
    channelState.tekuciMesecLeaderboarda = '2020-01';
    channelState.leaderboard = { 'stari': { username: 'Stari', count: 100 } };

    proveriIResetujMesec(chatroomId);

    // Leaderboard mora biti očišćen jer je novi mesec
    assert.deepEqual(channelState.leaderboard, {});

    if (channelState.leaderboardSaveTimer) {
        clearTimeout(channelState.leaderboardSaveTimer);
        channelState.leaderboardSaveTimer = null;
    }
});
