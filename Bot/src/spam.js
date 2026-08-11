const config = require('./config');
const state = require('./state');
const { log } = require('./utils');
const { smanjiPoruku } = require('./database');
const { posaljiPoruku } = require('./messenger');

// Nevidljivi/zero-width unicode karakteri koje spam-raid nalozi koriste da bi
// "identičnu" poruku učinili tehnički drugačijom (drugačiji hash/string) i tako
// zaobišli detekciju duplikata. Uklanjamo ih pre poređenja.
// U200B-U200D: zero-width space/non-joiner/joiner, U200E-U200F: LTR/RTL mark,
// UFEFF: zero-width no-break space (BOM), U2060-U2064: word joiner i slično,
// U00AD: soft hyphen, U061C: Arabic letter mark.
const NEVIDLJIVI_KARAKTERI_REGEX = /[\u200B-\u200F\uFEFF\u2060-\u2064\u00AD\u061C]/g;

function normalizujZaPoredjenje(poruka) {
    return poruka
        .normalize('NFKC')
        .replace(NEVIDLJIVI_KARAKTERI_REGEX, '')
        .trim()
        .toLowerCase();
}

function spamFilter(chatroomId, username, poruka) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return false;

    const sada  = Date.now();
    const userKey = username.toLowerCase();
    
    // ── 1. Provera identičnih poruka ──────────────────────────────────────────
    // Normalizujemo (skidamo zero-width karaktere) da bi "ista poruka + nevidljivi
    // karakter na kraju" i dalje bila prepoznata kao duplikat.
    const kljucIdenticna = `${userKey}::${normalizujZaPoredjenje(poruka)}`;
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
            log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam [identična poruka]: upozoren ${username} (${countIdenticna}x ista poruka)`);
        } else {
            log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam [identična poruka]: preskočeno duplirano upozorenje za ${username}`);
        }
        return true;
    }

    if (countIdenticna > limitIdenticna) {
        log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam [identična poruka]: blokirano od ${username} (${countIdenticna}x ista poruka)`);
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
            log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam [brzo kucanje]: upozoren ${username} (${countRapid}x brze poruke)`);
        } else {
            log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam [brzo kucanje]: preskočeno duplirano upozorenje za ${username}`);
        }
        return true;
    }

    if (countRapid > config.RAPID_MSG_THRESHOLD) {
        log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam [brzo kucanje]: blokirano od ${username} (${countRapid}x brze poruke)`);
        return true;
    }

    return false;
}

module.exports = {
    spamFilter,
    normalizujZaPoredjenje
};
