const Settings = require("../utils/db").Settings;

const {
    VoiceConnectionStatus,
    getVoiceConnection,
    joinVoiceChannel,
} = require("@discordjs/voice");


function getHumanMemberCount(channel) {
    if (!channel || !channel.members) {
        return 0;
    }

    const userCount = channel.members.filter((member) => !member.user.bot).size;
    return userCount;
}

class CallHandler {
    constructor(client) {
        this.calls = new Map();
        this.reconcileTimers = new Map();
        this.client = client;

        this.client.on("voiceStateUpdate", (oldState, newState) => {
            // check if this update is relevant to any of the calls we are tracking
            const oldChannelId = oldState.channelId;
            const newChannelId = newState.channelId;
            console.log("VoiceState:", oldChannelId, newChannelId);
            // if either has 1427083874776776775, then we need to update the call state
            if (oldChannelId && this.calls.has(oldChannelId) && oldState.channel) {
                this._updateEvent(oldState.channel);
            }
            if (newChannelId && this.calls.has(newChannelId) && newState.channel) {
                this._updateEvent(newState.channel);
            }
            // this._updateEvent(oldState.channel);
            // this._updateEvent(newState.channel);
        });
    }


    // limit: number of users in call before leaving, 0 = no limit
    // when a radio is present, the bot will not leave call even if the limit is reached, unless the radio is stopped
    // if limit is 5, and theres 5 users in the call, the bot will leave when the 6th user joins after 30 seconds to prevent debouncing
    // if limit is 0, the bot will never leave the call
    // stayInCall: if true, the bot will stay in the call even if the limit is reached

    /** @param {import("discord.js").Channel} channel */
    addCall(channel, { limit = 3, radioPlaying = false, stayInCall = false } = {}) {
        if (!channel || !channel.isVoiceBased() || channel.isDMBased()) {
            throw new Error("Channel is not a valid voice channel");
        }
        new Settings(channel.guild.id);
        if (!channel) {
            throw new Error("Channel is required to add a call");
        }

        if (this.calls.has(channel.id)) {
            throw new Error("Call already exists for this channel, use updateCall to change call settings");
        }
        // check if channel is a voice channel
        if (!channel || !channel.isVoiceBased()) {
            throw new Error("Channel is not a voice channel");
        }

        const userCount = getHumanMemberCount(channel);

        this.calls.set(channel.id, {
            channel,
            limit: limit,
            userCount: userCount,
            stayInCall: stayInCall,
            radioPlaying: radioPlaying,
            connection: null,
        });

        this.eventUpdate(channel);
    }

    /** @param {import("discord.js").Channel} channel */
    removeCall(channel) {
        const timer = this.reconcileTimers.get(channel.id);
        if (timer) {
            clearTimeout(timer);
            this.reconcileTimers.delete(channel.id);
        }
        this.calls.delete(channel.id);
    }

    /** @param {import("discord.js").Channel} channel */
    getCall(channel) {
        return this.calls.get(channel.id);
    }

    /** @param {import("discord.js").Channel} channel */
    updateCall(channel, { limit, radioPlaying, stayInCall }) {
        if (!this.calls.has(channel.id)) {
            throw new Error("Call does not exist for this channel, use addCall to create a call");
        }

        const call = this.calls.get(channel.id);
        if (limit !== undefined) {
            call.limit = limit;
        }

        if (radioPlaying !== undefined) {
            call.radioPlaying = radioPlaying;
        }

        if (stayInCall !== undefined) {
            call.stayInCall = stayInCall;
        }

        // run an update
        this.eventUpdate(channel);
    }

    _scheduleReconcile(call) {
        if (this.reconcileTimers.has(call.channel.id)) {
            return;
        }

        const timer = setTimeout(() => {
            this.reconcileTimers.delete(call.channel.id);
            this.eventUpdate(call.channel);
        }, 0);
        this.reconcileTimers.set(call.channel.id, timer);
    }

    _join(call) {
        const voiceChannel = call.channel;
        const existingConnection = getVoiceConnection(voiceChannel.guild.id);
        const activeStates = [
            VoiceConnectionStatus.Connecting,
            VoiceConnectionStatus.Signalling,
            VoiceConnectionStatus.Ready,
        ];

        if (existingConnection
            && existingConnection.joinConfig.channelId === voiceChannel.id
            && activeStates.includes(existingConnection.state.status)) {
            call.connection = existingConnection;
            return;
        }

        if (existingConnection) {
            call.rejoining = true;
            existingConnection.destroy();
        }

        console.log(`Call in channel ${voiceChannel.name} is at or below the limit of ${call.limit} members. Joining call.`);
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });
        call.rejoining = false;
        call.connection = connection;
        connection.on("stateChange", (_oldState, newState) => {
            if (call.connection !== connection && newState.status === VoiceConnectionStatus.Destroyed) {
                return;
            }

            if (newState.status === VoiceConnectionStatus.Destroyed) {
                call.connection = null;
                if (call.rejoining) {
                    return;
                }
                this.eventUpdate(voiceChannel);
                return;
            }

            if (newState.status === VoiceConnectionStatus.Disconnected) {
                this._scheduleReconcile(call);
            }
        });
    }

    eventUpdate(voiceChannel) {
        // update human member count
        const call = this.calls.get(voiceChannel.id);
        if (!call) {
            return;
        }

        const userCount = getHumanMemberCount(voiceChannel);
        call.userCount = userCount;

        console.log(`Call in channel ${voiceChannel.name} has ${userCount} human members.`);
        console.log(`Call settings: limit=${call.limit}, radioPlaying=${call.radioPlaying}, stayInCall=${call.stayInCall}`);
        // The bot stays for userCount <= limit and leaves only when userCount > limit.
        if (call.limit > 0 && userCount > call.limit && !call.radioPlaying && !call.stayInCall) {
            console.log(`Call in channel ${voiceChannel.name} has exceeded the limit of ${call.limit} members. Leaving call.`);
            const connection = getVoiceConnection(voiceChannel.guild.id);
            if (connection) {
                connection.destroy();
            }
            call.connection = null;
            return;
        }

        if (call.limit === 0 || userCount <= call.limit || call.radioPlaying || call.stayInCall) {
            this._join(call);
        }
    }

    _updateEvent(voiceChannel) {
        this.eventUpdate(voiceChannel);
    }

    selfDestruct() {
        for (const call of this.calls.values()) {
            const connection = getVoiceConnection(call.channel.guild.id);
            if (connection) {
                connection.destroy();
            }
        }
    }
}

module.exports = {
    CallHandler,
}