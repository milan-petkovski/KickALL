const test = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/bot-proxy');

// Save original env
const originalSecret = process.env.INTERNAL_API_SECRET;

test('Bot Proxy - OPTIONS request vraća 200 sa CORS zaglavljima', async () => {
    const res = await handler({ httpMethod: 'OPTIONS', headers: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Access-Control-Allow-Origin'], process.env.ALLOWED_ORIGIN || 'https://kickall.app');
});

test('Bot Proxy - Nedostajući INTERNAL_API_SECRET vraća 500 grešku', async () => {
    delete process.env.INTERNAL_API_SECRET;

    const res = await handler({
        httpMethod: 'GET',
        path: '/.netlify/functions/bot-proxy/api/channels',
        headers: { 'x-nf-client-connection-ip': '1.2.3.4' }
    });

    assert.equal(res.statusCode, 500);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Server misconfiguration: missing INTERNAL_API_SECRET');

    // Restore env
    if (originalSecret) process.env.INTERNAL_API_SECRET = originalSecret;
});

test('Bot Proxy - Nedozvoljena putanja vraća 404 Not Found', async () => {
    process.env.INTERNAL_API_SECRET = 'test_secret_123';

    const res = await handler({
        httpMethod: 'GET',
        path: '/.netlify/functions/bot-proxy/api/evil-unauthorized-route',
        headers: { 'x-nf-client-connection-ip': '1.2.3.5' }
    });

    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Not found');
});

test('Bot Proxy - Dozvoljena putanja uspešno prosleđuje zahtev upstream servisu', async () => {
    process.env.INTERNAL_API_SECRET = 'test_secret_123';

    // Mock global fetch for upstream bot response
    const origFetch = global.fetch;
    global.fetch = async (targetUrl, options) => {
        assert.ok(targetUrl.includes('/api/channels'));
        assert.equal(options.headers['X-Internal-Token'], 'test_secret_123');
        return {
            status: 200,
            headers: new Map([['content-type', 'application/json']]),
            text: async () => JSON.stringify({ active: true, count: 5 })
        };
    };

    try {
        const res = await handler({
            httpMethod: 'GET',
            path: '/.netlify/functions/bot-proxy/api/channels',
            headers: { 'x-nf-client-connection-ip': '1.2.3.6' }
        });

        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.active, true);
        assert.equal(body.count, 5);
    } finally {
        global.fetch = origFetch;
        if (originalSecret) process.env.INTERNAL_API_SECRET = originalSecret;
    }
});
