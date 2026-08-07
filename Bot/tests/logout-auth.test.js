const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { handleHttpRequest } = require('../bot');

test('Logout API Security - provera zaštite od neovlašćenog DoS logout-a na pravom handleru', async () => {
    const secret = 'test_logout_secret_key_456';
    process.env.INTERNAL_API_SECRET = secret;

    // Kreiramo server direktno nad PRAVIM handleHttpRequest iz bot.js
    const testServer = http.createServer(handleHttpRequest);

    await new Promise(resolve => testServer.listen(0, resolve));
    const port = testServer.address().port;

    try {
        // 1. Neautorizovan poziv ka /api/global-logout mora vratiti 401 Unauthorized (sprečava DoS logout)
        const resUnauthorized = await fetch(`http://127.0.0.1:${port}/api/global-logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: 'target_victim_user_123' })
        });
        assert.equal(resUnauthorized.status, 401);

        // 2. Autorizovan poziv sa ispravnim X-Internal-Token header-om uspeva sa HTTP 200
        const resAuthorized = await fetch(`http://127.0.0.1:${port}/api/global-logout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Internal-Token': secret
            },
            body: JSON.stringify({ userId: 'target_victim_user_123' })
        });
        assert.equal(resAuthorized.status, 200);
        const data = await resAuthorized.json();
        assert.equal(data.success, true);

        // 3. /api/check-logout je provera koja vraća true za izlogovanog usera i false za aktivnog korisnika
        const resCheckLoggedOut = await fetch(`http://127.0.0.1:${port}/api/check-logout?userId=target_victim_user_123`);
        assert.equal(resCheckLoggedOut.status, 200);
        const checkDataLoggedOut = await resCheckLoggedOut.json();
        assert.equal(checkDataLoggedOut.shouldLogout, true);

        const resCheckActive = await fetch(`http://127.0.0.1:${port}/api/check-logout?userId=active_user_456`);
        assert.equal(resCheckActive.status, 200);
        const checkDataActive = await resCheckActive.json();
        assert.equal(checkDataActive.shouldLogout, false);

    } finally {
        testServer.close();
    }
});
