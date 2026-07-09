/* ═══════════════════════════════════════════════════════════
   KickOt — app.js
   Supabase Auth + Language Switcher + UI Logic
   ═══════════════════════════════════════════════════════════ */

// ── Supabase Init ──────────────────────────────────────────
const SUPABASE_URL  = 'https://rcukparptzzyssqdmydt.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjdWtwYXJwdHp6eXNzcWRteWR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0Nzc3NzEsImV4cCI6MjA5OTA1Mzc3MX0.5FLpFchORq6h5O0q5HWWYBiRD6qCPZKGjx3Zo4UhlJc';

const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

let currentUser = null;

// ── Translations ───────────────────────────────────────────
const translations = {
  sr: {
    'meta.title':         'Kickot — Bot za Kick platformu',
    'meta.desc':          'Kickot je moćan chat bot za Kick platformu. Komande, moderacija, watchtime, leaderboard i mini-igre.',
    'nav.back':           'KickAll',
    'nav.login':          'Prijavi se',
    'nav.signup':         'Registruj se',
    'nav.dashboard':      'Dashboard',
    'nav.settings':       'Podešavanja',
    'nav.logout':         'Odjavi se',
    'hero.live':          'Aktivan · U produkciji',
    'hero.title':         'Bot za Kick koji radi dok ti odmaraš',
    'hero.subtitle':      'Moćan chat bot za Kick platformu sa prilagođenim komandama, automatskom moderacijom, watchtime sistemom, mini-igrama i leaderboard-om. Na srpskom i engleskom.',
    'hero.cta.primary':   '🚀 Počni besplatno',
    'hero.cta.secondary': 'Vidi funkcionalnosti',
    'hero.note':          'Besplatan plan dostupan. Bez kreditne kartice.',
    'features.label':     'Funkcionalnosti',
    'features.title':     'Sve što jedan Kick bot treba',
    'features.subtitle':  'Kickot dolazi sa bogatim setom funkcionalnosti koje možeš koristiti odmah, bez ikakve konfiguracije.',
    'feat.cmd.title':     'Prilagođene Komande',
    'feat.cmd.desc':      'Definiši vlastite komande sa odgovorima, varijablama i cool-down-om. Sistem komandi radi u realnom vremenu.',
    'feat.mod.title':     'Automatska Moderacija',
    'feat.mod.desc':      'Anti-spam, filter reči, timeout i ban sistem. Bot pazi na chat dok ti uživaš u streamu.',
    'feat.wt.title':      'Watchtime & Leaderboard',
    'feat.wt.desc':       'Automatsko praćenje watchtime-a svakog gledalaca. Rangovi, top liste i nagrade za lojalne fanove.',
    'feat.games.title':   'Mini-igre za Chat',
    'feat.games.desc':    '!duel, !8ball, !love, !brak, !roll — igre koje drže chat aktivan i zabavnim tokom celog streama.',
    'feat.lang.title':    'Srpski i Engleski',
    'feat.lang.desc':     'Bot odgovara na srpskom ili engleskom, u zavisnosti od podešavanja kanala.',
    'feat.stats.title':   'Statistike uživo',
    'feat.stats.desc':    'Dashboard sa svim statistikama kanala, aktivnim korisnicima, top komandama i aktivnošću chata.',
    'cmds.label':         'Komande',
    'cmds.title':         'Bogata biblioteka komandi',
    'cmds.subtitle':      'Klikni na komandu da vidiš kako izgleda u chatu.',
    'cmd.rank':           'Tvoj rang i watchtime',
    'cmd.top':            'Top 10 gledalaca',
    'cmd.love':           'Kompatibilnost sa nekim',
    'cmd.brak':           'Venčaj se sa nekim',
    'cmd.duel':           'Izazovi nekoga na duel',
    'cmd.8ball':          'Postavi pitanje sudbini',
    'cmd.roll':           'Baci kockicu',
    'cmd.uptime':         'Koliko stream traje',
    'cmd.preview':        '// Preview — live chat simulacija',
    'pricing.label':      'Cene',
    'pricing.title':      'Poštene cene za pravi alat',
    'pricing.subtitle':   'Počni besplatno. Nadogradi se kada budeš spreman.',
    'pricing.forever':    'Zauvek besplatno',
    'pricing.per.month':  '/mesec',
    'pricing.popular':    'Najpopularniji',
    'pricing.free.desc':  'Sve što treba za početak.',
    'pricing.pro.desc':   'Za ozbiljne streamere.',
    'pricing.biz.desc':   'Za više kanala i organizacije.',
    'pf.f1':              'Bot uvek aktivan',
    'pf.f2':              'Do 10 komandi',
    'pf.f3':              'Watchtime tracking',
    'pf.f4':              'Osnovna moderacija',
    'pf.f5':              'Napredna moderacija',
    'pf.f6':              'Prioritetna podrška',
    'pp.f1':              'Neograničene komande',
    'pp.f2':              'Napredna moderacija',
    'pp.f3':              'Sve mini-igre',
    'pp.f4':              'Analytics dashboard',
    'pp.f5':              'Prilagođeni prefix',
    'pp.f6':              'Prioritetna podrška',
    'pb.f1':              'Sve iz Pro plana',
    'pb.f2':              'Do 5 Kick kanala',
    'pb.f3':              'API pristup',
    'pb.f4':              'Prilagođeni branding',
    'pb.f5':              'Webhooks integracija',
    'pb.f6':              'Dedikovan support',
    'pricing.cta.free':   'Počni besplatno',
    'pricing.cta.pro':    'Uzmi Pro plan',
    'pricing.cta.biz':    'Uzmi Business',
    'cta.title':          'Spreman da poboljšaš chat?',
    'cta.desc':           'Registruj se i povezi Kickot sa svojim Kick kanalom. Za manje od 5 minuta.',
    'cta.primary':        '🚀 Kreiraj nalog',
    'cta.login':          'Prijavi se',
    'footer.desc':        'Moćan chat bot za Kick platformu. Deo KickAll ekosistema.',
    'footer.product':     'Produkt',
    'footer.features':    'Funkcionalnosti',
    'footer.commands':    'Komande',
    'footer.pricing':     'Cene',
    'footer.ecosystem':   'Ekosistem',
    'footer.copy':        '© 2026 KickAll / Kickot. Sva prava zadržana.',
    'footer.privacy':     'Privatnost',
    'footer.terms':       'Uslovi',
    'modal.tagline':      'Bot za Kick platformu',
    'tab.login':          'Prijava',
    'tab.signup':         'Registracija',
    'form.email':         'Email adresa',
    'form.password':      'Lozinka',
    'form.name':          'Ime / Nadimak',
    'form.name.ph':       'Tvoje ime',
    'form.pw.ph':         'Min. 8 karaktera',
    'form.pw.hint':       'Minimum 8 karaktera',
    'form.forgot':        'Zaboravljena lozinka?',
    'form.login.submit':  'Prijavi se',
    'form.signup.submit': 'Kreiraj nalog',
    'form.register.link': 'Registruj se',
    'form.login.link':    'Prijavi se',
    'form.have.account':  'Već imaš nalog?',
    'form.terms.note':    'Registracijom prihvataš naše Uslove korišćenja i Politiku privatnosti.',
    'forgot.desc':        'Unesi svoju email adresu i poslaćemo ti link za reset lozinke.',
    'forgot.submit':      'Pošalji reset link',
    'forgot.back':        '← Nazad na prijavu',
    // Validation
    'err.email.required': 'Email adresa je obavezna',
    'err.email.invalid':  'Unesi validnu email adresu',
    'err.pw.required':    'Lozinka je obavezna',
    'err.pw.short':       'Lozinka mora imati minimum 8 karaktera',
    'err.name.required':  'Ime je obavezno',
    // Auth responses
    'auth.login.success':    'Uspešno prijavljen!',
    'auth.signup.success':   'Nalog kreiran! Proveri email za potvrdu.',
    'auth.forgot.success':   'Link za reset je poslat na tvoj email.',
    'auth.logout.success':   'Uspešno odjavljen.',
    'auth.err.invalid':      'Pogrešan email ili lozinka.',
    'auth.err.exists':       'Nalog sa ovim emailom već postoji.',
    'auth.err.generic':      'Došlo je do greške. Pokušaj ponovo.',
    'auth.err.email.confirm':'Ovaj email već postoji ali nije potvrđen. Proveri inbox.',
    'auth.err.rate_limit':   'Previše pokušaja. Sačekaj nekoliko minuta pa pokušaj ponovo.',
    'auth.err.email_invalid':'Email adresa nije prihvaćena. Pokušaj sa drugom adresom.',
  },
  en: {
    'meta.title':         'Kickot — Bot for Kick Platform',
    'meta.desc':          'Kickot is a powerful chat bot for the Kick platform. Commands, moderation, watchtime, leaderboard and mini-games.',
    'nav.back':           'KickAll',
    'nav.login':          'Log in',
    'nav.signup':         'Sign up',
    'nav.dashboard':      'Dashboard',
    'nav.settings':       'Settings',
    'nav.logout':         'Log out',
    'hero.live':          'Active · In Production',
    'hero.title':         'The Kick Bot That Works While You Stream',
    'hero.subtitle':      'A powerful chat bot for the Kick platform with custom commands, automatic moderation, watchtime system, mini-games and leaderboard. In both Serbian and English.',
    'hero.cta.primary':   '🚀 Get started free',
    'hero.cta.secondary': 'See features',
    'hero.note':          'Free plan available. No credit card required.',
    'features.label':     'Features',
    'features.title':     'Everything a Kick Bot Needs',
    'features.subtitle':  'Kickot comes with a rich set of features you can use immediately, with no configuration.',
    'feat.cmd.title':     'Custom Commands',
    'feat.cmd.desc':      'Define your own commands with responses, variables and cooldowns. The command system works in real time.',
    'feat.mod.title':     'Automatic Moderation',
    'feat.mod.desc':      'Anti-spam, word filter, timeout and ban system. The bot watches chat while you enjoy streaming.',
    'feat.wt.title':      'Watchtime & Leaderboard',
    'feat.wt.desc':       'Automatic watchtime tracking for every viewer. Ranks, top lists and rewards for loyal fans.',
    'feat.games.title':   'Chat Mini-games',
    'feat.games.desc':    '!duel, !8ball, !love, !marry, !roll — games that keep chat active and fun throughout the stream.',
    'feat.lang.title':    'Serbian & English',
    'feat.lang.desc':     'The bot responds in Serbian or English depending on channel settings.',
    'feat.stats.title':   'Live Statistics',
    'feat.stats.desc':    'Dashboard with all channel stats, active users, top commands and chat activity.',
    'cmds.label':         'Commands',
    'cmds.title':         'Rich Command Library',
    'cmds.subtitle':      'Click a command to see how it looks in chat.',
    'cmd.rank':           'Your rank and watchtime',
    'cmd.top':            'Top 10 viewers',
    'cmd.love':           'Compatibility with someone',
    'cmd.brak':           'Marry someone',
    'cmd.duel':           'Challenge someone to a duel',
    'cmd.8ball':          'Ask fate a question',
    'cmd.roll':           'Roll a dice',
    'cmd.uptime':         'How long the stream has been live',
    'cmd.preview':        '// Preview — live chat simulation',
    'pricing.label':      'Pricing',
    'pricing.title':      'Fair Prices for a Real Tool',
    'pricing.subtitle':   'Start free. Upgrade when you\'re ready.',
    'pricing.forever':    'Forever free',
    'pricing.per.month':  '/month',
    'pricing.popular':    'Most Popular',
    'pricing.free.desc':  'Everything you need to get started.',
    'pricing.pro.desc':   'For serious streamers.',
    'pricing.biz.desc':   'For multiple channels and organizations.',
    'pf.f1':              'Bot always active',
    'pf.f2':              'Up to 10 commands',
    'pf.f3':              'Watchtime tracking',
    'pf.f4':              'Basic moderation',
    'pf.f5':              'Advanced moderation',
    'pf.f6':              'Priority support',
    'pp.f1':              'Unlimited commands',
    'pp.f2':              'Advanced moderation',
    'pp.f3':              'All mini-games',
    'pp.f4':              'Analytics dashboard',
    'pp.f5':              'Custom prefix',
    'pp.f6':              'Priority support',
    'pb.f1':              'Everything in Pro',
    'pb.f2':              'Up to 5 Kick channels',
    'pb.f3':              'API access',
    'pb.f4':              'Custom branding',
    'pb.f5':              'Webhooks integration',
    'pb.f6':              'Dedicated support',
    'pricing.cta.free':   'Get started free',
    'pricing.cta.pro':    'Get Pro plan',
    'pricing.cta.biz':    'Get Business',
    'cta.title':          'Ready to Upgrade Your Chat?',
    'cta.desc':           'Sign up and connect Kickot to your Kick channel. In less than 5 minutes.',
    'cta.primary':        '🚀 Get started free',
    'cta.login':          'Log in',
    'footer.desc':        'Powerful chat bot for the Kick platform. Part of the KickAll ecosystem.',
    'footer.product':     'Product',
    'footer.features':    'Features',
    'footer.commands':    'Commands',
    'footer.pricing':     'Pricing',
    'footer.ecosystem':   'Ecosystem',
    'footer.copy':        '© 2026 KickAll / Kickot. All rights reserved.',
    'footer.privacy':     'Privacy',
    'footer.terms':       'Terms',
    'modal.tagline':      'Bot for Kick Platform',
    'tab.login':          'Login',
    'tab.signup':         'Register',
    'form.email':         'Email address',
    'form.password':      'Password',
    'form.name':          'Name / Nickname',
    'form.name.ph':       'Your name',
    'form.pw.ph':         'Min. 8 characters',
    'form.pw.hint':       'Minimum 8 characters',
    'form.forgot':        'Forgot password?',
    'form.login.submit':  'Log in',
    'form.signup.submit': 'Create Account',
    'form.register.link': 'Register',
    'form.login.link':    'Log in',
    'form.have.account':  'Already have an account?',
    'form.terms.note':    'By registering you agree to our Terms of Service and Privacy Policy.',
    'forgot.desc':        'Enter your email address and we\'ll send you a password reset link.',
    'forgot.submit':      'Send reset link',
    'forgot.back':        '← Back to login',
    // Validation
    'err.email.required': 'Email address is required',
    'err.email.invalid':  'Please enter a valid email address',
    'err.pw.required':    'Password is required',
    'err.pw.short':       'Password must be at least 8 characters',
    'err.name.required':  'Name is required',
    // Auth responses
    'auth.login.success':    'Successfully logged in!',
    'auth.signup.success':   'Account created! Check your email for confirmation.',
    'auth.forgot.success':   'Reset link sent to your email.',
    'auth.logout.success':   'Successfully logged out.',
    'auth.err.invalid':      'Invalid email or password.',
    'auth.err.exists':       'An account with this email already exists.',
    'auth.err.generic':      'An error occurred. Please try again.',
    'auth.err.email.confirm':'This email exists but is not confirmed. Check your inbox.',
    'auth.err.rate_limit':   'Too many attempts. Please wait a few minutes and try again.',
    'auth.err.email_invalid':'Email address was not accepted. Please try a different address.',
  }
};

// ── Language System ────────────────────────────────────────
let currentLang = localStorage.getItem('kickall-lang') || 'sr';

function t(key) {
  return translations[currentLang][key] || translations['sr'][key] || key;
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('kickall-lang', lang);
  document.documentElement.lang = lang === 'sr' ? 'sr' : 'en';

  // Dodaj/ukloni klase na body elementu
  document.body.classList.toggle('lang-sr', lang === 'sr');
  document.body.classList.toggle('lang-en', lang === 'en');

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const text = translations[lang][key];
    if (text !== undefined && el.children.length === 0) {
      el.textContent = text;
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const text = translations[lang][key];
    if (text) el.placeholder = text;
  });

  document.getElementById('btn-sr').classList.toggle('active', lang === 'sr');
  document.getElementById('btn-en').classList.toggle('active', lang === 'en');

  document.title = t('meta.title');
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = t('meta.desc');
}

// ── Navbar Scroll ──────────────────────────────────────────
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

// ── Scroll Reveal (supports data-reveal directions + data-delay) ────
// Elements without data-reveal attribute (plain [data-reveal]) animate up.
// data-reveal="left|right|scale|fade" for directional entries.
// data-delay="1-6" for stagger offset.
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('revealed');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });

document.querySelectorAll('[data-reveal]').forEach(el => revealObserver.observe(el));

// ── Smooth scroll ──────────────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }
  });
});

// ── Particles ─────────────────────────────────────────────
(function() {
  const canvas = document.getElementById('particlesCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const particles = [];
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize, { passive: true });
  const colors = ['#8B5CF6','#6366F1','#53FC18','#A78BFA'];
  for (let i = 0; i < 50; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      size: Math.random() * 2 + 0.5,
      speedX: (Math.random() - 0.5) * 0.3,
      speedY: (Math.random() - 0.5) * 0.3 - 0.1,
      color: colors[Math.floor(Math.random() * colors.length)],
      opacity: Math.random() * 0.4 + 0.1,
      life: Math.random(),
      lifeSpeed: Math.random() * 0.003 + 0.001,
    });
  }
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.life += p.lifeSpeed;
      if (p.life > 1) { p.life = 0; p.x = Math.random() * canvas.width; p.y = canvas.height + 10; }
      const alpha = Math.sin(p.life * Math.PI) * p.opacity;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color + Math.round(alpha * 255).toString(16).padStart(2, '0');
      ctx.fill();
      p.x += p.speedX;
      p.y += p.speedY;
    });
    requestAnimationFrame(animate);
  }
  animate();
})();

// ── Web Audio API Synth Sound Helper ───────────────────────
let audioCtx = null;
function playSynthSound(frequency = 440, type = 'sine', duration = 0.1, volume = 0.1) {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);

        gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);

        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
        console.warn('Audio is blocked or not supported:', e);
    }
}

// ── Commands Showcase ─────────────────────────────────────
const commandPreviews = {
  // Statistika i rangiranje
  'top-watchtime': () => `<div class="cp-line"><span class="cp-user">tutz_fan:</span> <span class="cp-msg">!top watchtime</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:var(--color-green)">👑 Top gledaoci: 1. VIP_stefan (48h) 2. chat_queen (36h) 3. tutz_fan (24h) 4. gamer_marko (18h) 5. novak99 (15h)</span></div>`,
  'top-chat':      () => `<div class="cp-line"><span class="cp-user">novak99:</span> <span class="cp-msg">!top chat 3</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#FBBF24">💬 Najaktivniji u četu: 1. chat_queen (1.450 poruka) 2. tutz_fan (982 poruke) 3. VIP_stefan (820 poruka)</span></div>`,
  'watchtime':     () => `<div class="cp-line"><span class="cp-user">tutz_fan:</span> <span class="cp-msg">!watchtime</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#60A5FA">⏱️ tutz_fan, tvoj watchtime je: 24 sata i 35 minuta!</span></div>`,
  'chat':          () => `<div class="cp-line"><span class="cp-user">tutz_fan:</span> <span class="cp-msg">!chat</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#A78BFA">✉️ tutz_fan, poslao si ukupno 982 poruke u ovom četu!</span></div>`,
  'me':            () => `<div class="cp-line"><span class="cp-user">tutz_fan:</span> <span class="cp-msg">!me</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:var(--color-green)">📊 Korisnik: tutz_fan | Sati: 24.5h | Poruke: 982 | Rang: #3 | Uloga: VIP</span></div>`,

  // Zabava i interakcija
  'iq':            () => `<div class="cp-line"><span class="cp-user">novak99:</span> <span class="cp-msg">!iq @tutz_fan</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#A78BFA">🧠 Skeniram mozak korisnika @tutz_fan... Rezultat: IQ je 142! Genijalac! 💡</span></div>`,
  'samar':         () => `<div class="cp-line"><span class="cp-user">novak99:</span> <span class="cp-msg">!samar @tutz_fan</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#F87171">💥 novak99 je opalio šamarčinu korisniku @tutz_fan sa mokrom haringom! 🐟</span></div>`,
  'duel':          () => `<div class="cp-line"><span class="cp-user">novak99:</span> <span class="cp-msg">!duel @tutz_fan</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#F87171">⚔️ Duel: @novak99 vs @tutz_fan! Pucnjava počinje... @tutz_fan je izvukao brži revolver i pobedio sa 12 HP preostalo! 🏆</span></div>`,
  'roll':          () => `<div class="cp-line"><span class="cp-user">novak99:</span> <span class="cp-msg">!roll @tutz_fan</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:var(--color-green)">🎲 Bacam kockicu za @tutz_fan... Rezultat: 78! (0-100)</span></div>`,

  // Informacije i alati
  'vreme':         () => `<div class="cp-line"><span class="cp-user">chat_fan:</span> <span class="cp-msg">!vreme Beograd</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#60A5FA">⛅ Vreme u Beogradu: 24°C | Vetar: 12 km/h | Vlažnost: 65% | Delimično oblačno.</span></div>`,
  'info':          () => `<div class="cp-line"><span class="cp-user">chat_fan:</span> <span class="cp-msg">!info</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#60A5FA">🤖 Kickot Chat Bot v2.4 | Pomažem u moderaciji, zabavi i statistici tvog kanala.</span></div>`,
  'cinjenica':     () => `<div class="cp-line"><span class="cp-user">chat_fan:</span> <span class="cp-msg">!cinjenica</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#FBBF24">💡 Činjenica: Prvi kompjuterski bag bila je stvarna buba (moljac) zaglavljena u releju 1947. godine!</span></div>`,
  'followage':     () => `<div class="cp-line"><span class="cp-user">tutz_fan:</span> <span class="cp-msg">!followage</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#F472B6">💖 tutz_fan prati ovaj kanal već 8 meseci, 12 dana i 4 sata!</span></div>`,
  'uptime':        () => `<div class="cp-line"><span class="cp-user">new_viewer:</span> <span class="cp-msg">!uptime</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#60A5FA">⏱️ Stream traje: 2 sata, 47 minuta i 32 sekunde!</span></div>`,
};

// Logika za prebacivanje kategorija komandi
document.querySelectorAll('.category-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const cat = btn.getAttribute('data-category');
    
    // Sakri sve komande i prikaži samo iz odabrane kategorije
    document.querySelectorAll('.cmd-item').forEach(item => {
      if (item.getAttribute('data-cat') === cat) {
        item.style.display = 'flex';
      } else {
        item.style.display = 'none';
      }
    });
    
    // Klikni na prvu komandu u toj kategoriji da se osveži preview
    const firstVisible = document.querySelector(`.cmd-item[data-cat="${cat}"]`);
    if (firstVisible) {
      firstVisible.click();
    }
  });
});

// Logika za klik na pojedinačnu komandu
document.querySelectorAll('.cmd-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.cmd-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    const cmd = item.getAttribute('data-cmd');
    const preview = document.getElementById('cmdPreviewContent');
    if (preview && commandPreviews[cmd]) {
      preview.innerHTML = commandPreviews[cmd]();
      
      // Zvučni efekat na klik
      playSynthSound(600, 'sine', 0.15);
      
      // Beli bljesak okvira za preview log tablu
      const playground = document.getElementById('mainPlayground');
      if (playground) {
        playground.classList.remove('flash-active');
        void playground.offsetWidth; // Trigger reflow
        playground.classList.add('flash-active');
      }
    }
  });
});

// ── Modal ─────────────────────────────────────────────────
let currentTab = 'login';

function openModal(tab = 'login') {
  const modal = document.getElementById('authModal');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  switchTab(tab);
}

function closeModal() {
  const modal = document.getElementById('authModal');
  modal.classList.remove('open');
  document.body.style.overflow = '';
  clearAllErrors();
}

function handleModalBackdropClick(e) {
  if (e.target === document.getElementById('authModal')) closeModal();
}

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

function switchTab(tab) {
  currentTab = tab;
  const tabs = ['login', 'signup', 'forgot'];
  tabs.forEach(t => {
    const tabEl = document.getElementById(`tab-${t}`);
    const formEl = document.getElementById(`${t}Form`);
    if (tabEl) tabEl.classList.toggle('active', t === tab);
    if (formEl) formEl.style.display = t === tab ? 'flex' : 'none';
  });
  clearAllErrors();
}

// ── Form Helpers ───────────────────────────────────────────
function clearAllErrors() {
  document.querySelectorAll('.field-error').forEach(e => { e.textContent = ''; e.classList.remove('show'); });
  document.querySelectorAll('.form-alert').forEach(e => { e.textContent = ''; e.classList.remove('show'); });
  document.querySelectorAll('.form-input').forEach(e => e.classList.remove('error'));
}

function showFieldError(fieldId, msg) {
  const el = document.getElementById(fieldId);
  if (el) { el.textContent = msg; el.classList.add('show'); }
  const input = document.getElementById(fieldId.replace('Err', ''));
  if (input) input.classList.add('error');
}

function showFormAlert(alertId, msg, type = 'error') {
  const el = document.getElementById(alertId);
  if (!el) return;
  el.textContent = msg;
  el.className = `form-alert form-alert-${type} show`;
}

function setLoading(formName, loading) {
  const btn = document.getElementById(`${formName}Btn`);
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = show 
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>` 
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}

// ── Auth Error Mapper ─────────────────────────────────────
function mapAuthError(error) {
  const code = (error.code || '').toLowerCase();
  const msg  = (error.message || '').toLowerCase();

  if (code === 'over_email_send_rate_limit' || error.status === 429 || msg.includes('rate limit')) {
    return t('auth.err.rate_limit');
  }
  if (code === 'email_address_invalid' || msg.includes('is invalid') || msg.includes('invalid email')) {
    return t('auth.err.email_invalid');
  }
  if (msg.includes('already registered') || msg.includes('already exists') || code === 'user_already_exists') {
    return t('auth.err.exists');
  }
  if (msg.includes('invalid login') || msg.includes('invalid credentials') || code === 'invalid_credentials') {
    return t('auth.err.invalid');
  }
  if (msg.includes('email not confirmed') || code === 'email_not_confirmed') {
    return t('auth.err.email.confirm');
  }
  return t('auth.err.generic');
}

// ── Login ──────────────────────────────────────────────────
async function handleLogin() {
  clearAllErrors();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  let valid = true;

  if (!email) { showFieldError('loginEmailErr', t('err.email.required')); valid = false; }
  else if (!validateEmail(email)) { showFieldError('loginEmailErr', t('err.email.invalid')); valid = false; }
  if (!password) { showFieldError('loginPasswordErr', t('err.pw.required')); valid = false; }
  if (!valid) return;

  setLoading('login', true);
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      showFormAlert('loginError', mapAuthError(error));
    } else {
      showToast('success', t('auth.login.success'), '👋');
      closeModal();
      onUserChange(data.user);
    }
  } catch (err) {
    showFormAlert('loginError', t('auth.err.generic'));
  } finally {
    setLoading('login', false);
  }
}

// ── Sign Up ────────────────────────────────────────────────
async function handleSignup() {
  clearAllErrors();
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  let valid = true;

  if (!name) { showFieldError('signupNameErr', t('err.name.required')); valid = false; }
  if (!email) { showFieldError('signupEmailErr', t('err.email.required')); valid = false; }
  else if (!validateEmail(email)) { showFieldError('signupEmailErr', t('err.email.invalid')); valid = false; }
  if (!password) { showFieldError('signupPasswordErr', t('err.pw.required')); valid = false; }
  else if (password.length < 8) { showFieldError('signupPasswordErr', t('err.pw.short')); valid = false; }
  if (!valid) return;

  setLoading('signup', true);
  try {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name }
      }
    });
    if (error) {
      showFormAlert('signupError', mapAuthError(error));
    } else if (data.user && !data.session) {
      // Email confirmation required
      showFormAlert('signupSuccess', t('auth.signup.success'), 'success');
    } else if (data.session) {
      showToast('success', t('auth.signup.success'), '🎉');
      closeModal();
      onUserChange(data.user);
    }
  } catch (err) {
    showFormAlert('signupError', t('auth.err.generic'));
  } finally {
    setLoading('signup', false);
  }
}

// ── Forgot Password ────────────────────────────────────────
async function handleForgot() {
  clearAllErrors();
  const email = document.getElementById('forgotEmail').value.trim();

  if (!email) { showFieldError('forgotEmailErr', t('err.email.required')); return; }
  if (!validateEmail(email)) { showFieldError('forgotEmailErr', t('err.email.invalid')); return; }

  setLoading('forgot', true);
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname + '?reset=true'
    });
    if (error) {
      showFormAlert('forgotError', t('auth.err.generic'));
    } else {
      showFormAlert('forgotSuccess', t('auth.forgot.success'), 'success');
    }
  } catch {
    showFormAlert('forgotError', t('auth.err.generic'));
  } finally {
    setLoading('forgot', false);
  }
}

// ── Sign Out ───────────────────────────────────────────────
async function handleSignOut() {
  await sb.auth.signOut();
  showToast('info', t('auth.logout.success'), '👋');
  onUserChange(null);
}

// ── Auth State ─────────────────────────────────────────────
function onUserChange(user) {
  currentUser = user;
  const guestNav = document.getElementById('guestNav');
  const userMenu = document.getElementById('userMenu');
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');

  if (user) {
    guestNav.style.display = 'none';
    userMenu.classList.add('visible');
    const name = user.user_metadata?.display_name || user.email?.split('@')[0] || 'User';
    userName.textContent = name;
    
    const avatarVal = user.user_metadata?.avatar_url || name.charAt(0).toUpperCase();
    if (avatarVal.startsWith('data:image') || avatarVal.startsWith('http')) {
      userAvatar.style.backgroundImage = `url("${avatarVal}")`;
      userAvatar.style.backgroundSize = 'cover';
      userAvatar.style.backgroundPosition = 'center';
      userAvatar.textContent = '';
    } else {
      userAvatar.style.backgroundImage = 'none';
      userAvatar.textContent = avatarVal;
    }
  } else {
    guestNav.style.display = 'flex';
    userMenu.classList.remove('visible');
  }
}

// ── User Dropdown (click-based, no hover gap bug) ──────────────
function toggleUserDropdown() {
  const menu = document.getElementById('userMenu');
  const isOpen = menu.classList.contains('open');
  if (isOpen) {
    closeUserDropdown();
  } else {
    menu.classList.add('open');
  }
}

function closeUserDropdown() {
  document.getElementById('userMenu')?.classList.remove('open');
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const menu = document.getElementById('userMenu');
  if (menu && !menu.contains(e.target)) {
    closeUserDropdown();
  }
});

let settingsUploadedAvatarBase64 = null;

function openSettingsModal() {
  closeUserDropdown();
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  if (!currentUser) {
    showToast('error', currentLang === 'sr' ? 'Moraš biti prijavljen' : 'You must be logged in', '⚠️');
    return;
  }
  
  // Fill in fields
  const name = currentUser.user_metadata?.display_name || currentUser.email?.split('@')[0] || 'User';
  const avatarVal = currentUser.user_metadata?.avatar_url || name.charAt(0).toUpperCase();

  document.getElementById('settingsEmail').value = currentUser.email;
  document.getElementById('settingsName').value = name;
  document.getElementById('settingsPassword').value = '';
  document.getElementById('settingsConfirmPassword').value = '';

  setSettingsAvatarPreview(avatarVal);
  settingsUploadedAvatarBase64 = null;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

function handleSettingsModalBackdropClick(e) {
  if (e.target.id === 'settingsModal') {
    closeSettingsModal();
  }
}

function setSettingsAvatarPreview(urlOrEmoji) {
  const imgEl = document.getElementById('settingsAvatarPreviewImg');
  if (!imgEl) return;
  if (urlOrEmoji.startsWith('data:image') || urlOrEmoji.startsWith('http')) {
    imgEl.style.backgroundImage = `url("${urlOrEmoji}")`;
    imgEl.style.backgroundSize = 'cover';
    imgEl.style.backgroundPosition = 'center';
    imgEl.textContent = '';
  } else {
    imgEl.style.backgroundImage = 'none';
    imgEl.textContent = urlOrEmoji;
  }
}

function triggerSettingsAvatarUpload() {
  document.getElementById('settingsAvatarFileInput').click();
}

function handleSettingsAvatarFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const maxDim = 128;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxDim) {
          height *= maxDim / width;
          width = maxDim;
        }
      } else {
        if (height > maxDim) {
          width *= maxDim / height;
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.65);
      setSettingsAvatarPreview(compressedBase64);
      settingsUploadedAvatarBase64 = compressedBase64;
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
}

function selectSettingsPresetAvatar(key) {
  const emojis = { robot: '🤖', ninja: '🥷', gamepad: '🎮', star: '⭐' };
  const emoji = emojis[key];
  setSettingsAvatarPreview(emoji);
  settingsUploadedAvatarBase64 = emoji;
}

async function handleSaveSettings() {
  const name = document.getElementById('settingsName').value.trim();
  const password = document.getElementById('settingsPassword').value;
  const confirmPassword = document.getElementById('settingsConfirmPassword').value;

  if (!name) {
    showToast('error', currentLang === 'sr' ? 'Ime ne može biti prazno.' : 'Name cannot be empty.', '⚠️');
    return;
  }

  if (password) {
    if (password.length < 8) {
      showToast('error', currentLang === 'sr' ? 'Lozinka mora imati barem 8 karaktera.' : 'Password must be at least 8 characters.', '⚠️');
      return;
    }
    if (password !== confirmPassword) {
      showToast('error', currentLang === 'sr' ? 'Lozinke se ne podudaraju.' : 'Passwords do not match.', '⚠️');
      return;
    }
  }

  const btn = document.getElementById('settingsSaveBtn');
  const spinner = document.getElementById('settingsSpinner');
  btn.disabled = true;
  spinner.classList.add('visible');

  try {
    const updateData = { display_name: name };
    if (settingsUploadedAvatarBase64 !== null) {
      updateData.avatar_url = settingsUploadedAvatarBase64;
    }

    const { error: profileError } = await sb.auth.updateUser({ data: updateData });
    if (profileError) throw profileError;

    if (password) {
      const { error: passwordError } = await sb.auth.updateUser({ password: password });
      if (passwordError) throw passwordError;
    }

    showToast('success', currentLang === 'sr' ? 'Podešavanja uspešno sačuvana!' : 'Settings saved successfully!', '✅');
    closeSettingsModal();
    
    const { data: { user } } = await sb.auth.getUser();
    if (user) onUserChange(user);

  } catch (err) {
    showToast('error', err.message || 'Greška pri čuvanju podešavanja.', '❌');
  } finally {
    btn.disabled = false;
    spinner.classList.remove('visible');
  }
}

function goToDashboard() { closeUserDropdown(); window.location.href = 'dashboard.html'; }

// ── Toast Notifications ────────────────────────────────────
let toastIdCounter = 0;

function showToast(type, msg, icon = '💬', duration = 4000) {
  const container = document.getElementById('toastContainer');
  const id = ++toastIdCounter;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.id = `toast-${id}`;
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-body"><div class="toast-msg">${msg}</div></div>
    <button class="toast-close" onclick="removeToast(${id})">✕</button>
  `;
  container.appendChild(toast);

  setTimeout(() => removeToast(id), duration);
}

function removeToast(id) {
  const el = document.getElementById(`toast-${id}`);
  if (el) {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 300);
  }
}

// ── Auth Listener ──────────────────────────────────────────
sb.auth.onAuthStateChange((event, session) => {
  onUserChange(session?.user || null);
});

// ── Spotlight Effect ────────────────────────────────────────
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

// ── Init ──────────────────────────────────────────────────
setLang(currentLang);

// Check for password reset redirect
if (window.location.search.includes('reset=true')) {
  openModal('login');
  showToast('info', currentLang === 'sr' ? 'Unesi novu lozinku' : 'Enter your new password', '🔑');
}
