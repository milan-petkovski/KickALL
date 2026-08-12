const { isRateLimited } = require('./utils/rate-limiter');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://kickall.app',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Internal-Token',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const clientIp = event.headers['x-nf-client-connection-ip'] ||
    (event.headers['x-forwarded-for'] ? event.headers['x-forwarded-for'].split(',')[0].trim() : null) ||
    'unknown';

  if (await isRateLimited(clientIp, { windowMs: 60000, maxRequests: 60, endpoint: 'bot-proxy' })) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Rate limit exceeded' })
    };
  }

  const botBase = (process.env.RENDER_BOT_API_BASE || process.env.BOT_API_URL || 'https://kickbot-ihzb.onrender.com').replace(/\/+$/, '');
  const secret = process.env.INTERNAL_API_SECRET;

  if (!secret) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server misconfiguration: missing INTERNAL_API_SECRET' })
    };
  }

  // Odredi ciljnu putanju prema unutrašnjem API-ju bota
  let pathSuffix = event.path;
  if (pathSuffix.startsWith('/.netlify/functions/bot-proxy')) {
    pathSuffix = pathSuffix.replace('/.netlify/functions/bot-proxy', '');
  }
  if (!pathSuffix || pathSuffix === '/') {
    pathSuffix = '/api/channels';
  }

  const ALLOWED_PATHS = ['/api/channels', '/api/kick/logs', '/api/kick/reload', '/api/kick/test-ping', '/api/kick/check-moderator', '/api/kick/channel', '/api/global-logout', '/api/check-logout'];
  if (!ALLOWED_PATHS.includes(pathSuffix)) {
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not found' })
    };
  }

  const queryString = event.rawQuery ? `?${event.rawQuery}` : '';
  const targetUrl = `${botBase}${pathSuffix}${queryString}`;

  try {
    const fetchOptions = {
      method: event.httpMethod,
      headers: {
        'Content-Type': event.headers['content-type'] || 'application/json',
        'X-Internal-Token': secret || ''
      }
    };

    if (event.body && event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
      fetchOptions.body = event.body;
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || 'application/json';
    const responseText = await response.text();

    return {
      statusCode: response.status,
      headers: {
        ...headers,
        'Content-Type': contentType
      },
      body: responseText
    };
  } catch (error) {
    console.error('[BotProxy] Greška pri prosleđivanju zahteva bot servisu:', error);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Failed to connect to Bot service', detail: error.message })
    };
  }
};
