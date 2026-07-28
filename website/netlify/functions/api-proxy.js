exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
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

    const isAllowed = allowedDomains.some(domain => url.hostname.includes(domain));

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
