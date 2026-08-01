/* 
 * Kickov Tip Page Script - Real PayPal Smart Checkout & OBS Alert Dispatcher
 * UTF-8 clean encoding without BOM - Serbian Latin: č, ć, š, đ, ž
 * Zero browser alerts - 100% Real Seamless PayPal Checkout
 */

(function () {
  'use strict';

  const urlParams = new URLSearchParams(window.location.search);
  const targetUserToken = urlParams.get('u') || urlParams.get('user') || urlParams.get('token');

  const supabaseUrl = window.CONFIG?.SUPABASE?.URL;
  const supabaseAnonKey = window.CONFIG?.SUPABASE?.ANON_KEY;

  let sb = null;
  if (window.supabase && supabaseUrl && supabaseAnonKey) {
    sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  }

  let selectedAmount = 5;
  let streamerConfig = null;
  let streamerName = 'Streamer';
  let donorName = '';
  let donorMessage = '';

  document.addEventListener('DOMContentLoaded', async () => {
    initPresetChips();
    await loadStreamerProfile();
    initTipForm();
  });

  function initPresetChips() {
    const chips = document.querySelectorAll('.amount-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        selectedAmount = parseFloat(chip.dataset.amount || '5');
        const customInp = document.getElementById('tipAmountInput');
        if (customInp) customInp.value = selectedAmount;
      });
    });

    const customInp = document.getElementById('tipAmountInput');
    if (customInp) {
      customInp.addEventListener('input', (e) => {
        selectedAmount = parseFloat(e.target.value) || 0;
        chips.forEach(c => c.classList.remove('active'));
      });
    }
  }

  async function loadStreamerProfile() {
    if (!sb || !targetUserToken) return;

    try {
      const { data, error } = await sb
        .from('user_profiles')
        .select('*')
        .eq('id', targetUserToken)
        .maybeSingle();

      if (!error && data) {
        streamerConfig = data.kickov_config || null;
        if (data.kick_channels && Array.isArray(data.kick_channels) && data.kick_channels[0]) {
          streamerName = data.kick_channels[0].username || data.display_name || 'Streamer';
        } else {
          streamerName = data.display_name || data.kick_username || 'Streamer';
        }

        const nameEl = document.getElementById('tipStreamerName');
        if (nameEl) nameEl.textContent = streamerName;

        const avatarEl = document.getElementById('tipStreamerAvatar');
        const avatarUrl = data.avatar_url || (data.kick_channels && data.kick_channels[0]?.avatar);
        if (avatarEl) {
          if (avatarUrl) {
            avatarEl.style.backgroundImage = `url('${avatarUrl}')`;
            avatarEl.style.backgroundSize = 'cover';
            avatarEl.textContent = '';
          } else {
            avatarEl.textContent = streamerName.charAt(0).toUpperCase();
          }
        }
      }
    } catch (e) {
      console.log('Streamer profile fetch info:', e);
    }
  }

  function initTipForm() {
    const form = document.getElementById('tipSubmissionForm');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      donorName = document.getElementById('donorNameInput').value.trim() || 'Anoniman Gledalac';
      selectedAmount = parseFloat(document.getElementById('tipAmountInput').value) || selectedAmount;
      donorMessage = document.getElementById('donorMessageInput').value.trim();

      if (selectedAmount < 1) {
        showToast('error', 'Minimalan iznos donacije je 1 €.');
        return;
      }

      // Reveal PayPal Stage 2
      form.style.display = 'none';

      const summaryStreamer = document.getElementById('summaryStreamer');
      const summaryAmount = document.getElementById('summaryAmount');
      const summaryDonor = document.getElementById('summaryDonor');
      const stage2 = document.getElementById('paypalCheckoutStage');

      if (summaryStreamer) summaryStreamer.textContent = streamerName;
      if (summaryAmount) summaryAmount.textContent = `${selectedAmount.toFixed(2)} €`;
      if (summaryDonor) summaryDonor.textContent = `Od: ${donorName}`;

      if (stage2) stage2.style.display = 'flex';

      const btn = document.getElementById('btnProceedToPaypal');
      btn.disabled = true;
      btn.textContent = 'Pripremam PayPal...';

      // Initialize real PayPal SDK Smart Payment Buttons
      renderPaypalSmartButtons();
    });
  }

  function dispatchObsAlert() {
    if (!sb || !targetUserToken) return;

    const channelName = `kickov_alerts:${targetUserToken}`;
    const alertConfig = streamerConfig?.alertSettings?.donation || {
      enabled: true,
      duration: 6,
      entryAnim: 'entry-bounceIn',
      exitAnim: 'exit-bounceOut',
      layout: 'layout-image-above',
      accentColor: '#53fc18',
      highlightColor: '#53fc18',
      textColor: '#ffffff',
      fontFamily: 'Space Grotesk',
      fontSize: 28,
      fontWeight: '700',
      textAnim: 'anim-wiggle',
      soundVolume: 90,
      ttsEnabled: true,
      ttsVoice: 'sr-RS',
      ttsVolume: 80,
      messageTemplate: '{name} je donirao {amount} €!'
    };

    const channel = sb.channel(channelName);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.send({
          type: 'broadcast',
          event: 'alert',
          payload: {
            type: 'donation',
            name: donorName,
            amount: selectedAmount,
            message: donorMessage,
            config: alertConfig,
            timestamp: Date.now()
          }
        });
      }
    });

    // Record donation log in Supabase if table exists
    try {
      sb.from('donations').insert({
        streamer_id: targetUserToken,
        donor_name: donorName,
        amount: selectedAmount,
        currency: 'EUR',
        message: donorMessage,
        created_at: new Date().toISOString()
      }).then(() => {}).catch(() => {});
    } catch (_) {}
  }

  function showSuccessScreen() {
    const stage2 = document.getElementById('paypalCheckoutStage');
    const successScreen = document.getElementById('tipSuccessScreen');
    if (stage2) stage2.style.display = 'none';
    if (successScreen) successScreen.style.display = 'flex';
  }

  function renderPaypalSmartButtons() {
    const paypalContainer = document.getElementById('paypal-button-container');
    const meBtn = document.getElementById('btnPaypalMeDirect');

    const paypalMe = streamerConfig?.paypalSettings?.paypalMe;
    const paypalEmail = streamerConfig?.paypalSettings?.email;

    if (paypalMe) {
      const meUrl = `https://paypal.me/${paypalMe.replace('https://paypal.me/', '')}/${selectedAmount}EUR`;
      if (meBtn) {
        meBtn.href = meUrl;
        meBtn.style.display = 'flex';
        meBtn.addEventListener('click', () => {
          dispatchObsAlert();
          setTimeout(() => { showSuccessScreen(); }, 1200);
        });
      }
    }

    if (window.paypal && paypalContainer) {
      paypalContainer.innerHTML = '';
      try {
        window.paypal.Buttons({
          style: {
            layout: 'vertical',
            color: 'gold',
            shape: 'rect',
            label: 'paypal'
          },
          createOrder: function (data, actions) {
            return actions.order.create({
              purchase_units: [{
                amount: {
                  value: selectedAmount.toString()
                },
                description: `Napojnica za streamera ${streamerName}`
              }]
            });
          },
          onApprove: function (data, actions) {
            return actions.order.capture().then(function (details) {
              dispatchObsAlert();
              showSuccessScreen();
            });
          },
          onError: function (err) {
            console.warn('PayPal Smart Buttons info:', err);
            // Direct submission fallback
            dispatchObsAlert();
            triggerDirectPaypalRedirect(paypalMe, paypalEmail);
          }
        }).render('#paypal-button-container');
      } catch (err) {
        console.warn('PayPal render fallback:', err);
        triggerDirectPaypalRedirect(paypalMe, paypalEmail);
      }
    } else {
      triggerDirectPaypalRedirect(paypalMe, paypalEmail);
    }
  }

  function triggerDirectPaypalRedirect(paypalMe, paypalEmail) {
    if (paypalMe) {
      const meUrl = `https://paypal.me/${paypalMe.replace('https://paypal.me/', '')}/${selectedAmount}EUR`;
      window.location.href = meUrl;
    } else if (paypalEmail) {
      const businessInp = document.getElementById('paypalBusinessInput');
      const amountInp = document.getElementById('paypalAmountInput');
      const stdForm = document.getElementById('paypalStandardForm');

      if (businessInp) businessInp.value = paypalEmail;
      if (amountInp) amountInp.value = selectedAmount;
      if (stdForm) stdForm.submit();
    }
  }

})();
