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

async function ucitajLeaderboard(chatroomId) {
    try {
        const channelState = state.getChannelState(chatroomId);
        if (!channelState) return;
        const channelUsername = channelState.channelUsername || chatroomId;
        let json = null;
        const trenutniMesec = dobijTrenutniMesec();

        if (KORISTI_SUPABASE) {
            log('INFO', `[${channelUsername}] Učitavam leaderboard sa Supabase baze...`);
            const { data, error } = await supabase
                .from('leaderboard')
                .select('username, display_name, points')
                .eq('channel_id', chatroomId)
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
                }
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
                resetMeseca = true;
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

                channelState.leaderboard = {};
                channelState.leaderboardDeltas = {};
                channelState.tekuciMesecLeaderboarda = trenutniMesec;
                channelState.leaderboardDirty = true;
                await sacuvajLeaderboard(chatroomId);
            } else {
                channelState.leaderboard = json.podaci || {};
                channelState.leaderboardDeltas = {};
                channelState.tekuciMesecLeaderboarda = trenutniMesec;
                if (json.mesec !== trenutniMesec) {
                    channelState.leaderboardDirty = true;
                }
                log('INFO', `[${channelUsername}] Učitan leaderboard za mesec: ${channelState.tekuciMesecLeaderboarda} (${Object.keys(channelState.leaderboard).length} aktivnih korisnika)`);
            }
        } else {
            channelState.leaderboard = {};
            channelState.leaderboardDeltas = {};
            channelState.tekuciMesecLeaderboarda = trenutniMesec;
            channelState.leaderboardDirty = true;
            await sacuvajLeaderboard(chatroomId);
        }
    } catch (err) {
        log('ERR', `Greška pri učitavanju leaderboarda za ${chatroomId}: ${err.message}`);
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
    try {
        const trenutniMesec = dobijTrenutniMesec();

        if (KORISTI_SUPABASE) {
            const dirtyKeys = Object.keys(channelState.leaderboardDeltas).filter(k => channelState.leaderboardDeltas[k] !== 0);

            if (dirtyKeys.length === 0) {
                channelState.leaderboardDirty = false;
                return;
            }

            const { data, error: fetchError } = await supabase
                .from('leaderboard')
                .select('username, display_name, points')
                .eq('channel_id', chatroomId)
                .eq('month', channelState.tekuciMesecLeaderboarda)
                .in('username', dirtyKeys);

            if (fetchError) throw fetchError;

            const dbMap = {};
            if (data) {
                data.forEach(row => {
                    dbMap[row.username.toLowerCase()] = row.points;
                });
            }

            const rowsToUpsert = dirtyKeys.map(key => {
                const dbPoints = dbMap[key] !== undefined ? dbMap[key] : 0;
                const delta = channelState.leaderboardDeltas[key];
                const newPoints = Math.max(0, dbPoints + delta);

                return {
                    channel_id: chatroomId,
                    username: key,
                    display_name: (channelState.leaderboard[key] && channelState.leaderboard[key].username) || key,
                    points: newPoints,
                    month: channelState.tekuciMesecLeaderboarda,
                    updated_at: new Date().toISOString(),
                    _newPoints: newPoints
                };
            });

            const rowsClean = rowsToUpsert.map(({ _newPoints, ...r }) => r);
            const { error: upsertError } = await supabase
                .from('leaderboard')
                .upsert(rowsClean, { onConflict: 'channel_id,username,month' });

            if (upsertError) throw upsertError;

            rowsToUpsert.forEach(row => {
                const key = row.username;
                if (channelState.leaderboard[key]) {
                    channelState.leaderboard[key].count = row._newPoints;
                } else {
                    channelState.leaderboard[key] = {
                        username: row.display_name,
                        count: row._newPoints
                    };
                }
                delete channelState.leaderboardDeltas[key];
            });

            channelState.leaderboardDirty = false;
            log('INFO', `[${channelState.channelUsername || chatroomId}] Leaderboard uspešno sačuvan na Supabase (${rowsClean.length} korisnika).`);
        } else {
            Object.keys(channelState.leaderboardDeltas).forEach(key => {
                if (channelState.leaderboard[key]) {
                    channelState.leaderboard[key].count = Math.max(0, channelState.leaderboard[key].count + channelState.leaderboardDeltas[key]);
                }
                delete channelState.leaderboardDeltas[key];
            });

            const json = {
                mesec: trenutniMesec,
                podaci: channelState.leaderboard
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
                    channelState.leaderboardDirty = false;
                    log('INFO', 'Leaderboard uspešno sačuvan na GitHub Gist.');
                } else {
                    throw new Error(`GitHub API status: ${res.status}`);
                }
            } else {
                fs.writeFileSync(config.LEADERBOARD_FILE, JSON.stringify(json, null, 2), 'utf8');
                channelState.leaderboardDirty = false;
                log('INFO', 'Leaderboard uspešno sačuvan na disk.');
            }
        }
    } catch (err) {
        log('ERR', `Greška pri čuvanju leaderboarda za ${chatroomId}: ${err.message}`);
    }
}

function proveriIResetujMesec(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const trenutniMesec = dobijTrenutniMesec();
    if (channelState.tekuciMesecLeaderboarda && channelState.tekuciMesecLeaderboarda !== trenutniMesec) {
        const stariMesec = channelState.tekuciMesecLeaderboarda;
        log('INFO', `[${channelState.channelUsername || chatroomId}] Novi mesec detektovan tokom rada bota (${stariMesec} -> ${trenutniMesec}). Resetujem leaderboard.`);

        const stariPodaci = {
            mesec: stariMesec,
            podaci: { ...channelState.leaderboard }
        };

        channelState.leaderboard = {};
        channelState.leaderboardDeltas = {};
        channelState.tekuciMesecLeaderboarda = trenutniMesec;

        if (KORISTI_SUPABASE) {
            channelState.leaderboardDirty = false;
        } else {
            channelState.leaderboardDirty = true;
            (async () => {
                if (!config.KORISTI_GIST) {
                    try {
                        const backupFile = path.join(__dirname, '..', `leaderboard_backup_${stariMesec}.json`);
                        fs.writeFileSync(backupFile, JSON.stringify(stariPodaci, null, 2), 'utf8');
                    } catch (e) {
                        log('ERR', `Greška pri čuvanju lokalnog backupa: ${e.message}`);
                    }
                }
                await sacuvajLeaderboard(chatroomId);
            })();
        }
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
    channelState.leaderboardDeltas[key] = (channelState.leaderboardDeltas[key] || 0) + 1;
    channelState.leaderboardDirty = true;
    channelState.lastPointEarned[key] = sada;

    if (!channelState.leaderboardSaveTimer) {
        channelState.leaderboardSaveTimer = setTimeout(() => {
            sacuvajLeaderboard(chatroomId);
            channelState.leaderboardSaveTimer = null;
        }, config.LEADERBOARD_SAVE_INTERVAL_MS);
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
        }
    }
}

// ─── LJUBAV / BRAKOVI ─────────────────────────────────────────────────────────

async function ucitajLjubav(chatroomId) {
    try {
        const channelState = state.getChannelState(chatroomId);
        if (!channelState) return;
        const channelUsername = channelState.channelUsername || chatroomId;
        let json = null;

        if (KORISTI_SUPABASE) {
            log('INFO', `[${channelUsername}] Učitavam ljubavne podatke sa Supabase baze...`);

            const { data: modData, error: modError } = await supabase
                .from('love_modifiers')
                .select('user1, user2, modifier')
                .eq('channel_id', chatroomId);

            if (modError) throw modError;

            const { data: marData, error: marError } = await supabase
                .from('marriages')
                .select('user1, user2, user1_display, user2_display, married_at')
                .eq('channel_id', chatroomId);

            if (marError) throw marError;

            if (modData) {
                modData.forEach(row => {
                    const key = [row.user1, row.user2].sort().join('::');
                    channelState.loveModifiers[key] = row.modifier;
                });
            }

            if (marData) {
                marData.forEach(row => {
                    const key = [row.user1, row.user2].sort().join('::');
                    channelState.marriedCouples[key] = {
                        user1: row.user1_display,
                        user2: row.user2_display,
                        datum: new Date(row.married_at).toLocaleDateString('sr-RS')
                    };
                });
            }

            log('INFO', `[${channelUsername}] Učitani ljubavni podaci sa Supabase (${Object.keys(channelState.loveModifiers).length} modifikatora, ${Object.keys(channelState.marriedCouples).length} brakova).`);
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
                }
            }
        } else {
            if (fs.existsSync(config.LOVE_DATA_FILE)) {
                const data = fs.readFileSync(config.LOVE_DATA_FILE, 'utf8');
                json = JSON.parse(data);
            }
        }

        if (json) {
            if (json.loveModifiers) {
                Object.assign(channelState.loveModifiers, json.loveModifiers);
            }
            if (json.marriedCouples) {
                Object.assign(channelState.marriedCouples, json.marriedCouples);
            }
            log('INFO', `Učitani ljubavni podaci (${Object.keys(channelState.loveModifiers).length} modifikatora, ${Object.keys(channelState.marriedCouples).length} brakova).`);
        }
    } catch (err) {
        log('ERR', `Greška pri učitavanju ljubavnih podataka za ${chatroomId}: ${err.message}`);
    }
}

async function sacuvajLjubav(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || !channelState.loveDirty) return;
    try {
        const json = {
            loveModifiers: channelState.loveModifiers,
            marriedCouples: channelState.marriedCouples
        };

        if (KORISTI_SUPABASE) {
            const rows = Object.entries(channelState.loveModifiers).map(([key, val]) => {
                const [u1, u2] = key.split('::');
                return {
                    channel_id: chatroomId,
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
            channelState.loveDirty = false;
            log('INFO', `[${channelState.channelUsername || chatroomId}] Ljubavni modifikatori uspešno sačuvani na Supabase.`);
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
                channelState.loveDirty = false;
                log('INFO', 'Ljubavni podaci uspešno sačuvani na GitHub Gist.');
            } else {
                throw new Error(`GitHub API status: ${res.status}`);
            }
        } else {
            fs.writeFileSync(config.LOVE_DATA_FILE, JSON.stringify(json, null, 2), 'utf8');
            channelState.loveDirty = false;
            log('INFO', 'Ljubavni podaci uspešno sačuvani na disk.');
        }
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

async function ucitajCustomKomande(chatroomId) {
    try {
        if (!KORISTI_SUPABASE) return;
        const channelState = state.getChannelState(chatroomId);
        if (!channelState) return;
        const channelUsername = channelState.channelUsername || chatroomId;

        log('INFO', `[${channelUsername}] Učitavam custom komande sa Supabase...`);
        const { data, error } = await supabase
            .from('custom_commands')
            .select('command, response, cooldown_ms, enabled')
            .eq('channel_id', chatroomId)
            .eq('enabled', true);

        if (error) throw error;

        channelState.customCommands = {};
        if (data) {
            data.forEach(row => {
                const aliases = row.command.split(',').map(c => c.trim().toLowerCase());
                aliases.forEach(alias => {
                    if (alias) {
                        channelState.customCommands[alias] = {
                            response: row.response,
                            cooldown_ms: row.cooldown_ms || 5000
                        };
                    }
                });
            });
            log('INFO', `[${channelUsername}] Custom komande učitane: ${data.length} redova.`);
        }
    } catch (err) {
        log('ERR', `Greška pri učitavanju custom komandi za ${chatroomId}: ${err.message}`);
    }
}

async function ucitajBotConfig(chatroomId) {
    try {
        if (!KORISTI_SUPABASE) return;
        const channelState = state.getChannelState(chatroomId);
        if (!channelState) return;
        const channelUsername = channelState.channelUsername || 'Nepoznat';

        log('INFO', `[${channelUsername}] Učitavam bot konfiguraciju sa Supabase...`);
        const { data, error } = await supabase
            .from('bot_config')
            .select('*')
            .eq('channel_id', chatroomId)
            .maybeSingle();

        if (error) throw error;

        if (data) {
            // Dinamički override u stanju kanala
            channelState.PREFIX = data.prefix || '!';
            channelState.COOLDOWN_MS = data.cooldown_ms ?? 3000;
            channelState.SPAM_THRESHOLD = data.spam_threshold ?? 3;
            channelState.SPAM_WINDOW_MS = data.spam_window_ms ?? 15000;
            
            if (data.stream_pin_msg) {
                channelState.STREAM_START_PIN_MESSAGE = data.stream_pin_msg;
            } else {
                channelState.STREAM_START_PIN_MESSAGE = '';
            }
            
            channelState.feature_leaderboard = data.feature_leaderboard ?? true;
            channelState.feature_watchtime = data.feature_watchtime ?? true;
            channelState.feature_games = data.feature_games ?? true;
            channelState.feature_love = data.feature_love ?? true;
            channelState.feature_moderation = data.feature_moderation ?? false;
            channelState.feature_autoresponse = data.feature_autoresponse ?? true;
            channelState.welcome_message = data.welcome_message || '';
            
            channelState.botActive = data.bot_active || false;
            channelState.autoAnnounces = Array.isArray(data.auto_announces) ? data.auto_announces : [];
            
            channelState.announce_interval_mins = data.announce_interval_mins ?? 15;
            channelState.announce_message_threshold = data.announce_message_threshold ?? 30;
            channelState.announce_time_enabled = data.announce_time_enabled ?? true;
            channelState.announce_msg_enabled = data.announce_msg_enabled ?? true;
            channelState.moderationSettings = data.moderation_settings || {};

            if (data.channel_name && data.channel_name !== channelState.channelUsername) {
                channelState.channelUsername = data.channel_name;
            }
            
            log('INFO', `[${channelState.channelUsername}] Bot konfiguracija uspešno učitana. Prefix: '${channelState.PREFIX}', Cooldown: ${channelState.COOLDOWN_MS}ms, Aktivnost: ${channelState.botActive}, Auto poruke: ${channelState.autoAnnounces.length}`);
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
    smanjiPoruku,
    ucitajCustomKomande,
    ucitajBotConfig,
    ucitajSveAktivneKanale
};
