const {
    SlashCommandBuilder,
    TextInputStyle,
    ModalBuilder,
    TextInputBuilder,
    ComponentType,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags
} = require('discord.js');

const { checkAccount } = require('../../database/accounts');
const formatTime = require('../../utils/formatTime');
const config = require('../../config.json');

function getSettingsEmoji() {
    const emoji = config.emojis?.settings;

    if (!emoji) return '⚙️';

    if (typeof emoji === 'string') {
        return emoji;
    }

    if (typeof emoji === 'object' && emoji.id) {
        return {
            id: emoji.id,
            name: emoji.name || 'settings',
            animated: Boolean(emoji.animated)
        };
    }

    return '⚙️';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('get_account')
        .setDescription('Get the account of someone')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to get the account of')
                .setRequired(true)
        ),

    async execute(interaction) {
        try {
            const user = interaction.options.getUser('user');

            if (!user) {
                return interaction.reply({
                    content: 'Could not find that user.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const account = await checkAccount(user.id);

            if (!account) {
                const section = new TextDisplayBuilder()
                    .setContent('## No Account\nThe user has no account.');

                const container = new ContainerBuilder()
                    .setAccentColor(0x353839)
                    .addTextDisplayComponents(section.data);

                return interaction.reply({
                    flags: 32768 | 64,
                    components: [container]
                });
            }

            const totalUsage = account.total_usage || {};
            const uses = account.uses || {};

            let totalUses = 0;
            let platformsUsed = '';
            let timeSaved = 0;
            let timeSavedPlatforms = '';

            for (const [name, platform] of Object.entries(totalUsage)) {
                const platformUses = Number(platform?.total_uses) || 0;
                const platformTimeSaved = Number(platform?.time_saved) || 0;

                totalUses += platformUses;
                platformsUsed += `${name.charAt(0).toUpperCase() + name.slice(1)}: ${platformUses}\n`;

                timeSaved += platformTimeSaved;
                timeSavedPlatforms += `${name.charAt(0).toUpperCase() + name.slice(1)}: ${formatTime(platformTimeSaved)}\n`;
            }

            let usages = '';

            for (const [platform, usage] of Object.entries(uses)) {
                const usageCount = Array.isArray(usage) ? usage.length : 0;

                usages += `${platform.charAt(0).toUpperCase() + platform.slice(1)}: ${usageCount}/${account.slots ?? 0}\n`;
            }

            const section = new TextDisplayBuilder()
                .setContent(
                    `## <@${user.id}>'s Account\n` +
                    `**Total Usage**: They have used the bot a total of **${totalUses}** times.\n` +
                    `**Slots Limit**: They have an account slots limit of **${account.slots ?? 0}**.\n` +
                    `**Account Rank**: Their current account rank is **${account.license ?? 'None'}**.\n` +
                    `### Account Slots (Last 24 Hours)\n` +
                    `\`\`\`js\n${usages || 'No slots used in the past 24 Hours'}\`\`\``
                );

            const statsBtn = new ButtonBuilder()
                .setCustomId('set_slots')
                .setLabel('Set Slots')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(getSettingsEmoji());

            const row = new ActionRowBuilder().addComponents(statsBtn);

            const separator = new SeparatorBuilder({
                spacing: SeparatorSpacingSize.Small
            });

            const container = new ContainerBuilder()
                .setAccentColor(0x353839)
                .addTextDisplayComponents(section.data)
                .addSeparatorComponents(separator)
                .addActionRowComponents(row);

            const messageSent = await interaction.reply({
                flags: 32768 | 64,
                components: [container],
                fetchReply: true
            });

            const collector = messageSent.createMessageComponentCollector({
                componentType: ComponentType.Button
            });

            collector.on('collect', async buttonInteraction => {
                if (buttonInteraction.customId !== 'set_slots') return;

                try {
                    const modal = new ModalBuilder()
                        .setCustomId(`set_slots_${user.id}`)
                        .setTitle('Set Slots');

                    const slotsInput = new TextInputBuilder()
                        .setCustomId('slots')
                        .setLabel('Slots')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(slotsInput)
                    );

                    await buttonInteraction.showModal(modal);
                } catch (error) {
                    console.error('Set slots modal error:', error);

                    if (!buttonInteraction.replied && !buttonInteraction.deferred) {
                        await buttonInteraction.reply({
                            content: 'Could not open the Set Slots form.',
                            flags: MessageFlags.Ephemeral
                        }).catch(() => {});
                    }
                }
            });

        } catch (error) {
            console.error('Error executing /get_account:', error);

            const errorMessage = {
                content: 'An error occurred while retrieving that account. Check the bot logs for details.',
                flags: MessageFlags.Ephemeral
            };

            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(errorMessage).catch(() => {});
            } else {
                await interaction.reply(errorMessage).catch(() => {});
            }
        }
    }
};
