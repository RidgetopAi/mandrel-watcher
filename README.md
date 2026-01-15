# Mandrel Watcher

Background daemon that watches local git repositories and syncs commits to [Mandrel](https://mandrel.ridgetopai.net) in real-time.

## Features

- 🔄 **Real-time sync** - Commits pushed to Mandrel as they happen
- 🎯 **Session association** - Automatically links commits to active Mandrel sessions
- 📁 **File tracking** - Lines added/deleted per file
- 🔌 **Works with any editor** - Claude Code, Cursor, Neovim, VSCode, etc.
- 🚀 **Single binary** - No runtime dependencies
- 🔧 **Systemd integration** - Auto-start on login

## Installation

### Quick Install (Recommended)

Download the latest release and run the install script:

```bash
# Download and extract release
tar -xzf mandrel-watcher-linux-x64.tar.gz
cd mandrel-watcher

# Run installer
./install/install.sh
```

### From Source

```bash
# Clone the repo
git clone https://github.com/RidgetopAi/mandrel-watcher.git
cd mandrel-watcher

# Install dependencies
bun install

# Build binary
bun run build

# Install
./install/install.sh
```

## Configuration

Edit `~/.config/mandrel-watcher/config.toml`:

```toml
# Mandrel API endpoint
api_url = "https://mandrel.ridgetopai.net"

# Authentication token (optional, for private sessions)
# auth_token = "your-jwt-token"

# Debounce time for git events (milliseconds)
debounce_ms = 2000

# Projects to watch
[[projects]]
path = "/home/user/myproject"
mandrel_project = "my-project-name"

[[projects]]
path = "/home/user/another-project"
mandrel_project = "another-project"
```

## Usage

### Manual Start

```bash
# Start in foreground (for testing)
mandrel-watcher start -f

# Start in foreground with debug output
mandrel-watcher start -f -d

# Check status
mandrel-watcher status

# Stop
mandrel-watcher stop
```

### Systemd Service (Auto-start)

```bash
# Enable auto-start on login
systemctl --user enable mandrel-watcher

# Start now
systemctl --user start mandrel-watcher

# Check status
systemctl --user status mandrel-watcher

# View logs
journalctl --user -u mandrel-watcher -f
```

## How It Works

1. **Watch** - Monitors `.git/logs/HEAD` for new commits using chokidar
2. **Extract** - Uses simple-git to get commit metadata and file changes
3. **Associate** - Queries Mandrel for active session
4. **Push** - POSTs commit data to `/api/git/push-stats`

```
┌─────────────────┐     HTTPS      ┌─────────────────┐
│ mandrel-watcher │ ──────────────→│  Mandrel API    │
│ (your machine)  │                │  (VPS)          │
│                 │                │                 │
│ Watches:        │                │ Writes to:      │
│  .git/logs/HEAD │                │  session_files  │
│                 │                │  git_commits    │
└─────────────────┘                └─────────────────┘
```

## Uninstall

```bash
./install/uninstall.sh
```

## Development

```bash
# Run in dev mode
bun run dev

# Run tests
bun test

# Build for current platform
bun run build

# Build for Linux
bun run build:linux

# Build for macOS ARM
bun run build:mac
```

## License

MIT
# Test Wed Jan 14 22:12:44 EST 2026
# E2E Test 1768446830
# Session cache test 1768447029
