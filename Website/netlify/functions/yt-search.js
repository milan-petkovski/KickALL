// Netlify Serverless Function for YouTube Search
// Returns top video ID, title, author, duration, and coverUrl for any query without API keys or CORS restrictions

const { isRateLimited } = require('./utils/rate-limiter');

const ALLOWED_ORIGINS = [
  'https://kickall.app',
  'https://kickall.netlify.app',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

exports.handler = async function (event, _context) {
  const requestOrigin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : (process.env.ALLOWED_ORIGIN || 'https://kickall.app');

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowOrigin,
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

  if (query.length > 200) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Query too long (max 200 characters)' })
    };
  }

  try {
    let directVideoId = null;
    const directMatch = query.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/) ||
                        (query.length === 11 && /^[\w-]{11}$/.test(query) ? [null, query] : null);
    if (directMatch && directMatch[1]) {
      directVideoId = directMatch[1];
    }

    const searchUrl = directVideoId
      ? `https://www.youtube.com/watch?v=${directVideoId}`
      : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

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
    let videoId = directVideoId;
    if (!videoId) {
      const videoIdMatch = html.match(/"videoId":"([\w-]{11})"/) || html.match(/\/watch\?v=([\w-]{11})/);
      if (videoIdMatch && videoIdMatch[1]) {
        videoId = videoIdMatch[1];
      }
    }

    if (!videoId) {
      return {
        statusCode: 404,
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
    const approxDurMatch = html.match(/"approxDurationMs":"(\d+)"/);
    if (approxDurMatch && approxDurMatch[1]) {
      duration = Math.round(parseInt(approxDurMatch[1], 10) / 1000);
    }
    if (!duration || isNaN(duration)) {
      const lengthSecMatch = html.match(/"lengthSeconds":"(\d+)"/);
      if (lengthSecMatch && lengthSecMatch[1]) {
        duration = parseInt(lengthSecMatch[1], 10);
      }
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

    // Secondary fetch on watch page if duration was not found on search results
    if ((!duration || duration === 0) && videoId) {
      try {
        const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          signal: AbortSignal.timeout(3000)
        });
        if (watchRes.ok) {
          const watchHtml = await watchRes.text();
          const wApprox = watchHtml.match(/"approxDurationMs":"(\d+)"/);
          if (wApprox && wApprox[1]) {
            duration = Math.round(parseInt(wApprox[1], 10) / 1000);
          } else {
            const wSec = watchHtml.match(/"lengthSeconds":"(\d+)"/);
            if (wSec && wSec[1]) {
              duration = parseInt(wSec[1], 10);
            }
          }
        }
      } catch (_) { }
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
