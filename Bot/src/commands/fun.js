const { isValidUsername, sanitizeInput } = require('../utils');
const { posaljiPoruku } = require('../messenger');

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
        komentar = 'Genije! Noj lični asistent i sledeća generacija AI-ja. 🤖🔥';
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

// ─── RUSKI RULET ─────────────────────────────────────────────────────────────
function handleRulet(chatroomId, sender) {
    if (!isValidUsername(sender)) return;
    const cleanSender = sanitizeInput(sender);
    const komore = [false, false, false, false, false, true]; // 1 u 6 šansa
    const metak = komore[Math.floor(Math.random() * komore.length)];
    if (metak) {
        const porazi = [
            `💀 KLIK... BUM! @${cleanSender} je popio metak u ruskom ruletu! Bolje sreće u sledećem životu. 🪦`,
            `💀 KLIK... ŠKLJOC... BUM! @${cleanSender} je izvukao kraći kraj. Počivaj u miru! 🥀`,
            `💀 KLIK... BUM! @${cleanSender} je eliminisan iz četa (simulirano)! Kakav hrabar, ali tragičan pokušaj! 🔫`
        ];
        posaljiPoruku(chatroomId, porazi[Math.floor(Math.random() * porazi.length)]);
    } else {
        const prezivljavanja = [
            `🔫 KLIK... Prazno! @${cleanSender} je preživeo ovu rundu ruskog ruleta. Znoj se cedi sa čela... 😰`,
            `🔫 KLIK... Tišina. Srce kuca ubrzano, ali @${cleanSender} je još uvek živ! Sreća te prati danas! 🍀`,
            `🔫 KLIK... Ništa! @${cleanSender} se samo nasmejao sudbini u lice. Sledeći! 😎`
        ];
        posaljiPoruku(chatroomId, prezivljavanja[Math.floor(Math.random() * prezivljavanja.length)]);
    }
}

// ─── ALKOTEST ─────────────────────────────────────────────────────────────────
function handleAlkotest(chatroomId, sender, targetRaw) {
    if (!isValidUsername(sender)) return;
    const cleanSender = sanitizeInput(sender);
    let target = targetRaw ? targetRaw.split(/\s+/)[0].replace(/^@/, '').trim() : '';

    if (target && !isValidUsername(target)) {
        posaljiPoruku(chatroomId, '❌ Nevalidno korisničko ime.');
        return;
    }

    const user = target ? sanitizeInput(target) : cleanSender;
    const promili = (Math.random() * 3.5).toFixed(2);

    let status = '';
    if (promili < 0.3) status = 'Trezan kao novorođenče! 🥛';
    else if (promili < 0.8) status = 'Veseo i spreman za pesmu! 🍻';
    else if (promili < 1.5) status = 'Pletu mu se noge i maši slova u chatu! 🍷';
    else if (promili < 2.5) status = 'Vidi dva strimera i tri chata! 😵';
    else status = 'Kritično! Spava pod stolom uz kafanski reprizni hit! 🚑🍺';

    posaljiPoruku(chatroomId, `🍺 Alkotest za @${user}: izmereno je ${promili}‰ alkohola u krvi! Status: ${status}`);
}

// ─── ČINJENICA ────────────────────────────────────────────────────────────────
function handleCinjenica(chatroomId) {
    const cinjenice = [
        "Banane su prirodno blago radioaktivne zbog kalijuma koji sadrže. 🍌",
        "Hobotnice imaju tri srca i plavu krv. 🐙",
        "Med se nikada ne kvari — pronađen je jestiv med u egipatskim piramidama star preko 3000 godina! 🍯",
        "Otisci jezika su potpuno jedinstveni za svakog čoveka, baš kao i otisci prstiju. 👅",
        "Srce plavog kita je veličine malog automobila. 🐋",
        "Voda u zamrzivaču se brže smrzava ako je bila vruća nego ako je bila hladna (Mpemba efekat). ❄️",
        "Krave imaju najbolje prijatelje i doživljavaju stres kada se razdvoje od njih. 🐄",
        "Kenguri ne mogu da hodaju unazad zbog strukture svojih nogu i repa. 🦘",
        "Ajkule postoje na Zemlji duže nego drveće — preko 400 miliona godina! 🦈",
        "Prva poslata SMS poruka u istoriji glasila je 'Merry Christmas' (1992. godine). 📱",
        "Prosečan čovek tokom života provede oko 6 meseci čekajući crveno svetlo na semaforu. 🚦",
        "Venera je jedina planeta u našem sunčevom sistemu koja se rotira u smeru kazaljke na satu. 🪐"
    ];
    const izabrana = cinjenice[Math.floor(Math.random() * cinjenice.length)];
    posaljiPoruku(chatroomId, `💡 Činjenica: ${izabrana}`);
}

module.exports = {
    handleIq,
    handleSamar,
    handleRoll,
    handleRulet,
    handleAlkotest,
    handleCinjenica
};
