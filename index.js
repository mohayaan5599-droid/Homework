require('dotenv').config();

const token = process.env.DISCORD_TOKEN;
const ADMIN_ROLE = process.env.ADMIN_ROLE;

const fs = require('node:fs');
const fspromise = require('fs').promises;
const path = require('node:path');

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    Collection,
    ActionRowBuilder,
    ButtonBuilder,
    REST,
    Routes
} = require('discord.js');

const { logError } = require('./utils/errorLogger.js');
const { executeViewAccounts, saveAccount } = require('./handlers/savedAccountsHandler.js');
const { educake_collector, educake_model_executor } = require('./educake/main.js');
const { seneca_collector, seneca_model_executor } = require('./seneca/main.js');
const { drfrost_collector, drfrost_model_executor } = require('./drfrost/main.js');
const { createAccount } = require('./handlers/accountHandler.js');
const { mainAccountLogin } = require('./handlers/mainAccountLogin.js');

const {
    viewSavedAccounts,
    changeMasterPassword,
    updateAccountInteraction,
    changeSlots,
    disableMasterPassword,
    enableMasterPassword,
    verifyPasswordForChange,
    enableMasterPasswordDirect
} = require('./handlers/accountManager.js');

const { updateAnalyticsEmbed } = require('./utils/analytics.js');
const { handleSettings } = require('./settings/router.js');
const { handleApiKeyRequest } = require('./handlers/apikeyHandler.js');
const config = require('./config.json');
const imageSolverHandler = require('./imageSolver.js');
const util = require('util');

if (!token) {
    console.error('Missing DISCORD_TOKEN environment variable.');
    process.exit(1);
}

// Ensure the file exists
if (!fs.existsSync('logs.txt')) {
    fs.writeFileSync('logs.txt', '');
}

const logFile = fs.createWriteStream('logs.txt', { flags: 'w' });
const originalLog = console.log;

console.log = function (...args) {
    logFile.write(util.format(...args) + '\n');
    originalLog.apply(console, args);
};

async function cleanLogs(dir = 'logs') {
    await fspromise.mkdir(dir, { recursive: true });
    const entries = await fspromise.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            await cleanLogs(fullPath);
        } else if (entry.isFile() && entry.name !== '.gitkeep') {
            await fspromise.unlink(fullPath);
        }
    }
}

cleanLogs().catch(err => console.error('cleanLogs failed:', err));

const { executeTasks } = require('./executeTasks.js');
const {
    languagenut_model_executor,
    languagenut_collector
} = require('./languagenut/main.js');

const { cookieUpdate } = require('./cookies_menu.js');

process.on('uncaughtException', async (err) => {
    console.error('Uncaught Exception:', err);

    try {
        await logError(err, null, 'Global Uncaught Exception');
    } catch (e) {
        console.error('Failed to log error to DB:', e);
    }
});

process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);

    try {
        await logError(reason, null, 'Global Unhandled Rejection');
    } catch (e) {
        console.error('Failed to log error to DB:', e);
    }
});

const { sparxReaderCollector } = require('./collectors/sparxCollectors.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

client.on('error', (error) => {
    console.error('Discord Client Error:', error);
});

client.on('warn', (info) => {
    console.warn('Discord Client Warning:', info);
});

client.on('clientReady', () => {
    console.log(`Logged in as ${client.user.tag}!`);

    updateAnalyticsEmbed(client);

    setInterval(() => {
        updateAnalyticsEmbed(client);
    }, 300000);
});

client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    if (folder === '.DS_Store') continue;

    const commandsPath = path.join(foldersPath, folder);
    const stats = fs.statSync(commandsPath);

    if (!stats.isDirectory()) continue;

    const commandFiles = fs.readdirSync(commandsPath)
        .filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);

        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(
                `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
            );
        }
    }
}

// Register slash commands
async function registerSlashCommands() {
    try {
        const rest = new REST().setToken(token);
        const commands = client.commands.map(c => c.data.toJSON());

        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );

        console.log(`Registered ${commands.length} commands`);
    } catch (err) {
        console.error('Command registration failed:', err);
    }
}

async function sendPersistentEmbeds(client) {
    await updateAnalyticsEmbed(client);

    const embedsPath = path.join(__dirname, 'startEmbeds', 'embeds');
    const embedFiles = fs.readdirSync(embedsPath)
        .filter(file => file.endsWith('.js'));

    const embeds = new Map();

    for (const file of embedFiles) {
        const filePath = path.join(embedsPath, file);
        const embed = require(filePath);

        const name = file.replace('.js', '');
        embeds.set(name, embed);
    }

    console.log(`Loaded ${embeds.size} embed(s).`);

    for (const [name, container] of embeds) {
        try {
            const channelID = config.channels[name];

            if (!channelID) {
                console.log(`Channel for ${name} is not configured`);
                continue;
            }

            const channel = await client.channels.fetch(channelID);

            if (!channel) {
                console.log(`${name} channel not found`);
                continue;
            }

            const messages = await channel.messages.fetch({ limit: 50 });

            const existingMessage = messages.find(msg =>
                msg.author.id === client.user.id &&
                msg.components?.[0]?.components?.[0]?.components?.[0]?.data?.content ===
                container.components[0].components[0].data.content
            );

            let embedMessage = existingMessage;

            if (!existingMessage) {
                console.log(`Sending persistent embed for ${name}`);

                embedMessage = await channel.send({
                    flags: 32768,
                    components: [container]
                });
            }

            const collectorsMap = new Map([
                ['languagenut_persistent', languagenut_collector],
                ['sparx_maths_persistent', sparxReaderCollector],
                ['sparx_reader_persistent', sparxReaderCollector],
                ['sparx_science_persistent', sparxReaderCollector],
                ['educake_persistent', educake_collector],
                ['seneca_persistent', seneca_collector],
                ['drfrost_persistent', drfrost_collector]
            ]);

            const collector = collectorsMap.get(name + '_persistent');

            if (collector) {
                await collector(embedMessage);
            } else {
                console.log(`No collector configured for ${name}`);
            }

        } catch (error) {
            console.error(`Error loading persistent embed ${name}:`, error);
        }
    }
}

async function DeleteVideos() {
    try {
        const files = await fspromise.readdir('videos');

        if (files.length > 1) {
            console.log('Deleting files...');

            for (const file of files) {
                if (file === '.gitkeep') continue;

                const filePath = path.join('videos', file);
                await fspromise.unlink(filePath);

                console.log(`Deleted ${file}`);
            }

            console.log('All files deleted.');
        } else {
            console.log('No files to delete.');
        }
    } catch (err) {
        console.error('Error deleting files:', err);
    }
}

client.once('clientReady', async () => {
    console.log('Bot has connected to discord');

    await registerSlashCommands();
    await sendPersistentEmbeds(client);
    await DeleteVideos();
});

// Slash command interactions
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
        return interaction.reply({
            content: `No command matching ${interaction.commandName} was found.`,
            flags: 64
        }).catch(console.error);
    }

    if (!interaction.guild) {
        return interaction.reply({
            content: 'This command can only be used in a server.',
            flags: 64
        }).catch(console.error);
    }

    // Discord provides the member's roles in the interaction.
    // This avoids an extra API request before executing the command.
    const memberRoles = interaction.member?.roles;

    const hasAdminRole =
        memberRoles?.cache?.has(ADMIN_ROLE) ??
        (Array.isArray(memberRoles) && memberRoles.includes(ADMIN_ROLE));

    if (!hasAdminRole && !command.public) {
        return interaction.reply({
            content: 'Only admins can run commands.',
            flags: 64
        }).catch(console.error);
    }

    try {
        await command.execute(interaction, client);
    } catch (error) {
        console.error(
            `Error executing /${interaction.commandName}:`,
            error
        );

        try {
            await logError(
                error,
                interaction.user,
                `Slash Command: ${interaction.commandName}`
            );
        } catch (logErr) {
            console.error('Failed to log command error:', logErr);
        }

        const errorMessage = `An error occurred: ${error.message || 'Unknown error'}`;

        if (interaction.deferred) {
            await interaction.editReply({
                content: errorMessage,
                components: []
            }).catch(console.error);
        } else if (interaction.replied) {
            await interaction.followUp({
                content: errorMessage,
                flags: 64
            }).catch(console.error);
        } else {
            await interaction.reply({
                content: errorMessage,
                flags: 64
            }).catch(console.error);
        }
    }
});

// Modal submit interactions
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    try {
        if (interaction.customId.startsWith('set_slots')) {
            await interaction.deferUpdate();
            await changeSlots(interaction);
            return;
        }

        if (interaction.customId === 'change_apikey') {
            await interaction.deferUpdate();
            await handleApiKeyRequest(interaction);
            return;
        }

        if (interaction.customId === 'handleSettings') {
            await interaction.deferReply({ flags: 64 });
            await handleSettings(interaction);
            return;
        }

        if (interaction.customId === 'accountManager_service') {
            await interaction.deferUpdate();
            await updateAccountInteraction(interaction);
            return;
        }

        if (interaction.customId === 'view_accounts') {
            await viewSavedAccounts(interaction);
            return;
        }

        if (interaction.customId === 'change_master_password') {
            await changeMasterPassword(interaction);
            return;
        }

        if (interaction.customId.startsWith('main_account')) {
            if (interaction.customId.endsWith('configure')) {
                await mainAccountLogin(interaction);
            } else if (interaction.customId.endsWith('remove')) {
                await mainAccountLogin(interaction, true);
            }
            return;
        }

        if (interaction.customId === 'create_master_password') {
            await createAccount(interaction);
            return;
        }

        if (interaction.customId === 'confirm_disable_mp') {
            await disableMasterPassword(interaction);
            return;
        }

        if (interaction.customId === 'confirm_enable_mp') {
            await enableMasterPassword(interaction);
            return;
        }

        if (interaction.customId === 'verify_password_for_change') {
            await verifyPasswordForChange(interaction);
            return;
        }

        if (interaction.customId === 'enable_master_password_direct') {
            await enableMasterPasswordDirect(interaction);
            return;
        }

        if (interaction.customId.startsWith('seneca')) {
            try {
                await seneca_model_executor(interaction);
            } catch (err) {
                if (err.code !== 10062) {
                    console.error('Error in seneca_model_executor:', err);
                }
            }
            return;
        }

        if (interaction.customId.startsWith('drfrost')) {
            try {
                await drfrost_model_executor(interaction);
            } catch (err) {
                if (err.code !== 10062) {
                    console.error('Error in drfrost_model_executor:', err);
                }
            }
            return;
        }

        if (interaction.customId.startsWith('educake')) {
            try {
                await educake_model_executor(interaction);
            } catch (err) {
                if (err.code !== 10062) {
                    console.error('Error in educake_model_executor:', err);
                }
            }
            return;
        }

        if (interaction.customId.startsWith('languagenut_set')) {
            await languagenut_model_executor(interaction);
            return;
        }

        if (interaction.customId.startsWith('save_account')) {
            await interaction.deferReply({ flags: 64 });
            await saveAccount(interaction);
            return;
        }

        if (interaction.customId.startsWith('view_saved_accounts')) {
            try {
                await interaction.deferReply({ flags: 64 });
                await executeViewAccounts(interaction);
                return;
            } catch {
                return;
            }
        }

        if (interaction.customId === 'cookies_maintenance') {
            await cookieUpdate(interaction);
            return;
        }

        if (!interaction.guild) {
            if (!interaction.replied && !interaction.deferred) {
                return interaction.reply({
                    content: 'This bot can only be used in a server.',
                    flags: 64
                });
            }
            return;
        }

        if (interaction.customId === 'languagenut_login_modal') {
            try {
                await languagenut_model_executor(interaction);
            } catch (error) {
                console.error('Error in languagenut_model_executor:', error);

                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: 'An error occurred while processing your LanguageNut login. Please try again.',
                        flags: 64
                    }).catch(replyError => {
                        console.error('Failed to send error reply for LanguageNut:', replyError);
                    });
                }
            }
            return;
        }

        if (interaction.customId.startsWith('loginSparx')) {
            if (!interaction.replied && !interaction.deferred) {
                try {
                    await interaction.deferReply({ flags: 64 });
                } catch (err) {
                    if (err.code === 10062) return;
                    throw err;
                }
            }

            await executeTasks(interaction);
            return;
        }

        if (
            interaction.customId.startsWith('sparxreader') ||
            interaction.customId.startsWith('sparxmaths') ||
            interaction.customId.startsWith('sparxscience')
        ) {
            if (!interaction.replied && !interaction.deferred) {
                try {
                    await interaction.deferUpdate();
                } catch (err) {
                    if (err.code === 10062) return;
                    throw err;
                }
            }

            await executeTasks(interaction);
            return;
        }

    } catch (error) {
        if (error.code === 40060 || error.code === 10062) {
            console.log(
                `Interaction timeout or already acknowledged, ignoring: ${error.code}`
            );
            return;
        }

        console.error('Error handling modal submit interaction:', error);

        await logError(
            error,
            interaction.user,
            'Modal Submit Handler'
        ).catch(e => console.error('Failed to log modal error:', e));

        try {
            const errorMessage = {
                content: 'An error occurred while processing your request. Please try again.',
                flags: 64
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage).catch(() => {});
            } else {
                await interaction.reply(errorMessage).catch(() => {});
            }
        } catch (e) {
            // Ignore further errors in the error reporter
        }
    }
});

// Button interactions
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (['resolved', 'close_ticket'].includes(interaction.customId)) {
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch {
            return;
        }

        const embed = interaction.message.embeds[0];

        if (!embed || !embed.footer || !embed.footer.text) {
            await interaction.editReply(
                'Could not find ticket information in the embed footer.'
            );
            return;
        }

        const footerText = embed.footer.text;
        const userIdMatch = footerText.match(/UserID:(\d+)/);

        if (!userIdMatch) {
            await interaction.editReply(
                'Could not parse user ID from the embed footer.'
            );
            return;
        }

        const userId = userIdMatch[1];
        const ticketChannel = interaction.channel;

        if (interaction.customId === 'close_ticket') {
            await interaction.editReply('Deleting ticket...');

            setTimeout(() => {
                ticketChannel.delete().catch(err =>
                    console.error('Failed to delete ticket channel:', err)
                );
            }, 1000);

        } else if (interaction.customId === 'resolved') {
            const resolvedEmbed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('Bug Resolved!')
                .setDescription(
                    "Thank you for your bug report! Our team has investigated and we're happy to let you know that the issue has been fixed.\nYou can now try again. If you run into any other problems, please let us know again."
                )
                .setFooter({
                    text: 'Thanks for making SparxNow better!'
                });

            try {
                const user = await client.users.fetch(userId);

                await user.send({
                    embeds: [resolvedEmbed]
                });

                await interaction.editReply({
                    content: 'Resolution notice sent to the user.'
                });

            } catch (e) {
                console.error(
                    'Failed to send resolution message or disable buttons:',
                    e
                );

                await interaction.editReply({
                    content: 'Could not send the resolution message to the user or disable buttons. They may have DMs disabled or the message was deleted.'
                });
            }
        }

        // Disable the buttons after processing
        const components = interaction.message.components;

        const updatedComponents = components.map(row => {
            if (
                row.components.some(comp =>
                    comp.customId === 'resolved' ||
                    comp.customId === 'close_ticket'
                )
            ) {
                const newRow = new ActionRowBuilder();

                row.components.forEach(comp => {
                    const button = ButtonBuilder.from(comp);

                    if (
                        button.customId === 'resolved' ||
                        button.customId === 'close_ticket'
                    ) {
                        button.setDisabled(true);
                    }

                    newRow.addComponents(button);
                });

                return newRow;
            }

            return row;
        });

        await interaction.message.edit({
            components: updatedComponents
        });

        return;
    }
});

// Message interactions
client.on('messageCreate', async (message) => {
    await imageSolverHandler(message);
});

if (require.main === module) {
    client.login(token);
}
