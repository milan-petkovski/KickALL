// Modul za automatsku detekciju i zaštitu od masovnih napada i racija (Raid Defense)

const RAID_WINDOW_MS = 8000;            // 8 sekundi klizeći prozor za detekciju
const RAID_TRIGGER_NEW_USERS = 12;      // 12 novih nepoznatih korisnika u 8 sekundi
const RAID_MODE_DURATION_MS = 60000;    // 60 sekundi trajanja odbrane nakon detekcije

class RaidDefenseManager {
    constructor() {
        this.channelActivity = new Map();
    }

    getChannelData(chatroomId) {
        if (!this.channelActivity.has(chatroomId)) {
            this.channelActivity.set(chatroomId, {
                recentSenders: [],
                isRaidActive: false,
                raidUntil: 0,
                knownUsers: new Set()
            });
        }
        return this.channelActivity.get(chatroomId);
    }

    /**
     * Proverava dolaznu poruku.
     * Vraća true ako je poruka blokirana i odbačena zbog aktivne zaštite od racije.
     */
    proveriRaidPoruku(chatroomId, username, senderObj, channelUsername) {
        if (!chatroomId || !username) return false;

        const now = Date.now();
        const data = this.getChannelData(chatroomId);
        const userKey = username.toLowerCase();

        // 1. Provera statusa odbrane: ako je vreme isteklo, ugasi Raid režim
        if (data.isRaidActive && now >= data.raidUntil) {
            data.isRaidActive = false;
            const utils = require('./utils');
            utils.log('INFO', `[${channelUsername || chatroomId}] [RAID DEFENSE] Racija završena. Bot se vratio u normalan rad.`);
        }

        // 2. Proveri bedževe: Moderatori, strimer, VIP, OG, Subscriber nikada nisu blokirani
        const identity = senderObj && senderObj.identity ? senderObj.identity : {};
        const badges = identity.badges || (Array.isArray(senderObj?.badges) ? senderObj.badges : (senderObj?.sender?.identity?.badges || []));
        const isTrusted = badges.some(b => b.type === 'moderator' || b.type === 'broadcaster' || b.type === 'vip' || b.type === 'og' || b.type === 'subscriber' || b.type === 'sub') ||
                          userKey === (channelUsername || '').toLowerCase();

        if (isTrusted) {
            data.knownUsers.add(userKey);
            return false;
        }

        // 3. Da li je korisnik već viđen u ovoj sesiji pre racije?
        const isAlreadyKnown = data.knownUsers.has(userKey);

        if (!isAlreadyKnown) {
            data.recentSenders.push({ username: userKey, ts: now });
            data.knownUsers.add(userKey);

            // Bounded set zaštita od curenja memorije
            if (data.knownUsers.size > 8000) {
                const toDelete = Array.from(data.knownUsers).slice(0, 2000);
                for (const u of toDelete) data.knownUsers.delete(u);
            }
        }

        // Čišćenje starih unosa iz klizećeg prozora
        data.recentSenders = data.recentSenders.filter(s => now - s.ts < RAID_WINDOW_MS);

        // 4. Detekcija racije na osnovu naglog priliva novih korisnika
        if (data.recentSenders.length >= RAID_TRIGGER_NEW_USERS) {
            const utils = require('./utils');
            if (!data.isRaidActive) {
                data.isRaidActive = true;
                data.raidUntil = now + RAID_MODE_DURATION_MS;
                utils.log('WARN', `[${channelUsername || chatroomId}] [RAID DEFENSE] Detektovan nagli priliv novih korisnika (${data.recentSenders.length} u ${RAID_WINDOW_MS / 1000}s). Aktiviran Raid Defense režim na ${RAID_MODE_DURATION_MS / 1000}s.`);
            } else {
                data.raidUntil = Math.max(data.raidUntil, now + RAID_MODE_DURATION_MS);
            }
        }

        // 5. Ako je Raid Mode aktivan:
        // Korisnici koji nisu imali poverljiv status i tek su se pojavili tokom racije se blokiraju
        if (data.isRaidActive && now < data.raidUntil && !isAlreadyKnown) {
            return true;
        }

        return false;
    }

    isRaidModeActive(chatroomId) {
        const data = this.channelActivity.get(chatroomId);
        if (!data) return false;
        if (data.isRaidActive && Date.now() >= data.raidUntil) {
            data.isRaidActive = false;
        }
        return data.isRaidActive;
    }

    resetChannel(chatroomId) {
        this.channelActivity.delete(chatroomId);
    }
}

const raidDefense = new RaidDefenseManager();

module.exports = raidDefense;
