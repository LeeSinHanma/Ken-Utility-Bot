const { MessageFlags } = require("discord.js");
const db = require("../database");
const { syncGuildCommands } = require("../logic/command-sync");

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

        // Check if name already exists in THIS guild
        const existingCommands = db.customCommands.getForGuild(guildId);
        if (existingCommands.some(cmd => cmd.name === name)) {
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

        // Save to DB then sync this guild immediately
        try {
            db.customCommands.add(guildId, name, newCommand);
            await syncGuildCommands(interaction.client, interaction.guild);
            
            await interaction.reply({
                content: `✅ **Success!** Custom command \`/${name}\` has been created and synced for **this server**. It should appear in the slash command list within seconds.`,
                flags: [] // Public success message
            });
        } catch (err) {
            console.error(`[SYNC] Failed to create and sync custom command \"${name}\" for guild ${guildId}:`, err);
            await interaction.reply({
                content: "The command was not fully synced due to a system error. Check logs for details.",
                flags: [MessageFlags.Ephemeral]
            });
        }
    }
};
