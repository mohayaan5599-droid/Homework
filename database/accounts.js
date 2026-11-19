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

// Replacement for the missing database/general.js updateDB function.
async function updateDB(table, data, column, value) {
    const { data: updatedData, error } = await supabase
        .from(table)
        .update(data)
        .eq(column, value)
        .select();

    if (error) throw error;

    return updatedData;
}

async function addToDb(discord_id, master_password, license) {
    if ((await checkAccount(discord_id)) !== null) return false;

    await supabase
        .from('accounts')
        .insert([{
            discord_id,
            master_password,
            license,
            slots: config.slots[license] ?? 0
        }])
        .throwOnError();

    return true;
}

async function resetAllUses() {
    const { data } = await supabase
        .from('accounts')
        .update({ uses: {} })
        .not('discord_id', 'is', null)
        .select()
        .throwOnError();

    return data;
}

async function getAudit() {
    const { data } = await supabase
        .from('accounts')
        .select('discord_id, license, free_trial_start')
        .throwOnError();

    return data;
}

async function removeMainAccount(discordId, platform) {
    const { data } = await supabase
        .from('accounts')
        .select('main_accounts')
        .eq('discord_id', discordId)
        .maybeSingle()
        .throwOnError();

    if (!data) return false;

    const currentAccounts = data.main_accounts || {};

    if (!currentAccounts[platform]) return false;

    delete currentAccounts[platform];

    await supabase
        .from('accounts')
        .update({ main_accounts: currentAccounts })
        .eq('discord_id', discordId)
        .throwOnError();

    return true;
}

async function checkDuplicatesMainAccounts(platform, accountId, discordId, checkSelf = false) {
    const { data } = await supabase
        .from('accounts')
        .select('discord_id, main_accounts')
        .throwOnError();

    let matchDiscordId = null;

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
                matchDiscordId = row.discord_id;
                break;
            }
        }
    }

    return matchDiscordId;
}

async function addMainAccount(discord_id, platform, accountId) {
    const account = await checkAccount(discord_id);

    if (!account) return false;

    const mainAccounts = account.main_accounts || {};

    if (mainAccounts[platform]) return false;

    mainAccounts[platform] = accountId;

    await supabase
        .from('accounts')
        .update({ main_accounts: mainAccounts })
        .eq('discord_id', discord_id)
        .throwOnError();

    return true;
}

async function activateFreeTrial(discord_id) {
    const account = await checkAccount(discord_id);

    if (!account) return false;
    if (account.free_trial_start !== null) return false;

    const { error } = await supabase
        .from('accounts')
        .update({ free_trial_start: new Date().toISOString() })
        .eq('discord_id', discord_id);

    if (error) {
        throw new Error(`Failed to activate free trial: ${error.message}`);
    }

    return true;
}

async function clearSpecificService(service) {
    const { data: accounts, error: fetchError } = await supabase
        .from('accounts')
        .select('discord_id, main_accounts');

    if (fetchError) throw fetchError;

    const updates = (accounts || []).map(async (account) => {
        const jsonData = account.main_accounts || {};

        if (jsonData[service]) {
            delete jsonData[service];

            await supabase
                .from('accounts')
                .update({ main_accounts: jsonData })
                .eq('discord_id', account.discord_id)
                .throwOnError();
        }
    });

    await Promise.all(updates);
}

async function checkAccount(discord_id, license) {
    const { data } = await supabase
        .from('accounts')
        .select('*')
        .eq('discord_id', discord_id)
        .maybeSingle()
        .throwOnError();

    if (!data) return null;

    if (license !== undefined && data.license !== license) {
        const dataToChange = { license };

        if (
            !data.custom_slots &&
            data.slots !== config.slots[license]
        ) {
            dataToChange.slots = config.slots[license];
        }

        await updateDB(
            'accounts',
            dataToChange,
            'discord_id',
            discord_id
        );

        if (Number.isFinite(dataToChange.slots)) {
            data.slots = dataToChange.slots;
        }

        data.license = license;
    }

    return data;
}

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
    account.total_usage[platform].time_saved += time_saved;

    await updateDB(
        'accounts',
        { total_usage: account.total_usage },
        'discord_id',
        discord_id
    );
}

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
