const { log } = require('./utils');
const { supabase, KORISTI_SUPABASE } = require('./database');

/**
 * Autonomous Stream Analytics Engine for Kickan Studio
 * Beleži kompletnu telemetriju i analitiku strima 24/7 na serveru u public.kickan tabelu,
 * čak i kada streamer ili moderator nema otvoren Kickan dashboard u browseru.
 */

const activeSessions = new Map();
let autoFlushTimer = null;

/**
 * Pomoćna funkcija: pronalazi vlasnički auth user_id za dati Kick kanal
 */
async function resolveOwnerUserId(channelName) {
    if (!KORISTI_SUPABASE || !supabase) return null;
    const clean = String(channelName || '').toLowerCase().trim();
    if (!clean) return null;

    try {
        // 1. Proveri direktno u user_profiles po kick_username
        const { data: directUser, error: directErr } = await supabase
            .from('user_profiles')
            .select('id')
            .ilike('kick_username', clean)
            .limit(1)
            .maybeSingle();

        if (!directErr && directUser?.id) {
            return directUser.id;
        }

        // 2. Proveri unutar kick_channels JSONB niza
        const { data: profiles, error: profErr } = await supabase
            .from('user_profiles')
            .select('id, kick_channels')
            .not('kick_channels', 'is', null);

        if (!profErr && profiles) {
            for (const p of profiles) {
                if (Array.isArray(p.kick_channels)) {
                    const match = p.kick_channels.some(c => (c.username || c.slug || '').toLowerCase() === clean);
                    if (match) return p.id;
                }
            }
        }
    } catch (err) {
        log('WARN', `[StreamAnalytics] Greška pri traženju vlasnika kanala ${channelName}: ${err.message}`);
    }
    return null;
}

/**
 * Pokreće ili obnavlja aktivnu sesiju strima
 */
async function onStreamLive(chatroomId, channelUsername, livestreamData = {}, fallbackUserId = null) {
    if (!chatroomId || !channelUsername) return null;
    const idKey = String(chatroomId);

    let session = activeSessions.get(idKey);
    const streamTitle = livestreamData.session_title || livestreamData.title || 'Kick Live Stream';
    const viewerCount = livestreamData.viewer_count || 0;
    const streamStartedAt = livestreamData.created_at || new Date().toISOString();

    if (session) {
        if (streamTitle && streamTitle !== session.streamTitle) {
            session.streamTitle = streamTitle;
            session.isDirty = true;
        }
        recordViewerCount(chatroomId, viewerCount);
        return session;
    }

    // Proveri da li u bazi već postoji otvorena sesija za ovaj kanal (npr. nakon restarta bota)
    let dbRecord = null;
    if (KORISTI_SUPABASE && supabase) {
        try {
            const { data, error } = await supabase
                .from('kickan')
                .select('*')
                .ilike('channel_name', channelUsername)
                .is('ended_at', null)
                .order('started_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!error && data) {
                dbRecord = data;
                log('INFO', `[StreamAnalytics] Obnovljena postojeća otvorena sesija za @${channelUsername} (ID: ${data.id})`);
            }
        } catch (dbErr) {
            log('WARN', `[StreamAnalytics] Greška pri proveri otvorene sesije za @${channelUsername}: ${dbErr.message}`);
        }
    }

    let userId = fallbackUserId || dbRecord?.user_id;
    if (!userId) {
        userId = await resolveOwnerUserId(channelUsername);
    }

    session = {
        channelName: channelUsername,
        channelId: livestreamData.channel_id || null,
        chatroomId: idKey,
        userId: userId || null,
        streamTitle: dbRecord?.stream_title || streamTitle,
        startedAt: dbRecord?.started_at || streamStartedAt,
        endedAt: null,
        durationSeconds: dbRecord?.duration_seconds || 0,
        peakViewers: Math.max(dbRecord?.peak_viewers || 0, viewerCount),
        avgViewers: dbRecord?.avg_viewers || viewerCount,
        viewerSamples: viewerCount > 0 ? 1 : 0,
        viewerSum: viewerCount,
        totalMessages: dbRecord?.total_messages || 0,
        totalEmotes: dbRecord?.total_emotes || 0,
        uniqueChatters: new Set(),
        chattersMap: new Map(),
        emotesMap: new Map(),
        banLogs: [],
        hourlyCounts: new Array(24).fill(0),
        rollingVelocityTimes: [],
        chatVelocityPeak: dbRecord?.chat_velocity_peak || 0,
        dbRecordId: dbRecord?.id || null,
        isDirty: true,
        lastFlushTs: Date.now()
    };

    // Popuni postojeće podatke ako je sesija obnovljena iz baze
    if (dbRecord?.summary) {
        const sum = dbRecord.summary;
        if (Array.isArray(sum.topChatters)) {
            sum.topChatters.forEach(c => {
                session.uniqueChatters.add(c.user);
                session.chattersMap.set(c.user, {
                    count: c.count || 0,
                    isSub: !!c.isSub,
                    isMod: !!c.isMod,
                    isVip: !!c.isVip,
                    lastSeen: c.lastSeen || '--'
                });
            });
        }
        if (Array.isArray(sum.topEmotes)) {
            sum.topEmotes.forEach(e => {
                session.emotesMap.set(e.name, e.count || 0);
            });
        }
        if (Array.isArray(sum.banLogs)) {
            session.banLogs = sum.banLogs;
        }
        if (Array.isArray(sum.hourlyCounts) && sum.hourlyCounts.length === 24) {
            session.hourlyCounts = sum.hourlyCounts;
        }
    }

    activeSessions.set(idKey, session);
    log('INFO', `[StreamAnalytics] 🔴 Pokrenuto autonomno praćenje lajva za @${channelUsername} (Gledaoci: ${viewerCount})`);

    // Inicijalni flush da red u bazi postoji odmah
    await flushSession(session, false);
    ensureAutoFlushTimer();

    return session;
}

/**
 * Beleži pristiglu poruku u četu
 */
function recordChatMessage(chatroomId, username, content, badges = []) {
    if (!chatroomId || !username || !content) return;
    const session = activeSessions.get(String(chatroomId));
    if (!session) return;

    session.totalMessages++;
    session.uniqueChatters.add(username);

    // Brzina četa (rolling velocity)
    const now = Date.now();
    session.rollingVelocityTimes.push(now);
    const windowStart = now - 60000;
    while (session.rollingVelocityTimes.length > 0 && session.rollingVelocityTimes[0] < windowStart) {
        session.rollingVelocityTimes.shift();
    }
    const currentVelocity = session.rollingVelocityTimes.length;
    if (currentVelocity > session.chatVelocityPeak) {
        session.chatVelocityPeak = currentVelocity;
    }

    // Ažuriraj gledaoca u mapi
    let isSub = false, isMod = false, isVip = false;
    if (Array.isArray(badges)) {
        badges.forEach(b => {
            const t = (typeof b === 'string' ? b : b.type || '').toLowerCase();
            if (t.includes('sub') || t.includes('founder')) isSub = true;
            if (t.includes('mod') || t.includes('broadcaster')) isMod = true;
            if (t.includes('vip')) isVip = true;
        });
    }

    const existingUser = session.chattersMap.get(username) || {
        count: 0,
        isSub: isSub,
        isMod: isMod,
        isVip: isVip,
        lastSeen: new Date().toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })
    };
    existingUser.count++;
    existingUser.isSub = existingUser.isSub || isSub;
    existingUser.isMod = existingUser.isMod || isMod;
    existingUser.isVip = existingUser.isVip || isVip;
    existingUser.lastSeen = new Date().toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
    session.chattersMap.set(username, existingUser);

    // Detekcija Kick i unicode emotea
    const emoteRegex = /\[emote:\d+:([a-zA-Z0-9_\-]+)\]/g;
    let match;
    while ((match = emoteRegex.exec(content)) !== null) {
        const emoteName = match[1];
        session.totalEmotes++;
        session.emotesMap.set(emoteName, (session.emotesMap.get(emoteName) || 0) + 1);
    }

    // Satni raspored
    const hour = new Date().getHours();
    session.hourlyCounts[hour] = (session.hourlyCounts[hour] || 0) + 1;

    // Ažuriraj trajanje
    const startMs = new Date(session.startedAt).getTime();
    if (!isNaN(startMs)) {
        session.durationSeconds = Math.max(0, Math.floor((now - startMs) / 1000));
    }

    session.isDirty = true;
}

/**
 * Beleži akciju moderacije (ban / timeout / kick)
 */
function recordModerationAction(chatroomId, type, targetUser, modUser = 'Sistem', reason = '') {
    if (!chatroomId || !targetUser) return;
    const session = activeSessions.get(String(chatroomId));
    if (!session) return;

    session.banLogs.unshift({
        user: targetUser,
        mod: modUser || 'Sistem',
        reason: reason || 'Prekršaj pravila',
        time: new Date().toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' }),
        type: type || 'BAN'
    });

    if (session.banLogs.length > 50) {
        session.banLogs.length = 50;
    }

    session.isDirty = true;
}

/**
 * Beleži trenutni broj gledalaca sa Kick API-ja
 */
function recordViewerCount(chatroomId, count) {
    if (!chatroomId) return;
    const session = activeSessions.get(String(chatroomId));
    if (!session) return;

    const val = parseInt(count, 10) || 0;
    if (val > session.peakViewers) {
        session.peakViewers = val;
    }

    if (val > 0) {
        session.viewerSamples++;
        session.viewerSum += val;
        session.avgViewers = Math.round(session.viewerSum / session.viewerSamples);
    }

    session.isDirty = true;
}

/**
 * Završava sesiju strima kada kanal ode offline
 */
async function onStreamOffline(chatroomId, channelUsername) {
    const idKey = String(chatroomId);
    const session = activeSessions.get(idKey);
    if (!session) return;

    const now = Date.now();
    const startMs = new Date(session.startedAt).getTime();
    session.endedAt = new Date(now).toISOString();
    if (!isNaN(startMs)) {
        session.durationSeconds = Math.max(0, Math.floor((now - startMs) / 1000));
    }
    session.isDirty = true;

    log('INFO', `[StreamAnalytics] ⚪ Strim za @${channelUsername || session.channelName} je završen (Trajanje: ${session.durationSeconds}s, Poruka: ${session.totalMessages}, Peak: ${session.peakViewers}). Čuvanje u bazu...`);

    await flushSession(session, true);
    activeSessions.delete(idKey);
}

/**
 * Snima stanje jedne sesije u public.kickan
 */
async function flushSession(session, _isFinal = false) {
    if (!session || !KORISTI_SUPABASE || !supabase) return;

    if (!session.userId) {
        session.userId = await resolveOwnerUserId(session.channelName);
        if (!session.userId) {
            log('WARN', `[StreamAnalytics] Nije pronađen user_id za kanal @${session.channelName}. Upis u public.kickan se odlaže.`);
            return;
        }
    }

    const topChatters = Array.from(session.chattersMap.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 25)
        .map(([user, data]) => ({ user, ...data }));

    const topEmotes = Array.from(session.emotesMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([name, count]) => ({ name, count }));

    const summaryPayload = {
        topChatters,
        topEmotes,
        banLogs: session.banLogs.slice(0, 50),
        hourlyCounts: session.hourlyCounts,
        uniqueChattersCount: session.uniqueChatters.size,
        chatVelocity: session.rollingVelocityTimes.length,
        peakVelocity: session.chatVelocityPeak,
        isAutonomous: true,
        savedAt: new Date().toISOString()
    };

    const payload = {
        user_id: session.userId,
        channel_name: session.channelName,
        channel_id: session.channelId ? String(session.channelId) : null,
        chatroom_id: session.chatroomId ? parseInt(session.chatroomId, 10) : null,
        stream_title: session.streamTitle || 'Kick Live Stream',
        started_at: session.startedAt,
        ended_at: session.endedAt || null,
        duration_seconds: session.durationSeconds || 0,
        peak_viewers: session.peakViewers || 0,
        avg_viewers: session.avgViewers || 0,
        total_messages: session.totalMessages || 0,
        total_emotes: session.totalEmotes || 0,
        unique_chatters: session.uniqueChatters.size || 0,
        chat_velocity_peak: session.chatVelocityPeak || 0,
        moderation_actions: session.banLogs.length,
        summary: summaryPayload,
        updated_at: new Date().toISOString()
    };

    try {
        if (session.dbRecordId) {
            const { error } = await supabase
                .from('kickan')
                .update(payload)
                .eq('id', session.dbRecordId);

            if (error) throw error;
        } else {
            const { data, error } = await supabase
                .from('kickan')
                .insert(payload)
                .select('id')
                .maybeSingle();

            if (error) throw error;
            if (data?.id) {
                session.dbRecordId = data.id;
            }
        }
        session.isDirty = false;
        session.lastFlushTs = Date.now();
    } catch (err) {
        log('ERR', `[StreamAnalytics] Greška pri upisu u public.kickan za @${session.channelName}: ${err.message}`);
    }
}

/**
 * Periodični sinhronizator svih aktivnih sesija
 */
async function flushAllSessions() {
    for (const session of activeSessions.values()) {
        if (session.isDirty || (Date.now() - session.lastFlushTs > 60000)) {
            await flushSession(session, false);
        }
    }
}

function ensureAutoFlushTimer() {
    if (!autoFlushTimer) {
        autoFlushTimer = setInterval(() => {
            flushAllSessions().catch(err => {
                log('ERR', `[StreamAnalytics] Greška u autoFlushTimer-u: ${err.message}`);
            });
        }, 30000);
        if (autoFlushTimer.unref) autoFlushTimer.unref();
    }
}

function getActiveSession(chatroomId) {
    return activeSessions.get(String(chatroomId)) || null;
}

module.exports = {
    onStreamLive,
    onStreamOffline,
    recordChatMessage,
    recordModerationAction,
    recordViewerCount,
    flushSession,
    flushAllSessions,
    getActiveSession,
    resolveOwnerUserId
};
