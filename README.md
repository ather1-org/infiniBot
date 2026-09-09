# InfiniBot

> The most over-engineered Discord call idle bot.

InfiniBot keeps a Discord bot present in a configured voice channel while the channel is active, leaves when a configurable human-member limit is exceeded, and can play AzuraCast radio streams. Settings persist per guild in SQLite, so the bot can restore configured calls after a restart.

## Features

- Persistent per-guild voice-channel configuration
- Automatic voice-state reconciliation and reconnection
- Configurable human-member limit
- `0` means unlimited: the bot will not leave because of member count
- Optional stay-in-call behavior
- AzuraCast station discovery and radio playback
- Per-server radio volume control
- SQLite-backed settings with no external database service
- Slash-command registration on startup

## Requirements

- Node.js 20 or newer recommended
- A Discord application and bot token
- A Discord server where the bot can use voice and slash commands
- An AzuraCast server, if radio playback is needed

## Installation

```bash
npm install
```

Create a `.env` file in the project root:

```env
TOKEN=your_discord_bot_token

# Optional AzuraCast configuration
AZURACAST_BASE_URL=https://radio.example.com
AZURACAST_API_KEY=your_azuracast_api_key
AZURACAST_SERVER_NAME=Primary
```

Start the bot with:

```bash
node .
```

The first run creates `data/db.sqlite`. Keep the `data/` directory when upgrading or redeploying if you want to preserve guild settings.

## Discord setup

Invite the bot with the permissions it needs for your deployment. At minimum, it needs to:

- View the configured voice channel
- Connect to and speak in voice channels
- View channels
- Send messages
- Use slash commands

Enable the `Guilds`, `Guild Messages`, `Message Content`, and `Guild Voice States` intents in the Discord Developer Portal. Voice-state handling depends on `Guild Voice States`.

## Slash commands

### Call settings

| Command                                      | Description                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `/settings show`                             | Show the current guild settings.                                                |
| `/settings channel channel:<voice channel>`  | Select the voice channel InfiniBot manages.                                     |
| `/settings limit limit:<number>`             | Leave when the number of human members exceeds the limit. Use `0` for no limit. |
| `/settings stay_in_call value:<true\|false>` | Keep the bot in the call even when the configured limit is exceeded.            |
| `/settings volume percent:<0-100>`           | Set the default radio volume for the guild.                                     |

Call settings require the Discord `Manage Server` permission. The configured channel and settings are persisted in SQLite.

### Azuracast Radios

| Command                       | Description                                                        |
| ----------------------------- | ------------------------------------------------------------------ |
| `/stations`                   | Browse stations available from the configured AzuraCast server(s). |
| `/playstation station:<name>` | Play an AzuraCast station in your current voice channel.           |
| `/stopradio`                  | Stop the radio stream and leave the voice channel.                 |
| `/volume percent:<0-100>`     | Change the current radio volume.                                   |

When multiple AzuraCast servers are configured, station selection can be narrowed with the optional `server` argument.

### Maintenance

| Command                        | Description                                                   |
| ------------------------------ | ------------------------------------------------------------- |
| `/nowplaying-debug`            | Show current station, server, now-playing, and polling state. |
| `/avatar-test url:<image URL>` | Administrative bot-avatar test command.                       |

## AzuraCast configuration

For one server, use the unnumbered variables:

```env
AZURACAST_BASE_URL=https://radio.example.com
AZURACAST_API_KEY=your_api_key
AZURACAST_SERVER_NAME=Primary
```

For multiple servers, use numbered variables. The numbers do not need to be sequential:

```env
AZURACAST_0_BASE_URL=https://main.example.com
AZURACAST_0_API_KEY=key1
AZURACAST_0_SERVER_NAME=Main

AZURACAST_2_BASE_URL=https://backup.example.com
AZURACAST_2_API_KEY=key2
AZURACAST_2_SERVER_NAME=Backup

AZURACAST_5_BASE_URL=https://testing.example.com
AZURACAST_5_API_KEY=key3
AZURACAST_5_SERVER_NAME=Testing
```

`AZURACAST_0_*`, `AZURACAST_2_*`, and `AZURACAST_5_*` will all be discovered automatically. Missing numbers are allowed.

The numbered and unnumbered formats can also be used together. The unnumbered configuration is treated as an additional server:

```env
AZURACAST_BASE_URL=https://main.example.com
AZURACAST_API_KEY=key1
AZURACAST_SERVER_NAME=Main

AZURACAST_2_BASE_URL=https://backup.example.com
AZURACAST_2_API_KEY=key2
AZURACAST_2_SERVER_NAME=Backup
```

If `AZURACAST_API_KEY` (or the corresponding numbered API key) is omitted, station discovery is attempted without bearer authentication.

## How the call limit works

InfiniBot counts human members only; bot accounts are ignored.

- Limit `2`: the bot stays while there are at most 2 humans and leaves when a third human is present.
- Limit `0`: the limit check is disabled and member count will not make the bot leave.
- A process shutdown still disconnects the bot normally.

Voice-state updates trigger reconciliation, and a short scheduled reconciliation handles connection-state changes without repeatedly joining or destroying the connection during bursts of events.

## Development

There is currently no automated test suite configured in `package.json`.

## License

The project currently declares the GNU General Public License v3.0 (GPL-3.0). See the [LICENSE](LICENSE) file for the full license text.
