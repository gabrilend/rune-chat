#!/bin/bash
#
# chat.sh - Bash functions for chat client
#
# Source this file: source wrappers/bash/chat.sh
#
# Usage:
#   chat_ensure_daemon    # Start daemon if not running
#   chat_connect          # Connect to daemon (creates context)
#   chat_send "message"   # Send message, stream response
#   chat_clear            # Clear conversation history
#   chat_disconnect       # Disconnect from daemon
#
# Environment variables:
#   CHAT_SOCKET  - Path to daemon socket (default: /tmp/chat_daemon.sock)
#   CHAT_HOST    - Ollama host (default: 192.168.0.61)
#   CHAT_PORT    - Ollama port (default: 11434)
#   CHAT_MODEL   - Model name (default: nemotron-3-nano)

# Configuration
CHAT_SOCKET="${CHAT_SOCKET:-/tmp/chat_daemon.sock}"
CHAT_DAEMON_PID=""
CHAT_NC_PID=""
CHAT_FIFO_IN=""
CHAT_FIFO_OUT=""
CHAT_CONNECTED=0

# Find script directory for daemon path
CHAT_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if jq is available
_chat_check_deps() {
    if ! command -v jq &> /dev/null; then
        echo "Error: jq is required. Install with: sudo pacman -S jq" >&2
        return 1
    fi
    if ! command -v nc &> /dev/null; then
        echo "Error: nc (netcat) is required. Install with: sudo pacman -S openbsd-netcat" >&2
        return 1
    fi
    return 0
}

# Start the chat daemon if not running
chat_ensure_daemon() {
    _chat_check_deps || return 1

    # Check if daemon is already running
    if [[ -S "$CHAT_SOCKET" ]]; then
        # Try to ping it
        if echo '{"action":"ping"}' | nc -U "$CHAT_SOCKET" -w 1 2>/dev/null | grep -q "pong"; then
            return 0
        fi
        # Socket exists but daemon not responding, remove stale socket
        rm -f "$CHAT_SOCKET"
    fi

    echo "Starting chat daemon..."

    # Find the daemon script
    local daemon_script="$CHAT_SCRIPT_DIR/chat_daemon.lua"
    if [[ ! -f "$daemon_script" ]]; then
        echo "Error: Cannot find chat_daemon.lua at $daemon_script" >&2
        return 1
    fi

    # Export config for daemon
    export CHAT_SOCKET CHAT_HOST CHAT_PORT CHAT_MODEL

    # Start daemon in background
    luajit "$daemon_script" &
    CHAT_DAEMON_PID=$!

    # Wait for socket to appear
    local tries=0
    while [[ ! -S "$CHAT_SOCKET" ]] && (( tries < 50 )); do
        sleep 0.1
        ((tries++))
    done

    if [[ ! -S "$CHAT_SOCKET" ]]; then
        echo "Error: Daemon failed to start" >&2
        return 1
    fi

    echo "Daemon started (PID: $CHAT_DAEMON_PID)"
    return 0
}

# Stop the chat daemon
chat_stop_daemon() {
    if [[ -n "$CHAT_DAEMON_PID" ]]; then
        kill "$CHAT_DAEMON_PID" 2>/dev/null
        wait "$CHAT_DAEMON_PID" 2>/dev/null
        CHAT_DAEMON_PID=""
    fi
    rm -f "$CHAT_SOCKET"
}

# Connect to the daemon (establishes persistent connection)
chat_connect() {
    _chat_check_deps || return 1

    if (( CHAT_CONNECTED )); then
        echo "Already connected" >&2
        return 0
    fi

    if [[ ! -S "$CHAT_SOCKET" ]]; then
        chat_ensure_daemon || return 1
    fi

    # Create temp FIFOs for nc communication
    CHAT_FIFO_IN=$(mktemp -u "/tmp/chat_in.XXXXXX")
    CHAT_FIFO_OUT=$(mktemp -u "/tmp/chat_out.XXXXXX")
    mkfifo "$CHAT_FIFO_IN" "$CHAT_FIFO_OUT"

    # Start nc in background, connected to Unix socket
    nc -U "$CHAT_SOCKET" < "$CHAT_FIFO_IN" > "$CHAT_FIFO_OUT" &
    CHAT_NC_PID=$!

    # Open FIFOs for reading/writing
    exec 3>"$CHAT_FIFO_IN"   # Write to this to send to daemon
    exec 4<"$CHAT_FIFO_OUT"  # Read from this to receive from daemon

    CHAT_CONNECTED=1

    # Verify connection
    if ! _chat_ping; then
        chat_disconnect
        echo "Error: Failed to connect to daemon" >&2
        return 1
    fi

    return 0
}

# Internal: send ping and wait for pong
_chat_ping() {
    echo '{"action":"ping"}' >&3
    local response
    read -r -t 2 response <&4
    [[ "$response" == *"pong"* ]]
}

# Send a message and stream the response
chat_send() {
    local message="$1"

    if (( ! CHAT_CONNECTED )); then
        echo "Error: Not connected. Call chat_connect first." >&2
        return 1
    fi

    if [[ -z "$message" ]]; then
        echo "Error: Message required" >&2
        return 1
    fi

    # Escape message for JSON
    local escaped
    escaped=$(printf '%s' "$message" | jq -Rs .)

    # Send request
    echo "{\"action\":\"send\",\"message\":$escaped}" >&3

    # Read streaming response
    local line type token
    while IFS= read -r line <&4; do
        type=$(echo "$line" | jq -r '.type' 2>/dev/null)

        case "$type" in
            token)
                token=$(echo "$line" | jq -r '.data' 2>/dev/null)
                printf '%s' "$token"
                ;;
            done)
                echo  # Final newline
                return 0
                ;;
            error)
                local error
                error=$(echo "$line" | jq -r '.error' 2>/dev/null)
                echo "Error: $error" >&2
                return 1
                ;;
        esac
    done

    echo "Error: Connection closed unexpectedly" >&2
    return 1
}

# Send message without streaming (returns full response)
chat_send_quiet() {
    local message="$1"
    local response=""

    if (( ! CHAT_CONNECTED )); then
        echo "Error: Not connected. Call chat_connect first." >&2
        return 1
    fi

    if [[ -z "$message" ]]; then
        echo "Error: Message required" >&2
        return 1
    fi

    local escaped
    escaped=$(printf '%s' "$message" | jq -Rs .)

    echo "{\"action\":\"send\",\"message\":$escaped}" >&3

    local line type
    while IFS= read -r line <&4; do
        type=$(echo "$line" | jq -r '.type' 2>/dev/null)

        case "$type" in
            token)
                response+=$(echo "$line" | jq -r '.data' 2>/dev/null)
                ;;
            done)
                echo "$response"
                return 0
                ;;
            error)
                local error
                error=$(echo "$line" | jq -r '.error' 2>/dev/null)
                echo "Error: $error" >&2
                return 1
                ;;
        esac
    done

    return 1
}

# Clear conversation history
chat_clear() {
    if (( ! CHAT_CONNECTED )); then
        echo "Error: Not connected" >&2
        return 1
    fi

    echo '{"action":"clear"}' >&3

    local response
    read -r -t 5 response <&4

    if [[ "$response" == *'"type":"ok"'* ]]; then
        return 0
    else
        echo "Error: Failed to clear context" >&2
        return 1
    fi
}

# Get conversation history
chat_get_context() {
    if (( ! CHAT_CONNECTED )); then
        echo "Error: Not connected" >&2
        return 1
    fi

    echo '{"action":"get_context"}' >&3

    local response
    read -r -t 5 response <&4

    echo "$response" | jq '.messages'
}

# Get connection info
chat_info() {
    if (( ! CHAT_CONNECTED )); then
        echo "Error: Not connected" >&2
        return 1
    fi

    echo '{"action":"get_info"}' >&3

    local response
    read -r -t 5 response <&4

    echo "$response" | jq '.info'
}

# Set model
chat_set_model() {
    local model="$1"

    if (( ! CHAT_CONNECTED )); then
        echo "Error: Not connected" >&2
        return 1
    fi

    if [[ -z "$model" ]]; then
        echo "Error: Model name required" >&2
        return 1
    fi

    local escaped
    escaped=$(printf '%s' "$model" | jq -Rs .)

    echo "{\"action\":\"set_model\",\"model\":$escaped}" >&3

    local response
    read -r -t 5 response <&4

    if [[ "$response" == *'"type":"ok"'* ]]; then
        echo "Model set to: $(echo "$response" | jq -r '.model')"
        return 0
    else
        echo "Error: Failed to set model" >&2
        return 1
    fi
}

# Disconnect from daemon
chat_disconnect() {
    if (( CHAT_CONNECTED )); then
        exec 3>&-  # Close write FD
        exec 4<&-  # Close read FD
        CHAT_CONNECTED=0
    fi

    if [[ -n "$CHAT_NC_PID" ]]; then
        kill "$CHAT_NC_PID" 2>/dev/null
        wait "$CHAT_NC_PID" 2>/dev/null
        CHAT_NC_PID=""
    fi

    [[ -n "$CHAT_FIFO_IN" ]] && rm -f "$CHAT_FIFO_IN"
    [[ -n "$CHAT_FIFO_OUT" ]] && rm -f "$CHAT_FIFO_OUT"
    CHAT_FIFO_IN=""
    CHAT_FIFO_OUT=""
}

# Auto-cleanup on exit
trap chat_disconnect EXIT

# Quick one-shot chat (starts daemon, sends message, prints response)
chat() {
    local message="$1"

    if [[ -z "$message" ]]; then
        echo "Usage: chat \"your message\"" >&2
        return 1
    fi

    chat_ensure_daemon || return 1
    chat_connect || return 1
    chat_send "$message"
    # Note: disconnect happens automatically via trap
}

# Interactive chat mode
chat_interactive() {
    chat_ensure_daemon || return 1
    chat_connect || return 1

    echo "Chat started. Type 'quit' to exit, 'clear' to reset context."
    echo ""

    while true; do
        printf "You: "
        read -r input

        case "$input" in
            quit|exit|q)
                echo "Goodbye!"
                break
                ;;
            clear)
                chat_clear && echo "[Context cleared]"
                ;;
            "")
                continue
                ;;
            *)
                printf "Assistant: "
                chat_send "$input"
                echo ""
                ;;
        esac
    done
}

# Print help
chat_help() {
    cat << 'EOF'
Chat Client for Bash

Functions:
  chat_ensure_daemon    Start the chat daemon if not running
  chat_connect          Connect to daemon (creates conversation context)
  chat_send "msg"       Send message and stream response
  chat_send_quiet "msg" Send message and return full response (no streaming)
  chat_clear            Clear conversation history
  chat_get_context      Get conversation history as JSON
  chat_info             Get connection info
  chat_set_model "name" Change the model
  chat_disconnect       Disconnect from daemon
  chat_stop_daemon      Stop the daemon process

  chat "msg"            Quick one-shot: start daemon, connect, send, print
  chat_interactive      Interactive chat mode

Environment:
  CHAT_SOCKET  Socket path (default: /tmp/chat_daemon.sock)
  CHAT_HOST    Ollama host (default: 192.168.0.61)
  CHAT_PORT    Ollama port (default: 11434)
  CHAT_MODEL   Model name (default: nemotron-3-nano)

Example:
  source wrappers/bash/chat.sh
  chat_ensure_daemon
  chat_connect
  chat_send "Hello, how are you?"
  chat_send "Tell me more"
  chat_clear
  chat_disconnect
EOF
}
