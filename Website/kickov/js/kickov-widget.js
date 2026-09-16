/**
 * Kickov OBS Browser Source Widget Script - Realtime Queue Manager & Overlay Player
 * UTF-8 clean encoding without BOM - Serbian Latin: č, ć, š, đ, ž
 */

(function () {
  'use strict';

  /* ── Global Error Handling ── */
  window.addEventListener('unhandledrejection', function (event) {
    console.warn('[Kickov Widget] Unhandled promise rejection:', event.reason);
  });

  // ── Constants ──────────────────────────────────────────
  const MAX_QUEUE_SIZE        = 50;   // Sprečava rast queue-a u dugotrajnom OBS sesiji
  const EXIT_ANIM_DURATION_MS = 600;  // Trajanje izlazne animacije
  const MAX_RECONNECT_ATTEMPTS = 5;   // Max pokušaja WebSocket reconnect

  // ── XSS Sanitizer (identičan kickaj/kickan/kickot) ──
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Extract Token from URL query string
  const urlParams = new URLSearchParams(window.location.search);
  const obsToken = urlParams.get('token') || urlParams.get('u') || urlParams.get('key');

  if (!obsToken) {
    console.warn('[Kickov Widget] OBS Token nije pronađen u URL parametrima. Koristite: widget.html?token=TVOJ_TOKEN');
  }

  // ── 0. Audio Autoplay Unlock (za OBS Browser Source) ──
  // OBS/Chromium blokira play() sa zvukom dok ne postoji "user gesture".
  // Trik: pustimo NEMI audio odmah pri učitavanju stranice (nemi autoplay je
  // uvek dozvoljen), i taj ISTI <audio> element kasnije reciklujemo za prave
  // alertove (menjamo mu src i skidamo mute) umesto da pravimo nov Audio().
  // Element koji već ima aktivnu playback sesiju obično sme da nastavi da
  // pušta zvuk i nakon što mu se ukloni mute, čak i bez klika korisnika.
  const SILENT_AUDIO_SRC =
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

  const unlockedAudio = new Audio();
  unlockedAudio.muted = true;
  unlockedAudio.loop = true;
  unlockedAudio.src = SILENT_AUDIO_SRC;
  unlockedAudio.play().catch(() => {
    // Ako čak i nemi autoplay padne, probaj ponovo čim se dokument "vidljivo" pokrene
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) unlockedAudio.play().catch(() => {});
    }, { once: true });
  });

  // Rezervni unlock: ako korisnik ipak klikne/pritisne bilo šta (npr. kroz OBS Interact),
  // iskoristi taj gest da definitivno otključa audio.
  ['click', 'keydown', 'touchstart'].forEach((evt) => {
    document.addEventListener(evt, () => {
      unlockedAudio.play().catch(() => {});
    }, { once: true, passive: true });
  });

  function playAlertSound(soundUrl, volume) {
    try {
      unlockedAudio.pause();
      unlockedAudio.src = soundUrl;
      unlockedAudio.loop = false;
      unlockedAudio.muted = false;
      unlockedAudio.currentTime = 0;
      unlockedAudio.volume = Math.min(1, Math.max(0, (volume || 80) / 100));

      const playPromise = unlockedAudio.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch((e) => {
          console.warn('[Kickov Widget] Audio autoplay restriction (fallback na novi element):', e);
          // Fallback: probaj sa potpuno novim Audio() objektom, za svaki slučaj
          try {
            const fallback = new Audio(soundUrl);
            fallback.volume = unlockedAudio.volume;
            fallback.play().catch((e2) => console.warn('[Kickov Widget] Fallback audio takođe blokiran:', e2));
          } catch (e3) {
            console.warn('[Kickov Widget] Fallback audio greška:', e3);
          }
        });
      }
    } catch (e) {
      console.warn('[Kickov Widget] Audio playback error:', e);
    }
  }

  // Kad se pravi alert-zvuk odsvira, vrati nemi loop da element ostane "zagrejan"
  unlockedAudio.addEventListener('ended', () => {
    if (unlockedAudio.muted === false) {
      unlockedAudio.muted = true;
      unlockedAudio.loop = true;
      unlockedAudio.src = SILENT_AUDIO_SRC;
      unlockedAudio.play().catch(() => {});
    }
  });

  // ── 1. Queue System Manager ────────────────────────────
  class AlertQueueManager {
    constructor() {
      this.queue = [];
      this.isProcessing = false;
      this.container = document.getElementById('obsAlertContainer');
      this.synth = window.speechSynthesis || null;
    }

    enqueue(alertPayload) {
      // Sprečava neograničeni rast queue-a tokom dugih strimova
      if (this.queue.length >= MAX_QUEUE_SIZE) {
        console.warn('[Kickov Widget] Queue je pun (max ' + MAX_QUEUE_SIZE + '), odbacujem najstariji alert.');
        this.queue.shift();
      }
      this.queue.push(alertPayload);
      if (!this.isProcessing) {
        this.processNext();
      }
    }

    async processNext() {
      if (this.queue.length === 0) {
        this.isProcessing = false;
        return;
      }

      this.isProcessing = true;
      const currentAlert = this.queue.shift();
      const cfg = currentAlert.config || {};

      // Skip if disabled
      if (cfg.enabled === false) {
        this.processNext();
        return;
      }

      await this.renderAndPlay(currentAlert, cfg);
    }

    renderAndPlay(alertData, cfg) {
      return new Promise((resolve) => {
        const layout = cfg.layout || 'layout-image-above';
        const entryAnim = cfg.entryAnim || 'entry-bounceIn';
        const exitAnim = cfg.exitAnim || 'exit-bounceOut';
        const textAnimClass = (cfg.textAnim && cfg.textAnim !== 'none') ? cfg.textAnim : '';
        const durationSec = Math.max(2, parseInt(cfg.duration || 5, 10));

        // Sanitizacija svih user-supplied podataka pre DOM inserta — sprečava XSS
        const name = escapeHtml(alertData.name || 'Korisnik');
        const rawTemplate = cfg.messageTemplate || '{name} je novi pratilac!';
        const formattedMsg = escapeHtml(
          rawTemplate
            .replace('{name}', alertData.name || 'Korisnik')
            .replace('{count}', alertData.count || '1')
            .replace('{viewers}', alertData.viewers || '10')
            .replace('{amount}', alertData.amount || '5')
        );

        // Create Alert Box DOM
        const alertEl = document.createElement('div');
        alertEl.className = `kickov-alert-box ${layout} ${entryAnim}`;
        alertEl.style.fontFamily = `'${escapeHtml(cfg.fontFamily || 'Space Grotesk')}', sans-serif`;

        alertEl.innerHTML = `
          <div class="alert-media-wrap">
            <img src="${escapeHtml(cfg.mediaUrl || 'https://media.giphy.com/media/26tPplGWjN0xLybiU/giphy.gif')}" alt="Media" class="alert-media-img">
          </div>
          <div class="alert-content-wrap">
            <div class="alert-user-name ${escapeHtml(textAnimClass)}" style="color:${escapeHtml(cfg.highlightColor || '#53fc18')}; font-size:${parseInt(cfg.fontSize || 28, 10)}px; font-weight:${escapeHtml(cfg.fontWeight || '700')}; text-shadow:0 0 14px ${escapeHtml(cfg.accentColor || '#53fc18')};">
              ${name}
            </div>
            <div class="alert-message-text" style="color:${escapeHtml(cfg.textColor || '#ffffff')};">
              ${formattedMsg}
            </div>
          </div>
        `;

        this.container.appendChild(alertEl);

        // Play Alert Audio (koristi unlock-ovan <audio> element, vidi sekciju 0 na vrhu fajla)
        if (cfg.soundUrl) {
          playAlertSound(cfg.soundUrl, cfg.soundVolume);
        }

        // Play TTS if enabled
        if (cfg.ttsEnabled && this.synth && (alertData.message || formattedMsg)) {
          try {
            // Koristi neobrađenu poruku za TTS (escapeHtml za HTML, ne za govor)
            const ttsText = alertData.message
              || rawTemplate
                .replace('{name}', alertData.name || 'Korisnik')
                .replace('{count}', alertData.count || '1')
                .replace('{viewers}', alertData.viewers || '10')
                .replace('{amount}', alertData.amount || '5');
            const utterance = new SpeechSynthesisUtterance(ttsText);
            utterance.lang = cfg.ttsVoice || 'sr-RS';
            utterance.volume = Math.min(1, Math.max(0, (cfg.ttsVolume || 80) / 100));
            this.synth.speak(utterance);
          } catch (e) {
            console.warn('[Kickov Widget] TTS error:', e);
          }
        }

        // Timer for duration + Exit Animation
        setTimeout(() => {
          alertEl.classList.remove(entryAnim);
          alertEl.classList.add(exitAnim);

          setTimeout(() => {
            if (alertEl.parentNode) {
              alertEl.parentNode.removeChild(alertEl);
            }
            resolve();
            this.processNext();
          }, EXIT_ANIM_DURATION_MS);
        }, durationSec * 1000);
      });
    }
  }

  const queueManager = new AlertQueueManager();

  // ── 2. Supabase Realtime Listener sa Reconnect Logikom ──
  const supabaseUrl = window.CONFIG?.SUPABASE?.URL;
  const supabaseAnonKey = window.CONFIG?.SUPABASE?.ANON_KEY;

  let reconnectAttempts = 0;
  let activeChannel = null;

  function connectRealtimeChannel(sb) {
    if (!sb || !obsToken) return;

    // Cleanup prethodnog kanala ako postoji
    if (activeChannel) {
      try { sb.removeChannel(activeChannel); } catch (_) {}
      activeChannel = null;
    }

    const channelName = `kickov_alerts:${obsToken}`;

    activeChannel = sb.channel(channelName)
      .on('broadcast', { event: 'alert' }, (payload) => {
        if (payload?.payload) {
          queueManager.enqueue(payload.payload);
        }
      })
      .on('broadcast', { event: 'alert_trigger' }, (payload) => {
        if (payload?.payload) {
          queueManager.enqueue(payload.payload);
        }
      })
      .subscribe((status) => {
        console.warn(`[Kickov Widget OBS] Realtime status za kanal ${channelName}:`, status);

        if (status === 'SUBSCRIBED') {
          // Uspešna konekcija — resetuj brojač pokušaja
          reconnectAttempts = 0;
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          // WebSocket pao — pokušaj reconnect sa exponential backoff
          if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(30000, 2000 * Math.pow(2, reconnectAttempts)); // max 30s
            reconnectAttempts++;
            console.warn(`[Kickov Widget] Konekcija pala. Reconnect pokušaj ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} za ${delay}ms`);
            setTimeout(() => connectRealtimeChannel(sb), delay);
          } else {
            console.warn('[Kickov Widget] Max reconnect pokušaji dostignuti. OBS widget je u offline modu.');
          }
        }
      });
  }

  if (window.supabase && supabaseUrl && supabaseAnonKey && obsToken) {
    const sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
    connectRealtimeChannel(sb);
  } else {
    console.warn('[Kickov Widget] Supabase nije dostupan ili nedostaje token.');
  }

})();