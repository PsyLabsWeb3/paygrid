#!/usr/bin/env python3
"""Read-only Docker deployment audit. Never output environment values."""
import json
import subprocess
import sys


def environment(container):
    return dict(item.split("=", 1) for item in container.get("Config", {}).get("Env", []) if "=" in item)


def audit(backend, worker):
    b, w = environment(backend), environment(worker)
    checks = {
        "backendRunning": backend.get("State", {}).get("Running") is True,
        "workerRunning": worker.get("State", {}).get("Running") is True,
        "workerCommandCorrect": worker.get("Config", {}).get("Cmd") == ["npm", "run", "x402:worker:start"],
        "workerSigningFlagsOff": all(w.get(key) == "false" for key in ("X402_SELLER_ENABLED", "X402_PAYER_ENABLED")),
        "workerHasNoPayerPrivateKey": not bool(w.get("X402_PAYER_PRIVATE_KEY")),
        "sameMainnet": b.get("CHAIN_ID") == w.get("CHAIN_ID") == "42220",
        "samePayer": b.get("X402_PAYER_ADDRESS", "").lower() == w.get("X402_PAYER_ADDRESS", "").lower() == "0xfb44350f335a823244c1c59948bcc838f81afa34",
        "facilitatorKeyMatches": bool(b.get("X402_API_KEY")) and b.get("X402_API_KEY") == w.get("X402_API_KEY"),
        "encryptionKeyMatches": len(b.get("X402_ENCRYPTION_KEY", "")) == 64 and b.get("X402_ENCRYPTION_KEY") == w.get("X402_ENCRYPTION_KEY"),
        "databaseMatches": bool(b.get("SUPABASE_URL")) and b.get("SUPABASE_URL") == w.get("SUPABASE_URL") and bool(b.get("SUPABASE_SERVICE_ROLE_KEY")) and b.get("SUPABASE_SERVICE_ROLE_KEY") == w.get("SUPABASE_SERVICE_ROLE_KEY"),
    }
    return {"ok": all(checks.values()), "checks": checks, "workerRestartCount": worker.get("RestartCount"),
            "backendStartedAt": backend.get("State", {}).get("StartedAt"),
            "workerStartedAt": worker.get("State", {}).get("StartedAt")}


def inspect_service(service):
    compose = ["docker", "compose", "-f", "docker-compose.prod.yml"]
    result = subprocess.run(compose + ["ps", "--all", "-q", service], capture_output=True, text=True, check=True, timeout=30)
    ids = result.stdout.strip().splitlines()
    if len(ids) != 1:
        raise RuntimeError("Expected one service container")
    # Docker's full response stays in memory; only audit()'s booleans are returned.
    result = subprocess.run(["docker", "inspect", ids[0]], capture_output=True, text=True, check=True, timeout=30)
    containers = json.loads(result.stdout)
    if len(containers) != 1:
        raise RuntimeError("Unexpected Docker response")
    return containers[0]


def main():
    try:
        report = audit(inspect_service("backend"), inspect_service("x402-worker"))
    except Exception:
        # Do not echo Docker stdout/stderr, which can contain environment values.
        print(json.dumps({"ok": False, "error": "WORKER_AUDIT_UNAVAILABLE"}))
        return 1
    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
