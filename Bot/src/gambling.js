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
function proveriUlog(chatroomId, sender, amountRaw, gameName = 'igra') {
    if (!isValidUsername(sender)) return { valid: false };

    const clean = sanitizeInput(sender);
    const key   = clean.toLowerCase();
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return { valid: false };

    if (channelState.feature_games === false || (channelState.planLimits && channelState.planLimits.allowGambling === false)) {
        posaljiPoruku(chatroomId, `❌ @${clean}, Kazino igre i komande kockanja su dostupne u PRO i ELITE paketima.`);
        return { valid: false };
    }

    const user          = dohvatiEkonomiju(channelState, key, clean);
    const trenutniCoins = user.coins || 0;
    const valuta        = dobijNazivValute(channelState);

    const cleanAmount = (amountRaw || '').trim();
    if (!cleanAmount) {
        let primer = `!${gameName} 100`;
        let icon = '🎯';
        if (gameName === 'coinflip') {
            primer = `!coinflip glava 100`;
            icon = '🪙';
        } else if (gameName === 'rulet' || gameName === 'roulette') {
            primer = `!rulet crvena 100`;
            icon = '🎡';
        } else if (gameName === 'tocak' || gameName === 'wheel' || gameName === 'spin') {
            primer = `!tocak 100`;
            icon = '🎡';
        } else if (gameName === 'slot' || gameName === 'slots') {
            primer = `!slot 100`;
            icon = '🎰';
        } else if (gameName === 'duel' || gameName === 'dvoboj') {
            primer = `!duel @korisnik 100`;
            icon = '⚔️';
        }
        posaljiPoruku(chatroomId, `${icon} @${clean}, navedi ulog! Upotreba: !${gameName} <iznos> (npr. ${primer} ili !${gameName} all)`);
        return { valid: false };
    }

    let iznos = 0;
    const arg = cleanAmount.toLowerCase();
    if (arg === 'all' || arg === 'sve')        iznos = trenutniCoins;
    else if (arg === 'half' || arg === 'pola') iznos = Math.floor(trenutniCoins / 2);
    else                                        iznos = parseInt(arg, 10);

    if (isNaN(iznos) || iznos <= 0) {
        posaljiPoruku(chatroomId, `❌ @${clean}, navedi ispravan broj uloga! (npr. !${gameName} 100 ili !${gameName} all)`);
        return { valid: false };
    }

    if (iznos > trenutniCoins) {
        posaljiPoruku(chatroomId, `❌ @${clean}, nemaš dovoljno poena! Tvoj balans: ${trenutniCoins.toLocaleString()} ${valuta}.`);
        return { valid: false };
    }

    const maxGamble = channelState.max_gamble_amount || 5000;
    if (iznos > maxGamble) {
        posaljiPoruku(chatroomId, `⚠️ @${clean}, maksimalni ulog po igri na ovom kanalu je ${maxGamble.toLocaleString()} ${valuta}! Proveri komandom !limit`);
        return { valid: false };
    }

    return { valid: true, cleanSender: clean, userKey: key, iznos, valuta, user, channelState, maxGamble };
}

// ─── HELPER: Pametni kockarski mehanizam rizika ─────────────────────────────
/**
 * Pametna procena rizika uloga:
 * Skalira od 0.0 (mali opušteni bet sa povećanim šansama za dobitak)
 * do 1.0 (maksimalni ulog / all-in gde je kuća nemilosrdna i drastično teže dobiti).
 * Takođe prati serije pobeda i gubitaka (streak) za autentični kazino osećaj.
 */
function izracunajKockarskiRizik(iznos, maxGamble, user) {
    const safeMax = Math.max(10, maxGamble || 5000);
    // Udeo u odnosu na max bet kanala (0.0 do 1.0)
    const ratioMax = Math.min(1, Math.max(0, iznos / safeMax));

    // Udeo u odnosu na trenutni balans igrača (all-in ili procenat imetka)
    const coins = (user && typeof user.coins === 'number') ? user.coins : iznos;
    const totalCoins = Math.max(coins, iznos);
    const ratioBalance = totalCoins > 0 ? Math.min(1, Math.max(0, iznos / totalCoins)) : ratioMax;

    // Kombinovani faktor rizika: ulog blizu maxbeta ili rizikovanje celog balansa
    let riskFactor = Math.max(ratioMax, ratioBalance * 0.85);

    // Kockarska memorija (streak): ako igrač naniže 2+ pobede, kuća pooštrava šanse
    if (user && user.gambleWinStreak >= 2) {
        riskFactor = Math.min(1, riskFactor + 0.15);
    }
    // Ako ima 3+ uzastopnih poraza na manjim ulozima, dajemo mali popust radi zadržavanja dinamike
    if (user && user.gambleLossStreak >= 3 && ratioMax < 0.35) {
        riskFactor = Math.max(0, riskFactor - 0.12);
    }

    return riskFactor;
}

function zabeleziIshod(user, pobeda) {
    if (!user) return;
    if (pobeda) {
        user.gambleWinStreak = (user.gambleWinStreak || 0) + 1;
        user.gambleLossStreak = 0;
    } else {
        user.gambleLossStreak = (user.gambleLossStreak || 0) + 1;
        user.gambleWinStreak = 0;
    }
}

// ─── KOMANDA: !limit / !maxbet ──────────────────────────────────────────────
function handleLimit(chatroomId, sender) {
    if (!isValidUsername(sender)) return;
    const clean = sanitizeInput(sender);
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    if (channelState.feature_games === false || (channelState.planLimits && channelState.planLimits.allowGambling === false)) {
        posaljiPoruku(chatroomId, `❌ @${clean}, kazino igre i komande kockanja su trenutno isključene na ovom kanalu.`);
        return;
    }

    const maxGamble = channelState.max_gamble_amount || 5000;
    const valuta = dobijNazivValute(channelState);
    posaljiPoruku(chatroomId, `🎰 @${clean}, maksimalni dozvoljeni ulog (maxbet) za kazino igre na ovom kanalu je ${maxGamble.toLocaleString()} ${valuta}! 🪙`);
}

// ─── KOMANDA: !slots [iznos] ─────────────────────────────────────────────────
function handleSlots(chatroomId, sender, amountRaw) {
    const p = proveriUlog(chatroomId, sender, amountRaw, 'slot');
    if (!p.valid) return;

    const simboli = ['🍒', '🍋', '🔔', '🍇', '🍉', '💎', '7️⃣'];
    const risk = izracunajKockarskiRizik(p.iznos, p.maxGamble, p.user);

    // Šanse za 3 u nizu (Jackpot) i 2 u nizu (Dobar dobitak / uteha):
    // Mali bet (risk ~ 0.0): 3 u nizu ~7.5%, 2 u nizu ~38% (ukupno ~45% šansa za dobitak)
    // Srednji bet (risk ~ 0.5): 3 u nizu ~3.5%, 2 u nizu ~25%
    // Veliki bet / maxbet (risk ~ 1.0): 3 u nizu ~1.2%, 2 u nizu ~16%, česti near-miss gubitak
    const jackpotChance = Math.max(0.012, 0.075 - (risk * 0.06));
    const pairChance = Math.max(0.16, 0.38 - (risk * 0.22));

    const roll = Math.random();
    let s1, s2, s3;
    let dobitak = 0;
    let porukaDobitka = '';

    if (roll < jackpotChance) {
        // 3 u nizu!
        const hitSymbol = Math.random() < 0.25 ? '7️⃣' : (Math.random() < 0.35 ? '💎' : simboli[Math.floor(Math.random() * simboli.length)]);
        s1 = hitSymbol;
        s2 = hitSymbol;
        s3 = hitSymbol;

        const mult = (hitSymbol === '7️⃣' || hitSymbol === '💎') ? 5 : 3;
        dobitak = p.iznos * mult;
        porukaDobitka = `💎🔥 JACKPOT ${mult}x! Osvojio si +${dobitak.toLocaleString()} ${p.valuta}! 🔥💎`;
        zabeleziIshod(p.user, true);
    } else if (roll < (jackpotChance + pairChance)) {
        // 2 u nizu (pobeda!)
        const mainIdx = Math.floor(Math.random() * simboli.length);
        const otherIdx = (mainIdx + 1 + Math.floor(Math.random() * (simboli.length - 1))) % simboli.length;
        s1 = simboli[mainIdx];
        s2 = simboli[mainIdx];
        s3 = simboli[otherIdx];

        // Za mali/umereni ulog: isplaćuje 1.5x uloga (čist profit +50%)
        // Za veliki ulog/maxbet: isplaćuje 1.0x (vraća ulog, push)
        const pairMult = risk > 0.6 ? 1.0 : 1.5;
        dobitak = Math.floor(p.iznos * pairMult);
        if (pairMult > 1.0) {
            porukaDobitka = `✨ 2 u nizu (${pairMult}x)! Osvojio si +${dobitak.toLocaleString()} ${p.valuta}! ✨`;
            zabeleziIshod(p.user, true);
        } else {
            porukaDobitka = `✨ 2 u nizu! Vraćen je tvoj ulog od ${dobitak.toLocaleString()} ${p.valuta}. ✨`;
        }
    } else {
        // Gubitak
        // Near-miss psihologija: kod većih betova često prikaži 2 ista simbola, a treći promaši za dlaku
        if (risk > 0.4 && Math.random() < 0.45) {
            const nearSym = (Math.random() < 0.5) ? '7️⃣' : '💎';
            const otherList = simboli.filter(s => s !== nearSym);
            const diffSym = otherList[Math.floor(Math.random() * otherList.length)];
            s1 = nearSym;
            s2 = nearSym;
            s3 = diffSym;
            dobitak = 0;
            porukaDobitka = `👀 Zamalo jackpot! Izgubio si ${p.iznos.toLocaleString()} ${p.valuta}. Više sreće sledeći put! 💸`;
        } else {
            // Svi različiti (bez while petlji)
            const idx1 = Math.floor(Math.random() * simboli.length);
            const idx2 = (idx1 + 1 + Math.floor(Math.random() * (simboli.length - 1))) % simboli.length;
            const remainingIndices = [];
            for (let i = 0; i < simboli.length; i++) {
                if (i !== idx1 && i !== idx2) remainingIndices.push(i);
            }
            const idx3 = remainingIndices[Math.floor(Math.random() * remainingIndices.length)];

            s1 = simboli[idx1];
            s2 = simboli[idx2];
            s3 = simboli[idx3];

            dobitak = 0;
            porukaDobitka = `❌ Izgubio si ${p.iznos.toLocaleString()} ${p.valuta}! Više sreće drugi put! 💸`;
        }
        zabeleziIshod(p.user, false);
    }

    p.user.coins = (p.user.coins || 0) - p.iznos + dobitak;
    markirajDirtyIZaplanujSave(p.channelState, chatroomId, p.userKey);

    posaljiPoruku(chatroomId, `🎰 @${p.cleanSender} je zavrteo slot: [ ${s1} | ${s2} | ${s3} ] — ${porukaDobitka}`);
}

// ─── KOMANDA: !roulette / !rulet [opcija] [iznos] ────────────────────────────
function handleRoulette(chatroomId, sender, arg1Raw, arg2Raw) {
    const cleanSender = sanitizeInput(sender);
    if (!arg1Raw && !arg2Raw) {
        posaljiPoruku(chatroomId, `🎡 @${cleanSender}, upotreba: !rulet <crvena/crna/par/nepar/broj 0-36> <iznos> (npr. !rulet crvena 100)`);
        return;
    }

    // Pametno prepoznavanje: !rulet crvena 100 ILI !rulet 100 crvena
    let optionRaw = '';
    let amountRaw = '';

    const validOptions = new Set(['crvena', 'red', 'crna', 'black', 'par', 'even', 'nepar', 'odd']);
    const a1 = (arg1Raw || '').toLowerCase().trim();
    const a2 = (arg2Raw || '').toLowerCase().trim();

    // Ako je prosleđen samo jedan argument:
    if (a1 && !a2) {
        const isSingleNumber = !isNaN(parseInt(a1, 10)) && parseInt(a1, 10) >= 0 && parseInt(a1, 10) <= 36;
        if (validOptions.has(a1) || isSingleNumber) {
            // Uneta je samo opcija (npr. !rulet crvena ili !rulet 7), ulog fali
            optionRaw = a1;
            amountRaw = '';
        } else {
            // Unet je ulog (npr. !rulet 100 ili !rulet all), ali fali opcija
            posaljiPoruku(chatroomId, `🎡 @${cleanSender}, izaberi opciju za rulet! Upotreba: !rulet <crvena/crna/par/nepar/0-36> ${arg1Raw} (npr. !rulet crvena ${arg1Raw})`);
            return;
        }
    } else if (validOptions.has(a2)) {
        amountRaw = arg1Raw;
        optionRaw = arg2Raw;
    } else if (validOptions.has(a1)) {
        optionRaw = arg1Raw;
        amountRaw = arg2Raw;
    } else {
        const n1 = parseInt(a1, 10);
        const n2 = parseInt(a2, 10);
        if (!isNaN(n1) && n1 >= 0 && n1 <= 36 && !isNaN(n2)) {
            // !rulet 7 100
            optionRaw = arg1Raw;
            amountRaw = arg2Raw;
        } else if (!isNaN(n2) && n2 >= 0 && n2 <= 36 && !isNaN(n1)) {
            // !rulet 100 7
            amountRaw = arg1Raw;
            optionRaw = arg2Raw;
        } else {
            optionRaw = arg1Raw;
            amountRaw = arg2Raw;
        }
    }

    const p = proveriUlog(chatroomId, sender, amountRaw, 'rulet');
    if (!p.valid) return;

    const opcija = optionRaw.toLowerCase().trim();
    const crveniBrojevi = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    const crniBrojevi   = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35];

    const isColorBet = (opcija === 'crvena' || opcija === 'red' || opcija === 'crna' || opcija === 'black');
    const isParityBet = (opcija === 'par' || opcija === 'even' || opcija === 'nepar' || opcija === 'odd');
    const ciljniBroj = parseInt(opcija, 10);
    const isNumberBet = (!isNaN(ciljniBroj) && ciljniBroj >= 0 && ciljniBroj <= 36);

    if (!isColorBet && !isParityBet && !isNumberBet) {
        posaljiPoruku(chatroomId, `❌ @${cleanSender}, neispravna opcija! Izaberi crvena/crna/par/nepar ili broj 0-36.`);
        return;
    }

    const risk = izracunajKockarskiRizik(p.iznos, p.maxGamble, p.user);

    // Evropski rulet (0 do 36, jedno zeleno polje 0):
    // Na malom betu: fer šanse (18/37 = 48.65% za crvenu/crnu/par/nepar) i punih 2.0x isplata!
    // Na velikom betu / maxbetu: kuća povećava verovatnoću zelene nule ili suprotne boje (teže sa većim betom):
    let loptica;
    const roll = Math.random();

    if (isNumberBet) {
        // Za pojedinačni broj:
        // Mali bet: šansa 1 u 37 (~2.7%) sa 36x isplatom
        // Ogroman bet: šansa pada na ~1.5%
        const hitNumberChance = Math.max(0.015, (1 / 37) - (risk * 0.012));
        if (roll < hitNumberChance) {
            loptica = ciljniBroj;
        } else {
            loptica = Math.floor(Math.random() * 37);
            if (loptica === ciljniBroj) loptica = (ciljniBroj + 1) % 37;
        }
    } else {
        // Boja ili par/nepar:
        // Na sitnom betu: ~48.6% šansa za pobedu (fer rulet sa 2x isplatom)
        // Na max betu: šansa pada na ~28%
        const winChance = Math.max(0.28, 0.486 - (risk * 0.20));
        const shouldWin = roll < winChance;

        if (shouldWin) {
            // Generiši dobitni broj
            if (opcija === 'crvena' || opcija === 'red') {
                loptica = crveniBrojevi[Math.floor(Math.random() * crveniBrojevi.length)];
            } else if (opcija === 'crna' || opcija === 'black') {
                loptica = crniBrojevi[Math.floor(Math.random() * crniBrojevi.length)];
            } else if (opcija === 'par' || opcija === 'even') {
                const parni = [...crveniBrojevi, ...crniBrojevi].filter(n => n % 2 === 0);
                loptica = parni[Math.floor(Math.random() * parni.length)];
            } else {
                const neparni = [...crveniBrojevi, ...crniBrojevi].filter(n => n % 2 !== 0);
                loptica = neparni[Math.floor(Math.random() * neparni.length)];
            }
        } else {
            // Generiši gubitnički broj
            const greenBias = (risk > 0.5 && Math.random() < 0.20);
            if (greenBias) {
                loptica = 0;
            } else if (opcija === 'crvena' || opcija === 'red') {
                loptica = crniBrojevi[Math.floor(Math.random() * crniBrojevi.length)];
            } else if (opcija === 'crna' || opcija === 'black') {
                loptica = crveniBrojevi[Math.floor(Math.random() * crveniBrojevi.length)];
            } else if (opcija === 'par' || opcija === 'even') {
                const neparni = [...crveniBrojevi, ...crniBrojevi].filter(n => n % 2 !== 0);
                loptica = neparni[Math.floor(Math.random() * neparni.length)];
            } else {
                const parni = [...crveniBrojevi, ...crniBrojevi].filter(n => n % 2 === 0);
                loptica = parni[Math.floor(Math.random() * parni.length)];
            }
        }
    }

    const jeZelena = (loptica === 0);
    const jeCrvena = crveniBrojevi.includes(loptica);
    const bojaLoptice = jeZelena ? 'Zelena 🟢' : (jeCrvena ? 'Crvena 🔴' : 'Crna ⚫');

    let pobeda = false;
    let mnozilac = 0;

    if (opcija === 'crvena' || opcija === 'red')        { if (jeCrvena && !jeZelena) { pobeda = true; mnozilac = 2.0; } }
    else if (opcija === 'crna' || opcija === 'black')   { if (!jeCrvena && !jeZelena) { pobeda = true; mnozilac = 2.0; } }
    else if (opcija === 'par' || opcija === 'even')     { if (!jeZelena && loptica % 2 === 0) { pobeda = true; mnozilac = 2.0; } }
    else if (opcija === 'nepar' || opcija === 'odd')    { if (!jeZelena && loptica % 2 !== 0) { pobeda = true; mnozilac = 2.0; } }
    else if (isNumberBet)                                { if (loptica === ciljniBroj) { pobeda = true; mnozilac = 36.0; } }

    if (pobeda) {
        const dobitak = Math.floor(p.iznos * mnozilac);
        p.user.coins = (p.user.coins || 0) - p.iznos + dobitak;
        zabeleziIshod(p.user, true);
        posaljiPoruku(chatroomId, `🎡 Loptica je pala na ${loptica} (${bojaLoptice})! @${p.cleanSender} je POBEDIO i osvojio +${dobitak.toLocaleString()} ${p.valuta}! 🎉`);
    } else {
        p.user.coins = (p.user.coins || 0) - p.iznos;
        zabeleziIshod(p.user, false);
        posaljiPoruku(chatroomId, `🎡 Loptica je pala na ${loptica} (${bojaLoptice})! @${p.cleanSender} je izgubio ${p.iznos.toLocaleString()} ${p.valuta}! 💸`);
    }
    markirajDirtyIZaplanujSave(p.channelState, chatroomId, p.userKey);
}

// ─── KOMANDA: !coinflip / !piskoglava [pismo/glava] [iznos] ──────────────────
function handleCoinflip(chatroomId, sender, arg1Raw, arg2Raw) {
    const cleanSender = sanitizeInput(sender);
    if (!arg1Raw && !arg2Raw) {
        posaljiPoruku(chatroomId, `🪙 @${cleanSender}, upotreba: !coinflip <pismo/glava> <iznos> (npr. !coinflip glava 100)`);
        return;
    }

    // Pametno prepoznavanje: !coinflip glava 100 ILI !coinflip 100 glava ILI !coinflip 100
    let sideRaw = '';
    let amountRaw = '';

    const validSides = new Set(['pismo', 'p', 'glava', 'g']);
    const a1 = (arg1Raw || '').toLowerCase().trim();
    const a2 = (arg2Raw || '').toLowerCase().trim();

    if (validSides.has(a2)) {
        amountRaw = arg1Raw;
        sideRaw = arg2Raw;
    } else if (validSides.has(a1)) {
        sideRaw = arg1Raw;
        amountRaw = arg2Raw;
    } else if (arg1Raw && !arg2Raw) {
        if (validSides.has(a1)) {
            sideRaw = a1;
            amountRaw = '';
        } else {
            sideRaw = 'glava';
            amountRaw = arg1Raw;
        }
    } else {
        sideRaw = arg1Raw;
        amountRaw = arg2Raw;
    }

    const p = proveriUlog(chatroomId, sender, amountRaw, 'coinflip');
    if (!p.valid) return;

    const stranaInput = sideRaw.toLowerCase().trim();
    let izabranaStrana = '';
    if (stranaInput === 'pismo' || stranaInput === 'p')       izabranaStrana = 'pismo';
    else if (stranaInput === 'glava' || stranaInput === 'g')  izabranaStrana = 'glava';
    else {
        posaljiPoruku(chatroomId, `❌ @${cleanSender}, izaberi 'pismo' ili 'glava'! (npr. !coinflip glava 100)`);
        return;
    }

    const risk = izracunajKockarskiRizik(p.iznos, p.maxGamble, p.user);

    // Šansa za pad na ivicu:
    // Mali bet: samo 2% šanse za ivicu
    // Visok ulog / maxbet: do 6% šanse
    const edgeChance = 0.02 + (risk * 0.04);

    // Povećane šanse za dobitak na manjim ulozima, znatno teže sa većim ulogom:
    // Mali ulog (risk ~ 0.0): 49% šansa za pobedu (fer, zabavno)
    // Srednji ulog (risk ~ 0.5): 40% šansa za pobedu
    // Max bet / all-in (risk ~ 1.0): 28% šansa za pobedu (kuća se brani od velikih uloga)
    const winChance = Math.max(0.26, 0.49 - (risk * 0.22));

    const roll = Math.random();

    if (roll > (1.0 - edgeChance)) {
        p.user.coins = (p.user.coins || 0) - p.iznos;
        zabeleziIshod(p.user, false);
        posaljiPoruku(chatroomId, `🪙 Novčić se zaustavio na IVICI! @${p.cleanSender} je izgubio ${p.iznos.toLocaleString()} ${p.valuta}! Kuća nosi ulog! 💸`);
        markirajDirtyIZaplanujSave(p.channelState, chatroomId, p.userKey);
        return;
    }

    const pobeda = roll < winChance;
    const ishod = pobeda ? izabranaStrana : (izabranaStrana === 'pismo' ? 'glava' : 'pismo');

    if (pobeda) {
        p.user.coins = (p.user.coins || 0) + p.iznos;
        zabeleziIshod(p.user, true);
        posaljiPoruku(chatroomId, `🪙 Novčić je pao na ${ishod.toUpperCase()}! @${p.cleanSender} je pogodio i osvojio +${p.iznos.toLocaleString()} ${p.valuta}! 💥`);
    } else {
        p.user.coins = (p.user.coins || 0) - p.iznos;
        zabeleziIshod(p.user, false);
        posaljiPoruku(chatroomId, `🪙 Novčić je pao na ${ishod.toUpperCase()}! @${p.cleanSender} je promašio i izgubio ${p.iznos.toLocaleString()} ${p.valuta}! 💸`);
    }
    markirajDirtyIZaplanujSave(p.channelState, chatroomId, p.userKey);
}

// ─── KOMANDA: !duel @user [iznos] ────────────────────────────────────────────
function handleDuel(chatroomId, sender, arg1Raw, arg2Raw) {
    const cleanSender = sanitizeInput(sender);
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    if (!arg1Raw && !arg2Raw) {
        posaljiPoruku(chatroomId, `⚔️ @${cleanSender}, upotreba: !duel @korisnik <iznos> (npr. !duel @user 200)`);
        return;
    }

    // Pametno prepoznavanje: !duel @user 200 ILI !duel 200 @user
    let targetRaw = '';
    let amountRaw = '';

    const isArg1Num = /^\d+$/.test((arg1Raw || '').trim()) || ['all', 'sve', 'half', 'pola'].includes((arg1Raw || '').toLowerCase().trim());
    const isArg2Num = /^\d+$/.test((arg2Raw || '').trim()) || ['all', 'sve', 'half', 'pola'].includes((arg2Raw || '').toLowerCase().trim());

    if (isArg1Num && !isArg2Num && arg2Raw) {
        amountRaw = arg1Raw;
        targetRaw = arg2Raw;
    } else if (isArg2Num) {
        targetRaw = arg1Raw;
        amountRaw = arg2Raw;
    } else {
        if ((arg1Raw || '').startsWith('@')) {
            targetRaw = arg1Raw;
            amountRaw = arg2Raw;
        } else if ((arg2Raw || '').startsWith('@')) {
            targetRaw = arg2Raw;
            amountRaw = arg1Raw;
        } else {
            targetRaw = arg1Raw;
            amountRaw = arg2Raw;
        }
    }

    const target = targetRaw ? targetRaw.split(/\s+/)[0].replace(/^@/, '').trim() : '';
    if (!target || !isValidUsername(target)) {
        posaljiPoruku(chatroomId, `⚔️ @${cleanSender}, označi protivnika i navedi ulog! Upotreba: !duel @korisnik <iznos> (npr. !duel @user 200)`);
        return;
    }

    const p = proveriUlog(chatroomId, sender, amountRaw, 'duel');
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
        posaljiPoruku(chatroomId, `❌ @${cleanTarget} nema dovoljno poena za ovaj dvoboj! (Ima: ${targetCoins.toLocaleString()} ${p.valuta}).`);
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
    const p = proveriUlog(chatroomId, sender, amountRaw, 'tocak');
    if (!p.valid) return;

    const risk = izracunajKockarskiRizik(p.iznos, p.maxGamble, p.user);
    const roll = Math.random() * 100;

    let pick;
    if (risk <= 0.25) {
        // Mali ulog: povećane šanse za dobitak (~48% šansa za profit!)
        if (roll < 32) {
            pick = { label: '0x ❌', mult: 0 };
        } else if (roll < 52) {
            pick = { label: '0.5x 📉', mult: 0.5 };
        } else if (roll < 76) {
            pick = { label: '1.5x 📈', mult: 1.5 };
        } else if (roll < 92) {
            pick = { label: '2.0x 🚀', mult: 2.0 };
        } else if (roll < 98) {
            pick = { label: '3.0x 👑', mult: 3.0 };
        } else {
            pick = { label: '5.0x 💎 JACKPOT', mult: 5.0 };
        }
    } else if (risk <= 0.65) {
        // Srednji ulog
        if (roll < 45) {
            pick = { label: '0x ❌', mult: 0 };
        } else if (roll < 68) {
            pick = { label: '0.5x 📉', mult: 0.5 };
        } else if (roll < 86) {
            pick = { label: '1.4x 📈', mult: 1.4 };
        } else if (roll < 96) {
            pick = { label: '2.0x 🚀', mult: 2.0 };
        } else {
            pick = { label: '3.0x 👑', mult: 3.0 };
        }
    } else {
        // Veliki bet / maxbet: teže sa većim betom i kuća uzima više
        if (roll < 65) {
            pick = { label: '0x ❌', mult: 0 };
        } else if (roll < 85) {
            pick = { label: '0.3x 📉', mult: 0.3 };
        } else if (roll < 94) {
            pick = { label: '1.0x 🔄', mult: 1.0 };
        } else if (roll < 98.5) {
            pick = { label: '1.5x 📈', mult: 1.5 };
        } else {
            pick = { label: '2.5x 👑', mult: 2.5 };
        }
    }

    const dobitak = Math.floor(p.iznos * pick.mult);
    const razlika = dobitak - p.iznos;

    p.user.coins = (p.user.coins || 0) + razlika;
    if (razlika > 0) zabeleziIshod(p.user, true);
    else if (razlika < 0) zabeleziIshod(p.user, false);

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
    izracunajKockarskiRizik,
    zabeleziIshod,
    handleLimit,
    handleSlots,
    handleRoulette,
    handleCoinflip,
    handleWheel,
    handleDuel,
    handleAcceptDuel,
    handleDeclineDuel
};
