-- Saved Sales momentum recommendations. One row per business, scope (all locations or one location),
-- day and rule. Results are generated from paid orders by saved rules, so a visit reads stored results.
create table if not exists business_growth_recommendations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  location_id uuid references business_locations(id) on delete cascade,
  scope_key text not null,
  period_end date not null,
  rule_key text not null,
  title text not null,
  detail text not null,
  action_label text not null,
  action_href text not null,
  score integer not null check (score between 0 and 100),
  impact_estimate numeric(12,2) not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  unique (business_id, scope_key, period_end, rule_key)
);

create index if not exists business_growth_recommendations_lookup_idx
  on business_growth_recommendations (business_id, scope_key, period_end, score desc);
