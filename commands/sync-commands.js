const { MessageFlags, PermissionsBitField } = require("discord.js");
const { botOwners } = require("../config.json");
const { syncGuildCommands } = require("../logic/command-sync");

module.exports = {
    data: {
        name: "sync-commands",
        description: "Force rebuild and sync slash commands for this server"
    },

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return await interaction.reply({
                content: "This command can only be used inside a server.",
                flags: [MessageFlags.Ephemeral]
            });
        }

        const isOwner = botOwners.includes(interaction.user.id);
        const hasManageGuild = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);

        if (!isOwner && !hasManageGuild) {
            return await interaction.reply({
                content: "You need the Manage Server permission to use this command.",
                flags: [MessageFlags.Ephemeral]
            });
        }

        try {
            const count = await syncGuildCommands(interaction.client, interaction.guildId);
            await interaction.reply({
                content: `✅ Synced ${count} slash commands for this server.`,
                flags: [MessageFlags.Ephemeral]
            });
        } catch (error) {
            console.error(`[SYNC] Manual sync failed for guild ${interaction.guildId}:`, error);
            await interaction.reply({
                content: "Failed to sync commands. Check bot logs for details.",
                flags: [MessageFlags.Ephemeral]
            });
        }
    }
};
