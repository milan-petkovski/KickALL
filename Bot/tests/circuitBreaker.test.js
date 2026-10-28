const test = require('node:test');
const assert = require('node:assert/strict');
const CircuitBreaker = require('../src/circuitBreaker');

test('CircuitBreaker - uspešno izvršavanje u CLOSED stanju', async () => {
    const breaker = new CircuitBreaker({ name: 'test-success', failureThreshold: 3 });

    const result = await breaker.execute(async () => {
        return 'uspesan_odgovor';
    });

    assert.equal(result, 'uspesan_odgovor');
    assert.equal(breaker.isOpen(), false);
    assert.equal(breaker.state, 'CLOSED');
});

test('CircuitBreaker - prelazak u OPEN stanje nakon 3 uzastopna neuspeha', async () => {
    const breaker = new CircuitBreaker({ name: 'test-fail', failureThreshold: 3, resetTimeoutMs: 100 });

    const failingTask = async () => {
        throw new Error('Servis u prekidu');
    };

    // 1. neuspeh
    await assert.rejects(breaker.execute(failingTask));
    assert.equal(breaker.state, 'CLOSED');

    // 2. neuspeh
    await assert.rejects(breaker.execute(failingTask));
    assert.equal(breaker.state, 'CLOSED');

    // 3. neuspeh -> otvara circuit breaker
    await assert.rejects(breaker.execute(failingTask));
    assert.equal(breaker.isOpen(), true);
    assert.equal(breaker.state, 'OPEN');

    // Sledeći poziv sa fallback funkcijom se ne izvršava, već odmah vraća fallback
    let executed = false;
    const fallbackResult = await breaker.execute(async () => {
        executed = true;
    }, () => 'fallback_odgovor');

    assert.equal(executed, false);
    assert.equal(fallbackResult, 'fallback_odgovor');
});
