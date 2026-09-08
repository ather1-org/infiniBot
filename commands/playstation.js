const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("playstation")
        .setDescription("Play a selected AzuraCast station in your voice channel.")
        .addStringOption((option) => option
            .setName("station")
            .setDescription("The station name to play")
            .setRequired(true))
        .addStringOption((option) => option
            .setName("server")
            .setDescription("Which AzuraCast server to use")
            .setRequired(false)
            .setAutocomplete(true)),

    async execute(interaction, { parseAzuraCastServers, buildServerSelectMenu, playAzuraCastStation }) {
        const stationName = interaction.options.getString("station");
        const serverName = interaction.options.getString("server");
        const voiceChannel = interaction.member.voice?.channel;

        if (!voiceChannel) {
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

        const result = await playAzuraCastStation(voiceChannel, stationName, serverName);
        if (!result.ok) {
            await interaction.reply({ content: result.message, ephemeral: true });
            return;
        }

        const serverLabel = result.server ? result.server.name : "configured server";
        await interaction.reply({
            content: `Now playing ${result.station.name} from ${serverLabel} in ${voiceChannel.name}.`,
        });
    },
};
