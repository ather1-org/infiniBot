const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("nowplaying-debug")
        .setDescription("Show current radio station/debug info (admin)."),

    async execute(interaction, { currentRadioStation, currentRadioServer, nowPlayingInterval, fetchCurrentNowPlayingText }) {
        const now = await fetchCurrentNowPlayingText();
        const info = {
            currentRadioStation: currentRadioStation ? {
                id: currentRadioStation.id,
                name: currentRadioStation.name,
                stream_url: currentRadioStation.stream_url,
            } : null,
            currentRadioServer: currentRadioServer ? {
                name: currentRadioServer.name,
                base_url: currentRadioServer.base_url,
            } : null,
            nowPlaying: now,
            nowPlayingInterval: Boolean(nowPlayingInterval),
        };

        await interaction.reply({
            content: "```json\n" + JSON.stringify(info, null, 2) + "\n```",
            ephemeral: true,
        });
    },
};
