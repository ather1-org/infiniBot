module.exports = async (interaction) => {
    console.log(`Received interaction: type=${interaction.type} command=${interaction.commandName || 'n/a'} user=${interaction.user?.id}`);
    if (interaction.isAutocomplete && interaction.isAutocomplete()) {
        try {
            const focused = interaction.options.getFocused();
            const servers = parseAzuraCastServers().map((s) => s.name || "");
            const filtered = servers
                .filter((name) => name.toLowerCase().includes(String(focused || "").toLowerCase()))
                .slice(0, 25)
                .map((name) => ({ name, value: name }));

            await interaction.respond(filtered);
        } catch (e) {
            await interaction.respond([]);
        }

        return;
    }

    if (interaction.isStringSelectMenu()) {
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
            const [serverName, stationName] = interaction.values[0].split("|");
            if (!interaction.member.voice?.channel) {
                await interaction.update({
                    content: "You need to be in a voice channel to play a radio station.",
                    components: [],
                });
                return;
            }

            const result = await playAzuraCastStation(interaction.member.voice.channel, stationName, serverName);

            if (!result.ok) {
                await interaction.update({
                    content: result.message,
                    components: [],
                });
                return;
            }

            await interaction.update({
                content: `Now playing ${result.station.name} from ${result.server ? result.server.name : "the selected server"} in ${interaction.member.voice.channel.name}.`,
                components: [],
            });
            return;
        }
    }

    if (!interaction.isChatInputCommand()) {
        return;
    }

    // settings command
    if (interaction.commandName === "settings") {
        const adminId = process.env.ADMIN_USER_ID;
        const memberIsAdmin = interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
        if (adminId && String(interaction.user.id) !== String(adminId) && !memberIsAdmin) {
            await interaction.reply({ content: "You are not allowed to change server settings.", ephemeral: true });
            return;
        }

        const sub = interaction.options.getSubcommand();
        if (sub === "show") {
            const guildId = interaction.guildId || GUILD_ID;
            const gsettings = settings[guildId] || {};
            await interaction.reply({ content: "Current settings:\n```json\n" + JSON.stringify(gsettings, null, 2) + "\n```", ephemeral: true });
            return;
        }

        if (sub === "stay_in_call") {
            const value = interaction.options.getBoolean("value");
            const guildId = interaction.guildId || GUILD_ID;
            await setGuildSetting(guildId, "stayInCall", Boolean(value));
            await interaction.reply({ content: `Updated stayInCall=${value} for this guild.`, ephemeral: true });
            return;
        }

        if (sub === "volume") {
            const percent = interaction.options.getInteger("percent");
            const guildId = interaction.guildId || GUILD_ID;
            const safe = clampVolumePercent(percent);
            await setGuildSetting(guildId, "defaultVolume", safe);
            await interaction.reply({ content: `Updated defaultVolume=${safe}% for this guild. This will be applied when the bot joins or next station is played.`, ephemeral: true });
            return;
        }
    }

    if (interaction.commandName === "stations") {
        const serverName = interaction.options.getString("server");
        const servers = parseAzuraCastServers();

        if (servers.length > 1 && !serverName) {
            await interaction.reply({
                content: "Choose an AzuraCast server:",
                components: [buildServerSelectMenu()],
                ephemeral: true,
            });
            return;
        }

        const effectiveServerName = serverName || (servers.length === 1 ? servers[0].name : null);
        const stationServer = getAzuraCastServer(effectiveServerName);
        const stations = await getAvailableStations(effectiveServerName);

        if (!stations.length) {
            await interaction.reply({ content: `No AzuraCast stations are configured or reachable right now on ${stationServer ? stationServer.name : "the selected server"}.`, ephemeral: true });
            return;
        }

        await interaction.reply({
            content: `Choose a station from ${stationServer ? stationServer.name : "the selected server"}:`,
            components: [buildStationsSelectMenu(stations, effectiveServerName || (stationServer ? stationServer.name : "Selected server"))],
            ephemeral: true,
        });
        return;
    }

    if (interaction.commandName === "playstation") {
        const stationName = interaction.options.getString("station");
        const serverName = interaction.options.getString("server");

        if (!interaction.member.voice?.channel) {
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

        const result = await playAzuraCastStation(interaction.member.voice.channel, stationName, serverName);

        if (!result.ok) {
            await interaction.reply({ content: result.message, ephemeral: true });
            return;
        }

        const serverLabel = result.server ? result.server.name : "configured server";
        await interaction.reply({ content: `Now playing ${result.station.name} from ${serverLabel} in ${interaction.member.voice.channel.name}.` });
        return;
    }

    if (interaction.commandName === "nowplaying-debug") {
        const now = await fetchCurrentNowPlayingText();
        const info = {
            currentRadioStation: currentRadioStation ? { id: currentRadioStation.id, name: currentRadioStation.name, stream_url: currentRadioStation.stream_url } : null,
            currentRadioServer: currentRadioServer ? { name: currentRadioServer.name, base_url: currentRadioServer.base_url } : null,
            nowPlaying: now,
            nowPlayingInterval: Boolean(nowPlayingInterval),
        };
        await interaction.reply({ content: "```json\n" + JSON.stringify(info, null, 2) + "\n```", ephemeral: true });
        return;
    }

    if (interaction.commandName === "avatar-test") {
        const adminId = process.env.ADMIN_USER_ID;
        if (adminId && String(interaction.user.id) !== String(adminId)) {
            await interaction.reply({ content: "You are not allowed to run this command.", ephemeral: true });
            return;
        }

        const url = interaction.options.getString("url");
        await interaction.deferReply({ ephemeral: true });
        const buf = await fetchImageBuffer(url);
        if (!buf) {
            await interaction.editReply({ content: "Failed to fetch image or image too large." });
            return;
        }

        try {
            await client.user.setAvatar(buf);
            lastAvatarChange = Date.now();
            await interaction.editReply({ content: "Avatar updated successfully." });
        } catch (e) {
            await interaction.editReply({ content: `Failed to set avatar: ${e && e.message ? e.message : e}` });
        }

        return;
    }

    if (interaction.commandName === "volume") {
        const percent = interaction.options.getInteger("percent");
        const finalVolume = setRadioVolume(percent);
        await interaction.reply({ content: `Radio volume set to ${finalVolume}%`, ephemeral: true });
        return;
    }

    if (interaction.commandName === "stopradio") {
        await stopRadio();
        await interaction.reply({ content: "The radio stream has been stopped." });
    }
}