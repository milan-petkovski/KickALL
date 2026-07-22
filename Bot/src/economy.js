const state = require('./state');
const { log, sanitizeInput, isValidUsername } = require('./utils');
const { posaljiPoruku } = require('./messenger');

// ─── MATEMATIKA NIPOA I XP-A ─────────────────────────────────────────
// Level N = floor(0.1 * sqrt(XP))  =>  XP za Nivo N = (N / 0.1)^2 = 100 * N^2
function izracunajNivo(xp) {
    if (!xp || xp < 0) return 0;
    return Math.floor(0.1 * Math.sqrt(xp));
}

function xpZaNivo(nivo) {
    if (nivo <= 0) return 0;
    return Math.pow(nivo / 0.1, 2); // 100 * nivo^2
}

function dobijTitulu(nivo) {
    if (nivo < 5) return 'Pijun 👶';
    if (nivo < 10) return 'Redovan Gledalac 📺';
    if (nivo < 20) return 'Čet Majstor 💬';
    if (nivo < 35) return 'VIP Gledalac ⭐';
    if (nivo < 50) return 'Kralj Četa 👑';
    return 'Legenda 🚀🔥';
}

function dobijNazivValute(channelState) {
    return (channelState && channelState.currency_name) ? channelState.currency_name : 'KickCoins';
}

// ─── DODELE XP-A I POENA ─────────────────────────────────────────────
function dodajXP(chatroomId, username, xpBonus = 15, pointsBonus = 5, isSub = false, messageText = '') {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const cleanUsername = sanitizeInput(username);
    const key = cleanUsername.toLowerCase();
    const isNewUser = !channelState.leaderboard[key];

    // Smart Anti-Spam Validation
    if (messageText && channelState.smart_chat_validation !== false) {
        const trimmed = messageText.trim();
        if (trimmed.length < 2) return; // ignorisi prekratke poruke
        if (/^(.)\1+$/.test(trimmed)) return; // ignorisi ponavljanje istog karaktera
    }

    if (isNewUser) {
        channelState.leaderboard[key] = {
            username: cleanUsername,
            display_name: cleanUsername,
            count: 0,
            xp: 0,
            level: 0,
            points: 0
        };
    }

    const user = channelState.leaderboard[key];
    user.username = cleanUsername;

    // Prva Interakcija Bonus
    if (isNewUser) {
        const firstBonus = channelState.first_interaction_bonus !== undefined ? channelState.first_interaction_bonus : 100;
        if (firstBonus > 0) {
            user.points = (user.points || 0) + firstBonus;
        }
    }

    // Subscriber Multiplikator
    let finalXP = xpBonus;
    let finalPoints = pointsBonus;

    if (isSub) {
        const mult = channelState.sub_multiplier !== undefined ? parseFloat(channelState.sub_multiplier) : 2.0;
        finalXP = Math.floor(finalXP * mult);
        finalPoints = Math.floor(finalPoints * mult) + (channelState.sub_bonus_per_msg || 10);
    }

    user.xp = (user.xp || 0) + finalXP;
    user.points = (user.points || 0) + finalPoints;

    const stariNivo = user.level || izracunajNivo(user.xp - finalXP);
    const noviNivo = izracunajNivo(user.xp);

    user.level = noviNivo;
    channelState.leaderboardDeltas[key] = (channelState.leaderboardDeltas[key] || 0) + finalPoints;
    channelState.leaderboardDirty = true;

    // Detekcija Level Up-a
    if (noviNivo > stariNivo) {
        const bonusPoena = noviNivo * 50;
        user.points += bonusPoena;
        const valuta = dobijNazivValute(channelState);
        const titula = dobijTitulu(noviNivo);

        if (channelState.level_up_announce !== false) {
            posaljiPoruku(chatroomId, `🎉 LEVEL UP! @${cleanUsername} je skočio na **Level ${noviNivo}** (${titula})! Dobio je **+${bonusPoena} ${valuta}** bonus! 🚀`);
        }
    }
}

// ─── POSEBNI REWARD TRIGERI ──────────────────────────────────────────
function dodajSubBonus(chatroomId, username) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const bonus = channelState.points_per_sub !== undefined ? channelState.points_per_sub : 1000;
    if (bonus <= 0) return;
    dodajXP(chatroomId, username, 200, bonus, true);
    const valuta = dobijNazivValute(channelState);
    posaljiPoruku(chatroomId, `⭐ Hvala na pretplati @${username}! Osvojio si **+${bonus.toLocaleString()} ${valuta}** i sub bonus multiplikator! 🎉`);
}

function dodajGiftSubBonus(chatroomId, sender, count = 1) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const perSub = channelState.points_per_gift_sub !== undefined ? channelState.points_per_gift_sub : 2000;
    const ukupno = perSub * Math.max(1, count);
    dodajXP(chatroomId, sender, 300 * count, ukupno, true);
    const valuta = dobijNazivValute(channelState);
    posaljiPoruku(chatroomId, `🎁 LEGENDARNO! @${sender} je poklonio **${count} Sub-ova** i osvojio **+${ukupno.toLocaleString()} ${valuta}**! 🔥👑`);
}

function dodajKickDonationBonus(chatroomId, sender, kicksAmount = 100) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const rate = channelState.points_per_100_kicks !== undefined ? channelState.points_per_100_kicks : 500;
    const ukupno = Math.floor((kicksAmount / 100) * rate);
    if (ukupno <= 0) return;
    dodajXP(chatroomId, sender, Math.floor(kicksAmount / 2), ukupno);
    const valuta = dobijNazivValute(channelState);
    posaljiPoruku(chatroomId, `⚡ @${sender} je donirao **${kicksAmount} KICKs** i osvojio **+${ukupno.toLocaleString()} ${valuta}**! 🚀`);
}

// ─── KOMANDA: !rank / !level / !xp ──────────────────────────────────
function handleRank(chatroomId, sender, targetRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const target = targetRaw ? targetRaw.split(/\s+/)[0].replace(/^@/, '').trim() : '';
    let user = sender;
    if (target && isValidUsername(target)) {
        user = sanitizeInput(target);
    } else if (target) {
        posaljiPoruku(chatroomId, '❌ Nevalidno korisničko ime.');
        return;
    }

    const key = user.toLowerCase();
    const podaci = channelState.leaderboard[key];

    if (!podaci) {
        posaljiPoruku(chatroomId, `⭐ @${user} još uvek nema zabeleženog XP-a na ovom kanalu.`);
        return;
    }

    const xp = podaci.xp || 0;
    const nivo = podaci.level || izracunajNivo(xp);
    const titula = dobijTitulu(nivo);
    const poeni = podaci.points || 0;
    const valuta = dobijNazivValute(channelState);

    const tekucaGranica = xpZaNivo(nivo);
    const sledecaGranica = xpZaNivo(nivo + 1);
    const potrbnoZaSledeci = sledecaGranica - tekucaGranica;
    const napredak = xp - tekucaGranica;
    const procenat = potrbnoZaSledeci > 0 ? Math.min(100, Math.floor((napredak / potrbnoZaSledeci) * 100)) : 100;

    // Izračunaj poziciju na rang listi po XP-u
    const sortirani = Object.values(channelState.leaderboard)
        .sort((a, b) => (b.xp || 0) - (a.xp || 0));
    const rangIdx = sortirani.findIndex(x => (x.username || '').toLowerCase() === key);
    const rangStr = rangIdx !== -1 ? `#${rangIdx + 1}` : 'N/A';

    posaljiPoruku(chatroomId, `⭐ @${user} | Nivo: ${nivo} (${titula}) | XP: ${xp.toLocaleString()} (${procenat}% do Lvl ${nivo + 1}) | 🪙 ${poeni.toLocaleString()} ${valuta} | Rang: ${rangStr}`);
}

// ─── KOMANDA: !points / !poeni / !bal ──────────────────────────────
function handlePoints(chatroomId, sender, targetRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const target = targetRaw ? targetRaw.split(/\s+/)[0].replace(/^@/, '').trim() : '';
    let user = sender;
    if (target && isValidUsername(target)) {
        user = sanitizeInput(target);
    } else if (target) {
        posaljiPoruku(chatroomId, '❌ Nevalidno korisničko ime.');
        return;
    }

    const key = user.toLowerCase();
    const podaci = channelState.leaderboard[key];
    const poeni = podaci ? (podaci.points || 0) : 0;
    const valuta = dobijNazivValute(channelState);

    posaljiPoruku(chatroomId, `🪙 @${user} trenutno ima **${poeni.toLocaleString()} ${valuta}**!`);
}

// ─── KOMANDA: !daily ───────────────────────────────────────────────
function handleDaily(chatroomId, sender) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    if (!isValidUsername(sender)) return;
    const clean = sanitizeInput(sender);
    const key = clean.toLowerCase();

    if (!channelState.leaderboard[key]) {
        channelState.leaderboard[key] = { username: clean, count: 0, xp: 0, level: 0, points: 0 };
    }

    const user = channelState.leaderboard[key];
    const sada = Date.now();
    const ZADNJI_DAILY = user.daily_claimed_at || 0;
    const RAZLIKA_SATI = (sada - ZADNJI_DAILY) / (1000 * 60 * 60);

    if (RAZLIKA_SATI < 24) {
        const preostaloSati = Math.ceil(24 - RAZLIKA_SATI);
        posaljiPoruku(chatroomId, `⏳ @${clean}, već si preuzeo dnevni bonus! Možeš ponovo za **${preostaloSati}h**.`);
        return;
    }

    // Strik bonus (ako je uzeo unutar 48 sati)
    let strik = user.daily_streak || 0;
    if (RAZLIKA_SATI <= 48) {
        strik += 1;
    } else {
        strik = 1;
    }

    const bazniPoeni = 250;
    const bazniXP = 100;
    const strikBonus = Math.min(strik * 50, 500); // Max +500 strak bonus

    const ukupnoPoena = bazniPoeni + strikBonus;
    const ukupnoXP = bazniXP + Math.floor(strikBonus / 2);

    user.daily_claimed_at = sada;
    user.daily_streak = strik;

    dodajXP(chatroomId, clean, ukupnoXP, ukupnoPoena);
    const valuta = dobijNazivValute(channelState);

    posaljiPoruku(chatroomId, `🎁 @${clean} je preuzeo dnevni bonus: **+${ukupnoPoena} ${valuta}** i **+${ukupnoXP} XP**! (Strik: ${strik} dan/a 🔥)`);
}

// ─── KOMANDA: !givepoints / !dajpoene ─────────────────────────────
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
    const senderKey = cleanSender.toLowerCase();
    const targetKey = cleanTarget.toLowerCase();

    if (senderKey === targetKey) {
        posaljiPoruku(chatroomId, `😂 Ne možeš poslati poene samom sebi!`);
        return;
    }

    const iznos = parseInt(amountRaw, 10);
    if (isNaN(iznos) || iznos <= 0) {
        posaljiPoruku(chatroomId, `❌ Iznos mora biti pozitivan broj!`);
        return;
    }

    const senderData = channelState.leaderboard[senderKey];
    const senderPoeni = senderData ? (senderData.points || 0) : 0;

    if (senderPoeni < iznos) {
        const valuta = dobijNazivValute(channelState);
        posaljiPoruku(chatroomId, `❌ @${cleanSender}, nemaš dovoljno poena! Tvoj balans je: ${senderPoeni} ${valuta}.`);
        return;
    }

    // Oduzmi poslaocu, dodaj primaocu
    senderData.points -= iznos;
    channelState.leaderboardDeltas[senderKey] = (channelState.leaderboardDeltas[senderKey] || 0) - iznos;

    if (!channelState.leaderboard[targetKey]) {
        channelState.leaderboard[targetKey] = { username: cleanTarget, count: 0, xp: 0, level: 0, points: 0 };
    }
    const targetData = channelState.leaderboard[targetKey];
    targetData.points = (targetData.points || 0) + iznos;
    channelState.leaderboardDeltas[targetKey] = (channelState.leaderboardDeltas[targetKey] || 0) + iznos;
    channelState.leaderboardDirty = true;

    const valuta = dobijNazivValute(channelState);
    posaljiPoruku(chatroomId, `💸 @${cleanSender} je uspešno prebacio **${iznos.toLocaleString()} ${valuta}** korisniku @${cleanTarget}!`);
}

// ─── LEADERBOARDS: !toplevel & !topcoins ──────────────────────────
function handleTopLevel(chatroomId, limitRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    let limit = 5;
    if (limitRaw) {
        const parsed = parseInt(limitRaw, 10);
        if (!isNaN(parsed) && parsed > 0) limit = Math.min(10, parsed);
    }

    const sortirani = Object.values(channelState.leaderboard)
        .sort((a, b) => (b.xp || 0) - (a.xp || 0))
        .filter(x => (x.xp || 0) > 0);

    if (sortirani.length === 0) {
        posaljiPoruku(chatroomId, `⭐ Još nema aktivnih nivoa na ovom kanalu!`);
        return;
    }

    const lista = sortirani.slice(0, limit)
        .map((x, idx) => `${idx + 1}. @${x.username || x.display_name} (Lvl ${x.level || izracunajNivo(x.xp)} - ${x.xp.toLocaleString()} XP)`)
        .join(', ');

    posaljiPoruku(chatroomId, `🏆 **Top ${limit} Nivoi**: ${lista}`);
}

function handleTopCoins(chatroomId, limitRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    let limit = 5;
    if (limitRaw) {
        const parsed = parseInt(limitRaw, 10);
        if (!isNaN(parsed) && parsed > 0) limit = Math.min(10, parsed);
    }

    const valuta = dobijNazivValute(channelState);
    const sortirani = Object.values(channelState.leaderboard)
        .sort((a, b) => (b.points || 0) - (a.points || 0))
        .filter(x => (x.points || 0) > 0);

    if (sortirani.length === 0) {
        posaljiPoruku(chatroomId, `🪙 Još niko nema sakupljenih ${valuta}!`);
        return;
    }

    const lista = sortirani.slice(0, limit)
        .map((x, idx) => `${idx + 1}. @${x.username || x.display_name} (${(x.points || 0).toLocaleString()} ${valuta})`)
        .join(', ');

    posaljiPoruku(chatroomId, `🪙 **Top ${limit} Najbogatiji (${valuta})**: ${lista}`);
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
