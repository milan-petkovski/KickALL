const config = require('./config');
const state = require('./state');
// kickAuth se uvozi lazy unutar kickScrapingHeaders da bi se izbegao circular dependency
// (utils.js <- kickAuth.js <- utils.js)

/**
 * Logovanje sa vremenskom oznakom i bojom
 */
function log(tip, poruka, meta = null) {
    const vreme = new Date().toLocaleTimeString('sr-RS', { hour12: false });
    const boje = { BOT: '\x1b[36m', CHAT: '\x1b[32m', INFO: '\x1b[33m', ERR: '\x1b[31m', WARN: '\x1b[35m', MOD: '\x1b[34m' };
    const boja = boje[tip] || '\x1b[37m';

    if (process.env.LOG_FORMAT === 'json') {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: tip,
            message: poruka,
            ...(meta && typeof meta === 'object' ? meta : {})
        }));
    } else {
        console.log(`\x1b[90m[${vreme}]\x1b[0m ${boja}[${tip}]\x1b[0m ${poruka}`);
    }

    // Baferuj logove u state za prikaz na dashboard-u
    try {
        state.globalLogs = state.globalLogs || [];
        state.globalLogs.push({ timestamp: vreme, type: tip, message: poruka, meta: meta || undefined });
        if (state.globalLogs.length > 50) {
            state.globalLogs.shift();
        }
    } catch (_) {}
}

/**
 * Sanitizuje unos za Kick plain-text chat tako što uklanja HTML/JS tagove i neprikazive/kontrolne karaktere
 * bez konvertovanja običnih karaktera (&, ', ", /) u HTML entitete (&amp;, &#x27;)
 */
function sanitizeInput(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/<[^>]*>/g, '') // Uklanja HTML tagove
        .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '') // Uklanja nevidljive i kontrolne karaktere
        .trim();
}

/**
 * Validira da li je korisničko ime u ispravnom formatu
 */
function isValidUsername(username) {
    if (typeof username !== 'string') return false;
    const usernameRegex = /^[a-zA-Z0-9_\-!&@#$]+$/;
    return usernameRegex.test(username);
}

/**
 * Izvlači XSRF-TOKEN iz kolačića (BOT_COOKIE) i url-dekodira ga.
 * Kick-ov interni (v2) API koristi Laravel Sanctum SPA autentikaciju: pored
 * sesijskog kolačića očekuje i X-XSRF-TOKEN header koji se poklapa sa
 * XSRF-TOKEN vrednošću iz kolačića. Bez ovog headera zahtevi ka v2 API-ju
 * (pin/unpin/brisanje poruke, followage) vraćaju HTTP 401, čak i kada su
 * kolačić i bearer token validni.
 */
function izvuciXsrfToken(cookieString) {
    if (!cookieString || typeof cookieString !== 'string') return null;
    const match = cookieString.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    if (!match) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch (_) {
        return match[1];
    }
}

/**
 * Izvlaci session_token iz kolacica i URL-dekodira ga.
 * Kick v2 interni API koristi Laravel Sanctum — session_token kolacic
 * je ujedno i Bearer token (format: userId|token).
 */
function izvuciSessionToken(cookieString) {
    if (!cookieString || typeof cookieString !== 'string') return null;
    const match = cookieString.match(/(?:^|;\s*)session_token=([^;]+)/);
    if (!match) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch (_) {
        return match[1];
    }
}

/**
 * Vraća standardni set headera za autentikovane zahteve ka Kick-ovom
 * internom (v2) API-ju preko got-scraping (cookie + bearer + XSRF).
 * Koristi OAuth Bearer token (automatski osvežavan) i session_cookie iz Supabase.
 */
async function kickScrapingHeaders(extra = {}) {
    // Lazy require da bi se izbegao circular dependency (utils -> kickAuth -> utils)
    const kickAuth = require('./kickAuth');

    let sessionCookie = await kickAuth.getSessionCookie();
    const xsrfToken = izvuciXsrfToken(sessionCookie);

    // Pokupi session_token iz kolacica — to je Sanctum Bearer token za v2 API
    const sessionToken = izvuciSessionToken(sessionCookie);

    let bearerToken;
    if (sessionToken) {
        // session_token iz kolacica je pravi Bearer za kick.com/api/v2/*
        bearerToken = `Bearer ${sessionToken}`;
    } else {
        // Fallback na OAuth token ili staticki BEARER_TOKEN iz .env
        try {
            const token = await kickAuth.getAccessToken();
            bearerToken = token ? `Bearer ${token}` : config.BEARER_TOKEN;
        } catch (_) {
            bearerToken = config.BEARER_TOKEN;
        }
    }

    const headers = {
        'accept':                    'application/json, text/plain, */*',
        'accept-language':           'en-US,en;q=0.9',
        'authorization':             bearerToken,
        'origin':                    'https://kick.com',
        'referer':                   'https://kick.com/',
        'sec-ch-ua':                 '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
        'sec-ch-ua-mobile':          '?0',
        'sec-ch-ua-platform':        '"Windows"',
        'sec-fetch-dest':            'empty',
        'sec-fetch-mode':            'cors',
        'sec-fetch-site':            'same-origin',
        'user-agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        ...extra
    };
    if (sessionCookie) {
        headers['cookie'] = sessionCookie;
    }
    if (xsrfToken) {
        headers['x-xsrf-token'] = xsrfToken;
    }
    return headers;
}

/**
 * Got-scraping preuzimanje sa Kick API-ja
 */
async function fetchKickAPI(url) {
    const { gotScraping } = await import('got-scraping');
    try {
        const response = await gotScraping({
            url: url,
            responseType: 'json',
            headers: await kickScrapingHeaders(),
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

/**
 * Formatira mesec i godinu (npr. "07-2026")
 */
function dobijTrenutniMesec() {
    const d = new Date();
    const godina = d.getFullYear();
    const mesec = String(d.getMonth() + 1).padStart(2, '0');
    return `${mesec}-${godina}`;
}

/**
 * Formatira trenutni datum kao ISO dan (npr. "2026-09-11")
 */
function dobijTrenutniDan() {
    const d = new Date();
    const godina = d.getFullYear();
    const mesec = String(d.getMonth() + 1).padStart(2, '0');
    const dan = String(d.getDate()).padStart(2, '0');
    return `${godina}-${mesec}-${dan}`;
}

/**
 * Proverava i beleži cooldown za komandu
 */
function proveraKulauna(chatroomId, kljuc, username, customCooldownMs) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return false;
    const sada   = Date.now();
    const zadnji = channelState.cooldowns[kljuc] || 0;

    let limit = customCooldownMs;
    if (limit === undefined) {
        const cmdIme = kljuc.startsWith('!') ? kljuc.slice(1).toLowerCase() : kljuc.toLowerCase();
        if (channelState.customCommands && channelState.customCommands[cmdIme]) {
            limit = channelState.customCommands[cmdIme].cooldown;
        }
    }
    if (limit === undefined) {
        limit = channelState.COOLDOWN_MS !== undefined ? channelState.COOLDOWN_MS : config.COOLDOWN_MS;
    }

    if (sada - zadnji < limit) {
        const preostalo = ((limit - (sada - zadnji)) / 1000).toFixed(1);
        log('WARN', `[${channelState.channelUsername || chatroomId}] [${username}] Komanda ${kljuc} na cooldown-u još ${preostalo}s`);
        return true;
    }
    channelState.cooldowns[kljuc] = sada;
    return false;
}

/**
 * Prevođenje vremenskih uslova sa engleskog na srpski
 */
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
        'thundery outbreaks in nearby':     '⛈️ Grmljavina u blizini',
        'thundery outbreaks possible':      '⛈️ Moguća grmljavina',
        'blowing snow':                     '🌨️ Vejavica',
        'blizzard':                         '🌨️ Mećava',
        'light drizzle':                    '🌦️ Rosulja',
        'freezing drizzle':                 '🌧️ Ledena rosulja',
        'heavy freezing drizzle':           '🌧️ Jaka ledena rosulja',
        'patchy light drizzle':             '🌦️ Mestimična blaga rosulja',
        'light rain':                       '🌧️ Blaga kiša',
        'moderate rain at times':           '🌧️ Povremena umerena kiša',
        'moderate rain':                    '🌧️ Umerena kiša',
        'heavy rain at times':              '🌧️ Povremena jaka kiša',
        'heavy rain':                       '🌧️ Jaka kiša',
        'light freezing rain':              '🌧️ Blaga ledena kiša',
        'moderate or heavy freezing rain':  '🌧️ Umerena ili jaka ledena kiša',
        'light sleet':                      '🌨️ Blaga susnežica',
        'moderate or heavy sleet':          '🌨️ Umerena ili jaka susnežica',
        'patchy light snow':                '🌨️ Mestimičan blag sneg',
        'light snow':                       '🌨️ Blag sneg',
        'patchy moderate snow':             '🌨️ Mestimičan umeren sneg',
        'moderate snow':                    '🌨️ Umeren sneg',
        'patchy heavy snow':                '🌨️ Mestimičan jak sneg',
        'heavy snow':                       '🌨️ Jak sneg',
        'ice pellets':                      '🌨️ Ledenice',
        'light rain shower':                '🌧️ Kratkotrajni pljusak',
        'moderate or heavy rain shower':    '🌧️ Umeren ili jak pljusak',
        'torrential rain shower':           '🌧️ Obilan pljusak',
        'light sleet showers':              '🌨️ Kratkotrajna susnežica',
        'moderate or heavy sleet showers':  '🌨️ Umereni ili jaki pljuskovi susnežice',
        'light snow showers':               '🌨️ Kratkotrajan sneg',
        'moderate or heavy snow showers':   '🌨️ Umereni ili jaki pljuskovi snega',
        'light showers of ice pellets':     '🌨️ Blagi pljusak ledenica',
        'moderate or heavy showers of ice pellets': '🌨️ Umereni ili jaki pljuskovi ledenica',
        'patchy light rain with thunder':   '⛈️ Mestimična blaga kiša sa grmljavinom',
        'moderate or heavy rain with thunder': '⛈️ Umerena ili jaka kiša sa grmljavinom',
        'patchy light snow with thunder':   '⛈️ Mestimičan blag sneg sa grmljavinom',
        'moderate or heavy snow with thunder': '⛈️ Umeren ili jak sneg sa grmljavinom'
    };
    return mapa[opis.toLowerCase().trim()] || opis;
}

/**
 * Parsira i formatira predložak poruke (npr. welcome poruku) zamenom varijabli kao što su:
 * $(name), $(user), {name}, {username}, {user}, $name, $user, %name%, %user%
 */
function formatTemplateMessage(template, username) {
    if (typeof template !== 'string' || !template) return '';
    if (!username) return template;

    let res = template;

    res = res
        .replace(/@(?:\$\(name\)|\$\(user\)|\{name\}|\{username\}|\{user\}|\$name|\$user|%name%|%user%)/gi, `@${username}`)
        .replace(/(?:\$\(name\)|\$\(user\)|\{name\}|\{username\}|\{user\}|\$name|\$user|%name%|%user%)/gi, username);

    if (!res.includes(`@${username}`) && !res.includes(username)) {
        res = `@${username}, ${res}`;
    }

    return res;
}

// Formatira poruke chat alertova (Dobrodošlica, Follow, Sub, Resub, Giftsub, KICKs, Host/Raid).
// Podržava varijable: @$(name) / $(name), $(amount), $(months), $(viewers).
// Ako je poruka prazna, koristi razuman podrazumevani tekst kao fallback.
function formatAlertMessage(template, vars = {}) {
    const { name = '', amount, months, viewers, fallback = '' } = vars;

    let res = (typeof template === 'string' && template.trim()) ? template : fallback;
    if (!res) return '';

    if (name) {
        res = res
            .replace(/@(?:\$\(name\)|\$\(user\)|\{name\}|\{username\}|\{user\}|\$name|\$user|%name%|%user%)/gi, `@${name}`)
            .replace(/(?:\$\(name\)|\$\(user\)|\{name\}|\{username\}|\{user\}|\$name|\$user|%name%|%user%)/gi, name);
    }

    if (amount !== undefined && amount !== null) {
        res = res.replace(/\$\(amount\)|\{amount\}|%amount%/gi, String(amount));
    }
    if (months !== undefined && months !== null) {
        res = res.replace(/\$\(months\)|\{months\}|%months%/gi, String(months));
    }
    if (viewers !== undefined && viewers !== null) {
        res = res.replace(/\$\(viewers\)|\{viewers\}|%viewers%/gi, String(viewers));
    }

    if (name && !res.includes(`@${name}`) && !res.includes(name)) {
        res = `@${name}, ${res}`;
    }

    return res;
}

// Garancija da sacuvajLeaderboard i sacuvajWatchtime nikad ne rade istovremeno nad istim kanalom.
async function runWithLeaderboardLock(channelState, task) {
    if (!channelState) return await task();
    if (!channelState.leaderboardSaveLock) {
        channelState.leaderboardSaveLock = Promise.resolve();
    }
    const previousLock = channelState.leaderboardSaveLock;
    let release;
    channelState.leaderboardSaveLock = new Promise(resolve => { release = resolve; });
    try {
        await previousLock;
        return await task();
    } finally {
        release();
    }
}

module.exports = {
    log,
    sanitizeInput,
    isValidUsername,
    fetchKickAPI,
    kickScrapingHeaders,
    izvuciXsrfToken,
    izvuciSessionToken,
    dobijTrenutniMesec,
    dobijTrenutniDan,
    proveraKulauna,
    prevediVreme,
    formatTemplateMessage,
    formatAlertMessage,
    runWithLeaderboardLock
};