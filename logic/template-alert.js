const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionsBitField } = require('discord.js');

// Global map to track active alarms across commands
const activeAlarms = new Map();

function clearAlarm(alarmId) {
    const alarmData = activeAlarms.get(alarmId);
    if (alarmData?.timeoutRef) {
        clearTimeout(alarmData.timeoutRef);
    }
    activeAlarms.delete(alarmId);
}

function buildCleanedEmbed(message) {
    const baseEmbed = message?.embeds?.[0];
    if (!baseEmbed) return null;
    const oldEmbed = EmbedBuilder.from(baseEmbed);
    oldEmbed.setImage(null);
    return oldEmbed;
}

function getActiveAlarms() {
    return activeAlarms;
}

module.exports = {
    internalOnly: true,
    /**
     * Executes the custom alert command.
     * @param {CommandInteraction} interaction - The interaction that triggered the command.
     * @param {Object} config - Optional configuration object for preset alerts.
     */
    async execute(interaction, config = {}) {
        const role = interaction.options.getRole('target-role') || (config.roleId ? await interaction.guild.roles.fetch(config.roleId) : null);
        const location = interaction.options.getString('location') || config.location || 'Unknown Location';
        const duration = interaction.options.getInteger('duration') || config.duration || 30;
        const interval = interaction.options.getInteger('interval') || config.interval || 5;
        const remindBefore = interaction.options.getInteger('remind-before') || config.remindBefore || 0;
        const attachment = interaction.options.getAttachment('vortex-image');
        const imageUrl = attachment ? attachment.url : (config.imageUrl || null);
        const alertName = config.name || 'Custom Alert';
        const themeColor = config.color || 0x7289DA;

        const alarmId = `custom_${Date.now()}`;

        if (!role) {
            return await interaction.reply({
                content: 'Could not find the target role for this alert.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Stop button
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`stop_alert_${alarmId}`)
                .setLabel('Stop Alarm')
                .setStyle(ButtonStyle.Danger)
        );

        const targetTime = new Date(Date.now() + duration * 60 * 1000);
        const formatClock = (date, timeZone) =>
            date.toLocaleTimeString('en-GB', {
                timeZone,
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        const utcTime = formatClock(targetTime, 'UTC');
        const phTime = formatClock(targetTime, 'Asia/Manila');
        const arrivalString = `\`${utcTime} UTC\` | \`${phTime} PH\``;

        const embed = new EmbedBuilder()
            .setColor(themeColor)
            .setTitle(`🌪️ ${alertName} Started!`)
            .setDescription('A custom alarm has been launched.')
            .addFields(
                { name: '📍 Location', value: location, inline: true },
                { name: '🎯 Role', value: role.toString(), inline: true },
                { name: '⏰ Arrival Time', value: arrivalString, inline: true },
                {
                    name: '⏲️ Schedule',
                    value: `Every ${interval}m for ${duration}m${remindBefore ? ` (Early Warning: ${remindBefore}m before)` : ''}`,
                    inline: false
                }
            )
            .setFooter({ text: `Alarm ID: ${alarmId}` })
            .setTimestamp();
        if (imageUrl) embed.setImage(imageUrl);

        // Send the initial reply and fetch the sent message
        await interaction.reply({ embeds: [embed], components: [row] });
        const initialMessage = await interaction.fetchReply();
        const startTime = Date.now();

        // Store alarm data with proper message reference
        activeAlarms.set(alarmId, {
            timeoutRef: null,
            lastMessage: initialMessage,
            imageUrl,
            arrivalString,
            remindBefore,
            role,
            location,
            duration,
            alertName,
            color: themeColor,
            requesterId: interaction.user.id,
            startTime,
            guildId: interaction.guildId,
            interval
        });

        // Build schedule points
        const rawPoints = [];
        for (let m = interval; m < duration; m += interval) rawPoints.push(m);
        if (remindBefore && remindBefore > 0 && remindBefore < duration) rawPoints.push(duration - remindBefore);
        rawPoints.push(duration);
        const mentionPoints = [...new Set(rawPoints.filter(p => p > 0))].sort((a, b) => a - b);

        const scheduleSpecificPoint = (pointIndex) => {
            if (pointIndex >= mentionPoints.length) return;
            const targetMinute = mentionPoints[pointIndex];
            const nextTrigger = startTime + targetMinute * 60 * 1000;
            const delay = nextTrigger - Date.now();

            const timeoutRef = setTimeout(async () => {
                try {
                    const alarmData = activeAlarms.get(alarmId);
                    if (!alarmData) return;

                    // Clean up previous message
                    if (alarmData.lastMessage) {
                        try {
                            const cleaned = buildCleanedEmbed(alarmData.lastMessage);
                            await alarmData.lastMessage.edit({ embeds: cleaned ? [cleaned] : [], components: [] });
                        } catch (e) {
                            console.error('Cleanup failed:', e.message);
                        }
                    }

                    const isFinal = targetMinute === duration;
                    const isWarning = alarmData.remindBefore && targetMinute === duration - alarmData.remindBefore;
                    const elapsed = Math.round((Date.now() - startTime) / 60000);

                    let title = `⏰ ${alertName} Update`;
                    let desc = `The **${alertName}** at **${location}** is still active.`;
                    if (isFinal) {
                        title = `🎊 ${alertName} Ready!`;
                        desc = `The target time for **${alertName}** at **${location}** has been reached!`;
                    } else if (isWarning) {
                        title = `⚠️ ${alertName} Warning!`;
                        desc = `Only **${alarmData.remindBefore} minutes remaining** for **${alertName}**!`;
                    }

                    const updateEmbed = new EmbedBuilder()
                        .setColor(themeColor)
                        .setTitle(title)
                        .setDescription(desc)
                        .addFields(
                            { name: '📍 Location', value: location, inline: true },
                            { name: '⏰ Arrival Time', value: arrivalString, inline: true },
                            { name: '⏳ Elapsed', value: `${elapsed} / ${duration}m`, inline: false },
                            { name: '📢 Attention', value: role.toString(), inline: false }
                        )
                        .setTimestamp();
                    if (alarmData.imageUrl) updateEmbed.setImage(alarmData.imageUrl);

                    const newMessage = await interaction.channel.send({
                        content: isFinal ? `🏁 ${role} GO GO GO!` : isWarning ? `🚨 ${role} PREPARE!` : `🔔 Reminder for ${role}`,
                        embeds: [updateEmbed],
                        components: [row]
                    });

                    if (activeAlarms.has(alarmId)) {
                        activeAlarms.set(alarmId, { ...alarmData, lastMessage: newMessage });
                        const nextIdx = pointIndex + 1;
                        if (nextIdx >= mentionPoints.length) {
                            clearAlarm(alarmId);
                        } else {
                            scheduleSpecificPoint(nextIdx);
                        }
                    }
                } catch (err) {
                    console.error('Cycle failed:', err);
                    const nextIdx = pointIndex + 1;
                    if (!activeAlarms.has(alarmId) || nextIdx >= mentionPoints.length) {
                        clearAlarm(alarmId);
                    } else {
                        scheduleSpecificPoint(nextIdx);
                    }
                }
            }, Math.max(delay, 0));

            if (activeAlarms.has(alarmId)) {
                const data = activeAlarms.get(alarmId);
                activeAlarms.set(alarmId, { ...data, timeoutRef });
            }
        };

        scheduleSpecificPoint(0);
    },

    /**
     * Handles button interactions for stopping alerts.
     * @param {ButtonInteraction} interaction
     */
    async handleButton(interaction) {
        const alarmId = interaction.customId.startsWith('stop_vortex_')
            ? interaction.customId.replace('stop_vortex_', '')
            : interaction.customId.replace('stop_alert_', '');

        const alarmData = activeAlarms.get(alarmId);
        if (!alarmData) {
            return await interaction.reply({ content: 'Alarm already finished or stopped.', flags: [MessageFlags.Ephemeral] });
        }

        const isRequester = alarmData.requesterId === interaction.user.id;
        const isAdmin =
            interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ||
            interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);

        if (!isRequester && !isAdmin) {
            return await interaction.reply({
                content: '❌ You do not have permission to stop this alarm. Only the user who started it or an administrator can stop it.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        if (alarmData.timeoutRef) clearTimeout(alarmData.timeoutRef);
        if (alarmData.lastMessage) {
            try {
                const cleaned = buildCleanedEmbed(alarmData.lastMessage);
                if (interaction.message.id === alarmData.lastMessage.id) {
                    await interaction.update({ embeds: cleaned ? [cleaned] : [], components: [] });
                } else {
                    await alarmData.lastMessage.edit({ embeds: cleaned ? [cleaned] : [], components: [] });
                }
                const msg = `🛑 **${alarmData.alertName} stopped** by ${interaction.user}!`;
                if (!interaction.replied) await interaction.reply(msg);
                else await interaction.followUp(msg);
            } catch (e) {
                console.error('Cleanup failed:', e.message);
                if (!interaction.replied) await interaction.reply('🛑 Alarm stopped.');
            }
        }
        clearAlarm(alarmId);
    },

    getActiveAlarms,
};
