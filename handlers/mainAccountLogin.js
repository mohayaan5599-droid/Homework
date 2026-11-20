const {
    ComponentType,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ContainerBuilder,
    TextDisplayBuilder
} = require('discord.js');

const {
    addMainAccount,
    checkDuplicatesMainAccounts,
    removeMainAccount
} = require('../database/accounts');

const { getTokenRequest, getTokenSparx } = require('../sparx/puppeteer');
const { SparxReader } = require('../sparx/reader.js');
const {
    login_languagenut,
    languagenut_getUserInfo
} = require('../languagenut/main');
const { educakeLogin } = require('../educake/puppeteer');
const { senecaLogin } = require('../seneca/puppeteer');
const { drfrostLogin } = require('../drfrost/puppeteer');
const { drfrostAutocompleter } = require('../drfrost/main');
const { senecaAutocompleter } = require('../seneca/main');
const { emojis } = require('../config.json');
const Educake_Requesticator = require('../educake/requesticator');
const hash = require('../utils/hash');
const puppetQueue = require('../queues/puppeteerQueue.js');

function getModalFieldSafe(interaction, fieldId, type = 'text') {
    try {
        if (type === 'text') {
            return interaction.fields.getTextInputValue(fieldId);
        }

        if (type === 'select') {
            const field = interaction.fields.getField(fieldId);
            return field?.values?.[0] ?? null;
        }

        return null;
    } catch (err) {
        if (err.code === 'ModalSubmitInteractionFieldNotFound') {
            return null;
        }

        throw err;
    }
}

async function notHasEverything(interaction, parametersRequired, parametersGiven) {
    for (const param of parametersRequired) {
        if (!parametersGiven[param]) {
            const section = new TextDisplayBuilder().setContent(
                `# Missing Input\nThe service requires ${param} and you have not included it in your input.`
            );

            const container = new ContainerBuilder()
                .setAccentColor(0xFF474D)
                .addTextDisplayComponents(section.data);

            await interaction.editReply({
                flags: 32768 | 64,
                components: [container]
            });

            return true;
        }
    }

    return false;
}

function getSparxAccountId(userInfo) {
    if (!userInfo || !userInfo.subject || !userInfo.displayName) {
        return null;
    }

    return userInfo.subject + userInfo.displayName;
}

function parsePasswordAndAuthenticator(rawPassword, explicitCode = null) {
    const trimmedPassword = rawPassword?.trim?.() ?? '';
    const trimmedExplicitCode = explicitCode?.trim?.() ?? null;

    if (trimmedExplicitCode) {
        return {
            password: trimmedPassword,
            authenticatorCode: trimmedExplicitCode
        };
    }

    const splitIndex = trimmedPassword.lastIndexOf('::');

    if (splitIndex === -1) {
        return {
            password: trimmedPassword,
            authenticatorCode: null
        };
    }

    const passwordPart = trimmedPassword.slice(0, splitIndex).trim();
    const maybeCodePart = trimmedPassword.slice(splitIndex + 2).trim();

    if (/^\d{6,8}$/.test(maybeCodePart) && passwordPart.length) {
        return {
            password: passwordPart,
            authenticatorCode: maybeCodePart
        };
    }

    return {
        password: trimmedPassword,
        authenticatorCode: null
    };
}

function buildAuthenticatorCallback(authenticatorCode) {
    const code = authenticatorCode?.trim?.();

    if (!code) {
        return null;
    }

    return async ({ type, methods }) => {
        if (type === 'select_method' && Array.isArray(methods) && methods.length) {
            const authenticatorIdx = methods.findIndex(method =>
                /authenticator|app|verification code|code/i.test(method?.text || '')
            );

            if (authenticatorIdx >= 0) {
                return {
                    action: 'select_method',
                    index: authenticatorIdx
                };
            }

            return null;
        }

        if (type === 'code') {
            return {
                action: 'code',
                code
            };
        }

        return null;
    };
}

async function mainAccountLogin(interaction, deleteAccount = false) {
    const school = getModalFieldSafe(interaction, 'school');

    // The account.js modal uses "username". Keep "email" as a fallback
    // for older modals that may still use that field ID.
    const email =
        getModalFieldSafe(interaction, 'username') ||
        getModalFieldSafe(interaction, 'email');

    const passwordRaw = getModalFieldSafe(interaction, 'password');
    const authenticatorCodeInput = getModalFieldSafe(
        interaction,
        'authenticator_code'
    );

    const { password, authenticatorCode } =
        parsePasswordAndAuthenticator(passwordRaw, authenticatorCodeInput);

    const on2FA = buildAuthenticatorCallback(authenticatorCode);

    // account.js creates the cookie input with the ID "cookie".
    const cookiesSparx =
        getModalFieldSafe(interaction, 'cookie') ||
        getModalFieldSafe(interaction, 'cookies');

    const loginType = getModalFieldSafe(interaction, 'type', 'select');
    let platform = getModalFieldSafe(interaction, 'platform', 'select');

    const parametersGiven = {
        school,
        email,
        password,
        loginType
    };

    const section = new TextDisplayBuilder().setContent(
        '# Logging In...\nThe bot is attempting to login into your account...'
    );

    const container = new ContainerBuilder()
        .setAccentColor(0xFFE347)
        .addTextDisplayComponents(section.data);

    await interaction.reply({
        flags: 32768 | 64,
        components: [container]
    });

    try {
        let accountId;

        if (['reader', 'maths', 'science'].includes(platform)) {
            if (
                await notHasEverything(
                    interaction,
                    ['school', 'email', 'password', 'loginType'],
                    parametersGiven
                )
            ) {
                return;
            }

            const token = (
                await getTokenSparx(
                    school,
                    email,
                    password,
                    loginType,
                    platform,
                    on2FA
                )
            ).token;

            platform = 'sparx';

            const sparxExecutor = new SparxReader(token);

            accountId = getSparxAccountId(
                await sparxExecutor.getUserInfo()
            );

        } else if (platform === 'languagenut') {
            if (
                await notHasEverything(
                    interaction,
                    ['email', 'password'],
                    parametersGiven
                )
            ) {
                return;
            }

            const token = (
                await login_languagenut(email, password)
            ).newToken;

            accountId = (
                await languagenut_getUserInfo(token)
            ).userUid;

        } else if (platform === 'educake') {
            if (
                await notHasEverything(
                    interaction,
                    ['email', 'password', 'loginType'],
                    parametersGiven
                )
            ) {
                return;
            }

            const cookie = await educakeLogin(
                email,
                password,
                loginType,
                on2FA
            );

            const educakeRequest = new Educake_Requesticator(cookie);

            const authToken = await educakeRequest.sendRequest(
                'https://my.educake.co.uk/session-token'
            );

            educakeRequest.sessionToken = authToken.accessToken;

            const userInfo = await educakeRequest.sendRequest(
                'https://my.educake.co.uk/api/me'
            );

            accountId = String(userInfo.id);

        } else if (platform === 'seneca') {
            if (
                await notHasEverything(
                    interaction,
                    ['email', 'password', 'loginType'],
                    parametersGiven
                )
            ) {
                return;
            }

            const token = await senecaLogin(
                email,
                password,
                loginType,
                on2FA
            );

            const senecaAuto = new senecaAutocompleter(
                interaction,
                token
            );

            const userInfo = await senecaAuto.get(
                'https://user-info.app.senecalearning.com/api/user-info/me'
            );

            accountId = userInfo.userId;

        } else if (platform === 'drfrost') {
            if (
                await notHasEverything(
                    interaction,
                    ['email', 'password', 'loginType'],
                    parametersGiven
                )
            ) {
                return;
            }

            const token = await drfrostLogin(
                email,
                password,
                loginType,
                on2FA
            );

            const drfrostAuto = new drfrostAutocompleter(
                interaction,
                token
            );

            const userInfo = await drfrostAuto.getSelfInfo();

            accountId = String(userInfo.user.uid);

        } else if (
            ['sparx_maths', 'sparx_reader', 'sparx_science'].includes(platform)
        ) {
            if (
                await notHasEverything(
                    interaction,
                    ['school', 'email', 'password', 'loginType'],
                    parametersGiven
                )
            ) {
                return;
            }

            const app = platform.replace('sparx_', '');

            const tokenAndCookies = await puppetQueue.add(() =>
                getTokenSparx(
                    school,
                    email,
                    password,
                    loginType,
                    app,
                    on2FA
                )
            );

            if (
                !tokenAndCookies ||
                tokenAndCookies.status === 'error' ||
                !tokenAndCookies.token
            ) {
                const failedSection = new TextDisplayBuilder().setContent(
                    '# Failed to Login\nSparx Login failed. Please check your credentials.'
                );

                const failedContainer = new ContainerBuilder()
                    .setAccentColor(0xFF474D)
                    .addTextDisplayComponents(failedSection.data);

                await interaction.editReply({
                    flags: 32768 | 64,
                    components: [failedContainer]
                });

                return;
            }

            const sparxExecutor = new SparxReader(
                tokenAndCookies.token,
                {
                    school,
                    email,
                    password,
                    loginType,
                    app
                },
                tokenAndCookies.cookies
            );

            const userInfo = await sparxExecutor.getUserInfo();

            accountId = getSparxAccountId(userInfo);

        } else if (platform === 'sparx' && cookiesSparx) {
            const token = await getTokenRequest(cookiesSparx);

            const sparxExecutor = new SparxReader(token);

            accountId = getSparxAccountId(
                await sparxExecutor.getUserInfo()
            );

        } else {
            throw new Error(`Unsupported main-account platform: ${platform}`);
        }

        if (accountId) {
            if (deleteAccount) {
                const accountBelongsTo = await checkDuplicatesMainAccounts(
                    platform,
                    accountId,
                    interaction.user.id,
                    true
                );

                if (accountBelongsTo) {
                    const confirmSection = new TextDisplayBuilder().setContent(
                        `# Confirmation\nAre you sure you want to delete the main account for ${platform} that belongs to <@${accountBelongsTo}> with Discord ID: \`\`${accountBelongsTo}\`\``
                    );

                    const savedBtn = new ButtonBuilder()
                        .setCustomId('confirm')
                        .setLabel('Confirm')
                        .setEmoji(emojis.tick)
                        .setStyle(ButtonStyle.Success);

                    const row = new ActionRowBuilder().addComponents(savedBtn);

                    const confirmContainer = new ContainerBuilder()
                        .setAccentColor(0xFFE347)
                        .addTextDisplayComponents(confirmSection.data)
                        .addActionRowComponents(row);

                    const replyMessage = await interaction.editReply({
                        flags: 32768 | 64,
                        components: [confirmContainer],
                        withResponse: true
                    });

                    const collector = replyMessage.createMessageComponentCollector({
                        componentType: ComponentType.Button
                    });

                    collector.on('collect', async buttonInteraction => {
                        if (buttonInteraction.customId !== 'confirm') {
                            return;
                        }

                        await buttonInteraction.deferUpdate({
                            flags: 64
                        });

                        await removeMainAccount(
                            accountBelongsTo,
                            platform
                        );

                        const removedSection = new TextDisplayBuilder().setContent(
                            '# Main Account Removed\nYou have successfully removed a main account!'
                        );

                        const removedContainer = new ContainerBuilder()
                            .setAccentColor(0x90EE90)
                            .addTextDisplayComponents(removedSection.data);

                        await buttonInteraction.editReply({
                            flags: 32768 | 64,
                            components: [removedContainer]
                        });

                        collector.stop();
                    });

                } else {
                    const noOwnerSection = new TextDisplayBuilder().setContent(
                        "# No-one Owns This Main Account\nThe main account you are trying to remove doesn't belong to anybody."
                    );

                    const noOwnerContainer = new ContainerBuilder()
                        .setAccentColor(0xFF474D)
                        .addTextDisplayComponents(noOwnerSection.data);

                    await interaction.editReply({
                        flags: 32768 | 64,
                        components: [noOwnerContainer]
                    });
                }

                return;
            }

            if (
                await checkDuplicatesMainAccounts(
                    platform,
                    accountId,
                    interaction.user.id
                )
            ) {
                const duplicateSection = new TextDisplayBuilder().setContent(
                    '# Main Account Already Belongs to Someone\nThe main account you are trying to add already belongs to another account. Open a [ticket](https://discord.com/channels/1351338824759906345/1467505173697007843) if you believe this to be a mistake.'
                );

                const duplicateContainer = new ContainerBuilder()
                    .setAccentColor(0xFF474D)
                    .addTextDisplayComponents(duplicateSection.data);

                await interaction.editReply({
                    flags: 32768 | 64,
                    components: [duplicateContainer]
                });

                return;
            }

            if (
                await addMainAccount(
                    interaction.user.id,
                    platform,
                    await hash(accountId)
                )
            ) {
                const successSection = new TextDisplayBuilder().setContent(
                    '# Main Account Added\nYou have successfully added a main account!'
                );

                const successContainer = new ContainerBuilder()
                    .setAccentColor(0x90EE90)
                    .addTextDisplayComponents(successSection.data);

                await interaction.editReply({
                    flags: 32768 | 64,
                    components: [successContainer]
                });

            } else {
                const existsSection = new TextDisplayBuilder().setContent(
                    '# Account already Configured\nThe platform you are adding the main account to already has a main account configured for you. If you have just recently added a main account, please run </account:1448725316322332799> again for it to show.'
                );

                const existsContainer = new ContainerBuilder()
                    .setAccentColor(0xFF474D)
                    .addTextDisplayComponents(existsSection.data);

                await interaction.editReply({
                    flags: 32768 | 64,
                    components: [existsContainer]
                });
            }

        } else {
            throw new Error('Unable to get account Id');
        }

    } catch (err) {
        console.error('Main account login error:', err);

        const failedSection = new TextDisplayBuilder().setContent(
            '# Failed to Login\nThe bot has failed to login.'
        );

        const failedContainer = new ContainerBuilder()
            .setAccentColor(0xFF474D)
            .addTextDisplayComponents(failedSection.data);

        await interaction.editReply({
            flags: 32768 | 64,
            components: [failedContainer]
        });
    }
}

module.exports = {
    mainAccountLogin,
    getSparxAccountId
};
