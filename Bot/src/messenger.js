const config = require('./config');
const state = require('./state');
const { log } = require('./utils');
const kickAuth = require('./kickAuth');
const { posaljiPrekoZvanicnogApija } = kickAuth;


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
