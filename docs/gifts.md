# PayGrid Gift Agent

PayGrid Gifts turns a short human instruction into a claimable stablecoin transfer on Celo. The sender funds the promised amount, shares a personal bearer link, and the recipient claims it with MiniPay or another Celo wallet.

## Contracts

- `PaygridGiftVault` holds the exact recipient amount until claim, cancellation, or expiration.
- `PaygridGiftRouter` collects the gift amount plus PayGrid fee and supports exact-token or authorized Mento/Uniswap swap funding.
- Claim authorizations use EIP-712 and bind `giftId`, recipient address, nonce, and deadline.
- The vault signer can be rotated and both contracts can be paused by their owner.

Deploy with:

```bash
forge script script/DeployGifts.s.sol:DeployGifts --rpc-url celo-mainnet --broadcast
```

Required deployment variables are `PRIVATE_KEY`, `TREASURY_ADDRESS`, `GIFT_CLAIM_SIGNER_ADDRESS`, `USDC_ADDRESS`, `USDT_ADDRESS`, `USDM_ADDRESS`, and at least one authorized swap router.

## Gift lifecycle

1. The sender creates a draft with aliases, message, amount, token, claim hash, and expiration.
2. PayGrid returns approval and funding transactions. If the payer token differs, the router builds a Mento-first swap.
3. The indexer observes `GiftCreated` and activates the public gift.
4. The WhatsApp URL carries the secret in its fragment (`#k=`), which is not sent in HTTP requests.
5. The claim page exchanges that secret for a one-time session.
6. The backend signs an EIP-712 authorization for the connected recipient address.
7. `claimGift` transfers the exact promised amount and emits settlement evidence.
8. Unclaimed gifts can be cancelled by the sender or refunded permissionlessly after expiration.

The claim URL is a bearer invitation. Anyone who obtains it can bind a claim to their wallet, so it must be shared only with the intended recipient.

## API

```text
POST /api/gifts/minipay
POST /api/gifts/:id/quote
POST /api/gifts/:id/funding-tx
GET  /api/gifts/:id/public
GET  /api/gifts/:id/status
POST /api/gifts/:id/claim-session
POST /api/gifts/:id/claim-authorization
POST /api/gifts/:id/refund-tx
GET  /api/gifts/leaderboard
```

Raw claim secrets and WhatsApp phone numbers are never persisted. Claim session tokens are stored as SHA-256 hashes and consumed after authorization.

## MiniPay and wallet fallback

The universal claim page supports MiniPay's injected provider and WalletConnect-compatible Celo wallets. Until PayGrid is approved as a Mini App, `NEXT_PUBLIC_MINIPAY_DEEPLINK_ENABLED` must remain `false`. Recipients can install MiniPay from the official stores, return to the original message, and connect through WalletConnect.

After MiniPay approval, enable the official `https://link.minipay.xyz/browse?url=...` flow. PayGrid exchanges the fragment secret for an opaque resume token before opening MiniPay, so the secret is not included in the deeplink URL.

## Campaign rules

- Minimum scoring gift: $0.50.
- Sender and claimant must differ.
- Repeated sender-recipient pairs record legitimate volume but count once toward unique-claim ranking.
- A referral conversion requires a claimant to fund a subsequent gift to a new recipient.
- Leaderboard transactions should include the assigned hackathon attribution code using `NEXT_PUBLIC_CELO_ATTRIBUTION_CODE`.

## Claim account preparation

`POST /api/gifts/:id/claim-preparation` prepares a claim without exposing network-fee details in the MiniPay UI. The backend checks the claimant's CELO, USDm, USDC and USDT balances. It uses CELO when available, otherwise Celo fee abstraction through USDm or the verified USDC/USDT fee-currency adapters.

When the account has insufficient CELO and exactly zero supported stablecoin balance, PayGrid may send a minimal USDm preparation credit from a dedicated sponsor wallet. The credit is calculated from estimated claim gas plus a 25% safety margin, rounded up to `0.000001 USDm`, and capped at `0.01 USDm`.

Sponsorship is disabled by default. Its Supabase reservation is atomic, limited to one gift and one lifetime credit per recipient, capped at `$2 USDm` and 100 claims per UTC day, and limited to two attempts only when no transfer was submitted. The sponsor wallet must have no contract roles and should keep only a small manually refilled operating balance.

Both the preparation transfer and claim calldata include `CELO_ATTRIBUTION_CODE`. The legacy `claim-authorization` endpoint remains available for compatibility.

The reward pool is distributed manually from the PayGrid Safe after reviewing the final leaderboard for circular or coordinated abuse.
