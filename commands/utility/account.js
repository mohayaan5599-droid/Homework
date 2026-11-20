const {
    SlashCommandBuilder,
    TextInputStyle,
    ModalBuilder,
    MessageFlags,
    StringSelectMenuBuilder,
    LabelBuilder,
    TextInputBuilder,
    ComponentType,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize
} = require('discord.js');

const { checkAccount, activateFreeTrial } = require('../../database/accounts');
const config = require('../../config.json');

const queueRanksPositions = config.queue_ranks || {};

const emojis = new Proxy(config.emojis || {}, {
    get(target, property) {
        return target[property] ?? '🔹';
    }
});

const colours = config.colours || {};

function getColour(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const cleaned = value.trim().replace(/^#/, '').replace(/^0x/i, '');

        if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
            return parseInt(cleaned, 16);
        }
    }

    return fallback;
}

const COLOURS = {
    onyx: getColour(colours.onyx, 0x2B2D31),
    light_red: getColour(colours.light_red, 0xED4245),
    light_green: getColour(colours.light_green, 0x57F287)
};

const botName = config.name || 'the bot';

const whatRole = require('../../utils/whatRole');
const formatTime = require('../../utils/formatTime');

const fs = require('node:fs').promises;
const path = require('node:path');

async function getSettingsData() {
    const baseDir = path.join(process.cwd(), 'autocompleters');
    const results = [];

    async function searchDirectory(currentDir) {
        let items;

        try {
            items = await fs.readdir(currentDir, { withFileTypes: true });
        } catch {
            return;
        }

        const promises = [];

        for (const item of items) {
            const fullPath = path.join(currentDir, item.name);

            if (item.isDirectory()) {
                promises.push(searchDirectory(fullPath));
            } else if (item.isFile() && item.name === 'settings.json') {
                const relativeDir = path.relative(baseDir, currentDir);
                const pathParts = relativeDir.split(path.sep);

                let combinedValue;

                if (pathParts.length > 1) {
                    const topFolder = pathParts[0];
                    const bottomFolder = pathParts[pathParts.length - 1];
                    combinedValue = `${topFolder}_${bottomFolder}`;
                } else {
                    combinedValue = pathParts[0];
                }

                const folderName = path.basename(currentDir);
                const labelName =
                    folderName.charAt(0).toUpperCase() + folderName.slice(1);

                results.push({
                    label: labelName,
                    value: combinedValue,
                    emoji: emojis[combinedValue]
                });
            }
        }

        await Promise.all(promises);
    }

    await searchDirectory(baseDir);

    return results;
}

// Main-account platforms supported by handlers/mainAccountLogin.js.
// These are project-root folders, not folders inside an "autocompleters" directory.
async function getPlatformNames() {
    const platforms = [
        { label: 'Sparx Maths', value: 'sparx_maths' },
        { label: 'Sparx Reader', value: 'sparx_reader' },
        { label: 'Sparx Science', value: 'sparx_science' },
        { label: 'Sparx Cookies', value: 'sparx' },
        { label: 'LanguageNut', value: 'languagenut' },
        { label: 'Educake', value: 'educake' },
        { label: 'Seneca', value: 'seneca' },
        { label: 'Dr Frost', value: 'drfrost' }
    ];

    return platforms.map(platform => ({
        ...platform,
        emoji: emojis[platform.value]
    }));
}

function createContainer(content, colour = COLOURS.onyx) {
    return new ContainerBuilder()
        .setAccentColor(colour)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(content)
        );
}

async function sendComponentError(interaction, error) {
    console.error('Account component error:', error);

    try {
        const message = {
            content: 'Something went wrong while processing that action. Please try again.',
            ephemeral: true
        };

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(message);
        } else {
            await interaction.reply(message);
        }
    } catch (replyError) {
        console.error('Could not send account component error:', replyError);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('account')
        .setDescription(`View your ${botName} Account`),

    public: true,

    async execute(interaction) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        try {
            const seperator = new SeparatorBuilder({
                spacing: SeparatorSpacingSize.Small
            });

            const member = await interaction.guild.members.fetch(
                interaction.user.id
            );

            const roleID = whatRole(member);

            const userRole = Object.keys(queueRanksPositions)
                .find(key => queueRanksPositions[key] === roleID) ?? null;

            const account = await checkAccount(
                interaction.user.id,
                userRole
            );

            if (account) {
                let totalUses = 0;
                let platformsUsed = '';
                let timeSaved = 0;
                let timeSavedPlatforms = '';

                for (const [platformName, platform] of Object.entries(
                    account.total_usage || {}
                )) {
                    totalUses += platform.total_uses || 0;

                    platformsUsed +=
                        `${platformName.charAt(0).toUpperCase() + platformName.slice(1)}: ${platform.total_uses || 0}\n`;

                    timeSaved += platform.time_saved || 0;

                    timeSavedPlatforms +=
                        `${platformName.charAt(0).toUpperCase() + platformName.slice(1)}: ${formatTime(platform.time_saved || 0)}\n`;
                }

                let usages = '';

                for (const [platform, usage] of Object.entries(
                    account.uses || {}
                )) {
                    usages +=
                        `${platform.charAt(0).toUpperCase() + platform.slice(1)}: ${Array.isArray(usage) ? usage.length : 0}/${account.slots || 0}\n`;
                }

                const statsBtn = new ButtonBuilder()
                    .setCustomId('view_stats')
                    .setLabel('View Stats')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(emojis.stats);

                const savedBtn = new ButtonBuilder()
                    .setCustomId('manage_saved_accounts')
                    .setLabel('Saved Accounts')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(emojis.accounts);

                const mainBtn = new ButtonBuilder()
                    .setCustomId('configure_main_accounts')
                    .setLabel('Main Accounts')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(emojis.main_accounts);

                const settingBtn = new ButtonBuilder()
                    .setCustomId('settings')
                    .setLabel('Settings')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(emojis.settings);

                const freetrialBtn = new ButtonBuilder()
                    .setCustomId('activate_free_trial')
                    .setLabel('Activate Free Trial')
                    .setEmoji(emojis.tick)
                    .setStyle(ButtonStyle.Success);

                const row = new ActionRowBuilder()
                    .addComponents(statsBtn, savedBtn);

                const row2 = new ActionRowBuilder();

                if (config.require_mainaccounts) {
                    row2.addComponents(mainBtn);
                }

                row2.addComponents(settingBtn);

                if (account.free_trial_start == null && !account.license) {
                    row2.addComponents(freetrialBtn);
                }

                const container = new ContainerBuilder()
                    .setAccentColor(COLOURS.onyx)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `## <@${interaction.user.id}>'s Account\n**Total Usage**: You have used the bot a total of **${totalUses}** times.\n**Slots Limit**: You have an account slots limit of **${account.slots || 0}**.\n**Account Rank**: Your current account rank is **${account.license ?? 'None'}**.\n### Account Slots (Last 24 Hours)\n\`\`\`js\n${usages || 'No slots used in the past 24 Hours'}\`\`\``
                        )
                    )
                    .addSeparatorComponents(seperator)
                    .addActionRowComponents(row, row2);

                const messageSent = await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [container],
                    fetchReply: true
                });

                const collector = messageSent.createMessageComponentCollector({
                    componentType: ComponentType.Button
                });

                collector.on('collect', async buttonInteraction => {
                    try {
                        if (buttonInteraction.customId === 'settings') {
                            const modal = new ModalBuilder()
                                .setCustomId('handleSettings')
                                .setTitle('Settings for Platform...');

                            const generalSetting = {
                                label: 'General',
                                value: 'general'
                            };

                            const platformSettings = [
                                generalSetting,
                                ...(await getSettingsData())
                            ];

                            const sparxInput = new StringSelectMenuBuilder()
                                .setCustomId('platform')
                                .setPlaceholder('Platform')
                                .addOptions(...platformSettings);

                            const typeLabel = new LabelBuilder({
                                label: 'Platform',
                                component: sparxInput
                            });

                            modal.addLabelComponents(typeLabel);

                            await buttonInteraction.showModal(modal);
                            return;
                        }

                        await buttonInteraction.deferUpdate();

                        if (buttonInteraction.customId === 'view_stats') {
                            const statsContainer = createContainer(
                                `## 📊 Statistics\n**Total Usage**: You have used the bot a total of **${totalUses}** times.\n**Time Saved**: You have saved **${formatTime(timeSaved)}** of time.\n### Platform Usage\n\`\`\`js\n${platformsUsed || 'No platform usage recorded'}\`\`\`\n### Time Saved\n\`\`\`js\n${timeSavedPlatforms || 'No time saved recorded'}\`\`\``
                            );

                            await buttonInteraction.followUp({
                                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                                components: [statsContainer]
                            });

                        } else if (
                            buttonInteraction.customId === 'manage_saved_accounts'
                        ) {
                            const viewAccountsBtn = new ButtonBuilder()
                                .setCustomId('view_accounts')
                                .setLabel('View Accounts')
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji(emojis.accounts);

                            const changePasswordBtn = new ButtonBuilder()
                                .setCustomId('change_master_password')
                                .setLabel('Change Master Password')
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji(emojis.key);

                            const savedRow = new ActionRowBuilder()
                                .addComponents(
                                    viewAccountsBtn,
                                    changePasswordBtn
                                );

                            const savedContainer = createContainer(
                                `## 🗂️ Saved Accounts\nManage all your saved accounts. You can save accounts by clicking on the \`Save Account\` button at the homework selection on one of our services, this option only appears if you **did not** login with cookies.\n### Warning: Changing your Master Password will delete all saved accounts!`
                            )
                                .addSeparatorComponents(seperator)
                                .addActionRowComponents(savedRow);

                            const savedMessage = await buttonInteraction.followUp({
                                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                                components: [savedContainer],
                                fetchReply: true
                            });

                            const savedCollector =
                                savedMessage.createMessageComponentCollector({
                                    componentType: ComponentType.Button
                                });

                            savedCollector.on('collect', async accountInteraction => {
                                try {
                                    const schoolInput = new TextInputBuilder()
                                        .setCustomId('master_password')
                                        .setLabel('Master Password')
                                        .setStyle(TextInputStyle.Short);

                                    if (
                                        accountInteraction.customId === 'view_accounts'
                                    ) {
                                        const modal = new ModalBuilder()
                                            .setCustomId('view_accounts')
                                            .setTitle('Saved Accounts Login');

                                        modal.addComponents(
                                            new ActionRowBuilder().addComponents(
                                                schoolInput
                                            )
                                        );

                                        await accountInteraction.showModal(modal);

                                    } else if (
                                        accountInteraction.customId === 'change_master_password'
                                    ) {
                                        const modal = new ModalBuilder()
                                            .setCustomId('change_master_password')
                                            .setTitle('Change Master Password');

                                        modal.addComponents(
                                            new ActionRowBuilder().addComponents(
                                                schoolInput
                                            )
                                        );

                                        await accountInteraction.showModal(modal);
                                    }
                                } catch (error) {
                                    await sendComponentError(accountInteraction, error);
                                }
                            });

                        } else if (
                            buttonInteraction.customId === 'configure_main_accounts'
                        ) {
                            let configured = '';
                            const mainAccountsConfigured = [];

                            for (const mainAccount of Object.keys(
                                account.main_accounts || {}
                            )) {
                                configured +=
                                    `${mainAccount.charAt(0).toUpperCase() + mainAccount.slice(1)}: Configured\n`;

                                mainAccountsConfigured.push(mainAccount);
                            }

                            const platforms = await getPlatformNames();

                            const filteredPlatforms = platforms.filter(
                                item => !mainAccountsConfigured.includes(item.value)
                            );

                            const addMainBtn = new ButtonBuilder()
                                .setCustomId('add_main_account')
                                .setLabel('Add Main Account')
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji(emojis.main_accounts);

                            const cookieBtn = new ButtonBuilder()
                                .setCustomId('add_main_account_cookie')
                                .setLabel('Add Main Account')
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji(emojis.cookies);

                            const mainRow = new ActionRowBuilder()
                                .addComponents(addMainBtn, cookieBtn);

                            const mainContainer = createContainer(
                                `## 🔒 Configure Main Accounts\nConfigure your main accounts for each platform. Main accounts do **not** count towards your accounts slots. **Your main accounts should only be your own personal accounts**, this is so you can still do *your* homework if you use up your daily slots and it is also used to prevent free trial abusing.\n### Main Accounts Configured\n\`\`\`js\n${configured || 'You have no Main Accounts Configured'}\`\`\`\n### Warning: Configuring a Main Account is irreversible!`
                            ).addSeparatorComponents(seperator);

                            if (filteredPlatforms.length) {
                                mainContainer.addActionRowComponents(mainRow);
                            }

                            const mainMessage = await buttonInteraction.followUp({
                                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                                components: [mainContainer],
                                fetchReply: true
                            });

                            const mainCollector =
                                mainMessage.createMessageComponentCollector({
                                    componentType: ComponentType.Button
                                });

                            mainCollector.on('collect', async accountInteraction => {
                                try {
                                    const modal = new ModalBuilder()
                                        .setCustomId('main_account_configure')
                                        .setTitle('Main Account Configuration');

                                    const platformSelect =
                                        new StringSelectMenuBuilder()
                                            .setCustomId('platform')
                                            .setPlaceholder('Platform')
                                            .addOptions(...filteredPlatforms);

                                    const platformLabel = new LabelBuilder({
                                        label: 'Platform',
                                        component: platformSelect
                                    });

                                    modal.addLabelComponents(platformLabel);

                                    if (
                                        accountInteraction.customId === 'add_main_account'
                                    ) {
                                        const schoolInput = new TextInputBuilder()
                                            .setCustomId('school')
                                            .setLabel('School')
                                            .setPlaceholder('If needed for login')
                                            .setRequired(false)
                                            .setStyle(TextInputStyle.Short);

                                        const emailInput = new TextInputBuilder()
                                            .setCustomId('username')
                                            .setLabel('Username')
                                            .setStyle(TextInputStyle.Short);

                                        const passwordInput = new TextInputBuilder()
                                            .setCustomId('password')
                                            .setLabel('Password')
                                            .setStyle(TextInputStyle.Short);

                                        const typeInput =
                                            new StringSelectMenuBuilder()
                                                .setCustomId('type')
                                                .setPlaceholder(
                                                    'Normal/Microsoft/Google (If needed for login)'
                                                )
                                                .addOptions(
                                                    {
                                                        label: 'Normal',
                                                        value: 'Normal',
                                                        emoji: emojis.sparx
                                                    },
                                                    {
                                                        label: 'Microsoft',
                                                        value: 'Microsoft',
                                                        emoji: emojis.microsoft
                                                    },
                                                    {
                                                        label: 'Google',
                                                        value: 'Google',
                                                        emoji: emojis.google
                                                    }
                                                );

                                        const typeLabel = new LabelBuilder({
                                            label: 'Login Type',
                                            component: typeInput
                                        });

                                        for (const input of [
                                            schoolInput,
                                            emailInput,
                                            passwordInput
                                        ]) {
                                            modal.addComponents(
                                                new ActionRowBuilder().addComponents(input)
                                            );
                                        }

                                        modal.addLabelComponents(typeLabel);

                                    } else if (
                                        accountInteraction.customId === 'add_main_account_cookie'
                                    ) {
                                        const cookieInput = new TextInputBuilder()
                                            .setCustomId('cookie')
                                            .setLabel('Cookie')
                                            .setStyle(TextInputStyle.Paragraph)
                                            .setRequired(true);

                                        modal.addComponents(
                                            new ActionRowBuilder().addComponents(
                                                cookieInput
                                            )
                                        );
                                    }

                                    await accountInteraction.showModal(modal);
                                } catch (error) {
                                    await sendComponentError(accountInteraction, error);
                                }
                            });

                        } else if (
                            buttonInteraction.customId === 'activate_free_trial'
                        ) {
                            if (
                                !Object.keys(account.main_accounts || {}).length
                            ) {
                                const noMainContainer = createContainer(
                                    `### No Main Accounts Exist\nYou have no main accounts configured. Please configure at least one main account to activate your free trial. If you have *just* configured a main account, please run the command \`/account\` again.`,
                                    COLOURS.light_red
                                );

                                await buttonInteraction.followUp({
                                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                                    components: [noMainContainer]
                                });

                                return;
                            }

                            const freeTrialActivated = await activateFreeTrial(
                                buttonInteraction.user.id
                            );

                            if (freeTrialActivated) {
                                const freeTrialRoleId =
                                    queueRanksPositions['free-trial'];

                                if (freeTrialRoleId) {
                                    try {
                                        const guildMember =
                                            await interaction.guild.members.fetch(
                                                buttonInteraction.user.id
                                            );

                                        await guildMember.roles.add(freeTrialRoleId);
                                    } catch (error) {
                                        console.error(
                                            'Failed to assign free trial role:',
                                            error
                                        );
                                    }
                                } else {
                                    console.error(
                                        'Free trial role is not configured in queue_ranks.'
                                    );
                                }

                                const successContainer = createContainer(
                                    `### Free Trial Activated\nYour 3-day Free Trial for ${botName} has been successfully activated!`,
                                    COLOURS.light_green
                                );

                                await buttonInteraction.followUp({
                                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                                    components: [successContainer]
                                });

                            } else {
                                const existsContainer = createContainer(
                                    '### Free Trial Already Exists\nYou already activated your Free Trial.',
                                    COLOURS.light_red
                                );

                                await buttonInteraction.followUp({
                                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                                    components: [existsContainer]
                                });
                            }
                        }
                    } catch (error) {
                        await sendComponentError(buttonInteraction, error);
                    }
                });

            } else {
                const agreeBtn = new ButtonBuilder()
                    .setCustomId('agree')
                    .setLabel('I Agree')
                    .setEmoji(emojis.tick)
                    .setStyle(ButtonStyle.Success);

                const row = new ActionRowBuilder().addComponents(agreeBtn);

                const container = createContainer(
                    `## Create an Account\nBy creating an account, you agree to the Terms of Service of ${botName} which can be found at ${config.tos_channel}`
                )
                    .addSeparatorComponents(seperator)
                    .addActionRowComponents(row);

                const messageSent = await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [container],
                    fetchReply: true
                });

                const collector = messageSent.createMessageComponentCollector({
                    componentType: ComponentType.Button
                });

                collector.on('collect', async buttonInteraction => {
                    try {
                        if (buttonInteraction.customId === 'agree') {
                            await buttonInteraction.deferUpdate();

                            const createPasswordBtn = new ButtonBuilder()
                                .setCustomId('create_master_password')
                                .setLabel('Create Master Password')
                                .setEmoji(emojis.key)
                                .setStyle(ButtonStyle.Primary);

                            const createRow = new ActionRowBuilder()
                                .addComponents(createPasswordBtn);

                            const createContainerMessage = createContainer(
                                `## Create Master Password\nCreate a Master Password that will be used whenever you choose to save an account on one of our services. The option to save an account will be provided at the homework selection assuming you **did not** login with cookies. You will be prompted to input your Master Password whenever you try to save an account.\n\nThe Master Password stored in the Database is hashed and all saved account data is encrypted. Consequently, we **cannot view your saved accounts or master password** meaning all saved accounts are deleted when changing the Master Password.`
                            )
                                .addSeparatorComponents(seperator)
                                .addActionRowComponents(createRow);

                            await buttonInteraction.editReply({
                                flags: MessageFlags.IsComponentsV2,
                                components: [createContainerMessage]
                            });

                        } else if (
                            buttonInteraction.customId === 'create_master_password'
                        ) {
                            const passwordInput = new TextInputBuilder()
                                .setCustomId('master_password')
                                .setLabel('Master Password')
                                .setStyle(TextInputStyle.Short);

                            const modal = new ModalBuilder()
                                .setCustomId('create_master_password')
                                .setTitle('Saved Accounts Login');

                            modal.addComponents(
                                new ActionRowBuilder().addComponents(passwordInput)
                            );

                            await buttonInteraction.showModal(modal);
                        }
                    } catch (error) {
                        await sendComponentError(buttonInteraction, error);
                    }
                });
            }
        } catch (error) {
            console.error('Error executing /account:', error);

            try {
                const errorMessage =
                    'There was an error loading your account. Please try again later.';

                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({
                        content: errorMessage,
                        components: []
                    });
                } else {
                    await interaction.reply({
                        content: errorMessage,
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                console.error('Failed to respond to /account error:', replyError);
            }
        }
    }
};
