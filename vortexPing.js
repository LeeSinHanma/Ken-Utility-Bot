const {ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder} = require("discord.js");

// Map to track active timeout references by unique alarm ID
const activeAlarms = new Map();

// Color configuration for vortex types
const vortexColors = {
    "Gold": 0xFFD700,
    "Blue": 0x0099FF,
    "Green": 0x00FF00
};

module.exports = {
    data: {
        name: "vortex-ping",
        description: "Specialized vortex alarm with location and type",
        options: [
            {
                name: "target-role",
                description: "The role you want to mention",
                type: 8, // Role type
                required: true
            },
            {
                name: "location",
                description: "Where the vortex is located",
                type: 3, // String type
                required: true
            },
            {
                name: "vortex-type",
                description: "The type of vortex",
                type: 3, // String type
                required: true,
                choices: [
                    { name: "Gold", value: "Gold" },
                    { name: "Blue", value: "Blue" },
                    { name: "Green", value: "Green" }
                ]
            },
            {
                name: "duration",
                description: "Total time in minutes (max 360/6h)",
                type: 4, // Integer type
                required: true
            },
            {
                name: "interval",
                description: "Remind every X minutes during the duration",
                type: 4, // Integer type
                required: true
            },
            {
                name: "vortex-image",
                description: "Upload a screenshot of the vortex",
                type: 11, // Attachment type
                required: false
            }
        ]
    },

    async execute(interaction) {
        const role = interaction.options.getRole("target-role");
        const location = interaction.options.getString("location");
        const vortexType = interaction.options.getString("vortex-type");
        const duration = interaction.options.getInteger("duration");
        const interval = interaction.options.getInteger("interval");
        const attachment = interaction.options.getAttachment("vortex-image");
        const imageUrl = attachment ? attachment.url : null;

        // Unique ID for this specific alarm
        const alarmId = `vortex_${Date.now()}`;
        const color = vortexColors[vortexType] || 0x7289DA;

        if (duration < 1 || duration > 360) {
            return await interaction.reply({
                content: "Please specify a duration between 1 and 360 minutes.",
                ephemeral: true
            });
        }

        if (interval < 1 || interval >= duration) {
            return await interaction.reply({
                content: "Interval must be at least 1 minute and less than the total duration.",
                ephemeral: true
            });
        }

        // Add a "Stop Alarm" button to the initial message
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`stop_${alarmId}`)
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
            .setColor(color)
            .setTitle(`🌪️ New Vortex Detected!`)
            .setDescription(`An alarm has been set for the **${vortexType} Vortex**.`)
            .addFields(
                { name: "📍 Location", value: location, inline: true },
                { name: "🎯 Role", value: role.toString(), inline: true },
                { name: "⏰ Arrival Time", value: arrivalString, inline: true },
                { name: "⏲️ Schedule", value: `Every ${interval}m for ${duration}m`, inline: false }
            )
            .setFooter({ text: `Alarm ID: ${alarmId}` })
            .setTimestamp();

        // Include the image if it was provided
        if (imageUrl) embed.setImage(imageUrl);

        const initialReply = await interaction.reply({
            embeds: [embed],
            components: [row],
            fetchReply: true
        });

        const startTime = Date.now();
        // Initialize the alarm tracking with the initial message and clocks
        activeAlarms.set(alarmId, { 
            timeoutRef: null, 
            lastMessage: initialReply, 
            imageUrl,
            arrivalString 
        });

        const mentionPoints = [];
        for (let m = interval; m < duration; m += interval) {
            mentionPoints.push(m);
        }
        if (mentionPoints.length === 0 || mentionPoints[mentionPoints.length - 1] !== duration) {
            mentionPoints.push(duration);
        }

        const scheduleSpecificPoint = (pointIndex) => {
            if (pointIndex >= mentionPoints.length) {
                return;
            }

            const targetMinute = mentionPoints[pointIndex];
            const nextTriggerTime = startTime + (targetMinute * 60 * 1000);
            const delay = nextTriggerTime - Date.now();

            const timeoutRef = setTimeout(async () => {
                try {
                    const alarmData = activeAlarms.get(alarmId);
                    
                    // Remove the button AND image from the previous message
                    if (alarmData && alarmData.lastMessage) {
                        try {
                            const oldEmbed = EmbedBuilder.from(alarmData.lastMessage.embeds[0]);
                            oldEmbed.setImage(null);
                            await alarmData.lastMessage.edit({ embeds: [oldEmbed], components: [] });
                        } catch (err) {
                            console.error("Failed to clean up old message designs:", err.message);
                        }
                    }

                    const isFinal = (pointIndex === mentionPoints.length - 1);
                    const elapsed = Math.round((Date.now() - startTime) / 60000);
                    
                    const updateEmbed = new EmbedBuilder()
                        .setColor(color)
                        .setTitle(isFinal ? `🎊 Vortex is UP!` : `⏰ Vortex Reminder`)
                        .setDescription(isFinal ? `**${vortexType} Vortex** is active at **${location}**!` : `The **${vortexType} Vortex** is still being tracked.`)
                        .addFields(
                            { name: "📍 Location", value: location, inline: true },
                            { name: "⏰ Arrival Time", value: alarmData?.arrivalString || arrivalString, inline: true },
                            { name: "⏳ Elapsed", value: `${elapsed} / ${duration}m`, inline: false },
                            { name: "📢 Attention", value: role.toString(), inline: false }
                        )
                        .setFooter({ text: isFinal ? "Goal metadata reached." : "Keeping you updated..." })
                        .setTimestamp();

                    if (alarmData?.imageUrl) updateEmbed.setImage(alarmData.imageUrl);

                    const newMessage = await interaction.channel.send({
                        content: isFinal ? `🏁 ${role} GO GO GO!` : `🔔 Reminder for ${role}`,
                        embeds: [updateEmbed],
                        components: [row] // Keep the button on the latest message
                    });
                    
                    // Update tracking with the latest message
                    if (activeAlarms.has(alarmId)) {
                        activeAlarms.set(alarmId, { ...activeAlarms.get(alarmId), lastMessage: newMessage });
                        scheduleSpecificPoint(pointIndex + 1);
                    }
                } catch (error) {
                    console.error("Failed to cycle vortex alarm:", error);
                    if (activeAlarms.has(alarmId)) {
                        scheduleSpecificPoint(pointIndex + 1);
                    }
                }
            }, delay > 0 ? delay : 0);

            if (activeAlarms.has(alarmId)) {
                activeAlarms.set(alarmId, { ...activeAlarms.get(alarmId), timeoutRef });
            }
        };

        scheduleSpecificPoint(0);
    },

    async handleButton(interaction) {
        if (interaction.customId.startsWith("stop_vortex_")) {
            const alarmId = interaction.customId.replace("stop_", "");
            const alarmData = activeAlarms.get(alarmId);

            if (alarmData) {
                if (alarmData.timeoutRef) clearTimeout(alarmData.timeoutRef);
                
                // Final cleanup: remove the button and image from the current message
                if (alarmData.lastMessage) {
                    try {
                        const oldEmbed = EmbedBuilder.from(alarmData.lastMessage.embeds[0]);
                        oldEmbed.setImage(null);

                        if (interaction.message.id === alarmData.lastMessage.id) {
                            await interaction.update({ embeds: [oldEmbed], components: [] });
                        } else {
                            await alarmData.lastMessage.edit({ embeds: [oldEmbed], components: [] });
                        }
                        
                        if (!interaction.replied) {
                            await interaction.reply(`🛑 **Vortex alarm stopped** by ${interaction.user}!`);
                        } else {
                            await interaction.followUp(`🛑 **Vortex alarm stopped** by ${interaction.user}!`);
                        }
                    } catch (err) {
                        console.error("Failed to clean up final design stop:", err.message);
                        if (!interaction.replied) await interaction.reply(`🛑 **Vortex alarm stopped** by ${interaction.user}!`);
                    }
                } else {
                    await interaction.reply(`🛑 **Vortex alarm stopped** by ${interaction.user}!`);
                }

                activeAlarms.delete(alarmId);
            } else {
                await interaction.reply({
                    content: "This alarm has already finished or was already stopped.",
                    ephemeral: true
                });
            }
        }
    }
};
