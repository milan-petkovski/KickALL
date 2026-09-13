const state = require('../state');
const { log, isValidUsername, sanitizeInput, dobijTrenutniDan, dobijTrenutniMesec } = require('../utils');
const { supabase, KORISTI_SUPABASE } = require('../database');
const { posaljiPoruku } = require('../messenger');

// Kratkotrajni keš za teške godišnje / all-time agregate (15 sekundi)
const topAggCache = new Map();

function handleTop(chatroomId, numRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const rawStr = (numRaw || '').trim();
    const lowerRaw = rawStr.toLowerCase();

    // 1. Provera za pod-leaderboarde: watchtime, coins/poeni, nivoi/level
    if (lowerRaw.startsWith('watchtime') || lowerRaw.startsWith('watch') || lowerRaw.startsWith('gledanje') || lowerRaw.startsWith('sati')) {
        const remainingArg = rawStr.replace(/^(watchtime|watch|gledanje|sati)/i, '').trim();
        const watchtimeMod = require('../watchtime');
        if (channelState.feature_watchtime !== false) {
            watchtimeMod.handleTopWatchtime(chatroomId, remainingArg);
        } else {
            posaljiPoruku(chatroomId, `⚠️ Watchtime sistem je trenutno isključen na ovom kanalu.`);
        }
        return;
    }

    if (lowerRaw.startsWith('coins') || lowerRaw.startsWith('coin') || lowerRaw.startsWith('poeni') || lowerRaw.startsWith('pare') || lowerRaw.startsWith('bal') || lowerRaw.startsWith('novac')) {
        const remainingArg = rawStr.replace(/^(coins|coin|poeni|pare|bal|novac)/i, '').trim();
        const economyMod = require('../economy');
        economyMod.handleTopCoins(chatroomId, remainingArg);
        return;
    }

    if (lowerRaw.startsWith('level') || lowerRaw.startsWith('xp') || lowerRaw.startsWith('nivo') || lowerRaw.startsWith('lvl')) {
        const remainingArg = rawStr.replace(/^(level|xp|nivo|lvl)/i, '').trim();
        const economyMod = require('../economy');
        economyMod.handleTopLevel(chatroomId, remainingArg);
        return;
    }

    // 2. Chatters / Poruke aktivnost (podrazumevano ili preko ključnih reči)
    let cleanedArg = rawStr;
    if (lowerRaw.startsWith('chatters') || lowerRaw.startsWith('chatter') || lowerRaw.startsWith('poruke') || lowerRaw.startsWith('poruka') || lowerRaw.startsWith('chat')) {
        cleanedArg = rawStr.replace(/^(chatters|chatter|poruke|poruka|chat)/i, '').trim();
    }

    const tokens = cleanedArg.split(/\s+/).filter(Boolean);
    let limit = 5;
    let period = 'month'; // default: mesec

    for (const token of tokens) {
        const tLower = token.toLowerCase();
        if (['dan', 'danas', 'dnevno', 'today', 'day', 'daily'].includes(tLower)) {
            period = 'day';
        } else if (['mesec', 'mesecno', 'ovajmesec', 'month', 'monthly'].includes(tLower)) {
            period = 'month';
        } else if (['godina', 'godisnje', 'year', 'yearly'].includes(tLower)) {
            period = 'year';
        } else if (['sve', 'ukupno', 'svevreme', 'all', 'alltime', 'total'].includes(tLower)) {
            period = 'alltime';
        } else {
            const parsed = parseInt(token.replace(/\D/g, ''), 10);
            if (!isNaN(parsed) && parsed > 0) {
                limit = Math.min(15, parsed);
            }
        }
    }

    // 1. Dnevni leaderboard
    if (period === 'day') {
        const dataSource = channelState.leaderboardDaily || {};
        const sortirani = Object.values(dataSource)
            .sort((a, b) => b.count - a.count)
            .filter(x => x.count > 0);

        if (sortirani.length === 0) {
            posaljiPoruku(chatroomId, `🏆 Leaderboard za danas je trenutno prazan. Napišite nešto u chat i budite prvi!`);
            return;
        }
        const topList = sortirani.slice(0, limit)
            .map((x, idx) => `${idx + 1}. @${x.username} (${x.count.toLocaleString()})`)
            .join(', ');
        const dan = channelState.tekuciDanLeaderboarda || dobijTrenutniDan();
        posaljiPoruku(chatroomId, `🏆 Dnevna aktivnost (${dan}) - Top ${limit}: ${topList}`);
        return;
    }

    // 2. Mesečni leaderboard (DEFAULT)
    if (period === 'month') {
        const dataSource = channelState.leaderboard || {};
        const sortirani = Object.values(dataSource)
            .sort((a, b) => b.count - a.count)
            .filter(x => x.count > 0);

        if (sortirani.length === 0) {
            posaljiPoruku(chatroomId, `🏆 Leaderboard za ovaj mesec je trenutno prazan. Napišite nešto u chat i budite prvi!`);
            return;
        }
        const topList = sortirani.slice(0, limit)
            .map((x, idx) => `${idx + 1}. @${x.username} (${x.count.toLocaleString()})`)
            .join(', ');
        const trenutniMesec = dobijTrenutniMesec();
        posaljiPoruku(chatroomId, `🏆 Aktivnost (${trenutniMesec}) - Top ${limit}: ${topList}`);
        return;
    }

    // 3. Godišnji ili Sve vreme (All-time)
    if (period === 'year' || period === 'alltime') {
        if (!KORISTI_SUPABASE) {
            const dataSource = channelState.leaderboard || {};
            const sortirani = Object.values(dataSource).sort((a, b) => b.count - a.count).filter(x => x.count > 0);
            const topList = sortirani.slice(0, limit).map((x, idx) => `${idx + 1}. @${x.username} (${x.count.toLocaleString()})`).join(', ');
            posaljiPoruku(chatroomId, `🏆 Top ${limit} Aktivnost: ${topList}`);
            return;
        }

        (async () => {
            try {
                const cacheKey = `${chatroomId}::${period}`;
                const cached = topAggCache.get(cacheKey);
                const now = Date.now();
                if (cached && now - cached.ts < 15000) {
                    emitTopList(cached.sorted, limit, period, chatroomId);
                    return;
                }

                const currentYear = String(new Date().getFullYear());
                let query = supabase
                    .from('leaderboard')
                    .select('username, display_name, chat')
                    .eq('channel_id', chatroomId);

                if (period === 'year') {
                    query = query.eq('year', currentYear);
                }

                const { data, error } = await query;
                if (error) throw error;

                const mapAgg = new Map();
                (data || []).forEach(row => {
                    const uKey = (row.username || '').toLowerCase();
                    if (!uKey) return;
                    const prev = mapAgg.get(uKey) || { username: row.display_name || row.username, count: 0 };
                    prev.count += Number(row.chat) || 0;
                    if (row.display_name) prev.username = row.display_name;
                    mapAgg.set(uKey, prev);
                });

                // Dodaj neflushovane delte
                if (channelState.leaderboardDeltas) {
                    for (const uKey in channelState.leaderboardDeltas) {
                        const delta = channelState.leaderboardDeltas[uKey] || 0;
                        if (delta > 0) {
                            const prev = mapAgg.get(uKey) || { username: uKey, count: 0 };
                            prev.count += delta;
                            mapAgg.set(uKey, prev);
                        }
                    }
                }

                const sortirani = Array.from(mapAgg.values())
                    .sort((a, b) => b.count - a.count)
                    .filter(x => x.count > 0);

                topAggCache.set(cacheKey, { ts: now, sorted: sortirani });
                emitTopList(sortirani, limit, period, chatroomId);
            } catch (err) {
                log('ERR', `Greška pri dohvatanju Top Leaderboard (${period}): ${err.message}`);
                posaljiPoruku(chatroomId, `❌ Greška pri učitavanju leaderboard-a.`);
            }
        })();
        return;
    }
}

function emitTopList(sortirani, limit, period, chatroomId) {
    const currentYear = String(new Date().getFullYear());
    if (!sortirani || sortirani.length === 0) {
        const periodText = period === 'year' ? `za ${currentYear}. godinu` : 'sve vreme';
        posaljiPoruku(chatroomId, `🏆 Još nema poruka u aktivnosti za ${periodText}!`);
        return;
    }

    const topList = sortirani.slice(0, limit)
        .map((x, idx) => `${idx + 1}. @${x.username} (${x.count.toLocaleString()})`)
        .join(', ');

    const periodLabel = period === 'year' ? `Godina ${currentYear}` : 'Sve vreme';
    posaljiPoruku(chatroomId, `🏆 Top ${limit} Aktivnost (${periodLabel}): ${topList}`);
}

function handleMe(chatroomId, sender, targetRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const target = targetRaw ? targetRaw.split(/\s+/)[0].replace(/^@/, '').trim() : '';
    let user = sender;
    if (target && isValidUsername(target)) {
        user = sanitizeInput(target);
    }

    const key = user.toLowerCase();

    // 1. Poruke i Rang u aktivnosti
    const sortiraniPoruke = Object.values(channelState.leaderboard || {})
        .sort((a, b) => (b.count || 0) - (a.count || 0));
    const rankPorukeIdx = sortiraniPoruke.findIndex(x => (x.username || '').toLowerCase() === key);
    const rankPoruke = rankPorukeIdx !== -1 ? `#${rankPorukeIdx + 1}` : 'N/A';
    const msgCount = channelState.leaderboard[key] ? (channelState.leaderboard[key].count || 0) : 0;

    // 2. Ekonomija (XP, Level, Coins)
    const economyMod = require('../economy');
    const ecoUser = channelState.economy ? channelState.economy[key] : null;
    const xp = ecoUser ? (ecoUser.xp || 0) : 0;
    const nivo = ecoUser ? (ecoUser.level || economyMod.izracunajNivo(xp)) : 0;
    const coins = ecoUser ? (ecoUser.coins || 0) : 0;
    const titula = economyMod.dobijTitulu(nivo);
    const valuta = economyMod.dobijNazivValute(channelState);

    // 3. Watchtime
    const wtUser = channelState.watchtime ? channelState.watchtime[key] : null;
    const minutes = wtUser ? (wtUser.minutes || 0) : 0;
    const sati = Math.floor(minutes / 60);
    const preostaliMin = minutes % 60;
    const wtStr = sati > 0 ? `${sati}h ${preostaliMin}m` : `${minutes}m`;

    posaljiPoruku(chatroomId, `📊 @${user} | Lvl ${nivo} (${titula}) | 🪙 ${coins.toLocaleString()} ${valuta} | 💬 ${msgCount.toLocaleString()} poruka (Rang ${rankPoruke}) | ⏱️ ${wtStr}`);
}

function handleAktivnost(chatroomId, sender, targetRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const target = targetRaw ? targetRaw.split(/\s+/)[0].replace(/^@/, '').trim() : '';
    let user = sanitizeInput(sender);
    if (target && isValidUsername(target)) {
        user = sanitizeInput(target);
    }
    if (!isValidUsername(user)) return;

    const key = user.toLowerCase();

    // 1. Dnevne poruke iz leaderboard_daily
    const dailyCount = channelState.leaderboardDaily && channelState.leaderboardDaily[key]
        ? (channelState.leaderboardDaily[key].count || 0)
        : 0;

    // 2. Mesečne poruke iz leaderboard
    const msgCount = channelState.leaderboard && channelState.leaderboard[key]
        ? (channelState.leaderboard[key].count || 0)
        : 0;

    // 3. Rang korisnika po mesečnim porukama
    const sortiraniPoruke = Object.values(channelState.leaderboard || {})
        .sort((a, b) => (b.count || 0) - (a.count || 0));
    const rankPorukeIdx = sortiraniPoruke.findIndex(x => (x.username || '').toLowerCase() === key);
    const rankPoruke = rankPorukeIdx !== -1 ? `#${rankPorukeIdx + 1}` : 'N/A';

    posaljiPoruku(chatroomId, `💬 @${user} | Čet aktivnost: ${dailyCount.toLocaleString()} poruka danas | ${msgCount.toLocaleString()} ovog meseca (Rang ${rankPoruke})`);
}

module.exports = {
    handleTop,
    handleMe,
    handleAktivnost
};
