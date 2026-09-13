// Centralni re-eksportni modul za sve komande
// Komande su logički podeljene u src/commands/ podmodule radi lakšeg održavanja i performansi.

const funCommands = require('./commands/fun');
const loveCommands = require('./commands/love');
const statsCommands = require('./commands/stats');
const adminCommands = require('./commands/admin');
const musicCommands = require('./commands/music');
const storeCommands = require('./commands/store');
const infoCommands = require('./commands/info');

module.exports = {
    // Info & general
    ...infoCommands,

    // Fun & mini games
    ...funCommands,

    // Love & marriage
    ...loveCommands,

    // Stats & leaderboard
    ...statsCommands,

    // Admin & config
    ...adminCommands,

    // Music & Song requests
    ...musicCommands,

    // Store & points redemption
    ...storeCommands
};
