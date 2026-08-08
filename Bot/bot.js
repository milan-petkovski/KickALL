require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');

// Uvoz pomoćnih modula
const config = require('./src/config');
const state = require('./src/state');
const utils = require('./src/utils');
const database = require('./src/database');
const spam = require('./src/spam');
const commands = require('./src/commands');
const messenger = require('./src/messenger');
const watchtime = require('./src/watchtime');
const moderation = require('./src/moderation');
const economy = require('./src/economy');
const gambling = require('./src/gambling');

let botUsernameResolved = config.BOT_USERNAME;

async function detectBotUsername() {
    if (!config.BEARER_TOKEN) return;
    try {
        const authHeader = config.BEARER_TOKEN.startsWith('Bearer ') ? config.BEARER_TOKEN : `Bearer ${config.BEARER_TOKEN}`;
        const response = await fetch('https://id.kick.com/public/v1/users/me', {
            headers: { 'Authorization': authHeader }
        });
        if (response.ok) {
            const data = await response.json();
            if (data && data.username) {
                botUsernameResolved = data.username;
                utils.log('INFO', `Detektovano korisničko ime bota preko API-ja: @${botUsernameResolved}`);
            }
        }
    } catch (err) {
        utils.log('WARN', `Greška pri detekciji korisničkog ime bota: ${err.message}`);
    }
}

function ukloniSrpskeDijakritike(str) {
    if (!str) return '';
    return str
        .replace(/š/g, 's')
        .replace(/đ/g, 'd')
        .replace(/č/g, 'c')
        .replace(/ć/g, 'c')
        .replace(/ž/g, 'z')
        .replace(/Š/g, 's')
        .replace(/Đ/g, 'd')
        .replace(/Č/g, 'c')
        .replace(/Ć/g, 'c')
        .replace(/Ž/g, 'z');
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
    'roll': 'everyone',
    'duel': 'everyone',
    'rulet': 'everyone',
    'ruskirulet': 'everyone',
    'alkotest': 'everyone',
    'cinjenica': 'everyone',
    
    // Ljubav & Brak
    'love': 'everyone',
    'vencaj': 'everyone',
    'razvod': 'everyone',
    'brakovi': 'everyone',
    'brak': 'everyone',
    'vencani': 'everyone',
    'posaljiljubav': 'everyone',
    'odbijljubav': 'everyone',
    'mrzim': 'everyone',
    'bacihejt': 'everyone',
    'prihvati': 'everyone',
    'da': 'everyone',
    'pristajem': 'everyone',
    'odbij': 'everyone',
    'ne': 'everyone',
    'odbijam': 'everyone',
    'cooldown': 'everyone',
    'coldown': 'everyone',
    
    // Strim Info
    'komande': 'everyone',
    'help': 'everyone',
    'pomoc': 'everyone',
    'commands': 'everyone',
    'vreme': 'everyone',
    'vrijeme': 'everyone',
    'uptime': 'everyone',
    'igra': 'everyone',
    'info': 'everyone',
    
    // Moderacija
    'permit': 'moderator',
    'dozvoli': 'moderator',
    'addcom': 'moderator',
    'dodajkomandu': 'moderator',
    'delcom': 'moderator',
    'obrisikomandu': 'moderator',
    'osvezi': 'broadcaster',
    'pin': 'moderator',
    'unpin': 'broadcaster',
    'setlive': 'broadcaster',
    'setgame': 'broadcaster',
    
    // Statistika
    'watchtime': 'everyone',
    'topwatchtime': 'everyone',
    'topwatch': 'everyone',
    'top': 'everyone',
    'leaderboard': 'everyone',
    'aktivnost': 'everyone',
    'stats': 'everyone',
    'me': 'everyone',
    'followage': 'everyone',
    'resetleaderboard': 'broadcaster',
    
    // Ekonomija
    'rank': 'everyone',
    'level': 'everyone',
    'xp': 'everyone',
    'points': 'everyone',
    'poeni': 'everyone',
    'bal': 'everyone',
    'coins': 'everyone',
    'daily': 'everyone',
    'givepoints': 'everyone',
    'dajpoene': 'everyone',
    'pay': 'everyone',
    'toplevel': 'everyone',
    'topxp': 'everyone',
    'topcoins': 'everyone',
    'toppoeni': 'everyone',
    
    // Kockanje
    'slots': 'everyone',
    'slot': 'everyone',
    'roulette': 'everyone',
    'rulet': 'everyone',
    'coinflip': 'everyone',
    'piskoglava': 'everyone',
    'gamble': 'everyone',
    'kockaj': 'everyone',
    'tocak': 'everyone',
    'wheel': 'everyone',
    'dvoboj': 'everyone',
    'accept': 'everyone',
    
    // Prodavnica
    'store': 'everyone',
    'prodavnica': 'everyone',
    'shop': 'everyone',
    'redeem': 'everyone',
    'kupi': 'everyone',
    
    // Muzika
    'pesma': 'everyone',
    'sr': 'everyone',
    'song': 'everyone'
};

function getUserRankLevel(username, senderObj, channelUsername) {
    const userKey = username.toLowerCase();
    if (userKey === channelUsername.toLowerCase() || userKey === 'milan_567') return 5; // Streamer / Creator

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
    const foundKey = Object.keys(channelState.customCommands).find(k =>
        ukloniSrpskeDijakritike(k.toLowerCase()) === normalizedInput
    );

    if (!foundKey) return null;

    return { key: foundKey, cmd: channelState.customCommands[foundKey] };
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

    // Rank proveru za custom komandu
    const requiredRank = customCmd.min_rank || 'everyone';
    const userRank = getUserRankLevel(username, senderObj, channelState.channelUsername);
    if (userRank < RANK_LEVELS[requiredRank]) {
        messenger.posaljiPoruku(chatroomId, `❌ @${username}, ova komanda je rezervisana za ulogu: ${RANK_LABELS_SR[requiredRank] || requiredRank}.`);
        return true; // Konzumirano ali blokirano
    }

    if (utils.proveraKulauna(chatroomId, 'custom_' + cmdIme, username, customCmd.cooldown_ms)) return true;

    // Inkrementiraj uses_count u bazi
    if (database.KORISTI_SUPABASE && database.supabase) {
        (async () => {
            try {
                await database.supabase.rpc('increment_command_uses', {
                    p_channel_id: chatroomId,
                    p_command: cmdIme
                });
            } catch (e) {
                console.error('Error incrementing uses:', e);
            }
        })();
    }

    messenger.posaljiPoruku(chatroomId, customCmd.response);
    return true;
}

// ─── WEBSOCKET KONEKCIJA ──────────────────────────────────────────────────────
function povezi() {
    utils.log('INFO', `Pokušavam konekciju... (pokušaj #${state.reconnectAttempt + 1})`);

    state.ws = new WebSocket(
        'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.5.0&flash=false'
    );

    state.ws.on('open', () => {
        utils.log('INFO', 'Povezan na Kick server. Šaljem zahtev za pretplatu na sve aktivne kanale...');
        state.reconnectAttempt = 0;
        state.isConnected = true;

        for (const chatroomId of Object.keys(state.channels)) {
            const channelState = state.channels[chatroomId];
            const subId = channelState.realChatroomId || chatroomId;
            state.ws.send(JSON.stringify({
                event: 'pusher:subscribe',
                data: { channel: `chatrooms.${subId}.v2` }
            }));
        }

        startHeartbeat();
    });

    state.ws.on('message', async (data) => {
        let response;
        try {
            response = JSON.parse(data);
        } catch {
            return;
        }

        // Odgovaramo na Pusher ping
        if (response.event === 'pusher:ping') {
            state.ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
            return;
        }

        // Potvrda pretplate
        if (response.event === 'pusher_internal:subscription_succeeded') {
            utils.log('INFO', `Uspešno pretplaćen na kanal četa: ${response.channel}`);
            return;
        }

        // Nova chat poruka
        if (response.event === 'App\\Events\\ChatMessageEvent') {
            let chatData;
            try {
                chatData = JSON.parse(response.data);
            } catch {
                return;
            }

            if (!chatData || !chatData.content || !chatData.sender || !chatData.sender.username) {
                return;
            }

            // Ekstrakcija chatroom ID-ja iz koverte Pusher kanala
            const match = response.channel.match(/^chatrooms\.(\d+)\.v2$/);
            if (!match) return;
            const pusherChatroomId = match[1];

            // Nađimo odgovarajući interni chatroomId (baza/state ključ)
            let chatroomId = Object.keys(state.channels).find(k => {
                const cs = state.channels[k];
                return cs.realChatroomId === pusherChatroomId || k === pusherChatroomId;
            });
            if (!chatroomId) {
                chatroomId = pusherChatroomId;
            }

            const channelState = state.getChannelState(chatroomId);
            if (!channelState || !channelState.botActive || channelState.isModerator === false) {
                return;
            }

            const poruka = chatData.content.trim();
            const username = chatData.sender.username;
            const isBotMsg = chatData.sender.is_bot || false;
            const userKey = username.toLowerCase();

            // Preskačemo sopstvene poruke i poznate botove
            if (isBotMsg || userKey === botUsernameResolved.toLowerCase() || userKey === 'kickotbot' || userKey === 'botrix' || userKey === 'nightbot' || userKey === 'streamelements' || userKey === 'streamlabs') {
                return;
            }

            // Logujemo samo poruke drugih korisnika (ne botove)
            if (userKey !== botUsernameResolved.toLowerCase()) {
                utils.log('CHAT', `[@${channelState.channelUsername || chatroomId}] ${username}: ${poruka}`);
            }

            // Automatska moderacija četa
            const messageId = chatData.id || chatData.messageId || null;
            if (moderation.proveriModeraciju(chatroomId, username, poruka, messageId, chatData.sender)) {
                return;
            }

            // Anti-spam filter (izuzimamo strimera)
            if (userKey !== channelState.channelUsername.toLowerCase() && spam.spamFilter(chatroomId, username, poruka)) return;

            const prefix = channelState.PREFIX || '!';
            const startsWithPrefix = poruka.startsWith(prefix);

            // Ako poruka počinje sa prefiksom i posle njega ima razmak (npr. "! komanda"), spoj ih
            let porukaSredjena = poruka;
            if (startsWithPrefix) {
                const ostatak = poruka.slice(prefix.length).trim();
                porukaSredjena = prefix + ostatak;
            }

            // Welcome message: pošalji pozdravnu poruku ako je definisana i korisnik se prvi put javlja u ovoj sesiji
            if (channelState.welcome_message && !channelState.welcomedUsers.has(userKey)) {
                channelState.welcomedUsers.add(userKey);
                let welcomeMsg = channelState.welcome_message;
                welcomeMsg = welcomeMsg.replace(/{user}/g, `@${username}`).replace(/{username}/g, username);
                if (!welcomeMsg.includes(`@${username}`) && !welcomeMsg.includes(username)) {
                    welcomeMsg = `@${username}, ${welcomeMsg}`;
                }
                messenger.posaljiPoruku(chatroomId, welcomeMsg);
            }

            // Evidentiraj poruku u leaderboardu aktivnosti
            if (channelState.isStreamLive && !startsWithPrefix && userKey !== channelState.channelUsername.toLowerCase()) {
                database.evidentirajPoruku(chatroomId, username, poruka);
            }

            // Watchtime: registruj korisnika kao aktivnog gledaoca
            if (channelState.isStreamLive && userKey !== channelState.channelUsername.toLowerCase()) {
                watchtime.registrujAktivnogGledaoca(chatroomId, username);
            }

            // Ako poruka ne počinje sa ispravnim prefiksom, proveravamo samo mentove, a sve ostale komande preskačemo
            const porukaLowerOriginal = porukaSredjena.toLowerCase();
            if (!startsWithPrefix) {
                if (channelState.feature_autoresponse !== false && porukaLowerOriginal.includes('@' + botUsernameResolved.toLowerCase())) {
                    const ment = commands.handleBotMentions(chatroomId, username, porukaLowerOriginal);
                    if (ment) return;
                }
                return;
            }

            // Normalizujemo poruku da uvek interno počinje sa '!' radi kompatibilnosti sa ugrađenim komandama
            let normalizovanaPoruka = '!' + porukaSredjena.slice(prefix.length);
            const porukaLower = normalizovanaPoruka.toLowerCase();
            const porukaNormalized = ukloniSrpskeDijakritike(porukaLower);

            // Ekstrakcija i provera dozvole za ugrađene komande
            const cmdName = normalizovanaPoruka.slice(1).split(/\s+/)[0].toLowerCase();
            if (defaultBuiltinRanks[cmdName] !== undefined) {
                const podrazumevaniRank = defaultBuiltinRanks[cmdName];
                const provera = proveriDozvoluKomande(chatroomId, username, cmdName, channelState, chatData.sender, podrazumevaniRank);
                if (!provera.dozvoljeno) {
                    if (provera.razlog === 'rank') {
                        messenger.posaljiPoruku(chatroomId, `❌ @${username}, ova komanda je rezervisana za ulogu: ${RANK_LABELS_SR[provera.requiredRank] || provera.requiredRank}.`);
                    }
                    return;
                }
            }

            // Auto-announce brojač po broju poruka
            if (channelState.isStreamLive && channelState.announce_msg_enabled) {
                channelState.porukePosleAnnounce++;
                if (channelState.porukePosleAnnounce >= (channelState.announce_message_threshold || 30)) {
                    const sada = Date.now();
                    const minGapMs = 5 * 60 * 1000; // 5 minuta
                    if (sada - channelState.zadnjaAutoPorukaTs >= minGapMs) {
                        triggerAutoAnnounce(chatroomId);
                    }
                }
            }

            // Dinamičke komande
            if (porukaNormalized.startsWith('!vreme') || porukaNormalized.startsWith('!vrijeme')) {
                const isVreme = porukaNormalized.startsWith('!vreme');
                const grad = isVreme ? porukaSredjena.slice(6).trim() : porukaSredjena.slice(8).trim();
                if (grad) {
                    if (utils.proveraKulauna(chatroomId, '!vreme', username)) return;
                    commands.handleVreme(chatroomId, grad);
                } else {
                    messenger.posaljiPoruku(chatroomId, `Upotreba: ${isVreme ? '!vreme' : '!vrijeme'} <naziv grada> — npr. !vreme Beograd`);
                }
                return;
            }

            if (porukaNormalized === '!uptime') {
                if (utils.proveraKulauna(chatroomId, '!uptime', username)) return;
                commands.handleUptime(chatroomId);
                return;
            }

            if (porukaNormalized === '!igra') {
                if (channelState.feature_games === false) return;
                if (utils.proveraKulauna(chatroomId, '!igra', username)) return;
                commands.handleIgra(chatroomId);
                return;
            }

            if (porukaNormalized === '!watchtime' || porukaNormalized.startsWith('!watchtime ')) {
                if (channelState.feature_watchtime === false) return;
                const args = porukaSredjena.slice(10).trim();
                if (utils.proveraKulauna(chatroomId, '!watchtime', username)) return;
                watchtime.handleWatchtime(chatroomId, username, args);
                return;
            }

            if (porukaNormalized.startsWith('!topwatchtime') || porukaNormalized.startsWith('!topwatch')) {
                if (channelState.feature_watchtime === false) return;
                const limit = porukaNormalized.startsWith('!topwatchtime') ? porukaSredjena.slice(13).trim() : porukaSredjena.slice(9).trim();
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

            if (porukaNormalized === '!daily') {
                if (utils.proveraKulauna(chatroomId, '!daily', username)) return;
                economy.handleDaily(chatroomId, username);
                return;
            }

            if (porukaNormalized.startsWith('!givepoints ') || porukaNormalized.startsWith('!dajpoene ') || porukaNormalized.startsWith('!pay ')) {
                let rest = '';
                if (porukaNormalized.startsWith('!givepoints ')) rest = porukaSredjena.slice(12).trim();
                else if (porukaNormalized.startsWith('!dajpoene ')) rest = porukaSredjena.slice(10).trim();
                else rest = porukaSredjena.slice(5).trim();
                const parts = rest.split(/\s+/);
                const target = parts[0] || '';
                const amount = parts[1] || '';
                if (utils.proveraKulauna(chatroomId, '!givepoints', username)) return;
                economy.handleGivePoints(chatroomId, username, target, amount);
                return;
            }

            if (porukaNormalized.startsWith('!toplevel') || porukaNormalized.startsWith('!topxp')) {
                const limit = porukaNormalized.startsWith('!toplevel') ? porukaSredjena.slice(9).trim() : porukaSredjena.slice(6).trim();
                if (utils.proveraKulauna(chatroomId, '!toplevel', username)) return;
                economy.handleTopLevel(chatroomId, limit);
                return;
            }

            if (porukaNormalized.startsWith('!topcoins') || porukaNormalized.startsWith('!toppoeni')) {
                const limit = porukaNormalized.startsWith('!topcoins') ? porukaSredjena.slice(9).trim() : porukaSredjena.slice(9).trim();
                if (utils.proveraKulauna(chatroomId, '!topcoins', username)) return;
                economy.handleTopCoins(chatroomId, limit);
                return;
            }

            // ─── KOCKANJE & KAZINO ──────────────────────────────────────────
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

            if (porukaNormalized.startsWith('!coinflip ') || porukaNormalized.startsWith('!piskoglava ') || porukaNormalized.startsWith('!gamble ') || porukaNormalized.startsWith('!kockaj ')) {
                if (channelState.feature_games === false) return;
                let rest = '';
                if (porukaNormalized.startsWith('!coinflip ')) rest = porukaSredjena.slice(10).trim();
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

            if (porukaNormalized.startsWith('!tocak') || porukaNormalized.startsWith('!wheel')) {
                if (channelState.feature_games === false) return;
                const amount = porukaNormalized.startsWith('!tocak') ? porukaSredjena.slice(6).trim() : porukaSredjena.slice(6).trim();
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

            if (porukaNormalized === '!accept' || porukaNormalized === '!prihvati') {
                gambling.handleAcceptDuel(chatroomId, username);
                return;
            }

            if (porukaNormalized === '!odbij') {
                gambling.handleDeclineDuel(chatroomId, username);
                return;
            }

            // ─── PRODAVNICA & NAGRADE ───────────────────────────────────────
            if (porukaNormalized === '!store' || porukaNormalized === '!prodavnica' || porukaNormalized === '!shop') {
                if (utils.proveraKulauna(chatroomId, '!store', username)) return;
                commands.handleStoreList(chatroomId);
                return;
            }

            if (porukaNormalized.startsWith('!redeem ') || porukaNormalized.startsWith('!kupi ')) {
                const query = porukaNormalized.startsWith('!redeem ') ? porukaSredjena.slice(8).trim() : porukaSredjena.slice(6).trim();
                if (utils.proveraKulauna(chatroomId, '!redeem', username)) return;
                commands.handleRedeemStore(chatroomId, username, query);
                return;
            }

            if (porukaNormalized.startsWith('!roll')) {
                if (channelState.feature_games === false) return;
                const target = porukaSredjena.slice(5).trim();
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

            if (porukaNormalized.startsWith('!samar')) {
                if (channelState.feature_games === false) return;
                const target = porukaSredjena.slice(6).trim();
                if (utils.proveraKulauna(chatroomId, '!samar', username)) return;
                commands.handleSamar(chatroomId, username, target);
                return;
            }

            if (porukaNormalized.startsWith('!ruskirulet') || porukaNormalized.startsWith('!rr')) {
                if (channelState.feature_games === false) return;
                if (utils.proveraKulauna(chatroomId, '!ruskirulet', username)) return;
                commands.handleRulet(chatroomId, username);
                return;
            }

            if (porukaNormalized.startsWith('!alkotest')) {
                if (channelState.feature_games === false) return;
                const target = porukaSredjena.slice(9).trim();
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

            if (porukaNormalized.startsWith('!followage')) {
                const target = porukaSredjena.slice(10).trim();
                if (utils.proveraKulauna(chatroomId, '!followage', username)) return;
                commands.handleFollowage(chatroomId, username, target);
                return;
            }

            if (porukaNormalized.startsWith('!permit') || porukaNormalized.startsWith('!dozvoli')) {
                const isPermit = porukaNormalized.startsWith('!permit');
                const target = isPermit ? porukaSredjena.slice(7).trim() : porukaSredjena.slice(8).trim();
                commands.handlePermit(chatroomId, username, target, chatData.sender);
                return;
            }

            if (porukaNormalized === '!komande' || porukaNormalized === '!help' || porukaNormalized === '!pomoc' || porukaNormalized === '!commands') {
                if (utils.proveraKulauna(chatroomId, '!komande', username)) return;
                commands.handleHelp(chatroomId, username);
                return;
            }

            if (porukaNormalized.startsWith('!pesma ') || porukaNormalized.startsWith('!sr ') || porukaNormalized.startsWith('!song ')) {
                if (channelState.feature_songrequest === false) return;
                let songQuery = '';
                if (porukaNormalized.startsWith('!pesma ')) songQuery = porukaSredjena.slice(7).trim();
                else if (porukaNormalized.startsWith('!sr ')) songQuery = porukaSredjena.slice(4).trim();
                else songQuery = porukaSredjena.slice(6).trim();
                if (utils.proveraKulauna(chatroomId, '!pesma', username)) return;
                commands.handlePesma(chatroomId, username, songQuery, chatData.sender);
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

            if (porukaNormalized.startsWith('!posaljiljubav')) {
                if (channelState.feature_love === false) return;
                const targetRaw = porukaSredjena.slice(14).trim();
                const targetClean = targetRaw.split(/\s+/)[0].replace(/^@/, '').trim();
                if (!targetClean) {
                    messenger.posaljiPoruku(chatroomId, `@${username}, upotreba: !posaljiljubav @user`);
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

            if (porukaNormalized.startsWith('!bacihejt')) {
                if (channelState.feature_love === false) return;
                const targetRaw = porukaSredjena.slice(9).trim();
                const targetClean = targetRaw.split(/\s+/)[0].replace(/^@/, '').trim();
                if (!targetClean) {
                    messenger.posaljiPoruku(chatroomId, `@${username}, upotreba: !bacihejt @user`);
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

            if (porukaNormalized === '!cooldown' || porukaNormalized === '!coldown') {
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

            if (porukaNormalized === '!prihvati' || porukaNormalized === '!da' || porukaNormalized === '!pristajem') {
                if (utils.proveraKulauna(chatroomId, '!prihvati', username)) return;
                commands.handlePrihvatiBrak(chatroomId, username);
                return;
            }

            if (porukaNormalized === '!odbij' || porukaNormalized === '!ne' || porukaNormalized === '!odbijam') {
                if (utils.proveraKulauna(chatroomId, '!odbij', username)) return;
                commands.handleOdbijBrak(chatroomId, username);
                return;
            }

            if (porukaNormalized.startsWith('!vencaj')) {
                if (channelState.feature_love === false) return;
                const targetRaw = porukaSredjena.slice(7).trim();
                if (utils.proveraKulauna(chatroomId, '!vencaj', username)) return;
                commands.handleVencaj(chatroomId, username, targetRaw);
                return;
            }

            if (porukaNormalized.startsWith('!razvod')) {
                if (channelState.feature_love === false) return;
                const target = porukaSredjena.slice(7).trim();
                if (utils.proveraKulauna(chatroomId, '!razvod', username)) return;
                commands.handleRazvod(chatroomId, username, target);
                return;
            }

            if (porukaNormalized === '!brakovi' || porukaNormalized === '!brak' || porukaNormalized === '!vencani') {
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
                    limitStr = porukaSredjena.slice(4).trim();
                } else {
                    limitStr = porukaSredjena.slice(12).trim();
                }
                if (utils.proveraKulauna(chatroomId, '!top', username)) return;
                commands.handleTop(chatroomId, limitStr);
                return;
            }

            if (porukaNormalized.startsWith('!me') || porukaNormalized.startsWith('!stats') || porukaNormalized.startsWith('!aktivnost')) {
                if (channelState.feature_leaderboard === false) return;
                let target = '';
                if (porukaNormalized.startsWith('!me')) target = porukaSredjena.slice(3).trim();
                else if (porukaNormalized.startsWith('!stats')) target = porukaSredjena.slice(6).trim();
                else target = porukaSredjena.slice(10).trim();
                if (utils.proveraKulauna(chatroomId, '!me', username)) return;
                commands.handleMe(chatroomId, username, target);
                return;
            }

            // Admin komande
            const isAuthorized = username.toLowerCase() === channelState.channelUsername.toLowerCase() ||
                username.toLowerCase() === 'milan_567' ||
                (chatData.sender.identity &&
                    chatData.sender.identity.badges &&
                    chatData.sender.identity.badges.some(b => b.type === 'broadcaster'));

            const canPin = isAuthorized ||
                (chatData.sender.identity &&
                    chatData.sender.identity.badges &&
                    chatData.sender.identity.badges.some(b => b.type === 'moderator'));

            if (porukaNormalized === '!resetleaderboard') {
                commands.handleResetLeaderboard(chatroomId, username, isAuthorized);
                return;
            }

            if (porukaNormalized === '!osvezi') {
                commands.handleOsvezi(chatroomId, username, isAuthorized);
                return;
            }

            if (porukaNormalized === '!pin' || porukaNormalized.startsWith('!pin ')) {
                const isCustom = porukaNormalized.startsWith('!pin ');
                const allowed = isCustom ? isAuthorized : canPin;
                if (allowed) {
                    let tekst = '';
                    if (isCustom) {
                        tekst = porukaSredjena.slice(5).trim();
                    } else {
                        tekst = channelState.STREAM_START_PIN_MESSAGE;
                    }

                    if (tekst) {
                        messenger.posaljiIPinujPoruku(chatroomId, tekst);
                    }
                }
                return;
            }

            if (porukaNormalized === '!unpin') {
                if (isAuthorized) {
                    messenger.odpinujPoruku(chatroomId);
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
                await commands.handleAddCommand(chatroomId, username, textRaw, chatData.sender);
                return;
            }

            if (porukaNormalized.startsWith('!delcom ') || porukaNormalized.startsWith('!obrisikomandu ')) {
                const cmdRaw = porukaNormalized.startsWith('!delcom ') ? porukaSredjena.slice(8).trim() : porukaSredjena.slice(15).trim();
                await commands.handleDelCommand(chatroomId, username, cmdRaw, chatData.sender);
                return;
            }

            // Custom komande iz baze podataka
            if (await obradiCustomKomandu(chatroomId, username, porukaNormalized, channelState, chatData.sender)) {
                return;
            }


            // Pošto su statičke komande uklonjene, komande koje se ne prepoznaju biće potpuno ignorisane.
        }
    });

    state.ws.on('close', (kod, razlog) => {
        state.isConnected = false;
        stopHeartbeat();
        const opis = razlog ? ` (${razlog})` : '';
        utils.log('WARN', `Veza prekinuta (kod: ${kod})${opis}`);
        scheduleReconnect();
    });

    state.ws.on('error', (greska) => {
        utils.log('ERR', `WebSocket greška: ${greska.message}`);
    });
}

function stopHeartbeat() {
    if (state.heartbeatTimer) {
        clearInterval(state.heartbeatTimer);
        state.heartbeatTimer = null;
    }
}

function startHeartbeat() {
    stopHeartbeat();
    state.heartbeatTimer = setInterval(() => {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
        }
    }, config.HEARTBEAT_MS || 25000);
}

function scheduleReconnect() {
    const baseCekanje = Math.min((config.RECONNECT_BASE_MS || 3000) * Math.pow(2, state.reconnectAttempt), config.RECONNECT_MAX_MS || 60000);
    const jitter = Math.floor(Math.random() * 1000);
    const cekanje = baseCekanje + jitter;
    state.reconnectAttempt++;
    utils.log('INFO', `Pokušavam ponovo za ${(cekanje / 1000).toFixed(1)}s...`);
    setTimeout(povezi, cekanje);
}

// Provera statusa strima
async function proveriDaLiJeLive(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const channelUsername = channelState.channelUsername;

    try {
        const res = await utils.fetchKickAPI(`https://kick.com/api/v2/channels/${channelUsername}`);
        if (res.ok) {
            const data = await res.json();
            const liveState = !!data.livestream;

            // Moderator check - uklonjeno da bi bot radio i bez moderator statusa
            const _isModOrOwner = (data.role === 'moderator' || data.role === 'creator' || data.role === 'broadcaster' || channelUsername.toLowerCase() === botUsernameResolved.toLowerCase());
            channelState.isModerator = true; // Uvek dozvoli bota da radi

            if (database.KORISTI_SUPABASE && database.supabase) {
                try {
                    await database.supabase
                        .from('channels')
                        .upsert({
                            id: chatroomId,
                            username: channelUsername,
                            is_active: liveState,
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'id' });
                } catch (dbErr) {
                    utils.log('ERR', `[${channelUsername}] Greška pri upisu statusa strima u bazu: ${dbErr.message}`);
                }
            }

            if (liveState !== channelState.isStreamLive) {
                channelState.isStreamLive = liveState;
                utils.log('INFO', `[${channelUsername}] Status strima promenjen: ${channelState.isStreamLive ? '🔴 LIVE' : '⚪ OFFLINE'}`);
                if (channelState.isStreamLive && !channelState.isFirstLiveCheck) {
                    utils.log('INFO', `[${channelUsername}] Strim je počeo! Slanje pozdravne poruke i pinovanje...`);
                    if (channelState.STREAM_START_PIN_MESSAGE) {
                        messenger.posaljiIPinujPoruku(chatroomId, channelState.STREAM_START_PIN_MESSAGE);
                    }
                } else if (!channelState.isStreamLive) {
                    watchtime.ocistiAktivneGledaoce(chatroomId);
                    channelState.welcomedUsers.clear(); // Očisti pozdravljene korisnike za sledeći stream
                }
            }
            channelState.isFirstLiveCheck = false;
        }
    } catch (err) {
        utils.log('ERR', `[${channelUsername}] Greška pri proveri statusa strima: ${err.message}`);
    }
}

async function proveriDaLiSuLiveSvi() {
    for (const chatroomId of Object.keys(state.channels)) {
        await proveriDaLiJeLive(chatroomId);
    }
}

// ─── AUTO ANNOUNCE ───────────────────────────────────────────────────────────
function triggerAutoAnnounce(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || channelState.isModerator === false) return;

    const poruke = channelState.autoAnnounces || [];
    if (poruke.length === 0) return;

    let idx;
    do {
        idx = Math.floor(Math.random() * poruke.length);
    } while (idx === channelState.zadnjiAutoPorukaIdx && poruke.length > 1);

    channelState.zadnjiAutoPorukaIdx = idx;
    channelState.porukePosleAnnounce = 0;
    channelState.zadnjaAutoPorukaTs = Date.now();

    messenger.posaljiPoruku(chatroomId, poruke[idx]);
}

function pokreniAutoAnnounceTajmer(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    if (channelState.autoAnnounceTimer) {
        clearInterval(channelState.autoAnnounceTimer);
        channelState.autoAnnounceTimer = null;
    }

    if (channelState.botActive && channelState.announce_time_enabled && channelState.announce_interval_mins > 0) {
        channelState.autoAnnounceTimer = setInterval(() => {
            if (channelState.isStreamLive) {
                triggerAutoAnnounce(chatroomId);
            }
        }, channelState.announce_interval_mins * 60 * 1000);
    }
}

// ─── UPRAVLJANJE KANALIMA ──────────────────────────────────────────────────────
async function pokreniKanal(chatroomId, channelUsername, dbConfig) {
    utils.log('INFO', `Pokrećem rad na kanalu: @${channelUsername} (ID: ${chatroomId})...`);

    // Inicijalizacija stanja kanala
    const channelState = state.getChannelState(chatroomId);
    channelState.channelUsername = channelUsername;

    // Dohvatamo pravi chatroom ID sa Kick API-ja za pretplatu na WS i slanje poruka
    let realChatroomId = chatroomId;
    try {
        const res = await utils.fetchKickAPI(`https://kick.com/api/v2/channels/${channelUsername}`);
        if (res.ok) {
            const data = await res.json();
            if (data?.chatroom?.id) {
                realChatroomId = String(data.chatroom.id);
                utils.log('INFO', `[${channelUsername}] Nađen pravi chatroom ID: ${realChatroomId} (baza: ${chatroomId})`);
            }
        }
    } catch (e) {
        utils.log('ERR', `[${channelUsername}] Greška pri pronalaženju pravog chatroom ID-ja: ${e.message}`);
    }
    channelState.realChatroomId = realChatroomId;

    // Primenjujemo konfiguraciju iz baze uz prolinkovani plan
    await azurirajKonfiguracijuKanala(channelState, dbConfig);

    // Učitavamo in-memory podatke za ovaj kanal
    await database.ucitajLeaderboard(chatroomId);
    await database.ucitajEkonomiju(chatroomId);
    await database.ucitajLjubav(chatroomId);
    await database.ucitajCustomKomande(chatroomId);
    await watchtime.ucitajWatchtime(chatroomId);

    // Ako je WebSocket već otvoren, odmah se pretplatimo na ovaj čet
    if (state.isConnected && state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
            event: 'pusher:subscribe',
            data: { channel: `chatrooms.${channelState.realChatroomId || chatroomId}.v2` }
        }));
    }

    // Pokrećemo auto-announce vremenski tajmer za ovaj kanal
    pokreniAutoAnnounceTajmer(chatroomId);

    // Prva provera da li je live
    await proveriDaLiJeLive(chatroomId);
}

async function zaustaviKanal(chatroomId) {
    const channelState = state.channels[chatroomId];
    if (!channelState) return;

    utils.log('INFO', `Zaustavljam rad na kanalu: @${channelState.channelUsername} (ID: ${chatroomId})...`);

    // Čuvamo podatke koji su izmenjeni
    if (channelState.leaderboardDirty) {
        await database.sacuvajLeaderboard(chatroomId);
    }
    if (channelState.loveDirty) {
        await database.sacuvajLjubav(chatroomId);
    }
    if (channelState.watchtimeDirty) {
        await watchtime.sacuvajWatchtime(chatroomId);
    }
    if (channelState.economyDirty) {
        await database.sacuvajEkonomiju(chatroomId);
    }

    // Otkazivanje pretplate sa četa
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        const subId = channelState.realChatroomId || chatroomId;
        state.ws.send(JSON.stringify({
            event: 'pusher:unsubscribe',
            data: { channel: `chatrooms.${subId}.v2` }
        }));
    }

    // Čišćenje tajmera
    if (channelState.autoAnnounceTimer) {
        clearInterval(channelState.autoAnnounceTimer);
    }
    if (channelState.economySaveTimer) {
        clearTimeout(channelState.economySaveTimer);
        channelState.economySaveTimer = null;
    }

    delete state.channels[chatroomId];
}

async function azurirajKonfiguracijuKanala(channelState, dbConfig) {
    if (dbConfig.user_id) {
        await database.ucitajUserPlan(dbConfig.user_id, dbConfig.channel_id);
    }
    const limits = channelState.planLimits || config.PLAN_LIMITS.free;

    channelState.PREFIX = dbConfig.prefix || '!';
    channelState.COOLDOWN_MS = Math.max(dbConfig.cooldown_ms ?? 3000, limits.minCooldownMs || 3000);
    channelState.SPAM_THRESHOLD = dbConfig.spam_threshold ?? 3;
    channelState.SPAM_WINDOW_MS = dbConfig.spam_window_ms ?? 15000;

    channelState.STREAM_START_PIN_MESSAGE = dbConfig.stream_pin_msg || '';
    channelState.welcome_message = dbConfig.welcome_message || '';

    channelState.feature_leaderboard = limits.allowLeaderboard && (dbConfig.feature_leaderboard ?? true);
    channelState.feature_watchtime = limits.allowWatchtime && (dbConfig.feature_watchtime ?? true);
    channelState.feature_games = limits.allowGambling && (dbConfig.feature_games ?? true);
    channelState.feature_love = limits.allowLove && (dbConfig.feature_love ?? true);
    channelState.feature_moderation = limits.allowAdvancedModeration && (dbConfig.feature_moderation ?? false);
    channelState.feature_autoresponse = dbConfig.feature_autoresponse ?? true;
    channelState.feature_songrequest = limits.allowSongRequest && (dbConfig.feature_songrequest ?? false);
    channelState.songrequest_settings = dbConfig.songrequest_settings || {};
    channelState.botActive = dbConfig.bot_active || false;

    const rawAnnounces = Array.isArray(dbConfig.auto_announces) ? dbConfig.auto_announces : [];
    channelState.autoAnnounces = rawAnnounces.slice(0, limits.maxAutoAnnounces || 2);

    channelState.announce_interval_mins = dbConfig.announce_interval_mins ?? 15;
    channelState.announce_message_threshold = dbConfig.announce_message_threshold ?? 30;
    channelState.announce_time_enabled = dbConfig.announce_time_enabled ?? true;
    channelState.announce_msg_enabled = dbConfig.announce_msg_enabled ?? true;
    channelState.moderationSettings = dbConfig.moderation_settings || {};
    channelState.currency_name = dbConfig.currency_name || 'Koins';
    channelState.max_gamble_amount = dbConfig.max_gamble_amount || 5000;
    channelState.gamble_enabled = dbConfig.gamble_enabled ?? true;
    channelState.first_interaction_bonus = dbConfig.first_interaction_bonus ?? 100;
    channelState.sub_multiplier = dbConfig.sub_multiplier ?? 2.0;
    channelState.sub_bonus_per_msg = dbConfig.sub_bonus_per_msg ?? 10;
    channelState.points_per_sub = dbConfig.points_per_sub ?? 1000;
    channelState.points_per_gift_sub = dbConfig.points_per_gift_sub ?? 2000;
    channelState.points_per_100_kicks = dbConfig.points_per_100_kicks ?? 500;
    channelState.daily_streak_bonus = dbConfig.daily_streak_bonus ?? 150;
    channelState.host_raid_bonus = dbConfig.host_raid_bonus ?? 300;

    const maxStoreItems = channelState.userPlan === 'free' ? 10 : (channelState.userPlan === 'pro' ? 50 : 999999);
    const rawStore = Array.isArray(dbConfig.store_items) ? dbConfig.store_items : [];
    channelState.store_items = rawStore.slice(0, maxStoreItems);
}


// ─── SHUTDOWN HANDLER ─────────────────────────────────────────────────────────
let isShuttingDown = false;
async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    utils.log('INFO', `Bot se gasi... (${signal})`);

    // Čuvanje podataka za sve pokrenute kanale
    for (const chatroomId of Object.keys(state.channels)) {
        await zaustaviKanal(chatroomId);
    }

    watchtime.zaustavljWatchtimeTick();
    stopHeartbeat();
    if (state.ws) state.ws.close();
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ─── GLOBAL CRASH PROTECTION ──────────────────────────────────────────────────
process.on('uncaughtException', async (err) => {
    utils.log('ERR', `Neuhvaćena greška (uncaughtException): ${err.stack || err.message}`);
    utils.log('WARN', 'Pokrećem gracefulShutdown radi bezbednog ponovnog pokretanja bota...');
    try {
        await gracefulShutdown('uncaughtException');
    } catch (shutdownErr) {
        console.error('Shutdown failed during uncaughtException:', shutdownErr);
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, _promise) => {
    const msg = reason instanceof Error ? reason.stack : String(reason);
    utils.log('ERR', `Neobrađeno obećanje (unhandledRejection): ${msg}`);
});

const ALLOWED_KICK_REDIRECT_URIS = new Set([
    'http://localhost:5500/auth/kick/callback',
    'http://localhost:5500/auth/kick/callback/',
    'http://127.0.0.1:5500/auth/kick/callback',
    'http://127.0.0.1:5500/auth/kick/callback/',
    'http://localhost:8888/auth/kick/callback',
    'http://localhost:8888/auth/kick/callback/',
    'http://127.0.0.1:8888/auth/kick/callback',
    'http://127.0.0.1:8888/auth/kick/callback/',
    'https://kickall.app/auth/kick/callback',
    'https://kickall.app/auth/kick/callback/',
    'http://localhost:5500/Website/auth/kick/callback',
    'http://localhost:5500/Website/auth/kick/callback/',
    'http://127.0.0.1:5500/Website/auth/kick/callback',
    'http://127.0.0.1:5500/Website/auth/kick/callback/',
    'http://localhost:8888/Website/auth/kick/callback',
    'http://localhost:8888/Website/auth/kick/callback/',
    'http://127.0.0.1:8888/Website/auth/kick/callback',
    'http://127.0.0.1:8888/Website/auth/kick/callback/'
]);

function normalizeKickRedirectUri(uri) {
    if (!uri || typeof uri !== 'string') return null;

    try {
        const parsed = new URL(uri);
        // Preserve trailing slash for OAuth exact matching
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return null;
    }
}

function resolveKickRedirectUri(candidate) {
    // If candidate is provided and in allowed list, use it
    if (candidate) {
        const normalizedCandidate = normalizeKickRedirectUri(candidate);
        if (ALLOWED_KICK_REDIRECT_URIS.has(candidate) || ALLOWED_KICK_REDIRECT_URIS.has(normalizedCandidate)) {
            return candidate;
        }
    }

    // Fallback to env var or production
    const envUri = process.env.KICK_REDIRECT_URI;
    if (envUri) {
        const normalizedEnvUri = normalizeKickRedirectUri(envUri);
        if (ALLOWED_KICK_REDIRECT_URIS.has(envUri) || ALLOWED_KICK_REDIRECT_URIS.has(normalizedEnvUri)) {
            return envUri;
        }
    }

    return 'https://kickall.app/auth/kick/callback/';
}

function verifyInternalToken(req) {
    const secret = process.env.INTERNAL_API_SECRET || process.env.INTERNAL_SECRET;
    if (!secret) {
        utils.log('ERR', 'KRITIČNO: INTERNAL_API_SECRET nije podešen u okruženju! Zahtev je odbijen.');
        return false;
    }
    const tokenHeader = req.headers['x-internal-token'];
    const authHeader = req.headers['authorization'];
    if (tokenHeader && tokenHeader === secret) return true;
    if (authHeader && (authHeader === `Bearer ${secret}` || authHeader === secret)) return true;
    return false;
}

async function handleHttpRequest(req, res) {
    const origin = req.headers['origin'];
    const allowedOrigins = [
        process.env.ALLOWED_ORIGIN,
        'https://kickall.app',
        'https://www.kickall.app',
        'http://localhost:8888',
        'http://127.0.0.1:8888',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
    ].filter(Boolean);

    if (origin && (allowedOrigins.includes(origin) || origin.endsWith('.netlify.app'))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', 'https://kickall.app');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Internal-Token');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    try {
        const parsedUrl = new URL(req.url, 'http://localhost');

        // ─── Kick OAuth2 Callback ─────────────────────────────────────────────
        if (parsedUrl.pathname === '/auth/kick/callback') {
            const code = parsedUrl.searchParams.get('code');
            const redirectUri = resolveKickRedirectUri(parsedUrl.searchParams.get('redirect_uri'));
            if (!code) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Greška: nedostaje OAuth code parametar.');
                return;
            }

            try {
                const tokenRes = await fetch('https://id.kick.com/oauth/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        grant_type: 'authorization_code',
                        client_id: process.env.KICK_CLIENT_ID,
                        client_secret: process.env.KICK_CLIENT_SECRET,
                        redirect_uri: redirectUri,
                        code: code,
                        code_verifier: parsedUrl.searchParams.get('code_verifier') || '' // Ako se zove direktno
                    }).toString()
                });

                if (!tokenRes.ok) {
                    const errText = await tokenRes.text();
                    utils.log('ERR', `Kick OAuth token greška: ${errText}`);
                    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('Greška pri razmeni koda za token.');
                    return;
                }

                const tokenData = await tokenRes.json();
                const accessToken = tokenData.access_token;
                const tokenType = tokenData.token_type || 'Bearer';
                const expiresIn = tokenData.expires_in || 3600;

                utils.log('INFO', 'Kick OAuth2: Uspešno dobijen access_token.');

                // Bezbedno preusmeri korisnika na dashboard stranicu
                const dashboardUrl = `/Website/kickot/dashboard.html#kick_token=${encodeURIComponent(accessToken)}&token_type=${encodeURIComponent(tokenType)}&expires_in=${expiresIn}`;
                res.writeHead(302, { 'Location': dashboardUrl });
                res.end();
            } catch (tokenErr) {
                utils.log('ERR', `Kick OAuth grešk pri token razmeni: ${tokenErr.message}`);
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Interna greška pri OAuth autorizaciji.');
            }
            return;
        }

        // ─── Kick OAuth2 Token Exchange API (za Live Server / 5500) ──────────
        if (parsedUrl.pathname === '/api/kick/exchange' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const params = new URLSearchParams(body);
                    const code = params.get('code');
                    const codeVerifier = params.get('code_verifier') || '';
                    const requestedRedirectUri = params.get('redirect_uri');
                    const normalizedRequestedRedirectUri = normalizeKickRedirectUri(requestedRedirectUri);
                    const redirectUri = resolveKickRedirectUri(requestedRedirectUri);
                    if (!code) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing code' }));
                        return;
                    }

                    if (requestedRedirectUri && !normalizedRequestedRedirectUri) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid redirect_uri format' }));
                        return;
                    }

                    if (normalizedRequestedRedirectUri && !ALLOWED_KICK_REDIRECT_URIS.has(normalizedRequestedRedirectUri)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'redirect_uri is not allowed' }));
                        return;
                    }

                    const tokenRes = await fetch('https://id.kick.com/oauth/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            grant_type: 'authorization_code',
                            client_id: process.env.KICK_CLIENT_ID,
                            client_secret: process.env.KICK_CLIENT_SECRET,
                            redirect_uri: redirectUri,
                            code: code,
                            code_verifier: codeVerifier
                        }).toString()
                    });

                    if (!tokenRes.ok) {
                        const errText = await tokenRes.text();
                        console.log('Kick token error response:', errText);
                        res.writeHead(502, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Token exchange failed', detail: errText }));
                        return;
                    }

                    const tokenData = await tokenRes.json();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        access_token: tokenData.access_token,
                        token_type: tokenData.token_type || 'Bearer',
                        expires_in: tokenData.expires_in || 3600,
                        scope: tokenData.scope || ''
                    }));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Internal error', detail: err.message }));
                }
            });
            return;
        }

        if (parsedUrl.pathname === '/api/kick/me' && req.method === 'GET') {
            const authHeader = req.headers['authorization'];
            if (!authHeader) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing authorization header' }));
                return;
            }

            try {
                let username = '';
                let userId = '';
                let avatar = '';

                let kickUserRes = await fetch('https://api.kick.com/public/v1/users', {
                    headers: { 'Authorization': authHeader }
                });

                if (kickUserRes.ok) {
                    const kickData = await kickUserRes.json();
                    const kickUser = Array.isArray(kickData?.data) ? kickData.data[0] : kickData?.data || kickData;
                    username = kickUser?.username || kickUser?.name || '';
                    userId = kickUser?.user_id || kickUser?.id || '';
                    avatar = kickUser?.profile_picture || kickUser?.profile_pic || '';
                } else {
                    let altRes = await fetch('https://id.kick.com/oauth/userinfo', {
                        headers: { 'Authorization': authHeader }
                    });
                    if (altRes.ok) {
                        const altData = await altRes.json();
                        username = altData?.preferred_username || altData?.name || altData?.sub || '';
                        userId = altData?.sub || '';
                        avatar = altData?.picture || '';
                    }
                }

                if (!username) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Could not retrieve user info from Kick OAuth' }));
                    return;
                }

                const channelRes = await utils.fetchKickAPI(`https://kick.com/api/v2/channels/${username}`);
                let chatroomId = userId;
                let slug = username;
                if (channelRes.ok) {
                    const channelData = await channelRes.json();
                    chatroomId = channelData?.chatroom?.id || chatroomId;
                    slug = channelData?.slug || slug;
                    avatar = channelData?.user?.profile_pic || avatar;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    id: userId,
                    username: username,
                    slug: slug,
                    avatar: avatar,
                    profile_pic: avatar,
                    chatroom_id: chatroomId
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal error', detail: err.message }));
            }
            return;
        }

        if (parsedUrl.pathname === '/api/avatar') {
            const username = parsedUrl.searchParams.get('username');
            if (!username) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing username parameter' }));
                return;
            }

            try {
                const channelRes = await utils.fetchKickAPI(`https://kick.com/api/v2/channels/${username}`);
                let avatar = '';
                let chatroomId = '';
                let slug = username;

                if (channelRes.ok) {
                    const channelData = await channelRes.json();
                    avatar = channelData?.user?.profile_pic || '';
                    chatroomId = channelData?.chatroom?.id || '';
                    slug = channelData?.slug || username;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    username: username,
                    slug: slug,
                    avatar: avatar,
                    chatroom_id: chatroomId
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal error', detail: err.message }));
            }
            return;
        }

        // Global logout endpoint (zahteva autentikaciju)
        if (parsedUrl.pathname === '/api/global-logout' && req.method === 'POST') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized', detail: 'Missing or invalid authentication token' }));
                return;
            }
            try {
                const body = await new Promise((resolve) => {
                    let data = '';
                    req.on('data', chunk => data += chunk);
                    req.on('end', () => resolve(data));
                });
                const { userId } = JSON.parse(body || '{}');

                if (!global.logoutCache) {
                    global.logoutCache = new Map();
                }
                if (userId) {
                    global.logoutCache.set(userId, Date.now());
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal error', detail: err.message }));
            }
            return;
        }

        // Check logout status endpoint
        if (parsedUrl.pathname === '/api/check-logout' && req.method === 'GET') {
            try {
                const userId = parsedUrl.searchParams.get('userId');
                let shouldLogout = false;

                if (global.logoutCache && userId) {
                    const logoutTime = global.logoutCache.get(userId);
                    if (logoutTime && Date.now() - logoutTime < 300000) { // 5 minutes
                        shouldLogout = true;
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ shouldLogout }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal error', detail: err.message }));
            }
            return;
        }

        if (parsedUrl.pathname === '/api/kick/channel') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized access to channel endpoint' }));
                return;
            }
            const username = parsedUrl.searchParams.get('username');
            if (!username) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing username parameter' }));
                return;
            }

            try {
                const apiRes = await utils.fetchKickAPI(`https://kick.com/api/v2/channels/${username}`);
                if (apiRes.ok) {
                    const data = await apiRes.json();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(data));
                } else {
                    res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: `Kick API returned status ${apiRes.status}` }));
                }
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        if (parsedUrl.pathname === '/api/kick/logs' && req.method === 'GET') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized access to bot logs' }));
                return;
            }
            const chatroomId = parsedUrl.searchParams.get('chatroom_id') || parsedUrl.searchParams.get('channel_id');
            const channelState = chatroomId ? state.getChannelState(chatroomId) : null;
            const channelUsername = channelState ? channelState.channelUsername : null;

            let filteredLogs = state.globalLogs || [];
            if (channelUsername) {
                const lowerUsername = channelUsername.toLowerCase();
                filteredLogs = filteredLogs.filter(l => 
                    (l.message && l.message.toLowerCase().includes(`[${lowerUsername}]`)) ||
                    (l.message && l.message.toLowerCase().includes(`@${lowerUsername}`))
                );
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(filteredLogs));
            return;
        }

        if (parsedUrl.pathname === '/api/kick/test-ping' && req.method === 'POST') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized access to test-ping' }));
                return;
            }
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const params = new URLSearchParams(body);
                    const chatroomId = params.get('chatroom_id');
                    if (!chatroomId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing chatroom_id parameter' }));
                        return;
                    }

                    // Izvrši slanje sinhrono da vidimo da li uspeva
                    await messenger.izvrsiSlanje(chatroomId, '🤖 Veza je uspešno testirana! 🟢');

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Test message sent' }));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Failed to send message', detail: err.message }));
                }
            });
            return;
        }

        if (parsedUrl.pathname === '/api/kick/reload') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized access to reload endpoint' }));
                return;
            }
            const chatroomId = parsedUrl.searchParams.get('chatroom_id') || parsedUrl.searchParams.get('channel_id');
            if (!chatroomId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing chatroom_id parameter' }));
                return;
            }

            try {
                await database.ucitajCustomKomande(chatroomId);
                await database.ucitajBotConfig(chatroomId);
                
                utils.log('INFO', `[${chatroomId}] Bot konfiguracija i komande uspešno reloadovani preko API poziva.`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Reloaded successfully' }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to reload', detail: err.message }));
            }
            return;
        }

        if (parsedUrl.pathname === '/api/kick/check-moderator') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized access to check-moderator endpoint' }));
                return;
            }
            const chatroomId = parsedUrl.searchParams.get('chatroom_id') || parsedUrl.searchParams.get('channel_id');
            if (!chatroomId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing chatroom_id parameter' }));
                return;
            }

            try {
                await proveriDaLiJeLive(chatroomId);
                const channelState = state.getChannelState(chatroomId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    isModerator: channelState?.isModerator,
                    botActive: channelState?.botActive 
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to check moderator status', detail: err.message }));
            }
            return;
        }

        if (parsedUrl.pathname === '/api/channels' && req.method === 'GET') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized access to channels summary' }));
                return;
            }
            try {
                const channelsSummary = Object.keys(state.channels).map(id => {
                    const c = state.channels[id];
                    return {
                        id: id,
                        username: c.channelUsername,
                        realChatroomId: c.realChatroomId || id,
                        botActive: c.botActive,
                        isStreamLive: c.isStreamLive,
                        userPlan: c.userPlan || 'free',
                        subscriptionStatus: c.subscriptionStatus || 'active',
                        customCommandsCount: Object.keys(c.customCommands || {}).length,
                        autoAnnouncesCount: (c.autoAnnounces || []).length,
                        prefix: c.PREFIX
                    };
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    totalActiveChannels: channelsSummary.length,
                    isConnectedToKick: state.isConnected,
                    channels: channelsSummary
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to fetch channels summary', detail: err.message }));
            }
            return;
        }

        if (parsedUrl.pathname === '/api/global-logout' && req.method === 'POST') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized', detail: 'Missing or invalid authentication token' }));
                return;
            }
            state.loggedOutUsers = state.loggedOutUsers || new Set();
            let bodyStr = '';
            req.on('data', chunk => { bodyStr += chunk; });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(bodyStr || '{}');
                    if (payload.userId) {
                        state.loggedOutUsers.add(String(payload.userId));
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (_e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
                }
            });
            return;
        }

        if (parsedUrl.pathname === '/api/check-logout' && req.method === 'GET') {
            const userId = parsedUrl.searchParams.get('userId');
            state.loggedOutUsers = state.loggedOutUsers || new Set();
            const shouldLogout = userId ? state.loggedOutUsers.has(String(userId)) : false;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ shouldLogout, userId }));
            return;
        }
    } catch (err) {
        console.error('Error handling HTTP request in bot.js:', err);
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`🤖 Multi-channel Kick Bot je aktivan!\nKanali na kojima radi: ${Object.values(state.channels).map(c => '@' + c.channelUsername).join(', ') || 'nijedan'}\n`);
}

const PORT = process.env.PORT || 3000;
const server = http.createServer(handleHttpRequest);

function pokreniServer() {
    server.listen(PORT, () => {
        utils.log('INFO', `Lokalni HTTP server pokrenut na portu: ${PORT}`);
    });
}

// ─── MEMORY CLEANUP ───────────────────────────────────────────────────────────
setInterval(() => {
    const sada = Date.now();
    for (const chatroomId of Object.keys(state.channels)) {
        const channelState = state.channels[chatroomId];
        for (const key in channelState.spamTracker) {
            channelState.spamTracker[key] = channelState.spamTracker[key].filter(t => sada - t < (channelState.SPAM_WINDOW_MS || 15000));
            if (channelState.spamTracker[key].length === 0) {
                delete channelState.spamTracker[key];
            }
        }
        for (const key in channelState.rapidTracker) {
            channelState.rapidTracker[key] = channelState.rapidTracker[key].filter(t => sada - t < 8000);
            if (channelState.rapidTracker[key].length === 0) {
                delete channelState.rapidTracker[key];
            }
        }
    }
}, 10 * 60 * 1000).unref(); // Svakih 10 minuta

// ─── START ────────────────────────────────────────────────────────────────────
async function start() {
    utils.log('INFO', '🤖 Multi-channel Kick bot se pokreće...');
    await detectBotUsername();

    if (database.KORISTI_SUPABASE && database.supabase) {
        // 1. Učitaj sve kanale koji imaju aktivnog bota
        const aktivniKanali = await database.ucitajSveAktivneKanale();
        utils.log('INFO', `Pronađeno ${aktivniKanali.length} aktivnih kanala u bazi.`);

        // 2. Pokreni i učitaj svaki od njih paralelno
        for (const dbConfig of aktivniKanali) {
            const chatroomId = String(dbConfig.channel_id);
            const channelUsername = dbConfig.channel_name || 'Nepoznat';
            try {
                await pokreniKanal(chatroomId, channelUsername, dbConfig);
            } catch (err) {
                utils.log('ERR', `Greška pri pokretanju kanala @${channelUsername}: ${err.message}`);
            }
        }

        // 3. Pokreni globalne watchtime tick cikluse
        watchtime.pokreniWatchtimeTick();

        // 4. Poveži WebSocket na Kick Pusher
        povezi();

        // 5. Pokreni periodicnu proaktivnu proveru live statusa
        setInterval(proveriDaLiSuLiveSvi, 2 * 60 * 1000);

        // 6. Osluškuj izmene konfiguracije u realnom vremenu
        const lastUpdateLogs = new Map();
        function logDebouncedUpdate(key, msg) {
            const now = Date.now();
            const last = lastUpdateLogs.get(key) || 0;
            if (now - last > 15000) {
                lastUpdateLogs.set(key, now);
                utils.log('INFO', msg);
            }
        }

        database.supabase.channel('public:bot_config')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'bot_config'
            }, async (payload) => {
                const { eventType, new: newRow, old: oldRow } = payload;

                if (eventType === 'DELETE') {
                    const chatroomId = String(oldRow.channel_id);
                    if (state.channels[chatroomId]) {
                        utils.log('INFO', `🔴 Kanal @${oldRow.channel_name} je uklonjen iz bot konfiguracije.`);
                        await zaustaviKanal(chatroomId);
                    }
                } else {
                    const chatroomId = String(newRow.channel_id);
                    const channelUsername = newRow.channel_name || 'Nepoznat';
                    const botActive = newRow.bot_active || false;

                    if (botActive) {
                        if (!state.channels[chatroomId]) {
                            utils.log('INFO', `🟢 Bot je uspešno aktiviran za kanal @${channelUsername}!`);
                            await pokreniKanal(chatroomId, channelUsername, newRow);
                        } else {
                            const cs = state.getChannelState(chatroomId);
                            logDebouncedUpdate(`config::${chatroomId}`, `⚙️ [PRO Plan] Podešavanja i komande sinhronizovane za @${channelUsername}.`);
                            await azurirajKonfiguracijuKanala(cs, newRow);
                            pokreniAutoAnnounceTajmer(chatroomId);
                        }
                    } else {
                        if (state.channels[chatroomId]) {
                            utils.log('INFO', `⚪ Bot je zaustavljen za kanal @${channelUsername}.`);
                            await zaustaviKanal(chatroomId);
                        }
                    }
                }
            })
            .subscribe();

        // 7. Osluškuj izmene na custom komandama u realnom vremenu
        database.supabase.channel('public:custom_commands')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'custom_commands'
            }, async (payload) => {
                const { new: newRow, old: oldRow } = payload;
                const row = newRow || oldRow;
                if (row) {
                    const chatroomId = String(row.channel_id);
                    if (state.channels[chatroomId]) {
                        logDebouncedUpdate(`custom_cmds::${chatroomId}`, `⚡ Custom komande osvežene za kanal.`);
                        await database.ucitajCustomKomande(chatroomId);
                    }
                }
            })
            .subscribe();

        // 8. Osluškuj izmene korisničkih profila (promene pretplate/plana)
        database.supabase.channel('public:user_profiles')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'user_profiles'
            }, async (payload) => {
                const { new: newRow, old: oldRow } = payload;
                const row = newRow || oldRow;
                if (row && row.id) {
                    const userId = row.id;
                    for (const chatroomId of Object.keys(state.channels)) {
                        const channelState = state.channels[chatroomId];
                        if (channelState && channelState.userId === userId) {
                            utils.log('INFO', `Detektovana promena paketa za korisnika ${userId} (@${channelState.channelUsername}). Osvežavam plan...`);
                            await database.ucitajUserPlan(userId, chatroomId);
                            await database.ucitajCustomKomande(chatroomId);
                        }
                    }
                }
            })
            .subscribe();


    }
}

if (require.main === module) {
    pokreniServer();
    start();
}

module.exports = {
    verifyInternalToken,
    handleHttpRequest
};