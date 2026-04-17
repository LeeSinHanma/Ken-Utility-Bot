# 🤖 Ken Utility Bot

**Ken Utility Bot** is a powerful, modular Discord utility designed to streamline server management through a robust economy system, customizable timed alerts, and advanced payout distribution tools.

---

## ✨ Key Features

### 🏦 Bank & Economy System

- **Balance Management**: Check your balance or manage others' (with Bank Manager role or bot owner access).
- **Automated Roles**: Automatically manages the `Bank Manager` role for administration.
- **Secure Transactions**: Powered by a robust SQLite backend using `better-sqlite3`.

### ⏰ Custom Alert System

- **Dynamic Command Generation**: Create, edit, and delete server-specific slash commands on the fly.
- **Templates**: Use a powerful template system for boss timers, farm alerts, or events.
- **Visuals**: Supports image attachments and persistent timers.

### 💰 Split System

- **Payout Management**: Easily divide resources or credits among multiple users.
- **Share Modifiers**: Assign specific percentage shares to individuals.
- **Claim Tracking**: Track who has claimed their share with interactive buttons and real-time status updates.

### 🛠 Utility Tools

- **Timed Mentions**: Use `/mention-role` or `/mention-users` to set alarms with optional custom messages.
- **Autocomplete Support**: Intuitive command usage with real-time suggestions.

---

## 🎮 How to Use

### Core Slash Commands

| Command         | Description                                           |
| :-------------- | :---------------------------------------------------- |
| `/bank balance` | View your current balance or a target user's balance. |
| `/create-alert` | Generate a new, custom slash command for your server. |
| `/sync-commands`| Force rebuild and sync slash commands in this server. |
| `/split`        | Initiate a payout distribution session.               |
| `/mention-role` | Set a timed alarm for a specific role.                |
| `/mention-users`| Set a timed alarm for a specific user.                |
| `/help`         | Display a detailed guide of all available features.   |

### Setup Instructions

1.  **Invite the Bot**: Ensure the bot has `Manage Roles` and `Send Messages` permissions.
2.  **Role Setup**: Upon joining, the bot will automatically create or identify the **Bank Manager** role. Assign this role to users who should manage balances. Server admins can still use `/bank setup` to recover or change bank role configuration.

---

## 📜 Support & Technical Details

- **Framework**: `Discord.js v14`
- **Database**: `SQLite` (via `better-sqlite3`)
- **Environment**: `Node.js 18+`

For issues or feature requests, contact the bot administrator or refer to the `/help` command within Discord.
