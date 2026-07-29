// In-memory rate limiter for serverless execution instance
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30;  // Max 30 requests/min per IP
const MAX_BODY_BYTES = 50000;        // Max 50KB payload

function isRateLimited(clientIp) {
  if (clientIp === '127.0.0.1' || clientIp === 'localhost' || clientIp === '::1' || clientIp.includes('127.0.0.1')) {
    return false;
  }
  const now = Date.now();
  const userHistory = rateLimitMap.get(clientIp) || [];
  const validHistory = userHistory.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
  
  if (validHistory.length >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }
  
  validHistory.push(now);
  rateLimitMap.set(clientIp, validHistory);
  
  // Periodic cleanup
  if (rateLimitMap.size > 1000) {
    for (const [ip, history] of rateLimitMap.entries()) {
      if (history.length === 0 || now - history[history.length - 1] > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.delete(ip);
      }
    }
  }
  return false;
}

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

  if (isRateLimited(clientIp)) {
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
      'spotify.com',
      'api.spotify.com'
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
    
    const proxyOptions = {
      method: method,
      headers: {
        'User-Agent': 'KickALL/1.0',
        ...targetHeaders
      },
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
