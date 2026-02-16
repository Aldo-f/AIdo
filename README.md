# AIDO - Intelligent AI Assistant

A unified AI CLI that intelligently routes queries across multiple providers (Ollama, Docker Model Runner, OpenCode Zen, Google Gemini, OpenAI).

## Quick Start

```bash
# 1. Start the proxy
./aido.sh serve

# 2. Connect OpenCode to use AIDO
./aido.sh connect opencode

# 3. Restart OpenCode

# 4. Query using AIDO
./aido.sh run "Hello, help me write a function"

# Or use directly
./aido.sh "Hello"
```

## Commands

| Command | Description |
|---------|-------------|
| `aido serve [port]` | Start proxy server (default: 11999) |
| `aido stop` | Stop proxy server |
| `aido status` | Show provider status |
| `aido list` | List available models |
| `aido run [query]` | Run a query or start interactive mode |
| `aido pull [model]` | Download a model |
| `aido init` | Check all providers |

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
| cloud | OpenAI | Yes |

### Multi-Key Support

You can add multiple API keys per provider. AIDO automatically handles:
- **Rate limits (HTTP 429)**: Tries next key
- **Auth errors (HTTP 401/403)**: Tries next key

```bash
# Add multiple keys
./aido key add opencode-zen sk-zen-xxx-1 "primary"
./aido key add opencode-zen sk-zen-xxx-2 "backup"

# List keys
./aido key list

# Delete a key by index
./aido key delete opencode-zen 1

# Delete all keys
./aido key delete-all opencode-zen

# Test all keys
./aido key test opencode-zen
```

### Model Selection

AIDO supports three selection modes controlled by `selection.default_mode` in config:

| Mode | Behavior |
|------|----------|
| `cloud_first` | Prefer cloud providers (Zen, Gemini, OpenAI) first, fall back to local |
| `local_first` | Prefer local providers (Ollama, DMR) first, fall back to cloud |
| `auto` | Use cloud if keys available, otherwise local (default) |

```bash
# View current config
./aido --config | jq '.selection'

# Change to cloud_first
./aido --config | jq '.selection = {"default_mode": "cloud_first"}' > /tmp/c.json
mv /tmp/c.json ~/.aido-data/config.json

# Change to local_first
./aido --config | jq '.selection = {"default_mode": "local_first"}' > /tmp/c.json
mv /tmp/c.json ~/.aido-data/config.json
```

**Selection Priority:**
- `cloud_first`: OpenCode Zen → Gemini → OpenAI → Ollama → DMR
- `local_first`: Ollama → DMR → OpenCode Zen → Gemini → OpenAI |

## Architecture

```
┌─────────────┐    localhost:11999     ┌─────────────┐
│  OpenCode   │ ◄────────────────────► │  AIDO Proxy │
│  (client)  │   OpenAI-compatible    │  (your AI)  │
└─────────────┘                        └──────┬──────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
            ┌───────────────┐         ┌───────────────┐         ┌───────────────┐
            │  OpenCode Zen │         │    Ollama     │         │    Gemini     │
            │   (API key)  │         │   (local)     │         │   (API key)   │
            └───────────────┘         └───────────────┘         └───────────────┘
```

## OpenCode Integration

### What does `aido connect opencode` do?

This command (similar to `ollama launch`) configures OpenCode to use AIDO as a provider:

1. Creates/updates `~/.config/opencode/opencode.jsonc`
2. Adds AIDO provider with `baseURL: http://localhost:11999`
3. Preserves existing OpenCode providers

### What does `aido auth zen` do?

Opens the OpenCode Zen auth page where you can:
- Log in to your OpenCode account
- Generate an API key

After getting the key, add it with:
```bash
aido key add opencode-zen <your-api-key>
```

## Examples

```bash
# Query with auto model selection
aido "How do I reverse a list in Python?"

# Use specific model
aido -p ollama "Hello"

# Interactive mode
aido run

# Continue last session
aido run -c

# List models
aido list

# Check status
aido status
```

## Install Globally

```bash
./aido.sh --install
```

This installs `aido` to `/usr/local/bin/aido`.
# Test
