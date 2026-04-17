const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, UserSelectMenuBuilder, StringSelectMenuBuilder } = require("discord.js");
const db = require("../database");

function extractUserIds(input) {
    if (!input) {
        return [];
    }

    const ids = [];

    for (const match of input.matchAll(/<@!?(\d+)>/g)) {
        ids.push(match[1]);
    }

    for (const match of input.matchAll(/(?<!\d)(\d{15,20})(?!\d)/g)) {
        ids.push(match[1]);
    }

    return ids;
}

function calculateBreakdown(session, userIds) {
    const userModifiers = session.user_modifiers || {};
    const equalShare = session.net_amount / userIds.length;
    const breakdown = {};
    let surplus = 0;
    const unmodifiedUsers = [];

    userIds.forEach(id => {
        if (userModifiers[id] !== undefined) {
            const share = equalShare * (userModifiers[id] / 100);
            breakdown[id] = share;
            surplus += (equalShare - share);
        } else {
            unmodifiedUsers.push(id);
        }
    });

    if (unmodifiedUsers.length > 0) {
        const bonus = surplus / unmodifiedUsers.length;
        unmodifiedUsers.forEach(id => {
            breakdown[id] = equalShare + bonus;
        });
    } else {
        userIds.forEach(id => {
            if (breakdown[id] === undefined) breakdown[id] = equalShare;
        });
    }

    return breakdown;
}

function getSplitRecipients(session) {
    return Array.isArray(session.recipient_order) && session.recipient_order.length > 0
        ? session.recipient_order
        : Object.keys(session.user_breakdown || {});
}

function buildSplitJumpUrl(session) {
    if (session.thread_id) {
        return `https://discord.com/channels/${session.guild_id}/${session.thread_id}`;
    }

    return `https://discord.com/channels/${session.guild_id}/${session.channel_id}/${session.message_id}`;
}

function buildSplitThreadName(hostName) {
    const now = new Date();
    const hh = String(now.getUTCHours()).padStart(2, "0");
    const mm = String(now.getUTCMinutes()).padStart(2, "0");
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    const year = now.getUTCFullYear();
    const safeHost = (hostName || "Host").replace(/[\r\n]/g, " ").trim();
    const fullName = `${safeHost} ${hh}:${mm} UTC ${month}/${day}/${year} split`;

    return fullName.slice(0, 100);
}

async function cleanupSplitThread(interaction, session, reason) {
    let splitThread = null;

    if (session.thread_id && session.channel_id === session.thread_id) {
        splitThread = await interaction.client.channels.fetch(session.channel_id).catch(() => null);
    } else if (session.thread_id) {
        splitThread = await interaction.client.channels.fetch(session.thread_id).catch(() => null);
    }

    if (!splitThread || typeof splitThread.isThread !== "function" || !splitThread.isThread()) {
        return;
    }

    try {
        await splitThread.delete(reason);
    } catch (error) {
        console.warn(`Failed to delete split thread ${splitThread.id}:`, error.message);
        try {
            if (typeof splitThread.setLocked === "function") {
                await splitThread.setLocked(true, reason);
            }
            if (typeof splitThread.setArchived === "function") {
                await splitThread.setArchived(true, reason);
            }
        } catch (archiveError) {
            console.warn(`Failed to archive split thread ${splitThread.id}:`, archiveError.message);
        }
    }
}

function buildPendingSplitsView(userId, pendingSplits) {
    const embed = new EmbedBuilder()
        .setTitle("📋 Your Pending Splits")
        .setColor("#5865F2")
        .setTimestamp();

    const locateRow = new ActionRowBuilder();
    const removeRow = new ActionRowBuilder();
    let description = "";

    pendingSplits.slice(0, 5).forEach((split, index) => {
        const amount = split.user_breakdown[userId];
        const jumpUrl = buildSplitJumpUrl(split);

        description += `**#${index + 1}** | **${Math.round(amount).toLocaleString()}** credits from <@${split.host_id}>\n[🔗 Open Split](${jumpUrl})\n\n`;

        locateRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`split_locate:${split.id}`)
                .setLabel(`Locate #${index + 1}`)
                .setStyle(ButtonStyle.Secondary)
        );

        removeRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`split_remove:${split.id}`)
                .setLabel(`Remove #${index + 1}`)
                .setStyle(ButtonStyle.Danger)
        );
    });

    embed.setDescription(description || "No pending splits found.");

    const components = [];
    if (locateRow.components.length > 0) components.push(locateRow);
    if (removeRow.components.length > 0) components.push(removeRow);

    return { embed, components };
}

/**
 * Utility: Generate the split embed description based on session state
 */
function generateDescription(session) {
    const lines = getSplitRecipients(session).map(userId => {
        let status = "";
        if (session.opted_out_status?.[userId]) {
            return `<@${userId}> - **OPTED OUT**`;
        }

        if (session.claimed_status[userId]) {
            status = " **Claimed ✅**";
        } else if (session.pending_claims.includes(userId)) {
            status = " *Waiting ⏳*";
        }

        const modifier = session.user_modifiers && session.user_modifiers[userId] 
            ? ` (${session.user_modifiers[userId]}% Share)` 
            : "";

        const amount = session.user_breakdown[userId];
        return `<@${userId}>${modifier} - **${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}** credits${status}`;
    });

    let details = "";
    if (session.extra > 0) details += `\n➕ **Extra:** ${session.extra.toLocaleString()}`;
    if (session.deductions > 0) details += `\n➖ **Deductions:** ${session.deductions.toLocaleString()}`;

    const totalOptedOut = Object.values(session.opted_out_status || {}).filter(Boolean).length;
    if (totalOptedOut > 0) {
        details += `\n🚪 **Total Opted Out:** ${totalOptedOut}`;
    }

    return `**Host:** <@${session.host_id}>\n**Initial Total:** ${session.total_amount.toLocaleString()}\n**Discount:** ${session.discount}%${details}\n**💎 Total to Split:** ${session.net_amount.toLocaleString()}\n\n**Recipients:**\n${lines.join("\n")}`;
}

async function finalizeSplitIfComplete(interaction, sessionId, session) {
    const claimedValues = Object.values(session.claimed_status || {});
    if (claimedValues.length === 0 || !claimedValues.every(Boolean)) {
        return false;
    }

    try {
        const channel = await interaction.client.channels.fetch(session.channel_id);
        if (channel) {
            for (const msgId of Object.values(session.host_notification_ids || {})) {
                try {
                    const msg = await channel.messages.fetch(msgId);
                    await msg.delete();
                } catch (error) {}
            }

            try {
                const originalMsg = await channel.messages.fetch(session.message_id);
                const completedEmbed = EmbedBuilder.from(originalMsg.embeds[0])
                    .setTitle("✅ Money Split Completed")
                    .setDescription(`${generateDescription(session)}\n\n**Status:** All shares have been claimed.`);

                await originalMsg.edit({ embeds: [completedEmbed], components: [] });
            } catch (error) {
                console.error("Failed to update completed split message:", error);
            }

            await cleanupSplitThread(interaction, session, `Split ${sessionId} completed`);
        }
    } catch (error) {
        console.error("Failed to finalize completed split session:", error);
    } finally {
        db.splits.delete(sessionId);
    }

    return true;
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
                        max_length: 4000,
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
                        max_length: 4000,
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
            const mainUserIds = extractUserIds(usersInput);
            allUserIds.push(...mainUserIds);

            // From modifiers list (and parse percentages)
            const userModifiers = {};
            if (modifiersInput) {
                const groups = modifiersInput.match(/(\d+)%\s*([^%]+)/g);
                if (groups) {
                    for (const group of groups) {
                        const percentMatch = group.match(/(\d+)%/);
                        const userIds = extractUserIds(group);
                        if (percentMatch && userIds.length > 0) {
                            const percent = parseInt(percentMatch[1]);
                            userIds.forEach(id => {
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
                thread_id: null,
                total_amount: totalAmount,
                discount: discount,
                extra: extra,
                deductions: deductions,
                net_amount: netAmount,
                user_breakdown: breakdown,
                user_modifiers: userModifiers,
                recipient_order: userIds,
                opted_out_status: {},
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

            try {
                const hostName = interaction.member?.displayName || interaction.user.username;
                const threadName = buildSplitThreadName(hostName);
                const thread = await response.startThread({
                    name: threadName,
                    autoArchiveDuration: 1440,
                    reason: `Split session ${sessionId}`
                });

                const threadMessage = await thread.send({ embeds: [embed], components: [row] });

                session.thread_id = thread.id;
                session.channel_id = thread.id;
                session.message_id = threadMessage.id;

                await response.edit({
                    content: `🧵 Split moved to <#${thread.id}>. Use the thread message for all actions.`,
                    embeds: [embed],
                    components: []
                });
            } catch (error) {
                console.warn(`Failed to auto-create thread for split ${sessionId}:`, error.message);
            }
            
            db.splits.save(sessionId, session);
            await finalizeSplitIfComplete(interaction, sessionId, session);
        }

        else if (subcommand === "check") {
            const userId = interaction.user.id;
            const pendingSplits = db.splits.getAllPending(userId, interaction.guildId);

            if (pendingSplits.length === 0) {
                return await interaction.reply({ content: "✅ You have no pending splits to claim!", flags: [MessageFlags.Ephemeral] });
            }

            const view = buildPendingSplitsView(userId, pendingSplits);
            await interaction.reply({ embeds: [view.embed], components: view.components, flags: [MessageFlags.Ephemeral] });
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
                    const jumpUrl = buildSplitJumpUrl(session);
                    await channel.send({
                        content: `📍 <@${interaction.user.id}>, here is your pending split from <@${session.host_id}>!\n${jumpUrl}`
                    });
                }
            } catch (err) {
                console.error("Failed to locate split:", err);
                await interaction.followUp({ content: "❌ Could not send a message in that channel.", flags: [MessageFlags.Ephemeral] });
            }
            return;
        }

        if (action === "split_remove") {
            const userId = interaction.user.id;

            if (!session.user_breakdown[userId]) {
                return await interaction.reply({ content: "❌ This split wasn't assigned to you.", flags: [MessageFlags.Ephemeral] });
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`split_remove_confirm:${sessionId}`)
                    .setLabel("Yes, Opt Out")
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`split_remove_cancel:${sessionId}`)
                    .setLabel("No, Keep Me In")
                    .setStyle(ButtonStyle.Secondary)
            );

            return await interaction.reply({
                content: "⚠️ Are you sure you want to opt out of this split? Your share will be removed from your side only.",
                components: [row],
                flags: [MessageFlags.Ephemeral]
            });
        }

        if (action === "split_remove_cancel") {
            return await interaction.reply({ content: "✅ Opt-out cancelled.", flags: [MessageFlags.Ephemeral] });
        }

        if (action === "split_remove_confirm") {
            const userId = interaction.user.id;

            if (!session.user_breakdown[userId]) {
                return await interaction.reply({ content: "❌ This split wasn't assigned to you.", flags: [MessageFlags.Ephemeral] });
            }

            await interaction.deferUpdate();

            const channel = await interaction.client.channels.fetch(session.channel_id).catch(() => null);
            const notifyMsgId = session.host_notification_ids?.[userId];
            if (channel && notifyMsgId) {
                try {
                    const notifyMsg = await channel.messages.fetch(notifyMsgId);
                    await notifyMsg.delete();
                } catch (err) {}
            }

            session.opted_out_status = session.opted_out_status || {};
            session.opted_out_status[userId] = true;
            delete session.user_breakdown[userId];
            delete session.claimed_status[userId];
            delete session.user_modifiers?.[userId];
            if (session.pending_claims) {
                session.pending_claims = session.pending_claims.filter(id => id !== userId);
            }
            if (session.host_notification_ids) {
                delete session.host_notification_ids[userId];
            }
            const remainingUserIds = Object.keys(session.user_breakdown);

            if (remainingUserIds.length === 0) {
                try {
                    if (channel) {
                        const originalMsg = await channel.messages.fetch(session.message_id);
                        const updatedEmbed = EmbedBuilder.from(originalMsg.embeds[0]).setDescription(generateDescription(session));
                        await originalMsg.edit({ embeds: [updatedEmbed], components: [] });
                    }
                } catch (err) {}

                db.splits.delete(sessionId);
                return await interaction.editReply({ content: "✅ You opted out of the split. No recipients remained, so the split was closed.", embeds: [], components: [] });
            }

            try {
                if (channel) {
                    const originalMsg = await channel.messages.fetch(session.message_id);
                    const updatedEmbed = EmbedBuilder.from(originalMsg.embeds[0]).setDescription(generateDescription(session));
                    await originalMsg.edit({ embeds: [updatedEmbed] });
                }
            } catch (err) {}

            db.splits.save(sessionId, session);

            const pendingSplits = db.splits.getAllPending(userId, interaction.guildId);
            const view = buildPendingSplitsView(userId, pendingSplits);

            if (pendingSplits.length === 0) {
                return await interaction.editReply({ content: "✅ You opted out of that split and now have no pending splits in this server.", embeds: [], components: [] });
            }

            return await interaction.editReply({ content: "✅ You opted out of the split.", embeds: [view.embed], components: view.components });
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

                await cleanupSplitThread(interaction, session, `Split ${sessionId} deleted by host`);
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
            await finalizeSplitIfComplete(interaction, sessionId, session);
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
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

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
                await finalizeSplitIfComplete(interaction, sessionId, session);
                await interaction.editReply({ content: `✅ Successfully marked ${updatedCount} user(s) as claimed.` });
            } else {
                await interaction.editReply({ content: "ℹ️ No changes were made. Selected users might already be marked as claimed or aren't part of this split." });
            }
        }
    }
};
