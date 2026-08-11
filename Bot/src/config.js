require('dotenv').config();

const BEARER_TOKEN     = process.env.BEARER_TOKEN;
const BOT_COOKIE       = process.env.BOT_COOKIE;
const BOT_USERNAME     = process.env.BOT_USERNAME || "kickot_bot";
const KICK_CLIENT_ID     = process.env.KICK_CLIENT_ID;
const KICK_CLIENT_SECRET = process.env.KICK_CLIENT_SECRET;
const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_KEY;

// Nalog koji dobija vlasnicki rang (nivo 5) na SVAKOM kanalu (npr. za admin/support pristup).
// Ostavi prazno u .env ako ne zelis nikakav globalni super-admin nalog.
const SUPER_ADMIN_USERNAME = (process.env.SUPER_ADMIN_USERNAME || '').toLowerCase();

// Gist fallback (opciono)
const GIST_ID          = process.env.GIST_ID;
const GITHUB_TOKEN     = process.env.GITHUB_TOKEN;
const KORISTI_GIST     = !!(GIST_ID && GITHUB_TOKEN);

module.exports = {
    // Kredencijali i API detalji
    BEARER_TOKEN,
    BOT_COOKIE,
    BOT_USERNAME,
    KICK_CLIENT_ID,
    KICK_CLIENT_SECRET,
    SUPABASE_URL,
    SUPABASE_KEY,
    SUPER_ADMIN_USERNAME,
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
    ECONOMY_SAVE_INTERVAL_MS: 2 * 60 * 1000,
    LOVE_SAVE_INTERVAL_MS: 2 * 60 * 1000,
    WEATHER_TTL_MS: 5 * 60 * 1000,
    POINT_COOLDOWN_MS: 5000,
    SPAM_PENALTY_COOLDOWN_MS: 10 * 60 * 1000,
    LOVE_HATE_COOLDOWN_MS: 10 * 60 * 1000,

    // Fajl banze i keš
    LEADERBOARD_FILE: './leaderboard.json',
    LOVE_DATA_FILE: './love_data.json',

    // Pricing planovi i ograničenja
    PLAN_LIMITS: {
        free: {
            name: 'FREE',
            maxCustomCommands: 50,
            maxAutoAnnounces: 5,
            minCooldownMs: 1000,
            allowAdvancedModeration: false,
            allowSongRequest: true,
            allowStore: true,
            allowGambling: true,
            allowLove: true,
            allowWatchtime: true,
            allowLeaderboard: true,
            priority: 1
        },
        pro: {
            name: 'PRO',
            maxCustomCommands: 200,
            maxAutoAnnounces: 50,
            minCooldownMs: 1000,
            allowAdvancedModeration: true,
            allowSongRequest: true,
            allowStore: true,
            allowGambling: true,
            allowLove: true,
            allowWatchtime: true,
            allowLeaderboard: true,
            priority: 2
        },
        elite: {
            name: 'ELITE',
            maxCustomCommands: 999999,
            maxAutoAnnounces: 999999,
            minCooldownMs: 1000,
            allowAdvancedModeration: true,
            allowSongRequest: true,
            allowStore: true,
            allowGambling: true,
            allowLove: true,
            allowWatchtime: true,
            allowLeaderboard: true,
            allowAiResponses: true,
            priority: 3
        }
    }
};



