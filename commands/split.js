const fs = require("node:fs");
const path = require("node:path");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");

const splitsPath = path.join(__dirname, "..", "data", "splits.json");

/**
 * Utility: Load JSON data
 */
function loadData(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, "utf-8"));
        }
    } catch (err) {
        console.error(`Error loading ${filePath}:`, err);
    }
    return {};
}

/**
 * Utility: Save JSON data
 */
function saveData(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
    } catch (err) {
        console.error(`Error saving ${filePath}:`, err);
    }
}

/**
 * Utility: Generate the split embed description based on session state
 */
function generateDescription(session) {
    const lines = Object.entries(session.user_breakdown).map(([userId, amount]) => {
        let status = "";
        if (session.claimed_status[userId]) {
            status = " **Claimed ✅**";
        } else if (session.pending_claims.includes(userId)) {
            status = " *Waiting ⏳*";
        }
        return `<@${userId}> - **${amount.toLocaleString()}** credits${status}`;
    });

    return `**Host:** <@${session.host_id}>\n**Total:** ${session.total_amount.toLocaleString()}\n**Net to Split:** ${session.net_amount.toLocaleString()} (${session.discount}% off)\n\n**Recipients:**\n${lines.join("\n")}`;
}

module.exports = {
    data: {
        name: "split",
        description: "Manage money splits",
        options: [
            {
                name: "start",
                description: "Initiate a money split",
                type: 1, // Subcommand
                options: [
                    {
                        name: "amount",
                        description: "Total amount to split",
                        type: 10,
                        required: true
                    },
                    {
                        name: "discount",
                        description: "Discount percentage (e.g. 15 for 15% off)",
                        type: 10,
                        required: true
                    },
                    {
                        name: "users",
                        description: "Users to split with (mentions or IDs)",
                        type: 3,
                        required: true
                    },
                    {
                        name: "include-host",
                        description: "Include yourself in the split (defaults to true)",
                        type: 5,
                        required: false
                    }
                ]
            },
            {
                name: "check",
                description: "Check your pending splits",
                type: 1 // Subcommand
            },
            {
                name: "help",
                description: "Show how to use the split system",
                type: 1 // Subcommand
            }
        ]
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === "start") {
            const totalAmount = interaction.options.getNumber("amount");
            const discount = interaction.options.getNumber("discount");
            const includeHost = interaction.options.getBoolean("include-host") ?? true;
            const usersInput = interaction.options.getString("users");
            
            let userIds = usersInput.match(/\d+/g) || [];
            if (includeHost) userIds.push(interaction.user.id);
            userIds = [...new Set(userIds)];

            if (userIds.length === 0) {
                return await interaction.reply({ content: "❌ **Error:** Please mention at least one valid user.", flags: [MessageFlags.Ephemeral] });
            }

            const netAmount = totalAmount * (1 - (discount / 100));
            const sharePerUser = netAmount / userIds.length;
            const sessionId = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);

            const session = {
                host_id: interaction.user.id,
                guild_id: interaction.guildId,
                channel_id: interaction.channelId,
                total_amount: totalAmount,
                discount: discount,
                net_amount: netAmount,
                user_breakdown: {},
                claimed_status: {},
                pending_claims: [],
                host_notification_ids: {},
                created_at: new Date().toISOString()
            };

            userIds.forEach(id => {
                session.user_breakdown[id] = sharePerUser;
                session.claimed_status[id] = false;
            });

            const embed = new EmbedBuilder()
                .setTitle("💰 Money Split Initiated")
                .setDescription(generateDescription(session))
                .setFooter({ text: `Session ID: ${sessionId}` })
                .setColor("#2B2D31")
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`split_claim:${sessionId}`)
                    .setLabel("Claim My Share")
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`split_notify:${sessionId}`)
                    .setLabel("Notify Claim")
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`split_delete:${sessionId}`)
                    .setLabel("Delete Split")
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.reply({ embeds: [embed], components: [row] });
            const response = await interaction.fetchReply();
            
            session.message_id = response.id;
            
            const splits = loadData(splitsPath);
            splits[sessionId] = session;
            saveData(splitsPath, splits);
        }

        else if (subcommand === "check") {
            const splits = loadData(splitsPath);
            const userId = interaction.user.id;
            const pendingSplits = [];

            for (const [sid, session] of Object.entries(splits)) {
                if (session.user_breakdown[userId] && !session.claimed_status[userId]) {
                    pendingSplits.push({ id: sid, ...session });
                }
            }

            if (pendingSplits.length === 0) {
                return await interaction.reply({ content: "✅ You have no pending splits to claim!", flags: [MessageFlags.Ephemeral] });
            }

            const embed = new EmbedBuilder()
                .setTitle("📋 Your Pending Splits")
                .setColor("#5865F2")
                .setTimestamp();

            const row = new ActionRowBuilder();
            let description = "";

            pendingSplits.slice(0, 5).forEach((split, index) => {
                const amount = split.user_breakdown[userId];
                const jumpUrl = `https://discord.com/channels/${split.guild_id}/${split.channel_id}/${split.message_id}`;
                
                description += `**#${index + 1}** | **${amount.toLocaleString()}** credits from <@${split.host_id}>\n[🔗 Jump to Message](${jumpUrl})\n\n`;
                
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`split_locate:${split.id}`)
                        .setLabel(`Locate #${index + 1}`)
                        .setStyle(ButtonStyle.Secondary)
                );
            });

            embed.setDescription(description || "No pending splits found.");

            await interaction.reply({ embeds: [embed], components: row.components.length > 0 ? [row] : [], flags: [MessageFlags.Ephemeral] });
        }

        else if (subcommand === "help") {
            const embed = new EmbedBuilder()
                .setTitle("📖 Split System Help Guide")
                .setDescription("The Split System simplifies dividing credits among users with a secure claim/approval flow.")
                .addFields(
                    { 
                        name: "🚀 Starting a Split", 
                        value: "Use `/split start <amount> <discount> <users>`\n- **Amount**: The total credit pool.\n- **Discount**: Whole number % off (e.g., `15` for 15% off).\n- **Users**: Mention users or paste IDs.\n- **Include-host**: Default is true." 
                    },
                    { 
                        name: "📥 Claiming Shares", 
                        value: "Recipients click **'Claim My Share'**. The host is then mentioned in the channel to approve." 
                    },
                    { 
                        name: "✅ Host Controls", 
                        value: "- **Confirm Claim**: Approaches a user's request.\n- **Notify Claim**: Pings all users who haven't claimed yet.\n- **Delete Split**: Permanently removes the split (requires host confirmation)." 
                    },
                    { 
                        name: "📋 Checking Pending Splits", 
                        value: "Use `/split check` to see all splits waiting for your claim. Use the **'Locate'** buttons to find the original message thread." 
                    },
                    { 
                        name: "💡 Emojis Status", 
                        value: "- `Waiting ⏳`: User requested claim, host needs to approve.\n- `Claimed ✅`: Split finalized for that user." 
                    }
                )
                .setColor("#5865F2")
                .setTimestamp();

            await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }
    },

    async handleButton(interaction) {
        const [action, sessionId, targetUserId] = interaction.customId.split(":");
        const splits = loadData(splitsPath);
        const session = splits[sessionId];

        if (!session && !action.includes("confirm") && !action.includes("cancel")) {
            return await interaction.reply({ content: "❌ **Error:** Split session not found.", flags: [MessageFlags.Ephemeral] });
        }

        // --- LOCATE ACTION ---
        if (action === "split_locate") {
            await interaction.deferUpdate();
            try {
                const channel = await interaction.client.channels.fetch(session.channel_id);
                if (channel) {
                    await channel.send({
                        content: `📍 <@${interaction.user.id}>, here is your pending split from <@${session.host_id}>!\nhttps://discord.com/channels/${session.guild_id}/${session.channel_id}/${session.message_id}`
                    });
                }
            } catch (err) {
                console.error("Failed to locate split:", err);
                await interaction.followUp({ content: "❌ Could not send a message in that channel.", flags: [MessageFlags.Ephemeral] });
            }
            return;
        }

        // --- DELETE TRIGGER ---
        if (action === "split_delete") {
            if (interaction.user.id !== session.host_id) {
                return await interaction.reply({ content: "❌ Only the host can delete this split.", flags: [MessageFlags.Ephemeral] });
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`split_delete_confirm:${sessionId}`)
                    .setLabel("Yes, Delete Split")
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`split_delete_cancel:${sessionId}`)
                    .setLabel("No, Cancel")
                    .setStyle(ButtonStyle.Secondary)
            );

            return await interaction.reply({ 
                content: "⚠️ **WARNING:** Are you sure you want to delete this split? This will remove all data and delete the original message. This action cannot be undone.", 
                components: [row],
                flags: [MessageFlags.Ephemeral] 
            });
        }

        // --- DELETE CONFIRM ---
        if (action === "split_delete_confirm") {
            // Re-load to ensure we have the latest session even if session not found above
            if (!session) return await interaction.update({ content: "❌ Split already deleted.", components: [] });
            if (interaction.user.id !== session.host_id) return await interaction.reply({ content: "❌ Unauthorized.", flags: [MessageFlags.Ephemeral] });

            await interaction.deferUpdate();

            // 1. Delete Host Notifications
            const channel = await interaction.client.channels.fetch(session.channel_id);
            if (channel) {
                for (const msgId of Object.values(session.host_notification_ids)) {
                    try {
                        const msg = await channel.messages.fetch(msgId);
                        await msg.delete();
                    } catch (err) {}
                }

                // 2. Delete Original Message
                try {
                    const originalMsg = await channel.messages.fetch(session.message_id);
                    await originalMsg.delete();
                } catch (err) {}
            }

            // 3. Delete from JSON
            delete splits[sessionId];
            saveData(splitsPath, splits);

            return await interaction.editReply({ content: "✅ **Split successfully deleted.** All associated messages have been removed.", components: [] });
        }

        // --- DELETE CANCEL ---
        if (action === "split_delete_cancel") {
            return await interaction.update({ content: "✅ Deletion cancelled. The split remains active.", components: [] });
        }

        // --- NOTIFY ACTION ---
        if (action === "split_notify") {
            if (interaction.user.id !== session.host_id) {
                return await interaction.reply({ content: "❌ Only the host can use the notify button.", flags: [MessageFlags.Ephemeral] });
            }

            const nonClaimants = Object.keys(session.user_breakdown).filter(id => 
                !session.claimed_status[id] && !session.pending_claims.includes(id)
            );

            if (nonClaimants.length === 0) {
                return await interaction.reply({ content: "✅ Everyone has already claimed or is pending approval!", flags: [MessageFlags.Ephemeral] });
            }

            const pings = nonClaimants.map(id => `<@${id}>`).join(" ");
            await interaction.channel.send({
                content: `🔔 **Attention!** ${pings}, please claim your share in the split initiated by <@${session.host_id}>!`
            });

            return await interaction.reply({ content: "📢 Re-notified all pending recipients.", flags: [MessageFlags.Ephemeral] });
        }

        // --- CLAIM ACTION ---
        if (action === "split_claim") {
            const userId = interaction.user.id;
            if (!session.user_breakdown[userId]) return await interaction.reply({ content: "❌ This split wasn't assigned to you.", flags: [MessageFlags.Ephemeral] });
            if (session.claimed_status[userId]) return await interaction.reply({ content: "❌ You have already claimed your share.", flags: [MessageFlags.Ephemeral] });
            if (session.pending_claims.includes(userId)) return await interaction.reply({ content: "⏳ Your claim is already pending.", flags: [MessageFlags.Ephemeral] });

            await interaction.deferUpdate();
            session.pending_claims.push(userId);

            const hostNotifyEmbed = new EmbedBuilder()
                .setTitle("📥 Claim Request")
                .setDescription(`<@${session.host_id}>, <@${userId}> wants to claim their share of **${session.user_breakdown[userId].toLocaleString()}** credits.`)
                .setColor("#5865F2");

            const hostRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`split_confirm:${sessionId}:${userId}`)
                    .setLabel("Confirm Claim")
                    .setStyle(ButtonStyle.Success)
            );

            try {
                const hostMsg = await interaction.channel.send({ 
                    content: `<@${session.host_id}> <@${userId}>`,
                    embeds: [hostNotifyEmbed], 
                    components: [hostRow] 
                });
                session.host_notification_ids[userId] = hostMsg.id;
            } catch (err) {}

            try {
                const channel = await interaction.client.channels.fetch(session.channel_id);
                const originalMsg = await channel.messages.fetch(session.message_id);
                const updatedEmbed = EmbedBuilder.from(originalMsg.embeds[0]).setDescription(generateDescription(session));
                await originalMsg.edit({ embeds: [updatedEmbed] });
            } catch (err) {}

            saveData(splitsPath, splits);
        }

        // --- CONFIRM ACTION ---
        else if (action === "split_confirm") {
            if (interaction.user.id !== session.host_id) return await interaction.reply({ content: "❌ Only the host can confirm.", flags: [MessageFlags.Ephemeral] });
            if (session.claimed_status[targetUserId]) return await interaction.reply({ content: "❌ Already claimed.", flags: [MessageFlags.Ephemeral] });

            await interaction.deferUpdate();
            session.claimed_status[targetUserId] = true;
            session.pending_claims = session.pending_claims.filter(id => id !== targetUserId);

            try {
                const channel = await interaction.client.channels.fetch(session.channel_id);
                const originalMsg = await channel.messages.fetch(session.message_id);
                const updatedEmbed = EmbedBuilder.from(originalMsg.embeds[0]).setDescription(generateDescription(session));
                await originalMsg.edit({ embeds: [updatedEmbed] });

                const notifyMsgId = session.host_notification_ids[targetUserId];
                if (notifyMsgId) {
                    const notifyMsg = await channel.messages.fetch(notifyMsgId);
                    await notifyMsg.delete();
                    delete session.host_notification_ids[targetUserId];
                }
            } catch (err) {}

            saveData(splitsPath, splits);
        }
    }
};
