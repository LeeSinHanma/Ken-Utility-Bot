require('dotenv').config();
const fs = require("node:fs");
const path = require("node:path");
const { botOwners, bankAdminRoles } = require("./config.json");
const { DISCORD_TOKEN: token, CLIENT_ID: clientId, GUILD_ID: guildId } = process.env;
const {Client, GatewayIntentBits, REST, Routes, Events, Collection, MessageFlags, InteractionType} = require("discord.js");

const db = require("./database");

// Ensure "Bank Manager" role exists in a guild
async function ensureBankRoles(guild) {
    if (!guild.members.me.permissions.has("ManageRoles")) {
        console.warn(`[BANK] Missing ManageRoles permission in ${guild.name}. Cannot ensure roles.`);
        return;
    }

    let role;
    const adminRoleId = db.settings.get(guild.id, "adminRoleId");
    if (adminRoleId) {
        role = await guild.roles.fetch(adminRoleId).catch(() => null);
    }
    
    if (!role) {
        role = guild.roles.cache.find(r => r.name === "Bank Manager");
    }
    
    if (!role) {
        try {
            role = await guild.roles.create({
                name: "Bank Manager",
                color: "#FFD700",
                reason: "Required for Bank Economy System"
            });
            console.log(`[BANK] Created 'Bank Manager' role in ${guild.name}`);
        } catch (err) {
            console.error(`[BANK] Failed to create role in ${guild.name}:`, err);
        }
    }
    
    if (role && adminRoleId !== role.id) {
        db.settings.set(guild.id, "adminRoleId", role.id);
    }
}

// Initialize Client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent // Needed for legacy !ping
    ]
});

// Command Collection for modular handling
client.commands = new Collection();

// Load commands dynamically from the commands/ directory
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

const commandsData = []; // To store data for registration

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    
    if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
        commandsData.push(command.data);
    } else {
        console.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}



client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Loaded ${client.commands.size} base modular commands.`);
    
    const rest = new REST({version: "10"}).setToken(token);
    const templateAlert = require("./commands/template-alert.js");

    // Define registration function for custom commands per guild
    const registerGuildCommands = async (guild) => {
        const guildId = guild.id;
        const guildCommandsData = [];

        // Core commands are registered GLOBALLY now. 
        // We only use guild registration for VIRTUAL (Custom) commands.
        const customConfigs = db.customCommands.getForGuild(guildId);
        
        for (const config of customConfigs) {
            const virtualCommand = {
                isVirtual: true,
                data: {
                    name: config.name,
                    description: config.description,
                    options: [
                        { name: "target-role", description: `Override role (Preset: ${config.roleId ? "Set" : "None"})`, type: 8, required: false },
                        { name: "location", description: "Set or override location", type: 3, required: false },
                        { name: "vortex-image", description: "Upload a screenshot", type: 11, required: false },
                        { name: "duration", description: `Override duration (Preset: ${config.duration}m)`, type: 4, required: false },
                        { name: "interval", description: `Override interval (Preset: ${config.interval}m)`, type: 4, required: false },
                        { name: "remind-before", description: `Override early warning (Preset: ${config.remindBefore || 0}m)`, type: 4, required: false }
                    ]
                },
                async execute(interaction) {
                    await templateAlert.execute(interaction, config);
                },
                async handleButton(interaction) {
                    await templateAlert.handleButton(interaction);
                }
            };

            if (!client.commands.has(config.name)) {
                client.commands.set(config.name, virtualCommand);
            }
            guildCommandsData.push(virtualCommand.data);
        }

        try {
            // Put even if empty to clear old guild commands if necessary
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: guildCommandsData });
            if (guildCommandsData.length > 0) {
                console.log(`[SYNC] Synced ${guildCommandsData.length} custom commands for server: ${guild.name}`);
            }
        } catch (error) {
            console.error(`Failed to register custom commands for server ${guild.name}:`, error);
        }
    };

    // 1. REGISTER GLOBAL COMMANDS (ONCE)
    const globalCommandsData = [];
    client.commands.forEach(cmd => {
        if (cmd.data && !cmd.isVirtual) {
            globalCommandsData.push(cmd.data);
        }
    });

    try {
        console.log(`Refreshing ${globalCommandsData.length} global application (/) commands...`);
        await rest.put(Routes.applicationCommands(clientId), { body: globalCommandsData });
        console.log("Successfully reloaded global application (/) commands.");
    } catch (error) {
        console.error("Failed to register global commands:", error);
    }

    // 2. REGISTER GUILD-SPECIFIC CUSTOM COMMANDS + SETUP ROLES
    const guilds = await client.guilds.fetch();
    console.log(`Syncing roles and custom commands for ${guilds.size} servers...`);
    
    for (const [id, guildInfo] of guilds) {
        try {
            const guild = await client.guilds.fetch(id);
            await ensureBankRoles(guild);
            await registerGuildCommands(guild);
        } catch (err) {
            console.error(`Failed to fetch and sync for guild ${id}:`, err);
        }
    }

    console.log("Global command synchronization complete.");
});

// Sync commands when joining a new server
client.on(Events.GuildCreate, async (guild) => {
    console.log(`Joined new server: ${guild.name}! Registering commands...`);
    // Note: We'd need to re-fetch customData or have it updated
    // For simplicity, we just trigger the registration with what's on disk
    const registerGuildCommands = async (guild) => {
        const rest = new REST({version: "10"}).setToken(token);
        const guildCommandsData = [];
        client.commands.forEach(cmd => { if (cmd.data && !cmd.isVirtual) guildCommandsData.push(cmd.data); });
        try {
            await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: guildCommandsData });
            console.log(`[SYNC] Registered base commands for new server: ${guild.name}`);
        } catch (error) {
            console.error("Failed to register commands on join:", error);
        }
    };
    await ensureBankRoles(guild);
    await registerGuildCommands(guild);
});

client.on(Events.InteractionCreate, async interaction => {
    // Handle Slash Commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

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
    } 
    
    // Handle Autocomplete Interactions
    else if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
        const command = client.commands.get(interaction.commandName);

        if (!command) return;

        try {
            if (command.autocomplete) {
                await command.autocomplete(interaction);
            }
        } catch (error) {
            console.error(`Autocomplete error for ${interaction.commandName}:`, error);
        }
    }
    
    // Handle Button Interactions
    else if (interaction.isButton()) {
        const customId = interaction.customId;

        // 1. Check for split command buttons
        if (customId.startsWith("split_")) {
            const splitCommand = client.commands.get("split");
            if (splitCommand && splitCommand.handleButton) {
                return await splitCommand.handleButton(interaction);
            }
        }

        // 2. Check for basic Vortex buttons (Legacy/Migration check)
        if (customId.startsWith("stop_vortex_")) {
            const templateAlert = require("./commands/template-alert.js");
            await templateAlert.handleButton(interaction);
        }
        // 3. Check for "Template Alert" / Custom buttons
        else if (customId.startsWith("stop_alert_")) {
            const templateAlert = require("./commands/template-alert.js");
            if (templateAlert && templateAlert.handleButton) {
                await templateAlert.handleButton(interaction);
            }
        }
    }
    
    // Handle Select Menu Interactions
    else if (interaction.isAnySelectMenu()) {
        const customId = interaction.customId;

        // Route split command select menus
        if (customId.startsWith("split_")) {
            const splitCommand = client.commands.get("split");
            if (splitCommand && splitCommand.handleSelectMenu) {
                return await splitCommand.handleSelectMenu(interaction);
            }
        }
    }
});

// Legacy Message Handler
client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;
    if (message.content === "!ping") {
        message.reply("Pong! (Legacy mode)");
    }
});

client.login(token);
