#!/bin/bash
# AIDO wrapper script - place in PATH or use directly
# Usage: ./aido.sh <command> [args]
# Or: symlink/copy to /usr/local/bin/aido

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec python3 "$SCRIPT_DIR/aido.py" "$@"
