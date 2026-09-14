const { isRateLimited } = require('./utils/rate-limiter');

exports.handler = async (event) => {
  const requestOrigin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const allowedOrigins = [
    'https://kickall.app',
    'https://kickall.netlify.app',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ];
  const allowOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : (process.env.ALLOWED_ORIGIN || 'https://kickall.app');

  const headers = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

  if (event.httpMethod !== 'GET') {
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
  if (await isRateLimited(clientIp, { windowMs: 60000, maxRequests: 30, endpoint: 'kick-me' })) {
    return {
      statusCode: 429,
      headers: { ...headers, 'Retry-After': '60' },
      body: JSON.stringify({ error: 'Rate limit exceeded. Please wait 60 seconds.' })
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
    const upstreamHeaders = {
      Authorization: event.headers.authorization || event.headers.Authorization || ''
    };
    if (process.env.INTERNAL_API_SECRET) {
      upstreamHeaders['X-Internal-Token'] = process.env.INTERNAL_API_SECRET;
    }

    const upstream = await fetch(`${base}/api/kick/me`, {
      method: 'GET',
      headers: upstreamHeaders
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
    console.error('Kick me upstream error:', error);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Upstream service temporarily unavailable' })
    };
  }
};