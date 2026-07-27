exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  const base = (process.env.RENDER_BOT_API_BASE || '').trim().replace(/\/+$/, '');
  if (!base) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Missing RENDER_BOT_API_BASE env var' })
    };
  }

  try {
    const url = new URL(event.path, `https://${event.headers.host}`);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    const codeVerifier = url.searchParams.get('code_verifier') || '';
    const state = url.searchParams.get('state') || '';

    // Determine origin site from state or default to kickall
    const originSite = state.includes('kickot') ? 'kickot' : 'kickall';

    if (error) {
      return {
        statusCode: 302,
        headers: {
          ...headers,
          'Location': `/${originSite}/dashboard.html?error=${encodeURIComponent(error)}`
        },
        body: ''
      };
    }

    if (!code) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing code' })
      };
    }

    const redirectUri = (() => {
      const host = event.headers.host || '';
      const protocol = event.headers['x-forwarded-proto'] || 'https';
      const origin = `${protocol}://${host}`;
      return `${origin}/auth/kick/callback/`;
    })();

    const upstream = await fetch(`${base}/api/kick/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri
      }).toString()
    });

    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'application/json';

    if (upstream.ok) {
      const tokenData = JSON.parse(text);
      const accessToken = tokenData.access_token;
      const tokenType = tokenData.token_type || 'Bearer';
      const expiresIn = tokenData.expires_in || 3600;

      return {
        statusCode: 302,
        headers: {
          ...headers,
          'Location': `/${originSite}/dashboard.html#kick_token=${encodeURIComponent(accessToken)}&token_type=${encodeURIComponent(tokenType)}&expires_in=${expiresIn}`
        },
        body: ''
      };
    } else {
      return {
        statusCode: 302,
        headers: {
          ...headers,
          'Location': `/${originSite}/dashboard.html?error=${encodeURIComponent('OAuth exchange failed')}`
        },
        body: ''
      };
    }
  } catch (error) {
    return {
      statusCode: 302,
      headers: {
        ...headers,
        'Location': `/${originSite}/dashboard.html?error=${encodeURIComponent('Server error')}`
      },
      body: ''
    };
  }
};