// Netlify Serverless Function for YouTube Search
// Returns top video ID, title, author, duration, and coverUrl for any query without API keys or CORS restrictions

const { isRateLimited } = require('./utils/rate-limiter');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://kickall.app';

exports.handler = async function (event, _context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  // Rate Limiting Protection
  const clientIp = event.headers['x-nf-client-connection-ip'] || 
                   (event.headers['x-forwarded-for'] ? event.headers['x-forwarded-for'].split(',')[0].trim() : null) || 
                   event.headers['client-ip'] || 
                   'unknown';

  if (await isRateLimited(clientIp, { windowMs: 60000, maxRequests: 20, endpoint: 'yt-search' })) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders, 'Retry-After': '60' },
      body: JSON.stringify({ error: 'Rate limit exceeded. Please wait 60 seconds.' })
    };
  }

  const query = event.queryStringParameters && event.queryStringParameters.q ? event.queryStringParameters.q.trim() : '';

  if (!query) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing query parameter q' })
    };
  }

  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,sr;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`YouTube responded with status ${response.status}`);
    }

    const html = await response.text();

    // Extract videoId using multiple robust patterns
    let videoId = null;
    const videoIdMatch = html.match(/"videoId":"([\w-]{11})"/) || html.match(/\/watch\?v=([\w-]{11})/);
    if (videoIdMatch && videoIdMatch[1]) {
      videoId = videoIdMatch[1];
    }

    if (!videoId) {
      return {
        statusCode: 444,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No YouTube video found for query' })
      };
    }

    // Attempt to extract title with multiple fallback patterns
    let title = null;
    const titleMatch = html.match(/"title":\s*\{\s*"runs":\s*\[\s*\{\s*"text":\s*"([^"]+)"/) ||
                       html.match(/"title":\s*\{\s*"simpleText":\s*"([^"]+)"/) ||
                       html.match(/<meta name="title" content="([^"]+)">/);
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1];
    }
    if (!title || title.trim() === '') {
      const pageTitleMatch = html.match(/<title>(.*?) - YouTube<\/title>/);
      title = (pageTitleMatch && pageTitleMatch[1]) ? pageTitleMatch[1] : (query || 'YouTube Video');
    }

    // Attempt to extract uploader / channel with multiple fallback patterns
    let uploader = 'YouTube';
    const uploaderMatch = html.match(/"ownerText":\s*\{\s*"runs":\s*\[\s*\{\s*"text":\s*"([^"]+)"/) ||
                          html.match(/"longBylineText":\s*\{\s*"runs":\s*\[\s*\{\s*"text":\s*"([^"]+)"/) ||
                          html.match(/"shortBylineText":\s*\{\s*"runs":\s*\[\s*\{\s*"text":\s*"([^"]+)"/);
    if (uploaderMatch && uploaderMatch[1]) {
      uploader = uploaderMatch[1];
    }

    // Attempt to extract duration in seconds
    let duration = 0;
    const lengthSecMatch = html.match(/"lengthSeconds":"(\d+)"/);
    if (lengthSecMatch && lengthSecMatch[1]) {
      duration = parseInt(lengthSecMatch[1], 10);
    }
    if (!duration || isNaN(duration)) {
      const lengthTextMatch = html.match(/"lengthText":\s*\{\s*"accessibility":\s*\{[^}]*\}\s*,\s*"simpleText":\s*"([^"]+)"\}/) ||
                              html.match(/"lengthText":\s*\{\s*"simpleText":\s*"([^"]+)"\}/);
      if (lengthTextMatch && lengthTextMatch[1]) {
        const parts = lengthTextMatch[1].split(':').map(p => parseInt(p, 10));
        if (parts.length === 2) duration = parts[0] * 60 + parts[1];
        else if (parts.length === 3) duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
    }

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({
        videoId: videoId,
        title: title,
        uploader: uploader,
        coverUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        duration: (duration && !isNaN(duration)) ? duration : 0
      })
    };
  } catch (error) {
    console.error('YouTube Search Netlify Function Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to search YouTube', details: error.message })
    };
  }
};
