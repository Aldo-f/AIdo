#!/usr/bin/env python3
"""
AIDO - Intelligent AI Assistant
Multi-provider AI assistant with intelligent model selection
Supports: Ollama, Docker Model Runner, OpenCode Zen, Google Gemini, OpenAI
"""

import argparse
import json
import os
import sys
import signal
import subprocess
import time
from pathlib import Path

import httpx

DATA_DIR = Path.home() / ".aido-data"
CONFIG_PATH = DATA_DIR / "config.json"
LOG_DIR = DATA_DIR / "logs"
SESSIONS_DIR = DATA_DIR / "sessions"
PID_FILE = DATA_DIR / "aido-proxy.pid"

DEFAULT_PORT = 11999

RED = "\033[0;31m"
GREEN = "\033[0;32m"
YELLOW = "\033[1;33m"
BLUE = "\033[0;34m"
CYAN = "\033[0;36m"
NC = "\033[0m"


def color_print(color: str, msg: str):
    print(f"{color}{msg}{NC}")


def error(msg: str):
    color_print(RED, f"[ERROR] {msg}")


def warning(msg: str):
    color_print(YELLOW, f"[WARNING] {msg}")


def success(msg: str):
    color_print(GREEN, f"[OK] {msg}")


def info(msg: str):
    color_print(CYAN, f"[INFO] {msg}")


def debug(msg: str, debug_mode: bool = False):
    if debug_mode:
        color_print(BLUE, f"[DEBUG] {msg}")


def init_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

    if not CONFIG_PATH.exists():
        default_config = {
            "providers": {
                "ollama": {
                    "enabled": True,
                    "endpoint": "http://localhost:11434",
                    "keys": [],
                },
                "docker-model-runner": {
                    "enabled": True,
                    "endpoint": "http://localhost:12434",
                    "keys": [],
                },
                "opencode-zen": {
                    "enabled": True,
                    "endpoint": "https://opencode.ai/zen",
                    "keys": [],
                },
                "gemini": {
                    "enabled": True,
                    "endpoint": "https://generativelanguage.googleapis.com",
                    "keys": [],
                },
                "openai": {
                    "enabled": False,
                    "endpoint": "https://api.openai.com",
                    "keys": [],
                },
            },
            "selection": {"default_mode": "cloud_first"},
            "ui": {"debug_mode": False, "show_timing": True},
        }
        with open(CONFIG_PATH, "w") as f:
            json.dump(default_config, f, indent=2)


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        init_data_dir()
    with open(CONFIG_PATH) as f:
        return json.load(f)


def save_config(config: dict):
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)


def get_provider_keys(provider: str) -> list[dict]:
    config = load_config()
    return config.get("providers", {}).get(provider, {}).get("keys", [])


def normalize_provider_name(provider: str) -> str:
    mapping = {
        "zen": "opencode-zen",
        "dmr": "docker-model-runner",
        "openai": "openai",
        "cloud": "openai",
    }
    return mapping.get(provider, provider)


def open_url(url: str):
    if sys.platform == "win32":
        os.startfile(url)
    elif sys.platform == "darwin":
        subprocess.run(["open", url])
    else:
        subprocess.run(["xdg-open", url])


def is_proxy_running(port: int = DEFAULT_PORT) -> bool:
    try:
        with httpx.Client(timeout=2.0) as client:
            resp = client.get(f"http://localhost:{port}/health")
            return resp.status_code == 200
    except Exception:
        return False


def stream_response(response: httpx.Response):
    try:
        for line in response.iter_lines():
            if not line:
                continue
            if line.startswith("data: "):
                data = line[6:]
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    if "choices" in chunk:
                        for choice in chunk["choices"]:
                            delta = choice.get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                print(content, end="", flush=True)
                except json.JSONDecodeError:
                    continue
            elif line.startswith("{"):
                try:
                    error_data = json.loads(line)
                    if "error" in error_data:
                        print(f"\n[ERROR] {error_data['error']}", flush=True)
                except json.JSONDecodeError:
                    pass
    except Exception as e:
        print(f"\n[WARNING] Stream ended unexpectedly: {e}", flush=True)
    print()


def execute_query(
    query: str,
    model: str = "aido/auto",
    stream: bool = True,
    port: int = DEFAULT_PORT,
    session: str | None = None,
):
    if not is_proxy_running(port):
        error("AIDO proxy is not running. Run 'aido serve' first.")
        return 1

    url = f"http://localhost:{port}/v1/query"
    payload = {"query": query, "model": model, "stream": stream}
    if session:
        payload["session_id"] = session

    try:
        with httpx.Client(timeout=120.0) as client:
            if stream:
                try:
                    response = client.post(url, json=payload)
                    if response.status_code != 200:
                        error(f"Request failed: {response.status_code}")
                        return 1

                    content_type = response.headers.get("content-type", "")
                    if "text/event-stream" in content_type:
                        stream_response(response)
                    else:
                        data = response.json()
                        if "choices" in data:
                            content = data["choices"][0]["message"]["content"]
                            print(content)
                        elif "error" in data:
                            error(data["error"])
                            return 1
                except (
                    httpx.RemoteProtocolError,
                    httpx.ConnectError,
                    httpx.ReadTimeout,
                ) as e:
                    warning(f"Streaming failed: {e}")
                    warning("Trying non-streaming mode...")
                    stream = False
                except Exception as e:
                    warning(f"Streaming error: {e}")
                    warning("Trying non-streaming mode...")
                    stream = False

            if not stream:
                payload["stream"] = False
                response = client.post(url, json=payload)
                if response.status_code != 200:
                    error(f"Request failed: {response.status_code}")
                    try:
                        error_data = response.json()
                        if "error" in error_data:
                            error(error_data["error"])
                    except Exception:
                        pass
                    return 1
                data = response.json()
                if "choices" in data:
                    content = data["choices"][0]["message"]["content"]
                    print(content)
                elif "error" in data:
                    error(data["error"])
                    return 1
                elif "response" in data:
                    print(data["response"])
    except Exception as e:
        error(f"Query failed: {e}")
        return 1

    return 0


def cmd_serve(args):
    if is_proxy_running(args.port):
        info(f"Proxy already running on port {args.port}")
        return 0

    proxy_dir = Path(__file__).parent.resolve()
    os.environ["PYTHONPATH"] = str(proxy_dir)

    info(f"Starting AIDO Proxy on port {args.port}...")

    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "proxy.server:app",
            "--host",
            "0.0.0.0",
            "--port",
            str(args.port),
        ],
        cwd=str(proxy_dir),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    with open(PID_FILE, "w") as f:
        f.write(str(process.pid))

    time.sleep(2)

    if is_proxy_running(args.port):
        success(f"AIDO Proxy started on port {args.port} (PID {process.pid})")
        return 0
    else:
        error("Failed to start AIDO Proxy")
        PID_FILE.unlink(missing_ok=True)
        return 1


def cmd_stop(args):
    if PID_FILE.exists():
        try:
            pid = int(PID_FILE.read_text().strip())
            os.kill(pid, signal.SIGTERM)
            PID_FILE.unlink()
            success("AIDO Proxy stopped")
            return 0
        except ProcessLookupError:
            PID_FILE.unlink(missing_ok=True)
        except Exception as e:
            error(f"Failed to stop proxy: {e}")

    if sys.platform != "win32":
        try:
            result = subprocess.run(
                ["lsof", "-ti", f":{DEFAULT_PORT}"], capture_output=True, text=True
            )
            if result.returncode == 0 and result.stdout.strip():
                subprocess.run(
                    ["kill", "-9"] + result.stdout.strip().split(), capture_output=True
                )
                success("AIDO Proxy stopped")
                return 0
        except FileNotFoundError:
            pass

    info("AIDO Proxy is not running")
    return 0


def cmd_status(args):
    if not is_proxy_running():
        print("AIDO Proxy is not running")
        return 0

    try:
        with httpx.Client(timeout=2.0) as client:
            resp = client.get(f"http://localhost:{DEFAULT_PORT}/health")
            data = resp.json()
            print("AIDO Proxy is running")
            print(f"Providers: {', '.join(data.get('providers', []))}")
    except Exception as e:
        error(f"Failed to get status: {e}")

    return 0


def cmd_list(args):
    if not is_proxy_running():
        error("AIDO proxy is not running. Run 'aido serve' first.")
        return 1

    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(f"http://localhost:{DEFAULT_PORT}/v1/models")
            data = resp.json()
            print(f"{CYAN}Available Models:{NC}")
            for model in data.get("data", []):
                owned_by = model.get("owned_by", "unknown")
                model_id = model.get("id", "unknown")
                print(f"  {model_id} [{owned_by}]")
    except Exception as e:
        error(f"Failed to list models: {e}")
        return 1

    return 0


def cmd_providers(args):
    config = load_config()
    print(f"{CYAN}Providers:{NC}")
    for name, prov in config.get("providers", {}).items():
        enabled = prov.get("enabled", False)
        status = "enabled" if enabled else "disabled"
        keys = len(prov.get("keys", []))
        print(f"  {name}: {status} ({keys} keys)")
    return 0


def cmd_run(args):
    model = getattr(args, "model", "aido/auto")
    session = getattr(args, "session", None)
    if not args.query:
        info("Interactive mode - type /help for commands, /exit to quit")
        print()
        while True:
            try:
                query = input(f"{BLUE}>{NC} ").strip()
            except EOFError:
                break

            if not query:
                continue

            if query.startswith("/"):
                if query in ("/exit", "/quit"):
                    print("Goodbye!")
                    break
                elif query in ("/help", "/h"):
                    print("Commands: /help, /exit, /models, /providers, /status")
                elif query == "/models":
                    cmd_list(argparse.Namespace())
                elif query == "/providers":
                    cmd_providers(argparse.Namespace())
                elif query == "/status":
                    cmd_status(argparse.Namespace())
                else:
                    warning(f"Unknown command: {query}")
                continue

            execute_query(
                query, model=model, stream=not args.no_stream, session=session
            )
            print()
        return 0

    return execute_query(
        " ".join(args.query), model=model, stream=not args.no_stream, session=session
    )


def cmd_pull(args):
    model = args.model

    if sys.platform == "win32":
        warning("On Windows, please run 'ollama pull' manually")
        return 1

    try:
        if (
            subprocess.run(
                ["docker", "ps", "--format", "{{.Names}}"], capture_output=True
            ).returncode
            == 0
        ):
            result = subprocess.run(
                ["docker", "ps", "--format", "{{.Names}}"],
                capture_output=True,
                text=True,
            )
            if "ollama" in result.stdout:
                info(f"Installing {model} via Docker...")
                subprocess.run(["docker", "exec", "ollama", "ollama", "pull", model])
                success(f"Installed: {model}")
                return 0
    except FileNotFoundError:
        pass

    try:
        if subprocess.run(["ollama", "--version"], capture_output=True).returncode == 0:
            info(f"Installing {model} via ollama...")
            subprocess.run(["ollama", "pull", model])
            success(f"Installed: {model}")
            return 0
    except FileNotFoundError:
        pass

    error("Ollama not found. Install from https://ollama.com")
    return 1


def cmd_key(args):
    action = args.action
    provider = args.provider
    key = args.key
    name = args.name or "default"

    if action == "list":
        config = load_config()
        print(f"{CYAN}API Keys:{NC}")
        for prov_name, prov_config in config.get("providers", {}).items():
            keys = prov_config.get("keys", [])
            print(f"{GREEN}{prov_name}:{NC} {len(keys)} key(s)")
            for i, k in enumerate(keys):
                masked = f"**{k['key'][-4:]}" if len(k["key"]) > 4 else k["key"]
                print(f"  [{i}] {masked} ({k.get('name', 'default')})")
        return 0

    if action == "add":
        if not provider or not key:
            error("Usage: aido key add <provider> <key> [name]")
            return 1
        provider = normalize_provider_name(provider)
        config = load_config()
        if provider not in config["providers"]:
            config["providers"][provider] = {"enabled": True, "keys": []}
        config["providers"][provider].setdefault("keys", []).append(
            {"key": key, "name": name}
        )
        save_config(config)
        success(f"Added key for {provider}")
        return 0

    if action == "delete":
        if provider is None:
            error("Usage: aido key delete <provider> <index>")
            return 1
        provider = normalize_provider_name(provider)
        config = load_config()
        keys = config["providers"].get(provider, {}).get("keys", [])
        if key is None or int(key) >= len(keys):
            error("Invalid index")
            return 1
        del keys[int(key)]
        save_config(config)
        success(f"Deleted key {key} from {provider}")
        return 0

    if action == "delete-all":
        if not provider:
            error("Usage: aido key delete-all <provider>")
            return 1
        provider = normalize_provider_name(provider)
        config = load_config()
        if provider in config["providers"]:
            config["providers"][provider]["keys"] = []
            save_config(config)
            success(f"Deleted all keys from {provider}")
        return 0

    error(f"Unknown action: {action}")
    return 1


def cmd_init(args):
    init_data_dir()
    config = load_config()

    print(f"{CYAN}AIDO Init{NC}")
    print("=========")
    print()
    print(f"{CYAN}Checking providers...{NC}")
    print()

    for prov_name, prov_config in config.get("providers", {}).items():
        enabled = prov_config.get("enabled", False)
        endpoint = prov_config.get("endpoint", "")
        keys = prov_config.get("keys", [])

        print(f"{prov_name:24} ", end="")

        if not enabled:
            print(f"{YELLOW}Disabled{NC}")
            continue

        if prov_name in ("ollama", "docker-model-runner"):
            try:
                with httpx.Client(timeout=2.0) as client:
                    if prov_name == "ollama":
                        resp = client.get(f"{endpoint}/api/tags")
                    else:
                        resp = client.get(f"{endpoint}/models")
                    if resp.status_code == 200:
                        print(f"{GREEN}Running{NC}")
                    else:
                        print(f"{RED}Not running{NC}")
            except Exception:
                print(f"{RED}Not running{NC}")
        else:
            if keys:
                print(f"{GREEN}Ready ({len(keys)} key(s)){NC}")
            else:
                print(f"{YELLOW}No keys - run 'aido auth {prov_name}'{NC}")

    print()
    print("Use 'aido status' for detailed info")
    print("Use 'aido key add <provider> <key>' to add API keys")
    return 0


def cmd_auth(args):
    provider = args.provider

    urls = {
        "zen": "https://opencode.ai/auth",
        "opencode-zen": "https://opencode.ai/auth",
        "gemini": "https://aistudio.google.com/app/apikey",
        "openai": "https://platform.openai.com/settings/organization/api-keys",
    }

    if not provider:
        print(f"{CYAN}AIDO Auth Providers{NC}")
        print("=====================")
        print()
        for name, url in urls.items():
            print(f"  {name:12} {url}")
        print()
        print("Usage: aido auth <provider>")
        return 0

    url = urls.get(provider) or urls.get(normalize_provider_name(provider))
    if not url:
        error(f"Unknown provider: {provider}")
        return 1

    info(f"Opening: {url}")
    open_url(url)
    return 0


def cmd_connect(args):
    client = args.client or "opencode"

    if client != "opencode":
        error(f"Unknown client: {client}")
        return 1

    config_dir = Path.home() / ".config" / "opencode"
    config_file = config_dir / "opencode.jsonc"

    print(f"{CYAN}Connecting to OpenCode...{NC}")
    print()

    config_dir.mkdir(parents=True, exist_ok=True)

    aido_provider = {
        "aido": {
            "name": "AIDO",
            "options": {
                "baseURL": f"http://localhost:{DEFAULT_PORT}",
                "apiKey": "dummy",
            },
        }
    }

    if config_file.exists():
        print("Updating existing OpenCode config...")
        try:
            with open(config_file) as f:
                existing = json.load(f)
        except json.JSONDecodeError:
            existing = {}

        if "provider" not in existing:
            existing["provider"] = {}
        existing["provider"].update(aido_provider)

        with open(config_file, "w") as f:
            json.dump(existing, f, indent=2)
    else:
        print("Creating new OpenCode config...")
        new_config = {"provider": aido_provider, "model": "auto"}
        with open(config_file, "w") as f:
            json.dump(new_config, f, indent=2)

    success("OpenCode configured successfully!")
    print()
    print(f"Config written to: {config_file}")
    print()
    print("To use AIDO in OpenCode:")
    print("  1. Restart OpenCode")
    print("  2. Run 'aido serve' to start the proxy")
    print()
    print("To add API keys:")
    print("  aido auth zen")
    print("  aido key add opencode-zen <your-api-key>")
    return 0


def get_session(session_name: str) -> dict | None:
    session_file = SESSIONS_DIR / f"session-{session_name}.json"
    if session_file.exists():
        with open(session_file) as f:
            return json.load(f)
    return None


def update_session_provider(session_name: str, provider: str, model: str):
    session_file = SESSIONS_DIR / f"session-{session_name}.json"
    if session_file.exists():
        with open(session_file) as f:
            session_data = json.load(f)
        session_data["cached_provider"] = provider
        session_data["cached_model"] = model
        with open(session_file, "w") as f:
            json.dump(session_data, f, indent=2)


def cmd_session(args):
    action = args.action

    if action == "list":
        if not SESSIONS_DIR.exists():
            print("No sessions found")
            return 0
        sessions = list(SESSIONS_DIR.glob("session-*.json"))
        if not sessions:
            print("No sessions found")
        else:
            for s in sessions:
                print(f"  {s.stem}")
        return 0

    if action == "new":
        name = args.name
        if not name:
            error("Usage: aido session new <name>")
            return 1
        session_file = SESSIONS_DIR / f"session-{name}.json"
        session_data = {
            "session_id": f"session-{name}",
            "name": name,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "messages": [],
            "cached_provider": None,
            "cached_model": None,
        }
        with open(session_file, "w") as f:
            json.dump(session_data, f, indent=2)
        success(f"Created session: {name}")
        return 0

    if action == "delete":
        name = args.name
        if not name:
            error("Usage: aido session delete <name>")
            return 1
        session_file = SESSIONS_DIR / f"session-{name}.json"
        if session_file.exists():
            session_file.unlink()
            success(f"Deleted session: {name}")
        else:
            error(f"Session not found: {name}")
        return 0

    error(f"Unknown action: {action}")
    return 1


def main():
    parser = argparse.ArgumentParser(
        prog="aido",
        description="AIDO - Intelligent AI Assistant",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    subparsers = parser.add_subparsers(dest="command", help="Commands")

    serve_parser = subparsers.add_parser("serve", help="Start proxy server")
    serve_parser.add_argument(
        "port", nargs="?", type=int, default=DEFAULT_PORT, help="Port number"
    )
    serve_parser.set_defaults(func=cmd_serve)

    stop_parser = subparsers.add_parser("stop", help="Stop proxy server")
    stop_parser.set_defaults(func=cmd_stop)

    status_parser = subparsers.add_parser("status", help="Show status")
    status_parser.set_defaults(func=cmd_status)

    list_parser = subparsers.add_parser("list", help="List models")
    list_parser.set_defaults(func=cmd_list)

    providers_parser = subparsers.add_parser("providers", help="List providers")
    providers_parser.set_defaults(func=cmd_providers)

    run_parser = subparsers.add_parser(
        "run",
        help="Run query or interactive mode",
        description="""Models:
  aido/auto   Auto-select based on config (default)
  aido/cloud  Cloud providers only (Zen, Gemini, OpenAI)
  aido/local  Local providers only (Ollama, DMR)

Examples:
  aido run "Hello"                    # Uses aido/auto
  aido run --model aido/local "Hello" # Force local model
  aido run --model aido/cloud "Hello" # Force cloud model""",
    )
    run_parser.add_argument("query", nargs="*", help="Query to run")
    run_parser.add_argument(
        "--no-stream", action="store_true", help="Disable streaming"
    )
    run_parser.add_argument(
        "--model",
        "-m",
        default="aido/auto",
        help="Model to use: aido/auto, aido/cloud, aido/local (default: aido/auto)",
    )
    run_parser.add_argument(
        "--session", "-s", default=None, help="Session name for conversation context"
    )
    run_parser.set_defaults(func=cmd_run)

    pull_parser = subparsers.add_parser("pull", help="Download model")
    pull_parser.add_argument("model", help="Model to download")
    pull_parser.set_defaults(func=cmd_pull)

    key_parser = subparsers.add_parser("key", help="Manage API keys")
    key_parser.add_argument(
        "action", choices=["list", "add", "delete", "delete-all"], help="Action"
    )
    key_parser.add_argument("provider", nargs="?", help="Provider name")
    key_parser.add_argument("key", nargs="?", help="Key or index")
    key_parser.add_argument("name", nargs="?", help="Key name (for add)")
    key_parser.set_defaults(func=cmd_key)

    init_parser = subparsers.add_parser("init", help="Initialize AIDO")
    init_parser.set_defaults(func=cmd_init)

    auth_parser = subparsers.add_parser("auth", help="Open auth page")
    auth_parser.add_argument("provider", nargs="?", help="Provider name")
    auth_parser.set_defaults(func=cmd_auth)

    connect_parser = subparsers.add_parser("connect", help="Configure client")
    connect_parser.add_argument("client", nargs="?", help="Client name (opencode)")
    connect_parser.set_defaults(func=cmd_connect)

    session_parser = subparsers.add_parser("session", help="Manage sessions")
    session_parser.add_argument(
        "action", choices=["list", "new", "delete"], help="Action"
    )
    session_parser.add_argument("name", nargs="?", help="Session name")
    session_parser.set_defaults(func=cmd_session)

    parser.add_argument("--version", "-v", action="version", version="AIDO 1.0.0")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 0

    init_data_dir()

    if hasattr(args, "func"):
        return args.func(args)

    return 0


if __name__ == "__main__":
    sys.exit(main())
