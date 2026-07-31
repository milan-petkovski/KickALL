const crypto = require('crypto');

// Variant ID-jevi iz Lemon Squeezy dashboard-a (mesečno i godišnje)
const PRO_VARIANT_IDS   = new Set(['ef8c2e17-c6c6-4f01-97ab-7e0b70ac2374', 'eeb6f9b7-aeeb-4769-b333-78c089a5d732']);
const ELITE_VARIANT_IDS = new Set(['09412cf7-f7ad-4103-826e-96fa00786a53', '7faf6d66-f155-4885-b64c-d1a284eb2df8']);

const HANDLED_EVENTS = new Set([
  'order_created',
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'subscription_resumed',
  'subscription_expired',
  'subscription_paused',
  'subscription_unpaused'
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

  // Dekodiraj body ako je Netlify poslao kao base64
  const rawBody = event.isBase64Encoded 
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const signature = event.headers['x-signature'] || event.headers['X-Signature'] || event.headers['x-signature-256'] || '';

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
    console.warn('[LS Webhook] Neispravan HMAC potpis. Ocekivani:', computedHmac, 'Stigli:', signature);
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Neispravan potpis' }) };
  }

  // 2. Parsiranje payload-a
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    console.error('[LS Webhook] Greska pri parsiranju JSON payload-a:', e);
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Neispravan JSON payload' }) };
  }

  const eventName = payload && payload.meta && payload.meta.event_name;
  if (!HANDLED_EVENTS.has(eventName)) {
    console.log('[LS Webhook] Neobrađeni događaj:', eventName);
    return { statusCode: 200, headers, body: JSON.stringify({ received: true, handled: false }) };
  }

  // 3. Provera Supabase env varijabli i zaglavlja za nativni REST API
  const supabaseUrl = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/+$/, '') : null;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    console.error('[LS Webhook] Nedostaje SUPABASE_URL env varijabla');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'SUPABASE_URL nedostaje u Netlify env' }) };
  }

  if (!supabaseKey) {
    console.error('[LS Webhook] Nedostaje SUPABASE_SERVICE_KEY env varijabla');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'SUPABASE_SERVICE_KEY nedostaje u Netlify env' }) };
  }

  const sbHeaders = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  // 4. Ekstrakcija user_id i atributa
  const customData = (payload && payload.meta && payload.meta.custom_data) || {};
  let userId = customData.user_id || 
               customData['user_id'] || 
               customData['custom[user_id]'] || 
               (payload && payload.data && payload.data.attributes && payload.data.attributes.custom_data && payload.data.attributes.custom_data.user_id);

  const attr = (payload && payload.data && payload.data.attributes) || {};
  const customerEmail = attr.user_email || attr.customer_email || (payload && payload.meta && payload.meta.user_email);

  if (!userId && customerEmail) {
    console.log('[LS Webhook] Tražim korisnika u Supabase-u po email-u:', customerEmail);
    try {
      const searchRes = await fetch(`${supabaseUrl}/rest/v1/user_profiles?email=eq.${encodeURIComponent(customerEmail)}&select=id`, {
        headers: sbHeaders
      });
      if (searchRes.ok) {
        const users = await searchRes.json();
        if (users && users.length > 0) {
          userId = users[0].id;
          console.log('[LS Webhook] Korisnik uspešno pronađen po email-u:', userId);
        }
      }
    } catch (searchErr) {
      console.error('[LS Webhook] Greška pri pretrazi korisnika po mejlu:', searchErr);
    }
  }

  if (!userId) {
    console.error('[LS Webhook] Nedostaje user_id u payload-u i nije pronađen po email-u:', JSON.stringify(payload && payload.meta));
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nedostaje user_id u custom_data' }) };
  }

  // 5. Određivanje novog plana (po variant_id, variant_name ili product_name)
  const firstItem = attr.first_order_item || {};
  const variantIdStr = String(attr.variant_id || firstItem.variant_id || '');
  const productName  = String(attr.product_name || firstItem.product_name || '').toLowerCase();
  const variantName  = String(attr.variant_name || firstItem.variant_name || '').toLowerCase();

  const subStatus = String(attr.status || '').toLowerCase();

  let newPlan = null;

  if (
    eventName === 'subscription_cancelled' || 
    eventName === 'subscription_expired' || 
    eventName === 'subscription_paused' ||
    subStatus === 'cancelled' || 
    subStatus === 'expired' || 
    subStatus === 'paused' ||
    subStatus === 'unpaid'
  ) {
    newPlan = 'free';
  } else if (
    PRO_VARIANT_IDS.has(variantIdStr) || 
    productName.includes('pro') || 
    variantName.includes('pro')
  ) {
    newPlan = 'pro';
  } else if (
    ELITE_VARIANT_IDS.has(variantIdStr) || 
    productName.includes('elite') || 
    variantName.includes('elite')
  ) {
    newPlan = 'elite';
  } else {
    console.warn('[LS Webhook] Nepoznat paket za variant_id:', variantIdStr, 'product:', productName, 'variant:', variantName);
    return { statusCode: 200, headers, body: JSON.stringify({ received: true, handled: false, reason: 'Nepoznat paket' }) };
  }

  const YEARLY_IDS = new Set(['eeb6f9b7-aeeb-4769-b333-78c089a5d732', '7faf6d66-f155-4885-b64c-d1a284eb2df8']);
  const isYearly = YEARLY_IDS.has(variantIdStr) || variantName.includes('year') || variantName.includes('god') || productName.includes('year') || productName.includes('god');
  const planPeriod = isYearly ? 'yearly' : 'monthly';

  // 6. Ažuriranje user_profiles u Supabase-u preko nativnog REST API-ja
  const updatePayloadFull = {
    plan: newPlan,
    plan_period: newPlan === 'free' ? null : planPeriod,
    subscription_status: newPlan === 'free' ? (subStatus || 'cancelled') : (subStatus || 'active'),
    renews_at: attr.renews_at || null,
    ends_at: attr.ends_at || null,
    customer_portal_url: (attr.urls && attr.urls.customer_portal) ? attr.urls.customer_portal : null,
    updated_at: new Date().toISOString()
  };

  try {
    let updateRes = await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: sbHeaders,
      body: JSON.stringify(updatePayloadFull)
    });

    if (!updateRes.ok) {
      console.warn('[LS Webhook] Full update failed (status ' + updateRes.status + '), attempting minimal plan update');
      updateRes = await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: sbHeaders,
        body: JSON.stringify({ plan: newPlan, updated_at: new Date().toISOString() })
      });
    }

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      console.error('[LS Webhook] Greška pri ažuriranju Supabase-a:', updateRes.status, errText);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Greska pri azuriranju baze' }) };
    }
  } catch (updateErr) {
    console.error('[LS Webhook] Network greška pri Supabase pozivu:', updateErr);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Network greska pri azuriranju baze' }) };
  }

  console.log('[LS Webhook] Uspešno ažuriran plan na "' + newPlan + '" za korisnika ' + userId + ' (događaj: ' + eventName + ')');

  // 7. Obrada referral nagrade (samo pri novoj porudžbini/pretplati da se izbegnu duplikati)
  if (eventName === 'order_created' || eventName === 'subscription_created') {
    try {
      let refRecord = null;
      
      // A) Proveri postojanje referral zapisa po kupcu (referred_id)
      const refRes = await fetch(`${supabaseUrl}/rest/v1/referrals?referred_id=eq.${encodeURIComponent(userId)}&select=id,referrer_id,status`, {
        headers: sbHeaders
      });

      if (refRes.ok) {
        const refRecords = await refRes.json();
        if (refRecords && refRecords.length > 0) {
          refRecord = refRecords[0];
        }
      }

      // B) Ako nema zapisa po referred_id, ali imamo uneti ref_code iz checkout-a
      const passedRefCode = customData.ref_code || 
                            customData['ref_code'] || 
                            customData['custom[ref_code]'] || 
                            (payload && payload.data && payload.data.attributes && payload.data.attributes.custom_data && payload.data.attributes.custom_data.ref_code);

      if (!refRecord && passedRefCode) {
        // Nađi vlasnika referral koda
        const statRes = await fetch(`${supabaseUrl}/rest/v1/referral_stats?referral_code=eq.${encodeURIComponent(String(passedRefCode).trim().toUpperCase())}&select=user_id`, {
          headers: sbHeaders
        });
        if (statRes.ok) {
          const statData = await statRes.json();
          if (statData && statData.length > 0 && statData[0].user_id !== userId) {
            const referrerId = statData[0].user_id;
            // Kreiraj novi referral zapis
            const newRefRes = await fetch(`${supabaseUrl}/rest/v1/referrals`, {
              method: 'POST',
              headers: sbHeaders,
              body: JSON.stringify({
                referrer_id: referrerId,
                referred_id: userId,
                referral_code: String(passedRefCode).trim().toUpperCase(),
                status: 'pending',
                created_at: new Date().toISOString()
              })
            });
            if (newRefRes.ok) {
              const createdRefs = await newRefRes.json();
              if (createdRefs && createdRefs.length > 0) {
                refRecord = createdRefs[0];
              }
            }
          }
        }
      }

      if (refRecord && refRecord.referrer_id && refRecord.referrer_id !== userId) {

        // IDEMPOTENCIJA: Preskoči ako je nagrada već dodeljena za ovaj isti događaj
        if (refRecord.status === 'purchased') {
          console.log('[LS Webhook] Referral nagrada već dodeljena za referred_id:', userId, '- preskačemo duplikat.');
        } else {
          const referrerId = refRecord.referrer_id;

          // Izračunaj tačnih 20% provizije od cene plana
          // Cene: PRO Mesečni $4.99, PRO Godišnji $49.99, ELITE Mesečni $9.99, ELITE Godišnji $99.99
          const totalPaid = Number(attr.total || attr.first_order_item?.price || 0) / 100;
          let calculatedReward = 0;

          if (totalPaid > 0) {
            calculatedReward = Number((totalPaid * 0.20).toFixed(2));
          } else {
            // Fallback po planu i periodu ako total stigne kao 0
            if (newPlan === 'elite') {
              calculatedReward = isYearly ? 19.99 : 2.00;
            } else {
              calculatedReward = isYearly ? 9.99 : 1.00;
            }
          }

          await fetch(`${supabaseUrl}/rest/v1/referrals?id=eq.${encodeURIComponent(refRecord.id)}`, {
            method: 'PATCH',
            headers: sbHeaders,
            body: JSON.stringify({
              status: 'purchased',
              purchased_at: new Date().toISOString(),
              reward_amount: calculatedReward,
              reward_currency: 'EUR',
              updated_at: new Date().toISOString()
            })
          });

          const planNameLabel = `${newPlan.toUpperCase()} (${isYearly ? 'Godišnje' : 'Mesečno'})`;

          await fetch(`${supabaseUrl}/rest/v1/referral_rewards`, {
            method: 'POST',
            headers: sbHeaders,
            body: JSON.stringify({
              user_id: referrerId,
              referral_id: refRecord.id,
              reward_value: calculatedReward,
              reward_description: `20% provizije za kupovinu ${planNameLabel} plana`,
              status: 'Dostupno',
              created_at: new Date().toISOString()
            })
          });

          const statsRes = await fetch(`${supabaseUrl}/rest/v1/referral_stats?user_id=eq.${encodeURIComponent(referrerId)}&select=*`, {
            headers: sbHeaders
          });
          if (statsRes.ok) {
            const statsData = await statsRes.json();
            const refStats = statsData && statsData.length > 0 ? statsData[0] : null;
            if (refStats) {
              await fetch(`${supabaseUrl}/rest/v1/referral_stats?user_id=eq.${encodeURIComponent(referrerId)}`, {
                method: 'PATCH',
                headers: sbHeaders,
                body: JSON.stringify({
                  total_earned: (Number(refStats.total_earned) || 0) + calculatedReward,
                  available_balance: (Number(refStats.available_balance) || 0) + calculatedReward,
                  successful_referrals: (Number(refStats.successful_referrals) || 0) + 1,
                  updated_at: new Date().toISOString()
                })
              });
            }
          }

          console.log('[LS Webhook] Dodeljena nagrada €' + calculatedReward + ' korisniku ' + referrerId + ' za referral ' + userId);
        }
      }
    } catch (refErr) {
      console.error('[LS Webhook] Greška pri obradi referral nagrade:', refErr);
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ received: true, handled: true, userId: userId, newPlan: newPlan })
  };
};

