const test = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/api-proxy');

test('API Proxy - OPTIONS vraca 200', async () => {
    const res = await handler({ httpMethod: 'OPTIONS', headers: {} });
    assert.equal(res.statusCode, 200);
});

test('API Proxy - Odbija HTTP metode osim POST (npr. GET)', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {} });
    assert.equal(res.statusCode, 405);
});

test('API Proxy - Odbija preveliki payload (>50KB)', async () => {
    const hugeBody = 'x'.repeat(55000);
    const res = await handler({
        httpMethod: 'POST',
        headers: { 'x-nf-client-connection-ip': '10.0.0.1' },
        body: hugeBody
    });
    assert.equal(res.statusCode, 413);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Payload too large');
});

test('API Proxy - SSRF zaštita: Odbija targetUrl sa nedozvoljenim domenom (evil.com)', async () => {
    const res = await handler({
        httpMethod: 'POST',
        headers: { 'x-nf-client-connection-ip': '10.0.0.2' },
        body: JSON.stringify({ targetUrl: 'http://evil.com/steal-data' })
    });
    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Target domain not allowed');
});

test('API Proxy - Neispravan URL vraća 400 Bad Request', async () => {
    const res = await handler({
        httpMethod: 'POST',
        headers: { 'x-nf-client-connection-ip': '10.0.0.3' },
        body: JSON.stringify({ targetUrl: 'not-a-valid-url' })
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Invalid URL');
});

test('API Proxy - Dozvoljen domen (kick.com) prolazi i vraca proxy odgovor', async () => {
    const origFetch = global.fetch;
    global.fetch = async (url) => {
        assert.ok(url.includes('kick.com'));
        return {
            status: 200,
            headers: new Map([['content-type', 'application/json']]),
            text: async () => JSON.stringify({ success: true })
        };
    };

    try {
        const res = await handler({
            httpMethod: 'POST',
            headers: { 'x-nf-client-connection-ip': '10.0.0.4' },
            body: JSON.stringify({ targetUrl: 'https://kick.com/api/v2/channels/test' })
        });
        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.success, true);
    } finally {
        global.fetch = origFetch;
    }
});
