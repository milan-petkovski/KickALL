const state = require('./state');
const { log, sanitizeInput, isValidUsername } = require('./utils');
const { posaljiPoruku } = require('./messenger');
const { dobijNazivValute } = require('./economy');

// Pomoćna provera za poene i dozvole ulog-a
function proveriUlog(chatroomId, sender, amountRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return { valid: false };

    if (channelState.gamble_enabled === false) {
        posaljiPoruku(chatroomId, `🎰 Kockanje je trenutno onemogućeno na ovom kanalu.`);
        return { valid: false };
    }

    if (!isValidUsername(sender)) return { valid: false };
    const clean = sanitizeInput(sender);
    const key = clean.toLowerCase();

    const valuta = dobijNazivValute(channelState);
    const user = channelState.leaderboard[key];
    const trenutniPoeni = user ? (user.points || 0) : 0;

    let iznos = 0;
    if (!amountRaw) {
        posaljiPoruku(chatroomId, `❌ Unesi iznos uloga! Primjer: !slots 100 ili !slots all`);
        return { valid: false };
    }

    if (amountRaw.toLowerCase() === 'all' || amountRaw.toLowerCase() === 'sve') {
        iznos = trenutniPoeni;
    } else {
        iznos = parseInt(amountRaw, 10);
    }

    if (isNaN(iznos) || iznos <= 0) {
        posaljiPoruku(chatroomId, `❌ Iznos uloga mora biti pozitivan broj!`);
        return { valid: false };
    }

    if (iznos > trenutniPoeni) {
        posaljiPoruku(chatroomId, `❌ @${clean}, nemaš dovoljno poena! Tvoj balans: **${trenutniPoeni.toLocaleString()} ${valuta}**.`);
        return { valid: false };
    }

    const maxGamble = channelState.max_gamble_amount || 5000;
    if (iznos > maxGamble) {
        posaljiPoruku(chatroomId, `⚠️ Maksimalni ulog po igri na ovom kanalu je **${maxGamble.toLocaleString()} ${valuta}**!`);
        return { valid: false };
    }

    return { valid: true, cleanSender: clean, userKey: key, iznos, valuta, user };
}

// ─── KOMANDA: !slots [iznos] ─────────────────────────────────────────
function handleSlots(chatroomId, sender, amountRaw) {
    const p = proveriUlog(chatroomId, sender, amountRaw);
    if (!p.valid) return;

    const simboli = ['🍒', '🍋', '🔔', '🍇', '🍉', '💎', '7️⃣'];
    const s1 = simboli[Math.floor(Math.random() * simboli.length)];
    const s2 = simboli[Math.floor(Math.random() * simboli.length)];
    const s3 = simboli[Math.floor(Math.random() * simboli.length)];

    const channelState = state.getChannelState(chatroomId);

    // Ishodi
    let dobitak = 0;
    let porukaDobitka = '';

    if (s1 === s2 && s2 === s3) {
        if (s1 === '7️⃣' || s1 === '💎') {
            dobitak = p.iznos * 10; // JACKPOT
            porukaDobitka = `💎🔥 **JACKPOT 10x!** Osvojio si **+${dobitak.toLocaleString()} ${p.valuta}**! 🔥💎`;
        } else {
            dobitak = p.iznos * 5;
            porukaDobitka = `🎉 **3 u nizu 5x!** Osvojio si **+${dobitak.toLocaleString()} ${p.valuta}**! 🎉`;
        }
    } else if (s1 === s2 || s2 === s3 || s1 === s3) {
        dobitak = Math.floor(p.iznos * 1.5);
        porukaDobitka = `✨ **2 u nizu!** Dobio si nazad **+${dobitak.toLocaleString()} ${p.valuta}**! ✨`;
    } else {
        dobitak = 0;
        porukaDobitka = `❌ Izgubio si **${p.iznos.toLocaleString()} ${p.valuta}**! Više sreće drugi put! 💸`;
    }

    // Ažuriraj poene
    p.user.points = p.user.points - p.iznos + dobitak;
    channelState.leaderboardDeltas[p.userKey] = (channelState.leaderboardDeltas[p.userKey] || 0) + (dobitak - p.iznos);
    channelState.leaderboardDirty = true;

    posaljiPoruku(chatroomId, `🎰 @${p.cleanSender} je zavrteo slot: [ ${s1} | ${s2} | ${s3} ] — ${porukaDobitka}`);
}

// ─── KOMANDA: !roulette / !rulet [opcija] [iznos] ────────────────────
function handleRoulette(chatroomId, sender, optionRaw, amountRaw) {
    if (!optionRaw || !amountRaw) {
        posaljiPoruku(chatroomId, `🎲 Upotreba: !roulette <crvena/crna/zelena/par/nepar/0-36> <iznos> — npr. !roulette crvena 100`);
        return;
    }

    const p = proveriUlog(chatroomId, sender, amountRaw);
    if (!p.valid) return;

    const opcija = optionRaw.toLowerCase().trim();
    const loptica = Math.floor(Math.random() * 37); // 0 do 36

    // Boja broja
    const crveniBrojevi = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    let bojaLoptice = 'zelena 💚'; // 0
    if (loptica !== 0) {
        bojaLoptice = crveniBrojevi.includes(loptica) ? 'crvena ❤️' : 'crna 🖤';
    }

    let pobeda = false;
    let mnozilac = 0;

    if (opcija === 'crvena' || opcija === 'red') {
        if (loptica !== 0 && crveniBrojevi.includes(loptica)) { pobeda = true; mnozilac = 2; }
    } else if (opcija === 'crna' || opcija === 'black') {
        if (loptica !== 0 && !crveniBrojevi.includes(loptica)) { pobeda = true; mnozilac = 2; }
    } else if (opcija === 'zelena' || opcija === 'green') {
        if (loptica === 0) { pobeda = true; mnozilac = 14; }
    } else if (opcija === 'par' || opcija === 'even') {
        if (loptica !== 0 && loptica % 2 === 0) { pobeda = true; mnozilac = 2; }
    } else if (opcija === 'nepar' || opcija === 'odd') {
        if (loptica !== 0 && loptica % 2 !== 0) { pobeda = true; mnozilac = 2; }
    } else {
        const izabraniBroj = parseInt(opcija, 10);
        if (!isNaN(izabraniBroj) && izabraniBroj >= 0 && izabraniBroj <= 36) {
            if (loptica === izabraniBroj) { pobeda = true; mnozilac = 36; }
        } else {
            posaljiPoruku(chatroomId, `❌ Nevaljana opcija u ruletu! Izaberi: crvena, crna, zelena, par, nepar ili broj od 0 do 36.`);
            return;
        }
    }

    const channelState = state.getChannelState(chatroomId);
    let dobitak = 0;
    if (pobeda) {
        dobitak = p.iznos * mnozilac;
        p.user.points = p.user.points - p.iznos + dobitak;
        channelState.leaderboardDeltas[p.userKey] = (channelState.leaderboardDeltas[p.userKey] || 0) + (dobitak - p.iznos);
        channelState.leaderboardDirty = true;
        posaljiPoruku(chatroomId, `🎡 Loptica je pala na **${loptica} (${bojaLoptice})**! @${p.cleanSender} je POBEDIO i osvojio **+${dobitak.toLocaleString()} ${p.valuta}**! 🎉`);
    } else {
        p.user.points -= p.iznos;
        channelState.leaderboardDeltas[p.userKey] = (channelState.leaderboardDeltas[p.userKey] || 0) - p.iznos;
        channelState.leaderboardDirty = true;
        posaljiPoruku(chatroomId, `🎡 Loptica je pala na **${loptica} (${bojaLoptice})**! @${p.cleanSender} je izgubio **${p.iznos.toLocaleString()} ${p.valuta}**! 💸`);
    }
}

// ─── KOMANDA: !coinflip / !piskoglava [pismo/glava] [iznos] ──────────
function handleCoinflip(chatroomId, sender, sideRaw, amountRaw) {
    if (!sideRaw || !amountRaw) {
        posaljiPoruku(chatroomId, `🪙 Upotreba: !coinflip <pismo/glava> <iznos> — npr. !coinflip pismo 100`);
        return;
    }

    const p = proveriUlog(chatroomId, sender, amountRaw);
    if (!p.valid) return;

    const stranaInput = sideRaw.toLowerCase().trim();
    let izabranaStrana = '';
    if (stranaInput === 'pismo' || stranaInput === 'p') izabranaStrana = 'pismo';
    else if (stranaInput === 'glava' || stranaInput === 'g') izabranaStrana = 'glava';
    else {
        posaljiPoruku(chatroomId, `❌ Izaberi 'pismo' ili 'glava'!`);
        return;
    }

    const ishod = Math.random() < 0.5 ? 'pismo' : 'glava';
    const pobeda = (izabranaStrana === ishod);

    const channelState = state.getChannelState(chatroomId);
    if (pobeda) {
        const dobitak = p.iznos * 2;
        p.user.points = p.user.points - p.iznos + dobitak;
        channelState.leaderboardDeltas[p.userKey] = (channelState.leaderboardDeltas[p.userKey] || 0) + p.iznos;
        channelState.leaderboardDirty = true;
        posaljiPoruku(chatroomId, `🪙 Novčić je pao na **${ishod.toUpperCase()}**! @${p.cleanSender} je pogodio i osvojio **+${p.iznos.toLocaleString()} ${p.valuta}**! 💥`);
    } else {
        p.user.points -= p.iznos;
        channelState.leaderboardDeltas[p.userKey] = (channelState.leaderboardDeltas[p.userKey] || 0) - p.iznos;
        channelState.leaderboardDirty = true;
        posaljiPoruku(chatroomId, `🪙 Novčić je pao na **${ishod.toUpperCase()}**! @${p.cleanSender} je promašio i izgubio **${p.iznos.toLocaleString()} ${p.valuta}**! 💸`);
    }
}

// ─── KOMANDA: !duel @user [iznos] ────────────────────────────────────
function handleDuel(chatroomId, sender, targetRaw, amountRaw) {
    const target = targetRaw ? targetRaw.split(/\s+/)[0].replace(/^@/, '').trim() : '';
    if (!target || !isValidUsername(target)) {
        posaljiPoruku(chatroomId, `⚔️ Upotreba: !duel @korisnik <iznos>`);
        return;
    }

    const p = proveriUlog(chatroomId, sender, amountRaw);
    if (!p.valid) return;

    const cleanTarget = sanitizeInput(target);
    const targetKey = cleanTarget.toLowerCase();

    if (p.userKey === targetKey) {
        posaljiPoruku(chatroomId, `😂 Ne možeš izazvati samog sebe na dvoboj!`);
        return;
    }

    const channelState = state.getChannelState(chatroomId);
    const targetUserData = channelState.leaderboard[targetKey];
    const targetPoeni = targetUserData ? (targetUserData.points || 0) : 0;

    if (targetPoeni < p.iznos) {
        posaljiPoruku(chatroomId, `❌ @${cleanTarget} nema dovoljno poena za ovaj dvoboj! (Ima: ${targetPoeni} ${p.valuta}).`);
        return;
    }

    // Sačuvaj dvoboj na 30 sekundi
    if (!channelState.pendingDuels) channelState.pendingDuels = {};
    channelState.pendingDuels[targetKey] = {
        challenger: p.cleanSender,
        challengerKey: p.userKey,
        target: cleanTarget,
        targetKey,
        iznos: p.iznos,
        createdTs: Date.now()
    };

    posaljiPoruku(chatroomId, `⚔️ @${p.cleanSender} je izazvao korisnika @${cleanTarget} na DVOBOJ u **${p.iznos.toLocaleString()} ${p.valuta}**! Ukucaj **!accept** za prihvatanje ili **!odbij** (imaš 30 sekundi)! 💥`);
}

function handleAcceptDuel(chatroomId, sender) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || !channelState.pendingDuels) return;

    if (!isValidUsername(sender)) return;
    const clean = sanitizeInput(sender);
    const targetKey = clean.toLowerCase();

    const duel = channelState.pendingDuels[targetKey];
    if (!duel) {
        posaljiPoruku(chatroomId, `❌ @${clean}, nemaš aktivnih poziva za dvoboj.`);
        return;
    }

    if (Date.now() - duel.createdTs > 30000) {
        delete channelState.pendingDuels[targetKey];
        posaljiPoruku(chatroomId, `⏳ Vreme za prihvatanje dvoboja je isteklo.`);
        return;
    }

    delete channelState.pendingDuels[targetKey];

    const cUser = channelState.leaderboard[duel.challengerKey];
    const tUser = channelState.leaderboard[duel.targetKey];
    const valuta = dobijNazivValute(channelState);

    if (!cUser || (cUser.points || 0) < duel.iznos || !tUser || (tUser.points || 0) < duel.iznos) {
        posaljiPoruku(chatroomId, `❌ Dvoboj poništen jer jedan od igrača više nema dovoljno poena.`);
        return;
    }

    // Ishod dvoboja 50/50
    const pobednikChallenger = Math.random() < 0.5;
    if (pobednikChallenger) {
        cUser.points += duel.iznos;
        tUser.points -= duel.iznos;
        channelState.leaderboardDeltas[duel.challengerKey] = (channelState.leaderboardDeltas[duel.challengerKey] || 0) + duel.iznos;
        channelState.leaderboardDeltas[duel.targetKey] = (channelState.leaderboardDeltas[duel.targetKey] || 0) - duel.iznos;
        channelState.leaderboardDirty = true;
        posaljiPoruku(chatroomId, `⚔️💥 @${duel.challenger} je POBEDIO u dvoboju protiv @${duel.target} i osvojio **+${duel.iznos.toLocaleString()} ${valuta}**! 🏆`);
    } else {
        cUser.points -= duel.iznos;
        tUser.points += duel.iznos;
        channelState.leaderboardDeltas[duel.challengerKey] = (channelState.leaderboardDeltas[duel.challengerKey] || 0) - duel.iznos;
        channelState.leaderboardDeltas[duel.targetKey] = (channelState.leaderboardDeltas[duel.targetKey] || 0) + duel.iznos;
        channelState.leaderboardDirty = true;
        posaljiPoruku(chatroomId, `⚔️💥 @${duel.target} je POBEDIO u dvoboju protiv @${duel.challenger} i osvojio **+${duel.iznos.toLocaleString()} ${valuta}**! 🏆`);
    }
}

function handleDeclineDuel(chatroomId, sender) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || !channelState.pendingDuels) return;

    if (!isValidUsername(sender)) return;
    const clean = sanitizeInput(sender);
    const targetKey = clean.toLowerCase();

    if (channelState.pendingDuels[targetKey]) {
        const challenger = channelState.pendingDuels[targetKey].challenger;
        delete channelState.pendingDuels[targetKey];
        posaljiPoruku(chatroomId, `🛡️ @${clean} je odbio dvoboj sa @${challenger}.`);
    }
}

function handleWheel(chatroomId, sender, amountRaw) {
    const p = proveriUlog(chatroomId, sender, amountRaw);
    if (!p.valid) return;

    const opcije = [
        { label: '0x ❌', mult: 0 },
        { label: '0.5x 📉', mult: 0.5 },
        { label: '1.5x 📈', mult: 1.5 },
        { label: '2x 🚀', mult: 2.0 },
        { label: '3x 🔥', mult: 3.0 },
        { label: '5x 👑', mult: 5.0 }
    ];

    const pick = opcije[Math.floor(Math.random() * opcije.length)];
    const dobitak = Math.floor(p.iznos * pick.mult);
    const razlika = dobitak - p.iznos;

    const channelState = state.getChannelState(chatroomId);
    p.user.points = p.user.points + razlika;
    channelState.leaderboardDeltas[p.userKey] = (channelState.leaderboardDeltas[p.userKey] || 0) + razlika;
    channelState.leaderboardDirty = true;

    if (razlika > 0) {
        posaljiPoruku(chatroomId, `🎯 @${p.cleanSender} je zavrteo točak sreće: **[ ${pick.label} ]** — Osvojio si **+${dobitak.toLocaleString()} ${p.valuta}**! 🎉`);
    } else if (razlika === 0) {
        posaljiPoruku(chatroomId, `🎯 @${p.cleanSender} je zavrteo točak: **[ ${pick.label} ]** — Vraćeno **${dobitak.toLocaleString()} ${p.valuta}**.`);
    } else {
        posaljiPoruku(chatroomId, `🎯 @${p.cleanSender} je zavrteo točak: **[ ${pick.label} ]** — Izgubio si **${Math.abs(razlika).toLocaleString()} ${p.valuta}**! 💸`);
    }
}

module.exports = {
    handleSlots,
    handleRoulette,
    handleCoinflip,
    handleWheel,
    handleDuel,
    handleAcceptDuel,
    handleDeclineDuel
};
