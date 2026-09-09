const { SlashCommandBuilder } = require("discord.js");
const { azuracastAvailable } = require("../utils/azura");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("volume")
        .setDescription("Set the radio volume in percent, like 15 for 15%.")
        .addIntegerOption((option) => option
            .setName("percent")
            .setDescription("Volume percent from 0 to 100")
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(100)),

    disabled: !azuracastAvailable(),

    async execute(interaction, { setRadioVolume }) {
        const percent = interaction.options.getInteger("percent");
        const finalVolume = setRadioVolume(percent);
        await interaction.reply({ content: `Radio volume set to ${finalVolume}%`, ephemeral: true });
    },
};
