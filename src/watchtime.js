const config = require('./config');
const state = require('./state');
const { log, sanitizeInput, isValidUsername } = require('./utils');
const { supabase, KORISTI_SUPABASE } = require('./database');
const { posaljiPoruku } = require('./messenger');

// Interval ažuriranja i prozor aktivnosti (10 minuta)
const UPDATE_INTERVAL_MS = 10 * 60 * 1000;

// Inicijalizacija in-memory watchtime stanja (sigurno, bez override-a)
if (!state.watchtime) state.watchtime = {};
if (!state.watchtimeDirty) state.watchtimeDirty = false;
if (!state.watchtimeLastSeen) state.watchtimeLastSeen = {};
if (!state.watchtimeDeltas) state.watchtimeDeltas = {};
if (!state.watchtimeTickTimer) state.watchtimeTickTimer = null;

// ─── UČITAVANJE SA SUPABASE ───────────────────────────────────────────────────
async function ucitajWatchtime() {
    try {
        if (!KORISTI_SUPABASE) {
            log('WARN', 'Watchtime: Supabase nije konfigurisan, watchtime neće biti praćen.');
            return;
        }

        log('INFO', `Učitavam watchtime sa Supabase za kanal: ${config.CHANNEL_USERNAME}...`);
        const { data, error } = await supabase
            .from('watchtime')
            .select('username, display_name, minutes')
            .eq('channel_id', config.CHATROOM_ID);

        if (error) throw error;

        // Resetuj in-memory i delte pri svakom ucitavanju
        state.watchtime = {};
        state.watchtimeDeltas = {};

        if (data && data.length > 0) {
            data.forEach(row => {
                state.watchtime[row.username.toLowerCase()] = {
                    display_name: row.display_name,
                    minutes: row.minutes
                };
            });
            log('INFO', `Watchtime učitan: ${data.length} korisnika.`);
        } else {
            log('INFO', 'Watchtime: Nema podataka u bazi, počinjemo od nule.');
        }
    } catch (err) {
        log('ERR', `Greška pri učitavanju watchtime-a: ${err.message}`);
    }
}

// ─── ČUVANJE NA SUPABASE (odmah pri tick-u jer je na svakih 10 min) ───────────
async function sacuvajWatchtime() {
    if (!state.watchtimeDirty) return;
    if (!KORISTI_SUPABASE) return;

    try {
        const dirtyKeys = Object.keys(state.watchtimeDeltas).filter(k => state.watchtimeDeltas[k] !== 0);

        if (dirtyKeys.length === 0) {
            state.watchtimeDirty = false;
            return;
        }

        // Povuci trenutni watchtime iz baze za aktivne korisnike
        const { data, error: fetchError } = await supabase
            .from('watchtime')
            .select('username, minutes')
            .eq('channel_id', config.CHATROOM_ID)
            .in('username', dirtyKeys);

        if (fetchError) throw fetchError;

        // Mapa username -> trenutni minuti iz baze
        const dbMap = {};
        if (data) {
            data.forEach(row => {
                dbMap[row.username.toLowerCase()] = row.minutes;
            });
        }

        // Pripremi redove: baza + delta = novi total
        const rowsToUpsert = dirtyKeys.map(key => {
            const dbMinutes = dbMap[key] !== undefined ? dbMap[key] : 0;
            const delta = state.watchtimeDeltas[key];
            const newMinutes = Math.max(0, dbMinutes + delta);

            return {
                channel_id: config.CHATROOM_ID,
                username: key,
                display_name: (state.watchtime[key] && state.watchtime[key].display_name) || key,
                minutes: newMinutes,
                updated_at: new Date().toISOString(),
                _newMinutes: newMinutes // privremeno za sinhronizaciju memorije
            };
        });

        // Upsert - tek NAKON uspešnog upisa resetuj delte i ažuriraj memoriju
        const rowsClean = rowsToUpsert.map(({ _newMinutes, ...r }) => r);
        const { error: upsertError } = await supabase
            .from('watchtime')
            .upsert(rowsClean, { onConflict: 'channel_id,username' });

        if (upsertError) throw upsertError;

        // Uspešno - sinhronizuj in-memory sa vrednostima koje smo upisali
        rowsToUpsert.forEach(row => {
            const key = row.username;
            if (state.watchtime[key]) {
                state.watchtime[key].minutes = row._newMinutes;
            } else {
                state.watchtime[key] = {
                    display_name: row.display_name,
                    minutes: row._newMinutes
                };
            }
            delete state.watchtimeDeltas[key]; // ukloni, ne ostavljaj 0
        });

        state.watchtimeDirty = false;
        log('INFO', `Watchtime sačuvan na Supabase (${rowsClean.length} korisnika).`);
    } catch (err) {
        // Delte se NAMERNO ne resetuju - čuvaju se za sledeći pokušaj
        log('ERR', `Greška pri čuvanju watchtime-a: ${err.message}`);
    }
}

// ─── TICK: Dodaje 10 minuta gledaocima koji su poslali poruku u poslednjih 10 min
async function watchtimeTick() {
    if (!state.isStreamLive) return;

    const sada = Date.now();
    let nesto = false;
    let dodatiKorisnici = [];

    for (const [username, lastSeenTs] of Object.entries(state.watchtimeLastSeen)) {
        if (sada - lastSeenTs <= UPDATE_INTERVAL_MS) {
            const key = username.toLowerCase();
            if (!state.watchtime[key]) {
                state.watchtime[key] = { display_name: username, minutes: 0 };
            }
            // Povecaj in-memory i delta
            state.watchtime[key].minutes += 10;
            state.watchtimeDeltas[key] = (state.watchtimeDeltas[key] || 0) + 10;
            dodatiKorisnici.push(state.watchtime[key].display_name);
            nesto = true;
        }
    }

    if (nesto) {
        log('INFO', `Watchtime tick pokrenut. Dodato po +10 minuta za: ${dodatiKorisnici.join(', ')}`);
        state.watchtimeDirty = true;
        await sacuvajWatchtime();
    }
}

// ─── Registruj korisnika (poziva se na svaku poslatu poruku na lajvu) ──────────
function registrujAktivnogGledaoca(username) {
    if (!state.isStreamLive) return;
    if (!isValidUsername(username)) return;

    const clean = sanitizeInput(username);
    const key = clean.toLowerCase();

    state.watchtimeLastSeen[key] = Date.now();

    if (!state.watchtime[key]) {
        state.watchtime[key] = { display_name: clean, minutes: 0 };
    } else {
        state.watchtime[key].display_name = clean;
    }
}

// Čišćenje kada strim ode offline
function ocistiAktivneGledaoce() {
    log('INFO', 'Strim je offline, praznim registre aktivnosti gledalaca.');
    state.watchtimeLastSeen = {};
    sacuvajWatchtime();
}

// ─── POKRETANJE I ZAUSTAVLJANJE TIMERA ─────────────────────────────────────────
function pokreniWatchtimeTick() {
    if (state.watchtimeTickTimer) return;
    state.watchtimeTickTimer = setInterval(watchtimeTick, UPDATE_INTERVAL_MS);
    log('INFO', 'Watchtime tick pokrenut (svakih 10 minuta).');
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
function handleWatchtime(sender, targetRaw) {
    const target = targetRaw ? targetRaw.split(/\s+/)[0].replace(/^@/, '').trim() : '';

    let user;
    if (target && isValidUsername(target)) {
        user = sanitizeInput(target);
    } else if (!target) {
        user = sender;
    } else {
        posaljiPoruku('❌ Nevalidno korisničko ime.');
        return;
    }

    const key = user.toLowerCase();
    const podaci = state.watchtime[key];

    if (!podaci || podaci.minutes === 0) {
        posaljiPoruku(`⏱️ @${user} još uvek nema zabeleženog watchtime-a na ovom kanalu.`);
        return;
    }

    const tekst = formatWatchtime(podaci.minutes);
    posaljiPoruku(`⏱️ @${user} je gledao strim ukupno: ${tekst}`);
}

// ─── KOMANDA: !topwatchtime [broj] ───────────────────────────────────────────
function handleTopWatchtime(numRaw) {
    let limit = 5;
    if (numRaw) {
        const parsed = parseInt(numRaw.trim(), 10);
        if (!isNaN(parsed) && parsed > 0) {
            limit = Math.min(15, parsed);
        }
    }

    const sortirani = Object.values(state.watchtime)
        .sort((a, b) => b.minutes - a.minutes)
        .filter(x => x.minutes > 0);

    if (sortirani.length === 0) {
        posaljiPoruku('⏱️ Još nema watchtime podataka za ovaj kanal!');
        return;
    }

    const lista = sortirani.slice(0, limit)
        .map((x, idx) => `${idx + 1}. @${x.display_name} (${formatWatchtime(x.minutes)})`)
        .join(', ');

    posaljiPoruku(`⏱️ Top ${limit} Watchtime: ${lista}`);
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
