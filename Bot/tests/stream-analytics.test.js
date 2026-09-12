const test = require('node:test');
const assert = require('node:assert/strict');
const streamAnalytics = require('../src/streamAnalytics');

test('StreamAnalytics - onStreamLive inicijalizuje aktivnu sesiju i beleži startne podatke', async () => {
    const chatroomId = 'test_sa_room_1';
    const channelUsername = 'Milan_567';
    const livestreamData = {
        session_title: 'Prvi lajv danas!',
        viewer_count: 85,
        created_at: new Date(Date.now() - 3600000).toISOString() // 1 sat ranije
    };

    const session = await streamAnalytics.onStreamLive(chatroomId, channelUsername, livestreamData, '00000000-0000-0000-0000-000000000001');

    assert.ok(session);
    assert.equal(session.channelName, 'Milan_567');
    assert.equal(session.streamTitle, 'Prvi lajv danas!');
    assert.equal(session.peakViewers, 85);
    assert.equal(session.avgViewers, 85);
    assert.equal(session.totalMessages, 0);
    assert.equal(session.totalEmotes, 0);
});

test('StreamAnalytics - recordChatMessage ispravno ažurira poruke, jedinstvene chatere, emoti i brzinu', () => {
    const chatroomId = 'test_sa_room_1';

    // Šaljemo poruke sa i bez Kick emotea
    streamAnalytics.recordChatMessage(chatroomId, 'GledalacA', 'Pozdrav svima [emote:123:kekw]!');
    streamAnalytics.recordChatMessage(chatroomId, 'GledalacB', 'Idemo jako [emote:123:kekw] [emote:456:pog]');
    streamAnalytics.recordChatMessage(chatroomId, 'GledalacA', 'Druga poruka od A');

    const session = streamAnalytics.getActiveSession(chatroomId);
    assert.ok(session);
    assert.equal(session.totalMessages, 3);
    assert.equal(session.uniqueChatters.size, 2);
    assert.equal(session.totalEmotes, 3); // 2x kekw + 1x pog
    assert.equal(session.emotesMap.get('kekw'), 2);
    assert.equal(session.emotesMap.get('pog'), 1);

    // Proveri aktivnost korisnika
    assert.equal(session.chattersMap.get('GledalacA').count, 2);
    assert.equal(session.chattersMap.get('GledalacB').count, 1);
    assert.ok(session.chatVelocityPeak >= 3);
});

test('StreamAnalytics - recordViewerCount prati peak i prosek gledalaca', () => {
    const chatroomId = 'test_sa_room_1';

    streamAnalytics.recordViewerCount(chatroomId, 120);
    streamAnalytics.recordViewerCount(chatroomId, 95);

    const session = streamAnalytics.getActiveSession(chatroomId);
    assert.ok(session);
    assert.equal(session.peakViewers, 120);
    assert.ok(session.avgViewers > 0);
});

test('StreamAnalytics - recordModerationAction beleži banove i timeout-e', () => {
    const chatroomId = 'test_sa_room_1';

    streamAnalytics.recordModerationAction(chatroomId, 'TIMEOUT', 'Spamer1', 'Kickot Bot', 'Ponavljanje poruka');
    streamAnalytics.recordModerationAction(chatroomId, 'BAN', 'RaidBot', 'Kickot Bot', 'Zabranjene reči');

    const session = streamAnalytics.getActiveSession(chatroomId);
    assert.ok(session);
    assert.equal(session.banLogs.length, 2);
    assert.equal(session.banLogs[0].user, 'RaidBot');
    assert.equal(session.banLogs[0].type, 'BAN');
    assert.equal(session.banLogs[1].user, 'Spamer1');
    assert.equal(session.banLogs[1].type, 'TIMEOUT');
});

test('StreamAnalytics - onStreamOffline finalizuje sesiju i uklanja je iz aktivnih', async () => {
    const chatroomId = 'test_sa_room_1';

    await streamAnalytics.onStreamOffline(chatroomId, 'Milan_567');

    const session = streamAnalytics.getActiveSession(chatroomId);
    assert.equal(session, null);
});
