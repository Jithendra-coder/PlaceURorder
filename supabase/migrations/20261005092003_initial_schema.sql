create extension if not exists pgcrypto;
create schema if not exists extensions;
create extension if not exists citext with schema extensions;

do $$
begin
  if exists (
    select 1 from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'citext' and n.nspname <> 'extensions'
  ) then
    execute 'alter extension citext set schema extensions';
  end if;
end;
$$;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null unique,
  password_hash text not null,
  full_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

drop trigger if exists app_users_set_updated_at on app_users;
create trigger app_users_set_updated_at
before update on app_users
for each row execute function set_updated_at();

create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_id_idx on password_reset_tokens(user_id);
create index if not exists password_reset_tokens_expires_at_idx on password_reset_tokens(expires_at);

create table if not exists email_verification_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists email_verification_codes_user_id_idx on email_verification_codes(user_id);
create index if not exists email_verification_codes_expires_at_idx on email_verification_codes(expires_at);

create table if not exists profiles (
  id uuid primary key references app_users(id) on delete cascade,
  email extensions.citext,
  full_name text,
  onboarding_business_type text,
  onboarding_business_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles
add column if not exists onboarding_business_type text;

alter table profiles
add column if not exists onboarding_business_description text;

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at
before update on profiles
for each row execute function set_updated_at();

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references app_users(id) on delete cascade,
  name text not null check (length(name) >= 2),
  slug text not null unique,
  type text not null default 'restaurant',
  business_subtype text,
  contact_phone text,
  tagline text,
  logo_path text,
  logo_shape text not null default 'square' check (logo_shape in ('circle', 'square', 'rectangle')),
  logo_scale integer not null default 120 check (logo_scale >= 60 and logo_scale <= 220),
  logo_position_x integer not null default 50 check (logo_position_x >= 0 and logo_position_x <= 100),
  logo_position_y integer not null default 50 check (logo_position_y >= 0 and logo_position_y <= 100),
  brand_color text not null default '#1A4D2E',
  kiosk_layout_id text not null default 'top-navigation' check (kiosk_layout_id in ('side-navigation', 'top-navigation', 'category-first')),
  kiosk_theme text not null default 'top_category:premium_light',
  kiosk_layout text not null default 'wide_16_9',
  kiosk_screen_orientation text not null default 'landscape' check (kiosk_screen_orientation in ('landscape', 'portrait')),
  kiosk_screen_size text not null default '32',
  kiosk_cart_mode text not null default 'page' check (kiosk_cart_mode in ('drawer', 'page')),
  kiosk_start_screen_enabled boolean not null default true,
  kiosk_start_text_position text not null default 'middle' check (kiosk_start_text_position in ('top', 'middle', 'bottom')),
  kiosk_touch_to_start boolean not null default false,
  welcome_screen jsonb not null default '{"enabled":true,"heading":"Welcome","supporting_text":"","instruction_text":"Tap to begin","start_button_text":"Start","text_position":"middle","touch_anywhere_to_start":false,"show_business_logo":true}'::jsonb,
  kiosk_start_screen_settings jsonb not null default '{}'::jsonb,
  kiosk_lock_settings jsonb not null default '{}'::jsonb,
  kiosk_order_settings jsonb not null default '{}'::jsonb,
  display_show_tagline boolean not null default true,
  display_show_category_images boolean not null default true,
  display_show_item_descriptions boolean not null default true,
  display_show_prices boolean not null default true,
  display_show_unavailable boolean not null default true,
  idle_timeout_seconds integer not null default 60 check (idle_timeout_seconds >= 15 and idle_timeout_seconds <= 600),
  order_reset_seconds integer not null default 5 check (order_reset_seconds >= 5 and order_reset_seconds <= 10),
  default_language text not null default 'English',
  sound_effects_enabled boolean not null default true,
  offer_enabled boolean not null default false,
  offer_title text not null default 'Fresh choices, smart savings',
  offer_subtitle text not null default 'Discover today''s best picks and seasonal offers.',
  offer_badge text not null default 'Up to 25% off',
  offer_cta text not null default 'Shop now',
  offer_image_path text,
  offer_background text not null default 'emerald',
  currency_code text not null default 'INR',
  currency_symbol text not null default 'Rs',
  tax_percent numeric(6,2) not null default 0 check (tax_percent >= 0 and tax_percent <= 100),
  address_line1 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'India',
  timezone text not null default 'Asia/Kolkata',
  opening_time time,
  closing_time time,
  order_modes jsonb not null default '["dine_in", "takeaway"]'::jsonb,
  store_schedule jsonb not null default '{}'::jsonb,
  receipt_settings jsonb not null default '{}'::jsonb,
  owner_pin_hash text,
  owner_pin_set_at timestamptz,
  pin_failed_attempts integer not null default 0,
  pin_locked_until timestamptz,
  onboarding_step integer not null default 0,
  onboarding_completed boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table businesses
add column if not exists contact_phone text,
add column if not exists kiosk_layout_id text not null default 'top-navigation',
add column if not exists logo_scale integer not null default 120,
add column if not exists logo_position_x integer not null default 50,
add column if not exists logo_position_y integer not null default 50,
add column if not exists offer_enabled boolean not null default false,
add column if not exists offer_title text not null default 'Fresh choices, smart savings',
add column if not exists offer_subtitle text not null default 'Discover today''s best picks and seasonal offers.',
add column if not exists offer_badge text not null default 'Up to 25% off',
add column if not exists offer_cta text not null default 'Shop now',
add column if not exists offer_image_path text,
add column if not exists offer_background text not null default 'emerald',
add column if not exists kiosk_layout text not null default 'wide_16_9',
add column if not exists kiosk_screen_orientation text not null default 'landscape',
add column if not exists kiosk_screen_size text not null default '32',
add column if not exists kiosk_cart_mode text not null default 'page',
add column if not exists kiosk_start_screen_enabled boolean not null default true,
add column if not exists kiosk_start_text_position text not null default 'middle',
add column if not exists kiosk_touch_to_start boolean not null default false,
add column if not exists welcome_screen jsonb not null default '{"enabled":true,"heading":"Welcome","supporting_text":"","instruction_text":"Tap to begin","start_button_text":"Start","text_position":"middle","touch_anywhere_to_start":false,"show_business_logo":true}'::jsonb,
add column if not exists kiosk_start_screen_settings jsonb not null default '{}'::jsonb,
add column if not exists kiosk_lock_settings jsonb not null default '{}'::jsonb,
add column if not exists kiosk_order_settings jsonb not null default '{}'::jsonb,
add column if not exists store_schedule jsonb not null default '{}'::jsonb,
add column if not exists receipt_settings jsonb not null default '{}'::jsonb,
add column if not exists owner_pin_hash text,
add column if not exists owner_pin_set_at timestamptz,
add column if not exists pin_failed_attempts integer not null default 0,
add column if not exists pin_locked_until timestamptz,
add column if not exists display_show_tagline boolean not null default true,
add column if not exists display_show_category_images boolean not null default true,
add column if not exists display_show_item_descriptions boolean not null default true,
add column if not exists display_show_prices boolean not null default true,
add column if not exists display_show_unavailable boolean not null default true,
add column if not exists idle_timeout_seconds integer not null default 60,
add column if not exists order_reset_seconds integer not null default 5,
add column if not exists default_language text not null default 'English',
add column if not exists sound_effects_enabled boolean not null default true;

alter table businesses
drop constraint if exists businesses_kiosk_cart_mode_check;

alter table businesses
drop constraint if exists businesses_kiosk_layout_id_check;

alter table businesses
add constraint businesses_kiosk_layout_id_check
check (kiosk_layout_id in ('side-navigation', 'top-navigation', 'category-first'));

alter table businesses
add constraint businesses_kiosk_cart_mode_check
check (kiosk_cart_mode in ('drawer', 'page'));

alter table businesses
drop constraint if exists businesses_kiosk_screen_orientation_check;

alter table businesses
add constraint businesses_kiosk_screen_orientation_check
check (kiosk_screen_orientation in ('landscape', 'portrait'));

alter table businesses
alter column kiosk_theme set default 'top_category:premium_light';

alter table businesses
alter column offer_enabled set default false;

alter table businesses
alter column kiosk_cart_mode set default 'page';


alter table businesses
drop constraint if exists businesses_idle_timeout_seconds_check;

alter table businesses
add constraint businesses_idle_timeout_seconds_check
check (idle_timeout_seconds >= 15 and idle_timeout_seconds <= 600);

alter table businesses
drop constraint if exists businesses_order_reset_seconds_check;

alter table businesses
add constraint businesses_order_reset_seconds_check
check (order_reset_seconds >= 5 and order_reset_seconds <= 10);

alter table businesses
drop constraint if exists businesses_logo_scale_check;

alter table businesses
add constraint businesses_logo_scale_check
check (logo_scale >= 60 and logo_scale <= 220);

alter table businesses
drop constraint if exists businesses_logo_position_x_check;

alter table businesses
add constraint businesses_logo_position_x_check
check (logo_position_x >= 0 and logo_position_x <= 100);

alter table businesses
drop constraint if exists businesses_logo_position_y_check;

alter table businesses
add constraint businesses_logo_position_y_check
check (logo_position_y >= 0 and logo_position_y <= 100);

drop trigger if exists businesses_set_updated_at on businesses;
create trigger businesses_set_updated_at
before update on businesses
for each row execute function set_updated_at();

create index if not exists businesses_owner_id_idx on businesses(owner_id);
create index if not exists businesses_slug_idx on businesses(slug);

create table if not exists business_staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner', 'admin', 'manager', 'kitchen', 'cashier', 'salon_staff', 'kiosk', 'viewer')),
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create index if not exists business_staff_user_id_idx on business_staff(user_id);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  description text,
  image_path text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists categories_set_updated_at on categories;
create trigger categories_set_updated_at
before update on categories
for each row execute function set_updated_at();

create index if not exists categories_business_id_idx on categories(business_id);

alter table categories
add column if not exists image_path text;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  name text not null,
  description text,
  sku text,
  item_type text not null default 'other' check (item_type in ('veg', 'non_veg', 'retail', 'service', 'other')),
  price numeric(12,2) not null check (price >= 0),
  discount_type text not null default 'none' check (discount_type in ('none', 'percentage', 'fixed')),
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  discount_label text,
  discount_starts_at timestamptz,
  discount_ends_at timestamptz,
  primary_image_path text,
  is_available boolean not null default true,
  is_featured boolean not null default false,
  track_stock boolean not null default false,
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  daily_limit integer check (daily_limit is null or daily_limit >= 0),
  sold_today integer not null default 0 check (sold_today >= 0),
  availability_start_time time,
  availability_end_time time,
  original_price numeric(12,2) check (original_price is null or original_price >= 0),
  display_badge text,
  tags jsonb not null default '[]'::jsonb,
  menu_status text not null default 'shown' check (menu_status in ('draft', 'shown', 'hidden', 'unavailable')),
  sort_order integer not null default 0,
  availability_type text not null default 'always' check (availability_type in ('always', 'scheduled')),
  available_days jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table products
add column if not exists discount_type text not null default 'none',
add column if not exists sku text,
add column if not exists item_type text not null default 'other',
add column if not exists discount_value numeric(12,2) not null default 0,
add column if not exists discount_label text,
add column if not exists discount_starts_at timestamptz,
add column if not exists discount_ends_at timestamptz,
add column if not exists primary_image_path text,
add column if not exists is_featured boolean not null default false,
add column if not exists track_stock boolean not null default false,
add column if not exists stock_quantity integer,
add column if not exists daily_limit integer,
add column if not exists sold_today integer not null default 0,
add column if not exists availability_start_time time,
add column if not exists availability_end_time time,
add column if not exists original_price numeric(12,2),
add column if not exists display_badge text,
add column if not exists tags jsonb not null default '[]'::jsonb,
add column if not exists sort_order integer not null default 0,
add column if not exists availability_type text not null default 'always',
add column if not exists available_days jsonb not null default '[]'::jsonb,
add column if not exists metadata jsonb not null default '{}'::jsonb;

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
$$;

alter table products
drop constraint if exists products_discount_type_check;

alter table products
add constraint products_discount_type_check
check (discount_type in ('none', 'percentage', 'fixed'));

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at
before update on products
for each row execute function set_updated_at();

create index if not exists products_business_id_idx on products(business_id);
create index if not exists products_category_id_idx on products(category_id);
create index if not exists products_business_sort_order_idx on products(business_id, sort_order, created_at);

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
);

drop trigger if exists menu_combos_set_updated_at on menu_combos;
create trigger menu_combos_set_updated_at
before update on menu_combos
for each row execute function set_updated_at();

create index if not exists menu_combos_business_id_idx on menu_combos(business_id);
create index if not exists menu_combos_business_sort_order_idx on menu_combos(business_id, sort_order, created_at);

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
);

drop trigger if exists combo_sections_set_updated_at on combo_sections;
create trigger combo_sections_set_updated_at
before update on combo_sections
for each row execute function set_updated_at();

create index if not exists combo_sections_combo_id_idx on combo_sections(combo_id);

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
);

drop trigger if exists combo_options_set_updated_at on combo_options;
create trigger combo_options_set_updated_at
before update on combo_options
for each row execute function set_updated_at();

create index if not exists combo_options_combo_id_idx on combo_options(combo_id);
create index if not exists combo_options_section_id_idx on combo_options(section_id);
create index if not exists combo_options_existing_item_id_idx on combo_options(existing_item_id);

create table if not exists product_modifier_groups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  name text not null,
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer not null default 1 check (max_select >= 0),
  is_required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists product_modifier_groups_set_updated_at on product_modifier_groups;
create trigger product_modifier_groups_set_updated_at
before update on product_modifier_groups
for each row execute function set_updated_at();

create index if not exists product_modifier_groups_product_id_idx on product_modifier_groups(product_id);

create table if not exists product_modifier_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references product_modifier_groups(id) on delete cascade,
  name text not null,
  price_delta numeric(12,2) not null default 0,
  is_default boolean not null default false,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table product_modifier_options
add column if not exists is_default boolean not null default false;

drop trigger if exists product_modifier_options_set_updated_at on product_modifier_options;
create trigger product_modifier_options_set_updated_at
before update on product_modifier_options
for each row execute function set_updated_at();

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
);

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
);

create table if not exists kiosk_published_configs (
  business_id uuid primary key references businesses(id) on delete cascade,
  config_signature text not null,
  snapshot jsonb not null,
  published_by uuid not null references app_users(id) on delete restrict,
  published_at timestamptz not null default now()
);

create table if not exists kiosk_test_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references app_users(id) on delete restrict,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists kiosk_test_sessions_business_created_idx
on kiosk_test_sessions(business_id, created_at desc);

create index if not exists kiosk_test_sessions_expires_at_idx
on kiosk_test_sessions(expires_at);

create table if not exists test_runtime_orders (
  id uuid primary key default gen_random_uuid(), test_session_id uuid not null references kiosk_test_sessions(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade, source text not null check (source in ('kiosk','counter')),
  order_type text not null check (order_type in ('dine_in','takeaway')), items jsonb not null default '[]'::jsonb, notes text,
  payment_status text not null default 'awaiting_payment' check (payment_status in ('awaiting_payment','paid')),
  kitchen_status text not null default 'pending_payment' check (kitchen_status in ('pending_payment','pending','preparing','ready','completed')),
  is_held boolean not null default false, held_at timestamptz, handed_over_at timestamptz, location_id uuid,
  hold_reason text, held_by uuid, previous_kitchen_status text, handover_metadata jsonb not null default '{}'::jsonb,
  idempotency_key text, preparing_started_at timestamptz, ready_at timestamptz, completed_at timestamptz,
  rework_requested boolean not null default false, rework_reason text, rework_requested_at timestamptz,
  rework_metadata jsonb not null default '{}'::jsonb, table_label text,
  subtotal numeric(12,2) not null default 0, tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0, payment_method text, paid_at timestamptz, handed_over_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists test_runtime_orders_session_status_idx on test_runtime_orders(test_session_id, kitchen_status, created_at);
create unique index if not exists test_runtime_orders_idempotency_uidx on test_runtime_orders(test_session_id, business_id, idempotency_key) where idempotency_key is not null;
create table if not exists test_runtime_order_events (
  id uuid primary key default gen_random_uuid(), test_session_id uuid not null references kiosk_test_sessions(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade, order_id uuid not null references test_runtime_orders(id) on delete cascade,
  app_type text not null check (app_type in ('kiosk','counter','kitchen')), event_type text not null, from_status text, to_status text,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists test_runtime_order_events_order_idx on test_runtime_order_events(test_session_id, business_id, order_id, created_at);
create table if not exists test_runtime_availability_overrides (
  test_session_id uuid not null references kiosk_test_sessions(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade, is_available boolean not null,
  updated_at timestamptz not null default now(), primary key (test_session_id, product_id)
);

create index if not exists kiosk_setup_attestations_business_kind_idx
on kiosk_setup_attestations(business_id, kind, created_at desc);

create index if not exists kiosk_test_orders_business_created_idx
on kiosk_test_orders(business_id, created_at desc);

create table if not exists business_locations (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
  name text not null, address_line1 text, city text, state text, postal_code text, country text, phone text,
  timezone text, currency_code text, default_language text, tax_region text,
  operating_status text not null default 'open' check (operating_status in ('open', 'temporarily_closed', 'inactive')),
  store_schedule jsonb not null default '{}'::jsonb, ordering_settings jsonb not null default '{}'::jsonb,
  receipt_settings jsonb not null default '{}'::jsonb, created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique (business_id, name)
);
create index if not exists business_locations_business_status_idx on business_locations(business_id, operating_status);

create table if not exists order_counters (
  business_id uuid not null references businesses(id) on delete cascade,
  counter_date date not null default current_date,
  next_number integer not null default 1,
  primary key (business_id, counter_date)
);

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
$$ language plpgsql;

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  location_id uuid references business_locations(id) on delete set null,
  order_number integer,
  order_date date not null default current_date,
  public_token text default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  status text not null default 'pending' check (status in ('payment_pending', 'pending', 'preparing', 'ready', 'completed', 'cancelled')),
  order_type text not null default 'dine_in' check (order_type in ('dine_in', 'takeaway', 'delivery', 'pickup')),
  table_label text,
  customer_name text,
  customer_phone text,
  subtotal numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'pending', 'authorized', 'paid', 'failed', 'cancelled', 'expired', 'refunded', 'pay_at_counter_pending')),
  payment_method text,
  notes text,
  idempotency_key text,
  source text not null default 'kiosk',
  placed_at timestamptz not null default now(),
  prep_started_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table orders
add column if not exists order_date date not null default current_date,
add column if not exists cancel_reason text;

update orders
set order_date = placed_at::date
where placed_at is not null
  and order_date <> placed_at::date;

alter table orders
drop constraint if exists orders_business_id_order_number_placed_at_key;

drop trigger if exists orders_set_updated_at on orders;
create trigger orders_set_updated_at
before update on orders
for each row execute function set_updated_at();

create index if not exists orders_business_status_idx on orders(business_id, status);
create index if not exists orders_placed_at_idx on orders(placed_at);
create index if not exists orders_business_order_date_idx on orders(business_id, order_date);
create unique index if not exists orders_business_order_date_number_uidx
on orders(business_id, order_date, order_number)
where order_number is not null;
create unique index if not exists orders_business_idempotency_uidx
on orders(business_id, idempotency_key)
where idempotency_key is not null;

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null default 0,
  total_price numeric(12,2) not null default 0,
  notes text,
  customizations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on order_items(order_id);
create index if not exists order_items_business_id_idx on order_items(business_id);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  provider text check (provider is null or provider in ('stripe', 'razorpay', 'paytm', 'pay_at_counter')),
  provider_reference text,
  provider_payment_id text,
  provider_order_id text,
  payment_intent_id text,
  amount numeric(12,2) not null default 0,
  currency text not null default 'INR',
  status text not null default 'pending' check (status in ('pending', 'authorized', 'paid', 'failed', 'cancelled', 'expired', 'refunded', 'pay_at_counter_pending')),
  payment_method text,
  raw_provider_status text,
  raw_payload jsonb not null default '{}'::jsonb,
  collected_by uuid references app_users(id) on delete set null,
  collected_at timestamptz,
  collected_amount numeric(12,2),
  collection_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
);

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
);

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
);

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
);

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
);

create index if not exists business_payment_accounts_business_provider_idx on business_payment_accounts(business_id, provider);
create unique index if not exists business_payment_accounts_business_provider_uidx on business_payment_accounts(business_id, provider);
create unique index if not exists business_payment_accounts_one_default_uidx on business_payment_accounts(business_id) where is_default;
create index if not exists payments_business_status_idx on payments(business_id, status);
create index if not exists payments_order_id_idx on payments(order_id);
create index if not exists payment_events_provider_event_id_idx on payment_events(provider, event_id);
create index if not exists devices_business_status_idx on devices(business_id, status);
create index if not exists devices_business_last_seen_idx on devices(business_id, last_seen);
create unique index if not exists devices_token_hash_uidx on devices(token_hash) where token_hash is not null;
create index if not exists device_pairing_requests_business_status_idx on device_pairing_requests(business_id, status, requested_at desc);
create index if not exists device_pairing_requests_expires_at_idx on device_pairing_requests(expires_at);
create unique index if not exists device_pairing_requests_pairing_code_uidx on device_pairing_requests(pairing_code);
create index if not exists alerts_business_status_idx on alerts(business_id, status);
create index if not exists alerts_business_created_at_idx on alerts(business_id, created_at);

create table if not exists kitchen_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists kitchen_order_states (
  order_id uuid primary key references orders(id) on delete cascade, business_id uuid not null references businesses(id) on delete cascade,
  stage text not null check (stage in ('pending','preparing','ready')), is_held boolean not null default false,
  hold_reason text, held_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists kitchen_item_states (
  order_item_id uuid primary key references order_items(id) on delete cascade, order_id uuid not null references orders(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade, completed_quantity integer not null default 0 check (completed_quantity >= 0), updated_at timestamptz not null default now()
);
create table if not exists kitchen_offline_events (
  event_id uuid primary key, business_id uuid not null references businesses(id) on delete cascade, device_id uuid not null references devices(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade, action text not null, payload jsonb not null default '{}'::jsonb, status text not null default 'applied', created_at timestamptz not null default now()
);
create table if not exists kitchen_device_preferences (
  device_id uuid primary key references devices(id) on delete cascade, sound_enabled boolean not null default true,
  sound_volume integer not null default 70 check (sound_volume between 0 and 100), updated_at timestamptz not null default now()
);
create index if not exists kitchen_order_states_scope_idx on kitchen_order_states(business_id,stage,is_held);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  user_id uuid references app_users(id) on delete set null,
  action text not null,
  entity text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists business_locations (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
  name text not null, address_line1 text, city text, state text, postal_code text, country text, phone text,
  timezone text, currency_code text, default_language text, tax_region text,
  operating_status text not null default 'open' check (operating_status in ('open', 'temporarily_closed', 'inactive')),
  store_schedule jsonb not null default '{}'::jsonb, ordering_settings jsonb not null default '{}'::jsonb,
  receipt_settings jsonb not null default '{}'::jsonb, created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique (business_id, name)
);
create index if not exists business_locations_business_status_idx on business_locations(business_id, operating_status);

create table if not exists availability_rules (
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
);

create index if not exists availability_rules_business_target_idx on availability_rules(business_id,target_type,target_id);
create index if not exists availability_rules_business_status_idx on availability_rules(business_id,status,rule_type);
create index if not exists audit_logs_business_created_idx on audit_logs(business_id, created_at desc);
create table if not exists kiosk_promotions (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
  name text not null, description text, discount_type text not null default 'percentage', discount_value numeric(10,2) not null default 0,
  starts_at timestamptz, ends_at timestamptz, status text not null default 'draft', paused_at timestamptz,
  created_by uuid not null references app_users(id) on delete restrict, updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists kiosk_promotion_targets (promotion_id uuid not null references kiosk_promotions(id) on delete cascade, target_type text not null, target_id uuid not null, primary key (promotion_id, target_type, target_id));
create table if not exists kiosk_promotion_locations (promotion_id uuid not null references kiosk_promotions(id) on delete cascade, location_id uuid not null references business_locations(id) on delete cascade, primary key (promotion_id, location_id));
create table if not exists kiosk_promotion_placements (promotion_id uuid not null references kiosk_promotions(id) on delete cascade, placement text not null, primary key (promotion_id, placement));
create table if not exists kiosk_qr_codes (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
  name text not null, destination_type text not null, destination_id uuid, location_id uuid references business_locations(id) on delete set null,
  table_token text, active boolean not null default true, expires_at timestamptz, tracking_metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references app_users(id) on delete restrict, updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists kiosk_published_versions (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
  version_number integer not null, config_signature text not null, snapshot jsonb not null,
  published_by uuid not null references app_users(id) on delete restrict, source_draft_id uuid,
  published_at timestamptz not null default now(), unique (business_id, version_number)
);
create table if not exists kiosk_restore_lineage (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
  source_version_id uuid not null references kiosk_published_versions(id) on delete restrict, draft_id uuid not null,
  created_by uuid not null references app_users(id) on delete restrict, created_at timestamptz not null default now()
);

create or replace function reset_daily_product_sales()
returns void as $$
begin
  update products
  set sold_today = 0,
      is_available = case
        when track_stock and stock_quantity is not null and stock_quantity <= 0 then false
        else true
      end;
end;
$$ language plpgsql;

create table if not exists counter_held_orders (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade, order_reference text, payload jsonb not null,
  status text not null default 'held' check (status in ('held','resumed','cancelled','expired')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create table if not exists counter_payment_claims (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
  payment_id uuid not null references payments(id) on delete cascade, order_id uuid not null references orders(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  status text not null default 'claimed' check (status in ('claimed','released','expired','completed')),
  claimed_at timestamptz not null default now(), expires_at timestamptz not null, released_at timestamptz, created_at timestamptz not null default now()
);
create unique index if not exists counter_payment_claims_active_uidx on counter_payment_claims(payment_id) where status = 'claimed';

CREATE INDEX IF NOT EXISTS audit_logs_user_id_fk_idx ON public.audit_logs (user_id);
CREATE INDEX IF NOT EXISTS availability_rules_created_by_fk_idx ON public.availability_rules (created_by);
CREATE INDEX IF NOT EXISTS availability_rules_updated_by_fk_idx ON public.availability_rules (updated_by);
CREATE INDEX IF NOT EXISTS business_locations_created_by_fk_idx ON public.business_locations (created_by);
CREATE INDEX IF NOT EXISTS business_locations_updated_by_fk_idx ON public.business_locations (updated_by);
CREATE INDEX IF NOT EXISTS counter_held_orders_business_id_fk_idx ON public.counter_held_orders (business_id);
CREATE INDEX IF NOT EXISTS counter_held_orders_device_id_fk_idx ON public.counter_held_orders (device_id);
CREATE INDEX IF NOT EXISTS counter_payment_claims_business_id_fk_idx ON public.counter_payment_claims (business_id);
CREATE INDEX IF NOT EXISTS counter_payment_claims_device_id_fk_idx ON public.counter_payment_claims (device_id);
CREATE INDEX IF NOT EXISTS counter_payment_claims_order_id_fk_idx ON public.counter_payment_claims (order_id);
CREATE INDEX IF NOT EXISTS device_pairing_requests_approved_by_fk_idx ON public.device_pairing_requests (approved_by);
CREATE INDEX IF NOT EXISTS device_pairing_requests_device_id_fk_idx ON public.device_pairing_requests (device_id);
CREATE INDEX IF NOT EXISTS device_pairing_requests_rejected_by_fk_idx ON public.device_pairing_requests (rejected_by);
CREATE INDEX IF NOT EXISTS kiosk_promotion_locations_location_id_fk_idx ON public.kiosk_promotion_locations (location_id);
CREATE INDEX IF NOT EXISTS kiosk_promotions_business_id_fk_idx ON public.kiosk_promotions (business_id);
CREATE INDEX IF NOT EXISTS kiosk_promotions_created_by_fk_idx ON public.kiosk_promotions (created_by);
CREATE INDEX IF NOT EXISTS kiosk_promotions_updated_by_fk_idx ON public.kiosk_promotions (updated_by);
CREATE INDEX IF NOT EXISTS kiosk_published_configs_published_by_fk_idx ON public.kiosk_published_configs (published_by);
CREATE INDEX IF NOT EXISTS kiosk_published_versions_published_by_fk_idx ON public.kiosk_published_versions (published_by);
CREATE INDEX IF NOT EXISTS kiosk_qr_codes_business_id_fk_idx ON public.kiosk_qr_codes (business_id);
CREATE INDEX IF NOT EXISTS kiosk_qr_codes_created_by_fk_idx ON public.kiosk_qr_codes (created_by);
CREATE INDEX IF NOT EXISTS kiosk_qr_codes_location_id_fk_idx ON public.kiosk_qr_codes (location_id);
CREATE INDEX IF NOT EXISTS kiosk_qr_codes_updated_by_fk_idx ON public.kiosk_qr_codes (updated_by);
CREATE INDEX IF NOT EXISTS kiosk_restore_lineage_business_id_fk_idx ON public.kiosk_restore_lineage (business_id);
CREATE INDEX IF NOT EXISTS kiosk_restore_lineage_created_by_fk_idx ON public.kiosk_restore_lineage (created_by);
CREATE INDEX IF NOT EXISTS kiosk_restore_lineage_source_version_id_fk_idx ON public.kiosk_restore_lineage (source_version_id);
CREATE INDEX IF NOT EXISTS kiosk_setup_attestations_created_by_fk_idx ON public.kiosk_setup_attestations (created_by);
CREATE INDEX IF NOT EXISTS kiosk_setup_attestations_test_order_id_fk_idx ON public.kiosk_setup_attestations (test_order_id);
CREATE INDEX IF NOT EXISTS kiosk_test_orders_created_by_fk_idx ON public.kiosk_test_orders (created_by);
CREATE INDEX IF NOT EXISTS kiosk_test_sessions_created_by_fk_idx ON public.kiosk_test_sessions (created_by);
CREATE INDEX IF NOT EXISTS kitchen_events_business_id_fk_idx ON public.kitchen_events (business_id);
CREATE INDEX IF NOT EXISTS kitchen_events_changed_by_fk_idx ON public.kitchen_events (changed_by);
CREATE INDEX IF NOT EXISTS kitchen_events_order_id_fk_idx ON public.kitchen_events (order_id);
CREATE INDEX IF NOT EXISTS kitchen_item_states_business_id_fk_idx ON public.kitchen_item_states (business_id);
CREATE INDEX IF NOT EXISTS kitchen_item_states_order_id_fk_idx ON public.kitchen_item_states (order_id);
CREATE INDEX IF NOT EXISTS kitchen_offline_events_business_id_fk_idx ON public.kitchen_offline_events (business_id);
CREATE INDEX IF NOT EXISTS kitchen_offline_events_device_id_fk_idx ON public.kitchen_offline_events (device_id);
CREATE INDEX IF NOT EXISTS kitchen_offline_events_order_id_fk_idx ON public.kitchen_offline_events (order_id);
CREATE INDEX IF NOT EXISTS menu_combos_category_id_fk_idx ON public.menu_combos (category_id);
CREATE INDEX IF NOT EXISTS order_items_product_id_fk_idx ON public.order_items (product_id);
CREATE INDEX IF NOT EXISTS orders_location_id_fk_idx ON public.orders (location_id);
CREATE INDEX IF NOT EXISTS payment_events_business_id_fk_idx ON public.payment_events (business_id);
CREATE INDEX IF NOT EXISTS payment_events_order_id_fk_idx ON public.payment_events (order_id);
CREATE INDEX IF NOT EXISTS payment_events_payment_id_fk_idx ON public.payment_events (payment_id);
CREATE INDEX IF NOT EXISTS payments_collected_by_fk_idx ON public.payments (collected_by);
CREATE INDEX IF NOT EXISTS product_modifier_groups_business_id_fk_idx ON public.product_modifier_groups (business_id);
CREATE INDEX IF NOT EXISTS product_modifier_options_group_id_fk_idx ON public.product_modifier_options (group_id);
CREATE INDEX IF NOT EXISTS test_runtime_availability_overrides_product_id_fk_idx ON public.test_runtime_availability_overrides (product_id);
CREATE INDEX IF NOT EXISTS test_runtime_order_events_business_id_fk_idx ON public.test_runtime_order_events (business_id);
CREATE INDEX IF NOT EXISTS test_runtime_order_events_order_id_fk_idx ON public.test_runtime_order_events (order_id);
CREATE INDEX IF NOT EXISTS test_runtime_orders_business_id_fk_idx ON public.test_runtime_orders (business_id);

-- Supabase Auth owns identity and credentials; app_users remains a domain profile mirror.
ALTER TABLE public.app_users DROP COLUMN IF EXISTS password_hash;

CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  reauthenticated_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  ip_address inet,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.sync_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.app_users (id, email, full_name, is_active, created_at)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
    NEW.email_confirmed_at IS NOT NULL,
    NEW.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.app_users.full_name),
    is_active = EXCLUDED.is_active;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''))
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.sync_auth_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_changed
AFTER INSERT OR UPDATE OF email, email_confirmed_at, raw_user_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.sync_auth_user();

DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.tablename);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

CREATE OR REPLACE FUNCTION private.can_manage_business_assets(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = p_business_id
        AND (
          b.owner_id = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.business_staff s
            WHERE s.business_id = b.id
              AND s.user_id = (SELECT auth.uid())
              AND s.role IN ('owner', 'admin', 'manager')
          )
        )
    );
$$;
REVOKE ALL ON FUNCTION private.can_manage_business_assets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_manage_business_assets(uuid) TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('business-assets', 'business-assets', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Business managers upload assets"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'business-assets'
  AND (storage.foldername(name))[2] IN ('products', 'brand')
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND private.can_manage_business_assets(((storage.foldername(name))[1])::uuid)
);
