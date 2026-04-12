const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, UserSelectMenuBuilder, StringSelectMenuBuilder } = require("discord.js");
const db = require("../database");

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

        const modifier = session.user_modifiers && session.user_modifiers[userId] 
            ? ` (${session.user_modifiers[userId]}% Share)` 
            : "";

        return `<@${userId}>${modifier} - **${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}** credits${status}`;
    });

    let details = "";
    if (session.extra > 0) details += `\n➕ **Extra:** ${session.extra.toLocaleString()}`;
    if (session.deductions > 0) details += `\n➖ **Deductions:** ${session.deductions.toLocaleString()}`;

    return `**Host:** <@${session.host_id}>\n**Initial Total:** ${session.total_amount.toLocaleString()}\n**Discount:** ${session.discount}%${details}\n**💎 Total to Split:** ${session.net_amount.toLocaleString()}\n\n**Recipients:**\n${lines.join("\n")}`;
}

module.exports = {
    data: {
        name: "split",
        description: "Manage money splits (SQLite)",
        options: [
            {
                name: "start",
                description: "Initiate a money split",
                type: 1, // Subcommand
                options: [
                    {
                        name: "amount",
                        description: "Total base amount",
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
                        name: "extra",
                        description: "Additional amount to add to the split pool",
                        type: 10,
                        required: false
                    },
                    {
                        name: "deductions",
                        description: "Amount to subtract from the split pool",
                        type: 10,
                        required: false
                    },
                    {
                        name: "modifiers",
                        description: "Custom percentages (e.g. 50% @user1 @user2)",
                        type: 3,
                        required: false
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
            const extra = interaction.options.getNumber("extra") || 0;
            const deductions = interaction.options.getNumber("deductions") || 0;
            const includeHost = interaction.options.getBoolean("include-host") ?? true;
            const usersInput = interaction.options.getString("users");
            const modifiersInput = interaction.options.getString("modifiers");
            
            // Step 1: Extract all potential user IDs from both inputs
            const allUserIds = [];
            
            // From main users list
            const mainUserIds = usersInput.match(/\d+/g) || [];
            allUserIds.push(...mainUserIds);

            // From modifiers list (and parse percentages)
            const userModifiers = {};
            if (modifiersInput) {
                const groups = modifiersInput.match(/(\d+)%\s*((?:<@!?\d+>\s*)+)/g);
                if (groups) {
                    for (const group of groups) {
                        const percentMatch = group.match(/(\d+)%/);
                        const userMatches = group.match(/<@!?(\d+)>/g);
                        if (percentMatch && userMatches) {
                            const percent = parseInt(percentMatch[1]);
                            userMatches.forEach(u => {
                                const id = u.match(/\d+/)[0];
                                allUserIds.push(id);
                                userModifiers[id] = percent;
                            });
                        }
                    }
                }
            }

            if (includeHost) allUserIds.push(interaction.user.id);

            // Step 2: Deduplicate and validate
            const userIds = [...new Set(allUserIds)];

            if (userIds.length === 0) {
                return await interaction.reply({ content: "❌ **Error:** Please mention at least one valid user.", flags: [MessageFlags.Ephemeral] });
            }

            // MATH: Calculate final pool
            const baseNet = totalAmount * (1 - (discount / 100));
            const netAmount = baseNet + extra - deductions;
            
            const equalShare = netAmount / userIds.length;
            
            const breakdown = {};
            let surplus = 0;
            const unmodifiedUsers = [];

            // Step 3: Calculate adjusted shares and collect surplus
            userIds.forEach(id => {
                if (userModifiers[id] !== undefined) {
                    const share = equalShare * (userModifiers[id] / 100);
                    breakdown[id] = share;
                    surplus += (equalShare - share);
                } else {
                    unmodifiedUsers.push(id);
                }
            });

            // Step 4: Redistribute surplus to unmodified users
            if (unmodifiedUsers.length > 0) {
                const bonus = surplus / unmodifiedUsers.length;
                unmodifiedUsers.forEach(id => {
                    breakdown[id] = equalShare + bonus;
                });
            } else {
                // If everyone has a modifier, just use the calculated reduced shares
                userIds.forEach(id => {
                    if (breakdown[id] === undefined) breakdown[id] = equalShare;
                });
            }

            const sessionId = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);

            const session = {
                host_id: interaction.user.id,
                guild_id: interaction.guildId,
                channel_id: interaction.channelId,
                total_amount: totalAmount,
                discount: discount,
                extra: extra,
                deductions: deductions,
                net_amount: netAmount,
                user_breakdown: breakdown,
                user_modifiers: userModifiers,
                claimed_status: {},
                pending_claims: [],
                host_notification_ids: {},
                created_at: new Date().toISOString()
            };

            userIds.forEach(id => {
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
                    .setCustomId(`split_mark_manual:${sessionId}`)
                    .setLabel("Mark Claimed")
                    .setStyle(ButtonStyle.Secondary),
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
            
            db.splits.save(sessionId, session);
        }

        else if (subcommand === "check") {
            const userId = interaction.user.id;
            const pendingSplits = db.splits.getAllPending(userId);

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
                
                description += `**#${index + 1}** | **${Math.round(amount).toLocaleString()}** credits from <@${split.host_id}>\n[🔗 Jump to Message](${jumpUrl})\n\n`;
                
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
                        value: "Use `/split start <amount> <discount> <users> [extra] [deductions] [modifiers]`\n- **Amount**: The total credit pool.\n- **Discount**: Whole number % off.\n- **Extra**: Additional credits added to the pool.\n- **Deductions**: Credits subtracted from the pool (fees, etc)." 
                    },
                    {
                        name: "📊 Advanced Calculations",
                        value: "The bot calculates: `(Initial - Discount) + Extra - Deductions`. The final result is then divided among recipients."
                    },
                    {
                        name: "⚖️ Percentage Modifiers",
                        value: "Use `modifiers: 50% @user` to reduce specific shares. The surplus is given to unmodified users."
                    },
                    { 
                        name: "📥 Claiming & Managing", 
                        value: "• **Claim My Share**: Request payout.\n• **Mark Claimed (Host Only)**: Directly finalize users using a menu.\n• **Notify Claim**: Ping non-claimants.\n• **Delete Split**: Cancel the session." 
                    }
                )
                .setColor("#5865F2")
                .setTimestamp();

            await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }
    },

    async handleButton(interaction) {
        const [action, sessionId] = interaction.customId.split(":");
        const session = db.splits.get(sessionId);

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

        // --- MARK MANUAL ACTION (Host Selection Menu) ---
        if (action === "split_mark_manual") {
            if (interaction.user.id !== session.host_id) {
                return await interaction.reply({ content: "❌ Only the host can mark users as claimed.", flags: [MessageFlags.Ephemeral] });
            }

            const pendingIds = Object.keys(session.user_breakdown).filter(id => !session.claimed_status[id]);

            if (pendingIds.length === 0) {
                return await interaction.reply({ content: "✅ Everyone in this split has already been marked as claimed!", flags: [MessageFlags.Ephemeral] });
            }

            const options = [];
            for (const id of pendingIds.slice(0, 25)) {
                let label = id;
                try {
                    const user = await interaction.client.users.fetch(id);
                    label = user.username;
                } catch (err) {}

                options.push({
                    label: label,
                    value: id,
                    description: `Share: ${Math.round(session.user_breakdown[id]).toLocaleString()} credits`
                });
            }

            const select = new StringSelectMenuBuilder()
                .setCustomId(`split_mark_select:${sessionId}`)
                .setPlaceholder("Select users to mark as claimed")
                .setMinValues(1)
                .setMaxValues(options.length)
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(select);

            return await interaction.reply({ 
                content: "📋 **Manual Claim Confirmation**\nSelect the users you've paid to update their status in the main split embed.", 
                components: [row],
                flags: [MessageFlags.Ephemeral] 
            });
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
            if (!session) return await interaction.update({ content: "❌ Split already deleted.", components: [] });
            if (interaction.user.id !== session.host_id) return await interaction.reply({ content: "❌ Unauthorized.", flags: [MessageFlags.Ephemeral] });

            await interaction.deferUpdate();

            const channel = await interaction.client.channels.fetch(session.channel_id);
            if (channel) {
                for (const msgId of Object.values(session.host_notification_ids)) {
                    try {
                        const msg = await channel.messages.fetch(msgId);
                        await msg.delete();
                    } catch (err) {}
                }

                try {
                    const originalMsg = await channel.messages.fetch(session.message_id);
                    await originalMsg.delete();
                } catch (err) {}
            }

            db.splits.delete(sessionId);

            return await interaction.editReply({ content: "✅ **Split successfully deleted.** All associated messages have been removed.", components: [] });
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

            const amount = session.user_breakdown[userId];
            const hostNotifyEmbed = new EmbedBuilder()
                .setTitle("📥 Claim Request")
                .setDescription(`<@${session.host_id}>, <@${userId}> wants to claim their share of **${Math.round(amount).toLocaleString()}** credits.`)
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

            db.splits.save(sessionId, session);
        }

        // --- CONFIRM ACTION (from claim notification) ---
        else if (action === "split_confirm") {
            const targetUserId = interaction.customId.split(":")[2];
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

            db.splits.save(sessionId, session);
        }
    },

    async handleSelectMenu(interaction) {
        const [action, sessionId] = interaction.customId.split(":");
        const session = db.splits.get(sessionId);

        if (!session) return await interaction.reply({ content: "❌ Split session not found.", flags: [MessageFlags.Ephemeral] });
        if (interaction.user.id !== session.host_id) return await interaction.reply({ content: "❌ Only the host can perform this action.", flags: [MessageFlags.Ephemeral] });

        if (action === "split_mark_select") {
            const selectedUserIds = interaction.values;
            let updatedCount = 0;

            const channel = await interaction.client.channels.fetch(session.channel_id);

            for (const id of selectedUserIds) {
                if (session.user_breakdown[id] && !session.claimed_status[id]) {
                    session.claimed_status[id] = true;
                    session.pending_claims = session.pending_claims.filter(p => p !== id);
                    updatedCount++;

                    const notifyMsgId = session.host_notification_ids[id];
                    if (notifyMsgId) {
                        try {
                            const notifyMsg = await channel.messages.fetch(notifyMsgId);
                            await notifyMsg.delete();
                        } catch (err) {}
                        delete session.host_notification_ids[id];
                    }
                }
            }

            if (updatedCount > 0) {
                try {
                    const originalMsg = await channel.messages.fetch(session.message_id);
                    const updatedEmbed = EmbedBuilder.from(originalMsg.embeds[0]).setDescription(generateDescription(session));
                    await originalMsg.edit({ embeds: [updatedEmbed] });
                } catch (err) {}

                db.splits.save(sessionId, session);
                await interaction.reply({ content: `✅ Successfully marked ${updatedCount} user(s) as claimed.`, flags: [MessageFlags.Ephemeral] });
            } else {
                await interaction.reply({ content: "ℹ️ No changes were made. Selected users might already be marked as claimed or aren't part of this split.", flags: [MessageFlags.Ephemeral] });
            }
        }
    }
};
