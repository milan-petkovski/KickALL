// WebSocket / Pusher konekcija ka Kick servisima, deduplikacija događaja i distribucija

const WebSocket = require('ws');
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

function scheduleReconnect(immediate = false) {
    if (state.isShuttingDown) return;

    if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
    }

    if (immediate) {
        state.reconnectAttempt = 0;
        utils.log('INFO', 'Hitna rekonekcija na WebSocket (kod 4200/4201) za 0.5s...');
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
        response = JSON.parse(data);
    } catch {
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

        const prefix = channelState.PREFIX || '!';
        const startsWithPrefix = poruka.startsWith(prefix);

        // Ako je automatska poruka od samog bota (i nije komanda), preskačemo da izbegnemo petlje
        if (isBotMsg && !startsWithPrefix) {
            return;
        }
        if (botKey && userKey === botKey && !startsWithPrefix) {
            return;
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

        // Anti-spam filter (izuzimamo strimera)
        if (userKey !== channelState.channelUsername.toLowerCase() && spam.spamFilter(chatroomId, username, poruka)) {
            if (messageId) messenger.obrisiPoruku(chatroomId, messageId);
            return;
        }

        // Ako poruka počinje sa prefiksom i posle njega ima razmak (npr. "! komanda"), spoj ih
        let porukaSredjena = poruka;
        if (startsWithPrefix) {
            const ostatak = poruka.slice(prefix.length).trim();
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

        // Auto-announce brojač po broju poruka
        if (channelState.isStreamLive && channelState.announce_msg_enabled && userKey !== channelState.channelUsername.toLowerCase()) {
            channelState.porukePosleAnnounce++;
            if (channelState.porukePosleAnnounce >= (channelState.announce_message_threshold || 30)) {
                const sada = Date.now();
                const minGapMs = 5 * 60 * 1000;
                if (sada - channelState.zadnjaAutoPorukaTs >= minGapMs) {
                    channelManager.triggerAutoAnnounce(chatroomId);
                }
            }
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

function povezi() {
    if (state.isShuttingDown) {
        utils.log('WARN', 'Gašenje u toku — preskačem ponovno povezivanje na WebSocket.');
        return;
    }

    if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
    }

    if (state.isConnecting) {
        utils.log('INFO', 'Konekcija na WebSocket je već u toku — preskačem duplirani poziv.');
        return;
    }
    state.isConnecting = true;

    if (state.ws) {
        try {
            state.ws.removeAllListeners();
            if (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING) {
                state.ws.terminate();
            }
        } catch (_) {}
        state.ws = null;
    }

    utils.log('INFO', 'Povezujem se na Kick Pusher WebSocket...');
    const pusherUrl = config.PUSHER_URL || 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.5.0&flash=false';
    state.ws = new WebSocket(pusherUrl);

    state.ws.on('open', () => {
        state.isConnecting = false;
        state.isConnected = true;
        state.reconnectAttempt = 0;
        utils.log('INFO', 'Uspešno povezan na Kick Pusher!');

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

    state.ws.on('message', obradiPusherPoruku);

    state.ws.on('close', (kod, razlog) => {
        state.isConnecting = false;
        state.isConnected = false;
        stopHeartbeat();
        utils.log('WARN', `WebSocket konekcija zatvorena. Kod: ${kod}, Razlog: ${razlog || 'nema'}`);
        const isImmediate = kod === 4200 || kod === 4201 || kod === 4202;
        scheduleReconnect(isImmediate);
    });

    state.ws.on('error', (greska) => {
        state.isConnecting = false;
        const isTransient = greska.code === 'ECONNRESET' ||
                            greska.code === 'ETIMEDOUT' ||
                            greska.code === 'EPIPE' ||
                            (greska.message && greska.message.includes('ECONNRESET'));
        if (isTransient) {
            utils.log('WARN', `WebSocket prolazni prekid veze (${greska.code || 'ECONNRESET'}): ${greska.message}`);
        } else {
            utils.log('ERR', `WebSocket greška: ${greska.message}`);
        }
    });
}

function prekiniKonekciju() {
    stopHeartbeat();
    if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
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
    prekiniKonekciju,
    obradiPusherPoruku
};
