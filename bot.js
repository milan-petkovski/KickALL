const WebSocket = require('ws');
const fs        = require('fs');
const path      = require('path');
const http      = require('http');

// ─── KONFIGURACIJA (ne menjaj) ────────────────────────────────────────────────
const CHATROOM_ID      = "93361227";
const CHANNEL_USERNAME = "tutz_live";
const BEARER_TOKEN  = "Bearer 389179658|D3szQX9nsKYknEjj5Umt2AWMcuJcqQjuUWBRkqiv";
const BOT_COOKIE    = `cf_clearance=ezbrEx33FpRWS0tXJTf4NHrcd7Dg850icIOBQH5C9Dc-1782816941-1.2.1.1-apAXO0.n3N6aZ6oE0uSrin1WWmyHnInLsd1TYp08yA.BbvrQ8rE85oZoKop4sHEkgxWsszvObA2TdH3z6erB7l2osQfeFu44rwDayyrc352h3aqLnfWlbC_QeI26s55aDJgM9DtTdK6fzUXh0qpekAp_3JT_bv5EFpsXw2H52_MYa6x6R1mr8JKUYRWwuEzKKIckUxipUI2ivSndTJvzLOC8yv.7jf5YmxDAHp5KM39kQKnuwVqE_lemipl37QhweYACCgaMk7o7AXsgyL5CjEZYmyIfqvkKlkWWNgVcPxwbmATJR17OjL47GS5ePQBXbRngLKwysx0wshofNYjwFQ; KP_UIDz-ssn=0PWTbXafST42PKO5aojj4Q2nFGuqAUPdfktw2jVETfJv3i087Patg1BeqF40lnsNqio3APUGc6ZUybXaiqtmuA8AGR2dU26dV40WZ8A5fbgm4oYFbdmgJPaMObeMjwloi3GNv5dn3Ai8nK8mL2q6S5g3YBnWzD2gASuDIktlMpge; KP_UIDz=0PWTbXafST42PKO5aojj4Q2nFGuqAUPdfktw2jVETfJv3i087Patg1BeqF40lnsNqio3APUGc6ZUybXaiqtmuA8AGR2dU26dV40WZ8A5fbgm4oYFbdmgJPaMObeMjwloi3GNv5dn3Ai8nK8mL2q6S5g3YBnWzD2gASuDIktlMpge; __stripe_mid=6ff5cc8a-fd2d-4319-9221-652c9959bd5dec5dfd; __stripe_sid=44778426-ba6b-48ad-a6c9-4752e04beaec1012e7; session_token=389179658%7CD3szQX9nsKYknEjj5Umt2AWMcuJcqQjuUWBRkqiv; XSRF-TOKEN=eyJpdiI6IkE5SUVrYmJaN3QyRHc1QTRLNEw2OEE9PSIsInZhbHVlIjoiM2wvWFI5cE90TmtvWGdmRFdZTGJGNWF4TEFmcTJocnJRWFRkTTcxM25GZGwvYVpVRy9NbVNYdW1SUmhDNWV0Q2R2YnB3bThqbkxFRHd5RzY1emM2L2JHTEMwcU1VRE4yWFdIT1F5dCtUWHlsbENEWGJFU1hIbFFDV2NOdndRRXQiLCJtYWMiOiI5ZjZiYTFmYmY1MDIwZGFkODZmMjE2OTUyN2Y3YTM5MzExZjg0MTYyNWJhNzdjYzgxNDYyOGVhZDdmNmQzYzJkIiwidGFnIjoiIn0%3D; kick_session=eyJpdiI6ImpDUlBReTJUNncvTEFKanEzN1hORnc9PSIsInZhbHVlIjoiQ2FzaHNUejM1RmlBQWlTSWZzLzZldWJYdzUxanQzc0NLV1dkaGt5a1QxYnpRWm04TVc5NytQd0VjZTh4elNPeE80NUtrdUwxL1pPSHIybGF4ckk1VUc0NW10T0kwcWN3WlBLcEhNR3BidndXd3JlUkdXV1hRWDRHbXNlRHhUbkoiLCJtYWMiOiIzMmU5YTJhMTEyNTMwMzJhMTIyOGRmYmFkM2YwNTU3MzM3NTk2NzE3NTExYzBiZTZlMjQ2OGQwODNkMGNmOTczIiwidGFnIjoiIn0%3D; _iidt=ARhmkhcMA/7pVwxa4hpmWR6TeSs68+EP0mZNZORG3O1uH/QSFtcSNd32H+HsHausQULAWflhB/suMtq3PDny1KXv4zR2+hSaSpOFLWE=; volume=0.5; __cf_bm=cwx_GzqCaSQdnTHURVV6HoFv8uu3uZE_bI3VAgHiDT4-1782816964.9727213-1.0.1.1-7NaKjNHGm9HN1GADKN2_E2jO9pfEujB3yed9x6n1rAreLu4zmV4soil_7HcZQrTXDqHezTpf9qnAES_esLIiD79.6BJrgY_m.ymOVJrVw02xT6f4mukdVALkWp_sYp2i; _cfuvid=I_EG_6TGtC32.Mmi9xxcXqd_SqxL2KYrFSq4RGiIPS0-1782816969.2289946-1.0.1.1-Lnw2FICduTVx3p7lkBKMsJte_T6VJ4JzSQKQxzSen2M; kick:anon-id:v1=33b237ef-4d16-4366-9c6b-65af1508a709; _dd_s=aid=8ce60aab-a6e6-4340-8a99-494bbb7fadc5&logs=1&id=90d08dc4-d7e8-4c15-92bd-5b761f6a5c99&created=1782816960352&expire=1782817932657`;

// ─── BOT PODEŠAVANJA ──────────────────────────────────────────────────────────
const COOLDOWN_MS           = 3000;   // Minimalno vreme između iste komande (ms)
const RECONNECT_BASE_MS     = 3000;   // Početno vreme za reconnect (ms)
const RECONNECT_MAX_MS      = 60000;  // Maksimalno vreme čekanja reconnecta (ms)
const HEARTBEAT_MS          = 25000;  // Koliko često šaljemo ping (ms)
const SPAM_THRESHOLD        = 3;      // Broj identičnih poruka pre upozorenja
const SPAM_WINDOW_MS        = 15000;  // Vremenski prozor za spam detekciju (ms)
const RAPID_MSG_THRESHOLD   = 5;      // Broj bilo kojih poruka za detekciju brzog kucanja
const RAPID_MSG_WINDOW_MS   = 8000;   // Vremenski prozor za brzo kucanje (ms)
const ANNOUNCE_AFTER_MSGS   = 30;     // Broj poruka u chatu pre auto-poruke
const ANNOUNCE_MIN_GAP_MS   = 15 * 60 * 1000; // Min. vreme između dve auto-poruke (15min)

// ─── PORUKE ZA GRUPISANE KOMANDE ──────────────────────────────────────────────
const specPoruka      = '🖥️ Tutz PC Setup: Ryzen 9 5900X | RTX 4080 16GB | 32GB RAM | Asus ROG B550-F | 2.5TB SSD | ROG 750W Gold | Corsair H150i LCD | Ekran: 2x Asus 144Hz | Miš: G502 Hero | Tastatura: Scope RX';
const giveawayPoruka  = '🎁 Tutz Giveaway: https://tutzz.netlify.app/giveaway';
const linktreePoruka  = '🌳 Sve mreže i linkovi: https://tutzz.netlify.app/linktree';
const merchPoruka     = '🛍️ Tutz Merch: https://tutzshop.com';
const instaPoruka     = '📸 Instagram: https://instagram.com/tutzgaming';
const tiktokPoruka    = '🎵 TikTok: https://tiktok.com/@not_tutz';
const youtubePoruka   = '🎥 YouTube: https://youtube.com/@TutzOfficial';
const discordPoruka   = '💬 Discord: https://discord.gg/u3Sf9rTyDt';

// ─── KOMANDE ─────────────────────────────────────────────────────────────────
const komande = {
    // ─── OSNOVNE STRIM KOMANDE ───────────────────────────────────────────────────
    '!ping':        'Pong! Bot radi uspešno. 🚀',
    '!socials':     'Zaprati Tutza na svim mrežama! TikTok, YouTube, Kick, Instagram!',
    '!kick':        'Dobrodošli na strim! Lupite taj Follow ako uživate!',

    // ─── KANAL / EKIPA (GANG) ────────────────────────────────────────────────────
    /*'!tutz':        'Deda matori neradnik',
    '!treshonja':   'Ko je taj lik',
    '!milance':     'Najbolji menadzer Tutz Ganga',
    '!lambana':     'Lamba i Ana Kid se vole najvise na svetu',
    '!lamba':       'Tutzov brat',
    '!sofia':       'Milanova najveća ljubav',
    '!block':       'Sofia unblock plssss',
    '!inaa':        'INAABANK',
    '!anakid':      'Samo ime kaze kid...',
    '!itachi':      'Juri zene al one njega ne',*/
    '!67':          '[emote:5163606:tutz_livesedam][emote:5163606:tutz_livesedam][emote:5163606:tutz_livesedam]',

    // ─── DRUŠTVENE MREŽE & PROMO (SA SAJTA) ───────────────────────────────────────
    '!linktree':    linktreePoruka,
    '!socijalne':   linktreePoruka,
    '!discord':     discordPoruka,
    '!dc':          discordPoruka,
    '!instagram':   instaPoruka,
    '!ig':          instaPoruka,
    '!tiktok':      tiktokPoruka,
    '!tt':          tiktokPoruka,
    '!youtube':     youtubePoruka,
    '!yt':          youtubePoruka,
    '!viber':       '📱 Viber grupa: https://tutzz.netlify.app/viber',

    // ─── HARDWARE / SETUP ────────────────────────────────────────────────────────
    '!specs':       specPoruka,
    '!setup':       specPoruka,
    '!pc':          specPoruka,

    // ─── SHOP & MERCH ────────────────────────────────────────────────────────────
    '!shop':        merchPoruka,
    '!merch':       merchPoruka,

    // ─── PARTNERSTVA & SPONZORI ──────────────────────────────────────────────────
    '!sponzori':    '🔥 Sponzori: NORO (popust: https://noro.rs/?aff_id=22), TEMU (popust: https://temu.to/k/ex8gi9wpj14), Waterdrop i OBSBOT.',
    '!noro':        '🥤 NORO (popust preko linka): Noro Srbija (https://noro.rs/?aff_id=22) | Noro Balkan/EU (https://noro.eu/?aff_id=22)',

    // ─── NAGRADNE IGRE ───────────────────────────────────────────────────────────
    '!giveaway':    giveawayPoruka,
    '!gw':          giveawayPoruka,

    // ─── LISTA SVIH KOMANDI ───────────────────────────────────────────────────────
    '!komande':     '🤖 Komande: !socials, !pc, !gw, !merch, !sponzori, !viber, !igra, !uptime, !vreme <grad>, !love, !duel, !brakovi, !top, !stats, !info',
};

// Automatske poruke koje bot rotira (neće iste dve izaći jedna za drugom)
const AUTO_PORUKE = [
    'Zaprati Tutza na Kicku da ne propustiš ni jedan stream! 📲',
    'Koristi kod tutz na sajtovima ako imaš više od 18 godina! 💰',
    '🎁 Učestvuj u Tutz Giveaway-u za Brawl Stars nagrade: https://tutzz.netlify.app/giveaway',
    '🛍️ Kupi oficijalni Tutz Merch i podrži kanal: https://tutzshop.com',
    '💬 Pridruži se našoj Discord zajednici: https://discord.gg/u3Sf9rTyDt',
    '📱 Upadni u Viber grupu i druži se sa ekipom: https://tutzz.netlify.app/viber',
    '🌳 Sve Tutzove društvene mreže i linkovi: https://tutzz.netlify.app/linktree',
    '🥤 Podrži kanal i kupi Noro osvežavajuće napitke: https://noro.rs/?aff_id=22',
    'Uživajte na strimu i poštujte pravila chata da ne dobijete timeout! 🚫',
    'Tip: Upotrebi !komande da vidiš šta sve bot može! 🤖'
];

// ─── STANJE BOTA ─────────────────────────────────────────────────────────────
let ws               = null;
let reconnectAttempt = 0;
let heartbeatTimer   = null;
let isConnected      = false;

// Cooldown tracker: { komanda: lastUsedTimestamp }
const cooldowns = {};

// Cooldown tracker za ljubav/hejt: { username: lastUsedTimestamp }
const loveHateCooldowns = {};
const LOVE_HATE_COOLDOWN_MS = 5 * 60 * 60 * 1000; // 5 sati

// Spam tracker: { username::message: [timestamp, timestamp, ...] }
const spamTracker = {};

// Rapid messaging tracker: { username: [timestamp, timestamp, ...] }
const rapidTracker = {};

// Last warning tracker: { username: timestamp }
const lastWarned = {};

// Love modifiers: { 'user1::user2': offset_value }
const loveModifiers = {};

// Married couples: { 'user1::user2': true }
const marriedCouples = {};

// Leaderboard state
let leaderboard          = {};
let leaderboardDirty     = false;
let leaderboardSaveTimer = null;
let tekuciMesecLeaderboarda = '';
const LEADERBOARD_FILE   = path.join(__dirname, 'leaderboard.json');

// GitHub Gist konfiguracija za čuvanje podataka na Renderu
const GITHUB_TOKEN       = process.env.GITHUB_TOKEN;
const GIST_ID            = process.env.GIST_ID;
const KORISTI_GIST       = !!(GITHUB_TOKEN && GIST_ID);

// Message Queue state
const messageQueue       = [];
let isProcessingQueue    = false;

// API Caching state
let cachedIgra           = null;
let cachedIgraTs         = 0;
const weatherCache       = {};
const CACHE_TTL_MS       = 60 * 1000;      // 1 minut keširanja za Kick API
const WEATHER_TTL_MS     = 5 * 60 * 1000;  // 5 minuta keširanja za vreme (wttr.in)

// Ručne komande za strimera (Fallback u slučaju 403 greške od Cloudflare-a)
let manualGameName       = '';
let manualStreamStartTs  = 0;

// Auto-announce state
let porukePosleAnnounce  = 0;   // brojac poruka od poslednje auto-poruke
let zadnjaAutoPorukaTs   = 0;   // timestamp poslednje auto-poruke
let zadnjiAutoPorukaIdx  = -1;  // index poslednje poslate auto-poruke
let isStreamLive         = false; // da li je strim trenutno aktivan

// ─── POMOĆNE FUNKCIJE ─────────────────────────────────────────────────────────
function log(tip, poruka) {
    const vreme = new Date().toLocaleTimeString('sr-RS', { hour12: false });
    const boje = { BOT: '\x1b[36m', CHAT: '\x1b[32m', INFO: '\x1b[33m', ERR: '\x1b[31m', WARN: '\x1b[35m' };
    const boja = boje[tip] || '\x1b[37m';
    console.log(`\x1b[90m[${vreme}]\x1b[0m ${boja}[${tip}]\x1b[0m ${poruka}`);
}

async function fetchKickAPI(url) {
    const { gotScraping } = await import('got-scraping');
    try {
        const response = await gotScraping({
            url: url,
            responseType: 'json',
            headers: {
                'cookie': BOT_COOKIE,
                'authorization': BEARER_TOKEN
            },
            retry: { limit: 0 }
        });
        
        return {
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            json: async () => response.body,
            text: async () => JSON.stringify(response.body)
        };
    } catch (error) {
        log('ERR', `gotScraping greška za ${url}: ${error.message}`);
        return {
            ok: false,
            status: error.response ? error.response.statusCode : 500,
            json: async () => { throw new Error(error.message); },
            text: async () => error.message
        };
    }
}

// ─── LEADERBOARD SISTEM ──────────────────────────────────────────────────────
function dobijTrenutniMesec() {
    const d = new Date();
    const godina = d.getFullYear();
    const mesec = String(d.getMonth() + 1).padStart(2, '0');
    return `${godina}-${mesec}`;
}

async function ucitajLeaderboard() {
    try {
        let json = null;

        if (KORISTI_GIST) {
            log('INFO', `Učitavam leaderboard sa GitHub Gist-a (${GIST_ID})...`);
            const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
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
            // Lokalni fajl sistem fallback
            if (fs.existsSync(LEADERBOARD_FILE)) {
                const data = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
                json = JSON.parse(data);
            }
        }

        const trenutniMesec = dobijTrenutniMesec();
        
        if (json) {
            if (json.mesec && json.mesec !== trenutniMesec) {
                log('INFO', `Detektovan novi mesec (${json.mesec} -> ${trenutniMesec}). Resetujem leaderboard.`);
                
                const stariMesec = json.mesec;
                if (!KORISTI_GIST) {
                    const backupFile = path.join(__dirname, `leaderboard_backup_${stariMesec}.json`);
                    fs.writeFileSync(backupFile, JSON.stringify(json, null, 2), 'utf8');
                } else {
                    await sacuvajBackupUGist(stariMesec, json);
                }

                leaderboard = {};
                tekuciMesecLeaderboarda = trenutniMesec;
                leaderboardDirty = true;
                await sacuvajLeaderboard();
            } else {
                leaderboard = json.podaci || {};
                tekuciMesecLeaderboarda = json.mesec || trenutniMesec;
                log('INFO', `Učitan leaderboard za mesec: ${tekuciMesecLeaderboarda} (${Object.keys(leaderboard).length} aktivnih korisnika)`);
            }
        } else {
            leaderboard = {};
            tekuciMesecLeaderboarda = trenutniMesec;
            leaderboardDirty = true;
            await sacuvajLeaderboard();
        }
    } catch (err) {
        log('ERR', `Greška pri učitavanju leaderboarda: ${err.message}`);
        leaderboard = {};
        tekuciMesecLeaderboarda = dobijTrenutniMesec();
    }
}

async function sacuvajBackupUGist(mesec, stariPodaci) {
    try {
        log('INFO', `Čuvam backup za mesec ${mesec} na GitHub Gist...`);
        const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            method: 'PATCH',
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
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

async function sacuvajLeaderboard() {
    if (!leaderboardDirty) return;
    try {
        const trenutniMesec = dobijTrenutniMesec();
        const json = {
            mesec: trenutniMesec,
            podaci: leaderboard
        };

        if (KORISTI_GIST) {
            const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
                method: 'PATCH',
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
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
                leaderboardDirty = false;
                log('INFO', 'Leaderboard uspešno sačuvan na GitHub Gist.');
            } else {
                throw new Error(`GitHub API status: ${res.status}`);
            }
        } else {
            fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(json, null, 2), 'utf8');
            leaderboardDirty = false;
            log('INFO', 'Leaderboard uspešno sačuvan na disk.');
        }
    } catch (err) {
        log('ERR', `Greška pri čuvanju leaderboarda: ${err.message}`);
    }
}

function proveriIResetujMesec() {
    const trenutniMesec = dobijTrenutniMesec();
    if (tekuciMesecLeaderboarda && tekuciMesecLeaderboarda !== trenutniMesec) {
        const stariMesec = tekuciMesecLeaderboarda;
        log('INFO', `Novi mesec detektovan tokom rada bota (${stariMesec} -> ${trenutniMesec}). Resetujem leaderboard.`);
        
        const stariPodaci = {
            mesec: stariMesec,
            podaci: { ...leaderboard }
        };

        leaderboard = {};
        tekuciMesecLeaderboarda = trenutniMesec;
        leaderboardDirty = true;

        // Pozadinski async proces za backup i čuvanje da ne blokira chat nit
        (async () => {
            if (KORISTI_GIST) {
                await sacuvajBackupUGist(stariMesec, stariPodaci);
            } else {
                try {
                    const backupFile = path.join(__dirname, `leaderboard_backup_${stariMesec}.json`);
                    fs.writeFileSync(backupFile, JSON.stringify(stariPodaci, null, 2), 'utf8');
                } catch (e) {
                    log('ERR', `Greška pri čuvanju lokalnog backupa: ${e.message}`);
                }
            }
            await sacuvajLeaderboard();
        })();
    }
}

function evidentirajPoruku(username) {
    const key = username.toLowerCase();
    proveriIResetujMesec();

    if (!leaderboard[key]) {
        leaderboard[key] = {
            username: username,
            count: 0
        };
    }
    leaderboard[key].count++;
    leaderboard[key].username = username; // Ažuriramo case u slučaju da se promenio
    leaderboardDirty = true;

    // Odloženo upisivanje na disk (svakih 10 sekundi) da ne opterećujemo disk pri svakoj poruci
    if (!leaderboardSaveTimer) {
        leaderboardSaveTimer = setTimeout(() => {
            sacuvajLeaderboard();
            leaderboardSaveTimer = null;
        }, 10000);
    }
}

function smanjiPoruku(username, iznos) {
    const key = username.toLowerCase();
    if (leaderboard[key]) {
        leaderboard[key].count = Math.max(0, leaderboard[key].count - iznos);
        leaderboardDirty = true;

        if (!leaderboardSaveTimer) {
            leaderboardSaveTimer = setTimeout(() => {
                sacuvajLeaderboard();
                leaderboardSaveTimer = null;
            }, 10000);
        }
    }
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
        }
    }, HEARTBEAT_MS);
}

// ─── WEBSOCKET KONEKCIJA ──────────────────────────────────────────────────────
function povezi() {
    log('INFO', `Pokušavam konekciju... (pokušaj #${reconnectAttempt + 1})`);

    ws = new WebSocket(
        'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.5.0&flash=false'
    );

    ws.on('open', () => {
        log('INFO', 'Povezan na Kick server. Šaljem zahtev za pretplatu na chat...');
        reconnectAttempt = 0;
        isConnected = true;

        ws.send(JSON.stringify({
            event: 'pusher:subscribe',
            data: { channel: `chatrooms.${CHATROOM_ID}.v2` }
        }));

        startHeartbeat();
    });

    ws.on('message', (data) => {
        let response;
        try {
            response = JSON.parse(data);
        } catch {
            return;
        }

        // Odgovaramo na Pusher ping
        if (response.event === 'pusher:ping') {
            ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
            return;
        }

        // Potvrda pretplate
        if (response.event === 'pusher_internal:subscription_succeeded') {
            log('INFO', 'Uspešno pretplaćen na chat! Bot aktivno sluša poruke... 👀');
            return;
        }

        // Nova chat poruka
        if (response.event === 'App\\Events\\ChatMessageEvent') {
            let chatData;
            try {
                chatData = JSON.parse(response.data);
            } catch {
                return;
            }

            const poruka   = chatData.content.trim();
            const username = chatData.sender.username;
            const isBotMsg = chatData.sender.is_bot || false;

            // Logujemo samo poruke drugih korisnika (da ne bismo duplirali poruke bota u konzoli)
            if (username.toLowerCase() !== 'tutzonja') {
                log('CHAT', `${username}: ${poruka}`);
            }

            // Preskačemo sopstvene poruke, strimera i poznate botove
            const userKey = username.toLowerCase();
            if (isBotMsg || userKey === 'tutzonja' || userKey === 'botrix' || userKey === 'nightbot' || userKey === 'streamelements' || userKey === 'streamlabs' || userKey === CHANNEL_USERNAME.toLowerCase()) {
                return;
            }

            // ── Anti-spam filter ───────────────────────────────────────────────
            if (spamFilter(username, poruka)) return;

            // Evidentiraj poruku u leaderboardu aktivnosti (komande sa ! se ne računaju)
            if (!poruka.startsWith('!')) {
                evidentirajPoruku(username);
            }

            const porukaLower = poruka.toLowerCase();

            // ── Pozdrav na tag bota ─────────────────────────────────────────────
            if (porukaLower.includes('@tutzonja')) {
                const pozdravi = ['cao', 'ćao', 'pozdrav', 'zdravo', 'hej', 'hi', 'hello', 'desi', 'de si', 'jesi tu', 'gde si'];
                const imaPozdrav = pozdravi.some(rec => porukaLower.includes(rec));
                if (imaPozdrav) {
                    if (!proveraKulauna('bot_tag_welcome', username)) {
                        const odgovori = [
                            `Ćao @${username}! Kako si danas? 😊`,
                            `Hej @${username}! Tu sam, pratim strim i družim se sa vama! 🔥`,
                            `Pozdrav @${username}! Uživaj u lajvu! 👑`,
                            `Zdravo @${username}! Šta ima kod tebe? 👋`
                        ];
                        const tekst = odgovori[Math.floor(Math.random() * odgovori.length)];
                        posaljiPoruku(tekst);
                        return; // Prekidamo dalju obradu jer je na pozdrav odgovoreno
                    }
                }
            }

            // ── Auto-announce brojač ────────────────────────────────────────────
            if (isStreamLive) {
                porukePosleAnnounce++;
                if (porukePosleAnnounce >= ANNOUNCE_AFTER_MSGS) {
                    const sada = Date.now();
                    if (sada - zadnjaAutoPorukaTs >= ANNOUNCE_MIN_GAP_MS) {
                        triggerAutoAnnounce();
                    }
                }
            }

            // ── Dinamičke komande ────────────────────────────────────────────

            if (porukaLower.startsWith('!vreme ')) {
                const grad = poruka.slice(7).trim();
                if (grad) {
                    if (proveraKulauna('!vreme', username)) return;
                    handleVreme(grad);
                } else {
                    posaljiPoruku('Upotreba: !vreme <naziv grada> — npr. !vreme Beograd');
                }
                return;
            }

            if (porukaLower === '!uptime') {
                if (proveraKulauna('!uptime', username)) return;
                handleUptime();
                return;
            }

            if (porukaLower === '!igra') {
                if (proveraKulauna('!igra', username)) return;
                handleIgra();
                return;
            }

            if (porukaLower.startsWith('!duel ')) {
                const meta = poruka.slice(6).trim();
                if (proveraKulauna('!duel', username)) return;
                handleDuel(username, meta);
                return;
            }

            if (porukaLower === '!info') {
                if (proveraKulauna('!info', username)) return;
                handleInfo();
                return;
            }

            if (porukaLower.startsWith('!love')) {
                const args = poruka.slice(5).trim();
                if (proveraKulauna('!love', username)) return;
                handleLove(username, args);
                return;
            }

            if (porukaLower.startsWith('!posaljiljubav ')) {
                const target = poruka.slice(15).trim();
                const userKey = username.toLowerCase();
                const sada = Date.now();
                const zadnji = loveHateCooldowns[userKey] || 0;
                
                if (sada - zadnji < LOVE_HATE_COOLDOWN_MS) {
                    const preostaloMs = LOVE_HATE_COOLDOWN_MS - (sada - zadnji);
                    const sati = Math.floor(preostaloMs / 3600000);
                    const minuti = Math.floor((preostaloMs % 3600000) / 60000);
                    
                    let preostaloTekst = '';
                    if (sati > 0) preostaloTekst += `${sati}h `;
                    preostaloTekst += `${minuti}min`;
                    
                    posaljiPoruku(`❌ @${username}, cooldown: ${preostaloTekst}.`);
                    return;
                }
                
                const uspesno = handleModifyLove(username, target, 10);
                if (uspesno) {
                    loveHateCooldowns[userKey] = sada;
                }
                return;
            }

            if (porukaLower.startsWith('!bacihejt ')) {
                const target = poruka.slice(10).trim();
                const userKey = username.toLowerCase();
                const sada = Date.now();
                const zadnji = loveHateCooldowns[userKey] || 0;
                
                if (sada - zadnji < LOVE_HATE_COOLDOWN_MS) {
                    const preostaloMs = LOVE_HATE_COOLDOWN_MS - (sada - zadnji);
                    const sati = Math.floor(preostaloMs / 3600000);
                    const minuti = Math.floor((preostaloMs % 3600000) / 60000);
                    
                    let preostaloTekst = '';
                    if (sati > 0) preostaloTekst += `${sati}h `;
                    preostaloTekst += `${minuti}min`;
                    
                    posaljiPoruku(`❌ @${username}, cooldown: ${preostaloTekst}.`);
                    return;
                }
                
                const uspesno = handleModifyLove(username, target, -10);
                if (uspesno) {
                    loveHateCooldowns[userKey] = sada;
                }
                return;
            }

            if (porukaLower.startsWith('!vencaj ')) {
                const target = poruka.slice(8).trim();
                if (proveraKulauna('!vencaj', username)) return;
                handleVencaj(username, target);
                return;
            }

            if (porukaLower.startsWith('!razvod ')) {
                const target = poruka.slice(8).trim();
                if (proveraKulauna('!razvod', username)) return;
                handleRazvod(username, target);
                return;
            }

            if (porukaLower === '!brakovi' || porukaLower === '!brak') {
                if (proveraKulauna('!brakovi', username)) return;
                handleBrakovi();
                return;
            }

            // ── Leaderboard komande ──────────────────────────────────────────
            if (porukaLower === '!top' || porukaLower === '!leaderboard') {
                if (proveraKulauna('!top', username)) return;
                handleTop();
                return;
            }

            if (porukaLower === '!aktivnost' || porukaLower === '!stats') {
                if (proveraKulauna('!aktivnost', username)) return;
                handleAktivnost(username);
                return;
            }

            if (porukaLower === '!resetleaderboard') {
                const isBroadcaster = username.toLowerCase() === CHANNEL_USERNAME.toLowerCase() || 
                                      (chatData.sender.identity && 
                                       chatData.sender.identity.badges && 
                                       chatData.sender.identity.badges.some(b => b.type === 'broadcaster'));
                handleResetLeaderboard(username, isBroadcaster);
                return;
            }

            if (porukaLower.startsWith('!setlive ')) {
                const isBroadcaster = username.toLowerCase() === CHANNEL_USERNAME.toLowerCase() || 
                                      (chatData.sender.identity && 
                                       chatData.sender.identity.badges && 
                                       chatData.sender.identity.badges.some(b => b.type === 'broadcaster'));
                if (isBroadcaster) {
                    const val = poruka.slice(9).trim().toLowerCase();
                    if (val === 'true') {
                        isStreamLive = true;
                        manualStreamStartTs = Date.now();
                        posaljiPoruku('🔴 Status strima je ručno podešen na: LIVE.');
                    } else if (val === 'false') {
                        isStreamLive = false;
                        manualStreamStartTs = 0;
                        posaljiPoruku('⚪ Status strima je ručno podešen na: OFFLINE.');
                    } else {
                        posaljiPoruku('Upotreba: !setlive true ili !setlive false');
                    }
                }
                return;
            }

            if (porukaLower.startsWith('!setgame ')) {
                const isBroadcaster = username.toLowerCase() === CHANNEL_USERNAME.toLowerCase() || 
                                      (chatData.sender.identity && 
                                       chatData.sender.identity.badges && 
                                       chatData.sender.identity.badges.some(b => b.type === 'broadcaster'));
                if (isBroadcaster) {
                    const game = poruka.slice(9).trim();
                    if (game) {
                        manualGameName = game;
                        posaljiPoruku(`🎮 Igra je ručno podešena na: ${game}`);
                    } else {
                        posaljiPoruku('Upotreba: !setgame <naziv igre>');
                    }
                }
                return;
            }

            // ── Statičke komande ─────────────────────────────────────────────
            const kljuc = Object.keys(komande).find(
                k => k.toLowerCase() === poruka.toLowerCase()
            );

            if (!kljuc) return;

            // Cooldown provera
            const sada = Date.now();
            const zadnji = cooldowns[kljuc] || 0;
            if (sada - zadnji < COOLDOWN_MS) {
                const preostalo = ((COOLDOWN_MS - (sada - zadnji)) / 1000).toFixed(1);
                log('WARN', `Komanda ${kljuc} na cooldown-u još ${preostalo}s`);
                return;
            }

            cooldowns[kljuc] = sada;
            posaljiPoruku(komande[kljuc]);
        }
    });

    ws.on('close', (kod, razlog) => {
        isConnected = false;
        stopHeartbeat();
        const opis = razlog ? ` (${razlog})` : '';
        log('WARN', `Veza prekinuta (kod: ${kod})${opis}`);
        scheduleReconnect();
    });

    ws.on('error', (greska) => {
        log('ERR', `WebSocket greška: ${greska.message}`);
    });
}

function scheduleReconnect() {
    const cekanje = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt), RECONNECT_MAX_MS);
    reconnectAttempt++;
    log('INFO', `Pokušavam ponovo za ${(cekanje / 1000).toFixed(1)}s...`);
    setTimeout(povezi, cekanje);
}

// ─── COOLDOWN HELPER ─────────────────────────────────────────────────────────
function proveraKulauna(kljuc, username) {
    const sada   = Date.now();
    const zadnji = cooldowns[kljuc] || 0;
    if (sada - zadnji < COOLDOWN_MS) {
        const preostalo = ((COOLDOWN_MS - (sada - zadnji)) / 1000).toFixed(1);
        log('WARN', `[${username}] Komanda ${kljuc} na cooldown-u još ${preostalo}s`);
        return true;
    }
    cooldowns[kljuc] = sada;
    return false;
}

// ─── DINAMIČKE KOMANDE ────────────────────────────────────────────────────────

// !duel @user — random dvoboj između dva korisnika
function handleDuel(challenger, meta) {
    // Meta može biti "@user" ili samo "user"
    const opponent = meta.replace(/^@/, '').trim();
    if (!opponent || opponent.toLowerCase() === challenger.toLowerCase()) {
        posaljiPoruku(`${challenger}, ne možeš da se boriš sam sa sobom! 😄 Tag-uj nekog!`);
        return;
    }

    const pobednik = Math.random() < 0.5 ? challenger : opponent;
    const gubitnik = pobednik === challenger ? opponent : challenger;
    const rezultati = [
        `⚔️ ${challenger} vs ${opponent} — ${pobednik} pobedio sa 100-0! ${gubitnik} ništa nije uradio. 💥`,
        `🥊 ${challenger} vs ${opponent} — ${pobednik} nokaut u prvoj rundi! ${gubitnik} pada na pod. 💥`,
        `🎯 ${challenger} vs ${opponent} — ${pobednik} headshot iz prvog metka! ${gubitnik} respawn za 30s. 💀`,
        `🔫 ${challenger} vs ${opponent} — ${pobednik} wins FATALITY! ${gubitnik} — get rekt. 😈`,
        `⚡ ${challenger} vs ${opponent} — ${pobednik} je prebrz, ${gubitnik} nije ni video šta ga je snašlo! 🐈`,
        `🛡️ ${challenger} vs ${opponent} — ${gubitnik} je pokušao da blokira, ali ga je ${pobednik} razneo jednim udarcem! 🌪️`,
        `💨 ${challenger} vs ${opponent} — ${gubitnik} je pobegao sa megdana, pa je ${pobednik} proglašen za šampiona! 🏃💨`,
        `🧙‍♂️ ${challenger} vs ${opponent} — ${pobednik} je bacio magiju i pretvorio ${gubitnik}-a u žabu! 🐸`,
        `🦴 ${challenger} vs ${opponent} — ${pobednik} je slomio ruku i nogu ${gubitnik}-u. Totalna dominacija! 🔥`,
        `🍌 ${challenger} vs ${opponent} — ${gubitnik} se okliznuo na bananu i sam sebe eliminisao, ${pobednik} slavi! 🍌`,
        `🎮 ${challenger} vs ${opponent} — ${pobednik} je iskoristio cheat code i pobedio u sekundi! EZ PZ za ${pobednik}-a.`,
        `🦖 ${challenger} vs ${opponent} — ${pobednik} je prizvao T-Rexa koji je pojeo ${gubitnik}-a za doručak! 🦕`
    ];
    const poruka = rezultati[Math.floor(Math.random() * rezultati.length)];
    posaljiPoruku(poruka);
}

// ─── ANTI-SPAM FILTER ────────────────────────────────────────────────────────────
// Vraća true ako je spam (treba zaustaviti dalju obradu poruke)
function spamFilter(username, poruka) {
    const sada  = Date.now();
    const userKey = username.toLowerCase();
    
    // ── 1. Provera identičnih poruka ──────────────────────────────────────────
    const kljucIdenticna = `${username}::${poruka.toLowerCase()}`;
    if (!spamTracker[kljucIdenticna]) spamTracker[kljucIdenticna] = [];
    spamTracker[kljucIdenticna] = spamTracker[kljucIdenticna].filter(t => sada - t < SPAM_WINDOW_MS);
    spamTracker[kljucIdenticna].push(sada);
    const countIdenticna = spamTracker[kljucIdenticna].length;

    // ── 2. Provera brzog kucanja (bilo kojih poruka) ──────────────────────────
    if (!rapidTracker[userKey]) rapidTracker[userKey] = [];
    rapidTracker[userKey] = rapidTracker[userKey].filter(t => sada - t < RAPID_MSG_WINDOW_MS);
    rapidTracker[userKey].push(sada);
    const countRapid = rapidTracker[userKey].length;

    const zadnjeUpozorenje = lastWarned[userKey] || 0;

    // Ako je dostignut limit za identične poruke
    if (countIdenticna === SPAM_THRESHOLD) {
        smanjiPoruku(username, SPAM_THRESHOLD - 1);
        porukePosleAnnounce = Math.max(0, porukePosleAnnounce - (SPAM_THRESHOLD - 1));

        if (sada - zadnjeUpozorenje > SPAM_WINDOW_MS) {
            posaljiPoruku(`@${username} molim te ne spam-uj u chatu! 🙏`);
            lastWarned[userKey] = sada;
            log('WARN', `Anti-spam: upozoren ${username} (${countIdenticna}x ista poruka)`);
        } else {
            log('WARN', `Anti-spam: preskočeno duplirano upozorenje za ${username}`);
        }
        return true;
    }

    if (countIdenticna > SPAM_THRESHOLD) {
        log('WARN', `Anti-spam: blokirano od ${username} (${countIdenticna}x ista poruka)`);
        return true;
    }

    // Ako je dostignut limit za brzo kucanje (bilo koje poruke)
    if (countRapid === RAPID_MSG_THRESHOLD) {
        smanjiPoruku(username, RAPID_MSG_THRESHOLD - 1);
        porukePosleAnnounce = Math.max(0, porukePosleAnnounce - (RAPID_MSG_THRESHOLD - 1));

        if (sada - zadnjeUpozorenje > SPAM_WINDOW_MS) {
            posaljiPoruku(`@${username} molim te ne spam-uj u chatu! 🙏`);
            lastWarned[userKey] = sada;
            log('WARN', `Anti-spam: upozoren ${username} (${countRapid}x brze poruke)`);
        } else {
            log('WARN', `Anti-spam: preskočeno duplirano upozorenje za ${username}`);
        }
        return true;
    }

    if (countRapid > RAPID_MSG_THRESHOLD) {
        log('WARN', `Anti-spam: blokirano od ${username} (${countRapid}x brze poruke)`);
        return true;
    }

    return false;
}

// ─── AUTO ANNOUNCE ────────────────────────────────────────────────────────────
function triggerAutoAnnounce() {
    // Biramo random poruku, ali ne istu kao prethodna
    let idx;
    do {
        idx = Math.floor(Math.random() * AUTO_PORUKE.length);
    } while (idx === zadnjiAutoPorukaIdx && AUTO_PORUKE.length > 1);

    posaljiPoruku(AUTO_PORUKE[idx]);
    zadnjiAutoPorukaIdx = idx;
    zadnjaAutoPorukaTs  = Date.now();
    porukePosleAnnounce = 0;
    log('INFO', `Auto-announce poslata: #${idx}`);
}

// ─── DYNAMIC INFO ─────────────────────────────────────────────────────────────
const INFO_FACTS = [
    "U bus može da stane 250 ljudi.",
    "Prosečan oblak je težak oko 500 tona (oko 100 slonova). ☁️",
    "Prva kompjuterska igra napravljena je 1961. godine i zvala se Spacewar! 🎮",
    "Hobotnice imaju tri srca i plavu krv. 🐙",
    "Kola-kola bi bila zelene boje da joj se ne dodaje veštačka boja. 🥤",
    "Med se nikada ne kvari. Možeš jesti med star 3000 godina i biće skroz u redu. 🍯",
    "Bananama je potrebno oko 9 meseci da potpuno sazru na drvetu. 🍌",
    "Najkraći rat u istoriji trajao je samo 38 minuta (Zanzibar protiv Velike Britanije). ⚔️",
    "Ljudsko oko može da razlikuje oko 10 miliona različitih boja. 👁️",
    "Zvuk putuje oko 4 puta brže kroz vodu nego kroz vazduh. 🔊",
    "Jastuci vremenom akumuliraju mrtvu kožu i grinje — posle 2 godine trećina težine jastuka su oni. 🛏️",
    "Jagoda zapravo tehnički nije bobica, ali lubenica jeste. 🍉",
    "Zemlja je jedina planeta u našem sunčevom sistemu koja nije dobila ime po nekom rimskom ili grčkom božanstvu. 🌍",
    "Psi mogu da razumeju do 250 reči i gestova, što ih čini pametnim kao dvogodišnje dete. 🐶",
    "Prvobitni fen za kosu bio je ogroman i spojen sa usisivačem. 💨",
    "Postoji više mogućih partija šaha nego što ima atoma u poznatom univerzumu. ♟️",
    "Najduži zabeleženi let kokoške trajao je samo 13 sekundi. 🐔",
    "Leptiri osećaju ukus preko svojih nogu. 🦋",
    "Kečap se u 19. veku prodavao kao lek protiv lošeg varenja. 🍅",
    "Ajfelov toranj može biti viši i do 15 cm tokom leta zbog širenja metala na vrućini. 🗼",
    "Prve papirne novčanice napravljene su u Kini pre više od 1400 godina. 💵",
    "Koale spavaju u proseku od 18 do 22 sata dnevno kako bi svarile hranu. 🐨",
    "Flamingosi dobijaju svoju roze boju od hrane koju jedu (škampi i alge). 🦩",
    "U celom svetu postoji više plastičnih flaminga nego pravih živih ptica. 🦩",
    "Otvarač za konzerve izmišljen je čak 48 godina nakon što su same konzerve puštene u prodaju. 🥫"
];

let zadnjiInfoIdx = -1;

function handleInfo() {
    let idx;
    do {
        idx = Math.floor(Math.random() * INFO_FACTS.length);
    } while (idx === zadnjiInfoIdx && INFO_FACTS.length > 1);

    zadnjiInfoIdx = idx;
    posaljiPoruku(`💡 Zanimljivost: ${INFO_FACTS[idx]}`);
}

// ─── LJUBAVNI KALKULATOR ──────────────────────────────────────────────────────
function handleLove(sender, args) {
    if (!args) {
        posaljiPoruku('Upotreba: !love @user1 @user2 ili !love @user');
        return;
    }

    const delovi = args.split(/\s+/).filter(Boolean);
    let user1 = '';
    let user2 = '';

    if (delovi.length === 1) {
        user1 = sender;
        user2 = delovi[0];
    } else {
        user1 = delovi[0];
        user2 = delovi[1];
    }

    // Čišćenje @ karaktera
    const u1 = user1.replace(/^@/, '').trim();
    const u2 = user2.replace(/^@/, '').trim();

    if (!u1 || !u2) {
        posaljiPoruku('Upotreba: !love @user1 @user2 ili !love @user');
        return;
    }

    if (u1.toLowerCase() === u2.toLowerCase()) {
        posaljiPoruku(`❤️ Ljubav prema samom sebi? To je uvek 100%! 🥰 Bravo @${u1}, ceni sebe!`);
        return;
    }

    // Učitaj bazu i modifikator
    const kljucMod = [u1.toLowerCase(), u2.toLowerCase()].sort().join('::');
    const baza = getDefaultLove(u1, u2);
    const modifikator = loveModifiers[kljucMod] || 0;

    let procenat = baza + modifikator;
    procenat = Math.max(0, Math.min(100, procenat)); // Držimo procenat između 0 i 100

    let komentar = '';
    if (procenat <= 15) {
        komentar = 'Nema tu hleba... 😭💔';
    } else if (procenat <= 35) {
        komentar = 'Prijateljska zona (Friendzone) 5/5. Više sreće drugi put. 🤝';
    } else if (procenat <= 60) {
        komentar = 'Ima nekih varnica, ali duva vetar pa ih gasi. Radite na tome! 💨⚡';
    } else if (procenat <= 85) {
        komentar = 'Opa! Ovde se nešto ozbiljno kuva. Spremajte odelo za svadbu! 🤵👰';
    } else {
        komentar = 'Savršen par, čista hemija i večna ljubav! ❤️🔥';
    }

    posaljiPoruku(`❤️ Ljubavni Kalkulator: @${u1} + @${u2} = ${procenat}% | Komentar: ${komentar}`);
}

// ─── MODIFIKACIJA LJUBAVI ─────────────────────────────────────────────────────
function handleModifyLove(sender, targetRaw, amount) {
    const target = targetRaw.replace(/^@/, '').trim();
    if (!target) {
        posaljiPoruku('Upotreba: !posaljiljubav @user ili !bacihejt @user');
        return false;
    }

    const sLower = sender.toLowerCase();
    const tLower = target.toLowerCase();

    if (sLower === tLower) {
        posaljiPoruku(`@${sender}, ne možeš modifikovati ljubav prema samom sebi! 😄`);
        return false;
    }

    const kljucMod = [sLower, tLower].sort().join('::');
    if (!loveModifiers[kljucMod]) {
        loveModifiers[kljucMod] = 0;
    }

    loveModifiers[kljucMod] += amount;

    // Učitaj bazu i modifikator
    const baza = getDefaultLove(sLower, tLower);
    let noviProcenat = baza + loveModifiers[kljucMod];
    noviProcenat = Math.max(0, Math.min(100, noviProcenat));

    if (amount > 0) {
        posaljiPoruku(`💖 @${sender} šalje ljubav @${target}-u! Ljubav je skočila za +${amount}%! Novi ljubavni status iznosi ${noviProcenat}%. ✨`);
    } else {
        posaljiPoruku(`💔 @${sender} baca hejt na @${target}! Ljubav je pala za ${Math.abs(amount)}%! Novi ljubavni status iznosi ${noviProcenat}%. 🌪️`);
    }
    return true;
}

// ─── BRAK I RAZVOD ────────────────────────────────────────────────────────────
function handleVencaj(sender, targetRaw) {
    const target = targetRaw.replace(/^@/, '').trim();
    if (!target) {
        posaljiPoruku('Upotreba: !vencaj @user');
        return;
    }

    const sLower = sender.toLowerCase();
    const tLower = target.toLowerCase();

    if (sLower === tLower) {
        posaljiPoruku(`@${sender}, ne možeš se venčati sa samim sobom! 😂`);
        return;
    }

    const kljucBrak = [sLower, tLower].sort().join('::');

    if (marriedCouples[kljucBrak]) {
        posaljiPoruku(`💍 @${sender} i @${target} su već zvanično u braku! Čuvajte jedno drugo! 🥰`);
        return;
    }

    // Računanje trenutnog procenta ljubavi
    const baza = getDefaultLove(sLower, tLower);
    const modifikator = loveModifiers[kljucBrak] || 0;
    let procenat = baza + modifikator;
    procenat = Math.max(0, Math.min(100, procenat));

    if (procenat < 80) {
        posaljiPoruku(`💔 Venčanje odbijeno! Nemate dovoljno ljubavi (potrebno je bar 80%, a vi imate ${procenat}%). Šaljite ljubav pomoću !posaljiljubav @user!`);
        return;
    }

    // Zvanično venčani
    marriedCouples[kljucBrak] = {
        user1: sender,
        user2: target,
        datum: new Date().toLocaleDateString('sr-RS')
    };

    posaljiPoruku(`💍 ZVANIČNO VENČANI! @${sender} i @${target} su stupili u brak sa ${procenat}% ljubavi! Svadbena zvona zvone, a ekipa u chatu slavi! Nek je sa srećom! 🥳🚌🎉`);
}

function handleRazvod(sender, targetRaw) {
    const target = targetRaw.replace(/^@/, '').trim();
    if (!target) {
        posaljiPoruku('Upotreba: !razvod @user');
        return;
    }

    const sLower = sender.toLowerCase();
    const tLower = target.toLowerCase();
    const kljucBrak = [sLower, tLower].sort().join('::');

    if (!marriedCouples[kljucBrak]) {
        posaljiPoruku(`Vi niste ni u braku sa korisnikom @${target}! 😂`);
        return;
    }

    // Brisanje braka i postavljanje ogromnog hejta (-50%)
    delete marriedCouples[kljucBrak];
    loveModifiers[kljucBrak] = (loveModifiers[kljucBrak] || 0) - 50;

    posaljiPoruku(`💔 TUŽNE VESTI: @${sender} i @${target} su se razveli! Papiri su potpisani, a svadbeni bus je prazan. Ljubav im je drastično opala za -50%! 😭😭`);
}

function handleBrakovi() {
    const parovi = Object.values(marriedCouples);

    if (parovi.length === 0) {
        posaljiPoruku('💍 Niko na strimu još nije u braku! Budite prvi: skupite 80%+ ljubavi i kucajte !vencaj @user!');
        return;
    }

    const lista = parovi.map(p => `@${p.user1} ❤️ @${p.user2} (od ${p.datum})`).join(', ');
    posaljiPoruku(`💍 Venčani parovi na strimu: ${lista}`);
}

// ─── LEADERBOARD HANDLERI ─────────────────────────────────────────────────────
function handleTop() {
    const sortirani = Object.values(leaderboard)
        .sort((a, b) => b.count - a.count);

    if (sortirani.length === 0) {
        posaljiPoruku('🏆 Leaderboard je trenutno prazan. Napišite nešto u chat i budite prvi!');
        return;
    }

    const top5 = sortirani.slice(0, 5)
        .map((x, idx) => `${idx + 1}. @${x.username} (${x.count})`)
        .join(', ');

    const trenutniMesec = dobijTrenutniMesec();
    posaljiPoruku(`🏆 Aktivnost (${trenutniMesec}) - Top 5: ${top5}`);
}

function handleAktivnost(user) {
    const userKey = user.toLowerCase();
    const sortirani = Object.values(leaderboard)
        .sort((a, b) => b.count - a.count);

    const rank = sortirani.findIndex(x => x.username.toLowerCase() === userKey) + 1;
    const podaci = leaderboard[userKey];

    if (!podaci || rank === 0) {
        posaljiPoruku(`📊 @${user}, još uvek nemaš upisanih poruka za ovaj mesec.`);
        return;
    }

    const trenutniMesec = dobijTrenutniMesec();
    posaljiPoruku(`📊 @${user}, tvoja aktivnost (${trenutniMesec}): ${podaci.count} poruka (Rank #${rank})`);
}

function handleResetLeaderboard(user, isBroadcaster) {
    if (!isBroadcaster) {
        posaljiPoruku(`❌ @${user}, nemaš dozvolu.`);
        return;
    }

    leaderboard = {};
    leaderboardDirty = true;
    sacuvajLeaderboard();
    posaljiPoruku('🔄 Leaderboard je uspešno resetovan za ovaj mesec!');
}

// ─── PODRAZUMEVANA LJUBAV (Lore) ──────────────────────────────────────────────
function getDefaultLove(u1, u2) {
    return 0; // Svi parovi po defaultu kreću sa 0%
}

// !vreme <grad> — koristi wttr.in API sa keširanjem od 5 min
async function handleVreme(grad) {
    const gradKey = grad.toLowerCase().trim();
    const sada = Date.now();

    if (weatherCache[gradKey] && (sada - weatherCache[gradKey].ts < WEATHER_TTL_MS)) {
        posaljiPoruku(weatherCache[gradKey].podaci);
        log('INFO', `Korišćeno keširano vreme za grad: ${grad}`);
        return;
    }

    try {
        const url = `https://wttr.in/${encodeURIComponent(grad)}?format=j1`;
        const res  = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const podaci = await res.json();

        const cc      = podaci.current_condition[0];
        const tempC   = cc.temp_C;
        const opis    = cc.weatherDesc[0].value;
        const vlaznost= cc.humidity;
        const vetar   = cc.windspeedKmph;
        const osecaj  = cc.FeelsLikeC;

        // Prevođenje čestih engleskih opisa na srpski
        const opisSrp = prevediVreme(opis);

        const tekst = `🌍 Vreme u ${grad}: ${opisSrp} | 🌡️ ${tempC}°C (oseća se ${osecaj}°C) | 💧 Vlažnost: ${vlaznost}% | 💨 Vetar: ${vetar} km/h`;
        
        weatherCache[gradKey] = {
            podaci: tekst,
            ts: sada
        };

        posaljiPoruku(tekst);
    } catch (err) {
        log('ERR', `handleVreme greška: ${err.message}`);
        posaljiPoruku(`❌ Nije moguće pronaći vreme za "${grad}". Provjeri naziv grada.`);
    }
}

function prevediVreme(opis) {
    const mapa = {
        'sunny':                            '☀️ Sunčano',
        'clear':                            '🌙 Vedro',
        'partly cloudy':                    '⛅ Delimično oblačno',
        'cloudy':                           '☁️ Oblačno',
        'overcast':                         '☁️ Potpuno oblačno',
        'mist':                             '🌫️ Sumaglica',
        'fog':                              '🌫️ Magla',
        'freezing fog':                     '🌫️ Ledena magla',
        'patchy rain nearby':               '🌦️ Mestimična kiša u blizini',
        'patchy rain possible':             '🌦️ Moguća kiša',
        'patchy snow nearby':               '🌨️ Mestimičan sneg u blizini',
        'patchy snow possible':             '🌨️ Moguć sneg',
        'patchy sleet nearby':              '🌨️ Mestimična susnežica u blizini',
        'patchy sleet possible':            '🌨️ Moguća susnežica',
        'patchy freezing drizzle nearby':   '🌧️ Mestimična ledena rosulja u blizini',
        'patchy freezing drizzle possible': '🌧️ Moguća ledena rosulja',
        'thundery outbreaks nearby':        '⛈️ Grmljavina u blizini',
        'thundery outbreaks possible':      '⛈️ Moguća grmljavina',
        'blowing snow':                     '🌨️ Vejavica',
        'blizzard':                         '🌨️ Mećava',
        'light drizzle':                    '🌦️ Rosulja',
        'freezing drizzle':                 '🌧️ Ledena rosulja',
        'heavy freezing drizzle':           '🌧️ Jaka ledena rosulja',
        'patchy light drizzle':             '🌦️ Mestimična blaga rosulja',
        'patchy light rain':                '🌦️ Mestimična blaga kiša',
        'light rain':                       '🌦️ Lagana kiša',
        'moderate rain at times':           '🌧️ Povremeno umerena kiša',
        'moderate rain':                    '🌧️ Umerena kiša',
        'heavy rain at times':              '🌧️ Povremeno jaka kiša',
        'heavy rain':                       '🌧️ Jaka kiša',
        'light freezing rain':              '🌧️ Blaga ledena kiša',
        'moderate or heavy freezing rain':  '🌧️ Umerena ili jaka ledena kiša',
        'light sleet':                      '🌨️ Lagana susnežica',
        'moderate or heavy sleet':          '🌨️ Umerena ili jaka susnežica',
        'patchy light snow':                '🌨️ Mestimičan blag sneg',
        'light snow':                       '🌨️ Lagani sneg',
        'patchy moderate snow':             '❄️ Mestimičan umeren sneg',
        'moderate snow':                    '❄️ Umereni sneg',
        'patchy heavy snow':                '❄️ Mestimičan jak sneg',
        'heavy snow':                       '❄️ Jak sneg',
        'ice pellets':                      '🌨️ Krupa / Grad',
        'light rain shower':                '🌦️ Kratkotrajna kiša',
        'moderate or heavy rain shower':    '🌧️ Pljusak',
        'torrential rain shower':           '🌧️ Jak pljusak',
        'light sleet showers':              '🌨️ Kratkotrajna susnežica',
        'moderate or heavy sleet showers':  '🌨️ Jaka susnežica',
        'light snow showers':               '🌨️ Kratkotrajni sneg',
        'moderate or heavy snow showers':   '🌨️ Jak sneg',
        'light showers of ice pellets':     '🌨️ Kratkotrajna krupa / grad',
        'moderate or heavy showers of ice pellets': '🌨️ Jaka krupa / grad',
        'patchy light rain with thunder':   '⛈️ Blaga kiša sa grmljavinom',
        'moderate or heavy rain with thunder': '⛈️ Jaka kiša sa grmljavinom',
        'patchy light snow with thunder':   '⛈️ Blag sneg sa grmljavinom',
        'moderate or heavy snow with thunder': '⛈️ Jak sneg sa grmljavinom',
    };
    return mapa[opis.toLowerCase().trim()] || opis;
}

// !uptime — koliko je stream live (bez keširanja, po želji)
async function handleUptime() {
    try {
        const res  = await fetchKickAPI(`https://kick.com/api/v2/channels/${CHANNEL_USERNAME}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const podaci = await res.json();

        if (!podaci.livestream || !podaci.livestream.created_at) {
            posaljiPoruku('📴 Stream trenutno nije live.');
            return;
        }

        const pocetak = new Date(podaci.livestream.created_at);
        const sada    = new Date();
        const diffMs  = sada - pocetak;
        const sati    = Math.floor(diffMs / 3_600_000);
        const minuti  = Math.floor((diffMs % 3_600_000) / 60_000);
        const sekunde = Math.floor((diffMs % 60_000) / 1000);

        let trajanje = '';
        if (sati > 0)   trajanje += `${sati}h `;
        trajanje += `${minuti}min`;
        if (sati === 0) trajanje += ` ${sekunde}s`;

        posaljiPoruku(`⏱️ Stream je live već ${trajanje.trim()}`);
    } catch (err) {
        log('ERR', `handleUptime greška: ${err.message}`);
        // Fallback na ručne podatke strimera
        if (isStreamLive && manualStreamStartTs) {
            const diffMs = Date.now() - manualStreamStartTs;
            const sati = Math.floor(diffMs / 3_600_000);
            const minuti = Math.floor((diffMs % 3_600_000) / 60_000);
            const sekunde = Math.floor((diffMs % 60_000) / 1000);

            let trajanje = '';
            if (sati > 0)   trajanje += `${sati}h `;
            trajanje += `${minuti}min`;
            if (sati === 0) trajanje += ` ${sekunde}s`;

            posaljiPoruku(`⏱️ Stream je live već ${trajanje.trim()} (ručno podešeno)`);
        } else {
            posaljiPoruku('❌ Uptime nedostupan.');
        }
    }
}

// !igra — trenutna kategorija/igra na streamu sa keširanjem od 1 min
async function handleIgra() {
    const sada = Date.now();
    
    // Ako imamo ručno podešenu igru i API ne radi, koristićemo nju, ali prvo proveravamo keš
    if (cachedIgra && (sada - cachedIgraTs < CACHE_TTL_MS)) {
        posaljiPoruku(`🎮 Tutz trenutno igra: ${cachedIgra}`);
        log('INFO', 'Korišćena keširana igra/kategorija.');
        return;
    }

    try {
        const res  = await fetchKickAPI(`https://kick.com/api/v2/channels/${CHANNEL_USERNAME}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const podaci = await res.json();

        if (!podaci.livestream) {
            // Ako je API vratio 200 ali nema livestreama, proveravamo ručnu igru
            if (manualGameName) {
                posaljiPoruku(`🎮 Tutz trenutno igra: ${manualGameName} (ručno podešeno)`);
            } else {
                posaljiPoruku('📴 Stream trenutno nije live, ne mogu pronaći igru.');
            }
            return;
        }

        let igra = null;
        if (podaci.livestream.category && podaci.livestream.category.name) {
            igra = podaci.livestream.category.name;
        } else if (podaci.livestream.categories && podaci.livestream.categories.length > 0) {
            igra = podaci.livestream.categories[0].name;
        }

        if (!igra) {
            if (manualGameName) {
                posaljiPoruku(`🎮 Tutz trenutno igra: ${manualGameName} (ručno podešeno)`);
            } else {
                posaljiPoruku('🎮 Igra/kategorija nije postavljena na streamu.');
            }
            return;
        }

        cachedIgra = igra;
        cachedIgraTs = sada;

        posaljiPoruku(`🎮 Tutz trenutno igra: ${igra}`);
    } catch (err) {
        log('ERR', `handleIgra greška: ${err.message}`);
        // Fallback na ručne podatke strimera
        if (manualGameName) {
            posaljiPoruku(`🎮 Tutz trenutno igra: ${manualGameName} (ručno podešeno)`);
        } else {
            posaljiPoruku('❌ Igra nedostupna.');
        }
    }
}

// ─── SLANJE PORUKE (MESSAGE QUEUE & KICK LIMITS) ─────────────────────────────
function posaljiPoruku(tekst) {
    messageQueue.push(tekst);
    processQueue();
}

async function processQueue() {
    if (isProcessingQueue) return;
    if (messageQueue.length === 0) return;

    isProcessingQueue = true;
    const tekst = messageQueue.shift();

    try {
        await izvrsiSlanje(tekst);
    } catch (error) {
        log('ERR', `Greška pri izvršavanju slanja poruke: ${error.message}`);
    }

    // Sačekaj 1.5 sekundi pre slanja sledeće poruke (Kick rate-limit bezbednost)
    setTimeout(() => {
        isProcessingQueue = false;
        processQueue();
    }, 1500);
}

async function izvrsiSlanje(tekst) {
    const response = await fetch(`https://kick.com/api/v2/messages/send/${CHATROOM_ID}`, {
        method: 'POST',
        headers: {
            'accept':        'application/json',
            'authorization': BEARER_TOKEN,
            'content-type':  'application/json',
            'cookie':        BOT_COOKIE,
            'user-agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
        },
        body: JSON.stringify({ content: tekst, type: 'message' })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    log('BOT', tekst);
}

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────
process.on('SIGINT', () => {
    log('INFO', 'Bot se gasi... (CTRL+C)');
    
    // Sačuvaj preostalu aktivnost na disk pre gašenja
    if (leaderboardDirty) {
        sacuvajLeaderboard();
    }
    
    stopHeartbeat();
    if (ws) ws.close();
    process.exit(0);
});

// ─── GLOBAL CRASH PROTECTION ──────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
    log('ERR', `Neuhvaćena greška (uncaughtException): ${err.stack || err.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
    const msg = reason instanceof Error ? reason.stack : String(reason);
    log('ERR', `Neobrađeno obećanje (unhandledRejection): ${msg}`);
});

// Provera statusa strima (svetski nivo - pametna detekcija)
async function proveriDaLiJeLive() {
    try {
        const res = await fetchKickAPI(`https://kick.com/api/v2/channels/${CHANNEL_USERNAME}`);
        if (res.ok) {
            const data = await res.json();
            const liveState = !!data.livestream;
            if (liveState !== isStreamLive) {
                isStreamLive = liveState;
                log('INFO', `Status strima promenjen: ${isStreamLive ? '🔴 LIVE' : '⚪ OFFLINE'}`);
                if (isStreamLive) {
                    log('INFO', 'Strim je počeo! Slanje pozdravne poruke...');
                    posaljiPoruku('🤖 Tutzot bot je aktivan! Strim je počeo, lupite follow i uživajte! 🚀');
                }
            }
        }
    } catch (err) {
        log('ERR', `Greška pri proveri statusa strima: ${err.message}`);
    }
}

// ─── HTTP SERVER (Trik za besplatni Render Web Service) ────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('🤖 Tutzot Kick Bot je aktivan i zdrav!\n');
}).listen(PORT, () => {
    log('INFO', `Lokalni HTTP server pokrenut na portu: ${PORT}`);
});

// ─── START ────────────────────────────────────────────────────────────────────
async function start() {
    log('INFO', '🤖 Kickot bot se pokreće...');
    await ucitajLeaderboard();
    povezi();

    // Pokrećemo periodičnu proveru live statusa strima (na svaka 2 minuta)
    proveriDaLiJeLive();
    setInterval(proveriDaLiJeLive, 2 * 60 * 1000);
}
start();