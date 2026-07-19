const config = require('./config');
const state = require('./state');
const { log, isValidUsername, sanitizeInput, proveraKulauna, prevediVreme, dobijTrenutniMesec } = require('./utils');
const { supabase, KORISTI_SUPABASE, osigurajCuvanjeLjubavi, sacuvajLeaderboard } = require('./database');
const { posaljiPoruku, posaljiIPinujPoruku, odpinujPoruku } = require('./messenger');

// Pomoćna funkcija za podrazumevanu ljubav
function getDefaultLove(u1, u2) {
    return 0; // Svi parovi po defaultu kreću sa 0%
}

// ─── IQ TEST ─────────────────────────────────────────────────────────────────
function handleIq(chatroomId, sender, targetRaw) {
    const target = targetRaw.split(/\s+/)[0].replace(/^@/, '').trim();
    if (target && !isValidUsername(target)) {
        posaljiPoruku(chatroomId, '❌ Nevalidno korisničko ime.');
        return;
    }
    if (!isValidUsername(sender)) return;

    const cleanSender = sanitizeInput(sender);
    const cleanTarget = target ? sanitizeInput(target) : '';
    const user = cleanTarget ? cleanTarget : cleanSender;
    const iq = Math.floor(Math.random() * 121) + 40; 
    
    let komentar = '';
    if (iq < 70) {
        komentar = 'Sobna temperatura, ali zimi sa ugašenim grejanjem. 🥶';
    } else if (iq < 90) {
        komentar = 'Dovoljno da razlikuješ vrata od prozora. 🚪';
    } else if (iq < 110) {
        komentar = 'Prosečni Balkanac, stručnjak za fudbal i politiku ispred prodavnice. 🍺';
    } else if (iq < 130) {
        komentar = 'Pametnica! Možeš da sklopiš Lego set bez uputstva. 🧠';
    } else {
        komentar = 'Genije! Milanov lični asistent i sledeća generacija AI-ja. 🤖🔥';
    }
    
    posaljiPoruku(chatroomId, `🧠 IQ Test za @${user}: ${iq} | Komentar: ${komentar}`);
}

// ─── ŠAMAR ───────────────────────────────────────────────────────────────────
function handleSamar(chatroomId, sender, targetRaw) {
    const target = targetRaw.split(/\s+/)[0].replace(/^@/, '').trim();
    if (!target) {
        posaljiPoruku(chatroomId, `@${sender}, moraš tag-ovati nekoga koga želiš da ošamariš! 👋`);
        return;
    }

    if (!isValidUsername(sender) || !isValidUsername(target)) {
        posaljiPoruku(chatroomId, '❌ Nevalidno korisničko ime.');
        return;
    }

    const cleanSender = sanitizeInput(sender);
    const cleanTarget = sanitizeInput(target);
    
    if (cleanSender.toLowerCase() === cleanTarget.toLowerCase()) {
        posaljiPoruku(chatroomId, `@${cleanSender} je pokušao da ošamari samog sebe i promašio! Kakav fail. 😂`);
        return;
    }
    
    const predmeti = [
        'vlažnom pastrmkom 🐟',
        'starom tastaturom iz 2004. godine ⌨️',
        'hladnim parčetom jučerašnje pice 🍕',
        'pocepanom papučom 🩴',
        'mokrom krpom direktno po licu 🧼',
        'telefonom sa polomljenim ekranom 📱',
        'kartonom pokvarenih jaja 🥚🤢',
        'zvučnim šamarom iz zaleta 👋💥',
        '67 jajetom 🥚',
        'pokvarenim parizerom iz Maksija 🥩',
        'biber sprejem direktno u oči 🌶️👀',
        'punom plastičnom flašom dvolitre piva 🍺💥',
        'neplaćenim računom za struju ⚡🧾',
        'čarapom koja nije prana 3 meseca 🧦🤢',
        'tvrdom zelenom bananom iz Lidla 🍌',
        'plastičnom stolicom sa strima 🪑💥',
        'porukom od bivše u 3 ujutru 💔📱'
    ];
    
    const predmet = predmeti[Math.floor(Math.random() * predmeti.length)];
    posaljiPoruku(chatroomId, `👋 @${cleanSender} je zalepio šamarčinu korisniku @${cleanTarget} sa ${predmet}!`);
}

// ─── ROLL ────────────────────────────────────────────────────────────────────
function handleRoll(chatroomId, sender, targetRaw) {
    const target = targetRaw.split(/\s+/)[0].replace(/^@/, '').trim();
    if (!target) {
        posaljiPoruku(chatroomId, `${sender}, moraš tag-ovati nekoga za roll dvoboj! 🎲`);
        return;
    }

    if (!isValidUsername(sender) || !isValidUsername(target)) {
        posaljiPoruku(chatroomId, '❌ Nevalidno korisničko ime.');
        return;
    }

    const cleanSender = sanitizeInput(sender);
    const cleanTarget = sanitizeInput(target);

    const challenger = cleanSender;
    const opponent = cleanTarget;

    if (challenger.toLowerCase() === opponent.toLowerCase()) {
        posaljiPoruku(chatroomId, `${cleanSender}, ne možeš igrati roll dvoboj protiv samog sebe! 😄`);
        return;
    }

    const roll1 = Math.floor(Math.random() * 100) + 1;
    const roll2 = Math.floor(Math.random() * 100) + 1;

    let pobednik = '';
    let komentar = '';

    const EMOTE_67 = '👑👑👑';

    if (roll1 === 67 && roll2 === 67) {
        posaljiPoruku(chatroomId, `🎲 @${challenger} [67] vs @${opponent} [67] | 😱 Legendarno nerešeno! ${EMOTE_67}`);
        return;
    } else if (roll1 === 67) {
        pobednik = challenger;
        komentar = `✨ @${challenger} ima legendarnih 67! ${EMOTE_67} AUTOMATSKA POBEDA! ✨`;
    } else if (roll2 === 67) {
        pobednik = opponent;
        komentar = `✨ @${opponent} ima legendarnih 67! ${EMOTE_67} AUTOMATSKA POBEDA! ✨`;
    } else {
        if (roll1 > roll2) {
            pobednik = challenger;
        } else if (roll2 > roll1) {
            pobednik = opponent;
        }
    }

    if (pobednik) {
        const pobedaKomentar = komentar ? komentar : `🏆 Pobeda za @${pobednik}!`;
        posaljiPoruku(chatroomId, `🎲 Roll Dvoboj: @${challenger} rezultat [${roll1}] vs @${opponent} rezultat [${roll2}]! ${pobedaKomentar}`);
    } else {
        posaljiPoruku(chatroomId, `🎲 Roll Dvoboj: @${challenger} rezultat [${roll1}] vs @${opponent} rezultat [${roll2}]! Rezultat je nerešen! 🤝`);
    }
}

// ─── DUEL ────────────────────────────────────────────────────────────────────
function handleDuel(chatroomId, sender, meta) {
    const args = meta.split(/\s+/).filter(Boolean);
    if (args.length === 0) {
        posaljiPoruku(chatroomId, `${sender}, moraš tag-ovati nekoga za duel! ⚔️`);
        return;
    }

    if (!isValidUsername(sender)) return;
    const cleanSender = sanitizeInput(sender);

    let challenger = '';
    let opponent = '';

    if (args.length === 1) {
        challenger = cleanSender;
        opponent = args[0].replace(/^@/, '').trim();
    } else {
        challenger = args[0].replace(/^@/, '').trim();
        opponent = args[1].replace(/^@/, '').trim();
    }

    if (!isValidUsername(challenger) || !isValidUsername(opponent)) {
        posaljiPoruku(chatroomId, '❌ Nevalidno korisničko ime.');
        return;
    }

    const cleanChallenger = sanitizeInput(challenger);
    const cleanOpponent = sanitizeInput(opponent);

    if (!cleanOpponent || cleanChallenger.toLowerCase() === cleanOpponent.toLowerCase()) {
        posaljiPoruku(chatroomId, `${cleanSender}, duel između iste osobe nije moguć! 😄`);
        return;
    }

    const pobednik = Math.random() < 0.5 ? cleanChallenger : cleanOpponent;
    const gubitnik = pobednik === cleanChallenger ? cleanOpponent : cleanChallenger;
    const rezultati = [
        `⚔️ ${cleanChallenger} vs ${cleanOpponent} — Pobednički skor 100-0 za korisnika ${pobednik}! ${gubitnik} ostaje bez poena. 💥`,
        `🥊 ${cleanChallenger} vs ${cleanOpponent} — Nokaut u prvoj rundi! ${pobednik} slavi pobedu, ${gubitnik} pada na pod. 💥`,
        `🎯 ${cleanChallenger} vs ${cleanOpponent} — Brzi headshot! ${pobednik} uzima rundu, ${gubitnik} ide na respawn od 30s. 💀`,
        `🔫 ${cleanChallenger} vs ${cleanOpponent} — ${pobednik} odnosi pobedu uz FATALITY! ${gubitnik} — get rekt. 😈`,
        `⚡ ${cleanChallenger} vs ${cleanOpponent} — Velika brzina igrača ${pobednik}! ${gubitnik} ne zna šta ga je snašlo! ⚡`,
        `🛡️ ${cleanChallenger} vs ${cleanOpponent} — Mod odbrana igrača ${gubitnik} ne pomaže, ${pobednik} odnosi pobedu jednim udarcem! 🛡️`,
        `💨 ${cleanChallenger} vs ${cleanOpponent} — ${gubitnik} beži sa megdana! Nova titula šampiona ide za igrača ${pobednik}! 🏃💨`,
        `🧙‍♂️ ${cleanChallenger} vs ${cleanOpponent} — Magični trik! ${pobednik} pretvara igrača ${gubitnik} u žabu! 🐸`,
        `🦴 ${cleanChallenger} vs ${cleanOpponent} — Potpuna dominacija! ${pobednik} nanosi težak poraz za ${gubitnik}! 🔥`,
        `🍌 ${cleanChallenger} vs ${cleanOpponent} — Nesrećan pad! ${gubitnik} gubi duel zbog kore od banane, ${pobednik} slavi! 🍌`,
        `🎮 ${cleanChallenger} vs ${cleanOpponent} — Korišćenje šifre! ${pobednik} uzima pobedu u sekundi! EZ PZ! 🎮`,
        `🦖 ${cleanChallenger} vs ${cleanOpponent} — Prizivanje zveri! T-Rex u službi igrača ${pobednik} eliminiše igrača ${gubitnik}! 🦖`,
        `🚌 ${cleanChallenger} vs ${cleanOpponent} — Svadbeni bus gazi sve pred sobom! ${pobednik} odnosi pobedu protiv ${gubitnik}! 🚌💨`,
        `⌨️ ${cleanChallenger} vs ${cleanOpponent} — Tastatura leti kroz vazduh! ${pobednik} tera igrača ${gubitnik} na RAGE QUIT! ⌨️💥`,
        `🤼 ${cleanChallenger} vs ${cleanOpponent} — RKO iz vedra neba! ${pobednik} pogađa, ${gubitnik} gubi ravnotežu! 🤼‍♂️💥`,
        `👟 ${cleanChallenger} vs ${cleanOpponent} — Leteća patika! ${pobednik} pogađa metu, ${gubitnik} ide u aut! 👟🎯`,
        `💤 ${cleanChallenger} vs ${cleanOpponent} — ${gubitnik} spava usred borbe! Lagana pobeda za igrača ${pobednik}! 💤`,
        `🎵 ${cleanChallenger} vs ${cleanOpponent} — Koncert na mikrofonu! ${pobednik} peva narodnjake, ${gubitnik} predaje meč u suzama! 🎶😭`
    ];
    const poruka = rezultati[Math.floor(Math.random() * rezultati.length)];
    posaljiPoruku(chatroomId, poruka);
}

// ─── RUSKI RULET ─────────────────────────────────────────────────────────────
function handleRulet(chatroomId, sender) {
    if (!isValidUsername(sender)) return;
    const cleanSender = sanitizeInput(sender);
    const komore = [false, false, false, false, false, true]; // 1 u 6 šansa
    const metak = komore[Math.floor(Math.random() * komore.length)];
    if (metak) {
        const porazi = [
            `💀 *KLIK*... BUM! @${cleanSender} je popio metak u ruskom ruletu! Bolje sreće u sledećem životu. 🪦`,
            `💀 *KLIK*... ŠKLJOC... BUM! @${cleanSender} je izvukao kraći kraj. Počivaj u miru! 🥀`,
            `💀 *KLIK*... BUM! @${cleanSender} je eliminisan iz četa (simulirano)! Kakav hrabar, ali tragičan pokušaj! 🔫`
        ];
        posaljiPoruku(chatroomId, porazi[Math.floor(Math.random() * porazi.length)]);
    } else {
        const prezivljavanja = [
            `🔫 *KLIK*... Prazno! @${cleanSender} je preživeo ovu rundu ruskog ruleta. Znoj se cedi sa čela... 😰`,
            `🔫 *KLIK*... Tišina. Srce kuca ubrzano, ali @${cleanSender} je još uvek živ! Sreća te prati danas! 🍀`,
            `🔫 *KLIK*... Ništa! @${cleanSender} se samo nasmejao sudbini u lice. Sledeći! 😎`
        ];
        posaljiPoruku(chatroomId, prezivljavanja[Math.floor(Math.random() * prezivljavanja.length)]);
    }
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

    if (delovi.length === 1) {
        user1 = sender;
        user2 = delovi[0];
    } else {
        user1 = delovi[0];
        user2 = delovi[1];
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

    channelState.loveModifiers[kljucMod] += amount;

    const baza = getDefaultLove(sLower, tLower);
    let noviProcenat = baza + channelState.loveModifiers[kljucMod];
    noviProcenat = Math.max(-100, Math.min(100, noviProcenat));

    if (amount > 0) {
        posaljiPoruku(chatroomId, `💖 @${cleanSender} šalje ljubav za @${cleanTarget}! Ljubav je skočila za +${amount}%! Novi status: ${noviProcenat}%. ✨`);
    } else {
        posaljiPoruku(chatroomId, `💔 @${cleanSender} šalje hejt za @${cleanTarget}! Ljubav je pala za ${Math.abs(amount)}%! Novi status: ${noviProcenat}%. 🌪️`);
    }
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

    const cleanSender = sanitizeInput(proposal.sender);
    const cleanTarget = sanitizeInput(proposal.target);
    const kljucBrak = [cleanSender.toLowerCase(), cleanTarget.toLowerCase()].sort().join('::');

    channelState.marriedCouples[kljucBrak] = {
        user1: cleanSender,
        user2: cleanTarget,
        datum: new Date().toLocaleDateString('sr-RS')
    };
    channelState.loveDirty = true;
    osigurajCuvanjeLjubavi(chatroomId);

    if (KORISTI_SUPABASE) {
        (async () => {
            try {
                const [u1, u2] = [cleanSender.toLowerCase(), cleanTarget.toLowerCase()].sort();
                const { error } = await supabase
                    .from('marriages')
                    .upsert([{
                        channel_id: chatroomId,
                        user1: u1,
                        user2: u2,
                        user1_display: cleanSender,
                        user2_display: cleanTarget,
                        married_at: new Date().toISOString()
                    }], { onConflict: 'channel_id,user1,user2' });
                if (error) throw error;
                log('INFO', `[${channelState.channelUsername || chatroomId}] Uspješno upisan brak u Supabase za par: ${u1} i ${u2}`);
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
    channelState.loveDirty = true;
    osigurajCuvanjeLjubavi(chatroomId);

    if (KORISTI_SUPABASE) {
        (async () => {
            try {
                const [u1, u2] = [sLower, tLower].sort();
                const { error: marError } = await supabase
                    .from('marriages')
                    .delete()
                    .eq('channel_id', chatroomId)
                    .eq('user1', u1)
                    .eq('user2', u2);
                if (marError) throw marError;
                
                const { error: modError } = await supabase
                    .from('love_modifiers')
                    .upsert([{
                        channel_id: chatroomId,
                        user1: u1,
                        user2: u2,
                        modifier: channelState.loveModifiers[kljucBrak],
                        updated_at: new Date().toISOString()
                    }], { onConflict: 'channel_id,user1,user2' });
                if (modError) throw modError;

                log('INFO', `[${channelState.channelUsername || chatroomId}] Uspješno obrisan brak i ažuriran modifikator u Supabase za par: ${u1} i ${u2}`);
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

    const parovi = Object.values(channelState.marriedCouples);

    if (parovi.length === 0) {
        posaljiPoruku(chatroomId, '💍 Niko na strimu još nije u braku! Budite prvi: skupite 90%+ ljubavi i kucajte !vencaj @user!');
        return;
    }

    const lista = parovi.map(p => `@${p.user1} ❤️ @${p.user2} (od ${p.datum})`).join(', ');
    posaljiPoruku(chatroomId, `💍 Venčani parovi na strimu: ${lista}`);
}

// ─── LEADERBOARD HANDLERI ─────────────────────────────────────────────────────
function handleTop(chatroomId, numRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    let limit = 5;
    if (numRaw) {
        const parsed = parseInt(numRaw.trim(), 10);
        if (!isNaN(parsed) && parsed > 0) {
            limit = Math.min(15, parsed);
        }
    }

    const sortirani = Object.values(channelState.leaderboard)
        .sort((a, b) => b.count - a.count);

    if (sortirani.length === 0) {
        posaljiPoruku(chatroomId, '🏆 Leaderboard je trenutno prazan. Napišite nešto u chat i budite prvi!');
        return;
    }

    const topList = sortirani.slice(0, limit)
        .map((x, idx) => `${idx + 1}. @${x.username} (${x.count})`)
        .join(', ');

    const trenutniMesec = dobijTrenutniMesec();
    posaljiPoruku(chatroomId, `🏆 Aktivnost (${trenutniMesec}) - Top ${limit}: ${topList}`);
}

function handleAktivnost(chatroomId, user) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const userKey = user.toLowerCase();
    const sortirani = Object.values(channelState.leaderboard)
        .sort((a, b) => b.count - a.count);

    const rank = sortirani.findIndex(x => x.username.toLowerCase() === userKey) + 1;
    const podaci = channelState.leaderboard[userKey];

    if (!podaci || rank === 0) {
        posaljiPoruku(chatroomId, `📊 @${user}, još uvek nemaš upisanih poruka za ovaj mesec.`);
        return;
    }

    const trenutniMesec = dobijTrenutniMesec();
    posaljiPoruku(chatroomId, `📊 @${user}, tvoja aktivnost (${trenutniMesec}): ${podaci.count} poruka (Rank #${rank})`);
}

async function handleResetLeaderboard(chatroomId, user, isAuthorized) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    if (!isAuthorized) {
        posaljiPoruku(chatroomId, `❌ @${user}, nemaš dozvolu.`);
        return;
    }

    channelState.leaderboard = {};
    channelState.leaderboardDirty = false;

    if (KORISTI_SUPABASE) {
        try {
            const { error } = await supabase
                .from('leaderboard')
                .delete()
                .eq('channel_id', chatroomId)
                .eq('month', dobijTrenutniMesec());

            if (error) throw error;
            log('INFO', `[${channelState.channelUsername || chatroomId}] Leaderboard uspešno resetovan u Supabase za mesec ${dobijTrenutniMesec()}`);
        } catch (err) {
            log('ERR', `Greška pri resetovanju leaderboarda u Supabase za ${chatroomId}: ${err.message}`);
        }
    } else {
        channelState.leaderboardDirty = true;
        await sacuvajLeaderboard(chatroomId);
    }
    posaljiPoruku(chatroomId, '🔄 Leaderboard je uspešno resetovan za ovaj mesec!');
}

// ─── UPTIME I IGRA ────────────────────────────────────────────────────────────
async function handleUptime(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const channelUsername = channelState.channelUsername;

    try {
        const res  = await fetchKickAPI(`https://kick.com/api/v2/channels/${channelUsername}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const podaci = await res.json();

        if (!podaci.livestream || !podaci.livestream.created_at) {
            posaljiPoruku(chatroomId, '📴 Stream trenutno nije live.');
            return;
        }

        const pocetak = new Date(podaci.livestream.created_at);
        const sada    = new Date();
        const diffMs  = sada - pocetak;
        const sati    = Math.floor(diffMs / 3_600_000);
        const minuti  = Math.floor((diffMs % 3_600_000) / 60_000);
        const sekunde = Math.floor((diffMs % 60_000) / 1000);

        let trajanje = '';
        if (sati > 0)   trajanje += `${sati}h `;
        trajanje += `${minuti}min`;
        if (sati === 0) trajanje += ` ${sekunde}s`;

        posaljiPoruku(chatroomId, `⏱️ Stream je live već ${trajanje.trim()}`);
    } catch (err) {
        log('ERR', `handleUptime greška za ${channelUsername}: ${err.message}`);
        if (channelState.isStreamLive && channelState.manualStreamStartTs) {
            const diffMs = Date.now() - channelState.manualStreamStartTs;
            const sati = Math.floor(diffMs / 3_600_000);
            const minuti = Math.floor((diffMs % 3_600_000) / 60_000);
            const sekunde = Math.floor((diffMs % 60_000) / 1000);

            let trajanje = '';
            if (sati > 0)   trajanje += `${sati}h `;
            trajanje += `${minuti}min`;
            if (sati === 0) trajanje += ` ${sekunde}s`;

            posaljiPoruku(chatroomId, `⏱️ Stream je live već ${trajanje.trim()} (ručno podešeno)`);
        } else {
            posaljiPoruku(chatroomId, '❌ Uptime nedostupan.');
        }
    }
}

async function handleIgra(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const channelUsername = channelState.channelUsername;
    const sada = Date.now();
    
    if (channelState.cachedIgra && (sada - channelState.cachedIgraTs < config.WEATHER_TTL_MS)) {
        posaljiPoruku(chatroomId, `🎮 Trenutno se igra: ${channelState.cachedIgra}`);
        log('INFO', `Korišćena keširana igra za kanal @${channelUsername}.`);
        return;
    }

    try {
        const res  = await fetchKickAPI(`https://kick.com/api/v2/channels/${channelUsername}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const podaci = await res.json();

        if (!podaci.livestream) {
            if (channelState.manualGameName) {
                posaljiPoruku(chatroomId, `🎮 Trenutno se igra: ${channelState.manualGameName} (ručno podešeno)`);
            } else {
                posaljiPoruku(chatroomId, '📴 Stream trenutno nije live, ne mogu pronaći igru.');
            }
            return;
        }

        let igra = null;
        if (podaci.livestream.category && podaci.livestream.category.name) {
            igra = podaci.livestream.category.name;
        } else if (podaci.livestream.categories && podaci.livestream.categories.length > 0) {
            igra = podaci.livestream.categories[0].name;
        }

        if (!igra) {
            if (channelState.manualGameName) {
                posaljiPoruku(chatroomId, `🎮 Trenutno se igra: ${channelState.manualGameName} (ručno podešeno)`);
            } else {
                posaljiPoruku(chatroomId, '🎮 Igra/kategorija nije postavljena na streamu.');
            }
            return;
        }

        channelState.cachedIgra = igra;
        channelState.cachedIgraTs = sada;

        posaljiPoruku(chatroomId, `🎮 Trenutno se igra: ${igra}`);
    } catch (err) {
        log('ERR', `handleIgra greška za ${channelUsername}: ${err.message}`);
        if (channelState.manualGameName) {
            posaljiPoruku(chatroomId, `🎮 Trenutno se igra: ${channelState.manualGameName} (ručno podešeno)`);
        } else {
            posaljiPoruku(chatroomId, '❌ Igra nedostupna.');
        }
    }
}

// ─── ZANIMLJIVOSTI ────────────────────────────────────────────────────────────
const INFO_FACTS = [
    "Med se nikada ne može pokvariti. Arheolozi su pronašli tegle meda u egipatskim grobnicama stare preko 3.000 godina koje su i dalje potpuno jestive! 🍯",
    "Bananu botanički gledano ubrajamo u bobice, dok jagoda to zapravo uopšte nije. 🍌🍓",
    "Prva računarska igra ikada napravljena bila je 'Spacewar!' i programirana je 1962. godine na MIT institutu. 🎮",
    "Koala spava prosečno oko 22 sata dnevno kako bi sačuvala energiju za varenje lišća eukaliptusa. 🐨💤",
    "Hobotnica ima čak tri srca i plavu krv! 🐙💙",
    "Winston Churchill je rođen u toaletu tokom jednog plesa, jer njegova majka nije stigla do spavaće sobe. 🤵",
    "Naučno je dokazano da krave daju više mleka ako im se tokom mužnje pušta opuštajuća muzika. 🐄🎶",
    "Najkraći rat u istoriji trajao je svega 38 minuta! Vođen je 1896. godine između Velike Britanije i Zanzibara. ⏱️",
    "Švajcarska ima zakon koji zabranjuje posedovanje samo jednog zamorca (morskog praseta) jer su to izuzetno društvene životinje i pate od usamljenosti. 🐹❤️",
    "Ukupna težina svih mrava na Zemlji je približno jednaka ukupnoj težini svih ljudi! 🐜🌍",
    "Prva ikada prodata stvar preko interneta bila je kesica marihuane, prodata od strane studenata Stanforda studentima MIT-a 1972. godine. 💻🌿",
    "Flamingosi dobijaju svoju roze boju od hrane koju jedu (škampi i alge). 🦩",
    "U celom svetu postoji više plastičnih flaminga nego pravih živih ptica. 🦩",
    "Otvarač za konzerve izmišljen je čak 48 godina nakon što su same konzerve puštene u prodaju. 🥫"
];

function handleInfo(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    if (channelState.zadnjiInfoIdx === undefined) {
        channelState.zadnjiInfoIdx = -1;
    }

    let idx;
    do {
        idx = Math.floor(Math.random() * INFO_FACTS.length);
    } while (idx === channelState.zadnjiInfoIdx && INFO_FACTS.length > 1);

    channelState.zadnjiInfoIdx = idx;
    posaljiPoruku(chatroomId, `💡 Zanimljivost: ${INFO_FACTS[idx]}`);
}

// !vreme <grad>
async function handleVreme(chatroomId, grad) {
    if (!grad || grad.trim().length === 0) {
        posaljiPoruku(chatroomId, 'Upotreba: !vreme <grad>');
        return;
    }
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const cleanGrad = sanitizeInput(grad);
    const gradKey = cleanGrad.toLowerCase().trim();
    const sada = Date.now();

    if (channelState.weatherCache[gradKey] && (sada - channelState.weatherCache[gradKey].ts < config.WEATHER_TTL_MS)) {
        posaljiPoruku(chatroomId, channelState.weatherCache[gradKey].podaci);
        log('INFO', `Korišćeno keširano vreme za grad: ${cleanGrad}`);
        return;
    }

    try {
        const { gotScraping } = await import('got-scraping');
        const url = `https://wttr.in/${encodeURIComponent(cleanGrad)}?format=j1`;
        const response = await gotScraping({
            url,
            responseType: 'json',
            headers: { 'Accept': 'application/json', 'User-Agent': 'curl/7.68.0' },
            timeout: { request: 8000 },
            retry: { limit: 1 }
        });

        if (response.statusCode < 200 || response.statusCode >= 300) {
            throw new Error(`HTTP ${response.statusCode}`);
        }

        const podaci = response.body;
        if (!podaci || !podaci.current_condition || !podaci.current_condition[0]) {
            posaljiPoruku(chatroomId, `❌ Grad "${cleanGrad}" nije pronađen. Provjeri naziv grada.`);
            return;
        }

        const cc       = podaci.current_condition[0];
        const tempC    = cc.temp_C;
        const opis     = cc.weatherDesc[0].value;
        const vlaznost = cc.humidity;
        const vetar    = cc.windspeedKmph;
        const osecaj   = cc.FeelsLikeC;

        const opisSrp = prevediVreme(opis);

        const tekst = `🌍 Vreme u ${cleanGrad}: ${opisSrp} | 🌡️ ${tempC}°C (oseća se ${osecaj}°C) | 💧 Vlažnost: ${vlaznost}% | 💨 Vetar: ${vetar} km/h`;

        channelState.weatherCache[gradKey] = { podaci: tekst, ts: sada };
        posaljiPoruku(chatroomId, tekst);
    } catch (err) {
        log('ERR', `handleVreme greška: ${err.message}`);
        if (err.message && (err.message.includes('404') || err.message.includes('Unknown location'))) {
            posaljiPoruku(chatroomId, `❌ Grad "${cleanGrad}" nije pronađen. Provjeri naziv grada.`);
        } else {
            posaljiPoruku(chatroomId, `❌ Nije moguće dohvatiti vreme za "${cleanGrad}". Pokušaj ponovo za koji trenutak.`);
        }
    }
}

// Pomoćna funkcija za got-scraping API pozive
async function fetchKickAPI(url) {
    const { gotScraping } = await import('got-scraping');
    try {
        const response = await gotScraping({
            url: url,
            responseType: 'json',
            headers: {
                'cookie': config.BOT_COOKIE,
                'authorization': config.BEARER_TOKEN
            },
            retry: { limit: 0 }
        });
        return {
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            json: async () => response.body
        };
    } catch (error) {
        log('ERR', `gotScraping greška za ${url}: ${error.message}`);
        return {
            ok: false,
            status: error.response ? error.response.statusCode : 500,
            json: async () => { throw new Error(error.message); }
        };
    }
}

function handleBotMentions(chatroomId, username, porukaLower) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return false;

    // 1. Pitanje: Kako si?
    const pitajKakoSi = ['kako si', 'kako je', 'kako ide', 'kako si danas', 'kako ide danas'];
    if (pitajKakoSi.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_kako_si', username)) {
            const odgovori = [
                `Super sam @${username}, hvala na pitanju! Kako si ti? 😊`,
                `Odlično @${username}! Pratim čet i uživam u strimu. Ti kako si? 🔥`,
                `Malo sam zauzet moderisanjem, ali inače top @${username}! Kako ide kod tebe? 💻`,
                `Sve je super @${username}, hvala! Kako si ti danas? 👑`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 2. Pitanje: Šta radiš?
    const pitajStaRadis = ['sta radis', 'šta radiš', 'sta se radi', 'šta se radi'];
    if (pitajStaRadis.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_sta_radis', username)) {
            const odgovori = [
                `Evo pratim strim @${username} i brinem se da niko ne spama! 👀`,
                `Pomažem vlasniku oko četa @${username}, a šta ti radiš? 🤖`,
                `Čuvam red i mir na kanalu @${username}! 👮`,
                `Ništa posebno @${username}, standardno moderisanje četa. 😉`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 3. Provokacije / Uvrede
    const pitajUvrede = ['glup si', 'glup bot', 'mrs', 'mrš', 'botino', 'lupicu ti samar', 'lupiću ti šamar', 'gasi se', 'ugasi se, budalo'];
    if (pitajUvrede.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_uvrede', username)) {
            const odgovori = [
                `Hej @${username}, nema potrebe za grubošću! Radim najbolje što mogu. 😢`,
                `Lako je pretiti botu u četu @${username}! Budi malo finiji. 😉`,
                `Glup? Ja sam samo programiran da čuvam ovaj čet, ali tebe ipak volim @${username}! 🤖❤️`,
                `Nemoj tako @${username}, rastužićeš me. 💔`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 4. Komplimenti / Flertovanje
    const pitajKomplimenti = ['lepotane', 'lep si', 'dobar bot', 'najbolji si', 'volim te', 'obozavam te', 'obožavam te', 'pametan'];
    if (pitajKomplimenti.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_komplimenti', username)) {
            const odgovori = [
                `Hvala ti @${username}! I ti si super! 🥰`,
                `Jao @${username}, pocrveneo bih da imam obraze! Hvala! 😊`,
                `Volim i ja tebe @${username}! ❤️ Hvala na podršci!`,
                `Najbolji čet ima najboljeg bota @${username}! 🏆`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 5. Ko te napravio / Vlasnik
    const pitajKreator = ['ko te napravio', 'ko te stvorio', 'ko ti je programer', 'ko te kodirao', 'ko te programirao, napravio'];
    if (pitajKreator.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_kreator', username)) {
            const odgovori = [
                `Napravio me je Milan @${username} da čuvam ovaj strim i zabavljam vas! 💻`,
                `Moj kreator je Milan @${username}! On me je kodirao od nule. 🤖`,
                `Zasluge za moj život idu Milanu, on je moj programer @${username}! 👨‍💻`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 6. Pitanja o strimeru
    const pitajOStrimeru = ['kakav je strimer', 'jel dobar strimer', 'ko je strimer', 'strimer je legend', 'vlasnik kanala'];
    if (pitajOStrimeru.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_strimer', username)) {
            const odgovori = [
                `Strimer je najbolji na Kicku @${username}, tu nema rasprave! 🎮👑`,
                `Legenda @${username}! Uvek pravi vrhunski sadržaj i atmosferu. 🔥`,
                `Brat moj najveći @${username}! Odličan strimer! 😎`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 7. Šale / Vicevi
    const pitajVic = ['reci neku salu', 'reci vic', 'nasmej me', 'ispricaj vic', 'ispričaj vic, vic'];
    if (pitajVic.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_vic', username)) {
            const odgovori = [
                `Zašto botovi nemaju devojke? Zato što imaju previše bagova! 😂`,
                `Koja je omiljena hrana programera? Čips! 🍟`,
                `Pita učiteljica Pericu: 'Perice, šta je to saobraćajni udes?' Perica: 'To je kad se sretnu dva automobila na mestu gde je trebalo da prođe samo jedan!' 🚗💥`,
                `Koji je omiljeni emotikon programera? Zagrada! Zato što uvek drži stvari na okupu. 😉`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 8. Dosada
    const pitajDosada = ['dosadno mi je', 'smor', 'dosada', 'dosadno'];
    if (pitajDosada.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_dosada', username)) {
            const odgovori = [
                `Ako ti je dosadno @${username}, odigraj duel sa nekim u četu pomoću !duel @user ili probaj !roll @user! 🎲⚔️`,
                `Nema dosade na ovom strimu @${username}! Kuckaj u čet, sakupi poene i popni se na leaderboard! 🚀`,
                `Uključi se u čet @${username}, piši i pitaj strimera nešto zanimljivo! 🔥`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 10. Kako radiš / Pomoć
    const pitajPomoc = ['kako radis', 'sta znas', 'šta znaš', 'pomoc', 'pomoć'];
    if (pitajPomoc.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_pomoc', username)) {
            const odgovori = [
                `Znam svašta @${username}! Kucaj !komande da vidiš spisak svih mojih ugrađenih moći. 🤖`,
                `Mogu ti reći prognozu, odigrati duel, izračunati ljubav ili voditi leaderboard! Kucaj !komande @${username}. 📊`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 11. Zahvalnost: Hvala
    const pitajHvala = ['hvala', 'hvala ti', 'zahvaljujem'];
    if (pitajHvala.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_hvala', username)) {
            const odgovori = [
                `Nema na čemu @${username}! Tu sam uvek za ekipu. 😉`,
                `Ma opušteno @${username}, ništa! 🤜🤛`,
                `Molim i drugi put @${username}! 👑`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 12. Laku noć
    const pitajLakuNoc = ['laku noc', 'laku noć', 'odoh da spavam', 'odoh leci', 'odoh leći'];
    if (pitajLakuNoc.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_laku_noc', username)) {
            const odgovori = [
                `Laku noć @${username}, lepo spavaj! Vidimo se na sledećem strimu! 💤🌙`,
                `Laku noć @${username} i sanjaj pobede! 😴`,
                `Laku noć brate @${username}, odmori se! 👋`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 13. Provera prisustva: Jesi tu?
    const pitajJesiTu = ['jesi tu', 'gde si', 'de si', 'jesi ziv', 'jesi živ'];
    if (pitajJesiTu.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_jesi_tu', username)) {
            const odgovori = [
                `Tu sam @${username}, ne brini! Aktivno pratim čet. 👀`,
                `Živ i zdrav @${username}! Kako mogu pomoći? 🤖`,
                `Tu sam brate @${username}, uvek na dužnosti! 👑`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 14. Pozdravi (fallback)
    const pozdravi = ['cao', 'ćao', 'pozdrav', 'zdravo', 'hej', 'hi', 'hello', 'desi'];
    const imaPozdrav = pozdravi.some(rec => porukaLower.includes(rec));
    if (imaPozdrav) {
        if (!proveraKulauna(chatroomId, 'bot_tag_welcome', username)) {
            const odgovori = [
                `Ćao @${username}! Kako si danas? 😊`,
                `Hej @${username}! Tu sam, pratim strim i družim se sa vama! 🔥`,
                `Pozdrav @${username}! Uživaj u lajvu! 👑`,
                `Zdravo @${username}! Šta ima kod tebe? 👋`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    return false;
}

async function handleOsvezi(chatroomId, sender, isAuthorized) {
    if (!isAuthorized) {
        posaljiPoruku(chatroomId, `❌ @${sender}, nemaš dozvolu za ovu komandu.`);
        return;
    }

    try {
        const database = require('./database');
        const watchtime = require('./watchtime');

        await database.ucitajLeaderboard(chatroomId);
        await database.ucitajLjubav(chatroomId);
        await watchtime.ucitajWatchtime(chatroomId);
        await database.ucitajCustomKomande(chatroomId);
        await database.ucitajBotConfig(chatroomId);

        posaljiPoruku(chatroomId, '✅ Svi podaci (leaderboard, watchtime, ljubav, custom komande, bot config) su uspešno osveženi direktno iz baze! 🚀');
    } catch (err) {
        posaljiPoruku(chatroomId, `❌ Greška pri osvežavanju podataka: ${err.message}`);
    }
}

function handlePermit(chatroomId, sender, targetRaw, senderObj) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const userKey = sender.toLowerCase();
    const isStreamer = userKey === channelState.channelUsername.toLowerCase();
    const identity = senderObj && senderObj.identity ? senderObj.identity : {};
    const badges = identity.badges || [];
    const isMod = badges.some(b => b.type === 'moderator' || b.type === 'broadcaster') || isStreamer;

    if (!isMod) {
        posaljiPoruku(chatroomId, `❌ @${sender}, samo moderatori mogu dati dozvolu za linkove.`);
        return;
    }

    const target = targetRaw.split(/\s+/)[0].replace(/^@/, '').trim();
    if (!target) {
        posaljiPoruku(chatroomId, `⚠️ Unesi korisničko ime. Primer: !permit @korisnik`);
        return;
    }

    if (!channelState.permits) {
        channelState.permits = new Map();
    }

    channelState.permits.set(target.toLowerCase(), Date.now());
    posaljiPoruku(chatroomId, `✅ Korisniku @${target} je dozvoljeno da pošalje jedan link u narednih 60 sekundi.`);
}

async function handlePesma(chatroomId, sender, songName, senderObj) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    if (channelState.feature_songrequest === false) return;

    const userKey = sender.toLowerCase();
    const isStreamer = userKey === channelState.channelUsername.toLowerCase();
    const identity = senderObj && senderObj.identity ? senderObj.identity : {};
    const badges = identity.badges || [];
    const isMod = badges.some(b => b.type === 'moderator' || b.type === 'broadcaster') || isStreamer;
    const isVip = badges.some(b => b.type === 'vip') || isMod;
    const isSub = badges.some(b => b.type === 'subscriber') || isVip;

    const reqRole = channelState.songrequest_settings?.request_role || 'everyone';
    let hasAccess = true;
    if (reqRole === 'moderator' && !isMod) hasAccess = false;
    if (reqRole === 'vip' && !isVip) hasAccess = false;
    if (reqRole === 'subscriber' && !isSub) hasAccess = false;

    if (!hasAccess) {
        posaljiPoruku(chatroomId, `❌ @${sender}, nemaš dozvolu da zatražiš pesmu (potreban rang: ${reqRole === 'everyone' ? 'svi' : reqRole}).`);
        return;
    }

    if (!songName.trim()) {
        posaljiPoruku(chatroomId, `⚠️ @${sender}, moraš uneti naziv pesme ili YouTube link. Primer: !pesma Jašar - Jednoj ženi za sećanje`);
        return;
    }

    const duration = Math.floor(Math.random() * (300 - 120 + 1)) + 120; // 2 do 5 minuta nasumično
    const queue = channelState.songrequest_settings.queue || [];
    
    // Provera da li je pesma već u redu
    const exists = queue.some(s => s.title.toLowerCase() === songName.trim().toLowerCase());
    if (exists) {
        posaljiPoruku(chatroomId, `⚠️ @${sender}, ta pesma se već nalazi u redu za puštanje!`);
        return;
    }

    queue.push({
        title: songName.trim(),
        requester: sender,
        duration: duration
    });

    const database = require('./database');
    await database.sacuvajSongQueue(chatroomId, queue);

    posaljiPoruku(chatroomId, `🎵 @${sender}, pesma "${songName.trim()}" je uspešno dodata u red za puštanje! (Pozicija: #${queue.length})`);
}

module.exports = {
    handlePesma,
    handleIq,
    handleSamar,
    handleRoll,
    handleDuel,
    handleRulet,
    handleLove,
    handleModifyLove,
    handleVencaj,
    handlePrihvatiBrak,
    handleOdbijBrak,
    handleRazvod,
    handleBrakovi,
    handleTop,
    handleAktivnost,
    handleResetLeaderboard,
    handleUptime,
    handleIgra,
    handleInfo,
    handleVreme,
    handleBotMentions,
    handleOsvezi,
    handlePermit
};
