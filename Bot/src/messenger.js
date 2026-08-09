const config = require('./config');
const state = require('./state');
const { log } = require('./utils');
const kickAuth = require('./kickAuth');


function posaljiPoruku(chatroomId, tekst) {
    if (!chatroomId) return;
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    channelState.messageQueue.push(tekst);
    processQueue(chatroomId);
}

async function processQueue(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    if (channelState.isProcessingQueue) return;
    if (channelState.messageQueue.length === 0) return;

    channelState.isProcessingQueue = true;
    const tekst = channelState.messageQueue.shift();

    try {
        await izvrsiSlanje(chatroomId, tekst);
    } catch (error) {
        log('ERR', `[${channelState.channelUsername || chatroomId}] Greška pri izvršavanju slanja poruke: ${error.message}`);
    }

    setTimeout(() => {
        channelState.isProcessingQueue = false;
        processQueue(chatroomId);
    }, 1500);
}

async function izvrsiSlanje(chatroomId, tekst) {
    const channelState = state.getChannelState(chatroomId);
    const channelUsername = channelState && channelState.channelUsername;

    if (channelUsername) {
        try {
            return await posaljiPrekoZvanicnogApija(chatroomId, tekst, channelUsername, channelState);
        } catch (error) {
            if (error.message && error.message.includes('Nema sačuvanih Kick bot tokena')) {
                // OAuth nije podešen, tiho pređi na stari metod
            } else {
                throw error;
            }
        }
    }

    // Fallback: stari neoficijalni endpoint sa statičnim BEARER_TOKEN/BOT_COOKIE.
    return await posaljiPrekoStarogEndpointa(chatroomId, tekst, channelState);
}

async function posaljiPrekoZvanicnogApija(chatroomId, tekst, channelUsername, channelState) {
    try {
        const accessToken = await kickAuth.getAccessToken();
        const broadcasterUserId = await kickAuth.getBroadcasterUserId(channelUsername);

        const response = await fetch('https://api.kick.com/public/v1/chat', {
            method: 'POST',
            headers: {
                'accept':        'application/json',
                'authorization': `Bearer ${accessToken}`,
                'content-type':  'application/json'
            },
            body: JSON.stringify({
                type: 'user',
                content: tekst,
                broadcaster_user_id: broadcasterUserId
            })
        });

        if (!response.ok) {
            const errorText = await response.text();

            // Auto-fallback za NO_LINKS_ERROR (Kada kanal zabranjuje linkove, a bot nije Moderator)
            if (errorText.includes('NO_LINKS_ERROR') && !channelState._retryNoLink) {
                channelState._retryNoLink = true;
                log('WARN', `[${channelUsername}] Kick odbio link (NO_LINKS_ERROR). Sanitizujem link (razdvajam domen sa razmakom) i pokušavam ponovo...`);
                const sanitizedText = tekst
                    .replace(/https?:\/\//gi, '')
                    .replace(/discord\.gg\//gi, 'discord . gg/')
                    .replace(/\.(com|rs|org|net|me|gg)\b/gi, ' . $1');
                try {
                    const result = await posaljiPrekoZvanicnogApija(chatroomId, sanitizedText, channelUsername, channelState);
                    channelState._retryNoLink = false;
                    return result;
                } catch (retryErr) {
                    channelState._retryNoLink = false;
                    throw retryErr;
                }
            }

            // Auto-fallback za MAX_SPECIAL_CHARS_ERROR (Previše specijalnih znakova/emoji-ja)
            if (errorText.includes('MAX_SPECIAL_CHARS_ERROR') && !channelState._retryNoSpecial) {
                channelState._retryNoSpecial = true;
                log('WARN', `[${channelUsername}] Kick odbio poruku (MAX_SPECIAL_CHARS_ERROR). Uklanjam specijalne karaktere i pokušavam ponovo...`);
                const cleanText = tekst
                    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
                    .replace(/[^\w\s\d,.:;!?'"@#$%\-*+()\/\[\]=_čćšđžČĆŠĐŽ]/g, '');
                try {
                    const result = await posaljiPrekoZvanicnogApija(chatroomId, cleanText, channelUsername, channelState);
                    channelState._retryNoSpecial = false;
                    return result;
                } catch (retryErr) {
                    channelState._retryNoSpecial = false;
                    throw retryErr;
                }
            }

            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const json = await response.json();
        const msgId = json && json.data && json.data.message_id;
        state.isBotAuthenticated = true;

        if (msgId) {
            log('BOT', `[${channelUsername}] ${tekst}`);
        } else {
            log('WARN', `[${channelUsername}] Poruka poslata ali API nije vratio message_id. Poruka: "${tekst}"`);
        }
        return msgId;
    } catch (error) {
        log('ERR', `[${channelUsername || chatroomId}] Greška pri slanju preko zvaničnog Kick API-ja: ${error.message}`);
        throw error;
    }
}

async function posaljiPrekoStarogEndpointa(chatroomId, tekst, channelState) {
    const sendRoomId = (channelState && channelState.realChatroomId) ? channelState.realChatroomId : chatroomId;

    if (state.isBotAuthenticated === false && (Date.now() - (state.lastAuthErrorTs || 0) < 30000)) {
        throw new Error('Bot token unauthenticated. Skiping send attempt.');
    }

    const response = await fetch(`https://kick.com/api/v2/messages/send/${sendRoomId}`, {
        method: 'POST',
        headers: {
            'accept':        'application/json',
            'authorization': config.BEARER_TOKEN,
            'content-type':  'application/json',
            'cookie':        config.BOT_COOKIE,
            'user-agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
        },
        body: JSON.stringify({ content: tekst, type: 'message' })
    });

    if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 403 && (errorText.includes('User is not authenticated') || errorText.includes('security policy'))) {
            state.isBotAuthenticated = false;
            state.lastAuthErrorTs = Date.now();
            state.authErrorCount = (state.authErrorCount || 0) + 1;
            log('ERR', `[AUTH] Bot autentifikacija neuspešna (HTTP 403). BEARER_TOKEN ili BOT_COOKIE je nevažeći ili istekao! (${errorText})`);
        } else if (response.status === 400 && errorText.includes('NO_LINKS_ERROR')) {
            log('WARN', `[${(channelState && channelState.channelUsername) || chatroomId}] Poruka sa linkom odbijena od Kick-a (NO_LINKS_ERROR). Proverite da li bot ima Moderator ulogu u kanalu ili da li su linkovi dozvoljeni.`);
        }
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    // Uspešan poziv resetuje auth flag
    state.isBotAuthenticated = true;

    let msgId = null;
    try {
        const json = await response.json();
        msgId = (json.data && json.data.id) || (json.data && json.data.message && json.data.message.id) || json.id || null;
    } catch {
        // JSON parse greška — tretiramo kao tihi neuspeh
    }

    if (msgId) {
        log('BOT', `[${(channelState && channelState.channelUsername) || chatroomId}] ${tekst}`);
    } else {
        log('WARN', `[${(channelState && channelState.channelUsername) || chatroomId}] Poruka tiho odbijena od Kick API-ja (nema msg ID). Bot verovatno nema moderatorska prava u ovom kanalu. Poruka: "${tekst}"`);
    }

    return msgId;
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
            url: url,
            method: 'POST',
            headers: {
                'accept':        'application/json',
                'authorization': config.BEARER_TOKEN,
                'cookie':        config.BOT_COOKIE
            },
            json: {
                message: {
                    id: messageId
                },
                duration: 20
            },
            retry: { limit: 0 }
        });

        if (res.statusCode >= 200 && res.statusCode < 300) {
            log('INFO', `[${channelUsername}] Poruka uspešno pinovana na lajvu!`);
        } else {
            log('ERR', `[${channelUsername}] Neuspešan pin poruke: HTTP ${res.statusCode} - ${JSON.stringify(res.body)}`);
        }
    } catch (err) {
        log('ERR', `[${channelUsername}] Greška pri pinovanju poruke: ${err.message}`);
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
            url: url,
            method: 'DELETE',
            headers: {
                'accept':        'application/json',
                'authorization': config.BEARER_TOKEN,
                'cookie':        config.BOT_COOKIE
            },
            retry: { limit: 0 }
        });

        if (res.statusCode >= 200 && res.statusCode < 300) {
            log('INFO', `[${channelUsername}] Poruka uspešno odpinovana sa lajva!`);
        } else {
            log('ERR', `[${channelUsername}] Neuspešan unpin poruke: HTTP ${res.statusCode} - ${JSON.stringify(res.body)}`);
        }
    } catch (err) {
        log('ERR', `[${channelUsername}] Greška pri unpinovanju poruke: ${err.message}`);
    }
}

async function obrisiPoruku(chatroomId, messageId) {
    if (!chatroomId || !messageId) return false;
    const channelState = state.getChannelState(chatroomId);
    const channelName = channelState ? channelState.channelUsername : chatroomId;
    const sendRoomId = (channelState && channelState.realChatroomId) ? channelState.realChatroomId : chatroomId;
    
    try {
        const { gotScraping } = await import('got-scraping');
        const url = `https://kick.com/api/v2/chatrooms/${sendRoomId}/messages/${messageId}`;
        const res = await gotScraping({
            url: url,
            method: 'DELETE',
            headers: {
                'accept':        'application/json',
                'authorization': config.BEARER_TOKEN,
                'cookie':        config.BOT_COOKIE
            },
            retry: { limit: 0 }
        });
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
            log('INFO', `[${channelName}] Poruka ${messageId} uspešno obrisana sa lajva.`);
            return true;
        } else {
            const bodyText = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
            log('ERR', `[${channelName}] Neuspešno brisanje poruke ${messageId}: HTTP ${res.statusCode} - ${bodyText}`);
            return false;
        }
    } catch (err) {
        log('ERR', `[${channelName}] Greška pri brisanju poruke ${messageId}: ${err.message}`);
        return false;
    }
}

module.exports = {
    posaljiPoruku,
    posaljiIPinujPoruku,
    pinujPoruku,
    odpinujPoruku,
    obrisiPoruku,
    izvrsiSlanje
};
