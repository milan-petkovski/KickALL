const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/state');
const commands = require('../src/commands');

test('Song Request - handleSongLink vraca link trenutne pesme ako pesma svira', async () => {
    const chatroomId = 'test_room_sr_songlink_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'teststreamer';
    channelState.feature_songrequest = true;
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];

    // Nema pesme u redu
    channelState.songrequest_settings = { queue: [] };
    await commands.handleSongLink(chatroomId, 'Gledalac1');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('trenutno se ne pušta nijedna pesma'));

    channelState.messageQueue = [];
    // Postavimo aktivnu pesmu
    channelState.songrequest_settings = {
        queue: [
            {
                title: 'Doktor',
                artist: 'Ceca',
                ytId: 'dQw4w9WgXcQ',
                requester: 'Gledalac1'
            }
        ]
    };

    await commands.handleSongLink(chatroomId, 'Gledalac2');
    assert.equal(channelState.messageQueue.length, 1);
    const reply = channelState.messageQueue[0];
    assert.ok(reply.includes('Ceca - Doktor'));
    assert.ok(reply.includes('https://youtu.be/dQw4w9WgXcQ'));
    assert.ok(reply.includes('@Gledalac1'));
});

test('Song Request - handleVoteSkip glasanje i registracija glasova', async () => {
    const chatroomId = 'test_room_sr_voteskip_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'teststreamer';
    channelState.feature_songrequest = true;
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];

    // Nema pesme
    channelState.songrequest_settings = { queue: [] };
    await commands.handleVoteSkip(chatroomId, 'User1');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('nema aktivne pesme za preskakanje'));

    channelState.messageQueue = [];
    channelState.songrequest_settings = {
        queue: [
            { title: 'Pesma 1', artist: 'Izvodjac 1', ytId: 'id1', requester: 'Pesnik' },
            { title: 'Pesma 2', artist: 'Izvodjac 2', ytId: 'id2', requester: 'Gledalac' }
        ]
    };

    // Prvi glas
    await commands.handleVoteSkip(chatroomId, 'User1');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('1/3 glasova'));

    // Dupli glas od istog korisnika se odbija
    channelState.messageQueue = [];
    await commands.handleVoteSkip(chatroomId, 'User1');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('već si glasao'));

    // Drugi glas
    channelState.messageQueue = [];
    await commands.handleVoteSkip(chatroomId, 'User2');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('2/3 glasova'));
});

test('Song Request - handleSetVolume podesava jacinu zvuka u rasponu 0-100', async () => {
    const chatroomId = 'test_room_sr_vol_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'teststreamer';
    channelState.feature_songrequest = true;
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];

    // Obican gledalac bez permisija
    await commands.handleSetVolume(chatroomId, 'RegularViewer', '50');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('samo moderatori i strimer mogu'));

    // Strimer unosi nevazecu vrednost
    channelState.messageQueue = [];
    await commands.handleSetVolume(chatroomId, 'teststreamer', 'abc');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('od 0 do 100'));

    // Strimer unosi preko 100
    channelState.messageQueue = [];
    await commands.handleSetVolume(chatroomId, 'teststreamer', '150');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('od 0 do 100'));

    // Strimer validno postavlja na 75
    channelState.messageQueue = [];
    await commands.handleSetVolume(chatroomId, 'teststreamer', '75');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('podešena na 75%'));
});

test('Song Request - handleTogglePause pauzira i nastavlja reprodukciju', async () => {
    const chatroomId = 'test_room_sr_pause_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'teststreamer';
    channelState.feature_songrequest = true;
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];

    // Obican gledalac
    await commands.handleTogglePause(chatroomId, 'RegularViewer', 'pause');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('samo moderatori i strimer mogu'));

    // Strimer pauzira
    channelState.messageQueue = [];
    await commands.handleTogglePause(chatroomId, 'teststreamer', 'pause');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('pauziran'));

    // Strimer nastavlja
    channelState.messageQueue = [];
    await commands.handleTogglePause(chatroomId, 'teststreamer', 'resume');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('nastavljen'));
});

test('Song Request - Odbija plejlist linkove i zahteva pojedinacnu pesmu', async () => {
    const chatroomId = 'test_room_sr_playlist_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'teststreamer';
    channelState.feature_songrequest = true;
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];

    await commands.handlePesma(chatroomId, 'User1', 'https://www.youtube.com/playlist?list=PL12345');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('uneli ste link cele plejliste'));
});

test('Song Request - Ogranicenje maksimalnog broja pesama po korisniku', async () => {
    const chatroomId = 'test_room_sr_limit_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'teststreamer';
    channelState.feature_songrequest = true;
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];
    channelState.songrequest_settings = {
        max_songs_per_user: 2,
        queue: [
            { title: 'Prva', artist: 'A', ytId: 'id1', requester: 'userspammer' },
            { title: 'Druga', artist: 'B', ytId: 'id2', requester: 'userspammer' }
        ]
    };

    await commands.handlePesma(chatroomId, 'userspammer', 'neka nova pesma');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('već imaš 2 pesme na čekanju u redu'));
});
