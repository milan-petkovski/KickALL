// Lagan i robustan Circuit Breaker za zaštitu eksternih API poziva od zastoja i usporavanja

class CircuitBreaker {
    constructor(options = {}) {
        this.name = options.name || 'generic';
        this.failureThreshold = options.failureThreshold || 3;
        this.resetTimeoutMs = options.resetTimeoutMs || 30000; // 30s
        this.state = 'CLOSED'; // 'CLOSED', 'OPEN', 'HALF_OPEN'
        this.failureCount = 0;
        this.lastFailureTime = 0;
    }

    isOpen() {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
                this.state = 'HALF_OPEN';
                return false;
            }
            return true;
        }
        return false;
    }

    recordSuccess() {
        this.failureCount = 0;
        this.state = 'CLOSED';
    }

    recordFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
        }
    }

    async execute(asyncFn, fallbackFn) {
        if (this.isOpen()) {
            if (typeof fallbackFn === 'function') {
                return fallbackFn(new Error(`Circuit breaker '${this.name}' is OPEN (servis privremeno nedostupan)`));
            }
            throw new Error(`Circuit breaker '${this.name}' is OPEN (servis privremeno nedostupan)`);
        }

        try {
            const res = await asyncFn();
            this.recordSuccess();
            return res;
        } catch (err) {
            this.recordFailure();
            if (typeof fallbackFn === 'function') {
                return fallbackFn(err);
            }
            throw err;
        }
    }
}

module.exports = CircuitBreaker;
