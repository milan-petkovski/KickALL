const test = require('node:test');
const assert = require('node:assert/strict');
const { isRateLimited } = require('../netlify/functions/utils/rate-limiter');

test('RateLimiter - dozvoljava lokalne IP adrese bez ograničenja', async () => {
    assert.equal(await isRateLimited('127.0.0.1'), false);
    assert.equal(await isRateLimited('localhost'), false);
    assert.equal(await isRateLimited('::1'), false);
});

test('RateLimiter - in-memory rate limiter ograničava učestale zahteve sa iste IP adrese', async () => {
    const testIp = '203.0.113.42';
    const options = { windowMs: 1000, maxRequests: 3, endpoint: 'test_limit' };

    // Prva 3 zahteva moraju proći
    assert.equal(await isRateLimited(testIp, options), false);
    assert.equal(await isRateLimited(testIp, options), false);
    assert.equal(await isRateLimited(testIp, options), false);

    // 4. zahtev mora biti blokiran (true)
    assert.equal(await isRateLimited(testIp, options), true);
});

test('RateLimiter - konkurentni paralelni zahtevi poštuju maxRequests limit bez race condition-a', async () => {
    const testIp = '198.51.100.77';
    const options = { windowMs: 2000, maxRequests: 5, endpoint: 'concurrent_test' };

    // Pokrećemo 12 paralelnih asinhronih zahteva u isto vreme
    const results = await Promise.all(
        Array.from({ length: 12 }, () => isRateLimited(testIp, options))
    );

    const allowed = results.filter(r => r === false).length;
    const blocked = results.filter(r => r === true).length;

    assert.equal(allowed, 5, 'Tačno 5 zahteva mora biti propušteno');
    assert.equal(blocked, 7, 'Preostalih 7 zahteva mora biti blokirano');
});
