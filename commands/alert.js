const { EmbedBuilder, MessageFlags } = require("discord.js");

module.exports = {
    data: {
        name: "alert",
        description: "Manage and learn about the alert system",
        options: [
            {
                name: "help",
                description: "Detailed manual for the alert and preset system",
                type: 1 // Subcommand
            }
        ]
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === "help") {
            const embed = new EmbedBuilder()
                .setTitle("📖 Alert System Help Guide")
                .setDescription("The Alert System allows you to build high-precision, recurring timers that mention specific roles.")
                .addFields(
                    { 
                        name: "🛠️ Managing Presets", 
                        value: "• `/create-alert` - Build a permanent server preset (e.g., for Bosses or Events).\n• `/edit-alert` - Modify the duration, interval, or role of an existing preset.\n• `/delete-alert` - Permanently remove a preset from the server." 
                    },
                    {
                        name: "🚀 Virtual Commands",
                        value: "Once a preset is created (e.g., named `boss`), it becomes its own command: `#/boss`. These commands support overrides for location, duration, and images."
                    },
                    {
                        name: "⏲️ One-off Alarms",
                        value: "• `/mention-role` - Set a quick, one-time or simple recurring timer without creating a permanent preset."
                    },
                    {
                        name: "📝 Pro-Tips",
                        value: "• **Early Warnings:** Set a `remind-before` value to get a ping X minutes before the arrival.\n• **Syncing:** New, edited, or deleted presets are re-synced to this server immediately."
                    }
                )
                .setColor("#7289DA")
                .setTimestamp()
                .setFooter({ text: "Ken Utility Bot • Precision Timing Tools" });

            await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }
    }
};
