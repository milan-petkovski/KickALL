require('dotenv').config();

// Uvoz konfiguracije i stanja
const config = require('./src/config');
const state = require('./src/state');
const utils = require('./src/utils');
const database = require('./src/database');
const kickAuth = require('./src/kickAuth');
const watchtime = require('./src/watchtime');
const streamAnalytics = require('./src/streamAnalytics');

// Uvoz modularizovanih podsistema
const channelManager = require('./src/channelManager');
const connection = require('./src/connection');
const httpServer = require('./src/httpServer');

// Inicijalizacija i automatska provera Kick OAuth tokena
(async () => {
    try {
        const konfigurisano = await kickAuth.proveriKonfiguraciju();
        if (konfigurisano) {
            kickAuth.zakaziAutoOsvezavanje();
            utils.log('INFO', '[AUTH] Kick OAuth tokeni pronađeni u Supabase, automatsko osvežavanje je aktivno. Bot koristi zvanični Public API za slanje poruka.');
        } else {
            utils.log('ERR', '[AUTH] Kick OAuth tokeni nisu pronađeni u Supabase (bot_kick_tokens). Ulogujte bota preko: node scripts/kick-login.js');
        }
    } catch (err) {
        utils.log('ERR', `[AUTH] Provera Kick OAuth tokena pri startu nije uspela: ${err.message}`);
    }
})();

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
                channelManager.setBotUsername(data.username);
                utils.log('INFO', `Detektovano korisničko ime bota preko API-ja: @${data.username}`);
            }
        }
    } catch (err) {
        utils.log('WARN', `Greška pri detekciji korisničkog ime bota: ${err.message}`);
    }
}

// ─── MEMORY CLEANUP WORKER (Svakih 10 minuta) ──────────────────────────────────
state.memoryCleanupTimer = setInterval(() => {
    const sada = Date.now();
    for (const chatroomId of Object.keys(state.channels)) {
        const channelState = state.channels[chatroomId];

        // 1. Spam & Rapid tracker
        for (const key in channelState.spamTracker) {
            channelState.spamTracker[key] = channelState.spamTracker[key].filter(t => sada - t < (channelState.SPAM_WINDOW_MS || 15000));
            if (channelState.spamTracker[key].length === 0) delete channelState.spamTracker[key];
        }
        for (const key in channelState.rapidTracker) {
            channelState.rapidTracker[key] = channelState.rapidTracker[key].filter(t => sada - t < 8000);
            if (channelState.rapidTracker[key].length === 0) delete channelState.rapidTracker[key];
        }

        // 2. Cooldowns čišćenje (istekli cooldown-i)
        for (const cmd in channelState.cooldowns) {
            if (channelState.cooldowns[cmd] && channelState.cooldowns[cmd] < sada) {
                delete channelState.cooldowns[cmd];
            }
        }

        // 3. Last warned & love/hate cooldowns stariji od 1h/24h
        for (const user in channelState.lastWarned) {
            if (sada - channelState.lastWarned[user] > 3600000) delete channelState.lastWarned[user];
        }
        for (const user in channelState.loveHateCooldowns) {
            if (sada - channelState.loveHateCooldowns[user] > 86400000) delete channelState.loveHateCooldowns[user];
        }

        // 4. Bounded Set za welcomedUsers
        if (channelState.welcomedUsers && channelState.welcomedUsers.size > 2000) {
            channelState.welcomedUsers.clear();
        }

        // 5. Warnings count i permits
        if (channelState.warningsCount) {
            for (const [user, data] of channelState.warningsCount.entries()) {
                if (data && data.timestamp && (sada - data.timestamp > 86400000)) channelState.warningsCount.delete(user);
            }
        }
        if (channelState.permits) {
            for (const [user, expiry] of channelState.permits.entries()) {
                if (expiry && expiry < sada) channelState.permits.delete(user);
            }
        }

        // 6. Duplicate tracker
        if (channelState.duplicateTracker) {
            for (const [user, data] of channelState.duplicateTracker.entries()) {
                if (data && data.timestamp && (sada - data.timestamp > 3600000)) channelState.duplicateTracker.delete(user);
            }
        }

        // 7. Watchtime last seen
        for (const user in channelState.watchtimeLastSeen) {
            if (sada - channelState.watchtimeLastSeen[user] > 1800000) delete channelState.watchtimeLastSeen[user];
        }

        // 8. Pending duels i proposals
        for (const duelId in channelState.pendingDuels) {
            if (channelState.pendingDuels[duelId]?.created_at && (sada - channelState.pendingDuels[duelId].created_at > 300000)) {
                delete channelState.pendingDuels[duelId];
            }
        }
        for (const propId in channelState.pendingProposals) {
            if (channelState.pendingProposals[propId]?.created_at && (sada - channelState.pendingProposals[propId].created_at > 300000)) {
                delete channelState.pendingProposals[propId];
            }
        }
    }

    // 9. Čišćenje globalnog deduplication keša poruka
    if (connection.processedMessageCache.size > 2000) {
        const threshold = sada - 60000;
        for (const [msgId, ts] of connection.processedMessageCache.entries()) {
            if (ts < threshold) connection.processedMessageCache.delete(msgId);
        }
    }
}, 10 * 60 * 1000).unref();

// ─── DISTRIBUTED LOCK & LEADER ELECTION ───────────────────────────────────────
const CLUSTER_LOCK_ID = 'primary_bot_leader';
const LEASE_DURATION_MS = 60000;
const HEARTBEAT_INTERVAL_MS = 15000;
const STARTUP_LOCK_WAIT_TIMEOUT_MS = 25000;
const STARTUP_LOCK_RETRY_INTERVAL_MS = 2500;

let lastLockErrorLogTime = 0;
let consecutiveLockErrors = 0;

function logLockWarningDebounced(msg) {
    consecutiveLockErrors++;
    const now = Date.now();
    // Ne spamuj konzolu: loguj samo ako je greška nova i traje, najviše jednom u 5 minuta
    if (now - lastLockErrorLogTime > 5 * 60 * 1000 || consecutiveLockErrors === 3) {
        lastLockErrorLogTime = now;
        utils.log('WARN', `[DISTRIBUTED-LOCK] ${msg} (ponovljeno ${consecutiveLockErrors}x)`);
    }
}

function resetLockErrorCount() {
    if (consecutiveLockErrors >= 3) {
        utils.log('INFO', `[DISTRIBUTED-LOCK] Veza sa cluster lock bazom uspešno stabilizovana.`);
    }
    consecutiveLockErrors = 0;
}

async function acquireOrRenewLeaderLock(options = {}) {
    if (!database.supabase || !database.KORISTI_SUPABASE) {
        state.isLeader = true;
        return true;
    }
    if (state.isShuttingDown) return false;

    const nowIso = new Date().toISOString();
    const expiresAtIso = new Date(Date.now() + LEASE_DURATION_MS).toISOString();

    try {
        const { data: existingLock, error: readError } = await database.supabase
            .from('bot_cluster_lock')
            .select('*')
            .eq('lock_id', CLUSTER_LOCK_ID)
            .maybeSingle();

        if (readError) {
            logLockWarningDebounced(`Greška čitanja cluster lock-a: ${readError.message}`);
            return state.isLeader;
        }

        if (!existingLock) {
            const { error: insertError } = await database.supabase
                .from('bot_cluster_lock')
                .insert({
                    lock_id: CLUSTER_LOCK_ID,
                    leader_instance_id: state.instanceId,
                    heartbeat_at: nowIso,
                    expires_at: expiresAtIso,
                    updated_at: nowIso
                });
            if (insertError) {
                logLockWarningDebounced(`Greška pri kreiranju lock-a: ${insertError.message}`);
                return false;
            }
            resetLockErrorCount();
            state.isLeader = true;
            utils.log('INFO', `[DISTRIBUTED-LOCK] Osvojen primarni distributed lock (Instance ID: ${state.instanceId})`);
            return true;
        }

        const isCurrentHolder = existingLock.leader_instance_id === state.instanceId;
        const isExpired = new Date(existingLock.expires_at).getTime() <= Date.now();

        if (isCurrentHolder || isExpired || options.force) {
            const { error: updateError } = await database.supabase
                .from('bot_cluster_lock')
                .update({
                    leader_instance_id: state.instanceId,
                    heartbeat_at: nowIso,
                    expires_at: expiresAtIso,
                    updated_at: nowIso
                })
                .eq('lock_id', CLUSTER_LOCK_ID);

            if (updateError) {
                logLockWarningDebounced(`Greška pri obnovi lock-a: ${updateError.message}`);
                return false;
            }
            resetLockErrorCount();
            if (!state.isLeader) {
                utils.log('INFO', `[DISTRIBUTED-LOCK] Preuzet primarni distributed lock (Instance ID: ${state.instanceId})`);
            }
            state.isLeader = true;
            return true;
        }

        // Ako je instanca već bila aktivan lider, a neko drugi je u međuvremenu preuzeo lock:
        if (state.isLeader) {
            utils.log('WARN', `[DISTRIBUTED-LOCK] Druga instanca (${existingLock.leader_instance_id}) drži aktivan lease do ${existingLock.expires_at}. Prepuštam vođstvo radi prevencije split-brain-a.`);
            state.isLeader = false;
            gracefulShutdown('SPLIT_BRAIN_LEASE_LOST');
            return false;
        }

        // Ako proces tek startuje i nije još lider, ne gasi proces već vrati false (kandidat čeka istek)
        return false;
    } catch (err) {
        logLockWarningDebounced(`Izuzetak pri obradi lock-a: ${err.message}`);
        return state.isLeader;
    }
}

function startLeaderLockHeartbeat() {
    if (state.leaderLockTimer) clearInterval(state.leaderLockTimer);
    state.leaderLockTimer = setInterval(async () => {
        await acquireOrRenewLeaderLock();
    }, HEARTBEAT_INTERVAL_MS);
    if (state.leaderLockTimer && state.leaderLockTimer.unref) {
        state.leaderLockTimer.unref();
    }
}

function setupClusterBroadcast() {
    if (!database.supabase || typeof database.supabase.channel !== 'function') return null;
    try {
        const clusterChannel = database.supabase.channel('kickall-cluster-control');
        clusterChannel
            .on('broadcast', { event: 'instance_takeover' }, payload => {
                const newInstanceId = payload.payload?.instanceId;
                if (newInstanceId && newInstanceId !== state.instanceId && !state.isShuttingDown) {
                    utils.log('WARN', `[SPLIT-BRAIN ZAŠTITA] Nova instanca (${newInstanceId}) preuzima vođstvo. Prepuštam lock i pokrećem graceful shutdown.`);
                    gracefulShutdown('SPLIT_BRAIN_TAKEOVER');
                }
            })
            .subscribe(status => {
                if (status === 'SUBSCRIBED') {
                    clusterChannel.send({
                        type: 'broadcast',
                        event: 'instance_takeover',
                        payload: { instanceId: state.instanceId, timestamp: Date.now() }
                    }).catch(() => {});
                }
            });
        return clusterChannel;
    } catch (_) {
        return null;
    }
}

async function acquireStartupLeadership() {
    state.instanceId = state.instanceId || require('crypto').randomUUID();
    state.isLeader = false;

    if (!database.supabase || !database.KORISTI_SUPABASE) {
        state.isLeader = true;
        utils.log('INFO', `[LEADER-ELECTION] Supabase nije konfigurisan; instanca radi kao primarni bot (Instance ID: ${state.instanceId})`);
        return true;
    }

    setupClusterBroadcast();

    utils.log('INFO', `[LEADER-ELECTION] Provera statusa distributed lock-a (Instance ID: ${state.instanceId})...`);
    let acquired = await acquireOrRenewLeaderLock();
    if (acquired) {
        startLeaderLockHeartbeat();
        utils.log('INFO', `[LEADER-ELECTION] Bot instanca je uspešno postala primarni lider (Instance ID: ${state.instanceId})`);
        return true;
    }

    // Prethodna instanca još uvek drži lease (npr. Render rolling deploy ili nedavni restart)
    const startTime = Date.now();
    utils.log('INFO', `[LEADER-ELECTION] Prethodna instanca još uvek drži lease. Čekam prenos vođstva (do ${STARTUP_LOCK_WAIT_TIMEOUT_MS / 1000}s)...`);

    while (Date.now() - startTime < STARTUP_LOCK_WAIT_TIMEOUT_MS) {
        await new Promise(r => setTimeout(r, STARTUP_LOCK_RETRY_INTERVAL_MS));
        if (state.isShuttingDown) return false;

        acquired = await acquireOrRenewLeaderLock();
        if (acquired) {
            startLeaderLockHeartbeat();
            utils.log('INFO', `[LEADER-ELECTION] Uspešno preuzet distributed lock nakon čekanja (Instance ID: ${state.instanceId})`);
            return true;
        }
    }

    // Istekao maksimalan prozor za čekanje – nova instanca deploy-a preuzima lock autoritativno
    utils.log('WARN', `[LEADER-ELECTION] Prethodna instanca nije oslobodila lease u predviđenom roku. Preuzimam primarni lock automatski...`);
    acquired = await acquireOrRenewLeaderLock({ force: true });
    startLeaderLockHeartbeat();
    utils.log('INFO', `[LEADER-ELECTION] Bot instanca je autoritativno preuzela vođstvo (Instance ID: ${state.instanceId})`);
    return true;
}

// ─── START WORKFLOW ───────────────────────────────────────────────────────────
async function start() {
    utils.log('INFO', 'Multi-channel Kick bot se pokreće...');
    await detectBotUsername();
    await acquireStartupLeadership();

    if (database.KORISTI_SUPABASE && database.supabase) {
        // 1. Učitaj sve kanale koji imaju aktivnog bota
        const aktivniKanali = await database.ucitajSveAktivneKanale();
        utils.log('INFO', `Pronađeno ${aktivniKanali.length} aktivnih kanala u bazi.`);

        // 2. Pokreni i učitaj svaki od njih paralelno
        for (const dbConfig of aktivniKanali) {
            const chatroomId = String(dbConfig.channel_id);
            const channelUsername = dbConfig.channel_name || 'Nepoznat';
            try {
                await channelManager.pokreniKanal(chatroomId, channelUsername, dbConfig);
            } catch (err) {
                utils.log('ERR', `Greška pri pokretanju kanala @${channelUsername}: ${err.message}`);
            }
        }

        // 3. Pokreni globalne watchtime tick cikluse
        watchtime.pokreniWatchtimeTick();

        // 3b. Sinhronizuj pending pretplate iz Supabase baze
        await channelManager.syncPendingSubscriptions();
        state.syncSubscriptionsTimer = setInterval(channelManager.syncPendingSubscriptions, 3 * 60 * 1000);
        if (state.syncSubscriptionsTimer && state.syncSubscriptionsTimer.unref) state.syncSubscriptionsTimer.unref();

        // 4. Poveži WebSocket na Kick Pusher
        connection.povezi();

        // 5. Pokreni periodičnu proaktivnu proveru live statusa
        state.checkLiveTimer = setInterval(channelManager.proveriDaLiSuLiveSvi, 2 * 60 * 1000);
        if (state.checkLiveTimer && state.checkLiveTimer.unref) state.checkLiveTimer.unref();

        // 5b. Pokreni periodičnu normalizaciju ljubavnih modifikatora ka 0% (svakih 2h po 1%)
        state.loveNormalizationTimer = setInterval(() => {
            try {
                database.normalizujLjubavKaNuli();
            } catch (err) {
                utils.log('ERR', `Greška pri normalizaciji ljubavi: ${err.message}`);
            }
        }, 2 * 60 * 60 * 1000);
        if (state.loveNormalizationTimer && state.loveNormalizationTimer.unref) state.loveNormalizationTimer.unref();

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

        const realtimeBotConfigDebounceTimers = state.realtimeBotConfigDebounceTimers || new Map();

        database.supabase.channel('public:bot_config')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'bot_config'
            }, (payload) => {
                const { eventType, new: newRow, old: oldRow } = payload;
                const row = newRow || oldRow;
                if (!row || !row.channel_id) return;
                const chatroomId = String(row.channel_id);

                if (realtimeBotConfigDebounceTimers.has(chatroomId)) {
                    clearTimeout(realtimeBotConfigDebounceTimers.get(chatroomId));
                }

                const timer = setTimeout(async () => {
                    realtimeBotConfigDebounceTimers.delete(chatroomId);
                    try {
                        if (eventType === 'DELETE') {
                            if (state.channels[chatroomId]) {
                                utils.log('INFO', `[REALTIME] Kanal @${oldRow.channel_name || chatroomId} je uklonjen iz bot konfiguracije.`);
                                await channelManager.zaustaviKanal(chatroomId);
                            }
                        } else {
                            const channelUsername = newRow.channel_name || 'Nepoznat';
                            const botActive = newRow.bot_active || false;

                            if (botActive) {
                                if (!state.channels[chatroomId] && !channelManager.pendingChannelOps.has(chatroomId)) {
                                    utils.log('INFO', `[REALTIME] Bot je uspešno aktiviran za kanal @${channelUsername}!`);
                                    await channelManager.pokreniKanal(chatroomId, channelUsername, newRow);
                                } else if (state.channels[chatroomId]) {
                                    logDebouncedUpdate(`config::${chatroomId}`, `[REALTIME] Podešavanja i komande sinhronizovane za @${channelUsername}.`);
                                    await channelManager.azurirajKonfiguracijuKanala(state.channels[chatroomId], newRow);
                                }
                            } else {
                                if (state.channels[chatroomId]) {
                                    utils.log('INFO', `[REALTIME] Bot je deaktiviran za kanal @${channelUsername}.`);
                                    await channelManager.zaustaviKanal(chatroomId);
                                }
                            }
                        }
                    } catch (err) {
                        utils.log('ERR', `Greška pri obradi Realtime promene za kanal ${chatroomId}: ${err.message}`);
                    }
                }, 1500);

                realtimeBotConfigDebounceTimers.set(chatroomId, timer);
            })
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'chat_alerts'
            }, async (payload) => {
                const { new: newRow, old: oldRow } = payload;
                const row = newRow || oldRow;
                if (row) {
                    const chatroomId = String(row.channel_id);
                    if (state.channels[chatroomId]) {
                        logDebouncedUpdate(`chat_alerts::${chatroomId}`, `[REALTIME] Alertovi osveženi za kanal.`);
                        await database.ucitajAlerts(chatroomId);
                    }
                }
            })
            .subscribe();

        // 8. Osluškuj izmene korisničkih profila
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

        // 9. Pokreni Supabase Realtime CDC sinhronizaciju
        database.postaviRealtimeSlusalac();
    }
}

// ─── SHUTDOWN & CLEANUP ───────────────────────────────────────────────────────
let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        utils.log('WARN', `Shutdown je već u toku (stigao signal ${signal}). Preskačem višestruko gašenje.`);
        return;
    }
    isShuttingDown = true;
    state.isShuttingDown = true;
    state.isLeader = false;

    utils.log('WARN', `Primljen signal ${signal}. Pokrećem bezbedno gašenje bota i sinhronizaciju podataka sa Supabase...`);

    // 0. Otpusti distributed lock odmah u bazi kako bi nova instanca bez odlaganja preuzela vođstvo
    if (database.supabase && database.KORISTI_SUPABASE && state.instanceId) {
        try {
            await database.supabase
                .from('bot_cluster_lock')
                .update({ expires_at: new Date().toISOString() })
                .eq('lock_id', CLUSTER_LOCK_ID)
                .eq('leader_instance_id', state.instanceId);
        } catch (_) {}
    }

    const watchdogTimer = setTimeout(() => {
        utils.log('ERR', 'Graceful shutdown timeout (10s) istekao. Nasilno gašenje procesa.');
        process.exit(1);
    }, 10000);
    if (watchdogTimer.unref) watchdogTimer.unref();

    // 1. Prekini WebSocket konekciju
    connection.prekiniKonekciju();

    // 2. Zaustavi HTTP server
    httpServer.zaustaviServer();

    // 3. Zaustavi globalne tajmere i procese
    watchtime.zaustavljWatchtimeTick();
    if (state.leaderLockTimer) { clearInterval(state.leaderLockTimer); state.leaderLockTimer = null; }
    if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
    if (state.memoryCleanupTimer) { clearInterval(state.memoryCleanupTimer); state.memoryCleanupTimer = null; }
    if (state.syncSubscriptionsTimer) { clearInterval(state.syncSubscriptionsTimer); state.syncSubscriptionsTimer = null; }
    if (state.checkLiveTimer) { clearInterval(state.checkLiveTimer); state.checkLiveTimer = null; }
    if (state.loveNormalizationTimer) { clearInterval(state.loveNormalizationTimer); state.loveNormalizationTimer = null; }

    if (state.realtimeBotConfigDebounceTimers) {
        for (const t of state.realtimeBotConfigDebounceTimers.values()) {
            clearTimeout(t);
        }
        state.realtimeBotConfigDebounceTimers.clear();
    }

    database.zaustaviRealtimeSlusalac();
    streamAnalytics.stopAutoFlushTimer();

    // 4. Zaustavi tajmere po kanalima
    for (const chatroomId of Object.keys(state.channels)) {
        const channelState = state.channels[chatroomId];
        if (channelState.autoAnnounceTimer) clearInterval(channelState.autoAnnounceTimer);
        if (channelState.leaderboardSaveTimer) clearTimeout(channelState.leaderboardSaveTimer);
        if (channelState.economySaveTimer) clearTimeout(channelState.economySaveTimer);
        if (channelState.watchtimeSaveTimer) clearTimeout(channelState.watchtimeSaveTimer);
        if (channelState.loveSaveTimer) clearTimeout(channelState.loveSaveTimer);
        if (channelState.commandUsageSaveTimer) clearTimeout(channelState.commandUsageSaveTimer);
        if (channelState.queueDrainTimer) clearTimeout(channelState.queueDrainTimer);
    }

    // 5. Grupni kontrolisani upis podataka u Supabase
    const channelIds = Object.keys(state.channels);
    const BATCH_SIZE = 4;
    for (let i = 0; i < channelIds.length; i += BATCH_SIZE) {
        const batch = channelIds.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
            batch.map(async (chatroomId) => {
                try {
                    await database.sacuvajLeaderboard(chatroomId);
                    await database.sacuvajEkonomiju(chatroomId);
                    await watchtime.sacuvajWatchtime(chatroomId);
                    await database.sacuvajLjubav(chatroomId);
                    await database.sacuvajCommandUsage(chatroomId);
                } catch (e) {
                    utils.log('ERR', `Greška pri bezbednom čuvanju kanala ${chatroomId}: ${e.message}`);
                }
            })
        );
    }

    try {
        await streamAnalytics.flushAllSessions();
        utils.log('INFO', 'Stream analytics sesije uspešno sačuvane pre gašenja.');
    } catch (saFlushErr) {
        utils.log('ERR', `Greška pri čuvanju stream analytics sesija pri gašenju: ${saFlushErr.message}`);
    }

    clearTimeout(watchdogTimer);
    utils.log('INFO', 'Svi podaci bezbedno sačuvani u Supabase. Bot je spreman za gašenje.');
    process.exit(0);
}

// ─── PROCESS GUARDS ───────────────────────────────────────────────────────────
process.on('uncaughtException', async (err) => {
    utils.log('ERR', `Neuhvaćena greška (uncaughtException): ${err.stack || err.message}`);
    utils.log('WARN', 'Pokrećem gracefulShutdown radi bezbednog ponovnog pokretanja bota...');
    try {
        await gracefulShutdown('uncaughtException');
    } catch (shutdownErr) {
        utils.log('ERR', `Shutdown failed during uncaughtException: ${shutdownErr.message || shutdownErr}`);
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, _promise) => {
    const msg = reason instanceof Error ? reason.stack : String(reason);
    utils.log('ERR', `Neobrađeno obećanje (unhandledRejection): ${msg}`);
});

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

if (require.main === module) {
    httpServer.pokreniServer();
    start();
}

module.exports = {
    verifyInternalToken: httpServer.verifyInternalToken,
    handleHttpRequest: httpServer.handleHttpRequest,
    gracefulShutdown,
    start,
    povezi: connection.povezi,
    acquireOrRenewLeaderLock,
    acquireStartupLeadership
};