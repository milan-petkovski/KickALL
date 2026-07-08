const config = require('./config');
const state = require('./state');
const { log } = require('./utils');

function posaljiPoruku(tekst) {
    state.messageQueue.push(tekst);
    processQueue();
}

async function processQueue() {
    if (state.isProcessingQueue) return;
    if (state.messageQueue.length === 0) return;

    state.isProcessingQueue = true;
    const tekst = state.messageQueue.shift();

    try {
        await izvrsiSlanje(tekst);
    } catch (error) {
        log('ERR', `Greška pri izvršavanju slanja poruke: ${error.message}`);
    }

    setTimeout(() => {
        state.isProcessingQueue = false;
        processQueue();
    }, 1500);
}

async function izvrsiSlanje(tekst) {
    const response = await fetch(`https://kick.com/api/v2/messages/send/${config.CHATROOM_ID}`, {
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

    log('BOT', tekst);

    try {
        const json = await response.json();
        const msgId = (json.data && json.data.id) || (json.data && json.data.message && json.data.message.id) || json.id || null;
        return msgId;
    } catch {
        return null;
    }
}

async function posaljiIPinujPoruku(tekst) {
    try {
        log('INFO', `Šaljem poruku za pin: "${tekst}"`);
        const msgId = await izvrsiSlanje(tekst);
        if (msgId) {
            log('INFO', `Poruka poslata sa ID-jem: ${msgId}. Pokušavam da je pinujem...`);
            await new Promise(resolve => setTimeout(resolve, 1500));
            await pinujPoruku(msgId);
        } else {
            log('WARN', 'Nije dobijen ID poruke, nemoguće je pinovati.');
        }
    } catch (err) {
        log('ERR', `Greška pri slanju i pinovanju poruke: ${err.message}`);
    }
}

async function pinujPoruku(messageId) {
    try {
        const { gotScraping } = await import('got-scraping');
        const url = `https://kick.com/api/v2/channels/${config.CHANNEL_USERNAME}/pinned-message`;
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
            log('INFO', `Poruka uspešno pinovana na lajvu!`);
        } else {
            log('ERR', `Neuspešan pin poruke: HTTP ${res.statusCode} - ${JSON.stringify(res.body)}`);
        }
    } catch (err) {
        log('ERR', `Greška pri pinovanju poruke: ${err.message}`);
    }
}

async function odpinujPoruku() {
    try {
        const { gotScraping } = await import('got-scraping');
        const url = `https://kick.com/api/v2/channels/${config.CHANNEL_USERNAME}/pinned-message`;
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
            log('INFO', `Poruka uspešno odpinovana sa lajva!`);
        } else {
            log('ERR', `Neuspešan unpin poruke: HTTP ${res.statusCode} - ${JSON.stringify(res.body)}`);
        }
    } catch (err) {
        log('ERR', `Greška pri unpinovanju poruke: ${err.message}`);
    }
}

module.exports = {
    posaljiPoruku,
    posaljiIPinujPoruku,
    pinujPoruku,
    odpinujPoruku
};
