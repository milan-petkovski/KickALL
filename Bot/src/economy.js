const state = require('./state');
const config = require('./config');
const { sanitizeInput, isValidUsername } = require('./utils');
const { posaljiPoruku } = require('./messenger');

// ─── MATEMATIKA NIVOA I XP-A ─────────────────────────────────────────────────
// Level N = floor(0.1 * sqrt(XP))  =>  XP za Nivo N = (N / 0.1)^2 = 100 * N^2
function izracunajNivo(xp) {
    if (!xp || xp < 0) return 0;
    return Math.floor(0.1 * Math.sqrt(xp));
}

function xpZaNivo(nivo) {
    if (nivo <= 0) return 0;
    return Math.pow(nivo / 0.1, 2);
}

function dobijTitulu(nivo) {
    if (nivo < 5)  return 'Pijun 👶';
    if (nivo < 10) return 'Redovan Gledalac 📺';
    if (nivo < 20) return 'Čet Majstor 💬';
    if (nivo < 35) return 'VIP Gledalac ⭐';
    if (nivo < 50) return 'Kralj Četa 👑';
    return 'Legenda 🚀🔥';
}

function dobijNazivValute(channelState) {
    return (channelState && channelState.currency_name) ? channelState.currency_name : 'KickCoins';
}

// ─── HELPER: Dohvati ili kreiraj economy unos za korisnika ───────────────────
function dohvatiIliKreirajEkonomiju(channelState, key, displayName) {
    if (!channelState.economy[key]) {
        channelState.economy[key] = {
            username:         displayName || key,
            xp:               0,
            level:            0,
            coins:            0,
            daily_claimed_at: 0,
            daily_streak:     0
        };
    }
    return channelState.economy[key];
}

// ─── HELPER: Oznaci korisnika kao dirty i zaplanuj save ──────────────────────
function oznakiKaoPromenjenIZaplanujSave(channelState, chatroomId, key) {
    channelState.economyDirty = true;
    channelState.economyDeltas.add(key);

    if (!channelState.economySaveTimer) {
        channelState.economySaveTimer = setTimeout(async () => {
            try {
                const { sacuvajEkonomiju } = require('./database');
                await sacuvajEkonomiju(chatroomId);
            } catch (e) {
                // Greška pri planiranom čuvanju ekonomije
            }
            channelState.economySaveTimer = null;
        }, config.ECONOMY_SAVE_INTERVAL_MS);
        if (channelState.economySaveTimer && typeof channelState.economySaveTimer.unref === 'function') {
            channelState.economySaveTimer.unref();
        }
    }
}

// ─── DODELA XP-A I COINSA ────────────────────────────────────────────────────
function dodajXP(chatroomId, username, xpBonus = 15, pointsBonus = 5, isSub = false, messageText = '') {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const cleanUsername = sanitizeInput(username);
    const key = cleanUsername.toLowerCase();

    // Smart Anti-Spam Validation
    if (messageText && channelState.smart_chat_validation !== false) {
        const trimmed = messageText.trim();
        if (trimmed.length < 2) return;
        if (/^(.)\1+$/.test(trimmed)) return;
    }

    const user = dohvatiIliKreirajEkonomiju(channelState, key, cleanUsername);
    user.username = cleanUsername;

    const isNewUser = user.xp === 0 && user.coins === 0;

    // Prva Interakcija Bonus
    if (isNewUser) {
        const firstBonus = channelState.first_interaction_bonus !== undefined ? channelState.first_interaction_bonus : 100;
        if (firstBonus > 0) {
            user.coins = (user.coins || 0) + firstBonus;
        }
    }

    // Subscriber Multiplikator
    let finalXP = xpBonus;
    let finalCoins = pointsBonus;

    if (isSub) {
        const mult = channelState.sub_multiplier !== undefined ? parseFloat(channelState.sub_multiplier) : 2.0;
        finalXP    = Math.floor(finalXP * mult);
        finalCoins = Math.floor(finalCoins * mult) + (channelState.sub_bonus_per_msg || 10);
    }

    const stariNivo = user.level || izracunajNivo(user.xp);
    user.xp    = (user.xp || 0) + finalXP;
    user.coins = (user.coins || 0) + finalCoins;
    const noviNivo = izracunajNivo(user.xp);
    user.level = noviNivo;

    // Detekcija Level Up-a
    if (noviNivo > stariNivo) {
        const bonusCoins = noviNivo * 50;
        user.coins += bonusCoins;
        const valuta = dobijNazivValute(channelState);
        const titula = dobijTitulu(noviNivo);

        if (channelState.level_up_announce !== false) {
            posaljiPoruku(chatroomId, `🎉 LEVEL UP! @${cleanUsername} je skočio na Level ${noviNivo} (${titula})! Dobio je +${bonusCoins} ${valuta} bonus! 🚀`);
        }
    }

    oznakiKaoPromenjenIZaplanujSave(channelState, chatroomId, key);
}

// ─── POSEBNI REWARD TRIGERI ──────────────────────────────────────────────────
function dodajSubBonus(chatroomId, username) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const bonus = channelState.points_per_sub !== undefined ? channelState.points_per_sub : 1000;
    if (bonus <= 0) return;
    dodajXP(chatroomId, username, 200, bonus, true);
    const valuta = dobijNazivValute(channelState);
    posaljiPoruku(chatroomId, `⭐ Hvala na pretplati @${username}! Osvojio si +${bonus.toLocaleString()} ${valuta} i sub bonus multiplikator! 🎉`);
}

function dodajGiftSubBonus(chatroomId, sender, count = 1) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const perSub = channelState.points_per_gift_sub !== undefined ? channelState.points_per_gift_sub : 2000;
    const ukupno = perSub * Math.max(1, count);
    dodajXP(chatroomId, sender, 300 * count, ukupno, true);
    const valuta = dobijNazivValute(channelState);
    posaljiPoruku(chatroomId, `🎁 LEGENDARNO! @${sender} je poklonio ${count} Sub-ova i osvojio +${ukupno.toLocaleString()} ${valuta}! 🔥👑`);
}

function dodajKickDonationBonus(chatroomId, sender, kicksAmount = 100) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const rate = channelState.points_per_100_kicks !== undefined ? channelState.points_per_100_kicks : 500;
    const ukupno = Math.floor((kicksAmount / 100) * rate);
    if (ukupno <= 0) return;
    dodajXP(chatroomId, sender, Math.floor(kicksAmount / 2), ukupno);
    const valuta = dobijNazivValute(channelState);
    posaljiPoruku(chatroomId, `⚡ @${sender} je donirao ${kicksAmount} KICKs i osvojio +${ukupno.toLocaleString()} ${valuta}! 🚀`);
}

// ─── KOMANDA: !rank / !level / !xp ───────────────────────────────────────────
function handleRank(chatroomId, sender, targetRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const target = targetRaw ? targetRaw.split(/\s+/)[0].replace(/^@/, '').trim() : '';
    let user = sender;
    if (target && isValidUsername(target)) {
        user = sanitizeInput(target);
    } else if (target) {
        posaljiPoruku(chatroomId, `❌ Nevalidno korisničko ime.`);
        return;
    }

    const key = user.toLowerCase();
    const podaci = channelState.economy[key];

    if (!podaci || (podaci.xp === 0 && podaci.coins === 0)) {
        posaljiPoruku(chatroomId, `⭐ @${user} još uvek nema zabeleženog XP-a na ovom kanalu.`);
        return;
    }

    const xp     = podaci.xp || 0;
    const nivo   = podaci.level || izracunajNivo(xp);
    const titula = dobijTitulu(nivo);
    const coins  = podaci.coins || 0;
    const valuta = dobijNazivValute(channelState);

    const tekucaGranica    = xpZaNivo(nivo);
    const sledecaGranica   = xpZaNivo(nivo + 1);
    const potrebnoZaSledeci = sledecaGranica - tekucaGranica;
    const napredak         = xp - tekucaGranica;
    const procenat = potrebnoZaSledeci > 0 ? Math.min(100, Math.floor((napredak / potrebnoZaSledeci) * 100)) : 100;

    // Rang po XP-u
    const sortirani = Object.values(channelState.economy)
        .sort((a, b) => (b.xp || 0) - (a.xp || 0));
    const rangIdx = sortirani.findIndex(x => (x.username || '').toLowerCase() === key);
    const rangStr = rangIdx !== -1 ? `#${rangIdx + 1}` : 'N/A';

    posaljiPoruku(chatroomId, `⭐ @${user} | Nivo: ${nivo} (${titula}) | XP: ${xp.toLocaleString()} (${procenat}% do Lvl ${nivo + 1}) | 🪙 ${coins.toLocaleString()} ${valuta} | Rang: ${rangStr}`);
}

// ─── KOMANDA: !points / !poeni / !bal ────────────────────────────────────────
function handlePoints(chatroomId, sender, targetRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const target = targetRaw ? targetRaw.split(/\s+/)[0].replace(/^@/, '').trim() : '';
    let user = sender;
    if (target && isValidUsername(target)) {
        user = sanitizeInput(target);
    } else if (target) {
        posaljiPoruku(chatroomId, `❌ Nevalidno korisničko ime.`);
        return;
    }

    const key    = user.toLowerCase();
    const podaci = channelState.economy[key];
    const coins  = podaci ? (podaci.coins || 0) : 0;
    const valuta = dobijNazivValute(channelState);

    posaljiPoruku(chatroomId, `🪙 @${user} trenutno ima ${coins.toLocaleString()} ${valuta}!`);
}

// ─── KOMANDA: !daily ─────────────────────────────────────────────────────────
function handleDaily(chatroomId, sender) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    if (!isValidUsername(sender)) return;
    const clean = sanitizeInput(sender);
    const key   = clean.toLowerCase();

    const user = dohvatiIliKreirajEkonomiju(channelState, key, clean);
    const sada = Date.now();
    const zadnjiDaily   = user.daily_claimed_at || 0;
    const razlikaSati   = (sada - zadnjiDaily) / (1000 * 60 * 60);

    if (razlikaSati < 24) {
        const preostaloSati = Math.ceil(24 - razlikaSati);
        posaljiPoruku(chatroomId, `⏳ @${clean}, već si preuzeo dnevni bonus! Možeš ponovo za ${preostaloSati}h.`);
        return;
    }

    // Strik bonus (ako je uzeo unutar 48 sati)
    let strik = user.daily_streak || 0;
    if (razlikaSati <= 48) {
        strik += 1;
    } else {
        strik = 1;
    }

    const bazniCoins  = 250;
    const bazniXP     = 100;
    const strikBonus  = Math.min(strik * 50, 500);
    const ukupnoCoins = bazniCoins + strikBonus;
    const ukupnoXP    = bazniXP + Math.floor(strikBonus / 2);

    user.daily_claimed_at = sada;
    user.daily_streak     = strik;

    const stariNivo = user.level || izracunajNivo(user.xp);
    user.xp    = (user.xp || 0) + ukupnoXP;
    user.coins = (user.coins || 0) + ukupnoCoins;
    user.level = izracunajNivo(user.xp);
    if (user.level > stariNivo && channelState.level_up_announce !== false) {
        const titula = dobijTitulu(user.level);
        const bonusCoins = user.level * 50;
        user.coins += bonusCoins;
        const valuta = dobijNazivValute(channelState);
        posaljiPoruku(chatroomId, `🎉 LEVEL UP! @${clean} je skočio na Level ${user.level} (${titula})! +${bonusCoins} ${valuta} bonus! 🚀`);
    }

    oznakiKaoPromenjenIZaplanujSave(channelState, chatroomId, key);

    const valuta = dobijNazivValute(channelState);
    posaljiPoruku(chatroomId, `🎁 @${clean} je preuzeo dnevni bonus: +${ukupnoCoins} ${valuta} i +${ukupnoXP} XP! (Streak: ${strik} dan/a 🔥)`);
}

// ─── KOMANDA: !givepoints / !dajpoene ────────────────────────────────────────
function handleGivePoints(chatroomId, sender, targetRaw, amountRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const target = targetRaw ? targetRaw.split(/\s+/)[0].replace(/^@/, '').trim() : '';
    if (!target || !isValidUsername(target)) {
        posaljiPoruku(chatroomId, `❌ Upotreba: !givepoints @korisnik <iznos>`);
        return;
    }

    const cleanSender = sanitizeInput(sender);
    const cleanTarget = sanitizeInput(target);
    const senderKey   = cleanSender.toLowerCase();
    const targetKey   = cleanTarget.toLowerCase();

    if (senderKey === targetKey) {
        posaljiPoruku(chatroomId, `😂 Ne možeš poslati poene samom sebi!`);
        return;
    }

    const iznos = parseInt(amountRaw, 10);
    if (isNaN(iznos) || iznos <= 0) {
        posaljiPoruku(chatroomId, `❌ Iznos mora biti pozitivan broj!`);
        return;
    }

    const senderEconomy = channelState.economy[senderKey];
    const senderCoins   = senderEconomy ? (senderEconomy.coins || 0) : 0;

    if (senderCoins < iznos) {
        const valuta = dobijNazivValute(channelState);
        posaljiPoruku(chatroomId, `❌ @${cleanSender}, nemaš dovoljno poena! Tvoj balans je: ${senderCoins} ${valuta}.`);
        return;
    }

    // Oduzmi poslaocu
    senderEconomy.coins -= iznos;
    oznakiKaoPromenjenIZaplanujSave(channelState, chatroomId, senderKey);

    // Dodaj primaocu
    const targetEconomy = dohvatiIliKreirajEkonomiju(channelState, targetKey, cleanTarget);
    targetEconomy.coins = (targetEconomy.coins || 0) + iznos;
    oznakiKaoPromenjenIZaplanujSave(channelState, chatroomId, targetKey);

    const valuta = dobijNazivValute(channelState);
    posaljiPoruku(chatroomId, `💸 @${cleanSender} je uspešno prebacio ${iznos.toLocaleString()} ${valuta} korisniku @${cleanTarget}!`);
}

// ─── KOMANDA: !toplevel ──────────────────────────────────────────────────────
function handleTopLevel(chatroomId, limitRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    let limit = 5;
    if (limitRaw) {
        const parsed = parseInt(limitRaw, 10);
        if (!isNaN(parsed) && parsed > 0) limit = Math.min(10, parsed);
    }

    const sortirani = Object.values(channelState.economy)
        .sort((a, b) => (b.xp || 0) - (a.xp || 0))
        .filter(x => (x.xp || 0) > 0);

    if (sortirani.length === 0) {
        posaljiPoruku(chatroomId, `⭐ Još nema aktivnih nivoa na ovom kanalu!`);
        return;
    }

    const lista = sortirani.slice(0, limit)
        .map((x, idx) => `${idx + 1}. @${x.username} (Lvl ${x.level || izracunajNivo(x.xp)} - ${(x.xp || 0).toLocaleString()} XP)`)
        .join(', ');

    posaljiPoruku(chatroomId, `🏆 Top ${limit} Nivoi: ${lista}`);
}

// ─── KOMANDA: !topcoins ──────────────────────────────────────────────────────
function handleTopCoins(chatroomId, limitRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    let limit = 5;
    if (limitRaw) {
        const parsed = parseInt(limitRaw, 10);
        if (!isNaN(parsed) && parsed > 0) limit = Math.min(10, parsed);
    }

    const valuta    = dobijNazivValute(channelState);
    const sortirani = Object.values(channelState.economy)
        .sort((a, b) => (b.coins || 0) - (a.coins || 0))
        .filter(x => (x.coins || 0) > 0);

    if (sortirani.length === 0) {
        posaljiPoruku(chatroomId, `🪙 Još niko nema sakupljenih ${valuta}!`);
        return;
    }

    const lista = sortirani.slice(0, limit)
        .map((x, idx) => `${idx + 1}. @${x.username} (${(x.coins || 0).toLocaleString()} ${valuta})`)
        .join(', ');

    posaljiPoruku(chatroomId, `🪙 Top ${limit} Najbogatiji (${valuta}): ${lista}`);
}

module.exports = {
    izracunajNivo,
    xpZaNivo,
    dobijTitulu,
    dobijNazivValute,
    dodajXP,
    dodajSubBonus,
    dodajGiftSubBonus,
    dodajKickDonationBonus,
    handleRank,
    handlePoints,
    handleDaily,
    handleGivePoints,
    handleTopLevel,
    handleTopCoins
};
