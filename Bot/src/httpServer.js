// HTTP Server i API rute za komunikaciju sa dashboard-om i webhook servisima

const http = require('http');
const config = require('./config');
const state = require('./state');
const utils = require('./utils');
const database = require('./database');
const kickAuth = require('./kickAuth');
const messenger = require('./messenger');
const channelManager = require('./channelManager');

const ALLOWED_KICK_REDIRECT_URIS = new Set([
    'http://localhost:5500/auth/kick/callback',
    'http://localhost:5500/auth/kick/callback/',
    'http://127.0.0.1:5500/auth/kick/callback',
    'http://127.0.0.1:5500/auth/kick/callback/',
    'http://localhost:8888/auth/kick/callback',
    'http://localhost:8888/auth/kick/callback/',
    'http://127.0.0.1:8888/auth/kick/callback',
    'http://127.0.0.1:8888/auth/kick/callback/',
    'https://kickall.app/auth/kick/callback',
    'https://kickall.app/auth/kick/callback/',
    'http://localhost:5500/Website/auth/kick/callback',
    'http://localhost:5500/Website/auth/kick/callback/',
    'http://127.0.0.1:5500/Website/auth/kick/callback',
    'http://127.0.0.1:5500/Website/auth/kick/callback/',
    'http://localhost:8888/Website/auth/kick/callback',
    'http://localhost:8888/Website/auth/kick/callback/',
    'http://127.0.0.1:8888/Website/auth/kick/callback',
    'http://127.0.0.1:8888/Website/auth/kick/callback/'
]);

function normalizeKickRedirectUri(uri) {
    if (!uri || typeof uri !== 'string') return null;

    try {
        const parsed = new URL(uri);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return null;
    }
}

function resolveKickRedirectUri(candidate) {
    if (candidate) {
        const normalizedCandidate = normalizeKickRedirectUri(candidate);
        if (ALLOWED_KICK_REDIRECT_URIS.has(candidate) || ALLOWED_KICK_REDIRECT_URIS.has(normalizedCandidate)) {
            return candidate;
        }
    }

    const envUri = process.env.KICK_REDIRECT_URI;
    if (envUri) {
        const normalizedEnvUri = normalizeKickRedirectUri(envUri);
        if (ALLOWED_KICK_REDIRECT_URIS.has(envUri) || ALLOWED_KICK_REDIRECT_URIS.has(normalizedEnvUri)) {
            return envUri;
        }
    }

    return 'https://kickall.app/auth/kick/callback/';
}

function verifyInternalToken(req) {
    const rawSecret = process.env.INTERNAL_API_SECRET || process.env.INTERNAL_SECRET;
    if (!rawSecret) {
        utils.log('ERR', '[AUTH] CRITICAL: INTERNAL_API_SECRET is missing. Rejecting internal admin request (fail-closed).');
        return false;
    }
    const validSecrets = String(rawSecret).split(',').map(s => s.trim()).filter(Boolean);
    if (validSecrets.length === 0) return false;

    const tokenHeader = req.headers['x-internal-token'] || req.headers['x-internal-secret'];
    const authHeader = req.headers['authorization'];

    for (const secret of validSecrets) {
        if (tokenHeader && tokenHeader === secret) return true;
        if (authHeader && (authHeader === `Bearer ${secret}` || authHeader === secret)) return true;
    }
    return false;
}

function readRequestBody(req, res, maxBytes = 50000) {
    return new Promise((resolve, reject) => {
        let body = '';
        let receivedBytes = 0;

        req.on('data', chunk => {
            receivedBytes += chunk.length;
            if (receivedBytes > maxBytes) {
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Payload too large', detail: `Request body exceeds ${maxBytes} bytes limit` }));
                req.destroy();
                return reject(new Error('PAYLOAD_TOO_LARGE'));
            }
            body += chunk.toString();
        });

        req.on('end', () => {
            resolve(body);
        });

        req.on('error', err => {
            reject(err);
        });
    });
}

async function handleHttpRequest(req, res) {
    const origin = req.headers['origin'];
    const allowedOrigins = [
        process.env.ALLOWED_ORIGIN,
        'https://kickall.app',
        'https://www.kickall.app',
        'http://localhost:8888',
        'http://127.0.0.1:8888',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
    ].filter(Boolean);

    if (origin && (allowedOrigins.includes(origin) || origin.endsWith('.netlify.app'))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', 'https://kickall.app');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Internal-Token');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    try {
        const parsedUrl = new URL(req.url, 'http://localhost');

        // ─── Health Check Endpoint (za Render i load balancer-e) ─────────────
        if (parsedUrl.pathname === '/health' || parsedUrl.pathname === '/healthz') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                isLeader: state.isLeader,
                instanceId: state.instanceId,
                uptime: process.uptime()
            }));
            return;
        }

        // ─── Kick OAuth2 Callback ─────────────────────────────────────────────
        if (parsedUrl.pathname === '/auth/kick/callback') {
            const code = parsedUrl.searchParams.get('code');
            const redirectUri = resolveKickRedirectUri(parsedUrl.searchParams.get('redirect_uri'));
            if (!code) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Greška: nedostaje OAuth code parametar.');
                return;
            }

            try {
                const tokenRes = await fetch('https://id.kick.com/oauth/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        grant_type: 'authorization_code',
                        client_id: process.env.KICK_CLIENT_ID,
                        client_secret: process.env.KICK_CLIENT_SECRET,
                        redirect_uri: redirectUri,
                        code: code,
                        code_verifier: parsedUrl.searchParams.get('code_verifier') || ''
                    }).toString()
                });

                if (!tokenRes.ok) {
                    const errText = await tokenRes.text();
                    utils.log('ERR', `Kick OAuth token greška: ${errText}`);
                    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('Greška pri razmeni koda za token.');
                    return;
                }

                const tokenData = await tokenRes.json();
                const accessToken = tokenData.access_token;
                const tokenType = tokenData.token_type || 'Bearer';
                const expiresIn = tokenData.expires_in || 3600;

                utils.log('INFO', 'Kick OAuth2: Uspešno dobijen access_token.');

                const dashboardUrl = `/Website/kickot/dashboard.html#kick_token=${encodeURIComponent(accessToken)}&token_type=${encodeURIComponent(tokenType)}&expires_in=${expiresIn}`;
                res.writeHead(302, { 'Location': dashboardUrl });
                res.end();
            } catch (tokenErr) {
                utils.log('ERR', `Kick OAuth greška pri token razmeni: ${tokenErr.message}`);
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Interna greška pri OAuth autorizaciji.');
            }
            return;
        }

        // ─── Kick OAuth2 Token Exchange API (za Live Server / 5500) ──────────
        if (parsedUrl.pathname === '/api/kick/exchange' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const params = new URLSearchParams(body);
                    const code = params.get('code');
                    const codeVerifier = params.get('code_verifier') || '';
                    const requestedRedirectUri = params.get('redirect_uri');
                    const normalizedRequestedRedirectUri = normalizeKickRedirectUri(requestedRedirectUri);
                    const redirectUri = resolveKickRedirectUri(requestedRedirectUri);
                    if (!code) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Missing code' }));
                        return;
                    }

                    if (requestedRedirectUri && !normalizedRequestedRedirectUri) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid redirect_uri format' }));
                        return;
                    }

                    if (normalizedRequestedRedirectUri && !ALLOWED_KICK_REDIRECT_URIS.has(normalizedRequestedRedirectUri)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'redirect_uri is not allowed' }));
                        return;
                    }

                    const tokenRes = await fetch('https://id.kick.com/oauth/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            grant_type: 'authorization_code',
                            client_id: process.env.KICK_CLIENT_ID,
                            client_secret: process.env.KICK_CLIENT_SECRET,
                            redirect_uri: redirectUri,
                            code: code,
                            code_verifier: codeVerifier
                        }).toString()
                    });

                    if (!tokenRes.ok) {
                        const errText = await tokenRes.text();
                        utils.log('ERR', `[AUTH] Kick token exchange greška: ${errText}`);
                        res.writeHead(502, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Token exchange failed', detail: errText }));
                        return;
                    }

                    const tokenData = await tokenRes.json();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        access_token: tokenData.access_token,
                        token_type: tokenData.token_type || 'Bearer',
                        expires_in: tokenData.expires_in || 3600,
                        scope: tokenData.scope || ''
                    }));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Internal error', detail: err.message }));
                }
            });
            return;
        }

        if (parsedUrl.pathname === '/api/kick/me' && req.method === 'GET') {
            const authHeader = req.headers['authorization'];
            if (!authHeader) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing authorization header' }));
                return;
            }

            try {
                let username = '';
                let userId = '';
                let avatar = '';

                let kickUserRes = await fetch('https://api.kick.com/public/v1/users', {
                    headers: { 'Authorization': authHeader }
                });

                if (kickUserRes.ok) {
                    const kickData = await kickUserRes.json();
                    const kickUser = Array.isArray(kickData?.data) ? kickData.data[0] : kickData?.data || kickData;
                    username = kickUser?.username || kickUser?.name || '';
                    userId = kickUser?.user_id || kickUser?.id || '';
                    avatar = kickUser?.profile_picture || kickUser?.profile_pic || '';
                } else {
                    let altRes = await fetch('https://id.kick.com/oauth/userinfo', {
                        headers: { 'Authorization': authHeader }
                    });
                    if (altRes.ok) {
                        const altData = await altRes.json();
                        username = altData?.preferred_username || altData?.name || altData?.sub || '';
                        userId = altData?.sub || '';
                        avatar = altData?.picture || '';
                    }
                }

                if (!username) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Could not retrieve user info from Kick OAuth' }));
                    return;
                }

                const channelRes = await utils.fetchKickAPI(`https://kick.com/api/v2/channels/${username}`);
                let chatroomId = userId;
                let slug = username;
                if (channelRes.ok) {
                    const channelData = await channelRes.json();
                    chatroomId = channelData?.chatroom?.id || chatroomId;
                    slug = channelData?.slug || slug;
                    avatar = channelData?.user?.profile_pic || avatar;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    id: userId,
                    username: username,
                    slug: slug,
                    avatar: avatar,
                    profile_pic: avatar,
                    chatroom_id: chatroomId
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal error', detail: err.message }));
            }
            return;
        }

        if (parsedUrl.pathname === '/api/avatar') {
            const username = parsedUrl.searchParams.get('username');
            if (!username) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing username parameter' }));
                return;
            }

            try {
                const channelRes = await utils.fetchKickAPI(`https://kick.com/api/v2/channels/${username}`);
                let avatar = '';
                let chatroomId = '';
                let userId = '';
                let slug = username;

                if (channelRes.ok) {
                    const channelData = await channelRes.json();
                    avatar = channelData?.user?.profile_pic || '';
                    chatroomId = channelData?.chatroom?.id || '';
                    userId = channelData?.user_id ? String(channelData.user_id) : '';
                    slug = channelData?.slug || username;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    id: userId,
                    username: username,
                    slug: slug,
                    avatar: avatar,
                    chatroom_id: chatroomId
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal error', detail: err.message }));
            }
            return;
        }

        // Global logout endpoint (zahteva autentikaciju)
        if (parsedUrl.pathname === '/api/global-logout' && req.method === 'POST') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized', detail: 'Missing or invalid authentication token' }));
                return;
            }
            try {
                const body = await new Promise((resolve) => {
                    let data = '';
                    req.on('data', chunk => data += chunk);
                    req.on('end', () => resolve(data));
                });
                const { userId } = JSON.parse(body || '{}');

                if (!global.logoutCache) {
                    global.logoutCache = new Map();
                }
                if (userId) {
                    global.logoutCache.set(userId, Date.now());
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal error', detail: err.message }));
            }
            return;
        }

        // Check logout status endpoint
        if (parsedUrl.pathname === '/api/check-logout' && req.method === 'GET') {
            try {
                const userId = parsedUrl.searchParams.get('userId');
                let shouldLogout = false;

                if (global.logoutCache && userId) {
                    const logoutTime = global.logoutCache.get(userId);
                    if (logoutTime && Date.now() - logoutTime < 300000) {
                        shouldLogout = true;
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ shouldLogout }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal error', detail: err.message }));
            }
            return;
        }

        if (parsedUrl.pathname === '/api/kick/channel') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized access to channel endpoint' }));
                return;
            }
            const username = parsedUrl.searchParams.get('username');
            if (!username) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing username parameter' }));
                return;
            }

            try {
                const apiRes = await utils.fetchKickAPI(`https://kick.com/api/v2/channels/${username}`);
                if (apiRes.ok) {
                    const data = await apiRes.json();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(data));
                } else {
                    res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: `Kick API returned status ${apiRes.status}` }));
                }
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        if (parsedUrl.pathname === '/api/kick/follow-check' && req.method === 'GET') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized access to follow-check endpoint' }));
                return;
            }
            const channel = parsedUrl.searchParams.get('channel') || parsedUrl.searchParams.get('channelUsername');
            const username = parsedUrl.searchParams.get('username');
            if (!channel || !username) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing channel or username parameter' }));
                return;
            }
            const cleanChannel = String(channel).trim().toLowerCase().replace(/^@/, '');
            const cleanTarget = String(username).trim().toLowerCase().replace(/^@/, '');

            try {
                let data = null;
                // 1. Primarno: Kick v2 API
                try {
                    const resV2 = await utils.fetchKickAPI(`https://kick.com/api/v2/channels/${cleanChannel}/users/${cleanTarget}`);
                    if (resV2 && resV2.ok) {
                        data = await resV2.json();
                    }
                } catch (_) { }

                // 2. Fallback preko zvaničnog Public API-ja
                if (!data || !data.following_since) {
                    try {
                        const token = await kickAuth.getAccessToken();
                        if (token) {
                            const resAuth = await fetch(`https://api.kick.com/public/v1/channels/${cleanChannel}/users/${cleanTarget}`, {
                                headers: {
                                    'Authorization': `Bearer ${token}`,
                                    'Accept': 'application/json'
                                }
                            });
                            if (resAuth.ok) {
                                const authData = await resAuth.json();
                                if (authData && (authData.following_since || authData.followed_at)) {
                                    data = { ...data, ...authData };
                                }
                            }
                        }
                    } catch (_) { }
                }

                const rawDate = data ? (data.following_since || data.followed_at || data.follow_date) : null;
                if (rawDate) {
                    const followDate = new Date(rawDate);
                    if (!isNaN(followDate.getTime())) {
                        const diffTime = Math.max(0, Date.now() - followDate.getTime());
                        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            is_following: true,
                            follow_days: diffDays,
                            follow_date: followDate.toISOString(),
                            subscribed_months: typeof data.subscribed_for === 'number' ? data.subscribed_for : 0,
                            username: cleanTarget,
                            channel: cleanChannel
                        }));
                        return;
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    is_following: false,
                    follow_days: 0,
                    follow_date: null,
                    subscribed_months: (data && typeof data.subscribed_for === 'number') ? data.subscribed_for : 0,
                    username: cleanTarget,
                    channel: cleanChannel
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message, is_following: false, follow_days: 0 }));
            }
            return;
        }

        if (parsedUrl.pathname === '/api/kick/logs' && req.method === 'GET') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized access to bot logs' }));
                return;
            }
            const chatroomId = parsedUrl.searchParams.get('chatroom_id') || parsedUrl.searchParams.get('channel_id');
            const channelState = chatroomId ? state.getChannelState(chatroomId) : null;
            const channelUsername = channelState ? channelState.channelUsername : null;

            let filteredLogs = state.globalLogs || [];
            if (channelUsername) {
                const lowerUsername = channelUsername.toLowerCase();
                filteredLogs = filteredLogs.filter(l => 
                    (l.message && l.message.toLowerCase().includes(`[${lowerUsername}]`)) ||
                    (l.message && l.message.toLowerCase().includes(`@${lowerUsername}`))
                );
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(filteredLogs));
            return;
        }

        if (parsedUrl.pathname === '/api/kick/test-ping' && req.method === 'POST') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized access to test-ping' }));
                return;
            }
            try {
                const body = await readRequestBody(req, res, 50000);
                const params = new URLSearchParams(body);
                const chatroomId = params.get('chatroom_id');
                if (!chatroomId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing chatroom_id parameter' }));
                    return;
                }

                await messenger.izvrsiSlanje(chatroomId, '🤖 Veza je uspešno testirana! 🟢');

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Test message sent' }));
            } catch (err) {
                if (err.message !== 'PAYLOAD_TOO_LARGE') {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Failed to send message', detail: err.message }));
                }
            }
            return;
        }

        if (parsedUrl.pathname === '/api/kick/send-message' && req.method === 'POST') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized access to send-message' }));
                return;
            }
            try {
                const body = await readRequestBody(req, res, 50000);
                let chatroomId = '';
                let channelUsername = '';
                let message = '';
                try {
                    const json = JSON.parse(body);
                    chatroomId = json.chatroom_id || json.channel_id;
                    channelUsername = json.channel_username || json.username;
                    message = json.message;
                } catch (_) {
                    const params = new URLSearchParams(body);
                    chatroomId = params.get('chatroom_id') || params.get('channel_id');
                    channelUsername = params.get('channel_username') || params.get('username');
                    message = params.get('message');
                }

                if (!chatroomId || !message) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing chatroom_id or message parameter' }));
                    return;
                }

                const idStr = String(chatroomId);
                const channelState = state.getChannelState(idStr);
                if (channelState && channelUsername && !channelState.channelUsername) {
                    channelState.channelUsername = channelUsername;
                }

                messenger.posaljiPoruku(idStr, String(message).trim());

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Message queued for sending' }));
            } catch (err) {
                if (err.message !== 'PAYLOAD_TOO_LARGE') {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Failed to send message', detail: err.message }));
                }
            }
            return;
        }

        if (parsedUrl.pathname === '/api/kick/update-session' && req.method === 'POST') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
            try {
                const body = await readRequestBody(req, res, 50000);
                const json = JSON.parse(body);
                const cookie = json.session_cookie || json.cookie;
                if (!cookie || typeof cookie !== 'string' || cookie.trim().length < 10) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing or invalid session_cookie' }));
                    return;
                }
                const ok = await kickAuth.saveSessionCookie(cookie.trim());
                if (ok) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Sesijski kolačić uspešno sačuvan u Supabase.' }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Greška pri čuvanju sesijskog kolačića u Supabase.' }));
                }
            } catch (err) {
                if (err.message !== 'PAYLOAD_TOO_LARGE') {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Interna greška', detail: err.message }));
                }
            }
            return;
        }

        if (parsedUrl.pathname === '/api/internal/subscription-sync' && req.method === 'POST') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
            try {
                const body = await readRequestBody(req, res, 50000);
                const json = JSON.parse(body || '{}');
                const userId = json.userId || json.clientReferenceId;
                if (userId) {
                    for (const chatroomId of Object.keys(state.channels)) {
                        const chState = state.channels[chatroomId];
                        if (chState && chState.userId === userId) {
                            await database.ucitajUserPlan(userId, chatroomId);
                            await database.ucitajCustomKomande(chatroomId);
                            utils.log('INFO', `[SubscriptionSync] Osvežen plan za korisnika ${userId} (@${chState.channelUsername}).`);
                        }
                    }
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                if (err.message !== 'PAYLOAD_TOO_LARGE') {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Interna greška pri sinhronizaciji pretplate', detail: err.message }));
                }
            }
            return;
        }

        if (parsedUrl.pathname === '/api/kick/reload') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized access to reload endpoint' }));
                return;
            }
            const chatroomId = parsedUrl.searchParams.get('chatroom_id') || parsedUrl.searchParams.get('channel_id');
            if (!chatroomId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing chatroom_id parameter' }));
                return;
            }

            try {
                const cs = state.getChannelState(chatroomId);
                if (cs) {
                    await database.ucitajCustomKomande(chatroomId);
                    await database.ucitajBotConfig(chatroomId);
                    await database.ucitajEkonomiju(chatroomId);
                }

                utils.log('INFO', `[${chatroomId}] Bot konfiguracija i komande uspešno reloadovani preko API poziva.`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Reloaded successfully' }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to reload', detail: err.message }));
            }
            return;
        }

        if (parsedUrl.pathname === '/api/kick/check-moderator') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized access to check-moderator endpoint' }));
                return;
            }
            const chatroomId = parsedUrl.searchParams.get('chatroom_id') || parsedUrl.searchParams.get('channel_id');
            if (!chatroomId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing chatroom_id parameter' }));
                return;
            }

            try {
                await channelManager.proveriDaLiJeLive(chatroomId);
                const channelState = state.getChannelState(chatroomId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    isModerator: channelState?.isModerator,
                    botActive: channelState?.botActive 
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to check moderator status', detail: err.message }));
            }
            return;
        }

        if (parsedUrl.pathname === '/api/channels' && req.method === 'GET') {
            if (!verifyInternalToken(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized access to channels summary' }));
                return;
            }
            try {
                const channelsSummary = Object.keys(state.channels).map(id => {
                    const c = state.channels[id];
                    return {
                        id: id,
                        username: c.channelUsername,
                        realChatroomId: c.realChatroomId || id,
                        botActive: c.botActive,
                        isStreamLive: c.isStreamLive,
                        userPlan: c.userPlan || 'free',
                        subscriptionStatus: c.subscriptionStatus || 'active',
                        customCommandsCount: Object.keys(c.customCommands || {}).length,
                        autoAnnouncesCount: (c.autoAnnounces || []).length,
                        prefix: c.PREFIX
                    };
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    totalActiveChannels: channelsSummary.length,
                    isConnectedToKick: state.isConnected,
                    channels: channelsSummary
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to fetch channels summary', detail: err.message }));
            }
            return;
        }

    } catch (err) {
        utils.log('ERR', `Error handling HTTP request in bot.js: ${err.message || err}`);
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Multi-channel Kick Bot je aktivan!\nKanali na kojima radi: ${Object.values(state.channels).map(c => '@' + c.channelUsername).join(', ') || 'nijedan'}\n`);
}

const PORT = process.env.PORT || 3000;
const server = http.createServer(handleHttpRequest);

function pokreniServer() {
    server.listen(PORT, () => {
        utils.log('INFO', `Lokalni HTTP server pokrenut na portu: ${PORT}`);
    });
}

function zaustaviServer() {
    if (server && server.listening) {
        try {
            server.close();
        } catch (_) {}
    }
}

module.exports = {
    ALLOWED_KICK_REDIRECT_URIS,
    normalizeKickRedirectUri,
    resolveKickRedirectUri,
    verifyInternalToken,
    readRequestBody,
    handleHttpRequest,
    server,
    PORT,
    pokreniServer,
    zaustaviServer
};
