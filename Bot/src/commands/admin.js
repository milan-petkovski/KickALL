const state = require('../state');
const { log, dobijTrenutniMesec } = require('../utils');
const { supabase, KORISTI_SUPABASE, sacuvajLeaderboard } = require('../database');
const { posaljiPoruku } = require('../messenger');

async function handleResetLeaderboard(chatroomId, user, isAuthorized) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    if (!isAuthorized) {
        posaljiPoruku(chatroomId, `❌ @${user}, nemaš dozvolu.`);
        return;
    }

    channelState.leaderboard = {};
    channelState.leaderboardDirty = false;

    if (KORISTI_SUPABASE && supabase) {
        try {
            const { error } = await supabase
                .from('leaderboard')
                .delete()
                .eq('channel_id', chatroomId)
                .eq('month', dobijTrenutniMesec());

            if (error) throw error;
            log('INFO', `[${channelState.channelUsername || chatroomId}] Leaderboard uspešno resetovan u Supabase za mesec ${dobijTrenutniMesec()}`);
        } catch (err) {
            log('ERR', `Greška pri resetovanju leaderboarda u Supabase za ${chatroomId}: ${err.message}`);
        }
    } else {
        channelState.leaderboardDirty = true;
        await sacuvajLeaderboard(chatroomId);
    }
    posaljiPoruku(chatroomId, '🔄 Leaderboard je uspešno resetovan za ovaj mesec!');
}

async function handleOsvezi(chatroomId, sender, isAuthorized) {
    if (!isAuthorized) {
        posaljiPoruku(chatroomId, `❌ @${sender}, nemaš dozvolu za ovu komandu.`);
        return;
    }

    try {
        const database = require('../database');
        const watchtime = require('../watchtime');

        await Promise.allSettled([
            database.ucitajLeaderboard(chatroomId),
            database.ucitajLjubav(chatroomId),
            watchtime.ucitajWatchtime(chatroomId),
            database.ucitajCustomKomande(chatroomId),
            database.ucitajBotConfig(chatroomId)
        ]);

        posaljiPoruku(chatroomId, '✅ Svi podaci (leaderboard, watchtime, ljubav, custom komande, bot config) su uspešno osveženi direktno iz baze! 🚀');
    } catch (err) {
        log('ERR', `handleOsvezi greška za kanal ${chatroomId}: ${err.message}`);
        posaljiPoruku(chatroomId, `❌ Greška pri osvežavanju podataka. Pokušaj ponovo za koji trenutak.`);
    }
}

function handlePermit(chatroomId, sender, targetRaw, senderObj) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const userKey = sender.toLowerCase();
    const isStreamer = userKey === channelState.channelUsername.toLowerCase();
    const identity = senderObj && senderObj.identity ? senderObj.identity : {};
    const badges = identity.badges || [];
    const isMod = badges.some(b => b.type === 'moderator' || b.type === 'broadcaster') || isStreamer;

    if (!isMod) {
        posaljiPoruku(chatroomId, `❌ @${sender}, samo moderatori mogu dati dozvolu za linkove.`);
        return;
    }

    const target = targetRaw.split(/\s+/)[0].replace(/^@/, '').trim();
    if (!target) {
        posaljiPoruku(chatroomId, `⚠️ Unesi korisničko ime. Primer: !permit @korisnik`);
        return;
    }

    if (!channelState.permits) {
        channelState.permits = new Map();
    }

    channelState.permits.set(target.toLowerCase(), Date.now());
    posaljiPoruku(chatroomId, `✅ Korisniku @${target} je dozvoljeno da pošalje jedan link u narednih 60 sekundi.`);
}

async function handleAddCommand(chatroomId, sender, textRaw, senderObj) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const userKey = sender.toLowerCase();
    const isStreamer = userKey === channelState.channelUsername.toLowerCase();
    const identity = senderObj && senderObj.identity ? senderObj.identity : {};
    const badges = identity.badges || [];
    const isMod = badges.some(b => b.type === 'moderator' || b.type === 'broadcaster') || isStreamer;

    if (!isMod) {
        posaljiPoruku(chatroomId, `❌ @${sender}, samo moderatori i strimer mogu dodavati custom komande.`);
        return;
    }

    if (!textRaw || !textRaw.trim()) {
        posaljiPoruku(chatroomId, `⚠️ Upotreba: !dodajkomandu !komanda Odgovor (ili !addcom !komanda Odgovor) — npr. !addcom !ig Instagram: @mojprofile`);
        return;
    }

    const parts = textRaw.trim().split(/\s+/);
    let cmdName = parts[0].toLowerCase();
    if (!cmdName.startsWith('!')) cmdName = '!' + cmdName;

    const responseText = parts.slice(1).join(' ');
    if (!responseText) {
        posaljiPoruku(chatroomId, `⚠️ Unesite tekst odgovora za komandu ${cmdName}.`);
        return;
    }

    const currentCount = Object.keys(channelState.customCommands || {}).length;
    const maxAllowed = channelState.planLimits?.maxCustomCommands || 5;

    if (currentCount >= maxAllowed) {
        posaljiPoruku(chatroomId, `❌ Dostignut je maksimum od ${maxAllowed} custom komandi za ${channelState.userPlan.toUpperCase()} paket. Unapredi paket na Kickot Dashboard-u!`);
        return;
    }

    if (!channelState.userId) {
        posaljiPoruku(chatroomId, `❌ @${sender}, kanal još nije povezan sa nalogom preko Kickot Dashboard-a. Kontaktiraj podršku ili ponovo poveži kanal.`);
        log('ERR', `handleAddCommand: channelState.userId je null/undefined za kanal ${chatroomId} (@${channelState.channelUsername}). Prekidam pre insert-a da izbegnem NOT NULL violation.`);
        return;
    }

    const database = require('../database');
    if (database.KORISTI_SUPABASE && database.supabase) {
        try {
            const cleanCmdName = cmdName.slice(1);

            const { data: existing } = await database.supabase
                .from('custom_commands')
                .select('id')
                .eq('channel_id', chatroomId)
                .eq('command', cleanCmdName)
                .maybeSingle();

            if (existing && existing.id) {
                const { error: updateErr } = await database.supabase
                    .from('custom_commands')
                    .update({
                        response: responseText,
                        cooldown: channelState.planLimits?.minCooldownMs || 3000,
                        enabled: true,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existing.id);

                if (updateErr) throw updateErr;
            } else {
                const { error: insertErr } = await database.supabase
                    .from('custom_commands')
                    .insert({
                        user_id: channelState.userId,
                        channel_id: chatroomId,
                        command: cleanCmdName,
                        response: responseText,
                        cooldown: channelState.planLimits?.minCooldownMs || 3000,
                        enabled: true,
                        min_rank: 'everyone',
                        is_default: false,
                        created_at: new Date().toISOString()
                    });

                if (insertErr) throw insertErr;
            }

            await database.ucitajCustomKomande(chatroomId);
            posaljiPoruku(chatroomId, `✅ Custom komanda ${cmdName} je uspešno dodata!`);
        } catch (err) {
            log('ERR', `handleAddCommand greška za kanal ${chatroomId}: ${err.message}`);
            posaljiPoruku(chatroomId, `❌ Greška pri čuvanju komande. Pokušaj ponovo, a ako se ponavlja javi se podršci.`);
        }
    } else {
        posaljiPoruku(chatroomId, `❌ Supabase baza nije dostupna.`);
    }
}

async function handleDelCommand(chatroomId, sender, cmdRaw, senderObj) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    const userKey = sender.toLowerCase();
    const isStreamer = userKey === channelState.channelUsername.toLowerCase();
    const identity = senderObj && senderObj.identity ? senderObj.identity : {};
    const badges = identity.badges || [];
    const isMod = badges.some(b => b.type === 'moderator' || b.type === 'broadcaster') || isStreamer;

    if (!isMod) {
        posaljiPoruku(chatroomId, `❌ @${sender}, samo moderatori i strimer mogu brisati custom komande.`);
        return;
    }

    if (!cmdRaw || !cmdRaw.trim()) {
        posaljiPoruku(chatroomId, `⚠️ Upotreba: !obrisikomandu !komanda (ili !delcom !komanda) — npr. !delcom !ig`);
        return;
    }

    let cmdName = cmdRaw.trim().toLowerCase();
    if (cmdName.startsWith('!')) cmdName = cmdName.slice(1);

    const database = require('../database');
    if (database.KORISTI_SUPABASE && database.supabase) {
        try {
            const { data: deleted, error } = await database.supabase
                .from('custom_commands')
                .delete()
                .eq('channel_id', chatroomId)
                .eq('command', cmdName)
                .select('id');

            if (error) throw error;

            if (!deleted || deleted.length === 0) {
                posaljiPoruku(chatroomId, `⚠️ Komanda !${cmdName} nije pronađena.`);
                return;
            }

            await database.ucitajCustomKomande(chatroomId);
            posaljiPoruku(chatroomId, `✅ Custom komanda !${cmdName} je uspešno obrisana.`);
        } catch (err) {
            log('ERR', `handleDelCommand greška za kanal ${chatroomId}: ${err.message}`);
            posaljiPoruku(chatroomId, `❌ Greška pri brisanju komande. Pokušaj ponovo, a ako se ponavlja javi se podršci.`);
        }
    } else {
        posaljiPoruku(chatroomId, `❌ Supabase baza nije dostupna.`);
    }
}

module.exports = {
    handleResetLeaderboard,
    handleOsvezi,
    handlePermit,
    handleAddCommand,
    handleDelCommand
};
