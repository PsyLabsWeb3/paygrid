#!/usr/bin/env bash
# Generate deployments JSON from the latest foundry broadcast run-latest.json
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_JSON="$(find "$ROOT_DIR/broadcast" -type f -name 'run-latest.json' -printf "%T@ %p\n" | sort -nr | head -n1 | awk '{print $2}')"

if [ -z "${RUN_JSON}" ]; then
  echo "run-latest.json not found under $ROOT_DIR/broadcast"
  echo "Please run deploy first so broadcast/run-latest.json exists."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to run this script. Install jq and retry." >&2
  exit 1
fi

CHAIN_ID=11142220
NETWORK=celo-sepolia
DEPLOYER=$(jq -r '.transactions[0].transaction.from' "$RUN_JSON")
TIMESTAMP=$(jq -r '.timestamp' "$RUN_JSON")

CONTRACTS=$(jq -r '.transactions[] | select(.contractName != null) | {name: .contractName, address: .contractAddress, tx: .hash} ' "$RUN_JSON" | jq -s '.')

cat > "$ROOT_DIR/deployments.sepolia.json" <<EOF
{
  "chainId": $CHAIN_ID,
  "network": "$NETWORK",
  "deployer": $DEPLOYER,
  "timestamp": $TIMESTAMP,
  "contracts": $CONTRACTS
}
EOF

echo "Wrote $ROOT_DIR/deployments.sepolia.json"
