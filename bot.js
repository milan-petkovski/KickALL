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

let lastCustomCommandsRefreshTs = 0;
const CUSTOM_COMMAND_REFRESH_THROTTLE_MS = 5000;

function pronadjiCustomKomandu(cmdImeRaw) {
    if (!state.customCommands) return null;

    if (state.customCommands[cmdImeRaw]) {
        return { key: cmdImeRaw, cmd: state.customCommands[cmdImeRaw] };
    }

    const normalizedInput = ukloniSrpskeDijakritike(cmdImeRaw);
    const foundKey = Object.keys(state.customCommands).find(k =>
        ukloniSrpskeDijakritike(k.toLowerCase()) === normalizedInput
    );

    if (!foundKey) return null;

    return { key: foundKey, cmd: state.customCommands[foundKey] };
}

async function obradiCustomKomandu(username, porukaNormalized) {
    if (!porukaNormalized.startsWith('!')) return false;

    const cmdImeRaw = porukaNormalized.slice(1).trim();
    let pronadjena = pronadjiCustomKomandu(cmdImeRaw);

    if (!pronadjena) {
        const sada = Date.now();
        if (sada - lastCustomCommandsRefreshTs >= CUSTOM_COMMAND_REFRESH_THROTTLE_MS) {
            lastCustomCommandsRefreshTs = sada;
            await database.ucitajCustomKomande();
            pronadjena = pronadjiCustomKomandu(cmdImeRaw);
        }
    }

    if (!pronadjena) return false;

    const { key: cmdIme, cmd: customCmd } = pronadjena;
    if (utils.proveraKulauna('custom_' + cmdIme, username, customCmd.cooldown_ms)) return true;

    // Inkrementiraj uses_count u bazi
    if (database.KORISTI_SUPABASE && database.supabase) {
        (async () => {
            try {
                await database.supabase.rpc('increment_command_uses', {
                    p_channel_id: config.CHATROOM_ID,
                    p_command: cmdIme
                });
            } catch (e) {
                console.error('Error incrementing uses:', e);
            }
        })();
    }

    messenger.posaljiPoruku(customCmd.response);
    return true;
}

// ─── WEBSOCKET KONEKCIJA ──────────────────────────────────────────────────────
function povezi() {
    utils.log('INFO', `Pokušavam konekciju... (pokušaj #${state.reconnectAttempt + 1})`);

    state.ws = new WebSocket(
        'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.5.0&flash=false'
    );

    state.ws.on('open', () => {
        utils.log('INFO', 'Povezan na Kick server. Šaljem zahtev za pretplatu na chat...');
        state.reconnectAttempt = 0;
        state.isConnected = true;

        state.ws.send(JSON.stringify({
            event: 'pusher:subscribe',
            data: { channel: `chatrooms.${config.CHATROOM_ID}.v2` }
        }));

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
            utils.log('INFO', 'Uspešno pretplaćen na chat! Bot aktivno sluša poruke... 👀');
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

            const poruka = chatData.content.trim();
            const username = chatData.sender.username;
            const isBotMsg = chatData.sender.is_bot || false;

            // Logujemo samo poruke drugih korisnika (da ne bismo duplirali poruke bota u konzoli)
            if (username.toLowerCase() !== config.BOT_USERNAME.toLowerCase()) {
                utils.log('CHAT', `${username}: ${poruka}`);
            }

            // Preskačemo sopstvene poruke i poznate botove
            const userKey = username.toLowerCase();
            if (isBotMsg || userKey === config.BOT_USERNAME.toLowerCase() || userKey === 'botrix' || userKey === 'nightbot' || userKey === 'streamelements' || userKey === 'streamlabs') {
                return;
            }

            // Ako bot nije aktiviran preko dashboarda, potpuno ignorišemo sve poruke
            if (!state.botActive) {
                return;
            }

            // Anti-spam filter (izuzimamo strimera)
            if (userKey !== config.CHANNEL_USERNAME.toLowerCase() && spam.spamFilter(username, poruka)) return;

            const prefix = config.PREFIX || '!';
            const startsWithPrefix = poruka.startsWith(prefix);

            // Ako poruka počinje sa prefiksom i posle njega ima razmak (npr. "! komanda"), spoj ih u "!komanda"
            let porukaSredjena = poruka;
            if (startsWithPrefix) {
                const ostatak = poruka.slice(prefix.length).trim();
                porukaSredjena = prefix + ostatak;
            }

            // Evidentiraj poruku u leaderboardu aktivnosti
            if (state.isStreamLive && !startsWithPrefix && userKey !== config.CHANNEL_USERNAME.toLowerCase()) {
                database.evidentirajPoruku(username, poruka);
            }

            // Watchtime: registruj korisnika kao aktivnog gledaoca svaki put kad pošalje poruku
            if (state.isStreamLive && userKey !== config.CHANNEL_USERNAME.toLowerCase()) {
                watchtime.registrujAktivnogGledaoca(username);
            }

            // Normalizujemo poruku da uvek interno počinje sa '!' radi kompatibilnosti sa ugrađenim komandama
            let normalizovanaPoruka = porukaSredjena;
            if (startsWithPrefix && prefix !== '!') {
                normalizovanaPoruka = '!' + porukaSredjena.slice(prefix.length);
            }
            const porukaLower = normalizovanaPoruka.toLowerCase();
            const porukaNormalized = ukloniSrpskeDijakritike(porukaLower);

            // Komunikacija sa botom (@bot_username)
            if (config.feature_autoresponse !== false && !startsWithPrefix && porukaLower.includes('@' + config.BOT_USERNAME.toLowerCase())) {
                const ment = commands.handleBotMentions(username, porukaLower);
                if (ment) return;
            }

            // Auto-announce brojač
            if (state.isStreamLive) {
                state.porukePosleAnnounce++;
                if (state.porukePosleAnnounce >= config.ANNOUNCE_AFTER_MSGS) {
                    const sada = Date.now();
                    if (sada - state.zadnjaAutoPorukaTs >= config.ANNOUNCE_MIN_GAP_MS) {
                        triggerAutoAnnounce();
                    }
                }
            }

            // Dinamičke komande
            if (porukaNormalized.startsWith('!vreme') || porukaNormalized.startsWith('!vrijeme')) {
                const isVreme = porukaNormalized.startsWith('!vreme');
                const grad = isVreme ? porukaSredjena.slice(6).trim() : porukaSredjena.slice(8).trim();
                if (grad) {
                    if (utils.proveraKulauna('!vreme', username)) return;
                    commands.handleVreme(grad);
                } else {
                    messenger.posaljiPoruku(`Upotreba: ${isVreme ? '!vreme' : '!vrijeme'} <naziv grada> — npr. !vreme Beograd`);
                }
                return;
            }

            if (porukaNormalized === '!uptime') {
                if (utils.proveraKulauna('!uptime', username)) return;
                commands.handleUptime();
                return;
            }

            if (porukaNormalized === '!igra') {
                if (utils.proveraKulauna('!igra', username)) return;
                commands.handleIgra();
                return;
            }

            if (porukaNormalized === '!watchtime' || porukaNormalized.startsWith('!watchtime ')) {
                const args = porukaSredjena.slice(10).trim();
                if (utils.proveraKulauna('!watchtime', username)) return;
                watchtime.handleWatchtime(username, args);
                return;
            }

            if (porukaNormalized.startsWith('!topwatchtime') || porukaNormalized.startsWith('!topwatch')) {
                const limit = porukaNormalized.startsWith('!topwatchtime') ? porukaSredjena.slice(13).trim() : porukaSredjena.slice(9).trim();
                if (utils.proveraKulauna('!topwatchtime', username)) return;
                watchtime.handleTopWatchtime(limit);
                return;
            }

            if (porukaNormalized.startsWith('!duel ')) {
                if (config.feature_games === false) return;
                const meta = porukaSredjena.slice(6).trim();
                if (utils.proveraKulauna('!duel', username)) return;
                commands.handleDuel(username, meta);
                return;
            }

            if (porukaNormalized.startsWith('!roll')) {
                if (config.feature_games === false) return;
                const target = porukaSredjena.slice(5).trim();
                if (utils.proveraKulauna('!roll', username)) return;
                commands.handleRoll(username, target);
                return;
            }

            if (porukaNormalized.startsWith('!iq')) {
                if (config.feature_games === false) return;
                const target = porukaSredjena.slice(3).trim();
                if (utils.proveraKulauna('!iq', username)) return;
                commands.handleIq(username, target);
                return;
            }

            if (porukaNormalized.startsWith('!samar')) {
                if (config.feature_games === false) return;
                const target = porukaSredjena.slice(6).trim();
                if (utils.proveraKulauna('!samar', username)) return;
                commands.handleSamar(username, target);
                return;
            }

            if (porukaNormalized === '!info') {
                if (utils.proveraKulauna('!info', username)) return;
                commands.handleInfo();
                return;
            }

            if (porukaNormalized.startsWith('!love')) {
                if (config.feature_love === false) return;
                const args = porukaSredjena.slice(5).trim();
                if (utils.proveraKulauna('!love', username)) return;
                commands.handleLove(username, args);
                return;
            }

            if (porukaNormalized.startsWith('!posaljiljubav')) {
                const targetRaw = porukaSredjena.slice(14).trim();
                const targetClean = targetRaw.split(/\s+/)[0].replace(/^@/, '').trim();
                if (!targetClean) {
                    messenger.posaljiPoruku(`@${username}, upotreba: !posaljiljubav @user`);
                    return;
                }

                const userKey = username.toLowerCase();
                const sada = Date.now();
                const zadnji = state.loveHateCooldowns[userKey] || 0;

                if (sada - zadnji < config.LOVE_HATE_COOLDOWN_MS) {
                    const preostaloMs = config.LOVE_HATE_COOLDOWN_MS - (sada - zadnji);
                    const sati = Math.floor(preostaloMs / 3600000);
                    const minuti = Math.floor((preostaloMs % 3600000) / 60000);
                    const sekunde = Math.floor((preostaloMs % 60000) / 1000);

                    let preostaloTekst = '';
                    if (sati > 0) preostaloTekst += `${sati}h `;
                    if (minuti > 0) preostaloTekst += `${minuti}min `;
                    if (sekunde > 0 || (sati === 0 && minuti === 0)) preostaloTekst += `${sekunde}s`;

                    messenger.posaljiPoruku(`❌ @${username}, cooldown: ${preostaloTekst.trim()}.`);
                    return;
                }

                const uspesno = commands.handleModifyLove(username, targetClean, 2);
                if (uspesno) {
                    state.loveHateCooldowns[userKey] = sada;
                }
                return;
            }

            if (porukaNormalized.startsWith('!bacihejt')) {
                const targetRaw = porukaSredjena.slice(9).trim();
                const targetClean = targetRaw.split(/\s+/)[0].replace(/^@/, '').trim();
                if (!targetClean) {
                    messenger.posaljiPoruku(`@${username}, upotreba: !bacihejt @user`);
                    return;
                }

                const userKey = username.toLowerCase();
                const sada = Date.now();
                const zadnji = state.loveHateCooldowns[userKey] || 0;

                if (sada - zadnji < config.LOVE_HATE_COOLDOWN_MS) {
                    const preostaloMs = config.LOVE_HATE_COOLDOWN_MS - (sada - zadnji);
                    const sati = Math.floor(preostaloMs / 3600000);
                    const minuti = Math.floor((preostaloMs % 3600000) / 60000);
                    const sekunde = Math.floor((preostaloMs % 60000) / 1000);

                    let preostaloTekst = '';
                    if (sati > 0) preostaloTekst += `${sati}h `;
                    if (minuti > 0) preostaloTekst += `${minuti}min `;
                    if (sekunde > 0 || (sati === 0 && minuti === 0)) preostaloTekst += `${sekunde}s`;

                    messenger.posaljiPoruku(`❌ @${username}, cooldown: ${preostaloTekst.trim()}.`);
                    return;
                }

                const uspesno = commands.handleModifyLove(username, targetClean, -5);
                if (uspesno) {
                    state.loveHateCooldowns[userKey] = sada;
                }
                return;
            }

            if (porukaNormalized === '!cooldown' || porukaNormalized === '!coldown') {
                const userKey = username.toLowerCase();
                const sada = Date.now();
                const zadnji = state.loveHateCooldowns[userKey] || 0;

                if (sada - zadnji < config.LOVE_HATE_COOLDOWN_MS) {
                    const preostaloMs = config.LOVE_HATE_COOLDOWN_MS - (sada - zadnji);
                    const sati = Math.floor(preostaloMs / 3600000);
                    const minuti = Math.floor((preostaloMs % 3600000) / 60000);
                    const sekunde = Math.floor((preostaloMs % 60000) / 1000);

                    let preostaloTekst = '';
                    if (sati > 0) preostaloTekst += `${sati}h `;
                    if (minuti > 0) preostaloTekst += `${minuti}min `;
                    if (sekunde > 0 || (sati === 0 && minuti === 0)) preostaloTekst += `${sekunde}s`;

                    messenger.posaljiPoruku(`⏳ @${username}, cooldown: ${preostaloTekst.trim()}.`);
                } else {
                    messenger.posaljiPoruku(`✅ @${username}, nema cooldown-a.`);
                }
                return;
            }

            if (porukaNormalized === '!prihvati' || porukaNormalized === '!da' || porukaNormalized === '!pristajem') {
                if (utils.proveraKulauna('!prihvati', username)) return;
                commands.handlePrihvatiBrak(username);
                return;
            }

            if (porukaNormalized === '!odbij' || porukaNormalized === '!ne' || porukaNormalized === '!odbijam') {
                if (utils.proveraKulauna('!odbij', username)) return;
                commands.handleOdbijBrak(username);
                return;
            }

            if (porukaNormalized.startsWith('!vencaj')) {
                if (config.feature_love === false) return;
                const targetRaw = porukaSredjena.slice(7).trim();
                if (utils.proveraKulauna('!vencaj', username)) return;
                commands.handleVencaj(username, targetRaw);
                return;
            }

            if (porukaNormalized.startsWith('!razvod')) {
                if (config.feature_love === false) return;
                const target = porukaSredjena.slice(7).trim();
                if (utils.proveraKulauna('!razvod', username)) return;
                commands.handleRazvod(username, target);
                return;
            }

            if (porukaNormalized === '!brakovi' || porukaNormalized === '!brak' || porukaNormalized === '!vencani') {
                if (config.feature_love === false) return;
                if (utils.proveraKulauna('!brakovi', username)) return;
                commands.handleBrakovi();
                return;
            }

            // Leaderboard komande
            if (porukaNormalized.startsWith('!top') || porukaNormalized.startsWith('!leaderboard')) {
                let limitStr = '';
                if (porukaNormalized.startsWith('!top')) {
                    limitStr = porukaSredjena.slice(4).trim();
                } else {
                    limitStr = porukaSredjena.slice(12).trim();
                }
                if (utils.proveraKulauna('!top', username)) return;
                commands.handleTop(limitStr);
                return;
            }

            if (porukaNormalized === '!aktivnost' || porukaNormalized === '!stats' || porukaNormalized === '!points' || porukaNormalized === '!poeni') {
                if (utils.proveraKulauna('!aktivnost', username)) return;
                commands.handleAktivnost(username);
                return;
            }

            // Admin komande
            const isAuthorized = username.toLowerCase() === config.CHANNEL_USERNAME.toLowerCase() ||
                username.toLowerCase() === 'milan_567' ||
                (chatData.sender.identity &&
                    chatData.sender.identity.badges &&
                    chatData.sender.identity.badges.some(b => b.type === 'broadcaster'));

            const canPin = isAuthorized ||
                (chatData.sender.identity &&
                    chatData.sender.identity.badges &&
                    chatData.sender.identity.badges.some(b => b.type === 'moderator'));

            if (porukaNormalized === '!resetleaderboard') {
                commands.handleResetLeaderboard(username, isAuthorized);
                return;
            }

            if (porukaNormalized === '!osvezi') {
                commands.handleOsvezi(username, isAuthorized);
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
                        tekst = config.STREAM_START_PIN_MESSAGE;
                    }

                    if (tekst) {
                        messenger.posaljiIPinujPoruku(tekst);
                    }
                }
                return;
            }

            if (porukaNormalized === '!unpin') {
                if (isAuthorized) {
                    messenger.odpinujPoruku();
                }
                return;
            }

            if (porukaNormalized.startsWith('!setlive ')) {
                if (isAuthorized) {
                    const val = porukaSredjena.slice(9).trim().toLowerCase();
                    if (val === 'true') {
                        state.isStreamLive = true;
                        state.manualStreamStartTs = Date.now();
                        messenger.posaljiPoruku('🔴 Status strima je ručno podešen na: LIVE.');
                    } else if (val === 'false') {
                        state.isStreamLive = false;
                        state.manualStreamStartTs = 0;
                        messenger.posaljiPoruku('⚪ Status strima je ručno podešen na: OFFLINE.');
                    } else {
                        messenger.posaljiPoruku('Upotreba: !setlive true or !setlive false');
                    }
                }
                return;
            }

            if (porukaNormalized.startsWith('!setgame ')) {
                if (isAuthorized) {
                    const game = porukaSredjena.slice(9).trim();
                    if (game) {
                        state.manualGameName = game;
                        messenger.posaljiPoruku(`🎮 Igra je ručno podešena na: ${game}`);
                    } else {
                        messenger.posaljiPoruku('Upotreba: !setgame <naziv igre>');
                    }
                }
                return;
            }

            // Custom komande iz baze podataka
            if (await obradiCustomKomandu(username, porukaNormalized)) {
                return;
            }

            // Statičke komande
            const staticKomande = {
                '!pc': config.specPoruka,
                '!setup': config.specPoruka,
                '!giveaway': config.giveawayPoruka,
                '!linktree': config.linktreePoruka,
                '!links': config.linktreePoruka,
                '!mreze': config.linktreePoruka,
                '!mreže': config.linktreePoruka,
                '!merch': config.merchPoruka,
                '!instagram': config.instaPoruka,
                '!insta': config.instaPoruka,
                '!ig': config.instaPoruka,
                '!tiktok': config.tiktokPoruka,
                '!tt': config.tiktokPoruka,
                '!youtube': config.youtubePoruka,
                '!yt': config.youtubePoruka,
                '!discord': config.discordPoruka,
                '!dc': config.discordPoruka,
                '!watchtime': '⏱️ Proveri watchtime: !watchtime ili !watchtime @user | Top lista: !topwatchtime',
                '!komande': '🤖 Sve komande bota: !aktivnost, !top, !watchtime, !topwatchtime, !vreme <grad>, !love @user, !vencaj @user, !razvod @user, !samar @user, !roll @user, !duel @user, !iq, !info, !pc, !giveaway, !links, !merch, !dc, !ig, !tt, !yt, !cooldown'
            };

            const kljuc = Object.keys(staticKomande).find(
                k => ukloniSrpskeDijakritike(k.toLowerCase()) === porukaNormalized
            );

            if (!kljuc) return;

            if (utils.proveraKulauna(kljuc, username)) return;
            messenger.posaljiPoruku(staticKomande[kljuc]);
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
    }, config.HEARTBEAT_MS);
}

function scheduleReconnect() {
    const cekanje = Math.min(config.RECONNECT_BASE_MS * Math.pow(2, state.reconnectAttempt), config.RECONNECT_MAX_MS);
    state.reconnectAttempt++;
    utils.log('INFO', `Pokušavam ponovo za ${(cekanje / 1000).toFixed(1)}s...`);
    setTimeout(povezi, cekanje);
}

// Provera statusa strima
async function proveriDaLiJeLive() {
    try {
        const res = await utils.fetchKickAPI(`https://kick.com/api/v2/channels/${config.CHANNEL_USERNAME}`);
        if (res.ok) {
            const data = await res.json();
            const liveState = !!data.livestream;

            if (database.KORISTI_SUPABASE && database.supabase) {
                try {
                    await database.supabase
                        .from('channels')
                        .upsert({
                            id: config.CHATROOM_ID,
                            username: config.CHANNEL_USERNAME,
                            is_active: liveState,
                            created_at: new Date().toISOString()
                        }, { onConflict: 'id' });
                } catch (dbErr) {
                    utils.log('ERR', `Greška pri upisu statusa strima u bazu: ${dbErr.message}`);
                }
            }

            if (liveState !== state.isStreamLive) {
                state.isStreamLive = liveState;
                utils.log('INFO', `Status strima promenjen: ${state.isStreamLive ? '🔴 LIVE' : '⚪ OFFLINE'}`);
                if (state.isStreamLive && !state.isFirstLiveCheck) {
                    utils.log('INFO', 'Strim je počeo! Slanje pozdravne poruke i pinovanje...');
                    messenger.posaljiIPinujPoruku(config.STREAM_START_PIN_MESSAGE);
                } else if (!state.isStreamLive) {
                    watchtime.ocistiAktivneGledaoce();
                }
            }
            state.isFirstLiveCheck = false;
        }
    } catch (err) {
        utils.log('ERR', `Greška pri proveri statusa strima: ${err.message}`);
    }
}

// ─── AUTO ANNOUNCE ───────────────────────────────────────────────────────────
function triggerAutoAnnounce() {
    const poruke = state.autoAnnounces || [];
    if (poruke.length === 0) return;

    let idx;
    do {
        idx = Math.floor(Math.random() * poruke.length);
    } while (idx === state.zadnjiAutoPorukaIdx && poruke.length > 1);

    state.zadnjiAutoPorukaIdx = idx;
    state.porukePosleAnnounce = 0;
    state.zadnjaAutoPorukaTs = Date.now();

    messenger.posaljiPoruku(poruke[idx]);
}

// ─── SHUTDOWN HANDLER ─────────────────────────────────────────────────────────
let isShuttingDown = false;
async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    utils.log('INFO', `Bot se gasi... (${signal})`);

    if (state.leaderboardDirty) {
        try {
            await database.sacuvajLeaderboard();
        } catch (e) {
            utils.log('ERR', `Greška pri čuvanju leaderboarda pre gašenja: ${e.message}`);
        }
    }

    if (state.loveDirty) {
        try {
            await database.sacuvajLjubav();
        } catch (e) {
            utils.log('ERR', `Greška pri čuvanju ljubavnih podataka pre gašenja: ${e.message}`);
        }
    }

    if (state.watchtimeDirty) {
        try {
            await watchtime.sacuvajWatchtime();
        } catch (e) {
            utils.log('ERR', `Greška pri čuvanju watchtime-a pre gašenja: ${e.message}`);
        }
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

// ─── HTTP SERVER (Uptime / Render Service fallback) ───────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer(async (req, res) => {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    try {
        const parsedUrl = new URL(req.url, 'http://localhost');
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
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ avatar }));
                return;
            } else {
                res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ avatar: null, error: `Kick API returned status ${apiRes.status}` }));
                return;
            }
        }
    } catch (err) {
        console.error('Error handling HTTP request in bot.js:', err);
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('🤖 Tutzot Kick Bot je aktivan i zdrav!\n');
}).listen(PORT, () => {
    utils.log('INFO', `Lokalni HTTP server pokrenut na portu: ${PORT}`);
});

// ─── MEMORY CLEANUP ───────────────────────────────────────────────────────────
setInterval(() => {
    const sada = Date.now();
    for (const key in state.spamTracker) {
        state.spamTracker[key] = state.spamTracker[key].filter(t => sada - t < config.SPAM_WINDOW_MS);
        if (state.spamTracker[key].length === 0) {
            delete state.spamTracker[key];
        }
    }
    for (const key in state.rapidTracker) {
        state.rapidTracker[key] = state.rapidTracker[key].filter(t => sada - t < config.RAPID_MSG_WINDOW_MS);
        if (state.rapidTracker[key].length === 0) {
            delete state.rapidTracker[key];
        }
    }
}, 10 * 60 * 1000); // Svakih 10 minuta

// Rezolucija kanala (dohvata chatroom ID dinamički sa Kick API-ja)
async function resolvujKanal() {
    utils.log('INFO', `Rezolucija kanala za korisničko ime: ${config.CHANNEL_USERNAME}...`);
    try {
        const res = await utils.fetchKickAPI(`https://kick.com/api/v2/channels/${config.CHANNEL_USERNAME}`);
        if (!res.ok) {
            throw new Error(`HTTP status ${res.status}`);
        }
        const data = await res.json();
        if (data && data.chatroom && data.chatroom.id) {
            config.CHATROOM_ID = data.chatroom.id.toString();
            utils.log('INFO', `Uspešno rezolvovan CHATROOM_ID: ${config.CHATROOM_ID}`);
        } else if (data && data.id) {
            config.CHATROOM_ID = data.id.toString();
            utils.log('INFO', `Uspešno rezolvovan CHATROOM_ID iz ID kanala: ${config.CHATROOM_ID}`);
        } else {
            throw new Error('Nije pronađen ID chatroom-a u odgovoru API-ja.');
        }
    } catch (err) {
        utils.log('ERR', `Neuspešna rezolucija kanala: ${err.message}`);
        if (!config.CHATROOM_ID) {
            utils.log('ERR', 'Kritična greška: CHATROOM_ID nije definisan u .env i ne može se rezolvovati.');
            process.exit(1);
        }
        utils.log('WARN', `Koristiću CHATROOM_ID iz .env-a: ${config.CHATROOM_ID}`);
    }
}

// ─── START ────────────────────────────────────────────────────────────────────
async function start() {
    utils.log('INFO', '🤖 Kickot bot se pokreće...');
    await resolvujKanal();
    state.isFirstLiveCheck = true;

    // Učitaj bot config na samom startu
    await database.ucitajBotConfig();

    await database.ucitajLeaderboard();
    await database.ucitajLjubav();
    await database.ucitajCustomKomande();
    await watchtime.ucitajWatchtime();
    watchtime.pokreniWatchtimeTick();
    povezi();

    proveriDaLiJeLive();
    setInterval(proveriDaLiJeLive, 2 * 60 * 1000);

    // Osluškivanje izmena konfiguracije i custom komandi u realnom vremenu
    if (database.KORISTI_SUPABASE && database.supabase) {
        database.supabase.channel('public:bot_config')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'bot_config',
                filter: `channel_id=eq.${config.CHATROOM_ID}`
            }, async (payload) => {
                utils.log('INFO', 'Detektovana promena konfiguracije bota na Supabase. Osvežavam...');
                await database.ucitajBotConfig();
            })
            .subscribe();

        database.supabase.channel('public:custom_commands')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'custom_commands',
                filter: `channel_id=eq.${config.CHATROOM_ID}`
            }, async (payload) => {
                utils.log('INFO', 'Detektovana promena custom komandi na Supabase. Osvežavam...');
                await database.ucitajCustomKomande();
            })
            .subscribe();
    }
}
start();