require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { DISCORD_TOKEN: token } = process.env;
const { Client, GatewayIntentBits, Events, Collection, MessageFlags, InteractionType } = require("discord.js");

const db = require("./database");
const templateAlert = require("./logic/template-alert.js");
const { syncGuildCommands } = require("./logic/command-sync");
const SPLIT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

// Ensure "Bank Manager" role exists in a guild
async function ensureBankRoles(guild) {
    let role;
    const adminRoleId = db.settings.get(guild.id, "adminRoleId");
    if (adminRoleId) {
        role = await guild.roles.fetch(adminRoleId).catch(() => null);
    }

    if (!role) {
        role = guild.roles.cache.find(r => r.name === "Bank Manager");
    }

    if (role) {
        if (adminRoleId !== role.id) {
            db.settings.set(guild.id, "adminRoleId", role.id);
        }
        return;
    }

    if (!guild.members.me.permissions.has("ManageRoles")) {
        console.warn(`[BANK] Missing ManageRoles permission in ${guild.name}. Cannot create 'Bank Manager' role. Grant Manage Roles or run /bank setup with an existing role.`);
        return;
    }

    try {
        role = await guild.roles.create({
            name: "Bank Manager",
            colors: { primaryColor: "#FFD700" },
            reason: "Required for Bank Economy System"
        });
        console.log(`[BANK] Created 'Bank Manager' role in ${guild.name}`);
    } catch (err) {
        console.error(`[BANK] Failed to create role in ${guild.name}:`, err);
    }

    if (role && adminRoleId !== role.id) {
        db.settings.set(guild.id, "adminRoleId", role.id);
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    if (command.internalOnly) {
        continue;
    }

    if ("data" in command && typeof command.execute === "function") {
        client.commands.set(command.data.name, command);
    } else {
        console.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Loaded ${client.commands.size} base modular commands.`);

    const purgedSplits = db.splitCleanup.purgeStale(SPLIT_RETENTION_MS);
    if (purgedSplits > 0) {
        console.log(`[CLEANUP] Purged ${purgedSplits} stale split session(s) during startup.`);
    }

    const guilds = await client.guilds.fetch();
    console.log(`Syncing roles and slash commands for ${guilds.size} servers...`);

    for (const [id] of guilds) {
        try {
            const guild = await client.guilds.fetch(id);
            await ensureBankRoles(guild);
            await syncGuildCommands(client, guild);
        } catch (err) {
            console.error(`Failed to fetch and sync for guild ${id}:`, err);
        }
    }

    console.log("Guild command synchronization complete.");
});

client.on(Events.GuildCreate, async (guild) => {
    console.log(`Joined new server: ${guild.name}! Registering commands...`);
    await ensureBankRoles(guild);

    try {
        await syncGuildCommands(client, guild);
    } catch (error) {
        console.error(`[SYNC] Failed to register commands on join for ${guild.name}:`, error);
    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (command) {
            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`Error executing ${interaction.commandName}:`, error);
                const errorMessage = { content: "There was an error while executing this command!", flags: [MessageFlags.Ephemeral] };
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(errorMessage);
                } else {
                    await interaction.reply(errorMessage);
                }
            }
            return;
        }

        // Fallback: dynamic DB-backed custom commands synced to guild.
        const customConfig = db.customCommands.get(interaction.guildId, interaction.commandName);
        if (!customConfig) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await templateAlert.execute(interaction, customConfig);
        } catch (error) {
            console.error(`Error executing custom command ${interaction.commandName}:`, error);
            const errorMessage = { content: "There was an error while executing this custom command!", flags: [MessageFlags.Ephemeral] };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage);
            } else {
                await interaction.reply(errorMessage);
            }
        }
    } else if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
        const command = client.commands.get(interaction.commandName);

        if (!command) return;

        try {
            if (command.autocomplete) {
                await command.autocomplete(interaction);
            }
        } catch (error) {
            console.error(`Autocomplete error for ${interaction.commandName}:`, error);
        }
    } else if (interaction.isButton()) {
        const customId = interaction.customId;

        if (customId.startsWith("split_")) {
            const splitCommand = client.commands.get("split");
            if (splitCommand && splitCommand.handleButton) {
                return await splitCommand.handleButton(interaction);
            }
        }

        if (customId.startsWith("stop_vortex_")) {
            await templateAlert.handleButton(interaction);
        } else if (customId.startsWith("stop_alert_")) {
            if (templateAlert && templateAlert.handleButton) {
                await templateAlert.handleButton(interaction);
            }
        }
    } else if (interaction.isAnySelectMenu()) {
        const customId = interaction.customId;

        if (customId.startsWith("split_")) {
            const splitCommand = client.commands.get("split");
            if (splitCommand && splitCommand.handleSelectMenu) {
                return await splitCommand.handleSelectMenu(interaction);
            }
        }
    }
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;
    if (message.content === "!ping") {
        message.reply("Pong! (Legacy mode)");
    }
});

client.login(token);
