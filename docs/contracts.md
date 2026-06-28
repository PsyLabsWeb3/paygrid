# Contracts Spec

## Overview

Paygrid uses two core contracts on Celo:

- **PaygridLink.sol** creates and manages payment links on-chain.
- **PaygridRouterV2.sol** receives exact-token payments, executes authorized stablecoin swaps, splits the 0.5% fee to treasury, and forwards the remainder to the recipient.

Mainnet is the canonical production deployment. Sepolia remains the development reference for backend integration and UI wiring.

---

## Deployed Reference

### Celo Sepolia

| Contract | Address |
|----------|---------|
| PaygridLink | `0x58b7125e0bed4d082985c76b772bf84808e5a474` |
| PaygridRouter | `0xb3fe724934de14afd56157bacb8ed6907a3d091b` |
| Treasury | `0xd4683314a013792fe8840e4171dc4692e317617b` |

### Mainnet

| Contract | Address |
|----------|---------|
| PaygridLink | `0x31Aa9Ba23e4CAC3f41d88fb1C904067c0b3dda89` |
| PaygridRouterV2 | `0x8d290c97100f0e87e04Efd1a790F27004fA3f08B` |
| Mento Router | `0x4861840C2EfB2b98312B0aE34d86fD73E8f9B6f6` |
| Treasury | `0xc0C019DCeCE7a3a235Ab520F394A57c132F90cD6` |

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

## PaygridRouterV2.sol

### Responsibility

- Receive stablecoin payments.
- Execute atomic swaps for supported stablecoin mismatches.
- Validate final settlement token output before marking the link paid.
- Split 0.5% fee to treasury.
- Forward 99.5% to recipient.
- Emit indexed payment events for the backend indexer.

### State
- `treasury: address` - fee recipient
- `feeBps: uint256 = 50` - 0.5% fee
- `paygridLink: PaygridLink` - link registry reference
- `supportedTokens: mapping(address => bool)` - USDC, USDT, USDm allowlist
- `authorizedSwapTargets: mapping(address => bool)` - Mento first, optional Uniswap fallback

### Functions
- `pay(uint256 linkId, address token, uint256 amount)`
- `payWithSwap(uint256 linkId, address tokenIn, uint256 amountInMax, uint256 minAmountOut, address swapTarget, bytes swapCalldata, uint256 deadline)`
- `payWithFiat(uint256 linkId, address token, uint256 amount, bytes32 onrampTxId)` - backend-only settlement after Fonbnk confirmation
- `setSupportedToken(address token, bool supported)` - owner only
- `setSwapTarget(address target, bool authorized)` - owner only
- `setTreasury(address)` - owner only
- `setFeeBps(uint256)` - owner only, max 5% (500 bps)

### Internal
- `_splitAndForward(token, amount, recipient)` - calculates fee, sends treasury cut, forwards remainder

### Events
- `PaymentReceived(uint256 indexed linkId, address indexed payer, address indexed token, uint256 amount, uint256 fee, PaymentMethod method, bytes32 onrampTxId)`
- `SwapPayment(uint256 indexed linkId, address indexed payer, address indexed tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, address swapTarget)`

### Swap flow

`payWithSwap` lets a payer use one supported stablecoin while the recipient receives the token requested by the payment link. For example, a link can request USDC while the payer pays with USDT.

1. The payer approves `PaygridRouterV2` for `amountInMax` of `tokenIn`.
2. `PaygridRouterV2` pulls `tokenIn` from the payer.
3. The router approves an authorized swap target and calls the provided swap calldata.
4. The router validates that final `tokenOut` balance increased by at least `link.amount`.
5. Excess output is refunded to the payer.
6. The Paygrid fee is charged in the final settlement token.
7. The recipient receives the requested token and `PaygridLink` is marked paid.

Mento is the primary configured route for USDC, USDT and USDm swaps. Uniswap may be enabled as a fallback.

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
- For fee abstraction, USDC and USDT gas payment uses adapter addresses, while settlement uses the token contract addresses.

---

## Security

- `ReentrancyGuard` on `pay` and `payWithFiat`
- `ReentrancyGuard` on `payWithSwap`
- `onlyCreator` on `cancelLink`
- Owner controls treasury address and fee cap
- Owner controls supported token and swap target allowlists
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
- `payWithSwap` / `SwapPayment`
- Sepolia addresses in `contracts/deployments.sepolia.json`

- `payWithFiat` for the future Fonbnk settlement path

Still pending:

- Celoscan verification
- Mainnet fork tests
