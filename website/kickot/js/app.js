/* ═══════════════════════════════════════════════════════════
   KickOt — app.js
   Supabase Auth + Language Switcher + UI Logic
   ═══════════════════════════════════════════════════════════ */

// ── Supabase Init ──────────────────────────────────────────
const SUPABASE_URL = 'https://rcukparptzzyssqdmydt.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjdWtwYXJwdHp6eXNzcWRteWR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0Nzc3NzEsImV4cCI6MjA5OTA1Mzc3MX0.5FLpFchORq6h5O0q5HWWYBiRD6qCPZKGjx3Zo4UhlJc';

const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    storage: window.localStorage,
    storageKey: 'kickbot-supabase-auth'
  }
});

let currentUser = null;

// ── Translations ───────────────────────────────────────────
const translations = {
  sr: {
    'meta.title': 'Kickot — Bot za Kick platformu',
    'meta.desc': 'Kickot je moćan chat bot za Kick platformu. Komande, moderacija, watchtime, leaderboard i mini-igre.',
    'nav.back': 'KickAll',
    'nav.login': 'Prijavi se',
    'nav.signup': 'Registruj se',
    'nav.dashboard': 'Dashboard',
    'nav.settings': 'Podešavanja',
    'nav.logout': 'Odjavi se',
    'hero.live': 'Aktivan',
    'hero.title': 'za KICK koji radi dok ti strimuješ',
    'hero.subtitle': 'Moćan chat bot za Kick platformu sa prilagođenim komandama, automatskom moderacijom, watchtime sistemom, mini-igrama i leaderboard-om. Na srpskom i engleskom.',
    'hero.cta.primary': 'Počni besplatno',
    'hero.cta.secondary': 'Vidi funkcionalnosti',
    'hero.note': 'Besplatan plan dostupan. Bez kreditne kartice.',
    'features.label': 'Funkcionalnosti',
    'features.title': 'Sve što jedan Kick bot treba',
    'features.subtitle': 'Kickot dolazi sa bogatim setom funkcionalnosti koje možeš koristiti odmah, bez ikakve konfiguracije.',
    'feat.cmd.title': 'Prilagođene Komande',
    'feat.cmd.desc': 'Definiši vlastite komande sa odgovorima, varijablama i cool-down-om. Sistem komandi radi u realnom vremenu.',
    'feat.mod.title': 'Automatska Moderacija',
    'feat.mod.desc': 'Anti-spam, filter reči, timeout i ban sistem. Bot pazi na chat dok ti uživaš u streamu.',
    'feat.wt.title': 'Watchtime & Leaderboard',
    'feat.wt.desc': 'Automatsko praćenje watchtime-a svakog gledalaca. Rangovi, top liste i nagrade za lojalne fanove.',
    'feat.games.title': 'Mini-igre za Chat',
    'feat.games.desc': '!duel, !8ball, !love, !brak, !roll — igre koje drže chat aktivan i zabavnim tokom celog streama.',
    'feat.lang.title': 'Srpski i Engleski',
    'feat.lang.desc': 'Bot odgovara na srpskom ili engleskom, u zavisnosti od podešavanja kanala.',
    'feat.stats.title': 'Statistike uživo',
    'feat.stats.desc': 'Dashboard sa svim statistikama kanala, aktivnim korisnicima, top komandama i aktivnošću chata.',
    'cmds.label': 'Komande',
    'cmds.title': 'Bogata biblioteka komandi',
    'cmds.subtitle': 'Klikni na komandu da vidiš kako izgleda u chatu.',
    'cmd.rank': 'Tvoj rang i watchtime',
    'cmd.top': 'Top 10 gledalaca',
    'cmd.love': 'Kompatibilnost sa nekim',
    'cmd.brak': 'Venčaj se sa nekim',
    'cmd.duel': 'Izazovi nekoga na duel',
    'cmd.8ball': 'Postavi pitanje sudbini',
    'cmd.roll': 'Baci kockicu',
    'cmd.uptime': 'Koliko stream traje',
    'cmd.preview': '// Preview — live chat simulacija',
    'pricing.label': 'Cene',
    'pricing.title': 'Poštene cene za pravi alat',
    'pricing.subtitle': 'Počni besplatno. Nadogradi se kada budeš spreman.',
    'pricing.forever': 'Zauvek besplatno',
    'pricing.per.month': '/mesec',
    'pricing.popular': 'Najpopularniji',
    'pricing.free.desc': 'Sve što treba za početak.',
    'pricing.pro.desc': 'Za ozbiljne streamere.',
    'pricing.biz.desc': 'Za više kanala i organizacije.',
    'pf.f1': 'Bot uvek aktivan',
    'pf.f2': 'Do 10 komandi',
    'pf.f3': 'Watchtime tracking',
    'pf.f4': 'Osnovna moderacija',
    'pf.f5': 'Napredna moderacija',
    'pf.f6': 'Prioritetna podrška',
    'pp.f1': 'Neograničene komande',
    'pp.f2': 'Napredna moderacija',
    'pp.f3': 'Sve mini-igre',
    'pp.f4': 'Analytics dashboard',
    'pp.f5': 'Prilagođeni prefix',
    'pp.f6': 'Prioritetna podrška',
    'pb.f1': 'Sve iz Pro plana',
    'pb.f2': 'Do 5 Kick kanala',
    'pb.f3': 'API pristup',
    'pb.f4': 'Prilagođeni branding',
    'pb.f5': 'Webhooks integracija',
    'pb.f6': 'Dedikovan support',
    'pricing.cta.free': 'Počni besplatno',
    'pricing.cta.pro': 'Uzmi Pro plan',
    'pricing.cta.biz': 'Uzmi Business',
    'cta.title': 'Spreman da poboljšaš chat?',
    'cta.desc': 'Registruj se i povezi Kickot sa svojim Kick kanalom. Za manje od 5 minuta.',
    'cta.primary': 'Kreiraj nalog',
    'cta.login': 'Prijavi se',
    'footer.desc': 'Moćan chat bot za Kick platformu. Deo KickAll ekosistema.',
    'footer.product': 'Produkt',
    'footer.features': 'Funkcionalnosti',
    'footer.commands': 'Komande',
    'footer.pricing': 'Cene',
    'footer.ecosystem': 'Ekosistem',
    'footer.copy': '© 2026 KickAll / Kickot. Sva prava zadržana.',
    'footer.privacy': 'Privatnost',
    'footer.terms': 'Uslovi',
    'modal.tagline': 'Bot za Kick platformu',
    'tab.login': 'Prijava',
    'tab.signup': 'Registracija',
    'form.email': 'Email adresa',
    'form.password': 'Lozinka',
    'form.name': 'Ime / Nadimak',
    'form.name.ph': 'Tvoje ime',
    'form.pw.ph': 'Min. 8 karaktera',
    'form.pw.hint': 'Minimum 8 karaktera',
    'form.forgot': 'Zaboravljena lozinka?',
    'form.login.submit': 'Prijavi se',
    'form.signup.submit': 'Kreiraj nalog',
    'form.register.link': 'Registruj se',
    'form.login.link': 'Prijavi se',
    'form.have.account': 'Već imaš nalog?',
    'form.terms.note': 'Registracijom prihvataš naše Uslove korišćenja i Politiku privatnosti.',
    'forgot.desc': 'Unesi svoju email adresu i poslaćemo ti link za reset lozinke.',
    'forgot.submit': 'Pošalji reset link',
    'forgot.back': '← Nazad na prijavu',
    // Validation
    'err.email.required': 'Email adresa je obavezna',
    'err.email.invalid': 'Unesi validnu email adresu',
    'err.pw.required': 'Lozinka je obavezna',
    'err.pw.short': 'Lozinka mora imati minimum 8 karaktera',
    'err.name.required': 'Ime je obavezno',
    // Auth responses
    'auth.login.success': 'Uspešno prijavljen!',
    'auth.signup.success': 'Nalog kreiran! Proveri email za potvrdu.',
    'auth.forgot.success': 'Link za reset je poslat na tvoj email.',
    'auth.logout.success': 'Uspešno odjavljen.',
    'auth.err.invalid': 'Pogrešan email ili lozinka.',
    'auth.err.exists': 'Nalog sa ovim emailom već postoji.',
    'auth.err.generic': 'Došlo je do greške. Pokušaj ponovo.',
    'auth.err.email.confirm': 'Ovaj email već postoji ali nije potvrđen. Proveri inbox.',
    'auth.err.rate_limit': 'Previše pokušaja. Sačekaj nekoliko minuta pa pokušaj ponovo.',
    'auth.err.email_invalid': 'Email adresa nije prihvaćena. Pokušaj sa drugom adresom.',
  },
  en: {
    'meta.title': 'Kickot — Bot for Kick Platform',
    'meta.desc': 'Kickot is a powerful chat bot for the Kick platform. Commands, moderation, watchtime, leaderboard and mini-games.',
    'nav.back': 'KickAll',
    'nav.login': 'Log in',
    'nav.signup': 'Sign up',
    'nav.dashboard': 'Dashboard',
    'nav.settings': 'Settings',
    'nav.logout': 'Log out',
    'hero.live': 'Active · In Production',
    'hero.title': 'The Kick Bot That Works While You Stream',
    'hero.subtitle': 'A powerful chat bot for the Kick platform with custom commands, automatic moderation, watchtime system, mini-games and leaderboard. In both Serbian and English.',
    'hero.cta.primary': 'Get started free',
    'hero.cta.secondary': 'See features',
    'hero.note': 'Free plan available. No credit card required.',
    'features.label': 'Features',
    'features.title': 'Everything a Kick Bot Needs',
    'features.subtitle': 'Kickot comes with a rich set of features you can use immediately, with no configuration.',
    'feat.cmd.title': 'Custom Commands',
    'feat.cmd.desc': 'Define your own commands with responses, variables and cooldowns. The command system works in real time.',
    'feat.mod.title': 'Automatic Moderation',
    'feat.mod.desc': 'Anti-spam, word filter, timeout and ban system. The bot watches chat while you enjoy streaming.',
    'feat.wt.title': 'Watchtime & Leaderboard',
    'feat.wt.desc': 'Automatic watchtime tracking for every viewer. Ranks, top lists and rewards for loyal fans.',
    'feat.games.title': 'Chat Mini-games',
    'feat.games.desc': '!duel, !8ball, !love, !marry, !roll — games that keep chat active and fun throughout the stream.',
    'feat.lang.title': 'Serbian & English',
    'feat.lang.desc': 'The bot responds in Serbian or English depending on channel settings.',
    'feat.stats.title': 'Live Statistics',
    'feat.stats.desc': 'Dashboard with all channel stats, active users, top commands and chat activity.',
    'cmds.label': 'Commands',
    'cmds.title': 'Rich Command Library',
    'cmds.subtitle': 'Click a command to see how it looks in chat.',
    'cmd.rank': 'Your rank and watchtime',
    'cmd.top': 'Top 10 viewers',
    'cmd.love': 'Compatibility with someone',
    'cmd.brak': 'Marry someone',
    'cmd.duel': 'Challenge someone to a duel',
    'cmd.8ball': 'Ask fate a question',
    'cmd.roll': 'Roll a dice',
    'cmd.uptime': 'How long the stream has been live',
    'cmd.preview': '// Preview — live chat simulation',
    'pricing.label': 'Pricing',
    'pricing.title': 'Fair Prices for a Real Tool',
    'pricing.subtitle': 'Start free. Upgrade when you\'re ready.',
    'pricing.forever': 'Forever free',
    'pricing.per.month': '/month',
    'pricing.popular': 'Most Popular',
    'pricing.free.desc': 'Everything you need to get started.',
    'pricing.pro.desc': 'For serious streamers.',
    'pricing.biz.desc': 'For multiple channels and organizations.',
    'pf.f1': 'Bot always active',
    'pf.f2': 'Up to 10 commands',
    'pf.f3': 'Watchtime tracking',
    'pf.f4': 'Basic moderation',
    'pf.f5': 'Advanced moderation',
    'pf.f6': 'Priority support',
    'pp.f1': 'Unlimited commands',
    'pp.f2': 'Advanced moderation',
    'pp.f3': 'All mini-games',
    'pp.f4': 'Analytics dashboard',
    'pp.f5': 'Custom prefix',
    'pp.f6': 'Priority support',
    'pb.f1': 'Everything in Pro',
    'pb.f2': 'Up to 5 Kick channels',
    'pb.f3': 'API access',
    'pb.f4': 'Custom branding',
    'pb.f5': 'Webhooks integration',
    'pb.f6': 'Dedicated support',
    'pricing.cta.free': 'Get started free',
    'pricing.cta.pro': 'Get Pro plan',
    'pricing.cta.biz': 'Get Business',
    'cta.title': 'Ready to Upgrade Your Chat?',
    'cta.desc': 'Sign up and connect Kickot to your Kick channel. In less than 5 minutes.',
    'cta.primary': 'Get started free',
    'cta.login': 'Log in',
    'footer.desc': 'Powerful chat bot for the Kick platform. Part of the KickAll ecosystem.',
    'footer.product': 'Product',
    'footer.features': 'Features',
    'footer.commands': 'Commands',
    'footer.pricing': 'Pricing',
    'footer.ecosystem': 'Ecosystem',
    'footer.copy': '© 2026 KickAll / Kickot. All rights reserved.',
    'footer.privacy': 'Privacy',
    'footer.terms': 'Terms',
    'modal.tagline': 'Bot for Kick Platform',
    'tab.login': 'Login',
    'tab.signup': 'Register',
    'form.email': 'Email address',
    'form.password': 'Password',
    'form.name': 'Name / Nickname',
    'form.name.ph': 'Your name',
    'form.pw.ph': 'Min. 8 characters',
    'form.pw.hint': 'Minimum 8 characters',
    'form.forgot': 'Forgot password?',
    'form.login.submit': 'Log in',
    'form.signup.submit': 'Create Account',
    'form.register.link': 'Register',
    'form.login.link': 'Log in',
    'form.have.account': 'Already have an account?',
    'form.terms.note': 'By registering you agree to our Terms of Service and Privacy Policy.',
    'forgot.desc': 'Enter your email address and we\'ll send you a password reset link.',
    'forgot.submit': 'Send reset link',
    'forgot.back': '← Back to login',
    // Validation
    'err.email.required': 'Email address is required',
    'err.email.invalid': 'Please enter a valid email address',
    'err.pw.required': 'Password is required',
    'err.pw.short': 'Password must be at least 8 characters',
    'err.name.required': 'Name is required',
    // Auth responses
    'auth.login.success': 'Successfully logged in!',
    'auth.signup.success': 'Account created! Check your email for confirmation.',
    'auth.forgot.success': 'Reset link sent to your email.',
    'auth.logout.success': 'Successfully logged out.',
    'auth.err.invalid': 'Invalid email or password.',
    'auth.err.exists': 'An account with this email already exists.',
    'auth.err.generic': 'An error occurred. Please try again.',
    'auth.err.email.confirm': 'This email exists but is not confirmed. Check your inbox.',
    'auth.err.rate_limit': 'Too many attempts. Please wait a few minutes and try again.',
    'auth.err.email_invalid': 'Email address was not accepted. Please try a different address.',
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

  // Ako je korisnik ulogovan, prilagodi i hero dugme jeziku
  const heroPrimaryBtn = document.getElementById('heroPrimaryBtn');
  const heroPrimaryBtnText = document.getElementById('heroPrimaryBtnText');
  if (heroPrimaryBtn && heroPrimaryBtnText && currentUser) {
    heroPrimaryBtnText.textContent = lang === 'sr' ? 'Idi na Dashboard' : 'Go to Dashboard';
  }

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
(function () {
  const canvas = document.getElementById('particlesCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const particles = [];
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize, { passive: true });
  const colors = ['#8B5CF6', '#6366F1', '#53FC18', '#A78BFA'];
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
  'top-watchtime': () => `<div class="cp-line"><span class="cp-user">milan_fan:</span> <span class="cp-msg">!top watchtime</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:var(--color-green)">👑 Top gledaoci: 1. VIP_stefan (48h) 2. chat_queen (36h) 3. milan_fan (24h) 4. gamer_marko (18h) 5. novak99 (15h)</span></div>`,
  'top-chat': () => `<div class="cp-line"><span class="cp-user">novak99:</span> <span class="cp-msg">!top chat 3</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#FBBF24">💬 Najaktivniji u četu: 1. chat_queen (1.450 poruka) 2. milan_fan (982 poruke) 3. VIP_stefan (820 poruka)</span></div>`,
  'watchtime': () => `<div class="cp-line"><span class="cp-user">milan_fan:</span> <span class="cp-msg">!watchtime</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#60A5FA">⏱️ milan_fan, tvoj watchtime je: 24 sata i 35 minuta!</span></div>`,
  'chat': () => `<div class="cp-line"><span class="cp-user">milan_fan:</span> <span class="cp-msg">!chat</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#A78BFA">✉️ milan_fan, poslao si ukupno 982 poruke u ovom četu!</span></div>`,
  'me': () => `<div class="cp-line"><span class="cp-user">milan_fan:</span> <span class="cp-msg">!me</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:var(--color-green)">📊 Korisnik: milan_fan | Sati: 24.5h | Poruke: 982 | Rang: #3 | Uloga: VIP</span></div>`,

  // Zabava i interakcija
  'iq': () => `<div class="cp-line"><span class="cp-user">novak99:</span> <span class="cp-msg">!iq @milan_fan</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#A78BFA">🧠 Skeniram mozak korisnika @milan_fan... Rezultat: IQ je 142! Genijalac! 💡</span></div>`,
  'samar': () => `<div class="cp-line"><span class="cp-user">novak99:</span> <span class="cp-msg">!samar @milan_fan</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#F87171">💥 novak99 je opalio šamarčinu korisniku @milan_fan sa mokrom haringom! 🐟</span></div>`,
  'duel': () => `<div class="cp-line"><span class="cp-user">novak99:</span> <span class="cp-msg">!duel @milan_fan</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#F87171">⚔️ Duel: @novak99 vs @milan_fan! Pucnjava počinje... @milan_fan je izvukao brži revolver i pobedio sa 12 HP preostalo! 🏆</span></div>`,
  'roll': () => `<div class="cp-line"><span class="cp-user">novak99:</span> <span class="cp-msg">!roll @milan_fan</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:var(--color-green)">🎲 Bacam kockicu za @milan_fan... Rezultat: 78! (0-100)</span></div>`,

  // Informacije i alati
  'vreme': () => `<div class="cp-line"><span class="cp-user">chat_fan:</span> <span class="cp-msg">!vreme Beograd</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#60A5FA">⛅ Vreme u Beogradu: 24°C | Vetar: 12 km/h | Vlažnost: 65% | Delimično oblačno.</span></div>`,
  'info': () => `<div class="cp-line"><span class="cp-user">chat_fan:</span> <span class="cp-msg">!info</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#60A5FA">🤖 Kickot Chat Bot v2.4 | Pomažem u moderaciji, zabavi i statistici tvog kanala.</span></div>`,
  'cinjenica': () => `<div class="cp-line"><span class="cp-user">chat_fan:</span> <span class="cp-msg">!cinjenica</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#FBBF24">💡 Činjenica: Prvi kompjuterski bag bila je stvarna buba (moljac) zaglavljena u releju 1947. godine!</span></div>`,
  'followage': () => `<div class="cp-line"><span class="cp-user">milan_fan:</span> <span class="cp-msg">!followage</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#F472B6">💖 milan_fan prati ovaj kanal već 8 meseci, 12 dana i 4 sata!</span></div>`,
  'uptime': () => `<div class="cp-line"><span class="cp-user">new_viewer:</span> <span class="cp-msg">!uptime</span></div><div class="cp-line bot-reply"><span class="cp-bot">kickot</span> <span class="cp-msg" style="color:#60A5FA">⏱️ Stream traje: 2 sata, 47 minuta i 32 sekunde!</span></div>`,
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

// ── Auth Helper Functions ──────────────────────────────────
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function clearAllErrors() {
  document.querySelectorAll('.field-error').forEach(el => {
    el.textContent = '';
    el.classList.remove('visible');
  });
  document.querySelectorAll('.form-input').forEach(el => {
    el.classList.remove('error');
  });
  document.querySelectorAll('.form-alert').forEach(el => {
    el.textContent = '';
    el.style.display = 'none';
  });
}

function showFieldError(id, msg) {
  const errEl = document.getElementById(id);
  if (errEl) {
    errEl.textContent = msg;
    errEl.classList.add('visible');
  }
  const inputId = id.replace('Err', '');
  const inputEl = document.getElementById(inputId);
  if (inputEl) {
    inputEl.classList.add('error');
  }
}

function showFormAlert(id, msg, type = 'error') {
  const alertEl = document.getElementById(id);
  if (alertEl) {
    alertEl.textContent = msg;
    alertEl.style.display = 'block';
    if (type === 'success') {
      alertEl.classList.remove('form-alert-error');
      alertEl.classList.add('form-alert-success');
    } else {
      alertEl.classList.remove('form-alert-success');
      alertEl.classList.add('form-alert-error');
    }
  }
}

function setLoading(type, loading) {
  const btnId = type.endsWith('Btn') ? type : `${type}Btn`;
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  const spinner = btn.querySelector('.auth-spinner');
  if (spinner) {
    spinner.style.display = loading ? 'inline-block' : 'none';
  }
}

// ── Modal ─────────────────────────────────────────────────
// ── Modal ─────────────────────────────────────────────────
let currentTab = 'login';

function openModal(tab = 'login') {
  const modal = document.getElementById('authModal');
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    switchTab('login');
  }
}

function closeModal() {
  const modal = document.getElementById('authModal');
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
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
  const kickForm = document.getElementById('kickLoginForm');
  if (kickForm) kickForm.style.display = 'none';
  const authTabs = document.getElementById('authTabs');
  if (authTabs) authTabs.style.display = 'flex';
  clearAllErrors();
}

let kickLoginUsername = '';
let kickLoginVerificationCode = '';
let kickLoginEmail = '';

// Pomoćne funkcije za PKCE (Code Challenge / Verifier)
function generateRandomString(length) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let text = '';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
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

async function generateCodeChallenge(v) {
  const hashed = await sha256(v);
  return base64urlencode(hashed);
}

function getKickRedirectUri() {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `${window.location.origin}/auth/kick/callback/`;
  }
  return `${window.location.origin}/auth/kick/callback`;
}

async function openKickLogin() {
  const KICK_CLIENT_ID = '01KXN4YW8GF6DPXSC1JMMJ25QN';
  const KICK_REDIRECT_URI = getKickRedirectUri();
  const KICK_SCOPE = 'user:read';

  const state = generateRandomString(16);
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  localStorage.setItem('kick_oauth_state', state);
  localStorage.setItem('kick_code_verifier', codeVerifier);

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

function cancelKickLogin() {
  const loginForm = document.getElementById('loginForm');
  const kickForm = document.getElementById('kickLoginForm');
  const authTabs = document.getElementById('authTabs');
  if (loginForm) loginForm.style.display = 'flex';
  if (kickForm) kickForm.style.display = 'none';
  if (authTabs) authTabs.style.display = 'flex';
  clearAllErrors();
}

function generateVerificationCode() {
  const num = Math.floor(100000 + Math.random() * 900000);
  return `kickot-${num}`;
}

function showKickLoginStep(step, data = {}) {
  const contentEl = document.getElementById('kickLoginContent');
  if (!contentEl) return;

  if (step === 'input') {
    contentEl.innerHTML = `
      <div class="form-alert form-alert-error" id="kickLoginError"></div>
      <div class="form-group" style="margin-bottom: 16px;">
          <label class="form-label" for="kickUsername">Kick korisničko ime</label>
          <input type="text" id="kickUsername" class="form-input" placeholder="npr. milan-567" style="width: 100%;" value="${kickLoginUsername}" />
          <span class="field-error" id="kickUsernameErr"></span>
      </div>
      <button class="auth-submit" id="kickLoginNextBtn" onclick="handleKickLoginNext()" style="background: #53fc18; color: #000; border: none; padding: 12px; border-radius: 8px; font-weight: 700; font-family: 'Space Grotesk', sans-serif; cursor: pointer; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <span class="auth-spinner" id="kickLoginNextSpinner" style="display: none;"></span>
          <span class="btn-text">Nastavi</span>
      </button>
      <div style="text-align: center; margin-top: 16px;">
          <a href="#" onclick="cancelKickLogin()" style="font-size: 0.85rem; color: var(--color-violet); text-decoration: none;">Nazad na standardnu prijavu</a>
      </div>
    `;
    bindEnterKey('kickUsername', 'kickLoginNextBtn');
  } else if (step === 'login') {
    contentEl.innerHTML = `
      <div class="form-alert form-alert-error" id="kickLoginError"></div>
      <div style="font-size: 0.9rem; line-height: 1.4; color: var(--color-text-muted); margin-bottom: 12px; font-family: 'Space Grotesk', sans-serif;">
          Kanal @<strong>${kickLoginUsername}</strong> je već registrovan. Unesi lozinku da se prijaviš:
      </div>
      <div class="form-group" style="margin-bottom: 16px;">
          <label class="form-label" for="kickPassword">Lozinka</label>
          <input type="password" id="kickPassword" class="form-input" placeholder="••••••••" style="width: 100%;" />
          <span class="field-error" id="kickPasswordErr"></span>
      </div>
      <button class="auth-submit" id="kickLoginSubmitBtn" onclick="handleKickLoginSubmit()" style="background: #53fc18; color: #000; border: none; padding: 12px; border-radius: 8px; font-weight: 700; font-family: 'Space Grotesk', sans-serif; cursor: pointer; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <span class="auth-spinner" id="kickLoginSubmitSpinner" style="display: none;"></span>
          <span class="btn-text">Prijavi se</span>
      </button>
      <div style="text-align: center; margin-top: 16px;">
          <a href="#" onclick="showKickLoginStep('input')" style="font-size: 0.85rem; color: var(--color-violet); text-decoration: none;">Nazad</a>
      </div>
    `;
    bindEnterKey('kickPassword', 'kickLoginSubmitBtn');
  } else if (step === 'register') {
    contentEl.innerHTML = `
      <div class="form-alert form-alert-error" id="kickLoginError"></div>
      <div style="font-size: 0.9rem; line-height: 1.4; color: var(--color-text-muted); margin-bottom: 12px; font-family: 'Space Grotesk', sans-serif;">
          Da kreiraš nalog za @<strong>${kickLoginUsername}</strong> i potvrdiš vlasništvo, kopiraj i stavi ovaj kod u svoj Kick opis (Bio/About):
      </div>
      <div style="background: rgba(83,252,24,0.1); border: 1px dashed #53fc18; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 1.1rem; font-weight: 700; color: #53fc18; text-align: center; margin-bottom: 16px; letter-spacing: 1px;">
          ${kickLoginVerificationCode}
      </div>
      <div class="form-group" style="margin-bottom: 16px;">
          <label class="form-label" for="kickPassword">Izaberi lozinku za nalog (min. 8 karaktera)</label>
          <input type="password" id="kickPassword" class="form-input" placeholder="••••••••" style="width: 100%;" />
          <span class="field-error" id="kickPasswordErr"></span>
      </div>
      <button class="auth-submit" id="kickRegisterSubmitBtn" onclick="handleKickRegisterSubmit()" style="background: #53fc18; color: #000; border: none; padding: 12px; border-radius: 8px; font-weight: 700; font-family: 'Space Grotesk', sans-serif; cursor: pointer; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <span class="auth-spinner" id="kickRegisterSubmitSpinner" style="display: none;"></span>
          <span class="btn-text">Verifikuj i registruj se</span>
      </button>
      <div style="text-align: center; margin-top: 16px;">
          <a href="#" onclick="showKickLoginStep('input')" style="font-size: 0.85rem; color: var(--color-violet); text-decoration: none;">Nazad</a>
      </div>
    `;
    bindEnterKey('kickPassword', 'kickRegisterSubmitBtn');
  }
}

async function handleKickLoginNext() {
  clearAllErrors();
  const usernameInput = document.getElementById('kickUsername');
  const username = usernameInput ? usernameInput.value.trim() : '';

  if (!username) {
    showFieldError('kickUsernameErr', 'Korisničko ime je obavezno.');
    return;
  }

  const cleanUsername = username.replace(/^@/, '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(cleanUsername)) {
    showFieldError('kickUsernameErr', 'Nevalidno korisničko ime.');
    return;
  }

  kickLoginUsername = cleanUsername;
  setLoading('kickLoginNext', true);

  try {
    let ownerProfile = null;

    // 1. Direktna REST pretraga po kick_channels JSONB sadržaju (username field)
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/user_profiles?select=id,display_name,email&kick_channels=cs.${encodeURIComponent(JSON.stringify([{ username: cleanUsername }]))}`,
        { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
      );
      if (res.ok) {
        const rows = await res.json();
        if (rows && rows.length > 0) ownerProfile = rows[0];
      }
    } catch (_) { }

    // 2. RPC pretraga (ako je REST fallback bio neuspešan)
    if (!ownerProfile) {
      try {
        const { data: byRpc } = await sb.rpc('find_profile_by_kick_username', { kick_user: cleanUsername });
        if (byRpc && byRpc.length > 0) ownerProfile = byRpc[0];
      } catch (_) { }
    }

    // 3. Pokušaj po chatroom_id sa Kick API-ja
    if (!ownerProfile) {
      try {
        const channelData = await fetchKickChannelData(cleanUsername);
        if (channelData && channelData.chatroom_id) {
          const channelId = channelData.chatroom_id.toString();
          const { data: byId } = await sb.rpc('find_profile_by_kick_channel_id', { channel_id: channelId });
          if (byId && byId.length > 0) ownerProfile = byId[0];
        }
      } catch (_) { }
    }

    // 4. Poslednji fallback — po display_name (hvatamo slučaj kada je display_name = kick username)
    if (!ownerProfile) {
      const { data: byDisplayName } = await sb.from('user_profiles')
        .select('id, display_name, email')
        .ilike('display_name', cleanUsername)
        .maybeSingle();
      if (byDisplayName) ownerProfile = byDisplayName;
    }

    if (ownerProfile) {
      // Nalog postoji — samo traži lozinku
      kickLoginUsername = ownerProfile.display_name;
      kickLoginEmail = ownerProfile.email || `kick_user_${ownerProfile.display_name.toLowerCase()}@kickot.com`;
      showKickLoginStep('login');
    } else {
      // Novi korisnik — ide na registraciju sa bio verifikacijom
      kickLoginUsername = cleanUsername;
      kickLoginEmail = `kick_user_${cleanUsername.toLowerCase()}@kickot.com`;
      kickLoginVerificationCode = generateVerificationCode();
      showKickLoginStep('register');
    }
  } catch (err) {
    showFormAlert('kickLoginError', 'Greška pri proveri naloga.');
    console.error(err);
  } finally {
    setLoading('kickLoginNext', false);
  }
}


async function handleKickLoginSubmit() {
  clearAllErrors();
  const pwInput = document.getElementById('kickPassword');
  const password = pwInput ? pwInput.value : '';

  if (!password) {
    showFieldError('kickPasswordErr', 'Lozinka je obavezna.');
    return;
  }

  setLoading('kickLoginSubmit', true);

  const email = kickLoginEmail || `kick_user_${kickLoginUsername.toLowerCase()}@kickot.com`;

  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      showFormAlert('kickLoginError', 'Netačna lozinka za ovaj nalog.');
    } else {
      // ── Posle uspešne prijave, automatski dodaj vlasništvo nad kanalnom ──
      try {
        const user = data.user;
        // Dohvati profil da proverimo kick_channels
        const { data: profile } = await sb.from('user_profiles')
          .select('kick_channels')
          .eq('id', user.id)
          .maybeSingle();

        const existingChannels = (profile && profile.kick_channels) ? profile.kick_channels : [];
        const usernameLC = kickLoginUsername.toLowerCase();

        // Proveri da li kanal već postoji u listi
        const alreadyAdded = existingChannels.some(
          ch => (ch.username || '').toLowerCase() === usernameLC
        );

        if (!alreadyAdded) {
          // Dohvati podatke kanala sa Kick API-ja
          const channelData = await fetchKickChannelData(kickLoginUsername);
          const channelId = channelData.chatroom_id
            ? channelData.chatroom_id.toString()
            : `kick_${usernameLC}`;

          const updatedChannels = [
            ...existingChannels,
            {
              id: channelId,
              username: channelData.slug || kickLoginUsername,
              avatar: channelData.avatar || null,
              is_primary: existingChannels.length === 0
            }
          ];

          await sb.from('user_profiles')
            .update({
              kick_channels: updatedChannels,
              updated_at: new Date().toISOString()
            })
            .eq('id', user.id);
        }
      } catch (chanErr) {
        console.warn('Nije moguće automatski dodati kanal:', chanErr);
      }

      showToast('success', `Uspešna prijava kao @${kickLoginUsername}!`, '💚');
      closeModal();
      onUserChange(data.user);
      setTimeout(() => {
        const fromKickAll = sessionStorage.getItem('from_kickall') === 'true';
        window.location.href = fromKickAll ? '../dashboard.html' : 'dashboard.html';
      }, 800);
    }
  } catch (err) {
    showFormAlert('kickLoginError', 'Greška pri prijavi.');
  } finally {
    setLoading('kickLoginSubmit', false);
  }
}

async function fetchKickChannelData(username) {
  // 1. Pokušaj preko lokalnog bot API servera
  try {
    const localRes = await fetch(`https://kickbot-ihzb.onrender.com/api/avatar?username=${username}`);
    if (localRes.ok) {
      const d = await localRes.json();
      if (d && d.bio !== undefined) {
        return { bio: d.bio || '', chatroom_id: d.chatroom_id || null, slug: d.slug || username, avatar: d.avatar || null };
      }
    }
  } catch (_) { }

  const apiUrl = `https://kick.com/api/v2/channels/${username}`;
  const proxies = [
    {
      url: `https://api.allorigins.win/get?url=${encodeURIComponent(apiUrl)}`,
      parse: async (res) => {
        const json = await res.json();
        const data = json.contents ? JSON.parse(json.contents) : null;
        return data ? {
          bio: data.user?.bio || '',
          chatroom_id: data.chatroom?.id || null,
          slug: data.slug || username,
          avatar: data.user?.profile_pic || null
        } : null;
      }
    },
    {
      url: `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`,
      parse: async (res) => {
        const data = await res.json();
        return data ? {
          bio: data.user?.bio || '',
          chatroom_id: data.chatroom?.id || null,
          slug: data.slug || username,
          avatar: data.user?.profile_pic || null
        } : null;
      }
    }
  ];

  return new Promise((resolve) => {
    let completed = 0;
    let resolved = false;

    proxies.forEach(proxy => {
      fetch(proxy.url)
        .then(async (res) => {
          if (res.ok && !resolved) {
            const result = await proxy.parse(res);
            if (result && !resolved) {
              resolved = true;
              resolve(result);
            }
          }
        })
        .catch(() => { })
        .finally(() => {
          completed++;
          if (completed === proxies.length && !resolved) {
            resolve({ bio: '', chatroom_id: null, slug: username, avatar: null });
          }
        });
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ bio: '', chatroom_id: null, slug: username, avatar: null });
      }
    }, 6000);
  });
}

// Legacy wrapper — vraća samo bio string
async function fetchKickBio(username) {
  const data = await fetchKickChannelData(username);
  return data.bio || '';
}

async function handleKickRegisterSubmit() {
  clearAllErrors();
  const pwInput = document.getElementById('kickPassword');
  const password = pwInput ? pwInput.value : '';

  if (!password) {
    showFieldError('kickPasswordErr', 'Lozinka je obavezna.');
    return;
  }
  if (password.length < 8) {
    showFieldError('kickPasswordErr', 'Lozinka mora imati bar 8 karaktera.');
    return;
  }

  setLoading('kickRegisterSubmit', true);

  try {
    // Dohvati sve podatke kanala uključujući bio za verifikaciju i chatroom_id
    const channelData = await fetchKickChannelData(kickLoginUsername);
    const hasCode = channelData.bio.toLowerCase().includes(kickLoginVerificationCode.toLowerCase());

    if (!hasCode) {
      showFormAlert('kickLoginError', 'Verifikacioni kod nije pronađen u tvom Kick opisu (Bio/About). Stavi kod i pokušaj ponovo.');
      setLoading('kickRegisterSubmit', false);
      return;
    }

    const email = `kick_user_${kickLoginUsername.toLowerCase()}@kickot.com`;
    const { data: signUpData, error: signUpError } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: kickLoginUsername }
      }
    });

    if (signUpError) {
      showFormAlert('kickLoginError', signUpError.message);
      setLoading('kickRegisterSubmit', false);
      return;
    }

    const user = signUpData.user;
    if (user) {
      // Koristi pravi chatroom_id sa Kick API-ja
      const channelId = channelData.chatroom_id
        ? channelData.chatroom_id.toString()
        : Math.floor(1000000 + Math.random() * 9000000).toString();

      const { error: insertError } = await sb.from('user_profiles').insert({
        id: user.id,
        display_name: kickLoginUsername,
        email: email,
        plan: 'free',
        kick_channels: [
          {
            id: channelId,
            username: channelData.slug || kickLoginUsername,
            avatar: channelData.avatar || null,
            is_primary: true
          }
        ],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      if (insertError) {
        console.error('Greška pri kreiranju profila:', insertError);
      }

      showToast('success', `Uspešna registracija i prijava za @${kickLoginUsername}!`, '🎉');
      closeModal();
      onUserChange(user);
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 800);
    }
  } catch (err) {
    showFormAlert('kickLoginError', 'Greška tokom registracije.');
    console.error(err);
  } finally {
    setLoading('kickRegisterSubmit', false);
  }
}

// ── Auth Error Mapper ─────────────────────────────────────
function mapAuthError(error) {
  const code = (error.code || '').toLowerCase();
  const msg = (error.message || '').toLowerCase();

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
  const inputVal = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  let valid = true;

  if (!inputVal) {
    showFieldError('loginEmailErr', t('err.email.required'));
    valid = false;
  } else if (inputVal.includes('@')) {
    if (!validateEmail(inputVal)) {
      showFieldError('loginEmailErr', t('err.email.invalid'));
      valid = false;
    }
  } else {
    // Ako je korisničko ime (nema @), proveri format
    const cleanUser = inputVal.replace(/^@/, '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(cleanUser)) {
      showFieldError('loginEmailErr', 'Nevalidno korisničko ime.');
      valid = false;
    }
  }

  if (!password) { showFieldError('loginPasswordErr', t('err.pw.required')); valid = false; }
  if (!valid) return;

  // Ako sadrži @ koristi kao email, inače pretvori u sistemski email
  const email = inputVal.includes('@')
    ? inputVal
    : `kick_user_${inputVal.replace(/^@/, '').trim().toLowerCase()}@kickot.com`;

  setLoading('login', true);
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      showFormAlert('loginError', mapAuthError(error));
    } else {
      showToast('success', t('auth.login.success'), '👋');
      closeModal();
      onUserChange(data.user);
      setTimeout(() => {
        const fromKickAll = sessionStorage.getItem('from_kickall') === 'true';
        window.location.href = fromKickAll ? '../dashboard.html' : 'dashboard.html';
      }, 800);
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
    const { data: signUpData, error: signUpError } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name }
      }
    });

    if (signUpError) {
      showFormAlert('signupError', mapAuthError(signUpError));
      return;
    }

    const user = signUpData.user;

    // Proveri da li profil već postoji u user_profiles
    const { data: existingProfile } = await sb.from('user_profiles').select('id').eq('id', user.id).maybeSingle();

    if (!existingProfile) {
      await sb.from('user_profiles').insert({
        id: user.id,
        display_name: name,
        email: email,
        plan: 'free',
        kick_channels: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    if (user && !signUpData.session) {
      showFormAlert('signupSuccess', t('auth.signup.success'), 'success');
    } else if (signUpData.session) {
      showToast('success', t('auth.signup.success'), '🎉');
      closeModal();
      onUserChange(user);
      setTimeout(() => {
        const fromKickAll = sessionStorage.getItem('from_kickall') === 'true';
        window.location.href = fromKickAll ? '../dashboard.html' : 'dashboard.html';
      }, 800);
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

function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = show
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}

// ── Sign Out ───────────────────────────────────────────────
async function handleSignOut() {
  await sb.auth.signOut();
  showToast('info', t('auth.logout.success'), '👋');
  onUserChange(null);
  
  // Global logout - notify other domains
  notifyGlobalLogout();
}

function notifyGlobalLogout() {
  const domains = [
    'https://kickall.netlify.app',
    'https://kickall.milanwebportal.com',
    'http://localhost:5500'
  ];
  
  domains.forEach(domain => {
    // Try to send message to iframe or window if exists
    try {
      const iframe = document.querySelector(`iframe[src*="${domain}"]`);
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'GLOBAL_LOGOUT' }, domain);
      }
    } catch (e) {
      // Ignore cross-origin errors
    }
  });
  
  // Also set a flag in localStorage that other domains can check
  localStorage.setItem('kickbot_global_logout', Date.now().toString());
  
  // Notify bot server for global logout
  const { data: { session } } = sb.auth.getSession();
  if (session?.user?.id) {
    fetch('https://kickbot-ihzb.onrender.com/api/global-logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: session.user.id })
    }).catch(() => {});
  }
}

// Listen for global logout from other domains
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GLOBAL_LOGOUT') {
    sb.auth.signOut().then(() => {
      window.location.reload();
    });
  }
});

// Check for global logout flag on load
setInterval(() => {
  const logoutTime = localStorage.getItem('kickbot_global_logout');
  if (logoutTime && Date.now() - parseInt(logoutTime) < 5000) {
    // Logout happened recently on another domain
    const { data: { session } } = sb.auth.getSession();
    if (session) {
      sb.auth.signOut().then(() => {
        window.location.reload();
      });
    }
    localStorage.removeItem('kickbot_global_logout');
  }
}, 1000);

// Check server-side logout status on page load
async function checkServerLogoutStatus() {
  const { data: { session } } = sb.auth.getSession();
  if (session?.user?.id) {
    try {
      const res = await fetch(`https://kickbot-ihzb.onrender.com/api/check-logout?userId=${session.user.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.shouldLogout) {
          await sb.auth.signOut();
          window.location.reload();
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }
}

checkServerLogoutStatus();

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

    // Dynamic hero button update
    const heroPrimaryBtn = document.getElementById('heroPrimaryBtn');
    const heroPrimaryBtnText = document.getElementById('heroPrimaryBtnText');
    if (heroPrimaryBtn && heroPrimaryBtnText) {
      heroPrimaryBtn.onclick = () => { window.location.href = 'dashboard.html'; };
      heroPrimaryBtnText.textContent = currentLang === 'sr' ? 'Idi na Dashboard' : 'Go to Dashboard';
      heroPrimaryBtnText.removeAttribute('data-i18n');
    }
  } else {
    guestNav.style.display = 'flex';
    userMenu.classList.remove('visible');

    // Reset hero button update
    const heroPrimaryBtn = document.getElementById('heroPrimaryBtn');
    const heroPrimaryBtnText = document.getElementById('heroPrimaryBtnText');
    if (heroPrimaryBtn && heroPrimaryBtnText) {
      heroPrimaryBtn.onclick = () => { openModal('login'); };
      heroPrimaryBtnText.setAttribute('data-i18n', 'hero.cta.primary');
      heroPrimaryBtnText.textContent = currentLang === 'sr' ? 'Počni besplatno' : 'Get started free';
    }
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

// ── Kick Channel Management & OAuth Add-Channel Flow ──────
let currentChannels = [];

function switchSettingsTab(tabName) {
  const tabProfile = document.getElementById('setTabProfile');
  const tabChannels = document.getElementById('setTabChannels');
  const panelProfile = document.getElementById('settingsProfilePanel');
  const panelChannels = document.getElementById('settingsChannelsPanel');

  if (!tabProfile || !tabChannels || !panelProfile || !panelChannels) return;

  tabProfile.classList.remove('active');
  tabChannels.classList.remove('active');

  panelProfile.style.display = 'none';
  panelChannels.style.display = 'none';

  if (tabName === 'profile') {
    tabProfile.classList.add('active');
    panelProfile.style.display = 'block';
  } else if (tabName === 'channels') {
    tabChannels.classList.add('active');
    panelChannels.style.display = 'block';
    cancelAddChannelVerification();
    loadConnectedChannels().then(() => {
      renderSettingsChannelList();
    });
  }
}

async function loadConnectedChannels() {
  if (!currentUser) return;
  try {
    const { data, error } = await sb.from('user_profiles')
      .select('kick_channels')
      .eq('id', currentUser.id)
      .maybeSingle();

    if (data && data.kick_channels) {
      currentChannels = data.kick_channels;
    } else {
      currentChannels = [];
    }
  } catch (e) {
    console.error('Greška pri učitavanju kanala:', e);
  }
}

function renderSettingsChannelList() {
  const listEl = document.getElementById('settingsChannelList');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (currentChannels.length === 0) {
    listEl.innerHTML = '<div style="padding:10px;font-size:0.85rem;color:var(--color-text-muted);text-align:center;">Nema povezanih kanala.</div>';
    return;
  }

  currentChannels.forEach(ch => {
    const item = document.createElement('div');
    item.className = 'modal-channel-item';

    const avatarHtml = ch.avatar
      ? `<div class="modal-channel-avatar" style="background-image:url('${ch.avatar}');background-size:cover;background-position:center;"></div>`
      : `<div class="modal-channel-avatar">${ch.username.charAt(0).toUpperCase()}</div>`;

    const badgeHtml = ch.is_primary
      ? `<span class="modal-ch-badge primary" style="background: rgba(83, 252, 24, 0.1); color: var(--color-green); border: 1px solid rgba(83, 252, 24, 0.2); font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;">Glavni</span>`
      : `<button class="btn btn-secondary btn-sm" onclick="makeChannelPrimary('${ch.id}')" style="padding:3px 8px;font-size:0.75rem;border-radius:4px;cursor:pointer;">Postavi za glavni</button>`;

    item.innerHTML = `
      <div class="modal-channel-info" style="display:flex;align-items:center;gap:8px;">
        ${avatarHtml}
        <div>
          <div class="modal-channel-name" style="font-weight:600;font-size:0.88rem;color:var(--color-text);">${ch.username}</div>
          <div style="font-size:0.7rem;color:var(--color-text-muted)">ID: ${ch.id}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        ${badgeHtml}
        <button class="btn btn-secondary btn-sm" onclick="deleteConnectedChannel('${ch.id}')" style="padding:4px 8px;font-size:0.75rem;border-radius:4px;border-color:rgba(239,68,68,0.2);color:#ef4444;cursor:pointer;" title="Ukloni kanal">✕</button>
      </div>
    `;
    listEl.appendChild(item);
  });
}

async function makeChannelPrimary(channelId) {
  if (!currentUser) return;
  const updatedChannels = currentChannels.map(c => ({
    ...c,
    is_primary: c.id === channelId
  }));

  try {
    const { error } = await sb.from('user_profiles')
      .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
      .eq('id', currentUser.id);

    if (error) throw error;
    currentChannels = updatedChannels;
    renderSettingsChannelList();
    showToast('success', 'Glavni kanal je promenjen.', '✅');
  } catch (err) {
    showToast('error', 'Greška pri promeni glavnog kanala.', '❌');
  }
}

async function deleteConnectedChannel(channelId) {
  if (!currentUser) return;
  if (!confirm('Da li ste sigurni da želite da uklonite ovaj kanal?')) return;

  const updatedChannels = currentChannels.filter(c => c.id !== channelId);
  if (currentChannels.find(c => c.id === channelId)?.is_primary && updatedChannels.length > 0) {
    updatedChannels[0].is_primary = true;
  }

  try {
    const { error } = await sb.from('user_profiles')
      .update({ kick_channels: updatedChannels, updated_at: new Date().toISOString() })
      .eq('id', currentUser.id);

    if (error) throw error;
    currentChannels = updatedChannels;
    renderSettingsChannelList();
    showToast('success', 'Kanal je uspešno uklonjen.', '✅');
  } catch (err) {
    showToast('error', 'Greška pri uklanjanju kanala.', '❌');
  }
}

// Pokreće Kick OAuth flow s intent-om za dodavanje kanala
async function openKickLoginForChannel() {
  if (!currentUser) return;
  const KICK_CLIENT_ID = '01KXN4YW8GF6DPXSC1JMMJ25QN';
  const KICK_REDIRECT_URI = getKickRedirectUri();
  const KICK_SCOPE = 'user:read';

  const state = generateRandomString(16);
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Sačuvamo PKCE i intent u sessionStorage
  sessionStorage.setItem('kick_oauth_state', state);
  sessionStorage.setItem('kick_code_verifier', codeVerifier);
  sessionStorage.setItem('kick_oauth_intent', 'add_channel');
  sessionStorage.setItem('kick_add_channel_uid', currentUser.id);

  const authUrl = 'https://id.kick.com/oauth/authorize?' + new URLSearchParams({
    response_type: 'code',
    client_id: KICK_CLIENT_ID,
    redirect_uri: KICK_REDIRECT_URI,
    scope: KICK_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  }).toString();

  window.location.href = authUrl;
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
  reader.onload = function (evt) {
    const img = new Image();
    img.onload = function () {
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
let settingsChannelsPendingOpen = false;
if (window.location.search.includes('settings=channels')) {
  settingsChannelsPendingOpen = true;
}

sb.auth.onAuthStateChange((event, session) => {
  onUserChange(session?.user || null);

  if (session?.user) {
    const fromKickAll = sessionStorage.getItem('from_kickall') === 'true';
    if (fromKickAll) {
      sessionStorage.removeItem('from_kickall');
      window.location.href = '../dashboard.html';
      return;
    }
  }

  // Ako se vraćamo sa add_channel OAuth callbacka — otvori settings na Kick Kanali tabu
  if (settingsChannelsPendingOpen && session?.user) {
    settingsChannelsPendingOpen = false;
    setTimeout(() => {
      openSettingsModal();
      setTimeout(() => switchSettingsTab('channels'), 150);
    }, 400);
  }
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

// ── Enter Key Bindings Helper ─────────────────────────────
function bindEnterKey(inputId, buttonId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const btn = document.getElementById(buttonId);
        if (btn) btn.click();
      }
    });
  }
}

function setupEnterKeyBindings() {
  const bindings = [
    { inputId: 'loginEmail', buttonId: 'loginBtn' },
    { inputId: 'loginPassword', buttonId: 'loginBtn' },
    { inputId: 'signupName', buttonId: 'signupBtn' },
    { inputId: 'signupEmail', buttonId: 'signupBtn' },
    { inputId: 'signupPassword', buttonId: 'signupBtn' },
    { inputId: 'forgotEmail', buttonId: 'forgotBtn' }
  ];

  bindings.forEach(({ inputId, buttonId }) => {
    bindEnterKey(inputId, buttonId);
  });
}

// ── Init ──────────────────────────────────────────────────
setLang(currentLang);
setupEnterKeyBindings();

if (window.location.search.includes('from=kickall')) {
  sessionStorage.setItem('from_kickall', 'true');
} else if (!window.location.search.includes('action=login') && !window.location.search.includes('action=logout')) {
  sessionStorage.removeItem('from_kickall');
}

// Check for password reset redirect
if (window.location.search.includes('reset=true')) {
  openModal('login');
  showToast('info', currentLang === 'sr' ? 'Unesi novu lozinku' : 'Enter your new password', '🔑');
} else if (window.location.search.includes('action=login')) {
  openModal('login');
} else if (window.location.search.includes('action=logout')) {
  sb.auth.signOut().then(() => {
    notifyGlobalLogout();
    window.location.href = '../index.html';
  });
}
