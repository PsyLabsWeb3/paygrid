-- Allow provider-backed card settlement to be tracked separately from Fonbnk.

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'card';
