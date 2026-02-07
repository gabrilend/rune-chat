#!/usr/bin/env bash
# rs-sdk local dependencies environment
# Source this file to configure the environment for rs-sdk
# Usage: source /home/ritz/programming/ai-stuff/runescape/libs/env.sh

# =============================================================================
# Prisma Engines (locally built)
# =============================================================================
export PRISMA_SCHEMA_ENGINE_BINARY="/home/ritz/programming/ai-stuff/runescape/libs/prisma-engines/schema-engine"
export PRISMA_QUERY_ENGINE_BINARY="/home/ritz/programming/ai-stuff/runescape/libs/prisma-engines/query-engine"
export PRISMA_QUERY_ENGINE_LIBRARY="/home/ritz/programming/ai-stuff/runescape/libs/prisma-engines/libquery_engine.node"
export PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1

# =============================================================================
# OpenSSL (locally built)
# =============================================================================
export OPENSSL_DIR="/home/ritz/programming/ai-stuff/runescape/libs/openssl"
export OPENSSL_LIB_DIR="/home/ritz/programming/ai-stuff/runescape/libs/openssl/lib64"
export OPENSSL_INCLUDE_DIR="/home/ritz/programming/ai-stuff/runescape/libs/openssl/include"
if [[ -z "$__RS_SDK_OPENSSL_PATH_SET" ]]; then
    export PKG_CONFIG_PATH="/home/ritz/programming/ai-stuff/runescape/libs/openssl/lib64/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
    export LD_LIBRARY_PATH="/home/ritz/programming/ai-stuff/runescape/libs/openssl/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    export LIBRARY_PATH="/home/ritz/programming/ai-stuff/runescape/libs/openssl/lib64${LIBRARY_PATH:+:$LIBRARY_PATH}"
    export C_INCLUDE_PATH="/home/ritz/programming/ai-stuff/runescape/libs/openssl/include${C_INCLUDE_PATH:+:$C_INCLUDE_PATH}"
    export __RS_SDK_OPENSSL_PATH_SET=1
fi

# =============================================================================
# NixOS Library Paths (for native Node.js modules like bcrypt)
# =============================================================================
if [[ -z "$__RS_SDK_LD_LIBRARY_PATH_SET" ]]; then
    export LD_LIBRARY_PATH="/nix/store/90yn7340r8yab8kxpb0p7y0c9j3snjam-gcc-13.2.0-lib/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    export __RS_SDK_LD_LIBRARY_PATH_SET=1
fi

# =============================================================================
# Status
# =============================================================================
echo "rs-sdk environment configured"
echo "  Prisma engines: /home/ritz/programming/ai-stuff/runescape/libs/prisma-engines"
echo "  LD_LIBRARY_PATH: configured for NixOS"
