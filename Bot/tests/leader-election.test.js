const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../src/state');
const database = require('../src/database');
const bot = require('../bot');

test('Leader Election & Distributed Lock Tests', async (t) => {
    const originalSupabase = database.supabase;
    const originalKoristiSupabase = database.KORISTI_SUPABASE;
    const originalIsLeader = state.isLeader;
    const originalInstanceId = state.instanceId;

    t.afterEach(() => {
        database.supabase = originalSupabase;
        database.KORISTI_SUPABASE = originalKoristiSupabase;
        state.isLeader = originalIsLeader;
        state.instanceId = originalInstanceId;
    });

    await t.test('Kandidat na startu ne prekida rad ako druga instanca drži aktivan lease', async () => {
        state.isLeader = false;
        state.instanceId = 'test-candidate-1';

        let mockLockData = {
            lock_id: 'primary_bot_leader',
            leader_instance_id: 'old-render-container',
            expires_at: new Date(Date.now() + 10000).toISOString()
        };

        database.KORISTI_SUPABASE = true;
        database.supabase = {
            from: (table) => {
                assert.equal(table, 'bot_cluster_lock');
                return {
                    select: () => ({
                        eq: () => ({
                            maybeSingle: async () => ({ data: mockLockData, error: null })
                        })
                    }),
                    update: () => ({
                        eq: async () => ({ error: null })
                    })
                };
            }
        };

        const result = await bot.acquireOrRenewLeaderLock();
        assert.equal(result, false, 'Kandidat treba da vrati false dok čeka istek');
        assert.equal(state.isLeader, false, 'Kandidat ne sme prerano postaviti isLeader');
    });

    await t.test('Preuzimanje vođstva kada prethodni lease istekne', async () => {
        state.isLeader = false;
        state.instanceId = 'test-candidate-2';

        let updatedTo = null;
        let mockLockData = {
            lock_id: 'primary_bot_leader',
            leader_instance_id: 'old-expired-instance',
            expires_at: new Date(Date.now() - 5000).toISOString() // Istekao pre 5s
        };

        database.KORISTI_SUPABASE = true;
        database.supabase = {
            from: (table) => ({
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({ data: mockLockData, error: null })
                    })
                }),
                update: (payload) => ({
                    eq: async () => {
                        updatedTo = payload.leader_instance_id;
                        return { error: null };
                    }
                })
            })
        };

        const result = await bot.acquireOrRenewLeaderLock();
        assert.equal(result, true, 'Treba uspešno osvojiti istekli lock');
        assert.equal(state.isLeader, true, 'Instanca postaje primarni lider');
        assert.equal(updatedTo, 'test-candidate-2', 'Baza je ažurirana novim ID-jem instance');
    });

    await t.test('Autoritativno preuzimanje sa opcijom force: true', async () => {
        state.isLeader = false;
        state.instanceId = 'test-deploy-replacement';

        let updatedTo = null;
        let mockLockData = {
            lock_id: 'primary_bot_leader',
            leader_instance_id: 'stuck-container',
            expires_at: new Date(Date.now() + 12000).toISOString() // Još aktivan lease
        };

        database.KORISTI_SUPABASE = true;
        database.supabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({ data: mockLockData, error: null })
                    })
                }),
                update: (payload) => ({
                    eq: async () => {
                        updatedTo = payload.leader_instance_id;
                        return { error: null };
                    }
                })
            })
        };

        const result = await bot.acquireOrRenewLeaderLock({ force: true });
        assert.equal(result, true, 'Force opcija mora autoritativno osvojiti lock');
        assert.equal(state.isLeader, true);
        assert.equal(updatedTo, 'test-deploy-replacement');
    });
});
