const fs = require("node:fs");
const path = require("node:path");
const {token, clientId, guildId} = require("./config.json");
const {Client, GatewayIntentBits, REST, Routes, Events, Collection, MessageFlags, InteractionType} = require("discord.js");

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
    const customDataPath = path.join(__dirname, "data", "custom_commands.json");
    const templateAlert = require("./commands/template-alert.js");

    // Load custom commands but we only use them to create "virtual" command objects
    let customData = {};
    if (fs.existsSync(customDataPath)) {
        try {
            customData = JSON.parse(fs.readFileSync(customDataPath, "utf-8"));
        } catch (err) {
            console.error("Failed to load custom commands factory:", err);
        }
    }

    // Define registration function for a single guild
    const registerGuildCommands = async (guild) => {
        const guildId = guild.id;
        const guildCommandsData = [];

        // 1. Add all STATIC commands from the commands/ directory
        // We filter out template-alert here if needed, but the loader already skips things without data
        client.commands.forEach(cmd => {
            // To prevent recursion/confusion, only add real file-based commands here
            if (cmd.data && !cmd.isVirtual) {
                guildCommandsData.push(cmd.data);
            }
        });

        // 2. Add VIRTUAL (Custom) commands for THIS specific guild
        if (customData[guildId]) {
            for (const config of customData[guildId]) {
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

                // Add to client.commands for the interaction handler to find it
                // Note: Collision check - if multiple guilds use the same command name,
                // our handler will find the template which then uses guildId to find config.
                // We'll store it as a single entry in client.commands because the template handles the guild lookup.
                if (!client.commands.has(config.name)) {
                    client.commands.set(config.name, virtualCommand);
                }
                guildCommandsData.push(virtualCommand.data);
            }
        }

        try {
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: guildCommandsData });
            console.log(`[SYNC] Synced ${guildCommandsData.length} commands for server: ${guild.name} (${guildId})`);
        } catch (error) {
            console.error(`Failed to register commands for server ${guild.name}:`, error);
        }
    };

    // Parallel registration for all guilds
    const guilds = await client.guilds.fetch();
    console.log(`Starting command synchronization for ${guilds.size} servers...`);
    
    for (const [id, guildInfo] of guilds) {
        try {
            const guild = await client.guilds.fetch(id);
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
        // Buttons currently use a specific format, e.g. "stop_vortex_12345" or "stop_alert_12345"
        
        // 1. Check for basic Vortex buttons (Legacy/Migration check)
        if (interaction.customId.startsWith("stop_vortex_")) {
            // Check if any command (like vortex-ping used to) handles it
            const templateAlert = require("./commands/template-alert.js");
            await templateAlert.handleButton(interaction);
        }
        // 2. Check for "Template Alert" / Custom buttons
        else if (interaction.customId.startsWith("stop_alert_")) {
            // All custom commands share the handleButton in template-alert.js
            const templateAlert = require("./commands/template-alert.js");
            if (templateAlert && templateAlert.handleButton) {
                await templateAlert.handleButton(interaction);
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
