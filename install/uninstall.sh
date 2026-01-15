#!/bin/bash
#
# Mandrel Watcher Uninstall Script
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
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

main() {
    echo ""
    echo "╔════════════════════════════════════════╗"
    echo "║    Mandrel Watcher Uninstallation      ║"
    echo "╚════════════════════════════════════════╝"
    echo ""
    
    # Stop service if running
    if systemctl --user is-active --quiet mandrel-watcher 2>/dev/null; then
        log_info "Stopping service..."
        systemctl --user stop mandrel-watcher
    fi
    
    # Disable service
    if systemctl --user is-enabled --quiet mandrel-watcher 2>/dev/null; then
        log_info "Disabling service..."
        systemctl --user disable mandrel-watcher
    fi
    
    # Remove systemd service file
    if [ -f "$SYSTEMD_USER_DIR/mandrel-watcher.service" ]; then
        log_info "Removing systemd service..."
        rm -f "$SYSTEMD_USER_DIR/mandrel-watcher.service"
        systemctl --user daemon-reload
    fi
    
    # Remove binary
    if [ -f "$INSTALL_DIR/$BINARY_NAME" ]; then
        log_info "Removing binary..."
        sudo rm -f "$INSTALL_DIR/$BINARY_NAME"
    fi
    
    # Ask about config
    if [ -d "$CONFIG_DIR" ]; then
        echo ""
        read -p "Remove config directory ($CONFIG_DIR)? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log_info "Removing config directory..."
            rm -rf "$CONFIG_DIR"
        else
            log_info "Keeping config directory"
        fi
    fi
    
    echo ""
    log_info "Uninstallation complete!"
    echo ""
}

main "$@"
