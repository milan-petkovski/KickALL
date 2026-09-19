const state = require('../state');
const { posaljiPoruku } = require('../messenger');

async function handlePesma(chatroomId, sender, songName, senderObj) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    if (channelState.planLimits && channelState.planLimits.allowSongRequest === false) {
        posaljiPoruku(chatroomId, `@${sender}, Song Request funkcija je dostupna u PRO i ELITE paketima.`);
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
        posaljiPoruku(chatroomId, `@${sender}, nemaš dozvolu da zatražiš pesmu (potreban rang: ${reqRole === 'everyone' ? 'svi' : reqRole}).`);
        return;
    }

    if (!songName.trim()) {
        posaljiPoruku(chatroomId, `@${sender}, moraš uneti naziv pesme ili YouTube link. Primer: !pesma Jašar - Jednoj ženi za sećanje`);
        return;
    }

    const trimmedQuery = songName.trim().toLowerCase();
    const conversationalFilters = [
        'i koju ces', 'i koju ces?', 'i koju ces!',
        'i koju ceš', 'i koju ceš?',
        'sta god', 'šta god', 'bilo sta', 'bilo šta', 'bilo koju',
        'kako hoces', 'kako hoćeš', 'nebitno', 'svejedno',
        'primer', 'kako se zove', 'ne znam'
    ];
    if (conversationalFilters.some(f => trimmedQuery === f || trimmedQuery.startsWith(f + ' '))) {
        posaljiPoruku(chatroomId, `@${sender}, unesi tačan naziv pesme ili YouTube link. Primer: !pesma Jašar - Jednoj ženi za sećanje`);
        return;
    }

    const userPlan = channelState.userPlan || 'free';
    const maxQueue = userPlan === 'free' ? 25 : (userPlan === 'pro' ? 100 : 999999);
    const queue = channelState.songrequest_settings?.queue || [];

    if (queue.length >= maxQueue) {
        posaljiPoruku(chatroomId, `Dostignuto je maksimalno ograničenje od ${maxQueue} pesama u redu za ${userPlan.toUpperCase()} paket. Nadogradi paket na Kickot Dashboard-u!`);
        return;
    }

    // Provera cene poena
    const cenaPoena = channelState.songrequest_settings?.points_price ?? channelState.songrequest_settings?.cost_points ?? 0;
    const economy = require('../economy');
    const valuta = economy.dobijNazivValute(channelState);
    const userEcon = channelState.economy[userKey];
    const trenutniPoeni = userEcon ? (userEcon.coins || 0) : 0;

    if (cenaPoena > 0 && trenutniPoeni < cenaPoena) {
        posaljiPoruku(chatroomId, `@${sender}, nemaš dovoljno poena za muzičku želju! Potrebno: ${cenaPoena} ${valuta}, a ti imaš: ${trenutniPoeni} ${valuta}.`);
        return;
    }

    // Provera limita pesama po korisniku (sprečava monopolizaciju reda)
    if (!isMod && !isStreamer) {
        const userSongs = queue.filter(s => s.requester && s.requester.toLowerCase() === userKey).length;
        const maxPerUser = channelState.songrequest_settings?.max_songs_per_user || 3;
        if (userSongs >= maxPerUser) {
            posaljiPoruku(chatroomId, `@${sender}, već imaš ${userSongs} pesme na čekanju u redu! Sačekaj da se neka odsvira pre nego što zatražiš novu.`);
            return;
        }
    }

    const query = songName.trim();

    // Provera da li je unet link cele plejliste
    if (query.includes('playlist?list=') && !query.includes('watch?v=')) {
        posaljiPoruku(chatroomId, `@${sender}, uneli ste link cele plejliste. Song Request podržava pojedinačne pesme - unesite naziv pesme ili link videa!`);
        return;
    }

    // Pametno pretraživanje YouTube-a za bot komandu !pesma
    let ytId = null;
    let fetchedTitle = '';
    let fetchedArtist = '';
    let duration = 0;

    async function checkEmbedAllowed(videoId) {
        if (!videoId) return false;
        try {
            const https = require('https');
            return await new Promise((resolve) => {
                const req = https.get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                }, (res) => {
                    resolve(res.statusCode === 200);
                });
                req.on('error', () => resolve(false));
                req.setTimeout(2000, () => { req.destroy(); resolve(false); });
            });
        } catch (_) {
            return false;
        }
    }

    // 1. Provera da li je unet direktan YouTube URL / ID
    const ytMatch = query.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (ytMatch && ytMatch[1]) {
        const candidateDirect = ytMatch[1];
        const isAllowed = await checkEmbedAllowed(candidateDirect);
        if (isAllowed) {
            ytId = candidateDirect;
        }
    }

    if (!ytId) {
        // 2. Pretraga YouTube-a preko HTTPS hendlera
        try {
            const https = require('https');
            const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
            const html = await new Promise((res, rej) => {
                const req = https.get(searchUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Accept-Language': 'en-US,en;q=0.9,sr;q=0.8'
                    }
                }, (response) => {
                    let data = '';
                    response.on('data', chunk => data += chunk);
                    response.on('end', () => res(data));
                });
                req.on('error', err => rej(err));
                req.setTimeout(4000, () => { req.destroy(); rej(new Error('Timeout')); });
            });

            const candidates = [];

            // 2a. Parsiraj ytInitialData iz pretrage
            const initialDataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s) || html.match(/ytInitialData\s*=\s*({.*?});/s);
            if (initialDataMatch) {
                try {
                    const parsed = JSON.parse(initialDataMatch[1]);
                    const sections = parsed.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
                    if (Array.isArray(sections)) {
                        for (const sec of sections) {
                            const items = sec.itemSectionRenderer?.contents;
                            if (Array.isArray(items)) {
                                for (const it of items) {
                                    if (it.videoRenderer && it.videoRenderer.videoId && it.videoRenderer.videoId !== 'dQw4w9WgXcQ') {
                                        const vr = it.videoRenderer;
                                        let cDur = 0;
                                        if (vr.lengthText?.simpleText) {
                                            const parts = vr.lengthText.simpleText.split(':').map(p => parseInt(p, 10));
                                            if (parts.length === 2) cDur = parts[0] * 60 + parts[1];
                                            else if (parts.length === 3) cDur = parts[0] * 3600 + parts[1] * 60 + parts[2];
                                        }
                                        candidates.push({
                                            videoId: vr.videoId,
                                            title: vr.title?.runs?.map(r => r.text).join('') || vr.title?.simpleText || '',
                                            artist: vr.ownerText?.runs?.map(r => r.text).join('') || vr.longBylineText?.runs?.map(r => r.text).join('') || '',
                                            duration: cDur
                                        });
                                    }
                                }
                            }
                        }
                    }
                } catch (_) { }
            }

            // 2b. Regex fallback za kandidate
            if (candidates.length === 0) {
                const matches = html.match(/"videoId":"([\w-]{11})"/g);
                if (matches && matches.length > 0) {
                    for (const m of matches) {
                        const idMatch = m.match(/"videoId":"([\w-]{11})"/);
                        if (idMatch && idMatch[1] && idMatch[1] !== 'dQw4w9WgXcQ' && !candidates.some(c => c.videoId === idMatch[1])) {
                            candidates.push({ videoId: idMatch[1], title: '', artist: '', duration: 0 });
                        }
                    }
                }
            }

            // 2c. Izaberi kandidata koji dozvoljava embedovanje (sprečava grešku 150)
            for (const cand of candidates.slice(0, 6)) {
                const ok = await checkEmbedAllowed(cand.videoId);
                if (ok) {
                    ytId = cand.videoId;
                    fetchedTitle = cand.title;
                    fetchedArtist = cand.artist;
                    duration = cand.duration;
                    break;
                }
            }

            // Fallback ako nijedan oEmbed nije vratio 200
            if (!ytId && candidates.length > 0) {
                ytId = candidates[0].videoId;
                fetchedTitle = candidates[0].title;
                fetchedArtist = candidates[0].artist;
                duration = candidates[0].duration;
            }

            if (!duration) {
                const lenMatch = html.match(/"lengthSeconds":"(\d+)"/);
                if (lenMatch && lenMatch[1]) {
                    duration = parseInt(lenMatch[1], 10);
                }
            }
        } catch (_) { }
    }

    if (!ytId) {
        posaljiPoruku(chatroomId, `@${sender}, nije bilo moguće pronaći pesmu "${query}" na YouTube-u. Pokušaj sa tačnim nazivom ili YouTube linkom.`);
        return;
    }

    // 3. Ako nedostaje naslov ili trajanje, preuzmi ih direktno sa YouTube Watch stranice
    if (ytId && (!fetchedTitle || !duration || duration <= 0)) {
        try {
            const https = require('https');
            const watchUrl = `https://www.youtube.com/watch?v=${ytId}`;
            const watchHtml = await new Promise((res) => {
                const req = https.get(watchUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Accept-Language': 'en-US,en;q=0.9,sr;q=0.8'
                    }
                }, (resp) => {
                    let data = '';
                    resp.on('data', chunk => data += chunk);
                    resp.on('end', () => res(data));
                });
                req.on('error', () => res(''));
                req.setTimeout(3500, () => { req.destroy(); res(''); });
            });

            if (watchHtml) {
                if (!fetchedTitle) {
                    const ogTitle = watchHtml.match(/<meta property="og:title" content="([^"]+)"/i) ||
                                    watchHtml.match(/<meta name="title" content="([^"]+)"/i) ||
                                    watchHtml.match(/<title>([^<]+?)(?:\s*-\s*YouTube)?<\/title>/i);
                    if (ogTitle && ogTitle[1]) fetchedTitle = ogTitle[1].replace(/\s*-\s*YouTube$/i, '').trim();
                }
                if (!fetchedArtist) {
                    const aMatch = watchHtml.match(/<link itemprop="name" content="([^"]+)"/i) ||
                                   watchHtml.match(/"author":"([^"]+)"/i);
                    if (aMatch && aMatch[1]) fetchedArtist = aMatch[1].trim();
                }
                if (!duration || duration <= 0) {
                    const durMatch = watchHtml.match(/"approxDurationMs":"(\d+)"/);
                    if (durMatch && durMatch[1]) {
                        duration = Math.round(parseInt(durMatch[1], 10) / (durMatch[1].length > 5 ? 1000 : 1));
                    } else {
                        const secMatch = watchHtml.match(/"lengthSeconds":"(\d+)"/);
                        if (secMatch && secMatch[1]) {
                            duration = parseInt(secMatch[1], 10);
                        }
                    }
                }
            }
        } catch (_) { }
    }

    // 4. Rezervni oEmbed sa User-Agent zaglavljem
    if (ytId && !fetchedTitle) {
        try {
            const https = require('https');
            const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`;
            const oembedRaw = await new Promise((res) => {
                const req = https.get(oembedUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                    }
                }, (response) => {
                    let data = '';
                    response.on('data', chunk => data += chunk);
                    response.on('end', () => res(data));
                });
                req.on('error', () => res(''));
                req.setTimeout(3000, () => { req.destroy(); res(''); });
            });
            if (oembedRaw) {
                const oembed = JSON.parse(oembedRaw);
                if (oembed.title && !fetchedTitle) fetchedTitle = oembed.title;
                if (oembed.author_name && !fetchedArtist) fetchedArtist = oembed.author_name;
            }
        } catch (_) { }
    }

    let artist = '';
    let title = query;

    if (fetchedTitle) {
        if (fetchedTitle.includes(' - ')) {
            const parts = fetchedTitle.split(' - ');
            artist = parts[0].trim();
            title = parts.slice(1).join(' - ').trim();
        } else {
            title = fetchedTitle;
            artist = fetchedArtist || 'YouTube';
        }
    } else if (fetchedArtist) {
        artist = fetchedArtist;
    }

    // Proveri pipe separator u naslovu (npr. "Nedeljko Bajić Baja | Slatki Lopov")
    if (title.includes('|')) {
        const pipeParts = title.split(/\s*\|\s*/);
        if (pipeParts.length >= 2) {
            if (!artist || artist === 'YouTube' || artist.toLowerCase() === pipeParts[0].trim().toLowerCase()) {
                artist = pipeParts[0].trim();
                title = pipeParts.slice(1).join(' - ').trim();
            } else if (pipeParts[0].trim().toLowerCase() === artist.toLowerCase()) {
                title = pipeParts.slice(1).join(' - ').trim();
            }
        }
    }

    // Čišćenje autora od oznaka kanala
    if (artist) {
        artist = artist
            .replace(/\s*-\s*Topic$/i, '')
            .replace(/^Official Channel\s+/i, '')
            .replace(/\s*Official\s*Channel$/i, '')
            .replace(/\s*Official$/i, '')
            .replace(/,\s*Inc\.?$/i, '')
            .replace(/VEVO$/i, '')
            .replace(/[\s\-\|]+$/, '')
            .replace(/^[\s\-\|]+/, '')
            .trim();
    }

    // Čišćenje naslova od etiketa spota, kvaliteta i audio/video oznaka
    if (title) {
        title = title
            .replace(/\s*-\s*Topic$/i, '')
            .replace(/\s*\((?:Official\s*)?(?:Music\s*)?(?:Video|Audio|Lyric\s*Video|Lyrics|Visualizer|HD|4K|Spot)?(?:\s*\d{4})?\)/gi, '')
            .replace(/\s*\[(?:Official\s*)?(?:Music\s*)?(?:Video|Audio|Lyric\s*Video|Lyrics|Visualizer|HD|4K|Spot)?(?:\s*\d{4})?\]/gi, '')
            .replace(/\s*\(\s*\)/g, '')
            .replace(/\s*\[\s*\]/g, '')
            .replace(/\s*HD\s*$/i, '')
            .replace(/\s*-\s*HD\s*$/i, '')
            .replace(/[\s\-\|:]+$/, '')
            .replace(/^[\s\-\|:]+/, '')
            .trim();
    }

    // Ukloni dupliranog izvođača ako se ponavlja na početku naslova
    if (artist && artist !== 'YouTube') {
        const artLower = artist.toLowerCase();
        if (title.toLowerCase().startsWith(artLower)) {
            title = title.substring(artLower.length).replace(/^[\s\-\|:]+/, '').trim();
        }
    }

    if (!title) title = query;
    if (!artist) artist = 'YouTube';

    const displaySongName = (artist && artist !== 'YouTube' && !title.toLowerCase().includes(artist.toLowerCase()))
        ? `${artist} - ${title}`
        : title;

    // Provera duplikata u redu po ytId ili naslovu
    const exists = queue.some(s => (s.ytId && s.ytId === ytId) || (s.id && s.id === 'yt_' + ytId) || (s.title && s.title.toLowerCase() === title.toLowerCase()));
    if (exists) {
        posaljiPoruku(chatroomId, `@${sender}, ta pesma se već nalazi u redu za puštanje!`);
        return;
    }

    coverUrl = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;

    // Provera maksimalnog trajanja pesme (ako je postavljeno u dashboardu)
    const maxDuration = channelState.songrequest_settings?.max_duration_seconds || 0;
    if (maxDuration > 0 && duration > 0 && duration > maxDuration) {
        const maxMins = Math.floor(maxDuration / 60);
        posaljiPoruku(chatroomId, `@${sender}, trajanje pesme (${Math.floor(duration / 60)}m) prelazi maksimalno dozvoljeno trajanje od ${maxMins}m na ovom kanalu.`);
        return;
    }

    // Skidanje poena tek NAKON svih uspešnih provera!
    if (cenaPoena > 0 && userEcon) {
        userEcon.coins -= cenaPoena;
        channelState.economyDirty = true;
        channelState.economyDeltas.add(userKey);
    }

    queue.push({
        uid: 'sr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
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

    posaljiPoruku(chatroomId, `@${sender}, pesma "${displaySongName}" je uspešno dodata u red za puštanje! (Pozicija u redu: #${queue.length})`);
}

async function getOrSyncQueue(chatroomId, channelState) {
    let queue = channelState?.songrequest_settings?.queue;
    if (!Array.isArray(queue) || queue.length === 0) {
        try {
            const database = require('../database');
            if (typeof database.ucitajSongQueue === 'function') {
                const freshQueue = await database.ucitajSongQueue(chatroomId);
                if (Array.isArray(freshQueue) && freshQueue.length > 0) {
                    if (!channelState.songrequest_settings) channelState.songrequest_settings = {};
                    channelState.songrequest_settings.queue = freshQueue;
                    return freshQueue;
                }
            }
        } catch (_) {}
    }
    return Array.isArray(queue) ? queue : [];
}

async function handleSongQueue(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || channelState.feature_songrequest === false) return;
    const queue = await getOrSyncQueue(chatroomId, channelState);
    if (queue.length === 0) {
        posaljiPoruku(chatroomId, `Red pesama je trenutno prazan. Zatraži pesmu komandom: !pesma <naziv>`);
        return;
    }
    const current = queue[0];
    const upcoming = queue.slice(1, 4);
    const upcomingList = upcoming.length > 0
        ? ` | Sledeće: ` + upcoming.map((s, i) => `${i + 1}. ${s.artist && s.artist !== 'YouTube' ? s.artist + ' - ' : ''}${s.title}`).join(' | ')
        : '';
    const extraCount = queue.length > 4 ? ` (+još ${queue.length - 4})` : '';
    posaljiPoruku(chatroomId, `Trenutno svira: "${current.artist && current.artist !== 'YouTube' ? current.artist + ' - ' : ''}${current.title}" (${queue.length} u redu)${upcomingList}${extraCount}`);
}

async function handleSkipSong(chatroomId, sender, senderObj) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || channelState.feature_songrequest === false) return;
    const userKey = sender.toLowerCase();
    const isStreamer = (channelState.channelUsername && userKey === channelState.channelUsername.toLowerCase()) || userKey === 'milan_567';

    const queue = await getOrSyncQueue(chatroomId, channelState);
    if (queue.length === 0) {
        posaljiPoruku(chatroomId, `Red pesama je prazan.`);
        return;
    }

    const currentSong = queue[0];
    const isRequester = currentSong && currentSong.requester && currentSong.requester.toLowerCase() === userKey;

    if (!isStreamer && !isRequester) {
        const requesterTag = currentSong?.requester ? ` (@${currentSong.requester})` : '';
        posaljiPoruku(chatroomId, `@${sender}, komandu !skip može iskoristiti samo korisnik koji je naručio pesmu${requesterTag} ili strimer. Za glasanje za preskakanje upotrebi komandu !voteskip.`);
        return;
    }

    const skipped = queue.shift();
    channelState.songrequest_voteskips = { songId: null, voters: new Set() };
    const database = require('../database');
    await database.sacuvajSongQueue(chatroomId, queue);

    const nextSong = queue.length > 0 ? queue[0] : null;
    const nextMsg = nextSong ? ` | Sledeća na redu: "${nextSong.artist && nextSong.artist !== 'YouTube' ? nextSong.artist + ' - ' : ''}${nextSong.title}"` : ' | Red pesama je sada prazan.';
    const actor = isStreamer ? (userKey === 'milan_567' ? '@Milan_567' : 'Strimer') : 'Naručilac';
    posaljiPoruku(chatroomId, `${actor} (@${sender}) je preskočio pesmu: "${skipped.artist && skipped.artist !== 'YouTube' ? skipped.artist + ' - ' : ''}${skipped.title}"${nextMsg}`);
}

async function handleCurrentSong(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || channelState.feature_songrequest === false) return;
    const queue = await getOrSyncQueue(chatroomId, channelState);
    if (queue.length === 0) {
        posaljiPoruku(chatroomId, `Trenutno se ne pušta nijedna pesma. Zatraži pesmu komandom: !pesma <naziv>`);
        return;
    }
    const current = queue[0];
    const durationStr = current.duration ? ` [${Math.floor(current.duration / 60)}:${String(current.duration % 60).padStart(2, '0')}]` : '';
    posaljiPoruku(chatroomId, `Trenutno svira: "${current.artist && current.artist !== 'YouTube' ? current.artist + ' - ' : ''}${current.title}"${durationStr} (Zatražio: @${current.requester})`);
}

async function handleMySong(chatroomId, sender) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || channelState.feature_songrequest === false) return;
    const queue = await getOrSyncQueue(chatroomId, channelState);
    const userKey = sender.toLowerCase();

    const userIndices = [];
    queue.forEach((s, idx) => {
        if (s.requester && s.requester.toLowerCase() === userKey) {
            userIndices.push(idx);
        }
    });

    if (userIndices.length === 0) {
        posaljiPoruku(chatroomId, `@${sender}, trenutno nemaš nijednu pesmu u redu za puštanje. Zatraži je komandom: !pesma <naziv>`);
        return;
    }

    const firstIdx = userIndices[0];
    const song = queue[firstIdx];
    if (firstIdx === 0) {
        posaljiPoruku(chatroomId, `@${sender}, tvoja pesma "${song.artist && song.artist !== 'YouTube' ? song.artist + ' - ' : ''}${song.title}" trenutno svira u lajvu!`);
        return;
    }

    // Izračunaj procenjeno vreme čekanja
    let waitSecs = 0;
    for (let i = 0; i < firstIdx; i++) {
        waitSecs += (queue[i].duration || 210);
    }
    const waitMins = Math.max(1, Math.round(waitSecs / 60));
    const extra = userIndices.length > 1 ? ` (imaš ukupno ${userIndices.length} pesama u redu)` : '';
    posaljiPoruku(chatroomId, `@${sender}, tvoja pesma "${song.artist && song.artist !== 'YouTube' ? song.artist + ' - ' : ''}${song.title}" je na poziciji #${firstIdx + 1} u redu (oko ${waitMins}m čekanja)${extra}.`);
}

async function handleCancelSong(chatroomId, sender) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || channelState.feature_songrequest === false) return;
    const queue = await getOrSyncQueue(chatroomId, channelState);
    const userKey = sender.toLowerCase();

    // Tražimo pesmu koja čeka u redu (počevši od kraja reda unazad da otkažemo poslednju dodatu)
    let foundIdx = -1;
    for (let i = queue.length - 1; i >= 1; i--) {
        if (queue[i].requester && queue[i].requester.toLowerCase() === userKey) {
            foundIdx = i;
            break;
        }
    }

    if (foundIdx === -1 && queue.length > 0 && queue[0].requester && queue[0].requester.toLowerCase() === userKey) {
        posaljiPoruku(chatroomId, `@${sender}, tvoja pesma već svira! Ako želiš da je prekineš, upotrebi komandu !skip.`);
        return;
    }

    if (foundIdx === -1) {
        posaljiPoruku(chatroomId, `@${sender}, nemaš nijednu pesmu na čekanju u redu za puštanje.`);
        return;
    }

    const removed = queue.splice(foundIdx, 1)[0];
    const database = require('../database');
    await database.sacuvajSongQueue(chatroomId, queue);

    // Refundiraj poene ako je bila plaćena
    const cenaPoena = channelState.songrequest_settings?.points_price ?? channelState.songrequest_settings?.cost_points ?? 0;
    let refundMsg = '';
    if (cenaPoena > 0 && channelState.economy && channelState.economy[userKey]) {
        channelState.economy[userKey].coins = (channelState.economy[userKey].coins || 0) + cenaPoena;
        channelState.economyDirty = true;
        channelState.economyDeltas.add(userKey);
        const economy = require('../economy');
        const valuta = economy.dobijNazivValute(channelState);
        refundMsg = ` Refundirano: +${cenaPoena} ${valuta}.`;
    }

    posaljiPoruku(chatroomId, `@${sender}, pesma "${removed.artist && removed.artist !== 'YouTube' ? removed.artist + ' - ' : ''}${removed.title}" je uspešno otkazana i uklonjena iz reda.${refundMsg}`);
}

async function handleClearQueue(chatroomId, sender, senderObj) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || channelState.feature_songrequest === false) return;
    const userKey = sender.toLowerCase();
    const isStreamer = channelState.channelUsername && userKey === channelState.channelUsername.toLowerCase();
    const identity = senderObj && senderObj.identity ? senderObj.identity : {};
    const badges = identity.badges || (Array.isArray(senderObj?.badges) ? senderObj.badges : (senderObj?.sender?.identity?.badges || []));
    const isMod = badges.some(b => b.type === 'moderator' || b.type === 'broadcaster') || isStreamer;

    if (!isMod) {
        posaljiPoruku(chatroomId, `@${sender}, samo moderatori i strimer mogu očistiti red pesama!`);
        return;
    }

    const queue = await getOrSyncQueue(chatroomId, channelState);
    if (queue.length === 0) {
        posaljiPoruku(chatroomId, `Red pesama je već prazan.`);
        return;
    }

    channelState.songrequest_settings.queue = [];
    channelState.songrequest_voteskips = { songId: null, voters: new Set() };
    const database = require('../database');
    await database.sacuvajSongQueue(chatroomId, []);
    posaljiPoruku(chatroomId, `Moderacija (@${sender}) je uspešno očistila ceo red pesama.`);
}

async function handleVoteSkip(chatroomId, sender) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || channelState.feature_songrequest === false) return;
    const queue = await getOrSyncQueue(chatroomId, channelState);
    if (queue.length === 0) {
        posaljiPoruku(chatroomId, `@${sender}, red pesama je prazan - nema aktivne pesme za preskakanje.`);
        return;
    }

    const currentSong = queue[0];
    const songId = currentSong.uid || currentSong.uuid || currentSong.ytId || currentSong.id || `${currentSong.title || ''}_${currentSong.requester || ''}`;

    if (!channelState.songrequest_voteskips || channelState.songrequest_voteskips.songId !== songId) {
        channelState.songrequest_voteskips = { songId: songId, voters: new Set() };
    }

    const tracker = channelState.songrequest_voteskips;
    const userKey = sender.toLowerCase();
    const needed = channelState.songrequest_settings?.voteskip_needed || 5;

    if (tracker.voters.has(userKey)) {
        posaljiPoruku(chatroomId, `@${sender}, već si glasao za preskakanje ove pesme! (${tracker.voters.size}/${needed} glasova)`);
        return;
    }

    tracker.voters.add(userKey);

    if (tracker.voters.size < needed) {
        posaljiPoruku(chatroomId, `@${sender} je glasao za preskakanje pesme (${tracker.voters.size}/${needed} glasova). Kucajte !voteskip da preskočite!`);
        return;
    }

    // Dostignut prag glasova - preskoči pesmu
    const skipped = queue.shift();
    channelState.songrequest_voteskips = { songId: null, voters: new Set() };
    const database = require('../database');
    await database.sacuvajSongQueue(chatroomId, queue);

    const nextSong = queue.length > 0 ? queue[0] : null;
    const nextMsg = nextSong ? ` | Sledeća na redu: "${nextSong.artist && nextSong.artist !== 'YouTube' ? nextSong.artist + ' - ' : ''}${nextSong.title}"` : ' | Red pesama je sada prazan.';
    posaljiPoruku(chatroomId, `Pesma "${skipped.artist && skipped.artist !== 'YouTube' ? skipped.artist + ' - ' : ''}${skipped.title}" je preskočena većinom glasova gledalaca (${needed}/${needed})!${nextMsg}`);
}

async function handleSongLink(chatroomId, sender) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || channelState.feature_songrequest === false) return;
    const queue = await getOrSyncQueue(chatroomId, channelState);
    if (queue.length === 0) {
        posaljiPoruku(chatroomId, `@${sender}, trenutno se ne pušta nijedna pesma.`);
        return;
    }
    const current = queue[0];
    const ytId = current.ytId || (current.id && current.id.startsWith('yt_') ? current.id.slice(3) : null);
    const linkStr = ytId ? `https://youtu.be/${ytId}` : 'Nema YouTube linka';
    posaljiPoruku(chatroomId, `Trenutna pesma: "${current.artist && current.artist !== 'YouTube' ? current.artist + ' - ' : ''}${current.title}" | Link: ${linkStr} (Zatražio: @${current.requester})`);
}

async function handleSetVolume(chatroomId, sender, volumeStr, senderObj) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || channelState.feature_songrequest === false) return;
    const userKey = sender.toLowerCase();
    const isStreamer = channelState.channelUsername && userKey === channelState.channelUsername.toLowerCase();
    const isAuthorized = isStreamer || userKey === 'milan_567';

    if (!isAuthorized) {
        posaljiPoruku(chatroomId, `@${sender}, samo strimer i @Milan_567 mogu podešavati jačinu zvuka muzike!`);
        return;
    }

    const cleanStr = String(volumeStr || '').replace('%', '').trim();
    const val = parseInt(cleanStr, 10);
    if (isNaN(val) || val < 0 || val > 100) {
        posaljiPoruku(chatroomId, `@${sender}, navedite jačinu zvuka od 0 do 100. Primer: !volume 50`);
        return;
    }

    const database = require('../database');
    await database.azurirajSongRequestPodesavanja(chatroomId, { volume: val });
    posaljiPoruku(chatroomId, `Jačina zvuka muzičkog plejera je podešena na ${val}%.`);
}

async function handleTogglePause(chatroomId, sender, action, senderObj) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState || channelState.feature_songrequest === false) return;
    const userKey = sender.toLowerCase();
    const isStreamer = channelState.channelUsername && userKey === channelState.channelUsername.toLowerCase();
    const identity = senderObj && senderObj.identity ? senderObj.identity : {};
    const badges = identity.badges || (Array.isArray(senderObj?.badges) ? senderObj.badges : (senderObj?.sender?.identity?.badges || []));
    const isMod = badges.some(b => b.type === 'moderator' || b.type === 'broadcaster') || isStreamer;

    if (!isMod) {
        posaljiPoruku(chatroomId, `@${sender}, samo moderatori i strimer mogu pauzirati ili nastaviti muziku!`);
        return;
    }

    const stateVal = action === 'pause' ? 'paused' : 'playing';
    const database = require('../database');
    await database.azurirajSongRequestPodesavanja(chatroomId, { playback_state: stateVal });
    posaljiPoruku(chatroomId, `Muzički plejer je ${action === 'pause' ? 'pauziran' : 'nastavljen'}.`);
}

module.exports = {
    handlePesma,
    handleSongQueue,
    handleSkipSong,
    handleCurrentSong,
    handleMySong,
    handleCancelSong,
    handleClearQueue,
    handleVoteSkip,
    handleSongLink,
    handleSetVolume,
    handleTogglePause
};

