const { isRateLimited } = require('./utils/rate-limiter');
const MAX_BODY_BYTES = 50000;        // Max 50KB payload

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://kickall.app',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

  // Extract client IP
  const clientIp = event.headers['x-nf-client-connection-ip'] || 
                   (event.headers['x-forwarded-for'] ? event.headers['x-forwarded-for'].split(',')[0].trim() : null) || 
                   event.headers['client-ip'] || 
                   'unknown';

  if (await isRateLimited(clientIp, { windowMs: 60000, maxRequests: 30, endpoint: 'api-proxy' })) {
    return {
      statusCode: 429,
      headers: { ...headers, 'Retry-After': '60' },
      body: JSON.stringify({ error: 'Rate limit exceeded', detail: 'Too many requests. Please try again in a minute.' })
    };
  }

  // Payload size limit
  if (event.body && event.body.length > MAX_BODY_BYTES) {
    return {
      statusCode: 413,
      headers,
      body: JSON.stringify({ error: 'Payload too large', detail: 'Request body exceeds 50KB size limit' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { targetUrl, method = 'GET', headers: targetHeaders = {}, body: targetBody } = body;

    if (!targetUrl) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing targetUrl', detail: 'The targetUrl parameter is required' })
      };
    }

    // Validate target URL to prevent SSRF attacks
    const allowedDomains = [
      'kick.com',
      'api.kick.com',
      'id.kick.com',
      'youtube.com',
      'www.youtube.com',
      'i.ytimg.com',
      'api.allorigins.win',
      'corsproxy.io',
      'onrender.com',
      'kickbot-ihzb.onrender.com'
    ];

    let url;
    try {
      url = new URL(targetUrl);
    } catch (urlError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid URL', detail: 'The provided targetUrl is not a valid URL' })
      };
    }

    const isAllowed = allowedDomains.some(domain => 
      url.hostname === domain || url.hostname.endsWith('.' + domain)
    );

    if (!isAllowed) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Target domain not allowed', detail: `Domain ${url.hostname} is not in the allowed list` })
      };
    }

    // Make the proxy request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    // Bela lista zaglavlja koja klijent sme da prosledi ka upstream servisu
    const ALLOWED_CLIENT_HEADERS = ['content-type', 'authorization', 'accept', 'accept-language', 'user-agent'];
    const sanitizedHeaders = { 'User-Agent': 'KickALL/1.0' };
    
    if (targetHeaders && typeof targetHeaders === 'object') {
      for (const [key, val] of Object.entries(targetHeaders)) {
        if (ALLOWED_CLIENT_HEADERS.includes(String(key).toLowerCase())) {
          sanitizedHeaders[key] = val;
        }
      }
    }

    // Ako zahtev ide ka Render bot servisu, automatski priloži X-Internal-Token
    if (url.hostname.includes('onrender.com') && process.env.INTERNAL_API_SECRET) {
      sanitizedHeaders['X-Internal-Token'] = process.env.INTERNAL_API_SECRET;
    }

    const proxyOptions = {
      method: method,
      headers: sanitizedHeaders,
      signal: controller.signal
    };

    if (targetBody && method !== 'GET') {
      proxyOptions.body = targetBody;
    }

    let response;
    try {
      response = await fetch(targetUrl, proxyOptions);
    } finally {
      clearTimeout(timeoutId);
    }
    
    const responseText = await response.text();
    const contentType = response.headers.get('content-type') || 'application/json';

    return {
      statusCode: response.status,
      headers: {
        ...headers,
        'Content-Type': contentType
      },
      body: responseText
    };

  } catch (error) {
    console.error('API Proxy error:', error);
    
    // Handle timeout specifically
    if (error.name === 'AbortError') {
      return {
        statusCode: 504,
        headers,
        body: JSON.stringify({ 
          error: 'Gateway timeout', 
          detail: 'Request timed out after 10 seconds',
          timestamp: new Date().toISOString()
        })
      };
    }
    
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ 
        error: 'Proxy request failed', 
        detail: error.message || 'Unknown error occurred',
        timestamp: new Date().toISOString()
      })
    };
  }
};
