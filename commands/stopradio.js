const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("stopradio")
        .setDescription("Stop the radio stream and leave the voice channel."),

    async execute(interaction, { stopRadio }) {
        await stopRadio();
        await interaction.reply({ content: "The radio stream has been stopped." });
    },
};
