const fs = require("node:fs");
const path = require("node:path");
const { MessageFlags } = require("discord.js");

const customDataPath = path.join(__dirname, "..", "data", "custom_commands.json");

module.exports = {
    data: {
        name: "edit-alert",
        description: "Modify an existing custom slash command",
        options: [
            {
                name: "name",
                description: "The name of the command to edit",
                type: 3, // String
                required: true,
                autocomplete: true
            },
            {
                name: "description",
                description: "New description (leave blank to keep current)",
                type: 3, // String
                required: false
            },
            {
                name: "role",
                description: "New default role to mention",
                type: 8, // Role
                required: false
            },
            {
                name: "duration",
                description: "New default duration in minutes",
                type: 4, // Integer
                required: false
            },
            {
                name: "interval",
                description: "New default interval in minutes",
                type: 4, // Integer
                required: false
            },
            {
                name: "remind-before",
                description: "New default early warning in minutes",
                type: 4, // Integer
                required: false
            },
            {
                name: "color",
                description: "New HEX color for the embed (e.g. #FF0000)",
                type: 3, // String
                required: false
            }
        ]
    },

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const guildId = interaction.guildId;

        let customData = {};
        try {
            if (fs.existsSync(customDataPath)) {
                customData = JSON.parse(fs.readFileSync(customDataPath, "utf-8"));
            }
        } catch (err) {
            return await interaction.respond([]);
        }

        const guildCommands = customData[guildId] || [];
        const choices = guildCommands.map(cmd => cmd.name);
        const filtered = choices.filter(choice => choice.toLowerCase().includes(focusedValue));
        
        await interaction.respond(
            filtered.slice(0, 25).map(choice => ({ name: choice, value: choice }))
        );
    },

    async execute(interaction) {
        const name = interaction.options.getString("name");
        const guildId = interaction.guildId;

        let customData = {};
        try {
            if (fs.existsSync(customDataPath)) {
                customData = JSON.parse(fs.readFileSync(customDataPath, "utf-8"));
            }
        } catch (err) {
            console.error("Failed to load custom commands:", err);
        }

        if (!customData[guildId]) {
            return await interaction.reply({ content: "No custom commands found for this server.", flags: [MessageFlags.Ephemeral] });
        }

        const commandIndex = customData[guildId].findIndex(cmd => cmd.name === name);
        if (commandIndex === -1) {
            return await interaction.reply({ content: `Command \`/${name}\` not found in this server.`, flags: [MessageFlags.Ephemeral] });
        }

        const cmd = customData[guildId][commandIndex];

        // Update fields if provided
        const newDesc = interaction.options.getString("description");
        const newRole = interaction.options.getRole("role");
        const newDuration = interaction.options.getInteger("duration");
        const newInterval = interaction.options.getInteger("interval");
        const newRemindBefore = interaction.options.getInteger("remind-before");
        const newColorStr = interaction.options.getString("color");

        if (newDesc !== null) cmd.description = newDesc;
        if (newRole !== null) cmd.roleId = newRole.id;
        if (newDuration !== null) cmd.duration = newDuration;
        if (newInterval !== null) cmd.interval = newInterval;
        if (newRemindBefore !== null) cmd.remindBefore = newRemindBefore;
        if (newColorStr !== null) {
            cmd.color = parseInt(newColorStr.replace("#", ""), 16);
        }

        // Save back to file
        try {
            fs.writeFileSync(customDataPath, JSON.stringify(customData, null, 4));
            await interaction.reply({
                content: `✅ **Success!** Command \`/${name}\` has been updated.\n\n**Note:** Like creation, these changes will take effect after the bot restarts or re-syncs.`,
                flags: []
            });
        } catch (err) {
            console.error("Failed to save edited command:", err);
            await interaction.reply({ content: "Failed to save the changes due to a system error.", flags: [MessageFlags.Ephemeral] });
        }
    }
};
