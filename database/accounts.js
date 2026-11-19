require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const config = require('../config.json');
const hashCompare = require('../utils/hashCompare');

const supabaseUrl = process.env.SUPABASEURL;
const supabaseKey = process.env.SUPABASEKEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASEURL or SUPABASEKEY environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const accountSlots = config.slots || {};

// Update database records.
async function updateDB(table, data, column, value) {
    const { data: updatedData, error } = await supabase
        .from(table)
        .update(data)
        .eq(column, value)
        .select();

    if (error) throw error;

    return updatedData;
}

// Create a new account.
async function addToDb(discord_id, master_password, license) {
    const existingAccount = await checkAccount(discord_id);

    if (existingAccount) return false;

    const slots = accountSlots[license] ?? 0;

    const { error } = await supabase
        .from('accounts')
        .insert([{
            discord_id,
            master_password,
            license: license ?? null,
            slots,
            uses: {},
            main_accounts: {},
            total_usage: {},
            custom_slots: false
        }]);

    if (error) {
        if (error.code === '23505') return false;
        throw error;
    }

    return true;
}

// Reset usage for all accounts.
async function resetAllUses() {
    const { data, error } = await supabase
        .from('accounts')
        .update({ uses: {} })
        .not('discord_id', 'is', null)
        .select();

    if (error) throw error;

    return data;
}

// Retrieve account audit information.
async function getAudit() {
    const { data, error } = await supabase
        .from('accounts')
        .select('discord_id, license, free_trial_start');

    if (error) throw error;

    return data;
}

// Remove a main account.
async function removeMainAccount(discordId, platform) {
    const { data, error } = await supabase
        .from('accounts')
        .select('main_accounts')
        .eq('discord_id', discordId)
        .maybeSingle();

    if (error) throw error;
    if (!data) return false;

    const currentAccounts = data.main_accounts || {};

    if (!currentAccounts[platform]) return false;

    delete currentAccounts[platform];

    await updateDB(
        'accounts',
        { main_accounts: currentAccounts },
        'discord_id',
        discordId
    );

    return true;
}

// Check whether a main account is already used.
async function checkDuplicatesMainAccounts(
    platform,
    accountId,
    discordId,
    checkSelf = false
) {
    const { data, error } = await supabase
        .from('accounts')
        .select('discord_id, main_accounts');

    if (error) throw error;

    for (const row of data || []) {
        const mainAccounts = row.main_accounts || {};

        if (
            mainAccounts[platform] &&
            (checkSelf || row.discord_id !== discordId)
        ) {
            const isMatch = await hashCompare(
                accountId,
                mainAccounts[platform]
            );

            if (isMatch) {
                return row.discord_id;
            }
        }
    }

    return null;
}

// Add a main account.
async function addMainAccount(discord_id, platform, accountId) {
    const account = await checkAccount(discord_id);

    if (!account) return false;

    const mainAccounts = account.main_accounts || {};

    if (mainAccounts[platform]) return false;

    mainAccounts[platform] = accountId;

    await updateDB(
        'accounts',
        { main_accounts: mainAccounts },
        'discord_id',
        discord_id
    );

    return true;
}

// Activate a free trial.
async function activateFreeTrial(discord_id) {
    const account = await checkAccount(discord_id);

    if (!account) return false;
    if (account.free_trial_start) return false;

    const { data, error } = await supabase
        .from('accounts')
        .update({
            free_trial_start: new Date().toISOString()
        })
        .eq('discord_id', discord_id)
        .is('free_trial_start', null)
        .select('discord_id')
        .maybeSingle();

    if (error) throw error;

    return Boolean(data);
}

// Clear a specific service from all main accounts.
async function clearSpecificService(service) {
    const { data: accounts, error } = await supabase
        .from('accounts')
        .select('discord_id, main_accounts');

    if (error) throw error;

    const updates = (accounts || []).map(async account => {
        const mainAccounts = account.main_accounts || {};

        if (mainAccounts[service]) {
            delete mainAccounts[service];

            await updateDB(
                'accounts',
                { main_accounts: mainAccounts },
                'discord_id',
                account.discord_id
            );
        }
    });

    await Promise.all(updates);
}

// Find an account by Discord ID.
// Only update the rank when a real rank is supplied.
async function checkAccount(discord_id, license) {
    const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('discord_id', discord_id)
        .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    if (license !== undefined && license !== null && data.license !== license) {
        const dataToChange = {
            license
        };

        const configuredSlots = accountSlots[license];

        if (
            !data.custom_slots &&
            Number.isFinite(configuredSlots) &&
            data.slots !== configuredSlots
        ) {
            dataToChange.slots = configuredSlots;
        }

        await updateDB(
            'accounts',
            dataToChange,
            'discord_id',
            discord_id
        );

        data.license = license;

        if (dataToChange.slots !== undefined) {
            data.slots = dataToChange.slots;
        }
    }

    return data;
}

// Update account usage statistics.
async function updateStats(discord_id, platform, time_saved) {
    const account = await checkAccount(discord_id);

    if (!account) {
        throw new Error(`No account found for Discord ID ${discord_id}`);
    }

    if (!account.total_usage) {
        account.total_usage = {};
    }

    if (!account.total_usage[platform]) {
        account.total_usage[platform] = {
            total_uses: 0,
            time_saved: 0
        };
    }

    account.total_usage[platform].total_uses += 1;
    account.total_usage[platform].time_saved += Number(time_saved) || 0;

    await updateDB(
        'accounts',
        { total_usage: account.total_usage },
        'discord_id',
        discord_id
    );
}

// Set a database column back to its default.
async function setDefault(table, column) {
    const { error } = await supabase.rpc('set_column_to_default', {
        table_name: table,
        column_name: column
    });

    if (error) throw error;
}

module.exports = {
    addToDb,
    setDefault,
    updateDB,
    updateStats,
    removeMainAccount,
    getAudit,
    clearSpecificService,
    resetAllUses,
    checkDuplicatesMainAccounts,
    checkAccount,
    addMainAccount,
    activateFreeTrial
};
