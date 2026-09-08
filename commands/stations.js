const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, MessageFlags } = require("discord.js");

const { parseAzuraCastServers, getAzuraCastServer, getAvailableStations } = require("../utils/azura");

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

const customIdsRegex = [
    /^station-select:.*/,
    /^server-select$/
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName("stations")
        .setDescription("Show the AzuraCast stations available to play.")
        .addStringOption((option) => option
            .setName("server")
            .setDescription("Which AzuraCast server to pull stations from")
            .setRequired(false)
            .setAutocomplete(true)),

    customIdsRegex,

    async execute(interaction) {
        const serverName = interaction.options.getString("server");
        const servers = parseAzuraCastServers();

        if (servers.length > 1 && !serverName) {
            await interaction.reply({
                content: "Choose an AzuraCast server:",
                components: [buildServerSelectMenu()],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const effectiveServerName = serverName || (servers.length === 1 ? servers[0].name : null);
        const stationServer = getAzuraCastServer(effectiveServerName);
        const stations = await getAvailableStations(effectiveServerName);

        if (!stations.length) {
            await interaction.reply({
                content: `No AzuraCast stations are configured or reachable right now on ${stationServer ? stationServer.name : "the selected server"}.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.reply({
            content: `Choose a station from ${stationServer ? stationServer.name : "the selected server"}:`,
            components: [buildStationsSelectMenu(stations, effectiveServerName || (stationServer ? stationServer.name : "Selected server"))],
            flags: MessageFlags.Ephemeral
        });
    },

    async handleSelectMenu(interaction) {
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
            const [serverLabel, stationName] = interaction.values[0].split("|");
            await interaction.update({
                content: `You selected the station "${stationName}" from ${serverLabel}.`,
                components: [],
            });
            return;
        }
    }
};
