const { ContainerBuilder, TextDisplayBuilder } = require('discord.js');

const {
    checkAccount,
    addToDb,
    updateDB
} = require('../database/accounts');

const whatRole = require('../utils/whatRole');
const config = require('../config.json');
const hash = require('../utils/hash');
const hashCompare = require('../utils/hashCompare');

const queueRanksPositions = config.queue_ranks || {};

async function useUpSlot(interaction, platform, accountId, alias) {
    try {
        if (!alias) alias = platform;

        const discordId = interaction.user.id;
        const account = await checkAccount(discordId);

        if (!account) {
            throw new Error(`No account found for Discord ID ${discordId}`);
        }

        const mainAccounts = account.main_accounts || {};
        const uses = account.uses || {};
        const totalUsage = account.total_usage || {};

        // Check whether this is the user's configured main account.
        const mainAccount = mainAccounts[alias];

        if (
            mainAccount &&
            await hashCompare(accountId, mainAccount)
        ) {
            console.log('Main account detected, not using an account slot');

            if (!account.used_main_account) {
                console.log('Adding usage for main account');

                account.used_main_account = true;

                await updateDB(
                    'accounts',
                    { used_main_account: true },
                    'discord_id',
                    discordId
                );

                if (!totalUsage[platform]) {
                    totalUsage[platform] = {
                        total_uses: 0,
                        time_saved: 0
                    };
                }

                totalUsage[platform].total_uses =
                    (Number(totalUsage[platform].total_uses) || 0) + 1;

                await updateDB(
                    'accounts',
                    { total_usage: totalUsage },
                    'discord_id',
                    discordId
                );
            }

            return false;
        }

        console.log('Not a main account, checking whether already used');

        const platformUsesAccounts = Array.isArray(uses[platform])
            ? uses[platform]
            : [];

        let accountAlreadyUsed = false;

        for (const accountUsed of platformUsesAccounts) {
            if (await hashCompare(accountId, accountUsed)) {
                accountAlreadyUsed = true;
                break;
            }
        }

        console.log('Account already used:', accountAlreadyUsed);

        if (accountAlreadyUsed) {
            return false;
        }

        console.log('Checking available account slots');

        const slots = Number(account.slots) || 0;

        if (platformUsesAccounts.length >= slots) {
            const section = new TextDisplayBuilder().setContent(
                `# No Account Slots Left\nYou have run out of account slots. Please wait 24 hours for your account slots to replenish.`
            );

            const container = new ContainerBuilder()
                .setAccentColor(0xFF474D)
                .addTextDisplayComponents(section.data);

            await interaction.followUp({
                flags: 32768 | 64,
                components: [container]
            });

            return true;
        }

        platformUsesAccounts.push(await hash(accountId));
        uses[platform] = platformUsesAccounts;

        if (!totalUsage[platform]) {
            totalUsage[platform] = {
                total_uses: 0,
                time_saved: 0
            };
        }

        totalUsage[platform].total_uses =
            (Number(totalUsage[platform].total_uses) || 0) + 1;

        await updateDB(
            'accounts',
            {
                uses,
                total_usage: totalUsage
            },
            'discord_id',
            discordId
        );

        return false;

    } catch (error) {
        console.error('useUpSlot error:', error);
        throw error;
    }
}

async function validAccount(interaction, platform) {
    try {
        const member = await interaction.guild.members.fetch(
            interaction.user.id
        );

        const roleID = whatRole(member);

        const userRole = Object.keys(queueRanksPositions).find(
            key => queueRanksPositions[key] === roleID
        ) ?? null;

        const account = await checkAccount(
            interaction.user.id,
            userRole
        );

        if (!account) {
            const section = new TextDisplayBuilder().setContent(
                `# No Account Found\nYou do not have a SparxNow Account. Please create one by doing \`/account\` and then configuring the main account for this platform.`
            );

            const container = new ContainerBuilder()
                .setAccentColor(0xFF474D)
                .addTextDisplayComponents(section.data);

            await interaction.reply({
                flags: 32768 | 64,
                components: [container]
            });

            return true;
        }

        if (
            config.require_mainaccounts &&
            !(account.main_accounts || {})[platform]
        ) {
            const section = new TextDisplayBuilder().setContent(
                `# No Main Account Found for this Platform\nYou do not have a Main Account for this platform configured. Please configure one by doing it in the \`/account\` menu.`
            );

            const container = new ContainerBuilder()
                .setAccentColor(0xFF474D)
                .addTextDisplayComponents(section.data);

            await interaction.reply({
                flags: 32768 | 64,
                components: [container]
            });

            return true;
        }

        if (!userRole) {
            const section = new TextDisplayBuilder().setContent(
                `# You do not have Access\nYou do not have access to the bot. Please open a ticket to buy Lifetime for £6 or activate your 3-day free trial if you haven't already.`
            );

            const container = new ContainerBuilder()
                .setAccentColor(0xFF474D)
                .addTextDisplayComponents(section.data);

            await interaction.reply({
                flags: 32768 | 64,
                components: [container]
            });

            return true;
        }

        return false;

    } catch (error) {
        console.error('validAccount error:', error);
        throw error;
    }
}

async function createAccount(interaction) {
    await interaction.deferReply({
        flags: 32768 | 64
    });

    try {
        const masterPassword =
            interaction.fields.getTextInputValue('master_password');

        const userId = interaction.user.id;

        const member = await interaction.guild.members.fetch(userId);
        const roleID = whatRole(member);

        const userRole = Object.keys(queueRanksPositions).find(
            key => queueRanksPositions[key] === roleID
        ) ?? null;

        const hashedPassword = await hash(masterPassword);

        const accountCreated = await addToDb(
            userId,
            hashedPassword,
            userRole
        );

        if (!accountCreated) {
            const section = new TextDisplayBuilder().setContent(
                `# Account Already Exists\nYou already have a SparxNow account.`
            );

            const container = new ContainerBuilder()
                .setAccentColor(0xFF474D)
                .addTextDisplayComponents(section.data);

            await interaction.editReply({
                flags: 32768,
                components: [container]
            });

            return;
        }

        const section = new TextDisplayBuilder().setContent(
            `# Account Created\nYour SparxNow account has been successfully created!`
        );

        const container = new ContainerBuilder()
            .setAccentColor(0x90EE90)
            .addTextDisplayComponents(section.data);

        await interaction.editReply({
            flags: 32768,
            components: [container]
        });

    } catch (error) {
        console.error('Create account error:', error);

        await interaction.editReply({
            content: 'Failed to create your account. Please try again.',
            components: []
        }).catch(replyError => {
            console.error('Could not send account creation error:', replyError);
        });
    }
}

module.exports = {
    createAccount,
    validAccount,
    useUpSlot
};
