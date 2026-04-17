const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionsBitField } = require("discord.js");

const TIMER_COLOR = 0x7289DA;
const MAX_DURATION_MINUTES = 360;
const activeMentionTimers = new Map();

function makeTimerId() {
    return `mt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildTimerButtonRow(timerId, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`cancel_mention_timer:${timerId}`)
            .setLabel(disabled ? "Timer Cancelled" : "Cancel Timer")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled)
    );
}

function buildMentionPoints(duration, interval) {
    if (!interval) {
        return [duration];
    }

    const points = [];
    for (let m = interval; m < duration; m += interval) {
        points.push(m);
    }

    if (points.length === 0 || points[points.length - 1] !== duration) {
        points.push(duration);
    }

    return points;
}

function buildTimerEmbed({ title, targetText, duration, interval, elapsed, customMessage, requestedBy, timerId, isFinal = false }) {
    const scheduleLabel = interval
        ? `Every ${interval}m for ${duration}m`
        : `One alert at ${duration}m`;

    const fields = [
        { name: "🎯 Target", value: targetText, inline: false },
        { name: "⏱️ Schedule", value: scheduleLabel, inline: true },
        { name: "⏳ Progress", value: `${elapsed} / ${duration}m`, inline: true },
        { name: "👤 Requested By", value: requestedBy, inline: false }
    ];

    if (customMessage) {
        fields.push({ name: "📝 Message", value: customMessage, inline: false });
    }

    const embed = new EmbedBuilder()
        .setColor(TIMER_COLOR)
        .setTitle(title)
        .setDescription(isFinal ? "The timer has reached its final alert." : "The timer is active and running. Use the button below to cancel it.")
        .addFields(fields)
        .setTimestamp();

    if (timerId) {
        embed.setFooter({ text: `Timer ID: ${timerId}` });
    }

    return embed;
}

function buildImmediateEmbed({ targetText, customMessage, requestedBy }) {
    const fields = [
        { name: "🎯 Target", value: targetText, inline: false },
        { name: "👤 Requested By", value: requestedBy, inline: false }
    ];

    if (customMessage) {
        fields.push({ name: "📝 Message", value: customMessage, inline: false });
    }

    return new EmbedBuilder()
        .setColor(TIMER_COLOR)
        .setTitle("📣 Immediate Mention")
        .setDescription("Mention dispatched immediately.")
        .addFields(fields)
        .setTimestamp();
}

async function deleteMessageSafely(message) {
    if (!message) {
        return;
    }

    try {
        await message.delete();
    } catch (error) {
        console.error("Failed to delete timer message:", error.message);
    }
}

function getMemberHighestRolePosition(interaction) {
    return interaction.member?.roles?.highest?.position ?? 0;
}

async function canCancelMentionTimer(interaction, timer) {
    if (!timer || !interaction.inGuild()) {
        return false;
    }

    if (timer.requesterId === interaction.user.id) {
        return true;
    }

    const permissions = interaction.memberPermissions;
    if (permissions?.has(PermissionsBitField.Flags.Administrator) || permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return true;
    }

    const memberRolePosition = getMemberHighestRolePosition(interaction);

    if (timer.kind === "role" && typeof timer.targetRolePosition === "number") {
        return memberRolePosition > timer.targetRolePosition;
    }

    if (timer.kind === "users" && typeof timer.requesterRolePosition === "number") {
        return memberRolePosition > timer.requesterRolePosition;
    }

    return false;
}

function clearTimerTimeouts(timer) {
    if (!timer?.timeoutRefs) {
        return;
    }

    for (const ref of timer.timeoutRefs) {
        clearTimeout(ref);
    }
}

function removeMentionTimer(timerId) {
    const timer = activeMentionTimers.get(timerId);
    if (!timer) {
        return null;
    }

    clearTimerTimeouts(timer);
    activeMentionTimers.delete(timerId);
    return timer;
}

async function executeMentionTimer(interaction, { targetText, duration, interval, customMessage, kind = "users", targetRolePosition = null }) {
    if (duration && (duration < 1 || duration > MAX_DURATION_MINUTES)) {
        return await interaction.reply({
            content: `Please specify a duration between 1 and ${MAX_DURATION_MINUTES} minutes (6 hours).`,
            flags: [MessageFlags.Ephemeral]
        });
    }

    if (interval && !duration) {
        return await interaction.reply({
            content: "Please provide a duration when using interval.",
            flags: [MessageFlags.Ephemeral]
        });
    }

    if (!duration) {
        const immediateEmbed = buildImmediateEmbed({
            targetText,
            customMessage,
            requestedBy: interaction.user.toString()
        });

        return await interaction.reply({
            content: targetText,
            embeds: [immediateEmbed]
        });
    }

    if (interval && (interval < 1 || interval >= duration)) {
        return await interaction.reply({
            content: "Interval must be at least 1 minute and less than the total duration.",
            flags: [MessageFlags.Ephemeral]
        });
    }

    const mentionPoints = buildMentionPoints(duration, interval);
    const timerId = makeTimerId();
    const scheduleText = interval
        ? `Recurring timer armed for ${duration}m at ${interval}m intervals.`
        : `One-time timer armed for ${duration}m.`;

    const armedEmbed = buildTimerEmbed({
        title: "⏰ Timer Armed",
        targetText,
        duration,
        interval,
        elapsed: 0,
        customMessage,
        requestedBy: interaction.user.toString(),
        timerId
    });

    const armedRow = buildTimerButtonRow(timerId);

    await interaction.reply({
        content: scheduleText,
        embeds: [armedEmbed],
        components: [armedRow],
    });

    const startTime = Date.now();
    const timeoutRefs = [];
    const armedMessage = await interaction.fetchReply();

    activeMentionTimers.set(timerId, {
        timerId,
        kind,
        requesterId: interaction.user.id,
        requesterRolePosition: getMemberHighestRolePosition(interaction),
        channelId: interaction.channelId,
        timeoutRefs,
        targetText,
        startedAt: startTime,
        targetRolePosition,
        currentMessage: armedMessage
    });

    let previousMessage = armedMessage;

    const scheduleSpecificPoint = (pointIndex) => {
        const active = activeMentionTimers.get(timerId);
        if (!active) {
            return;
        }

        if (pointIndex >= mentionPoints.length) {
            activeMentionTimers.delete(timerId);
            return;
        }

        const targetMinute = mentionPoints[pointIndex];
        const targetTime = startTime + (targetMinute * 60 * 1000);
        const delay = targetTime - Date.now();

        const timeoutRef = setTimeout(async () => {
            try {
                if (!activeMentionTimers.has(timerId)) {
                    return;
                }

                const elapsed = Math.round((Date.now() - startTime) / 60000);
                const isFinal = targetMinute === duration;

                const updateEmbed = buildTimerEmbed({
                    title: isFinal ? "🎊 Timer Complete" : "🔔 Timer Reminder",
                    targetText,
                    duration,
                    interval,
                    elapsed,
                    customMessage,
                    requestedBy: interaction.user.toString(),
                    timerId,
                    isFinal
                });

                const updateRow = buildTimerButtonRow(timerId, isFinal);

                const nextMessage = await interaction.channel.send({
                    content: targetText,
                    embeds: [updateEmbed],
                    components: [updateRow]
                });

                const activeTimer = activeMentionTimers.get(timerId);
                if (!activeTimer) {
                    await deleteMessageSafely(nextMessage);
                    return;
                }

                activeTimer.currentMessage = nextMessage;

                if (previousMessage && previousMessage.id !== nextMessage.id) {
                    await deleteMessageSafely(previousMessage);
                }

                previousMessage = nextMessage;

                if (isFinal) {
                    activeMentionTimers.delete(timerId);
                    return;
                }

                scheduleSpecificPoint(pointIndex + 1);
            } catch (error) {
                console.error("Failed to send mention timer update:", error);
                scheduleSpecificPoint(pointIndex + 1);
            }
        }, delay > 0 ? delay : 0);

        timeoutRefs.push(timeoutRef);
    };

    scheduleSpecificPoint(0);

    return { timerId };
}

function cancelMentionTimer({ timerId, requesterId, channelId }) {
    const timer = activeMentionTimers.get(timerId);
    if (!timer) {
        return { ok: false, reason: "not-found" };
    }

    if (timer.requesterId !== requesterId) {
        return { ok: false, reason: "forbidden" };
    }

    if (channelId && timer.channelId !== channelId) {
        return { ok: false, reason: "wrong-channel" };
    }

    for (const ref of timer.timeoutRefs) {
        clearTimeout(ref);
    }

    activeMentionTimers.delete(timerId);
    return { ok: true, timerId };
}

function cancelLatestMentionTimer({ requesterId, channelId }) {
    const candidates = [...activeMentionTimers.values()]
        .filter((timer) => timer.requesterId === requesterId && timer.channelId === channelId)
        .sort((a, b) => b.startedAt - a.startedAt);

    if (candidates.length === 0) {
        return { ok: false, reason: "not-found" };
    }

    return cancelMentionTimer({ timerId: candidates[0].timerId, requesterId, channelId });
}

async function handleButton(interaction) {
    const timerId = interaction.customId.replace("cancel_mention_timer:", "");
    const timer = activeMentionTimers.get(timerId);

    if (!timer) {
        return await interaction.reply({
            content: "This timer has already finished or was cancelled.",
            flags: [MessageFlags.Ephemeral]
        });
    }

    const allowed = await canCancelMentionTimer(interaction, timer);
    if (!allowed) {
        return await interaction.reply({
            content: "You do not have permission to cancel this timer.",
            flags: [MessageFlags.Ephemeral]
        });
    }

    const removedTimer = removeMentionTimer(timerId);
    await interaction.reply({
        content: `⛔ Timer cancelled by ${interaction.user}.`,
        flags: [MessageFlags.Ephemeral]
    });

    if (removedTimer?.currentMessage) {
        await deleteMessageSafely(removedTimer.currentMessage);
    }
}

module.exports = {
    executeMentionTimer,
    cancelMentionTimer,
    cancelLatestMentionTimer,
    handleButton,
    removeMentionTimer,
    canCancelMentionTimer
};
