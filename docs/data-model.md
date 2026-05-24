# Data Model

Supabase (PostgreSQL) schema for Paygrid.

---

## Tables

### `payment_links`

Stores payment links created by users or agents.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Link unique identifier |
| on_chain_link_id | bigint (UNIQUE) | PaygridLink `linkId` on Celo |
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

- `payment_links(on_chain_link_id)` — indexer event lookup
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

---

## Row Level Security (RLS)

Supabase RLS policies for each table:

### `payment_links`

```sql
-- Creator can read/write their own links
CREATE POLICY "creator_access" ON payment_links
  FOR ALL USING (creator_id = auth.uid());

-- Anyone can read active links (needed for pay page)
CREATE POLICY "read_active_links" ON payment_links
  FOR SELECT USING (status = 'active');

-- Backend service role bypasses RLS
```

### `payments`

```sql
-- Payer or link creator can read payments
CREATE POLICY "read_own_payments" ON payments
  FOR SELECT USING (
    payer_address = auth.jwt()->>'address'
    OR link_id IN (SELECT id FROM payment_links WHERE creator_id = auth.uid())
  );

-- Only backend creates payments (triggers + webhooks via service_role)
CREATE POLICY "backend_insert" ON payments
  FOR INSERT WITH CHECK (true);
```

### `onramp_sessions`

```sql
CREATE POLICY "read_own_sessions" ON onramp_sessions
  FOR SELECT USING (
    payment_link_id IN (SELECT id FROM payment_links WHERE creator_id = auth.uid())
  );
```

### `agents`

```sql
-- Public read for agent metadata
CREATE POLICY "read_agents" ON agents FOR SELECT USING (true);
```

---

## Migration Strategy

Use Supabase CLI for versioned migrations:

```bash
# Create migration
supabase migration new add_onramp_sessions

# Apply locally
supabase db reset

# Push to production
supabase db push
```

### Migration files

```
supabase/
└── migrations/
    ├── 20260523000001_create_users.sql
    ├── 20260523000002_create_agents.sql
    ├── 20260523000003_create_payment_links.sql
    ├── 20260523000004_create_payments.sql
    └── 20260523000005_create_onramp_sessions.sql
```
