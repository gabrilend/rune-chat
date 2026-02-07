#!/bin/bash
# Install chatbot libraries from source
# Usage: ./scripts/install-libs.sh [--all|--luasocket|--cjson|--dkjson|--raylib]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LIBS_DIR="$PROJECT_DIR/libs"
BUILD_DIR="$PROJECT_DIR/.build"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[-]${NC} $1"; exit 1; }

mkdir -p "$BUILD_DIR"
mkdir -p "$LIBS_DIR/lib"
mkdir -p "$LIBS_DIR/share/lua/5.1"

# ============================================================================
# dkjson - Pure Lua JSON library
# ============================================================================
install_dkjson() {
    log "Installing dkjson..."
    local url="https://raw.githubusercontent.com/LuaDist/dkjson/master/dkjson.lua"

    if [ -f "$LIBS_DIR/dkjson.lua" ]; then
        warn "dkjson.lua already exists, skipping"
        return 0
    fi

    curl -sL "$url" -o "$LIBS_DIR/dkjson.lua"
    log "dkjson installed to $LIBS_DIR/dkjson.lua"
}

# ============================================================================
# LuaSocket - Network support for Lua
# ============================================================================
install_luasocket() {
    log "Installing LuaSocket..."
    local version="3.1.0"
    local url="https://github.com/lunarmodules/luasocket/archive/refs/tags/v${version}.tar.gz"

    cd "$BUILD_DIR"

    if [ ! -d "luasocket-${version}" ]; then
        log "Downloading LuaSocket v${version}..."
        curl -sL "$url" -o luasocket.tar.gz
        tar xzf luasocket.tar.gz
        rm luasocket.tar.gz
    fi

    cd "luasocket-${version}"

    # Build with LuaJIT compatibility
    log "Building LuaSocket..."
    make clean 2>/dev/null || true
    make LUAV=5.1 LUAINC_linux=/usr/include/luajit-2.1 linux

    # Install to libs directory
    log "Installing LuaSocket to $LIBS_DIR..."
    make LUAV=5.1 \
         INSTALL_TOP_LDIR="$LIBS_DIR/share/lua/5.1" \
         INSTALL_TOP_CDIR="$LIBS_DIR/lib/lua/5.1" \
         install-unix

    log "LuaSocket installed"
}

# ============================================================================
# cJSON - Fast JSON parser (C library with Lua bindings)
# ============================================================================
install_cjson() {
    log "Installing cJSON..."
    local url="https://github.com/DaveGamble/cJSON/archive/refs/tags/v1.7.17.tar.gz"

    cd "$BUILD_DIR"

    if [ ! -d "cJSON-1.7.17" ]; then
        log "Downloading cJSON..."
        curl -sL "$url" -o cjson.tar.gz
        tar xzf cjson.tar.gz
        rm cjson.tar.gz
    fi

    cd "cJSON-1.7.17"

    log "Building cJSON..."
    mkdir -p build && cd build
    cmake .. -DCMAKE_INSTALL_PREFIX="$LIBS_DIR"
    make -j$(nproc)
    make install

    log "cJSON installed"
}

# ============================================================================
# lua-cjson - Lua bindings for cJSON
# ============================================================================
install_lua_cjson() {
    log "Installing lua-cjson..."
    local url="https://github.com/openresty/lua-cjson/archive/refs/tags/2.1.0.13.tar.gz"

    cd "$BUILD_DIR"

    if [ ! -d "lua-cjson-2.1.0.13" ]; then
        log "Downloading lua-cjson..."
        curl -sL "$url" -o lua-cjson.tar.gz
        tar xzf lua-cjson.tar.gz
        rm lua-cjson.tar.gz
    fi

    cd "lua-cjson-2.1.0.13"

    log "Building lua-cjson..."
    make LUA_INCLUDE_DIR=/usr/include/luajit-2.1

    # Install
    mkdir -p "$LIBS_DIR/lib/lua/5.1"
    cp cjson.so "$LIBS_DIR/lib/lua/5.1/"

    log "lua-cjson installed"
}

# ============================================================================
# Raylib - Graphics library (optional)
# ============================================================================
install_raylib() {
    log "Installing Raylib (Wayland)..."
    local version="5.0"
    local url="https://github.com/raysan5/raylib/archive/refs/tags/${version}.tar.gz"

    cd "$BUILD_DIR"

    if [ ! -d "raylib-${version}" ]; then
        log "Downloading Raylib v${version}..."
        curl -sL "$url" -o raylib.tar.gz
        tar xzf raylib.tar.gz
        rm raylib.tar.gz
    fi

    cd "raylib-${version}"

    log "Building Raylib with Wayland support..."
    mkdir -p build && cd build
    cmake .. \
        -DCMAKE_INSTALL_PREFIX="$LIBS_DIR/raylib-wayland" \
        -DUSE_WAYLAND=ON \
        -DBUILD_SHARED_LIBS=ON
    make -j$(nproc)
    make install

    log "Raylib installed"
}

# ============================================================================
# ansicolors - Pure Lua ANSI color library
# ============================================================================
install_ansicolors() {
    log "Installing ansicolors..."

    if [ -f "$LIBS_DIR/ansicolors.lua" ]; then
        warn "ansicolors.lua already exists, skipping"
        return 0
    fi

    # Minimal implementation
    cat > "$LIBS_DIR/ansicolors.lua" << 'EOF'
-- ansicolors: minimal ANSI color support
local colors = {}
setmetatable(colors, {__call = function(_, s) return s end})
return colors
EOF

    log "ansicolors installed"
}

# ============================================================================
# fuzzy-computing - Chat client library (custom)
# ============================================================================
install_fuzzy_computing() {
    log "Checking fuzzy-computing..."

    if [ -d "$LIBS_DIR/fuzzy-computing" ]; then
        log "fuzzy-computing already present"
        return 0
    fi

    warn "fuzzy-computing is a custom library - manual installation required"
    warn "Expected location: $LIBS_DIR/fuzzy-computing/"
    warn "Required files: chat_client.lua, chat_config_loader.lua, config/, tools/"
}

# ============================================================================
# Check dependencies
# ============================================================================
check_deps() {
    log "Checking build dependencies..."

    local missing=""
    command -v gcc >/dev/null || missing="$missing gcc"
    command -v make >/dev/null || missing="$missing make"
    command -v cmake >/dev/null || missing="$missing cmake"
    command -v curl >/dev/null || missing="$missing curl"
    command -v luajit >/dev/null || missing="$missing luajit"

    if [ -n "$missing" ]; then
        err "Missing dependencies:$missing\nInstall with: sudo pacman -S$missing (Arch) or apt install$missing (Debian)"
    fi

    log "All dependencies found"
}

# ============================================================================
# Main
# ============================================================================
show_help() {
    cat << EOF
Usage: $0 [OPTIONS]

Install chatbot libraries from source.

Options:
  --all         Install all libraries
  --check       Check dependencies only
  --dkjson      Install dkjson (pure Lua JSON)
  --luasocket   Install LuaSocket (network)
  --cjson       Install cJSON (fast JSON)
  --lua-cjson   Install lua-cjson bindings
  --raylib      Install Raylib (graphics, optional)
  --ansicolors  Install ansicolors
  --help        Show this help

Environment:
  LIBS_DIR=$LIBS_DIR
  BUILD_DIR=$BUILD_DIR
EOF
}

main() {
    if [ $# -eq 0 ]; then
        show_help
        exit 0
    fi

    check_deps

    for arg in "$@"; do
        case "$arg" in
            --all)
                install_dkjson
                install_ansicolors
                install_luasocket
                install_lua_cjson
                install_fuzzy_computing
                ;;
            --check)
                log "Dependencies OK"
                ;;
            --dkjson)
                install_dkjson
                ;;
            --luasocket)
                install_luasocket
                ;;
            --cjson)
                install_cjson
                ;;
            --lua-cjson)
                install_lua_cjson
                ;;
            --raylib)
                install_raylib
                ;;
            --ansicolors)
                install_ansicolors
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                warn "Unknown option: $arg"
                ;;
        esac
    done

    log "Done. Add to LUA_PATH/LUA_CPATH:"
    echo "  export LUA_PATH=\"$LIBS_DIR/share/lua/5.1/?.lua;$LIBS_DIR/?.lua;;\""
    echo "  export LUA_CPATH=\"$LIBS_DIR/lib/lua/5.1/?.so;;\""
}

main "$@"
