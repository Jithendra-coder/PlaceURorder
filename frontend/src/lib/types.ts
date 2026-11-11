export type BusinessType =
  | "restaurant"
  | "cafe"
  | "retail"
  | "bakery"
  | "pizza"
  | "burger"
  | "salon"
  | "grocery"
  | "ice_cream"
  | "other";

export type ItemType = "veg" | "non_veg" | "retail" | "service" | "other";
export type MenuStatus = "draft" | "shown" | "hidden" | "unavailable";
export type AvailabilityType = "always" | "scheduled";
export type AvailabilityTargetType = "item" | "category" | "combo" | "location" | "menu";
export type AvailabilityRuleType = "schedule" | "exception";

export type AvailabilityRule = {
  id: string;
  business_id: string;
  target_type: AvailabilityTargetType;
  target_id?: string | null;
  rule_type: AvailabilityRuleType;
  name?: string | null;
  is_available: boolean;
  status: "active" | "paused";
  days: string[];
  time_windows: Array<{ start: string; end: string }>;
  starts_at?: string | null;
  ends_at?: string | null;
  location_ids: string[];
  reason?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ResolvedAvailability = {
  product_id: string;
  available: boolean;
  mixed: boolean;
  source: "default" | "schedule" | "exception" | "location";
  reason?: string | null;
  next_change_at?: string | null;
  rule_id?: string | null;
};
export type OrderStatus = "payment_pending" | "pending" | "preparing" | "ready" | "completed" | "cancelled";
export type OrderType = "dine_in" | "takeaway" | "delivery" | "pickup";
export type LogoShape = "circle" | "square" | "rectangle";
export type StaffRole = "owner" | "admin" | "manager" | "kitchen" | "cashier" | "salon_staff" | "kiosk" | "viewer";
export type KioskScreenOrientation = "landscape" | "portrait";
export type KioskStartTextPosition = "top" | "middle" | "bottom";

export type StoreTimeSlot = {
  open: string;
  close: string;
};

export type StoreDaySchedule = {
  closed: boolean;
  slots: StoreTimeSlot[];
};

export type StoreScheduleOverride = {
  id: string;
  date: string;
  label: string;
  closed: boolean;
  slots: StoreTimeSlot[];
};

export type StoreScheduleSettings = {
  enabled?: boolean;
  weekly?: Record<string, StoreDaySchedule>;
  overrides?: StoreScheduleOverride[];
  emergency_closed?: boolean;
  emergency_message?: string;
};

export type ReceiptSettings = {
  logo_path?: string | null;
  show_logo?: boolean;
  business_name?: string;
  tax_details?: string;
  show_order_id?: boolean;
  show_token_number?: boolean;
  footer_text?: string;
  thank_you_text?: string;
  show_qr_code?: boolean;
  contact_text?: string;
  social_text?: string;
};

export type KioskLockSettings = {
  enabled?: boolean;
  require_pin_to_exit?: boolean;
  require_pin_for_admin?: boolean;
  owner_pin_configured?: boolean;
};

export type KioskOrderSettings = {
  setup?: KioskSetupState;
  display_configured?: boolean;
  last_previewed_signature?: string;
  last_successful_test_signature?: string;
  published_signature?: string;
  checkout_mode?: "basic" | "full" | "display";
  public_online_ordering_enabled?: boolean;
  pay_at_counter?: boolean;
  online_payments?: boolean;
  payment_methods?: string[];
  require_payment_before_kitchen?: boolean;
  allow_unpaid_counter_orders?: boolean;
  require_customer_name?: boolean;
  require_customer_phone?: boolean;
  allow_customer_notes?: boolean;
  quick_note_chips?: string[];
  checkout_enabled?: boolean;
  default_payment_method?: string;
  show_confirmation?: boolean;
  show_estimated_time?: boolean;
};

export type KioskSetupStep = "menu" | "kiosk-settings" | "welcome-screen" | "preview-test" | "review-publish";

export type KioskSetupState = {
  version: 1 | 2;
  currentStep: KioskSetupStep;
  startedAt: string;
  completedAt?: string | null;
  introPending?: boolean;
  revision?: number;
  active?: boolean;
  eligible?: boolean;
  entrySource?: "onboarding" | "resume";
  publishedSignature?: string;
};

export type KioskSetupStatus = {
  businessComplete: boolean;
  menuComplete: boolean;
  kioskSettingsComplete: boolean;
  welcomeScreenComplete: boolean;
  previewComplete: boolean;
  successfulTestComplete: boolean;
  publishable: boolean;
  published: boolean;
  previewStale: boolean;
  testStale: boolean;
};

export type KioskSetupOverview = {
  setup: KioskSetupState;
  status: KioskSetupStatus;
  requirements: Array<{ key: string; label: string; complete: boolean; href: string }>;
  signature: string;
  lastPreviewedAt?: string | null;
  lastSuccessfulTestAt?: string | null;
  lastPublishedAt?: string | null;
  lastSavedAt?: string | null;
  unpublishedChanges: number;
  changeSummary: Array<{ key: string; label: string; count: number }>;
};

export type KioskTestOrderPayload = {
  event_version: 1;
  order_type: OrderType;
  items: Array<{ product_id: string; quantity: number; customizations: Array<{ option_id: string }> }>;
};

export type PaymentSummary = {
  enabled_methods: string[];
  default_payment_method?: string | null;
  provider_statuses?: Record<
    string,
    {
      connection_status?: string | null;
      payments_enabled?: boolean;
      charges_enabled?: boolean;
    }
  >;
};

export type KioskStartScreenSettings = {
  configured?: boolean;
  layout_style?: "full_image" | "split_image_text" | "plain_light" | "plain_dark";
  overlay_strength?: number;
  image_position?: "center" | "top" | "bottom" | "left" | "right";
  welcome_text?: string;
  instruction_text?: string;
  text_color_mode?: "auto" | "white" | "black" | "brand";
  selected_brand_color?: string;
  custom_brand_colors?: string[];
  highlight_text?: string;
  start_prompt?: string;
  content_position?: "bottom_left" | "bottom_center" | "center";
  readability?: "auto" | "light" | "strong";
  focal_x?: number;
  focal_y?: number;
};

export type AuthUser = {
  id: string;
  email: string;
  full_name?: string | null;
  is_active: boolean;
  created_at?: string | null;
};

export type AuthSession = {
  access_token?: string | null;
  token_type: "bearer";
  user: AuthUser;
};

export type SignupStartResponse = {
  requires_verification: boolean;
  email: string;
  message: string;
  dev_otp?: string | null;
};

export type Business = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  type: BusinessType;
  tagline?: string | null;
  business_subtype?: string | null;
  contact_phone?: string | null;
  logo_path?: string | null;
  logo_shape: LogoShape;
  logo_scale?: number | null;
  logo_position_x?: number | null;
  logo_position_y?: number | null;
  brand_color: string;
  kiosk_theme: string;
  kiosk_layout: string;
  kiosk_screen_orientation: KioskScreenOrientation;
  kiosk_screen_size: string;
  kiosk_cart_mode: "drawer" | "page";
  kiosk_start_screen_enabled: boolean;
  kiosk_start_text_position?: KioskStartTextPosition;
  kiosk_touch_to_start?: boolean;
  kiosk_start_screen_settings?: KioskStartScreenSettings;
  kiosk_lock_settings?: KioskLockSettings;
  kiosk_order_settings?: KioskOrderSettings;
  display_show_tagline: boolean;
  display_show_category_images: boolean;
  display_show_item_descriptions: boolean;
  display_show_prices: boolean;
  display_show_unavailable: boolean;
  idle_timeout_seconds: number;
  default_language: string;
  sound_effects_enabled: boolean;
  order_reset_seconds?: number | null;
  offer_enabled: boolean;
  offer_title?: string | null;
  offer_subtitle?: string | null;
  offer_badge?: string | null;
  offer_cta?: string | null;
  offer_image_path?: string | null;
  offer_background?: string | null;
  currency_code: string;
  currency_symbol: string;
  tax_percent: number;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  timezone?: string | null;
  opening_time?: string | null;
  closing_time?: string | null;
  order_modes?: OrderType[];
  store_schedule?: StoreScheduleSettings;
  receipt_settings?: ReceiptSettings;
  payment_summary?: PaymentSummary;
  onboarding_step: number;
  onboarding_completed: boolean;
  is_active: boolean;
};

export type Category = {
  id: string;
  business_id: string;
  name: string;
  description?: string | null;
  image_path?: string | null;
  sort_order: number;
  is_active: boolean;
};

export type Product = {
  id: string;
  business_id: string;
  category_id?: string | null;
  name: string;
  description?: string | null;
  sku?: string | null;
  item_type: ItemType;
  price: number;
  discount_type: "none" | "percentage" | "fixed";
  discount_value: number;
  discount_label?: string | null;
  discount_starts_at?: string | null;
  discount_ends_at?: string | null;
  primary_image_path?: string | null;
  is_available: boolean;
  is_featured: boolean;
  track_stock: boolean;
  stock_quantity?: number | null;
  daily_limit?: number | null;
  sold_today: number;
  availability_start_time?: string | null;
  availability_end_time?: string | null;
  original_price?: number | null;
  display_badge?: string | null;
  tags?: string[];
  menu_status?: MenuStatus;
  sort_order?: number;
  availability_type?: AvailabilityType;
  available_days?: string[];
  modifier_groups?: ModifierGroup[];
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string | null;
};

export type ModifierOption = {
  id: string;
  group_id: string;
  name: string;
  price_delta: number;
  is_default?: boolean;
  is_available: boolean;
  sort_order: number;
};

export type ModifierGroup = {
  id: string;
  business_id: string;
  product_id: string;
  name: string;
  min_select: number;
  max_select: number;
  is_required: boolean;
  sort_order: number;
  options: ModifierOption[];
};

export type ComboStatus = MenuStatus;
export type ComboSectionType = "included_items" | "optional_upgrades";
export type ComboSourceType = "existing_item" | "exclusive_combo_item";
export type ComboExclusiveType = "main" | "side" | "drink" | "dessert" | "add_on";

export type ComboOption = {
  id: string;
  combo_id: string;
  section_id: string;
  source_type: ComboSourceType;
  existing_item_id?: string | null;
  exclusive_name?: string | null;
  exclusive_description?: string | null;
  exclusive_image_path?: string | null;
  exclusive_type?: ComboExclusiveType | null;
  quantity: number;
  price_impact: number;
  default_selected: boolean;
  removable: boolean;
  visible: boolean;
  sort_order: number;
  existing_item?: Product | null;
  missing_existing_item?: boolean;
};

export type ComboSection = {
  id: string;
  combo_id: string;
  title: string;
  section_type: ComboSectionType;
  required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  options: ComboOption[];
};

export type Combo = {
  id: string;
  business_id: string;
  category_id?: string | null;
  name: string;
  description?: string | null;
  image_path?: string | null;
  price: number;
  original_price?: number | null;
  display_badge?: string | null;
  tags: string[];
  status: ComboStatus;
  sort_order: number;
  availability_type: AvailabilityType;
  available_days: string[];
  available_start_time?: string | null;
  available_end_time?: string | null;
  sections?: ComboSection[];
  included_items_count?: number;
  created_at?: string;
  updated_at?: string | null;
};

export type ComboOptionInput = Omit<
  ComboOption,
  "id" | "combo_id" | "section_id" | "existing_item" | "missing_existing_item"
> & {
  id?: string;
};

export type ComboSectionInput = Omit<ComboSection, "id" | "combo_id" | "options"> & {
  id?: string;
  options: ComboOptionInput[];
};

export type ComboPayload = Omit<
  Combo,
  "id" | "business_id" | "sections" | "included_items_count" | "created_at" | "updated_at"
> & {
  sections: ComboSectionInput[];
};

export type OrderItem = {
  id: string;
  order_id: string;
  business_id: string;
  product_id?: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  notes?: string | null;
  customizations?: Record<string, unknown>[];
};

export type Order = {
  id: string;
  business_id: string;
  location_id?: string | null;
  order_number?: number | null;
  public_token?: string | null;
  status: OrderStatus;
  order_type: OrderType;
  table_label?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  payment_status: string;
  payment_method?: string | null;
  source?: string | null;
  notes?: string | null;
  placed_at: string;
  prep_started_at?: string | null;
  ready_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  order_items?: OrderItem[];
  payment?: {
    payment?: PaymentRecord;
    checkout_url?: string | null;
    provider?: string | null;
    qr?: { qr_data?: string; amount?: string; reference_id?: string; expires_at?: string | null } | null;
  };
};

export type PaymentAccount = {
  id?: string | null;
  business_id: string;
  provider: "stripe" | "razorpay" | "paytm";
  display_name?: string | null;
  provider_account_id?: string | null;
  provider_merchant_id?: string | null;
  connection_status: "not_connected" | "setup_required" | "pending" | "active" | "restricted" | "disabled" | "error" | "disconnected" | "connected";
  activation_status?: "pending" | "activated" | "rejected" | "incomplete" | "not_applicable" | string;
  charges_enabled: boolean;
  payments_enabled: boolean;
  payouts_enabled?: boolean;
  requirements_due?: string[];
  last_status_check_at?: string | null;
  is_default?: boolean;
  is_enabled?: boolean;
  onboarding_status: string;
  metadata?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
};

export type PaymentRecord = {
  id: string;
  business_id: string;
  order_id?: string | null;
  provider?: "stripe" | "razorpay" | "paytm" | "pay_at_counter" | null;
  provider_reference?: string | null;
  provider_payment_id?: string | null;
  provider_order_id?: string | null;
  payment_intent_id?: string | null;
  amount: number;
  currency: string;
  status: "pending" | "authorized" | "paid" | "failed" | "cancelled" | "expired" | "refunded" | "pay_at_counter_pending";
  payment_method?: string | null;
  raw_provider_status?: string | null;
  raw_payload?: Record<string, unknown>;
  collected_by?: string | null;
  collected_at?: string | null;
  collected_amount?: number | null;
  collection_method?: string | null;
  created_at: string;
  updated_at?: string | null;
  order?: Order;
};

export type DeviceRecord = {
  id: string;
  business_id: string;
  device_id: string;
  device_type: string;
  name: string;
  display_name?: string;
  status: "online" | "warning" | "offline" | "never_connected" | "maintenance" | "issue" | "disabled";
  last_seen?: string | null;
  assigned_kiosk_slug?: string | null;
  location_label?: string | null;
  current_route?: string | null;
  app_version?: string | null;
  user_agent?: string | null;
  last_error?: string | null;
  is_active?: boolean;
  disabled_at?: string | null;
  has_launch_token?: boolean;
  launch_token?: string;
  launch_path?: string;
  launch_url?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string | null;
};

export type DevicePairingRequest = {
  id: string;
  business_id?: string;
  pairing_code: string;
  device_type: "kiosk" | "kitchen" | "counter";
  device_name?: string | null;
  location_label?: string | null;
  source: "device_request" | "admin_activation";
  status: "pending" | "approved" | "rejected" | "claimed" | "expired";
  requested_at: string;
  expires_at: string;
  approved_at?: string | null;
  claimed_at?: string | null;
  device_id?: string | null;
  app_version?: string | null;
  user_agent?: string | null;
  metadata?: Record<string, unknown>;
  business?: Pick<Business, "id" | "name" | "slug" | "type">;
  polling_secret?: string;
  attempt_count?: number;
  locked_until?: string | null;
};

export type DeviceSession = {
  pairing: DevicePairingRequest;
  device: DeviceRecord;
  session: {
    device_token?: string | null;
    device_type: "kiosk" | "kitchen" | "counter";
    launch_path: string;
    launch_url: string;
  };
};

export type LiveDeviceContext = {
  business: Business;
  device: DeviceRecord;
  launch_path: string;
};

export type AlertRecord = {
  id: string;
  business_id: string;
  type: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  source: string;
  status: "open" | "acknowledged" | "resolved";
  dedupe_key?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at?: string | null;
  resolved_at?: string | null;
};

export type AlertSummary = {
  unresolved_count: number;
  critical_count: number;
  warning_count: number;
  info_count: number;
};

export type DashboardStats = {
  revenue_today: number;
  active_orders: number;
  orders_today: number;
  orders_last_hour: number;
  orders_past_7_days: number;
  items_sold?: number;
  average_order_value: number;
  top_selling_item?: { name: string; quantity: number; revenue: number } | null;
  top_selling_items: { name: string; quantity: number; revenue: number }[];
  gross_sales_today: number;
  discounts_today: number;
  refunds_today: number;
  cancellations_today: number;
  net_sales_today: number;
  weekly_revenue: { date: string; orders: number; revenue: number }[];
  period_start?: string | null;
  period_end?: string | null;
  completed_orders?: number;
  period_gross_sales?: number;
  period_discounts?: number;
  period_refunds?: number;
  period_cancellations?: number;
  period_net_sales?: number;
  period_average_order_value?: number;
  order_type_summary?: Record<string, number>;
  payment_method_summary?: Record<string, number>;
  order_funnel?: Record<string, number>;
};

export type HomeActivation = { state: "new" | "returning"; completed_order_count: number };

export type OnboardingStatus = {
  has_business: boolean;
  business_id: string | null;
  onboarding_step: number;
  onboarding_completed: boolean;
  next_route: string;
};

export type KioskMenu = {
  business: Business;
  categories: Category[];
  products: Product[];
};

/** Public, non-sensitive view of a store's online (QR) ordering. */
export type QrStoreStatus = {
  name: string;
  slug: string;
  currency_symbol: string;
  tax_percent: number;
  qr_ordering_enabled: boolean;
  is_open: boolean;
  order_modes: Array<"dine_in" | "takeaway">;
  require_customer_name: boolean;
  require_customer_phone: boolean;
  allow_customer_notes: boolean;
  store_url: string;
};

export type OwnerStoreOrdering = QrStoreStatus & { business_id: string };

export type QrOrderOption = { group_id: string; group_name: string; option_id: string; name: string; price_delta: number };

export type QrOrderPayload = {
  order_type: "dine_in" | "takeaway";
  table_label?: string;
  customer_name?: string;
  customer_phone?: string;
  notes?: string;
  payment_method: "pay_at_counter";
  items: Array<{ product_id: string; quantity: number; customizations: QrOrderOption[] }>;
};

export type StaffMember = {
  id: string;
  business_id: string;
  user_id: string;
  role: StaffRole;
  email?: string | null;
  full_name?: string | null;
  created_at?: string | null;
};

export type BusinessLocation = {
  id: string;
  business_id: string;
  name: string;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  phone?: string | null;
  timezone?: string | null;
  currency_code?: string | null;
  default_language?: string | null;
  tax_region?: string | null;
  operating_status: "open" | "temporarily_closed" | "inactive";
  store_schedule?: Record<string, unknown>;
  ordering_settings?: Record<string, unknown>;
  receipt_settings?: Record<string, unknown>;
  promotion_count?: number;
  qr_code_count?: number;
  device_count?: number;
  created_at?: string;
  updated_at?: string;
};

export type AdministrationActivity = {
  id: string;
  action: string;
  entity?: string | null;
  entity_id?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
  actor_role?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export type AdministrationOverview = {
  checks: { key: string; status: "ready" | "attention" | "unavailable"; detail: string }[];
  recent_activity: AdministrationActivity[];
  updated_at?: string | null;
};
