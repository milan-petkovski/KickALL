const test = require('node:test');
const assert = require('node:assert/strict');
const raidDefense = require('../src/raidDefense');

test('RaidDefense - regularni gledaoci i pojedinačne poruke prolaze bez blokiranja', () => {
    const chatroomId = 'test_raid_room_1';
    raidDefense.resetChannel(chatroomId);

    const isBlocked1 = raidDefense.proveriRaidPoruku(chatroomId, 'Viewer1', {}, 'StreamerTest');
    assert.equal(isBlocked1, false);

    const isBlocked2 = raidDefense.proveriRaidPoruku(chatroomId, 'Viewer2', {}, 'StreamerTest');
    assert.equal(isBlocked2, false);

    assert.equal(raidDefense.isRaidModeActive(chatroomId), false);
});

test('RaidDefense - moderatori, strimer, VIP i pretplatnici su uvek zaštićeni od blokiranja', () => {
    const chatroomId = 'test_raid_room_2';
    raidDefense.resetChannel(chatroomId);

    const modSender = { identity: { badges: [{ type: 'moderator' }] } };
    const subSender = { identity: { badges: [{ type: 'subscriber' }] } };

    assert.equal(raidDefense.proveriRaidPoruku(chatroomId, 'ModUser', modSender, 'StreamerTest'), false);
    assert.equal(raidDefense.proveriRaidPoruku(chatroomId, 'SubUser', subSender, 'StreamerTest'), false);
    assert.equal(raidDefense.proveriRaidPoruku(chatroomId, 'StreamerTest', {}, 'StreamerTest'), false);
});

test('RaidDefense - nagli priliv 12+ novih nepoznatih korisnika aktivira Raid Defense i blokira nove raider naloge', () => {
    const chatroomId = 'test_raid_room_3';
    raidDefense.resetChannel(chatroomId);

    // Prvih 11 novih korisnika ulazi
    for (let i = 1; i <= 11; i++) {
        const blocked = raidDefense.proveriRaidPoruku(chatroomId, `NewUser_${i}`, {}, 'StreamerTest');
        assert.equal(blocked, false);
    }

    assert.equal(raidDefense.isRaidModeActive(chatroomId), false);

    // 12. novi korisnik u kratkom roku okida Raid Defense prag
    raidDefense.proveriRaidPoruku(chatroomId, 'NewUser_12', {}, 'StreamerTest');
    assert.equal(raidDefense.isRaidModeActive(chatroomId), true);

    // Sledeći novi nepoznati korisnik bez bedževa koji upada u toku racije mora biti blokiran
    const raiderBlocked = raidDefense.proveriRaidPoruku(chatroomId, 'RaiderBot_99', {}, 'StreamerTest');
    assert.equal(raiderBlocked, true);

    // Ali pretplatnik ili moderator koji se javi tokom racije NE SME biti blokiran
    const vipSender = { identity: { badges: [{ type: 'vip' }] } };
    const vipBlocked = raidDefense.proveriRaidPoruku(chatroomId, 'VipGledalac', vipSender, 'StreamerTest');
    assert.equal(vipBlocked, false);
});
