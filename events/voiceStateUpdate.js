
async function announceJoin(guild, member) {
    const voiceConnection = discordVoice.getVoiceConnection(guild.id) || connection;

    if (!voiceConnection) {
        return;
    }

    try {
        const audioFile = await createAnnouncementAudio(`${member.displayName} joined the call`);
        if (!audioFile) {
            // TTS not available or failed; just skip the announcement
            return;
        }

        // If a radio is currently playing, try to mix the announcement with the live stream using ffmpeg so music continues.
        const channel = guild.channels.cache.get(INFINICALL);
        const station = currentRadioStation;

        const playedMixed = station && commandExistsSync("ffmpeg") && (await (async () => {
            try {
                // spawn ffmpeg to mix live stream and announcement file
                const spawn = require("child_process").spawn;
                const ff = spawn("ffmpeg", [
                    "-i", station.stream_url,
                    "-i", audioFile,
                    "-filter_complex", "amix=inputs=2:duration=shortest:dropout_transition=0",
                    "-f", "wav",
                    "pipe:1",
                ], { windowsHide: true });

                ff.once("error", (err) => console.warn("ffmpeg spawn error:", err && err.message ? err.message : err));

                const resource = discordVoice.createAudioResource(ff.stdout, {
                    inputType: discordVoice.StreamType.Arbitrary,
                    inlineVolume: true,
                });
                resource.volume?.setVolume(currentRadioVolume / 100);

                voiceConnection.subscribe(radioPlayer);
                radioPlayer.play(resource);

                // When mixed playback ends, restart normal radio playback
                const onIdle = async () => {
                    radioPlayer.removeListener("idle", onIdle);
                    try {
                        if (channel && station) {
                            await playAzuraCastStation(channel, station.name);
                        }
                    } catch (e) {
                        console.warn("Failed to resume radio after announcement:", e && e.message ? e.message : e);
                    }
                };

                radioPlayer.on("idle", onIdle);

                return true;
            } catch (e) {
                return false;
            }
        })());

        if (playedMixed) {
            // mixed and played successfully
            activeAnnouncementFile = audioFile;
            return;
        }

        // Fallback: play announcement alone (will temporarily replace the subscription)
        voiceConnection.subscribe(announcementPlayer);
        activeAnnouncementFile = audioFile;
        const audioResource = discordVoice.createAudioResource(fs.createReadStream(audioFile));
        const wasPlaying = radioPlayer.state.status === "playing";

        announcementPlayer.play(audioResource);

        if (wasPlaying && currentRadioStation) {
            announcementPlayer.once("idle", async () => {
                try {
                    const channel = guild.channels.cache.get(INFINICALL);
                    if (channel) await playAzuraCastStation(channel, currentRadioStation.name);
                } catch (e) {
                    console.warn("Failed to resume radio after announcement:", e && e.message ? e.message : e);
                }
            });
        }
    } catch (error) {
        console.error("Failed to create voice announcement:", error);
    }
}

module.exports = (oldState, newState) => {
    if (oldState.channelId !== newState.channelId) {
        checkStatus();
    }

    if (newState.channelId === INFINICALL && oldState.channelId !== INFINICALL && !newState.member.user.bot) {
        announceJoin(newState.guild, newState.member);
    }
}   