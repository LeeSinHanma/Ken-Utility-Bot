const {token, clientId, guildId} = require("./config.json");
const {Client, GatewayIntentBits, REST, Routes, Events, MessageFlags} = require("discord.js");
const vortexPing = require("./vortexPing.js");

// Added GuildMembers intent to allow for fetching role data easily
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers
    ]
});

client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Define commands to register
    const commands = [
        {
            name: "ping",
            description: "Replies with Pong!"
        },
        {
            name: "mention-role",
            description: "Mention a specific role with a timed alarm",
            options: [
                {
                    name: "target-role",
                    description: "The role you want to mention",
                    type: 8, // Role type
                    required: true
                },
                {
                    name: "duration",
                    description: "Total time in minutes for the alarm (max 360/6h)",
                    type: 4, // Integer type
                    required: false
                },
                {
                    name: "interval",
                    description: "Remind every X minutes during the duration",
                    type: 4, // Integer type
                    required: false
                }
            ]
        },
        vortexPing.data // New command from separate file
    ];

    const rest = new REST({version: "10"}).setToken(token);

    try {
        console.log(`Started refreshing application (/) commands for server [${guildId}]`);
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), {body: commands});
        console.log("Successfully reloaded application (/) commands.");
    } catch (error) {
        console.error(error);
    }
});

client.on("interactionCreate", async interaction => {
    if (interaction.isChatInputCommand()) {
        const {commandName} = interaction;

        if (commandName === "ping") {
            await interaction.reply("Pong!");
        } else if (commandName === "vortex-ping") {
            await vortexPing.execute(interaction);
        } else if (commandName === "mention-role") {
            const role = interaction.options.getRole("target-role");
        const duration = interaction.options.getInteger("duration");
        const interval = interaction.options.getInteger("interval");

        if (duration) {
            if (duration < 1 || duration > 360) {
                return await interaction.reply({
                    content: "Please specify a duration between 1 and 360 minutes (6 hours).",
                    flags: [MessageFlags.Ephemeral]
                });
            }

            // Simple one-off alarm
            if (!interval) {
                await interaction.reply(`Alarm set! I will mention ${role} in ${duration} minute(s).`);
                setTimeout(async () => {
                    try {
                        await interaction.channel.send(`⏰ **Alarm!** ${role} member(s), you were mentioned by ${interaction.user}!`);
                    } catch (error) {
                        console.error("Failed to send alarm message:", error);
                    }
                }, duration * 60 * 1000);
                return;
            }

            // Recurring alarm with interval
            if (interval < 1 || interval >= duration) {
                return await interaction.reply({
                    content: "Interval must be at least 1 minute and less than the total duration.",
                    flags: [MessageFlags.Ephemeral]
                });
            }

            await interaction.reply({
                content: `Recurring alarm set! I will mention ${role} every ${interval} minutes for a total of ${duration} minutes.`
            });

            const startTime = Date.now();
            
            // Pre-calculate all target points (in minutes)
            const mentionPoints = [];
            for (let m = interval; m < duration; m += interval) {
                mentionPoints.push(m);
            }
            // Always add the final duration point if it wasn't added
            if (mentionPoints.length === 0 || mentionPoints[mentionPoints.length - 1] !== duration) {
                mentionPoints.push(duration);
            }

            console.log(`Scheduling alarms at minutes: ${mentionPoints.join(", ")}`);

            const scheduleSpecificPoint = (pointIndex) => {
                if (pointIndex >= mentionPoints.length) {
                    console.log("All alarm points completed.");
                    return;
                }

                const targetMinute = mentionPoints[pointIndex];
                const targetTime = startTime + (targetMinute * 60 * 1000);
                const delay = targetTime - Date.now();

                // If for some reason delay is less than or equal to 0, trigger it immediately
                setTimeout(async () => {
                    try {
                        const actualElapsed = Math.round((Date.now() - startTime) / 60000);
                        await interaction.channel.send(`⏰ **Alarm!** ${role} members, ${actualElapsed}m have passed! (Total: ${duration}m). Mentions from ${interaction.user}!`);
                        
                        // Proceed to the next point
                        scheduleSpecificPoint(pointIndex + 1);
                    } catch (error) {
                        console.error("Failed to send recurring alarm message:", error);
                        // Still try to schedule next even if current fails
                        scheduleSpecificPoint(pointIndex + 1);
                    }
                }, delay > 0 ? delay : 0);
            };

            // Start the first point
            scheduleSpecificPoint(0);

        } else {
            // Immediate mention if no duration is provided
            await interaction.reply(`Immediate Mention: ${role}`);
        }
    }
} else if (interaction.isButton()) {
    await vortexPing.handleButton(interaction);
}
});

client.on("messageCreate", async message => {
    if (message.author.bot) return;
    if (message.content === "!ping") {
        message.reply("Pong!");
    }
});

client.login(token);