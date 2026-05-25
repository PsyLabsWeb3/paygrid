# Contracts Spec

## Overview

Paygrid uses two core contracts on Celo:

- **PaygridLink.sol** creates and manages payment links on-chain.
- **PaygridRouter.sol** receives payments, splits the 0.5% fee to treasury, and forwards the remainder to the recipient.

The Sepolia deployment is the canonical development reference for backend integration and UI wiring. Mainnet addresses remain pending.

---

## Deployed Reference

### Celo Sepolia

| Contract | Address |
|----------|---------|
| PaygridLink | `0xd2dc71c47803b0939944ec29ff3b644c48bae7de` |
| PaygridRouter | `0xe75027ff07931ef97248402f4df63a4d3287020d` |
| Treasury | `0xd4683314a013792fe8840e4171dc4692e317617b` |

### Mainnet

| Contract | Address |
|----------|---------|
| PaygridLink | TBD |
| PaygridRouter | TBD |
| Treasury | TBD |

---

## PaygridLink.sol

### Responsibility

- Create on-chain payment links.
- Store creator, recipient, token, amount, fiat acceptance, creation time, and expiry.
- Emit events for backend indexing.

### State
```solidity
struct PaymentLink {
    uint256 id;
    address creator;
    address recipient;
    uint256 amount;
    address token;
    string description;
    bool acceptsFiat;
    bool paid;
    bool cancelled;
    uint256 createdAt;
    uint256 expiresAt;
}
```

### Functions
- `createLink(recipient, amount, token, description, acceptsFiat, expiresAt) -> uint256 linkId`
- `cancelLink(linkId)` - only creator
- `getLink(linkId) -> PaymentLink`

### Events
- `LinkCreated(uint256 indexed linkId, address indexed creator, address indexed recipient, uint256 amount, address token, bool acceptsFiat)`
- `LinkCancelled(uint256 indexed linkId)`
- `LinkPaid(uint256 indexed linkId, address payer, uint256 amount, address token, PaymentMethod method)`

---

## PaygridRouter.sol

### Responsibility

- Receive stablecoin payments.
- Split 0.5% fee to treasury.
- Forward 99.5% to recipient.
- Emit indexed payment events for the backend indexer.

### State
- `treasury: address` - fee recipient
- `feeBps: uint256 = 50` - 0.5% fee
- `paygridLink: PaygridLink` - link registry reference

### Functions
- `pay(uint256 linkId, address token, uint256 amount)`
- `payWithFiat(uint256 linkId, address token, uint256 amount, bytes32 onrampTxId)` - backend-only settlement after Fonbnk confirmation
- `setTreasury(address)` - owner only
- `setFeeBps(uint256)` - owner only, max 5% (500 bps)

### Internal
- `_splitAndForward(token, amount, recipient)` - calculates fee, sends treasury cut, forwards remainder

### Events
- `PaymentReceived(uint256 indexed linkId, address indexed payer, address indexed token, uint256 amount, uint256 fee, PaymentMethod method, bytes32 onrampTxId)`

---

## Enums

```solidity
enum PaymentMethod { Crypto, Fonbnk }
```

---

## Token Handling

- USDC / USDT use 6 decimals.
- USDm uses 18 decimals.
- All transfers use OpenZeppelin `safeTransfer` / `safeTransferFrom`.
- MiniPay frontend and backend should never present CELO as a primary user-facing payment asset; user flows surface USDm, USDC, and USDT.

---

## Security

- `ReentrancyGuard` on `pay` and `payWithFiat`
- `onlyCreator` on `cancelLink`
- Owner controls treasury address and fee cap
- Standard OpenZeppelin access control

---

## Deployment

- Foundry (`^0.8.20`)
- Deploy script: `script/Deploy.s.sol`
- Sepolia deploy record: `contracts/deployments.sepolia.json`
- Fork testing: `forge test --fork-url https://forno.celo.org`

### Demo deploy (Sepolia)

The Sepolia deployment is the source of truth for development and backend integration. The raw broadcast is stored under `contracts/broadcast/*/run-latest.json`.

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

---

## Current Status

Implemented on-chain and integrated with the backend today:

- `createLink` / `LinkCreated`
- `pay` / `PaymentReceived`
- Sepolia addresses in `contracts/deployments.sepolia.json`

Available on-chain but not yet wired by the backend:

- `payWithFiat` for the future Fonbnk settlement path

Still pending:

- Mainnet deployment
- Celoscan verification
- Mainnet fork tests
