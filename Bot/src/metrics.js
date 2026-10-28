// Lagane metrike (brojači) sa Prometheus text izlazom za /metrics?format=prom

const counters = new Map();
const startedAt = Date.now();

function inc(name, value = 1) {
    counters.set(name, (counters.get(name) || 0) + value);
}

function get(name) {
    return counters.get(name) || 0;
}

function snapshot() {
    const out = {};
    for (const [k, v] of counters.entries()) out[k] = v;
    return out;
}

function toPrometheus(extraGauges = {}) {
    const lines = [];
    for (const [name, value] of counters.entries()) {
        const metric = `kickot_${name}_total`;
        lines.push(`# TYPE ${metric} counter`, `${metric} ${value}`);
    }
    for (const [name, value] of Object.entries(extraGauges)) {
        const metric = `kickot_${name}`;
        lines.push(`# TYPE ${metric} gauge`, `${metric} ${Number(value) || 0}`);
    }
    lines.push('# TYPE kickot_uptime_seconds gauge', `kickot_uptime_seconds ${Math.round((Date.now() - startedAt) / 1000)}`);
    return lines.join('\n') + '\n';
}

function reset() {
    counters.clear();
}

module.exports = { inc, get, snapshot, toPrometheus, reset };
