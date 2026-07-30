const config = require('./config');
const channels = {};

function getChannelState(chatroomId) {
    if (!chatroomId) return null;
    const id = String(chatroomId);
    if (!channels[id]) {
        channels[id] = {
            // Pricing Plan & Korisnički Podaci
            userId: null,
            userPlan: 'free',
            subscriptionStatus: 'active',
            planLimits: config.PLAN_LIMITS.free,

            // In-memory data
            leaderboard: {},
            leaderboardDeltas: {},
            loveModifiers: {},
            marriedCouples: {},
            watchtime: {},
            watchtimeDeltas: {},
            customCommands: {},
            autoAnnounces: [],
            botActive: false,

            // State / Trackers
            pendingProposals: {},
            lastPointEarned: {},
            cooldowns: {},
            lastWarned: {},
            spamTracker: {},
            rapidTracker: {},
            loveHateCooldowns: {},
            weatherCache: {},
            lastSpamPenalty: {},
            welcomedUsers: new Set(),
            warningsCount: new Map(),
            permits: new Map(),
            duplicateTracker: new Map(),
            moderationSettings: {},

            // Watchtime Trackers
            watchtimeDirty: false,
            watchtimeActiveViewers: new Set(),
            watchtimeLastSeen: {},

            // Flags i statusi
            leaderboardDirty: false,
            loveDirty: false,
            tekuciMesecLeaderboarda: '',
            isStreamLive: false,
            isFirstLiveCheck: true,
            manualGameName: '',
            manualStreamStartTs: 0,
            porukePosleAnnounce: 0,
            zadnjaAutoPorukaTs: 0,
            zadnjiAutoPorukaIdx: -1,
            cachedIgra: null,
            cachedIgraTs: 0,
            smart_chat_validation: true,

            // Dinamičke konfiguracione vrednosti iz baze
            PREFIX: '!',
            COOLDOWN_MS: 3000,
            SPAM_THRESHOLD: 3,
            SPAM_WINDOW_MS: 15000,
            STREAM_START_PIN_MESSAGE: '',
            welcome_message: '',
            feature_leaderboard: true,
            feature_watchtime: true,
            feature_games: true,
            feature_love: true,
            feature_moderation: false,
            feature_autoresponse: true,
            feature_songrequest: false,
            songrequest_settings: {},

            // Ekonomija, Nivoi & Kockanje
            currency_name: 'KickCoins',
            xp_per_msg: 15,
            points_per_msg: 5,
            xp_per_watchtime: 50,
            points_per_watchtime: 20,
            level_up_announce: true,
            gamble_enabled: true,
            max_gamble_amount: 5000,
            store_enabled: true,
            store_items: [],
            store_redemptions: [],
            pendingDuels: {},

            announce_interval_mins: 15,
            announce_message_threshold: 30,
            announce_time_enabled: true,
            announce_msg_enabled: true,

            // Naziv kanala
            channelUsername: '',

            // Slanje poruka red
            isProcessingQueue: false,
            messageQueue: [],

            // Kanalski tajmeri
            leaderboardSaveTimer: null,
            loveSaveTimer: null,
            watchtimeSaveTimer: null,
            autoAnnounceTimer: null
        };
    }
    return channels[id];
}

module.exports = {
    channels,
    getChannelState,

    // Globalni WebSocket i statusi konekcije
    ws: null,
    isConnected: false,
    reconnectAttempt: 0,
    heartbeatTimer: null,
    watchtimeTickTimer: null
};


