const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const state = require('./state');
const { log, dobijTrenutniMesec, sanitizeInput, isValidUsername, runWithLeaderboardLock } = require('./utils');

// Inicijalizacija Supabase klijenta
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);
const sbPanels = supabase;
// Uvek koristimo Supabase — nema lokalnih fallbackova
const KORISTI_SUPABASE = true;

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────

async function ucitajLeaderboard(chatroomId) {
    try {
        const channelState = state.getChannelState(chatroomId);
        if (!channelState) return;
        const channelUsername = channelState.channelUsername || chatroomId;
        const trenutniMesec = dobijTrenutniMesec();

        log('INFO', `[${channelUsername}] U\u010ditavam leaderboard sa Supabase baze...`);
        const { data, error } = await sbPanels
            .from('leaderboard')
            .select('username, display_name, chat')
            .eq('channel_id', chatroomId)
            .eq('month', trenutniMesec);

        if (error) throw error;

        const podaci = {};
        if (data && data.length > 0) {
            data.forEach(row => {
                podaci[row.username.toLowerCase()] = {
                    username: row.display_name,
                    count: row.chat || 0
                };
            });
        }
        channelState.leaderboard = podaci;
        channelState.leaderboardDeltas = {};
        channelState.tekuciMesecLeaderboarda = trenutniMesec;
        channelState.leaderboardDirty = false;
        log('INFO', `[${channelUsername}] U\u010ditan Supabase leaderboard za mesec: ${trenutniMesec} (${Object.keys(podaci).length} aktivnih korisnika)`);
    } catch (err) {
        log('ERR', `Gre\u0161ka pri u\u010ditavanju leaderboarda za ${chatroomId}: ${err.message}`);
        const channelState = state.getChannelState(chatroomId);
        if (channelState) {
            channelState.leaderboard = {};
            channelState.leaderboardDeltas = {};
            channelState.tekuciMesecLeaderboarda = dobijTrenutniMesec();
        }
    }
}

async function sacuvajLeaderboard(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || !channelState.leaderboardDirty) return;
    return runWithLeaderboardLock(channelState, async () => {
        try {
            const trenutniMesec = dobijTrenutniMesec();
            const dirtyKeys = Object.keys(channelState.leaderboardDeltas).filter(k => channelState.leaderboardDeltas[k] !== 0);

            if (dirtyKeys.length === 0) {
                channelState.leaderboardDirty = false;
                return;
            }

            const { data, error: fetchError } = await sbPanels
                .from('leaderboard')
                .select('username, chat, watchtime_minutes')
                .eq('channel_id', chatroomId)
                .eq('month', channelState.tekuciMesecLeaderboarda)
                .in('username', dirtyKeys);

            if (fetchError) throw fetchError;

            const dbMap = {};
            if (data) {
                data.forEach(row => {
                    dbMap[row.username.toLowerCase()] = row;
                });
            }

            const rowsToUpsert = dirtyKeys.map(key => {
                const existing = dbMap[key];
                const dbChat = existing && existing.chat !== undefined ? existing.chat : 0;
                const dbWatchtime = existing && existing.watchtime_minutes !== undefined ? existing.watchtime_minutes : ((channelState.watchtime && channelState.watchtime[key]) ? channelState.watchtime[key].minutes : 0);
                const delta = channelState.leaderboardDeltas[key];
                const newChat = Math.max(0, dbChat + delta);
                const mesecStr = channelState.tekuciMesecLeaderboarda || trenutniMesec;
                const godinaStr = mesecStr.includes('-') ? mesecStr.split('-')[1] : String(new Date().getFullYear());

                return {
                    channel_id: chatroomId,
                    username: key,
                    display_name: (channelState.leaderboard[key] && channelState.leaderboard[key].display_name) || (channelState.leaderboard[key] && channelState.leaderboard[key].username) || key,
                    chat: newChat,
                    watchtime_minutes: dbWatchtime,
                    month: mesecStr,
                    year: godinaStr,
                    updated_at: new Date().toISOString(),
                    _newChat: newChat
                };
            });

            const rowsClean = rowsToUpsert.map(({ _newChat, ...r }) => r);
            const { error: upsertError } = await sbPanels
                .from('leaderboard')
                .upsert(rowsClean, { onConflict: 'channel_id,username,month' });

            if (upsertError) throw upsertError;

            rowsToUpsert.forEach(row => {
                const key = row.username;
                if (channelState.leaderboard[key]) {
                    channelState.leaderboard[key].count = row._newChat;
                } else {
                    channelState.leaderboard[key] = {
                        username: row.display_name,
                        count: row._newChat
                    };
                }
                delete channelState.leaderboardDeltas[key];
            });

            channelState.leaderboardDirty = false;
            log('INFO', `[${channelState.channelUsername || chatroomId}] Leaderboard uspešno sačuvan na Supabase (${rowsClean.length} korisnika).`);
        } catch (err) {
            log('ERR', `Greška pri čuvanju leaderboarda za ${chatroomId}: ${err.message}`);
        }
    });
}

function proveriIResetujMesec(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const trenutniMesec = dobijTrenutniMesec();
    if (channelState.tekuciMesecLeaderboarda && channelState.tekuciMesecLeaderboarda !== trenutniMesec) {
        const stariMesec = channelState.tekuciMesecLeaderboarda;
        log('INFO', `[${channelState.channelUsername || chatroomId}] Novi mesec detektovan tokom rada bota (${stariMesec} -> ${trenutniMesec}). Resetujem leaderboard.`);

        channelState.leaderboard = {};
        channelState.leaderboardDeltas = {};
        channelState.tekuciMesecLeaderboarda = trenutniMesec;
        channelState.leaderboardDirty = false;
    }
}

function evidentirajPoruku(chatroomId, username, poruka) {
    if (!poruka || poruka.trim().length < 3) return;
    if (!isValidUsername(username)) {
        log('WARN', `Blokirano evidentiranje poruke za nevalidno korisničko ime: ${username}`);
        return;
    }

    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const cleanUsername = sanitizeInput(username);
    const key = cleanUsername.toLowerCase();
    const sada = Date.now();
    const zadnji = channelState.lastPointEarned[key] || 0;
    if (sada - zadnji < config.POINT_COOLDOWN_MS) {
        return;
    }

    proveriIResetujMesec(chatroomId);

    if (!channelState.leaderboard[key]) {
        channelState.leaderboard[key] = {
            username: cleanUsername,
            count: 0
        };
    }
    channelState.leaderboard[key].count++;
    channelState.leaderboard[key].username = cleanUsername;

    // Dodaj XP i Poene preko economy modula
    const xpPerMsg = channelState.xp_per_msg || 15;
    const pointsPerMsg = channelState.points_per_msg || 5;
    try {
        const economy = require('./economy');
        economy.dodajXP(chatroomId, cleanUsername, xpPerMsg, pointsPerMsg);
    } catch (e) {
        channelState.leaderboard[key].xp = (channelState.leaderboard[key].xp || 0) + xpPerMsg;
        channelState.leaderboard[key].points = (channelState.leaderboard[key].points || 0) + pointsPerMsg;
    }

    channelState.leaderboardDeltas[key] = (channelState.leaderboardDeltas[key] || 0) + 1;
    channelState.leaderboardDirty = true;
    channelState.lastPointEarned[key] = sada;

    if (!channelState.leaderboardSaveTimer) {
        channelState.leaderboardSaveTimer = setTimeout(() => {
            sacuvajLeaderboard(chatroomId);
            channelState.leaderboardSaveTimer = null;
        }, config.LEADERBOARD_SAVE_INTERVAL_MS);
        if (channelState.leaderboardSaveTimer && typeof channelState.leaderboardSaveTimer.unref === 'function') {
            channelState.leaderboardSaveTimer.unref();
        }
    }
}

function smanjiPoruku(chatroomId, username, iznos) {
    if (!isValidUsername(username)) return;
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const cleanUsername = sanitizeInput(username);
    const key = cleanUsername.toLowerCase();
    if (channelState.leaderboard[key]) {
        channelState.leaderboard[key].count = Math.max(0, channelState.leaderboard[key].count - iznos);
        channelState.leaderboard[key].username = cleanUsername;
        channelState.leaderboardDeltas[key] = (channelState.leaderboardDeltas[key] || 0) - iznos;
        channelState.leaderboardDirty = true;

        if (!channelState.leaderboardSaveTimer) {
            channelState.leaderboardSaveTimer = setTimeout(() => {
                sacuvajLeaderboard(chatroomId);
                channelState.leaderboardSaveTimer = null;
            }, config.LEADERBOARD_SAVE_INTERVAL_MS);
            if (channelState.leaderboardSaveTimer && typeof channelState.leaderboardSaveTimer.unref === 'function') {
                channelState.leaderboardSaveTimer.unref();
            }
        }
    }
}

// ─── LJUBAV / BRAKOVI ─────────────────────────────────────────────────────────

async function ucitajLjubav(chatroomId) {
    try {
        const channelState = state.getChannelState(chatroomId);
        if (!channelState) return;
        const channelUsername = channelState.channelUsername || chatroomId;

        log('INFO', `[${channelUsername}] U\u010ditavam ljubavne podatke sa Supabase baze (love_and_marriages)...`);

        const { data, error } = await sbPanels
            .from('love_and_marriages')
            .select('user1, user2, modifier, is_married, married_at')
            .eq('channel_id', chatroomId);

        if (error) throw error;

        if (data) {
            data.forEach(row => {
                const key = [row.user1.toLowerCase(), row.user2.toLowerCase()].sort().join('::');
                if (row.modifier !== null && row.modifier !== undefined) {
                    channelState.loveModifiers[key] = row.modifier;
                }
                if (row.is_married) {
                    channelState.marriedCouples[key] = {
                        user1: row.user1,
                        user2: row.user2,
                        datum: row.married_at ? new Date(row.married_at).toLocaleDateString('sr-RS') : '\u2014'
                    };
                }
            });
        }

        log('INFO', `[${channelUsername}] U\u010ditani ljubavni podaci sa Supabase (${Object.keys(channelState.loveModifiers).length} modifikatora, ${Object.keys(channelState.marriedCouples).length} brakova).`);
    } catch (err) {
        log('ERR', `Gre\u0161ka pri u\u010ditavanju ljubavnih podataka za ${chatroomId}: ${err.message}`);
    }
}

async function sacuvajLjubav(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || !channelState.loveDirty) return;
    try {
        const keys = new Set([
            ...Object.keys(channelState.loveModifiers),
            ...Object.keys(channelState.marriedCouples)
        ]);

        const rows = Array.from(keys).map(key => {
            const [u1, u2] = key.split('::');
            const isMarried = !!channelState.marriedCouples[key];
            return {
                channel_id: chatroomId,
                user1: u1,
                user2: u2,
                modifier: channelState.loveModifiers[key] ?? 0,
                is_married: isMarried,
                married_at: isMarried ? new Date().toISOString() : null,
                updated_at: new Date().toISOString()
            };
        });

        if (rows.length > 0) {
            const { error } = await sbPanels
                .from('love_and_marriages')
                .upsert(rows, { onConflict: 'channel_id,user1,user2' });

            if (error) throw error;
        }
        channelState.loveDirty = false;
        log('INFO', `[${channelState.channelUsername || chatroomId}] Ljubavni podaci uspešno sačuvani u love_and_marriages na Supabase.`);
    } catch (err) {
        log('ERR', `Greška pri čuvanju ljubavnih podataka za ${chatroomId}: ${err.message}`);
    }
}

function osigurajCuvanjeLjubavi(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    if (!channelState.loveSaveTimer) {
        channelState.loveSaveTimer = setTimeout(() => {
            sacuvajLjubav(chatroomId);
            channelState.loveSaveTimer = null;
        }, config.LOVE_SAVE_INTERVAL_MS);
        if (channelState.loveSaveTimer && typeof channelState.loveSaveTimer.unref === 'function') {
            channelState.loveSaveTimer.unref();
        }
    }
}

async function ucitajUserPlan(userId, chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return config.PLAN_LIMITS.free;

    if (!KORISTI_SUPABASE || !userId) {
        channelState.userPlan = 'free';
        channelState.subscriptionStatus = 'active';
        channelState.planLimits = config.PLAN_LIMITS.free;
        return config.PLAN_LIMITS.free;
    }

    try {
        const { data, error } = await supabase
            .from('user_profiles')
            .select('plan, subscription_status, ends_at, renews_at')
            .eq('id', userId)
            .maybeSingle();

        if (error) throw error;

        let rawPlan = 'free';
        let subStatus = 'active';

        if (data) {
            rawPlan = (data.plan || 'free').toLowerCase();
            subStatus = (data.subscription_status || 'active').toLowerCase();

            if (subStatus === 'expired' || (subStatus === 'cancelled' && data.ends_at && new Date(data.ends_at) < new Date())) {
                rawPlan = 'free';
            }
        }

        const planKey = (rawPlan.includes('elite') ? 'elite' : (rawPlan.includes('pro') ? 'pro' : 'free'));
        const limits = config.PLAN_LIMITS[planKey] || config.PLAN_LIMITS.free;

        channelState.userId = userId;
        channelState.userPlan = planKey;
        channelState.subscriptionStatus = subStatus;
        channelState.planLimits = limits;
        return limits;
    } catch (err) {
        log('WARN', `Greška pri učitavanju plana za korisnika ${userId}: ${err.message}`);
        channelState.userPlan = 'free';
        channelState.subscriptionStatus = 'active';
        channelState.planLimits = config.PLAN_LIMITS.free;
        return config.PLAN_LIMITS.free;
    }
}

async function ucitajCustomKomande(chatroomId) {
    try {
        if (!KORISTI_SUPABASE) return;
        const channelState = state.getChannelState(chatroomId);
        if (!channelState) return;

        const { data, error } = await sbPanels
            .from('custom_commands')
            .select('command, response, cooldown, enabled, min_rank, is_default')
            .eq('channel_id', chatroomId);

        if (error) throw error;

        channelState.customCommands = {};
        if (data) {
            const maxCmds = channelState.planLimits?.maxCustomCommands || 50;
            const enabledRows = data.filter(r => r.enabled !== false).slice(0, maxCmds);
            const disabledRows = data.filter(r => r.enabled === false);
            const limitedData = [...enabledRows, ...disabledRows];
            limitedData.forEach(row => {
                const aliases = row.command.split(',').map(c => c.trim().toLowerCase());
                aliases.forEach(alias => {
                    if (alias) {
                        const minCd = channelState.planLimits?.minCooldownMs || 1000;
                        channelState.customCommands[alias] = {
                            response: row.response,
                            cooldown: Math.max(row.cooldown || 5000, minCd),
                            min_rank: row.min_rank || 'everyone',
                            is_default: row.is_default || false,
                            enabled: row.enabled !== false
                        };
                    }
                });
            });
        }
    } catch (err) {
        log('ERR', `Greška pri učitavanju custom komandi za ${chatroomId}: ${err.message}`);
    }
}

async function ucitajAlerts(chatroomId) {
    try {
        if (!KORISTI_SUPABASE) return;
        const channelState = state.getChannelState(chatroomId);
        if (!channelState) return;

        const { data, error } = await sbPanels
            .from('bot_interaction')
            .select('alert_type, enabled, message, min_amount, min_viewers')
            .eq('channel_id', chatroomId);

        if (error) throw error;

        const alerts = {};
        (data || []).forEach(row => {
            alerts[`${row.alert_type}_enabled`] = row.enabled;
            if (row.message !== null) alerts[`${row.alert_type}_message`] = row.message;
            if (row.alert_type === 'kicks') alerts.kicks_min_amount = row.min_amount ?? 0;
            if (row.alert_type === 'host') alerts.host_min_viewers = row.min_viewers ?? 0;
        });
        channelState.alerts_settings = alerts;
    } catch (err) {
        log('ERR', `Greška pri učitavanju alertova za ${chatroomId}: ${err.message}`);
    }
}

async function ucitajAutoAnnounces(chatroomId) {
    try {
        if (!KORISTI_SUPABASE) return;
        const channelState = state.getChannelState(chatroomId);
        if (!channelState) return;

        const { data, error } = await sbPanels
            .from('auto_messages')
            .select('message, enabled, position')
            .eq('channel_id', chatroomId)
            .eq('enabled', true)
            .order('position', { ascending: true });

        if (error) throw error;

        const limits = channelState.planLimits || config.PLAN_LIMITS.free;
        const maxAnnounces = limits.maxAutoAnnounces || 2;
        const rows = Array.isArray(data) ? data : [];
        channelState.autoAnnounces = rows.slice(0, maxAnnounces).map(row => row.message);
    } catch (err) {
        log('ERR', `Greška pri učitavanju auto-najava za ${chatroomId}: ${err.message}`);
    }
}

async function ucitajBotConfig(chatroomId) {
    try {
        if (!KORISTI_SUPABASE) return;
        const channelState = state.getChannelState(chatroomId);
        if (!channelState) return;
        const _channelUsername = channelState.channelUsername || 'Nepoznat';

        const { data, error } = await supabase
            .from('bot_config')
            .select('*')
            .eq('channel_id', chatroomId)
            .maybeSingle();

        if (error) throw error;

        if (data) {
            if (data.user_id) {
                await ucitajUserPlan(data.user_id, chatroomId);
            }

            const limits = channelState.planLimits || config.PLAN_LIMITS.free;

            // Dinamički override u stanju kanala uz poštovanje limita plana
            channelState.PREFIX = data.prefix || '!';
            channelState.COOLDOWN_MS = Math.max(data.cooldown_ms ?? 3000, limits.minCooldownMs || 3000);
            channelState.SPAM_THRESHOLD = data.spam_threshold ?? 3;
            channelState.SPAM_WINDOW_MS = data.spam_window_ms ?? 15000;

            if (data.stream_pin_msg) {
                channelState.STREAM_START_PIN_MESSAGE = data.stream_pin_msg;
            } else {
                channelState.STREAM_START_PIN_MESSAGE = '';
            }

            channelState.feature_leaderboard = limits.allowLeaderboard && (data.feature_leaderboard ?? true);
            channelState.feature_watchtime = limits.allowWatchtime && (data.feature_watchtime ?? true);
            channelState.feature_games = limits.allowGambling && (data.feature_games ?? true);
            channelState.feature_love = limits.allowLove && (data.feature_love ?? true);
            channelState.feature_moderation = limits.allowAdvancedModeration && (data.feature_moderation ?? false);
            channelState.feature_autoresponse = data.feature_autoresponse ?? true;
            channelState.feature_songrequest = limits.allowSongRequest && (data.feature_songrequest ?? false);
            channelState.welcome_message = data.welcome_message || '';
            await ucitajAlerts(chatroomId);

            channelState.botActive = data.bot_active || false;

            await ucitajAutoAnnounces(chatroomId);

            channelState.announce_interval_mins = data.announce_interval_mins ?? 15;
            channelState.announce_message_threshold = data.announce_message_threshold ?? 10;
            channelState.announce_time_enabled = data.announce_time_enabled ?? true;
            channelState.announce_msg_enabled = data.announce_msg_enabled ?? true;
            
            // Učitavanje podešavanja Moderacije 100% isključivo iz `moderation` tabele
            try {
                const { data: modData } = await sbPanels
                    .from('moderation')
                    .select('settings')
                    .eq('channel_id', chatroomId)
                    .eq('type', 'config')
                    .maybeSingle();

                channelState.moderationSettings = modData?.settings || {};
            } catch (modErr) {
                channelState.moderationSettings = {};
            }
            
            // Učitavanje podešavanja mini igara isključivo iz jedinstvene tabele `mini_games`
            try {
                const { data: mgData } = await sbPanels
                    .from('mini_games')
                    .select('enabled, max_bet')
                    .eq('channel_id', chatroomId)
                    .eq('type', 'config')
                    .maybeSingle();

                channelState.max_gamble_amount = mgData?.max_bet ?? 5000;
                channelState.gamble_enabled = mgData?.enabled ?? true;
            } catch (mgErr) {
                channelState.max_gamble_amount = 5000;
                channelState.gamble_enabled = true;
            }

            // Učitavanje podešavanja Song Request panela isključivo iz tabele `song_request`
            try {
                const { data: srData } = await sbPanels
                    .from('song_request')
                    .select('*')
                    .eq('channel_id', chatroomId)
                    .eq('type', 'config')
                    .maybeSingle();

                if (srData) {
                    channelState.feature_songrequest = srData.enabled ?? false;
                    channelState.songrequest_settings = {
                        request_role: srData.request_role || 'everyone',
                        cost_points: srData.cost_points ?? 0,
                        points_price: srData.cost_points ?? 0,
                        max_duration_seconds: srData.max_duration_seconds ?? 360,
                        queue: Array.isArray(srData.queue) ? srData.queue : []
                    };
                } else {
                    channelState.feature_songrequest = false;
                    channelState.songrequest_settings = { request_role: 'everyone', cost_points: 0, points_price: 0, max_duration_seconds: 360, queue: [] };
                }
            } catch (srErr) {
                channelState.feature_songrequest = false;
                channelState.songrequest_settings = { request_role: 'everyone', cost_points: 0, points_price: 0, max_duration_seconds: 360, queue: [] };
            }

            // Učitavanje podešavanja Ranking sistema i Prodavnice 100% isključivo iz `ranking` tabele
            try {
                const { data: rankData } = await sbPanels
                    .from('ranking')
                    .select('*')
                    .eq('channel_id', chatroomId)
                    .eq('type', 'config')
                    .maybeSingle();

                if (rankData) {
                    channelState.currency_name = rankData.currency_name || 'Koins';
                    channelState.first_interaction_bonus = rankData.first_interaction_bonus ?? 100;
                    channelState.sub_multiplier = rankData.sub_multiplier ?? 2.0;
                    channelState.sub_bonus_per_msg = rankData.sub_bonus_per_msg ?? 10;
                    channelState.points_per_sub = rankData.points_per_sub ?? 1000;
                    channelState.points_per_gift_sub = rankData.points_per_gift_sub ?? 2000;
                    channelState.points_per_100_kicks = rankData.points_per_100_kicks ?? 500;
                    channelState.daily_streak_bonus = rankData.points_daily_streak ?? 150;
                    channelState.host_raid_bonus = rankData.points_per_raid ?? 300;

                    const maxStoreItems = channelState.userPlan === 'free' ? 10 : (channelState.userPlan === 'pro' ? 50 : 999999);
                    const rawStore = Array.isArray(rankData.store_items) ? rankData.store_items : [];
                    channelState.store_items = rawStore.slice(0, maxStoreItems);
                }
            } catch (rankErr) {
                log('ERR', `Greška pri učitavanju ranking podešavanja za ${chatroomId}: ${rankErr.message}`);
            }

            if (data.channel_name && data.channel_name !== channelState.channelUsername) {
                channelState.channelUsername = data.channel_name;
            }

            log('INFO', `⚙️ Bot konfiguracija sinhronizovana za @${channelState.channelUsername} (${limits.name} Plan). Prefix: '${channelState.PREFIX}', Aktivan: ${channelState.botActive}`);
        } else {
            channelState.botActive = false;
            channelState.autoAnnounces = [];
        }
    } catch (err) {
        log('ERR', `Greška pri učitavanju bot konfiguracije za ${chatroomId}: ${err.message}`);
    }
}

async function ucitajSveAktivneKanale() {
    try {
        if (!KORISTI_SUPABASE) return [];
        log('INFO', 'Učitavam sve aktivne kanale iz bot_config tabele...');
        const { data, error } = await supabase
            .from('bot_config')
            .select('*')
            .eq('bot_active', true);

        if (error) throw error;
        return data || [];
    } catch (err) {
        log('ERR', `Greška pri učitavanju svih aktivnih kanala: ${err.message}`);
        return [];
    }
}

async function sacuvajSongQueue(chatroomId, queue) {
    try {
        const channelState = state.getChannelState(chatroomId);
        if (!channelState) return;

        if (!channelState.songrequest_settings) channelState.songrequest_settings = {};
        channelState.songrequest_settings.queue = queue;

        if (KORISTI_SUPABASE) {
            const { error } = await sbPanels
                .from('song_request')
                .upsert({
                    channel_id: chatroomId,
                    type: 'config',
                    enabled: channelState.feature_songrequest ?? true,
                    request_role: channelState.songrequest_settings.request_role || 'everyone',
                    cost_points: channelState.songrequest_settings.cost_points ?? 0,
                    max_duration_seconds: channelState.songrequest_settings.max_duration_seconds ?? 360,
                    queue: queue,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'channel_id,type' });

            if (error) throw error;
        }
    } catch (err) {
        log('ERR', `Greška pri čuvanju song request reda za ${chatroomId}: ${err.message}`);
    }
}

async function posaljiKickovAlert(userId, alertType, payloadData) {
    if (!KORISTI_SUPABASE || !supabase || !userId) return;
    try {
        const channelName = `kickov_alerts:${userId}`;
        const channel = supabase.channel(channelName);
        await channel.send({
            type: 'broadcast',
            event: 'alert',
            payload: {
                type: alertType,
                ...payloadData,
                timestamp: Date.now()
            }
        });
    } catch (err) {
        log('ERR', `Greška pri slanju Kickov alerta za ${userId}: ${err.message}`);
    }
}

// ─── EKONOMIJA (XP, LEVEL, COINS) ────────────────────────────────────────────

async function ucitajEkonomiju(chatroomId) {
    try {
        if (!KORISTI_SUPABASE) return;
        const channelState = state.getChannelState(chatroomId);
        if (!channelState) return;
        const channelUsername = channelState.channelUsername || chatroomId;

        const { dobijTrenutniMesec } = require('./utils');
        const trenutniMesec = dobijTrenutniMesec();

        log('INFO', `[${channelUsername}] Učitavam ekonomiju (XP/level/coins) iz leaderboard tabele...`);

        const { data, error } = await sbPanels
            .from('leaderboard')
            .select('username, display_name, xp, level, coins, daily_claimed_at, daily_streak')
            .eq('channel_id', chatroomId)
            .eq('month', trenutniMesec);

        if (error) throw error;

        if (data && data.length > 0) {
            data.forEach(row => {
                const key = row.username.toLowerCase();
                channelState.economy[key] = {
                    username: row.display_name || row.username,
                    xp: row.xp || 0,
                    level: row.level || 0,
                    coins: row.coins || 0,
                    daily_claimed_at: row.daily_claimed_at || 0,
                    daily_streak: row.daily_streak || 0
                };
            });
            log('INFO', `[${channelUsername}] Učitana ekonomija iz leaderboard tabele za ${data.length} korisnika.`);
        } else {
            log('INFO', `[${channelUsername}] Nema ekonomskih podataka u leaderboard tabeli za ovaj mesec, počinjemo od nule.`);
        }
    } catch (err) {
        log('ERR', `Greška pri učitavanju ekonomije za ${chatroomId}: ${err.message}`);
    }
}

async function sacuvajEkonomiju(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || !channelState.economyDirty) return;

    try {
        if (!KORISTI_SUPABASE) return;

        const dirtyUsers = channelState.economyDeltas;
        if (!dirtyUsers || dirtyUsers.size === 0) {
            channelState.economyDirty = false;
            return;
        }

        const { dobijTrenutniMesec } = require('./utils');
        const trenutniMesec = dobijTrenutniMesec();
        const godinaStr = trenutniMesec.split('-')[1] || String(new Date().getFullYear());

        const rows = [];
        for (const key of dirtyUsers) {
            const user = channelState.economy[key];
            if (!user) continue;
            rows.push({
                channel_id: chatroomId,
                username: key,
                display_name: user.username || key,
                xp: user.xp || 0,
                level: user.level || 0,
                coins: user.coins || 0,
                daily_claimed_at: user.daily_claimed_at || 0,
                daily_streak: user.daily_streak || 0,
                month: trenutniMesec,
                year: godinaStr,
                updated_at: new Date().toISOString()
            });
        }

        if (rows.length === 0) {
            channelState.economyDirty = false;
            return;
        }

        const { error } = await sbPanels
            .from('leaderboard')
            .upsert(rows, { onConflict: 'channel_id,username,month' });

        if (error) throw error;

        channelState.economyDeltas.clear();
        channelState.economyDirty = false;

        log('INFO', `[${channelState.channelUsername || chatroomId}] Ekonomija sačuvana u leaderboard tabelu za ${rows.length} korisnika.`);
    } catch (err) {
        log('ERR', `Greška pri čuvanju ekonomije za ${chatroomId}: ${err.message}`);
    }
}

async function syncChatroomId(channelName, realChatroomId) {
    try {
        await supabase
            .from('channels')
            .update({ chatroom_id: String(realChatroomId) })
            .eq('username', channelName);
    } catch (err) {
        console.error('Greska u syncChatroomId:', err);
    }
}

let realtimeChannel = null;

/**
 * Pokreće Supabase Realtime CDC (Change Data Capture) pretplatu na `bot_config` tabelu.
 * Kada strimer izmeni podešavanje na web-u, bot u realnom vremenu automatski
 * osvežava konfiguraciju tog kanala u memoriji bez ručnog osvežavanja.
 */
function postaviRealtimeSlusalac() {
    if (!KORISTI_SUPABASE || !supabase || realtimeChannel) return;

    try {
        realtimeChannel = supabase
            .channel('bot_realtime_config_sync')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'bot_config' },
                async (payload) => {
                    const chatroomId = payload?.new?.channel_id || payload?.old?.channel_id;
                    if (chatroomId) {
                        log('INFO', `[REALTIME] Detektovana izmena u bot_config za chatroomId ${chatroomId}. Sinhronizujem u realnom vremenu...`);
                        await ucitajBotConfig(chatroomId);
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    log('INFO', '[REALTIME] Supabase Realtime CDC sinhronizacija aktivna za izmene bota u realnom vremenu.');
                }
            });
    } catch (err) {
        log('ERR', `[REALTIME] Greška pri pokretanju Realtime CDC slušaoca: ${err.message}`);
    }
}

module.exports = {
    supabase,
    sbPanels,
    KORISTI_SUPABASE,
    sacuvajSongQueue,
    ucitajLeaderboard,
    ucitajEkonomiju,
    sacuvajEkonomiju,
    ucitajLjubav,
    sacuvajLjubav,
    osigurajCuvanjeLjubavi,
    sacuvajLeaderboard,
    proveriIResetujMesec,
    evidentirajPoruku,
    smanjiPoruku,
    ucitajCustomKomande,
    ucitajAutoAnnounces,
    ucitajAlerts,
    ucitajBotConfig,
    ucitajUserPlan,
    ucitajSveAktivneKanale,
    posaljiKickovAlert,
    syncChatroomId,
    postaviRealtimeSlusalac
};


