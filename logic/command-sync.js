const db = require("../database");

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

        deduped.set(command.data.name, command.data);
    }

    const customConfigs = db.customCommands.getForGuild(guildId);
    for (const config of customConfigs) {
        if (deduped.has(config.name)) {
            console.warn(`[SYNC] Skipping custom command "/${config.name}" in guild ${guildId} because it conflicts with a built-in command.`);
            continue;
        }

        deduped.set(config.name, buildCustomCommandData(config));
    }

    return [...deduped.values()];
}

async function syncGuildCommands(client, guild) {
    const commands = buildGuildCommandData(client, guild.id);
    await guild.commands.set(commands);
    console.log(`[SYNC] Guild ${guild.name}: synced ${commands.length} slash commands.`);
    return commands.length;
}

module.exports = {
    buildCustomCommandData,
    buildGuildCommandData,
    syncGuildCommands
};
