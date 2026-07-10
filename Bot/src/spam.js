const config = require('./config');
const state = require('./state');
const { log } = require('./utils');
const { smanjiPoruku } = require('./database');
const { posaljiPoruku } = require('./messenger');

// Inicijalizujemo lastSpamPenalty ako ne postoji u state
if (!state.lastSpamPenalty) {
    state.lastSpamPenalty = {};
}

function spamFilter(username, poruka) {
    const sada  = Date.now();
    const userKey = username.toLowerCase();
    
    // ── 1. Provera identičnih poruka ──────────────────────────────────────────
    const kljucIdenticna = `${username}::${poruka.toLowerCase()}`;
    if (!state.spamTracker[kljucIdenticna]) state.spamTracker[kljucIdenticna] = [];
    state.spamTracker[kljucIdenticna] = state.spamTracker[kljucIdenticna].filter(t => sada - t < config.SPAM_WINDOW_MS);
    state.spamTracker[kljucIdenticna].push(sada);
    const countIdenticna = state.spamTracker[kljucIdenticna].length;

    // ── 2. Provera brzog kucanja (bilo kojih poruka) ──────────────────────────
    if (!state.rapidTracker[userKey]) state.rapidTracker[userKey] = [];
    state.rapidTracker[userKey] = state.rapidTracker[userKey].filter(t => sada - t < config.RAPID_MSG_WINDOW_MS);
    state.rapidTracker[userKey].push(sada);
    const countRapid = state.rapidTracker[userKey].length;

    const zadnjeUpozorenje = state.lastWarned[userKey] || 0;

    // Ako je dostignut limit za identične poruke
    if (countIdenticna === config.SPAM_THRESHOLD) {
        const zadnjiSpam = state.lastSpamPenalty[userKey] || 0;
        if (sada - zadnjiSpam >= config.SPAM_PENALTY_COOLDOWN_MS) {
            if (!poruka.startsWith('!')) {
                smanjiPoruku(username, 1);
                state.porukePosleAnnounce = Math.max(0, state.porukePosleAnnounce - 1);
            }
            state.lastSpamPenalty[userKey] = sada;
        }

        if (sada - zadnjeUpozorenje > config.SPAM_WINDOW_MS) {
            posaljiPoruku(`@${username} molim te ne spamuj u chatu! 🙏`);
            state.lastWarned[userKey] = sada;
            log('WARN', `Anti-spam: upozoren ${username} (${countIdenticna}x ista poruka)`);
        } else {
            log('WARN', `Anti-spam: preskočeno duplirano upozorenje za ${username}`);
        }
        return true;
    }

    if (countIdenticna > config.SPAM_THRESHOLD) {
        log('WARN', `Anti-spam: blokirano od ${username} (${countIdenticna}x ista poruka)`);
        return true;
    }

    // Ako je dostignut limit za brzo kucanje (bilo koje poruke)
    if (countRapid === config.RAPID_MSG_THRESHOLD) {
        const zadnjiSpam = state.lastSpamPenalty[userKey] || 0;
        if (sada - zadnjiSpam >= config.SPAM_PENALTY_COOLDOWN_MS) {
            if (!poruka.startsWith('!')) {
                smanjiPoruku(username, 1);
                state.porukePosleAnnounce = Math.max(0, state.porukePosleAnnounce - 1);
            }
            state.lastSpamPenalty[userKey] = sada;
        }

        if (sada - zadnjeUpozorenje > config.SPAM_WINDOW_MS) {
            posaljiPoruku(`@${username} molim te ne spamuj u chatu! 🙏`);
            state.lastWarned[userKey] = sada;
            log('WARN', `Anti-spam: upozoren ${username} (${countRapid}x brze poruke)`);
        } else {
            log('WARN', `Anti-spam: preskočeno duplirano upozorenje za ${username}`);
        }
        return true;
    }

    if (countRapid > config.RAPID_MSG_THRESHOLD) {
        log('WARN', `Anti-spam: blokirano od ${username} (${countRapid}x brze poruke)`);
        return true;
    }

    return false;
}

module.exports = {
    spamFilter
};
