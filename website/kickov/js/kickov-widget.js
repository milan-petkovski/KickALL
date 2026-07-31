/**
 * Kickov OBS Browser Source Widget Script - Realtime Queue Manager & Overlay Player
 * UTF-8 clean encoding without BOM - Serbian Latin: č, ć, š, đ, ž
 */

(function () {
  'use strict';

  // Extract Token from URL query string
  const urlParams = new URLSearchParams(window.location.search);
  const obsToken = urlParams.get('token') || urlParams.get('u') || urlParams.get('key');

  if (!obsToken) {
    console.warn('[Kickov Widget] OBS Token nije pronađen u URL parametrima. Koristite: widget.html?token=TVOJ_TOKEN');
  }

  // ── 1. Queue System Manager ────────────────────────────
  class AlertQueueManager {
    constructor() {
      this.queue = [];
      this.isProcessing = false;
      this.container = document.getElementById('obsAlertContainer');
      this.synth = window.speechSynthesis || null;
    }

    enqueue(alertPayload) {
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

        const name = alertData.name || 'Korisnik';
        const rawTemplate = cfg.messageTemplate || '{name} je novi pratilac!';
        const formattedMsg = rawTemplate
          .replace('{name}', name)
          .replace('{count}', alertData.count || '1')
          .replace('{viewers}', alertData.viewers || '10')
          .replace('{amount}', alertData.amount || '5');

        // Create Alert Box DOM
        const alertEl = document.createElement('div');
        alertEl.className = `kickov-alert-box ${layout} ${entryAnim}`;
        alertEl.style.fontFamily = `'${cfg.fontFamily || 'Space Grotesk'}', sans-serif`;

        alertEl.innerHTML = `
          <div class="alert-media-wrap">
            <img src="${cfg.mediaUrl || 'https://media.giphy.com/media/26tPplGWjN0xLybiU/giphy.gif'}" alt="Media" class="alert-media-img">
          </div>
          <div class="alert-content-wrap">
            <div class="alert-user-name ${textAnimClass}" style="color:${cfg.highlightColor || '#53fc18'}; font-size:${cfg.fontSize || 28}px; font-weight:${cfg.fontWeight || '700'}; text-shadow:0 0 14px ${cfg.accentColor || '#53fc18'};">
              ${name}
            </div>
            <div class="alert-message-text" style="color:${cfg.textColor || '#ffffff'};">
              ${formattedMsg}
            </div>
          </div>
        `;

        this.container.appendChild(alertEl);

        // Play Alert Audio
        if (cfg.soundUrl) {
          try {
            const audio = new Audio(cfg.soundUrl);
            audio.volume = Math.min(1, Math.max(0, (cfg.soundVolume || 80) / 100));
            audio.play().catch(e => console.warn('[Kickov Widget] Audio autoplay restriction:', e));
          } catch (e) {
            console.warn('[Kickov Widget] Audio playback error:', e);
          }
        }

        // Play TTS if enabled
        if (cfg.ttsEnabled && this.synth && (alertData.message || formattedMsg)) {
          try {
            const ttsText = alertData.message || formattedMsg;
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
          }, 600); // 600ms exit animation duration
        }, durationSec * 1000);
      });
    }
  }

  const queueManager = new AlertQueueManager();

  // ── 2. Supabase Realtime Listener ──────────────────────
  const supabaseUrl = window.CONFIG?.SUPABASE?.URL;
  const supabaseAnonKey = window.CONFIG?.SUPABASE?.ANON_KEY;

  if (window.supabase && supabaseUrl && supabaseAnonKey && obsToken) {
    const sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
    const channelName = `kickov_alerts:${obsToken}`;

    sb.channel(channelName)
      .on('broadcast', { event: 'alert' }, (payload) => {
        if (payload?.payload) {
          queueManager.enqueue(payload.payload);
        }
      })
      .subscribe((status) => {
        console.log(`[Kickov Widget OBS] Realtime status za kanal ${channelName}:`, status);
      });
  } else {
    console.warn('[Kickov Widget] Supabase nije dostupan ili nedostaje token.');
  }

})();
