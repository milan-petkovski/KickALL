const state = require('./state');
const { log, sanitizeInput, isValidUsername } = require('./utils');
const { supabase, KORISTI_SUPABASE } = require('./database');
const { posaljiPoruku } = require('./messenger');

// Interval ažuriranja i prozor aktivnosti (10 minuta)
const UPDATE_INTERVAL_MS = 10 * 60 * 1000;

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

        log('INFO', `[${channelUsername}] Učitavam watchtime sa Supabase...`);
        const { data, error } = await supabase
            .from('watchtime')
            .select('username, display_name, minutes')
            .eq('channel_id', chatroomId);

        if (error) throw error;

        channelState.watchtime = {};
        channelState.watchtimeDeltas = {};

        if (data && data.length > 0) {
            data.forEach(row => {
                channelState.watchtime[row.username.toLowerCase()] = {
                    display_name: row.display_name,
                    minutes: row.minutes
                };
            });
            log('INFO', `[${channelUsername}] Watchtime učitan: ${data.length} korisnika.`);
        } else {
            log('INFO', `[${channelUsername}] Watchtime: Nema podataka u bazi, počinjemo od nule.`);
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

        const { data, error: fetchError } = await supabase
            .from('watchtime')
            .select('username, minutes')
            .eq('channel_id', chatroomId)
            .in('username', dirtyKeys);

        if (fetchError) throw fetchError;

        const dbMap = {};
        if (data) {
            data.forEach(row => {
                dbMap[row.username.toLowerCase()] = row.minutes;
            });
        }

        const rowsToUpsert = dirtyKeys.map(key => {
            const dbMinutes = dbMap[key] !== undefined ? dbMap[key] : 0;
            const delta = channelState.watchtimeDeltas[key];
            const newMinutes = Math.max(0, dbMinutes + delta);

            return {
                channel_id: chatroomId,
                username: key,
                display_name: (channelState.watchtime[key] && channelState.watchtime[key].display_name) || key,
                minutes: newMinutes,
                updated_at: new Date().toISOString(),
                _newMinutes: newMinutes
            };
        });

        const rowsClean = rowsToUpsert.map(({ _newMinutes, ...r }) => r);
        const { error: upsertError } = await supabase
            .from('watchtime')
            .upsert(rowsClean, { onConflict: 'channel_id,username' });

        if (upsertError) throw upsertError;

        rowsToUpsert.forEach(row => {
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
        log('INFO', `[${channelState.channelUsername || chatroomId}] Watchtime sačuvan na Supabase (${rowsClean.length} korisnika).`);
    } catch (err) {
        log('ERR', `Greška pri čuvanju watchtime-a za ${chatroomId}: ${err.message}`);
    }
}

// ─── TICK ────────────────────────────────────────────────────────────────────
async function watchtimeTick(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || !channelState.isStreamLive) return;

    const sada = Date.now();
    let nesto = false;
    let dodatiKorisnici = [];

    for (const [username, lastSeenTs] of Object.entries(channelState.watchtimeLastSeen)) {
        if (sada - lastSeenTs <= UPDATE_INTERVAL_MS) {
            const key = username.toLowerCase();
            if (!channelState.watchtime[key]) {
                channelState.watchtime[key] = { display_name: username, minutes: 0 };
            }
            channelState.watchtime[key].minutes += 10;
            channelState.watchtimeDeltas[key] = (channelState.watchtimeDeltas[key] || 0) + 10;

            // Nagrađivanje XP-om i Poenima za watchtime (+50 XP, +20 Poena po 10 min)
            try {
                const economy = require('./economy');
                const xpBonus = channelState.xp_per_watchtime || 50;
                const pointsBonus = channelState.points_per_watchtime || 20;
                economy.dodajXP(chatroomId, channelState.watchtime[key].display_name || username, xpBonus, pointsBonus);
            } catch (e) {}

            dodatiKorisnici.push(channelState.watchtime[key].display_name);
            nesto = true;
        }
    }

    if (nesto) {
        log('INFO', `[${channelState.channelUsername || chatroomId}] Watchtime tick. Dodato po +10 minuta za: ${dodatiKorisnici.join(', ')}`);
        channelState.watchtimeDirty = true;
        await sacuvajWatchtime(chatroomId);
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

// Čišćenje kada strim ode offline
function ocistiAktivneGledaoce(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    log('INFO', `[${channelState.channelUsername || chatroomId}] Strim je offline, praznim registre aktivnosti gledalaca.`);
    channelState.watchtimeLastSeen = {};
    sacuvajWatchtime(chatroomId);
}

// ─── POKRETANJE I ZAUSTAVLJANJE TIMERA ─────────────────────────────────────────
function pokreniWatchtimeTick() {
    if (state.watchtimeTickTimer) return;
    state.watchtimeTickTimer = setInterval(watchtimeTickSve, UPDATE_INTERVAL_MS);
    log('INFO', 'Globalni watchtime tick pokrenut (svakih 10 minuta).');
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
