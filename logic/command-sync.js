const db = require("../database");

// Discord requires command and option names to be lowercase and match a specific
// regex. Enforce a conservative pattern here and skip invalid entries to avoid
// failing the entire guild sync request.
const NAME_REGEX = /^[a-z0-9_-]{1,32}$/;

function buildCustomCommandData(config) {
    return {
        name: config.name,
        description: config.description,
        options: [
            { name: "target-role", description: `Override role (Preset: ${config.roleId ? "Set" : "None"})`, type: 8, required: false },
            { name: "location", description: "Set or override location", type: 3, required: false },
            { name: "vortex-image", description: "Upload a screenshot", type: 11, required: false },
            { name: "duration", description: `Override duration (Preset: ${config.duration}m)`, type: 4, required: false },
            { name: "interval", description: `Override interval (Preset: ${config.interval}m)`, type: 4, required: false },
            { name: "remind-before", description: `Override early warning (Preset: ${config.remindBefore || 0}m)`, type: 4, required: false }
        ]
    };
}

function buildGuildCommandData(client, guildId) {
    const deduped = new Map();

    for (const command of client.commands.values()) {
        if (!command.data || command.internalOnly) {
            continue;
        }

        if (!NAME_REGEX.test(command.data.name)) {
            console.warn(`[SYNC] Skipping built-in command with invalid name "${command.data.name}"`);
            continue;
        }

        deduped.set(command.data.name, command.data);
    }

    const customConfigs = db.customCommands.getForGuild(guildId);
    for (const config of customConfigs) {
        if (!config || typeof config.name !== "string") {
            console.warn(`[SYNC] Skipping malformed custom command config in guild ${guildId}:`, config);
            continue;
        }

        if (!NAME_REGEX.test(config.name)) {
            console.warn(`[SYNC] Skipping custom command "/${config.name}" in guild ${guildId} because the name contains invalid characters.`);
            continue;
        }

        if (deduped.has(config.name)) {
            console.warn(`[SYNC] Skipping custom command "/${config.name}" in guild ${guildId} because it conflicts with a built-in command.`);
            continue;
        }

        deduped.set(config.name, buildCustomCommandData(config));
    }

    return [...deduped.values()];
}

async function syncGuildCommands(client, guild) {
    const guildId = typeof guild === "string" ? guild : guild?.id;
    if (!guildId) {
        throw new TypeError("syncGuildCommands requires a guild object or guild id.");
    }

    let resolvedGuild = typeof guild === "string" ? null : guild;

    if (!resolvedGuild) {
        resolvedGuild = client.guilds.cache.get(guildId) || null;
    }

    if (!resolvedGuild) {
        try {
            resolvedGuild = await client.guilds.fetch(guildId);
        } catch (error) {
            if (error?.code === 10004) {
                throw new Error(`Cannot sync commands: guild ${guildId} is unknown to this bot (code 10004).`);
            }
            throw error;
        }
    }

    const commands = buildGuildCommandData(client, guildId);
    await resolvedGuild.commands.set(commands);
    console.log(`[SYNC] Guild ${resolvedGuild.name}: synced ${commands.length} slash commands.`);
    return commands.length;
}

module.exports = {
    buildCustomCommandData,
    buildGuildCommandData,
    syncGuildCommands
};
