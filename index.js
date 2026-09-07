require("dotenv").config();

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    EmbedBuilder,
    ActivityType,
    PermissionFlagsBits,
} = require("discord.js");
const discordVoice = require("@discordjs/voice");

const GUILD_ID = process.env.GUILD_ID || "1406595308275630212";
const INFINICALL = process.env.INFINICALL || "1427083874776776775";
const MAX_CALL_SIZE = Number(process.env.MAX_CALL_SIZE || 4);
const DEFAULT_RADIO_VOLUME = Number(process.env.RADIO_VOLUME || 60);
let currentRadioVolume = DEFAULT_RADIO_VOLUME;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

let connection = null;
let connected = false;
let disconnectTimeout = null;
const announcementPlayer = discordVoice.createAudioPlayer();
const radioPlayer = discordVoice.createAudioPlayer();
let activeAnnouncementFile = null;
let currentRadioStation = null;
let currentRadioServer = null;
let nowPlayingInterval = null;
const NOWPLAY_CHANNEL = process.env.NOWPLAY_CHANNEL || null;
let nowPlayingMessageId = null;
const ENABLE_SONG_AVATAR = true; // Set to true to enable automatic avatar updates based on now-playing song art
const AVATAR_CHANGE_COOLDOWN_MS = Number(process.env.AVATAR_CHANGE_COOLDOWN_MS || 60000);
const MAX_AVATAR_BYTES = Number(process.env.MAX_AVATAR_BYTES || 256 * 1024); // 256 KB default
let originalAvatarBuffer = null;
let lastAvatarChange = 0;
// persistent per-guild settings
const SETTINGS_FILE = path.join(__dirname, "bot-settings.json");
let settings = {};

async function loadSettings() {
    try {
        const txt = await fs.promises.readFile(SETTINGS_FILE, "utf8");
        settings = JSON.parse(txt || "{}");
    } catch (e) {
        settings = {};
    }
}

async function saveSettings() {
    try {
        await fs.promises.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
    } catch (e) {
        console.warn("Failed to save settings:", e && e.message ? e.message : e);
    }
}

function getGuildSetting(guildId, key, def) {
    try {
        return (settings[guildId] && Object.prototype.hasOwnProperty.call(settings[guildId], key)) ? settings[guildId][key] : def;
    } catch (e) {
        return def;
    }
}

async function setGuildSetting(guildId, key, value) {
    settings[guildId] = settings[guildId] || {};
    settings[guildId][key] = value;
    await saveSettings();
}
let lastNowPlayingDisplay = null;
let lastNowPlayingArt = null;

announcementPlayer.on("idle", () => {
    if (activeAnnouncementFile) {
        fs.promises.unlink(activeAnnouncementFile).catch(() => {});
        activeAnnouncementFile = null;
    }
});

announcementPlayer.on("error", (error) => {
    console.error("Voice announcement failed:", error);
    if (activeAnnouncementFile) {
        fs.promises.unlink(activeAnnouncementFile).catch(() => {});
        activeAnnouncementFile = null;
    }
});

radioPlayer.on("error", (error) => {
    console.error("Radio stream error:", error);
});

function clampVolumePercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 60;
    }

    return Math.min(100, Math.max(0, numeric));
}

function setRadioVolume(volumePercent) {
    const safePercent = clampVolumePercent(volumePercent);
    currentRadioVolume = safePercent;

    const activeResource = radioPlayer.state?.resource;
    if (activeResource && activeResource.volume) {
        activeResource.volume.setVolume(safePercent / 100);
    }

    return safePercent;
}

function getHumanMemberCount(channel) {
    if (!channel || !channel.members) {
        return 0;
    }

    return channel.members.filter((member) => !member.user.bot).size;
}

function escapePowerShellString(value) {
    return value.replace(/'/g, "''");
}

function commandExistsSync(cmd) {
    try {
        const which = require("child_process").spawnSync(process.platform === "win32" ? "where" : "which", [cmd]);
        return which.status === 0;
    } catch (e) {
        return false;
    }
}

function createAnnouncementAudio(text) {
    return new Promise((resolve) => {
        const filePath = path.join(os.tmpdir(), `discord-join-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);

        const finish = (ok) => {
            if (ok) {
                resolve(filePath);
            } else {
                resolve(null);
            }
        };

        // Try platform-specific TTS implementations in order of preference
        if (process.platform === "win32" && commandExistsSync("powershell.exe")) {
            const script = [
                "Add-Type -AssemblyName System.Speech;",
                "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
                "$synth.SetOutputToWaveFile('" + escapePowerShellString(filePath) + "');",
                "$synth.Speak('" + escapePowerShellString(text) + "');",
                "$synth.Dispose();",
            ].join(" ");

            const child = execFile("powershell.exe", ["-NoProfile", "-Command", script], (error) => {
                if (error) {
                    console.warn("PowerShell TTS failed:", error && error.message ? error.message : error);
                    finish(false);
                    return;
                }

                finish(true);
            });

            child.once("error", (err) => {
                console.warn("PowerShell spawn error:", err && err.message ? err.message : err);
                finish(false);
            });

            return;
        }

        // macOS `say` (writes AIFF by default with -o, but Discord accepts many formats via ffmpeg)
        if (process.platform === "darwin" && commandExistsSync("say")) {
            const child = execFile("say", ["-o", filePath, text], (error) => {
                if (error) {
                    console.warn("macOS `say` TTS failed:", error && error.message ? error.message : error);
                    finish(false);
                    return;
                }

                finish(true);
            });

            child.once("error", (err) => {
                console.warn("macOS `say` spawn error:", err && err.message ? err.message : err);
                finish(false);
            });

            return;
        }

        // Linux: try pico2wave -> espeak
        if (process.platform === "linux") {
            if (commandExistsSync("pico2wave")) {
                const child = execFile("pico2wave", ["-w", filePath, text], (error) => {
                    if (error) {
                        console.warn("pico2wave TTS failed:", error && error.message ? error.message : error);
                        finish(false);
                        return;
                    }

                    finish(true);
                });

                child.once("error", (err) => {
                    console.warn("pico2wave spawn error:", err && err.message ? err.message : err);
                    finish(false);
                });

                return;
            }

            if (commandExistsSync("espeak")) {
                const child = execFile("espeak", ["-w", filePath, text], (error) => {
                    if (error) {
                        console.warn("espeak TTS failed:", error && error.message ? error.message : error);
                        finish(false);
                        return;
                    }

                    finish(true);
                });

                child.once("error", (err) => {
                    console.warn("espeak spawn error:", err && err.message ? err.message : err);
                    finish(false);
                });

                return;
            }
        }

        // No supported TTS available — resolve null so caller can continue playback
        console.warn("No supported TTS engine found (powershell, pico2wave, espeak, or say). Skipping announcement.");
        finish(false);
    });
}

async function announceJoin(guild, member) {
    const voiceConnection = discordVoice.getVoiceConnection(guild.id) || connection;

    if (!voiceConnection) {
        return;
    }

    try {
        const audioFile = await createAnnouncementAudio(`${member.displayName} joined the call`);
        if (!audioFile) {
            // TTS not available or failed; just skip the announcement
            return;
        }

        // If a radio is currently playing, try to mix the announcement with the live stream using ffmpeg so music continues.
        const channel = guild.channels.cache.get(INFINICALL);
        const station = currentRadioStation;

        const playedMixed = station && commandExistsSync("ffmpeg") && (await (async () => {
            try {
                // spawn ffmpeg to mix live stream and announcement file
                const spawn = require("child_process").spawn;
                const ff = spawn("ffmpeg", [
                    "-i", station.stream_url,
                    "-i", audioFile,
                    "-filter_complex", "amix=inputs=2:duration=shortest:dropout_transition=0",
                    "-f", "wav",
                    "pipe:1",
                ], { windowsHide: true });

                ff.once("error", (err) => console.warn("ffmpeg spawn error:", err && err.message ? err.message : err));

                const resource = discordVoice.createAudioResource(ff.stdout, {
                    inputType: discordVoice.StreamType.Arbitrary,
                    inlineVolume: true,
                });
                resource.volume?.setVolume(currentRadioVolume / 100);

                voiceConnection.subscribe(radioPlayer);
                radioPlayer.play(resource);

                // When mixed playback ends, restart normal radio playback
                const onIdle = async () => {
                    radioPlayer.removeListener("idle", onIdle);
                    try {
                        if (channel && station) {
                            await playAzuraCastStation(channel, station.name);
                        }
                    } catch (e) {
                        console.warn("Failed to resume radio after announcement:", e && e.message ? e.message : e);
                    }
                };

                radioPlayer.on("idle", onIdle);

                return true;
            } catch (e) {
                return false;
            }
        })());

        if (playedMixed) {
            // mixed and played successfully
            activeAnnouncementFile = audioFile;
            return;
        }

        // Fallback: play announcement alone (will temporarily replace the subscription)
        voiceConnection.subscribe(announcementPlayer);
        activeAnnouncementFile = audioFile;
        const audioResource = discordVoice.createAudioResource(fs.createReadStream(audioFile));
        const wasPlaying = radioPlayer.state.status === "playing";

        announcementPlayer.play(audioResource);

        if (wasPlaying && currentRadioStation) {
            announcementPlayer.once("idle", async () => {
                try {
                    const channel = guild.channels.cache.get(INFINICALL);
                    if (channel) await playAzuraCastStation(channel, currentRadioStation.name);
                } catch (e) {
                    console.warn("Failed to resume radio after announcement:", e && e.message ? e.message : e);
                }
            });
        }
    } catch (error) {
        console.error("Failed to create voice announcement:", error);
    }
}

function normalizeAzuraCastServer(rawServer) {
    if (!rawServer || typeof rawServer !== "object") {
        return null;
    }

    const name = String(rawServer.name || rawServer.server_name || rawServer.label || "Primary").trim();
    const baseUrl = String(rawServer.base_url || rawServer.url || rawServer.baseUrl || "").trim().replace(/\/+$/, "");
    const apiKey = String(rawServer.api_key || rawServer.apiKey || rawServer.key || "").trim();

    if (!baseUrl) {
        return null;
    }

    return {
        name: name || "Server 1",
        base_url: baseUrl,
        api_key: apiKey,
    };
}

function parseConfiguredStations() {
    const rawValue = process.env.AZURACAST_STATIONS || "";
    if (!rawValue.trim()) {
        return [];
    }

    try {
        const parsed = JSON.parse(rawValue);
        if (Array.isArray(parsed)) {
            return parsed;
        }
    } catch (error) {
        // Fall through to the string-based config parser below.
    }

    return rawValue
        .split(/\n|,/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
            const separatorIndex = entry.indexOf("|");
            if (separatorIndex >= 0) {
                const name = entry.slice(0, separatorIndex).trim();
                const streamUrl = entry.slice(separatorIndex + 1).trim();
                if (name && streamUrl) {
                    return { name, stream_url: streamUrl };
                }
            }

            const equalsIndex = entry.indexOf("=");
            if (equalsIndex >= 0) {
                const name = entry.slice(0, equalsIndex).trim();
                const streamUrl = entry.slice(equalsIndex + 1).trim();
                if (name && streamUrl) {
                    return { name, stream_url: streamUrl };
                }
            }

            return null;
        })
        .filter(Boolean);
}

function parseAzuraCastServers() {
    const rawValue = process.env.AZURACAST_SERVERS || "";

    if (rawValue.trim()) {
        try {
            const parsed = JSON.parse(rawValue);
            const servers = Array.isArray(parsed) ? parsed : [parsed];
            return servers.map(normalizeAzuraCastServer).filter(Boolean);
        } catch (error) {
            const entries = rawValue
                .split(/\n|;/)
                .map((entry) => entry.trim())
                .filter(Boolean)
                .map((entry) => {
                    const parts = entry.split("|").map((part) => part.trim());
                    if (parts.length >= 2) {
                        const [name, baseUrl, apiKey] = parts;
                        return normalizeAzuraCastServer({ name, base_url: baseUrl, api_key: apiKey || "" });
                    }

                    const equalsIndex = entry.indexOf("=");
                    if (equalsIndex >= 0) {
                        const name = entry.slice(0, equalsIndex).trim();
                        const details = entry.slice(equalsIndex + 1).trim();
                        const [baseUrl, apiKey] = details.split(",").map((part) => part.trim());
                        return normalizeAzuraCastServer({ name, base_url: baseUrl, api_key: apiKey || "" });
                    }

                    return null;
                })
                .filter(Boolean);

            if (entries.length) {
                return entries;
            }
        }
    }

    const baseUrl = (process.env.AZURACAST_BASE_URL || "").trim().replace(/\/+$/, "");
    if (!baseUrl) {
        return [];
    }

    return [
        normalizeAzuraCastServer({
            name: process.env.AZURACAST_SERVER_NAME || "Primary",
            base_url: baseUrl,
            api_key: process.env.AZURACAST_API_KEY || "",
        }),
    ].filter(Boolean);
}

function getAzuraCastServer(serverName) {
    const servers = parseAzuraCastServers();
    if (!servers.length) {
        return null;
    }

    if (!serverName) {
        return servers.length === 1 ? servers[0] : null;
    }

    const normalizedInput = String(serverName).trim().toLowerCase();
    return (
        servers.find((server) => server.name.toLowerCase() === normalizedInput) ||
        servers.find((server) => server.name.toLowerCase().includes(normalizedInput)) ||
        null
    );
}

function normalizeStation(station) {
    if (!station) {
        return null;
    }

    return {
        id: station.id ?? station.short_name ?? station.name ?? station.display_name ?? "",
        name: station.name ?? station.display_name ?? station.short_name ?? "Unknown Station",
        stream_url: station.stream_url ?? station.listen_url ?? station.url ?? station.listenUrl ?? station.hls_url ?? null,
    };
}

function buildAzuraCastHeaders(apiKey) {
    const headers = {
        Accept: "application/json",
        "User-Agent": "DiscordRadioBot/1.0",
    };

    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    return headers;
}

function getUrlStream(url) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const transport = parsedUrl.protocol === "https:" ? https : http;

        const req = transport.get(parsedUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                resolve(getUrlStream(new URL(res.headers.location, parsedUrl).toString()));
                res.resume();
                return;
            }

            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`Received ${res.statusCode} for ${url}`));
                return;
            }

            resolve(res);
        });

        req.on("error", reject);
    });
}

async function fetchAzuraCastStations(serverConfig) {
    const server = serverConfig || getAzuraCastServer();
    if (!server) {
        return [];
    }

    try {
        const response = await fetch(`${server.base_url}/api/stations`, {
            headers: buildAzuraCastHeaders(server.api_key),
        });

        if (!response.ok) {
            throw new Error(`AzuraCast API returned ${response.status}`);
        }

        const payload = await response.json();
        const list = Array.isArray(payload)
            ? payload
            : Array.isArray(payload.data)
                ? payload.data
                : Array.isArray(payload.stations)
                    ? payload.stations
                    : [];

        return list.map(normalizeStation).filter(Boolean).filter((station) => station.stream_url);
    } catch (error) {
        console.error(`Failed to fetch AzuraCast stations for ${server.name}:`, error.message || error);
        return [];
    }
}

async function getAvailableStations(serverName) {
    const configuredStations = parseConfiguredStations();
    if (configuredStations.length) {
        return configuredStations.map((station) => normalizeStation(station)).filter(Boolean);
    }

    const server = getAzuraCastServer(serverName);
    return fetchAzuraCastStations(server);
}

async function resolveStation(stationName, serverName) {
    const normalizedInput = String(stationName || "").trim().toLowerCase();
    if (!normalizedInput) {
        return null;
    }

    const stations = await getAvailableStations(serverName);
    return (
        stations.find((station) => station.name.toLowerCase() === normalizedInput) ||
        stations.find((station) => station.id.toString().toLowerCase() === normalizedInput) ||
        stations.find((station) => station.name.toLowerCase().includes(normalizedInput)) ||
        null
    );
}

function ensureConnection(channel) {
    const guild = channel.guild;
    const existingConnection = discordVoice.getVoiceConnection(guild.id);

    if (existingConnection) {
        if (existingConnection.joinConfig.channelId !== channel.id) {
            existingConnection.destroy();
        } else {
            return existingConnection;
        }
    }

    const newConnection = discordVoice.joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
    });

    connection = newConnection;
    return newConnection;
}

async function playAzuraCastStation(channel, stationName, serverName) {
    const server = getAzuraCastServer(serverName);
    const station = await resolveStation(stationName, serverName);

    if (!server && !parseConfiguredStations().length) {
        return { ok: false, message: "No AzuraCast server is configured. Add AZURACAST_BASE_URL or AZURACAST_SERVERS first." };
    }

    if (!station) {
        const serverLabel = server ? server.name : "configured";
        return { ok: false, message: `I couldn't find the station "${stationName}" on the ${serverLabel} AzuraCast server.` };
    }

    const voiceConnection = ensureConnection(channel);
    if (!voiceConnection) {
        return { ok: false, message: "I couldn't join the voice channel." };
    }

    // apply per-guild default volume (so radio starts at configured level when joining)
    try {
        const guildId = channel.guild.id;
        const guildDefault = getGuildSetting(guildId, "defaultVolume", DEFAULT_RADIO_VOLUME);
        setRadioVolume(guildDefault);
        console.log(`Applied guild ${guildId} defaultVolume=${guildDefault}%`);
    } catch (e) {
        // ignore
    }

    try {
        const stream = await getUrlStream(station.stream_url);
        const resource = discordVoice.createAudioResource(stream, {
            inputType: discordVoice.StreamType.Arbitrary,
            inlineVolume: true,
        });
        resource.volume?.setVolume(currentRadioVolume / 100);
        currentRadioStation = station;
        currentRadioServer = server;
        console.log(`Selected station: ${station.name} (id=${station.id}) on server ${server ? server.name : 'configured'}`);
        // clear any previous now-playing updater
        if (nowPlayingInterval) {
            clearInterval(nowPlayingInterval);
            nowPlayingInterval = null;
        }
        voiceConnection.subscribe(radioPlayer);
        radioPlayer.play(resource);

        // Set Discord activity to show station name immediately
        try {
            if (client.user) {
                const stationUrl = getStationWebUrl(station, server);
                if (stationUrl) {
                    await client.user.setActivity(`${station.name}`, { type: ActivityType.Streaming, url: stationUrl });
                    console.log(`Set presence: ${station.name} (STREAMING) -> ${stationUrl}`);
                    try {
                        await client.user.setPresence({ activities: [{ name: station.name, type: ActivityType.Streaming, url: stationUrl }], status: "online" });
                    } catch (e) {}
                            try { await updateNowPlayingPresence(station.name, stationUrl); } catch (e) {}
                } else {
                    await client.user.setActivity(`${station.name}`, { type: ActivityType.Listening });
                    console.log(`Set presence: ${station.name} (LISTENING)`);
                    try {
                        await client.user.setPresence({ activities: [{ name: station.name, type: ActivityType.Listening }], status: "online" });
                    } catch (e) {}
                            try { await updateNowPlayingPresence(station.name, null); } catch (e) {}
                }
            }
        } catch (e) {
            console.warn("Failed to set activity:", e && e.message ? e.message : e);
        }

        // Start periodic now-playing updates if we have a server base URL
        const updateNowPlaying = async () => {
            try {
                if (!currentRadioServer || !currentRadioStation) return;

                const candidates = [
                    `${currentRadioServer.base_url}/api/station/${encodeURIComponent(currentRadioStation.id)}/nowplaying`,
                    `${currentRadioServer.base_url}/api/stations/${encodeURIComponent(currentRadioStation.id)}/nowplaying`,
                    `${currentRadioServer.base_url}/api/nowplaying?station=${encodeURIComponent(currentRadioStation.id)}`,
                    `${currentRadioServer.base_url}/api/nowplaying`,
                ];

                let payload = null;
                let usedUrl = null;
                for (const url of candidates) {
                    try {
                        const res = await fetch(url, { headers: buildAzuraCastHeaders(currentRadioServer.api_key) });
                        if (!res.ok) continue;
                        const json = await res.json();
                        // accept if it has a now_playing block or song info
                        if (json && (json.now_playing || json.song || json.current || json.stations)) {
                            payload = json;
                            usedUrl = url;
                            break;
                        }
                    } catch (e) {
                        // try next candidate
                        continue;
                    }
                }

                if (!payload) return;

                // extract song object with several fallbacks
                let song = payload.now_playing?.song || payload.now_playing?.current?.song || payload.song || payload.current?.song || null;
                if (!song && Array.isArray(payload.stations)) {
                    // some endpoints return stations array with now_playing per station
                    const found = payload.stations.find((s) => String(s.id) === String(currentRadioStation.id) || s.short_name === currentRadioStation.id || s.name === currentRadioStation.name);
                    song = found?.now_playing?.song || null;
                }

                const artist = song?.artist || song?.info?.artist || payload.now_playing?.source?.artist || "";
                const title = song?.title || song?.info?.title || payload.now_playing?.source?.title || "";
                let display = [artist, title].filter(Boolean).join(" - ") || currentRadioStation.name;
                if (display.length > 128) display = display.slice(0, 125) + "...";

                console.log(`NowPlaying update from ${usedUrl || 'unknown'}: ${display}`);

                // try to extract artwork from payload
                let art = song?.art || song?.art_url || song?.image || song?.thumbnail || payload.now_playing?.song?.art || payload.now_playing?.song?.art_url || payload.now_playing?.source?.image || null;
                 console.log(`NowPlaying artwork URL: ${art || 'none'}`);
                // post or edit a now-playing embed in the configured channel (if set)
                if (NOWPLAY_CHANNEL && client.user) {
                    try {
                        const ch = client.channels.cache.get(NOWPLAY_CHANNEL) || client.guilds.cache.get(GUILD_ID)?.channels.cache.get(NOWPLAY_CHANNEL);
                        if (ch && ch.isTextBased && ch.isTextBased()) {
                            const embed = new EmbedBuilder().setTitle(display).setDescription(currentRadioStation.name).setTimestamp();
                            if (art) embed.setThumbnail(art);
                            if (currentRadioServer && currentRadioServer.name) embed.setFooter({ text: currentRadioServer.name });

                            if (nowPlayingMessageId) {
                                try {
                                    const msg = await ch.messages.fetch(nowPlayingMessageId);
                                    await msg.edit({ embeds: [embed] });
                                } catch (e) {
                                    const msg = await ch.send({ embeds: [embed] });
                                    nowPlayingMessageId = msg.id;
                                }
                            } else {
                                const msg = await ch.send({ embeds: [embed] });
                                nowPlayingMessageId = msg.id;
                            }
                        }
                    } catch (e) {
                        // ignore channel errors
                    }
                }

                if (client.user) {
                    const stationUrl = getStationWebUrl(currentRadioStation, currentRadioServer);
                    if (stationUrl) {
                        await client.user.setActivity(display, { type: ActivityType.Streaming, url: stationUrl });
                        console.log(`Updated now-playing presence: ${display} (STREAMING) -> ${stationUrl}`);
                        try {
                            await client.user.setPresence({ activities: [{ name: display, type: ActivityType.Streaming, url: stationUrl }], status: "online" });
                        } catch (e) {}
                            try { await updateNowPlayingPresence(display, stationUrl); } catch (e) {}
                    } else {
                        await client.user.setActivity(display, { type: ActivityType.Listening });
                        console.log(`Updated now-playing presence: ${display} (LISTENING)`);
                        try {
                            await client.user.setPresence({ activities: [{ name: display, type: ActivityType.Listening }], status: "online" });
                        } catch (e) {}
                            try { await updateNowPlayingPresence(display, null); } catch (e) {}
                    }
                }
                // Attempt to update avatar to song art (if enabled). Force update when the song display changes.
                if (ENABLE_SONG_AVATAR && art) {
                    try {
                        console.log(`Avatar diagnostic: ENABLE_SONG_AVATAR=${ENABLE_SONG_AVATAR}, art=${art}, lastAvatarChange=${lastAvatarChange}, cooldownMs=${AVATAR_CHANGE_COOLDOWN_MS}, maxBytes=${MAX_AVATAR_BYTES}`);
                        if (display !== lastNowPlayingDisplay) {
                            console.log(`NowPlaying changed from '${lastNowPlayingDisplay || "(none)"}' to '${display}'. Forcing avatar update.`);
                            await setSongAvatarImmediate(art);
                            lastNowPlayingDisplay = display;
                            lastNowPlayingArt = art;
                        } else if (art && art !== lastNowPlayingArt) {
                            // Song display same but art URL changed — update immediately
                            console.log(`Art URL changed for same display. Forcing avatar update.`);
                            await setSongAvatarImmediate(art);
                            lastNowPlayingArt = art;
                        } else {
                            console.log("No change in song display or art; skipping avatar update.");
                        }
                    } catch (e) {
                        console.warn("setSongAvatarImmediate threw:", e && e.message ? e.message : e);
                    }
                }
            } catch (e) {
                // ignore fetch errors
            }
        };

        // run immediately and then every 30s
        updateNowPlaying();
        nowPlayingInterval = setInterval(updateNowPlaying, 30000);
        return { ok: true, station, server };
    } catch (error) {
        console.error("Failed to start radio stream:", error);
        return { ok: false, message: `I couldn't play ${station.name}. Check the AzuraCast URL or stream permissions.` };
    }
}

async function stopRadio() {
    radioPlayer.stop();
    currentRadioStation = null;
    currentRadioServer = null;
    if (nowPlayingInterval) {
        clearInterval(nowPlayingInterval);
        nowPlayingInterval = null;
    }

    const voiceConnection = discordVoice.getVoiceConnection(GUILD_ID);
    if (voiceConnection) {
        voiceConnection.destroy();
        connection = null;
        connected = false;
    }
    try {
        if (client.user) await client.user.setActivity(null);
    } catch (e) {}
    // restore original avatar if we changed it
    try {
        await restoreOriginalAvatar();
    } catch (e) {}
}

function buildStationsSelectMenu(stations, serverName) {
    const serverLabel = serverName || "selected server";
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`station-select:${serverLabel}`)
        .setPlaceholder(`Select a station from ${serverLabel}`)
        .addOptions(
            stations.slice(0, 25).map((station) => ({
                label: station.name.length > 100 ? `${station.name.slice(0, 97)}...` : station.name,
                value: `${serverLabel}|${station.name}`,
                description: station.id ? `ID: ${station.id}` : undefined,
            }))
        );

    return new ActionRowBuilder().addComponents(selectMenu);
}

function buildServerSelectMenu() {
    const servers = parseAzuraCastServers();
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("server-select")
        .setPlaceholder("Select an AzuraCast server")
        .addOptions(
            servers.map((server) => ({
                label: server.name,
                value: server.name,
                description: server.base_url,
            }))
        );

    return new ActionRowBuilder().addComponents(selectMenu);
}

async function registerSlashCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName("stations")
            .setDescription("Show the AzuraCast stations available to play.")
            .addStringOption((option) =>
                option.setName("server")
                    .setDescription("Which AzuraCast server to pull stations from")
                    .setRequired(false)
                    .setAutocomplete(true)
            ),
        new SlashCommandBuilder()
            .setName("playstation")
            .setDescription("Play a selected AzuraCast station in your voice channel.")
            .addStringOption((option) =>
                option.setName("station")
                    .setDescription("The station name to play")
                    .setRequired(true)
            )
            .addStringOption((option) =>
                option.setName("server")
                    .setDescription("Which AzuraCast server to use")
                    .setRequired(false)
                    .setAutocomplete(true)
            ),
        new SlashCommandBuilder()
            .setName("stopradio")
            .setDescription("Stop the radio stream and leave the voice channel."),
        new SlashCommandBuilder()
            .setName("nowplaying-debug")
            .setDescription("Show current radio station/debug info (admin)."),
        new SlashCommandBuilder()
            .setName("avatar-test")
            .setDescription("(Admin) Test changing bot avatar from an image URL")
            .addStringOption((opt) => opt.setName("url").setDescription("Image URL").setRequired(true)),
        new SlashCommandBuilder()
            .setName("volume")
            .setDescription("Set the radio volume in percent, like 15 for 15%.")
            .addIntegerOption((option) =>
                option.setName("percent")
                    .setDescription("Volume percent from 0 to 100")
                    .setRequired(true)
                    .setMinValue(0)
                    .setMaxValue(100)
            ),
        new SlashCommandBuilder()
            .setName("settings")
            .setDescription("Server settings for InfiniCall bot")
            .addSubcommand((sub) => sub.setName("show").setDescription("Show current guild settings"))
            .addSubcommand((sub) => sub.setName("stay_in_call").setDescription("Keep the bot in the call even if member count is over the configured max").addBooleanOption((opt) => opt.setName("value").setDescription("true to keep in call, false to allow disconnect").setRequired(true)))
            .addSubcommand((sub) => sub.setName("volume").setDescription("Set the default radio volume for this server (applied when joining)").addIntegerOption((opt) => opt.setName("percent").setDescription("Volume percent from 0 to 100").setRequired(true).setMinValue(0).setMaxValue(100))),
    ].map((command) => command.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    const appId = client.user?.id || client.application?.id;
    if (!appId) {
        throw new Error('No application id available for registering commands');
    }

    try {
        const putRes = await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), {
            body: commands,
        });
        console.log(`registerSlashCommands: registration response:`, putRes);

        // fetch back the registered commands to verify
        try {
            const listed = await rest.get(Routes.applicationGuildCommands(appId, GUILD_ID));
            console.log("COMMAND METADATA:");
console.log(
    listed.map(c => ({
        name: c.name,
        id: c.id,
        type: c.type,
        default_member_permissions: c.default_member_permissions,
        dm_permission: c.dm_permission,
        integration_types: c.integration_types,
        contexts: c.contexts
    }))
);
        } catch (e) {
            console.warn("registerSlashCommands: failed to list registered commands:", e && e.message ? e.message : e);
        }
    } catch (e) {
        console.error("registerSlashCommands: failed to register commands:", e && e.message ? e.message : e);
        throw e;
    }
}

async function fetchCurrentNowPlayingText() {
    try {
        if (!currentRadioServer || !currentRadioStation) return null;

        const candidates = [
            `${currentRadioServer.base_url}/api/station/${encodeURIComponent(currentRadioStation.id)}/nowplaying`,
            `${currentRadioServer.base_url}/api/stations/${encodeURIComponent(currentRadioStation.id)}/nowplaying`,
            `${currentRadioServer.base_url}/api/nowplaying?station=${encodeURIComponent(currentRadioStation.id)}`,
            `${currentRadioServer.base_url}/api/nowplaying`,
        ];

        let payload = null;
        for (const url of candidates) {
            try {
                const res = await fetch(url, { headers: buildAzuraCastHeaders(currentRadioServer.api_key) });
                if (!res.ok) continue;
                const json = await res.json();
                if (json && (json.now_playing || json.song || json.current || json.stations)) {
                    payload = json;
                    break;
                }
            } catch (e) {
                continue;
            }
        }

        if (!payload) return null;

        let song = payload.now_playing?.song || payload.now_playing?.current?.song || payload.song || payload.current?.song || null;
        if (!song && Array.isArray(payload.stations)) {
            const found = payload.stations.find((s) => String(s.id) === String(currentRadioStation.id) || s.short_name === currentRadioStation.id || s.name === currentRadioStation.name);
            song = found?.now_playing?.song || null;
        }

        const artist = song?.artist || song?.info?.artist || payload.now_playing?.source?.artist || "";
        const title = song?.title || song?.info?.title || payload.now_playing?.source?.title || "";
        let display = [artist, title].filter(Boolean).join(" - ") || null;
        if (display && display.length > 128) display = display.slice(0, 125) + "...";
        return display;
    } catch (e) {
        return null;
    }
}

async function updateNowPlayingPresence(display, stationUrl) {
    if (!client.user || !display) return;
    const presenceName = display.length > 128 ? display.slice(0, 125) + "..." : display;
    try {
        if (stationUrl) {
            await client.user.setPresence({ activities: [{ name: presenceName, type: ActivityType.Streaming, url: stationUrl }], status: "online" });
        } else {
            await client.user.setPresence({ activities: [{ name: presenceName, type: ActivityType.Listening }], status: "online" });
        }
    } catch (e) {
        console.warn("updateNowPlayingPresence failed:", e && e.message ? e.message : e);
    }
}

function getStationWebUrl(station, server) {
    try {
        if (!station) return null;
        // prefer explicit website fields
        if (station.website) return station.website;
        if (station.page) return station.page;

        // try to derive from stream_url and server base
        if (station.stream_url) {
            try {
                const u = new URL(station.stream_url);
                const host = u.hostname; // e.g. azura.ather1.net
                const pathSegs = u.pathname.split("/").filter(Boolean); // ['listen','atherradio_rock','radio.mp3']
                if (host.startsWith("azura.") && pathSegs.length >= 2 && pathSegs[0] === "listen") {
                    const mount = pathSegs[1];
                    const slug = mount.split("_").pop();
                    const base = host.replace(/^azura\./, "");
                    return `https://${slug}.${base}`;
                }
                // fallback to server base url
            } catch (e) {}
        }

        if (server && server.base_url) return server.base_url;
        return null;
    } catch (e) {
        return null;
    }
}

async function fetchImageBuffer(url, maxBytes = MAX_AVATAR_BYTES) {
    try {
        console.log(`fetchImageBuffer: fetching ${url}`);
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`fetchImageBuffer: non-OK response ${res.status} for ${url}`);
            return null;
        }
        const arrayBuf = await res.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        console.log(`fetchImageBuffer: fetched ${buf.length} bytes from ${url}`);
        if (buf.length > maxBytes) {
            console.warn(`fetchImageBuffer: image too large (${buf.length} > ${maxBytes})`);
            return null;
        }
        return buf;
    } catch (e) {
        console.warn(`fetchImageBuffer: error fetching ${url}:`, e && e.message ? e.message : e);
        return null;
    }
}

// Fetch an image and, if it's larger than maxBytes, attempt to resize it using `sharp` (if available).
async function fetchAndMaybeResize(url, maxBytes = MAX_AVATAR_BYTES) {
    try {
        console.log(`fetchAndMaybeResize: fetching ${url}`);
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`fetchAndMaybeResize: non-OK response ${res.status} for ${url}`);
            return null;
        }
        const arrayBuf = await res.arrayBuffer();
        let buf = Buffer.from(arrayBuf);
        console.log(`fetchAndMaybeResize: fetched ${buf.length} bytes from ${url}`);
        if (buf.length <= maxBytes) return buf;

        // Try resizing with sharp if installed
        let sharpLib;
        try {
            sharpLib = require("sharp");
        } catch (e) {
            console.warn("fetchAndMaybeResize: 'sharp' not installed, cannot resize large image");
            return null;
        }

        // iterative attempts: reduce quality then dimensions
        const dims = [256, 192, 128, 96, 64];
        const qualities = [85, 75, 60, 45, 30];

        for (const dim of dims) {
            for (const q of qualities) {
                try {
                    const out = await sharpLib(buf).resize(dim, dim, { fit: "cover" }).jpeg({ quality: q }).toBuffer();
                    console.log(`fetchAndMaybeResize: resized to ${dim}x${dim} q=${q} => ${out.length} bytes`);
                    if (out.length <= maxBytes) return out;
                    // keep trying
                } catch (e) {
                    console.warn(`fetchAndMaybeResize: sharp resize failed dim=${dim} q=${q}:`, e && e.message ? e.message : e);
                }
            }
        }

        console.warn(`fetchAndMaybeResize: unable to reduce image under ${maxBytes} bytes`);
        return null;
    } catch (e) {
        console.warn(`fetchAndMaybeResize: error fetching ${url}:`, e && e.message ? e.message : e);
        return null;
    }
}

// Fetch raw image bytes without enforcing max size (used for forced avatar updates).
async function fetchRawImageBuffer(url) {
    try {
        console.log(`fetchRawImageBuffer: fetching ${url}`);
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`fetchRawImageBuffer: non-OK response ${res.status} for ${url}`);
            return null;
        }
        const arrayBuf = await res.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        console.log(`fetchRawImageBuffer: fetched ${buf.length} bytes from ${url}`);
        return buf;
    } catch (e) {
        console.warn(`fetchRawImageBuffer: error fetching ${url}:`, e && e.message ? e.message : e);
        return null;
    }
}

// Immediately set the bot avatar from an image URL, ignoring size/cooldown checks.
async function setSongAvatarImmediate(imageUrl) {
    if (!ENABLE_SONG_AVATAR) {
        console.log("setSongAvatarImmediate: feature disabled");
        return false;
    }

    if (!imageUrl) {
        console.log("setSongAvatarImmediate: no imageUrl provided");
        return false;
    }

    if (!client.user) {
        console.log("setSongAvatarImmediate: client.user not ready");
        return false;
    }

    try {
        const buf = await fetchRawImageBuffer(imageUrl);
        if (!buf) {
            console.log("setSongAvatarImmediate: failed to fetch image");
            return false;
        }

        // store original avatar if not stored
        if (!originalAvatarBuffer) {
            try {
                const origUrl = client.user.displayAvatarURL({ format: "png", size: 256 });
                console.log(`setSongAvatarImmediate: fetching original avatar from ${origUrl}`);
                const origBuf = await fetchRawImageBuffer(origUrl);
                if (origBuf) {
                    originalAvatarBuffer = origBuf;
                    console.log(`setSongAvatarImmediate: stored original avatar (${origBuf.length} bytes)`);
                }
            } catch (e) {
                console.warn("setSongAvatarImmediate: failed fetching original avatar:", e && e.message ? e.message : e);
            }
        }

        await client.user.setAvatar(buf);
        lastAvatarChange = Date.now();
        console.log("Changed bot avatar to song art (immediate)");
        return true;
    } catch (e) {
        console.warn("setSongAvatarImmediate: Failed to set song avatar:", e && e.message ? e.message : e);
        return false;
    }
}

async function setSongAvatar(imageUrl) {
    if (!ENABLE_SONG_AVATAR) {
        console.log("setSongAvatar: feature disabled");
        return false;
    }

    if (!imageUrl) {
        console.log("setSongAvatar: no imageUrl provided");
        return false;
    }

    if (!client.user) {
        console.log("setSongAvatar: client.user not ready");
        return false;
    }

    const now = Date.now();
    if (now - lastAvatarChange < AVATAR_CHANGE_COOLDOWN_MS) {
        console.log(`setSongAvatar: cooldown in effect (${now - lastAvatarChange}ms < ${AVATAR_CHANGE_COOLDOWN_MS}ms)`);
        return false;
    }

    console.log(`setSongAvatar: attempting to fetch image ${imageUrl}`);
    const buf = await fetchAndMaybeResize(imageUrl, MAX_AVATAR_BYTES);
    if (!buf) {
        console.log("setSongAvatar: failed to fetch or image rejected");
        return false;
    }

    try {
        // store original avatar if not stored
        if (!originalAvatarBuffer) {
            try {
                const origUrl = client.user.displayAvatarURL({ format: "png", size: 256 });
                console.log(`setSongAvatar: fetching original avatar from ${origUrl}`);
                const origBuf = await fetchAndMaybeResize(origUrl, MAX_AVATAR_BYTES);
                if (origBuf) {
                    originalAvatarBuffer = origBuf;
                    console.log(`setSongAvatar: stored original avatar (${origBuf.length} bytes)`);
                }
            } catch (e) {
                console.warn("setSongAvatar: failed fetching original avatar:", e && e.message ? e.message : e);
            }
        }

        await client.user.setAvatar(buf);
        lastAvatarChange = Date.now();
        console.log("Changed bot avatar to song art");
        return true;
    } catch (e) {
        console.warn("Failed to set song avatar:", e && e.message ? e.message : e);
        return false;
    }
}

async function restoreOriginalAvatar() {
    if (!ENABLE_SONG_AVATAR || !originalAvatarBuffer || !client.user) return false;
    try {
        await client.user.setAvatar(originalAvatarBuffer);
        console.log("Restored original bot avatar");
        return true;
    } catch (e) {
        console.warn("Failed to restore original avatar:", e && e.message ? e.message : e);
        return false;
    }
}

function checkStatus() {
    const guild = client.guilds.cache.get(GUILD_ID);
    const channel = guild?.channels.cache.get(INFINICALL);

    if (!guild || !channel) {
        return;
    }

    const humanCount = getHumanMemberCount(channel);
    const existingConnection = discordVoice.getVoiceConnection(guild.id);

    connected = Boolean(existingConnection);

    if (channel.isVoiceBased()) {
        console.log("Voice Size:" + humanCount);
    }

    console.log("Connected: " + connected);

    if (humanCount <= MAX_CALL_SIZE) {
        if (!existingConnection) {
            connection = discordVoice.joinVoiceChannel({
                channelId: channel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: true,
            });
            connected = true;
        }

        if (disconnectTimeout) {
            clearTimeout(disconnectTimeout);
            disconnectTimeout = null;
        }
    }

    if (humanCount > MAX_CALL_SIZE) {
        // check per-guild override setting
        const keepInCall = getGuildSetting(guild.id, "stayInCall", false);
        if (keepInCall) {
            console.log(`Guild ${guild.id} setting stayInCall=true; will not disconnect even though humanCount=${humanCount}`);
        } else {
            if (disconnectTimeout) {
                clearTimeout(disconnectTimeout);
            }

            if (existingConnection) {
                disconnectTimeout = setTimeout(() => {
                    const latestConnection = discordVoice.getVoiceConnection(guild.id);
                    const latestGuild = client.guilds.cache.get(GUILD_ID);
                    const latestChannel = latestGuild?.channels.cache.get(INFINICALL);
                    const latestHumanCount = latestChannel ? getHumanMemberCount(latestChannel) : 0;

                    if (latestConnection && latestHumanCount > MAX_CALL_SIZE) {
                        connected = false;
                        latestConnection.destroy();
                        console.log("Disconnected from voice channel due to too many members.");
                    }
                    disconnectTimeout = null;
                }, 30000);
            }
        }
    } else if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = null;
    }
}

client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // load persistent settings
    try {
        await loadSettings();
        console.log(`Loaded settings for ${Object.keys(settings).length} guild(s).`);
    } catch (e) {
        console.warn("Failed loading settings:", e && e.message ? e.message : e);
    }

    // capture original avatar (if avatar swap enabled)
    if (ENABLE_SONG_AVATAR) {
        try {
            const url = client.user.displayAvatarURL({ format: "png", size: 256 });
            const buf = await fetchAndMaybeResize(url, MAX_AVATAR_BYTES);
            if (buf) originalAvatarBuffer = buf;
        } catch (e) {
            console.warn("Failed to fetch original avatar:", e && e.message ? e.message : e);
        }
    }

    try {
        await registerSlashCommands();
        console.log("Slash commands registered.");
        console.log(`Client ready: user=${client.user?.tag} id=${client.user?.id} applicationId=${client.application?.id}`);
    } catch (error) {
        console.error("Failed to register slash commands:", error);
    }

    checkStatus();
});

client.on("interactionCreate", async (interaction) => {
    console.log(`Received interaction: type=${interaction.type} command=${interaction.commandName || 'n/a'} user=${interaction.user?.id}`);
    if (interaction.isAutocomplete && interaction.isAutocomplete()) {
        try {
            const focused = interaction.options.getFocused();
            const servers = parseAzuraCastServers().map((s) => s.name || "");
            const filtered = servers
                .filter((name) => name.toLowerCase().includes(String(focused || "").toLowerCase()))
                .slice(0, 25)
                .map((name) => ({ name, value: name }));

            await interaction.respond(filtered);
        } catch (e) {
            await interaction.respond([]);
        }

        return;
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "server-select") {
            const serverName = interaction.values[0];
            const stations = await getAvailableStations(serverName);

            if (!stations.length) {
                await interaction.update({
                    content: `No stations were found on ${serverName}.`,
                    components: [],
                });
                return;
            }

            const stationMenu = buildStationsSelectMenu(stations, serverName);
            await interaction.update({
                content: `Choose a station from ${serverName}:`,
                components: [stationMenu],
            });
            return;
        }

        if (interaction.customId.startsWith("station-select:")) {
            const [serverName, stationName] = interaction.values[0].split("|");
            if (!interaction.member.voice?.channel) {
                await interaction.update({
                    content: "You need to be in a voice channel to play a radio station.",
                    components: [],
                });
                return;
            }

            const result = await playAzuraCastStation(interaction.member.voice.channel, stationName, serverName);

            if (!result.ok) {
                await interaction.update({
                    content: result.message,
                    components: [],
                });
                return;
            }

            await interaction.update({
                content: `Now playing ${result.station.name} from ${result.server ? result.server.name : "the selected server"} in ${interaction.member.voice.channel.name}.`,
                components: [],
            });
            return;
        }
    }

    if (!interaction.isChatInputCommand()) {
        return;
    }

    // settings command
    if (interaction.commandName === "settings") {
        const adminId = process.env.ADMIN_USER_ID;
        const memberIsAdmin = interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
        if (adminId && String(interaction.user.id) !== String(adminId) && !memberIsAdmin) {
            await interaction.reply({ content: "You are not allowed to change server settings.", ephemeral: true });
            return;
        }

        const sub = interaction.options.getSubcommand();
        if (sub === "show") {
            const guildId = interaction.guildId || GUILD_ID;
            const gsettings = settings[guildId] || {};
            await interaction.reply({ content: "Current settings:\n```json\n" + JSON.stringify(gsettings, null, 2) + "\n```", ephemeral: true });
            return;
        }

        if (sub === "stay_in_call") {
            const value = interaction.options.getBoolean("value");
            const guildId = interaction.guildId || GUILD_ID;
            await setGuildSetting(guildId, "stayInCall", Boolean(value));
            await interaction.reply({ content: `Updated stayInCall=${value} for this guild.`, ephemeral: true });
            return;
        }

        if (sub === "volume") {
            const percent = interaction.options.getInteger("percent");
            const guildId = interaction.guildId || GUILD_ID;
            const safe = clampVolumePercent(percent);
            await setGuildSetting(guildId, "defaultVolume", safe);
            await interaction.reply({ content: `Updated defaultVolume=${safe}% for this guild. This will be applied when the bot joins or next station is played.`, ephemeral: true });
            return;
        }
    }

    if (interaction.commandName === "stations") {
        const serverName = interaction.options.getString("server");
        const servers = parseAzuraCastServers();

        if (servers.length > 1 && !serverName) {
            await interaction.reply({
                content: "Choose an AzuraCast server:",
                components: [buildServerSelectMenu()],
                ephemeral: true,
            });
            return;
        }

        const effectiveServerName = serverName || (servers.length === 1 ? servers[0].name : null);
        const stationServer = getAzuraCastServer(effectiveServerName);
        const stations = await getAvailableStations(effectiveServerName);

        if (!stations.length) {
            await interaction.reply({ content: `No AzuraCast stations are configured or reachable right now on ${stationServer ? stationServer.name : "the selected server"}.`, ephemeral: true });
            return;
        }

        await interaction.reply({
            content: `Choose a station from ${stationServer ? stationServer.name : "the selected server"}:`,
            components: [buildStationsSelectMenu(stations, effectiveServerName || (stationServer ? stationServer.name : "Selected server"))],
            ephemeral: true,
        });
        return;
    }

    if (interaction.commandName === "playstation") {
        const stationName = interaction.options.getString("station");
        const serverName = interaction.options.getString("server");

        if (!interaction.member.voice?.channel) {
            await interaction.reply({ content: "You need to be in a voice channel to use this command.", ephemeral: true });
            return;
        }

        const servers = parseAzuraCastServers();
        if (servers.length > 1 && !serverName) {
            await interaction.reply({
                content: "Choose an AzuraCast server to play from:",
                components: [buildServerSelectMenu()],
                ephemeral: true,
            });
            return;
        }

        const result = await playAzuraCastStation(interaction.member.voice.channel, stationName, serverName);

        if (!result.ok) {
            await interaction.reply({ content: result.message, ephemeral: true });
            return;
        }

        const serverLabel = result.server ? result.server.name : "configured server";
        await interaction.reply({ content: `Now playing ${result.station.name} from ${serverLabel} in ${interaction.member.voice.channel.name}.` });
        return;
    }

    if (interaction.commandName === "nowplaying-debug") {
        const now = await fetchCurrentNowPlayingText();
        const info = {
            currentRadioStation: currentRadioStation ? { id: currentRadioStation.id, name: currentRadioStation.name, stream_url: currentRadioStation.stream_url } : null,
            currentRadioServer: currentRadioServer ? { name: currentRadioServer.name, base_url: currentRadioServer.base_url } : null,
            nowPlaying: now,
            nowPlayingInterval: Boolean(nowPlayingInterval),
        };
        await interaction.reply({ content: "```json\n" + JSON.stringify(info, null, 2) + "\n```", ephemeral: true });
        return;
    }

    if (interaction.commandName === "avatar-test") {
        const adminId = process.env.ADMIN_USER_ID;
        if (adminId && String(interaction.user.id) !== String(adminId)) {
            await interaction.reply({ content: "You are not allowed to run this command.", ephemeral: true });
            return;
        }

        const url = interaction.options.getString("url");
        await interaction.deferReply({ ephemeral: true });
        const buf = await fetchImageBuffer(url);
        if (!buf) {
            await interaction.editReply({ content: "Failed to fetch image or image too large." });
            return;
        }

        try {
            await client.user.setAvatar(buf);
            lastAvatarChange = Date.now();
            await interaction.editReply({ content: "Avatar updated successfully." });
        } catch (e) {
            await interaction.editReply({ content: `Failed to set avatar: ${e && e.message ? e.message : e}` });
        }

        return;
    }

    if (interaction.commandName === "volume") {
        const percent = interaction.options.getInteger("percent");
        const finalVolume = setRadioVolume(percent);
        await interaction.reply({ content: `Radio volume set to ${finalVolume}%`, ephemeral: true });
        return;
    }

    if (interaction.commandName === "stopradio") {
        await stopRadio();
        await interaction.reply({ content: "The radio stream has been stopped." });
    }
});

client.on("voiceStateUpdate", (oldState, newState) => {
    if (oldState.channelId !== newState.channelId) {
        checkStatus();
    }

    if (newState.channelId === INFINICALL && oldState.channelId !== INFINICALL && !newState.member.user.bot) {
        announceJoin(newState.guild, newState.member);
    }
});

process.on("SIGINT", () => {
    console.log("Received SIGINT. Disconnecting from voice channel...");
    if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
    }
    if (connection) {
        connection.destroy();
    }
    process.exit();
});

client.login(process.env.TOKEN);