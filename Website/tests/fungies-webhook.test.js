const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
    handler,
    _test: {
        verifyFungiesSignature,
        normalizeEventType,
        resolvePlanTier,
        extractEntityData,
        buildProfilePayload
    }
} = require('../netlify/functions/fungies-webhook');

test('Fungies Webhook - verifyFungiesSignature', () => {
    const secret = 'sec_test_secret_key_123';
    const rawBody = JSON.stringify({ event: 'subscription_created', data: { id: 'sub_123' } });

    const expectedHex = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    const signatureWithPrefix = `sha256_${expectedHex}`;

    // Valid signatures
    assert.equal(verifyFungiesSignature(rawBody, signatureWithPrefix, secret), true);
    assert.equal(verifyFungiesSignature(rawBody, expectedHex, secret), true);

    // Invalid signatures
    assert.equal(verifyFungiesSignature(rawBody, 'sha256_invalid_hash', secret), false);
    assert.equal(verifyFungiesSignature(rawBody, signatureWithPrefix, 'wrong_secret'), false);
    assert.equal(verifyFungiesSignature('tampered_body', signatureWithPrefix, secret), false);
});

test('Fungies Webhook - normalizeEventType', () => {
    assert.equal(normalizeEventType({ event: 'subscription_created' }), 'subscription_created');
    assert.equal(normalizeEventType({ event_type: 'PAYMENT_SUCCESS' }), 'payment_success');
    assert.equal(normalizeEventType({ type: 'Subscription_Cancelled' }), 'subscription_cancelled');
    assert.equal(normalizeEventType({}), '');
});

test('Fungies Webhook - resolvePlanTier', () => {
    // Pro
    assert.deepEqual(resolvePlanTier('bedbc1aa-e5ef-4402-9a6b-e7236823a40d'), { tier: 'pro', period: 'monthly' });
    assert.deepEqual(resolvePlanTier('87a918a2-aa51-4ae2-a25e-26fbb1463116'), { tier: 'pro', period: 'monthly' });
    assert.deepEqual(resolvePlanTier('16459e35-8c70-4cdc-b158-d1f492e5628f'), { tier: 'pro', period: 'yearly' });
    assert.deepEqual(resolvePlanTier('62d7b40f-45a0-413a-b967-d38ac97c4872'), { tier: 'pro', period: 'monthly' });

    // Elite
    assert.deepEqual(resolvePlanTier('6478510e-150f-4069-9ac4-7c918c97f676'), { tier: 'elite', period: 'monthly' });
    assert.deepEqual(resolvePlanTier('f66a25f4-53b5-4cd7-9012-5454f4761d47'), { tier: 'elite', period: 'yearly' });
    assert.deepEqual(resolvePlanTier('5fef2ac1-1f21-4f3c-a3cc-16a4bde51807'), { tier: 'elite', period: 'yearly' });

    // Unknown
    assert.deepEqual(resolvePlanTier('unknown_id'), { tier: 'free', period: null });
    assert.deepEqual(resolvePlanTier(null), { tier: 'free', period: null });
});

test('Fungies Webhook - extractEntityData', () => {
    const payload = {
        event: 'subscription_created',
        data: {
            client_reference_id: 'user_supabase_abc_123',
            customer_email: 'tester@example.com',
            offer_id: '87a918a2-aa51-4ae2-a25e-26fbb1463116',
            subscription_id: 'sub_xyz_999'
        }
    };

    const extracted = extractEntityData(payload);
    assert.equal(extracted.clientReferenceId, 'user_supabase_abc_123');
    assert.equal(extracted.customerEmail, 'tester@example.com');
    assert.equal(extracted.offerId, '87a918a2-aa51-4ae2-a25e-26fbb1463116');
    assert.equal(extracted.subscriptionId, 'sub_xyz_999');
});

test('Fungies Webhook - buildProfilePayload', () => {
    const activePro = buildProfilePayload('pro', 'monthly', 'active');
    assert.equal(activePro.plan, 'pro');
    assert.equal(activePro.plan_tier, 'pro');
    assert.equal(activePro.subscription_status, 'active');
    assert.equal(activePro.plan_period, 'monthly');

    const cancelledElite = buildProfilePayload('elite', 'yearly', 'canceled');
    assert.equal(cancelledElite.plan, 'free');
    assert.equal(cancelledElite.plan_tier, 'free');
    assert.equal(cancelledElite.subscription_status, 'canceled');
    assert.equal(cancelledElite.plan_period, null);
});

test('Fungies Webhook - handler rejects non-POST and invalid signatures', async () => {
    process.env.FUNGIES_WEBHOOK_SECRET = 'sec_mock_test';
    // Rejects GET
    const getRes = await handler({ httpMethod: 'GET' });
    assert.equal(getRes.statusCode, 405);

    // Rejects Invalid signature
    const postRes = await handler({
        httpMethod: 'POST',
        headers: { 'x-fngs-signature': 'sha256_fake' },
        body: JSON.stringify({ event: 'payment_success' })
    });
    assert.equal(postRes.statusCode, 401);
});

test('Fungies Webhook - handler accepts valid signed webhook', async () => {
    const secret = 'sec_test_mock_secret';
    process.env.FUNGIES_WEBHOOK_SECRET = secret;
    delete process.env.SUPABASE_URL; // Simulated mode without live DB

    const body = JSON.stringify({
        event: 'payment_success',
        data: {
            client_reference_id: 'user_456',
            offer_id: '87a918a2-aa51-4ae2-a25e-26fbb1463116'
        }
    });

    const expectedHex = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');

    const res = await handler({
        httpMethod: 'POST',
        headers: { 'x-fngs-signature': `sha256_${expectedHex}` },
        body
    });

    assert.equal(res.statusCode, 200);
    const parsedBody = JSON.parse(res.body);
    assert.equal(parsedBody.received, true);
    assert.equal(parsedBody.simulated, true);
    assert.equal(parsedBody.planTier, 'pro');
    assert.equal(parsedBody.clientReferenceId, 'user_456');
});
