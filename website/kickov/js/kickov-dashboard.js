/**
 * Kickov Dashboard Script - Studio za podešavanje alertova i OBS vidžeta
 * Integrisano sa KickALL ekosistemom (po uzoru na Kickaj i Kickan)
 */
(function () {
  'use strict';

  // 1. Supabase i Konfiguracija
  const supabaseUrl = window.CONFIG?.SUPABASE?.URL;
  const supabaseAnonKey = window.CONFIG?.SUPABASE?.ANON_KEY;
  const storageKey = window.CONFIG?.SUPABASE?.STORAGE_KEY || 'kickbot-supabase-auth';
  let sb = null;

  if (window.supabase && supabaseUrl && supabaseAnonKey) {
    sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage, storageKey: storageKey }
    });
  }

  let currentUser = null;
  let obsToken = '';
  let realtimeChannel = null;

  // Podrazumevana podešavanja po karticama
  const DEFAULT_ALERT_CONFIG = {
    enabled: true,
    duration: 5,
    entryAnim: 'entry-bounceIn',
    exitAnim: 'exit-bounceOut',
    layout: 'layout-image-above',
    bgColor: 'rgba(18, 15, 36, 0.95)',
    accentColor: '#53fc18',
    textColor: '#ffffff',
    highlightColor: '#53fc18',
    fontFamily: 'Space Grotesk',
    fontSize: 28,
    fontWeight: '700',
    textAnim: 'anim-wiggle',
    mediaUrl: 'https://media.giphy.com/media/26tPplGWjN0xLybiU/giphy.gif',
    soundUrl: 'https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3',
    soundVolume: 80,
    ttsEnabled: true,
    ttsVoice: 'sr-RS',
    ttsVolume: 80,
    ttsMinAmount: 0,
    minKicks: 0,
    minDonation: 0,
    messageTemplate: '{name} je upravo zapratio stream!'
  };

  let alertSettings = {
    follower: { ...DEFAULT_ALERT_CONFIG, messageTemplate: '{name} je novi pratilac!' },
    sub: { ...DEFAULT_ALERT_CONFIG, messageTemplate: '{name} se upravo pretplatio na kanal!', accentColor: '#9333ea', highlightColor: '#a855f7' },
    gift_sub: { ...DEFAULT_ALERT_CONFIG, messageTemplate: '{name} je poklonio {count} pretplata!', accentColor: '#3b82f6', highlightColor: '#60a5fa' },
    host: { ...DEFAULT_ALERT_CONFIG, messageTemplate: '{name} donosi host sa {viewers} gledalaca!', accentColor: '#f59e0b', highlightColor: '#fbbf24' },
    kicks: { ...DEFAULT_ALERT_CONFIG, messageTemplate: '{name} je poslao {amount} KICK-ova!', accentColor: '#53fc18', highlightColor: '#53fc18' },
    donation: { ...DEFAULT_ALERT_CONFIG, messageTemplate: '{name} je donirao {amount} €!', accentColor: '#ec4899', highlightColor: '#f472b6' }
  };

  let paypalSettings = {
    email: '',
    paypalMe: ''
  };

  let activeTab = 'follower';

  // 2. Toast Notifikacije
  function showKickovToast(message, type = 'success') {
    if (window.toastSystem) {
      if (typeof window.toastSystem[type] === 'function') {
        window.toastSystem[type](message);
        return;
      } else if (typeof window.toastSystem.show === 'function') {
        window.toastSystem.show(message, type);
        return;
      }
    }
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type} show`;
    const isErr = type === 'error';
    const iconSvg = isErr
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#53fc18" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    toast.innerHTML = `
      <div class="toast-content">
        <div class="toast-icon-wrap">${iconSvg}</div>
        <div class="toast-msg">${message}</div>
      </div>
      <div class="toast-progress" style="animation: toastProgress 4000ms linear forwards;"></div>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 350);
    }, 4000);
  }

  // 3. Inicijalizacija Dashboarda
  document.addEventListener('DOMContentLoaded', async () => {
    initTabsNav();
    loadSettingsFromStorage();
    await checkAuthSession();
    if (sb && currentUser) {
      await syncSettingsFromSupabase();
    }
    renderActiveTabForm();
    updateLivePreview();
    updateActiveCardsMetric();
    setupOBSLinkSection();
    initRealtimeChannel();
    setupUserMenu();
  });

  function setupUserMenu() {
    const trigger = document.getElementById('userMenuTrigger');
    const menu = document.getElementById('userMenu');
    const btnLogout = document.getElementById('btnLogout');
    if (menu) menu.classList.add('visible');
    if (trigger && menu) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
      });
      document.addEventListener('click', () => { menu.classList.remove('open'); });
    }
    if (btnLogout) {
      btnLogout.addEventListener('click', async () => {
        if (sb) await sb.auth.signOut();
        window.location.href = '../index.html';
      });
    }
  }

  function cleanUsername(raw) {
    if (!raw) return 'Streamer';
    let s = String(raw).trim();
    if (s.startsWith('kick_user_')) s = s.replace(/^kick_user_/, '');
    if (s.includes('@')) s = s.split('@')[0];
    return s || 'Streamer';
  }

  function updateHeaderProfileUI(username, avatarUrl) {
    const userMenuEl = document.getElementById('userMenu');
    if (userMenuEl) userMenuEl.classList.add('visible');
    const nameEl = document.getElementById('userNameDisplay');
    const avatarEl = document.getElementById('userAvatarDisplay');
    const cleanName = cleanUsername(username);
    if (nameEl) nameEl.textContent = cleanName;
    if (avatarEl) {
      if (avatarUrl && avatarUrl.startsWith('http')) {
        avatarEl.style.backgroundImage = `url('${avatarUrl}')`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.textContent = '';
      } else if (cleanName) {
        avatarEl.style.backgroundImage = 'none';
        avatarEl.style.color = '#000';
        avatarEl.textContent = cleanName.charAt(0).toUpperCase();
      }
    }
  }

  function updateActiveCardsMetric() {
    const statEl = document.getElementById('statActiveCardsVal');
    if (!statEl) return;
    const keys = Object.keys(alertSettings);
    const enabledCount = keys.filter(k => alertSettings[k]?.enabled !== false).length;
    statEl.textContent = `${enabledCount} / ${keys.length}`;
  }

  async function checkAuthSession() {
    if (!sb) {
      redirectToHome();
      return;
    }
    try {
      const session = window.CONFIG?.getValidSessionWithRetry
        ? await window.CONFIG.getValidSessionWithRetry(sb, 3, 1500)
        : (await sb.auth.getSession())?.data?.session;

      if (!session?.user) {
        redirectToHome();
        return;
      }

      currentUser = session.user;
      obsToken = currentUser.id;

      let username = currentUser.user_metadata?.kick_username
                  || currentUser.user_metadata?.preferred_username
                  || currentUser.user_metadata?.name
                  || currentUser.user_metadata?.full_name
                  || (currentUser.email ? currentUser.email : 'Streamer');
      let avatarUrl = currentUser.user_metadata?.avatar_url
                   || currentUser.user_metadata?.picture
                   || currentUser.user_metadata?.profile_picture;

      updateHeaderProfileUI(username, avatarUrl);

      try {
        const { data: profile } = await sb
          .from('user_profiles')
          .select('*')
          .eq('id', currentUser.id)
          .maybeSingle();

        if (profile) {
          if (profile.kick_channels && Array.isArray(profile.kick_channels) && profile.kick_channels.length > 0) {
            const primary = profile.kick_channels.find(c => c.is_primary) || profile.kick_channels[0];
            if (primary.username) username = primary.username;
            if (primary.avatar) avatarUrl = primary.avatar;
          }
          if (!username && profile.display_name) username = profile.display_name;
          updateHeaderProfileUI(username, avatarUrl);
        }
      } catch (err) {
        console.log('Profile query info:', err);
      }

      dismissAuthGate();
    } catch (err) {
      console.error('KickOV auth check failed:', err);
      redirectToHome();
    }
  }

  function redirectToHome() {
    const msg = document.getElementById('authGateMsg');
    let secondsLeft = 3;
    if (msg) msg.textContent = `Niste prijavljeni. Preusmeravamo vas na početnu stranicu za ${secondsLeft}s...`;
    const timer = setInterval(() => {
      secondsLeft--;
      if (msg && secondsLeft > 0) msg.textContent = `Niste prijavljeni. Preusmeravamo vas na početnu stranicu za ${secondsLeft}s...`;
      if (secondsLeft <= 0) {
        clearInterval(timer);
        window.location.href = '../index.html';
      }
    }, 1000);
  }

  function dismissAuthGate() {
    const gate = document.getElementById('authGate');
    if (gate) {
      gate.classList.add('fade-out');
      setTimeout(() => { gate.style.display = 'none'; }, 450);
    }
    document.body.classList.remove('auth-loading');
  }

  function loadSettingsFromStorage() {
    try {
      const saved = localStorage.getItem('kickov_alert_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.alertSettings) alertSettings = { ...alertSettings, ...parsed.alertSettings };
        if (parsed.paypalSettings) paypalSettings = parsed.paypalSettings;
      }
    } catch (e) {
      console.warn('LocalStorage settings read error:', e);
    }
  }

  function saveSettingsToStorage() {
    try {
      localStorage.setItem('kickov_alert_settings', JSON.stringify({ alertSettings, paypalSettings }));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  }

  async function syncSettingsFromSupabase() {
    if (!sb || !currentUser) return;
    try {
      const { data, error } = await sb
        .from('user_profiles')
        .select('kickov_config')
        .eq('id', currentUser.id)
        .maybeSingle();

      if (!error && data?.kickov_config) {
        if (data.kickov_config.alertSettings) alertSettings = { ...alertSettings, ...data.kickov_config.alertSettings };
        if (data.kickov_config.paypalSettings) paypalSettings = data.kickov_config.paypalSettings;
        saveSettingsToStorage();
      }
    } catch (err) {
      console.log('Supabase sync info:', err.message);
    }
  }

  async function saveSettingsToSupabase() {
    saveSettingsToStorage();
    if (!sb || !currentUser) {
      showKickovToast('Podešavanja su uspešno sačuvana lokalno!', 'success');
      return;
    }
    try {
      const { error } = await sb
        .from('user_profiles')
        .update({
          kickov_config: { alertSettings, paypalSettings },
          updated_at: new Date().toISOString()
        })
        .eq('id', currentUser.id);

      if (error) throw error;
      showKickovToast('Podešavanja su uspešno sačuvana na bazi!', 'success');
    } catch (err) {
      console.warn('Supabase save warning:', err);
      showKickovToast('Podešavanja su uspešno sačuvana!', 'success');
    }
  }

  function initRealtimeChannel() {
    if (!sb || !obsToken) return;
    const channelName = `kickov_alerts:${obsToken}`;
    realtimeChannel = sb.channel(channelName);
    realtimeChannel.subscribe((status) => {
      const statusPill = document.getElementById('wsStatusPill');
      if (statusPill) {
        if (status === 'SUBSCRIBED') {
          statusPill.innerHTML = '<span class="status-dot"></span><span>Realtime Konekcija Aktivna</span>';
          statusPill.style.borderColor = 'rgba(83, 252, 24, 0.4)';
        } else {
          statusPill.innerHTML = '<span class="status-dot" style="background:#ef4444;box-shadow:0 0 10px #ef4444"></span><span>Povezivanje...</span>';
        }
      }
    });
  }

  function setupOBSLinkSection() {
    const obsInput = document.getElementById('obsUrlInput');
    const tokenToUse = obsToken || 'DEMO_TOKEN';
    const obsFullUrl = `${window.location.origin}/kickov/widget.html?token=${tokenToUse}`;

    if (obsInput) {
      obsInput.value = obsInput.dataset.visible === 'true' ? obsFullUrl : '••••••••••••••••••••••••••••••••••••••••';
    }
    const btnToggle = document.getElementById('btnToggleObsUrl');
    if (btnToggle && obsInput) {
      btnToggle.onclick = () => {
        const isVisible = obsInput.dataset.visible === 'true';
        obsInput.dataset.visible = (!isVisible).toString();
        obsInput.value = !isVisible ? obsFullUrl : '••••••••••••••••••••••••••••••••••••••••';
        btnToggle.innerHTML = !isVisible
          ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Sakrij`
          : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Prikaži Link`;
      };
    }
    const btnCopy = document.getElementById('btnCopyObsUrl');
    if (btnCopy) {
      btnCopy.onclick = () => {
        navigator.clipboard.writeText(obsFullUrl).then(() => {
          showKickovToast('OBS Link je uspešno kopiran!', 'success');
        });
      };
    }
  }

  function initTabsNav() {
    const tabBtns = document.querySelectorAll('.kickov-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeTab = btn.dataset.tab;
        renderActiveTabForm();
        updateLivePreview();
      });
    });

    const btnSaveAll = document.getElementById('btnSaveAllSettings');
    if (btnSaveAll) {
      btnSaveAll.addEventListener('click', saveSettingsToSupabase);
    }

    const btnTestAlert = document.getElementById('btnSendTestAlert');
    if (btnTestAlert) {
      btnTestAlert.addEventListener('click', triggerTestAlert);
    }
  }

  function getTabTitle(key) {
    const titles = {
      follower: 'Pratioci',
      sub: 'Pretplatnici',
      gift_sub: 'Poklon Pretplate',
      host: 'Hostovi',
      kicks: 'KICK-ovi',
      donation: 'Donacije'
    };
    return titles[key] || key;
  }

  function renderActiveTabForm() {
    const container = document.getElementById('tabConfigFormContainer');
    if (!container) return;
    if (activeTab === 'donation') {
      renderDonationAndPaypalForm(container);
    } else {
      renderAlertConfigForm(container, activeTab);
    }
  }

  function renderAlertConfigForm(container, tabKey) {
    const cfg = alertSettings[tabKey] || DEFAULT_ALERT_CONFIG;
    container.innerHTML = `
      <div class="panel-header" style="width:100%;">
        <h2 class="panel-title">
          Podešavanje Alerta: <span style="color:var(--kickov-accent-green); text-transform:capitalize;">${getTabTitle(tabKey)}</span>
        </h2>
      </div>
      <div class="master-switch-row" style="width:100%; box-sizing:border-box;">
        <div class="master-switch-info">
          <h3>Glavni prekidač za ${getTabTitle(tabKey)}</h3>
          <p>Aktiviraj ili privremeno isključi prikazivanje ovog alerta na streamu.</p>
        </div>
        <label class="custom-toggle">
          <input type="checkbox" id="field_enabled" ${cfg.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="panel-section-card" style="width:100%; box-sizing:border-box;">
        <h3>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--kickov-accent-green)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          1. Trajanje & Raspored Elemenata
        </h3>
        <div class="form-grid-2" style="width:100%; box-sizing:border-box;">
          <div class="form-group">
            <label class="form-label">Trajanje Prikaza</label>
            <input type="number" id="field_duration" class="form-control" min="1" max="30" value="${cfg.duration}">
          </div>
          <div class="form-group">
            <label class="form-label">Raspored Slike i Teksta</label>
            <select id="field_layout" class="form-control">
              <option value="layout-image-above" ${cfg.layout === 'layout-image-above' ? 'selected' : ''}>Slika iznad teksta</option>
              <option value="layout-text-above" ${cfg.layout === 'layout-text-above' ? 'selected' : ''}>Tekst iznad slike</option>
              <option value="layout-image-left" ${cfg.layout === 'layout-image-left' ? 'selected' : ''}>Slika levo, tekst desno</option>
              <option value="layout-text-over" ${cfg.layout === 'layout-text-over' ? 'selected' : ''}>Tekst preko slike</option>
            </select>
          </div>
        </div>
      </div>
      <div class="panel-section-card" style="width:100%; box-sizing:border-box;">
        <h3>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--kickov-accent-violet)" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          2. CSS Animacije Ulaska & Izlaska
        </h3>
        <div class="form-grid-2" style="width:100%; box-sizing:border-box;">
          <div class="form-group">
            <label class="form-label">Animacija Ulaska</label>
            <select id="field_entryAnim" class="form-control">
              <option value="entry-bounceIn" ${cfg.entryAnim === 'entry-bounceIn' ? 'selected' : ''}>Bounce In (Skakanje)</option>
              <option value="entry-fadeIn" ${cfg.entryAnim === 'entry-fadeIn' ? 'selected' : ''}>Fade In (Postepeno)</option>
              <option value="entry-slideInLeft" ${cfg.entryAnim === 'entry-slideInLeft' ? 'selected' : ''}>Slide In Left (Sa leve strane)</option>
              <option value="entry-slideInDown" ${cfg.entryAnim === 'entry-slideInDown' ? 'selected' : ''}>Slide In Down (Odozgo)</option>
              <option value="entry-zoomIn" ${cfg.entryAnim === 'entry-zoomIn' ? 'selected' : ''}>Zoom In (Uvećanje)</option>
              <option value="entry-flipIn" ${cfg.entryAnim === 'entry-flipIn' ? 'selected' : ''}>Flip In (Rotacija)</option>
              <option value="entry-elasticIn" ${cfg.entryAnim === 'entry-elasticIn' ? 'selected' : ''}>Elastic In (Elastično)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Animacija Izlaska</label>
            <select id="field_exitAnim" class="form-control">
              <option value="exit-bounceOut" ${cfg.exitAnim === 'exit-bounceOut' ? 'selected' : ''}>Bounce Out</option>
              <option value="exit-fadeOut" ${cfg.exitAnim === 'exit-fadeOut' ? 'selected' : ''}>Fade Out</option>
              <option value="exit-slideOutRight" ${cfg.exitAnim === 'exit-slideOutRight' ? 'selected' : ''}>Slide Out Right</option>
              <option value="exit-slideOutUp" ${cfg.exitAnim === 'exit-slideOutUp' ? 'selected' : ''}>Slide Out Up</option>
              <option value="exit-zoomOut" ${cfg.exitAnim === 'exit-zoomOut' ? 'selected' : ''}>Zoom Out</option>
              <option value="exit-flipOut" ${cfg.exitAnim === 'exit-flipOut' ? 'selected' : ''}>Flip Out</option>
            </select>
          </div>
        </div>
      </div>
      <div class="panel-section-card" style="width:100%; box-sizing:border-box;">
        <h3>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
          3. Izbor Boja, Tipografije & Efekata
        </h3>
        <div class="form-grid-2" style="width:100%; box-sizing:border-box;">
          <div class="form-group">
            <label class="form-label">Akcentna Boja</label>
            <div class="color-picker-wrap">
              <input type="color" id="field_accentColor" class="color-picker-input" value="${cfg.accentColor}">
              <input type="text" class="form-control" value="${cfg.accentColor}" readonly>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Boja Imena Korisnika</label>
            <div class="color-picker-wrap">
              <input type="color" id="field_highlightColor" class="color-picker-input" value="${cfg.highlightColor}">
              <input type="text" class="form-control" value="${cfg.highlightColor}" readonly>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Tipografija</label>
            <select id="field_fontFamily" class="form-control">
              <option value="Space Grotesk" ${cfg.fontFamily === 'Space Grotesk' ? 'selected' : ''}>Space Grotesk</option>
              <option value="Inter" ${cfg.fontFamily === 'Inter' ? 'selected' : ''}>Inter</option>
              <option value="Outfit" ${cfg.fontFamily === 'Outfit' ? 'selected' : ''}>Outfit</option>
              <option value="Roboto" ${cfg.fontFamily === 'Roboto' ? 'selected' : ''}>Roboto</option>
              <option value="Montserrat" ${cfg.fontFamily === 'Montserrat' ? 'selected' : ''}>Montserrat</option>
              <option value="Poppins" ${cfg.fontFamily === 'Poppins' ? 'selected' : ''}>Poppins</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Animacija Teksta</label>
            <select id="field_textAnim" class="form-control">
              <option value="anim-wiggle" ${cfg.textAnim === 'anim-wiggle' ? 'selected' : ''}>Trešenje</option>
              <option value="anim-shine" ${cfg.textAnim === 'anim-shine' ? 'selected' : ''}>Svetlucanje</option>
              <option value="anim-pulse" ${cfg.textAnim === 'anim-pulse' ? 'selected' : ''}>Pulsiranje</option>
              <option value="anim-rainbow" ${cfg.textAnim === 'anim-rainbow' ? 'selected' : ''}>Duga</option>
              <option value="anim-bounce" ${cfg.textAnim === 'anim-bounce' ? 'selected' : ''}>Skakanje</option>
              <option value="none" ${cfg.textAnim === 'none' ? 'selected' : ''}>Isključeno</option>
            </select>
          </div>
        </div>
      </div>
      <div class="panel-section-card" style="width:100%; box-sizing:border-box;">
        <h3>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--kickov-accent-pink)" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          4. Mediji, Zvuk & Text-to-Speech (TTS)
        </h3>
        <div class="form-group">
          <label class="form-label">URL Slike ili GIF Animacije</label>
          <input type="url" id="field_mediaUrl" class="form-control" value="${cfg.mediaUrl}">
          <div class="preset-gallery">
            <span class="preset-chip" onclick="setPresetMedia('https://media.giphy.com/media/26tPplGWjN0xLybiU/giphy.gif')">GIF Hype</span>
            <span class="preset-chip" onclick="setPresetMedia('https://media.giphy.com/media/l41YcGT5Sh62MmnG8/giphy.gif')">GIF Dance</span>
            <span class="preset-chip" onclick="setPresetMedia('https://media.giphy.com/media/3o7TKsjN41VGlV65mU/giphy.gif')">GIF Trophy</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">URL Zvuka Alerta (MP3)</label>
          <input type="url" id="field_soundUrl" class="form-control" value="${cfg.soundUrl}">
        </div>
        <div class="form-group" style="margin-bottom:0; background:rgba(0,0,0,0.3); border:1px solid var(--kickov-card-border); padding:20px; border-radius:var(--kickov-radius-md);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div>
              <h4 style="margin:0 0 4px 0; font-size:1.05rem;">Text to Speech (TTS) Poruka</h4>
              <p style="margin:0; font-size:0.85rem; color:var(--kickov-text-muted);">Glasovno čitanje poruke gledaoca u uživo tokom prikaza alerta.</p>
            </div>
            <label class="custom-toggle">
              <input type="checkbox" id="field_ttsEnabled" ${cfg.ttsEnabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="form-grid-2">
            <div>
              <label class="form-label">Jezik i Glas</label>
              <select id="field_ttsVoice" class="form-control">
                <option value="sr-RS" ${cfg.ttsVoice === 'sr-RS' ? 'selected' : ''}>Srpski (sr-RS)</option>
                <option value="en-US" ${cfg.ttsVoice === 'en-US' ? 'selected' : ''}>English (en-US)</option>
              </select>
            </div>
            <div>
              <label class="form-label">Jačina zvuka TTS (%)</label>
              <input type="range" id="field_ttsVolume" class="form-control" min="0" max="100" value="${cfg.ttsVolume}">
            </div>
          </div>
        </div>
      </div>
    `;
    bindFormInputs(tabKey);
  }

  function renderDonationAndPaypalForm(container) {
    const tipUrl = `${window.location.origin}/kickov/tip.html?u=${obsToken}`;
    container.innerHTML = `
      <div class="panel-header" style="width:100%;">
        <h2 class="panel-title">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          Modul Donacije & PayPal Integracija
        </h2>
      </div>
      <div class="paypal-notice-banner" style="width:100%; box-sizing:border-box;">
        <div class="paypal-notice-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
        <div class="paypal-notice-content">
          <h4>Platforma Ne Zadržava Vaš Novac!</h4>
          <p>KickALL je 100% transparentan servis. Svi novčani iznosi i napojnice donatora uplaćuju se <strong>direktno na vaš verifikovani PayPal nalog</strong> bez ikakvih provizija ili posredničkih računa.</p>
        </div>
      </div>
      <div class="form-group" style="width:100%; box-sizing:border-box; background:rgba(255,255,255,0.03); border:1px solid var(--kickov-card-border); padding:20px; border-radius:var(--kickov-radius-md);">
        <label class="form-label">Tvoj Unikatni Link za Donacije</label>
        <div class="obs-url-box" style="margin-bottom:12px;">
          <input type="text" class="obs-url-input" value="${tipUrl}" id="tipUrlInput" readonly>
          <button class="btn-icon-text btn-primary-green" id="btnCopyTipUrl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Kopiraj Tip Link
          </button>
        </div>
        <span style="font-size:0.85rem; color:var(--kickov-text-muted);">Postavi ovaj link u opis tvog stream kanala ili u chat komandu !donacije.</span>
      </div>
      <div class="form-grid-2" style="width:100%; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:24px; margin-top:24px;">
        <div class="form-group">
          <label class="form-label">PayPal Email Adresa</label>
          <input type="email" id="field_paypalEmail" class="form-control" placeholder="tvoj-email@paypal.com" value="${paypalSettings.email || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">PayPal.me Korisničko Ime / Link (Opciono)</label>
          <input type="text" id="field_paypalMe" class="form-control" placeholder="mojstream" value="${paypalSettings.paypalMe || ''}">
        </div>
      </div>
    `;

    const btnCopyTip = document.getElementById('btnCopyTipUrl');
    if (btnCopyTip) {
      btnCopyTip.onclick = () => {
        navigator.clipboard.writeText(tipUrl).then(() => {
          showKickovToast('Link za donacije je uspešno kopiran!', 'success');
        });
      };
    }
    const emailInp = document.getElementById('field_paypalEmail');
    if (emailInp) {
      emailInp.oninput = (e) => {
        paypalSettings.email = e.target.value;
        saveSettingsToStorage();
      };
    }
    const meInp = document.getElementById('field_paypalMe');
    if (meInp) {
      meInp.oninput = (e) => {
        paypalSettings.paypalMe = e.target.value;
        saveSettingsToStorage();
      };
    }
  }

  function bindFormInputs(tabKey) {
    const cfg = alertSettings[tabKey];
    if (!cfg) return;

    const bindField = (id, key, isCheck = false) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.onchange = (e) => {
        cfg[key] = isCheck ? e.target.checked : e.target.value;
        saveSettingsToStorage();
        updateLivePreview();
        updateTabBadgeState(tabKey, alertSettings[tabKey].enabled);
        updateActiveCardsMetric();
      };
      if (!isCheck && el.tagName === 'INPUT' && el.type === 'color') {
        el.oninput = (e) => {
          cfg[key] = e.target.value;
          updateLivePreview();
        };
      }
    };

    bindField('field_enabled', 'enabled', true);
    bindField('field_duration', 'duration');
    bindField('field_layout', 'layout');
    bindField('field_entryAnim', 'entryAnim');
    bindField('field_exitAnim', 'exitAnim');
    bindField('field_accentColor', 'accentColor');
    bindField('field_highlightColor', 'highlightColor');
    bindField('field_fontFamily', 'fontFamily');
    bindField('field_textAnim', 'textAnim');
    bindField('field_mediaUrl', 'mediaUrl');
    bindField('field_soundUrl', 'soundUrl');
    bindField('field_ttsEnabled', 'ttsEnabled', true);
    bindField('field_ttsVoice', 'ttsVoice');
    bindField('field_ttsVolume', 'ttsVolume');

    window.setPresetMedia = (url) => {
      cfg.mediaUrl = url;
      const mediaInp = document.getElementById('field_mediaUrl');
      if (mediaInp) mediaInp.value = url;
      saveSettingsToStorage();
      updateLivePreview();
    };
  }

  function updateTabBadgeState(tabKey, isEnabled) {
    const btn = document.querySelector(`.kickov-tab-btn[data-tab="${tabKey}"]`);
    if (btn) {
      if (isEnabled) btn.classList.add('enabled');
      else btn.classList.remove('enabled');
    }
  }

  function updateLivePreview() {
    const viewport = document.getElementById('previewViewport');
    if (!viewport) return;
    if (activeTab === 'donation') {
      viewport.innerHTML = `
        <div style="text-align:center; padding:20px;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#53fc18" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <h3 style="margin:12px 0 6px 0; color:#fff;">PayPal Pregled Aktiviran</h3>
          <p style="color:var(--kickov-text-muted); font-size:0.9rem; margin:0;">Donacije su sačuvane sa 0% provizije za streamer-a.</p>
        </div>
      `;
      return;
    }
    const cfg = alertSettings[activeTab] || DEFAULT_ALERT_CONFIG;
    const sampleNames = {
      follower: 'Nikola_Kick',
      sub: 'Stefan_SUB',
      gift_sub: 'Marko_GIFT',
      host: 'Balkans_Streamer',
      kicks: 'Gamer_PRO',
      donation: 'Donator_Brat'
    };
    const name = sampleNames[activeTab] || 'Korisnik';
    const textAnimClass = cfg.textAnim !== 'none' ? cfg.textAnim : '';
    viewport.innerHTML = `
      <div class="kickov-alert-box ${cfg.layout} ${cfg.entryAnim}" style="font-family: '${cfg.fontFamily}', sans-serif;">
        <div class="alert-media-wrap">
          <img src="${cfg.mediaUrl}" alt="Alert Media" class="alert-media-img" onerror="this.src='https://media.giphy.com/media/26tPplGWjN0xLybiU/giphy.gif'">
        </div>
        <div class="alert-content-wrap">
          <div class="alert-user-name ${textAnimClass}" style="color:${cfg.highlightColor}; font-size:${cfg.fontSize}px; font-weight:${cfg.fontWeight}; text-shadow:0 0 14px ${cfg.accentColor};">
            ${name}
          </div>
          <div class="alert-message-text" style="color:${cfg.textColor};">
            ${cfg.messageTemplate.replace('{name}', name).replace('{count}', '5').replace('{viewers}', '120').replace('{amount}', '50')}
          </div>
        </div>
      </div>
    `;
  }

  function triggerTestAlert() {
    updateLivePreview();
    const cfg = alertSettings[activeTab] || DEFAULT_ALERT_CONFIG;
    if (!cfg.enabled) {
      showKickovToast(`Alert ${getTabTitle(activeTab)} je isključen u podešavanjima!`, 'error');
      return;
    }
    const testPayload = {
      type: activeTab,
      name: 'TestKorisnik_' + Math.floor(Math.random() * 90 + 10),
      amount: 10,
      count: 5,
      message: 'Ovo je testna poruka za OBS vidžet!',
      config: cfg,
      timestamp: Date.now()
    };
    if (realtimeChannel) {
      realtimeChannel.send({
        type: 'broadcast',
        event: 'alert',
        payload: testPayload
      });
    }
    showKickovToast(`Test alert za [${getTabTitle(activeTab)}] je uspešno poslat u OBS!`, 'success');
  }
})();