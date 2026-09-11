const state = require('./state');
const { log, sanitizeInput, isValidUsername } = require('./utils');
const { supabase, KORISTI_SUPABASE } = require('./database');
const { posaljiPoruku } = require('./messenger');

// Interval ažuriranja (1 minut / 60.000 ms) i grace period (10 minuta / 600.000 ms)
const TICK_INTERVAL_MS = 60 * 1000;
const GRACE_PERIOD_MS = 10 * 60 * 1000;
const SAVE_INTERVAL_MINUTES = 10;

// ─── UČITAVANJE SA SUPABASE ───────────────────────────────────────────────────
async function ucitajWatchtime(chatroomId) {
    try {
        if (!KORISTI_SUPABASE) {
            log('WARN', `Watchtime: Supabase nije konfigurisan, watchtime za ${chatroomId} neće biti praćen.`);
            return;
        }

        const channelState = state.getChannelState(chatroomId);
        if (!channelState) return;
        const channelUsername = channelState.channelUsername || chatroomId;

        const { dobijTrenutniMesec, dobijTrenutniDan } = require('./utils');
        const trenutniMesec = dobijTrenutniMesec();
        const trenutniDan = dobijTrenutniDan();

        log('INFO', `[${channelUsername}] Učitavam watchtime iz leaderboard tabele...`);
        const { data, error } = await supabase
            .from('leaderboard')
            .select('username, display_name, watchtime_minutes')
            .eq('channel_id', chatroomId)
            .eq('month', trenutniMesec);

        if (error) throw error;

        channelState.watchtime = {};
        channelState.watchtimeDeltas = {};

        if (data && data.length > 0) {
            data.forEach(row => {
                channelState.watchtime[row.username.toLowerCase()] = {
                    display_name: row.display_name,
                    minutes: row.watchtime_minutes || 0
                };
            });
            log('INFO', `[${channelUsername}] Watchtime učitan iz leaderboard: ${data.length} korisnika.`);
        } else {
            log('INFO', `[${channelUsername}] Watchtime: Nema podataka u leaderboard tabeli za ovaj mesec, počinjemo od nule.`);
        }

        // Učitavanje dnevnog watchtime-a
        try {
            const { data: dailyData, error: dailyError } = await supabase
                .from('leaderboard_daily')
                .select('username, display_name, watchtime_minutes')
                .eq('channel_id', chatroomId)
                .eq('day', trenutniDan);

            if (dailyError) throw dailyError;

            channelState.watchtimeDaily = {};
            channelState.watchtimeDailyDeltas = {};

            if (dailyData && dailyData.length > 0) {
                dailyData.forEach(row => {
                    channelState.watchtimeDaily[row.username.toLowerCase()] = {
                        display_name: row.display_name,
                        minutes: row.watchtime_minutes || 0
                    };
                });
                log('INFO', `[${channelUsername}] Dnevni watchtime učitan: ${dailyData.length} korisnika.`);
            } else {
                channelState.watchtimeDaily = {};
                channelState.watchtimeDailyDeltas = {};
            }
        } catch (dErr) {
            channelState.watchtimeDaily = {};
            channelState.watchtimeDailyDeltas = {};
        }
    } catch (err) {
        log('ERR', `Greška pri učitavanju watchtime-a za ${chatroomId}: ${err.message}`);
    }
}

// ─── ČUVANJE NA SUPABASE ──────────────────────────────────────────────────────
async function sacuvajWatchtime(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || !channelState.watchtimeDirty) return;
    if (!KORISTI_SUPABASE) return;

    const { runWithLeaderboardLock } = require('./utils');
    return runWithLeaderboardLock(channelState, async () => {
        try {
            const dirtyKeys = Object.keys(channelState.watchtimeDeltas).filter(k => channelState.watchtimeDeltas[k] !== 0);
            const dailyDirtyKeys = Object.keys(channelState.watchtimeDailyDeltas || {}).filter(k => channelState.watchtimeDailyDeltas[k] !== 0);

            if (dirtyKeys.length === 0 && dailyDirtyKeys.length === 0) {
                channelState.watchtimeDirty = false;
                return;
            }

            const { dobijTrenutniMesec, dobijTrenutniDan } = require('./utils');
            const trenutniMesec = dobijTrenutniMesec();
            const trenutniDan = dobijTrenutniDan();
            const godinaStr = trenutniMesec.split('-')[1] || String(new Date().getFullYear());

            // 1. Čuvanje mesečnog watchtime-a
            if (dirtyKeys.length > 0) {
                const { data, error: fetchError } = await supabase
                    .from('leaderboard')
                    .select('username, chat, watchtime_minutes')
                    .eq('channel_id', chatroomId)
                    .eq('month', trenutniMesec)
                    .in('username', dirtyKeys);

                if (fetchError) throw fetchError;

                const dbMap = {};
                if (data) {
                    data.forEach(row => {
                        dbMap[row.username.toLowerCase()] = row;
                    });
                }

                const lbRows = dirtyKeys.map(key => {
                    const existing = dbMap[key];
                    const dbMinutes = existing && existing.watchtime_minutes !== undefined ? existing.watchtime_minutes : 0;
                    const dbChat = existing && existing.chat !== undefined ? existing.chat : ((channelState.leaderboard && channelState.leaderboard[key]) ? channelState.leaderboard[key].count : 0);
                    const delta = channelState.watchtimeDeltas[key];
                    const newMinutes = Math.max(0, dbMinutes + delta);

                    return {
                        channel_id: chatroomId,
                        username: key,
                        display_name: (channelState.watchtime[key] && channelState.watchtime[key].display_name) || key,
                        chat: dbChat,
                        watchtime_minutes: newMinutes,
                        month: trenutniMesec,
                        year: godinaStr,
                        updated_at: new Date().toISOString(),
                        _newMinutes: newMinutes
                    };
                });

                const lbClean = lbRows.map(({ _newMinutes, ...r }) => r);
                const { error: upsertError } = await supabase
                    .from('leaderboard')
                    .upsert(lbClean, { onConflict: 'channel_id,username,month' });

                if (upsertError) throw upsertError;

                lbRows.forEach(row => {
                    const key = row.username;
                    if (channelState.watchtime[key]) {
                        channelState.watchtime[key].minutes = row._newMinutes;
                    } else {
                        channelState.watchtime[key] = {
                            display_name: row.display_name,
                            minutes: row._newMinutes
                        };
                    }
                    delete channelState.watchtimeDeltas[key];
                });
            }

            // 2. Čuvanje dnevnog watchtime-a
            if (dailyDirtyKeys.length > 0) {
                const danStr = channelState.tekuciDanLeaderboarda || trenutniDan;
                const { data: dailyData, error: dailyFetchError } = await supabase
                    .from('leaderboard_daily')
                    .select('username, chat, watchtime_minutes')
                    .eq('channel_id', chatroomId)
                    .eq('day', danStr)
                    .in('username', dailyDirtyKeys);

                if (!dailyFetchError) {
                    const dailyDbMap = {};
                    if (dailyData) {
                        dailyData.forEach(row => { dailyDbMap[row.username.toLowerCase()] = row; });
                    }

                    const dailyRows = dailyDirtyKeys.map(key => {
                        const existing = dailyDbMap[key];
                        const dbMinutes = existing && existing.watchtime_minutes !== undefined ? existing.watchtime_minutes : 0;
                        const dbChat = existing && existing.chat !== undefined ? existing.chat : ((channelState.leaderboardDaily && channelState.leaderboardDaily[key]) ? channelState.leaderboardDaily[key].count : 0);
                        const delta = channelState.watchtimeDailyDeltas[key];
                        const newMinutes = Math.max(0, dbMinutes + delta);

                        return {
                            channel_id: chatroomId,
                            username: key,
                            display_name: (channelState.watchtimeDaily[key] && channelState.watchtimeDaily[key].display_name) || (channelState.watchtime[key] && channelState.watchtime[key].display_name) || key,
                            chat: dbChat,
                            watchtime_minutes: newMinutes,
                            day: danStr,
                            month: trenutniMesec,
                            year: godinaStr,
                            updated_at: new Date().toISOString(),
                            _newMinutes: newMinutes
                        };
                    });

                    const dailyClean = dailyRows.map(({ _newMinutes, ...r }) => r);
                    const { error: dailyUpsertError } = await supabase
                        .from('leaderboard_daily')
                        .upsert(dailyClean, { onConflict: 'channel_id,username,day' });

                    if (!dailyUpsertError) {
                        dailyRows.forEach(row => {
                            const key = row.username;
                            if (channelState.watchtimeDaily[key]) {
                                channelState.watchtimeDaily[key].minutes = row._newMinutes;
                            }
                            delete channelState.watchtimeDailyDeltas[key];
                        });
                    }
                }
            }

            channelState.watchtimeDirty = false;
            log('INFO', `[${channelState.channelUsername || chatroomId}] Watchtime sačuvan u bazu.`);
        } catch (err) {
            log('ERR', `Greška pri čuvanju watchtime-a za ${chatroomId}: ${err.message}`);
        }
    });
}

// ─── TICK (SVAKOG MINUTA) ──────────────────────────────────────────────────────
async function watchtimeTick(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || !channelState.isStreamLive) return;

    const sada = Date.now();
    let nesto = false;
    let dodatiKorisnici = [];

    const keysToClean = [];

    for (const [username, lastSeenTs] of Object.entries(channelState.watchtimeLastSeen)) {
        const razlikaMs = sada - lastSeenTs;
        if (razlikaMs <= GRACE_PERIOD_MS) {
            const key = username.toLowerCase();
            // Mesečni
            if (!channelState.watchtime[key]) {
                channelState.watchtime[key] = { display_name: username, minutes: 0 };
            }
            channelState.watchtime[key].minutes += 1;
            channelState.watchtimeDeltas[key] = (channelState.watchtimeDeltas[key] || 0) + 1;

            // Dnevni
            channelState.watchtimeDaily = channelState.watchtimeDaily || {};
            channelState.watchtimeDailyDeltas = channelState.watchtimeDailyDeltas || {};
            if (!channelState.watchtimeDaily[key]) {
                channelState.watchtimeDaily[key] = { display_name: username, minutes: 0 };
            }
            channelState.watchtimeDaily[key].minutes += 1;
            channelState.watchtimeDailyDeltas[key] = (channelState.watchtimeDailyDeltas[key] || 0) + 1;

            // Nagrađivanje XP-om i Poenima za watchtime (+5 XP, +2 Poena po 1 minutu)
            try {
                const economy = require('./economy');
                const xpBonus = Math.max(1, Math.round((channelState.xp_per_watchtime || 50) / 10));
                const pointsBonus = Math.max(1, Math.round((channelState.points_per_watchtime || 20) / 10));
                economy.dodajXP(chatroomId, channelState.watchtime[key].display_name || username, xpBonus, pointsBonus);
            } catch (e) {
                log('ERR', `Greška u watchtime praćenju za ${username}: ${e.message}`);
            }

            dodatiKorisnici.push(channelState.watchtime[key].display_name);
            nesto = true;
        } else {
            // Ako je prošlo više od 10 minuta bez ijedne akcije, uklanja se iz aktivne liste
            keysToClean.push(username);
        }
    }

    // Ukloni inaktivne
    keysToClean.forEach(k => {
        delete channelState.watchtimeLastSeen[k];
    });

    if (nesto) {
        channelState.watchtimeDirty = true;
        channelState.watchtimeTickCounter = (channelState.watchtimeTickCounter || 0) + 1;
        // Periodični save u bazu svakih 5 minuta (5 tickova)
        if (channelState.watchtimeTickCounter >= SAVE_INTERVAL_MINUTES) {
            channelState.watchtimeTickCounter = 0;
            await sacuvajWatchtime(chatroomId);
        }
    }
}

async function watchtimeTickSve() {
    for (const chatroomId of Object.keys(state.channels)) {
        const channelState = state.channels[chatroomId];
        if (channelState && channelState.botActive && channelState.isStreamLive && channelState.feature_watchtime) {
            await watchtimeTick(chatroomId);
        }
    }
}

// ─── Registruj aktivnog gledaoca ──────────────────────────────────────────────
function registrujAktivnogGledaoca(chatroomId, username) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    if (!channelState.isStreamLive) return;
    if (!isValidUsername(username)) return;

    const clean = sanitizeInput(username);
    const key = clean.toLowerCase();

    channelState.watchtimeLastSeen[key] = Date.now();

    if (!channelState.watchtime[key]) {
        channelState.watchtime[key] = { display_name: clean, minutes: 0 };
    } else {
        channelState.watchtime[key].display_name = clean;
    }
}

// Čišćenje kada strim ode offline (End-of-Stream Save)
async function ocistiAktivneGledaoce(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    log('INFO', `[${channelState.channelUsername || chatroomId}] Strim je offline - pražnjenje memorijskih delića i flush u bazu.`);
    channelState.watchtimeLastSeen = {};
    if (channelState.watchtimeDirty) {
        await sacuvajWatchtime(chatroomId);
    }
}

// ─── POKRETANJE I ZAUSTAVLJANJE TIMERA ─────────────────────────────────────────
function pokreniWatchtimeTick() {
    if (state.watchtimeTickTimer) return;
    state.watchtimeTickTimer = setInterval(watchtimeTickSve, TICK_INTERVAL_MS).unref();
    log('INFO', 'Globalni watchtime tick pokrenut (svakih 1 minut).');
}

function zaustavljWatchtimeTick() {
    if (state.watchtimeTickTimer) {
        clearInterval(state.watchtimeTickTimer);
        state.watchtimeTickTimer = null;
    }
}

// ─── FORMAT: Xd Xh Xmin ───────────────────────────────────────────────────────
function formatWatchtime(ukupnoMinuta) {
    if (!ukupnoMinuta || ukupnoMinuta < 1) return '0min';

    const dani   = Math.floor(ukupnoMinuta / 1440);
    const sati   = Math.floor((ukupnoMinuta % 1440) / 60);
    const minuti = ukupnoMinuta % 60;

    const delovi = [];
    if (dani > 0)    delovi.push(`${dani}d`);
    if (sati > 0)    delovi.push(`${sati}h`);
    if (minuti > 0 || delovi.length === 0) delovi.push(`${minuti}min`);

    return delovi.join(' ');
}

// ─── KOMANDA: !watchtime [@user] [period] ─────────────────────────────────────
async function handleWatchtime(chatroomId, sender, rawArgs) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const tokens = (rawArgs || '').trim().split(/\s+/).filter(Boolean);
    let targetUser = '';
    let requestedPeriod = 'month'; // default je mesec

    for (const token of tokens) {
        const tLower = token.toLowerCase();
        if (['dan', 'danas', 'dnevno', 'today', 'day', 'daily'].includes(tLower)) {
            requestedPeriod = 'day';
        } else if (['mesec', 'mesecno', 'ovajmesec', 'month', 'monthly'].includes(tLower)) {
            requestedPeriod = 'month';
        } else if (['godina', 'godisnje', 'year', 'yearly'].includes(tLower)) {
            requestedPeriod = 'year';
        } else if (['sve', 'ukupno', 'svevreme', 'all', 'alltime', 'total'].includes(tLower)) {
            requestedPeriod = 'alltime';
        } else {
            const cleanCandidate = token.replace(/^@/, '').trim();
            if (isValidUsername(cleanCandidate)) {
                targetUser = cleanCandidate;
            }
        }
    }

    let user = targetUser || sender;
    const cleanUser = sanitizeInput(user);
    const key = cleanUser.toLowerCase();

    // 1. Dnevni watchtime
    if (requestedPeriod === 'day') {
        const podaci = (channelState.watchtimeDaily || {})[key];
        const minutes = podaci ? podaci.minutes : 0;
        if (!minutes || minutes === 0) {
            posaljiPoruku(chatroomId, `⏱️ @${cleanUser} danas još uvek nema zabeleženog watchtime-a.`);
            return;
        }
        posaljiPoruku(chatroomId, `⏱️ @${cleanUser} (Danas): ${formatWatchtime(minutes)}`);
        return;
    }

    // 2. Mesečni watchtime (DEFAULT)
    if (requestedPeriod === 'month') {
        const podaci = (channelState.watchtime || {})[key];
        const minutes = podaci ? podaci.minutes : 0;
        if (!minutes || minutes === 0) {
            posaljiPoruku(chatroomId, `⏱️ @${cleanUser} nema zabeleženog watchtime-a za ovaj mesec.`);
            return;
        }
        const { dobijTrenutniMesec } = require('./utils');
        const mesecStr = channelState.tekuciMesecLeaderboarda || dobijTrenutniMesec();
        posaljiPoruku(chatroomId, `⏱️ @${cleanUser} (${mesecStr}): ${formatWatchtime(minutes)}`);
        return;
    }

    // 3. Godišnji ili Svevreme (All-time) iz Supabase
    if (requestedPeriod === 'year' || requestedPeriod === 'alltime') {
        if (!KORISTI_SUPABASE) {
            const podaci = (channelState.watchtime || {})[key];
            const minutes = podaci ? podaci.minutes : 0;
            posaljiPoruku(chatroomId, `⏱️ @${cleanUser} (ukupno): ${formatWatchtime(minutes)}`);
            return;
        }

        try {
            const currentYear = String(new Date().getFullYear());
            let query = supabase
                .from('leaderboard')
                .select('watchtime_minutes')
                .eq('channel_id', chatroomId)
                .eq('username', key);

            if (requestedPeriod === 'year') {
                query = query.eq('year', currentYear);
            }

            const { data, error } = await query;
            if (error) throw error;

            let totalMinutes = 0;
            if (data && data.length > 0) {
                totalMinutes = data.reduce((acc, row) => acc + (Number(row.watchtime_minutes) || 0), 0);
            }

            // Ako za tekući mesec ima delta koja još nije flushovana, dodaj je
            const delta = (channelState.watchtimeDeltas && channelState.watchtimeDeltas[key]) || 0;
            totalMinutes += delta;

            if (totalMinutes === 0) {
                const label = requestedPeriod === 'year' ? `za ${currentYear}. godinu` : 'sve vreme';
                posaljiPoruku(chatroomId, `⏱️ @${cleanUser} nema zabeleženog watchtime-a za ${label}.`);
                return;
            }

            const label = requestedPeriod === 'year' ? `${currentYear}. godina` : 'Sve vreme';
            posaljiPoruku(chatroomId, `⏱️ @${cleanUser} (${label}): ${formatWatchtime(totalMinutes)}`);
        } catch (err) {
            log('ERR', `Greška pri čitanju watchtime-a (${requestedPeriod}): ${err.message}`);
            const podaci = (channelState.watchtime || {})[key];
            const minutes = podaci ? podaci.minutes : 0;
            posaljiPoruku(chatroomId, `⏱️ @${cleanUser}: ${formatWatchtime(minutes)}`);
        }
    }
}

// ─── KOMANDA: !topwatchtime [period] [broj] ───────────────────────────────────
async function handleTopWatchtime(chatroomId, numRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const rawStr = (numRaw || '').trim();
    const tokens = rawStr.split(/\s+/).filter(Boolean);
    let limit = 5;
    let period = 'month'; // default: ovaj mesec

    for (const token of tokens) {
        const tLower = token.toLowerCase();
        if (['dan', 'danas', 'dnevno', 'today', 'day', 'daily'].includes(tLower)) {
            period = 'day';
        } else if (['mesec', 'mesecno', 'ovajmesec', 'month', 'monthly'].includes(tLower)) {
            period = 'month';
        } else if (['godina', 'godisnje', 'year', 'yearly'].includes(tLower)) {
            period = 'year';
        } else if (['sve', 'ukupno', 'svevreme', 'all', 'alltime', 'total'].includes(tLower)) {
            period = 'alltime';
        } else {
            const parsed = parseInt(token.replace(/\D/g, ''), 10);
            if (!isNaN(parsed) && parsed > 0) {
                limit = Math.min(15, parsed);
            }
        }
    }

    // 1. Danas
    if (period === 'day') {
        const dataSource = channelState.watchtimeDaily || {};
        const sortirani = Object.values(dataSource)
            .sort((a, b) => b.minutes - a.minutes)
            .filter(x => x.minutes > 0);

        if (sortirani.length === 0) {
            posaljiPoruku(chatroomId, `⏱️ Još nema watchtime podataka za danas!`);
            return;
        }
        const lista = sortirani.slice(0, limit)
            .map((x, idx) => `${idx + 1}. @${x.display_name} (${formatWatchtime(x.minutes)})`)
            .join(', ');
        const { dobijTrenutniDan } = require('./utils');
        const dan = channelState.tekuciDanLeaderboarda || dobijTrenutniDan();
        posaljiPoruku(chatroomId, `⏱️ Dnevni Top ${limit} Watchtime (${dan}): ${lista}`);
        return;
    }

    // 2. Ovaj mesec (DEFAULT)
    if (period === 'month') {
        const dataSource = channelState.watchtime || {};
        const sortirani = Object.values(dataSource)
            .sort((a, b) => b.minutes - a.minutes)
            .filter(x => x.minutes > 0);

        if (sortirani.length === 0) {
            posaljiPoruku(chatroomId, `⏱️ Još nema watchtime podataka za ovaj mesec!`);
            return;
        }
        const lista = sortirani.slice(0, limit)
            .map((x, idx) => `${idx + 1}. @${x.display_name} (${formatWatchtime(x.minutes)})`)
            .join(', ');
        const { dobijTrenutniMesec } = require('./utils');
        const mesecStr = channelState.tekuciMesecLeaderboarda || dobijTrenutniMesec();
        posaljiPoruku(chatroomId, `⏱️ Mesečni Top ${limit} Watchtime (${mesecStr}): ${lista}`);
        return;
    }

    // 3. Godišnji ili Sve vreme (All-time)
    if (period === 'year' || period === 'alltime') {
        if (!KORISTI_SUPABASE) {
            const dataSource = channelState.watchtime || {};
            const sortirani = Object.values(dataSource).sort((a, b) => b.minutes - a.minutes).filter(x => x.minutes > 0);
            const lista = sortirani.slice(0, limit).map((x, idx) => `${idx + 1}. @${x.display_name} (${formatWatchtime(x.minutes)})`).join(', ');
            posaljiPoruku(chatroomId, `⏱️ Top ${limit} Watchtime: ${lista}`);
            return;
        }

        try {
            const currentYear = String(new Date().getFullYear());
            let query = supabase
                .from('leaderboard')
                .select('username, display_name, watchtime_minutes')
                .eq('channel_id', chatroomId);

            if (period === 'year') {
                query = query.eq('year', currentYear);
            }

            const { data, error } = await query;
            if (error) throw error;

            // Agregacija po korisniku (sumiramo mesece)
            const mapAgg = new Map();
            (data || []).forEach(row => {
                const uKey = (row.username || '').toLowerCase();
                if (!uKey) return;
                const prev = mapAgg.get(uKey) || { display_name: row.display_name || row.username, minutes: 0 };
                prev.minutes += Number(row.watchtime_minutes) || 0;
                if (row.display_name) prev.display_name = row.display_name;
                mapAgg.set(uKey, prev);
            });

            // Dodaj trenutne neflushovane delte
            if (channelState.watchtimeDeltas) {
                for (const uKey in channelState.watchtimeDeltas) {
                    const delta = channelState.watchtimeDeltas[uKey] || 0;
                    if (delta > 0) {
                        const prev = mapAgg.get(uKey) || { display_name: uKey, minutes: 0 };
                        prev.minutes += delta;
                        mapAgg.set(uKey, prev);
                    }
                }
            }

            const sortirani = Array.from(mapAgg.values())
                .sort((a, b) => b.minutes - a.minutes)
                .filter(x => x.minutes > 0);

            if (sortirani.length === 0) {
                const periodText = period === 'year' ? `${currentYear}. godinu` : 'sve vreme';
                posaljiPoruku(chatroomId, `⏱️ Još nema watchtime podataka za ${periodText}!`);
                return;
            }

            const lista = sortirani.slice(0, limit)
                .map((x, idx) => `${idx + 1}. @${x.display_name} (${formatWatchtime(x.minutes)})`)
                .join(', ');

            const periodLabel = period === 'year' ? `Godina ${currentYear}` : 'Sve vreme';
            posaljiPoruku(chatroomId, `⏱️ Top ${limit} Watchtime (${periodLabel}): ${lista}`);
        } catch (err) {
            log('ERR', `Greška pri dohvatanju Top Watchtime (${period}): ${err.message}`);
            posaljiPoruku(chatroomId, `❌ Greška pri učitavanju top watchtime podataka.`);
        }
    }
}

module.exports = {
    ucitajWatchtime,
    sacuvajWatchtime,
    registrujAktivnogGledaoca,
    ocistiAktivneGledaoce,
    pokreniWatchtimeTick,
    zaustavljWatchtimeTick,
    handleWatchtime,
    handleTopWatchtime,
    formatWatchtime
};
