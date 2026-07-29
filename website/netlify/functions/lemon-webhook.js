const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// Variant ID-jevi iz Lemon Squeezy dashboard-a
const PRO_VARIANT_ID   = '5cf5297e-1531-4d20-b4d7-bee2a87ce43f';
const ELITE_VARIANT_ID = '49acae3b-d8ea-4fd6-a278-6daf3d9d48db';

const HANDLED_EVENTS = new Set([
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled'
]);

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://kickall.app',
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // 1. HMAC SHA256 verifikacija potpisa
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[LS Webhook] Nedostaje LEMON_SQUEEZY_WEBHOOK_SECRET env var');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Webhook secret nije konfigurisan' }) };
  }

  const rawBody  = event.body || '';
  const signature = event.headers['x-signature'] || event.headers['X-Signature'] || '';

  if (!signature) {
    console.warn('[LS Webhook] Nedostaje x-signature zaglavlje');
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Nedostaje potpis' }) };
  }

  const computedHmac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  let isValid = false;
  try {
    const sigBuffer  = Buffer.from(signature, 'hex');
    const hmacBuffer = Buffer.from(computedHmac, 'hex');
    isValid = sigBuffer.length === hmacBuffer.length && crypto.timingSafeEqual(sigBuffer, hmacBuffer);
  } catch (_) {
    isValid = false;
  }

  if (!isValid) {
    console.warn('[LS Webhook] Neispravan HMAC potpis');
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Neispravan potpis' }) };
  }

  // 2. Parsiranje payload-a
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Neispravan JSON payload' }) };
  }

  const eventName = payload && payload.meta && payload.meta.event_name;
  if (!HANDLED_EVENTS.has(eventName)) {
    return { statusCode: 200, headers, body: JSON.stringify({ received: true, handled: false }) };
  }

  // 3. Ekstrakcija podataka
  const userId    = payload.meta && payload.meta.custom_data && payload.meta.custom_data.user_id;
  const variantId = payload.data && payload.data.attributes && payload.data.attributes.variant_id
                  ? String(payload.data.attributes.variant_id)
                  : null;

  if (!userId) {
    console.error('[LS Webhook] Nedostaje user_id u custom_data');
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nedostaje user_id u custom_data' }) };
  }

  // 4. Odredjivanje novog plana
  let newPlan;
  if (eventName === 'subscription_cancelled') {
    newPlan = 'free';
  } else if (variantId === PRO_VARIANT_ID) {
    newPlan = 'pro';
  } else if (variantId === ELITE_VARIANT_ID) {
    newPlan = 'elite';
  } else {
    console.warn('[LS Webhook] Nepoznat variant_id: ' + variantId + ' za dogadjaj: ' + eventName);
    return { statusCode: 200, headers, body: JSON.stringify({ received: true, handled: false, reason: 'Nepoznat variant_id' }) };
  }

  // 5. Azuriranje Supabase baze
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[LS Webhook] Nedostaju Supabase env varijable');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase konfiguracija nedostaje' }) };
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const { error: dbError } = await supabase
    .from('user_profiles')
    .update({ plan: newPlan })
    .eq('id', userId);

  if (dbError) {
    console.error('[LS Webhook] Greska pri azuriranju plana za user ' + userId + ':', dbError);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Greska pri azuriranju baze' }) };
  }

  console.log('[LS Webhook] Azuriran plan na ' + newPlan + ' za user ' + userId + ' (dogadjaj: ' + eventName + ')');

  // 6. Obrada referral nagrade (ako je korisnik pozvan preko referral linka)
  if (eventName === 'subscription_created' || (eventName === 'subscription_updated' && (newPlan === 'pro' || newPlan === 'elite'))) {
    try {
      // Pronadji da li ovaj korisnik ima zabelezen referral u tabeli referrals
      const { data: refRecord } = await supabase
        .from('referrals')
        .select('id, referrer_id, status')
        .eq('referred_id', userId)
        .maybeSingle();

      if (refRecord && refRecord.referrer_id && refRecord.referrer_id !== userId) {
        const referrerId = refRecord.referrer_id;
        const rewardVal = newPlan === 'elite' ? 3.00 : 2.00;

        // Azuriraj status u referrals tabeli
        await supabase
          .from('referrals')
          .update({
            status: 'purchased',
            purchased_at: new Date().toISOString(),
            reward_amount: rewardVal,
            reward_currency: 'EUR',
            reward_status: 'credited',
            updated_at: new Date().toISOString()
          })
          .eq('id', refRecord.id);

        // Upisi nagradu u referral_rewards
        await supabase.from('referral_rewards').insert({
          user_id: referrerId,
          referral_id: refRecord.id,
          reward_type: 'commission',
          reward_value: rewardVal,
          reward_description: 'Provizija za ' + newPlan.toUpperCase() + ' pretplatu',
          status: 'Dostupno',
          created_at: new Date().toISOString()
        });

        // Dohvati i azuriraj referral_stats za referrera
        const { data: refStats } = await supabase
          .from('referral_stats')
          .select('*')
          .eq('user_id', referrerId)
          .maybeSingle();

        if (refStats) {
          await supabase
            .from('referral_stats')
            .update({
              total_earned: (Number(refStats.total_earned) || 0) + rewardVal,
              available_balance: (Number(refStats.available_balance) || 0) + rewardVal,
              successful_referrals: (Number(refStats.successful_referrals) || 0) + 1,
              updated_at: new Date().toISOString()
            })
            .eq('user_id', referrerId);
        }

        console.log('[LS Webhook] Dodeljena nagrada €' + rewardVal + ' korisniku ' + referrerId + ' za referral ' + userId);
      }
    } catch (refErr) {
      console.error('[LS Webhook] Greska pri obradi referral nagrade:', refErr);
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ received: true, handled: true, userId: userId, newPlan: newPlan })
  };
};
