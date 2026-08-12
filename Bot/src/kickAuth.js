const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const { log } = require('./utils');

const TABELA = 'bot_kick_tokens';
const RED_ID = 1; // uvek čuvamo jedan red (bot ima jedan nalog)

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);

let keshTokeni = null;       // { access_token, refresh_token, expires_at }
let refreshTimer = null;
let broadcasterIdCache = {}; // username -> user_id

async function ucitajTokene() {
    if (keshTokeni) return keshTokeni;

    try {
        const { data, error } = await supabase
            .from(TABELA)
            .select('access_token, refresh_token, expires_at')
            .eq('id', RED_ID)
            .maybeSingle();

        if (error) throw error;

        if (data) {
            keshTokeni = {
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_at: new Date(data.expires_at).getTime()
            };
            return keshTokeni;
        }

        return null;
    } catch (err) {
        log('ERR', `[AUTH] Greška pri učitavanju Kick tokena iz Supabase: ${err.message}`);
        return null;
    }
}

async function sacuvajTokene(data) {
    keshTokeni = data;

    try {
        const { error } = await supabase
            .from(TABELA)
            .upsert({
                id: RED_ID,
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_at: new Date(data.expires_at).toISOString(),
                updated_at: new Date().toISOString()
            });

        if (error) throw error;
    } catch (err) {
        log('ERR', `[AUTH] Greška pri čuvanju Kick tokena u Supabase: ${err.message}`);
    }
}

async function razmeniTokenZaOsvezavanje(refreshToken) {
    const res = await fetch('https://id.kick.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: config.KICK_CLIENT_ID,
            client_secret: config.KICK_CLIENT_SECRET,
            refresh_token: refreshToken
        }).toString()
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Osvežavanje Kick tokena neuspešno: HTTP ${res.status} - ${errText}`);
    }

    const data = await res.json();
    const noviTokeni = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || refreshToken, // Kick ponekad vrati isti refresh_token
        expires_at: Date.now() + ((data.expires_in || 3600) * 1000)
    };
    await sacuvajTokene(noviTokeni);
    log('INFO', '[AUTH] Kick bot token uspešno osvežen preko refresh_token-a.');
    return noviTokeni;
}

/**
 * Vraća važeći access_token. Ako je istekao ili ističe uskoro, osvežava ga.
 */
async function getAccessToken() {
    const current = await ucitajTokene();
    if (!current || !current.refresh_token) {
        throw new Error('Nema sačuvanih Kick bot tokena u Supabase (bot_kick_tokens tabela).');
    }

    // Osveži ako ističe za manje od 5 minuta
    if (!current.expires_at || Date.now() > current.expires_at - 5 * 60 * 1000) {
        return (await razmeniTokenZaOsvezavanje(current.refresh_token)).access_token;
    }

    return current.access_token;
}

/**
 * Zakazuje periodično osvežavanje tokena tako da nikad ne istekne dok bot radi.
 */
function zakaziAutoOsvezavanje() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
        try {
            await getAccessToken();
        } catch (err) {
            log('ERR', `[AUTH] Automatsko osvežavanje Kick tokena nije uspelo: ${err.message}`);
        }
    }, 15 * 60 * 1000).unref(); // proverava na svakih 15 minuta, osvežava kad je blizu isteka
}

/**
 * Dohvata broadcaster_user_id za dati username preko zvaničnog Public API-ja (kešira rezultat).
 */
async function getBroadcasterUserId(username) {
    const key = username.toLowerCase();
    if (broadcasterIdCache[key]) return broadcasterIdCache[key];

    const accessToken = await getAccessToken();
    const res = await fetch(`https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(username)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
        throw new Error(`Ne mogu da dohvatim broadcaster_user_id za ${username}: HTTP ${res.status}`);
    }

    const json = await res.json();
    const podaci = Array.isArray(json.data) ? json.data[0] : json.data;
    const userId = podaci && (podaci.broadcaster_user_id || podaci.user_id);

    if (!userId) {
        throw new Error(`API nije vratio broadcaster_user_id za ${username}`);
    }

    broadcasterIdCache[key] = userId;
    return userId;
}

/**
 * Šalje poruku u chat kanala preko zvaničnog Kick Public API v1 (POST https://api.kick.com/public/v1/chat).
 */
async function posaljiPrekoZvanicnogApija(chatroomId, tekst, channelUsername, _channelState) {
    if (!tekst || typeof tekst !== 'string') return null;

    try {
        const broadcasterId = await getBroadcasterUserId(channelUsername);
        const accessToken = await getAccessToken();

        const response = await fetch('https://api.kick.com/public/v1/chat', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                broadcaster_user_id: Number(broadcasterId) || broadcasterId,
                content: tekst,
                type: 'user'
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            log('ERR', `[${channelUsername || chatroomId}] Greška slanja na Kick API: HTTP ${response.status} - ${errText}`);
            return null;
        }

        const data = await response.json();
        const messageId = data?.data?.message_id || data?.message_id || data?.id || null;
        log('INFO', `[${channelUsername}] Poslata poruka na chat: "${tekst.length > 60 ? tekst.substring(0, 57) + '...' : tekst}"`);
        return messageId;
    } catch (err) {
        log('ERR', `[${channelUsername || chatroomId}] Neuspešno slanje poruke preko Kick API: ${err.message}`);
        return null;
    }
}

/**
 * Da li postoje sačuvani tokeni (proverava keš).
 */
function jeKonfigurisano() {
    return !!keshTokeni;
}

/**
 * Asinhrona, pouzdanija provera (uključuje Supabase). Koristiti na startu bota.
 */
async function proveriKonfiguraciju() {
    const t = await ucitajTokene();
    return !!(t && t.refresh_token);
}

module.exports = {
    getAccessToken,
    getBroadcasterUserId,
    zakaziAutoOsvezavanje,
    jeKonfigurisano,
    proveriKonfiguraciju,
    posaljiPrekoZvanicnogApija
};

