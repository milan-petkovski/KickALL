const state = require('./state');
const config = require('./config');
const { posaljiPoruku } = require('./messenger');
const { dobijNazivValute } = require('./economy');
const { sanitizeInput, isValidUsername } = require('./utils');

// ─── HELPER: Dohvati economy korisnika ───────────────────────────────────────
function dohvatiEkonomiju(channelState, key, displayName) {
    if (!channelState.economy[key]) {
        channelState.economy[key] = {
            username: displayName || key,
            xp: 0, level: 0, coins: 0,
            daily_claimed_at: 0, daily_streak: 0
        };
    }
    return channelState.economy[key];
}

// ─── HELPER: Oznaci korisnike kao dirty i zaplanuj save ──────────────────────
function markirajDirtyIZaplanujSave(channelState, chatroomId, ...keys) {
    channelState.economyDirty = true;
    for (const k of keys) channelState.economyDeltas.add(k);

    if (!channelState.economySaveTimer) {
        channelState.economySaveTimer = setTimeout(async () => {
            try {
                const { sacuvajEkonomiju } = require('./database');
                await sacuvajEkonomiju(chatroomId);
            } catch (e) { /* greska pri cuvanju */ }
            channelState.economySaveTimer = null;
        }, config.ECONOMY_SAVE_INTERVAL_MS);
        if (channelState.economySaveTimer && typeof channelState.economySaveTimer.unref === 'function') {
            channelState.economySaveTimer.unref();
        }
    }
}

// ─── HELPER: Provera uloga ───────────────────────────────────────────────────
function proveriUlog(chatroomId, sender, amountRaw) {
    if (!isValidUsername(sender)) return { valid: false };

    const clean = sanitizeInput(sender);
    const key   = clean.toLowerCase();
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return { valid: false };

    const user          = dohvatiEkonomiju(channelState, key, clean);
    const trenutniCoins = user.coins || 0;
    const valuta        = dobijNazivValute(channelState);

    if (!amountRaw) {
        posaljiPoruku(chatroomId, `❌ @${clean}, navedi iznos uloga!`);
        return { valid: false };
    }

    let iznos = 0;
    const arg = amountRaw.toLowerCase().trim();
    if (arg === 'all' || arg === 'sve')        iznos = trenutniCoins;
    else if (arg === 'half' || arg === 'pola') iznos = Math.floor(trenutniCoins / 2);
    else                                        iznos = parseInt(arg, 10);

    if (isNaN(iznos) || iznos <= 0) {
        posaljiPoruku(chatroomId, `❌ Iznos uloga mora biti pozitivan broj!`);
        return { valid: false };
    }

    if (iznos > trenutniCoins) {
        posaljiPoruku(chatroomId, `❌ @${clean}, nemaš dovoljno poena! Tvoj balans: ${trenutniCoins.toLocaleString()} ${valuta}.`);
        return { valid: false };
    }

    const maxGamble = channelState.max_gamble_amount || 5000;
    if (iznos > maxGamble) {
        posaljiPoruku(chatroomId, `⚠️ Maksimalni ulog po igri na ovom kanalu je ${maxGamble.toLocaleString()} ${valuta}!`);
        return { valid: false };
    }

    return { valid: true, cleanSender: clean, userKey: key, iznos, valuta, user, channelState };
}

// ─── KOMANDA: !slots [iznos] ─────────────────────────────────────────────────
function handleSlots(chatroomId, sender, amountRaw) {
    const p = proveriUlog(chatroomId, sender, amountRaw);
    if (!p.valid) return;

    const simboli = ['🍒', '🍋', '🔔', '🍇', '🍉', '💎', '7️⃣'];
    const s1 = simboli[Math.floor(Math.random() * simboli.length)];
    const s2 = simboli[Math.floor(Math.random() * simboli.length)];
    const s3 = simboli[Math.floor(Math.random() * simboli.length)];

    let dobitak = 0;
    let porukaDobitka = '';

    if (s1 === s2 && s2 === s3) {
        if (s1 === '7️⃣' || s1 === '💎') {
            dobitak = p.iznos * 10;
            porukaDobitka = `💎🔥 JACKPOT 10x! Osvojio si +${dobitak.toLocaleString()} ${p.valuta}! 🔥💎`;
        } else {
            dobitak = p.iznos * 5;
            porukaDobitka = `🎉 3 u nizu 5x! Osvojio si +${dobitak.toLocaleString()} ${p.valuta}! 🎉`;
        }
    } else if (s1 === s2 || s2 === s3 || s1 === s3) {
        dobitak = Math.floor(p.iznos * 1.5);
        porukaDobitka = `✨ 2 u nizu! Dobio si nazad +${dobitak.toLocaleString()} ${p.valuta}! ✨`;
    } else {
        dobitak = 0;
        porukaDobitka = `❌ Izgubio si ${p.iznos.toLocaleString()} ${p.valuta}! Više sreće drugi put! 💸`;
    }

    p.user.coins = (p.user.coins || 0) - p.iznos + dobitak;
    markirajDirtyIZaplanujSave(p.channelState, chatroomId, p.userKey);

    posaljiPoruku(chatroomId, `🎰 @${p.cleanSender} je zavrteo slot: [ ${s1} | ${s2} | ${s3} ] — ${porukaDobitka}`);
}

// ─── KOMANDA: !roulette / !rulet [opcija] [iznos] ────────────────────────────
function handleRoulette(chatroomId, sender, optionRaw, amountRaw) {
    if (!optionRaw || !amountRaw) {
        posaljiPoruku(chatroomId, `🎡 Upotreba: !roulette <crvena/crna/par/nepar/broj 0-36> <iznos>`);
        return;
    }

    const p = proveriUlog(chatroomId, sender, amountRaw);
    if (!p.valid) return;

    const opcija  = optionRaw.toLowerCase().trim();
    const loptica = Math.floor(Math.random() * 37);
    const jeCrvena = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(loptica);
    const bojaLoptice = loptica === 0 ? 'Zelena' : (jeCrvena ? 'Crvena' : 'Crna');

    let pobeda = false;
    let mnozilac = 0;

    if (opcija === 'crvena' || opcija === 'red')        { if (jeCrvena && loptica !== 0) { pobeda = true; mnozilac = 2; } }
    else if (opcija === 'crna' || opcija === 'black')   { if (!jeCrvena && loptica !== 0) { pobeda = true; mnozilac = 2; } }
    else if (opcija === 'par' || opcija === 'even')     { if (loptica !== 0 && loptica % 2 === 0) { pobeda = true; mnozilac = 2; } }
    else if (opcija === 'nepar' || opcija === 'odd')    { if (loptica !== 0 && loptica % 2 !== 0) { pobeda = true; mnozilac = 2; } }
    else {
        const ciljniBroj = parseInt(opcija, 10);
        if (!isNaN(ciljniBroj) && ciljniBroj >= 0 && ciljniBroj <= 36) {
            if (loptica === ciljniBroj) { pobeda = true; mnozilac = 36; }
        } else {
            posaljiPoruku(chatroomId, `❌ Neispravna opcija! Izaberi crvena/crna/par/nepar ili broj 0-36.`);
            return;
        }
    }

    if (pobeda) {
        const dobitak = p.iznos * mnozilac;
        p.user.coins = (p.user.coins || 0) - p.iznos + dobitak;
        posaljiPoruku(chatroomId, `🎡 Loptica je pala na ${loptica} (${bojaLoptice})! @${p.cleanSender} je POBEDIO i osvojio +${dobitak.toLocaleString()} ${p.valuta}! 🎉`);
    } else {
        p.user.coins = (p.user.coins || 0) - p.iznos;
        posaljiPoruku(chatroomId, `🎡 Loptica je pala na ${loptica} (${bojaLoptice})! @${p.cleanSender} je izgubio ${p.iznos.toLocaleString()} ${p.valuta}! 💸`);
    }
    markirajDirtyIZaplanujSave(p.channelState, chatroomId, p.userKey);
}

// ─── KOMANDA: !coinflip / !piskoglava [pismo/glava] [iznos] ──────────────────
function handleCoinflip(chatroomId, sender, sideRaw, amountRaw) {
    if (!sideRaw || !amountRaw) {
        posaljiPoruku(chatroomId, `🪙 Upotreba: !coinflip <pismo/glava> <iznos> — npr. !coinflip pismo 100`);
        return;
    }

    const p = proveriUlog(chatroomId, sender, amountRaw);
    if (!p.valid) return;

    const stranaInput = sideRaw.toLowerCase().trim();
    let izabranaStrana = '';
    if (stranaInput === 'pismo' || stranaInput === 'p')       izabranaStrana = 'pismo';
    else if (stranaInput === 'glava' || stranaInput === 'g')  izabranaStrana = 'glava';
    else {
        posaljiPoruku(chatroomId, `❌ Izaberi 'pismo' ili 'glava'!`);
        return;
    }

    const ishod  = Math.random() < 0.5 ? 'pismo' : 'glava';
    const pobeda = (izabranaStrana === ishod);

    if (pobeda) {
        p.user.coins = (p.user.coins || 0) + p.iznos;
        posaljiPoruku(chatroomId, `🪙 Novčić je pao na ${ishod.toUpperCase()}! @${p.cleanSender} je pogodio i osvojio +${p.iznos.toLocaleString()} ${p.valuta}! 💥`);
    } else {
        p.user.coins = (p.user.coins || 0) - p.iznos;
        posaljiPoruku(chatroomId, `🪙 Novčić je pao na ${ishod.toUpperCase()}! @${p.cleanSender} je promašio i izgubio ${p.iznos.toLocaleString()} ${p.valuta}! 💸`);
    }
    markirajDirtyIZaplanujSave(p.channelState, chatroomId, p.userKey);
}

// ─── KOMANDA: !duel @user [iznos] ────────────────────────────────────────────
function handleDuel(chatroomId, sender, targetRaw, amountRaw) {
    const target = targetRaw ? targetRaw.split(/\s+/)[0].replace(/^@/, '').trim() : '';
    if (!target || !isValidUsername(target)) {
        posaljiPoruku(chatroomId, `⚔️ Upotreba: !duel @korisnik <iznos>`);
        return;
    }

    const p = proveriUlog(chatroomId, sender, amountRaw);
    if (!p.valid) return;

    const cleanTarget = sanitizeInput(target);
    const targetKey   = cleanTarget.toLowerCase();

    if (p.userKey === targetKey) {
        posaljiPoruku(chatroomId, `😂 Ne možeš izazvati samog sebe na dvoboj!`);
        return;
    }

    const targetEconomy = p.channelState.economy[targetKey];
    const targetCoins   = targetEconomy ? (targetEconomy.coins || 0) : 0;

    if (targetCoins < p.iznos) {
        posaljiPoruku(chatroomId, `❌ @${cleanTarget} nema dovoljno poena za ovaj dvoboj! (Ima: ${targetCoins} ${p.valuta}).`);
        return;
    }

    if (!p.channelState.pendingDuels) p.channelState.pendingDuels = {};
    p.channelState.pendingDuels[targetKey] = {
        challenger:    p.cleanSender,
        challengerKey: p.userKey,
        target:        cleanTarget,
        targetKey,
        iznos:         p.iznos,
        createdTs:     Date.now()
    };

    posaljiPoruku(chatroomId, `⚔️ @${p.cleanSender} je izazvao korisnika @${cleanTarget} na DVOBOJ u ${p.iznos.toLocaleString()} ${p.valuta}! Ukucaj !accept za prihvatanje ili !odbij (imaš 30 sekundi)! 💥`);
}

function handleAcceptDuel(chatroomId, sender) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || !channelState.pendingDuels) return;

    if (!isValidUsername(sender)) return;
    const clean     = sanitizeInput(sender);
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

    const cEcon  = dohvatiEkonomiju(channelState, duel.challengerKey, duel.challenger);
    const tEcon  = dohvatiEkonomiju(channelState, duel.targetKey,     duel.target);
    const valuta = dobijNazivValute(channelState);

    if ((cEcon.coins || 0) < duel.iznos || (tEcon.coins || 0) < duel.iznos) {
        posaljiPoruku(chatroomId, `❌ Dvoboj poništen jer jedan od igrača više nema dovoljno poena.`);
        return;
    }

    const pobednikChallenger = Math.random() < 0.5;
    if (pobednikChallenger) {
        cEcon.coins = (cEcon.coins || 0) + duel.iznos;
        tEcon.coins = (tEcon.coins || 0) - duel.iznos;
        posaljiPoruku(chatroomId, `⚔️💥 @${duel.challenger} je POBEDIO u dvoboju protiv @${duel.target} i osvojio +${duel.iznos.toLocaleString()} ${valuta}! 🏆`);
    } else {
        cEcon.coins = (cEcon.coins || 0) - duel.iznos;
        tEcon.coins = (tEcon.coins || 0) + duel.iznos;
        posaljiPoruku(chatroomId, `⚔️💥 @${duel.target} je POBEDIO u dvoboju protiv @${duel.challenger} i osvojio +${duel.iznos.toLocaleString()} ${valuta}! 🏆`);
    }

    markirajDirtyIZaplanujSave(channelState, chatroomId, duel.challengerKey, duel.targetKey);
}

function handleDeclineDuel(chatroomId, sender) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || !channelState.pendingDuels) return;

    if (!isValidUsername(sender)) return;
    const clean     = sanitizeInput(sender);
    const targetKey = clean.toLowerCase();

    if (channelState.pendingDuels[targetKey]) {
        const challenger = channelState.pendingDuels[targetKey].challenger;
        delete channelState.pendingDuels[targetKey];
        posaljiPoruku(chatroomId, `🛡️ @${clean} je odbio dvoboj sa @${challenger}.`);
    }
}

// ─── KOMANDA: !wheel / !tocak [iznos] ────────────────────────────────────────
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

    const pick   = opcije[Math.floor(Math.random() * opcije.length)];
    const dobitak = Math.floor(p.iznos * pick.mult);
    const razlika = dobitak - p.iznos;

    p.user.coins = (p.user.coins || 0) + razlika;
    markirajDirtyIZaplanujSave(p.channelState, chatroomId, p.userKey);

    if (razlika > 0) {
        posaljiPoruku(chatroomId, `🎯 @${p.cleanSender} je zavrteo točak sreće: [ ${pick.label} ] — Osvojio si +${dobitak.toLocaleString()} ${p.valuta}! 🎉`);
    } else if (razlika === 0) {
        posaljiPoruku(chatroomId, `🎯 @${p.cleanSender} je zavrteo točak: [ ${pick.label} ] — Vraćeno ${dobitak.toLocaleString()} ${p.valuta}.`);
    } else {
        posaljiPoruku(chatroomId, `🎯 @${p.cleanSender} je zavrteo točak: [ ${pick.label} ] — Izgubio si ${Math.abs(razlika).toLocaleString()} ${p.valuta}! 💸`);
    }
}

module.exports = {
    proveriUlog,
    handleSlots,
    handleRoulette,
    handleCoinflip,
    handleWheel,
    handleDuel,
    handleAcceptDuel,
    handleDeclineDuel
};
