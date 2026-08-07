const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
    verifySignature,
    parsePaddleSignature,
    maskEmail,
    safeJsonParse,
    normalizeEventType,
    handler
} = require('../netlify/functions/paddle-webhook');

test('Paddle Webhook - maskEmail', () => {
    assert.equal(maskEmail('korisnik@example.com'), 'k***k@example.com');
    assert.equal(maskEmail('ab@domain.org'), '***@domain.org');
    assert.equal(maskEmail(null), null);
});

test('Paddle Webhook - parsePaddleSignature i verifySignature', () => {
    const secret = 'pdl_secret_test_12345';
    const ts = '1690000000';
    const rawBody = JSON.stringify({ event_type: 'subscription.created', data: { id: 'sub_123' } });

    const payload = `${ts}:${rawBody}`;
    const h1 = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    const headerValue = `ts=${ts};h1=${h1}`;

    const parsed = parsePaddleSignature(headerValue);
    assert.equal(parsed.ts, ts);
    assert.equal(parsed.h1, h1);

    assert.equal(verifySignature(rawBody, headerValue, secret), true);
    assert.equal(verifySignature(rawBody, headerValue, 'pogresan_secret'), false);
    assert.equal(verifySignature('modifikovan_body', headerValue, secret), false);
});

test('Paddle Webhook - safeJsonParse i normalizeEventType', () => {
    assert.deepEqual(safeJsonParse('{"ok":true}'), { ok: true });
    assert.equal(safeJsonParse('invalid json'), null);

    assert.equal(normalizeEventType({ event_type: 'Subscription.Created' }), 'subscription.created');
    assert.equal(normalizeEventType({ type: 'transaction.completed' }), 'transaction.completed');
});

test('Paddle Webhook - handler odbija zahtev sa neispravnim potpisom', async () => {
    process.env.PADDLE_WEBHOOK_SECRET = 'my_secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'service_key';

    const res = await handler({
        httpMethod: 'POST',
        headers: {
            'paddle-signature': 'ts=1000;h1=invalid_hash'
        },
        body: JSON.stringify({ event_type: 'subscription.created' })
    });

    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Invalid signature');
});
