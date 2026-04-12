const fs = require("node:fs");
const path = require("node:path");
const { MessageFlags } = require("discord.js");

const customDataPath = path.join(__dirname, "..", "data", "custom_commands.json");

module.exports = {
    data: {
        name: "create-alert",
        description: "Create a new permanent slash command based on a template",
        options: [
            {
                name: "name",
                description: "The name of the new /command (lowercase, no spaces, e.g. farm-boss)",
                type: 3, // String
                required: true
            },
            {
                name: "description",
                description: "A short description of the command",
                type: 3, // String
                required: true
            },
            {
                name: "role",
                description: "The default role to mention",
                type: 8, // Role
                required: true
            },
            {
                name: "duration",
                description: "Default duration in minutes",
                type: 4, // Integer
                required: true
            },
            {
                name: "interval",
                description: "Default interval in minutes",
                type: 4, // Integer
                required: true
            },
            {
                name: "remind-before",
                description: "Default early warning in minutes (optional)",
                type: 4, // Integer
                required: false
            },
            {
                name: "color",
                description: "The HEX color for the embed (e.g. #FFD700 for Gold)",
                type: 3, // String
                required: false
            }
        ]
    },

    async execute(interaction) {
        // Only allow admins or certain roles if needed
        // For now, let's just implement the logic
        
        const name = interaction.options.getString("name").toLowerCase().replace(/ /g, "-");
        const description = interaction.options.getString("description");
        const role = interaction.options.getRole("role");
        const duration = interaction.options.getInteger("duration");
        const interval = interaction.options.getInteger("interval");
        const remindBefore = interaction.options.getInteger("remind-before") || 0;
        const colorStr = interaction.options.getString("color") || "#7289DA";
        const guildId = interaction.guildId;
        
        // Convert hex string to integer
        const color = parseInt(colorStr.replace("#", ""), 16);

        // Load existing custom commands
        let customData = {};
        try {
            if (fs.existsSync(customDataPath)) {
                customData = JSON.parse(fs.readFileSync(customDataPath, "utf-8"));
            }
        } catch (err) {
            console.error("Failed to load custom commands:", err);
        }

        // Initialize guild array if it doesn't exist
        if (!customData[guildId]) {
            customData[guildId] = [];
        }

        // Check if name already exists in THIS guild
        if (customData[guildId].some(cmd => cmd.name === name)) {
            return await interaction.reply({
                content: `Error: A custom command with the name \`/${name}\` already exists in this server!`,
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Build the new command config
        const newCommand = {
            name,
            description,
            roleId: role.id,
            duration,
            interval,
            remindBefore,
            color
        };

        customData[guildId].push(newCommand);

        // Save to file
        try {
            fs.writeFileSync(customDataPath, JSON.stringify(customData, null, 4));
            
            await interaction.reply({
                content: `✅ **Success!** Custom command \`/${name}\` has been created for **this server**.\n\n**Important:** The new command will appear in the "/" list after the bot **restarts** or re-synchronizes with Discord.`,
                flags: [] // Public success message
            });
        } catch (err) {
            console.error("Failed to save custom command:", err);
            await interaction.reply({
                content: "Failed to save the new command due to a system error.",
                flags: [MessageFlags.Ephemeral]
            });
        }
    }
};
