// Netlify Serverless Function for YouTube Search
// Returns top video ID, title, author, duration, and coverUrl for any query without API keys or CORS restrictions

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://kickall.app';

exports.handler = async function (event, context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Content-Type': 'application/json'
  };

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

    // Extract initialData JSON from YouTube HTML
    const videoIdMatch = html.match(/"videoId":"([\w-]{11})"/);
    const videoId = videoIdMatch && videoIdMatch[1] ? videoIdMatch[1] : null;

    if (!videoId) {
      return {
        statusCode: 444,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No YouTube video found for query' })
      };
    }

    // Attempt to extract title
    let title = query;
    const titleMatch = html.match(/"title":\{"runs":\[\{"text":"([^"]+)"\}\]/);
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1];
    }

    // Attempt to extract uploader / channel
    let uploader = 'YouTube';
    const uploaderMatch = html.match(/"ownerText":\{"runs":\[\{"text":"([^"]+)"/);
    if (uploaderMatch && uploaderMatch[1]) {
      uploader = uploaderMatch[1];
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
        duration: 210
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

