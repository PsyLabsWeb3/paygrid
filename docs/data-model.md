# Data Model

Supabase (PostgreSQL) schema for Paygrid.

---

## Tables

### `payment_links`

Stores payment links created by users or agents.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Link unique identifier |
| creator_id | uuid (FK → users.id) | Creator of the link |
| creator_type | enum('user', 'agent') | Creator type |
| recipient_address | text | On-chain address that receives funds |
| amount | numeric(36,18) | Amount requested |
| token | enum('USDm', 'USDC', 'USDT') | Stablecoin token |
| description | text | Optional description |
| accepted_methods | text[] | Payment methods: ['crypto'], ['fonbnk'], or ['crypto', 'fonbnk'] |
| status | enum('active', 'paid', 'expired', 'cancelled') | Link status |
| tx_hash | text | On-chain transaction hash (when paid) |
| created_at | timestamptz | Creation timestamp |
| expires_at | timestamptz | Expiration timestamp |

### `payments`

Records each payment made through a link.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Payment unique identifier |
| link_id | uuid (FK → payment_links.id) | Associated link |
| payer_address | text | On-chain address of payer |
| amount | numeric(36,18) | Amount paid |
| token | enum('USDm', 'USDC', 'USDT') | Token used |
| fee_amount | numeric(36,18) | 0.5% fee collected |
| payment_method | enum('crypto', 'fonbnk') | How the payment was made |
| onramp_session_id | uuid (FK → onramp_sessions.id) | Onramp session (if fiat) |
| onramp_tx_id | text | Onramp transaction ID (if fiat) |
| tx_hash | text | On-chain settlement tx hash |
| status | enum('pending', 'confirmed', 'failed') | Payment status |
| created_at | timestamptz | Creation timestamp |
| confirmed_at | timestamptz | Confirmation timestamp |

### `onramp_sessions`

Tracks Fonbnk onramp sessions from initiation to confirmation.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Session unique identifier |
| payment_link_id | uuid (FK → payment_links.id) | Associated link |
| provider | text | Always 'fonbnk' |
| amount | numeric(36,18) | Crypto amount to receive |
| token | enum('USDm', 'USDC', 'USDT') | Target token |
| fiat_amount | numeric(36,18) | Fiat amount being paid |
| fiat_currency | text | Local currency (KES, NGN, etc.) |
| carrier | text | Mobile carrier (safaricom, airtel, etc.) |
| status | enum('initiated', 'processing', 'completed', 'failed') | Session status |
| tx_hash | text | On-chain settlement tx hash (when completed) |
| created_at | timestamptz | Creation timestamp |
| confirmed_at | timestamptz | Confirmation timestamp |

### `users`

Humans using Paygrid — authenticated via Privy.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | User unique identifier |
| privy_id | text (UNIQUE) | Privy user ID |
| phone_number | text | Phone number (from ODIS) |
| address | text | Default wallet address |
| created_at | timestamptz | Creation timestamp |

### `agents`

AI agents registered on Paygrid — authenticated via ERC-8004.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Agent unique identifier |
| agent_id | text (UNIQUE) | ERC-8004 agentId |
| address | text | Agent wallet address |
| name | text | Agent name |
| metadata_uri | text | ERC-8004 metadata URI |
| reputation_score | integer | Reputation from ERC-8004 |
| created_at | timestamptz | Creation timestamp |

---

## Indexes

- `payment_links(creator_id)` — user/agent history
- `payment_links(status)` — active link queries
- `payments(link_id)` — link payment history
- `payments(payer_address)` — payer history
- `onramp_sessions(payment_link_id)` — link onramp status
- `onramp_sessions(status)` — pending onramp monitoring

## Enums

- `token`: `USDm`, `USDC`, `USDT`
- `link_status`: `active`, `paid`, `expired`, `cancelled`
- `payment_method`: `crypto`, `fonbnk`
- `payment_status`: `pending`, `confirmed`, `failed`
- `onramp_status`: `initiated`, `processing`, `completed`, `failed`
- `creator_type`: `user`, `agent`
