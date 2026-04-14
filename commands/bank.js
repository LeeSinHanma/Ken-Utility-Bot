const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const { botOwners, bankAdminRoles } = require("../config.json");
const db = require("../database");

module.exports = {
    data: {
        name: "bank",
        description: "Guild bank and economy system (SQLite)",
        options: [
            {
                name: "balance",
                description: "Check your bank balance",
                type: 1, // Subcommand
                options: [
                    {
                        name: "user",
                        description: "The user whose balance you want to check (Bank Manager/authorized role)",
                        type: 6,
                        required: false
                    }
                ]
            },
            {
                name: "add",
                description: "Add money to a user's bank account (Bank Manager/authorized role)",
                type: 1, // Subcommand
                options: [
                    {
                        name: "user",
                        description: "The user to add money to",
                        type: 6,
                        required: true
                    },
                    {
                        name: "amount",
                        description: "The amount of coins to add",
                        type: 10,
                        required: true
                    }
                ]
            },
            {
                name: "remove",
                description: "Remove money from a user's bank account (Bank Manager/authorized role)",
                type: 1, // Subcommand
                options: [
                    {
                        name: "user",
                        description: "The user to remove money from",
                        type: 6,
                        required: true
                    },
                    {
                        name: "amount",
                        description: "The amount of coins to remove",
                        type: 10,
                        required: true
                    }
                ]
            },
            {
                name: "setup",
                description: "Configure bank settings (Admin only)",
                type: 1, // Subcommand
                options: [
                    {
                        name: "admin-role",
                        description: "The role allowed to manage the bank",
                        type: 8,
                        required: true
                    }
                ]
            },
            {
                name: "help",
                description: "Detailed manual for the bank and economy system",
                type: 1 // Subcommand
            }
        ]
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        
        // Permission check
        const adminRoleId = db.settings.get(guildId, "adminRoleId");
        const hasBankManagerRole = Boolean(adminRoleId && interaction.member.roles.cache.has(adminRoleId));
        const isAdmin = botOwners.includes(interaction.user.id) || 
                hasBankManagerRole ||
                        interaction.member.roles.cache.some(role => bankAdminRoles.includes(role.id));

        // --- BALANCE SUBCOMMAND ---
        if (subcommand === "balance") {
            const targetUser = interaction.options.getUser("user") || interaction.user;

            if (targetUser.id !== interaction.user.id && !hasBankManagerRole) {
                return await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("❌ Permission Denied")
                            .setDescription("Only the configured Bank Manager role can view other users' balances.")
                            .setColor("#FF4B4B")
                    ],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            const record = db.bank.get(guildId, targetUser.id);

            const embed = new EmbedBuilder()
                .setTitle("🏦 Bank Balance")
                .setAuthor({ name: targetUser.tag, iconURL: targetUser.displayAvatarURL() })
                .setDescription(`${targetUser.id === interaction.user.id ? "Your" : `<@${targetUser.id}>'s`} current bank balance is:\n\n# 💰 **${record.balance.toLocaleString()}** coins`)
                .setColor("#FFD700")
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }

        // --- ADD SUBCOMMAND ---
        else if (subcommand === "add") {
            if (!isAdmin) {
                return await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("❌ Unauthorized")
                            .setDescription("You must be an authorized Bank Admin to add funds.")
                            .setColor("#FF4B4B")
                    ],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            const targetUser = interaction.options.getUser("user");
            const amount = interaction.options.getNumber("amount");

            if (amount <= 0) {
                return await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("❌ Invalid Amount")
                            .setDescription("Amount must be positive.")
                            .setColor("#FF4B4B")
                    ],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            db.bank.update(guildId, targetUser.id, amount);
            const record = db.bank.get(guildId, targetUser.id);

            const embed = new EmbedBuilder()
                .setTitle("💵 Funds Added")
                .setDescription(`Successfully added **${amount.toLocaleString()}** coins to <@${targetUser.id}>'s account.`)
                .addFields({ name: "New Balance", value: `💰 **${record.balance.toLocaleString()}** coins` })
                .setColor("#57F287")
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }

        // --- REMOVE SUBCOMMAND ---
        else if (subcommand === "remove") {
            if (!isAdmin) {
                return await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("❌ Unauthorized")
                            .setDescription("You must be an authorized Bank Admin to remove funds.")
                            .setColor("#FF4B4B")
                    ],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            const targetUser = interaction.options.getUser("user");
            const amount = interaction.options.getNumber("amount");

            if (amount <= 0) {
                return await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("❌ Invalid Amount")
                            .setDescription("Amount must be positive.")
                            .setColor("#FF4B4B")
                    ],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            const record = db.bank.get(guildId, targetUser.id);
            if (record.balance < amount) {
                return await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("❌ Insufficient Funds")
                            .setDescription(`<@${targetUser.id}> only has **${record.balance.toLocaleString()}** coins.`)
                            .setColor("#FF4B4B")
                    ],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            db.bank.update(guildId, targetUser.id, -amount);
            const newRecord = db.bank.get(guildId, targetUser.id);

            const embed = new EmbedBuilder()
                .setTitle("💸 Funds Removed")
                .setDescription(`Successfully removed **${amount.toLocaleString()}** coins from <@${targetUser.id}>'s account.`)
                .addFields({ name: "New Balance", value: `💰 **${newRecord.balance.toLocaleString()}** coins` })
                .setColor("#57F287")
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }

        // --- SETUP SUBCOMMAND ---
        else if (subcommand === "setup") {
            const canSetup = botOwners.includes(interaction.user.id) || 
                             interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
                             interaction.member.permissions.has(PermissionFlagsBits.Administrator);

            if (!canSetup) {
                return await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("❌ Unauthorized")
                            .setDescription("You must have 'Manage Server' or 'Administrator' permissions to update settings.")
                            .setColor("#FF4B4B")
                    ],
                    flags: [MessageFlags.Ephemeral]
                });
            }

            const role = interaction.options.getRole("admin-role");
            db.settings.set(guildId, "adminRoleId", role.id);

            const embed = new EmbedBuilder()
                .setTitle("⚙️ Configuration Updated")
                .setDescription(`The bank management role for this server has been set to: <@&${role.id}>`)
                .setColor("#5865F2")
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }

        // --- HELP SUBCOMMAND ---
        else if (subcommand === "help") {
            const embed = new EmbedBuilder()
                .setTitle("📖 Bank & Economy Help Guide")
                .setDescription("The Bank System provides a guild-wide economy where users can track coins, and only authorized bank roles can manage funds.")
                .addFields(
                    { 
                        name: "💰 Personal Banking", 
                        value: "• `/bank balance` - View your current coin balance.\n• `/bank balance [user]` - (Configured Bank Manager role only) View another user's balance." 
                    },
                    {
                        name: "🛠️ Admin Management",
                        value: "• `/bank add <user> <amount>` - Grant coins to a member.\n• `/bank remove <user> <amount>` - Deduct coins from a member.\n• `/bank setup <role>` - Designate a role as a **Bank Manager**."
                    },
                    {
                        name: "⚖️ Permissions",
                        value: "• **Users**: Can check their own balance.\n• **Configured Bank Manager Role**: Required for `/bank balance [user]`.\n• **Bank Managers/Configured Bank Roles/Bot Owners**: Can use `/bank add` and `/bank remove`.\n• **Server Admins (Manage Server/Administrator)**: Can run `/bank setup` to configure or recover bank role access."
                    }
                )
                .setColor("#FFD700")
                .setTimestamp()
                .setFooter({ text: "Ken Utility Bot • Secure Economy System" });

            await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }
    }
};
