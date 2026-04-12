const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");

// Map to track active timeout references by unique alarm ID
// This must be shared across all virtual commands, so we can use a global Map or attach it to the client
const activeAlarms = new Map();

module.exports = {
    // This file acts as a TEMPLATE, not a standalone command
    // It will be "bound" to specific configurations in index.js
    
    async execute(interaction, config = {}) {
        const role = interaction.options.getRole("target-role") || (config.roleId ? await interaction.guild.roles.fetch(config.roleId) : null);
        const location = interaction.options.getString("location") || config.location || "Unknown Location";
        const duration = interaction.options.getInteger("duration") || config.duration || 30;
        const interval = interaction.options.getInteger("interval") || config.interval || 5;
        const remindBefore = interaction.options.getInteger("remind-before") || config.remindBefore || 0;
        const attachment = interaction.options.getAttachment("vortex-image");
        const imageUrl = attachment ? attachment.url : (config.imageUrl || null);
        const alertName = config.name || "Custom Alert";
        const themeColor = config.color || 0x7289DA;

        // Unique ID for this specific alarm
        const alarmId = `custom_${Date.now()}`;

        if (!role) {
            return await interaction.reply({
                content: "Could not find the target role for this alert.",
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Add a "Stop Alarm" button to the initial message
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`stop_alert_${alarmId}`)
                    .setLabel("Stop Alarm")
                    .setStyle(ButtonStyle.Danger)
            );

        // Calculate the exact target arrival time (start + total duration)
        const targetTime = new Date(Date.now() + (duration * 60 * 1000));
        const formatClock = (date, timeZone) => {
            return date.toLocaleTimeString('en-GB', { 
                timeZone, 
                hour: '2-digit', 
                minute: '2-digit', 
                hour12: false 
            });
        };

        const utcTime = formatClock(targetTime, 'UTC');
        const phTime = formatClock(targetTime, 'Asia/Manila');
        const arrivalString = `\`${utcTime} UTC\` | \`${phTime} PH\``;

        const embed = new EmbedBuilder()
            .setColor(themeColor)
            .setTitle(`🌪️ ${alertName} Started!`)
            .setDescription(`A custom alarm has been launched.`)
            .addFields(
                { name: "📍 Location", value: location, inline: true },
                { name: "🎯 Role", value: role.toString(), inline: true },
                { name: "⏰ Arrival Time", value: arrivalString, inline: true },
                { name: "⏲️ Schedule", value: `Every ${interval}m for ${duration}m${remindBefore ? ` (Early Warning: ${remindBefore}m before)` : ""}`, inline: false }
            )
            .setFooter({ text: `Alarm ID: ${alarmId}` })
            .setTimestamp();

        if (imageUrl) embed.setImage(imageUrl);

        const response = await interaction.reply({
            embeds: [embed],
            components: [row],
            withResponse: true
        });

        const initialReply = response.resource;
        const startTime = Date.now();

        activeAlarms.set(alarmId, { 
            timeoutRef: null, 
            lastMessage: initialReply, 
            imageUrl,
            arrivalString,
            remindBefore,
            role,
            location,
            duration,
            alertName,
            color: themeColor
        });

        const rawPoints = [];
        for (let m = interval; m < duration; m += interval) {
            rawPoints.push(m);
        }
        if (remindBefore && remindBefore > 0 && remindBefore < duration) {
            rawPoints.push(duration - remindBefore);
        }
        rawPoints.push(duration);

        const mentionPoints = [...new Set(rawPoints.filter(p => p > 0))].sort((a, b) => a - b);

        const scheduleSpecificPoint = (pointIndex) => {
            if (pointIndex >= mentionPoints.length) return;

            const targetMinute = mentionPoints[pointIndex];
            const nextTriggerTime = startTime + (targetMinute * 60 * 1000);
            const delay = nextTriggerTime - Date.now();

            const timeoutRef = setTimeout(async () => {
                try {
                    const alarmData = activeAlarms.get(alarmId);
                    if (!alarmData) return;

                    // Cleanup previous button/image
                    if (alarmData.lastMessage) {
                        try {
                            const oldEmbed = EmbedBuilder.from(alarmData.lastMessage.embeds[0]);
                            oldEmbed.setImage(null);
                            await alarmData.lastMessage.edit({ embeds: [oldEmbed], components: [] });
                        } catch (err) {
                            console.error("Cleanup failed:", err.message);
                        }
                    }

                    const isFinal = (targetMinute === duration);
                    const isWarning = (alarmData.remindBefore && targetMinute === (duration - alarmData.remindBefore));
                    const elapsed = Math.round((Date.now() - startTime) / 60000);
                    
                    let title = `⏰ ${alertName} Update`;
                    let desc = `The **${alertName}** at **${location}** is still active.`;
                    
                    if (isFinal) {
                        title = `🎊 ${alertName} Ready!`;
                        desc = `The target time for **${alertName}** at **${location}** has been reached!`;
                    } else if (isWarning) {
                        title = `⚠️ ${alertName} Warning!`;
                        desc = `Update: Only **${alarmData.remindBefore} minutes remaining** for **${alertName}**!`;
                    }

                    const updateEmbed = new EmbedBuilder()
                        .setColor(themeColor)
                        .setTitle(title)
                        .setDescription(desc)
                        .addFields(
                            { name: "📍 Location", value: location, inline: true },
                            { name: "⏰ Arrival Time", value: arrivalString, inline: true },
                            { name: "⏳ Elapsed", value: `${elapsed} / ${duration}m`, inline: false },
                            { name: "📢 Attention", value: role.toString(), inline: false }
                        )
                        .setTimestamp();

                    if (alarmData.imageUrl) updateEmbed.setImage(alarmData.imageUrl);

                    const newMessage = await interaction.channel.send({
                        content: isFinal ? `🏁 ${role} GO GO GO!` : (isWarning ? `🚨 ${role} PREPARE!` : `🔔 Reminder for ${role}`),
                        embeds: [updateEmbed],
                        components: [row]
                    });
                    
                    if (activeAlarms.has(alarmId)) {
                        activeAlarms.set(alarmId, { ...activeAlarms.get(alarmId), lastMessage: newMessage });
                        scheduleSpecificPoint(pointIndex + 1);
                    }
                } catch (error) {
                    console.error("Cycle failed:", error);
                    if (activeAlarms.has(alarmId)) scheduleSpecificPoint(pointIndex + 1);
                }
            }, delay > 0 ? delay : 0);

            if (activeAlarms.has(alarmId)) {
                activeAlarms.set(alarmId, { ...activeAlarms.get(alarmId), timeoutRef });
            }
        };

        scheduleSpecificPoint(0);
    },

    async handleButton(interaction) {
        // Shared button handler for all custom alerts
        const alarmId = interaction.customId.replace("stop_alert_", "");
        const alarmData = activeAlarms.get(alarmId);

        if (alarmData) {
            if (alarmData.timeoutRef) clearTimeout(alarmData.timeoutRef);
            
            if (alarmData.lastMessage) {
                try {
                    const oldEmbed = EmbedBuilder.from(alarmData.lastMessage.embeds[0]);
                    oldEmbed.setImage(null);

                    if (interaction.message.id === alarmData.lastMessage.id) {
                        await interaction.update({ embeds: [oldEmbed], components: [] });
                    } else {
                        await alarmData.lastMessage.edit({ embeds: [oldEmbed], components: [] });
                    }
                    
                    const msg = `🛑 **${alarmData.alertName} stopped** by ${interaction.user}!`;
                    if (!interaction.replied) await interaction.reply(msg);
                    else await interaction.followUp(msg);
                } catch (err) {
                    console.error("Cleanup failed:", err.message);
                    if (!interaction.replied) await interaction.reply(`🛑 Alarm stopped.`);
                }
            }
            activeAlarms.delete(alarmId);
        } else {
            await interaction.reply({ content: "Alarm already finished or stopped.", flags: [MessageFlags.Ephemeral] });
        }
    }
};
