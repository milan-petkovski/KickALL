// Zajednički helper za ponovni pokušaj sa eksponencijalnim backoff-om i jitter-om.

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Izvršava asinhronu funkciju uz ponovne pokušaje.
 * @param {() => Promise<any>} fn funkcija koja se izvršava
 * @param {object} opts
 * @param {number} [opts.retries=2] broj dodatnih pokušaja
 * @param {number} [opts.baseDelayMs=300] početno čekanje
 * @param {number} [opts.maxDelayMs=3000] gornja granica čekanja
 * @param {(err: any, attempt: number) => boolean} [opts.shouldRetry] odluka da li ponoviti
 */
async function withRetry(fn, opts = {}) {
    const retries = opts.retries ?? 2;
    const baseDelayMs = opts.baseDelayMs ?? 300;
    const maxDelayMs = opts.maxDelayMs ?? 3000;
    const shouldRetry = opts.shouldRetry || (() => true);

    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn(attempt);
        } catch (err) {
            lastErr = err;
            if (attempt === retries || !shouldRetry(err, attempt)) break;
            const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
            const jitter = Math.floor(Math.random() * (exp / 2));
            await sleep(exp / 2 + jitter);
        }
    }
    throw lastErr;
}

module.exports = { withRetry, sleep };
