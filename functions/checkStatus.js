
function checkStatus() {
    const guild = client.guilds.cache.get(GUILD_ID);
    const channel = guild?.channels.cache.get(INFINICALL);

    if (!guild || !channel) {
        return;
    }

    const humanCount = getHumanMemberCount(channel);
    const existingConnection = discordVoice.getVoiceConnection(guild.id);

    connected = Boolean(existingConnection);

    if (channel.isVoiceBased()) {
        console.log("Voice Size:" + humanCount);
    }

    console.log("Connected: " + connected);

    if (humanCount <= MAX_CALL_SIZE) {
        if (!existingConnection) {
            connection = discordVoice.joinVoiceChannel({
                channelId: channel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: true,
            });
            connected = true;
        }

        if (disconnectTimeout) {
            clearTimeout(disconnectTimeout);
            disconnectTimeout = null;
        }
    }

    if (humanCount > MAX_CALL_SIZE) {
        // check per-guild override setting
        const keepInCall = getGuildSetting(guild.id, "stayInCall", false);
        if (keepInCall) {
            console.log(`Guild ${guild.id} setting stayInCall=true; will not disconnect even though humanCount=${humanCount}`);
        } else {
            if (disconnectTimeout) {
                clearTimeout(disconnectTimeout);
            }

            if (existingConnection) {
                disconnectTimeout = setTimeout(() => {
                    const latestConnection = discordVoice.getVoiceConnection(guild.id);
                    const latestGuild = client.guilds.cache.get(GUILD_ID);
                    const latestChannel = latestGuild?.channels.cache.get(INFINICALL);
                    const latestHumanCount = latestChannel ? getHumanMemberCount(latestChannel) : 0;

                    if (latestConnection && latestHumanCount > MAX_CALL_SIZE) {
                        connected = false;
                        latestConnection.destroy();
                        console.log("Disconnected from voice channel due to too many members.");
                    }
                    disconnectTimeout = null;
                }, 30000);
            }
        }
    } else if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = null;
    }
}
