const fs = require("fs");
const path = require("path");

const sqlite3 = require("sqlite3").verbose();
// creates in data/db.sqlite

const db = new sqlite3.Database(path.join(__dirname, "../../data/db.sqlite"), (err) => {
    if (err) {
        console.error("Failed to connect to database:", err.message);
    } else {
        console.log("Connected to the SQLite database.");
    }
});

// Create the settings table if it doesn't exist
db.run(
    `CREATE TABLE IF NOT EXISTS settings (
        guild_id TEXT PRIMARY KEY,
        radio_id TEXT DEFAULT NULL,
        radio_volume INTEGER DEFAULT 60,
        radio_enabled INTEGER DEFAULT 0,
        song_avatar_enabled INTEGER DEFAULT 0,
        song_avatar_url TEXT DEFAULT NULL,
        infinicall_enabled INTEGER DEFAULT 0,
        infinicall_id TEXT DEFAULT NULL,
        infinicall_limit INTEGER DEFAULT 5
    )`,
    (err) => {
        if (err) {
            console.error("Failed to create settings table:", err.message);
        } else {
            console.log("Settings table created successfully.");
        }
    }
);

async function validateKey(key) {
    const validKeys = ["radio_volume", "song_avatar_enabled", "song_avatar_url", "radio_id", "radio_enabled", "infinicall_enabled", "infinicall_id", "infinicall_limit"];
    if (!validKeys.includes(key)) {
        throw new Error(`Invalid setting key: ${key}`);
    }
}

async function getSetting(guildId, settingKey) {
    validateKey(settingKey);
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT ${settingKey} FROM settings WHERE guild_id = ?`,
            [guildId],
            (err, row) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(row ? row[settingKey] : null);
                }
            }
        );
    });
}

async function setSetting(guildId, settingKey, value) {
    validateKey(settingKey);
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO settings (guild_id, ${settingKey}) VALUES (?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET ${settingKey} = excluded.${settingKey}`,
            [guildId, value],
            function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            }
        );
    });
}

class Settings {
    constructor(guildId) {
        this.guildId = guildId;
    }

    async get(key) {
        return await getSetting(this.guildId, key);
    }

    async set(key, value) {
        await setSetting(this.guildId, key, value);
    }
}

module.exports = {
    db,
    getSetting,
    setSetting,
    Settings
}