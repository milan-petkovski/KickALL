const config = require('./config');
const state = require('./state');
const { log } = require('./utils');

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
    const response = await fetch(`https://kick.com/api/v2/messages/send/${chatroomId}`, {
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
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const channelState = state.getChannelState(chatroomId);
    log('BOT', `[${(channelState && channelState.channelUsername) || chatroomId}] ${tekst}`);

    try {
        const json = await response.json();
        const msgId = (json.data && json.data.id) || (json.data && json.data.message && json.data.message.id) || json.id || null;
        return msgId;
    } catch {
        return null;
    }
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
    if (!chatroomId || !messageId) return;
    const channelState = state.getChannelState(chatroomId);
    const channelName = channelState ? channelState.channelUsername : chatroomId;
    
    try {
        const response = await fetch(`https://kick.com/api/v2/chatrooms/${chatroomId}/messages/${messageId}`, {
            method: 'DELETE',
            headers: {
                'accept':        'application/json',
                'authorization': config.BEARER_TOKEN,
                'content-type':  'application/json',
                'cookie':        config.BOT_COOKIE,
                'user-agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            log('ERR', `[${channelName}] Neuspešno brisanje poruke ${messageId}: HTTP ${response.status} - ${errorText}`);
        } else {
            log('INFO', `[${channelName}] Poruka ${messageId} uspešno obrisana sa lajva.`);
        }
    } catch (err) {
        log('ERR', `[${channelName}] Greška pri brisanju poruke ${messageId}: ${err.message}`);
    }
}

module.exports = {
    posaljiPoruku,
    posaljiIPinujPoruku,
    pinujPoruku,
    odpinujPoruku,
    obrisiPoruku
};
