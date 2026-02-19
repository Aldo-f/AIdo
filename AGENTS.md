# AGENTS.md - AIDO Development Guide

## Overview

AIDO is an intelligent AI CLI assistant with multi-provider support (Ollama, Docker Model Runner, OpenCode Zen, Google Gemini, OpenAI). The proxy server is built with FastAPI for optimal performance.

**Key Principle: DRY (Don't Repeat Yourself)**

All API logic is centralized in the FastAPI proxy server. The CLI (`aido.sh`) is a thin wrapper that delegates all queries to the proxy. This ensures:
- Single source of truth for API handling
- Consistent behavior between CLI and OpenCode
- Centralized key management with persistence

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        aido.sh (CLI)                            │
│  - start/stop proxy                                             │
│  - help system                                                  │
│  - config management                                            │
│  - thin wrapper for queries (HTTP to proxy)                    │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP localhost:11999/v1/query
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Proxy Server (FastAPI)                       │
│                                                                 │
│  Endpoints:                                                     │
│  - GET  /health              Health check                       │
│  - GET  /v1/models           List models                        │
│  - POST /v1/chat/completions OpenAI-compatible (OpenCode)      │
│  - POST /v1/query            Simple query (CLI)                │
│  - POST /chat/completions    Alias for /v1/chat/completions    │
│                                                                 │
│  Features:                                                      │
│  - Key rotation with SQLite persistence                        │
│  - Multi-provider fallback                                     │
│  - SSE comment filtering                                       │
│  - Cooldown tracking for failed keys                           │
└─────────────────────────┬───────────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
    ┌─────────┐      ┌─────────┐      ┌─────────┐
    │  Cloud  │      │  Ollama │      │   DMR   │
    │ Providers│     │ (local) │      │(Docker) │
    └─────────┘      └─────────┘      └─────────┘
```

---

## Development Setup

### Prerequisites

```bash
# Install dependencies
pip install -r requirements.txt
```

### Pre-Commit Hook

AIDO uses a pre-commit hook that automatically runs all tests before allowing a commit:

```bash
# Tests run automatically when you commit:
git commit -m "your message"

# If tests fail, the commit is aborted
```

---

## Commands

### Running Tests

```bash
# Run all tests (44 tests)
make test

# Run tests directly
cd /media/aldo/shared/aido && ./tests/aido_test.sh

# Run with custom test directory
AIDO_TEST_DIR=/tmp/aido-test ./tests/aido_test.sh
```

### Lint & Format

```bash
# Install formatters
make install-tools

# Check code (lint)
make lint

# Auto-format code
make format

# Run lint + test
make all
```

### Server Commands

```bash
./aido.sh serve          # Start proxy (default port 11999)
./aido.sh serve 8080     # Custom port
./aido.sh stop           # Stop proxy
./aido.sh status         # Check status

# Or directly with uvicorn:
python3 -m uvicorn proxy.server:app --host 0.0.0.0 --port 11999
```

### Query Commands

**Note: Proxy must be running (`aido serve`) before queries work.**

```bash
./aido.sh run "Hello"    # Run query
./aido.sh run            # Interactive mode
./aido.sh run -c         # Continue last session
./aido.sh list           # List available models
./aido.sh pull llama3.2  # Download model
```

### Manual API Testing

```bash
# Health check
curl http://localhost:11999/health

# List models
curl http://localhost:11999/v1/models

# Simple query (CLI uses this)
curl -X POST http://localhost:11999/v1/query \
  -H "Content-Type: application/json" \
  -d '{"query": "Hello", "model": "aido/auto"}'

# Chat completion (OpenCode uses this)
curl -X POST http://localhost:11999/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "aido/auto", "messages": [{"role": "user", "content": "Hello"}]}'
```

---

## Code Style - Bash

### General Rules
- Use `set -euo pipefail` at script top
- Use `[[ ]]` for conditionals (not `[ ]`)
- Use `$(command)` not backticks
- Double-quote all variable expansions: `"$variable"`

### Naming & Formatting
- Variables: `lower_case_with_underscores`
- Functions: `snake_case`
- Constants: `UPPER_CASE`
- Indent with 4 spaces, opening brace on same line
- Use `local` variables in functions

### Help System
Every public command should have help via `check_help`:

```bash
my_command() {
    local help_text="${CYAN}Usage:${NC} aido my-command [ARGS]

${CYAN}Description:${NC}
  Description of what it does.

${CYAN}Options:${NC}
  -h, --help        Show this help message

${CYAN}Examples:${NC}
  ${GREEN}aido my-command${NC}    Example usage"
    
    if check_help my-command "$help_text" "$@"; then
        exit 0
    fi
    
    # Command logic here
}
```

---

## Code Style - Python

### General Rules
- Python 3.10+ (modern type hints: `dict[str, Any]`, `list[str]`)
- 100 character line limit, 4-space indent
- Use async/await for FastAPI endpoints

### Imports
```python
# Order: stdlib -> third-party -> local
import json
from pathlib import Path
from typing import Any, AsyncGenerator

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

import config
import key_manager
import database
```

### Type Hints
```python
def function(param: str) -> int:
    ...

def optional_param(name: str, value: str | None = None) -> dict[str, Any]:
    ...

async def async_function() -> AsyncGenerator[str, None]:
    ...
```

### Key Manager Usage
```python
# Get next available key
api_key, key_name = key_manager.get_next_key(provider)

# Mark key as failed (adds to database with cooldown)
key_manager.mark_key_failed(provider, status_code, error_message, retry_after)

# Mark key as successful (clears from database)
key_manager.mark_key_success(provider)
```

### Logging
- Use `log()` function from server.py
- Levels: "INFO", "WARN", "ERROR"
- Logs written to `~/.aido-data/logs/proxy.log`

---

## File Structure

```
aido/
├── Makefile              # Build/lint/format commands
├── aido.sh               # Main CLI (thin wrapper)
├── requirements.txt      # Python dependencies
├── proxy/
│   ├── __init__.py       # Module exports
│   ├── config.py         # Config loading, provider detection
│   ├── key_manager.py    # Key rotation with database persistence
│   ├── database.py       # SQLite for key failures + query tracking
│   ├── server.py         # FastAPI main application
│   └── providers/
│       ├── __init__.py
│       ├── base.py       # Base provider class
│       ├── zen.py        # OpenCode Zen provider
│       ├── gemini.py     # Google Gemini provider
│       ├── openai.py     # OpenAI provider
│       ├── ollama.py     # Ollama (local) provider
│       └── dmr.py        # Docker Model Runner provider
├── tests/
│   └── aido_test.sh      # 44 tests
└── AGENTS.md             # This file
```

---

## Database Schema

### key_failures Table

Stores failed API keys with cooldown information:

| Column | Type | Description |
|--------|------|-------------|
| provider | TEXT | Provider name (opencode-zen, gemini, etc.) |
| key_index | INTEGER | Index of key in config |
| key_hash | TEXT | SHA256 hash of key (first 16 chars) |
| status_code | INTEGER | HTTP status code (401, 403, 429) |
| error_message | TEXT | Error message from API |
| retry_after_seconds | INTEGER | Custom retry-after value |
| failed_at | TEXT | ISO timestamp of failure |
| available_after | TEXT | ISO timestamp when key is available again |

### Cooldown Periods

| Status Code | Cooldown |
|-------------|----------|
| 401 (Unauthorized) | 24 hours |
| 403 (Forbidden) | 24 hours |
| 429 (Rate Limited) | 5 minutes (or custom retry-after) |

---

## Configuration

Config: `~/.aido-data/config.json`

### Provider Config
```json
{
  "providers": {
    "ollama": {"enabled": true, "endpoint": "http://localhost:11434"},
    "opencode-zen": {
      "enabled": true,
      "keys": [
        {"key": "sk-zen-xxx", "name": "primary"},
        {"key": "sk-zen-yyy", "name": "backup"}
      ]
    },
    "gemini": {"enabled": true, "keys": [{"key": "AIza...", "name": "default"}]},
    "openai": {"enabled": true, "keys": [{"key": "sk-...", "name": "default"}]}
  },
  "selection": {"default_mode": "cloud_first"}
}
```

### Selection Modes

| Mode | Behavior |
|------|----------|
| `cloud_first` | Prefer cloud (Zen, Gemini, OpenAI), fallback to local |
| `local_first` | Prefer local (Ollama, DMR), fallback to cloud |

### Meta Models

| Model | Behavior |
|-------|----------|
| `aido/auto` | Auto-select based on selection mode |
| `aido/cloud` | Only use cloud providers |
| `aido/local` | Only use local providers |

---

## Provider Fallback Order

### Cloud First (default)
1. OpenCode Zen → 2. Gemini → 3. OpenAI → 4. Ollama → 5. Docker Model Runner

### Local First
1. Ollama → 2. Docker Model Runner → 3. OpenCode Zen → 4. Gemini → 5. OpenAI

---

## Development Tips

1. **Proxy required**: Always run `aido serve` before queries
2. **Debug**: Check `~/.aido-data/logs/proxy.log`
3. **Database**: `sqlite3 ~/.aido-data/aido.db`
4. **Quick restart**: `./aido.sh stop && ./aido.sh serve`
5. **Provider status**: `curl localhost:11999/health`
6. **Clear failed keys**: Delete from `key_failures` table

---

## Request Flow

### CLI Query Flow
```
aido run "Hello"
    │
    ▼
Check if proxy running
    │
    ▼
POST /v1/query {"query": "Hello", "model": "aido/auto"}
    │
    ▼
Proxy: resolve model → select provider → get key → call API
    │
    ▼
Return response with metadata (model, provider, response_time_ms)
```

### OpenCode Chat Flow
```
OpenCode -> POST /v1/chat/completions
              │
              ▼
    [Resolve model: aido/auto, aido/cloud, specific model]
              │
              ▼
    [Select provider based on mode]
              │
              ▼
    [Get API key with rotation (skip failed keys)]
              │
              ▼
    [Forward request to provider]
              │
              ▼
    [On success: clear key failure]
    [On 401/403/429: mark key failed, try next]
              │
              ▼
    [Filter SSE comments if streaming]
              │
              <-- Return response to OpenCode
```
