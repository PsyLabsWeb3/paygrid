import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("worker_audit", Path(__file__).parents[1] / "x402-worker-audit.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixtures():
    common = {
        "CHAIN_ID": "42220", "X402_PAYER_ADDRESS": "0xFB44350f335A823244C1C59948BcC838f81AFA34",
        "X402_API_KEY": "facilitator-test-secret", "X402_ENCRYPTION_KEY": "e" * 64,
        "SUPABASE_URL": "https://database.example", "SUPABASE_SERVICE_ROLE_KEY": "database-test-secret",
    }
    backend_env = {**common, "X402_SELLER_ENABLED": "true", "X402_PAYER_ENABLED": "true", "X402_PAYER_PRIVATE_KEY": "payer-test-secret"}
    worker_env = {**common, "X402_SELLER_ENABLED": "false", "X402_PAYER_ENABLED": "false"}
    def container(env):
        return {"State": {"Running": True}, "RestartCount": 0,
                "Config": {"Env": [f"{k}={v}" for k, v in env.items()], "Cmd": ["npm", "run", "x402:worker:start"]}}
    return container(backend_env), container(worker_env)


class WorkerAuditTests(unittest.TestCase):
    def test_valid_configuration_is_redacted(self):
        b, w = fixtures()
        report = module.audit(b, w)
        self.assertTrue(report["ok"])
        output = json.dumps(report)
        for value in module.environment(b).values():
            if "secret" in value or value == "e" * 64:
                self.assertNotIn(value, output)
        self.assertTrue(all(isinstance(value, bool) for value in report["checks"].values()))

    def test_inconsistent_credentials_and_network_fail(self):
        for key in ("CHAIN_ID", "X402_PAYER_ADDRESS", "X402_API_KEY", "X402_ENCRYPTION_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
            with self.subTest(key=key):
                b, w = fixtures()
                values = module.environment(w)
                values[key] = "different-test-secret"
                w["Config"]["Env"] = [f"{k}={v}" for k, v in values.items()]
                report = module.audit(b, w)
                self.assertFalse(report["ok"])
                self.assertNotIn("different-test-secret", json.dumps(report))

    def test_missing_credentials_fail(self):
        b, w = fixtures()
        for c in (b, w):
            c["Config"]["Env"] = [v for v in c["Config"]["Env"] if not v.startswith("X402_API_KEY=")]
        self.assertFalse(module.audit(b, w)["ok"])

    def test_worker_cannot_have_signer_or_active_payment_flags(self):
        for item in ("X402_PAYER_PRIVATE_KEY=unexpected-private-secret", "X402_PAYER_ENABLED=true", "X402_SELLER_ENABLED=true"):
            b, w = fixtures()
            w["Config"]["Env"].append(item)
            report = module.audit(b, w)
            self.assertFalse(report["ok"])
            self.assertNotIn("unexpected-private-secret", json.dumps(report))

    def test_stopped_and_wrong_command_are_rejected(self):
        b, w = fixtures()
        stopped = copy.deepcopy(w)
        stopped["State"]["Running"] = False
        self.assertFalse(module.audit(b, stopped)["ok"])
        w["Config"]["Cmd"] = ["npm", "start"]
        self.assertFalse(module.audit(b, w)["ok"])


if __name__ == "__main__":
    unittest.main()
