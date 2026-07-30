const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 10; // Max 10 exchange attempts per minute per IP
const MAX_BODY_BYTES = 10000;       // Max 10KB payload za OAuth exchange

function isRateLimited(clientIp) {
  if (clientIp === '127.0.0.1' || clientIp === 'localhost' || clientIp === '::1' || clientIp.includes('127.0.0.1')) {
    return false;
  }
  const now = Date.now();
  const history = (rateLimitMap.get(clientIp) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (history.length >= MAX_REQUESTS_PER_WINDOW) return true;
  history.push(now);
  rateLimitMap.set(clientIp, history);
  return false;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://kickall.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const clientIp = event.headers['x-nf-client-connection-ip'] || 
                   (event.headers['x-forwarded-for'] ? event.headers['x-forwarded-for'].split(',')[0].trim() : null) || 
                   event.headers['client-ip'] || 
                   'unknown';
  if (isRateLimited(clientIp)) {
    return {
      statusCode: 429,
      headers: { ...headers, 'Retry-After': '60' },
      body: JSON.stringify({ error: 'Rate limit exceeded. Please wait 60 seconds.' })
    };
  }

  // Provera velicine payload-a
  if (event.body && event.body.length > MAX_BODY_BYTES) {
    return {
      statusCode: 413,
      headers,
      body: JSON.stringify({ error: 'Payload too large', detail: 'Request body exceeds 10KB size limit' })
    };
  }

  const base = (process.env.RENDER_BOT_API_BASE || '').trim().replace(/\/+$/, '');
  if (!base) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Missing RENDER_BOT_API_BASE env var' })
    };
  }

  try {
    const upstream = await fetch(`${base}/api/kick/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: event.body || ''
    });

    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'application/json';

    return {
      statusCode: upstream.status,
      headers: {
        ...headers,
        'Content-Type': contentType
      },
      body: text
    };
  } catch (error) {
    console.error('Kick exchange upstream error:', error);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Upstream service temporarily unavailable' })
    };
  }
};