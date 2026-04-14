const Database = require("better-sqlite3");
const path = require("node:path");
const fs = require("node:fs");

const dbPath = path.join(__dirname, "data", "database.db");

// Ensure data directory exists
if (!fs.existsSync(path.dirname(dbPath))) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

// Connect to Database
const db = new Database(dbPath);

// Initialize Tables
db.exec(`
    CREATE TABLE IF NOT EXISTS bank (
        guild_id TEXT,
        user_id TEXT,
        balance INTEGER DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
        guild_id TEXT,
        key TEXT,
        value TEXT,
        PRIMARY KEY (guild_id, key)
    );

    CREATE TABLE IF NOT EXISTS custom_commands (
        guild_id TEXT,
        name TEXT,
        config TEXT,
        PRIMARY KEY (guild_id, name)
    );

    CREATE TABLE IF NOT EXISTS splits (
        session_id TEXT PRIMARY KEY,
        data TEXT
    );
`);

/**
 * BANK SYSTEM METHODS
 */
const bank = {
    /**
     * Get or create a record for a user in a guild
     */
    get: (guildId, userId) => {
        const stm = db.prepare("SELECT * FROM bank WHERE guild_id = ? AND user_id = ?");
        let row = stm.get(guildId, userId);
        
        if (!row) {
            db.prepare("INSERT INTO bank (guild_id, user_id, balance) VALUES (?, ?, 0)").run(guildId, userId);
            row = { guild_id: guildId, user_id: userId, balance: 0 };
        }
        return row;
    },

    /**
     * Atomically update a balance
     */
    update: (guildId, userId, amount) => {
        return db.prepare("UPDATE bank SET balance = balance + ? WHERE guild_id = ? AND user_id = ?").run(amount, guildId, userId);
    },

    /**
     * Set an absolute balance
     */
    set: (guildId, userId, absoluteAmount) => {
        return db.prepare(`
            INSERT INTO bank (guild_id, user_id, balance) 
            VALUES (?, ?, ?) 
            ON CONFLICT(guild_id, user_id) DO UPDATE SET balance = excluded.balance
        `).run(guildId, userId, absoluteAmount);
    }
};

/**
 * SETTINGS METHODS
 */
const settings = {
    get: (guildId, key) => {
        const row = db.prepare("SELECT value FROM settings WHERE guild_id = ? AND key = ?").get(guildId, key);
        return row ? row.value : null;
    },
    set: (guildId, key, value) => {
        return db.prepare(`
            INSERT INTO settings (guild_id, key, value) 
            VALUES (?, ?, ?) 
            ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
        `).run(guildId, key, value);
    }
};

/**
 * CUSTOM COMMAND FACTORY METHODS
 */
const customCommands = {
    getForGuild: (guildId) => {
        const rows = db.prepare("SELECT * FROM custom_commands WHERE guild_id = ?").all(guildId);
        return rows.map(r => JSON.parse(r.config));
    },
    get: (guildId, name) => {
        const row = db.prepare("SELECT config FROM custom_commands WHERE guild_id = ? AND name = ?").get(guildId, name);
        return row ? JSON.parse(row.config) : null;
    },
    add: (guildId, name, config) => {
        const normalizedConfig = { ...config, name };
        return db.prepare(`
            INSERT INTO custom_commands (guild_id, name, config) 
            VALUES (?, ?, ?) 
            ON CONFLICT(guild_id, name) DO UPDATE SET config = excluded.config
        `).run(guildId, name, JSON.stringify(normalizedConfig));
    },
    remove: (guildId, name) => {
        return db.prepare("DELETE FROM custom_commands WHERE guild_id = ? AND name = ?").run(guildId, name);
    }
};

const splitCleanup = {
    purgeStale: (maxAgeMs) => {
        const rows = db.prepare("SELECT session_id, data FROM splits").all();
        const deleteStmt = db.prepare("DELETE FROM splits WHERE session_id = ?");
        const cutoffTime = Date.now() - maxAgeMs;
        let deletedCount = 0;

        for (const row of rows) {
            let session;

            try {
                session = JSON.parse(row.data);
            } catch (error) {
                deleteStmt.run(row.session_id);
                deletedCount++;
                continue;
            }

            const createdAt = session.created_at ? new Date(session.created_at).getTime() : NaN;
            const claimedValues = session.claimed_status ? Object.values(session.claimed_status) : [];
            const isComplete = claimedValues.length > 0 && claimedValues.every(Boolean);
            const isExpired = Number.isFinite(createdAt) ? createdAt < cutoffTime : true;

            if (isComplete || isExpired) {
                deleteStmt.run(row.session_id);
                deletedCount++;
            }
        }

        return deletedCount;
    }
};

/**
 * SPLITS SESSION METHODS
 */
const splits = {
    get: (sessionId) => {
        const row = db.prepare("SELECT data FROM splits WHERE session_id = ?").get(sessionId);
        return row ? JSON.parse(row.data) : null;
    },
    save: (sessionId, data) => {
        return db.prepare(`
            INSERT INTO splits (session_id, data) 
            VALUES (?, ?) 
            ON CONFLICT(session_id) DO UPDATE SET data = excluded.data
        `).run(sessionId, JSON.stringify(data));
    },
    delete: (sessionId) => {
        return db.prepare("DELETE FROM splits WHERE session_id = ?").run(sessionId);
    },
    getAllPending: (userId) => {
        const rows = db.prepare("SELECT session_id, data FROM splits").all();
        return rows
            .map(r => ({ id: r.session_id, ...JSON.parse(r.data) }))
            .filter(s => s.user_breakdown[userId] && !s.claimed_status[userId]);
    }
};

module.exports = { bank, settings, customCommands, splits, splitCleanup, raw: db };
