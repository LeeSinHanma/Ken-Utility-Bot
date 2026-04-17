const { MessageFlags } = require("discord.js");
const { executeMentionTimer } = require("../logic/mention-timer");

module.exports = {
    data: {
        name: "mention-users",
        description: "Mention one or more users with a timed alarm",
        options: [
            {
                name: "users",
                description: "User mentions or IDs separated by spaces",
                type: 3, // String type
                required: false
            },
            {
                name: "target-user",
                description: "Optional single user to include",
                type: 6, // User type
                required: false
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
            },
            {
                name: "message",
                description: "Optional message to include with each mention",
                type: 3, // String type
                required: false
            }
        ]
    },

    async execute(interaction) {
        const targetUser = interaction.options.getUser("target-user");
        const usersRaw = interaction.options.getString("users") || "";
        const duration = interaction.options.getInteger("duration");
        const interval = interaction.options.getInteger("interval");
        const customMessage = interaction.options.getString("message")?.trim();

        const parsedIds = new Set();
        const mentionOrIdRegex = /<@!?(\d{17,20})>|\b(\d{17,20})\b/g;
        for (const match of usersRaw.matchAll(mentionOrIdRegex)) {
            const id = match[1] || match[2];
            if (id) parsedIds.add(id);
        }
        if (targetUser) {
            parsedIds.add(targetUser.id);
        }

        if (parsedIds.size === 0) {
            return await interaction.reply({
                content: "Please provide at least one user using `users` (mentions/IDs) or `target-user`.",
                flags: [MessageFlags.Ephemeral]
            });
        }

        const mentionText = [...parsedIds].map((id) => `<@${id}>`).join(" ");

        await executeMentionTimer(interaction, {
            targetText: mentionText,
            duration,
            interval,
            customMessage,
            kind: "users"
        });
    }
};
