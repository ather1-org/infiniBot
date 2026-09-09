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

function parseAzuraCastServers() {
    const servers = [];
    const indexes = new Set();

    // Find all numbered AZURACAST_N_* configurations.
    for (const key of Object.keys(process.env)) {
        const match = key.match(/^AZURACAST_(\d+)_/);

        if (match) {
            indexes.add(Number(match[1]));
        }
    }

    // Parse numbered servers.
    for (const i of [...indexes].sort((a, b) => a - b)) {
        const prefix = `AZURACAST_${i}_`;

        const server = normalizeAzuraCastServer({
            name: process.env[`${prefix}SERVER_NAME`] || `Server ${i}`,
            base_url: process.env[`${prefix}BASE_URL`] || "",
            api_key: process.env[`${prefix}API_KEY`] || "",
        });

        if (server) {
            servers.push(server);
        }
    }

    // Parse unnumbered server.
    // This works whether it's the only server or alongside numbered servers.
    const baseUrl = (process.env.AZURACAST_BASE_URL || "")
        .trim()
        .replace(/\/+$/, "");

    if (baseUrl) {
        const server = normalizeAzuraCastServer({
            name: process.env.AZURACAST_SERVER_NAME || "Primary",
            base_url: baseUrl,
            api_key: process.env.AZURACAST_API_KEY || "",
        });

        if (server) {
            servers.push(server);
        }
    }

    return servers;
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


async function getAvailableStations(serverName) {
    const configuredStations = parseConfiguredStations();
    if (configuredStations.length) {
        return configuredStations.map((station) => normalizeStation(station)).filter(Boolean);
    }

    const server = getAzuraCastServer(serverName);
    return fetchAzuraCastStations(server);
}

const { getSetting, setSetting } = require("./db");

function selectStation(id) {
    return setSetting("global", "selected_station_id", id);
}

function getSelectedStation() {
    return getSetting("global", "selected_station_id");
}


module.exports = {
    normalizeAzuraCastServer,
    parseAzuraCastServers,
    getAzuraCastServer,
    fetchAzuraCastStations,
    parseConfiguredStations,
    normalizeStation,
    getAvailableStations,

    selectStation,
    getSelectedStation,
};
