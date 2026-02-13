#!/usr/bin/env python3
"""
AIDO Proxy - Transparent proxy for intelligent model selection
OpenAI-compatible API that automatically selects the best model
"""

import os
import sys
import json
import signal
import socket
import threading
import datetime
import uuid
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import urllib.request
import urllib.error

# Configuration
DEFAULT_PORT = 11999
DATA_DIR = Path(os.path.expanduser("~/.aido-data"))
CONFIG_FILE = DATA_DIR / "config.json"
PID_FILE = DATA_DIR / "aido-proxy.pid"
LOG_FILE = DATA_DIR / "logs" / "proxy.log"

# Check both DATA_DIR and SCRIPT_DIR for config
SCRIPT_DIR = Path(__file__).parent.resolve()
if not (DATA_DIR / "config.json").exists():
    # Use SCRIPT_DIR as fallback for config
    DATA_DIR = SCRIPT_DIR.parent

# Provider endpoints
OLLAMA_ENDPOINT = os.environ.get("OLLAMA_ENDPOINT", "http://localhost:11434")
DMR_ENDPOINT = os.environ.get("DMR_ENDPOINT", "http://localhost:12434")

# Ensure log directory exists
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)


def log(message, level="INFO"):
    """Log message to both stdout and file"""
    timestamp = datetime.datetime.now().isoformat()
    log_line = f"[{timestamp}] [{level}] {message}"
    print(log_line)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(log_line + "\n")
    except Exception as e:
        print(f"[WARN] Could not write to log file: {e}")


def load_config():
    """Load AIDO configuration"""
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {
        "providers": {
            "ollama": {"enabled": True, "priority": 1, "endpoint": OLLAMA_ENDPOINT},
            "docker-model-runner": {
                "enabled": True,
                "priority": 2,
                "endpoint": DMR_ENDPOINT,
            },
            "cloud": {
                "enabled": False,
                "priority": 3,
                "endpoint": "https://api.openai.com",
            },
        },
        "proxy": {"enabled": True, "port": DEFAULT_PORT, "default_model": "auto"},
    }


def detect_providers():
    """Detect available providers"""
    log("Detecting available providers...")
    config = load_config()
    providers = config.get("providers", {})

    available = {}

    # Check Ollama
    try:
        req = urllib.request.Request(f"{OLLAMA_ENDPOINT}/api/tags")
        with urllib.request.urlopen(req, timeout=2) as resp:
            models = json.load(resp).get("models", [])
            model_names = [m["name"] for m in models]
            available["ollama"] = {
                "endpoint": OLLAMA_ENDPOINT,
                "models": model_names,
                "status": "running",
            }
            log(f"Ollama: running, {len(model_names)} models: {model_names}")
    except Exception as e:
        available["ollama"] = {
            "status": "not running",
            "models": [],
            "endpoint": OLLAMA_ENDPOINT,
        }
        log(f"Ollama: not running - {e}", "WARN")

    # Check Docker Model Runner
    try:
        req = urllib.request.Request(f"{DMR_ENDPOINT}/models")
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.load(resp)
            models = data.get("data", [])
            model_names = [m.get("id") for m in models if m.get("id")]
            available["docker-model-runner"] = {
                "endpoint": DMR_ENDPOINT,
                "models": model_names,
                "status": "running",
            }
            log(f"DMR: running, {len(model_names)} models: {model_names}")
    except Exception as e:
        available["docker-model-runner"] = {
            "status": "not running",
            "models": [],
            "endpoint": DMR_ENDPOINT,
        }
        log(f"DMR: not running - {e}", "WARN")

    return available


def analyze_prompt(prompt):
    """Analyze prompt to determine best model"""
    prompt_lower = prompt.lower()

    # Detect capabilities
    capabilities = []

    if any(
        w in prompt_lower
        for w in ["code", "programming", "debug", "fix", "function", "script"]
    ):
        capabilities.append("coding")

    if any(
        w in prompt_lower
        for w in ["image", "picture", "visual", "diagram", "photo", "wat zie"]
    ):
        capabilities.append("vision")

    if any(
        w in prompt_lower for w in ["explain", "analyze", "compare", "think", "reason"]
    ):
        capabilities.append("reasoning")

    if not capabilities:
        capabilities = ["general"]

    return capabilities


def select_model(prompt, provider_hint=None):
    """Select best model for the given prompt"""
    log(f"Selecting model for prompt (length: {len(prompt)} chars)")
    available = detect_providers()

    if not available or all(p.get("status") != "running" for p in available.values()):
        log("No providers running, attempting fallback to llama3.2", "ERROR")
        try:
            return "llama3.2", "ollama", OLLAMA_ENDPOINT
        except:
            return None, None, None

    # Get first available provider (sorted by priority)
    # Filter out cloud models (they require authentication)
    cloud_suffixes = ["-cloud", ":cloud"]

    for name, info in available.items():
        if info.get("status") == "running" and info.get("models"):
            # Filter models: prefer local models over cloud models
            local_models = [
                m for m in info["models"] if not any(s in m for s in cloud_suffixes)
            ]

            if local_models:
                model = local_models[0]  # Pick first local model
                log(f"Selected model: {model} (local) from provider: {name}")
                return model, name, info["endpoint"]

            # Fallback to cloud models if no local models available
            if info["models"]:
                model = info["models"][0]
                log(f"Selected model: {model} (cloud) from provider: {name}", "WARN")
                return model, name, info["endpoint"]

    log("No models available from any provider", "ERROR")
    return None, None, None


def forward_request(endpoint, path, data, stream=False):
    """Forward request to provider"""
    url = f"{endpoint}{path}"

    request_id = str(uuid.uuid4())[:8]
    log(f"[{request_id}] Forwarding request to {url}")

    headers = {"Content-Type": "application/json"}

    req = urllib.request.Request(
        url, data=data.encode() if data else None, headers=headers, method="POST"
    )

    try:
        start_time = datetime.datetime.now()
        if stream:
            response = urllib.request.urlopen(req, timeout=300)
        else:
            with urllib.request.urlopen(req, timeout=300) as resp:
                response = resp.read().decode()

        duration = (datetime.datetime.now() - start_time).total_seconds()
        log(f"[{request_id}] Request successful ({duration:.2f}s)")
        return response
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else ""
        log(
            f"[{request_id}] HTTP Error {e.code}: {e.reason} - {error_body[:200]}",
            "ERROR",
        )
        return json.dumps(
            {"error": f"HTTP {e.code}: {e.reason}", "detail": error_body[:500]}
        )
    except Exception as e:
        log(
            f"[{request_id}] Request failed: {type(e).__name__}: {str(e)[:200]}",
            "ERROR",
        )
        return json.dumps({"error": str(e)})


class AIDOProxyHandler(BaseHTTPRequestHandler):
    """HTTP handler for AIDO Proxy"""

    def log_message(self, format, *args):
        """Custom logging"""
        log(f"HTTP: {args[0]}")

    def do_GET(self):
        """Handle GET requests"""
        log(f"GET {self.path}")
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/models" or path == "/v1/models":
            self.send_models_list()
        elif path == "/health":
            self.send_health()
        elif path == "/":
            self.send_welcome()
        else:
            self.send_error(404, "Not Found")

    def do_POST(self):
        """Handle POST requests"""
        request_id = str(uuid.uuid4())[:8]
        log(f"[{request_id}] POST {self.path}")

        parsed = urlparse(self.path)
        path = parsed.path

        # Read request body
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode() if content_length > 0 else ""

        # Log request info (truncated for privacy)
        body_preview = body[:200] if body else ""
        log(f"[{request_id}] Request body: {body_preview}...")

        if path == "/chat/completions" or path == "/v1/chat/completions":
            self.handle_chat_completions(body, request_id)
        elif path == "/completions" or path == "/v1/completions":
            self.handle_completions(body, request_id)
        else:
            log(f"[{request_id}] 404 Not Found", "WARN")
            self.send_error(404, "Not Found")

    def send_json(self, data, status=200):
        """Send JSON response"""
        response = json.dumps(data)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response.encode())

    def send_models_list(self):
        """Send available models list"""
        available = detect_providers()

        models = []
        for provider_name, info in available.items():
            if info.get("status") == "running":
                for model_name in info.get("models", []):
                    models.append(
                        {
                            "id": model_name,
                            "object": "model",
                            "created": 0,
                            "owned_by": provider_name,
                        }
                    )

        self.send_json({"object": "list", "data": models})

    def send_health(self):
        """Health check"""
        available = detect_providers()
        running = [k for k, v in available.items() if v.get("status") == "running"]
        self.send_json({"status": "ok", "providers": running})

    def send_welcome(self):
        """Welcome message"""
        self.send_json(
            {
                "name": "AIDO Proxy",
                "version": "1.0.0",
                "description": "Transparent AI model proxy with intelligent selection",
            }
        )

    def handle_chat_completions(self, body, request_id="unknown"):
        """Handle chat completions request"""
        log(f"[{request_id}] Processing chat completions")

        try:
            request_data = json.loads(body) if body else {}
        except:
            log(f"[{request_id}] Invalid JSON in request", "ERROR")
            self.send_json({"error": "Invalid JSON"}, 400)
            return

        # Get prompt from messages
        messages = request_data.get("messages", [])
        if not messages:
            # Try 'prompt' for non-chat format
            prompt = request_data.get("prompt", "")
        else:
            # Combine all messages into prompt
            prompt = "\n".join(
                [f"{m.get('role', 'user')}: {m.get('content', '')}" for m in messages]
            )

        # Get the user message
        user_message = next(
            (m["content"] for m in messages if m.get("role") == "user"), prompt
        )

        # Log user message preview (truncated)
        log(f"[{request_id}] User message: {user_message[:100]}...")

        # Select best model
        model, provider, endpoint = select_model(user_message)

        if not model:
            log(f"[{request_id}] No models available", "ERROR")
            self.send_json({"error": "No models available"}, 503)
            return

        log(f"[{request_id}] Using model: {model} (provider: {provider})")

        # Forward to provider (Ollama format)
        if provider == "ollama":
            # Use /api/chat for proper chat handling
            ollama_data = {
                "model": model,
                "messages": messages,
                "stream": request_data.get("stream", False),
            }

            result = forward_request(endpoint, "/api/chat", json.dumps(ollama_data))

            # Convert back to OpenAI format
            try:
                ollama_result = json.loads(result)
                # Ollama chat API returns: {"message": {"role": "assistant", "content": "..."}, ...}
                response_content = ollama_result.get("message", {}).get("content", "")
                response = {
                    "id": "chatcmpl-" + os.urandom(8).hex(),
                    "object": "chat.completion",
                    "created": 0,
                    "model": model,
                    "choices": [
                        {
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": response_content,
                            },
                            "finish_reason": "stop",
                        }
                    ],
                }
                log(f"[{request_id}] Response: {response_content[:100]}...")
                self.send_json(response)
            except Exception as e:
                log(f"[{request_id}] Error parsing response: {e}", "ERROR")
                log(
                    f"[{request_id}] Raw response (first 500 chars): {result[:500]}",
                    "ERROR",
                )
                self.send_json({"error": str(e), "detail": result[:500]}, 500)
        else:
            # Docker Model Runner - use OpenAI format
            log(f"[{request_id}] Forwarding to DMR")
            result = forward_request(endpoint, "/v1/chat/completions", body)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(result.encode())
            log(f"[{request_id}] Response sent to client")

    def handle_completions(self, body, request_id="unknown"):
        """Handle completions request"""
        # Similar to chat_completions but for /completions endpoint
        self.handle_chat_completions(body, request_id)


def run_server(port=DEFAULT_PORT):
    """Run the proxy server"""
    log(f"Starting AIDO Proxy on port {port}")
    server = HTTPServer(("0.0.0.0", port), AIDOProxyHandler)
    log(f"OpenAI-compatible endpoint: http://localhost:{port}/v1")
    log("Proxy ready - press Ctrl+C to stop")

    # Save PID
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("Shutting down...")
        server.shutdown()
        if PID_FILE.exists():
            PID_FILE.unlink()


def stop_server():
    """Stop the proxy server"""
    if PID_FILE.exists():
        with open(PID_FILE) as f:
            pid = int(f.read().strip())
        try:
            os.kill(pid, signal.SIGTERM)
            log("Proxy stopped")
            PID_FILE.unlink()
            return True
        except ProcessLookupError:
            log("Process not found, removing stale PID file", "WARN")
            PID_FILE.unlink()
            return False
    else:
        log("No PID file found - is the proxy running?", "WARN")
        return False


def check_status():
    """Check if proxy is running"""
    if PID_FILE.exists():
        with open(PID_FILE) as f:
            pid = int(f.read().strip())
        try:
            os.kill(pid, 0)
            log(f"Proxy is running (PID: {pid})")
            return True
        except ProcessLookupError:
            log("Proxy is not running (stale PID)", "WARN")
            return False
    else:
        print("[AIDO] Proxy is not running")
        return False


def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="AIDO Proxy")
    parser.add_argument(
        "command", choices=["start", "stop", "status"], help="Command to run"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Port to run on (default: {DEFAULT_PORT})",
    )

    args = parser.parse_args()

    if args.command == "start":
        run_server(args.port)
    elif args.command == "stop":
        stop_server()
    elif args.command == "status":
        check_status()


if __name__ == "__main__":
    main()
