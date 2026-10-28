const config = require('./config');
const state = require('./state');
const { log } = require('./utils');
const { smanjiPoruku } = require('./database');
const { posaljiPoruku, banujKorisnika, obrisiPoruku } = require('./messenger');
const moderationAudit = require('./moderationAudit');

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

// 100% nepobitne fraze, komercijalni šabloni i servisi koje koriste isključivo spam/viewbot botovi
// NIKADA ne stavljati opšte pozdrave ili komplimente (npr. "have a great stream", "keep grinding")
// kako se ni pod kojim uslovima ne bi banovao pravi čovek koji se pristojno javlja u četu.
const HARD_BOT_PROMO_REGEX = /\b(typical\s*panels|save\s*99%|buy\s*(followers|viewers|chatters)|cheap\s*(viewers|chatters|followers|bots)|kickbotting|ownkick|kickview|kivasmm|pay\s*only\s*for\s*what\s*you\s*use|free\s*trial\s*available|chatters\s*with\s*custom|kick\s*viewbot|viewbot[,\s]+follower\s*bot|make\s*your\s*(stream|broadcast|channel)\s*fire\s*with|take\s*your\s*(broadcast|stream|channel)\s*to\s*the\s*next\s*level\s*with|zero-?cost\s*perks\s*for\s*supporters|daily\s*(reward\s*)?drops\s*on\s*the\s*house|complimentary\s*reward\s*events|(stream|chat|channel)\s*stays\s*(buzzing|alive|active)\s*(24\/7|around\s*the\s*clock)|automate\s*your\s*stream\s*traffic|continuous\s*viewer\s*flow|dedicated\s*active\s*chat\s*tools|boost\s*your\s*(overall\s*)?channel\s*visibility|audience\s*engagement\s*with\s*cutting-?edge\s*automation)\b/i;

// AI-powered promo šablon sa cenzurisanim rečima (npr. Kick cenzuriše "viewbots" u "********")
const AI_POWERED_PROMO_REGEX = /\bwith\s+ai-?powered\s+(\*{3,}|[a-z]+)\s+(and\s+zero-?cost|community\s+growth|new\s+supporters|viewers|chatters|followers|highlight)/i;

// Spaced-out SMM domen u navodnicima (npr. "kivasmm com" ili "k iv a smm com")
const QUOTED_SPACED_DOMAIN_REGEX = /"[^"]{0,30}\b(smm|kiva|panel|kickview|ownkick)\b[^"]{0,30}\s+(com|net|org|io|gg|xyz|ru|live|store|club|app|dev)"/i;

// Generički termini za botove koji se kažnjavaju SAMO ako poruka sadrži komercijalne/reklamne reči ili link ka servisu
const GENERIC_BOT_REGEX = /\b(viewbot|view-bot|viewer\s*bot|follower\s*bot|chat\s*bot)\b/i;
const PROMO_INDICATOR_REGEX = /\b(cheap|reliable|automated|24\/7|order|discount|deal|packages?|instant|pricing|panel|trial|fast|best\s*service|usd|eur|fees?|billed|no\s*fees|minutes\s*you\s*use|\$|\%)\b|https?:\/\/|[a-z0-9-]+\.(com|net|org|io|gg|xyz|ru|live|store|club|app|dev)/i;
const SPAM_DOMAIN_PATTERN = /\b([a-zA-Z0-9-]{3,}\.)+(com|net|org|io|gg|xyz|site|ru|top|live|store|club|app|tv|me|info)\b/i;
const COLLAPSED_BOT_SERVICES_REGEX = /(kivasmm|ownkick|kickview|kickbotting|smmpanel)/i;
const COLLAPSED_SMM_DOMAIN_REGEX = /[a-z0-9]{2,}smm(com|net|org|io|gg|xyz|live|store|app)/i;

function hasBotAffiliateHexTag(norm) {
    // Mora imati i eksplicitan promo kontekst (npr. smm, fire with, next level with, panel)
    // kako se ne bi desio false-positive ako običan korisnik taguje prijatelja sa kratkim hex imenom (npr. @a1b2c3)
    const hasPromoContext = /\b(smm|fire\s*with|next\s*level\s*with|kiva|panel|viewbot|traffic|continuous\s*viewer)\b/i.test(norm);
    if (!hasPromoContext) return false;

    const hexTagMatches = norm.match(/@([0-9a-f]{6})\b/gi);
    if (!hexTagMatches) return false;
    return hexTagMatches.some(tag => {
        const hex = tag.slice(1);
        return /[0-9]/.test(hex) && /[a-f]/i.test(hex);
    });
}

function daLiJeBotSpam(poruka) {
    if (!poruka || typeof poruka !== 'string') return false;
    // Zaštita od ReDoS i nepotrebne obrade: Kick poruke su ograničene na 500 karaktera
    if (poruka.length > 1000) poruka = poruka.slice(0, 1000);
    const norm = normalizujZaPoredjenje(poruka);
    const despaced = despaceText(norm);
    const collapsed = norm.replace(/[^a-z0-9]/g, '');

    if (COLLAPSED_BOT_SERVICES_REGEX.test(collapsed)) return true;
    if (COLLAPSED_SMM_DOMAIN_REGEX.test(collapsed) && /\b(stream|broadcast|channel|fire|level|boost|take|make)\b/i.test(norm)) {
        return true;
    }

    if (HARD_BOT_PROMO_REGEX.test(poruka) || HARD_BOT_PROMO_REGEX.test(norm) || HARD_BOT_PROMO_REGEX.test(despaced)) {
        return true;
    }
    if (AI_POWERED_PROMO_REGEX.test(poruka) || AI_POWERED_PROMO_REGEX.test(norm)) {
        return true;
    }
    if (QUOTED_SPACED_DOMAIN_REGEX.test(poruka) || QUOTED_SPACED_DOMAIN_REGEX.test(norm)) {
        return true;
    }
    if (hasBotAffiliateHexTag(norm)) {
        return true;
    }

    // Ako spominje viewbot/follower bot/chat bot, banuj samo ako ima komercijalni/reklamni kontekst
    const mentionsBot = GENERIC_BOT_REGEX.test(poruka) || GENERIC_BOT_REGEX.test(despaced);
    if (mentionsBot) {
        if (PROMO_INDICATOR_REGEX.test(poruka) || PROMO_INDICATOR_REGEX.test(despaced)) {
            return true;
        }
    }

    if (SPAM_DOMAIN_PATTERN.test(despaced) && /\b(kick|bot|panel|view|follow|cheap|save|ownkick|smm|stream|broadcast)\b/i.test(despaced)) {
        return true;
    }
    return false;
}

function spamFilter(chatroomId, username, poruka, senderObj = null, messageId = null) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return false;

    const sada  = Date.now();
    const userKey = username.toLowerCase();

    // Moderatori, strimer, VIP, Sub i OG korisnici su izuzeti iz filtera
    const identity = senderObj && senderObj.identity ? senderObj.identity : {};
    const badges = identity.badges || (Array.isArray(senderObj?.badges) ? senderObj.badges : (senderObj?.sender?.identity?.badges || []));
    const isTrusted = badges.some(b => b.type === 'moderator' || b.type === 'broadcaster' || b.type === 'vip' || b.type === 'og' || b.type === 'subscriber' || b.type === 'sub') ||
                      userKey === (channelState.channelUsername || '').toLowerCase();

    // ── 0. Provera viewbot / promo spam botova ────────────────────────────────
    const jeKomanda = poruka.startsWith(channelState.PREFIX || '!') || poruka.startsWith('!');
    if (!jeKomanda && !isTrusted && daLiJeBotSpam(poruka)) {
        const dryRun = moderationAudit.jeDryRun(channelState);
        moderationAudit.zabelezi(chatroomId, {
            action: 'ban', username, reason: 'Nedozvoljen bot / promo spam', message: poruka, source: 'spam', dryRun
        });
        if (dryRun) {
            log('MOD', `[${channelState.channelUsername || chatroomId}] [DRY-RUN] Bio bi banovan ${username} (viewbot/reklama): "${poruka}"`);
            return false;
        }
        log('WARN', `[${channelState.channelUsername || chatroomId}] Anti-spam [viewbot/reklama]: blokirano i banovano od ${username}: "${poruka}"`);
        if (!channelState.bannedUsers) channelState.bannedUsers = new Set();
        channelState.bannedUsers.add(userKey);

        if (messageId) obrisiPoruku(chatroomId, messageId);
        if (channelState.recentUserMessages && channelState.recentUserMessages.has(userKey)) {
            for (const recentMsg of channelState.recentUserMessages.get(userKey)) {
                if (recentMsg.id && recentMsg.id !== messageId) {
                    obrisiPoruku(chatroomId, recentMsg.id);
                }
            }
            channelState.recentUserMessages.delete(userKey);
        }

        const userId = senderObj?.id || senderObj?.user_id || null;
        banujKorisnika(chatroomId, username, 'Nedozvoljen bot / promo spam', userId).then((ok) => {
            if (ok) {
                posaljiPoruku(chatroomId, `[MOD] @${username} je trajno banovan.`);
            }
        }).catch(() => {});
        return true;
    }

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
    daLiJeBotSpam,
    normalizujZaPoredjenje,
    despaceText
};
