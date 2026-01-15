#!/bin/bash
#
# Mandrel Watcher Install Script
# Installs the binary, creates config directory, and sets up systemd service
#

set -e

BINARY_NAME="mandrel-watcher"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="$HOME/.config/mandrel-watcher"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root for binary installation
check_permissions() {
    if [ "$EUID" -eq 0 ]; then
        log_error "Don't run this script as root. It will ask for sudo when needed."
        exit 1
    fi
}

# Find the binary to install
find_binary() {
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    
    # Check for binary in same directory
    if [ -f "$SCRIPT_DIR/$BINARY_NAME" ]; then
        BINARY_PATH="$SCRIPT_DIR/$BINARY_NAME"
    # Check for binary in dist directory (if running from source)
    elif [ -f "$SCRIPT_DIR/../dist/$BINARY_NAME" ]; then
        BINARY_PATH="$SCRIPT_DIR/../dist/$BINARY_NAME"
    else
        log_error "Could not find $BINARY_NAME binary"
        log_error "Make sure to run 'bun run build' first"
        exit 1
    fi
    
    log_info "Found binary: $BINARY_PATH"
}

# Install binary to /usr/local/bin
install_binary() {
    log_info "Installing binary to $INSTALL_DIR/$BINARY_NAME"
    sudo cp "$BINARY_PATH" "$INSTALL_DIR/$BINARY_NAME"
    sudo chmod +x "$INSTALL_DIR/$BINARY_NAME"
    log_info "Binary installed successfully"
}

# Create config directory and default config
setup_config() {
    if [ ! -d "$CONFIG_DIR" ]; then
        log_info "Creating config directory: $CONFIG_DIR"
        mkdir -p "$CONFIG_DIR"
    fi
    
    if [ ! -f "$CONFIG_DIR/config.toml" ]; then
        log_info "Creating default config file"
        $INSTALL_DIR/$BINARY_NAME config init
    else
        log_warn "Config file already exists, skipping"
    fi
}

# Setup systemd user service
setup_systemd() {
    log_info "Setting up systemd user service"
    
    mkdir -p "$SYSTEMD_USER_DIR"
    
    # Create service file (substitute user)
    cat > "$SYSTEMD_USER_DIR/mandrel-watcher.service" << 'EOF'
[Unit]
Description=Mandrel Watcher - Git commit sync daemon
Documentation=https://github.com/RidgetopAi/mandrel-watcher
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/mandrel-watcher start -f
Restart=on-failure
RestartSec=10

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mandrel-watcher

[Install]
WantedBy=default.target
EOF
    
    # Reload systemd
    systemctl --user daemon-reload
    
    log_info "Systemd service installed"
    log_info ""
    log_info "To enable auto-start on login:"
    log_info "  systemctl --user enable mandrel-watcher"
    log_info ""
    log_info "To start now:"
    log_info "  systemctl --user start mandrel-watcher"
    log_info ""
    log_info "To check status:"
    log_info "  systemctl --user status mandrel-watcher"
}

# Main installation flow
main() {
    echo ""
    echo "╔════════════════════════════════════════╗"
    echo "║     Mandrel Watcher Installation       ║"
    echo "╚════════════════════════════════════════╝"
    echo ""
    
    check_permissions
    find_binary
    install_binary
    setup_config
    setup_systemd
    
    echo ""
    log_info "Installation complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Edit config: $CONFIG_DIR/config.toml"
    echo "  2. Add your projects to watch"
    echo "  3. Start manually: mandrel-watcher start"
    echo "     Or enable service: systemctl --user enable --now mandrel-watcher"
    echo ""
}

main "$@"
