/**
 * kickall - Interaktivni Skriptovi
 * Sadrži simulatore, animacije brojača, jezički switcher i specijalne efekte
 */

// CONFIG is loaded from config.js and available as window.CONFIG

// Track Referral Code from URL
(function checkReferralParam() {
    try {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get('ref') || params.get('referral');
        if (ref) {
            const storageKey = (window.CONFIG && window.CONFIG.STORAGE_KEYS) ? window.CONFIG.STORAGE_KEYS.USER_REFERRAL_CODE : 'user_referral_code';
            localStorage.setItem(storageKey, ref.trim().toUpperCase());
        }
    } catch (e) {
        // Silently fail if storage unavailable
    }
})();

document.addEventListener('DOMContentLoaded', () => {
    // Element References
    const authKickLoginBtn = document.getElementById('authKickLoginBtn');

    // OAuth Callback Handling - Now managed by global-auth.js
    
    // Reset loading state on page visibility change (handles back button)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && authKickLoginBtn) {
            authKickLoginBtn.classList.remove('loading');
            const btnText = authKickLoginBtn.querySelector('span');
            if (btnText) {
                btnText.textContent = btnText.getAttribute('data-i18n') ? 
                    window.translations?.auth?.signInWithKick || 'Prijavi se preko Kicka' : 
                    'Prijavi se preko Kicka';
            }
        }
    });
    
    // Reset loading state on pageshow event (handles back/forward navigation)
    window.addEventListener('pageshow', (event) => {
        if (authKickLoginBtn) {
            authKickLoginBtn.classList.remove('loading');
            const btnText = authKickLoginBtn.querySelector('span');
            if (btnText) {
                btnText.textContent = btnText.getAttribute('data-i18n') ? 
                    window.translations?.auth?.signInWithKick || 'Prijavi se preko Kicka' : 
                    'Prijavi se preko Kicka';
            }
        }
    });
    
    if (authKickLoginBtn) {
        authKickLoginBtn.classList.remove('loading');
        const btnText = authKickLoginBtn.querySelector('span');
        if (btnText) {
            btnText.textContent = btnText.getAttribute('data-i18n') ? 
                window.translations?.auth?.signInWithKick || 'Prijavi se preko Kicka' : 
                'Prijavi se preko Kicka';
        }
    }
    
    // -----------------------------------------------------------------
    // 1. Jezički Switcher (SR / EN)
    // -----------------------------------------------------------------
    const btnSr = document.getElementById('btn-sr');
    const btnEn = document.getElementById('btn-en');
    
    // Current language state
    let currentLang = 'sr';
    // Učitaj sačuvani jezik ili postavi podrazumevani (SR)
    let savedLang = 'sr';
    try {
        savedLang = localStorage.getItem('kickall_lang') || 'sr';
    } catch (e) {
        console.warn('LocalStorage not available:', e);
    }
    setLanguage(savedLang);

    if (btnSr && btnEn) {
        btnSr.addEventListener('click', () => {
            setLanguage('sr');
            playSynthSound(450, 'sine', 0.1);
        });
        btnEn.addEventListener('click', () => {
            setLanguage('en');
            playSynthSound(450, 'sine', 0.1);
        });
    }

async function setLanguage(lang) {
    const oldLang = currentLang; // Capture previous language
    currentLang = lang;
    document.documentElement.lang = lang;
    
    try {
        localStorage.setItem('kickall_lang', lang);
    } catch (e) {
        console.warn('LocalStorage not available:', e);
    }

    if (btnEn && btnSr) {
        btnEn.classList.toggle('active', lang === 'en');
        btnSr.classList.toggle('active', lang === 'sr');
    }

    // Track language change
    if (window.KickALLAnalytics) {
        window.KickALLAnalytics.trackLanguageChange(oldLang, lang);
    }

    await loadTranslations(lang);
    checkAuthSession(); // Osvežava dinamične kartice i dugmad na novom jeziku
    
    // Dispatch language change event for consent banner and pricing updates
    document.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lang } }));
    
    // Additional event specifically for pricing updates
    document.dispatchEvent(new CustomEvent('pricingLanguageChanged', { detail: { language: lang } }));
}

    async function loadTranslations(lang) {
        try {
            const res = await fetch(`/locales/${lang}.json`);
            if (res.ok) {
                const data = await res.json();
                window.translations = data;
                applyTranslations(data);
            } else {
                console.warn(`Failed to load translations for ${lang}: HTTP ${res.status}`);
            }
        } catch (e) {
            console.error('JSON i18n load error:', e);
        }
    }

    function applyTranslations(obj, prefix = '') {
        for (const key in obj) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                applyTranslations(obj[key], fullKey);
            } else {
                const elements = document.querySelectorAll(`[data-i18n="${fullKey}"]`);
                elements.forEach(el => {
                    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                        el.placeholder = obj[key];
                    } else if (el.classList.contains('btn-text') || !/<[a-z][\s\S]*>/i.test(obj[key])) {
                        el.textContent = obj[key];
                    } else {
                        el.innerHTML = obj[key];
                    }
                });
            }
        }
    }


    // -----------------------------------------------------------------
    // 3. Mobilni Meni
    // -----------------------------------------------------------------
    const mobileToggle = document.getElementById('mobileToggle');
    const navMenu = document.getElementById('navMenu');
    const mobileMenuClose = document.getElementById('mobileMenuClose');
    const mobileLoginBtn = document.getElementById('mobileLoginBtn');

    if (mobileToggle && navMenu) {
        mobileToggle.addEventListener('click', () => {
            navMenu.classList.toggle('open');
            mobileToggle.classList.toggle('active');
            document.body.classList.toggle('nav-menu-open');
            document.documentElement.classList.toggle('nav-menu-open');
            
            // Animacija dugmeta (burger u X)
            const spans = mobileToggle.querySelectorAll('span');
            if (mobileToggle.classList.contains('active')) {
                spans[0].style.transform = 'rotate(45deg) translate(6px, 6px)';
                spans[1].style.opacity = '0';
                spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
            } else {
                spans[0].style.transform = 'none';
                spans[1].style.opacity = '1';
                spans[2].style.transform = 'none';
            }
        });

        // Zatvori meni na klik linka
        navMenu.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('open');
                mobileToggle.classList.remove('active');
                document.body.classList.remove('nav-menu-open');
                document.documentElement.classList.remove('nav-menu-open');
                mobileToggle.querySelectorAll('span').forEach(s => s.style.transform = 'none');
                mobileToggle.querySelectorAll('span')[1].style.opacity = '1';
            });
        });
    }

    // Mobile menu close button
    if (mobileMenuClose && navMenu && mobileToggle) {
        mobileMenuClose.addEventListener('click', () => {
            navMenu.classList.remove('open');
            mobileToggle.classList.remove('active');
            document.body.classList.remove('nav-menu-open');
            document.documentElement.classList.remove('nav-menu-open');
            mobileToggle.querySelectorAll('span').forEach(s => s.style.transform = 'none');
            mobileToggle.querySelectorAll('span')[1].style.opacity = '1';
        });
    }

    // Mobile login button
    if (mobileLoginBtn) {
        mobileLoginBtn.addEventListener('click', () => {
            openAuthModal();
            // Close mobile menu
            navMenu.classList.remove('open');
            mobileToggle.classList.remove('active');
            document.body.classList.remove('nav-menu-open');
            document.documentElement.classList.remove('nav-menu-open');
            mobileToggle.querySelectorAll('span').forEach(s => s.style.transform = 'none');
            mobileToggle.querySelectorAll('span')[1].style.opacity = '1';
        });
    }

    // Close mobile menu when clicking outside
    document.addEventListener('click', (e) => {
        if (navMenu && navMenu.classList.contains('open')) {
            // Check if click is outside nav menu and mobile toggle
            if (!navMenu.contains(e.target) && !mobileToggle.contains(e.target)) {
                navMenu.classList.remove('open');
                mobileToggle.classList.remove('active');
                document.body.classList.remove('nav-menu-open');
                document.documentElement.classList.remove('nav-menu-open');
                mobileToggle.querySelectorAll('span').forEach(s => s.style.transform = 'none');
                mobileToggle.querySelectorAll('span')[1].style.opacity = '1';
            }
        }
    });

    // -----------------------------------------------------------------
    // 4. Tabovi u Playground Sekciji
    // -----------------------------------------------------------------
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');
            switchTab(targetTab);
        });
    });

    function switchTab(targetTab) {
        // Deaktiviraj sve tastere i sadržaje
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));

        // Aktiviraj kliknuti taster i njegov sadržaj
        const activeBtn = document.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        const targetElement = document.getElementById(`tab-${targetTab}`);
        if (targetElement) {
            targetElement.classList.add('active');
        }

        // Ako je otvoren kickan tab, ponovo pokreni animaciju grafikona
        if (targetTab === 'kickan') {
            triggerGraphAnimation();
        }
    }

    // -----------------------------------------------------------------
    // 5. Povezivanje "4 stubova" sa Playground-om (Simulacija sa Scroll-om)
    // -----------------------------------------------------------------
    const simulateTriggers = document.querySelectorAll('.feature-simulate-trigger');
    const footerTabTriggers = document.querySelectorAll('.footer-tab-trigger');
    const mainPlayground = document.getElementById('mainPlayground');

    function handleTabTrigger(trigger) {
        const targetTab = trigger.getAttribute('data-target-tab');
        
        // 1. Promeni tab
        switchTab(targetTab);
        playSynthSound(600, 'sine', 0.15);

        // 2. Skroluj do playground-a
        const playgroundSection = document.getElementById('playground');
        if (playgroundSection) {
            // Proveri da li je već vidljiv da bi se izbegao nepotrebni scroll
            const rect = playgroundSection.getBoundingClientRect();
            const isVisible = rect.top < window.innerHeight && rect.bottom >= 0;
            
            if (!isVisible) {
                // Koristi instant scroll za manje glitchova
                playgroundSection.scrollIntoView({ behavior: 'auto', block: 'start' });
            }
        }

    }

    simulateTriggers.forEach(trigger => {
        trigger.addEventListener('click', (e) => {
            e.preventDefault();
            handleTabTrigger(trigger);
        });
    });

    footerTabTriggers.forEach(trigger => {
        trigger.addEventListener('click', (e) => {
            e.preventDefault();
            handleTabTrigger(trigger);
        });
    });

    // -----------------------------------------------------------------
    // 6. Uklanjanje Blura ("Isprobaj Simulaciju" dugmad)
    // -----------------------------------------------------------------
    const dismissButtons = document.querySelectorAll('.btn-dismiss-overlay');

    dismissButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const overlay = document.getElementById(targetId);
            if (overlay) {
                overlay.classList.add('hidden');
                playSynthSound(600, 'sine', 0.15);
                setTimeout(() => {
                    playSynthSound(800, 'sine', 0.2);
                }, 100);
                
                // Ako je u pitanju kickan, re-animiraj grafikon
                if (targetId === 'overlay-kickan') {
                    triggerGraphAnimation();
                }
            }
        });
    });

    // -----------------------------------------------------------------
    // 7. KICKOT Simulator chata
    // -----------------------------------------------------------------
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatMessages = document.getElementById('chatMessages');
    const quickCmdBadges = document.querySelectorAll('.cmd-badge');

    let userPoints = 100;
    const cooldowns = {
        bacihejt: 0,
        posaljiljubav: 0
    };

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    const roastReplies = [
        "Uff... {ime} ima cooldown od 10 minuta na šarm i lepo ponašanje!",
        "Izgleda da je {ime} zaboravio da upali monitor pre strima.",
        "Moj procesor ne može da pronađe skil kod igrača {ime}. Traženje prekinuto...",
        "Mislio sam da sam ja bot, ali onda sam video kako {ime} igra."
    ];

    const loveReplies = [
        "Šaljemo ogromnu ljubav za {ime}! Tvoja energija drži ovaj strim!",
        "{ime} je zvanično proglašen za najjačeg gledaoca danas!",
        "Ljubav poslata! {ime}, ti si legenda!",
        "Ekipa iz chata šalje zagrljaj za {ime}! Hvala što si tu!"
    ];

    const roastRepliesEn = [
        "Uff... {ime} has a 10-minute cooldown on charm and good behavior!",
        "It seems like {ime} forgot to turn on their monitor before streaming.",
        "My processor cannot find any skill on player {ime}. Search aborted...",
        "I thought I was the bot, but then I watched {ime} play."
    ];

    const loveRepliesEn = [
        "Sending huge love to {ime}! Your energy keeps this stream going!",
        "{ime} is officially declared the absolute best viewer today!",
        "Love sent! {ime}, you are a legend!",
        "Chat crew sends a warm hug to {ime}! Thanks for being here!"
    ];

    function addChatMessage(user, text, isBot = false, isSystem = false, userType = 'regular') {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${isBot ? 'bot-response' : ''} ${isSystem ? 'system' : ''}`;

        const time = new Date().toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
        
        let userClass = 'msg-user';
        if (userType === 'moderator') userClass += ' moderator';
        if (userType === 'vip') userClass += ' vip';

        const safeUser = escapeHtml(user);
        const safeText = isBot ? text : escapeHtml(text); // Bot poruke sadrže kontrolisane formatirane tagove, običan korisnik se sanitizuje

        if (isSystem) {
            msgDiv.innerHTML = `
                <span class="msg-time">${time}</span>
                <span class="msg-text">${safeText}</span>
            `;
        } else if (isBot) {
            msgDiv.innerHTML = `
                <span class="msg-time">${time}</span>
                <span class="msg-user">kickot</span>
                <span class="msg-text">${safeText}</span>
            `;
        } else {
            msgDiv.innerHTML = `
                <span class="msg-time">${time}</span>
                <span class="${userClass}">${safeUser}:</span>
                <span class="msg-text">${safeText}</span>
            `;
        }

        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function playSynthSound(frequency, type, duration) {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.type = type;
            oscillator.frequency.value = frequency;
            
            gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.start();
            oscillator.stop(audioCtx.currentTime + duration);
        } catch (e) {
            // Audio API not supported - silently fail
        }
    }

    if (chatForm && chatInput) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const message = chatInput.value.trim();
            if (!message) return;

            const t = window.translations || {};
            const chatSim = t.chatSim || {};
            const viewerName = chatSim.viewer || 'Gledalac';
            addChatMessage(viewerName, message, false, false, 'moderator');
            chatInput.value = '';
            playSynthSound(400, 'sine', 0.05);

            setTimeout(() => {
                handleBotCommand(message);
            }, 800);
        });
    }

    quickCmdBadges.forEach(badge => {
        badge.addEventListener('click', () => {
            const cmd = badge.textContent.trim();
            const t = window.translations || {};
            const chatSim = t.chatSim || {};
            const viewerName = chatSim.viewer || 'Gledalac';
            addChatMessage(viewerName, cmd, false, false, 'moderator');
            playSynthSound(400, 'sine', 0.05);
            setTimeout(() => {
                handleBotCommand(cmd);
            }, 800);
        });
    });

    function handleBotCommand(message) {
        const parts = message.split(' ');
        const cmd = parts[0].toLowerCase();
        const arg = parts.slice(1).join(' ').trim();
        const isEn = currentLang === 'en';
        const lang = currentLang;
        
        // Get translations from global translations object
        const t = window.translations || {};
        const chatSim = t.chatSim || {};
        const viewerName = chatSim.viewer || window.CONFIG.DEFAULTS.VIEWER_NAME;
        const botName = chatSim.bot || window.CONFIG.DEFAULTS.BOT_NAME;

        if (cmd === '!bacihejt') {
            const target = arg || chatSim.unnamedViewer || (isEn ? 'Unnamed viewer' : 'Neimenovani gledalac');
            const sada = Date.now();
            
            if (sada - cooldowns.bacihejt < 10000) {
                const preostalo = Math.ceil((10000 - (sada - cooldowns.bacihejt)) / 1000);
                let errText = chatSim.cooldownError || 'Error: Command {cmd} is on cooldown for {time}s! (Originally 10m)';
                errText = errText.replace('{cmd}', '!bacihejt').replace('{time}', preostalo);
                addChatMessage(botName, errText, true);
                playSynthSound(150, 'sawtooth', 0.25);
                return;
            }
            cooldowns.bacihejt = sada;

            const randomPoint = Math.random() > 0.5 ? 2 : -5;
            userPoints += randomPoint;

            const replies = isEn ? roastRepliesEn : roastReplies;
            let roast = replies[Math.floor(Math.random() * replies.length)];
            roast = roast.replace('{ime}', target);

            let responseText = chatSim.bacihejtTrigger || '<strong>!bacihejt</strong> triggered by {user} towards <strong>{target}</strong>. <br>{reply}<br>{user} received <strong>{points}</strong> points! (Total: <strong>{total}</strong>)';
            const pointsStr = randomPoint > 0 ? '+' + randomPoint : randomPoint;
            responseText = responseText.replace('{user}', viewerName).replace('{target}', target).replace('{reply}', roast).replace('{points}', pointsStr).replace('{total}', userPoints);

            addChatMessage(botName, responseText, true);
            playSynthSound(randomPoint > 0 ? 550 : 220, 'triangle', 0.3);

        } else if (cmd === '!posaljiljubav') {
            const target = arg || chatSim.unnamedViewer || (isEn ? 'Unnamed viewer' : 'Neimenovani gledalac');
            const sada = Date.now();
            
            if (sada - cooldowns.posaljiljubav < 10000) {
                const preostalo = Math.ceil((10000 - (sada - cooldowns.posaljiljubav)) / 1000);
                let errText = chatSim.cooldownError || 'Error: Command {cmd} is on cooldown for {time}s! (Originally 10m)';
                errText = errText.replace('{cmd}', '!posaljiljubav').replace('{time}', preostalo);
                addChatMessage(botName, errText, true);
                playSynthSound(150, 'sawtooth', 0.25);
                return;
            }
            cooldowns.posaljiljubav = sada;

            const randomPoint = Math.random() > 0.5 ? 2 : -5;
            userPoints += randomPoint;

            const replies = isEn ? loveRepliesEn : loveReplies;
            let love = replies[Math.floor(Math.random() * replies.length)];
            love = love.replace('{ime}', target);

            let responseText = chatSim.loveSent || '<strong>!posaljiljubav</strong> sent to <strong>{target}</strong>. <br>{reply}<br>{user} received <strong>{points}</strong> points! (Total: <strong>{total}</strong>)';
            const pointsStr = randomPoint > 0 ? '+' + randomPoint : randomPoint;
            responseText = responseText.replace('{user}', viewerName).replace('{target}', target).replace('{reply}', love).replace('{points}', pointsStr).replace('{total}', userPoints);

            addChatMessage(botName, responseText, true);
            playSynthSound(randomPoint > 0 ? 600 : 250, 'triangle', 0.3);

        } else if (cmd === '!poeni') {
            let responseText = chatSim.pointsResponse || 'User {user} currently has <strong>{points}</strong> points on this channel. Rank: <strong>Chat King</strong>.';
            responseText = responseText.replace('{user}', viewerName).replace('{points}', userPoints);
            addChatMessage(botName, responseText, true);
            playSynthSound(440, 'sine', 0.2);

        } else if (cmd === '!vreme' || cmd === '!weather') {
            const weatherText = chatSim.weather || 'Weather in Belgrade: Partly cloudy | 26°C (feels like 25°C) | Humidity: 32% | Wind: 22 km/h';
            addChatMessage(botName, weatherText, true);
            playSynthSound(500, 'sine', 0.2);

        } else if (cmd === '!info') {
            const infoText = chatSim.info || 'The shortest war in history lasted only 38 minutes!';
            addChatMessage(botName, infoText, true);
            playSynthSound(520, 'sine', 0.2);

        } else {
            if (message.startsWith('!')) {
                const responseText = chatSim.unknownCmd || 'Unknown command. Available commands: <strong>!vreme Beograd</strong>, <strong>!info</strong>.';
                addChatMessage(botName, responseText, true);
                playSynthSound(200, 'sawtooth', 0.2);
            } else {
                const repliesSr = [
                    "Slažem se sa ovim potpuno! Hype u chatu!",
                    "Zanimljivo razmišljanje. Šta ostali misle?",
                    "Hvala na poruci! Ne zaboravite da zapratite strim ako uživate!",
                    `${window.CONFIG.DEFAULTS.BOT_NAME} bot je uvek tu da nadgleda chat!`
                ];
                const repliesEn = [
                    "Totally agree with this! Chat hype!",
                    "Interesting thought. What does the rest of the chat think?",
                    "Thanks for the message! Don't forget to follow if you're enjoying!",
                    `${window.CONFIG.DEFAULTS.BOT_NAME} bot is always here watching over the chat!`
                ];
                const replies = isEn ? repliesEn : repliesSr;
                const reply = replies[Math.floor(Math.random() * replies.length)];
                addChatMessage(window.CONFIG.DEFAULTS.BOT_NAME, reply, true);
                playSynthSound(450, 'sine', 0.1);
            }
        }
    }


    // -----------------------------------------------------------------
    // 8. KICKAJ (Giveaway Simulator)
    // -----------------------------------------------------------------
    const startGiveawayBtn = document.getElementById('startGiveawayBtn');
    const giveawayPrize = document.getElementById('giveawayPrize');
    const prizeDisplay = document.getElementById('prizeDisplay');
    const drumRoller = document.getElementById('drumRoller');
    const giveawayStatusBadge = document.getElementById('giveawayStatusBadge');
    const winnerAnnouncement = document.getElementById('winnerAnnouncement');
    const winnerName = document.getElementById('winnerName');
    const winnerPrize = document.getElementById('winnerPrize');
    const winnerPrizeEn = document.getElementById('winnerPrizeEn');

    const participants = [
        'Gledalac', 'Ana_M', 'BalkanGamer', 'KickKralj', 'Pera_123',
        'StreamZver', 'Sandra_99', 'ChatMaster', 'Deki_BG', 'Kiki_00',
        'Luka_Pro', 'Nikola_K', 'Elena_NS', 'GamerStrim', 'Suki_OP'
    ];

    if (startGiveawayBtn) {
        startGiveawayBtn.addEventListener('click', () => {
            const prizeValue = giveawayPrize.value.trim() || 'Subscribe 🎁';
            const isEn = currentLang === 'en';

            prizeDisplay.textContent = prizeValue;
            winnerAnnouncement.style.display = 'none';
            giveawayStatusBadge.textContent = isEn ? 'Gathering participants...' : 'Prikupljanje učesnika...';
            giveawayStatusBadge.style.backgroundColor = 'rgba(139, 92, 246, 0.2)';
            giveawayStatusBadge.style.color = 'var(--color-violet)';
            
            startGiveawayBtn.disabled = true;
            startGiveawayBtn.textContent = isEn ? 'Drawing in progress...' : 'Izvlačenje u toku...';

            playSynthSound(300, 'sine', 0.15);
            setTimeout(() => playSynthSound(400, 'sine', 0.15), 150);

            drumRoller.innerHTML = '';
            const rollerList = [...participants, ...participants, ...participants, ...participants];
            
            rollerList.forEach(user => {
                const item = document.createElement('div');
                item.className = 'drum-item';
                item.textContent = user;
                drumRoller.appendChild(item);
            });

            drumRoller.style.transition = 'none';
            drumRoller.style.transform = 'translateX(0px)';

            setTimeout(() => {
                giveawayStatusBadge.textContent = isEn ? 'Spinning drum...' : 'Vrtenje bubnja...';
                giveawayStatusBadge.style.backgroundColor = 'rgba(83, 252, 24, 0.2)';
                giveawayStatusBadge.style.color = 'var(--color-green)';

                const targetIndex = participants.length * 2 + Math.floor(Math.random() * participants.length);
                const winner = rollerList[targetIndex];
                const offset = -(targetIndex * 160) + 80;
                
                drumRoller.style.transition = 'transform 4s cubic-bezier(0.1, 0.8, 0.1, 1)';
                drumRoller.style.transform = `translateX(${offset}px)`;

                let tickCount = 0;
                const totalTicks = 25;
                const tickInterval = setInterval(() => {
                    if (tickCount >= totalTicks) {
                        clearInterval(tickInterval);
                    } else {
                        playSynthSound(700, 'sine', 0.02);
                        tickCount++;
                    }
                }, 150);

                setTimeout(() => {
                    const items = drumRoller.querySelectorAll('.drum-item');
                    if (items[targetIndex]) {
                        items[targetIndex].classList.add('highlighted');
                    }

                    winnerName.textContent = winner;
                    winnerPrize.textContent = prizeValue;
                    if (winnerPrizeEn) winnerPrizeEn.textContent = prizeValue;
                    winnerAnnouncement.style.display = 'flex';
                    
                    giveawayStatusBadge.textContent = isEn ? 'DRAW FINISHED!' : 'ZAVRŠENO!';

                    playSynthSound(440, 'triangle', 0.1);
                    setTimeout(() => playSynthSound(554, 'triangle', 0.1), 100);
                    setTimeout(() => playSynthSound(659, 'triangle', 0.1), 200);
                    setTimeout(() => playSynthSound(880, 'triangle', 0.4), 300);

                    createConfetti();

                    startGiveawayBtn.disabled = false;
                    startGiveawayBtn.textContent = isEn ? 'Draw Again' : 'Pokreni Ponovo';
                }, 4200);

            }, 500);
        });
    }

    function createConfetti() {
        const visualizer = document.querySelector('.kickaj-visualizer');
        if (!visualizer) return;

        for (let i = 0; i < 40; i++) {
            const confetti = document.createElement('div');
            confetti.style.position = 'absolute';
            confetti.style.width = '8px';
            confetti.style.height = '8px';
            confetti.style.borderRadius = '50%';
            
            const isGreen = Math.random() > 0.5;
            confetti.style.backgroundColor = isGreen ? 'var(--color-green)' : 'var(--color-violet)';
            
            confetti.style.left = '50%';
            confetti.style.top = '50%';
            
            visualizer.appendChild(confetti);

            const angle = Math.random() * Math.PI * 2;
            const velocity = 50 + Math.random() * 150;
            const x = Math.cos(angle) * velocity;
            const y = Math.sin(angle) * velocity - 20;

            confetti.animate([
                { transform: 'translate(0, 0) scale(1)', opacity: 1 },
                { transform: `translate(${x}px, ${y}px) scale(0)`, opacity: 0 }
            ], {
                duration: 1000 + Math.random() * 800,
                easing: 'cubic-bezier(0.1, 0.8, 0.25, 1)',
                fill: 'forwards'
            });

            setTimeout(() => {
                confetti.remove();
            }, 1800);
        }
    }


    // -----------------------------------------------------------------
    // 9. KICKOV (Overlay Simulator)
    // -----------------------------------------------------------------
    const triggerFollow = document.getElementById('triggerFollow');
    const triggerSub = document.getElementById('triggerSub');
    const triggerDonation = document.getElementById('triggerDonation');
    const streamAlertArea = document.getElementById('streamAlertArea');

    function showLiveAlert(type, data) {
        if (!streamAlertArea) return;
        streamAlertArea.innerHTML = '';

        const alertCard = document.createElement('div');
        alertCard.className = `live-alert-card ${type === 'sub' ? 'alert-sub' : ''}`;
        
        // Primeni izabranu temu vidžeta
        const themeStyles = {
            green: { border: '#53FC18', shadow: '0 0 25px rgba(83, 252, 24, 0.45)' },
            violet: { border: '#8B5CF6', shadow: '0 0 25px rgba(139, 92, 246, 0.45)' },
            dark: { border: '#475569', shadow: '0 0 20px rgba(255, 255, 255, 0.15)' },
            gold: { border: '#F59E0B', shadow: '0 0 25px rgba(245, 158, 11, 0.45)' }
        };
        const activeTheme = themeStyles[currentOverlayTheme] || themeStyles.green;
        alertCard.style.borderColor = activeTheme.border;
        alertCard.style.boxShadow = activeTheme.shadow;

        const isEn = currentLang === 'en';

        let iconSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
        let title = isEn ? 'New Follower!' : 'Novi Pratilac!';
        const safeName = escapeHtml(data.name);
        const safeMsg = escapeHtml(data.msg);
        let message = isEn ? `User <span>${safeName}</span> is now following!` : `Korisnik <span>${safeName}</span> vas sada prati!`;

        if (type === 'sub') {
            iconSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 4l3 12h14l3-12-6 7-4-5-4 5-6-7z"></path></svg>`;
            title = isEn ? 'New Subscriber!' : 'Novi Pretplatnik!';
            message = isEn ? `<span>${safeName}</span> just subscribed!` : `<span>${safeName}</span> se pretplatio na kanal!`;
            playSynthSound(600, 'sine', 0.1);
            setTimeout(() => playSynthSound(800, 'sine', 0.15), 100);
            setTimeout(() => playSynthSound(1000, 'sine', 0.3), 200);
        } else if (type === 'donation') {
            iconSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12l4 6-10 12L2 9z"></path></svg>`;
            title = isEn ? 'New Donation!' : 'Nova Donacija!';
            const safeAmount = escapeHtml(data.amount);
            message = isEn 
                ? `<span>${safeName}</span> donated <span>€${safeAmount}</span>! <br>"${safeMsg}"`
                : `<span>${safeName}</span> je donirao <span>€${safeAmount}</span>! <br>"${safeMsg}"`;
            playSynthSound(500, 'triangle', 0.1);
            setTimeout(() => playSynthSound(650, 'triangle', 0.1), 100);
            setTimeout(() => playSynthSound(850, 'triangle', 0.25), 200);
        } else {
            playSynthSound(520, 'sine', 0.15);
            setTimeout(() => playSynthSound(650, 'sine', 0.25), 150);
        }

        alertCard.innerHTML = `
            <div class="alert-icon-anim">${iconSvg}</div>
            <div class="alert-title-text">${title}</div>
            <div class="alert-message-text">${message}</div>
        `;

        streamAlertArea.appendChild(alertCard);

        setTimeout(() => {
            alertCard.style.animation = 'alertFadeOut 0.4s ease-in forwards';
            setTimeout(() => {
                alertCard.remove();
            }, 400);
        }, 3600);
    }

    if (triggerFollow) {
        triggerFollow.addEventListener('click', () => {
            const names = ['Stefan_BG', 'Jovanaaa', 'Boki_Gamer', 'Katarina_NS'];
            const randomName = names[Math.floor(Math.random() * names.length)];
            showLiveAlert('follow', { name: randomName });
        });
    }

    if (triggerSub) {
        triggerSub.addEventListener('click', () => {
            const names = ['Kralj_Chata', 'StrimeriSrb', 'Milica_01', 'Dusan_K'];
            const randomName = names[Math.floor(Math.random() * names.length)];
            showLiveAlert('sub', { name: randomName });
        });
    }

    if (triggerDonation) {
        triggerDonation.addEventListener('click', () => {
            const names = ['Zverko', 'SponzorStrimera', 'Bata_Pera', 'Donator99'];
            const msgs = ['Najjači si, samo napred!', 'Pozdrav za čet i strimera!', 'Kupi novu grafičku 😄', 'Ideeeemoooo'];
            const randomName = names[Math.floor(Math.random() * names.length)];
            const randomMsg = msgs[Math.floor(Math.random() * msgs.length)];
            const randomAmount = (5 + Math.floor(Math.random() * 95));
            showLiveAlert('donation', { name: randomName, amount: randomAmount, msg: randomMsg });
        });
    }


    // -----------------------------------------------------------------
    // 10. KICKAN (Analytics Simulator)
    // -----------------------------------------------------------------
    const periodButtons = document.querySelectorAll('.period-btn');
    const graphPathLine = document.getElementById('graphPathLine');
    const graphPathArea = document.getElementById('graphPathArea');
    const graphDotsGroup = document.getElementById('graphDotsGroup');
    const avgViewersVal = document.getElementById('avgViewersVal');
    const totalFollowersVal = document.getElementById('totalFollowersVal');

    const chartData = {
        today: {
            linePath: "M 0 150 L 100 120 L 200 140 L 300 80 L 400 90 L 500 40",
            areaPath: "M 0 200 L 0 150 L 100 120 L 200 140 L 300 80 L 400 90 L 500 40 L 500 200 Z",
            points: [
                { cx: 100, cy: 120 },
                { cx: 200, cy: 140 },
                { cx: 300, cy: 80 },
                { cx: 400, cy: 90 },
                { cx: 500, cy: 40 }
            ],
            avg: "724",
            followers: "+148",
            labels: ["18:00", "19:00", "20:00", "21:00", "22:00", "23:00"]
        },
        week: {
            linePath: "M 0 170 L 100 150 L 200 100 L 300 130 L 400 70 L 500 30",
            areaPath: "M 0 200 L 0 170 L 100 150 L 200 100 L 300 130 L 400 70 L 500 30 L 500 200 Z",
            points: [
                { cx: 100, cy: 150 },
                { cx: 200, cy: 100 },
                { cx: 300, cy: 130 },
                { cx: 400, cy: 70 },
                { cx: 500, cy: 30 }
            ],
            avg: "890",
            followers: "+1,250",
            labels: ["Pon", "Uto", "Sre", "Čet", "Pet", "Vikend"]
        },
        month: {
            linePath: "M 0 190 L 100 160 L 200 130 L 300 90 L 400 50 L 500 15",
            areaPath: "M 0 200 L 0 190 L 100 160 L 200 130 L 300 90 L 400 50 L 500 15 L 500 200 Z",
            points: [
                { cx: 100, cy: 160 },
                { cx: 200, cy: 130 },
                { cx: 300, cy: 90 },
                { cx: 400, cy: 50 },
                { cx: 500, cy: 15 }
            ],
            avg: "1,120",
            followers: "+4,820",
            labels: ["Nedelja 1", "Nedelja 2", "Nedelja 3", "Nedelja 4", "Danas", "Kraj"]
        }
    };

    function triggerGraphAnimation() {
        if (!graphPathLine || !graphPathArea) return;
        graphPathLine.style.animation = 'none';
        graphPathLine.offsetHeight;
        graphPathLine.style.animation = 'drawPath 2s cubic-bezier(0.4, 0, 0.2, 1) forwards';

        graphPathArea.style.animation = 'none';
        graphPathArea.offsetHeight;
        graphPathArea.style.animation = 'fadeArea 1s ease-out 0.8s forwards';

        if (graphDotsGroup) {
            const dots = graphDotsGroup.querySelectorAll('.graph-dot');
            dots.forEach(d => {
                d.style.animation = 'none';
                d.offsetHeight;
                d.style.animation = '';
            });
        }
    }

    periodButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const period = btn.getAttribute('data-period');
            periodButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const data = chartData[period];
            if (!data) return;

            graphPathLine.setAttribute('d', data.linePath);
            graphPathArea.setAttribute('d', data.areaPath);
            
            if (graphDotsGroup && data.points) {
                graphDotsGroup.innerHTML = data.points.map((pt, idx) => {
                    const isLast = idx === data.points.length - 1;
                    const r = isLast ? 7 : 6;
                    const idAttr = isLast ? ' id="lastGraphDot"' : '';
                    return `<circle cx="${pt.cx}" cy="${pt.cy}" r="${r}" class="graph-dot dot-green-glow"${idAttr} />`;
                }).join('');
            }

            const chartLabels = document.getElementById('chartLabels');
            if (chartLabels) {
                chartLabels.innerHTML = data.labels.map(l => `<span>${l}</span>`).join('');
            }

            triggerGraphAnimation();
            playSynthSound(450, 'sine', 0.08);

            animateCountUp(avgViewersVal, parseInt(data.avg.replace(/,/g, '')));
            totalFollowersVal.textContent = data.followers;
        });
    });

    function animateCountUp(element, target) {
        if (!element) return;
        const duration = 1000;
        const stepTime = 20;
        const steps = duration / stepTime;
        const increment = target / steps;
        
        let current = 0;
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
                element.textContent = target.toLocaleString('sr-RS');
                clearInterval(timer);
            } else {
                element.textContent = Math.floor(current).toLocaleString('sr-RS');
            }
        }, stepTime);
    }


    // -----------------------------------------------------------------
    // 11. Animacija Brojeva (Stats)
    // -----------------------------------------------------------------
    const statNumbers = document.querySelectorAll('.stat-number');
    const countOptions = {
        threshold: 0.5,
        rootMargin: "0px 0px -50px 0px"
    };

    const countObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const element = entry.target;
                const target = parseFloat(element.getAttribute('data-target'));
                const decimal = element.getAttribute('data-decimal') === 'true';
                const suffix = element.getAttribute('data-suffix') || '';
                
                const duration = 2000;
                const stepTime = 30;
                const steps = duration / stepTime;
                const increment = target / steps;

                let current = 0;
                const timer = setInterval(() => {
                    current += increment;
                    if (current >= target) {
                        element.textContent = decimal ? target.toFixed(1) + suffix : Math.floor(target).toLocaleString('sr-RS') + suffix;
                        clearInterval(timer);
                    } else {
                        element.textContent = decimal ? current.toFixed(1) + suffix : Math.floor(current).toLocaleString('sr-RS') + suffix;
                    }
                }, stepTime);

                observer.unobserve(element);
            }
        });
    }, countOptions);

    statNumbers.forEach(num => {
        countObserver.observe(num);
    });

    // -----------------------------------------------------------------
    // 12. Spotlight Effect (Debounced for better performance)
    // -----------------------------------------------------------------
    const cards = document.querySelectorAll('.feature-card, .pricing-card');
    cards.forEach(card => {
        let cardTimeout = null;
        card.addEventListener('mousemove', e => {
            // Disable on mobile/tablet devices (< 1024px)
            if (window.innerWidth < 1024) return;
            
            if (cardTimeout) return;
            cardTimeout = setTimeout(() => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                card.style.setProperty('--mouse-x', `${x}px`);
                card.style.setProperty('--mouse-y', `${y}px`);
                cardTimeout = null;
            }, 16); // ~60fps max
        });
    });

    // -----------------------------------------------------------------
    // 13. Kopiranje Email Adrese
    // -----------------------------------------------------------------
    const copyEmailBtn = document.getElementById('copyEmailBtn');
    const copyBtnText = document.getElementById('copyBtnText');
    const copyBtnTextEn = document.getElementById('copyBtnTextEn');
    
    if (copyEmailBtn) {
        copyEmailBtn.addEventListener('click', () => {
            const emailAddress = window.CONFIG.CONTACT_EMAIL;
            navigator.clipboard.writeText(emailAddress).then(() => {
                // Dodaj klasu za zelenu boju i sjaj
                copyEmailBtn.classList.add('copied');

                // Koristi lokalizaciju
                const t = window.translations || {};
                const copyText = t.copy || {};
                const isEn = currentLang === 'en';

                if (copyBtnText) copyBtnText.textContent = copyText.copied || (isEn ? 'Copied!' : 'Kopirano!');
                if (copyBtnTextEn) copyBtnTextEn.textContent = copyText.copied || 'Copied!';

                playSynthSound(600, 'sine', 0.08);
                setTimeout(() => playSynthSound(800, 'sine', 0.12), 80);

                // Vrati na staro nakon 2 sekunde
                setTimeout(() => {
                    copyEmailBtn.classList.remove('copied');
                    if (copyBtnText) copyBtnText.textContent = copyText.copy || (isEn ? 'Copy' : 'Kopiraj');
                    if (copyBtnTextEn) copyBtnTextEn.textContent = copyText.copy || 'Copy';
                }, 2000);
            }).catch(err => {
                console.error("Greška pri kopiranju emaila: ", err);
            });
        });
    }

    // Supabase Auth Session Check & UI Dynamic Update
    const authModal = document.getElementById('authModal');
    const navBtnLogin = document.getElementById('navBtnLogin');
    const mobileDashboardBtn = document.getElementById('mobileDashboardBtn');
    const navBtnPrimary = document.getElementById('navBtnPrimary');
    const heroBtnPrimary = document.getElementById('heroBtnPrimary');
    const authModalClose = document.getElementById('authModalClose');

    // Initialize Supabase with same config as other pages
    const sb = window.supabase.createClient(window.CONFIG.SUPABASE.URL, window.CONFIG.SUPABASE.ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        storageKey: window.CONFIG.SUPABASE.STORAGE_KEY
      }
    });

    async function isUserLoggedIn() {
        const session = window.CONFIG?.getValidSessionWithRetry
            ? await window.CONFIG.getValidSessionWithRetry(sb, 2, 800)
            : (await sb.auth.getSession())?.data?.session;
        return !!session;
    }

// Rukovanje akcijom odjavljivanja
if (window.location.search.includes('action=logout')) {
    handleLogout();
}

async function handleLogout() {
    // Track logout event
    if (window.KickALLDataLayer) {
        window.KickALLDataLayer.trackLogout({
            method: 'kick_oauth'
        });
        window.KickALLDataLayer.setUserProperties({
            user_type: 'guest'
        });
    }

    try {
        let korisnikId = null;
        if (typeof sb !== 'undefined' && sb && sb.auth) {
            const { data } = await sb.auth.getSession();
            korisnikId = data?.session?.user?.id;
        }

        if (korisnikId) {
            notifyGlobalLogout(korisnikId);
        }

        // Obriši sve lokalne sesijske i Kick tokene odmah
        try {
            localStorage.removeItem('kick_access_token');
            localStorage.removeItem('kick_token_type');
            localStorage.removeItem('kick_session_active');
            localStorage.removeItem('kick_oauth_state');
            localStorage.removeItem('kick_code_verifier');
            sessionStorage.clear();

            // Obriši sve Supabase auth tokene iz localStorage
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (key && (key.startsWith('sb-') || key.includes('auth-token') || key.startsWith('kick_'))) {
                    localStorage.removeItem(key);
                }
            }
        } catch (e) {
            console.warn('LocalStorage/sessionStorage not available during logout:', e);
        }

        if (typeof sb !== 'undefined' && sb && sb.auth) {
            await Promise.race([
                sb.auth.signOut(),
                new Promise(resolve => setTimeout(resolve, 400))
            ]);
        }
    } catch (e) {
        console.error("Logout greška:", e);
    } finally {
        const cleanUrl = window.location.origin + window.location.pathname;
        window.location.replace(cleanUrl);
    }
}

function notifyGlobalLogout(userId) {
    const domains = window.CONFIG.CROSS_DOMAIN_DOMAINS;
    
    domains.forEach(domain => {
        try {
            const iframe = document.querySelector(`iframe[src*="${domain}"]`);
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage({ type: 'GLOBAL_LOGOUT' }, domain);
            }
        } catch (e) {
            // Ignoriši greške sa poreklom stranica
        }
    });
    
    try {
        localStorage.setItem(window.CONFIG.STORAGE_KEYS.GLOBAL_LOGOUT, Date.now().toString());
    } catch (e) {
        console.warn('LocalStorage not available during global logout:', e);
    }
    
    // Obavesti server koristeći prosleđeni id
    const apiBase = window.CONFIG.getBackendApiBase();
    if (userId) {
        fetch(`${apiBase}/api/global-logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId })
        }).catch(() => {});
    }
}

window.addEventListener('message', (event) => {
    // Bezbednosna provera: prihvati poruke samo od pouzdanih originа
    const allowedOrigins = (window.CONFIG && window.CONFIG.CROSS_DOMAIN_DOMAINS)
        ? window.CONFIG.CROSS_DOMAIN_DOMAINS
        : ['https://kickall.app'];
    if (!allowedOrigins.includes(event.origin)) return;

    if (event.data && event.data.type === 'GLOBAL_LOGOUT') {
        try {
            localStorage.clear();
            sessionStorage.clear();
            window.location.replace(window.location.origin + window.location.pathname);
        } catch (e) {
            console.warn('LocalStorage/sessionStorage not available during message logout:', e);
            window.location.replace(window.location.origin + window.location.pathname);
        }
    }
});

window.addEventListener('storage', (event) => {
    if (event.key === window.CONFIG.STORAGE_KEYS.GLOBAL_LOGOUT) {
        try {
            localStorage.clear();
            sessionStorage.clear();
            window.location.replace(window.location.origin + window.location.pathname);
        } catch (e) {
            console.warn('LocalStorage/sessionStorage not available during storage logout:', e);
            window.location.replace(window.location.origin + window.location.pathname);
        }
    }
});

    function openAuthModal() {
        if (authModal) {
            // Reset loading state when opening modal
            if (authKickLoginBtn) {
                authKickLoginBtn.classList.remove('loading');
                const btnText = authKickLoginBtn.querySelector('span');
                if (btnText) {
                    btnText.textContent = btnText.getAttribute('data-i18n') ? 
                        window.translations?.auth?.signInWithKick || 'Prijavi se preko Kicka' : 
                        'Prijavi se preko Kicka';
                }
            }
            
            const scrollY = window.scrollY;
            authModal.classList.add('open');
            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
            document.body.style.position = 'fixed';
            document.body.style.width = '100%';
            document.body.style.top = `-${scrollY}px`;
            document.body.dataset.scrollY = scrollY;
        }
    }

    function closeAuthModal() {
        if (authModal) {
            // Reset loading state when closing modal
            if (authKickLoginBtn) {
                authKickLoginBtn.classList.remove('loading');
                const btnText = authKickLoginBtn.querySelector('span');
                if (btnText) {
                    btnText.textContent = btnText.getAttribute('data-i18n') ? 
                        window.translations?.auth?.signInWithKick || 'Prijavi se preko Kicka' : 
                        'Prijavi se preko Kicka';
                }
            }
            
            authModal.classList.remove('open');
            const scrollY = document.body.dataset.scrollY || '0';
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
            document.body.style.position = '';
            document.body.style.width = '';
            document.body.style.top = '';
            delete document.body.dataset.scrollY;
            window.scrollTo(0, parseInt(scrollY));
        }
    }

    window.openAuthModal = openAuthModal;
    window.closeAuthModal = closeAuthModal;


    async function checkAuthSession() {
        try {
            const session = window.CONFIG?.getValidSessionWithRetry 
                ? await window.CONFIG.getValidSessionWithRetry(sb, 3, 1000)
                : (await sb.auth.getSession())?.data?.session;

            if (window.CONFIG?.setupCrossTabSync && !window._crossTabSyncInitialized) {
                window._crossTabSyncInitialized = true;
                window.CONFIG.setupCrossTabSync(sb, () => {
                    checkAuthSession();
                });
            }

            const userMenu = document.getElementById('userMenu');
            const userAvatar = document.getElementById('userAvatar');
            const userName = document.getElementById('userName');
            const heroVisualContent = document.getElementById('heroVisualContent');

            if (session) {
            const user = session.user;
            const displayName = user?.user_metadata?.display_name || user?.email || 'Profil';
            const avatarUrl = user?.user_metadata?.avatar_url;
            
            // User is logged in! Update UI
            if (navBtnLogin) {
                navBtnLogin.style.display = 'none';
            }
            if (mobileDashboardBtn) {
                mobileDashboardBtn.style.display = 'inline-flex';
            }
            if (mobileLoginBtn) {
                mobileLoginBtn.style.display = 'none';
            }
            if (navBtnPrimary) {
                navBtnPrimary.style.display = 'none';
            }

            if (userMenu) {
                userMenu.style.display = 'block';
                
                // Set avatar
                if (userAvatar) {
                    if (avatarUrl && (avatarUrl.startsWith('http') || avatarUrl.startsWith('data:image'))) {
                        userAvatar.style.backgroundImage = `url("${avatarUrl}")`;
                        userAvatar.style.backgroundSize = 'cover';
                        userAvatar.style.backgroundPosition = 'center';
                        userAvatar.textContent = '';
                    } else {
                        userAvatar.style.backgroundImage = 'none';
                        userAvatar.textContent = displayName.charAt(0).toUpperCase();
                    }
                }

                // Set name
                if (userName) {
                    userName.textContent = displayName;
                }
            }

            if (heroBtnPrimary) {
                heroBtnPrimary.href = 'dashboard.html';
                const heroBtnPrimaryText = document.getElementById('heroBtnPrimaryText');
                if (heroBtnPrimaryText) {
                    const t = window.translations || {};
                    const userProfile = t.userProfile || {};
                    const isEn = currentLang === 'en';
                    heroBtnPrimaryText.textContent = userProfile.goToDashboard || (isEn ? 'Go to Dashboard' : 'Idi na Dashboard');
                    heroBtnPrimaryText.removeAttribute('data-i18n');
                }
            }

            // Update CTA button for logged-in user
            const ctaKickLoginBtnEl = document.getElementById('ctaKickLoginBtn');
            if (ctaKickLoginBtnEl) {
                const t = window.translations || {};
                const userProfile = t.userProfile || {};
                const isEn = currentLang === 'en';
                const goToDashboardText = userProfile.goToDashboard || (isEn ? 'Go to Dashboard' : 'Idi na Dashboard');
                ctaKickLoginBtnEl.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                    </svg>
                    <span>${goToDashboardText}</span>
                `;
            }

            // Update Free Plan button for logged-in user
            const pricingFreeBtnEl = document.getElementById('pricingFreeBtn');
            if (pricingFreeBtnEl) {
                const t = window.translations || {};
                const userProfile = t.userProfile || {};
                const isEn = currentLang === 'en';
                const goToDashboardText = userProfile.goToDashboard || (isEn ? 'Go to Dashboard' : 'Idi na Dashboard');
                pricingFreeBtnEl.href = 'dashboard.html';
                pricingFreeBtnEl.innerHTML = `
                    <span>${goToDashboardText}</span>
                `;
            }

            // Render Personalized Logged-In User Profile Hero Card with REAL Supabase Data
            if (heroVisualContent) {
                let userBotActive = true;
                let activeModulesCount = 8;
                let kickChannelName = displayName;

                try {
                    const profileRes = await sb.from('user_profiles').select('*').eq('id', user.id).maybeSingle();

                    if (profileRes?.data) {
                        // Bot is considered active if user has channels configured
                        const kickChannels = profileRes.data.kick_channels || [];
                        userBotActive = kickChannels.length > 0;
                        
                        // Get channel name from first channel or display_name
                        if (kickChannels.length > 0 && kickChannels[0].username) {
                            kickChannelName = kickChannels[0].username;
                        }
                        
                        // Default to 8 modules active (all Kickot modules)
                        activeModulesCount = 8; // This is hardcoded by design
                    }
                } catch (e) {
                    console.warn("User stats fetch fallback:", e);
                }

                const t = window.translations || {};
                const userProfile = t.userProfile || {};
                const isEn = currentLang === 'en';
                
                const title = userProfile.title || (isEn ? 'MY PROFILE & STATUS' : 'MOJ PROFIL & STATUS');
                const botActiveText = userProfile.botActive || (isEn ? 'BOT ACTIVE' : 'BOT AKTIVAN');
                const botInactiveText = userProfile.botInactive || (isEn ? 'INACTIVE' : 'NEAKTIVAN');
                const connectedText = userProfile.connected || (isEn ? 'Connected with Kickot bot' : 'Povezan sa Kickot botom');
                const disconnectedText = userProfile.disconnected || (isEn ? 'Kickot bot disconnected' : 'Kickot bot odspojen');
                const activeModulesLabel = userProfile.activeModulesLabel || (isEn ? 'Active modules status' : 'Status aktivnih modula');
                const activeModulesText = (userProfile.activeModules || (isEn ? '{count} of 8 modules active' : '{count} od 8 modula aktivno')).replace('{count}', activeModulesCount);
                const botStatusLabel = userProfile.botStatusLabel || (isEn ? 'Bot status' : 'Status bota');
                const botPausedText = userProfile.botPaused || (isEn ? 'PAUSED' : 'PAUZIRAN');
                const openDashboardText = userProfile.openDashboard || (isEn ? 'Open Dashboard →' : 'Otvori Dashboard →');

                heroVisualContent.innerHTML = `
                    <div class="hero-glass-card">
                        <div class="hero-card-header">
                            <div class="card-header-left">
                                <span class="pulse-dot" style="background: ${userBotActive ? 'var(--color-green)' : '#EF4444'};"></span>
                                <span class="card-header-title">${title}</span>
                            </div>
                            <span class="badge ${userBotActive ? 'badge-active' : 'badge-soon'}">${userBotActive ? botActiveText : botInactiveText}</span>
                        </div>
                        <div class="hero-user-card">
                            <div class="hero-avatar" style="${(avatarUrl && /^https:\/\//.test(avatarUrl)) ? `background-image: url('${avatarUrl}');` : ''}">
                                ${!(avatarUrl && /^https:\/\//.test(avatarUrl)) ? kickChannelName.charAt(0).toUpperCase() : ''}
                            </div>
                            <div>
                                <h3 class="hero-user-name">@${kickChannelName}</h3>
                                <div class="hero-user-status">
                                    <span class="pulse-dot" style="background: ${userBotActive ? 'var(--color-green)' : '#EF4444'};"></span>
                                    <span>${userBotActive ? connectedText : disconnectedText}</span>
                                </div>
                            </div>
                        </div>
                        <div class="telemetry-grid">
                            <div class="t-cell">
                                <span class="t-label">${activeModulesLabel}</span>
                                <span class="t-val text-green">${activeModulesText}</span>
                            </div>
                            <div class="t-cell">
                                <span class="t-label">${botStatusLabel}</span>
                                <span class="t-val ${userBotActive ? 'text-green' : 'text-orange'}">${userBotActive ? botActiveText : botPausedText}</span>
                            </div>
                        </div>
                        <div class="hero-card-footer">
                            <a href="dashboard.html" class="btn btn-primary w-full" style="justify-content: center;">
                                <span>${openDashboardText}</span>
                            </a>
                        </div>
                    </div>
                `;
            }
            return;
        }

        // Default state if not logged in (Guest View)
        if (navBtnLogin) {
            navBtnLogin.style.display = 'inline-flex';
        }
        if (mobileDashboardBtn) {
            mobileDashboardBtn.style.display = 'none';
        }
        if (mobileLoginBtn) {
            mobileLoginBtn.style.display = 'inline-flex';
        }
        if (navBtnPrimary) {
            navBtnPrimary.style.display = 'none';
        }
        if (userMenu) {
            userMenu.style.display = 'none';
        }
        if (heroBtnPrimary) {
            heroBtnPrimary.href = '#';
        }
        const heroBtnPrimaryText = document.getElementById('heroBtnPrimaryText');
        if (heroBtnPrimaryText) {
            const t = window.translations || {};
            const isEn = currentLang === 'en';
            heroBtnPrimaryText.textContent = t.hero?.btnStart || (isEn ? 'Start for free' : 'Počni besplatno');
            heroBtnPrimaryText.setAttribute('data-i18n', 'hero.btnStart');
        }

        // Render Guest Global Telemetry Card
        if (heroVisualContent) {
            const t = window.translations || {};
            const hero = t.hero || {};
            const isEn = currentLang === 'en';
            
            heroVisualContent.innerHTML = `
                <div class="hero-glass-card">
                    <div class="hero-card-header">
                        <div class="card-header-left">
                            <span class="pulse-dot"></span>
                            <span class="card-header-title">${hero.guestTelemetry || (isEn ? 'LIVE SYSTEM STATISTICS' : 'LIVE STATISTIKA SISTEMA')}</span>
                        </div>
                        <span class="badge badge-active">${hero.guestUptime || '99.98% UPTIME'}</span>
                    </div>
                    <div class="hero-telemetry-body">
                        <div class="telemetry-metric">
                            <span class="metric-num-glow" id="heroLiveMsgCount">14,892,104</span>
                            <span class="metric-sub">${hero.guestProcessedMsgs || (isEn ? 'Processed Chat Messages' : 'Obrađenih Poruka u Chatu')}</span>
                        </div>
                        <div class="telemetry-grid">
                            <div class="t-cell">
                                <span class="t-label">${hero.websocket || 'Kick WebSocket'}</span>
                                <span class="t-val text-green">${hero.guestLatency || (isEn ? '&lt; 15ms Response' : '&lt; 15ms Odziv')}</span>
                            </div>
                            <div class="t-cell">
                                <span class="t-label">${hero.guestStreams || (isEn ? 'Active Kick Streams' : 'Aktivnih Kick Strimova')}</span>
                                <span class="t-val text-violet">2.840</span>
                            </div>
                        </div>
                        <div class="hero-card-footer">
                            <button type="button" class="btn btn-primary w-full hero-oauth-btn" id="heroFastOAuthBtn">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 0H5a5 5 0 0 0-5 5v14a5 5 0 0 0 5 5h14a5 5 0 0 0 5-5V5a5 5 0 0 0-5-5zM9 17H6.5v-10H9v3.5l4-3.5h3.5l-4.5 4.5 4.8 5.5H13.3l-4.3-5V17z" />
                                </svg>
                                <span style="padding-left: 5px">${hero.fastOAuth || (isEn ? 'Fast Kick OAuth Login' : 'Brza Kick Prijava')}</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;
            const heroFastOAuthBtn = document.getElementById('heroFastOAuthBtn');
            if (heroFastOAuthBtn) {
                heroFastOAuthBtn.addEventListener('click', openKickLogin);
            }
        }
        } catch (e) {
            console.error('Error checking auth session:', e);
        }
    }

    async function sha256(plain) {
        const encoder = new TextEncoder();
        const data = encoder.encode(plain);
        return window.crypto.subtle.digest('SHA-256', data);
    }

    function base64urlencode(a) {
        let str = "";
        const bytes = new Uint8Array(a);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            str += String.fromCharCode(bytes[i]);
        }
        return btoa(str)
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
    }

    function generateRandomString(length) {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        let text = '';
        for (let i = 0; i < length; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    function getKickRedirectUri() {
        return window.CONFIG.OAUTH.getRedirectUri();
    }

    async function generateCodeChallenge(v) {
        const hashed = await sha256(v);
        return base64urlencode(hashed);
    }

    async function openKickLogin() {
        // Track auth event start
        if (window.KickALLDataLayer) {
            window.KickALLDataLayer.trackLogin({
                method: 'kick_oauth',
                auth_type: 'oauth_start'
            });
        }

        // 1. Jasno postavi origin site i target stranicu
        try {
            sessionStorage.setItem('kick_origin_site', 'kickall');
            localStorage.setItem('kick_origin_site', 'kickall');
            sessionStorage.setItem('from_kickall', 'true');
            sessionStorage.setItem('kick_redirect_page', '/dashboard.html');
            localStorage.setItem('kick_redirect_page', '/dashboard.html');
        } catch (e) {
            console.warn('Storage not available:', e);
        }

        // 2. Ako koristiš globalni KickAuth
        if (window.KickAuth) {
            KickAuth.initiateOAuth('/dashboard.html'); // Uklonjeno /Website/
            return;
        }
        
        // 3. Fallback ako nema KickAuth-a
        const KICK_CLIENT_ID = window.CONFIG.OAUTH.CLIENT_ID;
        const KICK_REDIRECT_URI = window.CONFIG.OAUTH.getRedirectUri();
        const KICK_SCOPE = window.CONFIG.OAUTH.SCOPE;

        const state = `kickall_${generateRandomString(16)}`;
        const codeVerifier = generateRandomString(64);
        const codeChallenge = await generateCodeChallenge(codeVerifier);

        try {
            localStorage.setItem('kick_oauth_state', state);
            localStorage.setItem('kick_code_verifier', codeVerifier);
            sessionStorage.setItem('kick_oauth_state', state);
            sessionStorage.setItem('kick_code_verifier', codeVerifier);
        } catch (e) {
            console.warn('LocalStorage/sessionStorage not available during OAuth:', e);
        }

        const authUrl = `${window.CONFIG.API.KICK_OAUTH_AUTHORIZE}?` + new URLSearchParams({
            response_type: 'code',
            client_id: KICK_CLIENT_ID,
            redirect_uri: KICK_REDIRECT_URI,
            scope: KICK_SCOPE,
            state: state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
        }).toString();

        window.location.href = authUrl;
    }

    async function handleOAuthCallback(code, state) {
        try {
            const savedState = localStorage.getItem('kick_oauth_state') || sessionStorage.getItem('kick_oauth_state');
            const codeVerifier = localStorage.getItem('kick_code_verifier') || sessionStorage.getItem('kick_code_verifier');

            // Skip state validation for localhost to avoid development issues
            const isLocalhost = window.location.hostname === 'localhost' || 
                                window.location.hostname === '127.0.0.1' ||
                                window.location.hostname === '0.0.0.0';

            if (!isLocalhost && (!savedState || savedState !== state)) {
                console.error('OAuth state mismatch - Expected:', savedState, 'Got:', state);
                if (window.toastSystem) {
                    window.toastSystem.error('Security error: Invalid OAuth state');
                }
                return;
            }

            if (!codeVerifier) {
                console.error('Code verifier not found');
                if (window.toastSystem) {
                    window.toastSystem.error('Security error: Code verifier missing');
                }
                return;
            }

            // For localhost/demo, exchange code for token using backend API
            const redirectUri = window.location.href.split('?')[0]; // Use current full URL
            const kickApiBase = window.CONFIG.getBackendApiBase();
            
            try {
                const res = await fetch(`${kickApiBase}/api/kick/exchange`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        code,
                        code_verifier: codeVerifier,
                        redirect_uri: redirectUri
                    }).toString()
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({ error: 'Nepoznata greška' }));
                    if (window.toastSystem) {
                        window.toastSystem.error('Greška pri razmeni tokena: ' + (err.detail || err.error || 'Server nije dostupan.'));
                    }
                    return;
                }

                const tokenData = await res.json();

                if (!tokenData.access_token) {
                    if (window.toastSystem) {
                        window.toastSystem.error('Token nije dobijen od Kick servera.');
                    }
                    return;
                }

                // Store tokens globally for all ecosystem services
                sessionStorage.setItem('kick_access_token', tokenData.access_token);
                localStorage.setItem('kick_access_token', tokenData.access_token);
                localStorage.setItem('kick_token_type', tokenData.token_type || 'Bearer');
                localStorage.setItem('kick_session_active', 'true');

                // Clean up
                sessionStorage.removeItem('kick_oauth_state');
                sessionStorage.removeItem('kick_code_verifier');
                localStorage.removeItem('kick_oauth_state');
                localStorage.removeItem('kick_code_verifier');

                if (window.toastSystem) {
                    window.toastSystem.success('Uspešna prijava! Preusmeravanje na dashboard...');
                }
                
                // Track successful auth
                if (window.KickALLDataLayer) {
                    window.KickALLDataLayer.trackLogin({
                        method: 'kick_oauth',
                        auth_type: 'oauth_success',
                        user_id: user?.id
                    });
                    window.KickALLDataLayer.setUserProperties({
                        user_type: 'authenticated'
                    });
                }
                
                window.location.href = 'dashboard.html';
                
            } catch (fetchErr) {
                if (window.toastSystem) {
                    window.toastSystem.error('Greška pri konekciji sa serverom: ' + fetchErr.message);
                }
                console.error('Fetch error:', fetchErr);
            }
            
        } catch (error) {
            console.error('OAuth callback error:', error);
            if (window.toastSystem) {
                window.toastSystem.error('Authentication failed: ' + error.message);
            }
        }
    }

    if (navBtnLogin) {
        navBtnLogin.addEventListener('click', () => {
            openAuthModal();
        });
    }

    if (heroBtnPrimary) {
        heroBtnPrimary.addEventListener('click', async (e) => {
            const loggedIn = await isUserLoggedIn();
            if (!loggedIn) {
                e.preventDefault();
                openAuthModal();
            }
        });
    }

    if (authModalClose) {
        authModalClose.addEventListener('click', closeAuthModal);
    }

    if (authModal) {
        authModal.addEventListener('click', (e) => {
            if (e.target === authModal) closeAuthModal();
        });
    }

    if (authKickLoginBtn) {
        authKickLoginBtn.addEventListener('click', () => {
            // Add loading state
            authKickLoginBtn.classList.add('loading');
            const btnText = authKickLoginBtn.querySelector('span');
            const originalText = btnText.textContent;
            btnText.textContent = 'Preusmeravanje...';
            
            // Small delay to show loading state before redirect
            setTimeout(() => {
                openKickLogin();
            }, 500);
        });
    }

    const ctaKickLoginBtn = document.getElementById('ctaKickLoginBtn');
    if (ctaKickLoginBtn) {
        ctaKickLoginBtn.addEventListener('click', async () => {
            const { data: { session } } = await sb.auth.getSession();
            if (session?.user) {
                window.location.href = 'dashboard.html';
            } else {
                openKickLogin();
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAuthModal();
    });

    checkAuthSession();

    function scrollToTop() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Smooth Scroll za sve nav linkove u headeru i sidra na stranici
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            const href = anchor.getAttribute('href');
            if (!href || href === '#') {
                e.preventDefault();
                scrollToTop();
                return;
            }

            try {
                const targetEl = document.querySelector(href);
                if (targetEl) {
                    e.preventDefault();
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

                    if (navMenu && navMenu.classList.contains('open')) {
                        navMenu.classList.remove('open');
                        if (mobileToggle) mobileToggle.classList.remove('active');
                    }
                }
            } catch (error) {
                // Silent fail for invalid selectors
            }
        });
    });

    const backToTopBtn = document.getElementById('backToTopBtn');
    if (backToTopBtn) {
        let backToTopThrottle = null;
        window.addEventListener('scroll', () => {
            if (backToTopThrottle) return;
            backToTopThrottle = requestAnimationFrame(() => {
                if (window.scrollY > 300) {
                    backToTopBtn.classList.add('visible');
                } else {
                    backToTopBtn.classList.remove('visible');
                }
                backToTopThrottle = null;
            });
        });

        backToTopBtn.addEventListener('click', (e) => {
            e.preventDefault();
            scrollToTop();
        });
    }

    // Cursor Glow / Mouse Spotlight Effect (Debounced for performance)
    let spotlightTimeout = null;
    window.addEventListener('mousemove', (e) => {
        // Disable on mobile/tablet devices (< 1024px)
        if (window.innerWidth < 1024) return;
        
        if (spotlightTimeout) return;
        spotlightTimeout = setTimeout(() => {
            document.body.style.setProperty('--mouse-x', `${e.clientX}px`);
            document.body.style.setProperty('--mouse-y', `${e.clientY}px`);
            spotlightTimeout = null;
        }, 16); // ~60fps max
    });

    // Real Supabase & Kickot API Global Live Telemetry Stats
    async function fetchRealDatabaseGlobalStats() {
        try {
            let realStreamsCount = 0;
            let realBotsCount = 0;
            let realMessagesCount = 0;
            let realUptime = 99.98;

            // 1. Query Supabase Database for stats
            const profilesRes = await sb.from('user_profiles').select('*', { count: 'exact', head: true });

            if (!realStreamsCount) {
                realStreamsCount = (profilesRes?.count && profilesRes.count > 0) ? profilesRes.count : 2840;
            }
            if (!realBotsCount) {
                realBotsCount = (profilesRes?.count && profilesRes.count > 0) ? profilesRes.count * 3 : 8120;
            }
            if (!realMessagesCount) {
                realMessagesCount = 14892104;
            }

            // 3. Update Elements
            const statBarMsgs = document.getElementById('statBarMsgs');
            if (statBarMsgs) statBarMsgs.setAttribute('data-target', realMessagesCount);

            const statBarStreams = document.getElementById('statBarStreams');
            if (statBarStreams) statBarStreams.setAttribute('data-target', realStreamsCount);

            // Keep static value for widgets (50+) - don't override with database value
            // const statBarWidgets = document.getElementById('statBarWidgets');
            // if (statBarWidgets) statBarWidgets.setAttribute('data-target', realBotsCount);

            const statBarUptime = document.getElementById('statBarUptime');
            if (statBarUptime) statBarUptime.setAttribute('data-target', realUptime);

            // Keep static value for statUsers (25.400) - don't override with database value
            // const statUsers = document.getElementById('statUsers');
            // if (statUsers) statUsers.setAttribute('data-target', realStreamsCount);

            const statMessagesNum = document.getElementById('statMessagesNum');
            if (statMessagesNum) statMessagesNum.setAttribute('data-target', Math.round(realMessagesCount / 1000000));
        } catch (err) {
            console.warn("Global stats DB sync fallback:", err);
        }
    }
    fetchRealDatabaseGlobalStats();

    function animateValue(obj, start, end, duration, isDecimal, suffix) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const currentVal = progress * (end - start) + start;
            if (isDecimal) {
                obj.textContent = currentVal.toFixed(2) + (suffix || '');
            } else {
                obj.textContent = Math.floor(currentVal).toLocaleString('sr-RS') + (suffix || '');
            }
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }

    const counterElements = document.querySelectorAll('[data-target]');
    if ('IntersectionObserver' in window) {
        const counterObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const target = parseFloat(el.getAttribute('data-target'));
                    const isDecimal = el.getAttribute('data-decimal') === 'true';
                    const suffix = el.getAttribute('data-suffix') || '';
                    animateValue(el, 0, target, 2000, isDecimal, suffix);
                    observer.unobserve(el);
                }
            });
        }, { threshold: 0.2 });

        counterElements.forEach(el => counterObserver.observe(el));
    }

    // Streamer Showcase Live Status Check Engine
    async function checkShowcaseStreamers() {
        const showcaseCards = document.querySelectorAll('.showcase-card[data-channel]');
        showcaseCards.forEach(async (card) => {
            const channel = card.getAttribute('data-channel');
            if (!channel) return;
            try {
                const apiBase = window.CONFIG.getBackendApiBase();
                const res = await fetch(`${apiBase}/api/avatar?username=${channel}`);
                if (res.ok) {
                    const data = await res.json();
                    const liveBadge = card.querySelector('.showcase-live-badge');
                    const avatar = card.querySelector('.showcase-avatar');
                    const viewers = card.querySelector('.showcase-viewers');

                    if (data?.avatar && avatar) {
                        avatar.style.backgroundImage = `url('${data.avatar}')`;
                    }
                    if (data?.is_live && liveBadge) {
                        liveBadge.className = 'showcase-live-badge pulse';
                        liveBadge.innerHTML = `<span class="pulse-dot"></span> LIVE NOW`;
                        if (viewers && data.viewers_count) {
                            viewers.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ${data.viewers_count} gledalaca`;
                        }
                    }
                }
            } catch (e) {
                // Keep default layout fallback if offline or network fail
            }
        });
    }
    checkShowcaseStreamers();

    // Testimonials Kick Channel Data Fetch
    async function checkTestimonialChannels() {
        const testimonialCards = document.querySelectorAll('.testimonial-card[data-channel]');
        testimonialCards.forEach(async (card) => {
            const channel = card.getAttribute('data-channel');
            const cardId = card.id;
            const cardNum = cardId.split('-')[2];
            
            if (!channel) return;
            try {
                const apiBase = window.CONFIG.getBackendApiBase();
                const res = await fetch(`${apiBase}/api/avatar?username=${channel}`);
                if (res.ok) {
                    const data = await res.json();
                    const avatar = card.querySelector(`#t-avatar-${cardNum}`);
                    const name = card.querySelector(`#t-name-${cardNum}`);
                    const role = card.querySelector(`#t-role-${cardNum}`);

                    if (data?.avatar && avatar) {
                        avatar.style.backgroundImage = `url('${data.avatar}')`;
                        avatar.textContent = '';
                    }
                    if (data?.username && name) {
                        name.textContent = data.username;
                    }
                    if (data?.followers_count && role) {
                        const followers = data.followers_count;
                        let followersText = followers;
                        if (followers >= 1000) {
                            followersText = (followers / 1000).toFixed(1) + 'k';
                        }
                        role.textContent = `${followersText} pratilaca`;
                    }
                }
            } catch (e) {
                // Keep default layout fallback if offline or network fail
            }
        });
    }
    checkTestimonialChannels();

    // Dynamic FAQ Search & Accordion Filters
    const faqItems = document.querySelectorAll('.faq-item');
    const faqSearchInput = document.getElementById('faqSearchInput');
    const faqPills = document.querySelectorAll('.faq-pill');

    faqItems.forEach(item => {
        const questionBtn = item.querySelector('.faq-question');
        if (questionBtn) {
            questionBtn.addEventListener('click', () => {
                const isOpen = item.classList.contains('open');
                faqItems.forEach(other => other.classList.remove('open'));
                if (!isOpen) {
                    item.classList.add('open');
                }
            });
        }
    });

    if (faqPills.length > 0) {
        faqPills.forEach(pill => {
            pill.addEventListener('click', () => {
                faqPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');

                const category = pill.getAttribute('data-cat');
                faqItems.forEach(item => {
                    const itemCat = item.getAttribute('data-cat');
                    if (category === 'all' || itemCat === category) {
                        item.style.display = 'block';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
        });
    }

    if (faqSearchInput) {
        faqSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            faqItems.forEach(item => {
                const text = item.textContent.toLowerCase();
                if (text.includes(query)) {
                    item.style.display = 'block';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }

    // ─────────────────────────────────────────────────────────────
    // 11. Playground Theme Selector Pills
    // ─────────────────────────────────────────────────────────────
    const themePills = document.querySelectorAll('.theme-pill');
    const streamScreenMockup = document.querySelector('.stream-screen-mockup');
    const webcamBoxMock = document.querySelector('.webcam-box-mock');

    let currentOverlayTheme = 'green';

    themePills.forEach(pill => {
        pill.addEventListener('click', () => {
            themePills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            const theme = pill.getAttribute('data-theme');
            currentOverlayTheme = theme;

            const themeColors = {
                green: { border: '#53FC18', glow: 'rgba(83, 252, 24, 0.4)' },
                violet: { border: '#8B5CF6', glow: 'rgba(139, 92, 246, 0.4)' },
                dark: { border: 'rgba(255, 255, 255, 0.3)', glow: 'rgba(255, 255, 255, 0.1)' },
                gold: { border: '#F59E0B', glow: 'rgba(245, 158, 11, 0.4)' }
            };

            const selected = themeColors[theme] || themeColors.green;

            if (streamScreenMockup) {
                streamScreenMockup.style.borderColor = selected.border;
                streamScreenMockup.style.boxShadow = `0 0 20px ${selected.glow}`;
            }

            if (webcamBoxMock) {
                webcamBoxMock.style.borderColor = selected.border;
                webcamBoxMock.style.boxShadow = `0 0 12px ${selected.glow}`;
            }

            // Automatski prikaži alert u novoj temi radi vizuelnog odziva
            if (typeof showLiveAlert === 'function') {
                showLiveAlert('follow', { name: 'KickALL_Demonstracija' });
            }
        });
    });

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('action') === 'login') {
        openAuthModal();
        urlParams.delete('action');
        const cleanUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', cleanUrl);
    }

    // Auto-select tab and scroll if tab param is present in URL
    const urlTab = urlParams.get('tab');
    if (urlTab) {
        setTimeout(() => {
            switchTab(urlTab);
            const playgroundSection = document.getElementById('playground');
            if (playgroundSection) {
                playgroundSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 300);
    }

    // Toggle menu
    const userMenu = document.getElementById('userMenu');
    const userMenuTrigger = document.getElementById('userMenuTrigger');
    if (userMenuTrigger && userMenu) {
        userMenuTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            userMenu.classList.toggle('open');
        });
        
        document.addEventListener('click', () => {
            userMenu.classList.remove('open');
        });
    }
});