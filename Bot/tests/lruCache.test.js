const test = require('node:test');
const assert = require('node:assert/strict');
const LruCache = require('../src/lruCache');

test('LruCache - osnovno čuvanje i dohvatanje vrednosti', () => {
    const cache = new LruCache({ maxSize: 3, defaultTtlMs: 10000 });
    cache.set('user1', 12345);
    cache.set('user2', 67890);

    assert.equal(cache.get('user1'), 12345);
    assert.equal(cache.get('user2'), 67890);
    assert.equal(cache.get('user3'), null);
});

test('LruCache - izbacivanje najstarijeg (LRU eviction) kada se dostigne maxSize', () => {
    const cache = new LruCache({ maxSize: 3, defaultTtlMs: 10000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    // Pristupamo 'a' tako da 'b' postaje najstariji nekorišćeni element
    assert.equal(cache.get('a'), 1);

    // Dodajemo 4. element 'd'
    cache.set('d', 4);

    // 'b' mora biti izbačen jer je bio najstariji
    assert.equal(cache.get('b'), null);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('c'), 3);
    assert.equal(cache.get('d'), 4);
});

test('LruCache - TTL istek vrednosti', async () => {
    const cache = new LruCache({ maxSize: 10, defaultTtlMs: 50 });
    cache.set('temp', 'privremeno');

    assert.equal(cache.get('temp'), 'privremeno');

    await new Promise(r => setTimeout(r, 60));

    // Nakon isteka TTL, get vraća null
    assert.equal(cache.get('temp'), null);
});
