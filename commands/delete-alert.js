const fs = require("node:fs");
const path = require("node:path");
const { MessageFlags } = require("discord.js");

const customDataPath = path.join(__dirname, "..", "data", "custom_commands.json");

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

        // Remove the command
        customData[guildId].splice(commandIndex, 1);

        // Save back to file
        try {
            fs.writeFileSync(customDataPath, JSON.stringify(customData, null, 4));
            await interaction.reply({
                content: `🗑️ **Success!** Command \`/${name}\` has been deleted from this server.\n\n**Note:** It will disappear from the "/" list after the bot **restarts** or re-syncs.`,
                flags: []
            });
        } catch (err) {
            console.error("Failed to delete command:", err);
            await interaction.reply({ content: "Failed to delete the command due to a system error.", flags: [MessageFlags.Ephemeral] });
        }
    }
};
