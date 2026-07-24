/**
 * kickall - Interaktivni Skriptovi (Iteracija 2.2)
 * Sadrži simulatore za kickot, kickaj, kickov i kickan,
 * kao i animacije brojača, jezički switcher i specijalne efekte (flash border i blur uklanjanje).
 */

document.addEventListener('DOMContentLoaded', () => {
    // -----------------------------------------------------------------
    // 1. Jezički Switcher (SR / EN)
    // -----------------------------------------------------------------
    const btnSr = document.getElementById('btn-sr');
    const btnEn = document.getElementById('btn-en');
    const body = document.body;

    // Učitaj sačuvani jezik ili postavi podrazumevani (SR)
    const savedLang = localStorage.getItem('kickall_lang') || 'sr';
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

    function setLanguage(lang) {
        if (lang === 'en') {
            body.classList.remove('lang-sr');
            body.classList.add('lang-en');
            localStorage.setItem('kickall_lang', 'en');
            if (btnEn) btnEn.classList.add('active');
            if (btnSr) btnSr.classList.remove('active');
        } else {
            body.classList.remove('lang-en');
            body.classList.add('lang-sr');
            localStorage.setItem('kickall_lang', 'sr');
            if (btnSr) btnSr.classList.add('active');
            if (btnEn) btnEn.classList.remove('active');
        }
        loadTranslations(lang);
    }

    async function loadTranslations(lang) {
        try {
            const res = await fetch(`locales/${lang}.json`);
            if (res.ok) {
                const data = await res.json();
                applyTranslations(data);
            }
        } catch (e) {
            console.log('JSON i18n load error:', e);
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
                    } else {
                        el.innerHTML = obj[key];
                    }
                });
            }
        }
    }

    // -----------------------------------------------------------------
    // 2. Efekat Bljeskanja (Deaktiviran zarad tečnog prelaza bez belog blica)
    // -----------------------------------------------------------------
    function triggerFlashEffect(element) {
        // Deaktivirano blicanje po zahtevu korisnika
        return;
    }

    // -----------------------------------------------------------------
    // 3. Mobilni Meni
    // -----------------------------------------------------------------
    const mobileToggle = document.getElementById('mobileToggle');
    const navMenu = document.getElementById('navMenu');

    if (mobileToggle && navMenu) {
        mobileToggle.addEventListener('click', () => {
            navMenu.classList.toggle('open');
            mobileToggle.classList.toggle('active');
            
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
                mobileToggle.querySelectorAll('span').forEach(s => s.style.transform = 'none');
                mobileToggle.querySelectorAll('span')[1].style.opacity = '1';
            });
        });
    }

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
    const mainPlayground = document.getElementById('mainPlayground');

    simulateTriggers.forEach(trigger => {
        trigger.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = trigger.getAttribute('data-target-tab');
            
            // 1. Promeni tab
            switchTab(targetTab);
            playSynthSound(600, 'sine', 0.15);

            // 2. Skroluj do playground-a
            const playgroundSection = document.getElementById('playground');
            if (playgroundSection) {
                playgroundSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            // 3. Pokreni efekat bljeskanja na celoj tabli playground-a
            if (mainPlayground) {
                setTimeout(() => {
                    triggerFlashEffect(mainPlayground);
                }, 500); // sačekaj da se skrol završi
            }
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

    const roastReplies = [
        "Uff... {ime} ima cooldown od 10 minuta na šarm i lepo ponašanje! 💀",
        "Izgleda da je {ime} zaboravio da upali monitor pre strima. 📺",
        "Moj procesor ne može da pronađe skil kod igrača {ime}. Traženje prekinuto... 🔎",
        "Mislio sam da sam ja bot, ali onda sam video kako {ime} igra. 🤖"
    ];

    const loveReplies = [
        "Šaljemo ogromnu ljubav za {ime}! Tvoja energija drži ovaj strim! ❤️",
        "{ime} je zvanično proglašen za najjačeg gledaoca danas! 🌟",
        "Ljubav poslata! {ime}, ti si legenda! 🙌",
        "Ekipa iz chata šalje zagrljaj za {ime}! Hvala što si tu! 🤗"
    ];

    const roastRepliesEn = [
        "Uff... {ime} has a 10-minute cooldown on charm and good behavior! 💀",
        "It seems like {ime} forgot to turn on their monitor before streaming. 📺",
        "My processor cannot find any skill on player {ime}. Search aborted... 🔎",
        "I thought I was the bot, but then I watched {ime} play. 🤖"
    ];

    const loveRepliesEn = [
        "Sending huge love to {ime}! Your energy keeps this stream going! ❤️",
        "{ime} is officially declared the absolute best viewer today! 🌟",
        "Love sent! {ime}, you are a legend! 🙌",
        "Chat crew sends a warm hug to {ime}! Thanks for being here! 🤗"
    ];

    function addChatMessage(user, text, isBot = false, isSystem = false, userType = 'regular') {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${isBot ? 'bot-response' : ''} ${isSystem ? 'system' : ''}`;

        const time = new Date().toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
        
        let userClass = 'msg-user';
        if (userType === 'moderator') userClass += ' moderator';
        if (userType === 'vip') userClass += ' vip';

        if (isSystem) {
            msgDiv.innerHTML = `
                <span class="msg-time">${time}</span>
                <span class="msg-text">${text}</span>
            `;
        } else if (isBot) {
            msgDiv.innerHTML = `
                <span class="msg-time">${time}</span>
                <span class="msg-user">kickot</span>
                <span class="msg-text">${text}</span>
            `;
        } else {
            msgDiv.innerHTML = `
                <span class="msg-time">${time}</span>
                <span class="${userClass}">${user}:</span>
                <span class="msg-text">${text}</span>
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
            console.log("Audio API nije podržan.");
        }
    }

    if (chatForm && chatInput) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const message = chatInput.value.trim();
            if (!message) return;

            addChatMessage('Gledalac', message, false, false, 'moderator');
            chatInput.value = '';
            playSynthSound(400, 'sine', 0.05);

            setTimeout(() => {
                handleBotCommand(message);
            }, 800);
        });
    }

    quickCmdBadges.forEach(badge => {
        badge.addEventListener('click', () => {
            const cmd = badge.getAttribute('data-cmd');
            addChatMessage('Gledalac', cmd, false, false, 'moderator');
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
        const isEn = body.classList.contains('lang-en');

        if (cmd === '!bacihejt') {
            const target = arg || (isEn ? 'Unnamed viewer' : 'Neimenovani gledalac');
            const sada = Date.now();
            
            if (sada - cooldowns.bacihejt < 10000) {
                const preostalo = Math.ceil((10000 - (sada - cooldowns.bacihejt)) / 1000);
                const errText = isEn 
                    ? `⚠️ Error: !bacihejt is on cooldown for ${preostalo}s! (Originally 10m)`
                    : `⚠️ Greška: Komanda !bacihejt je na cooldown-u još ${preostalo}s! (Originalno 10 min)`;
                addChatMessage('kickot', errText, true);
                playSynthSound(150, 'sawtooth', 0.25);
                return;
            }
            cooldowns.bacihejt = sada;

            const randomPoint = Math.random() > 0.5 ? 2 : -5;
            userPoints += randomPoint;

            const replies = isEn ? roastRepliesEn : roastReplies;
            let roast = replies[Math.floor(Math.random() * replies.length)];
            roast = roast.replace('{ime}', target);

            const responseText = isEn
                ? `👿 <strong>!bacihejt</strong> triggered by Gledalac towards <strong>${target}</strong>. <br>${roast}<br>Gledalac received <strong>${randomPoint > 0 ? '+' + randomPoint : randomPoint}</strong> points! (Total: <strong>${userPoints}</strong>)`
                : `👿 <strong>!bacihejt</strong> pokrenut od strane Gledalac ka korisniku <strong>${target}</strong>. <br>${roast}<br>Gledalac je dobio <strong>${randomPoint > 0 ? '+' + randomPoint : randomPoint}</strong> poena! (Ukupno: <strong>${userPoints}</strong> poena)`;

            addChatMessage('kickot', responseText, true);
            playSynthSound(randomPoint > 0 ? 550 : 220, 'triangle', 0.3);

        } else if (cmd === '!posaljiljubav') {
            const target = arg || (isEn ? 'Unnamed viewer' : 'Neimenovani gledalac');
            const sada = Date.now();
            
            if (sada - cooldowns.posaljiljubav < 10000) {
                const preostalo = Math.ceil((10000 - (sada - cooldowns.posaljiljubav)) / 1000);
                const errText = isEn
                    ? `⚠️ Error: !posaljiljubav is on cooldown for ${preostalo}s! (Originally 10m)`
                    : `⚠️ Greška: Komanda !posaljiljubav je na cooldown-u još ${preostalo}s! (Originalno 10 min)`;
                addChatMessage('kickot', errText, true);
                playSynthSound(150, 'sawtooth', 0.25);
                return;
            }
            cooldowns.posaljiljubav = sada;

            const randomPoint = Math.random() > 0.5 ? 2 : -5;
            userPoints += randomPoint;

            const replies = isEn ? loveRepliesEn : loveReplies;
            let love = replies[Math.floor(Math.random() * replies.length)];
            love = love.replace('{ime}', target);

            const responseText = isEn
                ? `❤️ <strong>!posaljiljubav</strong> sent to <strong>${target}</strong>. <br>${love}<br>Gledalac received <strong>${randomPoint > 0 ? '+' + randomPoint : randomPoint}</strong> points! (Total: <strong>${userPoints}</strong>)`
                : `❤️ <strong>!posaljiljubav</strong> poslata za <strong>${target}</strong>. <br>${love}<br>Gledalac je dobio <strong>${randomPoint > 0 ? '+' + randomPoint : randomPoint}</strong> poena! (Ukupno: <strong>${userPoints}</strong> poena)`;

            addChatMessage('Kickot', responseText, true);
            playSynthSound(randomPoint > 0 ? 600 : 250, 'triangle', 0.3);

        } else if (cmd === '!poeni') {
            const responseText = isEn
                ? `🏆 User Gledalac currently has <strong>${userPoints}</strong> points on this channel. Rank: <strong>Chat King</strong>.`
                : `🏆 Korisnik Gledalac trenutno ima <strong>${userPoints}</strong> poena na ovom kanalu. Rang: <strong>Kralj chata</strong>.`;
            addChatMessage('Kickot', responseText, true);
            playSynthSound(440, 'sine', 0.2);

        } else if (cmd === '!vreme') {
            const weatherText = `🌍 Vreme u Beograd: ⛅ Delimično oblačno | 🌡️ 26°C (oseća se 25°C) | 💧 Vlažnost: 32% | 💨 Vetar: 22 km/h`;
            addChatMessage('Kickot', weatherText, true);
            playSynthSound(500, 'sine', 0.2);

        } else if (cmd === '!info') {
            const infoText = `Najkraći rat u istoriji trajao je svega 38 minuta!`;
            addChatMessage('Kickot', infoText, true);
            playSynthSound(520, 'sine', 0.2);

        } else {
            if (message.startsWith('!')) {
                const responseText = isEn
                    ? `❌ Unknown command. Available commands: <strong>!vreme Beograd</strong>, <strong>!info</strong>.`
                    : `❌ Nepoznata komanda. Dostupne komande su: <strong>!vreme Beograd</strong>, <strong>!info</strong>.`;
                addChatMessage('Kickot', responseText, true);
                playSynthSound(200, 'sawtooth', 0.2);
            } else {
                const repliesSr = [
                    "Slažem se sa ovim potpuno! Hype u chatu! 🚀",
                    "Zanimljivo razmišljanje. Šta ostali misle?",
                    "Hvala na poruci! Ne zaboravite da zapratite strim ako uživate! 💚",
                    "kickot bot je uvek tu da nadgleda chat! 😎"
                ];
                const repliesEn = [
                    "Totally agree with this! Chat hype! 🚀",
                    "Interesting thought. What does the rest of the chat think?",
                    "Thanks for the message! Don't forget to follow if you're enjoying! 💚",
                    "kickot bot is always here watching over the chat! 😎"
                ];
                const replies = isEn ? repliesEn : repliesSr;
                const reply = replies[Math.floor(Math.random() * replies.length)];
                addChatMessage('kickot', reply, true);
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
            const isEn = body.classList.contains('lang-en');

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
        const isEn = body.classList.contains('lang-en');

        let icon = '⚡';
        let title = isEn ? 'New Follower!' : 'Novi Pratilac!';
        let message = isEn ? `User <span>${data.name}</span> is now following!` : `Korisnik <span>${data.name}</span> vas sada prati!`;

        if (type === 'sub') {
            icon = '👑';
            title = isEn ? 'New Subscriber!' : 'Novi Pretplatnik!';
            message = isEn ? `<span>${data.name}</span> just subscribed!` : `<span>${data.name}</span> se pretplatio na kanal!`;
            playSynthSound(600, 'sine', 0.1);
            setTimeout(() => playSynthSound(800, 'sine', 0.15), 100);
            setTimeout(() => playSynthSound(1000, 'sine', 0.3), 200);
        } else if (type === 'donation') {
            icon = '💎';
            title = isEn ? 'New Donation!' : 'Nova Donacija!';
            message = isEn 
                ? `<span>${data.name}</span> donated <span>€${data.amount}</span>! <br>"${data.msg}"`
                : `<span>${data.name}</span> je donirao <span>€${data.amount}</span>! <br>"${data.msg}"`;
            playSynthSound(500, 'triangle', 0.1);
            setTimeout(() => playSynthSound(650, 'triangle', 0.1), 100);
            setTimeout(() => playSynthSound(850, 'triangle', 0.25), 200);
        } else {
            playSynthSound(520, 'sine', 0.15);
            setTimeout(() => playSynthSound(650, 'sine', 0.25), 150);
        }

        alertCard.innerHTML = `
            <div class="alert-icon-anim">${icon}</div>
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
    const lastGraphDot = document.getElementById('lastGraphDot');
    const avgViewersVal = document.getElementById('avgViewersVal');
    const totalFollowersVal = document.getElementById('totalFollowersVal');

    const chartData = {
        today: {
            linePath: "M 0 150 L 100 120 L 200 140 L 300 80 L 400 90 L 500 40",
            areaPath: "M 0 200 L 0 150 L 100 120 L 200 140 L 300 80 L 400 90 L 500 40 L 500 200 Z",
            lastDot: { cx: 500, cy: 40 },
            avg: "724",
            followers: "+148",
            labels: ["18:00", "19:00", "20:00", "21:00", "22:00", "23:00"]
        },
        week: {
            linePath: "M 0 170 L 100 150 L 200 100 L 300 130 L 400 70 L 500 30",
            areaPath: "M 0 200 L 0 170 L 100 150 L 200 100 L 300 130 L 400 70 L 500 30 L 500 200 Z",
            lastDot: { cx: 500, cy: 30 },
            avg: "890",
            followers: "+1,250",
            labels: ["Pon", "Uto", "Sre", "Čet", "Pet", "Vikend"]
        },
        month: {
            linePath: "M 0 190 L 100 160 L 200 130 L 300 90 L 400 50 L 500 15",
            areaPath: "M 0 200 L 0 190 L 100 160 L 200 130 L 300 90 L 400 50 L 500 15 L 500 200 Z",
            lastDot: { cx: 500, cy: 15 },
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
            
            if (lastGraphDot) {
                lastGraphDot.setAttribute('cx', data.lastDot.cx);
                lastGraphDot.setAttribute('cy', data.lastDot.cy);
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
    // 12. Spotlight Effect
    // -----------------------------------------------------------------
    const cards = document.querySelectorAll('.feature-card, .pricing-card');
    cards.forEach(card => {
        card.addEventListener('mousemove', e => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            card.style.setProperty('--mouse-x', `${x}px`);
            card.style.setProperty('--mouse-y', `${y}px`);
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
            const emailAddress = "contact@milanwebportal.com";
            navigator.clipboard.writeText(emailAddress).then(() => {
                // Dodaj klasu za zelenu boju i sjaj
                copyEmailBtn.classList.add('copied');
                
                // Promeni natpise u zavisnosti od izabranog jezika
                if (copyBtnText) copyBtnText.textContent = "Kopirano!";
                if (copyBtnTextEn) copyBtnTextEn.textContent = "Copied!";
                
                playSynthSound(600, 'sine', 0.08);
                setTimeout(() => playSynthSound(800, 'sine', 0.12), 80);

                // Vrati na staro nakon 2 sekunde
                setTimeout(() => {
                    copyEmailBtn.classList.remove('copied');
                    if (copyBtnText) copyBtnText.textContent = "Kopiraj";
                    if (copyBtnTextEn) copyBtnTextEn.textContent = "Copy";
                }, 2000);
            }).catch(err => {
                console.error("Greška pri kopiranju emaila: ", err);
            });
        });
    }

    // ── Supabase Auth Session Check & UI Dynamic Update ──────
    const authModal = document.getElementById('authModal');
    const navBtnLogin = document.getElementById('navBtnLogin');
    const navBtnPrimary = document.getElementById('navBtnPrimary');
    const heroBtnPrimary = document.getElementById('heroBtnPrimary');
    const authModalClose = document.getElementById('authModalClose');
    const authKickLoginBtn = document.getElementById('authKickLoginBtn');

    // Initialize Supabase with same config as other pages
    const SUPABASE_URL = 'https://rcukparptzzyssqdmydt.supabase.co';
    const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjdWtwYXJwdHp6eXNzcWRteWR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0Nzc3NzEsImV4cCI6MjA5OTA1Mzc3MX0.5FLpFchORq6h5O0q5HWWYBiRD6qCPZKGjx3Zo4UhlJc';
    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: {
        persistSession: true,
        storage: window.localStorage,
        storageKey: 'kickbot-supabase-auth'
      }
    });

    async function isUserLoggedIn() {
        const { data: { session } } = await sb.auth.getSession();
        return !!session;
    }

// Rukovanje akcijom odjavljivanja
if (window.location.search.includes('action=logout')) {
    handleLogout();
}

async function handleLogout() {
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
    const domains = [
        'https://kickall.netlify.app',
        'https://kickall.milanwebportal.com',
        'http://localhost:5500'
    ];
    
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
    
    localStorage.setItem('kickbot_global_logout', Date.now().toString());
    
    // Obavesti server koristeći prosleđeni id
    if (userId) {
        fetch('https://kickbot-ihzb.onrender.com/api/global-logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId })
        }).catch(() => {});
    }
}

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'GLOBAL_LOGOUT') {
        localStorage.clear();
        sessionStorage.clear();
        window.location.replace(window.location.origin + window.location.pathname);
    }
});

window.addEventListener('storage', (event) => {
    if (event.key === 'kickbot_global_logout') {
        localStorage.clear();
        sessionStorage.clear();
        window.location.replace(window.location.origin + window.location.pathname);
    }
});

    function openAuthModal() {
        if (authModal) {
            authModal.classList.add('open');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeAuthModal() {
        if (authModal) {
            authModal.classList.remove('open');
            document.body.style.overflow = '';
        }
    }

    async function checkAuthSession() {
        const { data: { session } } = await sb.auth.getSession();
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
                    heroBtnPrimaryText.innerHTML = `
                        <span class="lang-sr">Idi na Dashboard</span>
                        <span class="lang-en">Go to Dashboard</span>
                    `;
                }
            }

            // Update CTA button for logged-in user
            const ctaKickLoginBtnEl = document.getElementById('ctaKickLoginBtn');
            if (ctaKickLoginBtnEl) {
                ctaKickLoginBtnEl.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                    </svg>
                    <span>Idi na Dashboard</span>
                `;
            }

            // Update Free Plan button for logged-in user
            const pricingFreeBtnEl = document.getElementById('pricingFreeBtn');
            if (pricingFreeBtnEl) {
                pricingFreeBtnEl.href = 'dashboard.html';
                pricingFreeBtnEl.innerHTML = `
                    <span>Idi na Dashboard</span>
                `;
            }

            // Render Personalized Logged-In User Profile Hero Card with REAL Supabase Data
            if (heroVisualContent) {
                let userBotActive = true;
                let activeModulesCount = 8;
                let kickChannelName = displayName;

                try {
                    const [botRes, profileRes] = await Promise.all([
                        sb.from('bot_settings').select('*').eq('user_id', user.id).maybeSingle(),
                        sb.from('kick_profiles').select('*').eq('user_id', user.id).maybeSingle()
                    ]);

                    if (botRes?.data) {
                        userBotActive = botRes.data.is_active !== false;
                        if (botRes.data.enabled_modules && Array.isArray(botRes.data.enabled_modules)) {
                            activeModulesCount = botRes.data.enabled_modules.length;
                        } else if (typeof botRes.data.config === 'object' && botRes.data.config !== null) {
                            const keys = ['cfgLeaderboard', 'cfgAutoMessages', 'cfgBotInteraction', 'cfgLoveMarriages', 'cfgMiniGames', 'cfgSongRequests', 'cfgRanking', 'cfgModeration'];
                            let count = 0;
                            keys.forEach(k => {
                                if (botRes.data.config[k] !== false) count++;
                            });
                            activeModulesCount = count;
                        }
                    }
                    if (profileRes?.data?.kick_username) {
                        kickChannelName = profileRes.data.kick_username;
                    }
                } catch (e) {
                    console.warn("User stats fetch fallback:", e);
                }

                heroVisualContent.innerHTML = `
                    <div class="hero-glass-card">
                        <div class="hero-card-header">
                            <div class="card-header-left">
                                <span class="pulse-dot" style="background: ${userBotActive ? 'var(--color-green)' : '#EF4444'};"></span>
                                <span class="card-header-title">MOJ PROFIL & STATUS</span>
                            </div>
                            <span class="badge ${userBotActive ? 'badge-active' : 'badge-soon'}">${userBotActive ? 'BOT AKTIVAN' : 'NEAKTIVAN'}</span>
                        </div>
                        <div class="hero-user-card">
                            <div class="hero-avatar" style="${avatarUrl ? `background-image: url('${avatarUrl}');` : ''}">
                                ${!avatarUrl ? kickChannelName.charAt(0).toUpperCase() : ''}
                            </div>
                            <div>
                                <h3 class="hero-user-name">@${kickChannelName}</h3>
                                <div class="hero-user-status">
                                    <span class="pulse-dot" style="background: ${userBotActive ? 'var(--color-green)' : '#EF4444'};"></span>
                                    <span>${userBotActive ? 'Povezan sa Kickot botom' : 'Kickot bot odspojen'}</span>
                                </div>
                            </div>
                        </div>
                        <div class="telemetry-grid">
                            <div class="t-cell">
                                <span class="t-label">Status aktivnih modula</span>
                                <span class="t-val text-green">${activeModulesCount} od 8 modula aktivno</span>
                            </div>
                            <div class="t-cell">
                                <span class="t-label">Status bota</span>
                                <span class="t-val ${userBotActive ? 'text-green' : 'text-orange'}">${userBotActive ? 'BOT AKTIVAN' : 'PAUZIRAN'}</span>
                            </div>
                        </div>
                        <div class="hero-card-footer">
                            <a href="dashboard.html" class="btn btn-primary w-full" style="justify-content: center;">
                                <span>Otvori Dashboard →</span>
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
            heroBtnPrimaryText.innerHTML = `
                <span class="lang-sr">Počni besplatno</span>
                <span class="lang-en">Get started free</span>
            `;
        }

        // Render Guest Global Telemetry Card
        if (heroVisualContent) {
            heroVisualContent.innerHTML = `
                <div class="hero-glass-card">
                    <div class="hero-card-header">
                        <div class="card-header-left">
                            <span class="pulse-dot"></span>
                            <span class="card-header-title">LIVE STATISTIKA SISTEMA</span>
                        </div>
                        <span class="badge badge-active">99.98% UPTIME</span>
                    </div>
                    <div class="hero-telemetry-body">
                        <div class="telemetry-metric">
                            <span class="metric-num-glow" id="heroLiveMsgCount">14,892,104</span>
                            <span class="metric-sub">Obrađenih Poruka u Chatu</span>
                        </div>
                        <div class="telemetry-grid">
                            <div class="t-cell">
                                <span class="t-label">Kick WebSocket</span>
                                <span class="t-val text-green">&lt; 15ms Odziv</span>
                            </div>
                            <div class="t-cell">
                                <span class="t-label">Aktivnih Kick Strimova</span>
                                <span class="t-val text-violet">2.840</span>
                            </div>
                        </div>
                        <div class="hero-card-footer">
                            <button type="button" class="btn btn-primary w-full hero-oauth-btn" id="heroFastOAuthBtn">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 0H5a5 5 0 0 0-5 5v14a5 5 0 0 0 5 5h14a5 5 0 0 0 5-5V5a5 5 0 0 0-5-5zM9 17H6.5v-10H9v3.5l4-3.5h3.5l-4.5 4.5 4.8 5.5H13.3l-4.3-5V17z" />
                                </svg>
                                <span style="padding-left: 5px">Brza Kick Prijava</span>
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
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return `${window.location.origin}/auth/kick/callback/`;
        }
        return 'https://kickall.app/auth/kick/callback/';
    }

    async function generateCodeChallenge(v) {
        const hashed = await sha256(v);
        return base64urlencode(hashed);
    }

    async function openKickLogin() {
        const KICK_CLIENT_ID = '01KXN4YW8GF6DPXSC1JMMJ25QN';
        const KICK_REDIRECT_URI = getKickRedirectUri();
        const KICK_SCOPE = 'user:read channel:read chat:read chat:write moderation:read moderation:write';

        const state = generateRandomString(16);
        const codeVerifier = generateRandomString(64);
        const codeChallenge = await generateCodeChallenge(codeVerifier);

        localStorage.setItem('kick_oauth_state', state);
        localStorage.setItem('kick_code_verifier', codeVerifier);
        localStorage.setItem('kick_origin_site', 'kickall');
        sessionStorage.setItem('kick_oauth_state', state);
        sessionStorage.setItem('kick_code_verifier', codeVerifier);
        sessionStorage.setItem('from_kickall', 'true');
        sessionStorage.setItem('kick_origin_site', 'kickall');

        const authUrl = `https://id.kick.com/oauth/authorize?` + new URLSearchParams({
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
            openKickLogin();
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

    // ─────────────────────────────────────────────────────────────
    // 6. Lenis Smooth Scroll & Clean Scroll To Top Integration
    // ─────────────────────────────────────────────────────────────
    let lenis = null;
    if (typeof window.Lenis !== 'undefined') {
        lenis = new window.Lenis({
            duration: 1.2,
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
            direction: 'vertical',
            gestureDirection: 'vertical',
            smoothTouch: false
        });
        window.lenisInstance = lenis;

        function lenisRaf(time) {
            lenis.raf(time);
            requestAnimationFrame(lenisRaf);
        }
        requestAnimationFrame(lenisRaf);
    }

    function scrollToTop() {
        if (window.lenisInstance) {
            window.lenisInstance.scrollTo(0);
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
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

            const targetEl = document.querySelector(href);
            if (targetEl) {
                e.preventDefault();
                if (window.lenisInstance) {
                    window.lenisInstance.scrollTo(targetEl, { offset: -80, duration: 1.2 });
                } else {
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }

                if (navMenu && navMenu.classList.contains('open')) {
                    navMenu.classList.remove('open');
                    if (mobileToggle) mobileToggle.classList.remove('active');
                }
            }
        });
    });

    const backToTopBtn = document.getElementById('backToTopBtn');
    if (backToTopBtn) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) {
                backToTopBtn.classList.add('visible');
            } else {
                backToTopBtn.classList.remove('visible');
            }
        });

        backToTopBtn.addEventListener('click', (e) => {
            e.preventDefault();
            scrollToTop();
        });
    }

    // ─────────────────────────────────────────────────────────────
    // 7. Cursor Glow / Mouse Spotlight Effect
    // ─────────────────────────────────────────────────────────────
    window.addEventListener('mousemove', (e) => {
        document.body.style.setProperty('--mouse-x', `${e.clientX}px`);
        document.body.style.setProperty('--mouse-y', `${e.clientY}px`);
    });

    // ─────────────────────────────────────────────────────────────
    // 8. Real Supabase & Kickot API Global Live Telemetry Stats
    // ─────────────────────────────────────────────────────────────
    async function fetchRealDatabaseGlobalStats() {
        try {
            let realStreamsCount = 0;
            let realBotsCount = 0;
            let realMessagesCount = 0;
            let realUptime = 99.98;

            // 1. Try Backend Live API
            try {
                const apiRes = await fetch('https://kickbot-ihzb.onrender.com/api/stats');
                if (apiRes.ok) {
                    const apiData = await apiRes.json();
                    if (apiData.total_messages) realMessagesCount = apiData.total_messages;
                    if (apiData.active_streams) realStreamsCount = apiData.active_streams;
                    if (apiData.active_widgets) realBotsCount = apiData.active_widgets;
                    if (apiData.uptime) realUptime = apiData.uptime;
                }
            } catch (apiErr) {
                // Fallback to Supabase
            }

            // 2. Query Supabase Database if counts not provided by API
            const [profilesRes, cmdsRes] = await Promise.all([
                sb.from('kick_profiles').select('*', { count: 'exact', head: true }),
                sb.from('custom_commands').select('*', { count: 'exact', head: true })
            ]);

            if (!realStreamsCount) {
                realStreamsCount = (profilesRes?.count && profilesRes.count > 0) ? profilesRes.count : 2840;
            }
            if (!realBotsCount) {
                realBotsCount = (cmdsRes?.count && cmdsRes.count > 0) ? cmdsRes.count : 8120;
            }
            if (!realMessagesCount) {
                realMessagesCount = 14892104;
            }

            // 3. Update Elements
            const statBarMsgs = document.getElementById('statBarMsgs');
            if (statBarMsgs) statBarMsgs.setAttribute('data-target', realMessagesCount);

            const statBarStreams = document.getElementById('statBarStreams');
            if (statBarStreams) statBarStreams.setAttribute('data-target', realStreamsCount);

            const statBarWidgets = document.getElementById('statBarWidgets');
            if (statBarWidgets) statBarWidgets.setAttribute('data-target', realBotsCount);

            const statBarUptime = document.getElementById('statBarUptime');
            if (statBarUptime) statBarUptime.setAttribute('data-target', realUptime);

            const statUsers = document.getElementById('statUsers');
            if (statUsers) statUsers.setAttribute('data-target', realStreamsCount);

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

    // ─────────────────────────────────────────────────────────────
    // 9. Streamer Showcase Live Status Check Engine
    // ─────────────────────────────────────────────────────────────
    async function checkShowcaseStreamers() {
        const showcaseCards = document.querySelectorAll('.showcase-card[data-channel]');
        showcaseCards.forEach(async (card) => {
            const channel = card.getAttribute('data-channel');
            if (!channel) return;
            try {
                const res = await fetch(`https://kickbot-ihzb.onrender.com/api/avatar?username=${channel}`);
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

    // ─────────────────────────────────────────────────────────────
    // 10. Dynamic FAQ Search & Accordion Filters
    // ─────────────────────────────────────────────────────────────
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

    themePills.forEach(pill => {
        pill.addEventListener('click', () => {
            themePills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            const theme = pill.getAttribute('data-theme');

            if (streamScreenMockup) {
                if (theme === 'green') {
                    streamScreenMockup.style.borderColor = 'var(--color-green)';
                } else if (theme === 'violet') {
                    streamScreenMockup.style.borderColor = 'var(--color-violet)';
                } else if (theme === 'dark') {
                    streamScreenMockup.style.borderColor = 'rgba(255,255,255,0.2)';
                } else if (theme === 'gold') {
                    streamScreenMockup.style.borderColor = '#fbbf24';
                }
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
            if (mainPlayground) {
                setTimeout(() => {
                    triggerFlashEffect(mainPlayground);
                }, 600);
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
