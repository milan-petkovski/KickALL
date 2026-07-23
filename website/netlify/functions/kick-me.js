exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
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

  const base = (process.env.RENDER_BOT_API_BASE || '').trim().replace(/\/+$/, '');
  if (!base) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Missing RENDER_BOT_API_BASE env var' })
    };
  }

  try {
    const upstream = await fetch(`${base}/api/kick/me`, {
      method: 'GET',
      headers: {
        Authorization: event.headers.authorization || event.headers.Authorization || ''
      }
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
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Upstream unavailable', detail: error.message })
    };
  }
};