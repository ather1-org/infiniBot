const { SlashCommandBuilder } = require("discord.js");
const { azuracastAvailable } = require("../utils/azura");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("stopradio")
        .setDescription("Stop the radio stream and leave the voice channel."),

    disabled: !azuracastAvailable(),

    async execute(interaction, { stopRadio }) {
        await stopRadio();
        await interaction.reply({ content: "The radio stream has been stopped." });
    },
};
