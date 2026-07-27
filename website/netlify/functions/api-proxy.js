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
        body: JSON.stringify({ error: 'Missing targetUrl' })
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

    const url = new URL(targetUrl);
    const isAllowed = allowedDomains.some(domain => url.hostname.includes(domain));

    if (!isAllowed) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Target domain not allowed' })
      };
    }

    // Make the proxy request
    const proxyOptions = {
      method: method,
      headers: {
        'User-Agent': 'KickALL/1.0',
        ...targetHeaders
      }
    };

    if (targetBody && method !== 'GET') {
      proxyOptions.body = targetBody;
    }

    const response = await fetch(targetUrl, proxyOptions);
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
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ 
        error: 'Proxy request failed', 
        detail: error.message 
      })
    };
  }
};
