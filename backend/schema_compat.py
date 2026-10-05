import logging

from psycopg import connect
from services.analytics_service import ANALYTICS_ORDER_COLUMNS


logger = logging.getLogger(__name__)


class SchemaContractError(RuntimeError):
    pass


def assert_analytics_order_schema(connection) -> None:
    rows = connection.execute(
        "select column_name from information_schema.columns "
        "where table_schema = current_schema() and table_name = 'orders'"
    ).fetchall()
    available = {row[0] for row in rows}
    missing = set(ANALYTICS_ORDER_COLUMNS) - available
    if missing:
        raise SchemaContractError(
            "orders is missing analytics columns: " + ", ".join(sorted(missing))
        )

BUSINESS_COMPATIBILITY_SQL = [
    "alter table profiles add column if not exists onboarding_business_type text",
    "alter table businesses add column if not exists business_subtype text",
    "alter table businesses add column if not exists contact_phone text",
    "alter table businesses add column if not exists tagline text",
    "alter table businesses add column if not exists logo_path text",
    "alter table businesses add column if not exists logo_shape text not null default 'square'",
    "alter table businesses add column if not exists logo_scale integer not null default 120",
    "alter table businesses add column if not exists logo_position_x integer not null default 50",
    "alter table businesses add column if not exists logo_position_y integer not null default 50",
    "alter table businesses add column if not exists brand_color text not null default '#1A4D2E'",
    "alter table businesses add column if not exists kiosk_layout_id text not null default 'top-navigation'",
    """update businesses set kiosk_layout_id = case split_part(kiosk_theme, ':', 1)
    when 'left_category' then 'side-navigation'
    when 'category_gate' then 'category-first'
    else kiosk_layout_id end""",
    "alter table businesses add column if not exists kiosk_theme text not null default 'top_category:premium_light'",
    "alter table businesses add column if not exists kiosk_layout text not null default 'wide_16_9'",
    "alter table businesses add column if not exists kiosk_screen_orientation text not null default 'landscape'",
    "alter table businesses add column if not exists kiosk_screen_size text not null default '32'",
    "alter table businesses add column if not exists kiosk_cart_mode text not null default 'page'",
    "alter table businesses add column if not exists kiosk_start_screen_enabled boolean not null default true",
    "alter table businesses add column if not exists kiosk_start_text_position text not null default 'middle'",
    "alter table businesses add column if not exists kiosk_touch_to_start boolean not null default false",
    """alter table businesses add column if not exists welcome_screen jsonb not null default
    '{"enabled":true,"heading":"Welcome","supporting_text":"","instruction_text":"Tap to begin","start_button_text":"Start","text_position":"middle","touch_anywhere_to_start":false,"show_business_logo":true}'::jsonb""",
    """update businesses set welcome_screen = jsonb_build_object(
    'enabled', kiosk_start_screen_enabled,
    'heading', coalesce(nullif(kiosk_start_screen_settings->>'heading', ''), 'Welcome'),
    'supporting_text', coalesce(kiosk_start_screen_settings->>'supporting_text', ''),
    'instruction_text', coalesce(nullif(kiosk_start_screen_settings->>'instruction_text', ''), 'Tap to begin'),
    'start_button_text', coalesce(nullif(kiosk_start_screen_settings->>'start_button_text', ''), 'Start'),
    'text_position', kiosk_start_text_position,
    'touch_anywhere_to_start', kiosk_touch_to_start,
    'show_business_logo', coalesce((kiosk_start_screen_settings->>'show_business_logo')::boolean, true)
    ) where welcome_screen = '{"enabled":true,"heading":"Welcome","supporting_text":"","instruction_text":"Tap to begin","start_button_text":"Start","text_position":"middle","touch_anywhere_to_start":false,"show_business_logo":true}'::jsonb
    and (kiosk_start_screen_enabled is false or kiosk_start_text_position <> 'middle' or kiosk_touch_to_start is true or kiosk_start_screen_settings <> '{}'::jsonb)""",
    "alter table businesses add column if not exists kiosk_start_screen_settings jsonb not null default '{}'::jsonb",
    "alter table businesses add column if not exists kiosk_lock_settings jsonb not null default '{}'::jsonb",
    "alter table businesses add column if not exists kiosk_order_settings jsonb not null default '{}'::jsonb",
    "alter table businesses add column if not exists display_show_tagline boolean not null default true",
    "alter table businesses add column if not exists display_show_category_images boolean not null default true",
    "alter table businesses add column if not exists display_show_item_descriptions boolean not null default true",
    "alter table businesses add column if not exists display_show_prices boolean not null default true",
    "alter table businesses add column if not exists display_show_unavailable boolean not null default true",
    "alter table businesses add column if not exists idle_timeout_seconds integer not null default 60",
    "alter table businesses add column if not exists order_reset_seconds integer not null default 5",
    "alter table businesses add column if not exists default_language text not null default 'English'",
    "alter table businesses add column if not exists sound_effects_enabled boolean not null default true",
    "alter table businesses add column if not exists offer_enabled boolean not null default false",
    "alter table businesses add column if not exists offer_title text not null default 'Fresh choices, smart savings'",
    "alter table businesses add column if not exists offer_subtitle text not null default 'Discover today''s best picks and seasonal offers.'",
    "alter table businesses add column if not exists offer_badge text not null default 'Up to 25% off'",
    "alter table businesses add column if not exists offer_cta text not null default 'Shop now'",
    "alter table businesses add column if not exists offer_image_path text",
    "alter table businesses add column if not exists offer_background text not null default 'emerald'",
    "alter table businesses add column if not exists currency_code text not null default 'INR'",
    "alter table businesses add column if not exists currency_symbol text not null default 'Rs'",
    "alter table businesses add column if not exists tax_percent numeric(6,2) not null default 0",
    "alter table businesses add column if not exists address_line1 text",
    "alter table businesses add column if not exists city text",
    "alter table businesses add column if not exists state text",
    "alter table businesses add column if not exists postal_code text",
    "alter table businesses add column if not exists country text not null default 'India'",
    "alter table businesses add column if not exists timezone text not null default 'Asia/Kolkata'",
    "alter table businesses add column if not exists opening_time time",
    "alter table businesses add column if not exists closing_time time",
    "alter table businesses add column if not exists order_modes jsonb not null default '[\"dine_in\", \"takeaway\"]'::jsonb",
    "alter table businesses add column if not exists store_schedule jsonb not null default '{}'::jsonb",
    "alter table businesses add column if not exists receipt_settings jsonb not null default '{}'::jsonb",
    "alter table businesses add column if not exists owner_pin_hash text",
    "alter table businesses add column if not exists owner_pin_set_at timestamptz",
    "alter table businesses add column if not exists pin_failed_attempts integer not null default 0",
    "alter table businesses add column if not exists pin_locked_until timestamptz",
    "alter table businesses add column if not exists onboarding_step integer not null default 0",
    "alter table businesses add column if not exists onboarding_completed boolean not null default false",
    "alter table businesses add column if not exists is_active boolean not null default true",
    "alter table businesses alter column kiosk_theme set default 'top_category:premium_light'",
    "alter table businesses alter column offer_enabled set default false",
    "alter table businesses drop constraint if exists businesses_kiosk_layout_id_check",
    "alter table businesses add constraint businesses_kiosk_layout_id_check check (kiosk_layout_id in ('side-navigation', 'top-navigation', 'category-first'))",
    "alter table businesses drop constraint if exists businesses_order_reset_seconds_check",
    "alter table businesses add constraint businesses_order_reset_seconds_check check (order_reset_seconds >= 5 and order_reset_seconds <= 10)",
    "alter table businesses drop constraint if exists businesses_kiosk_screen_orientation_check",
    "alter table businesses add constraint businesses_kiosk_screen_orientation_check check (kiosk_screen_orientation in ('landscape', 'portrait'))",
    "alter table businesses drop constraint if exists businesses_kiosk_start_text_position_check",
    "alter table businesses add constraint businesses_kiosk_start_text_position_check check (kiosk_start_text_position in ('top', 'middle', 'bottom'))",
    "alter table businesses drop constraint if exists businesses_logo_scale_check",
    "alter table businesses add constraint businesses_logo_scale_check check (logo_scale >= 60 and logo_scale <= 220)",
    "alter table businesses drop constraint if exists businesses_logo_position_x_check",
    "alter table businesses add constraint businesses_logo_position_x_check check (logo_position_x >= 0 and logo_position_x <= 100)",
    "alter table businesses drop constraint if exists businesses_logo_position_y_check",
    "alter table businesses add constraint businesses_logo_position_y_check check (logo_position_y >= 0 and logo_position_y <= 100)",
    "alter table business_staff drop constraint if exists business_staff_role_check",
    "alter table business_staff add constraint business_staff_role_check check (role in ('owner', 'admin', 'manager', 'kitchen', 'cashier', 'salon_staff', 'kiosk', 'viewer'))",
    "alter table orders add column if not exists cancel_reason text",
    "alter table orders drop constraint if exists orders_status_check",
    "alter table orders add constraint orders_status_check check (status in ('payment_pending', 'pending', 'preparing', 'ready', 'completed', 'cancelled'))",
    "alter table orders drop constraint if exists orders_payment_status_check",
    "alter table orders add constraint orders_payment_status_check check (payment_status in ('unpaid', 'pending', 'authorized', 'paid', 'failed', 'cancelled', 'expired', 'refunded', 'pay_at_counter_pending'))",
]

ORDER_COMPATIBILITY_SQL = [
    """
    create table if not exists order_counters (
      business_id uuid not null references businesses(id) on delete cascade,
      counter_date date not null default current_date,
      next_number integer not null default 1,
      primary key (business_id, counter_date)
    )
    """,
    """
    create or replace function next_order_number(p_business_id uuid)
    returns integer as $$
    declare
      allocated_number integer;
    begin
      insert into order_counters (business_id, counter_date, next_number)
      values (p_business_id, current_date, 2)
      on conflict (business_id, counter_date)
      do update set next_number = order_counters.next_number + 1
      returning next_number - 1 into allocated_number;

      return allocated_number;
    end;
    $$ language plpgsql
    set search_path = ''
    """,
]

PAYMENT_COMPATIBILITY_SQL = [
    """
    create table if not exists business_payment_accounts (
      id uuid primary key default gen_random_uuid(),
      business_id uuid not null references businesses(id) on delete cascade,
      provider text not null check (provider in ('stripe', 'razorpay', 'paytm')),
      display_name text,
      provider_account_id text,
      provider_merchant_id text,
      connection_status text not null default 'not_connected' check (connection_status in ('not_connected', 'setup_required', 'pending', 'active', 'restricted', 'disabled', 'error', 'disconnected', 'connected')),
      activation_status text not null default 'not_applicable',
      charges_enabled boolean not null default false,
      payments_enabled boolean not null default false,
      payouts_enabled boolean not null default false,
      requirements_due jsonb not null default '[]'::jsonb,
      last_status_check_at timestamptz,
      is_default boolean not null default false,
      is_enabled boolean not null default true,
      onboarding_status text not null default 'not_started',
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (business_id, provider)
    )
    """,
    """
    create table if not exists payments (
      id uuid primary key default gen_random_uuid(),
      business_id uuid not null references businesses(id) on delete cascade,
      order_id uuid references orders(id) on delete cascade,
      provider text,
      provider_reference text,
      provider_payment_id text,
      provider_order_id text,
      payment_intent_id text,
      amount numeric(12,2) not null default 0,
      currency text not null default 'INR',
      status text not null default 'pending',
      payment_method text,
      raw_provider_status text,
      raw_payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
    """,
    "alter table business_payment_accounts drop constraint if exists business_payment_accounts_provider_check",
    "alter table business_payment_accounts add constraint business_payment_accounts_provider_check check (provider in ('stripe', 'razorpay', 'paytm'))",
    "alter table business_payment_accounts drop constraint if exists business_payment_accounts_connection_status_check",
    "alter table business_payment_accounts add constraint business_payment_accounts_connection_status_check check (connection_status in ('not_connected', 'setup_required', 'pending', 'active', 'restricted', 'disabled', 'error', 'disconnected', 'connected'))",
    "alter table business_payment_accounts add column if not exists display_name text",
    "alter table business_payment_accounts add column if not exists provider_account_id text",
    "alter table business_payment_accounts add column if not exists provider_merchant_id text",
    "alter table business_payment_accounts add column if not exists activation_status text not null default 'not_applicable'",
    "alter table business_payment_accounts add column if not exists charges_enabled boolean not null default false",
    "alter table business_payment_accounts add column if not exists payments_enabled boolean not null default false",
    "alter table business_payment_accounts add column if not exists payouts_enabled boolean not null default false",
    "alter table business_payment_accounts add column if not exists requirements_due jsonb not null default '[]'::jsonb",
    "alter table business_payment_accounts add column if not exists last_status_check_at timestamptz",
    "alter table business_payment_accounts add column if not exists is_default boolean not null default false",
    "alter table business_payment_accounts add column if not exists is_enabled boolean not null default true",
    "alter table business_payment_accounts add column if not exists onboarding_status text not null default 'not_started'",
    "alter table business_payment_accounts add column if not exists metadata jsonb not null default '{}'::jsonb",
    "alter table business_payment_accounts add column if not exists updated_at timestamptz not null default now()",
    "alter table payments add column if not exists provider_payment_id text",
    "alter table payments add column if not exists provider_order_id text",
    "alter table payments add column if not exists payment_intent_id text",
    "alter table payments add column if not exists payment_method text",
    "alter table payments add column if not exists currency text not null default 'INR'",
    "alter table payments add column if not exists raw_provider_status text",
    "alter table payments add column if not exists updated_at timestamptz not null default now()",
    "alter table payments alter column order_id drop not null",
    "alter table payments drop constraint if exists payments_status_check",
    "alter table payments add constraint payments_status_check check (status in ('pending', 'authorized', 'paid', 'failed', 'cancelled', 'expired', 'refunded', 'pay_at_counter_pending'))",
    "alter table payments drop constraint if exists payments_provider_check",
    "alter table payments add constraint payments_provider_check check (provider is null or provider in ('stripe', 'razorpay', 'paytm', 'pay_at_counter'))",
    "alter table payments add column if not exists collected_by uuid references app_users(id) on delete set null",
    "alter table payments add column if not exists collected_at timestamptz",
    "alter table payments add column if not exists collected_amount numeric(12,2)",
    "alter table payments add column if not exists collection_method text",
    """
    create table if not exists payment_events (
      id uuid primary key default gen_random_uuid(),
      provider text not null check (provider in ('stripe', 'razorpay', 'paytm')),
      event_id text not null,
      business_id uuid references businesses(id) on delete cascade,
      order_id uuid references orders(id) on delete set null,
      payment_id uuid references payments(id) on delete set null,
      event_type text not null,
      signature_valid boolean not null default false,
      processed_at timestamptz,
      raw_payload jsonb not null default '{}'::jsonb,
      idempotency_status text not null default 'processed',
      created_at timestamptz not null default now(),
      unique (provider, event_id)
    )
    """,
    "alter table payment_events drop constraint if exists payment_events_provider_check",
    "alter table payment_events add constraint payment_events_provider_check check (provider in ('stripe', 'razorpay', 'paytm'))",
    "create unique index if not exists business_payment_accounts_one_default_uidx on business_payment_accounts(business_id) where is_default",
    "create unique index if not exists business_payment_accounts_business_provider_uidx on business_payment_accounts(business_id, provider)",
]

CLOSURE_COMPATIBILITY_SQL = [
    "create table if not exists business_locations (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade, name text not null, created_at timestamptz not null default now(), unique (business_id, name))",
    """create table if not exists availability_rules (
      id uuid primary key default gen_random_uuid(),
      business_id uuid not null references businesses(id) on delete cascade,
      target_type text not null check (target_type in ('item','category','combo','location','menu')),
      target_id uuid,
      rule_type text not null check (rule_type in ('schedule','exception')),
      name text,
      is_available boolean not null default true,
      status text not null default 'active' check (status in ('active','paused')),
      days jsonb not null default '[]'::jsonb,
      time_windows jsonb not null default '[]'::jsonb,
      starts_at timestamptz,
      ends_at timestamptz,
      location_ids jsonb not null default '[]'::jsonb,
      reason text,
      created_by uuid references app_users(id) on delete set null,
      updated_by uuid references app_users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )""",
    "create index if not exists availability_rules_business_target_idx on availability_rules(business_id,target_type,target_id)",
    "create index if not exists availability_rules_business_status_idx on availability_rules(business_id,status,rule_type)",
    "create table if not exists kiosk_promotions (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade, name text not null, description text, discount_type text not null default 'percentage', discount_value numeric(10,2) not null default 0, starts_at timestamptz, ends_at timestamptz, status text not null default 'draft', paused_at timestamptz, created_by uuid not null references app_users(id) on delete restrict, updated_by uuid references app_users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())",
    "create table if not exists kiosk_promotion_targets (promotion_id uuid not null references kiosk_promotions(id) on delete cascade, target_type text not null, target_id uuid not null, primary key (promotion_id, target_type, target_id))",
    "create table if not exists kiosk_promotion_locations (promotion_id uuid not null references kiosk_promotions(id) on delete cascade, location_id uuid not null references business_locations(id) on delete cascade, primary key (promotion_id, location_id))",
    "create table if not exists kiosk_promotion_placements (promotion_id uuid not null references kiosk_promotions(id) on delete cascade, placement text not null, primary key (promotion_id, placement))",
    "create table if not exists kiosk_qr_codes (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade, name text not null, destination_type text not null, destination_id uuid, location_id uuid references business_locations(id) on delete set null, table_token text, active boolean not null default true, expires_at timestamptz, tracking_metadata jsonb not null default '{}'::jsonb, created_by uuid not null references app_users(id) on delete restrict, updated_by uuid references app_users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())",
    "create table if not exists kiosk_published_versions (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade, version_number integer not null, config_signature text not null, snapshot jsonb not null, published_by uuid not null references app_users(id) on delete restrict, source_draft_id uuid, published_at timestamptz not null default now(), unique (business_id, version_number))",
    "alter table kiosk_published_versions drop constraint if exists kiosk_published_versions_business_id_config_signature_key",
    "create table if not exists kiosk_restore_lineage (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade, source_version_id uuid not null references kiosk_published_versions(id) on delete restrict, draft_id uuid not null, created_by uuid not null references app_users(id) on delete restrict, created_at timestamptz not null default now())",
]

ADMINISTRATION_COMPATIBILITY_SQL = [
    "alter table business_locations add column if not exists address_line1 text",
    "alter table business_locations add column if not exists city text",
    "alter table business_locations add column if not exists state text",
    "alter table business_locations add column if not exists postal_code text",
    "alter table business_locations add column if not exists country text",
    "alter table business_locations add column if not exists phone text",
    "alter table business_locations add column if not exists timezone text",
    "alter table business_locations add column if not exists currency_code text",
    "alter table business_locations add column if not exists default_language text",
    "alter table business_locations add column if not exists tax_region text",
    "alter table business_locations add column if not exists operating_status text not null default 'open'",
    "alter table business_locations add column if not exists store_schedule jsonb not null default '{}'::jsonb",
    "alter table business_locations add column if not exists ordering_settings jsonb not null default '{}'::jsonb",
    "alter table business_locations add column if not exists receipt_settings jsonb not null default '{}'::jsonb",
    "alter table business_locations add column if not exists created_by uuid references app_users(id) on delete set null",
    "alter table business_locations add column if not exists updated_by uuid references app_users(id) on delete set null",
    "alter table business_locations add column if not exists updated_at timestamptz not null default now()",
    "alter table business_locations drop constraint if exists business_locations_operating_status_check",
    "alter table business_locations add constraint business_locations_operating_status_check check (operating_status in ('open', 'temporarily_closed', 'inactive'))",
    "create index if not exists business_locations_business_status_idx on business_locations(business_id, operating_status)",
    "create index if not exists audit_logs_business_created_idx on audit_logs(business_id, created_at desc)",
]

ADMINISTRATION_CLOSURE_COMPATIBILITY_SQL = [
    "create table if not exists payment_location_assignments (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade, location_id uuid not null references business_locations(id) on delete restrict, provider text not null, enabled_methods jsonb not null default '[]'::jsonb, is_override boolean not null default true, fallback_provider text, terminal_reference text, updated_by uuid references app_users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (business_id, location_id))",
    "create table if not exists business_invitations (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade, email text not null, role text not null, location_ids jsonb not null default '[]'::jsonb, token_hash text not null unique, expires_at timestamptz not null, status text not null default 'pending', created_by uuid references app_users(id) on delete set null, created_at timestamptz not null default now(), accepted_at timestamptz, revoked_at timestamptz)",
    "create table if not exists business_custom_roles (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade, name text not null, permissions jsonb not null default '[]'::jsonb, created_by uuid references app_users(id) on delete set null, created_at timestamptz not null default now(), unique (business_id,name))",
    "alter table business_staff add column if not exists custom_role_id uuid references business_custom_roles(id) on delete set null",
    "create table if not exists business_staff_location_access (business_staff_id uuid not null references business_staff(id) on delete cascade, location_id uuid not null references business_locations(id) on delete cascade, created_at timestamptz not null default now(), primary key (business_staff_id,location_id))",
    "create table if not exists business_security_policies (id uuid primary key default gen_random_uuid(), business_id uuid not null unique references businesses(id) on delete cascade, session_duration_minutes integer not null default 480, reauthentication_minutes integer not null default 15, invitation_expiry_days integer not null default 7, two_factor_required boolean not null default false, inactive_account_days integer not null default 90, updated_by uuid references app_users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())",
    "create table if not exists auth_sessions (id uuid primary key, user_id uuid not null references app_users(id) on delete cascade, token_hash text not null unique, created_at timestamptz not null default now(), expires_at timestamptz not null, last_active_at timestamptz not null default now(), reauthenticated_at timestamptz not null default now(), user_agent text, ip_address inet, revoked_at timestamptz, revoked_by uuid references app_users(id) on delete set null)",
    "alter table auth_sessions add column if not exists reauthenticated_at timestamptz not null default now()",
    "create table if not exists integration_accounts (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade, name text not null, integration_type text not null, status text not null default 'disconnected', last_synchronized_at timestamptz, last_error text, created_by uuid references app_users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())",
    "create table if not exists integration_location_mappings (integration_id uuid not null references integration_accounts(id) on delete cascade, location_id uuid not null references business_locations(id) on delete cascade, primary key(integration_id,location_id))",
    "create table if not exists integration_hardware_mappings (id uuid primary key default gen_random_uuid(), integration_id uuid not null references integration_accounts(id) on delete cascade, hardware_type text not null, external_reference text not null, location_id uuid references business_locations(id) on delete set null, created_at timestamptz not null default now())",
    "create table if not exists integration_api_keys (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade, name text not null, key_hash text not null unique, key_prefix text not null, scopes jsonb not null default '[]'::jsonb, expires_at timestamptz, last_used_at timestamptz, revoked_at timestamptz, created_by uuid references app_users(id) on delete set null, created_at timestamptz not null default now())",
    "create table if not exists integration_webhooks (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade, endpoint_url text not null, events jsonb not null default '[]'::jsonb, signing_secret_hash text not null, is_active boolean not null default true, last_delivered_at timestamptz, created_by uuid references app_users(id) on delete set null, created_at timestamptz not null default now())",
    "alter table integration_api_keys add column if not exists rotated_from_id uuid references integration_api_keys(id) on delete set null",
    "create table if not exists integration_webhook_deliveries (id uuid primary key default gen_random_uuid(), webhook_id uuid not null references integration_webhooks(id) on delete restrict, event_type text not null, event_identifier text not null, attempt_number integer not null default 1, requested_at timestamptz not null default now(), response_status integer, duration_ms integer, result text, next_retry_at timestamptz, retry_state text not null default 'pending', sanitized_error text, created_at timestamptz not null default now(), unique(webhook_id,event_identifier,attempt_number))",
    "alter table integration_webhooks add column if not exists signing_secret_ciphertext text",
    "alter table integration_webhook_deliveries add column if not exists business_id uuid references businesses(id) on delete cascade",
    "alter table integration_webhook_deliveries add column if not exists payload jsonb not null default '{}'::jsonb",
    "alter table integration_webhook_deliveries add column if not exists status text not null default 'pending'",
    "alter table integration_webhook_deliveries add column if not exists last_attempted_at timestamptz",
    "alter table integration_webhook_deliveries add column if not exists completed_at timestamptz",
    "alter table integration_webhook_deliveries add column if not exists failed_at timestamptz",
    "alter table integration_webhook_deliveries add column if not exists claimed_by text",
    "alter table integration_webhook_deliveries add column if not exists claim_expires_at timestamptz",
    "create unique index if not exists integration_webhook_event_once_idx on integration_webhook_deliveries(webhook_id,event_identifier)",
    "create index if not exists integration_webhook_delivery_queue_idx on integration_webhook_deliveries(status,next_retry_at,claim_expires_at)",
]

COUNTER_COMPATIBILITY_SQL = [
    "create table if not exists counter_held_orders (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade, device_id uuid not null references devices(id) on delete cascade, order_reference text, payload jsonb not null, status text not null default 'held' check (status in ('held','resumed','cancelled','expired')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), expires_at timestamptz not null default (now() + interval '24 hours'))",
    "create index if not exists counter_held_orders_scope_idx on counter_held_orders(business_id,device_id,status,created_at desc)",
    "create table if not exists counter_payment_claims (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade, payment_id uuid not null references payments(id) on delete cascade, order_id uuid not null references orders(id) on delete cascade, device_id uuid not null references devices(id) on delete cascade, status text not null default 'claimed' check (status in ('claimed','released','expired','completed')), claimed_at timestamptz not null default now(), expires_at timestamptz not null, released_at timestamptz, created_at timestamptz not null default now())",
    "create unique index if not exists counter_payment_claims_active_uidx on counter_payment_claims(payment_id) where status = 'claimed'",
    "create index if not exists counter_payment_claims_scope_idx on counter_payment_claims(business_id,payment_id,status,expires_at)",
]

KITCHEN_COMPATIBILITY_SQL = [
    "alter table orders add column if not exists source text not null default 'kiosk'",
    "alter table orders add column if not exists location_id uuid references business_locations(id) on delete set null",
    "create table if not exists kitchen_order_states (order_id uuid primary key references orders(id) on delete cascade, business_id uuid not null references businesses(id) on delete cascade, stage text not null check (stage in ('pending','preparing','ready')), is_held boolean not null default false, hold_reason text, held_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now())",
    "create table if not exists kitchen_item_states (order_item_id uuid primary key references order_items(id) on delete cascade, order_id uuid not null references orders(id) on delete cascade, business_id uuid not null references businesses(id) on delete cascade, completed_quantity integer not null default 0 check (completed_quantity >= 0), updated_at timestamptz not null default now())",
    "create table if not exists kitchen_offline_events (event_id uuid primary key, business_id uuid not null references businesses(id) on delete cascade, device_id uuid not null references devices(id) on delete cascade, order_id uuid references orders(id) on delete cascade, action text not null, payload jsonb not null default '{}'::jsonb, status text not null default 'applied', created_at timestamptz not null default now())",
    "create table if not exists kitchen_device_preferences (device_id uuid primary key references devices(id) on delete cascade, sound_enabled boolean not null default true, sound_volume integer not null default 70 check (sound_volume between 0 and 100), updated_at timestamptz not null default now())",
    "create index if not exists kitchen_order_states_scope_idx on kitchen_order_states(business_id,stage,is_held)",
]

DEVICE_ALERT_COMPATIBILITY_SQL = [
    """
    create table if not exists devices (
      id uuid primary key default gen_random_uuid(),
      business_id uuid not null references businesses(id) on delete cascade,
      device_id text not null,
      device_type text not null default 'kiosk',
      name text not null,
      status text not null default 'never_connected' check (status in ('online', 'warning', 'offline', 'never_connected', 'maintenance', 'issue', 'disabled')),
      last_seen timestamptz,
      assigned_kiosk_slug text,
      token_hash text unique,
      token_created_at timestamptz,
      is_active boolean not null default true,
      disabled_at timestamptz,
      location_label text,
      current_route text,
      app_version text,
      user_agent text,
      last_error text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (business_id, device_id)
    )
    """,
    "alter table devices drop constraint if exists devices_status_check",
    "alter table devices add constraint devices_status_check check (status in ('online', 'warning', 'offline', 'never_connected', 'maintenance', 'issue', 'disabled'))",
    "alter table devices add column if not exists token_hash text",
    "alter table devices add column if not exists token_created_at timestamptz",
    "alter table devices add column if not exists is_active boolean not null default true",
    "alter table devices add column if not exists disabled_at timestamptz",
    "alter table devices add column if not exists location_label text",
    "alter table devices add column if not exists current_route text",
    "alter table devices add column if not exists app_version text",
    "alter table devices add column if not exists user_agent text",
    "alter table devices add column if not exists last_error text",
    """
    create table if not exists device_pairing_requests (
      id uuid primary key default gen_random_uuid(),
      business_id uuid not null references businesses(id) on delete cascade,
      pairing_code text not null unique,
      device_type text not null check (device_type in ('kiosk', 'kitchen', 'counter')),
      device_name text,
      location_label text,
      source text not null default 'device_request' check (source in ('device_request', 'admin_activation')),
      status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'claimed', 'expired')),
      requested_at timestamptz not null default now(),
      expires_at timestamptz not null,
      approved_at timestamptz,
      approved_by uuid references app_users(id) on delete set null,
      rejected_at timestamptz,
      rejected_by uuid references app_users(id) on delete set null,
      claimed_at timestamptz,
      device_id uuid references devices(id) on delete set null,
      polling_secret_hash text,
      attempt_count integer not null default 0,
      last_attempt_at timestamptz,
      locked_until timestamptz,
      app_version text,
      user_agent text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
    """,
    "alter table device_pairing_requests add column if not exists polling_secret_hash text",
    "alter table device_pairing_requests add column if not exists attempt_count integer not null default 0",
    "alter table device_pairing_requests add column if not exists last_attempt_at timestamptz",
    "alter table device_pairing_requests add column if not exists locked_until timestamptz",
    """
    create table if not exists alerts (
      id uuid primary key default gen_random_uuid(),
      business_id uuid not null references businesses(id) on delete cascade,
      type text not null,
      severity text not null default 'info' check (severity in ('critical', 'warning', 'info')),
      title text not null,
      message text not null,
      source text not null default 'system',
      status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
      dedupe_key text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      resolved_at timestamptz,
      unique (business_id, dedupe_key)
    )
    """,
]

PRODUCT_COMPATIBILITY_SQL = [
    "alter table products add column if not exists sku text",
    "alter table products add column if not exists item_type text not null default 'other'",
    "alter table products add column if not exists discount_type text not null default 'none'",
    "alter table products add column if not exists discount_value numeric(12,2) not null default 0",
    "alter table products add column if not exists discount_label text",
    "alter table products add column if not exists discount_starts_at timestamptz",
    "alter table products add column if not exists discount_ends_at timestamptz",
    "alter table products add column if not exists primary_image_path text",
    "alter table products add column if not exists is_featured boolean not null default false",
    "alter table products add column if not exists track_stock boolean not null default false",
    "alter table products add column if not exists stock_quantity integer",
    "alter table products add column if not exists daily_limit integer",
    "alter table products add column if not exists sold_today integer not null default 0",
    "alter table products add column if not exists availability_start_time time",
    "alter table products add column if not exists availability_end_time time",
    "alter table products add column if not exists original_price numeric(12,2)",
    "alter table products add column if not exists display_badge text",
    "alter table products add column if not exists tags jsonb not null default '[]'::jsonb",
    """
    do $$
    begin
      if not exists (
        select 1
        from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'products'
          and column_name = 'menu_status'
      ) then
        alter table products add column menu_status text;
        update products
        set menu_status = case when is_available then 'shown' else 'hidden' end;
        alter table products alter column menu_status set default 'shown';
        alter table products alter column menu_status set not null;
      end if;
    end
    $$
    """,
    "alter table products add column if not exists sort_order integer not null default 0",
    "alter table products add column if not exists availability_type text not null default 'always'",
    "alter table products add column if not exists available_days jsonb not null default '[]'::jsonb",
    "alter table products add column if not exists metadata jsonb not null default '{}'::jsonb",
    "alter table products drop constraint if exists products_item_type_check",
    "alter table products add constraint products_item_type_check check (item_type in ('veg', 'non_veg', 'retail', 'service', 'other'))",
    "alter table products drop constraint if exists products_discount_type_check",
    "alter table products add constraint products_discount_type_check check (discount_type in ('none', 'percentage', 'fixed'))",
    "alter table products drop constraint if exists products_stock_quantity_check",
    "alter table products add constraint products_stock_quantity_check check (stock_quantity is null or stock_quantity >= 0)",
    "alter table products drop constraint if exists products_daily_limit_check",
    "alter table products add constraint products_daily_limit_check check (daily_limit is null or daily_limit >= 0)",
    "alter table products drop constraint if exists products_sold_today_check",
    "alter table products add constraint products_sold_today_check check (sold_today >= 0)",
    "alter table products drop constraint if exists products_original_price_check",
    "alter table products add constraint products_original_price_check check (original_price is null or original_price >= 0)",
    "alter table products drop constraint if exists products_menu_status_check",
    "alter table products add constraint products_menu_status_check check (menu_status in ('draft', 'shown', 'hidden', 'unavailable'))",
    "alter table products drop constraint if exists products_availability_type_check",
    "alter table products add constraint products_availability_type_check check (availability_type in ('always', 'scheduled'))",
]

CATEGORY_COMPATIBILITY_SQL = [
    "alter table categories add column if not exists image_path text",
]

MODIFIER_COMPATIBILITY_SQL = [
    "alter table product_modifier_options add column if not exists is_default boolean not null default false",
    "alter table product_modifier_options add column if not exists is_available boolean not null default true",
]

COMBO_COMPATIBILITY_SQL = [
    """
    create table if not exists menu_combos (
      id uuid primary key default gen_random_uuid(),
      business_id uuid not null references businesses(id) on delete cascade,
      category_id uuid references categories(id) on delete set null,
      name text not null,
      description text,
      image_path text,
      price numeric(12,2) not null default 0 check (price >= 0),
      original_price numeric(12,2) check (original_price is null or original_price >= 0),
      display_badge text,
      tags jsonb not null default '[]'::jsonb,
      status text not null default 'draft' check (status in ('draft', 'shown', 'hidden', 'unavailable')),
      sort_order integer not null default 0,
      availability_type text not null default 'always' check (availability_type in ('always', 'scheduled')),
      available_days jsonb not null default '[]'::jsonb,
      available_start_time time,
      available_end_time time,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
    """,
    """
    create table if not exists combo_sections (
      id uuid primary key default gen_random_uuid(),
      combo_id uuid not null references menu_combos(id) on delete cascade,
      title text not null,
      section_type text not null check (section_type in ('included_items', 'optional_upgrades')),
      required boolean not null default false,
      min_select integer not null default 0 check (min_select >= 0),
      max_select integer not null default 1 check (max_select >= 0),
      sort_order integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (min_select <= max_select)
    )
    """,
    """
    create table if not exists combo_options (
      id uuid primary key default gen_random_uuid(),
      combo_id uuid not null references menu_combos(id) on delete cascade,
      section_id uuid not null references combo_sections(id) on delete cascade,
      source_type text not null check (source_type in ('existing_item', 'exclusive_combo_item')),
      existing_item_id uuid references products(id) on delete set null,
      exclusive_name text,
      exclusive_description text,
      exclusive_image_path text,
      exclusive_type text check (exclusive_type is null or exclusive_type in ('main', 'side', 'drink', 'dessert', 'add_on')),
      quantity integer not null default 1 check (quantity >= 1),
      price_impact numeric(12,2) not null default 0 check (price_impact >= 0),
      default_selected boolean not null default true,
      removable boolean not null default true,
      visible boolean not null default true,
      sort_order integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint combo_options_source_integrity_check check (
        (source_type = 'existing_item' and exclusive_name is null)
        or
        (source_type = 'exclusive_combo_item' and existing_item_id is null and exclusive_name is not null)
      )
    )
    """,
    "alter table combo_options drop constraint if exists combo_options_check",
    "alter table combo_options drop constraint if exists combo_options_source_integrity_check",
    """
    alter table combo_options
    add constraint combo_options_source_integrity_check
    check (
      (source_type = 'existing_item' and exclusive_name is null)
      or
      (source_type = 'exclusive_combo_item' and existing_item_id is null and exclusive_name is not null)
    )
    """,
]

SETUP_COMPATIBILITY_SQL = [
    """
    create table if not exists kiosk_test_orders (
      id uuid primary key default gen_random_uuid(),
      business_id uuid not null references businesses(id) on delete cascade,
      kiosk_id text not null,
      config_signature text not null,
      operational_mode text not null default 'test' check (operational_mode = 'test'),
      is_test boolean not null default true check (is_test),
      confirmation_reached boolean not null default true,
      status text not null check (status in ('succeeded')),
      payment_method text not null check (payment_method = 'test_payment'),
      test_payment_result text not null check (test_payment_result = 'succeeded'),
      order_type text not null,
      items jsonb not null default '[]'::jsonb,
      subtotal numeric(12,2) not null default 0,
      tax_amount numeric(12,2) not null default 0,
      total_amount numeric(12,2) not null default 0,
      created_by uuid not null references app_users(id) on delete restrict,
      created_at timestamptz not null default now(),
      completed_at timestamptz not null default now()
    )
    """,
    "alter table kiosk_test_orders add column if not exists kiosk_id text",
    "alter table kiosk_test_orders add column if not exists test_payment_result text not null default 'succeeded'",
    "alter table kiosk_test_orders add column if not exists operational_mode text not null default 'test'",
    "alter table kiosk_test_orders add column if not exists is_test boolean not null default true",
    "alter table kiosk_test_orders add column if not exists confirmation_reached boolean not null default true",
    "alter table kiosk_test_orders add column if not exists completed_at timestamptz not null default now()",
    """
    create table if not exists kiosk_setup_attestations (
      id uuid primary key default gen_random_uuid(),
      business_id uuid not null references businesses(id) on delete cascade,
      kiosk_id text not null,
      kind text not null check (kind in ('preview', 'test')),
      operational_mode text not null check (operational_mode in ('preview', 'test')),
      config_signature text not null,
      event_version integer not null default 1,
      test_order_id uuid references kiosk_test_orders(id) on delete set null,
      confirmation_reached boolean not null default false,
      successful_result boolean,
      created_by uuid not null references app_users(id) on delete restrict,
      created_at timestamptz not null default now()
    )
    """,
    "alter table kiosk_setup_attestations add column if not exists kiosk_id text",
    "alter table kiosk_setup_attestations add column if not exists operational_mode text",
    "alter table kiosk_setup_attestations add column if not exists confirmation_reached boolean not null default false",
    "alter table kiosk_setup_attestations add column if not exists successful_result boolean",
    """
    create table if not exists kiosk_published_configs (
      business_id uuid primary key references businesses(id) on delete cascade,
      config_signature text not null,
      snapshot jsonb not null,
      published_by uuid not null references app_users(id) on delete restrict,
      published_at timestamptz not null default now()
    )
    """,
    """
    create table if not exists kiosk_test_sessions (
      id uuid primary key default gen_random_uuid(),
      business_id uuid not null references businesses(id) on delete cascade,
      token_hash text not null unique,
      created_by uuid not null references app_users(id) on delete restrict,
      expires_at timestamptz not null,
      revoked_at timestamptz,
      last_used_at timestamptz,
      created_at timestamptz not null default now()
    )
    """,
    "alter table orders add column if not exists idempotency_key text",
]

INDEX_COMPATIBILITY_SQL = [
    "create index if not exists businesses_owner_id_idx on businesses(owner_id)",
    "create index if not exists businesses_slug_idx on businesses(slug)",
    "create index if not exists business_staff_user_id_idx on business_staff(user_id)",
    "create index if not exists business_staff_business_id_idx on business_staff(business_id)",
    "create index if not exists categories_business_id_idx on categories(business_id)",
    "create index if not exists products_business_id_idx on products(business_id)",
    "create index if not exists products_category_id_idx on products(category_id)",
    "create index if not exists products_business_availability_idx on products(business_id, is_available)",
    "create index if not exists products_business_sort_order_idx on products(business_id, sort_order, created_at)",
    "create index if not exists product_modifier_groups_product_id_idx on product_modifier_groups(product_id)",
    "create index if not exists product_modifier_options_group_id_idx on product_modifier_options(group_id)",
    "create index if not exists menu_combos_business_id_idx on menu_combos(business_id)",
    "create index if not exists menu_combos_business_sort_order_idx on menu_combos(business_id, sort_order, created_at)",
    "create index if not exists combo_sections_combo_id_idx on combo_sections(combo_id)",
    "create index if not exists combo_options_combo_id_idx on combo_options(combo_id)",
    "create index if not exists combo_options_section_id_idx on combo_options(section_id)",
    "create index if not exists combo_options_existing_item_id_idx on combo_options(existing_item_id)",
    "create index if not exists kiosk_setup_attestations_business_kind_idx on kiosk_setup_attestations(business_id, kind, created_at desc)",
    "create index if not exists kiosk_test_orders_business_created_idx on kiosk_test_orders(business_id, created_at desc)",
    "create index if not exists kiosk_test_sessions_business_created_idx on kiosk_test_sessions(business_id, created_at desc)",
    "create index if not exists kiosk_test_sessions_expires_at_idx on kiosk_test_sessions(expires_at)",
    "create index if not exists orders_business_status_idx on orders(business_id, status)",
    "create index if not exists orders_placed_at_idx on orders(placed_at)",
    "create index if not exists orders_business_order_date_idx on orders(business_id, order_date)",
    "create index if not exists orders_business_created_at_idx on orders(business_id, placed_at)",
    "create unique index if not exists orders_business_idempotency_uidx on orders(business_id, idempotency_key) where idempotency_key is not null",
    "create index if not exists business_payment_accounts_business_provider_idx on business_payment_accounts(business_id, provider)",
    "create index if not exists payments_business_status_idx on payments(business_id, status)",
    "create index if not exists payments_order_id_idx on payments(order_id)",
    "create index if not exists payment_events_provider_event_id_idx on payment_events(provider, event_id)",
    "create index if not exists devices_business_status_idx on devices(business_id, status)",
    "create index if not exists devices_business_last_seen_idx on devices(business_id, last_seen)",
    "create unique index if not exists devices_token_hash_uidx on devices(token_hash) where token_hash is not null",
    "create index if not exists device_pairing_requests_business_status_idx on device_pairing_requests(business_id, status, requested_at desc)",
    "create index if not exists device_pairing_requests_expires_at_idx on device_pairing_requests(expires_at)",
    "create unique index if not exists device_pairing_requests_pairing_code_uidx on device_pairing_requests(pairing_code)",
    "create index if not exists alerts_business_status_idx on alerts(business_id, status)",
    "create index if not exists alerts_business_created_at_idx on alerts(business_id, created_at)",
    "create index if not exists order_items_order_id_idx on order_items(order_id)",
    "create index if not exists order_items_business_id_idx on order_items(business_id)",
    "create index if not exists order_items_product_id_idx on order_items(product_id)",
    "create index if not exists audit_logs_user_id_fk_idx on public.audit_logs (user_id);",
    "create index if not exists auth_sessions_revoked_by_fk_idx on public.auth_sessions (revoked_by);",
    "create index if not exists auth_sessions_user_id_fk_idx on public.auth_sessions (user_id);",
    "create index if not exists availability_rules_created_by_fk_idx on public.availability_rules (created_by);",
    "create index if not exists availability_rules_updated_by_fk_idx on public.availability_rules (updated_by);",
    "create index if not exists business_locations_created_by_fk_idx on public.business_locations (created_by);",
    "create index if not exists business_locations_updated_by_fk_idx on public.business_locations (updated_by);",
    "create index if not exists counter_held_orders_business_id_fk_idx on public.counter_held_orders (business_id);",
    "create index if not exists counter_held_orders_device_id_fk_idx on public.counter_held_orders (device_id);",
    "create index if not exists counter_payment_claims_business_id_fk_idx on public.counter_payment_claims (business_id);",
    "create index if not exists counter_payment_claims_device_id_fk_idx on public.counter_payment_claims (device_id);",
    "create index if not exists counter_payment_claims_order_id_fk_idx on public.counter_payment_claims (order_id);",
    "create index if not exists device_pairing_requests_approved_by_fk_idx on public.device_pairing_requests (approved_by);",
    "create index if not exists device_pairing_requests_device_id_fk_idx on public.device_pairing_requests (device_id);",
    "create index if not exists device_pairing_requests_rejected_by_fk_idx on public.device_pairing_requests (rejected_by);",
    "create index if not exists kiosk_promotion_locations_location_id_fk_idx on public.kiosk_promotion_locations (location_id);",
    "create index if not exists kiosk_promotions_business_id_fk_idx on public.kiosk_promotions (business_id);",
    "create index if not exists kiosk_promotions_created_by_fk_idx on public.kiosk_promotions (created_by);",
    "create index if not exists kiosk_promotions_updated_by_fk_idx on public.kiosk_promotions (updated_by);",
    "create index if not exists kiosk_published_configs_published_by_fk_idx on public.kiosk_published_configs (published_by);",
    "create index if not exists kiosk_published_versions_published_by_fk_idx on public.kiosk_published_versions (published_by);",
    "create index if not exists kiosk_qr_codes_business_id_fk_idx on public.kiosk_qr_codes (business_id);",
    "create index if not exists kiosk_qr_codes_created_by_fk_idx on public.kiosk_qr_codes (created_by);",
    "create index if not exists kiosk_qr_codes_location_id_fk_idx on public.kiosk_qr_codes (location_id);",
    "create index if not exists kiosk_qr_codes_updated_by_fk_idx on public.kiosk_qr_codes (updated_by);",
    "create index if not exists kiosk_restore_lineage_business_id_fk_idx on public.kiosk_restore_lineage (business_id);",
    "create index if not exists kiosk_restore_lineage_created_by_fk_idx on public.kiosk_restore_lineage (created_by);",
    "create index if not exists kiosk_restore_lineage_source_version_id_fk_idx on public.kiosk_restore_lineage (source_version_id);",
    "create index if not exists kiosk_setup_attestations_created_by_fk_idx on public.kiosk_setup_attestations (created_by);",
    "create index if not exists kiosk_setup_attestations_test_order_id_fk_idx on public.kiosk_setup_attestations (test_order_id);",
    "create index if not exists kiosk_test_orders_created_by_fk_idx on public.kiosk_test_orders (created_by);",
    "create index if not exists kiosk_test_sessions_created_by_fk_idx on public.kiosk_test_sessions (created_by);",
    "create index if not exists kitchen_events_business_id_fk_idx on public.kitchen_events (business_id);",
    "create index if not exists kitchen_events_changed_by_fk_idx on public.kitchen_events (changed_by);",
    "create index if not exists kitchen_events_order_id_fk_idx on public.kitchen_events (order_id);",
    "create index if not exists kitchen_item_states_business_id_fk_idx on public.kitchen_item_states (business_id);",
    "create index if not exists kitchen_item_states_order_id_fk_idx on public.kitchen_item_states (order_id);",
    "create index if not exists kitchen_offline_events_business_id_fk_idx on public.kitchen_offline_events (business_id);",
    "create index if not exists kitchen_offline_events_device_id_fk_idx on public.kitchen_offline_events (device_id);",
    "create index if not exists kitchen_offline_events_order_id_fk_idx on public.kitchen_offline_events (order_id);",
    "create index if not exists menu_combos_category_id_fk_idx on public.menu_combos (category_id);",
    "create index if not exists order_items_product_id_fk_idx on public.order_items (product_id);",
    "create index if not exists orders_location_id_fk_idx on public.orders (location_id);",
    "create index if not exists payment_events_business_id_fk_idx on public.payment_events (business_id);",
    "create index if not exists payment_events_order_id_fk_idx on public.payment_events (order_id);",
    "create index if not exists payment_events_payment_id_fk_idx on public.payment_events (payment_id);",
    "create index if not exists payments_collected_by_fk_idx on public.payments (collected_by);",
    "create index if not exists product_modifier_groups_business_id_fk_idx on public.product_modifier_groups (business_id);",
    "create index if not exists product_modifier_options_group_id_fk_idx on public.product_modifier_options (group_id);",
    "create index if not exists test_runtime_availability_overrides_product_id_fk_idx on public.test_runtime_availability_overrides (product_id);",
    "create index if not exists test_runtime_order_events_business_id_fk_idx on public.test_runtime_order_events (business_id);",
    "create index if not exists test_runtime_order_events_order_id_fk_idx on public.test_runtime_order_events (order_id);",
    "create index if not exists test_runtime_orders_business_id_fk_idx on public.test_runtime_orders (business_id);"
]


def ensure_schema_compatibility(database_url: str) -> None:
    try:
        with connect(database_url) as connection:
            for statement in [
                *BUSINESS_COMPATIBILITY_SQL,
                *ORDER_COMPATIBILITY_SQL,
                *CATEGORY_COMPATIBILITY_SQL,
                *PRODUCT_COMPATIBILITY_SQL,
                *MODIFIER_COMPATIBILITY_SQL,
                *COMBO_COMPATIBILITY_SQL,
                *SETUP_COMPATIBILITY_SQL,
                *PAYMENT_COMPATIBILITY_SQL,
                *CLOSURE_COMPATIBILITY_SQL,
                *ADMINISTRATION_COMPATIBILITY_SQL,
                *ADMINISTRATION_CLOSURE_COMPATIBILITY_SQL,
                *COUNTER_COMPATIBILITY_SQL,
                *KITCHEN_COMPATIBILITY_SQL,
                *DEVICE_ALERT_COMPATIBILITY_SQL,
                *INDEX_COMPATIBILITY_SQL,
            ]:
                try:
                    connection.execute(statement)
                    connection.commit()
                except Exception as exc:
                    connection.rollback()
                    logger.warning("Schema compatibility statement skipped: %s", exc)
            connection.execute(
                """DO $$
                DECLARE item record;
                BEGIN
                  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
                    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.tablename);
                  END LOOP;
                  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
                    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
                  END IF;
                  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
                    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
                  END IF;
                END $$"""
            )
            connection.commit()
            assert_analytics_order_schema(connection)
    except SchemaContractError:
        raise
    except Exception as exc:
        logger.warning("Database schema compatibility check could not run: %s", exc)
