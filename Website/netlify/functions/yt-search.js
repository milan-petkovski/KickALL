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
    async function checkEmbedStatus(id) {
      if (!id) return { ok: false, status: 400, data: null };
      try {
        const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`, {
          signal: AbortSignal.timeout(2000)
        });
        const data = res.ok ? await res.json() : null;
        return { ok: res.ok, status: res.status, data };
      } catch (_) {
        return { ok: false, status: 500, data: null };
      }
    }

    let directVideoId = null;
    const directMatch = query.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/) ||
                        (query.length === 11 && /^[\w-]{11}$/.test(query) ? [null, query] : null);
    if (directMatch && directMatch[1]) {
      directVideoId = directMatch[1];
    }

    let searchQuery = query;

    if (directVideoId) {
      const directCheck = await checkEmbedStatus(directVideoId);
      if (directCheck.ok) {
        let duration = 0;
        try {
          const wRes = await fetch(`https://www.youtube.com/watch?v=${directVideoId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(3000)
          });
          if (wRes.ok) {
            const wHtml = await wRes.text();
            const wApprox = wHtml.match(/"approxDurationMs":"(\d+)"/);
            if (wApprox && wApprox[1]) {
              duration = Math.round(parseInt(wApprox[1], 10) / 1000);
            } else {
              const wSec = wHtml.match(/"lengthSeconds":"(\d+)"/);
              if (wSec && wSec[1]) duration = parseInt(wSec[1], 10);
            }
          }
        } catch (_) {}

        return {
          statusCode: 200,
          headers: {
            ...corsHeaders,
            'Access-Control-Allow-Headers': 'Content-Type'
          },
          body: JSON.stringify({
            videoId: directVideoId,
            title: directCheck.data ? directCheck.data.title : query,
            uploader: directCheck.data ? directCheck.data.author_name : 'YouTube',
            coverUrl: `https://img.youtube.com/vi/${directVideoId}/hqdefault.jpg`,
            duration: (duration && !isNaN(duration)) ? duration : 0
          })
        };
      } else {
        // Direct video has embedding disabled (401) or is inaccessible
        try {
          const wRes = await fetch(`https://www.youtube.com/watch?v=${directVideoId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(3000)
          });
          if (wRes.ok) {
            const wHtml = await wRes.text();
            const tMatch = wHtml.match(/<title>(.*?)(?:\s*-\s*YouTube)?<\/title>/);
            if (tMatch && tMatch[1]) searchQuery = tMatch[1].trim();
          }
        } catch (_) {}
      }
    }

    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
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

    // Extract all candidate video IDs
    const idRegex = /"videoId":"([\w-]{11})"/g;
    const candidates = [];
    let m;
    while ((m = idRegex.exec(html)) !== null) {
      if (!candidates.includes(m[1]) && m[1] !== 'dQw4w9WgXcQ' && m[1] !== directVideoId) {
        candidates.push(m[1]);
      }
    }

    if (candidates.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No YouTube video found for query' })
      };
    }

    let selectedId = null;
    let selectedTitle = '';
    let selectedUploader = 'YouTube';
    let selectedDuration = 0;

    // Check candidate videos for embed permission via oEmbed (prevents Error 150)
    for (const candId of candidates.slice(0, 7)) {
      const chk = await checkEmbedStatus(candId);
      if (chk.ok) {
        selectedId = candId;
        selectedTitle = chk.data?.title || '';
        selectedUploader = chk.data?.author_name || 'YouTube';

        // Extract duration from the search HTML chunk near this candidate
        const pos = html.indexOf(candId);
        if (pos !== -1) {
          const chunk = html.substring(pos, pos + 3000);
          const durMatch = chunk.match(/"lengthText":\{.*?"simpleText":"(\d+:\d+(?::\d+)?)"\}/s);
          if (durMatch && durMatch[1]) {
            const parts = durMatch[1].split(':').map(p => parseInt(p, 10));
            if (parts.length === 2) selectedDuration = parts[0] * 60 + parts[1];
            else if (parts.length === 3) selectedDuration = parts[0] * 3600 + parts[1] * 60 + parts[2];
          }
        }
        break;
      }
    }

    // Fallback if none in top candidates passed oEmbed
    if (!selectedId) {
      selectedId = candidates[0];
    }

    // If title or duration still missing, fetch watch page
    if ((!selectedDuration || selectedDuration === 0 || !selectedTitle) && selectedId) {
      try {
        const watchRes = await fetch(`https://www.youtube.com/watch?v=${selectedId}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          signal: AbortSignal.timeout(3000)
        });
        if (watchRes.ok) {
          const watchHtml = await watchRes.text();
          if (!selectedDuration || selectedDuration === 0) {
            const wApprox = watchHtml.match(/"approxDurationMs":"(\d+)"/);
            if (wApprox && wApprox[1]) {
              selectedDuration = Math.round(parseInt(wApprox[1], 10) / 1000);
            } else {
              const wSec = watchHtml.match(/"lengthSeconds":"(\d+)"/);
              if (wSec && wSec[1]) {
                selectedDuration = parseInt(wSec[1], 10);
              }
            }
          }
          if (!selectedTitle) {
            const pageTitleMatch = watchHtml.match(/<title>(.*?)(?:\s*-\s*YouTube)?<\/title>/);
            if (pageTitleMatch && pageTitleMatch[1]) selectedTitle = pageTitleMatch[1].trim();
          }
        }
      } catch (_) { }
    }

    if (!selectedTitle) {
      selectedTitle = searchQuery || 'YouTube Track';
    }

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({
        videoId: selectedId,
        title: selectedTitle,
        uploader: selectedUploader,
        coverUrl: `https://img.youtube.com/vi/${selectedId}/hqdefault.jpg`,
        duration: (selectedDuration && !isNaN(selectedDuration)) ? selectedDuration : 0
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
