# Paygrid MiniPay Frontend

Next.js Mini App for Paygrid payment requests.

## UX direction

- Mobile-first interface inspired by high-density wallet and exchange flows.
- Black background, graphite surfaces, and a vivid lime primary action.
- Segmented controls, compact status pills, icon buttons, and bottom navigation.
- The MiniPay account address is used only as technical data. The UI displays `MiniPay account` inside MiniPay instead of raw addresses.
- User-facing copy uses MiniPay language: `Network fee`, `Deposit`, `Withdraw`, `stablecoin`, and `digital dollars`.

## Environment

Copy `.env.example` to `.env.local`.

```bash
npm install
npm run dev
```

Use ngrok and a physical device for MiniPay testing.
