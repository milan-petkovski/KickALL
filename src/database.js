const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const state = require('./state');
const { log, dobijTrenutniMesec, sanitizeInput, isValidUsername } = require('./utils');

// Inicijalizacija Supabase klijenta
const supabase = (config.SUPABASE_URL && config.SUPABASE_KEY) ? createClient(config.SUPABASE_URL, config.SUPABASE_KEY) : null;
const KORISTI_SUPABASE = !!supabase;

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────

async function ucitajLeaderboard() {
    try {
        let json = null;
        const trenutniMesec = dobijTrenutniMesec();

        if (KORISTI_SUPABASE) {
            log('INFO', `Učitavam leaderboard sa Supabase baze za kanal: ${config.CHANNEL_USERNAME} (${config.CHATROOM_ID})...`);
            const { data, error } = await supabase
                .from('leaderboard')
                .select('username, display_name, points')
                .eq('channel_id', config.CHATROOM_ID)
                .eq('month', trenutniMesec);

            if (error) throw error;

            if (data && data.length > 0) {
                const podaci = {};
                data.forEach(row => {
                    podaci[row.username.toLowerCase()] = {
                        username: row.display_name,
                        count: row.points
                    };
                });
                json = {
                    mesec: trenutniMesec,
                    podaci: podaci
                };
            }
        } else if (config.KORISTI_GIST) {
            log('INFO', `Učitavam leaderboard sa GitHub Gist-a (${config.GIST_ID})...`);
            const res = await fetch(`https://api.github.com/gists/${config.GIST_ID}`, {
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'Authorization': `Bearer ${config.GITHUB_TOKEN}`,
                    'X-GitHub-Api-Version': '2022-11-28',
                    'User-Agent': 'Kickot-Bot'
                }
            });

            if (res.ok) {
                const gistData = await res.json();
                const file = gistData.files['leaderboard.json'];
                if (file && file.content) {
                    json = JSON.parse(file.content);
                } else {
                    log('WARN', 'Fajl leaderboard.json nije pronađen u Gist-u, kreiram novi...');
                }
            } else {
                throw new Error(`GitHub API status: ${res.status}`);
            }
        } else {
            if (fs.existsSync(config.LEADERBOARD_FILE)) {
                const data = fs.readFileSync(config.LEADERBOARD_FILE, 'utf8');
                json = JSON.parse(data);
            }
        }

        if (json) {
            let resetMeseca = false;
            if (!KORISTI_SUPABASE && json.mesec && json.mesec !== trenutniMesec) {
                const staroUparivanje = json.mesec.match(/^(\d{4})-(\d{2})$/);
                const novoUparivanje = trenutniMesec.match(/^(\d{2})-(\d{4})$/);
                if (staroUparivanje && novoUparivanje) {
                    const [, sG, sM] = staroUparivanje;
                    const [, nM, nG] = novoUparivanje;
                    if (sG !== nG || sM !== nM) {
                        resetMeseca = true;
                    }
                } else {
                    resetMeseca = true;
                }
            }

            if (resetMeseca) {
                log('INFO', `Detektovan novi mesec (${json.mesec} -> ${trenutniMesec}). Resetujem leaderboard.`);
                const stariMesec = json.mesec;
                if (!config.KORISTI_GIST) {
                    const backupFile = path.join(__dirname, '..', `leaderboard_backup_${stariMesec}.json`);
                    fs.writeFileSync(backupFile, JSON.stringify(json, null, 2), 'utf8');
                } else {
                    await sacuvajBackupUGist(stariMesec, json);
                }

                state.leaderboard = {};
                state.leaderboardDeltas = {};
                state.tekuciMesecLeaderboarda = trenutniMesec;
                state.leaderboardDirty = true;
                await sacuvajLeaderboard();
            } else {
                state.leaderboard = json.podaci || {};
                state.leaderboardDeltas = {};
                state.tekuciMesecLeaderboarda = trenutniMesec;
                if (json.mesec !== trenutniMesec) {
                    state.leaderboardDirty = true;
                }
                log('INFO', `Učitan leaderboard za mesec: ${state.tekuciMesecLeaderboarda} (${Object.keys(state.leaderboard).length} aktivnih korisnika)`);
            }
        } else {
            state.leaderboard = {};
            state.leaderboardDeltas = {};
            state.tekuciMesecLeaderboarda = trenutniMesec;
            state.leaderboardDirty = true;
            await sacuvajLeaderboard();
        }
    } catch (err) {
        log('ERR', `Greška pri učitavanju leaderboarda: ${err.message}`);
        state.leaderboard = {};
        state.leaderboardDeltas = {};
        state.tekuciMesecLeaderboarda = dobijTrenutniMesec();
    }
}

async function sacuvajLeaderboard() {
    if (!state.leaderboardDirty) return;
    try {
        const trenutniMesec = dobijTrenutniMesec();

        if (KORISTI_SUPABASE) {
            // Uzmi samo korisnike sa nenultim deltama
            const dirtyKeys = Object.keys(state.leaderboardDeltas).filter(k => state.leaderboardDeltas[k] !== 0);

            if (dirtyKeys.length === 0) {
                state.leaderboardDirty = false;
                return;
            }

            // Povuci trenutne vrednosti iz baze za te korisnike
            const { data, error: fetchError } = await supabase
                .from('leaderboard')
                .select('username, display_name, points')
                .eq('channel_id', config.CHATROOM_ID)
                .eq('month', state.tekuciMesecLeaderboarda)
                .in('username', dirtyKeys);

            if (fetchError) throw fetchError;

            // Napravi mapu username -> trenutni poeni iz baze
            const dbMap = {};
            if (data) {
                data.forEach(row => {
                    dbMap[row.username.toLowerCase()] = row.points;
                });
            }

            // Pripremi redove: baza + delta = novi total
            const rowsToUpsert = dirtyKeys.map(key => {
                const dbPoints = dbMap[key] !== undefined ? dbMap[key] : 0;
                const delta = state.leaderboardDeltas[key];
                const newPoints = Math.max(0, dbPoints + delta);

                return {
                    channel_id: config.CHATROOM_ID,
                    username: key,
                    display_name: (state.leaderboard[key] && state.leaderboard[key].username) || key,
                    points: newPoints,
                    month: state.tekuciMesecLeaderboarda,
                    updated_at: new Date().toISOString(),
                    _newPoints: newPoints // privremeno za sinhronizaciju memorije
                };
            });

            // Upsert - tek NAKON uspešnog upisa resetuj delte i ažuriraj memoriju
            const rowsClean = rowsToUpsert.map(({ _newPoints, ...r }) => r);
            const { error: upsertError } = await supabase
                .from('leaderboard')
                .upsert(rowsClean, { onConflict: 'channel_id,username,month' });

            if (upsertError) throw upsertError;

            // Uspešno - sinhronizuj in-memory stanje sa vrednostima koje smo upisali
            rowsToUpsert.forEach(row => {
                const key = row.username;
                if (state.leaderboard[key]) {
                    state.leaderboard[key].count = row._newPoints;
                } else {
                    state.leaderboard[key] = {
                        username: row.display_name,
                        count: row._newPoints
                    };
                }
                delete state.leaderboardDeltas[key]; // ukloni, ne ostavljaj 0
            });

            state.leaderboardDirty = false;
            log('INFO', `Leaderboard uspešno sačuvan na Supabase (${rowsClean.length} korisnika).`);
        } else {
            // Primeni delte na lokalno stanje pre čuvanja
            Object.keys(state.leaderboardDeltas).forEach(key => {
                if (state.leaderboard[key]) {
                    state.leaderboard[key].count = Math.max(0, state.leaderboard[key].count + state.leaderboardDeltas[key]);
                }
                delete state.leaderboardDeltas[key];
            });

            const json = {
                mesec: trenutniMesec,
                podaci: state.leaderboard
            };

            if (config.KORISTI_GIST) {
                const res = await fetch(`https://api.github.com/gists/${config.GIST_ID}`, {
                    method: 'PATCH',
                    headers: {
                        'Accept': 'application/vnd.github+json',
                        'Authorization': `Bearer ${config.GITHUB_TOKEN}`,
                        'X-GitHub-Api-Version': '2022-11-28',
                        'User-Agent': 'Kickot-Bot',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        files: {
                            'leaderboard.json': {
                                content: JSON.stringify(json, null, 2)
                            }
                        }
                    })
                });

                if (res.ok) {
                    state.leaderboardDirty = false;
                    log('INFO', 'Leaderboard uspešno sačuvan na GitHub Gist.');
                } else {
                    throw new Error(`GitHub API status: ${res.status}`);
                }
            } else {
                fs.writeFileSync(config.LEADERBOARD_FILE, JSON.stringify(json, null, 2), 'utf8');
                state.leaderboardDirty = false;
                log('INFO', 'Leaderboard uspešno sačuvan na disk.');
            }
        }
    } catch (err) {
        // Delte se NAMERNO ne resetuju - čuvaju se za sledeći pokušaj
        log('ERR', `Greška pri čuvanju leaderboarda: ${err.message}`);
    }
}

function proveriIResetujMesec() {
    const trenutniMesec = dobijTrenutniMesec();
    if (state.tekuciMesecLeaderboarda && state.tekuciMesecLeaderboarda !== trenutniMesec) {
        const stariMesec = state.tekuciMesecLeaderboarda;
        log('INFO', `Novi mesec detektovan tokom rada bota (${stariMesec} -> ${trenutniMesec}). Resetujem leaderboard.`);

        const stariPodaci = {
            mesec: stariMesec,
            podaci: { ...state.leaderboard }
        };

        // Resetuj sve za novi mesec - stare delte ne prenosi
        state.leaderboard = {};
        state.leaderboardDeltas = {};
        state.tekuciMesecLeaderboarda = trenutniMesec;

        if (KORISTI_SUPABASE) {
            state.leaderboardDirty = false;
        } else {
            state.leaderboardDirty = true;
            (async () => {
                if (!config.KORISTI_GIST) {
                    try {
                        const backupFile = path.join(__dirname, '..', `leaderboard_backup_${stariMesec}.json`);
                        fs.writeFileSync(backupFile, JSON.stringify(stariPodaci, null, 2), 'utf8');
                    } catch (e) {
                        log('ERR', `Greška pri čuvanju lokalnog backupa: ${e.message}`);
                    }
                }
                await sacuvajLeaderboard();
            })();
        }
    }
}

function evidentirajPoruku(username, poruka) {
    if (!poruka || poruka.trim().length < 3) return;
    if (!isValidUsername(username)) {
        log('WARN', `Blokirano evidentiranje poruke za nevalidno korisničko ime: ${username}`);
        return;
    }

    const cleanUsername = sanitizeInput(username);
    const key = cleanUsername.toLowerCase();
    const sada = Date.now();
    const zadnji = state.lastPointEarned[key] || 0;
    if (sada - zadnji < config.POINT_COOLDOWN_MS) {
        return;
    }

    proveriIResetujMesec();

    if (!state.leaderboard[key]) {
        state.leaderboard[key] = {
            username: cleanUsername,
            count: 0
        };
    }
    state.leaderboard[key].count++;
    state.leaderboard[key].username = cleanUsername;
    state.leaderboardDeltas[key] = (state.leaderboardDeltas[key] || 0) + 1;
    state.leaderboardDirty = true;
    state.lastPointEarned[key] = sada;

    if (!state.leaderboardSaveTimer) {
        state.leaderboardSaveTimer = setTimeout(() => {
            sacuvajLeaderboard();
            state.leaderboardSaveTimer = null;
        }, config.LEADERBOARD_SAVE_INTERVAL_MS);
    }
}

function smanjiPoruku(username, iznos) {
    if (!isValidUsername(username)) return;
    const cleanUsername = sanitizeInput(username);
    const key = cleanUsername.toLowerCase();
    if (state.leaderboard[key]) {
        state.leaderboard[key].count = Math.max(0, state.leaderboard[key].count - iznos);
        state.leaderboard[key].username = cleanUsername;
        state.leaderboardDeltas[key] = (state.leaderboardDeltas[key] || 0) - iznos;
        state.leaderboardDirty = true;

        if (!state.leaderboardSaveTimer) {
            state.leaderboardSaveTimer = setTimeout(() => {
                sacuvajLeaderboard();
                state.leaderboardSaveTimer = null;
            }, config.LEADERBOARD_SAVE_INTERVAL_MS);
        }
    }
}

// ─── LJUBAV / BRAKOVI ─────────────────────────────────────────────────────────

async function ucitajLjubav() {
    try {
        let json = null;

        if (KORISTI_SUPABASE) {
            log('INFO', `Učitavam ljubavne podatke sa Supabase baze za kanal: ${config.CHANNEL_USERNAME} (${config.CHATROOM_ID})...`);

            const { data: modData, error: modError } = await supabase
                .from('love_modifiers')
                .select('user1, user2, modifier')
                .eq('channel_id', config.CHATROOM_ID);

            if (modError) throw modError;

            const { data: marData, error: marError } = await supabase
                .from('marriages')
                .select('user1, user2, user1_display, user2_display, married_at')
                .eq('channel_id', config.CHATROOM_ID);

            if (marError) throw marError;

            if (modData) {
                modData.forEach(row => {
                    const key = [row.user1, row.user2].sort().join('::');
                    state.loveModifiers[key] = row.modifier;
                });
            }

            if (marData) {
                marData.forEach(row => {
                    const key = [row.user1, row.user2].sort().join('::');
                    state.marriedCouples[key] = {
                        user1: row.user1_display,
                        user2: row.user2_display,
                        datum: new Date(row.married_at).toLocaleDateString('sr-RS')
                    };
                });
            }

            log('INFO', `Učitani ljubavni podaci sa Supabase (${Object.keys(state.loveModifiers).length} modifikatora, ${Object.keys(state.marriedCouples).length} brakova).`);
            return;
        } else if (config.KORISTI_GIST) {
            log('INFO', `Učitavam ljubavne podatke sa GitHub Gist-a (${config.GIST_ID})...`);
            const res = await fetch(`https://api.github.com/gists/${config.GIST_ID}`, {
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'Authorization': `Bearer ${config.GITHUB_TOKEN}`,
                    'X-GitHub-Api-Version': '2022-11-28',
                    'User-Agent': 'Kickot-Bot'
                }
            });

            if (res.ok) {
                const gistData = await res.json();
                const file = gistData.files['love_data.json'];
                if (file && file.content) {
                    json = JSON.parse(file.content);
                } else {
                    log('WARN', 'Fajl love_data.json nije pronađen u Gist-u, kreiram novi...');
                }
            } else {
                throw new Error(`GitHub API status: ${res.status}`);
            }
        } else {
            if (fs.existsSync(config.LOVE_DATA_FILE)) {
                const data = fs.readFileSync(config.LOVE_DATA_FILE, 'utf8');
                json = JSON.parse(data);
            }
        }

        if (json) {
            if (json.loveModifiers) {
                Object.assign(state.loveModifiers, json.loveModifiers);
            }
            if (json.marriedCouples) {
                Object.assign(state.marriedCouples, json.marriedCouples);
            }
            log('INFO', `Učitani ljubavni podaci (${Object.keys(state.loveModifiers).length} modifikatora, ${Object.keys(state.marriedCouples).length} brakova).`);
        } else {
            log('INFO', 'Nema sačuvanih ljubavnih podataka, počinjemo od nule.');
        }
    } catch (err) {
        log('ERR', `Greška pri učitavanju ljubavnih podataka: ${err.message}`);
    }
}

async function sacuvajLjubav() {
    if (!state.loveDirty) return;
    try {
        const json = {
            loveModifiers: state.loveModifiers,
            marriedCouples: state.marriedCouples
        };

        if (KORISTI_SUPABASE) {
            const rows = Object.entries(state.loveModifiers).map(([key, val]) => {
                const [u1, u2] = key.split('::');
                return {
                    channel_id: config.CHATROOM_ID,
                    user1: u1,
                    user2: u2,
                    modifier: val,
                    updated_at: new Date().toISOString()
                };
            });

            if (rows.length > 0) {
                const { error } = await supabase
                    .from('love_modifiers')
                    .upsert(rows, { onConflict: 'channel_id,user1,user2' });

                if (error) throw error;
            }
            state.loveDirty = false;
            log('INFO', 'Ljubavni modifikatori uspešno sačuvani na Supabase.');
        } else if (config.KORISTI_GIST) {
            const res = await fetch(`https://api.github.com/gists/${config.GIST_ID}`, {
                method: 'PATCH',
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'Authorization': `Bearer ${config.GITHUB_TOKEN}`,
                    'X-GitHub-Api-Version': '2022-11-28',
                    'User-Agent': 'Kickot-Bot',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    files: {
                        'love_data.json': {
                            content: JSON.stringify(json, null, 2)
                        }
                    }
                })
            });

            if (res.ok) {
                state.loveDirty = false;
                log('INFO', 'Ljubavni podaci uspešno sačuvani na GitHub Gist.');
            } else {
                throw new Error(`GitHub API status: ${res.status}`);
            }
        } else {
            fs.writeFileSync(config.LOVE_DATA_FILE, JSON.stringify(json, null, 2), 'utf8');
            state.loveDirty = false;
            log('INFO', 'Ljubavni podaci uspešno sačuvani na disk.');
        }
    } catch (err) {
        log('ERR', `Greška pri čuvanju ljubavnih podataka: ${err.message}`);
    }
}

function osigurajCuvanjeLjubavi() {
    if (!state.loveSaveTimer) {
        state.loveSaveTimer = setTimeout(() => {
            sacuvajLjubav();
            state.loveSaveTimer = null;
        }, config.LOVE_SAVE_INTERVAL_MS);
    }
}

// ─── GIST BACKUP ─────────────────────────────────────────────────────────────

async function sacuvajBackupUGist(mesec, stariPodaci) {
    try {
        log('INFO', `Čuvam backup za mesec ${mesec} na GitHub Gist...`);
        const res = await fetch(`https://api.github.com/gists/${config.GIST_ID}`, {
            method: 'PATCH',
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${config.GITHUB_TOKEN}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'Kickot-Bot',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: {
                    [`leaderboard_backup_${mesec}.json`]: {
                        content: JSON.stringify(stariPodaci, null, 2)
                    }
                }
            })
        });
        if (!res.ok) {
            log('ERR', `Neuspešan backup na Gist (status ${res.status})`);
        }
    } catch (err) {
        log('ERR', `Greška pri čuvanju backupa na Gist: ${err.message}`);
    }
}

module.exports = {
    supabase,
    KORISTI_SUPABASE,
    ucitajLeaderboard,
    ucitajLjubav,
    sacuvajLjubav,
    osigurajCuvanjeLjubavi,
    sacuvajLeaderboard,
    proveriIResetujMesec,
    evidentirajPoruku,
    smanjiPoruku
};
