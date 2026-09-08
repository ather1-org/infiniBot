const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("settings")
        .setDescription("Server settings for InfiniCall bot")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sub) => sub
            .setName("show")
            .setDescription("Show current guild settings"))
        .addSubcommand((sub) => sub
            .setName("stay_in_call")
            .setDescription("Keep the bot in the call even if member count is over the configured max")
            .addBooleanOption((option) => option
                .setName("value")
                .setDescription("true to keep in call, false to allow disconnect")
                .setRequired(true)))
        .addSubcommand((sub) => sub
            .setName("volume")
            .setDescription("Set the default radio volume for this server (applied when joining)")
            .addIntegerOption((option) => option
                .setName("percent")
                .setDescription("Volume percent from 0 to 100")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100))),

    async execute(interaction, { settings, setGuildSetting, clampVolumePercent, guildId }) {
        const adminId = process.env.ADMIN_USER_ID;
        const memberIsAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
        if (adminId && String(interaction.user.id) !== String(adminId) && !memberIsAdmin) {
            await interaction.reply({ content: "You are not allowed to change server settings.", ephemeral: true });
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        const currentGuildId = interaction.guildId || guildId;

        if (subcommand === "show") {
            await interaction.reply({
                content: "Current settings:\n```json\n" + JSON.stringify(settings[currentGuildId] || {}, null, 2) + "\n```",
                ephemeral: true,
            });
            return;
        }

        if (subcommand === "stay_in_call") {
            const value = interaction.options.getBoolean("value");
            await setGuildSetting(currentGuildId, "stayInCall", Boolean(value));
            await interaction.reply({ content: `Updated stayInCall=${value} for this guild.`, ephemeral: true });
            return;
        }

        if (subcommand === "volume") {
            const percent = interaction.options.getInteger("percent");
            const safe = clampVolumePercent(percent);
            await setGuildSetting(currentGuildId, "defaultVolume", safe);
            await interaction.reply({
                content: `Updated defaultVolume=${safe}% for this guild. This will be applied when the bot joins or next station is played.`,
                ephemeral: true,
            });
        }
    },
};
