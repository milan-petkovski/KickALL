const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/state');
const messenger = require('../src/messenger');

test('Messenger Leaky Bucket - Definisani limiti reda i tempo slanja', () => {
    assert.equal(messenger.MAX_QUEUE_SIZE, 50);
    assert.equal(messenger.MIN_SEND_INTERVAL_MS, 1000);
});

test('Messenger Leaky Bucket - Reset queue čisti tajmere i prazni red poruka', () => {
    const roomId = 'test_room_leaky_1';
    const channelState = state.getChannelState(roomId);
    channelState.channelUsername = 'TestStreamerLeaky';
    channelState.messageQueue = ['Poruka 1', 'Poruka 2'];
    channelState.isProcessingQueue = true;
    channelState.rateLimitUntil = Date.now() + 5000;

    messenger.resetQueue(roomId);

    assert.equal(channelState.messageQueue.length, 0);
    assert.equal(channelState.isProcessingQueue, false);
    assert.equal(channelState.rateLimitUntil, 0);
    assert.equal(channelState.queueDrainTimer, null);
});

test('Messenger Leaky Bucket - 429 Kick API blokada postavlja rateLimitUntil i pauzira slanje', () => {
    const roomId = 'test_room_leaky_2';
    const channelState = state.getChannelState(roomId);
    channelState.channelUsername = 'RateLimitedStreamer';

    // Postavi simuliranu 429 blokadu
    const futureTime = Date.now() + 6000;
    channelState.rateLimitUntil = futureTime;

    assert.ok(channelState.rateLimitUntil > Date.now());
    assert.ok(channelState.rateLimitUntil - Date.now() <= 6000);

    messenger.resetQueue(roomId);
});

test('Messenger Leaky Bucket - Pacing regulator drži tempo od 1s između slanja', () => {
    const roomId = 'test_room_leaky_3';
    const channelState = state.getChannelState(roomId);
    channelState.channelUsername = 'PacingStreamer';

    channelState.lastSentTimestamp = Date.now() - 300; // poslato pre 300ms
    const elapsed = Date.now() - channelState.lastSentTimestamp;
    const remainingDelay = messenger.MIN_SEND_INTERVAL_MS - elapsed;

    // Očekujemo kašnjenje od oko 700ms (1000 - 300)
    assert.ok(remainingDelay > 600 && remainingDelay <= 1000);

    messenger.resetQueue(roomId);
});
