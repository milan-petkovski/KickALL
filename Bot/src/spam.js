const config = require('./config');
const state = require('./state');
const { log } = require('./utils');
const { smanjiPoruku } = require('./database');
const { posaljiPoruku } = require('./messenger');

function spamFilter(chatroomId, username, poruka) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return false;

    const sada  = Date.now();
    const userKey = username.toLowerCase();
    
    // ── 1. Provera identičnih poruka ──────────────────────────────────────────
    const kljucIdenticna = `${userKey}::${poruka.trim().toLowerCase()}`;
    if (!channelState.spamTracker[kljucIdenticna]) channelState.spamTracker[kljucIdenticna] = [];
    const windowIdenticnaTime = channelState.SPAM_WINDOW_MS !== undefined ? channelState.SPAM_WINDOW_MS : config.SPAM_WINDOW_MS;
    channelState.spamTracker[kljucIdenticna] = channelState.spamTracker[kljucIdenticna].filter(t => sada - t < windowIdenticnaTime);
    channelState.spamTracker[kljucIdenticna].push(sada);
    const countIdenticna = channelState.spamTracker[kljucIdenticna].length;

    // ── 2. Provera brzog kucanja (bilo kojih poruka) ──────────────────────────
    if (!channelState.rapidTracker[userKey]) channelState.rapidTracker[userKey] = [];
    channelState.rapidTracker[userKey] = channelState.rapidTracker[userKey].filter(t => sada - t < config.RAPID_MSG_WINDOW_MS);
    channelState.rapidTracker[userKey].push(sada);
    const countRapid = channelState.rapidTracker[userKey].length;

    const zadnjeUpozorenje = channelState.lastWarned[userKey] || 0;
    const limitIdenticna = channelState.SPAM_THRESHOLD !== undefined ? channelState.SPAM_THRESHOLD : config.SPAM_THRESHOLD;
    const windowIdenticna = channelState.SPAM_WINDOW_MS !== undefined ? channelState.SPAM_WINDOW_MS : config.SPAM_WINDOW_MS;

    // Ako je dostignut limit za identične poruke
    if (countIdenticna === limitIdenticna) {
        const zadnjiSpam = channelState.lastSpamPenalty[userKey] || 0;
        if (sada - zadnjiSpam >= config.SPAM_PENALTY_COOLDOWN_MS) {
            if (!poruka.startsWith(channelState.PREFIX || '!')) {
                smanjiPoruku(chatroomId, username, 1);
                channelState.porukePosleAnnounce = Math.max(0, channelState.porukePosleAnnounce - 1);
            }
            channelState.lastSpamPenalty[userKey] = sada;
        }

        if (sada - zadnjeUpozorenje > windowIdenticna) {
            posaljiPoruku(chatroomId, `@${username} molim te ne spamuj u chatu! 🙏`);
            channelState.lastWarned[userKey] = sada;
            log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam: upozoren ${username} (${countIdenticna}x ista poruka)`);
        } else {
            log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam: preskočeno duplirano upozorenje za ${username}`);
        }
        return true;
    }

    if (countIdenticna > limitIdenticna) {
        log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam: blokirano od ${username} (${countIdenticna}x ista poruka)`);
        return true;
    }

    // Ako je dostignut limit za brzo kucanje (bilo koje poruke)
    if (countRapid === config.RAPID_MSG_THRESHOLD) {
        const zadnjiSpam = channelState.lastSpamPenalty[userKey] || 0;
        if (sada - zadnjiSpam >= config.SPAM_PENALTY_COOLDOWN_MS) {
            if (!poruka.startsWith(channelState.PREFIX || '!')) {
                smanjiPoruku(chatroomId, username, 1);
                channelState.porukePosleAnnounce = Math.max(0, channelState.porukePosleAnnounce - 1);
            }
            channelState.lastSpamPenalty[userKey] = sada;
        }

        if (sada - zadnjeUpozorenje > windowIdenticna) {
            posaljiPoruku(chatroomId, `@${username} molim te ne spamuj u chatu! 🙏`);
            channelState.lastWarned[userKey] = sada;
            log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam: upozoren ${username} (${countRapid}x brze poruke)`);
        } else {
            log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam: preskočeno duplirano upozorenje za ${username}`);
        }
        return true;
    }

    if (countRapid > config.RAPID_MSG_THRESHOLD) {
        log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam: blokirano od ${username} (${countRapid}x brze poruke)`);
        return true;
    }

    return false;
}

module.exports = {
    spamFilter
};
