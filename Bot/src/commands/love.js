const state = require('../state');
const { log, isValidUsername, sanitizeInput } = require('../utils');
const { supabase, KORISTI_SUPABASE, osigurajCuvanjeLjubavi } = require('../database');
const { posaljiPoruku } = require('../messenger');

// Pomoćna funkcija za podrazumevanu ljubav
function getDefaultLove(_u1, _u2) {
    return 0; // Svi parovi po defaultu kreću sa 0%
}

// ─── LJUBAVNI KALKULATOR ──────────────────────────────────────────────────────
function handleLove(chatroomId, sender, args) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    if (!args) {
        posaljiPoruku(chatroomId, 'Upotreba: !love @user1 @user2 ili !love @user');
        return;
    }

    const delovi = args.split(/\s+/).filter(Boolean);
    let user1 = '';
    let user2 = '';

    // Filtriramo samo prave @mention tokene — ignoriše obične reči kao srpski veznik "i"
    const mentions = delovi.filter(d => d.startsWith('@'));

    if (mentions.length >= 2) {
        // Dve @mention oznake — !love @user1 @user2 (ignorišemo sve između)
        user1 = mentions[0];
        user2 = mentions[1];
    } else if (mentions.length === 1) {
        // Jedna @mention — !love @user → sender voli user
        user1 = sender;
        user2 = mentions[0];
    } else if (delovi.length === 1) {
        // Bez @ — !love user → sender voli user
        user1 = sender;
        user2 = delovi[0];
    } else {
        // Višestruke reči bez @, ne znamo ko je target
        posaljiPoruku(chatroomId, 'Upotreba: !love @user1 @user2 ili !love @user');
        return;
    }

    const u1 = user1.replace(/^@/, '').trim();
    const u2 = user2.replace(/^@/, '').trim();

    if (!u1 || !u2) {
        posaljiPoruku(chatroomId, 'Upotreba: !love @user1 @user2 ili !love @user');
        return;
    }

    if (!isValidUsername(u1) || !isValidUsername(u2)) {
        posaljiPoruku(chatroomId, '❌ Nevalidno korisničko ime.');
        return;
    }

    const cleanU1 = sanitizeInput(u1);
    const cleanU2 = sanitizeInput(u2);

    if (cleanU1.toLowerCase() === cleanU2.toLowerCase()) {
        posaljiPoruku(chatroomId, `❤️ Ljubav prema samom sebi? To je uvek 100%! 🥰 Bravo @${cleanU1}, ceni sebe!`);
        return;
    }

    const kljucMod = [cleanU1.toLowerCase(), cleanU2.toLowerCase()].sort().join('::');
    const baza = getDefaultLove(cleanU1, cleanU2);
    const modifikator = channelState.loveModifiers[kljucMod] || 0;

    let procenat = baza + modifikator;
    procenat = Math.max(-100, Math.min(100, procenat));

    let komentar = '';
    if (procenat < 0) {
        komentar = 'Potpuna mržnja i toksičnost! Bežite jedno od drugog! 🤮💀';
    } else if (procenat <= 15) {
        komentar = 'Nema tu hleba... 😭💔';
    } else if (procenat <= 35) {
        komentar = 'Prijateljska zona (Friendzone) 5/5. Više sreće drugi put. 🤝';
    } else if (procenat <= 60) {
        komentar = 'Ima nekih varnica, ali duva vetar pa ih gasi. Radite na tome! 💨⚡';
    } else if (procenat <= 85) {
        komentar = 'Opa! Ovde se nešto ozbiljno kuva. Spremajte odelo za svadbu! 🤵👰';
    } else {
        komentar = 'Savršen par, čista hemija i večna ljubav! ❤️🔥';
    }

    posaljiPoruku(chatroomId, `❤️ Ljubavni Kalkulator: @${cleanU1} + @${cleanU2} = ${procenat}% | Komentar: ${komentar}`);
}

// ─── KALKULATOR MRŽNJE (!mrzim) ──────────────────────────────────────────────
function handleMrzim(chatroomId, sender, args) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const delovi = (args || '').split(/\s+/).filter(Boolean);
    let user1 = '';
    let user2 = '';

    const mentions = delovi.filter(d => d.startsWith('@'));
    if (mentions.length >= 2) {
        user1 = mentions[0];
        user2 = mentions[1];
    } else if (mentions.length === 1) {
        user1 = sender;
        user2 = mentions[0];
    } else if (delovi.length === 1) {
        user1 = sender;
        user2 = delovi[0];
    } else {
        posaljiPoruku(chatroomId, 'Upotreba: !mrzim @user ili !mrzim @user1 @user2');
        return;
    }

    const u1 = user1.replace(/^@/, '').trim();
    const u2 = user2.replace(/^@/, '').trim();

    if (!u1 || !u2) {
        posaljiPoruku(chatroomId, 'Upotreba: !mrzim @user ili !mrzim @user1 @user2');
        return;
    }

    if (!isValidUsername(u1) || !isValidUsername(u2)) {
        posaljiPoruku(chatroomId, '❌ Nevalidno korisničko ime.');
        return;
    }

    const cleanU1 = sanitizeInput(u1);
    const cleanU2 = sanitizeInput(u2);

    if (cleanU1.toLowerCase() === cleanU2.toLowerCase()) {
        posaljiPoruku(chatroomId, `🖤 Mržnja prema samom sebi? Nemoj tako @${cleanU1}, voli sebe! 🥰`);
        return;
    }

    const kljucMod = [cleanU1.toLowerCase(), cleanU2.toLowerCase()].sort().join('::');
    const baza = getDefaultLove(cleanU1, cleanU2);
    const modifikator = channelState.loveModifiers ? (channelState.loveModifiers[kljucMod] || 0) : 0;
    let procenatLjubavi = baza + modifikator;
    procenatLjubavi = Math.max(-100, Math.min(100, procenatLjubavi));

    // Inverzna formula za mržnju: kada je ljubav 100% -> mržnja 0%, kada je ljubav -100% -> mržnja 100%
    let procenatMrznje = Math.round(((100 - procenatLjubavi) / 200) * 100);
    procenatMrznje = Math.max(0, Math.min(100, procenatMrznje));

    let komentar = '';
    if (procenatMrznje < 15) {
        komentar = 'Ovde nema ni trunke mržnje, čista harmonija i ljubav! ❤️✨';
    } else if (procenatMrznje <= 40) {
        komentar = 'Mala neslaganja, ali generalno se dobro podnosite. 🤝';
    } else if (procenatMrznje <= 65) {
        komentar = 'Netrpeljivost se oseća u vazduhu, varnice sevaju! ⚡👀';
    } else if (procenatMrznje <= 85) {
        komentar = 'Ozbiljan hejt! Bolje se zaobilazite u širokom luku! 🤺🔥';
    } else {
        komentar = 'Apsolutna toksičnost i neprijateljstvo veka! Krvni neprijatelji! ☠️💣';
    }

    posaljiPoruku(chatroomId, `🖤 Kalkulator Mržnje: @${cleanU1} i @${cleanU2} = ${procenatMrznje}% mržnje | Komentar: ${komentar}`);
}

function handleModifyLove(chatroomId, sender, targetRaw, amount) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return false;

    const target = targetRaw.split(/\s+/)[0].replace(/^@/, '').trim();
    if (!target) {
        posaljiPoruku(chatroomId, 'Upotreba: !posaljiljubav @user ili !bacihejt @user');
        return false;
    }

    if (!isValidUsername(sender) || !isValidUsername(target)) {
        posaljiPoruku(chatroomId, '❌ Nevalidno korisničko ime.');
        return false;
    }

    const cleanSender = sanitizeInput(sender);
    const cleanTarget = sanitizeInput(target);

    const sLower = cleanSender.toLowerCase();
    const tLower = cleanTarget.toLowerCase();

    if (sLower === tLower) {
        posaljiPoruku(chatroomId, `@${cleanSender}, ne možeš modifikovati ljubav prema samom sebi! 😄`);
        return false;
    }

    const kljucMod = [sLower, tLower].sort().join('::');
    if (!channelState.loveModifiers[kljucMod]) {
        channelState.loveModifiers[kljucMod] = 0;
    }

    channelState.loveModifiers[kljucMod] = Math.max(-100, Math.min(100, channelState.loveModifiers[kljucMod] + amount));

    const baza = getDefaultLove(sLower, tLower);
    let noviProcenat = baza + channelState.loveModifiers[kljucMod];
    noviProcenat = Math.max(-100, Math.min(100, noviProcenat));

    if (amount > 0) {
        posaljiPoruku(chatroomId, `💖 @${cleanSender} šalje ljubav za @${cleanTarget}! Ljubav je skočila za +${amount}%! Novi status: ${noviProcenat}%. ✨`);
    } else {
        posaljiPoruku(chatroomId, `💔 @${cleanSender} šalje hejt za @${cleanTarget}! Ljubav je pala za ${Math.abs(amount)}%! Novi status: ${noviProcenat}%. 🌪️`);
    }
    if (!channelState.dirtyLoveKeys) channelState.dirtyLoveKeys = new Set();
    channelState.dirtyLoveKeys.add(kljucMod);
    if (!channelState.loveMetadata) channelState.loveMetadata = {};
    channelState.loveMetadata[kljucMod] = {
        ...(channelState.loveMetadata[kljucMod] || {}),
        updated_at: new Date().toISOString()
    };
    channelState.loveDirty = true;
    osigurajCuvanjeLjubavi(chatroomId);
    return true;
}

// ─── BRAK I RAZVOD ────────────────────────────────────────────────────────────
function handleVencaj(chatroomId, sender, targetRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const target = targetRaw.split(/\s+/)[0].replace(/^@/, '').trim();
    if (!target) {
        posaljiPoruku(chatroomId, 'Upotreba: !vencaj @user');
        return;
    }

    if (!isValidUsername(sender) || !isValidUsername(target)) {
        posaljiPoruku(chatroomId, '❌ Nevalidno korisničko ime.');
        return;
    }

    const cleanSender = sanitizeInput(sender);
    const cleanTarget = sanitizeInput(target);

    const sLower = cleanSender.toLowerCase();
    const tLower = cleanTarget.toLowerCase();

    if (sLower === tLower) {
        posaljiPoruku(chatroomId, `@${cleanSender}, ne možeš se venčati sa samim sobom! 😂`);
        return;
    }

    const kljucBrak = [sLower, tLower].sort().join('::');

    if (channelState.marriedCouples[kljucBrak]) {
        posaljiPoruku(chatroomId, `💍 @${cleanSender} i @${cleanTarget} su već zvanično u braku! Čuvajte jedno drugo! 🥰`);
        return;
    }

    const baza = getDefaultLove(sLower, tLower);
    const modifikator = channelState.loveModifiers[kljucBrak] || 0;
    let procenat = baza + modifikator;
    procenat = Math.max(-100, Math.min(100, procenat));

    if (procenat < 90) {
        posaljiPoruku(chatroomId, `💔 Venčanje odbijeno! Nemate dovoljno ljubavi (potrebno je bar 90%, a vi imate ${procenat}%). Šaljite ljubav pomoću !posaljiljubav @user!`);
        return;
    }

    channelState.pendingProposals[tLower] = {
        sender: cleanSender,
        target: cleanTarget,
        expires: Date.now() + 60000,
        procenat: procenat
    };

    posaljiPoruku(chatroomId, `💍 @${cleanTarget}, korisnik @${cleanSender} te prosi sa ${procenat}% ljubavi! Otkucaj !prihvati u narednih 60 sekundi da pristaneš, ili !odbij da odbiješ! 🥳🚌🎉`);
}

function handlePrihvatiBrak(chatroomId, receiver) {
    if (!isValidUsername(receiver)) return;
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const cleanReceiver = sanitizeInput(receiver);
    const rLower = cleanReceiver.toLowerCase();
    const proposal = channelState.pendingProposals[rLower];

    if (!proposal) {
        posaljiPoruku(chatroomId, `@${cleanReceiver}, nemaš aktivnih predloga za brak. Prosi nekoga sa !vencaj @user! 😉`);
        return;
    }

    if (Date.now() > proposal.expires) {
        delete channelState.pendingProposals[rLower];
        posaljiPoruku(chatroomId, `@${cleanReceiver}, predlog za brak od korisnika @${proposal.sender} je istekao! ⏰`);
        return;
    }

    if (!isValidUsername(proposal.sender) || !isValidUsername(proposal.target)) {
        delete channelState.pendingProposals[rLower];
        posaljiPoruku(chatroomId, '❌ Greška: Nevalidni podaci u predlogu braka.');
        return;
    }

    const maxCouples = channelState.userPlan === 'free' ? 50 : 999999;
    if (Object.keys(channelState.marriedCouples || {}).length >= maxCouples) {
        delete channelState.pendingProposals[rLower];
        posaljiPoruku(chatroomId, `❌ Dostignuto je ograničenje od 50 bračnih parova (100 venčanih lica) za FREE paket. Nadogradi na PRO za neograničeno na Kickot Dashboard-u!`);
        return;
    }

    const cleanSender = sanitizeInput(proposal.sender);
    const cleanTarget = sanitizeInput(proposal.target);
    const kljucBrak = [cleanSender.toLowerCase(), cleanTarget.toLowerCase()].sort().join('::');

    const weddingIso = new Date().toISOString();
    channelState.marriedCouples[kljucBrak] = {
        user1: cleanSender,
        user2: cleanTarget,
        datum: new Date().toLocaleDateString('sr-RS'),
        married_at: weddingIso
    };
    if (!channelState.loveMetadata) channelState.loveMetadata = {};
    channelState.loveMetadata[kljucBrak] = {
        married_at: weddingIso,
        updated_at: weddingIso
    };
    if (!channelState.dirtyLoveKeys) channelState.dirtyLoveKeys = new Set();
    channelState.dirtyLoveKeys.add(kljucBrak);
    channelState.loveDirty = true;
    osigurajCuvanjeLjubavi(chatroomId);

    if (KORISTI_SUPABASE) {
        (async () => {
            try {
                const [u1, u2] = [cleanSender, cleanTarget].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
                const { error } = await supabase
                    .from('love_and_marriages')
                    .upsert([{
                        channel_id: chatroomId,
                        user1: u1,
                        user2: u2,
                        modifier: channelState.loveModifiers[kljucBrak] ?? 0,
                        is_married: true,
                        married_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }], { onConflict: 'channel_id,user1,user2' });
                if (error) throw error;
                log('INFO', `[${channelState.channelUsername || chatroomId}] Uspješno upisan brak u love_and_marriages za par: ${u1} i ${u2}`);
            } catch (err) {
                log('ERR', `Greška pri upisu braka u Supabase za ${chatroomId}: ${err.message}`);
            }
        })();
    }

    delete channelState.pendingProposals[rLower];

    posaljiPoruku(chatroomId, `💍 ZVANIČNO VENČANI! @${cleanSender} i @${cleanTarget} su stupili u brak sa ${proposal.procenat}% ljubavi! Svadbena zvona zvone, a ekipa u chatu slavi! Nek je sa srećom! 🥳🚌🎉`);
}

function handleOdbijBrak(chatroomId, receiver) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const rLower = receiver.toLowerCase();
    const proposal = channelState.pendingProposals[rLower];

    if (!proposal) {
        posaljiPoruku(chatroomId, `@${receiver}, nemaš aktivnih predloga za brak da ih odbiješ.`);
        return;
    }

    delete channelState.pendingProposals[rLower];
    posaljiPoruku(chatroomId, `💔 Venčanje odbijeno! @${receiver} je odbio/la predlog za brak od korisnika @${proposal.sender}. Više sreće drugi put! 😭`);
}

function handleRazvod(chatroomId, sender, targetRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const target = targetRaw.split(/\s+/)[0].replace(/^@/, '').trim();
    if (!target) {
        posaljiPoruku(chatroomId, 'Upotreba: !razvod @user');
        return;
    }

    if (!isValidUsername(sender) || !isValidUsername(target)) {
        posaljiPoruku(chatroomId, '❌ Nevalidno korisničko ime.');
        return;
    }

    const cleanSender = sanitizeInput(sender);
    const cleanTarget = sanitizeInput(target);
    const sLower = cleanSender.toLowerCase();
    const tLower = cleanTarget.toLowerCase();
    const kljucBrak = [sLower, tLower].sort().join('::');

    if (!channelState.marriedCouples[kljucBrak]) {
        posaljiPoruku(chatroomId, `Vi niste ni u braku sa korisnikom @${cleanTarget}! 😂`);
        return;
    }

    delete channelState.marriedCouples[kljucBrak];
    channelState.loveModifiers[kljucBrak] = (channelState.loveModifiers[kljucBrak] || 0) - 50;
    if (!channelState.loveMetadata) channelState.loveMetadata = {};
    channelState.loveMetadata[kljucBrak] = {
        married_at: null,
        updated_at: new Date().toISOString()
    };
    if (!channelState.dirtyLoveKeys) channelState.dirtyLoveKeys = new Set();
    channelState.dirtyLoveKeys.add(kljucBrak);
    channelState.loveDirty = true;
    osigurajCuvanjeLjubavi(chatroomId);

    if (KORISTI_SUPABASE) {
        (async () => {
            try {
                const [u1, u2] = [sLower, tLower].sort();
                const { error: modError } = await supabase
                    .from('love_and_marriages')
                    .upsert([{
                        channel_id: chatroomId,
                        user1: u1,
                        user2: u2,
                        modifier: channelState.loveModifiers[kljucBrak] ?? 0,
                        is_married: false,
                        married_at: null,
                        updated_at: new Date().toISOString()
                    }], { onConflict: 'channel_id,user1,user2' });
                if (modError) throw modError;

                log('INFO', `[${channelState.channelUsername || chatroomId}] Uspješno ažuriran razvod (is_married: false) u love_and_marriages za par: ${u1} i ${u2}`);
            } catch (err) {
                log('ERR', `Greška pri razvodu u Supabase za ${chatroomId}: ${err.message}`);
            }
        })();
    }

    posaljiPoruku(chatroomId, `💔 TUŽNE VESTI: @${cleanSender} i @${cleanTarget} su se razveli! Papiri su potpisani, a svadbeni bus je prazan. Ljubav im je drastično opala za -50%! 😭😭`);
}

function handleBrakovi(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    let parovi = Object.values(channelState.marriedCouples);

    if (parovi.length === 0) {
        posaljiPoruku(chatroomId, '💍 Niko na strimu još nije u braku! Budite prvi: skupite 90%+ ljubavi i kucajte !vencaj @user!');
        return;
    }

    if (channelState.userPlan === 'free' && parovi.length > 50) {
        parovi = parovi.slice(0, 50);
    }

    const lista = parovi.map(p => `@${p.user1} ❤️ @${p.user2} (od ${p.datum})`).join(', ');
    posaljiPoruku(chatroomId, `💍 Venčani parovi na strimu: ${lista}`);
}

module.exports = {
    getDefaultLove,
    handleLove,
    handleMrzim,
    handleModifyLove,
    handleVencaj,
    handlePrihvatiBrak,
    handleOdbijBrak,
    handleRazvod,
    handleBrakovi
};
