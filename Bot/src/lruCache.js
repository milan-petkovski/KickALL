/**
 * Visokoperformantni LRU (Least Recently Used) keš sa TTL vremenskim istekom.
 * Sprečava curenje memorije (fiksiran maxSize) i eliminiše suvišne HTTP/API zahteve.
 */
class LruCache {
    constructor(options = {}) {
        this.maxSize = (typeof options.maxSize === 'number' && options.maxSize > 0) ? options.maxSize : 500;
        this.defaultTtlMs = (typeof options.defaultTtlMs === 'number' && options.defaultTtlMs > 0) ? options.defaultTtlMs : 30 * 60 * 1000;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) return null;

        const entry = this.cache.get(key);
        if (Date.now() > entry.expiry) {
            this.cache.delete(key);
            return null;
        }

        // Osveži poziciju u mapi (najskorije korišćen element ide na kraj)
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    set(key, value, customTtlMs = null) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Ukloni najstariji (prvi) element
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        const ttl = customTtlMs !== null ? customTtlMs : this.defaultTtlMs;
        this.cache.set(key, {
            value,
            expiry: Date.now() + ttl
        });
        return value;
    }

    has(key) {
        return this.get(key) !== null;
    }

    delete(key) {
        return this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    get size() {
        return this.cache.size;
    }

    cleanupExpired() {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiry) {
                this.cache.delete(key);
            }
        }
    }
}

module.exports = LruCache;
