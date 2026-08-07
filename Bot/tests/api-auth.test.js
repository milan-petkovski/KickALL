const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { handleHttpRequest } = require('../bot');

test('Bot API Auth & Security - provera X-Internal-Token zaštite na pravom HTTP handleru', async () => {
    // Postavi simulirane env varijable
    process.env.INTERNAL_API_SECRET = 'secret_test_token_987';
    process.env.ALLOWED_ORIGIN = 'https://kickall.app';

    // Kreiramo server direktno nad PRAVIM handleHttpRequest iz bot.js
    const testServer = http.createServer(handleHttpRequest);

    await new Promise(resolve => testServer.listen(0, resolve));
    const port = testServer.address().port;

    try {
        // 1. Poziv BEZ tokena -> mora vratiti 401
        const resNoToken = await fetch(`http://127.0.0.1:${port}/api/kick/test-ping`, { method: 'POST' });
        assert.equal(resNoToken.status, 401);

        // 2. Poziv sa NEISPRAVNIM tokenom -> mora vratiti 401
        const resBadToken = await fetch(`http://127.0.0.1:${port}/api/kick/reload`, {
            headers: { 'X-Internal-Token': 'wrong_token' }
        });
        assert.equal(resBadToken.status, 401);

        // 3. Poziv sa ISPRAVNIM X-Internal-Token -> mora vratiti 200
        const resGoodToken = await fetch(`http://127.0.0.1:${port}/api/kick/logs?chatroom_id=123`, {
            headers: { 'X-Internal-Token': 'secret_test_token_987' }
        });
        assert.equal(resGoodToken.status, 200);

        // 4. Poziv sa Authorization Bearer secret -> mora vratiti 200
        const resAuthHeader = await fetch(`http://127.0.0.1:${port}/api/channels`, {
            headers: { 'Authorization': 'Bearer secret_test_token_987' }
        });
        assert.equal(resAuthHeader.status, 200);

    } finally {
        testServer.close();
    }
});
