const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    StringSelectMenuOptionBuilder,
    StringSelectMenuBuilder,
    MessageFlags
} = require('discord.js');

const {
    checkAccounts,
    deleteAccounts,
    addAccount
} = require('../database/saved_accounts');

const { checkAccount } = require('../database/accounts');
const hashCompare = require('../utils/hashCompare');

const { loginsSavedTemp } = require('../executeTasks');
const { executeTasks } = require('../executeTasks');

const { languagenut_model_executor } = require('../languagenut/main');
const { educake_model_executor } = require('../educake/main');
const { seneca_model_executor } = require('../seneca/main');
const { drfrost_model_executor } = require('../drfrost/main');

function createContainer(content, colour = 0xFF474D) {
    return new ContainerBuilder()
        .setAccentColor(colour)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(content)
        );
}

async function sendMessage(interaction, content, colour = 0xFF474D) {
    const container = createContainer(content, colour);

    const payload = {
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container]
    };

    if (interaction.deferred || interaction.replied) {
        return interaction.followUp(payload);
    }

    return interaction.reply(payload);
}

async function getUserAccount(userId) {
    const account = await checkAccount(userId);

    if (!account) {
        throw new Error(`No account found for Discord ID ${userId}`);
    }

    return account;
}

async function verifyMasterPassword(account, password) {
    if (account.master_password === null || account.master_password === '') {
        return true;
    }

    if (!password) return false;

    return Boolean(
        await hashCompare(password, account.master_password)
    );
}

async function handleSavedAccounts(interaction, action, sparx) {
    try {
        if (action === 'view') {
            const account = await getUserAccount(interaction.user.id);

            if (
                account.master_password === null ||
                account.master_password === ''
            ) {
                await interaction.deferReply({
                    flags: MessageFlags.Ephemeral
                });

                return executeViewAccounts(interaction);
            }

            const modal = new ModalBuilder()
                .setCustomId(`view_saved_accounts_${sparx}`)
                .setTitle('Saved Accounts Login');

            const passwordInput = new TextInputBuilder()
                .setCustomId('master_password')
                .setLabel('Master Password')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(passwordInput)
            );

            return interaction.showModal(modal);
        }

        if (action === 'delete') {
            await deleteAccounts(interaction.user.id);

            return sendMessage(
                interaction,
                '# Accounts Deleted\nAll accounts saved by you have been deleted!'
            );
        }

    } catch (error) {
        console.error('handleSavedAccounts error:', error);

        return sendMessage(
            interaction,
            '# Error\nSomething went wrong while accessing your saved accounts.'
        );
    }
}

async function executeViewAccounts(interaction) {
    try {
        const account = await getUserAccount(interaction.user.id);

        const masterPassword = interaction.fields
            ? interaction.fields.getTextInputValue('master_password')
            : '';

        const passwordCorrect = await verifyMasterPassword(
            account,
            masterPassword
        );

        if (!passwordCorrect) {
            return sendMessage(
                interaction,
                '# Password Was Incorrect\nThe password to your saved accounts was incorrect!'
            );
        }

        const accounts = await checkAccounts(
            interaction.user.id,
            masterPassword
        );

        if (accounts === false) {
            return sendMessage(
                interaction,
                '# Password Error\nCould not decrypt your saved accounts.'
            );
        }

        if (!Array.isArray(accounts) || accounts.length === 0) {
            return sendMessage(
                interaction,
                '# No Accounts Saved\nYou have no accounts saved!'
            );
        }

        const customId = interaction.customId || '';
        const parts = customId.split('_');
        const sparxPlatform = parts[parts.length - 1];

        const sparxList = ['reader', 'maths', 'science'];

        let stringSelectCustomId;
        let allowedApp;

        if (sparxList.includes(sparxPlatform)) {
            stringSelectCustomId = `loginSparxL_homework_${sparxPlatform}`;
            allowedApp = 'sparx';
        } else if (sparxPlatform === 'languagenut') {
            stringSelectCustomId = 'languagenut_login_account';
            allowedApp = 'languagenut';
        } else if (sparxPlatform === 'educake') {
            stringSelectCustomId = 'educake_login_account';
            allowedApp = 'educake';
        } else if (sparxPlatform === 'seneca') {
            stringSelectCustomId = 'seneca_login_account';
            allowedApp = 'seneca';
        } else if (sparxPlatform === 'drfrost') {
            stringSelectCustomId = 'drfrost_login_account';
            allowedApp = 'drfrost';
        } else {
            return sendMessage(
                interaction,
                '# Invalid Platform\nThe requested platform could not be identified.'
            );
        }

        const platformAccounts = accounts.filter(
            account => account.app === allowedApp
        );

        if (!platformAccounts.length) {
            return sendMessage(
                interaction,
                '# No Accounts Saved\nYou have no saved accounts for this service!'
            );
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId(stringSelectCustomId)
            .setPlaceholder('Choose an account...')
            .addOptions(
                platformAccounts.slice(0, 25).map(account =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(String(account.email).slice(0, 100))
                        .setValue(String(account.email).slice(0, 100))
                )
            );

        const row = new ActionRowBuilder().addComponents(select);

        const container = createContainer(
            '# Accounts\nAll saved accounts for the requested service are listed below!',
            0x7D7D7D
        );

        const messageSent = await interaction.followUp({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container, row],
            fetchReply: true
        });

        const collector = messageSent.createMessageComponentCollector({
            time: 180_000
        });

        collector.on('collect', async componentInteraction => {
            try {
                if (
                    componentInteraction.customId !== stringSelectCustomId
                ) {
                    return;
                }

                await componentInteraction.deferUpdate();

                const selectedAccount = platformAccounts.find(
                    account => account.email === componentInteraction.values[0]
                );

                if (!selectedAccount) {
                    return componentInteraction.followUp({
                        content: 'That saved account could not be found.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                componentInteraction.loginDetails = selectedAccount;

                if (allowedApp === 'sparx') {
                    await executeTasks(componentInteraction);
                } else if (allowedApp === 'languagenut') {
                    await languagenut_model_executor(componentInteraction);
                } else if (allowedApp === 'educake') {
                    await educake_model_executor(componentInteraction);
                } else if (allowedApp === 'seneca') {
                    await seneca_model_executor(componentInteraction);
                } else if (allowedApp === 'drfrost') {
                    await drfrost_model_executor(componentInteraction);
                }

            } catch (error) {
                console.error('Saved account selection error:', error);

                await componentInteraction.followUp({
                    content: 'Something went wrong while logging into that account.',
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
            }
        });

        collector.on('end', () => {
            console.log('Saved account selection expired.');
        });

    } catch (error) {
        console.error('executeViewAccounts error:', error);

        return sendMessage(
            interaction,
            '# Error\nCould not load your saved accounts. Please try again.'
        );
    }
}

async function saveAccount(interaction) {
    try {
        const masterPassword =
            interaction.fields.getTextInputValue('master_password');

        const account = await getUserAccount(interaction.user.id);

        const passwordCorrect = await verifyMasterPassword(
            account,
            masterPassword
        );

        if (!passwordCorrect) {
            return sendMessage(
                interaction,
                '# Password Was Incorrect\nThe password you entered was incorrect!'
            );
        }

        let accounts = await checkAccounts(
            interaction.user.id,
            masterPassword
        );

        if (accounts === false) {
            return sendMessage(
                interaction,
                '# Error Decrypting Accounts\nCould not decrypt accounts despite the password check.'
            );
        }

        if (!Array.isArray(accounts)) {
            accounts = [];
        }

        let loginDetails;
        const customId = interaction.customId;

        if (customId === 'save_account_languagenut') {
            accounts = accounts.filter(value => value.app === 'languagenut');

            const { userSessions } = require('../languagenut/main');
            loginDetails = userSessions.get(interaction.user.id)?.login_details;

        } else if (customId === 'save_account_educake') {
            accounts = accounts.filter(value => value.app === 'educake');

            const { userSessions } = require('../educake/main');
            loginDetails = userSessions[interaction.user.id]?.login;

        } else if (customId === 'save_account_seneca') {
            accounts = accounts.filter(value => value.app === 'seneca');

            const { userSessions } = require('../seneca/main');
            loginDetails = userSessions[interaction.user.id]?.login;

        } else if (customId === 'save_account_drfrost') {
            accounts = accounts.filter(value => value.app === 'drfrost');

            const { userMenus } = require('../drfrost/main');
            loginDetails = userMenus[interaction.user.id]?.loginDetails;

        } else {
            accounts = accounts.filter(value => value.app === 'sparx');
            loginDetails = loginsSavedTemp?.[interaction.user.id];
        }

        if (!loginDetails || !loginDetails.email) {
            return sendMessage(
                interaction,
                '# Login Details Missing\nCould not find the active login details to save.'
            );
        }

        if (accounts.length >= 25) {
            return sendMessage(
                interaction,
                '# Account Max Reached\nYou cannot have more than 25 accounts saved!'
            );
        }

        const emailExists = accounts.some(
            user => user.email === loginDetails.email
        );

        if (emailExists) {
            return sendMessage(
                interaction,
                '# Account Already Saved\nThe account you tried to save is already saved!'
            );
        }

        const sparxList = ['reader', 'maths', 'science'];

        const accountToSave = {
            ...loginDetails
        };

        if (sparxList.includes(accountToSave.app)) {
            accountToSave.app = 'sparx';
        }

        await addAccount(
            interaction.user.id,
            accountToSave,
            masterPassword
        );

        return sendMessage(
            interaction,
            '# Account Saved\nYour account has been saved to SparxNow!',
            0x90EE90
        );

    } catch (error) {
        console.error('saveAccount error:', error);

        return sendMessage(
            interaction,
            '# Error\nFailed to save your account. Please try again.'
        );
    }
}

module.exports = {
    handleSavedAccounts,
    executeViewAccounts,
    saveAccount
};
