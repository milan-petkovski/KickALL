// Modul za upravljanje životnim ciklusom kanala, live statusom, auto-najavama i pretplatama

const WebSocket = require('ws');
const config = require('./config');
const state = require('./state');
const utils = require('./utils');
const database = require('./database');
const messenger = require('./messenger');
const watchtime = require('./watchtime');
const streamAnalytics = require('./streamAnalytics');

let botUsernameResolved = config.BOT_USERNAME || 'kickot';

function setBotUsername(name) {
    if (name) botUsernameResolved = name;
}

function getBotUsername() {
    return botUsernameResolved;
}

// Provera statusa strima
async function proveriDaLiJeLive(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const channelUsername = channelState.channelUsername;
    const realId = channelState.realChatroomId || chatroomId;

    try {
        const res = await utils.fetchKickAPI(`https://kick.com/api/v2/channels/${channelUsername}`);
        if (res.ok) {
            const data = await res.json();
            const liveState = !!data.livestream;

            channelState.isModerator = true; // Uvek dozvoli bota da radi

            if (database.KORISTI_SUPABASE && database.supabase) {
                try {
                    await database.supabase
                        .from('channels')
                        .upsert({
                            id: realId,
                            username: channelUsername,
                            is_active: liveState,
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'id' });
                } catch (dbErr) {
                    utils.log('ERR', `[${channelUsername}] Greška pri upisu statusa strima u bazu: ${dbErr.message}`);
                }
            }

            if (liveState && data.livestream) {
                try {
                    await streamAnalytics.onStreamLive(chatroomId, channelUsername, data.livestream, channelState.userId);
                    streamAnalytics.recordViewerCount(chatroomId, data.livestream.viewer_count || 0);
                } catch (saErr) {
                    utils.log('WARN', `[${channelUsername}] Greška u streamAnalytics.onStreamLive: ${saErr.message}`);
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
                    try {
                        await streamAnalytics.onStreamOffline(chatroomId, channelUsername);
                    } catch (saOffErr) {
                        utils.log('WARN', `[${channelUsername}] Greška u streamAnalytics.onStreamOffline: ${saOffErr.message}`);
                    }
                    watchtime.ocistiAktivneGledaoce(chatroomId);
                    channelState.welcomedUsers.clear(); // Očisti pozdravljene korisnike za sledeći stream
                    channelState.porukePosleAnnounce = 0; // Resetuj brojač za "broj poruka" pravilo za sledeći stream
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
// Mutex guard: sprečava race condition ako se isti kanal pokušava
// pokrenuti/zaustaviti više puta pre nego što prva operacija završi.
const pendingChannelOps = new Map();

async function pokreniKanal(chatroomId, channelUsername, dbConfig) {
    // Ako je operacija za ovaj kanal već u toku, čekamo da završi.
    if (pendingChannelOps.has(chatroomId)) {
        await pendingChannelOps.get(chatroomId);
    }

    let resolve;
    const guard = new Promise(r => { resolve = r; });
    pendingChannelOps.set(chatroomId, guard);

    try {
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
                    if (realChatroomId !== String(chatroomId)) {
                        database.syncChatroomId(channelUsername, realChatroomId).catch(err => {
                            utils.log('ERR', `[${channelUsername}] Neuspešna sinhronizacija chatroom ID-ja: ${err.message}`);
                        });
                    }
                }
            }
        } catch (e) {
            utils.log('ERR', `[${channelUsername}] Greška pri pronalaženju pravog chatroom ID-ja: ${e.message}`);
        }
        channelState.realChatroomId = realChatroomId;

        // Primenjujemo konfiguraciju iz baze uz prolinkovani plan
        await azurirajKonfiguracijuKanala(channelState, dbConfig);

        // Učitavamo in-memory podatke za ovaj kanal paralelno radi bržeg pokretanja
        await Promise.allSettled([
            database.ucitajLeaderboard(chatroomId),
            database.ucitajEkonomiju(chatroomId),
            database.ucitajLjubav(chatroomId),
            database.ucitajCustomKomande(chatroomId),
            watchtime.ucitajWatchtime(chatroomId)
        ]);

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
    } finally {
        resolve();
        pendingChannelOps.delete(chatroomId);
    }
}

async function zaustaviKanal(chatroomId) {
    // Ako je operacija za ovaj kanal već u toku, čekamo da završi.
    if (pendingChannelOps.has(chatroomId)) {
        await pendingChannelOps.get(chatroomId);
    }

    let resolve;
    const guard = new Promise(r => { resolve = r; });
    pendingChannelOps.set(chatroomId, guard);

    try {
        const channelState = state.channels[chatroomId];
        if (!channelState) return;

        const displayName = channelState.channelUsername || chatroomId;
        utils.log('INFO', `Zaustavljam rad na kanalu: @${displayName} (ID: ${chatroomId})...`);

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
        if (channelState.commandUsageDeltas && Object.keys(channelState.commandUsageDeltas).length > 0) {
            await database.sacuvajCommandUsage(chatroomId);
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
    } finally {
        resolve();
        pendingChannelOps.delete(chatroomId);
    }
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
    await database.ucitajAlerts(dbConfig.channel_id);

    channelState.feature_leaderboard = limits.allowLeaderboard && (dbConfig.feature_leaderboard ?? true);
    channelState.feature_watchtime = limits.allowWatchtime && (dbConfig.feature_watchtime ?? true);
    channelState.feature_games = limits.allowGambling && (dbConfig.feature_games ?? true);
    channelState.feature_love = limits.allowLove && (dbConfig.feature_love ?? true);
    channelState.feature_moderation = limits.allowAdvancedModeration && (dbConfig.feature_moderation ?? false);
    channelState.feature_autoresponse = dbConfig.feature_autoresponse ?? true;
    channelState.feature_songrequest = limits.allowSongRequest && (dbConfig.feature_songrequest ?? false);
    channelState.songrequest_settings = dbConfig.songrequest_settings || {};
    channelState.botActive = dbConfig.bot_active || false;

    await database.ucitajAutoAnnounces(dbConfig.channel_id);

    channelState.announce_interval_mins = dbConfig.announce_interval_mins ?? 15;
    channelState.announce_message_threshold = dbConfig.announce_message_threshold ?? 10;
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
    // Kolone u bazi su `points_daily_streak` i `points_per_raid` (vidi database.js ucitajBotConfig)
    channelState.daily_streak_bonus = dbConfig.points_daily_streak ?? 150;
    channelState.host_raid_bonus = dbConfig.points_per_raid ?? 300;

    const maxStoreItems = channelState.userPlan === 'free' ? 10 : (channelState.userPlan === 'pro' ? 50 : 999999);
    const rawStore = Array.isArray(dbConfig.store_items) ? dbConfig.store_items : [];
    channelState.store_items = rawStore.slice(0, maxStoreItems);
}

// ─── BACKGROUND SUBSCRIPTION RETRY WORKER ──────────────────────────────────────
async function syncPendingSubscriptions() {
    if (!database.KORISTI_SUPABASE || !database.supabase) return;
    try {
        const { data: users, error } = await database.supabase
            .from('user_profiles')
            .select('id, plan, plan_tier, subscription_status');

        if (error || !users) return;

        for (const user of users) {
            for (const chatroomId of Object.keys(state.channels)) {
                const chState = state.channels[chatroomId];
                if (chState && chState.userId === user.id) {
                    const expectedPlan = (user.plan_tier || user.plan || 'free').toLowerCase();
                    if (chState.userPlan !== expectedPlan) {
                        utils.log('INFO', `[RETRY-SYNC] Osvežavam plan za korisnika ${user.id} (@${chState.channelUsername}): ${chState.userPlan} -> ${expectedPlan}`);
                        await database.ucitajUserPlan(user.id, chatroomId);
                        await database.ucitajCustomKomande(chatroomId);
                    }
                }
            }
        }
        // 2. Sravnjivanje zaostalih uplata iz Dead Letter Queue tabele
        const { data: dlqItems, error: dlqErr } = await database.supabase
            .from('payment_dead_letter_queue')
            .select('*')
            .eq('status', 'pending_bot_sync');

        if (!dlqErr && dlqItems && dlqItems.length > 0) {
            for (const dlq of dlqItems) {
                const targetUserId = dlq.user_id;
                const targetPlan = (dlq.plan || 'free').toLowerCase();
                for (const chatroomId of Object.keys(state.channels)) {
                    const chState = state.channels[chatroomId];
                    if (chState && chState.userId === targetUserId) {
                        chState.userPlan = targetPlan;
                        chState.planLimits = config.PLAN_LIMITS[targetPlan] || config.PLAN_LIMITS.free;
                        await database.ucitajCustomKomande(chatroomId);
                        utils.log('INFO', `[DLQ-RESOLVED] Automatski aktiviran plan ${targetPlan} iz Dead Letter Queue za korisnika ${targetUserId} na kanalu @${chState.channelUsername}`);
                    }
                }
                // Označi zapis u DLQ kao razrešen
                await database.supabase
                    .from('payment_dead_letter_queue')
                    .update({
                        status: 'resolved',
                        resolved_at: new Date().toISOString()
                    })
                    .eq('id', dlq.id);
            }
        }
    } catch (e) {
        utils.log('WARN', `[RETRY-SYNC] Neuspešan periodični sync pretplata: ${e.message}`);
    }
}

module.exports = {
    pendingChannelOps,
    setBotUsername,
    getBotUsername,
    proveriDaLiJeLive,
    proveriDaLiSuLiveSvi,
    triggerAutoAnnounce,
    pokreniAutoAnnounceTajmer,
    pokreniKanal,
    zaustaviKanal,
    azurirajKonfiguracijuKanala,
    syncPendingSubscriptions
};
