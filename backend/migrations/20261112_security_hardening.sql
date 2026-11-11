-- Security hardening for production.
-- 1. Idempotency: store a keyed fingerprint of each order request so a reused key can only return the order it created.
alter table orders add column if not exists idempotency_fingerprint text;

-- 2. Public order token: 16 random hex characters (64 bits) instead of 8 (32 bits).
alter table orders
  alter column public_token set default upper(substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 16));
