const state = require('./state');
const { log, sanitizeInput, isValidUsername } = require('./utils');
const { supabase, KORISTI_SUPABASE } = require('./database');
const { posaljiPoruku } = require('./messenger');

// Interval ažuriranja (1 minut / 60.000 ms) i grace period (10 minuta / 600.000 ms)
const TICK_INTERVAL_MS = 60 * 1000;
const GRACE_PERIOD_MS = 10 * 60 * 1000;
const SAVE_INTERVAL_MINUTES = 5;

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

        const { dobijTrenutniMesec } = require('./utils');
        const trenutniMesec = dobijTrenutniMesec();

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
    } catch (err) {
        log('ERR', `Greška pri učitavanju watchtime-a za ${chatroomId}: ${err.message}`);
    }
}

// ─── ČUVANJE NA SUPABASE ──────────────────────────────────────────────────────
async function sacuvajWatchtime(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || !channelState.watchtimeDirty) return;
    if (!KORISTI_SUPABASE) return;

    try {
        const dirtyKeys = Object.keys(channelState.watchtimeDeltas).filter(k => channelState.watchtimeDeltas[k] !== 0);

        if (dirtyKeys.length === 0) {
            channelState.watchtimeDirty = false;
            return;
        }

        const { dobijTrenutniMesec } = require('./utils');
        const trenutniMesec = dobijTrenutniMesec();
        const godinaStr = trenutniMesec.split('-')[1] || String(new Date().getFullYear());

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

        channelState.watchtimeDirty = false;
        log('INFO', `[${channelState.channelUsername || chatroomId}] Watchtime sačuvan u leaderboard tabelu (${lbClean.length} korisnika).`);
    } catch (err) {
        log('ERR', `Greška pri čuvanju watchtime-a za ${chatroomId}: ${err.message}`);
    }
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
            if (!channelState.watchtime[key]) {
                channelState.watchtime[key] = { display_name: username, minutes: 0 };
            }
            channelState.watchtime[key].minutes += 1;
            channelState.watchtimeDeltas[key] = (channelState.watchtimeDeltas[key] || 0) + 1;

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

// ─── KOMANDA: !watchtime [@user] ─────────────────────────────────────────────
function handleWatchtime(chatroomId, sender, targetRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const target = targetRaw ? targetRaw.split(/\s+/)[0].replace(/^@/, '').trim() : '';

    let user;
    if (target && isValidUsername(target)) {
        user = sanitizeInput(target);
    } else if (!target) {
        user = sender;
    } else {
        posaljiPoruku(chatroomId, '❌ Nevalidno korisničko ime.');
        return;
    }

    const key = user.toLowerCase();
    const podaci = channelState.watchtime[key];

    if (!podaci || podaci.minutes === 0) {
        posaljiPoruku(chatroomId, `⏱️ @${user} još uvek nema zabeleženog watchtime-a na ovom kanalu.`);
        return;
    }

    const tekst = formatWatchtime(podaci.minutes);
    posaljiPoruku(chatroomId, `⏱️ @${user} je gledao strim ukupno: ${tekst}`);
}

// ─── KOMANDA: !topwatchtime [broj] ───────────────────────────────────────────
function handleTopWatchtime(chatroomId, numRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    let limit = 5;
    if (numRaw) {
        const parsed = parseInt(numRaw.trim(), 10);
        if (!isNaN(parsed) && parsed > 0) {
            limit = Math.min(15, parsed);
        }
    }

    const sortirani = Object.values(channelState.watchtime)
        .sort((a, b) => b.minutes - a.minutes)
        .filter(x => x.minutes > 0);

    if (sortirani.length === 0) {
        posaljiPoruku(chatroomId, '⏱️ Još nema watchtime podataka za ovaj kanal!');
        return;
    }

    const lista = sortirani.slice(0, limit)
        .map((x, idx) => `${idx + 1}. @${x.display_name} (${formatWatchtime(x.minutes)})`)
        .join(', ');

    posaljiPoruku(chatroomId, `⏱️ Top ${limit} Watchtime: ${lista}`);
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
