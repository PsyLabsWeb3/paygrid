ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS paygrid_link_address text;

UPDATE payment_links
SET paygrid_link_address = 'legacy'
WHERE paygrid_link_address IS NULL;

ALTER TABLE payment_links
  ALTER COLUMN paygrid_link_address SET NOT NULL;

ALTER TABLE payment_links
  DROP CONSTRAINT IF EXISTS payment_links_on_chain_link_id_key;

DROP INDEX IF EXISTS idx_payment_links_on_chain;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_links_contract_on_chain
  ON payment_links(paygrid_link_address, on_chain_link_id);

CREATE INDEX IF NOT EXISTS idx_payment_links_on_chain
  ON payment_links(on_chain_link_id);
