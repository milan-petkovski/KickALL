const state = require('../state');
const { isValidUsername, sanitizeInput } = require('../utils');
const { posaljiPoruku } = require('../messenger');

function handleStoreList(chatroomId) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    if (channelState.planLimits && channelState.planLimits.allowStore === false) {
        posaljiPoruku(chatroomId, `🛍️ Prodavnica je dostupna u PRO i ELITE paketima.`);
        return;
    }

    if (channelState.store_enabled === false) {
        posaljiPoruku(chatroomId, `🛍️ Prodavnica je trenutno zatvorena.`);
        return;
    }

    const items = channelState.store_items || [];
    if (items.length === 0) {
        posaljiPoruku(chatroomId, `🛍️ Trenutno nema dostupnih artikala u prodavnici!`);
        return;
    }

    const economyMod = require('../economy');
    const valuta = economyMod.dobijNazivValute(channelState);
    const lista = items.slice(0, 5).map(item => `[${item.name} - ${item.cost} ${valuta}]`).join(' | ');
    posaljiPoruku(chatroomId, `🛍️ Prodavnica Kanala: ${lista} — Ukucaj !kupi <naziv nagrade> za kupovinu!`);
}

function handleRedeemStore(chatroomId, sender, itemQueryRaw) {
    const channelState = state.getChannelState(chatroomId);
    if (!channelState) return;

    if (channelState.planLimits && channelState.planLimits.allowStore === false) {
        posaljiPoruku(chatroomId, `🛍️ Prodavnica je dostupna u PRO i ELITE paketima.`);
        return;
    }

    if (channelState.store_enabled === false) {
        posaljiPoruku(chatroomId, `🛍️ Prodavnica je trenutno zatvorena.`);
        return;
    }

    if (!itemQueryRaw || !itemQueryRaw.trim()) {
        posaljiPoruku(chatroomId, `🛍️ Upotreba: !kupi <naziv nagrade> — Unesi tačan naziv artikla iz prodavnice.`);
        return;
    }

    if (!isValidUsername(sender)) return;
    const cleanSender = sanitizeInput(sender);
    const key = cleanSender.toLowerCase();

    const items = channelState.store_items || [];
    const query = itemQueryRaw.trim().toLowerCase();
    const item = items.find(i => i.name.toLowerCase() === query || i.name.toLowerCase().includes(query));

    if (!item) {
        posaljiPoruku(chatroomId, `❌ Nagrada pod nazivom "${itemQueryRaw}" nije pronađena u prodavnici.`);
        return;
    }

    const economyMod = require('../economy');
    const valuta = economyMod.dobijNazivValute(channelState);
    const userEcon = channelState.economy[key];
    const trenutniPoeni = userEcon ? (userEcon.coins || 0) : 0;

    if (trenutniPoeni < item.cost) {
        posaljiPoruku(chatroomId, `@${cleanSender}, nemas dovoljno poena za "${item.name}"! Potrebno: ${item.cost} ${valuta}, a imas: ${trenutniPoeni} ${valuta}.`);
        return;
    }

    // Oduzmi poene
    userEcon.coins -= item.cost;
    channelState.economyDirty = true;
    channelState.economyDeltas.add(key);

    // Zabeleži redemption za Dashboard
    if (!channelState.store_redemptions) channelState.store_redemptions = [];
    const redemption = {
        id: 'red_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        username: cleanSender,
        item_id: item.id || item.name,
        item_name: item.name,
        cost: item.cost,
        status: 'pending',
        requested_at: new Date().toISOString()
    };
    channelState.store_redemptions.unshift(redemption);

    posaljiPoruku(chatroomId, `🎉 @${cleanSender} je kupio "${item.name}" za ${item.cost} ${valuta}! Vaš zahtev je poslat streamer-u na odobrenje! 🚀`);
}

module.exports = {
    handleStoreList,
    handleRedeemStore
};
