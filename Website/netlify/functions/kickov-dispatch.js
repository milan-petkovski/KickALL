const { isRateLimited } = require('./utils/rate-limiter');

/**
 * Kickov Alert Dispatch — Server-Side Rate-Limited Endpoint
 * Prima alert dispatch zahtev sa tip.html i:
 *  1. Rate limita per-IP (max 5 donacija / 60s po IP-u)
 *  2. Sanitizuje i validira unos
 *  3. Prosleduje broadcast ka Supabase Realtime
 *  4. Loguje donaciju u Supabase tabelu
 *
 * tip.html poziva: POST /.netlify/functions/kickov-dispatch
 * Body: { token, donorName, amount, message, alertConfig }
 */

const ALLOWED_ORIGINS = [
  'https://kickall.app',
  'https://kickall.netlify.app',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

const MIN_AMOUNT = 0.5;      // Minimum € za donaciju
const MAX_AMOUNT = 10000;    // Maximum € (anti-abuse)
const MAX_NAME_LEN = 60;     // Max duzina imena donatora
const MAX_MSG_LEN  = 300;    // Max duzina poruke

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeInput(raw, maxLen) {
  if (!raw) return '';
  return String(raw).trim().slice(0, maxLen);
}

exports.handler = async (event) => {
  const requestOrigin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(requestOrigin)
    ? requestOrigin
    : (process.env.ALLOWED_ORIGIN || 'https://kickall.app');

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // ── Rate Limiting: 5 donacija / 60s po IP-u ──
  const clientIp =
    event.headers['x-nf-client-connection-ip'] ||
    (event.headers['x-forwarded-for'] ? event.headers['x-forwarded-for'].split(',')[0].trim() : null) ||
    event.headers['client-ip'] ||
    'unknown';

  if (await isRateLimited(clientIp, {
    windowMs: 60000,
    maxRequests: 5,
    endpoint: 'kickov-dispatch'
  })) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders, 'Retry-After': '60' },
      body: JSON.stringify({ error: 'Previše zahteva. Sačekajte 60 sekundi pre sledeće donacije.' })
    };
  }

  // ── Parse i Validacija ──
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Neispravan JSON u zahtevu.' })
    };
  }

  const { token, donorName, amount, message, alertConfig } = body;

  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Nedostaje token korisnika.' })
    };
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount < MIN_AMOUNT || parsedAmount > MAX_AMOUNT) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: `Iznos mora biti između ${MIN_AMOUNT}€ i ${MAX_AMOUNT}€.` })
    };
  }

  const safeToken   = sanitizeInput(token, 128);
  const safeName    = escapeHtml(sanitizeInput(donorName, MAX_NAME_LEN)) || 'Anoniman';
  const safeMessage = escapeHtml(sanitizeInput(message, MAX_MSG_LEN));

  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Server konfiguracija nedostaje.' })
    };
  }

  const sbHeaders = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json'
  };

  try {
    // ── 1. Broadcast alert ka Supabase Realtime ──
    const channelName = `kickov_alerts:${safeToken}`;
    const broadcastPayload = {
      type: 'broadcast',
      event: 'alert',
      payload: {
        type: 'donation',
        name: safeName,
        amount: parsedAmount,
        message: safeMessage,
        config: alertConfig || null,
        timestamp: Date.now()
      }
    };

    // Supabase Realtime broadcast via REST API
    const realtimeUrl = `${supabaseUrl}/realtime/v1/api/broadcast`;
    await fetch(realtimeUrl, {
      method: 'POST',
      headers: {
        ...sbHeaders,
        'X-Supabase-Realtime-Token': supabaseKey
      },
      body: JSON.stringify({
        messages: [{
          topic: channelName,
          payload: broadcastPayload,
          event: 'alert',
          private: false
        }]
      })
    }).catch((err) => {
      // Neuspešan broadcast nije fatalan — donacija je već prošla kroz PayPal
      console.warn('[kickov-dispatch] Realtime broadcast greška:', err.message);
    });

    // ── 2. Log donacije u Supabase tabelu ──
    await fetch(`${supabaseUrl}/rest/v1/donations`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        streamer_id: safeToken,
        donor_name: safeName,
        amount: parsedAmount,
        currency: 'EUR',
        message: safeMessage,
        created_at: new Date().toISOString()
      })
    }).catch((err) => {
      // Log greška nije fatalna
      console.warn('[kickov-dispatch] Donations insert greška:', err.message);
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, message: 'Alert poslat uspešno.' })
    };

  } catch (err) {
    console.error('[kickov-dispatch] Greška:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Interna greška servera.' })
    };
  }
};
