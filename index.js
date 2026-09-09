require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
} = require("discord.js");
const {
    handleCommand,
    handleSelectMenu,
    registerSlashCommands,
} = require("./handler/commands");

const { CallHandler } = require("./handler/calls");
const { getAllCalls } = require("./utils/db/index.js");

const GUILD_ID = process.env.GUILD_ID || "1406595308275630212";
const INFINICALL = process.env.INFINICALL || "1427083874776776775";
const MAX_CALL_SIZE = Number(process.env.MAX_CALL_SIZE || 4);
const DEFAULT_RADIO_VOLUME = Number(process.env.RADIO_VOLUME || 60);
let currentRadioVolume = DEFAULT_RADIO_VOLUME;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

const caller = new CallHandler(client);

client.on("interactionCreate", (interaction) => {
    if (!interaction.isCommand() && !interaction.isStringSelectMenu()) {
        return;
    }

    if (interaction.isCommand()) {
        handleCommand(interaction, {
            client, caller
        }).catch((error) => {
            console.error("Command handler failed:", error);
        });
    }

    if (interaction.isStringSelectMenu()) {
        handleSelectMenu(interaction, {
            client, caller
        }).catch((error) => {
            console.error("Select menu handler failed:", error);
        });
    };
});

client.once("clientReady", async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    try {
        await registerSlashCommands(client);
        console.log("Slash commands registered.");
        console.log(`Client ready: user=${client.user?.tag} id=${client.user?.id} applicationId=${client.application?.id}`);
    } catch (error) {
        console.error("Failed to register slash commands:", error);
    }

    const calls = await getAllCalls();

    for (const call of calls) {
        console.log('call', call[1].infinicall_id);
        const channel = client.channels.cache.get(call[1].infinicall_id);
        if (!channel || !channel.isVoiceBased() || channel.isDMBased()) {
            console.warn(`Skipping call for guild ${call[0]}: channel ${call[1].infinicall_id} is not a valid voice channel`);
            continue;
        }

        console.log("Starting call for guild", call[0], "channel", call[1].infinicall_id, "limit", call[1].infinicall_limit, "stayInCall", call[1].infinicall_stay);

        caller.addCall(
            channel,
            {
                limit: call[1].infinicall_limit ?? 0,
                radioPlaying: false,
                stayInCall: call[1].infinicall_stay ?? false,
            }
        );
    }
});

process.on("SIGINT", () => {
    console.log("Received SIGINT. Disconnecting from voice channel...");
    caller.selfDestruct(); // caboose the bot to leave the voice channel and clean up resources
    process.exit();
});

client.login(process.env.TOKEN);