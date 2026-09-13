// Modul za proveru permisija, normalizaciju teksta i rutiranje chat komandi

const config = require('./config');
const state = require('./state');
const utils = require('./utils');
const database = require('./database');
const commands = require('./commands');
const messenger = require('./messenger');
const watchtime = require('./watchtime');
const economy = require('./economy');
const gambling = require('./gambling');

// Optimizovano uklanjanje dijakritika preko lookup tabele i jednog regularnog izraza (O(N) umesto 10x regex prolaza)
const DIACRITICS_MAP = {
    'š': 's', 'đ': 'd', 'č': 'c', 'ć': 'c', 'ž': 'z',
    'Š': 's', 'Đ': 'd', 'Č': 'c', 'Ć': 'c', 'Ž': 'z'
};
const DIACRITICS_REGEX = /[šđčćžŠĐČĆŽ]/g;

function ukloniSrpskeDijakritike(str) {
    if (!str) return '';
    return str.replace(DIACRITICS_REGEX, match => DIACRITICS_MAP[match] || match);
}

const CUSTOM_COMMAND_REFRESH_THROTTLE_MS = 5000;

const RANK_LEVELS = {
    'everyone': 0,
    'subscriber': 1,
    'vip': 2,
    'og': 3,
    'moderator': 4,
    'broadcaster': 5
};

const RANK_LABELS_SR = {
    'everyone': 'Svi',
    'subscriber': 'Subovi',
    'vip': 'VIP',
    'og': 'OG',
    'moderator': 'Moderatori',
    'broadcaster': 'Strimer'
};

const defaultBuiltinRanks = {
    // Zabava
    'iq': 'everyone',
    'samar': 'everyone',
    'slap': 'everyone',
    'roll': 'everyone',
    'dice': 'everyone',
    'duel': 'everyone',
    'ruskirulet': 'everyone',
    'rr': 'everyone',
    'russianroulette': 'everyone',
    'alkotest': 'everyone',
    'alcohol': 'everyone',
    'bac': 'everyone',
    'cinjenica': 'everyone',
    'fact': 'everyone',
    
    // Ljubav & Brak
    'love': 'everyone',
    'mrzim': 'everyone',
    'hate': 'everyone',
    'vencaj': 'everyone',
    'marry': 'everyone',
    'propose': 'everyone',
    'razvod': 'everyone',
    'divorce': 'everyone',
    'brakovi': 'everyone',
    'brak': 'everyone',
    'vencani': 'everyone',
    'marriages': 'everyone',
    'couples': 'everyone',
    'posaljiljubav': 'everyone',
    'sendlove': 'everyone',
    'bacihejt': 'everyone',
    'sendhate': 'everyone',
    'prihvati': 'everyone',
    'da': 'everyone',
    'yes': 'everyone',
    'pristajem': 'everyone',
    'odbij': 'everyone',
    'ne': 'everyone',
    'no': 'everyone',
    'odbijam': 'everyone',
    'decline': 'everyone',
    'cooldown': 'everyone',
    'coldown': 'everyone',
    'cd': 'everyone',
    
    // Strim Info
    'komande': 'everyone',
    'help': 'everyone',
    'pomoc': 'everyone',
    'commands': 'everyone',
    'vreme': 'everyone',
    'vrijeme': 'everyone',
    'weather': 'everyone',
    'uptime': 'everyone',
    'up': 'everyone',
    'igra': 'everyone',
    'game': 'everyone',
    'info': 'everyone',
    
    // Moderacija
    'permit': 'moderator',
    'dozvoli': 'moderator',
    'addcom': 'moderator',
    'dodajkomandu': 'moderator',
    'delcom': 'moderator',
    'obrisikomandu': 'moderator',
    'osvezi': 'broadcaster',
    'reload': 'broadcaster',
    'pin': 'moderator',
    'unpin': 'broadcaster',
    'setlive': 'broadcaster',
    'setgame': 'broadcaster',
    
    // Statistika
    'watchtime': 'everyone',
    'topwatchtime': 'everyone',
    'topwatch': 'everyone',
    'toptime': 'everyone',
    'top': 'everyone',
    'topchat': 'everyone',
    'topchatters': 'everyone',
    'topchaters': 'everyone',
    'topporuke': 'everyone',
    'topmessages': 'everyone',
    'topcoins': 'everyone',
    'toppoeni': 'everyone',
    'toppoints': 'everyone',
    'leaderboard': 'everyone',
    'chat': 'everyone',
    'aktivnost': 'everyone',
    'poruke': 'everyone',
    'messages': 'everyone',
    'time': 'everyone',
    'sati': 'everyone',
    'stats': 'everyone',
    'me': 'everyone',
    'profil': 'everyone',
    'profile': 'everyone',
    'followage': 'everyone',
    'pratim': 'everyone',
    'resetleaderboard': 'broadcaster',
    'resetlb': 'broadcaster',
    
    // Ekonomija
    'rank': 'everyone',
    'level': 'everyone',
    'xp': 'everyone',
    'points': 'everyone',
    'poeni': 'everyone',
    'bal': 'everyone',
    'coins': 'everyone',
    'daily': 'everyone',
    'dnevna': 'everyone',
    'give': 'everyone',
    'givepoints': 'everyone',
    'dajpoene': 'everyone',
    'toplevel': 'everyone',
    'topxp': 'everyone',
    
    // Kockanje
    'slots': 'everyone',
    'slot': 'everyone',
    'roulette': 'everyone',
    'rulet': 'everyone',
    'coinflip': 'everyone',
    'flip': 'everyone',
    'piskoglava': 'everyone',
    'gamble': 'everyone',
    'kockaj': 'everyone',
    'tocak': 'everyone',
    'wheel': 'everyone',
    'spin': 'everyone',
    'dvoboj': 'everyone',
    'accept': 'everyone',
    
    // Prodavnica
    'store': 'everyone',
    'prodavnica': 'everyone',
    'shop': 'everyone',
    'redeem': 'everyone',
    'kupi': 'everyone',
    'buy': 'everyone',
    
    // Muzika
    'pesma': 'everyone',
    'sr': 'everyone',
    'song': 'everyone',
    'queue': 'everyone',
    'songqueue': 'everyone',
    'redpesama': 'everyone',
    'skip': 'moderator',
    'skipsong': 'moderator',
    'preskocipesmu': 'moderator'
};

function getUserRankLevel(username, senderObj, channelUsername) {
    const userKey = username.toLowerCase();
    if (userKey === (channelUsername || '').toLowerCase() || (config.SUPER_ADMIN_USERNAME && userKey === config.SUPER_ADMIN_USERNAME)) return 5; // Streamer / Creator

    const identity = senderObj && senderObj.identity ? senderObj.identity : {};
    const badges = identity.badges || [];

    if (badges.some(b => b.type === 'broadcaster')) return 5;
    if (badges.some(b => b.type === 'moderator')) return 4;
    if (badges.some(b => b.type === 'og')) return 3;
    if (badges.some(b => b.type === 'vip')) return 2;
    if (badges.some(b => b.type === 'subscriber' || b.type === 'sub')) return 1;

    return 0; // Svi (everyone)
}

function proveriDozvoluKomande(chatroomId, username, cmdIme, channelState, senderObj, podrazumevaniRank = 'everyone') {
    const pronadjena = pronadjiCustomKomandu(channelState, cmdIme);
    
    let isEnabled = true;
    let requiredRank = podrazumevaniRank;
    
    if (pronadjena) {
        isEnabled = pronadjena.cmd.enabled !== false;
        requiredRank = pronadjena.cmd.min_rank || podrazumevaniRank;
    }
    
    if (!isEnabled) {
        return { dozvoljeno: false, razlog: 'disabled' };
    }
    
    const userRank = getUserRankLevel(username, senderObj, channelState.channelUsername);
    if (userRank < RANK_LEVELS[requiredRank]) {
        return { dozvoljeno: false, razlog: 'rank', requiredRank };
    }
    
    return { dozvoljeno: true };
}

function pronadjiCustomKomandu(channelState, cmdImeRaw) {
    if (!channelState.customCommands) return null;

    if (channelState.customCommands[cmdImeRaw]) {
        return { key: cmdImeRaw, cmd: channelState.customCommands[cmdImeRaw] };
    }

    const normalizedInput = ukloniSrpskeDijakritike(cmdImeRaw);
    let foundKey = Object.keys(channelState.customCommands).find(k =>
        ukloniSrpskeDijakritike(k.toLowerCase()) === normalizedInput
    );

    // Ako komanda nije pronađena po tačnom nazivu (npr. !up), a komanda je alias za drugu (npr. uptime),
    // proveri da li u customCommands postoji unos po glavnom ključu (npr. "uptime")
    if (!foundKey) {
        const ALIAS_TO_MAIN_KEY = {
            'up': 'uptime',
            'topwatch': 'topwatchtime',
            'help': 'komande',
            'pomoc': 'komande',
            'commands': 'komande',
            'vrijeme': 'vreme',
            'dozvoli': 'permit',
            'addcom': 'dodajkomandu',
            'delcom': 'obrisikomandu',
            'leaderboard': 'top',
            'topchat': 'top',
            'topchatters': 'top',
            'topchatter': 'top',
            'topmessages': 'top',
            'topporuke': 'top',
            'sati': 'watchtime',
            'poruke': 'chat',
            'poruka': 'chat',
            'stats': 'me',
            'aktivnost': 'me',
            'level': 'rank',
            'xp': 'rank',
            'poeni': 'points',
            'bal': 'points',
            'coins': 'points',
            'dajpoene': 'givepoints',
            'pay': 'givepoints',
            'topxp': 'toplevel',
            'toppoeni': 'topcoins',
            'slot': 'slots',
            'rulet': 'roulette',
            'piskoglava': 'coinflip',
            'gamble': 'coinflip',
            'kockaj': 'coinflip',
            'wheel': 'tocak',
            'dvoboj': 'duel',
            'prodavnica': 'store',
            'shop': 'store',
            'kupi': 'redeem',
            'sr': 'pesma',
            'song': 'pesma'
        };
        const mainKey = ALIAS_TO_MAIN_KEY[normalizedInput];
        if (mainKey && channelState.customCommands[mainKey]) {
            foundKey = mainKey;
        }
    }

    if (foundKey) {
        return { key: foundKey, cmd: channelState.customCommands[foundKey] };
    }

    return null;
}

async function obradiCustomKomandu(chatroomId, username, porukaNormalized, channelState, senderObj) {
    if (channelState.feature_autoresponse === false) return false;
    if (!porukaNormalized.startsWith(channelState.PREFIX || '!')) return false;

    const cmdImeRaw = porukaNormalized.slice((channelState.PREFIX || '!').length).trim();
    let pronadjena = pronadjiCustomKomandu(channelState, cmdImeRaw);

    if (!pronadjena) {
        const sada = Date.now();
        if (sada - (channelState.lastCustomCommandsRefreshTs || 0) >= CUSTOM_COMMAND_REFRESH_THROTTLE_MS) {
            channelState.lastCustomCommandsRefreshTs = sada;
            await database.ucitajCustomKomande(chatroomId);
            pronadjena = pronadjiCustomKomandu(channelState, cmdImeRaw);
        }
    }

    if (!pronadjena) return false;

    const { key: cmdIme, cmd: customCmd } = pronadjena;

    // Rank provera za custom komandu
    const requiredRank = customCmd.min_rank || 'everyone';
    const userRank = getUserRankLevel(username, senderObj, channelState.channelUsername);
    if (userRank < RANK_LEVELS[requiredRank]) {
        messenger.posaljiPoruku(chatroomId, `❌ @${username}, ova komanda je rezervisana za ulogu: ${RANK_LABELS_SR[requiredRank] || requiredRank}.`);
        return true; // Konzumirano ali blokirano
    }

    if (utils.proveraKulauna(chatroomId, 'custom_' + cmdIme, username, customCmd.cooldown)) return true;

    // Inkrementiraj usage brojač u bazi za custom komandu
    if (database.KORISTI_SUPABASE && database.sbPanels && customCmd.id) {
        database.evidentirajKoriscenjeKomande(chatroomId, cmdIme);
    }

    messenger.posaljiPoruku(chatroomId, customCmd.response);
    return true;
}

async function obradiKomandu({ chatroomId, username, porukaSredjena, porukaLowerOriginal, senderObj, channelState, botUsernameResolved, prefix, startsWithPrefix }) {
    // Ako poruka ne počinje sa ispravnim prefiksom, proveravamo samo mentove, a sve ostale komande preskačemo
    if (!startsWithPrefix) {
        if (channelState.feature_autoresponse !== false && botUsernameResolved && porukaLowerOriginal.includes('@' + botUsernameResolved.toLowerCase())) {
            const ment = commands.handleBotMentions(chatroomId, username, porukaLowerOriginal);
            if (ment) return;
        }
        return;
    }

    // Normalizujemo poruku da uvek interno počinje sa '!' radi kompatibilnosti sa ugrađenim komandama
    let normalizovanaPoruka = '!' + porukaSredjena.slice(prefix.length).trim();
    const porukaLower = normalizovanaPoruka.toLowerCase();
    const porukaNormalized = ukloniSrpskeDijakritike(porukaLower);

    // Ekstrakcija i provera dozvole za ugrađene komande
    const cmdName = normalizovanaPoruka.slice(1).split(/\s+/)[0].toLowerCase();
    if (defaultBuiltinRanks[cmdName] !== undefined) {
        const podrazumevaniRank = defaultBuiltinRanks[cmdName];
        const provera = proveriDozvoluKomande(chatroomId, username, cmdName, channelState, senderObj, podrazumevaniRank);
        if (!provera.dozvoljeno) {
            if (provera.razlog === 'disabled') {
                return;
            }
            if (provera.razlog === 'rank') {
                messenger.posaljiPoruku(chatroomId, `❌ @${username}, ova komanda je rezervisana za ulogu: ${RANK_LABELS_SR[provera.requiredRank] || provera.requiredRank}.`);
            }
            return;
        }
        // Evidentiraj korišćenje ugrađene komande u bazi podataka za dashboard brojač
        database.evidentirajKoriscenjeKomande(chatroomId, cmdName);
    }

    // Dinamičke komande
    if (porukaNormalized.startsWith('!vreme') || porukaNormalized.startsWith('!vrijeme') || porukaNormalized.startsWith('!weather')) {
        const isVreme = porukaNormalized.startsWith('!vreme');
        const isWeather = porukaNormalized.startsWith('!weather');
        let grad = '';
        if (isVreme) grad = porukaSredjena.slice(6).trim();
        else if (isWeather) grad = porukaSredjena.slice(8).trim();
        else grad = porukaSredjena.slice(8).trim();
        if (grad) {
            if (utils.proveraKulauna(chatroomId, '!vreme', username)) return;
            commands.handleVreme(chatroomId, grad);
        } else {
            messenger.posaljiPoruku(chatroomId, `Upotreba: !vreme <naziv grada> (ili !weather <city>) — npr. !vreme Beograd`);
        }
        return;
    }

    if (porukaNormalized === '!uptime' || porukaNormalized === '!up') {
        if (utils.proveraKulauna(chatroomId, '!uptime', username)) return;
        commands.handleUptime(chatroomId);
        return;
    }

    if (porukaNormalized === '!igra' || porukaNormalized === '!game') {
        if (channelState.feature_games === false) return;
        if (utils.proveraKulauna(chatroomId, '!igra', username)) return;
        commands.handleIgra(chatroomId);
        return;
    }

    if (porukaNormalized === '!watchtime' || porukaNormalized.startsWith('!watchtime ') || porukaNormalized === '!sati' || porukaNormalized.startsWith('!sati ') || porukaNormalized === '!time' || porukaNormalized.startsWith('!time ')) {
        if (channelState.feature_watchtime === false) return;
        let args = '';
        if (porukaNormalized.startsWith('!watchtime')) {
            args = normalizovanaPoruka.slice(10).trim();
        } else if (porukaNormalized.startsWith('!time')) {
            args = normalizovanaPoruka.slice(5).trim();
        } else {
            args = normalizovanaPoruka.slice(5).trim();
        }
        if (utils.proveraKulauna(chatroomId, '!watchtime', username)) return;
        watchtime.handleWatchtime(chatroomId, username, args);
        return;
    }

    if (porukaNormalized.startsWith('!topwatchtime') || porukaNormalized.startsWith('!topwatch') || porukaNormalized.startsWith('!toptime')) {
        if (channelState.feature_watchtime === false) return;
        let limit = '';
        if (porukaNormalized.startsWith('!topwatchtime')) limit = normalizovanaPoruka.slice(13).trim();
        else if (porukaNormalized.startsWith('!toptime')) limit = normalizovanaPoruka.slice(8).trim();
        else limit = normalizovanaPoruka.slice(9).trim();
        if (utils.proveraKulauna(chatroomId, '!topwatchtime', username)) return;
        watchtime.handleTopWatchtime(chatroomId, limit);
        return;
    }

    // ─── NIVOI & EKONOMIJA ─────────────────────────────────────────
    if (porukaNormalized.startsWith('!rank') || porukaNormalized.startsWith('!level') || porukaNormalized.startsWith('!xp')) {
        let target = '';
        if (porukaNormalized.startsWith('!rank')) target = porukaSredjena.slice(5).trim();
        else if (porukaNormalized.startsWith('!level')) target = porukaSredjena.slice(6).trim();
        else target = porukaSredjena.slice(3).trim();
        if (utils.proveraKulauna(chatroomId, '!rank', username)) return;
        economy.handleRank(chatroomId, username, target);
        return;
    }

    if (porukaNormalized.startsWith('!points') || porukaNormalized.startsWith('!poeni') || porukaNormalized.startsWith('!bal') || porukaNormalized.startsWith('!coins')) {
        let target = '';
        if (porukaNormalized.startsWith('!points')) target = porukaSredjena.slice(7).trim();
        else if (porukaNormalized.startsWith('!poeni')) target = porukaSredjena.slice(6).trim();
        else if (porukaNormalized.startsWith('!coins')) target = porukaSredjena.slice(6).trim();
        else target = porukaSredjena.slice(4).trim();
        if (utils.proveraKulauna(chatroomId, '!points', username)) return;
        economy.handlePoints(chatroomId, username, target);
        return;
    }

    if (porukaNormalized === '!daily' || porukaNormalized === '!dnevna') {
        if (utils.proveraKulauna(chatroomId, '!daily', username)) return;
        economy.handleDaily(chatroomId, username);
        return;
    }

    if (porukaNormalized.startsWith('!give ') || porukaNormalized.startsWith('!dajpoene ') || porukaNormalized.startsWith('!givepoints ')) {
        let rest = '';
        if (porukaNormalized.startsWith('!give ')) rest = porukaSredjena.slice(6).trim();
        else if (porukaNormalized.startsWith('!dajpoene ')) rest = porukaSredjena.slice(10).trim();
        else rest = porukaSredjena.slice(12).trim();
        const parts = rest.split(/\s+/);
        const target = parts[0] || '';
        const amount = parts[1] || '';
        if (utils.proveraKulauna(chatroomId, '!give', username)) return;
        economy.handleGivePoints(chatroomId, username, target, amount);
        return;
    }

    if (porukaNormalized.startsWith('!toplevel') || porukaNormalized.startsWith('!topxp')) {
        const limit = porukaNormalized.startsWith('!toplevel') ? porukaSredjena.slice(9).trim() : porukaSredjena.slice(6).trim();
        if (utils.proveraKulauna(chatroomId, '!toplevel', username)) return;
        economy.handleTopLevel(chatroomId, limit);
        return;
    }

    if (porukaNormalized.startsWith('!topcoins') || porukaNormalized.startsWith('!toppoeni') || porukaNormalized.startsWith('!toppoints')) {
        let limit = '';
        if (porukaNormalized.startsWith('!topcoins')) limit = porukaSredjena.slice(9).trim();
        else if (porukaNormalized.startsWith('!toppoints')) limit = porukaSredjena.slice(10).trim();
        else limit = porukaSredjena.slice(9).trim();
        if (utils.proveraKulauna(chatroomId, '!topcoins', username)) return;
        economy.handleTopCoins(chatroomId, limit);
        return;
    }

    // ─── KOCKANJE & KAZINO ──────────────────────────────────────────
    // Detekcija obrnutog redosleda: "200 !slot" → jasna poruka greške
    if (/^\d+\s+!slots?$/.test(porukaNormalized)) {
        messenger.posaljiPoruku(chatroomId, `@${username} Ispravna upotreba: !slot [iznos] (npr. !slot 200)`);
        return;
    }

    if (porukaNormalized.startsWith('!slots') || porukaNormalized.startsWith('!slot')) {
        if (channelState.feature_games === false) return;
        const amount = porukaNormalized.startsWith('!slots') ? porukaSredjena.slice(6).trim() : porukaSredjena.slice(5).trim();
        if (utils.proveraKulauna(chatroomId, '!slots', username)) return;
        gambling.handleSlots(chatroomId, username, amount);
        return;
    }

    if (porukaNormalized.startsWith('!roulette') || (porukaNormalized.startsWith('!rulet') && !porukaNormalized.startsWith('!ruskirulet'))) {
        if (channelState.feature_games === false) return;
        let rest = '';
        if (porukaNormalized.startsWith('!roulette')) rest = porukaSredjena.slice(9).trim();
        else rest = porukaSredjena.slice(6).trim();
        const parts = rest.split(/\s+/);
        const opt = parts[0] || '';
        const amount = parts[1] || '';
        if (utils.proveraKulauna(chatroomId, '!roulette', username)) return;
        gambling.handleRoulette(chatroomId, username, opt, amount);
        return;
    }

    // Detekcija čestih tipfelera za coinflip
    if (porukaNormalized.startsWith('!coinsflip') || porukaNormalized.startsWith('!coinflipp') || porukaNormalized.startsWith('!coinfliip')) {
        messenger.posaljiPoruku(chatroomId, `@${username} Da li si mislio/la: !coinflip [iznos]? (npr. !coinflip 100 glava)`);
        return;
    }

    if (porukaNormalized.startsWith('!coinflip ') || porukaNormalized === '!coinflip' || porukaNormalized.startsWith('!piskoglava ') || porukaNormalized.startsWith('!gamble ') || porukaNormalized.startsWith('!kockaj ') || porukaNormalized.startsWith('!flip ') || porukaNormalized === '!flip') {
        if (channelState.feature_games === false) return;
        let rest = '';
        if (porukaNormalized.startsWith('!coinflip')) rest = porukaSredjena.slice(9).trim();
        else if (porukaNormalized.startsWith('!flip')) rest = porukaSredjena.slice(5).trim();
        else if (porukaNormalized.startsWith('!piskoglava ')) rest = porukaSredjena.slice(12).trim();
        else if (porukaNormalized.startsWith('!gamble ')) rest = porukaSredjena.slice(8).trim();
        else rest = porukaSredjena.slice(8).trim();

        const parts = rest.split(/\s+/);
        const side = parts[0] || 'glava';
        const amount = parts[1] || parts[0] || '';
        if (utils.proveraKulauna(chatroomId, '!coinflip', username)) return;
        gambling.handleCoinflip(chatroomId, username, side, amount);
        return;
    }

    if (porukaNormalized.startsWith('!tocak') || porukaNormalized.startsWith('!wheel') || porukaNormalized.startsWith('!spin')) {
        if (channelState.feature_games === false) return;
        let amount = '';
        if (porukaNormalized.startsWith('!tocak')) amount = porukaSredjena.slice(6).trim();
        else if (porukaNormalized.startsWith('!wheel')) amount = porukaSredjena.slice(6).trim();
        else amount = porukaSredjena.slice(5).trim();
        if (utils.proveraKulauna(chatroomId, '!wheel', username)) return;
        gambling.handleWheel(chatroomId, username, amount);
        return;
    }

    if (porukaNormalized.startsWith('!duel ') || porukaNormalized.startsWith('!dvoboj ')) {
        if (channelState.feature_games === false) return;
        const rest = porukaNormalized.startsWith('!duel ') ? porukaSredjena.slice(6).trim() : porukaSredjena.slice(8).trim();
        const parts = rest.split(/\s+/);
        const target = parts[0] || '';
        const amount = parts[1] || '';
        if (utils.proveraKulauna(chatroomId, '!duel', username)) return;
        gambling.handleDuel(chatroomId, username, target, amount);
        return;
    }

    // ─── PRODAVNICA & NAGRADE ───────────────────────────────────────
    if (porukaNormalized === '!store' || porukaNormalized === '!prodavnica' || porukaNormalized === '!shop') {
        if (utils.proveraKulauna(chatroomId, '!store', username)) return;
        commands.handleStoreList(chatroomId);
        return;
    }

    if (porukaNormalized.startsWith('!redeem ') || porukaNormalized.startsWith('!kupi ') || porukaNormalized.startsWith('!buy ')) {
        let query = '';
        if (porukaNormalized.startsWith('!redeem ')) query = porukaSredjena.slice(8).trim();
        else if (porukaNormalized.startsWith('!kupi ')) query = porukaSredjena.slice(6).trim();
        else query = porukaSredjena.slice(5).trim();
        if (utils.proveraKulauna(chatroomId, '!redeem', username)) return;
        commands.handleRedeemStore(chatroomId, username, query);
        return;
    }

    if (porukaNormalized.startsWith('!roll') || porukaNormalized.startsWith('!dice')) {
        if (channelState.feature_games === false) return;
        const target = porukaNormalized.startsWith('!roll') ? porukaSredjena.slice(5).trim() : porukaSredjena.slice(5).trim();
        if (utils.proveraKulauna(chatroomId, '!roll', username)) return;
        commands.handleRoll(chatroomId, username, target);
        return;
    }

    if (porukaNormalized.startsWith('!iq')) {
        if (channelState.feature_games === false) return;
        const target = porukaSredjena.slice(3).trim();
        if (utils.proveraKulauna(chatroomId, '!iq', username)) return;
        commands.handleIq(chatroomId, username, target);
        return;
    }

    if (porukaNormalized.startsWith('!samar') || porukaNormalized.startsWith('!slap')) {
        if (channelState.feature_games === false) return;
        const target = porukaNormalized.startsWith('!samar') ? porukaSredjena.slice(6).trim() : porukaSredjena.slice(5).trim();
        if (utils.proveraKulauna(chatroomId, '!samar', username)) return;
        commands.handleSamar(chatroomId, username, target);
        return;
    }

    if (porukaNormalized.startsWith('!ruskirulet') || porukaNormalized.startsWith('!rr') || porukaNormalized.startsWith('!russianroulette')) {
        if (channelState.feature_games === false) return;
        if (utils.proveraKulauna(chatroomId, '!ruskirulet', username)) return;
        commands.handleRulet(chatroomId, username);
        return;
    }

    if (porukaNormalized.startsWith('!alkotest') || porukaNormalized.startsWith('!alcohol') || porukaNormalized.startsWith('!bac')) {
        if (channelState.feature_games === false) return;
        let target = '';
        if (porukaNormalized.startsWith('!alkotest')) target = porukaSredjena.slice(9).trim();
        else if (porukaNormalized.startsWith('!alcohol')) target = porukaSredjena.slice(8).trim();
        else target = porukaSredjena.slice(4).trim();
        if (utils.proveraKulauna(chatroomId, '!alkotest', username)) return;
        commands.handleAlkotest(chatroomId, username, target);
        return;
    }

    if (porukaNormalized.startsWith('!cinjenica') || porukaNormalized.startsWith('!fact')) {
        if (channelState.feature_games === false) return;
        if (utils.proveraKulauna(chatroomId, '!cinjenica', username)) return;
        commands.handleCinjenica(chatroomId);
        return;
    }

    if (porukaNormalized.startsWith('!followage') || porukaNormalized.startsWith('!pratim')) {
        const target = porukaNormalized.startsWith('!followage') ? porukaSredjena.slice(10).trim() : porukaSredjena.slice(7).trim();
        if (utils.proveraKulauna(chatroomId, '!followage', username)) return;
        commands.handleFollowage(chatroomId, username, target);
        return;
    }

    if (porukaNormalized.startsWith('!permit') || porukaNormalized.startsWith('!dozvoli')) {
        const isPermit = porukaNormalized.startsWith('!permit');
        const target = isPermit ? porukaSredjena.slice(7).trim() : porukaSredjena.slice(8).trim();
        commands.handlePermit(chatroomId, username, target, senderObj);
        return;
    }

    if (porukaNormalized === '!komande' || porukaNormalized === '!help' || porukaNormalized === '!pomoc' || porukaNormalized === '!commands') {
        if (utils.proveraKulauna(chatroomId, '!komande', username)) return;
        commands.handleHelp(chatroomId, username);
        return;
    }

    if (porukaNormalized === '!queue' || porukaNormalized === '!songqueue' || porukaNormalized === '!redpesama') {
        if (channelState.feature_songrequest === false) return;
        if (utils.proveraKulauna(chatroomId, '!queue', username)) return;
        commands.handleSongQueue(chatroomId);
        return;
    }

    if (porukaNormalized === '!skip' || porukaNormalized === '!skipsong' || porukaNormalized === '!preskocipesmu') {
        if (channelState.feature_songrequest === false) return;
        commands.handleSkipSong(chatroomId, username, senderObj);
        return;
    }

    if (porukaNormalized === '!pesma' || porukaNormalized === '!sr' || porukaNormalized === '!song' ||
        porukaNormalized.startsWith('!pesma ') || porukaNormalized.startsWith('!sr ') || porukaNormalized.startsWith('!song ')) {
        if (channelState.feature_songrequest === false) return;
        let songQuery = '';
        if (porukaNormalized.startsWith('!pesma ')) songQuery = porukaSredjena.slice(7).trim();
        else if (porukaNormalized.startsWith('!sr ')) songQuery = porukaSredjena.slice(4).trim();
        else if (porukaNormalized.startsWith('!song ')) songQuery = porukaSredjena.slice(6).trim();
        if (utils.proveraKulauna(chatroomId, '!pesma', username)) return;
        commands.handlePesma(chatroomId, username, songQuery, senderObj);
        return;
    }

    if (porukaNormalized === '!info') {
        if (utils.proveraKulauna(chatroomId, '!info', username)) return;
        commands.handleInfo(chatroomId);
        return;
    }

    if (porukaNormalized.startsWith('!love')) {
        if (channelState.feature_love === false) return;
        const args = porukaSredjena.slice(5).trim();
        if (utils.proveraKulauna(chatroomId, '!love', username)) return;
        commands.handleLove(chatroomId, username, args);
        return;
    }

    if (porukaNormalized.startsWith('!posaljiljubav') || porukaNormalized.startsWith('!sendlove')) {
        if (channelState.feature_love === false) return;
        const isPl = porukaNormalized.startsWith('!posaljiljubav');
        const targetRaw = isPl ? porukaSredjena.slice(14).trim() : porukaSredjena.slice(9).trim();
        const targetClean = targetRaw.split(/\s+/)[0].replace(/^@/, '').trim();
        if (!targetClean) {
            messenger.posaljiPoruku(chatroomId, `@${username}, upotreba: !posaljiljubav @user (ili !sendlove @user)`);
            return;
        }

        const userKey = username.toLowerCase();
        const sada = Date.now();
        const zadnji = channelState.loveHateCooldowns[userKey] || 0;

        if (sada - zadnji < config.LOVE_HATE_COOLDOWN_MS) {
            const preostaloMs = config.LOVE_HATE_COOLDOWN_MS - (sada - zadnji);
            const sati = Math.floor(preostaloMs / 3600000);
            const minuti = Math.floor((preostaloMs % 3600000) / 60000);
            const sekunde = Math.floor((preostaloMs % 60000) / 1000);

            let preostaloTekst = '';
            if (sati > 0) preostaloTekst += `${sati}h `;
            if (minuti > 0) preostaloTekst += `${minuti}min `;
            if (sekunde > 0 || (sati === 0 && minuti === 0)) preostaloTekst += `${sekunde}s`;

            messenger.posaljiPoruku(chatroomId, `❌ @${username}, cooldown: ${preostaloTekst.trim()}.`);
            return;
        }

        const uspesno = commands.handleModifyLove(chatroomId, username, targetClean, 2);
        if (uspesno) {
            channelState.loveHateCooldowns[userKey] = sada;
        }
        return;
    }

    if (porukaNormalized.startsWith('!bacihejt') || porukaNormalized.startsWith('!sendhate')) {
        if (channelState.feature_love === false) return;
        const isBh = porukaNormalized.startsWith('!bacihejt');
        const targetRaw = isBh ? porukaSredjena.slice(9).trim() : porukaSredjena.slice(9).trim();
        const targetClean = targetRaw.split(/\s+/)[0].replace(/^@/, '').trim();
        if (!targetClean) {
            messenger.posaljiPoruku(chatroomId, `@${username}, upotreba: !bacihejt @user (ili !sendhate @user)`);
            return;
        }

        const userKey = username.toLowerCase();
        const sada = Date.now();
        const zadnji = channelState.loveHateCooldowns[userKey] || 0;

        if (sada - zadnji < config.LOVE_HATE_COOLDOWN_MS) {
            const preostaloMs = config.LOVE_HATE_COOLDOWN_MS - (sada - zadnji);
            const sati = Math.floor(preostaloMs / 3600000);
            const minuti = Math.floor((preostaloMs % 3600000) / 60000);
            const sekunde = Math.floor((preostaloMs % 60000) / 1000);

            let preostaloTekst = '';
            if (sati > 0) preostaloTekst += `${sati}h `;
            if (minuti > 0) preostaloTekst += `${minuti}min `;
            if (sekunde > 0 || (sati === 0 && minuti === 0)) preostaloTekst += `${sekunde}s`;

            messenger.posaljiPoruku(chatroomId, `❌ @${username}, cooldown: ${preostaloTekst.trim()}.`);
            return;
        }

        const uspesno = commands.handleModifyLove(chatroomId, username, targetClean, -5);
        if (uspesno) {
            channelState.loveHateCooldowns[userKey] = sada;
        }
        return;
    }

    if (porukaNormalized === '!cooldown' || porukaNormalized === '!coldown' || porukaNormalized === '!cd') {
        const userKey = username.toLowerCase();
        const sada = Date.now();
        const zadnji = channelState.loveHateCooldowns[userKey] || 0;

        if (sada - zadnji < config.LOVE_HATE_COOLDOWN_MS) {
            const preostaloMs = config.LOVE_HATE_COOLDOWN_MS - (sada - zadnji);
            const sati = Math.floor(preostaloMs / 3600000);
            const minuti = Math.floor((preostaloMs % 3600000) / 60000);
            const sekunde = Math.floor((preostaloMs % 60000) / 1000);

            let preostaloTekst = '';
            if (sati > 0) preostaloTekst += `${sati}h `;
            if (minuti > 0) preostaloTekst += `${minuti}min `;
            if (sekunde > 0 || (sati === 0 && minuti === 0)) preostaloTekst += `${sekunde}s`;

            messenger.posaljiPoruku(chatroomId, `⏳ @${username}, cooldown: ${preostaloTekst.trim()}.`);
        } else {
            messenger.posaljiPoruku(chatroomId, `✅ @${username}, nema cooldown-a.`);
        }
        return;
    }

    if (porukaNormalized.startsWith('!mrzim') || porukaNormalized.startsWith('!hate')) {
        if (channelState.feature_love === false) return;
        const args = porukaNormalized.startsWith('!mrzim') ? porukaSredjena.slice(6).trim() : porukaSredjena.slice(5).trim();
        if (utils.proveraKulauna(chatroomId, '!mrzim', username)) return;
        commands.handleMrzim(chatroomId, username, args);
        return;
    }

    // ─── UNIFICIRANO PRIHVATANJE & ODBIJANJE (DVOBOJ & BRAK) ─────────
    if (porukaNormalized === '!accept' || porukaNormalized === '!prihvati' || porukaNormalized === '!da' || porukaNormalized === '!pristajem' || porukaNormalized === '!yes') {
        const userKey = username.toLowerCase();
        if (channelState.pendingDuels && channelState.pendingDuels[userKey]) {
            gambling.handleAcceptDuel(chatroomId, username);
            return;
        }
        if (channelState.pendingProposals && channelState.pendingProposals[userKey]) {
            if (utils.proveraKulauna(chatroomId, '!prihvati', username)) return;
            commands.handlePrihvatiBrak(chatroomId, username);
            return;
        }
        if (porukaNormalized === '!accept') {
            gambling.handleAcceptDuel(chatroomId, username);
        } else {
            messenger.posaljiPoruku(chatroomId, `❌ @${username}, nemaš aktivnih poziva za dvoboj niti predloga za brak.`);
        }
        return;
    }

    if (porukaNormalized === '!odbij' || porukaNormalized === '!ne' || porukaNormalized === '!odbijam' || porukaNormalized === '!decline' || porukaNormalized === '!no') {
        const userKey = username.toLowerCase();
        if (channelState.pendingDuels && channelState.pendingDuels[userKey]) {
            gambling.handleDeclineDuel(chatroomId, username);
            return;
        }
        if (channelState.pendingProposals && channelState.pendingProposals[userKey]) {
            if (utils.proveraKulauna(chatroomId, '!odbij', username)) return;
            commands.handleOdbijBrak(chatroomId, username);
            return;
        }
        messenger.posaljiPoruku(chatroomId, `❌ @${username}, nemaš aktivnih poziva za dvoboj niti predloga za brak.`);
        return;
    }

    if (porukaNormalized.startsWith('!vencaj') || porukaNormalized.startsWith('!marry') || porukaNormalized.startsWith('!propose')) {
        if (channelState.feature_love === false) return;
        let targetRaw = '';
        if (porukaNormalized.startsWith('!vencaj')) targetRaw = porukaSredjena.slice(7).trim();
        else if (porukaNormalized.startsWith('!marry')) targetRaw = porukaSredjena.slice(6).trim();
        else targetRaw = porukaSredjena.slice(8).trim();
        if (utils.proveraKulauna(chatroomId, '!vencaj', username)) return;
        commands.handleVencaj(chatroomId, username, targetRaw);
        return;
    }

    if (porukaNormalized.startsWith('!razvod') || porukaNormalized.startsWith('!divorce')) {
        if (channelState.feature_love === false) return;
        const target = porukaNormalized.startsWith('!razvod') ? porukaSredjena.slice(7).trim() : porukaSredjena.slice(8).trim();
        if (utils.proveraKulauna(chatroomId, '!razvod', username)) return;
        commands.handleRazvod(chatroomId, username, target);
        return;
    }

    if (porukaNormalized === '!brakovi' || porukaNormalized === '!brak' || porukaNormalized === '!vencani' || porukaNormalized === '!marriages' || porukaNormalized === '!couples') {
        if (channelState.feature_love === false) return;
        if (utils.proveraKulauna(chatroomId, '!brakovi', username)) return;
        commands.handleBrakovi(chatroomId);
        return;
    }

    // Leaderboard komande
    if (porukaNormalized.startsWith('!top') || porukaNormalized.startsWith('!leaderboard')) {
        if (channelState.feature_leaderboard === false) return;
        let limitStr = '';
        if (porukaNormalized.startsWith('!top')) {
            limitStr = normalizovanaPoruka.slice(4).trim();
        } else {
            limitStr = normalizovanaPoruka.slice(12).trim();
        }
        if (utils.proveraKulauna(chatroomId, '!top', username)) return;
        commands.handleTop(chatroomId, limitStr);
        return;
    }

    // Čet aktivnost (!chat, !aktivnost, !poruke, !messages)
    if (porukaNormalized.startsWith('!chat') || porukaNormalized.startsWith('!aktivnost') || porukaNormalized.startsWith('!poruke') || porukaNormalized.startsWith('!poruka') || porukaNormalized.startsWith('!messages')) {
        if (channelState.feature_leaderboard === false) return;
        let target = '';
        if (porukaNormalized.startsWith('!chat')) target = normalizovanaPoruka.slice(5).trim();
        else if (porukaNormalized.startsWith('!aktivnost')) target = normalizovanaPoruka.slice(10).trim();
        else if (porukaNormalized.startsWith('!messages')) target = normalizovanaPoruka.slice(9).trim();
        else if (porukaNormalized.startsWith('!poruke')) target = normalizovanaPoruka.slice(7).trim();
        else target = normalizovanaPoruka.slice(7).trim();
        if (utils.proveraKulauna(chatroomId, '!chat', username)) return;
        commands.handleAktivnost(chatroomId, username, target);
        return;
    }

    // Korisnički profil i karton (!me, !stats, !profil, !profile)
    if (porukaNormalized.startsWith('!me') || porukaNormalized.startsWith('!stats') || porukaNormalized.startsWith('!profil') || porukaNormalized.startsWith('!profile')) {
        if (channelState.feature_leaderboard === false) return;
        let target = '';
        if (porukaNormalized.startsWith('!me')) target = porukaSredjena.slice(3).trim();
        else if (porukaNormalized.startsWith('!stats')) target = porukaSredjena.slice(6).trim();
        else if (porukaNormalized.startsWith('!profile')) target = porukaSredjena.slice(8).trim();
        else target = porukaSredjena.slice(7).trim();
        if (utils.proveraKulauna(chatroomId, '!me', username)) return;
        commands.handleMe(chatroomId, username, target);
        return;
    }

    // Admin komande
    const isAuthorized = username.toLowerCase() === (channelState.channelUsername || '').toLowerCase() ||
        (config.SUPER_ADMIN_USERNAME && username.toLowerCase() === config.SUPER_ADMIN_USERNAME) ||
        (senderObj.identity &&
            senderObj.identity.badges &&
            senderObj.identity.badges.some(b => b.type === 'broadcaster'));

    const canPin = isAuthorized ||
        (senderObj.identity &&
            senderObj.identity.badges &&
            senderObj.identity.badges.some(b => b.type === 'moderator'));

    if (porukaNormalized === '!resetleaderboard' || porukaNormalized === '!resetlb') {
        commands.handleResetLeaderboard(chatroomId, username, isAuthorized);
        return;
    }

    if (porukaNormalized === '!osvezi' || porukaNormalized === '!reload') {
        commands.handleOsvezi(chatroomId, username, isAuthorized);
        return;
    }

    if (porukaNormalized === '!pin' || porukaNormalized.startsWith('!pin ')) {
        if (canPin) {
            let tekst = '';
            if (porukaNormalized.startsWith('!pin ')) {
                tekst = porukaSredjena.slice(5).trim();
            } else {
                tekst = channelState.STREAM_START_PIN_MESSAGE;
            }

            if (tekst) {
                messenger.posaljiIPinujPoruku(chatroomId, tekst);
            } else {
                messenger.posaljiPoruku(chatroomId, `⚠️ Upotreba: !pin <tekst poruke za pinovanje>`);
            }
        } else {
            messenger.posaljiPoruku(chatroomId, `❌ Samo moderatori i strimer mogu pinovati poruku.`);
        }
        return;
    }

    if (porukaNormalized === '!unpin') {
        if (canPin) {
            messenger.odpinujPoruku(chatroomId);
        } else {
            messenger.posaljiPoruku(chatroomId, `❌ Samo moderatori i strimer mogu odpinovati poruku.`);
        }
        return;
    }

    if (porukaNormalized.startsWith('!setlive ')) {
        if (isAuthorized) {
            const val = porukaSredjena.slice(9).trim().toLowerCase();
            if (val === 'true') {
                channelState.isStreamLive = true;
                channelState.manualStreamStartTs = Date.now();
                messenger.posaljiPoruku(chatroomId, '🔴 Status strima je ručno podešen na: LIVE.');
            } else if (val === 'false') {
                channelState.isStreamLive = false;
                channelState.manualStreamStartTs = 0;
                messenger.posaljiPoruku(chatroomId, '⚪ Status strima je ručno podešen na: OFFLINE.');
            } else {
                messenger.posaljiPoruku(chatroomId, 'Upotreba: !setlive true or !setlive false');
            }
        }
        return;
    }

    if (porukaNormalized.startsWith('!setgame ')) {
        if (isAuthorized) {
            const game = porukaSredjena.slice(9).trim();
            if (game) {
                channelState.manualGameName = game;
                messenger.posaljiPoruku(chatroomId, `🎮 Igra je ručno podešena na: ${game}`);
            } else {
                messenger.posaljiPoruku(chatroomId, 'Upotreba: !setgame <naziv igre>');
            }
        }
        return;
    }

    if (porukaNormalized.startsWith('!addcom ') || porukaNormalized.startsWith('!dodajkomandu ')) {
        const textRaw = porukaNormalized.startsWith('!addcom ') ? porukaSredjena.slice(8).trim() : porukaSredjena.slice(14).trim();
        await commands.handleAddCommand(chatroomId, username, textRaw, senderObj);
        return;
    }

    if (porukaNormalized.startsWith('!delcom ') || porukaNormalized.startsWith('!obrisikomandu ')) {
        const cmdRaw = porukaNormalized.startsWith('!delcom ') ? porukaSredjena.slice(8).trim() : porukaSredjena.slice(15).trim();
        await commands.handleDelCommand(chatroomId, username, cmdRaw, senderObj);
        return;
    }

    // Custom komande iz baze podataka
    if (await obradiCustomKomandu(chatroomId, username, porukaNormalized, channelState, senderObj)) {
        return;
    }
}

module.exports = {
    ukloniSrpskeDijakritike,
    RANK_LEVELS,
    RANK_LABELS_SR,
    defaultBuiltinRanks,
    getUserRankLevel,
    proveriDozvoluKomande,
    pronadjiCustomKomandu,
    obradiCustomKomandu,
    obradiKomandu
};
