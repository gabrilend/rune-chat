# Bot Manager

A terminal-based UI for discovering, viewing, and launching RS-SDK bots.

## Quick Start

```bash
./scripts/bot-manager
```

## Features

- **Bot Discovery**: Automatically scans `rs-sdk/bots/*/bot.env` for runnable bots
- **Live Status**: Queries gateway for real-time bot status (ONLINE/STALE/OFFLINE)
- **Position Display**: Shows in-game coordinates for online bots
- **Quick Launch**: Start any bot with a single keypress
- **Create Bots**: Initialize new bots from the template

## Keyboard Controls

| Key        | Action                              |
|------------|-------------------------------------|
| `↑` / `k`  | Move selection up                   |
| `↓` / `j`  | Move selection down                 |
| `Enter`    | Launch selected bot                 |
| `s`        | Show detailed status (JSON)         |
| `r`        | Refresh bot list                    |
| `n`        | Create new bot from template        |
| `q` / `Esc`| Quit                                |

## Status Indicators

| Status    | Meaning                                    |
|-----------|--------------------------------------------|
| `[ONLINE]`  | Bot connected and responding (green)     |
| `[STALE]`   | Connected but no recent state (yellow)   |
| `[OFFLINE]` | Not connected to gateway (dim)           |
| `[NO USER]` | No BOT_USERNAME in bot.env (red)         |

## TUI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  RS-SDK Bot Manager                                         │
├─────────────────────────────────────────────────────────────┤
│  > chatty           [ONLINE]   chattybot      (3200, 3200) │
│    idle             [OFFLINE]  idlebot                      │
│    companion        [STALE]    companion                    │
├─────────────────────────────────────────────────────────────┤
│  [↑/↓/j/k] Navigate  [Enter] Launch  [s] Status  [q] Quit  │
└─────────────────────────────────────────────────────────────┘
```

## Creating New Bots

Press `n` to create a new bot:

1. Enter a name (letters, numbers, underscores, hyphens)
2. Enter the bot's username
3. The bot is created from `bots/_template/`
4. Edit `bot.env` to set the password and other options

## Configuration

### Environment Variables

| Variable       | Default     | Description                    |
|----------------|-------------|--------------------------------|
| `GATEWAY_HOST` | `localhost` | Gateway server hostname        |
| `GATEWAY_PORT` | `8245`      | Gateway server port            |

### Bot Directory Structure

Each bot requires:
```
bots/mybot/
├── bot.env     # Credentials and config
└── script.ts   # Bot logic
```

### bot.env Format

```env
BOT_USERNAME=myusername
PASSWORD=mypassword
GATEWAY_URL=ws://localhost:8245
```

## Requirements

- Bash 4+
- curl (for gateway queries)
- bun (for launching TypeScript bots)

## Troubleshooting

### "No bots found"
Ensure `rs-sdk/bots/` contains subdirectories with `bot.env` files.

### Status always shows OFFLINE
Check that the gateway is running on the configured host/port.

### Bot fails to launch
Verify the bot directory contains `script.ts` and `bot.env` is properly configured.
