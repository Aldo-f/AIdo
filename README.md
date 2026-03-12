# aido

Lokale API key rotation proxy voor LLM providers.  
Roteert keys automatisch bij rate limits. Bijgehouden in SQLite.

---

## Vereisten

- **Node.js v22+** — controleer met `node --version`
- **npm**

> Node.js v22 heeft SQLite ingebouwd — geen extra native dependencies.

---

## Installatie

### Stap 1 — Uitpakken en dependencies installeren

```bash
tar -xzf aido-proxy.tar.gz
cd aido-proxy
npm install
```

### Stap 2 — `aido` commando beschikbaar maken

**Optie A: systeembreed** (vereist sudo, werkt voor alle users)
```bash
npm run install:global
```

**Optie B: alleen jouw user** (geen sudo nodig, aanbevolen)
```bash
npm run install:local
```

Zorg dat `~/.local/bin` in je PATH zit (éénmalig):
```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Stap 3 — Verifieer

```bash
aido --help
```

---

## Eerste gebruik

```bash
# 1. Voeg je Zen key toe
aido add sk-LXREfPN2uSYZ74VW4HLp...

# 2. Configureer je tools (Claude Code + OpenCode)
aido launch

# 3. Start de proxy
aido proxy

# 4. Test het
aido run "wat is 2+2"
```

---

## Alle commando's

### `aido add <key>`

Voegt een API key toe. Provider wordt automatisch herkend op basis van het key-formaat.

```bash
aido add sk-zen-key-hier...
aido add sk-ant-api03-anthropic-key...
aido add sk-proj-openai-key...

# Provider manueel opgeven
aido add some-key --provider groq
```

Opgeslagen in `.env` naast de project map:
```
ZEN_KEYS=key1,key2,key3
ANTHROPIC_KEYS=key1
```

### `aido run <prompt>`

Stuurt een prompt naar een model. Handig om snel te testen.

```bash
aido run "wat is 2+2"
aido run "schrijf een haiku" --model mimo-v2-flash-free
aido run "leg recursie uit" --provider zen --stream
```

### `aido models [provider]`

Haalt de beschikbare modellen op via jouw key. Resultaten worden 1 uur gecached.

```bash
aido models          # alle providers met een key
aido models zen      # alleen Zen
aido models --sync   # cache negeren, opnieuw ophalen
```

> Omdat de call gedaan wordt met jouw key, zie je exact welke modellen jouw account kan gebruiken.
> Een betaalde key kan meer modellen tonen dan een gratis key.

Vrije modellen op OpenCode Zen (op het moment van schrijven):

| Model ID                 | Naam                 |
|--------------------------|----------------------|
| `big-pickle`             | Big Pickle           |
| `mimo-v2-flash-free`     | MiMo V2 Flash        |
| `nemotron-3-super-free`  | Nemotron 3 Super     |
| `minimax-m2.5-free`      | MiniMax M2.5         |

### `aido proxy`

Start de proxy server op poort 4141 (instelbaar via `PROXY_PORT` in `.env`).

```bash
aido proxy
# [aido-proxy] Listening on http://localhost:4141
```

Routes:
| URL                    | Naar           |
|------------------------|----------------|
| `/v1/...`              | Zen (default)  |
| `/zen/v1/...`          | Zen expliciet  |
| `/openai/v1/...`       | OpenAI         |
| `/anthropic/...`       | Anthropic      |

### `aido launch`

Configureert Claude Code en/of OpenCode om de proxy te gebruiken.

```bash
aido launch                    # beide
aido launch --target claude    # alleen Claude Code
aido launch --target opencode  # alleen OpenCode
```

**Claude Code** — voegt toe aan `.bashrc` / `.zshrc`:
```bash
export ANTHROPIC_BASE_URL="http://localhost:4141/anthropic"
export ANTHROPIC_API_KEY="aido-proxy"
```

**OpenCode** — schrijft `~/.config/opencode/opencode.json`:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "aido/big-pickle",
  "provider": {
    "aido": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "AIdo Proxy (Zen)",
      "options": {
        "baseURL": "http://localhost:4141/v1",
        "apiKey": "aido-proxy"
      }
    }
  }
}
```

In OpenCode: `/models` → kies `aido/big-pickle` of een ander model.

### `aido status`

Toont geconfigureerde providers en rate-limited keys.

```bash
aido status

# Configured providers:
#   zen          2 keys
#   openai       1 key
#
# Rate-limited keys (1):
#   zen          ...gooTF  (until 14:30:00)
```

---

## Hoe rotatie werkt

1. Volgende beschikbare (niet-gelimiteerde) key wordt gebruikt
2. Bij `429` response: key gemarkeerd in SQLite + cooldown (default 1u, of `Retry-After` header)
3. Request herproefd met volgende key (max 3x)
4. Alle keys op → `503` teruggegeven aan de client

---

## Key-detectie formaten

| Formaat              | Provider   |
|----------------------|------------|
| `sk-ant-...`         | Anthropic  |
| `sk-proj-...`        | OpenAI     |
| `sk-` + 60+ tekens   | Zen        |
| `sk-` + korter       | OpenAI     |
| `gsk_...`            | Groq       |
| `AIza...`            | Google     |

---

## Development

```bash
npm test            # alle tests
npm run test:watch  # watch mode
```

---

## Git repo

```bash
# Kloon of kopieer de bestanden
git init
git add .
git commit -m "init"

# .env en aido.db staan in .gitignore — die worden nooit gecommit
```
