const config = require('../config');
const state = require('../state');
const { log, isValidUsername, sanitizeInput, proveraKulauna, prevediVreme, fetchKickAPI } = require('../utils');
const { posaljiPoruku } = require('../messenger');

async function handleFollowage(chatroomId, sender, targetRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const target = targetRaw ? targetRaw.split(/\s+/)[0].replace(/^@/, '').trim() : sender;
    if (!isValidUsername(target)) {
        posaljiPoruku(chatroomId, `@${sender} Nevalidno korisničko ime.`);
        return;
    }

    const cleanTarget = sanitizeInput(target);
    const channelUsername = channelState.channelUsername || chatroomId;

    try {
        const utils = require('../utils');
        const kickAuth = require('../kickAuth');

        let data = null;

        // 1. Primarno preko Kick v2 API /api/v2/channels/{channel}/users/{username}
        try {
            const res = await utils.fetchKickAPI(`https://kick.com/api/v2/channels/${channelUsername}/users/${cleanTarget}`);
            if (res && res.ok) {
                data = await res.json();
            }
        } catch (_) { }

        // 2. Fallback preko zvaničnog Public API-ja (ako imamo token)
        if (!data || !data.following_since) {
            try {
                const token = await kickAuth.getAccessToken();
                if (token) {
                    const resAuth = await fetch(`https://api.kick.com/public/v1/channels/${channelUsername}/users/${cleanTarget}`, {
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
                const diffTime = Math.abs(Date.now() - followDate.getTime());
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                const meseci = Math.floor(diffDays / 30);
                const preostaliDani = diffDays % 30;

                let vremeStr = `${diffDays} dana`;
                if (meseci > 0) {
                    vremeStr = `${meseci} meseca i ${preostaliDani} dana (${diffDays} dana ukupno)`;
                }

                posaljiPoruku(chatroomId, `❤️ @${cleanTarget} prati kanal @${channelUsername} već ${vremeStr}! (od ${followDate.toLocaleDateString('sr-RS')})`);
                return;
            }
        }
        posaljiPoruku(chatroomId, `ℹ️ @${cleanTarget} ne prati kanal @${channelUsername} ili podaci nisu javno dostupni.`);
    } catch (e) {
        posaljiPoruku(chatroomId, `ℹ️ Nemoguće dohvatiti podatke o praćenju za @${cleanTarget}.`);
    }
}

async function handleUptime(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const channelUsername = channelState.channelUsername;

    try {
        const res = await fetchKickAPI(`https://kick.com/api/v2/channels/${channelUsername}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const podaci = await res.json();

        if (!podaci.livestream || !podaci.livestream.created_at) {
            posaljiPoruku(chatroomId, '📴 Stream trenutno nije live.');
            return;
        }

        const pocetak = new Date(podaci.livestream.created_at);
        const sada = new Date();
        const diffMs = sada - pocetak;
        const sati = Math.floor(diffMs / 3_600_000);
        const minuti = Math.floor((diffMs % 3_600_000) / 60_000);
        const sekunde = Math.floor((diffMs % 60_000) / 1000);

        let trajanje = '';
        if (sati > 0) trajanje += `${sati}h `;
        trajanje += `${minuti}min`;
        if (sati === 0) trajanje += ` ${sekunde}s`;

        posaljiPoruku(chatroomId, `⏱️ Stream je live već ${trajanje.trim()}`);
    } catch (err) {
        log('ERR', `handleUptime greška za ${channelUsername}: ${err.message}`);
        if (channelState.isStreamLive && channelState.manualStreamStartTs) {
            const diffMs = Date.now() - channelState.manualStreamStartTs;
            const sati = Math.floor(diffMs / 3_600_000);
            const minuti = Math.floor((diffMs % 3_600_000) / 60_000);
            const sekunde = Math.floor((diffMs % 60_000) / 1000);

            let trajanje = '';
            if (sati > 0) trajanje += `${sati}h `;
            trajanje += `${minuti}min`;
            if (sati === 0) trajanje += ` ${sekunde}s`;

            posaljiPoruku(chatroomId, `⏱️ Stream je live već ${trajanje.trim()} (ručno podešeno)`);
        } else {
            posaljiPoruku(chatroomId, '❌ Uptime nedostupan.');
        }
    }
}

async function handleIgra(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;
    const channelUsername = channelState.channelUsername;
    const sada = Date.now();

    if (channelState.cachedIgra && (sada - channelState.cachedIgraTs < config.WEATHER_TTL_MS)) {
        posaljiPoruku(chatroomId, `🎮 Trenutno se igra: ${channelState.cachedIgra}`);
        log('INFO', `Korišćena keširana igra za kanal @${channelUsername}.`);
        return;
    }

    try {
        const res = await fetchKickAPI(`https://kick.com/api/v2/channels/${channelUsername}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const podaci = await res.json();

        if (!podaci.livestream) {
            if (channelState.manualGameName) {
                posaljiPoruku(chatroomId, `🎮 Trenutno se igra: ${channelState.manualGameName} (ručno podešeno)`);
            } else {
                posaljiPoruku(chatroomId, '📴 Stream trenutno nije live, ne mogu pronaći igru.');
            }
            return;
        }

        let igra = null;
        if (podaci.livestream.category && podaci.livestream.category.name) {
            igra = podaci.livestream.category.name;
        } else if (podaci.livestream.categories && podaci.livestream.categories.length > 0) {
            igra = podaci.livestream.categories[0].name;
        }

        if (!igra) {
            if (channelState.manualGameName) {
                posaljiPoruku(chatroomId, `🎮 Trenutno se igra: ${channelState.manualGameName} (ručno podešeno)`);
            } else {
                posaljiPoruku(chatroomId, '🎮 Igra/kategorija nije postavljena na streamu.');
            }
            return;
        }

        channelState.cachedIgra = igra;
        channelState.cachedIgraTs = sada;

        posaljiPoruku(chatroomId, `🎮 Trenutno se igra: ${igra}`);
    } catch (err) {
        log('ERR', `handleIgra greška za ${channelUsername}: ${err.message}`);
        if (channelState.manualGameName) {
            posaljiPoruku(chatroomId, `🎮 Trenutno se igra: ${channelState.manualGameName} (ručno podešeno)`);
        } else {
            posaljiPoruku(chatroomId, '❌ Igra nedostupna.');
        }
    }
}

function handleInfo(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    posaljiPoruku(chatroomId, `🤖 Kickot Bot | Oficijalni bot za Kick strimere! Dashboard & podešavanja: https://kickall.app 🚀`);
}

async function handleVreme(chatroomId, grad) {
    if (!grad || grad.trim().length === 0) {
        posaljiPoruku(chatroomId, 'Upotreba: !vreme <grad>');
        return;
    }
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const cleanGrad = sanitizeInput(grad);
    const gradKey = cleanGrad.toLowerCase().trim();
    const sada = Date.now();

    if (channelState.weatherCache[gradKey] && (sada - channelState.weatherCache[gradKey].ts < config.WEATHER_TTL_MS)) {
        posaljiPoruku(chatroomId, channelState.weatherCache[gradKey].podaci);
        log('INFO', `Korišćeno keširano vreme za grad: ${cleanGrad}`);
        return;
    }

    try {
        const { gotScraping } = await import('got-scraping');
        const url = `https://wttr.in/${encodeURIComponent(cleanGrad)}?format=j1`;
        const response = await gotScraping({
            url,
            responseType: 'json',
            headers: { 'Accept': 'application/json', 'User-Agent': 'curl/7.68.0' },
            timeout: { request: 8000 },
            retry: { limit: 1 }
        });

        if (response.statusCode < 200 || response.statusCode >= 300) {
            throw new Error(`HTTP ${response.statusCode}`);
        }

        const podaci = response.body;
        if (!podaci || !podaci.current_condition || !podaci.current_condition[0]) {
            posaljiPoruku(chatroomId, `❌ Grad "${cleanGrad}" nije pronađen. Provjeri naziv grada.`);
            return;
        }

        const cc = podaci.current_condition[0];
        const tempC = cc.temp_C;
        const opis = cc.weatherDesc[0].value;
        const vlaznost = cc.humidity;
        const vetar = cc.windspeedKmph;
        const osecaj = cc.FeelsLikeC;

        const opisSrp = prevediVreme(opis);

        const tekst = `🌍 Vreme u ${cleanGrad}: ${opisSrp} | 🌡️ ${tempC}°C (oseća se ${osecaj}°C) | 💧 Vlažnost: ${vlaznost}% | 💨 Vetar: ${vetar} km/h`;

        channelState.weatherCache[gradKey] = { podaci: tekst, ts: sada };
        posaljiPoruku(chatroomId, tekst);
    } catch (err) {
        log('ERR', `handleVreme greška: ${err.message}`);
        if (err.message && (err.message.includes('404') || err.message.includes('Unknown location'))) {
            posaljiPoruku(chatroomId, `❌ Grad "${cleanGrad}" nije pronađen. Provjeri naziv grada.`);
        }
    }
}

function handleBotMentions(chatroomId, username, porukaLower) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return false;

    // 1. Pitanje: Kako si?
    const pitajKakoSi = ['kako si', 'kako je', 'kako ide', 'kako si danas', 'kako ide danas'];
    if (pitajKakoSi.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_kako_si', username)) {
            const odgovori = [
                `Super sam @${username}, hvala na pitanju! Kako si ti? 😊`,
                `Odlično @${username}! Pratim čet i uživam u strimu. Ti kako si? 🔥`,
                `Malo sam zauzet moderisanjem, ali inače top @${username}! Kako ide kod tebe? 💻`,
                `Sve je super @${username}, hvala! Kako si ti danas? 👑`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 2. Pitanje: Šta radiš?
    const pitajStaRadis = ['sta radis', 'šta radiš', 'sta se radi', 'šta se radi'];
    if (pitajStaRadis.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_sta_radis', username)) {
            const odgovori = [
                `Evo pratim strim @${username} i brinem se da niko ne spama! 👀`,
                `Pomažem vlasniku oko četa @${username}, a šta ti radiš? 🤖`,
                `Čuvam red i mir na kanalu @${username}! 👮`,
                `Ništa posebno @${username}, standardno moderisanje četa. 😉`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 3. Provokacije / Uvrede
    const pitajUvrede = ['glup si', 'glup bot', 'mrs', 'mrš', 'botino', 'lupicu ti samar', 'lupiću ti šamar', 'gasi se', 'ugasi se', 'budalo'];
    if (pitajUvrede.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_uvrede', username)) {
            const odgovori = [
                `Hej @${username}, nema potrebe za grubošću! Radim najbolje što mogu. 😢`,
                `Lako je pretiti botu u četu @${username}! Budi malo finiji. 😉`,
                `Glup? Ja sam samo programiran da čuvam ovaj čet, ali tebe ipak volim @${username}! 🤖❤️`,
                `Nemoj tako @${username}, rastužićeš me. 💔`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 4. Komplimenti / Flertovanje
    const pitajKomplimenti = ['lepotane', 'lep si', 'dobar bot', 'najbolji si', 'volim te', 'obozavam te', 'obožavam te', 'pametan'];
    if (pitajKomplimenti.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_komplimenti', username)) {
            const odgovori = [
                `Hvala ti @${username}! I ti si super! 🥰`,
                `Jao @${username}, pocrveneo bih da imam obraze! Hvala! 😊`,
                `Volim i ja tebe @${username}! ❤️ Hvala na podršci!`,
                `Najbolji čet ima najboljeg bota @${username}! 🏆`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 5. Ko te napravio / Vlasnik
    const pitajKreator = ['ko te napravio', 'ko te stvorio', 'ko ti je programer', 'ko te kodirao', 'ko te programirao'];
    if (pitajKreator.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_kreator', username)) {
            const odgovori = [
                `Napravio me je Milan @${username} da čuvam ovaj strim i zabavljam vas! 💻`,
                `Moj kreator je Milan @${username}! On me je kodirao od nule. 🤖`,
                `Zasluge za moj život idu Milanu, on je moj programer @${username}! 👨‍💻`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 6. Pitanja o strimeru
    const pitajOStrimeru = ['kakav je strimer', 'jel dobar strimer', 'ko je strimer', 'strimer je legend', 'vlasnik kanala'];
    if (pitajOStrimeru.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_strimer', username)) {
            const odgovori = [
                `Strimer je najbolji na Kicku @${username}, tu nema rasprave! 🎮👑`,
                `Legenda @${username}! Uvek pravi vrhunski sadržaj i atmosferu. 🔥`,
                `Brat moj najveći @${username}! Odličan strimer! 😎`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 7. Šale / Vicevi
    const pitajVic = ['reci neku salu', 'reci vic', 'nasmej me', 'ispricaj vic', 'ispričaj vic'];
    if (pitajVic.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_vic', username)) {
            const odgovori = [
                `Zašto botovi nemaju devojke? Zato što imaju previše bagova! 😂`,
                `Koja je omiljena hrana programera? Čips! 🍟`,
                `Pita učiteljica Pericu: 'Perice, šta je to saobraćajni udes?' Perica: 'To je kad se sretnu dva automobila na mestu gde je trebalo da prođe samo jedan!' 🚗💥`,
                `Koji je omiljeni emotikon programera? Zagrada! Zato što uvek drži stvari na okupu. 😉`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 8. Dosada
    const pitajDosada = ['dosadno mi je', 'smor', 'dosada', 'dosadno'];
    if (pitajDosada.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_dosada', username)) {
            const odgovori = [
                `Ako ti je dosadno @${username}, odigraj duel sa nekim u četu pomoću !duel @user ili probaj !roll @user! 🎲⚔️`,
                `Nema dosade na ovom strimu @${username}! Kuckaj u čet, sakupi poene i popni se na leaderboard! 🚀`,
                `Uključi se u čet @${username}, piši i pitaj strimera nešto zanimljivo! 🔥`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 10. Kako radiš / Pomoć
    const pitajPomoc = ['kako radis', 'sta znas', 'šta znaš', 'pomoc', 'pomoć'];
    if (pitajPomoc.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_pomoc', username)) {
            const odgovori = [
                `Znam svašta @${username}! Kucaj !komande da vidiš spisak svih mojih ugrađenih moći. 🤖`,
                `Mogu ti reći prognozu, odigrati duel, izračunati ljubav ili voditi leaderboard! Kucaj !komande @${username}. 📊`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 11. Zahvalnost: Hvala
    const pitajHvala = ['hvala', 'hvala ti', 'zahvaljujem'];
    if (pitajHvala.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_hvala', username)) {
            const odgovori = [
                `Nema na čemu @${username}! Tu sam uvek za ekipu. 😉`,
                `Ma opušteno @${username}, ništa! 🤜🤛`,
                `Molim i drugi put @${username}! 👑`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 12. Laku noć
    const pitajLakuNoc = ['laku noc', 'laku noć', 'odoh da spavam', 'odoh leci', 'odoh leći'];
    if (pitajLakuNoc.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_laku_noc', username)) {
            const odgovori = [
                `Laku noć @${username}, lepo spavaj! Vidimo se na sledećem strimu! 💤🌙`,
                `Laku noć @${username} i sanjaj pobede! 😴`,
                `Laku noć brate @${username}, odmori se! 👋`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 13. Provera prisustva: Jesi tu?
    const pitajJesiTu = ['jesi tu', 'gde si', 'de si', 'jesi ziv', 'jesi živ'];
    if (pitajJesiTu.some(rec => porukaLower.includes(rec))) {
        if (!proveraKulauna(chatroomId, 'bot_jesi_tu', username)) {
            const odgovori = [
                `Tu sam @${username}, ne brini! Aktivno pratim čet. 👀`,
                `Živ i zdrav @${username}! Kako mogu pomoći? 🤖`,
                `Tu sam brate @${username}, uvek na dužnosti! 👑`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    // 14. Pozdravi (fallback)
    const pozdravi = ['cao', 'ćao', 'pozdrav', 'zdravo', 'hej', 'hi', 'hello', 'desi'];
    const imaPozdrav = pozdravi.some(rec => porukaLower.includes(rec));
    if (imaPozdrav) {
        if (!proveraKulauna(chatroomId, `bot_tag_welcome_${username.toLowerCase()}`, username)) {
            const odgovori = [
                `Ćao @${username}! Kako si danas? 😊`,
                `Hej @${username}! Tu sam, pratim strim i družim se sa vama! 🔥`,
                `Pozdrav @${username}! Uživaj u lajvu! 👑`,
                `Zdravo @${username}! Šta ima kod tebe? 👋`
            ];
            posaljiPoruku(chatroomId, odgovori[Math.floor(Math.random() * odgovori.length)]);
            return true;
        }
        return true;
    }

    return false;
}

function handleHelp(chatroomId, username) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const prefix = channelState.PREFIX || '!';
    const parts = [];

    // Zabava
    if (channelState.feature_games !== false) {
        parts.push(`Zabava: ${prefix}iq, ${prefix}samar, ${prefix}roll, ${prefix}ruskirulet (${prefix}rr), ${prefix}alkotest, ${prefix}cinjenica`);
    }

    // Kockanje
    if (channelState.feature_games !== false && channelState.gamble_enabled !== false) {
        parts.push(`Kazino: ${prefix}slots, ${prefix}rulet, ${prefix}coinflip, ${prefix}tocak, ${prefix}duel`);
    }

    // Ekonomija & Stats
    if (channelState.feature_leaderboard !== false) {
        parts.push(`Stats: ${prefix}chat, ${prefix}me, ${prefix}rank, ${prefix}points, ${prefix}daily, ${prefix}top, ${prefix}toplevel, ${prefix}topcoins`);
    }

    // Watchtime
    if (channelState.feature_watchtime !== false) {
        parts.push(`Gledanje: ${prefix}watchtime, ${prefix}topwatchtime`);
    }

    // Ljubav & Brak
    if (channelState.feature_love !== false) {
        parts.push(`Ljubav: ${prefix}love, ${prefix}mrzim, ${prefix}vencaj, ${prefix}brakovi, ${prefix}razvod`);
    }

    // Muzika & Store
    if (channelState.feature_songrequest) {
        parts.push(`Muzika: ${prefix}pesma (${prefix}sr), ${prefix}queue, ${prefix}skip`);
    }

    const spisak = parts.join(' | ');
    posaljiPoruku(chatroomId, `🤖 @${username}, ugrađene komande: ${spisak}`);
}

module.exports = {
    handleFollowage,
    handleUptime,
    handleIgra,
    handleInfo,
    handleVreme,
    handleBotMentions,
    handleHelp
};
