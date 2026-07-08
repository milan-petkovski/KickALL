module.exports = {
    // In-memory data
    leaderboard: {},
    leaderboardDeltas: {},
    loveModifiers: {},
    marriedCouples: {},
    watchtime: {},
    watchtimeDeltas: {},

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
    reconnectAttempt: 0,
    isConnected: false,
    ws: null,

    // Slanje poruka red
    isProcessingQueue: false,
    messageQueue: [],

    // Timers
    leaderboardSaveTimer: null,
    loveSaveTimer: null,
    heartbeatTimer: null,
    watchtimeSaveTimer: null,
    watchtimeTickTimer: null
};

