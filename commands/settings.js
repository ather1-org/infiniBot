const { ChannelType, PermissionFlagsBits, SlashCommandBuilder, MessageFlags } = require("discord.js");
const { Settings } = require("../utils/db/index.js");

function clampVolumePercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 60;
    }

    return Math.min(100, Math.max(0, numeric));
}

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
                .setMaxValue(100)))
        .addSubcommand((sub) => sub
            .setName("limit")
            .setDescription("Set the max number of users in a call before the bot leaves (0 = no limit)")
            .addIntegerOption((option) => option
                .setName("limit")
                .setDescription("Max number of users in call before bot leaves (0 = no limit)")
                .setRequired(true)
                .setMinValue(0)))
        .addSubcommand((sub) => sub
            .setName("channel")
            .setDescription("Select a voice channel accessible to the bot")
            .addChannelOption((option) => option
                .setName("channel")
                .setDescription("Voice channel")
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
                .setRequired(true))),

    async execute(interaction, { caller }) {
        const adminId = process.env.ADMIN_USER_ID;
        const memberIsAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
        if (adminId && String(interaction.user.id) !== String(adminId) && !memberIsAdmin) {
            await interaction.reply({ content: "You are not allowed to change server settings.", flags: MessageFlags.Ephemeral });
            return;
        }

        const settings = new Settings(interaction.guildId);

        const subcommand = interaction.options.getSubcommand();
        if (subcommand === "show") {
            const allSettings = await settings.getAll();
            let content = "Current guild settings:\n";
            for (const [key, value] of Object.entries(allSettings)) {
                content += `- ${key}: ${value}\n`;
            }
            await interaction.reply({
                content: content,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (subcommand === "stay_in_call") {
            const value = interaction.options.getBoolean("value");
            const lastChannelId = await settings.get("infinicall_id");
            const activeCaller = lastChannelId ? caller.getCall({ id: lastChannelId }) : null;
            await settings.set("infinicall_stay", Boolean(value));
            await interaction.reply({ content: `Updated infinicall_stay=${value} for this guild.`, flags: MessageFlags.Ephemeral });
            caller.updateCall(activeCaller.channel, { stayInCall: Boolean(value) });
            return;
        }

        if (subcommand === "volume") {
            const percent = interaction.options.getInteger("percent");
            const safe = clampVolumePercent(percent);
            await settings.set("radio_volume", safe);
            await interaction.reply({
                content: `Updated radio_volume=${safe}% for this guild. This will be applied when the bot joins or next station is played.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        if (subcommand === "limit") {
            const limit = interaction.options.getInteger("limit");
            if (limit === null || limit < 0) {
                await interaction.reply({ content: "Limit must be 0 or greater.", flags: MessageFlags.Ephemeral });
                return;
            }
            const lastChannelId = await settings.get("infinicall_id");
            const activeCaller = lastChannelId ? caller.getCall({ id: lastChannelId }) : null;
            await settings.set("infinicall_limit", limit);
            await interaction.reply({ content: `Updated infinicall_limit=${limit} for this guild.`, flags: MessageFlags.Ephemeral });

            caller.updateCall(activeCaller.channel, { limit });
        }

        if (subcommand === "channel") {
            const channel = interaction.options.getChannel("channel");
            if (!channel || !channel.isVoiceBased() || channel.isDMBased()) {
                await interaction.reply({ content: "Channel is not a valid voice channel", flags: MessageFlags.Ephemeral });
                return;
            }

            const lastChannelId = await settings.get("infinicall_id");
            const lastCaller = lastChannelId ? caller.getCall({ id: lastChannelId }) : null;
            if (lastCaller) {
                caller.removeCall(lastCaller.channel);
            }

            await settings.set("infinicall_id", channel.id);
            await interaction.reply({ content: `InifiniCall is set to <#${channel.id}> for this guild.`, flags: MessageFlags.Ephemeral });

            // suspend the current caller, and create a new one

            caller.addCall(channel, 0, false);
        }
    }
};
