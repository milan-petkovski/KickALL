const state = require('../state');
const { posaljiPoruku } = require('../messenger');

async function handlePesma(chatroomId, sender, songName, senderObj) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    if (channelState.planLimits && channelState.planLimits.allowSongRequest === false) {
        posaljiPoruku(chatroomId, `❌ @${sender}, Song Request funkcija je dostupna u PRO i ELITE paketima.`);
        return;
    }

    if (channelState.feature_songrequest === false) return;

    const userKey = sender.toLowerCase();
    const isStreamer = userKey === channelState.channelUsername.toLowerCase();
    const identity = senderObj && senderObj.identity ? senderObj.identity : {};
    const badges = identity.badges || [];
    const isMod = badges.some(b => b.type === 'moderator' || b.type === 'broadcaster') || isStreamer;
    const isVip = badges.some(b => b.type === 'vip') || isMod;
    const isSub = badges.some(b => b.type === 'subscriber') || isVip;

    const reqRole = channelState.songrequest_settings?.request_role || 'everyone';
    let hasAccess = true;
    if (reqRole === 'moderator' && !isMod) hasAccess = false;
    if (reqRole === 'vip' && !isVip) hasAccess = false;
    if (reqRole === 'subscriber' && !isSub) hasAccess = false;

    if (!hasAccess) {
        posaljiPoruku(chatroomId, `❌ @${sender}, nemaš dozvolu da zatražiš pesmu (potreban rang: ${reqRole === 'everyone' ? 'svi' : reqRole}).`);
        return;
    }

    if (!songName.trim()) {
        posaljiPoruku(chatroomId, `⚠️ @${sender}, moraš uneti naziv pesme ili YouTube link. Primer: !pesma Jašar - Jednoj ženi za sećanje`);
        return;
    }

    const userPlan = channelState.userPlan || 'free';
    const maxQueue = userPlan === 'free' ? 5 : (userPlan === 'pro' ? 50 : 999999);
    const queue = channelState.songrequest_settings.queue || [];

    if (queue.length >= maxQueue) {
        posaljiPoruku(chatroomId, `❌ Dostignuto je maksimalno ograničenje od ${maxQueue} pesama u redu za ${userPlan.toUpperCase()} paket. Nadogradi paket na Kickot Dashboard-u!`);
        return;
    }

    // Provera cene poena
    const cenaPoena = channelState.songrequest_settings?.points_price ?? channelState.songrequest_settings?.cost_points ?? 0;
    const economy = require('../economy');
    const valuta = economy.dobijNazivValute(channelState);
    const userEcon = channelState.economy[userKey];
    const trenutniPoeni = userEcon ? (userEcon.coins || 0) : 0;

    if (cenaPoena > 0 && trenutniPoeni < cenaPoena) {
        posaljiPoruku(chatroomId, `@${sender}, nemas dovoljno poena za muzicku zelju! Potrebno: ${cenaPoena} ${valuta}, a ti imas: ${trenutniPoeni} ${valuta}.`);
        return;
    }

    const query = songName.trim();

    // Pametno pretraživanje YouTube-a za bot komandu !pesma
    let ytId = null;
    let title = query;
    let artist = '';
    let coverUrl = '';
    let duration = 0;

    // 1. Provera da li je unet direktan YouTube URL / ID
    const ytMatch = query.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (ytMatch && ytMatch[1]) {
        ytId = ytMatch[1];
    } else {
        // 2. Pretraga YouTube-a preko HTTPS hendlera
        try {
            const https = require('https');
            const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
            const html = await new Promise((res, rej) => {
                const req = https.get(searchUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Accept-Language': 'en-US,en;q=0.9'
                    }
                }, (response) => {
                    let data = '';
                    response.on('data', chunk => data += chunk);
                    response.on('end', () => res(data));
                });
                req.on('error', err => rej(err));
                req.setTimeout(4000, () => { req.destroy(); rej(new Error('Timeout')); });
            });

            // Pronađi prvi videoId u renderovanim podacima YouTube-a
            const matches = html.match(/"videoId":"([\w-]{11})"/g);
            if (matches && matches.length > 0) {
                for (const m of matches) {
                    const idMatch = m.match(/"videoId":"([\w-]{11})"/);
                    if (idMatch && idMatch[1] && idMatch[1] !== 'dQw4w9WgXcQ') {
                        ytId = idMatch[1];
                        break;
                    }
                }
            }

            const lenMatch = html.match(/"lengthSeconds":"(\d+)"/);
            if (lenMatch && lenMatch[1]) {
                duration = parseInt(lenMatch[1], 10);
            }
        } catch (_) { }
    }

    if (!ytId) {
        posaljiPoruku(chatroomId, `❌ @${sender}, nije bilo moguće pronaći pesmu "${query}" na YouTube-u. Pokušaj sa tačnim nazivom ili YouTube linkom.`);
        return;
    }

    // Provera duplikata u redu po ytId ili naslovu
    const exists = queue.some(s => (s.ytId && s.ytId === ytId) || (s.id && s.id === 'yt_' + ytId) || (s.title && s.title.toLowerCase() === query.toLowerCase()));
    if (exists) {
        posaljiPoruku(chatroomId, `⚠️ @${sender}, ta pesma se već nalazi u redu za puštanje!`);
        return;
    }

    coverUrl = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
    try {
        const https = require('https');
        const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`;
        const oembedRaw = await new Promise((res) => {
            const req = https.get(oembedUrl, (response) => {
                let data = '';
                response.on('data', chunk => data += chunk);
                response.on('end', () => res(data));
            });
            req.on('error', () => res(''));
            req.setTimeout(3000, () => { req.destroy(); res(''); });
        });
        if (oembedRaw) {
            const oembed = JSON.parse(oembedRaw);
            if (oembed.title) {
                const rawTitle = oembed.title;
                if (rawTitle.includes(' - ')) {
                    const parts = rawTitle.split(' - ');
                    artist = parts[0].trim();
                    title = parts.slice(1).join(' - ').trim();
                } else {
                    title = rawTitle;
                    artist = oembed.author_name || 'YouTube';
                }
            }
        }
    } catch (_) { }

    // Provera maksimalnog trajanja pesme (ako je postavljeno u dashboardu)
    const maxDuration = channelState.songrequest_settings?.max_duration_seconds || 0;
    if (maxDuration > 0 && duration > 0 && duration > maxDuration) {
        const maxMins = Math.floor(maxDuration / 60);
        posaljiPoruku(chatroomId, `⚠️ @${sender}, trajanje pesme (${Math.floor(duration / 60)}m) prelazi maksimalno dozvoljeno trajanje od ${maxMins}m na ovom kanalu.`);
        return;
    }

    // Skidanje poena tek NAKON svih uspešnih provera!
    if (cenaPoena > 0 && userEcon) {
        userEcon.coins -= cenaPoena;
        channelState.economyDirty = true;
        channelState.economyDeltas.add(userKey);
    }

    queue.push({
        id: 'yt_' + ytId,
        ytId: ytId,
        title: title,
        artist: artist || 'YouTube',
        requester: sender,
        duration: duration || 210,
        source: 'youtube',
        coverUrl: coverUrl
    });

    const database = require('../database');
    await database.sacuvajSongQueue(chatroomId, queue);

    posaljiPoruku(chatroomId, `🎵 @${sender}, pesma "${artist ? artist + ' - ' : ''}${title}" je uspešno dodata u red za puštanje! (Pozicija: #${queue.length})`);
}

function handleSongQueue(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || channelState.feature_songrequest === false) return;
    const queue = channelState.songrequest_settings?.queue || [];
    if (queue.length === 0) {
        posaljiPoruku(chatroomId, `🎵 Red pesama je trenutno prazan.`);
        return;
    }
    const songsList = queue.slice(0, 3).map((s, i) => `${i + 1}. ${s.artist && s.artist !== 'YouTube' ? s.artist + ' - ' : ''}${s.title}`).join(' | ');
    const extraCount = queue.length > 3 ? ` (+još ${queue.length - 3})` : '';
    posaljiPoruku(chatroomId, `🎵 Trenutni red pesama (${queue.length}): ${songsList}${extraCount}`);
}

async function handleSkipSong(chatroomId, sender, senderObj) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || channelState.feature_songrequest === false) return;
    const userKey = sender.toLowerCase();
    const isStreamer = userKey === channelState.channelUsername.toLowerCase();
    const identity = senderObj && senderObj.identity ? senderObj.identity : {};
    const badges = identity.badges || [];
    const isMod = badges.some(b => b.type === 'moderator' || b.type === 'broadcaster') || isStreamer;

    if (!isMod) {
        posaljiPoruku(chatroomId, `❌ @${sender}, samo moderatori i strimer mogu preskočiti pesmu!`);
        return;
    }

    const queue = channelState.songrequest_settings?.queue || [];
    if (queue.length === 0) {
        posaljiPoruku(chatroomId, `⚠️ Red pesama je prazan.`);
        return;
    }

    const skipped = queue.shift();
    const database = require('../database');
    await database.sacuvajSongQueue(chatroomId, queue);
    posaljiPoruku(chatroomId, `⏭️ Moderacija (@${sender}) je preskočila pesmu: ${skipped.artist && skipped.artist !== 'YouTube' ? skipped.artist + ' - ' : ''}${skipped.title}`);
}

module.exports = {
    handlePesma,
    handleSongQueue,
    handleSkipSong
};
