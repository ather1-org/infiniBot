const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("avatar-test")
        .setDescription("(Admin) Test changing bot avatar from an image URL")
        .addStringOption((option) => option
            .setName("url")
            .setDescription("Image URL")
            .setRequired(true)),

    access: {
        users: process.env.ADMIN_USER_ID ? [process.env.ADMIN_USER_ID] : [],
    },

    async execute(interaction, { client, fetchImageBuffer, setLastAvatarChange }) {
        const url = interaction.options.getString("url");
        await interaction.deferReply({ ephemeral: true });
        const buffer = await fetchImageBuffer(url);

        if (!buffer) {
            await interaction.editReply({ content: "Failed to fetch image or image too large." });
            return;
        }

        try {
            await client.user.setAvatar(buffer);
            setLastAvatarChange(Date.now());
            await interaction.editReply({ content: "Avatar updated successfully." });
        } catch (error) {
            await interaction.editReply({ content: `Failed to set avatar: ${error?.message || error}` });
        }
    },
};
