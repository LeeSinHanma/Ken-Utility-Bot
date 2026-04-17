const { EmbedBuilder, MessageFlags } = require("discord.js");
const db = require("../database");

module.exports = {
    data: {
        name: "help",
        description: "Get a comprehensive guide on how to use Ken Utility Bot"
    },

    async execute(interaction) {
        const guildId = interaction.guildId;

        // Load custom commands for the current guild
        let guildCommands = [];
        try {
            guildCommands = db.customCommands.getForGuild(guildId);
        } catch (err) {
            console.error("Failed to load custom commands for help:", err);
        }

        const customList = guildCommands.length > 0 
            ? guildCommands.map(cmd => `\`/${cmd.name}\` - ${cmd.description}`).join("\n") 
            : "No custom alerts created for this server yet.";

        const helpEmbed = new EmbedBuilder()
            .setColor("#2b2d31")
            .setTitle("🛠️ Ken Utility Bot | User Manual")
            .setDescription("Welcome to the premium command hub. Use the sections below to navigate our precision tools and economy features.")
            .addFields(
                { 
                    name: "💰 Economy & Banking", 
                    value: "• `/split help` - Detailed manual for the split system.\n• `/bank help` - Comprehensive guide to the bank and coins." 
                },
                { 
                    name: "⏱️ Timers & Alerts", 
                    value: "• `/alert help` - Master guide for server presets and alerts.\n• `/mention-role` - Timed role mentions with optional message.\n• `/mention-users` - Timed user mentions with optional message.\n• `/ping` - Heartbeat check for bot responsiveness." 
                },
                { 
                    name: "🛠️ Admin Tools", 
                    value: "• `/create-alert` - Build a permanent server preset.\n• `/sync-commands` - Force rebuild/sync slash commands for this server.\n• `/bank setup` - Configure bank management roles.\n• `/bank add/remove` - Manage user coin balances." 
                },
                { 
                    name: "🎯 Server Custom Presets", 
                    value: customList 
                },
                { 
                    name: "📝 Pro-Tips", 
                    value: "• **Locate Me:** Use the 'Locate' buttons in `/split check` to find buried thread pings.\n• **Early Warnings:** Configure `remind-before` in alerts for advance notifications.\n• **Dynamic Clocks:** Arrival times are shown in both `UTC` and `PH` time zones." 
                }
            )
            .setFooter({ text: "Ken Utility Bot • Type / followed by a command to explore!" })
            .setTimestamp();

        await interaction.reply({ embeds: [helpEmbed] });
    }
};
