#!/usr/bin/env bash
# Deploy helper: runs the DeployHex script and saves the broadcast output.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "Running deploy (DeployHex) on Celo Sepolia..."

# Ensure PRIVATE_KEY exists in environment or .env in repo root
if [ -f ".env" ]; then
  # load .env safely
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

forge script script/DeployHex.s.sol:DeployHex \
  --rpc-url https://forno.celo-sepolia.celo-testnet.org --broadcast | tee deploy_output.txt

echo "Broadcast output saved to deploy_output.txt"
echo "After deploy, run ./contracts/script/generate_deployments.sh to produce contracts/deployments.sepolia.json"
