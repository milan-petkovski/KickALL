/**
 * kickall - Interaktivni Skriptovi (Iteracija 2.2)
 * Sadrži simulatore za kickot, kickaj, kickov i kickan,
 * kao i animacije brojača, jezički switcher i specijalne efekte (flash border i blur uklanjanje).
 */

document.addEventListener('DOMContentLoaded', () => {
    // -----------------------------------------------------------------
    // 1. Jezički Switcher (SR / EN)
    // -----------------------------------------------------------------
    const langSwitcherBtn = document.getElementById('langSwitcherBtn');
    const body = document.body;

    // Učitaj sačuvani jezik ili postavi podrazumevani (SR)
    const savedLang = localStorage.getItem('kickall_lang') || 'sr';
    setLanguage(savedLang);

    if (langSwitcherBtn) {
        langSwitcherBtn.addEventListener('click', () => {
            const currentLang = body.classList.contains('lang-sr') ? 'sr' : 'en';
            const newLang = currentLang === 'sr' ? 'en' : 'sr';
            setLanguage(newLang);
            triggerFlashEffect(langSwitcherBtn);
            playSynthSound(450, 'sine', 0.1);
        });
    }

    function setLanguage(lang) {
        if (lang === 'en') {
            body.classList.remove('lang-sr');
            body.classList.add('lang-en');
            localStorage.setItem('kickall_lang', 'en');
        } else {
            body.classList.remove('lang-en');
            body.classList.add('lang-sr');
            localStorage.setItem('kickall_lang', 'sr');
        }
    }

    // -----------------------------------------------------------------
    // 2. Efekat Bljeskanja Belog Okvira (Flash Border)
    // -----------------------------------------------------------------
    function triggerFlashEffect(element) {
        if (!element) return;
        element.classList.remove('flash-active');
        void element.offsetWidth; // Pokretanje reflow-a
        element.classList.add('flash-active');
        
        // Ukloni klasu nakon što se završi animacija
        setTimeout(() => {
            element.classList.remove('flash-active');
        }, 500);
    }

    // Dodaj automatski flash efekat na klik za dugmad, tabove i komande
    document.querySelectorAll('.btn, .tab-btn, .cmd-badge, .btn-alert-trigger, .period-btn').forEach(elem => {
        elem.addEventListener('click', () => {
            triggerFlashEffect(elem);
        });
    });

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

            addChatMessage('Milan_Streamer', message, false, false, 'moderator');
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
            addChatMessage('Milan_Streamer', cmd, false, false, 'moderator');
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
                ? `👿 <strong>!bacihejt</strong> triggered by Milan_Streamer towards <strong>${target}</strong>. <br>${roast}<br>Milan_Streamer received <strong>${randomPoint > 0 ? '+' + randomPoint : randomPoint}</strong> points! (Total: <strong>${userPoints}</strong>)`
                : `👿 <strong>!bacihejt</strong> pokrenut od strane Milan_Streamer ka korisniku <strong>${target}</strong>. <br>${roast}<br>Milan_Streamer je dobio <strong>${randomPoint > 0 ? '+' + randomPoint : randomPoint}</strong> poena! (Ukupno: <strong>${userPoints}</strong> poena)`;

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
                ? `❤️ <strong>!posaljiljubav</strong> sent to <strong>${target}</strong>. <br>${love}<br>Milan_Streamer received <strong>${randomPoint > 0 ? '+' + randomPoint : randomPoint}</strong> points! (Total: <strong>${userPoints}</strong>)`
                : `❤️ <strong>!posaljiljubav</strong> poslata za <strong>${target}</strong>. <br>${love}<br>Milan_Streamer je dobio <strong>${randomPoint > 0 ? '+' + randomPoint : randomPoint}</strong> poena! (Ukupno: <strong>${userPoints}</strong> poena)`;

            addChatMessage('kickot', responseText, true);
            playSynthSound(randomPoint > 0 ? 600 : 250, 'triangle', 0.3);

        } else if (cmd === '!poeni') {
            const responseText = isEn
                ? `🏆 User Milan_Streamer currently has <strong>${userPoints}</strong> points on this channel. Rank: <strong>Chat King</strong>.`
                : `🏆 Korisnik Milan_Streamer trenutno ima <strong>${userPoints}</strong> poena na ovom kanalu. Rang: <strong>Kralj chata</strong>.`;
            addChatMessage('kickot', responseText, true);
            playSynthSound(440, 'sine', 0.2);

        } else if (cmd === '!vreme') {
            const grad = arg || (isEn ? 'Belgrade' : 'Beograd');
            const isErrorSimulated = Math.random() > 0.7;

            if (isErrorSimulated) {
                const errText = isEn
                    ? `⚙️ [Retry Mechanism] API Error: fetch failed for city "${grad}". Retrying in 1s...`
                    : `⚙️ [Retry Mehanizam] API Greška: fetch failed za grad "${grad}". Pokušavam ponovo za 1s...`;
                addChatMessage('kickot', errText, true);
                playSynthSound(180, 'sawtooth', 0.15);
                
                setTimeout(() => {
                    const retryText = isEn
                        ? `✅ [Successful Retry] Weather for <strong>${grad}</strong>: Sunny ☀️, current temp is <strong>29°C</strong>. Wind: 3 m/s.`
                        : `✅ [Uspešan Retry] Vreme za <strong>${grad}</strong>: Sunčano ☀️, trenutna temperatura je <strong>29°C</strong>. Vetar: 3 m/s.`;
                    addChatMessage('kickot', retryText, true);
                    playSynthSound(500, 'sine', 0.2);
                }, 1000);
            } else {
                const weatherText = isEn
                    ? `🌤️ Weather for <strong>${grad}</strong>: Mostly sunny, current temp is <strong>28°C</strong>. Humidity: 45%.`
                    : `🌤️ Vreme za <strong>${grad}</strong>: Pretežno sunčano, trenutna temperatura je <strong>28°C</strong>. Vlažnost vazduha: 45%.`;
                addChatMessage('kickot', weatherText, true);
                playSynthSound(500, 'sine', 0.2);
            }

        } else {
            if (message.startsWith('!')) {
                const responseText = isEn
                    ? `❌ Unknown command. Available commands: <strong>!bacihejt</strong>, <strong>!posaljiljubav</strong>, <strong>!poeni</strong>, <strong>!vreme</strong>.`
                    : `❌ Nepoznata komanda. Dostupne komande su: <strong>!bacihejt</strong>, <strong>!posaljiljubav</strong>, <strong>!poeni</strong>, <strong>!vreme</strong>.`;
                addChatMessage('kickot', responseText, true);
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
        'Milan_Streamer', 'Ana_M', 'BalkanGamer', 'KickKralj', 'Pera_123',
        'StreamZver', 'Sandra_99', 'ChatMaster', 'Deki_BG', 'Kiki_00',
        'Luka_Pro', 'Nikola_K', 'Elena_NS', 'GamerStrim', 'Suki_OP'
    ];

    if (startGiveawayBtn) {
        startGiveawayBtn.addEventListener('click', () => {
            const prizeValue = giveawayPrize.value.trim() || 'Mesečna Subskripcija 🎁';
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
});
