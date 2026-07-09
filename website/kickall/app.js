/* ═══════════════════════════════════════════════════════════
   KickAll — app.js
   Language switcher (SR/EN) + Particles + Animations
   ═══════════════════════════════════════════════════════════ */

// ── Translations ──────────────────────────────────────────
const translations = {
  sr: {
    'meta.title':          'KickAll — Sve što ti treba za Kick',
    'meta.desc':           'KickAll je kompletan ekosistem alata za Kick streamere — bot, analitika, giveaway i overlay na jednom mestu.',
    'nav.cta':             'Počni besplatno',
    'hero.eyebrow':        'Srpski alati • Globalna kvaliteta',
    'hero.title.line1':    'Sve što ti treba',
    'hero.title.line2':    'za Kick',
    'hero.subtitle':       'Jedan ekosistem, pet alata. Bot, analitika, giveaway i overlay — sve napravljeno specijalno za Kick platformu i srpsku streaming zajednicu.',
    'hero.cta.primary':    '🚀 Isprobaj Kickot Bot',
    'hero.cta.secondary':  'Vidi sve alate',
    'hero.stat.products':  'Alata u ekosistemu',
    'hero.stat.live':      'Aktivan produkt',
    'hero.stat.commands':  'Mogućnosti',
    'hvc.kickot':          'Bot za Kick chat — aktivan',
    'hvc.kickan':          'Analitika streamova',
    'hvc.kickaj':          'Giveaway sistem',
    'hvc.kickov':          'Stream overlay alat',
    'badge.soon':          'Uskoro',
    'products.label':      'Naši produkti',
    'products.title':      'Sve što treba jednom Kick streameru',
    'products.subtitle':   'Pet specijalizovanih alata, svaki fokusiran na jedan aspekt Kick iskustva. Beri ono što ti treba.',
    'kickot.tagline':      'Chat Bot',
    'kickot.desc':         'Moćan chat bot za Kick platformu. Komande, moderacija, mini-igre, watchtime, leaderboard i još mnogo toga — sve na srpskom i engleskom.',
    'kickot.f1':           'Prilagođene komande (!rank, !love, !brak...)',
    'kickot.f2':           'Automatska moderacija i anti-spam',
    'kickot.f3':           'Watchtime i leaderboard sistem',
    'kickot.f4':           'Mini-igre za chat',
    'kickot.cta':          'Otvori Kickot →',
    'kickan.tagline':      'Analitika',
    'kickan.desc':         'Dubinska analitika tvojih Kick streamova. Prati rast, engagement, peak viewers, chat aktivnost i sve ostale bitne metrike.',
    'kickan.f1':           'Real-time dashboard metrika',
    'kickan.f2':           'Istorija i trendovi streamova',
    'kickan.f3':           'Analiza chat aktivnosti',
    'kickan.f4':           'Izveštaji i exporti',
    'kickaj.tagline':      'Giveaway',
    'kickaj.desc':         'Sistem za organizovanje nagradnih igara tokom live streama. Pravila, odbrojavanje, automatski odabir pobednika i objava u chatu.',
    'kickaj.f1':           'Automatski odabir pobednika',
    'kickaj.f2':           'Prilagođena pravila i uslovi',
    'kickaj.f3':           'Integracija sa Kickot botom',
    'kickaj.f4':           'Animirani overlay za pobednika',
    'kickov.tagline':      'Overlay',
    'kickov.desc':         'Profesionalni stream overlay alat za Kick. Alerts, chat prikaz, ciljevi, brojač followers-a i potpuno prilagodljiv dizajn.',
    'kickov.f1':           'Followers/subscriber alertovi',
    'kickov.f2':           'Chat overlay na streamu',
    'kickov.f3':           'Prilagodljivi widgeti',
    'kickov.f4':           'Lak import u OBS/Streamlabs',
    'how.label':           'Kako funkcioniše',
    'how.title':           'Tri koraka do savršenog streama',
    'how.subtitle':        'Bez komplikacija, bez coding znanja. Kreiraj nalog, izaberi alate, i počni da streahuješ profesionalnije.',
    'how.step1.title':     'Kreiraj nalog',
    'how.step1.desc':      'Registruj se na KickAll sa svojom email adresom. Jedan nalog za sve produkte u ekosistemu — besplatno za početak.',
    'how.step2.title':     'Izaberi alat',
    'how.step2.desc':      'Povezi svoj Kick kanal, biraj alate koji ti trebaju i podesi ih prema svom stilu. Sve je intuitivno i na srpskom.',
    'how.step3.title':     'Strejmuj bolje',
    'how.step3.desc':      'Uključi stream i uživaj dok KickAll alati rade umesto tebe — moderacija, analitika, giveaway-ji, sve automatski.',
    'pricing.label':       'Cene',
    'pricing.title':       'Poštene cene, pravi alati',
    'pricing.subtitle':    'Počni besplatno i rastuć uz KickAll. Nadogradi se kada budeš spreman — bez obaveza, otkaži kad hoćeš.',
    'pricing.forever':     'Zauvek besplatno',
    'pricing.per.month':   '/mesec',
    'pricing.popular':     'Najpopularniji',
    'pricing.free.desc':   'Sve što treba za početak. Bez kreditne kartice.',
    'pricing.free.f1':     'Kickot bot (osnovno)',
    'pricing.free.f2':     'Do 10 komandi',
    'pricing.free.f3':     'Watchtime tracking',
    'pricing.free.f4':     'Napredna moderacija',
    'pricing.free.f5':     'Analitika (KickAn)',
    'pricing.free.f6':     'Prioritetna podrška',
    'pricing.pro.desc':    'Za ozbiljne streamere koji žele punu kontrolu.',
    'pricing.pro.f1':      'Kickot bot (napredno)',
    'pricing.pro.f2':      'Neograničene komande',
    'pricing.pro.f3':      'Napredna moderacija',
    'pricing.pro.f4':      'KickAn analitika',
    'pricing.pro.f5':      'KickAj giveaway sistem',
    'pricing.pro.f6':      'KickOv overlay (beta)',
    'pricing.biz.desc':    'Za organizacije, agencije i multi-kanal operacije.',
    'pricing.biz.f1':      'Sve iz Pro plana',
    'pricing.biz.f2':      'Do 5 Kick kanala',
    'pricing.biz.f3':      'KickOv overlay (pun pristup)',
    'pricing.biz.f4':      'Prilagođeni branding',
    'pricing.biz.f5':      'API pristup',
    'pricing.biz.f6':      'Dedikovan support',
    'pricing.forever':     'Zauvek besplatno',
    'pricing.cta.free':    'Počni besplatno',
    'pricing.cta.pro':     'Uzmi Pro plan',
    'pricing.cta.biz':     'Uzmi Business',
    'cta.title':           'Spreman da unapređuješ stream?',
    'cta.desc':            'Pridruži se zajednici Kick streamera koji koriste KickAll alate. Počni besplatno danas.',
    'cta.primary':         '🚀 Kreiraj nalog',
    'cta.secondary':       'Vidi alate',
    'footer.desc':         'Ekosistem alata za Kick streamere. Napravljeno sa ❤️ za srpsku streaming zajednicu i svetsko tržište.',
    'footer.products':     'Produkti',
    'footer.company':      'Kompanija',
    'footer.legal':        'Pravno',
    'footer.soon':         'Uskoro',
    'footer.about':        'O nama',
    'footer.pricing':      'Cene',
    'footer.blog':         'Blog',
    'footer.contact':      'Kontakt',
    'footer.privacy':      'Politika privatnosti',
    'footer.terms':        'Uslovi korišćenja',
    'footer.cookies':      'Kolačići',
    'footer.copy':         '© 2026 KickAll. Sva prava zadržana.',
    'footer.discord':      'Discord',
    'footer.twitter':      'Twitter',
  },
  en: {
    'meta.title':          'KickAll — Everything You Need for Kick',
    'meta.desc':           'KickAll is a complete ecosystem of tools for Kick streamers — bot, analytics, giveaway and overlay in one place.',
    'nav.cta':             'Get started free',
    'hero.eyebrow':        'Made for Kick • World-class quality',
    'hero.title.line1':    'Everything You Need',
    'hero.title.line2':    'for Kick',
    'hero.subtitle':       'One ecosystem, five tools. Bot, analytics, giveaway and overlay — all built specifically for the Kick platform and streaming community.',
    'hero.cta.primary':    '🚀 Try Kickot Bot',
    'hero.cta.secondary':  'View all tools',
    'hero.stat.products':  'Tools in ecosystem',
    'hero.stat.live':      'Active product',
    'hero.stat.commands':  'Possibilities',
    'hvc.kickot':          'Kick chat bot — live',
    'hvc.kickan':          'Stream analytics',
    'hvc.kickaj':          'Giveaway system',
    'hvc.kickov':          'Stream overlay tool',
    'badge.soon':          'Coming Soon',
    'products.label':      'Our Products',
    'products.title':      'Everything a Kick Streamer Needs',
    'products.subtitle':   'Five specialized tools, each focused on one aspect of the Kick experience. Pick what you need.',
    'kickot.tagline':      'Chat Bot',
    'kickot.desc':         'A powerful chat bot for the Kick platform. Commands, moderation, mini-games, watchtime, leaderboard and much more — in both Serbian and English.',
    'kickot.f1':           'Custom commands (!rank, !love, !marry...)',
    'kickot.f2':           'Automatic moderation & anti-spam',
    'kickot.f3':           'Watchtime & leaderboard system',
    'kickot.f4':           'Chat mini-games',
    'kickot.cta':          'Open Kickot →',
    'kickan.tagline':      'Analytics',
    'kickan.desc':         'Deep analytics of your Kick streams. Track growth, engagement, peak viewers, chat activity and all other important metrics.',
    'kickan.f1':           'Real-time dashboard metrics',
    'kickan.f2':           'Stream history & trends',
    'kickan.f3':           'Chat activity analysis',
    'kickan.f4':           'Reports & exports',
    'kickaj.tagline':      'Giveaway',
    'kickaj.desc':         'System for organizing giveaways during live streams. Rules, countdown, automatic winner selection and chat announcement.',
    'kickaj.f1':           'Automatic winner selection',
    'kickaj.f2':           'Custom rules & conditions',
    'kickaj.f3':           'Integration with Kickot bot',
    'kickaj.f4':           'Animated winner overlay',
    'kickov.tagline':      'Overlay',
    'kickov.desc':         'Professional stream overlay tool for Kick. Alerts, chat display, goals, follower counter and fully customizable design.',
    'kickov.f1':           'Follower/subscriber alerts',
    'kickov.f2':           'Chat overlay on stream',
    'kickov.f3':           'Customizable widgets',
    'kickov.f4':           'Easy import into OBS/Streamlabs',
    'how.label':           'How it works',
    'how.title':           'Three Steps to the Perfect Stream',
    'how.subtitle':        'No complications, no coding knowledge. Create an account, choose your tools, and start streaming more professionally.',
    'how.step1.title':     'Create Account',
    'how.step1.desc':      'Sign up with your email address. One account for all products in the ecosystem — free to start.',
    'how.step2.title':     'Choose Tools',
    'how.step2.desc':      'Connect your Kick channel, choose the tools you need and configure them to your style. Everything is intuitive.',
    'how.step3.title':     'Stream Better',
    'how.step3.desc':      'Go live and enjoy while KickAll tools work for you — moderation, analytics, giveaways, all automatic.',
    'pricing.label':       'Pricing',
    'pricing.title':       'Fair Prices, Real Tools',
    'pricing.subtitle':    'Start free and grow with KickAll. Upgrade when ready — no commitments, cancel anytime.',
    'pricing.forever':     'Forever free',
    'pricing.per.month':   '/month',
    'pricing.popular':     'Most Popular',
    'pricing.free.desc':   'Everything you need to get started. No credit card required.',
    'pricing.free.f1':     'Kickot bot (basic)',
    'pricing.free.f2':     'Up to 10 commands',
    'pricing.free.f3':     'Watchtime tracking',
    'pricing.free.f4':     'Advanced moderation',
    'pricing.free.f5':     'Analytics (KickAn)',
    'pricing.free.f6':     'Priority support',
    'pricing.pro.desc':    'For serious streamers who want full control.',
    'pricing.pro.f1':      'Kickot bot (advanced)',
    'pricing.pro.f2':      'Unlimited commands',
    'pricing.pro.f3':      'Advanced moderation',
    'pricing.pro.f4':      'KickAn analytics',
    'pricing.pro.f5':      'KickAj giveaway system',
    'pricing.pro.f6':      'KickOv overlay (beta)',
    'pricing.biz.desc':    'For organizations, agencies and multi-channel operations.',
    'pricing.biz.f1':      'Everything in Pro',
    'pricing.biz.f2':      'Up to 5 Kick channels',
    'pricing.biz.f3':      'KickOv overlay (full access)',
    'pricing.biz.f4':      'Custom branding',
    'pricing.biz.f5':      'API access',
    'pricing.biz.f6':      'Dedicated support',
    'pricing.cta.free':    'Get started free',
    'pricing.cta.pro':     'Get Pro plan',
    'pricing.cta.biz':     'Get Business',
    'cta.title':           'Ready to Level Up Your Stream?',
    'cta.desc':            'Join the community of Kick streamers using KickAll tools. Start for free today.',
    'cta.primary':         '🚀 Create Account',
    'cta.secondary':       'View tools',
    'footer.desc':         'Ecosystem of tools for Kick streamers. Made with ❤️ for the streaming community.',
    'footer.products':     'Products',
    'footer.company':      'Company',
    'footer.legal':        'Legal',
    'footer.soon':         'Coming Soon',
    'footer.about':        'About',
    'footer.pricing':      'Pricing',
    'footer.blog':         'Blog',
    'footer.contact':      'Contact',
    'footer.privacy':      'Privacy Policy',
    'footer.terms':        'Terms of Service',
    'footer.cookies':      'Cookies',
    'footer.copy':         '© 2026 KickAll. All rights reserved.',
    'footer.discord':      'Discord',
    'footer.twitter':      'Twitter',
  }
};

// ── Language System ────────────────────────────────────────
let currentLang = localStorage.getItem('kickall-lang') || 'sr';

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('kickall-lang', lang);

  document.documentElement.lang = lang === 'sr' ? 'sr' : 'en';

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const text = translations[lang][key];
    if (text !== undefined) {
      // Preserve inner HTML structure if it has child elements (like spans)
      if (el.children.length === 0) {
        el.textContent = text;
      } else {
        // For elements with gradient-text spans, keep them but update surrounding text
        el.setAttribute('data-translated', text);
      }
    }
  });

  // Update lang buttons
  document.getElementById('btn-sr').classList.toggle('active', lang === 'sr');
  document.getElementById('btn-en').classList.toggle('active', lang === 'en');

  // Update meta
  const t = translations[lang];
  document.title = t['meta.title'];
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute('content', t['meta.desc']);
}

// ── Navbar Scroll ──────────────────────────────────────────
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

// ── Scroll Reveal ──────────────────────────────────────────────────
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('revealed');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });

document.querySelectorAll('[data-reveal]').forEach(el => observer.observe(el));

// ── Particles Canvas ───────────────────────────────────────
(function initParticles() {
  const canvas = document.getElementById('particlesCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const particles = [];
  const count = 60;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  const colors = ['#8B5CF6', '#6366F1', '#53FC18', '#A78BFA', '#4F46E5'];

  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      size: Math.random() * 2.5 + 0.5,
      speedX: (Math.random() - 0.5) * 0.4,
      speedY: (Math.random() - 0.5) * 0.4 - 0.1,
      color: colors[Math.floor(Math.random() * colors.length)],
      opacity: Math.random() * 0.5 + 0.1,
      life: Math.random(),
      lifeSpeed: Math.random() * 0.003 + 0.001,
    });
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach(p => {
      p.life += p.lifeSpeed;
      if (p.life > 1) {
        p.life = 0;
        p.x = Math.random() * canvas.width;
        p.y = canvas.height + 10;
      }

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

// ── Smooth scroll for anchor links ────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// ── Init ──────────────────────────────────────────────────
setLang(currentLang);
