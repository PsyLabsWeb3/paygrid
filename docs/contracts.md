# Contracts Spec

## Overview

Two smart contracts on Celo Mainnet:

- **PaygridLink.sol** — Creates and manages payment links on-chain. Stores link metadata, enforces payment method constraints, validates completion.
- **PaygridRouter.sol** — Receives stablecoin payments, splits 0.5% fee to Paygrid treasury, forwards remainder to recipient. Emits indexed events for the backend indexer.

## PaygridLink.sol

### State
```solidity
struct PaymentLink {
    uint256 id;
    address creator;
    address recipient;
    uint256 amount;
    address token;
    string description;
    bool acceptsFiat;       // true if Fonbnk payments accepted
    bool paid;
    bool cancelled;
    uint256 createdAt;
    uint256 expiresAt;
}
```

### Functions
- `createLink(recipient, amount, token, description, acceptsFiat, expiresAt) → uint256 linkId`
- `cancelLink(linkId)` — only creator
- `getLink(linkId) → PaymentLink`

### Events
- `LinkCreated(uint256 indexed linkId, address indexed creator, address indexed recipient, uint256 amount, address token, bool acceptsFiat)`
- `LinkCancelled(uint256 indexed linkId)`
- `LinkPaid(uint256 indexed linkId, address payer, uint256 amount, address token, PaymentMethod method)`

## PaygridRouter.sol

### State
- `treasury: address` — receives 0.5% fee
- `feeBps: uint256 = 50` — 0.5% = 50 basis points
- `paygridLink: PaygridLink` — reference to link contract

### Functions
- `pay(uint256 linkId, address token, uint256 amount)`
- `payWithFiat(uint256 linkId, address token, uint256 amount, bytes32 onrampTxId)` — called by backend after Fonbnk confirmation
- `setTreasury(address)` — owner only
- `setFeeBps(uint256)` — owner only, max 5% (500 bps)

### Internal
- `_splitAndForward(token, amount, recipient)` — calculates fee, sends to treasury, forwards remainder

### Events
- `PaymentReceived(uint256 indexed linkId, address indexed payer, address indexed token, uint256 amount, uint256 fee, PaymentMethod method, bytes32 onrampTxId)`

## Enums
```solidity
enum PaymentMethod { Crypto, Fonbnk }
```

## Token Handling

- USDC/USDT: 6 decimals, use feeCurrency adapter for gas
- USDm: 18 decimals, native feeCurrency
- All transfers use `safeTransfer` / `safeTransferFrom` from OpenZeppelin

## Security

- ReentrancyGuard on `pay` and `payWithFiat`
- `onlyCreator` modifier on `cancelLink`
- Owner controls treasury address and fee cap
- Standard OpenZeppelin access control

## Deployment

- Foundry (Solidity ^0.8.20)
- Deploy script: `script/Deploy.s.sol`
- Network: Celo Mainnet (chainId: 42220)
- Test via fork: `forge test --fork-url https://forno.celo.org`


### Demo deploy (Sepolia)

We performed a demo deployment to Celo Sepolia for development and demonstration purposes. The Sepolia deployment is recorded in `contracts/deployments.sepolia.json` and the raw broadcast is available under `contracts/broadcast/*/run-latest.json`.

To reproduce the demo deploy locally (requires a local `contracts/.env` with `PRIVATE_KEY=0x...`, which must not be committed):

```bash
cd contracts
forge script script/DeployHex.s.sol:DeployHex --rpc-url https://forno.celo-sepolia.celo-testnet.org --broadcast
```

After running, generate the canonical deployments JSON:

```bash
./script/generate_deployments.sh
```

Security: remove `.env` after use and rotate keys if needed. See `contracts/ENV_REMOVED_NOTICE.txt`.
