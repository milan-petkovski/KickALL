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

        // 5. Pokušaj Origin-spoofing napada (Origin header bez validnog tokena) -> mora vratiti 401
        const resSpoofedOrigin = await fetch(`http://127.0.0.1:${port}/api/channels`, {
            headers: { 'Origin': 'https://kickall.app' }
        });
        assert.equal(resSpoofedOrigin.status, 401);

        // 6. Testiranje internog endpointa /api/internal/subscription-sync sa validnim tokenom
        const resSync = await fetch(`http://127.0.0.1:${port}/api/internal/subscription-sync`, {
            method: 'POST',
            headers: {
                'X-Internal-Token': 'secret_test_token_987',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userId: 'test_user_abc' })
        });
        assert.equal(resSync.status, 200);

    } finally {
        testServer.close();
    }
});

test('Bot API Auth & Security - fail-closed zaštita kada INTERNAL_API_SECRET nedostaje u konfiguraciji', async () => {
    delete process.env.INTERNAL_API_SECRET;
    delete process.env.INTERNAL_SECRET;

    const testServer = http.createServer(handleHttpRequest);
    await new Promise(resolve => testServer.listen(0, resolve));
    const port = testServer.address().port;

    try {
        const res = await fetch(`http://127.0.0.1:${port}/api/channels`, {
            headers: { 'X-Internal-Token': 'random_guess' }
        });
        assert.equal(res.status, 401, 'Mora vratiti 401 kada tajni ključ nije konfigurisan (fail-closed)');
    } finally {
        testServer.close();
    }
});

test('Bot API Auth & Security - podrška za rotaciju tajnih ključeva (comma-separated secrets)', async () => {
    process.env.INTERNAL_API_SECRET = 'new_secret_2026, old_secret_2025';

    const testServer = http.createServer(handleHttpRequest);
    await new Promise(resolve => testServer.listen(0, resolve));
    const port = testServer.address().port;

    try {
        // Prihvata novi ključ
        const resNew = await fetch(`http://127.0.0.1:${port}/api/channels`, {
            headers: { 'X-Internal-Token': 'new_secret_2026' }
        });
        assert.equal(resNew.status, 200, 'Novi ključ mora biti prihvaćen tokom rotacije');

        // Prihvata i stari ključ
        const resOld = await fetch(`http://127.0.0.1:${port}/api/channels`, {
            headers: { 'X-Internal-Token': 'old_secret_2025' }
        });
        assert.equal(resOld.status, 200, 'Stari ključ mora biti prihvaćen tokom tranzicije');

        // Odbija nepovezan ključ
        const resUnknown = await fetch(`http://127.0.0.1:${port}/api/channels`, {
            headers: { 'X-Internal-Token': 'completely_random' }
        });
        assert.equal(resUnknown.status, 401);
    } finally {
        testServer.close();
    }
});

