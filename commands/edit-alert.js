const { MessageFlags } = require("discord.js");
const db = require("../database");
const { syncGuildCommands } = require("../logic/command-sync");

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

        let guildCommands = [];
        try {
            guildCommands = db.customCommands.getForGuild(guildId);
        } catch (err) {
            return await interaction.respond([]);
        }

        const choices = guildCommands.map(cmd => cmd.name);
        const filtered = choices.filter(choice => choice.toLowerCase().includes(focusedValue));
        
        await interaction.respond(
            filtered.slice(0, 25).map(choice => ({ name: choice, value: choice }))
        );
    },

    async execute(interaction) {
        const name = interaction.options.getString("name");
        const guildId = interaction.guildId;

        let guildCommands = [];
        try {
            guildCommands = db.customCommands.getForGuild(guildId);
        } catch (err) {
            console.error("Failed to load custom commands:", err);
        }

        if (guildCommands.length === 0) {
            return await interaction.reply({ content: "No custom commands found for this server.", flags: [MessageFlags.Ephemeral] });
        }

        const commandIndex = guildCommands.findIndex(cmd => cmd.name === name);
        if (commandIndex === -1) {
            return await interaction.reply({ content: `Command \`/${name}\` not found in this server.`, flags: [MessageFlags.Ephemeral] });
        }

        const cmd = guildCommands[commandIndex];

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

        // Save back to DB and sync this guild immediately
        try {
            db.customCommands.add(guildId, name, cmd);
            await syncGuildCommands(interaction.client, guildId);
            await interaction.reply({
                content: `✅ **Success!** Command \`/${name}\` has been updated and synced for this server.`,
                flags: []
            });
        } catch (err) {
            console.error(`[SYNC] Failed to edit and sync custom command \"${name}\" for guild ${guildId}:`, err);
            await interaction.reply({ content: "Failed to save the changes due to a system error.", flags: [MessageFlags.Ephemeral] });
        }
    }
};
