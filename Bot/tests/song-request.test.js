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
    assert.ok(channelState.messageQueue[0].includes('1/5 glasova'));

    // Dupli glas od istog korisnika se odbija
    channelState.messageQueue = [];
    await commands.handleVoteSkip(chatroomId, 'User1');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('već si glasao'));

    // Drugi glas
    channelState.messageQueue = [];
    await commands.handleVoteSkip(chatroomId, 'User2');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('2/5 glasova'));
});

test('Song Request - voteskip glasovi se prate isključivo po pesmi i ne prenose se na sledeću pesmu', async () => {
    const chatroomId = 'test_room_sr_voteskip_isolation_1';
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = 'teststreamer';
    channelState.feature_songrequest = true;
    channelState.isProcessingQueue = true;
    channelState.messageQueue = [];

    channelState.songrequest_settings = {
        queue: [
            { id: 'yt_song1', title: 'Pesma 1', artist: 'Izvodjac 1', ytId: 'song1', requester: 'Requester1' },
            { id: 'yt_song2', title: 'Pesma 2', artist: 'Izvodjac 2', ytId: 'song2', requester: 'Requester2' },
            { id: 'yt_song3', title: 'Pesma 3', artist: 'Izvodjac 3', ytId: 'song3', requester: 'Requester3' }
        ]
    };

    // 1. Korisnici glasaju za prvu pesmu (3 glasa)
    await commands.handleVoteSkip(chatroomId, 'UserA');
    await commands.handleVoteSkip(chatroomId, 'UserB');
    channelState.messageQueue = [];
    await commands.handleVoteSkip(chatroomId, 'UserC');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('3/5 glasova'));

    // 2. Naručilac prve pesme je preskače sa !skip
    channelState.messageQueue = [];
    await commands.handleSkipSong(chatroomId, 'Requester1');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('preskočio pesmu'));
    assert.equal(channelState.songrequest_settings.queue[0].id, 'yt_song2');

    // 3. UserA (koji je već glasao za Pesmu 1) sada glasa za Pesmu 2
    // Mora biti prihvaćen i brojač mora početi od 1/5, a ne 4/5!
    channelState.messageQueue = [];
    await commands.handleVoteSkip(chatroomId, 'UserA');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('1/5 glasova'));
    assert.ok(!channelState.messageQueue[0].includes('već si glasao'));

    // 4. Glasaju još 4 korisnika do 5/5
    await commands.handleVoteSkip(chatroomId, 'UserB');
    await commands.handleVoteSkip(chatroomId, 'UserC');
    await commands.handleVoteSkip(chatroomId, 'UserD');
    channelState.messageQueue = [];
    await commands.handleVoteSkip(chatroomId, 'UserE');

    // Pesma 2 mora biti preskočena i mora se pustiti Pesma 3
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('preskočena većinom glasova'));
    assert.ok(channelState.messageQueue[0].includes('(5/5)'));
    assert.equal(channelState.songrequest_settings.queue[0].id, 'yt_song3');

    // 5. UserA glasa za Pesmu 3 -> ponovo počinje od 1/5!
    channelState.messageQueue = [];
    await commands.handleVoteSkip(chatroomId, 'UserA');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('1/5 glasova'));
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
    assert.ok(channelState.messageQueue[0].includes('samo strimer i @Milan_567 mogu'));

    // Milan_567 postavlja jačinu zvuka
    channelState.messageQueue = [];
    await commands.handleSetVolume(chatroomId, 'Milan_567', '60');
    assert.equal(channelState.messageQueue.length, 1);
    assert.ok(channelState.messageQueue[0].includes('podešena na 60%'));

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

test('Song Request - formatDuration precizno formatira trajanje pesme u minute i sekunde', () => {
    const { formatDuration } = require('../src/commands/music');
    assert.equal(formatDuration(360), '6m');
    assert.equal(formatDuration(372), '6m 12s');
    assert.equal(formatDuration(45), '45s');
    assert.equal(formatDuration(480), '8m');
    assert.equal(formatDuration(605), '10m 5s');
    assert.equal(formatDuration(0), '0s');
});
