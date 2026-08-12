const test = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/kick-exchange');

const origBase = process.env.RENDER_BOT_API_BASE;

test('Kick Exchange - OPTIONS vraća 200', async () => {
    const res = await handler({ httpMethod: 'OPTIONS', headers: {} });
    assert.equal(res.statusCode, 200);
});

test('Kick Exchange - Odbija ne-POST metode (npr. GET)', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {} });
    assert.equal(res.statusCode, 405);
});

test('Kick Exchange - Nedostajući RENDER_BOT_API_BASE vraća 500 status', async () => {
    delete process.env.RENDER_BOT_API_BASE;

    const res = await handler({
        httpMethod: 'POST',
        headers: { 'x-nf-client-connection-ip': '192.168.1.1' },
        body: 'code=test_code_123'
    });

    assert.equal(res.statusCode, 500);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Missing RENDER_BOT_API_BASE env var');

    if (origBase) process.env.RENDER_BOT_API_BASE = origBase;
});

test('Kick Exchange - Odbija preveliki payload (>10KB)', async () => {
    process.env.RENDER_BOT_API_BASE = 'https://kickbot-ihzb.onrender.com';
    const hugeBody = 'a'.repeat(12000);

    const res = await handler({
        httpMethod: 'POST',
        headers: { 'x-nf-client-connection-ip': '192.168.1.2' },
        body: hugeBody
    });

    assert.equal(res.statusCode, 413);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Payload too large');

    if (origBase) process.env.RENDER_BOT_API_BASE = origBase;
});

test('Kick Exchange - Prosleđuje kod upstream servisu', async () => {
    process.env.RENDER_BOT_API_BASE = 'https://kickbot-ihzb.onrender.com';
    process.env.INTERNAL_API_SECRET = 'secret_test';

    const origFetch = global.fetch;
    global.fetch = async (url, options) => {
        assert.ok(url.endsWith('/api/kick/exchange'));
        assert.equal(options.headers['X-Internal-Token'], 'secret_test');
        return {
            status: 200,
            headers: new Map([['content-type', 'application/json']]),
            text: async () => JSON.stringify({ access_token: 'mock_access_token_xyz' })
        };
    };

    try {
        const res = await handler({
            httpMethod: 'POST',
            headers: { 'x-nf-client-connection-ip': '192.168.1.3' },
            body: 'code=valid_oauth_code&code_verifier=xyz'
        });

        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.access_token, 'mock_access_token_xyz');
    } finally {
        global.fetch = origFetch;
        if (origBase) process.env.RENDER_BOT_API_BASE = origBase;
    }
});
