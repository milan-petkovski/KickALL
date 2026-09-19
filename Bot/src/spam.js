const config = require('./config');
const state = require('./state');
const { log } = require('./utils');
const { smanjiPoruku } = require('./database');
const { posaljiPoruku, banujKorisnika } = require('./messenger');

// Nevidljivi/zero-width unicode karakteri i bidi override oznake koje spam-raid nalozi koriste
// da bi "identičnu" poruku učinili tehnički drugačijom i tako zaobišli detekciju duplikata.
// U200B-U200D: zero-width space/non-joiner/joiner, U200E-U200F: LTR/RTL mark,
// U202A-U202E: Bidi embedding i directional override (LRE, RLE, PDF, LRO, RLO),
// U2060-U206F: word joiner, invisible operators, bidi isolates (LRI, RLI, FSI, PDI),
// UFE00-UFE0F: variation selectors, UFEFF: zero-width no-break space (BOM),
// U00AD: soft hyphen, U061C: Arabic letter mark, U180E: Mongolian vowel separator.
const NEVIDLJIVI_KARAKTERI_REGEX = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF\u00AD\u061C\u180E]/g;

function normalizujZaPoredjenje(poruka) {
    return poruka
        .normalize('NFKC')
        .replace(NEVIDLJIVI_KARAKTERI_REGEX, '')
        .trim()
        .toLowerCase();
}

function despaceText(tekst) {
    if (!tekst) return '';
    return tekst
        .replace(/\b([a-zA-Z0-9])\s+(?=[a-zA-Z0-9]\b)/g, '$1')
        .replace(/\s*([./])\s*/g, '$1');
}

const BOT_SPAM_REGEX = /\b(viewbot|view-bot|viewer\s*bot|follower\s*bot|chat\s*bot|typical\s*panels|save\s*99%|buy\s*followers|kickbotting|ownkick|kickview|cheap\s*viewers|cheap\s*chatters|chatters\s*with\s*custom|pay\s*only\s*for\s*what\s*you\s*use|free\s*trial\s*available)\b/i;
const SPAM_DOMAIN_PATTERN = /\b([a-zA-Z0-9-]{3,}\.)+(com|net|org|io|gg|xyz|site|ru|top|live|store|club|app|tv|me|info)\b/i;

function daLiJeBotSpam(poruka) {
    if (!poruka) return false;
    if (BOT_SPAM_REGEX.test(poruka)) return true;
    const despaced = despaceText(poruka);
    if (BOT_SPAM_REGEX.test(despaced)) return true;
    if (SPAM_DOMAIN_PATTERN.test(despaced) && /\b(kick|bot|panel|view|follow|cheap|save|ownkick)\b/i.test(despaced)) {
        return true;
    }
    return false;
}

function spamFilter(chatroomId, username, poruka, senderObj = null) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return false;

    const sada  = Date.now();
    const userKey = username.toLowerCase();
    
    // ── 0. Provera viewbot / promo spam botova ────────────────────────────────
    const jeKomanda = poruka.startsWith(channelState.PREFIX || '!') || poruka.startsWith('!');
    if (!jeKomanda && daLiJeBotSpam(poruka)) {
        log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam [viewbot/reklama]: blokirano i banovano od ${username}: "${poruka}"`);
        if (!channelState.bannedUsers) channelState.bannedUsers = new Set();
        channelState.bannedUsers.add(userKey);
        const userId = senderObj?.id || senderObj?.user_id || null;
        banujKorisnika(chatroomId, username, 'Nedozvoljen bot / promo spam', userId).then((ok) => {
            if (ok) {
                posaljiPoruku(chatroomId, `[MOD] @${username} je trajno banovan.`);
            }
        }).catch(() => {});
        return true;
    }

    // Moderatori, strimer, VIP i OG korisnici su izuzeti iz filtera za identične poruke i brzo kucanje
    const identity = senderObj && senderObj.identity ? senderObj.identity : {};
    const badges = identity.badges || (Array.isArray(senderObj?.badges) ? senderObj.badges : (senderObj?.sender?.identity?.badges || []));
    const isExempt = badges.some(b => b.type === 'moderator' || b.type === 'broadcaster' || b.type === 'vip' || b.type === 'og') ||
                     userKey === (channelState.channelUsername || '').toLowerCase();
    if (isExempt) return false;
    
    // Provera da li je poruka kratka reakcija (hype, smeh, pojedinačni emote)
    const porukaTrim = poruka.trim();
    const isShortReaction = /^(w+|da+|ne+|l+|haha+|jaja+|xaxa+|lol+|gg+)$/i.test(porukaTrim) ||
                            porukaTrim.length <= 3 ||
                            /^(\[emote:\d+:[^\]]+\]\s*)+$/.test(porukaTrim);

    // ── 1. Provera identičnih poruka ──────────────────────────────────────────
    // Komande (poruke koje počinju sa prefiksom kanala ili '!') ne podležu proveri identičnih poruka
    // jer je legitimno da korisnici uzastopno igraju igre (npr. !rulet 0 5000, !tocak 5000)
    let countIdenticna = 0;
    if (!jeKomanda) {
        // Normalizujemo (skidamo zero-width karaktere) da bi "ista poruka + nevidljivi
        // karakter na kraju" i dalje bila prepoznata kao duplikat.
        const kljucIdenticna = `${userKey}::${normalizujZaPoredjenje(poruka)}`;
        if (!channelState.spamTracker[kljucIdenticna]) channelState.spamTracker[kljucIdenticna] = [];
        const windowIdenticnaTime = channelState.SPAM_WINDOW_MS !== undefined ? channelState.SPAM_WINDOW_MS : config.SPAM_WINDOW_MS;
        channelState.spamTracker[kljucIdenticna] = channelState.spamTracker[kljucIdenticna].filter(t => sada - t < windowIdenticnaTime);
        channelState.spamTracker[kljucIdenticna].push(sada);
        countIdenticna = channelState.spamTracker[kljucIdenticna].length;
    }

    // ── 2. Provera brzog kucanja (bilo kojih poruka) ──────────────────────────
    if (!channelState.rapidTracker[userKey]) channelState.rapidTracker[userKey] = [];
    channelState.rapidTracker[userKey] = channelState.rapidTracker[userKey].filter(t => sada - t < config.RAPID_MSG_WINDOW_MS);
    channelState.rapidTracker[userKey].push(sada);
    const countRapid = channelState.rapidTracker[userKey].length;

    const zadnjeUpozorenje = channelState.lastWarned[userKey] || 0;
    const baseLimitIdenticna = channelState.SPAM_THRESHOLD !== undefined ? channelState.SPAM_THRESHOLD : config.SPAM_THRESHOLD;
    const limitIdenticna = isShortReaction ? Math.max(baseLimitIdenticna, 5) : baseLimitIdenticna;
    const limitRapid = isShortReaction ? config.RAPID_MSG_THRESHOLD + 2 : config.RAPID_MSG_THRESHOLD;
    const windowIdenticna = channelState.SPAM_WINDOW_MS !== undefined ? channelState.SPAM_WINDOW_MS : config.SPAM_WINDOW_MS;

    // Ako je dostignut limit za identične poruke
    if (!jeKomanda && countIdenticna === limitIdenticna) {
        const zadnjiSpam = channelState.lastSpamPenalty[userKey] || 0;
        if (sada - zadnjiSpam >= config.SPAM_PENALTY_COOLDOWN_MS) {
            smanjiPoruku(chatroomId, username, 1);
            channelState.porukePosleAnnounce = Math.max(0, channelState.porukePosleAnnounce - 1);
            channelState.lastSpamPenalty[userKey] = sada;
        }

        const warningCooldown = Math.max(windowIdenticna, 60000);
        if (sada - zadnjeUpozorenje > warningCooldown) {
            posaljiPoruku(chatroomId, `@${username}, molim te ne spamuj u chatu!`);
            channelState.lastWarned[userKey] = sada;
            log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam [identična poruka]: upozoren ${username} (${countIdenticna}x ista poruka)`);
        } else {
            log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam [identična poruka]: preskočeno duplirano upozorenje za ${username}`);
        }
        return true;
    }

    if (!jeKomanda && countIdenticna > limitIdenticna) {
        log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam [identična poruka]: blokirano od ${username} (${countIdenticna}x ista poruka)`);
        return true;
    }

    // Ako je dostignut limit za brzo kucanje (bilo koje poruke)
    if (countRapid === limitRapid) {
        const zadnjiSpam = channelState.lastSpamPenalty[userKey] || 0;
        if (sada - zadnjiSpam >= config.SPAM_PENALTY_COOLDOWN_MS) {
            if (!jeKomanda) {
                smanjiPoruku(chatroomId, username, 1);
                channelState.porukePosleAnnounce = Math.max(0, channelState.porukePosleAnnounce - 1);
            }
            channelState.lastSpamPenalty[userKey] = sada;
        }

        const warningCooldown = Math.max(windowIdenticna, 60000);
        if (sada - zadnjeUpozorenje > warningCooldown) {
            posaljiPoruku(chatroomId, `@${username}, molim te ne spamuj u chatu!`);
            channelState.lastWarned[userKey] = sada;
            log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam [brzo kucanje]: upozoren ${username} (${countRapid}x brze poruke)`);
        } else {
            log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam [brzo kucanje]: preskočeno duplirano upozorenje za ${username}`);
        }
        return true;
    }

    if (countRapid > limitRapid) {
        log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam [brzo kucanje]: blokirano od ${username} (${countRapid}x brze poruke)`);
        return true;
    }

    return false;
}

module.exports = {
    spamFilter,
    normalizujZaPoredjenje,
    despaceText
};
