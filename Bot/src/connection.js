// WebSocket / Realtime (Centrifugo) konekcija ka Kick servisima, deduplikacija događaja i distribucija

const { Centrifuge } = require('centrifuge');
const WebSocket = require('ws');
const axios = require('axios');
const config = require('./config');
const state = require('./state');
const utils = require('./utils');
const database = require('./database');
const messenger = require('./messenger');
const watchtime = require('./watchtime');
const moderation = require('./moderation');
const spam = require('./spam');
const streamAnalytics = require('./streamAnalytics');
const commandRouter = require('./commandRouter');
const channelManager = require('./channelManager');

// ─── WEBSOCKET KONEKCIJA & SPLIT-BRAIN DEDUPLICATION ─────────────────────────
const processedMessageCache = new Map();

function isDuplicateMessage(msgId) {
    if (!msgId) return false;
    const id = String(msgId);
    const now = Date.now();
    if (processedMessageCache.has(id)) {
        return true;
    }
    processedMessageCache.set(id, now);
    if (processedMessageCache.size > 2000) {
        const threshold = now - 60000;
        for (const [k, ts] of processedMessageCache.entries()) {
            if (ts < threshold) processedMessageCache.delete(k);
        }
    }
    return false;
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

const TOKEN_ROTATION_MS = 25 * 60 * 1000; // 25 minuta (Kick JWT token ističe za 45 minuta)

function stopTokenRotation() {
    if (state.tokenRotationTimer) {
        clearTimeout(state.tokenRotationTimer);
        state.tokenRotationTimer = null;
    }
}

function startTokenRotation() {
    stopTokenRotation();
    state.tokenRotationTimer = setTimeout(() => {
        utils.log('INFO', 'Proaktivna rotacija Kick Realtime tokena (pre isteka sesije)...');
        povezi();
    }, TOKEN_ROTATION_MS);
}

function scheduleReconnect(immediate = false) {
    if (state.isShuttingDown) return;

    if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
    }

    if (immediate) {
        state.reconnectAttempt = 0;
        utils.log('INFO', 'Hitna rekonekcija na WebSocket za 0.5s...');
        state.reconnectTimer = setTimeout(() => {
            state.reconnectTimer = null;
            povezi();
        }, 500);
        return;
    }
    const baseCekanje = Math.min((config.RECONNECT_BASE_MS || 3000) * Math.pow(2, state.reconnectAttempt), config.RECONNECT_MAX_MS || 60000);
    const jitter = Math.floor(Math.random() * 1000);
    const cekanje = baseCekanje + jitter;
    state.reconnectAttempt++;
    utils.log('INFO', `Pokušavam ponovo za ${(cekanje / 1000).toFixed(1)}s...`);
    state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;
        povezi();
    }, cekanje);
}

async function obradiPusherPoruku(data) {
    if (state.isShuttingDown || !state.isLeader) {
        return;
    }

    let response;
    try {
        response = typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
        return;
    }

    if (!response || typeof response !== 'object') {
        return;
    }

    // Odgovaramo na Pusher ping
    if (response.event === 'pusher:ping') {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
        }
        return;
    }

    // Potvrda pretplate
    if (response.event === 'pusher_internal:subscription_succeeded') {
        utils.log('INFO', `Uspešno pretplaćen na kanal četa: ${response.channel}`);
        return;
    }

    // Ostali događaji sa kanala (Subscription, Gifted Subscription, Follower, Host/Raid, KICKs)
    if (
        response.event === 'App\\Events\\SubscriptionEvent' ||
        response.event === 'App\\Events\\GiftedSubscriptionsEvent' ||
        response.event === 'App\\Events\\FollowersUpdateEvent' ||
        response.event === 'App\\Events\\StreamHostEvent' ||
        response.event === 'StreamHostEvent' ||
        response.event === 'App\\Events\\KicksGiftedEvent' ||
        response.event === 'KicksGiftedEvent' ||
        (typeof response.event === 'string' && (response.event.includes('StreamHost') || response.event.includes('KicksGifted') || response.event.includes('RaidEvent')))
    ) {
        let evtData;
        try {
            evtData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        } catch {
            evtData = null;
        }

        const match = response.channel ? response.channel.match(/^chatrooms\.(\d+)/) : null;
        if (match && evtData) {
            const pusherChatroomId = String(match[1]);
            let chatroomId = Object.keys(state.channels).find(k => {
                const cs = state.channels[k];
                return String(cs.realChatroomId) === pusherChatroomId || String(k) === pusherChatroomId;
            }) || pusherChatroomId;

            const channelState = state.getChannelState(chatroomId);
            if (channelState && channelState.isStreamLive) {
                const activeUser = evtData.username || evtData.follower?.username || evtData.subscriber?.username || evtData.user?.username || evtData.host_username;
                if (activeUser && activeUser.toLowerCase() !== channelState.channelUsername.toLowerCase()) {
                    watchtime.registrujAktivnogGledaoca(chatroomId, activeUser);
                }
            }

            // Chat alertovi (Follow / Sub / Resub / Giftsub / KICKs / Host)
            if (channelState && channelState.feature_autoresponse !== false) {
                const alerts = channelState.alerts_settings || {};

                if (response.event === 'App\\Events\\FollowersUpdateEvent') {
                    const followedNow = evtData.followed !== false;
                    const followerName = evtData.username || evtData.follower?.username || evtData.user?.username;
                    if (followedNow && followerName && alerts.follow_enabled) {
                        const msg = utils.formatAlertMessage(alerts.follow_message, {
                            name: followerName,
                            fallback: `Hvala na praćenju @${followerName}!`
                        });
                        if (msg) messenger.posaljiPoruku(chatroomId, msg);
                    }
                }

                if (response.event === 'App\\Events\\SubscriptionEvent') {
                    const subName = evtData.username || evtData.subscriber?.username || evtData.user?.username;
                    const months = evtData.months || evtData.duration || 1;
                    if (subName) {
                        const isResub = Number(months) > 1;
                        const alertOn = isResub ? alerts.resub_enabled : alerts.sub_enabled;
                        const template = isResub ? alerts.resub_message : alerts.sub_message;
                        const fallback = isResub
                            ? `Hvala @${subName} na obnovi pretplate od ${months} meseci!`
                            : `Hvala na pretplati @${subName}!`;
                        if (alertOn) {
                            const msg = utils.formatAlertMessage(template, { name: subName, months, fallback });
                            if (msg) messenger.posaljiPoruku(chatroomId, msg);
                        }
                    }
                }

                if (response.event === 'App\\Events\\GiftedSubscriptionsEvent') {
                    const gifter = evtData.gifter_username || evtData.username || 'Anoniman';
                    const count = evtData.gifted_usernames ? evtData.gifted_usernames.length : (evtData.count || 1);
                    const alertOn = alerts.giftsub_enabled;
                    const template = alerts.giftsub_message;
                    const fallback = `Hvala @${gifter} na poklonjenih ${count} subova!`;
                    if (alertOn) {
                        const msg = utils.formatAlertMessage(template, { name: gifter, count, fallback });
                        if (msg) messenger.posaljiPoruku(chatroomId, msg);
                    }
                }

                if (response.event === 'App\\Events\\StreamHostEvent' || response.event === 'StreamHostEvent' || (typeof response.event === 'string' && response.event.includes('StreamHost'))) {
                    const hostUser = evtData.host_username || evtData.username || 'Neko';
                    const viewers = evtData.number_viewers || evtData.viewers || 0;
                    const minViewers = alerts.host_min_viewers || 0;
                    if (alerts.host_enabled && viewers >= minViewers) {
                        const msg = utils.formatAlertMessage(alerts.host_message, {
                            name: hostUser,
                            viewers,
                            fallback: `Hvala @${hostUser} na hostu sa ${viewers} gledalaca!`
                        });
                        if (msg) messenger.posaljiPoruku(chatroomId, msg);
                    }
                }

                if (response.event === 'App\\Events\\KicksGiftedEvent' || response.event === 'KicksGiftedEvent' || (typeof response.event === 'string' && response.event.includes('KicksGifted'))) {
                    const sender = evtData.sender_username || evtData.username || 'Neko';
                    const amount = evtData.amount || evtData.kicks || 0;
                    const minAmount = alerts.kicks_min_amount || 0;
                    if (alerts.kicks_enabled && amount >= minAmount) {
                        const msg = utils.formatAlertMessage(alerts.kicks_message, {
                            name: sender,
                            amount,
                            fallback: `Hvala @${sender} na poslatim ${amount} KICKs!`
                        });
                        if (msg) messenger.posaljiPoruku(chatroomId, msg);
                    }
                }
            }
        }
        return;
    }

    // Nova chat poruka
    const isChatEvent = response.event && (
        response.event === 'App\\Events\\ChatMessageEvent' ||
        response.event === 'App\\Events\\ChatMessageSentEvent' ||
        response.event === 'ChatMessageEvent' ||
        response.event === 'ChatMessageSentEvent' ||
        (typeof response.event === 'string' && response.event.includes('ChatMessage'))
    );

    if (isChatEvent) {
        let chatData;
        try {
            chatData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        } catch {
            return;
        }

        if (!chatData) return;

        // Split-Brain & Duplicate Event prevencija
        if (chatData.id && isDuplicateMessage(chatData.id)) {
            return;
        }

        const poruka = (chatData.content || chatData.message || '').trim();
        const username = chatData.sender?.username || chatData.sender?.slug || chatData.user?.username || chatData.username || '';

        if (!poruka || !username) {
            return;
        }

        // Ekstrakcija chatroom ID-ja iz koverte Pusher kanala
        const match = response.channel ? response.channel.match(/^chatrooms\.(\d+)/) : null;
        if (!match) return;
        const pusherChatroomId = String(match[1]);

        let chatroomId = Object.keys(state.channels).find(k => {
            const cs = state.channels[k];
            return String(cs.realChatroomId) === pusherChatroomId || String(k) === pusherChatroomId;
        });
        if (!chatroomId) {
            chatroomId = pusherChatroomId;
        }

        const channelState = state.getChannelState(chatroomId);
        if (!channelState || channelState.botActive === false) {
            return;
        }

        const isBotMsg = chatData.sender?.is_bot || false;
        const userKey = username.toLowerCase();
        const botKey = (channelManager.getBotUsername() || '').toLowerCase();

        // Preskačemo poznate eksterne botove
        if (userKey === 'kickotbot' || userKey === 'botrix' || userKey === 'nightbot' || userKey === 'streamelements' || userKey === 'streamlabs') {
            return;
        }

        const porukaTrimmed = poruka.trim();
        const prefix = channelState.PREFIX || '!';
        const startsWithPrefix = porukaTrimmed.startsWith(prefix);

        // Ako je automatska poruka od samog bota (i nije komanda), preskačemo da izbegnemo petlje
        if (isBotMsg && !startsWithPrefix) {
            return;
        }
        if (botKey && userKey === botKey && !startsWithPrefix) {
            return;
        }

        // Privilegovani nalozi (moderatori, broadcaster, VIP, OG, kanal) nikada ne smeju biti blokirani
        const senderBadges = chatData.sender?.identity?.badges || chatData.sender?.badges || [];
        const isPrivilegedUser = senderBadges.some(b => b.type === 'moderator' || b.type === 'broadcaster' || b.type === 'vip' || b.type === 'og') ||
                                 userKey === (channelState.channelUsername || '').toLowerCase();

        // Ako je korisnik već banovan u ovoj sesiji (npr. spam bot koji je poslao 2 poruke u sekundi), odmah odbaci
        if (channelState.bannedUsers && channelState.bannedUsers.has(userKey)) {
            if (isPrivilegedUser) {
                channelState.bannedUsers.delete(userKey);
            } else {
                const messageId = chatData.id || chatData.messageId || null;
                if (messageId) messenger.obrisiPoruku(chatroomId, messageId);
                return;
            }
        }

        // Stream Analytics za Kickan
        try {
            streamAnalytics.recordChatMessage(
                chatroomId,
                username,
                poruka,
                chatData.sender?.identity?.badges || chatData.sender?.badges || []
            );
        } catch (_) {}

        // Logujemo chat poruku
        utils.log('CHAT', `[@${channelState.channelUsername || chatroomId}] ${username}: ${poruka}`);

        // Automatska moderacija četa
        const messageId = chatData.id || chatData.messageId || null;
        if (moderation.proveriModeraciju(chatroomId, username, poruka, messageId, chatData.sender)) {
            return;
        }

        // Anti-spam filter (izuzimamo strimera i bot komande)
        if (userKey !== channelState.channelUsername.toLowerCase() && !startsWithPrefix && spam.spamFilter(chatroomId, username, poruka, chatData.sender)) {
            // Samo upozorenje bez brisanja poruka
            return;
        }

        // Ako poruka počinje sa prefiksom i posle njega ima razmak (npr. "! komanda"), spoj ih
        let porukaSredjena = porukaTrimmed;
        if (startsWithPrefix) {
            const ostatak = porukaTrimmed.slice(prefix.length).trim();
            porukaSredjena = prefix + ostatak;
        }

        // Welcome message
        const welcomeAlertEnabled = (channelState.alerts_settings || {}).welcome_enabled ?? false;
        if (welcomeAlertEnabled && channelState.welcome_message && !channelState.welcomedUsers.has(userKey)) {
            channelState.welcomedUsers.add(userKey);
            const welcomeMsg = utils.formatTemplateMessage(channelState.welcome_message, username);
            messenger.posaljiPoruku(chatroomId, welcomeMsg);
        }

        // Evidentiraj poruku u leaderboardu aktivnosti
        if (channelState.isStreamLive && !startsWithPrefix && userKey !== channelState.channelUsername.toLowerCase()) {
            const userRank = commandRouter.getUserRankLevel(username, chatData.sender, channelState.channelUsername);
            const isSubUser = userRank >= 1;
            database.evidentirajPoruku(chatroomId, username, poruka, isSubUser);
        }

        // Watchtime
        if (channelState.isStreamLive && userKey !== channelState.channelUsername.toLowerCase()) {
            watchtime.registrujAktivnogGledaoca(chatroomId, username);
        }

        // Auto-announce praćenje aktivnosti i provera uslova za slanje
        const botUsername = (channelManager.getBotUsername() || '').toLowerCase();
        const isFromBotOrStreamer = userKey === botUsername || userKey === (channelState.channelUsername || '').toLowerCase();

        if (channelState.isStreamLive && !isFromBotOrStreamer) {
            channelState.porukePosleAnnounce = (channelState.porukePosleAnnounce || 0) + 1;
            channelManager.proveriAutoAnnounce(chatroomId);
        }

        // Obrada komande preko centralnog command router-a
        const porukaLowerOriginal = porukaSredjena.toLowerCase();
        await commandRouter.obradiKomandu({
            chatroomId,
            username,
            porukaSredjena,
            porukaLowerOriginal,
            senderObj: chatData.sender || {},
            channelState,
            botUsernameResolved: channelManager.getBotUsername(),
            prefix,
            startsWithPrefix
        });
    }
}

async function getRealtimeToken() {
    const postData = JSON.stringify({
        client_id: `kickotbot-${Date.now()}`
    });

    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'x-app-platform': 'web'
    };

    if (config.BOT_COOKIE) {
        headers['Cookie'] = config.BOT_COOKIE;
    }
    if (config.BEARER_TOKEN) {
        headers['Authorization'] = config.BEARER_TOKEN.startsWith('Bearer ') ? config.BEARER_TOKEN : `Bearer ${config.BEARER_TOKEN}`;
    }

    try {
        const response = await axios.post(config.REALTIME_AUTH_URL, postData, {
            headers,
            timeout: 10000
        });

        if (response.data && response.data.data && response.data.data.token) {
            return response.data.data.token;
        }
        throw new Error('Kick realtime auth API nije vratio token');
    } catch (err) {
        if (headers['Cookie'] || headers['Authorization']) {
            try {
                const guestRes = await axios.post(config.REALTIME_AUTH_URL, postData, {
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': headers['User-Agent'],
                        'Accept': 'application/json',
                        'x-app-platform': 'web'
                    },
                    timeout: 10000
                });
                if (guestRes.data?.data?.token) {
                    return guestRes.data.data.token;
                }
            } catch (fallbackErr) {
                utils.log('ERR', `Greška pri preuzimanju guest realtime tokena: ${fallbackErr.message}`);
            }
        }
        utils.log('ERR', `Greška pri preuzimanju Kick realtime tokena: ${err.message}`);
        throw err;
    }
}

function clearConnectingTimeout() {
    if (state.connectingTimeout) {
        clearTimeout(state.connectingTimeout);
        state.connectingTimeout = null;
    }
}

function startLivenessWatchdog() {
    stopLivenessWatchdog();
    state.livenessWatchdogTimer = setInterval(() => {
        if (state.isShuttingDown || !state.isLeader) return;

        // 1. Ako je bot diskonektovan, a nijedan tajmer za povezivanje/rekonekciju nije aktivan
        if (!state.isConnected && !state.isConnecting && !state.reconnectTimer) {
            utils.log('WARN', '[WATCHDOG] Realtime konekcija je prekinuta i nije zakazana rekonekcija. Pokrećem automatski oporavak...');
            scheduleReconnect(true);
            return;
        }

        // 2. Ako state vodi da smo povezani, proveravamo stvarno stanje klijenta
        if (state.isConnected && state.centrifuge) {
            if (state.centrifuge.state !== 'connected') {
                utils.log('WARN', `[WATCHDOG] Otkriven nesklad stanja (centrifuge.state=${state.centrifuge.state}, isConnected=true). Resetujem konekciju...`);
                state.isConnected = false;
                state.isConnecting = false;
                scheduleReconnect(true);
                return;
            }

            // 3. Provera pretplata za sve aktivne kanale
            for (const chatroomId of Object.keys(state.channels)) {
                const channelState = state.channels[chatroomId];
                if (channelState && channelState.botActive !== false) {
                    const subId = channelState.realChatroomId || chatroomId;
                    const channelName = `chatrooms.${subId}.v2`;
                    const sub = state.centrifuge.getSubscription(channelName);
                    if (!sub || sub.state === 'unsubscribed') {
                        utils.log('WARN', `[WATCHDOG] Kanal ${channelName} nije aktivan u pretplatama. Ponovo pretplaćujem...`);
                        pretplatiNaChatroom(chatroomId);
                    }
                }
            }
        }
    }, 45000);
    if (state.livenessWatchdogTimer.unref) state.livenessWatchdogTimer.unref();
}

function stopLivenessWatchdog() {
    if (state.livenessWatchdogTimer) {
        clearInterval(state.livenessWatchdogTimer);
        state.livenessWatchdogTimer = null;
    }
}

function pretplatiNaChatroom(chatroomId) {
    if (!state.centrifuge) return;
    const channelState = state.channels[chatroomId];
    const subId = channelState?.realChatroomId || chatroomId;
    const channelName = `chatrooms.${subId}.v2`;

    let sub = state.centrifuge.getSubscription(channelName);
    if (!sub) {
        sub = state.centrifuge.newSubscription(channelName);
        sub.on('subscribed', () => {
            utils.log('INFO', `Uspešno pretplaćen na kanal četa: ${channelName}`);
        });
        sub.on('publication', (ctx) => {
            try {
                const res = obradiRealtimePoruku(channelName, ctx.data);
                if (res && typeof res.catch === 'function') {
                    res.catch((err) => {
                        utils.log('ERR', `Greška pri asinhronoj obradi poruke sa kanala ${channelName}: ${err.message}`);
                    });
                }
            } catch (err) {
                utils.log('ERR', `Greška pri prijemu poruke sa kanala ${channelName}: ${err.message}`);
            }
        });
        sub.on('error', (ctx) => {
            utils.log('WARN', `Centrifugo greška na kanalu ${channelName}: ${ctx.error?.message || ctx.error}`);
            // Ako je pretplata otkazana usled greške na serveru, ponovo je pokrećemo
            if (sub.state === 'unsubscribed' && !state.isShuttingDown && state.isConnected) {
                setTimeout(() => {
                    if (state.centrifuge && state.isConnected) {
                        pretplatiNaChatroom(chatroomId);
                    }
                }, 2000);
            }
        });
        sub.subscribe();
    } else if (sub.state === 'unsubscribed') {
        sub.subscribe();
    }
}

function otkaziPretplatu(chatroomId) {
    if (!state.centrifuge) return;
    const channelState = state.channels[chatroomId];
    const subId = channelState?.realChatroomId || chatroomId;
    const channelName = `chatrooms.${subId}.v2`;

    const sub = state.centrifuge.getSubscription(channelName);
    if (sub) {
        try {
            sub.unsubscribe();
            state.centrifuge.removeSubscription(sub);
            utils.log('INFO', `Otkazana pretplata sa kanala četa: ${channelName}`);
        } catch (_) {}
    }
}

async function obradiRealtimePoruku(channelName, payload) {
    if (!payload) return;
    let eventName = payload.event;
    let eventData = payload.data;

    if (typeof payload === 'string') {
        try {
            const parsed = JSON.parse(payload);
            eventName = parsed.event || eventName;
            eventData = parsed.data !== undefined ? parsed.data : eventData;
        } catch (_) {}
    }

    const response = {
        channel: channelName,
        event: eventName,
        data: eventData
    };

    return await obradiPusherPoruku(response);
}

// Globalno izlažemo metode na state radi prevencije kružnih zavisnosti
state.pretplatiNaChatroom = pretplatiNaChatroom;
state.otkaziPretplatu = otkaziPretplatu;

async function povezi(force = false) {
    if (state.isShuttingDown) {
        utils.log('WARN', 'Gašenje u toku — preskačem ponovno povezivanje na WebSocket.');
        return;
    }

    if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
    }

    if (state.isConnecting && !force) {
        utils.log('INFO', 'Konekcija na Kick Realtime je već u toku — preskačem duplirani poziv.');
        return;
    }
    state.isConnecting = true;
    stopTokenRotation();
    clearConnectingTimeout();

    // Watchdog za slučaj da povezivanje visi duže od 20s
    state.connectingTimeout = setTimeout(() => {
        if (state.isConnecting && !state.isConnected) {
            utils.log('WARN', 'Kick Realtime povezivanje je prekoračilo vremenski limit (20s). Resetujem i zakazujem rekonekciju...');
            state.isConnecting = false;
            if (state.centrifuge) {
                try {
                    state.centrifuge.removeAllListeners();
                    state.centrifuge.disconnect();
                } catch (_) {}
                state.centrifuge = null;
            }
            scheduleReconnect(true);
        }
    }, 20000);
    if (state.connectingTimeout.unref) state.connectingTimeout.unref();

    if (state.centrifuge) {
        try {
            state.centrifuge.removeAllListeners();
            state.centrifuge.disconnect();
        } catch (_) {}
        state.centrifuge = null;
    }

    utils.log('INFO', 'Povezujem se na Kick Realtime WebSocket (Centrifugo)...');
    const wsUrl = config.REALTIME_WS_URL || 'wss://realtime.us-east-1.platform.kick.com/connection/websocket';

    try {
        state.centrifuge = new Centrifuge(wsUrl, {
            websocket: WebSocket,
            getToken: async () => {
                return await getRealtimeToken();
            },
            maxReconnectDelay: 10000,
            minReconnectDelay: 1000
        });

        // Sprečavamo slanje in-place { refresh: { token } } RPC paketa koji Kick server odbija sa kodom 3500 (invalid token).
        // Umesto toga, pri svakom zahtevu za osvežavanje pokrećemo čistu rekonekciju sa novim tokenom.
        state.centrifuge._refresh = () => {
            utils.log('INFO', 'Zahtev za osvežavanje tokena — pokrećem bezbednu rotaciju konekcije...');
            povezi(true);
        };

        state.centrifuge.on('connected', (ctx) => {
            clearConnectingTimeout();
            state.isConnecting = false;
            state.isConnected = true;
            state.reconnectAttempt = 0;
            utils.log('INFO', 'Uspešno povezan na Kick Realtime WebSocket (Centrifugo)!');

            startTokenRotation();
            startLivenessWatchdog();

            for (const chatroomId of Object.keys(state.channels)) {
                pretplatiNaChatroom(chatroomId);
            }
        });

        state.centrifuge.on('disconnected', (ctx) => {
            clearConnectingTimeout();
            state.isConnecting = false;
            state.isConnected = false;
            stopTokenRotation();
            utils.log('WARN', `Kick Realtime konekcija zatvorena. Kod: ${ctx.code}, Razlog: ${ctx.reason || 'nema'}`);

            if (state.isShuttingDown) return;

            // Kodovi 3500-3999 (npr. 3500 invalid token) i 4200/4201 su terminalni za Centrifuge
            // Centrifuge na njima gasi interni reconnect, pa uvek pokrećemo naš robustni reconnect mehanizam
            const isTerminalError = ctx.code === 3500 || ctx.code === 3502 || ctx.code === 4200 || ctx.code === 4201;
            scheduleReconnect(isTerminalError);
        });

        state.centrifuge.on('error', (ctx) => {
            clearConnectingTimeout();
            state.isConnecting = false;
            utils.log('ERR', `Kick Realtime greška: ${ctx.error?.message || ctx.error}`);
            if (!state.isConnected && !state.reconnectTimer && !state.isShuttingDown) {
                scheduleReconnect();
            }
        });

        state.centrifuge.connect();
    } catch (err) {
        clearConnectingTimeout();
        state.isConnecting = false;
        state.isConnected = false;
        stopTokenRotation();
        utils.log('ERR', `Neuspešno pokretanje Kick Realtime klijenta: ${err.message}`);
        scheduleReconnect();
    }
}

function prekiniKonekciju() {
    stopHeartbeat();
    stopTokenRotation();
    stopLivenessWatchdog();
    clearConnectingTimeout();
    if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
    }
    if (state.centrifuge) {
        try {
            state.centrifuge.removeAllListeners();
            state.centrifuge.disconnect();
        } catch (_) {}
        state.centrifuge = null;
    }
    if (state.ws) {
        try {
            state.ws.removeAllListeners();
            state.ws.terminate();
        } catch (_) {}
        state.ws = null;
    }
    state.isConnected = false;
    state.isConnecting = false;
}

module.exports = {
    processedMessageCache,
    isDuplicateMessage,
    povezi,
    scheduleReconnect,
    startHeartbeat,
    stopHeartbeat,
    startTokenRotation,
    stopTokenRotation,
    startLivenessWatchdog,
    stopLivenessWatchdog,
    clearConnectingTimeout,
    prekiniKonekciju,
    obradiPusherPoruku,
    obradiRealtimePoruku,
    pretplatiNaChatroom,
    otkaziPretplatu,
    getRealtimeToken
};
