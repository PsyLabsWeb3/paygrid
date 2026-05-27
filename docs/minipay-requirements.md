# MiniPay Requirements

This document defines the implementation requirements for the MiniPay frontend in `minipay/`. It is the source of truth for the mobile-friendly app that creates payment links and pays them using crypto or Fonbnk.

The app is a separate frontend from the backend API. It consumes `BACKEND_URL` and should not host API routes itself.

The frontend can be built now against the current backend APIs and the current Celo Sepolia deployment. Backend and frontend envs should use the latest Sepolia addresses from `contracts/deployments.sepolia.json`.

---

## Product Goals

- Let a user create a stablecoin payment link in under one minute.
- Let a payer open a shared link and pay with crypto or fiat.
- Make receipts and payment history easy to verify inside MiniPay.
- Work well on a 360x640 viewport and within MiniPay constraints.

---

## User Flows

### Create a link

1. User opens the app.
2. App auto-connects to MiniPay wallet if available.
3. User enters amount, token, description, and accepted methods.
4. App submits to the backend and receives a shareable link URL.
5. App shows a success state with copy/share actions.

### Pay a link with crypto

1. User opens `/pay/[id]`.
2. App loads link details and available payment methods.
3. User selects the crypto tab.
4. App prepares the tx payload from the backend response.
5. User confirms in MiniPay.
6. App shows a success screen with tx hash and receipt link.

### Pay a link with fiat

1. User opens `/pay/[id]`.
2. App checks Fonbnk availability for the payer country.
3. If available, app shows a fiat tab with carrier limits.
4. User completes the Fonbnk widget flow.
5. App shows confirmation once the backend webhook settles the payment.

---

## Screens

### Home

- Create link CTA
- Payment history preview
- Recent links preview
- Empty state when there are no links

### Create link

- Amount input
- Token selector: USDm / USDC / USDT
- Description input
- Accepted methods toggle: crypto / fiat
- Primary submit button
- Loading, error, and success states

### Pay link

- Link summary
- Tabs for crypto and fiat when both are available
- Loading skeletons while data loads
- Success screen with tx hash / receipt / payment status

### Payment history

- Received payments tab
- Active links tab
- Filters by status / token / date
- Empty state
- Link-out to Celoscan for tx hashes

Backend currently exposes received-link history for the authenticated owner. Do not treat payer-side sent history as an MVP dependency unless the backend adds a dedicated endpoint for it.

---

## Data Dependencies

Frontend must read from the backend only:

- `POST {BACKEND_URL}/api/links`
- `GET {BACKEND_URL}/api/links`
- `GET {BACKEND_URL}/api/links/{id}`
- `POST {BACKEND_URL}/api/links/{id}/pay`
- `GET {BACKEND_URL}/api/payments`
- `GET {BACKEND_URL}/api/onramp/fonbnk/config`

Frontend must not assume API routes co-located in `minipay/`.
Webhook handling for Fonbnk is backend-only and should never be called directly by the frontend.

Frontend constraints from the current backend contract/API shape:
- `GET /api/payments` is owner-scoped received history, not payer-side sent history.
- Fonbnk currently supports `USDC` and `USDT` only; hide fiat for `USDm` links.
- The Fonbnk payment init flow requires an `email` field.
- MiniPay fee abstraction must use fee adapter addresses only for `feeCurrency`; token reads, balances and approvals must still use the canonical token addresses.

---

## UX Requirements

- Mobile-first layout.
- Responsive for 360x640 minimum.
- Fast initial render.
- Clear states for loading, pending confirmation, success, and error.
- Never show CELO as the primary user-facing asset in flows; surface USDm, USDC, and USDT.
- When fiat is available, show carrier-specific limits before the user proceeds.
- Use MiniPay-safe copy in user-facing strings: `Network fee`, `Deposit`, and `Withdraw`; never `Gas`, `Onramp`, `Offramp`, `Buy crypto`, or `Sell crypto`.

---

## Non-Functional Requirements

- Bundle should remain small enough for mobile usage.
- Deep links should work for receipts and deposits.
- Preserve MiniPay-compatible wallet behavior and legacy transaction constraints.
- Avoid requiring any unsupported signing method.

---

## Suggested File Layout

```text
minipay/
├── src/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── create/page.tsx
│   │   ├── pay/[id]/page.tsx
│   │   └── history/page.tsx
│   ├── components/
│   ├── lib/
│   └── hooks/
├── public/
├── package.json
└── next.config.js
```

---

## Status

This is still a spec document. There is no implementation in `minipay/` yet beyond the directory placeholder.
