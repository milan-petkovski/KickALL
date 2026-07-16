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

async function obradiCustomKomandu(chatroomId, username, porukaNormalized, channelState) {
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
            state.ws.send(JSON.stringify({
                event: 'pusher:subscribe',
                data: { channel: `chatrooms.${chatroomId}.v2` }
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
            const chatroomId = match[1];

            const channelState = state.getChannelState(chatroomId);
            if (!channelState || !channelState.botActive) {
                return;
            }

            const poruka = chatData.content.trim();
            const username = chatData.sender.username;
            const isBotMsg = chatData.sender.is_bot || false;

            // Logujemo samo poruke drugih korisnika
            if (username.toLowerCase() !== config.BOT_USERNAME.toLowerCase()) {
                utils.log('CHAT', `[@${channelState.channelUsername || chatroomId}] ${username}: ${poruka}`);
            }

            // Preskačemo sopstvene poruke i poznate botove
            const userKey = username.toLowerCase();
            if (isBotMsg || userKey === config.BOT_USERNAME.toLowerCase() || userKey === 'botrix' || userKey === 'nightbot' || userKey === 'streamelements' || userKey === 'streamlabs') {
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

            // Normalizujemo poruku da uvek interno počinje sa '!' radi kompatibilnosti sa ugrađenim komandama
            let normalizovanaPoruka = porukaSredjena;
            if (startsWithPrefix && prefix !== '!') {
                normalizovanaPoruka = '!' + porukaSredjena.slice(prefix.length);
            }
            const porukaLower = normalizovanaPoruka.toLowerCase();
            const porukaNormalized = ukloniSrpskeDijakritike(porukaLower);

            // Komunikacija sa botom (@bot_username)
            if (channelState.feature_autoresponse !== false && !startsWithPrefix && porukaLower.includes('@' + config.BOT_USERNAME.toLowerCase())) {
                const ment = commands.handleBotMentions(chatroomId, username, porukaLower);
                if (ment) return;
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

            if (porukaNormalized.startsWith('!duel ')) {
                if (channelState.feature_games === false) return;
                const meta = porukaSredjena.slice(6).trim();
                if (utils.proveraKulauna(chatroomId, '!duel', username)) return;
                commands.handleDuel(chatroomId, username, meta);
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

            if (porukaNormalized.startsWith('!rulet')) {
                if (channelState.feature_games === false) return;
                if (utils.proveraKulauna(chatroomId, '!rulet', username)) return;
                commands.handleRulet(chatroomId, username);
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

            if (porukaNormalized === '!aktivnost' || porukaNormalized === '!stats' || porukaNormalized === '!points' || porukaNormalized === '!poeni') {
                if (channelState.feature_leaderboard === false) return;
                if (utils.proveraKulauna(chatroomId, '!aktivnost', username)) return;
                commands.handleAktivnost(chatroomId, username);
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

            // Custom komande iz baze podataka
            if (await obradiCustomKomandu(chatroomId, username, porukaNormalized, channelState)) {
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
    const cekanje = Math.min((config.RECONNECT_BASE_MS || 3000) * Math.pow(2, state.reconnectAttempt), config.RECONNECT_MAX_MS || 60000);
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

            if (database.KORISTI_SUPABASE && database.supabase) {
                try {
                    await database.supabase
                        .from('channels')
                        .upsert({
                            id: chatroomId,
                            username: channelUsername,
                            is_active: liveState,
                            created_at: new Date().toISOString()
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
    if (!channelState) return;

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

    // Primenjujemo konfiguraciju iz baze
    azurirajKonfiguracijuKanala(channelState, dbConfig);

    // Učitavamo in-memory podatke za ovaj kanal
    await database.ucitajLeaderboard(chatroomId);
    await database.ucitajLjubav(chatroomId);
    await database.ucitajCustomKomande(chatroomId);
    await watchtime.ucitajWatchtime(chatroomId);

    // Ako je WebSocket već otvoren, odmah se pretplatimo na ovaj čet
    if (state.isConnected && state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
            event: 'pusher:subscribe',
            data: { channel: `chatrooms.${chatroomId}.v2` }
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

    // Otkazivanje pretplate sa četa
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
            event: 'pusher:unsubscribe',
            data: { channel: `chatrooms.${chatroomId}.v2` }
        }));
    }

    // Čišćenje tajmera
    if (channelState.autoAnnounceTimer) {
        clearInterval(channelState.autoAnnounceTimer);
    }

    delete state.channels[chatroomId];
}

function azurirajKonfiguracijuKanala(channelState, dbConfig) {
    channelState.PREFIX = dbConfig.prefix || '!';
    channelState.COOLDOWN_MS = dbConfig.cooldown_ms ?? 3000;
    channelState.SPAM_THRESHOLD = dbConfig.spam_threshold ?? 3;
    channelState.SPAM_WINDOW_MS = dbConfig.spam_window_ms ?? 15000;

    channelState.STREAM_START_PIN_MESSAGE = dbConfig.stream_pin_msg || '';
    channelState.welcome_message = dbConfig.welcome_message || '';

    channelState.feature_leaderboard = dbConfig.feature_leaderboard ?? true;
    channelState.feature_watchtime = dbConfig.feature_watchtime ?? true;
    channelState.feature_games = dbConfig.feature_games ?? true;
    channelState.feature_love = dbConfig.feature_love ?? true;
    channelState.feature_moderation = dbConfig.feature_moderation ?? false;
    channelState.feature_autoresponse = dbConfig.feature_autoresponse ?? true;

    channelState.botActive = dbConfig.bot_active || false;
    channelState.autoAnnounces = Array.isArray(dbConfig.auto_announces) ? dbConfig.auto_announces : [];

    channelState.announce_interval_mins = dbConfig.announce_interval_mins ?? 15;
    channelState.announce_message_threshold = dbConfig.announce_message_threshold ?? 30;
    channelState.announce_time_enabled = dbConfig.announce_time_enabled ?? true;
    channelState.announce_msg_enabled = dbConfig.announce_msg_enabled ?? true;
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
process.on('uncaughtException', (err) => {
    utils.log('ERR', `Neuhvaćena greška (uncaughtException): ${err.stack || err.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
    const msg = reason instanceof Error ? reason.stack : String(reason);
    utils.log('ERR', `Neobrađeno obećanje (unhandledRejection): ${msg}`);
});

const ALLOWED_KICK_REDIRECT_URIS = new Set([
    'https://kickall.netlify.app/auth/kick/callback',
    'https://kickall.netlify.app/auth/kick/callback/',
    'https://kickall.milanwebportal.com/auth/kick/callback',
    'https://kickall.milanwebportal.com/auth/kick/callback/',
    'http://localhost:5500/auth/kick/callback',
    'http://localhost:5500/auth/kick/callback/'
]);

function normalizeKickRedirectUri(uri) {
    if (!uri || typeof uri !== 'string') return null;

    try {
        const parsed = new URL(uri);
        const cleanPath = parsed.pathname.replace(/\/+$/, '') || '/';
        return `${parsed.origin}${cleanPath}`;
    } catch {
        return null;
    }
}

function resolveKickRedirectUri(candidate) {
    const normalizedCandidate = normalizeKickRedirectUri(candidate);
    if (normalizedCandidate && ALLOWED_KICK_REDIRECT_URIS.has(normalizedCandidate)) {
        return candidate;
    }

    const normalizedEnv = normalizeKickRedirectUri(process.env.KICK_REDIRECT_URI);
    if (normalizedEnv && ALLOWED_KICK_REDIRECT_URIS.has(normalizedEnv)) {
        return process.env.KICK_REDIRECT_URI;
    }

    return 'http://localhost:5500/auth/kick/callback/';
}

// ─── HTTP SERVER (Uptime / Render Service fallback) ───────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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

            const apiRes = await utils.fetchKickAPI(`https://kick.com/api/v2/channels/${username}`);
            if (apiRes.ok) {
                const data = await apiRes.json();
                const avatar = data?.user?.profile_pic || null;
                const bio = data?.user?.bio || '';
                const chatroom_id = data?.chatroom?.id || null;
                const slug = data?.slug || username;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ avatar, bio, chatroom_id, slug }));
                return;
            } else {
                res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ avatar: null, bio: '', chatroom_id: null, slug: username, error: `Kick API returned status ${apiRes.status}` }));
                return;
            }
        }
    } catch (err) {
        console.error('Error handling HTTP request in bot.js:', err);
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`🤖 Multi-channel Kick Bot je aktivan!\nKanali na kojima radi: ${Object.values(state.channels).map(c => '@' + c.channelUsername).join(', ') || 'nijedan'}\n`);
}).listen(PORT, () => {
    utils.log('INFO', `Lokalni HTTP server pokrenut na portu: ${PORT}`);
});

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
}, 10 * 60 * 1000); // Svakih 10 minuta

// ─── START ────────────────────────────────────────────────────────────────────
async function start() {
    utils.log('INFO', '🤖 Multi-channel Kick bot se pokreće...');

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
                        utils.log('INFO', `Kanal @${oldRow.channel_name} obrisan iz bot_config. Gasim bota za taj kanal...`);
                        await zaustaviKanal(chatroomId);
                    }
                } else {
                    const chatroomId = String(newRow.channel_id);
                    const channelUsername = newRow.channel_name || 'Nepoznat';
                    const botActive = newRow.bot_active || false;

                    if (botActive) {
                        if (!state.channels[chatroomId]) {
                            utils.log('INFO', `Kanal @${channelUsername} je aktiviran na dashboard-u! Pokrećem...`);
                            await pokreniKanal(chatroomId, channelUsername, newRow);
                        } else {
                            utils.log('INFO', `Ažuriram konfiguraciju za kanal @${channelUsername} (promena na dashboard-u)...`);
                            azurirajKonfiguracijuKanala(state.getChannelState(chatroomId), newRow);
                            pokreniAutoAnnounceTajmer(chatroomId);
                        }
                    } else {
                        if (state.channels[chatroomId]) {
                            utils.log('INFO', `Kanal @${channelUsername} je deaktiviran na dashboard-u. Gasim...`);
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
                        utils.log('INFO', `Detektovana izmena u custom komandama za kanal ID: ${chatroomId}. Osvežavam...`);
                        await database.ucitajCustomKomande(chatroomId);
                    }
                }
            })
            .subscribe();

    } else {
        utils.log('ERR', 'Kritična greška: Supabase nije konfigurisan! Multi-channel bot zahteva bazu podataka.');
        process.exit(1);
    }
}

start();