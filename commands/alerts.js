const { EmbedBuilder, MessageFlags } = require("discord.js");
const { getActiveAlarms } = require("../logic/template-alert");

module.exports = {
    data: {
        name: "alerts",
        description: "Show all currently active alerts",
        options: []
    },
    async execute(interaction) {
        const alarmsMap = getActiveAlarms();
        const alarms = Array.from(alarmsMap.entries()).filter(([_, data]) => data.guildId === interaction.guildId);
        if (alarms.length === 0) {
            return await interaction.reply({
                content: "There are no active alerts at the moment.",
                flags: [MessageFlags.Ephemeral]
            });
        }
        const embed = new EmbedBuilder()
            .setTitle("📢 Active Alerts")
            .setColor("#FFD700")
            .setTimestamp();
        for (const [alarmId, data] of alarms) {
            const start = new Date(data.startTime).toLocaleString();
            const fields = [];
            if (data.role) fields.push({ name: "Role", value: data.role.toString(), inline: true });
            if (data.location) fields.push({ name: "Location", value: data.location, inline: true });
            fields.push({ name: "Duration", value: `${data.duration}m`, inline: true });
            if (data.interval) fields.push({ name: "Interval", value: `${data.interval}m`, inline: true });
            if (data.remindBefore) fields.push({ name: "Early Warning", value: `${data.remindBefore}m before`, inline: true });
            fields.push({ name: "Started", value: start, inline: false });
            embed.addFields({ name: `Alarm ID: ${alarmId}`, value: fields.map(f => `**${f.name}:** ${f.value}`).join("\n"), inline: false });
        }
        await interaction.reply({ embeds: [embed] });
    }
};
