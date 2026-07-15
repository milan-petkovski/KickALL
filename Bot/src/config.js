require('dotenv').config();

const CHATROOM_ID      = process.env.CHATROOM_ID;
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME;
const BEARER_TOKEN     = process.env.BEARER_TOKEN;
const BOT_COOKIE       = process.env.BOT_COOKIE;
const BOT_USERNAME     = process.env.BOT_USERNAME || "kickot_bot";
const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_KEY;

// Gist fallback (opciono)
const GIST_ID          = process.env.GIST_ID;
const GITHUB_TOKEN     = process.env.GITHUB_TOKEN;
const KORISTI_GIST     = !!(GIST_ID && GITHUB_TOKEN);

module.exports = {
    // Kredencijali i API detalji
    CHATROOM_ID,
    CHANNEL_USERNAME,
    BEARER_TOKEN,
    BOT_COOKIE,
    BOT_USERNAME,
    SUPABASE_URL,
    SUPABASE_KEY,
    GIST_ID,
    GITHUB_TOKEN,
    KORISTI_GIST,

    // Bot podešavanja
    COOLDOWN_MS: 3000,
    RECONNECT_BASE_MS: 3000,
    RECONNECT_MAX_MS: 60000,
    HEARTBEAT_MS: 25000,
    SPAM_THRESHOLD: 3,
    SPAM_WINDOW_MS: 15000,
    RAPID_MSG_THRESHOLD: 5,
    RAPID_MSG_WINDOW_MS: 8000,
    ANNOUNCE_AFTER_MSGS: 30,
    ANNOUNCE_MIN_GAP_MS: 15 * 60 * 1000,
    LEADERBOARD_SAVE_INTERVAL_MS: 1 * 60 * 1000,
    LOVE_SAVE_INTERVAL_MS: 2 * 60 * 1000,
    WEATHER_TTL_MS: 5 * 60 * 1000,
    POINT_COOLDOWN_MS: 5000,
    SPAM_PENALTY_COOLDOWN_MS: 10 * 60 * 1000,
    LOVE_HATE_COOLDOWN_MS: 10 * 60 * 1000,

    // Fajl banze i keš
    LEADERBOARD_FILE: './leaderboard.json',
    LOVE_DATA_FILE: './love_data.json',
};

