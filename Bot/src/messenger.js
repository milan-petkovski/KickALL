const state = require('./state');
const { log, kickScrapingHeaders } = require('./utils');
const kickAuth = require('./kickAuth');
const { posaljiPrekoZvanicnogApija } = kickAuth;


const MAX_QUEUE_SIZE = 50;
const MIN_SEND_INTERVAL_MS = 1000; // Leaky Bucket tempo: najviše 1 poruka u sekundi po kanalu

function posaljiPoruku(chatroomId, tekst) {
    if (!chatroomId || !tekst) return;
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    // Zaštita od curenja memorije i zagušenja reda poruka (backpressure)
    if (channelState.messageQueue.length >= MAX_QUEUE_SIZE) {
        log('WARN', `[${channelState.channelUsername || chatroomId}] Red poruka popunjen (${channelState.messageQueue.length}/${MAX_QUEUE_SIZE}). Odbacujem poruku radi prevencije OOM curenja memorije.`);
        return;
    }

    channelState.messageQueue.push(tekst);
    scheduleQueueDrain(chatroomId);
}

function scheduleQueueDrain(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    if (channelState.isProcessingQueue) return;
    if (channelState.messageQueue.length === 0) return;
    if (channelState.queueDrainTimer) return;

    const now = Date.now();
    let delay = 0;

    // 1. Provera aktivne Kick 429 Too Many Requests blokade
    if (channelState.rateLimitUntil && now < channelState.rateLimitUntil) {
        delay = Math.max(0, channelState.rateLimitUntil - now);
    } else {
        // 2. Leaky bucket regulator: obezbeđuje razmak od najmanje MIN_SEND_INTERVAL_MS
        const elapsed = now - (channelState.lastSentTimestamp || 0);
        if (elapsed < MIN_SEND_INTERVAL_MS) {
            delay = MIN_SEND_INTERVAL_MS - elapsed;
        }
    }

    if (delay > 0) {
        channelState.queueDrainTimer = setTimeout(() => {
            channelState.queueDrainTimer = null;
            drainNextMessage(chatroomId);
        }, delay);
        if (channelState.queueDrainTimer && channelState.queueDrainTimer.unref) {
            channelState.queueDrainTimer.unref();
        }
    } else {
        drainNextMessage(chatroomId);
    }
}

async function drainNextMessage(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    if (channelState.isProcessingQueue) return;
    if (channelState.messageQueue.length === 0) return;

    channelState.isProcessingQueue = true;
    const tekst = channelState.messageQueue.shift();
    channelState.lastSentTimestamp = Date.now();

    try {
        await izvrsiSlanje(chatroomId, tekst);
    } catch (error) {
        log('ERR', `[${channelState.channelUsername || chatroomId}] Greška pri izvršavanju slanja poruke: ${error.message}`);
    } finally {
        channelState.isProcessingQueue = false;
        // Ako u redu i dalje ima poruka, nastavi leaky bucket drenažu
        if (channelState.messageQueue.length > 0) {
            scheduleQueueDrain(chatroomId);
        }
    }
}

// Kompatibilni alias za postojeće pozive i testove
function processQueue(chatroomId) {
    scheduleQueueDrain(chatroomId);
}

function resetQueue(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    if (channelState.queueDrainTimer) {
        clearTimeout(channelState.queueDrainTimer);
        channelState.queueDrainTimer = null;
    }
    channelState.messageQueue = [];
    channelState.isProcessingQueue = false;
    channelState.rateLimitUntil = 0;
}

async function izvrsiSlanje(chatroomId, tekst) {
    const channelState = state.getChannelState(chatroomId);
    const channelUsername = channelState && channelState.channelUsername;

    if (!channelUsername) {
        throw new Error(`Korisničko ime kanala nije dostupno za chatroomId: ${chatroomId}`);
    }

    return await posaljiPrekoZvanicnogApija(chatroomId, tekst, channelUsername, channelState);
}

async function posaljiIPinujPoruku(chatroomId, tekst) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const channelUsername = channelState.channelUsername;
    try {
        log('INFO', `[${channelUsername}] Šaljem poruku za pin: "${tekst}"`);
        const msgId = await izvrsiSlanje(chatroomId, tekst);
        if (msgId) {
            log('INFO', `[${channelUsername}] Poruka poslata sa ID-jem: ${msgId}. Pokušavam da je pinujem...`);
            await new Promise(resolve => setTimeout(resolve, 1500));
            await pinujPoruku(chatroomId, msgId);
        } else {
            log('WARN', `[${channelUsername}] Nije dobijen ID poruke, nemoguće je pinovati.`);
        }
    } catch (err) {
        log('ERR', `[${channelUsername}] Greška pri slanju i pinovanju poruke: ${err.message}`);
    }
}

async function pinujPoruku(chatroomId, messageId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const channelUsername = channelState.channelUsername;
    try {
        const { gotScraping } = await import('got-scraping');
        const url = `https://kick.com/api/v2/channels/${channelUsername}/pinned-message`;
        const res = await gotScraping({
            url,
            method: 'POST',
            headers: await kickScrapingHeaders(),
            json: {
                message: { id: messageId },
                duration: 20
            },
            retry: { limit: 0 }
        });

        if (res.statusCode >= 200 && res.statusCode < 300) {
            log('INFO', `[${channelUsername}] Poruka uspešno pinovana na lajvu!`);
        } else if (res.statusCode === 401 || res.statusCode === 403) {
            kickAuth.obrisiKeshSesije();
            log('WARN', `[${channelUsername}] Neuspešan pin poruke (HTTP ${res.statusCode}): Sesijski kolačić bota (session_cookie) je nevažeći ili je istekao. Pinovanje poruka zahteva aktivan session_cookie.`);
        } else {
            log('ERR', `[${channelUsername}] Neuspešan pin poruke: HTTP ${res.statusCode} - ${JSON.stringify(res.body)}`);
        }
    } catch (err) {
        if (err.response && (err.response.statusCode === 401 || err.response.statusCode === 403)) {
            kickAuth.obrisiKeshSesije();
            log('WARN', `[${channelUsername}] Neuspešan pin poruke (HTTP ${err.response.statusCode}): Sesijski kolačić bota (session_cookie) je nevažeći ili je istekao.`);
        } else {
            log('ERR', `[${channelUsername}] Greška pri pinovanju poruke: ${err.message}`);
        }
    }
}

async function odpinujPoruku(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const channelUsername = channelState.channelUsername;
    try {
        const { gotScraping } = await import('got-scraping');
        const url = `https://kick.com/api/v2/channels/${channelUsername}/pinned-message`;
        const res = await gotScraping({
            url,
            method: 'DELETE',
            headers: await kickScrapingHeaders(),
            retry: { limit: 0 }
        });

        if (res.statusCode >= 200 && res.statusCode < 300) {
            log('INFO', `[${channelUsername}] Poruka uspešno odpinovana sa lajva!`);
        } else if (res.statusCode === 401 || res.statusCode === 403) {
            kickAuth.obrisiKeshSesije();
            log('WARN', `[${channelUsername}] Neuspešan unpin poruke (HTTP ${res.statusCode}): Sesijski kolačić bota (session_cookie) je nevažeći ili je istekao.`);
        } else {
            log('ERR', `[${channelUsername}] Neuspešan unpin poruke: HTTP ${res.statusCode} - ${JSON.stringify(res.body)}`);
        }
    } catch (err) {
        if (err.response && (err.response.statusCode === 401 || err.response.statusCode === 403)) {
            kickAuth.obrisiKeshSesije();
            log('WARN', `[${channelUsername}] Neuspešan unpin poruke (HTTP ${err.response.statusCode}): Sesijski kolačić bota (session_cookie) je nevažeći ili je istekao.`);
        } else {
            log('ERR', `[${channelUsername}] Greška pri unpinovanju poruke: ${err.message}`);
        }
    }
}

async function obrisiPoruku(chatroomId, messageId) {
    if (!chatroomId || !messageId) return false;
    const channelState = state.getChannelState(chatroomId);
    const channelName = channelState ? channelState.channelUsername : chatroomId;
    const sendRoomId = (channelState && channelState.realChatroomId) ? channelState.realChatroomId : chatroomId;

    // Ako je prethodno zabeležen nedostatak ovlašćenja, sačekaj kratak prozor pre novog pokušaja
    if (channelState && channelState.deleteUnauthorizedUntil && Date.now() < channelState.deleteUnauthorizedUntil) {
        return false;
    }

    // 1. Zvanični Kick Public API v1: DELETE https://api.kick.com/public/v1/chat/:message_id
    try {
        const accessToken = await kickAuth.getAccessToken();
        if (accessToken) {
            const publicApiUrl = `https://api.kick.com/public/v1/chat/${encodeURIComponent(messageId)}`;
            const resPublic = await fetch(publicApiUrl, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json'
                }
            });

            if (resPublic.ok) {
                if (channelState) channelState.deleteUnauthorizedUntil = 0;
                log('INFO', `[${channelName}] Poruka ${messageId} uspešno obrisana preko zvaničnog Kick Public API-ja.`);
                return true;
            } else if (resPublic.status === 429) {
                const retryAfterHeader = resPublic.headers?.get ? resPublic.headers.get('retry-after') : null;
                const waitMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : 5000;
                if (channelState) {
                    channelState.rateLimitUntil = Math.max(channelState.rateLimitUntil || 0, Date.now() + waitMs);
                }
                log('WARN', `[${channelName}] Kick 429 Rate limit pri brisanju poruke ${messageId}.`);
                return false;
            }
        }
    } catch (publicErr) {
        log('WARN', `[${channelName}] Greška pri brisanju preko Kick Public API: ${publicErr.message}`);
    }

    // 2. Fallback na v2 chatrooms endpoint sa gotScraping (zaobilazi Cloudflare bot zaštitu)
    try {
        const { gotScraping } = await import('got-scraping');
        const url = `https://kick.com/api/v2/chatrooms/${sendRoomId}/messages/${messageId}`;
        const headers = await kickScrapingHeaders();

        const res = await gotScraping({
            url,
            method: 'DELETE',
            headers,
            retry: { limit: 0 }
        });

        if (res.statusCode >= 200 && res.statusCode < 300) {
            if (channelState) channelState.deleteUnauthorizedUntil = 0;
            log('INFO', `[${channelName}] Poruka ${messageId} uspešno obrisana sa lajva.`);
            return true;
        } else if (res.statusCode === 401 || res.statusCode === 403) {
            if (channelState) {
                // Postavi kraći cooldown od 2 minuta (umesto 15)
                channelState.deleteUnauthorizedUntil = Date.now() + 2 * 60 * 1000;
            }
            log('WARN', `[${channelName}] Kick API je vratio HTTP ${res.statusCode} pri brisanju poruke ${messageId}. Proveriti moderator permisije bota.`);
            return false;
        } else if (res.statusCode === 429) {
            const waitMs = 5000;
            if (channelState) {
                channelState.rateLimitUntil = Math.max(channelState.rateLimitUntil || 0, Date.now() + waitMs);
            }
            log('WARN', `[${channelName}] Kick 429 Rate limit pri brisanju poruke ${messageId}. Primenjujem backoff od ${waitMs}ms.`);
            return false;
        } else {
            let bodyText = typeof res.body === 'string' ? res.body.slice(0, 100) : '';
            log('WARN', `[${channelName}] Neuspešno brisanje poruke ${messageId}: HTTP ${res.statusCode} - ${bodyText}`);
            return false;
        }
    } catch (err) {
        log('WARN', `[${channelName}] Greška pri fallback brisanju poruke ${messageId}: ${err.message}`);
        return false;
    }
}

module.exports = {
    posaljiPoruku,
    posaljiIPinujPoruku,
    pinujPoruku,
    odpinujPoruku,
    obrisiPoruku,
    izvrsiSlanje,
    processQueue,
    scheduleQueueDrain,
    resetQueue,
    MIN_SEND_INTERVAL_MS,
    MAX_QUEUE_SIZE
};