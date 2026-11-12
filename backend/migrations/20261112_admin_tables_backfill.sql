-- Backfill tables used by Team & Access, Security & sessions, payment location assignments and
-- integrations. These were defined in backend/schema_compat.py but never shipped as migrations, so
-- databases created from the earlier migrations lack them (roles and security returned 500).
-- Additive only: new tables, one new nullable column, and indexes. Safe to re-run.

create table if not exists payment_location_assignments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  location_id uuid not null references business_locations(id) on delete restrict,
  provider text not null,
  enabled_methods jsonb not null default '[]'::jsonb,
  is_override boolean not null default true,
  fallback_provider text,
  terminal_reference text,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, location_id)
);

create table if not exists business_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  email text not null,
  role text not null,
  location_ids jsonb not null default '[]'::jsonb,
  token_hash text not null unique,
  expires_at timestamptz not null,
  status text not null default 'pending',
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);

create table if not exists business_custom_roles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  permissions jsonb not null default '[]'::jsonb,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

alter table business_staff add column if not exists custom_role_id uuid references business_custom_roles(id) on delete set null;

create table if not exists business_staff_location_access (
  business_staff_id uuid not null references business_staff(id) on delete cascade,
  location_id uuid not null references business_locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (business_staff_id, location_id)
);

create table if not exists business_security_policies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  session_duration_minutes integer not null default 480,
  reauthentication_minutes integer not null default 15,
  invitation_expiry_days integer not null default 7,
  two_factor_required boolean not null default false,
  inactive_account_days integer not null default 90,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists integration_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  integration_type text not null,
  status text not null default 'disconnected',
  last_synchronized_at timestamptz,
  last_error text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists integration_location_mappings (
  integration_id uuid not null references integration_accounts(id) on delete cascade,
  location_id uuid not null references business_locations(id) on delete cascade,
  primary key (integration_id, location_id)
);

create table if not exists integration_hardware_mappings (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references integration_accounts(id) on delete cascade,
  hardware_type text not null,
  external_reference text not null,
  location_id uuid references business_locations(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists integration_api_keys (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  key_prefix text not null,
  scopes jsonb not null default '[]'::jsonb,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists integration_webhooks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  endpoint_url text not null,
  events jsonb not null default '[]'::jsonb,
  signing_secret_hash text not null,
  is_active boolean not null default true,
  last_delivered_at timestamptz,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table integration_api_keys add column if not exists rotated_from_id uuid references integration_api_keys(id) on delete set null;

create table if not exists integration_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references integration_webhooks(id) on delete restrict,
  event_type text not null,
  event_identifier text not null,
  attempt_number integer not null default 1,
  requested_at timestamptz not null default now(),
  response_status integer,
  duration_ms integer,
  result text,
  next_retry_at timestamptz,
  retry_state text not null default 'pending',
  sanitized_error text,
  created_at timestamptz not null default now(),
  unique (webhook_id, event_identifier, attempt_number)
);

alter table integration_webhooks add column if not exists signing_secret_ciphertext text;
alter table integration_webhook_deliveries add column if not exists business_id uuid references businesses(id) on delete cascade;
alter table integration_webhook_deliveries add column if not exists payload jsonb not null default '{}'::jsonb;
alter table integration_webhook_deliveries add column if not exists status text not null default 'pending';
alter table integration_webhook_deliveries add column if not exists last_attempted_at timestamptz;
alter table integration_webhook_deliveries add column if not exists completed_at timestamptz;
alter table integration_webhook_deliveries add column if not exists failed_at timestamptz;
alter table integration_webhook_deliveries add column if not exists claimed_by text;
alter table integration_webhook_deliveries add column if not exists claim_expires_at timestamptz;

create unique index if not exists integration_webhook_event_once_idx on integration_webhook_deliveries (webhook_id, event_identifier);
create index if not exists integration_webhook_delivery_queue_idx on integration_webhook_deliveries (status, next_retry_at, claim_expires_at);
