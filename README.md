# AIDO - Intelligent AI Assistant

A unified AI CLI that intelligently routes queries across multiple providers (Ollama, Docker Model Runner, OpenCode Zen, Google Gemini, OpenAI). Built with FastAPI for optimal performance.

## Architecture

AIDO follows the **DRY (Don't Repeat Yourself)** principle - all API logic is centralized in the FastAPI proxy server. The CLI is a thin wrapper that delegates everything to the proxy.

```
┌─────────────────────────────────────────────────────────────────┐
│                        aido.sh (CLI)                            │
│  - start/stop proxy                                             │
│  - help system                                                  │
│  - config management                                            │
│  - thin wrapper for queries (calls proxy)                      │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP localhost:11999
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Proxy Server (FastAPI)                       │
│  - /v1/query (CLI queries)                                      │
│  - /v1/chat/completions (OpenCode)                             │
│  - Key rotation with database persistence                      │
│  - Multi-provider fallback                                     │
│  - SSE filtering for streaming                                 │
└─────────────────────────┬───────────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
    ┌─────────┐      ┌─────────┐      ┌─────────┐
    │  Cloud  │      │  Ollama │      │   DMR   │
    │(Zen/Gem │      │ (local) │      │(Docker) │
    │ ini/OAI)│      └─────────┘      └─────────┘
    └─────────┘
```

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start the proxy
./aido.sh serve

# 3. Query using AIDO (proxy must be running)
./aido.sh run "Hello, help me write a function"

# 4. For OpenCode integration
./aido.sh connect opencode
# Then restart OpenCode
```

## Commands

All commands support `-h` or `--help` for detailed usage information.

| Command | Description |
|---------|-------------|
| `aido serve [port]` | Start proxy server (default: 11999) |
| `aido stop` | Stop proxy server |
| `aido status` | Show provider status |
| `aido run [query]` | Run a query or start interactive mode |
| `aido list` | List available models |
| `aido pull [model]` | Download a model from Ollama |
| `aido init` | Check all providers |
| `aido connect [client]` | Connect a client (opencode) |
| `aido auth [provider]` | Open auth page for provider |
| `aido key <action>` | Manage API keys |
| `aido session <action>` | Manage sessions |

## Meta Models

AIDO provides special meta-models for intelligent routing:

| Model | Behavior |
|-------|----------|
| `aido/auto` | Auto-select based on selection mode |
| `aido/cloud` | Only use cloud providers (Zen, Gemini, OpenAI) |
| `aido/local` | Only use local providers (Ollama, DMR) |

```bash
# Use with OpenCode
opencode -m aido/auto run "Hello"

# Or via API
curl -X POST http://localhost:11999/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "aido/auto", "messages": [{"role": "user", "content": "Hello"}]}'
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check + provider status |
| `/v1/models` | GET | List all available models |
| `/v1/chat/completions` | POST | OpenAI-compatible chat (for OpenCode) |
| `/v1/query` | POST | Simple query endpoint (for CLI) |
| `/chat/completions` | POST | Same as /v1/chat/completions |

### /v1/query Endpoint

Used by the CLI for simple queries:

```bash
curl -X POST http://localhost:11999/v1/query \
  -H "Content-Type: application/json" \
  -d '{"query": "Hello", "model": "aido/auto"}'

# Response includes metadata:
{
  "choices": [{"message": {"content": "Hello!"}}],
  "model": "llama3.2",
  "provider": "ollama",
  "response_time_ms": 1500,
  "query": "Hello"
}
```

## Configuration

### Connect to OpenCode

```bash
./aido.sh connect opencode
```

This configures OpenCode to use AIDO as a provider. After running:
1. Restart OpenCode
2. Run `aido serve`

### Add API Keys

To use cloud providers (Zen, Gemini, OpenAI), add API keys:

```bash
# Open auth page to get API key
./aido.sh auth zen

# Add the key to AIDO
./aido key add opencode-zen <your-api-key>

# Check keys
./aido key list

# Test keys
./aido key test opencode-zen
```

### Providers

AIDO supports multiple providers:

| Provider | Description | Requires Key |
|----------|-------------|--------------|
| ollama | Local Ollama instance | No |
| docker-model-runner | Docker Model Runner | No |
| opencode-zen | OpenCode Zen | Yes |
| gemini | Google Gemini | Yes |
| openai | OpenAI | Yes |

### Multi-Key Support with Persistence

You can add multiple API keys per provider. AIDO automatically handles:
- **Rate limits (HTTP 429)**: Tries next key, 5-minute cooldown
- **Auth errors (HTTP 401/403)**: Tries next key, 24-hour cooldown
- **All keys failed**: Tries next provider

Key failures are **persisted in SQLite database** (`~/.aido-data/aido.db`), so failed keys won't be retried until their cooldown expires.

```bash
# Add multiple keys
./aido key add opencode-zen sk-zen-xxx-1 "primary"
./aido key add opencode-zen sk-zen-xxx-2 "backup"

# List keys
./aido key list

# Delete a key by index
./aido key delete opencode-zen 1

# Test all keys
./aido key test opencode-zen
```

### Model Selection

AIDO supports three selection modes controlled by `selection.default_mode` in config:

| Mode | Behavior |
|------|----------|
| `cloud_first` | Prefer cloud providers (Zen, Gemini, OpenAI) first, fall back to local |
| `local_first` | Prefer local providers (Ollama, DMR) first, fall back to cloud |
| `auto` | Use cloud if keys available, otherwise local |

**Selection Priority:**
- `cloud_first`: OpenCode Zen → Gemini → OpenAI → Ollama → DMR
- `local_first`: Ollama → DMR → OpenCode Zen → Gemini → OpenAI

## Help System

Every command has detailed help available:

```bash
aido serve --help
aido run --help
aido key --help
aido connect --help
# etc.
```

## Examples

```bash
# Start proxy (required before queries)
aido serve

# Query with auto model selection
aido run "How do I reverse a list in Python?"

# Interactive mode
aido run

# Use local provider only
aido run -p local "Hello"

# List models
aido list

# Check status
aido status
```

## Install Globally

```bash
./aido.sh --install
```

This installs `aido` to `~/.local/bin/aido` (or `/usr/local/bin/aido`).

## Development

### File Structure

```
aido/
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
└── tests/
    └── aido_test.sh      # 44 tests
```

### Debug

```bash
# Check logs
tail -f ~/.aido-data/logs/proxy.log

# Check database
sqlite3 ~/.aido-data/aido.db "SELECT * FROM key_failures"

# Manual API test
curl http://localhost:11999/health
curl http://localhost:11999/v1/models
```

### Key Features

- **DRY Architecture**: All API logic in one place (proxy)
- **FastAPI**: High-performance async server
- **Key Persistence**: Failed keys stored in SQLite with cooldown
- **Provider Fallback**: Automatic cloud → local fallback
- **SSE Filtering**: Removes SSE comments from streaming responses
- **Help System**: Every command has `--help`
- **Meta Models**: `aido/auto`, `aido/cloud`, `aido/local`
