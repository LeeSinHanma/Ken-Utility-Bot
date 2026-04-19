const { MessageFlags } = require("discord.js");
const db = require("../database");
const { syncGuildCommands } = require("../logic/command-sync");

module.exports = {
    data: {
        name: "delete-alert",
        description: "Permanently delete a custom slash command from this server",
        options: [
            {
                name: "name",
                description: "The name of the command to delete",
                type: 3, // String
                required: true,
                autocomplete: true
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

        // Remove from DB and sync this guild immediately
        try {
            db.customCommands.remove(guildId, name);
            await syncGuildCommands(interaction.client, interaction.guild || guildId);
            await interaction.reply({
                content: `🗑️ **Success!** Command \`/${name}\` has been deleted and synced for this server.`,
                flags: []
            });
        } catch (err) {
            console.error(`[SYNC] Failed to delete and sync custom command \"${name}\" for guild ${guildId}:`, err);
            await interaction.reply({ content: "Failed to delete the command due to a system error.", flags: [MessageFlags.Ephemeral] });
        }
    }
};
