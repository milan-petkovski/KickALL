const config = require('./config');
const state = require('./state');

/**
 * Logovanje sa vremenskom oznakom i bojom
 */
function log(tip, poruka) {
    const vreme = new Date().toLocaleTimeString('sr-RS', { hour12: false });
    const boje = { BOT: '\x1b[36m', CHAT: '\x1b[32m', INFO: '\x1b[33m', ERR: '\x1b[31m', WARN: '\x1b[35m' };
    const boja = boje[tip] || '\x1b[37m';
    console.log(`\x1b[90m[${vreme}]\x1b[0m ${boja}[${tip}]\x1b[0m ${poruka}`);

    // Baferuj logove u state za prikaz na dashboard-u
    try {
        state.globalLogs = state.globalLogs || [];
        state.globalLogs.push({ timestamp: vreme, type: tip, message: poruka });
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
 * Got-scraping preuzimanje sa Kick API-ja
 */
async function fetchKickAPI(url) {
    const { gotScraping } = await import('got-scraping');
    try {
        const response = await gotScraping({
            url: url,
            responseType: 'json',
            headers: {
                'cookie': config.BOT_COOKIE,
                'authorization': config.BEARER_TOKEN
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
            limit = channelState.customCommands[cmdIme].cooldown_ms;
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

module.exports = {
    log,
    sanitizeInput,
    isValidUsername,
    fetchKickAPI,
    dobijTrenutniMesec,
    proveraKulauna,
    prevediVreme,
    formatTemplateMessage
};
