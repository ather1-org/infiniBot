const fs = require("node:fs");
const path = require("node:path");
const { REST, Routes, MessageFlags } = require("discord.js");

const commandsDirectory = path.join(__dirname, "..", "commands");

function getRegexKey(regex) {
    if (!(regex instanceof RegExp)) {
        throw new TypeError("customIdsRegex entries must be regular expressions");
    }

    return `${regex.source}/${regex.flags}`;
}

function validateSelectMenuRegexes(commands) {
    const registeredRegexes = [];

    for (const command of commands) {
        for (const regex of command.customIdsRegex || []) {
            const key = getRegexKey(regex);
            const clash = registeredRegexes.find((registered) => registered.key === key);

            if (clash) {
                throw new Error(
                    `Select-menu regex clash between ${clash.file} and ${command.file}: /${regex.source}/${regex.flags}`
                );
            }

            registeredRegexes.push({
                file: command.file,
                key,
            });
        }
    }
}

function normalizeIds(values) {
    if (!values) {
        return [];
    }

    return (Array.isArray(values) ? values : [values]).map(String);
}

function loadCommands() {
    if (!fs.existsSync(commandsDirectory)) {
        return [];
    }

    const commands = fs.readdirSync(commandsDirectory)
        .filter((file) => file.endsWith(".js"))
        .map((file) => {
            const command = require(path.join(commandsDirectory, file));
            if (!command.data || typeof command.execute !== "function") {
                throw new Error(`${file} must export data and an execute function`);
            }

            return { ...command, file };
        });

    validateSelectMenuRegexes(commands);
    return commands;
}

function getCommandName(command) {
    return typeof command.data.name === "string" ? command.data.name : command.data.toJSON().name;
}

function getAccess(command) {
    return command.access || command.permissions || {};
}

function isAllowed(interaction, command) {
    const access = getAccess(command);
    const guilds = normalizeIds(access.guilds || access.guild);
    const roles = normalizeIds(access.roles || access.role);
    const users = normalizeIds(access.users || access.user);

    if (guilds.length && !guilds.includes(String(interaction.guildId))) {
        return false;
    }

    if (users.length && !users.includes(String(interaction.user?.id))) {
        return false;
    }

    if (roles.length) {
        const memberRoles = interaction.member?.roles?.cache;
        if (!memberRoles || !roles.some((roleId) => memberRoles.has(roleId))) {
            return false;
        }
    }

    if (access.permissions && !interaction.memberPermissions?.has(access.permissions)) {
        return false;
    }

    return true;
}

async function registerSlashCommands(client, token = process.env.TOKEN) {
    const commands = loadCommands();
    const rest = new REST({ version: "10" }).setToken(token);
    const appId = client.user?.id || client.application?.id;

    if (!appId) {
        throw new Error("No application id available for registering commands");
    }

    const globalCommands = [];
    const guildCommands = new Map();

    for (const command of commands) {
        const commandJson = command.data.toJSON();
        const access = getAccess(command);
        const guilds = normalizeIds(access.guilds || access.guild);

        if (!guilds.length) {
            globalCommands.push(commandJson);
            continue;
        }

        for (const guildId of guilds) {
            if (!guildCommands.has(guildId)) {
                guildCommands.set(guildId, []);
            }
            guildCommands.get(guildId).push(commandJson);
        }
    }

    await rest.put(Routes.applicationCommands(appId), { body: globalCommands });
    for (const [guildId, guildCommandData] of guildCommands) {
        await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: guildCommandData });
    }

    console.log(`Registered ${commands.length} slash command(s).`);
    return commands;
}

async function handleCommand(interaction, context = {}, commands = loadCommands()) {
    if (!interaction.isChatInputCommand()) {
        return false;
    }

    const command = commands.find((entry) => getCommandName(entry) === interaction.commandName);
    if (!command) {
        return false;
    }

    if (!isAllowed(interaction, command)) {
        await interaction.reply({
            content: "You are not allowed to use this command.",
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    await command.execute(interaction, context);
    return true;
}

async function handleSelectMenu(interaction, context = {}, commands = loadCommands()) {
    if (!interaction.isStringSelectMenu()) {
        return false;
    }

    const command = commands.find((entry) => entry.customIdsRegex?.some((regex) => regex.test(interaction.customId)));
    if (!command || typeof command.handleSelectMenu !== "function") {
        return false;
    }

    await command.handleSelectMenu(interaction, context);
    return true;
}

module.exports = {
    handleCommand,
    handleSelectMenu,
    isAllowed,
    loadCommands,
    registerSlashCommands,
};
