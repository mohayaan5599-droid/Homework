require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabaseUrl = process.env.SUPABASEURL;
const supabaseKey = process.env.SUPABASEKEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASEURL or SUPABASEKEY environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// AES-256-GCM encryption
// Format: salt(16) | iv(12) | tag(16) | ciphertext

function encrypt(plaintext, password) {
    if (!password) {
        throw new Error('A master password is required for encryption.');
    }

    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(password, salt, 32);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
    ]);

    const tag = cipher.getAuthTag();

    return Buffer.concat([
        salt,
        iv,
        tag,
        ciphertext
    ]).toString('base64');
}

function decrypt(payloadB64, password) {
    try {
        if (!payloadB64 || !password) return null;

        const data = Buffer.from(payloadB64, 'base64');

        if (data.length < 44) return null;

        const salt = data.subarray(0, 16);
        const iv = data.subarray(16, 28);
        const tag = data.subarray(28, 44);
        const ciphertext = data.subarray(44);

        const key = crypto.scryptSync(password, salt, 32);

        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            key,
            iv
        );

        decipher.setAuthTag(tag);

        const plaintext = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
        ]);

        return plaintext.toString('utf8');
    } catch {
        return null;
    }
}

// Get saved accounts
async function checkAccounts(discord_id, master_password) {
    const { data, error } = await supabase
        .from('accounts')
        .select('saved_accounts')
        .eq('discord_id', discord_id)
        .maybeSingle();

    if (error) {
        console.error('Error checking saved accounts:', error);
        throw error;
    }

    if (!data) {
        return null;
    }

    if (!data.saved_accounts) {
        return null;
    }

    const decryptedData = decrypt(
        data.saved_accounts,
        master_password
    );

    if (!decryptedData) {
        return false;
    }

    try {
        const accounts = JSON.parse(decryptedData);

        return Array.isArray(accounts) ? accounts : false;
    } catch (error) {
        console.error('Could not parse saved accounts:', error);
        return false;
    }
}

// Add a saved account
async function addAccount(discord_id, login_details, master_password) {
    if (!login_details || !master_password) {
        throw new Error('Login details and master password are required.');
    }

    const existingAccounts = await checkAccounts(
        discord_id,
        master_password
    );

    if (existingAccounts === false) {
        return false;
    }

    if (existingAccounts === null) {
        const { data: account, error: accountError } = await supabase
            .from('accounts')
            .select('discord_id')
            .eq('discord_id', discord_id)
            .maybeSingle();

        if (accountError) throw accountError;
        if (!account) return false;
    }

    const accounts = existingAccounts || [];

    if (accounts.length >= 25) {
        return false;
    }

    accounts.push(login_details);

    const encrypted = encrypt(
        JSON.stringify(accounts),
        master_password
    );

    const { error } = await supabase
        .from('accounts')
        .update({ saved_accounts: encrypted })
        .eq('discord_id', discord_id);

    if (error) {
        console.error('Error saving account:', error);
        throw error;
    }

    console.log('Saved account successfully.');

    return true;
}

// Replace all saved accounts
async function updateSavedAccounts(discord_id, newAccounts, master_password) {
    if (!Array.isArray(newAccounts) || !master_password) {
        throw new Error('Invalid saved accounts or master password.');
    }

    const encrypted = encrypt(
        JSON.stringify(newAccounts),
        master_password
    );

    const { error } = await supabase
        .from('accounts')
        .update({ saved_accounts: encrypted })
        .eq('discord_id', discord_id);

    if (error) {
        console.error('Error updating saved accounts:', error);
        throw error;
    }

    return true;
}

// Delete saved accounts WITHOUT deleting the user's main account
async function deleteAccounts(discord_id) {
    const { error } = await supabase
        .from('accounts')
        .update({ saved_accounts: null })
        .eq('discord_id', discord_id);

    if (error) {
        console.error('Error deleting saved accounts:', error);
        throw error;
    }

    return true;
}

module.exports = {
    addAccount,
    checkAccounts,
    deleteAccounts,
    updateSavedAccounts
};
