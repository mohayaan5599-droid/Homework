const {
    SlashCommandBuilder,
    TextInputStyle,
    ModalBuilder,
    StringSelectMenuBuilder,
    LabelBuilder,
    TextInputBuilder,
    ComponentType,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    EmbedBuilder
} = require('discord.js');

const { checkAccount, activateFreeTrial } = require('../../database/accounts');
const config = require('../../config.json');
const queueRanksPositions = config.queue_ranks;
const emojis = config.emojis;
const whatRole = require('../../utils/whatRole');
const formatTime = require('../../utils/formatTime');

function makeEmbed(title, description, color = 0x353839) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description);
}

function makeRow(...components) {
    return new ActionRowBuilder().addComponents(...components);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('account')
        .setDescription('View your SparxNow Account'),

    public: true,

    async execute(interaction) {
        // Acknowledge immediately. Use a normal ephemeral reply,
        // because this file now uses standard embeds and action rows.
        await interaction.deferReply({
            flags: 64
        });

        try {
            const roleID = whatRole(
                await interaction.guild.members.fetch(interaction.user.id)
            );

            const userRole = Object.keys(queueRanksPositions)
                .find(key => queueRanksPositions[key] === roleID) ?? null;

            console.log(userRole);

            const account = await checkAccount(interaction.user.id, userRole);

            if (account) {
                let totalUses = 0;
                let platformsUsed = '';
                let timeSaved = 0;
                let timeSavedPlatforms = '';

                for (const [name, platform] of Object.entries(account.total_usage)) {
                    totalUses += platform.total_uses;

                    platformsUsed += `${name.charAt(0).toUpperCase() + name.slice(1)}: ${platform.total_uses}\n`;

                    timeSaved += platform.time_saved;

                    timeSavedPlatforms += `${name.charAt(0).toUpperCase() + name.slice(1)}: ${formatTime(platform.time_saved)}\n`;
                }

                let usages = '';

                for (const [platform, usage] of Object.entries(account.uses)) {
                    usages += `${platform.charAt(0).toUpperCase() + platform.slice(1)}: ${usage.length}/${account.slots}\n`;
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
                    .setEmoji({ name: '✅' })
                    .setStyle(ButtonStyle.Success);

                const row = makeRow(statsBtn, savedBtn);
                const row2 = makeRow(mainBtn, settingBtn);

                if (account.free_trial_start === null && !account.license) {
                    row2.addComponents(freetrialBtn);
                }

                const message = await interaction.editReply({
                    embeds: [
                        makeEmbed(
                            `${interaction.user.username}'s Account`,
                            `**Total Usage:** You have used the bot a total of **${totalUses}** times.\n` +
                            `**Slots Limit:** You have an account slots limit of **${account.slots}**.\n` +
                            `**Account Rank:** Your current account rank is **${account.license ?? 'None'}**.\n\n` +
                            `**Account Slots (Last 24 Hours)**\n\`\`\`js\n${usages || 'No slots used in the past 24 Hours'}\n\`\`\``
                        )
                    ],
                    components: [row, row2]
                });

                const collector = message.createMessageComponentCollector({
                    componentType: ComponentType.Button
                });

                collector.on('collect', async (buttonInteraction) => {
                    try {
                        if (buttonInteraction.customId === 'settings') {
                            const modal = new ModalBuilder()
                                .setCustomId('handleSettings')
                                .setTitle('Settings for Platform...');

                            const sparxInput = new StringSelectMenuBuilder()
                                .setCustomId('platform')
                                .setPlaceholder('Platform')
                                .addOptions(
                                    { label: 'General', value: 'general' },
                                    { label: 'Reader', value: 'reader', emoji: emojis.reader },
                                    { label: 'Maths', value: 'maths', emoji: emojis.maths },
                                    { label: 'Science', value: 'science', emoji: emojis.science }
                                );

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
                            await buttonInteraction.followUp({
                                flags: 64,
                                embeds: [
                                    makeEmbed(
                                        '📊 Statistics',
                                        `**Total Usage:** You have used the bot a total of **${totalUses}** times.\n` +
                                        `**Time Saved:** You have saved **${formatTime(timeSaved)}** of time.\n\n` +
                                        `**Platform Usage**\n\`\`\`js\n${platformsUsed || 'No platform usage'}\n\`\`\`\n` +
                                        `**Time Saved**\n\`\`\`js\n${timeSavedPlatforms || 'No time saved data'}\n\`\`\``
                                    )
                                ]
                            });

                        } else if (buttonInteraction.customId === 'manage_saved_accounts') {
                            const statsBtn = new ButtonBuilder()
                                .setCustomId('view_accounts')
                                .setLabel('View Accounts')
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji(emojis.accounts);

                            const savedBtn = new ButtonBuilder()
                                .setCustomId('change_master_password')
                                .setLabel('Change Master Password')
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji(emojis.key);

                            const messageSent = await buttonInteraction.followUp({
                                flags: 64,
                                embeds: [
                                    makeEmbed(
                                        '🗂️ Saved Accounts',
                                        'Manage all your saved accounts. You can save accounts by clicking on the `Save Account` button at the homework selection on one of our services. This option only appears if you **did not** login with cookies.\n\n' +
                                        '**Warning:** Changing your Master Password will delete all saved accounts!'
                                    )
                                ],
                                components: [makeRow(statsBtn, savedBtn)],
                                fetchReply: true
                            });

                            const savedCollector = messageSent.createMessageComponentCollector({
                                componentType: ComponentType.Button
                            });

                            savedCollector.on('collect', async (accountInteraction) => {
                                try {
                                    const schoolInput = new TextInputBuilder()
                                        .setCustomId('master_password')
                                        .setLabel('Master Password')
                                        .setStyle(TextInputStyle.Short);

                                    const modal = new ModalBuilder()
                                        .setCustomId(accountInteraction.customId)
                                        .setTitle(
                                            accountInteraction.customId === 'view_accounts'
                                                ? 'Saved Accounts Login'
                                                : 'Change Master Password'
                                        )
                                        .addComponents(
                                            new ActionRowBuilder().addComponents(schoolInput)
                                        );

                                    await accountInteraction.showModal(modal);
                                } catch (error) {
                                    console.error('Saved accounts button error:', error);
                                }
                            });

                        } else if (buttonInteraction.customId === 'configure_main_accounts') {
                            let configured = '';

                            for (const mainAccount of Object.keys(account.main_accounts)) {
                                configured += `${mainAccount.charAt(0).toUpperCase() + mainAccount.slice(1)}: Configured\n`;
                            }

                            const statsBtn = new ButtonBuilder()
                                .setCustomId('add_main_account')
                                .setLabel('Add Main Account')
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji(emojis.main_accounts);

                            const cookieBtn = new ButtonBuilder()
                                .setCustomId('add_main_cookie_account')
                                .setLabel('Add Main Account with Cookies (Sparx Only)')
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji(emojis.cookies);

                            const messageSent = await buttonInteraction.followUp({
                                flags: 64,
                                embeds: [
                                    makeEmbed(
                                        '🔒 Configure Main Accounts',
                                        'Configure your main accounts for each platform. Main accounts do **not** count towards your account slots.\n\n' +
                                        '**Your main accounts should only be your own personal accounts.** This is so you can still do *your* homework if you use up your daily slots and it is also used to prevent free trial abusing.\n\n' +
                                        `**Main Accounts Configured**\n\`\`\`js\n${configured || 'You have no Main Accounts Configured'}\n\`\`\`\n` +
                                        '**Warning:** Configuring a Main Account is irreversible!'
                                    )
                                ],
                                components: [makeRow(statsBtn, cookieBtn)],
                                fetchReply: true
                            });

                            const mainCollector = messageSent.createMessageComponentCollector({
                                componentType: ComponentType.Button
                            });

                            mainCollector.on('collect', async (accountInteraction) => {
                                try {
                                    const modal = new ModalBuilder()
                                        .setCustomId('main_account_configure')
                                        .setTitle('Main Account Configuration');

                                    if (accountInteraction.customId === 'add_main_account') {
                                        const schoolInput = new TextInputBuilder()
                                            .setCustomId('school')
                                            .setLabel('School')
                                            .setPlaceholder('If needed for login')
                                            .setRequired(false)
                                            .setStyle(TextInputStyle.Short);

                                        const emailInput = new TextInputBuilder()
                                            .setCustomId('email')
                                            .setLabel('Email Address/Username')
                                            .setStyle(TextInputStyle.Short);

                                        const passwordInput = new TextInputBuilder()
                                            .setCustomId('password')
                                            .setLabel('Password')
                                            .setStyle(TextInputStyle.Short);

                                        const typeInput = new StringSelectMenuBuilder()
                                            .setCustomId('type')
                                            .setPlaceholder('Normal/Microsoft/Google (If needed for login)')
                                            .addOptions(
                                                { label: 'Normal', value: 'Normal', emoji: emojis.sparx },
                                                { label: 'Microsoft', value: 'Microsoft', emoji: emojis.microsoft },
                                                { label: 'Google', value: 'Google', emoji: emojis.google }
                                            );

                                        const sparxInput = new StringSelectMenuBuilder()
                                            .setCustomId('platform')
                                            .setPlaceholder('Platform')
                                            .addOptions(
                                                { label: 'Reader', value: 'reader', emoji: emojis.reader },
                                                { label: 'Maths', value: 'maths', emoji: emojis.maths },
                                                { label: 'Science', value: 'science', emoji: emojis.science },
                                                { label: 'LanguageNut', value: 'languagenut', emoji: emojis.languagenut },
                                                { label: 'Educake', value: 'educake', emoji: emojis.educake },
                                                { label: 'Seneca', value: 'seneca', emoji: emojis.seneca },
                                                { label: 'DrFrost', value: 'drfrost', emoji: emojis.drfrost }
                                            );

                                        modal.addLabelComponents(
                                            new LabelBuilder({
                                                label: 'Platform',
                                                component: sparxInput
                                            })
                                        );

                                        modal.addComponents(
                                            new ActionRowBuilder().addComponents(schoolInput),
                                            new ActionRowBuilder().addComponents(emailInput),
                                            new ActionRowBuilder().addComponents(passwordInput)
                                        );

                                        modal.addLabelComponents(
                                            new LabelBuilder({
                                                label: 'Login Type',
                                                component: typeInput
                                            })
                                        );

                                    } else if (accountInteraction.customId === 'add_main_cookie_account') {
                                        const cookieInput = new TextInputBuilder()
                                            .setCustomId('cookies')
                                            .setLabel('Cookies String')
                                            .setStyle(TextInputStyle.Paragraph);

                                        modal.addComponents(
                                            new ActionRowBuilder().addComponents(cookieInput)
                                        );
                                    }

                                    await accountInteraction.showModal(modal);
                                } catch (error) {
                                    console.error('Main account button error:', error);
                                }
                            });

                        } else if (buttonInteraction.customId === 'activate_free_trial') {
                            if (!Object.keys(account.main_accounts).length) {
                                await buttonInteraction.followUp({
                                    flags: 64,
                                    embeds: [
                                        makeEmbed(
                                            'No Main Accounts Exist',
                                            'You have no main accounts configured. Please configure at least one main account to activate your free trial. If you have just configured a main account, please run `/account` again.',
                                            0xFF474D
                                        )
                                    ]
                                });

                                return;
                            }

                            const freeTrialActivatedSuccess = await activateFreeTrial(
                                buttonInteraction.user.id
                            );

                            if (freeTrialActivatedSuccess) {
                                const freetrialRoleId = queueRanksPositions['free-trial'];

                                try {
                                    await buttonInteraction.member.roles.add(freetrialRoleId);
                                } catch (error) {
                                    console.error('Free trial role error:', error);
                                }

                                await buttonInteraction.followUp({
                                    flags: 64,
                                    embeds: [
                                        makeEmbed(
                                            'Free Trial Activated',
                                            'Your 3-day Free Trial for SparxNow has been successfully activated!',
                                            0x90EE90
                                        )
                                    ]
                                });

                            } else {
                                await buttonInteraction.followUp({
                                    flags: 64,
                                    embeds: [
                                        makeEmbed(
                                            'Free Trial Already Exists',
                                            'You already activated your Free Trial.',
                                            0xFF474D
                                        )
                                    ]
                                });
                            }
                        }

                    } catch (error) {
                        console.error('Account button interaction error:', error);
                    }
                });

            } else {
                const agreeBtn = new ButtonBuilder()
                    .setCustomId('agree')
                    .setLabel('I Agree')
                    .setEmoji({ name: '✅' })
                    .setStyle(ButtonStyle.Success);

                const message = await interaction.editReply({
                    embeds: [
                        makeEmbed(
                            'Create an Account',
                            'By creating an account, you agree to the Terms of Service of SparxNow which can be found at https://discord.com/channels/1351338824759906345/1446936637627043932'
                        )
                    ],
                    components: [makeRow(agreeBtn)]
                });

                const collector = message.createMessageComponentCollector({
                    componentType: ComponentType.Button
                });

                collector.on('collect', async (buttonInteraction) => {
                    try {
                        if (buttonInteraction.customId === 'agree') {
                            await buttonInteraction.deferUpdate();

                            const createBtn = new ButtonBuilder()
                                .setCustomId('create_master_password')
                                .setLabel('Create Master Password')
                                .setEmoji(emojis.key)
                                .setStyle(ButtonStyle.Primary);

                            await buttonInteraction.editReply({
                                embeds: [
                                    makeEmbed(
                                        'Create Master Password',
                                        'Create a Master Password that will be used whenever you choose to save an account on one of our services. The option to save an account will be provided at the homework selection, assuming you **did not** login with cookies.\n\n' +
                                        'You will be prompted to input your Master Password whenever you try to save an account.\n\n' +
                                        'The Master Password stored in the Database is hashed and all saved account data is encrypted. Consequently, we **cannot view your saved accounts or master password**, meaning all saved accounts are deleted when changing the Master Password.'
                                    )
                                ],
                                components: [makeRow(createBtn)]
                            });

                        } else if (buttonInteraction.customId === 'create_master_password') {
                            const masterPasswordInput = new TextInputBuilder()
                                .setCustomId('master_password')
                                .setLabel('Master Password')
                                .setStyle(TextInputStyle.Short);

                            const modal = new ModalBuilder()
                                .setCustomId('create_master_password')
                                .setTitle('Saved Accounts Login')
                                .addComponents(
                                    new ActionRowBuilder().addComponents(masterPasswordInput)
                                );

                            await buttonInteraction.showModal(modal);
                        }

                    } catch (error) {
                        console.error('Account creation button error:', error);
                    }
                });
            }

        } catch (error) {
            console.error('Error executing account:', error);

            const errorMessage = 'An error occurred while loading your account. Please try again.';

            try {
                await interaction.editReply({
                    content: errorMessage,
                    embeds: [],
                    components: []
                });
            } catch (replyError) {
                console.error('Could not send account error message:', replyError);
            }
        }
    }
};
