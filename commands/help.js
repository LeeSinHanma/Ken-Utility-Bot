const { EmbedBuilder } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

const customDataPath = path.join(__dirname, "..", "data", "custom_commands.json");

module.exports = {
    data: {
        name: "help",
        description: "Get a comprehensive guide on how to use the Vortex Alarm Bot"
    },

    async execute(interaction) {
        const guildId = interaction.guildId;

        // Load custom commands for the current guild
        let customData = {};
        try {
            if (fs.existsSync(customDataPath)) {
                customData = JSON.parse(fs.readFileSync(customDataPath, "utf-8"));
            }
        } catch (err) {
            console.error("Failed to load custom commands for help:", err);
        }

        const guildCommands = customData[guildId] || [];
        const customList = guildCommands.length > 0 
            ? guildCommands.map(cmd => `\`/${cmd.name}\` - ${cmd.description}`).join("\n") 
            : "No custom alerts created for this server yet.";

        const helpEmbed = new EmbedBuilder()
            .setColor(0x00AE86)
            .setTitle("⏱️ Advance Timer Bot - Universal Guide")
            .setDescription("Welcome! This bot helps you coordinate recurring alerts and vortex pings with precision.")
            .addFields(
                { 
                    name: "📖 Quick Start: How Timers Work", 
                    value: "• **Duration (m):** How long the alarm runs in minutes.\n• **Interval (m):** How often it mentions the role during the duration.\n• **Early Warning:** Set a special mention X minutes before the end (e.g. 5m before up)." 
                },
                { 
                    name: "⚡ Core Commands", 
                    value: "• \`/ping\` - Check if the bot is online.\n• \`/mention-role\` - Set a basic timed mention for any role." 
                },
                { 
                    name: "🛠️ Management (Admins)", 
                    value: "• \`/create-alert\` - Build a permanent server preset.\n• \`/edit-alert\` - Modify an existing preset.\n• \`/delete-alert\` - Remove a preset permanently." 
                },
                { 
                    name: "🎯 This Server's Custom Alerts", 
                    value: customList 
                },
                { 
                    name: "📝 Pro-Tips", 
                    value: "• **Clean Chat:** The 'Stop' button and image only appear on the **latest** message.\n• **Precision:** Display arrival times in both `UTC` and `PH` clocks automatically." 
                }
            )
            .setFooter({ text: "Type / followed by a command to get started!" })
            .setTimestamp();

        await interaction.reply({ embeds: [helpEmbed] });
    }
};
