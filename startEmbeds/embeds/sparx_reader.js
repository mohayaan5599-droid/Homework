const { ButtonBuilder, ButtonStyle, ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ThumbnailBuilder, SectionBuilder } = require('discord.js');

const seperator = new SeparatorBuilder({
    spacing: SeparatorSpacingSize.Small
});

const section = new SectionBuilder()
.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# Sparx Reader\nAutomate your Sparx Reader homework with high accuracy and zero detection by your teacher. Simply press \`Login\` and follow the instructions to be on your way to acing your Sparx Reader homework and never fearing of Sparx Reader again in your life!\n## ✨ Features\n- ⏰ **Customisable Time** — Autocompletes your Sparx Reader homework in whatever time you want to balance speed and detection!\n- 🎯 **Very High Accuracy** — Excellent accuracy of >95% at completing questions!\n- 🧠 **Easy To Use** — Simple and intuitive to use with the press of only a few buttons!`)
)
.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: 'https://i.imgur.com/0H0TBp3.png' } }));

const mathButtons = new ActionRowBuilder()
    .addComponents(
        new ButtonBuilder()
            .setCustomId('sparxreader')
            .setLabel('Login')
            .setStyle(ButtonStyle.Success)
            .setEmoji({ name: '🔑' }),
        new ButtonBuilder()
            .setCustomId('check_queue_reader')
            .setLabel('Check Queue')
            .setStyle(ButtonStyle.Primary)
            .setEmoji({ name: '📋' })
    );

const container = new ContainerBuilder()
    .setAccentColor(0x4467C4)
    .addSectionComponents(section)
    .addSeparatorComponents(seperator)
    .addActionRowComponents(mathButtons);

module.exports = container;
