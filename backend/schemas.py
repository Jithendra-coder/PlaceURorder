from datetime import datetime, time
from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class BusinessType(str, Enum):
    RESTAURANT = "restaurant"
    CAFE = "cafe"
    RETAIL = "retail"
    BAKERY = "bakery"
    PIZZA = "pizza"
    BURGER = "burger"
    SALON = "salon"
    GROCERY = "grocery"
    ICE_CREAM = "ice_cream"
    OTHER = "other"


class StaffRole(str, Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MANAGER = "manager"
    KITCHEN = "kitchen"
    CASHIER = "cashier"
    SALON_STAFF = "salon_staff"
    KIOSK = "kiosk"
    VIEWER = "viewer"


class ItemType(str, Enum):
    VEG = "veg"
    NON_VEG = "non_veg"
    RETAIL = "retail"
    SERVICE = "service"
    OTHER = "other"


class OrderStatus(str, Enum):
    PAYMENT_PENDING = "payment_pending"
    PENDING = "pending"
    PREPARING = "preparing"
    READY = "ready"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class OrderType(str, Enum):
    DINE_IN = "dine_in"
    TAKEAWAY = "takeaway"
    DELIVERY = "delivery"
    PICKUP = "pickup"


class PaymentStatus(str, Enum):
    UNPAID = "unpaid"
    PENDING = "pending"
    AUTHORIZED = "authorized"
    PAID = "paid"
    FAILED = "failed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    REFUNDED = "refunded"
    PAY_AT_COUNTER_PENDING = "pay_at_counter_pending"


class ApiResponse(BaseModel):
    status: str = "success"
    message: str
    data: Any | None = None


KioskLayoutId = Literal["side-navigation", "top-navigation", "category-first"]


class WelcomeScreenConfiguration(BaseModel):
    enabled: bool = True
    heading: str = Field("Welcome", max_length=120)
    supporting_text: str = Field("", max_length=240)
    instruction_text: str = Field("Tap to begin", max_length=160)
    start_button_text: str = Field("Start", min_length=1, max_length=60)
    text_position: Literal["top", "middle", "bottom"] = "middle"
    touch_anywhere_to_start: bool = False
    show_business_logo: bool = True


KioskSetupStep = Literal["menu", "kiosk-settings", "welcome-screen", "preview-test", "review-publish"]


class KioskSetupUpdate(BaseModel):
    expected_revision: int = Field(..., ge=0)
    current_step: Optional[KioskSetupStep] = None
    intro_pending: Optional[bool] = None
    active: Optional[bool] = None


class KioskSetupAttestationCreate(BaseModel):
    event_version: Literal[1] = 1


class KioskTestOrderItem(BaseModel):
    product_id: UUID
    quantity: int = Field(..., ge=1, le=99)
    customizations: List[Dict[str, Any]] = Field(default_factory=list)


class KioskTestOrderCreate(BaseModel):
    event_version: Literal[1] = 1
    order_type: OrderType = OrderType.DINE_IN
    items: List[KioskTestOrderItem] = Field(..., min_length=1, max_length=100)


class TestRuntimeOrderItem(BaseModel):
    product_id: UUID
    quantity: int = Field(..., ge=1, le=99)
    modifiers: List[Dict[str, Any]] = Field(default_factory=list, max_length=20)


class TestRuntimeOrderCreate(BaseModel):
    source: Literal["kiosk", "counter"]
    order_type: Literal["dine_in", "takeaway"] = "dine_in"
    location_id: Optional[UUID] = None
    table_label: Optional[str] = Field(None, max_length=40)
    items: List[TestRuntimeOrderItem] = Field(..., min_length=1, max_length=100)
    notes: Optional[str] = Field(None, max_length=400)
    idempotency_key: Optional[str] = Field(None, min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")


class TestRuntimeOrderStatusUpdate(BaseModel):
    status: Literal["pending", "preparing", "ready", "completed"]
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TestRuntimeKitchenAction(BaseModel):
    reason: Optional[str] = Field(None, min_length=3, max_length=240)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TestRuntimeItemProgress(BaseModel):
    completed_quantity: int = Field(..., ge=0, le=99)


class TestRuntimeReworkRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=240)
    item_ids: List[UUID] = Field(default_factory=list, max_length=100)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TestRuntimeAvailabilityUpdate(BaseModel):
    is_available: bool


class KioskExperienceTestOrderItem(BaseModel):
    preset_id: str = Field(..., min_length=2, max_length=120, pattern=r"^[a-z0-9-]+$")
    name: str = Field(..., min_length=1, max_length=120)
    quantity: int = Field(1, ge=1, le=99)


class KioskExperienceTestOrderCreate(BaseModel):
    event_version: Literal[1] = 1
    order_type: OrderType = OrderType.DINE_IN
    items: List[KioskExperienceTestOrderItem] = Field(..., min_length=1, max_length=100)


class KioskPublishRequest(BaseModel):
    expected_revision: int = Field(..., ge=0)
    allow_untested: bool = False


class KioskTestSessionExchange(BaseModel):
    token: str = Field(..., min_length=20, max_length=160)


class AuthUser(BaseModel):
    id: UUID
    email: str
    full_name: Optional[str] = None
    is_active: bool = True
    created_at: Optional[datetime] = None


class AuthSession(BaseModel):
    access_token: Optional[str] = None
    token_type: str = "bearer"
    user: AuthUser


class SignupStartResponse(BaseModel):
    requires_verification: bool = True
    email: str
    message: str
    dev_otp: Optional[str] = None


class AuthSignup(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    full_name: Optional[str] = Field(None, max_length=120)


class SignupEmailStart(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)


class SignupEmailComplete(BaseModel):
    password: str = Field(..., min_length=8, max_length=128)
    full_name: Optional[str] = Field(None, max_length=120)


class SignupLinkAccept(BaseModel):
    access_token: str = Field(..., min_length=20, max_length=4096)
    refresh_token: str = Field(..., min_length=20, max_length=4096)


class SignupEmailVerified(BaseModel):
    email: str
    message: str


class AuthLogin(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)


class GoogleOAuthExchange(BaseModel):
    code: str = Field(..., min_length=20, max_length=4096)


class ReauthenticateRequest(BaseModel):
    password: str = Field(..., min_length=8, max_length=128)


class VerifyEmailRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


class ResendVerificationRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)


class ForgotPasswordResponse(BaseModel):
    message: str
    reset_url: Optional[str] = None


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=20, max_length=4096)
    password: str = Field(..., min_length=8, max_length=128)


class StaffInvite(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    role: StaffRole = StaffRole.KITCHEN
    full_name: Optional[str] = Field(None, max_length=120)


class StaffUpdate(BaseModel):
    role: Optional[StaffRole] = None
    full_name: Optional[str] = Field(None, max_length=120)


class BusinessLocationCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    address_line1: Optional[str] = Field(None, max_length=240)
    city: Optional[str] = Field(None, max_length=120)
    state: Optional[str] = Field(None, max_length=120)
    postal_code: Optional[str] = Field(None, max_length=32)
    country: Optional[str] = Field(None, max_length=120)
    phone: Optional[str] = Field(None, max_length=30)
    timezone: Optional[str] = Field(None, max_length=80)
    currency_code: Optional[str] = Field(None, min_length=3, max_length=3)
    default_language: Optional[str] = Field(None, max_length=80)
    tax_region: Optional[str] = Field(None, max_length=120)
    store_schedule: Optional[Dict[str, Any]] = None
    ordering_settings: Optional[Dict[str, Any]] = None
    receipt_settings: Optional[Dict[str, Any]] = None


class BusinessLocationUpdate(BusinessLocationCreate):
    name: Optional[str] = Field(None, min_length=2, max_length=120)
    operating_status: Optional[Literal["open", "temporarily_closed", "inactive"]] = None
    use_business_defaults: Optional[bool] = None


class PaymentLocationAssignmentInput(BaseModel):
    provider: Literal["stripe", "razorpay", "paytm"]
    enabled_methods: List[str] = Field(default_factory=list, max_length=12)
    is_override: bool = True
    fallback_provider: Optional[Literal["stripe", "razorpay", "paytm"]] = None
    terminal_reference: Optional[str] = Field(None, max_length=120)


class AdministrationInvitationCreate(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    role: StaffRole = StaffRole.VIEWER
    location_ids: List[UUID] = Field(default_factory=list, max_length=100)
    expires_in_days: int = Field(7, ge=1, le=30)


class CustomRoleInput(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    permissions: List[str] = Field(default_factory=list, max_length=100)


class SecurityPolicyInput(BaseModel):
    session_duration_minutes: int = Field(480, ge=15, le=43200)
    reauthentication_minutes: int = Field(15, ge=1, le=1440)
    invitation_expiry_days: int = Field(7, ge=1, le=30)
    two_factor_required: bool = False
    inactive_account_days: int = Field(90, ge=1, le=3650)


class IntegrationInput(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    integration_type: str = Field(..., min_length=2, max_length=60)
    status: Literal["connected", "disconnected", "error"] = "disconnected"
    location_ids: List[UUID] = Field(default_factory=list, max_length=100)
    hardware_mappings: List[Dict[str, str]] = Field(default_factory=list, max_length=100)


class ApiKeyCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    scopes: List[str] = Field(default_factory=list, max_length=40)
    expires_in_days: Optional[int] = Field(None, ge=1, le=365)


class WebhookCreate(BaseModel):
    endpoint_url: str = Field(..., min_length=8, max_length=500, pattern=r"^https://")
    events: List[str] = Field(..., min_length=1, max_length=50)


class InvitationAccept(BaseModel):
    token: str = Field(..., min_length=20, max_length=160)


class CustomRoleAssignment(BaseModel):
    custom_role_id: UUID
    location_ids: List[UUID] = Field(default_factory=list, max_length=100)


class BusinessBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    slug: Optional[str] = Field(None, min_length=2, max_length=80)
    type: BusinessType = BusinessType.RESTAURANT
    tagline: Optional[str] = Field(None, max_length=180)
    business_subtype: Optional[str] = Field(None, max_length=80)
    contact_phone: Optional[str] = Field(None, max_length=30)
    logo_path: Optional[str] = None
    logo_shape: str = "square"
    logo_scale: int = Field(120, ge=60, le=220)
    logo_position_x: int = Field(50, ge=0, le=100)
    logo_position_y: int = Field(50, ge=0, le=100)
    brand_color: str = "#1A4D2E"
    kiosk_layout_id: KioskLayoutId = "top-navigation"
    kiosk_theme: str = "top_category:premium_light"
    kiosk_layout: str = "wide_16_9"
    kiosk_screen_orientation: str = "landscape"
    kiosk_screen_size: str = "32"
    kiosk_cart_mode: str = "page"
    kiosk_start_screen_enabled: bool = True
    kiosk_start_text_position: str = "middle"
    kiosk_touch_to_start: bool = False
    welcome_screen: WelcomeScreenConfiguration = Field(default_factory=WelcomeScreenConfiguration)
    kiosk_start_screen_settings: Dict[str, Any] = Field(default_factory=dict)
    kiosk_lock_settings: Dict[str, Any] = Field(default_factory=dict)
    kiosk_order_settings: Dict[str, Any] = Field(default_factory=dict)
    display_show_tagline: bool = True
    display_show_category_images: bool = True
    display_show_item_descriptions: bool = True
    display_show_prices: bool = True
    display_show_unavailable: bool = True
    idle_timeout_seconds: int = Field(60, ge=15, le=600)
    order_reset_seconds: int = Field(5, ge=5, le=10)
    default_language: str = "English"
    sound_effects_enabled: bool = True
    offer_enabled: bool = False
    offer_title: str = Field("Fresh choices, smart savings", max_length=120)
    offer_subtitle: str = Field("Discover today's best picks and seasonal offers.", max_length=220)
    offer_badge: str = Field("Up to 25% off", max_length=60)
    offer_cta: str = Field("Shop now", max_length=40)
    offer_image_path: Optional[str] = None
    offer_background: str = "emerald"
    currency_code: str = "INR"
    currency_symbol: str = "Rs"
    tax_percent: float = Field(0, ge=0, le=100)
    address_line1: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: str = "India"
    timezone: str = "Asia/Kolkata"
    opening_time: Optional[time] = None
    closing_time: Optional[time] = None
    order_modes: List[OrderType] = Field(default_factory=lambda: [OrderType.DINE_IN, OrderType.TAKEAWAY])
    store_schedule: Dict[str, Any] = Field(default_factory=dict)
    receipt_settings: Dict[str, Any] = Field(default_factory=dict)


class BusinessCreate(BusinessBase):
    onboarding_step: int = Field(0, ge=0, le=5)


class BusinessUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(None, min_length=2, max_length=120)
    slug: Optional[str] = Field(None, min_length=2, max_length=80)
    type: Optional[BusinessType] = None
    tagline: Optional[str] = Field(None, max_length=180)
    business_subtype: Optional[str] = Field(None, max_length=80)
    contact_phone: Optional[str] = Field(None, max_length=30)
    logo_path: Optional[str] = None
    logo_shape: Optional[str] = None
    logo_scale: Optional[int] = Field(None, ge=60, le=220)
    logo_position_x: Optional[int] = Field(None, ge=0, le=100)
    logo_position_y: Optional[int] = Field(None, ge=0, le=100)
    brand_color: Optional[str] = None
    kiosk_layout_id: Optional[KioskLayoutId] = None
    kiosk_theme: Optional[str] = None
    kiosk_layout: Optional[str] = None
    kiosk_screen_orientation: Optional[str] = None
    kiosk_screen_size: Optional[str] = None
    kiosk_cart_mode: Optional[str] = None
    kiosk_start_screen_enabled: Optional[bool] = None
    kiosk_start_text_position: Optional[str] = None
    kiosk_touch_to_start: Optional[bool] = None
    welcome_screen: Optional[WelcomeScreenConfiguration] = None
    kiosk_start_screen_settings: Optional[Dict[str, Any]] = None
    kiosk_lock_settings: Optional[Dict[str, Any]] = None
    kiosk_order_settings: Optional[Dict[str, Any]] = None
    display_show_tagline: Optional[bool] = None
    display_show_category_images: Optional[bool] = None
    display_show_item_descriptions: Optional[bool] = None
    display_show_prices: Optional[bool] = None
    display_show_unavailable: Optional[bool] = None
    idle_timeout_seconds: Optional[int] = Field(None, ge=15, le=600)
    order_reset_seconds: Optional[int] = Field(None, ge=5, le=10)
    default_language: Optional[str] = None
    sound_effects_enabled: Optional[bool] = None
    offer_enabled: Optional[bool] = None
    offer_title: Optional[str] = Field(None, max_length=120)
    offer_subtitle: Optional[str] = Field(None, max_length=220)
    offer_badge: Optional[str] = Field(None, max_length=60)
    offer_cta: Optional[str] = Field(None, max_length=40)
    offer_image_path: Optional[str] = None
    offer_background: Optional[str] = None
    currency_code: Optional[str] = None
    currency_symbol: Optional[str] = None
    tax_percent: Optional[float] = Field(None, ge=0, le=100)
    address_line1: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None
    timezone: Optional[str] = None
    opening_time: Optional[time] = None
    closing_time: Optional[time] = None
    order_modes: Optional[List[OrderType]] = None
    store_schedule: Optional[Dict[str, Any]] = None
    receipt_settings: Optional[Dict[str, Any]] = None
    onboarding_step: Optional[int] = Field(None, ge=0, le=5)
    is_active: Optional[bool] = None
    owner_pin: Optional[str] = Field(None, min_length=4, max_length=6, pattern=r"^\d+$")


class Business(BusinessBase):
    id: UUID
    owner_id: UUID
    onboarding_step: int
    onboarding_completed: bool
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None


class OnboardingStatus(BaseModel):
    has_business: bool
    business_id: UUID | None = None
    onboarding_step: int = 0
    onboarding_completed: bool = False
    next_route: str


class BusinessTypeSelection(BaseModel):
    business_type: BusinessType
    business_description: Optional[str] = Field(None, max_length=80)


class CategoryCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    description: Optional[str] = None
    image_path: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=80)
    description: Optional[str] = None
    image_path: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class Category(CategoryCreate):
    id: UUID
    business_id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None


class ProductCreate(BaseModel):
    category_id: Optional[UUID] = None
    name: str = Field(..., min_length=2, max_length=140)
    description: Optional[str] = None
    sku: Optional[str] = None
    item_type: ItemType = ItemType.OTHER
    price: float = Field(..., ge=0)
    discount_type: str = "none"
    discount_value: float = Field(0, ge=0)
    discount_label: Optional[str] = Field(None, max_length=80)
    discount_starts_at: Optional[datetime] = None
    discount_ends_at: Optional[datetime] = None
    primary_image_path: Optional[str] = None
    is_available: bool = True
    is_featured: bool = False
    track_stock: bool = False
    stock_quantity: Optional[int] = Field(None, ge=0)
    daily_limit: Optional[int] = Field(None, ge=0)
    availability_start_time: Optional[time] = None
    availability_end_time: Optional[time] = None
    original_price: Optional[float] = Field(None, ge=0)
    display_badge: Optional[str] = Field(None, max_length=40)
    tags: List[str] = Field(default_factory=list, max_length=50)
    menu_status: Literal["draft", "shown", "hidden", "unavailable"] = "shown"
    sort_order: int = Field(0, ge=0)
    availability_type: Literal["always", "scheduled"] = "always"
    available_days: List[str] = Field(default_factory=list, max_length=7)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ProductUpdate(BaseModel):
    category_id: Optional[UUID] = None
    name: Optional[str] = Field(None, min_length=2, max_length=140)
    description: Optional[str] = None
    sku: Optional[str] = None
    item_type: Optional[ItemType] = None
    price: Optional[float] = Field(None, ge=0)
    discount_type: Optional[str] = None
    discount_value: Optional[float] = Field(None, ge=0)
    discount_label: Optional[str] = Field(None, max_length=80)
    discount_starts_at: Optional[datetime] = None
    discount_ends_at: Optional[datetime] = None
    primary_image_path: Optional[str] = None
    is_available: Optional[bool] = None
    is_featured: Optional[bool] = None
    track_stock: Optional[bool] = None
    stock_quantity: Optional[int] = Field(None, ge=0)
    daily_limit: Optional[int] = Field(None, ge=0)
    availability_start_time: Optional[time] = None
    availability_end_time: Optional[time] = None
    original_price: Optional[float] = Field(None, ge=0)
    display_badge: Optional[str] = Field(None, max_length=40)
    tags: Optional[List[str]] = Field(None, max_length=50)
    menu_status: Optional[Literal["draft", "shown", "hidden", "unavailable"]] = None
    sort_order: Optional[int] = Field(None, ge=0)
    availability_type: Optional[Literal["always", "scheduled"]] = None
    available_days: Optional[List[str]] = Field(None, max_length=7)
    metadata: Optional[Dict[str, Any]] = None


class Product(ProductCreate):
    id: UUID
    business_id: UUID
    sold_today: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None


class PromotionCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=140)
    description: Optional[str] = None
    discount_type: Literal["percentage", "fixed", "label"] = "percentage"
    discount_value: float = Field(0, ge=0)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    status: Literal["draft", "scheduled", "active", "paused", "expired", "needs_attention"] = "draft"
    target_type: Literal["product", "category", "combo"] = "product"
    target_ids: List[UUID] = Field(default_factory=list, max_length=100)
    location_ids: List[UUID] = Field(default_factory=list, max_length=100)
    placements: List[Literal["deals_category", "welcome_screen", "kiosk_banner"]] = Field(default_factory=list)


class PromotionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=140)
    description: Optional[str] = None
    discount_type: Optional[Literal["percentage", "fixed", "label"]] = None
    discount_value: Optional[float] = Field(None, ge=0)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    status: Optional[Literal["draft", "scheduled", "active", "paused", "expired", "needs_attention"]] = None
    target_type: Optional[Literal["product", "category", "combo"]] = None
    target_ids: Optional[List[UUID]] = Field(None, max_length=100)
    location_ids: Optional[List[UUID]] = Field(None, max_length=100)
    placements: Optional[List[Literal["deals_category", "welcome_screen", "kiosk_banner"]]] = None


class QrCodeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    destination_type: Literal["main_menu", "category", "item", "deal", "table", "takeaway"]
    destination_id: Optional[UUID] = None
    location_id: Optional[UUID] = None
    table_token: Optional[str] = Field(None, max_length=120)
    expires_at: Optional[datetime] = None
    tracking_metadata: Dict[str, Any] = Field(default_factory=dict)


class QrCodeUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    active: Optional[bool] = None
    expires_at: Optional[datetime] = None
    tracking_metadata: Optional[Dict[str, Any]] = None


class AvailabilityUpdate(BaseModel):
    is_available: bool


class StockLimitUpdate(BaseModel):
    track_stock: bool = False
    stock_quantity: Optional[int] = Field(None, ge=0)
    daily_limit: Optional[int] = Field(None, ge=0)
    availability_start_time: Optional[time] = None
    availability_end_time: Optional[time] = None
    metadata: Optional[Dict[str, Any]] = None


class AvailabilityTimeWindow(BaseModel):
    start: time
    end: time

    @model_validator(mode="after")
    def validate_window(self) -> "AvailabilityTimeWindow":
        if self.start == self.end:
            raise ValueError("Availability window start and end must be different.")
        return self


class AvailabilityRuleCreate(BaseModel):
    target_type: Literal["item", "category", "combo", "location", "menu"]
    target_id: Optional[UUID] = None
    rule_type: Literal["schedule", "exception"]
    name: Optional[str] = Field(None, max_length=120)
    is_available: bool = True
    status: Literal["active", "paused"] = "active"
    days: List[str] = Field(default_factory=list, max_length=7)
    time_windows: List[AvailabilityTimeWindow] = Field(default_factory=list, max_length=8)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    location_ids: List[UUID] = Field(default_factory=list, max_length=100)
    reason: Optional[str] = Field(None, max_length=240)

    @model_validator(mode="after")
    def validate_rule(self) -> "AvailabilityRuleCreate":
        if self.target_type != "menu" and self.target_id is None:
            raise ValueError("Select a target for this availability rule.")
        if self.rule_type == "schedule" and (not self.days or not self.time_windows):
            raise ValueError("A schedule needs at least one day and time window.")
        if self.starts_at and self.ends_at and self.starts_at >= self.ends_at:
            raise ValueError("Availability end must be after its start.")
        return self


class AvailabilityRuleUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    is_available: Optional[bool] = None
    status: Optional[Literal["active", "paused"]] = None
    days: Optional[List[str]] = Field(None, max_length=7)
    time_windows: Optional[List[AvailabilityTimeWindow]] = Field(None, max_length=8)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    location_ids: Optional[List[UUID]] = Field(None, max_length=100)
    reason: Optional[str] = Field(None, max_length=240)


class ModifierOptionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    price_delta: float = 0
    is_default: bool = False
    is_available: bool = True
    sort_order: int = 0


class ModifierGroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    min_select: int = Field(0, ge=0)
    max_select: int = Field(1, ge=0)
    is_required: bool = False
    sort_order: int = 0
    options: List[ModifierOptionCreate] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_selection_limits(self) -> "ModifierGroupCreate":
        if self.min_select > self.max_select:
            raise ValueError("min_select cannot be greater than max_select.")
        return self


class ModifierGroupUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=80)
    min_select: Optional[int] = Field(None, ge=0)
    max_select: Optional[int] = Field(None, ge=0)
    is_required: Optional[bool] = None
    sort_order: Optional[int] = None

    @model_validator(mode="after")
    def validate_selection_limits(self) -> "ModifierGroupUpdate":
        if self.min_select is not None and self.max_select is not None and self.min_select > self.max_select:
            raise ValueError("min_select cannot be greater than max_select.")
        return self


ComboStatus = Literal["draft", "shown", "hidden", "unavailable"]
ComboAvailabilityType = Literal["always", "scheduled"]
ComboSectionType = Literal["included_items", "optional_upgrades"]
ComboSourceType = Literal["existing_item", "exclusive_combo_item"]
ComboExclusiveType = Literal["main", "side", "drink", "dessert", "add_on"]


class ComboOptionInput(BaseModel):
    id: Optional[UUID] = None
    source_type: ComboSourceType
    existing_item_id: Optional[UUID] = None
    exclusive_name: Optional[str] = Field(None, max_length=140)
    exclusive_description: Optional[str] = Field(None, max_length=500)
    exclusive_image_path: Optional[str] = None
    exclusive_type: Optional[ComboExclusiveType] = None
    quantity: int = Field(1, ge=1)
    price_impact: float = Field(0, ge=0)
    default_selected: bool = True
    removable: bool = True
    visible: bool = True
    sort_order: int = Field(0, ge=0)

    @model_validator(mode="after")
    def validate_source(self) -> "ComboOptionInput":
        if self.source_type == "existing_item":
            if self.existing_item_id is None:
                raise ValueError("existing_item_id is required for an existing item option.")
            if self.exclusive_name:
                raise ValueError("exclusive_name cannot be used for an existing item option.")
        else:
            if not (self.exclusive_name or "").strip():
                raise ValueError("exclusive_name is required for an exclusive combo item.")
            if self.existing_item_id is not None:
                raise ValueError("existing_item_id cannot be used for an exclusive combo item.")
        return self


class ComboSectionInput(BaseModel):
    id: Optional[UUID] = None
    title: str = Field(..., min_length=1, max_length=100)
    section_type: ComboSectionType
    required: bool = False
    min_select: int = Field(0, ge=0)
    max_select: int = Field(1, ge=0)
    sort_order: int = Field(0, ge=0)
    options: List[ComboOptionInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_selection_limits(self) -> "ComboSectionInput":
        if self.min_select > self.max_select:
            raise ValueError("min_select cannot be greater than max_select.")
        return self


class ComboCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=140)
    description: Optional[str] = Field(None, max_length=1000)
    image_path: Optional[str] = None
    category_id: Optional[UUID] = None
    price: float = Field(0, ge=0)
    original_price: Optional[float] = Field(None, ge=0)
    display_badge: Optional[str] = Field(None, max_length=40)
    tags: List[str] = Field(default_factory=list)
    status: ComboStatus = "draft"
    sort_order: int = Field(0, ge=0)
    availability_type: ComboAvailabilityType = "always"
    available_days: List[str] = Field(default_factory=list)
    available_start_time: Optional[time] = None
    available_end_time: Optional[time] = None
    sections: List[ComboSectionInput] = Field(default_factory=list)


class ComboUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=140)
    description: Optional[str] = Field(None, max_length=1000)
    image_path: Optional[str] = None
    category_id: Optional[UUID] = None
    price: Optional[float] = Field(None, ge=0)
    original_price: Optional[float] = Field(None, ge=0)
    display_badge: Optional[str] = Field(None, max_length=40)
    tags: Optional[List[str]] = None
    status: Optional[ComboStatus] = None
    sort_order: Optional[int] = Field(None, ge=0)
    availability_type: Optional[ComboAvailabilityType] = None
    available_days: Optional[List[str]] = None
    available_start_time: Optional[time] = None
    available_end_time: Optional[time] = None
    sections: Optional[List[ComboSectionInput]] = None


class ComboSectionCreate(ComboSectionInput):
    options: List[ComboOptionInput] = Field(default_factory=list)


class ComboSectionUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=100)
    section_type: Optional[ComboSectionType] = None
    required: Optional[bool] = None
    min_select: Optional[int] = Field(None, ge=0)
    max_select: Optional[int] = Field(None, ge=0)
    sort_order: Optional[int] = Field(None, ge=0)

    @model_validator(mode="after")
    def validate_selection_limits(self) -> "ComboSectionUpdate":
        if self.min_select is not None and self.max_select is not None and self.min_select > self.max_select:
            raise ValueError("min_select cannot be greater than max_select.")
        return self


class ComboOptionCreate(ComboOptionInput):
    pass


class ComboOptionUpdate(BaseModel):
    source_type: Optional[ComboSourceType] = None
    existing_item_id: Optional[UUID] = None
    exclusive_name: Optional[str] = Field(None, max_length=140)
    exclusive_description: Optional[str] = Field(None, max_length=500)
    exclusive_image_path: Optional[str] = None
    exclusive_type: Optional[ComboExclusiveType] = None
    quantity: Optional[int] = Field(None, ge=1)
    price_impact: Optional[float] = Field(None, ge=0)
    default_selected: Optional[bool] = None
    removable: Optional[bool] = None
    visible: Optional[bool] = None
    sort_order: Optional[int] = Field(None, ge=0)


class KioskMenu(BaseModel):
    business: Dict[str, Any]
    categories: List[Dict[str, Any]]
    products: List[Dict[str, Any]]


class OrderItemCreate(BaseModel):
    product_id: UUID
    quantity: int = Field(..., gt=0, le=99)
    notes: Optional[str] = Field(None, max_length=240)
    customizations: List[Dict[str, Any]] = Field(default_factory=list, max_length=20)


class OrderCreate(BaseModel):
    order_type: OrderType = OrderType.DINE_IN
    location_id: Optional[UUID] = None
    table_label: Optional[str] = Field(None, max_length=40)
    customer_name: Optional[str] = Field(None, max_length=120)
    customer_phone: Optional[str] = Field(None, max_length=30)
    notes: Optional[str] = Field(None, max_length=400)
    payment_method: Optional[str] = "pay_at_counter"
    items: List[OrderItemCreate] = Field(..., min_length=1)


class PaymentProvider(str, Enum):
    STRIPE = "stripe"
    RAZORPAY = "razorpay"
    PAYTM = "paytm"
    PAY_AT_COUNTER = "pay_at_counter"


class PaymentAccountConnect(BaseModel):
    provider_account_id: Optional[str] = Field(None, max_length=120)
    display_name: Optional[str] = Field(None, max_length=120)
    provider_merchant_id: Optional[str] = Field(None, max_length=120)
    is_enabled: bool = True


class PaymentAccountUpdate(BaseModel):
    business_id: UUID
    is_enabled: Optional[bool] = None
    is_default: Optional[bool] = None
    display_name: Optional[str] = Field(None, max_length=120)
    provider_account_id: Optional[str] = Field(None, max_length=120)
    provider_merchant_id: Optional[str] = Field(None, max_length=120)


class PaymentAccountDisconnect(BaseModel):
    confirm: bool = False


class CounterPaymentMarkPaid(BaseModel):
    business_id: UUID
    amount: Optional[float] = Field(None, ge=0)
    method: Optional[str] = Field("counter", max_length=40)


class CounterClaimAction(BaseModel):
    device_id: Optional[UUID] = None


class CounterOverrideRequest(BaseModel):
    action: Literal["cancel_pending_payment"]
    reason: str = Field(..., min_length=3, max_length=240)
    pin: str = Field(..., min_length=4, max_length=6, pattern=r"^\d+$")


class CounterOverrideUse(BaseModel):
    override_token: str = Field(..., min_length=20, max_length=2048)
    reason: str = Field(..., min_length=3, max_length=240)


class CounterOrderComplete(BaseModel):
    business_id: UUID


class KitchenItemCompletion(BaseModel):
    completed_quantity: int = Field(..., ge=0, le=99)
    event_id: UUID


class KitchenHoldRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=240)
    event_id: UUID


class KitchenActionRequest(BaseModel):
    reason: Optional[str] = Field(None, min_length=3, max_length=240)
    event_id: UUID
    override_token: Optional[str] = Field(None, min_length=20, max_length=2048)


class KitchenOverrideRequest(BaseModel):
    action: Literal["ready_incomplete", "recall"]
    reason: str = Field(..., min_length=3, max_length=240)
    pin: str = Field(..., min_length=4, max_length=6, pattern=r"^\d+$")


class KitchenAvailabilityUpdate(BaseModel):
    status: Literal["available", "temporarily_unavailable", "out_of_stock"]
    event_id: UUID


class KitchenPreferenceUpdate(BaseModel):
    sound_enabled: Optional[bool] = None
    sound_volume: Optional[int] = Field(None, ge=0, le=100)


class PaytmDynamicQrCreate(BaseModel):
    business_id: UUID
    payment_id: UUID
    payment_token: str = Field(..., min_length=8, max_length=120)


class PaymentStatusCheck(BaseModel):
    payment_token: str = Field(..., min_length=8, max_length=120)


class OwnerPinSet(BaseModel):
    current_pin: Optional[str] = Field(None, min_length=4, max_length=6, pattern=r"^\d+$")
    pin: str = Field(..., min_length=4, max_length=6, pattern=r"^\d+$")
    confirm_pin: str = Field(..., min_length=4, max_length=6, pattern=r"^\d+$")

    @model_validator(mode="after")
    def pins_must_match(self) -> "OwnerPinSet":
        if self.pin != self.confirm_pin:
            raise ValueError("confirm_pin must match pin.")
        return self


class OwnerPinVerify(BaseModel):
    pin: str = Field(..., min_length=4, max_length=6, pattern=r"^\d+$")


class DeviceCreate(BaseModel):
    device_id: Optional[str] = Field(None, min_length=4, max_length=120)
    name: str = Field(..., min_length=2, max_length=120)
    device_type: Literal["kiosk", "kitchen", "counter"] = "kiosk"
    assigned_kiosk_slug: Optional[str] = Field(None, max_length=120)
    location_label: Optional[str] = Field(None, max_length=120)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class DeviceHeartbeat(BaseModel):
    device_id: Optional[str] = Field(None, min_length=4, max_length=120)
    name: Optional[str] = Field(None, max_length=120)
    device_type: Optional[Literal["kiosk", "kitchen", "counter"]] = None
    app_version: Optional[str] = Field(None, max_length=80)
    user_agent: Optional[str] = Field(None, max_length=240)
    current_route: Optional[str] = Field(None, max_length=240)
    last_error: Optional[str] = Field(None, max_length=500)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class DeviceUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=120)
    device_type: Optional[Literal["kiosk", "kitchen", "counter"]] = None
    location_label: Optional[str] = Field(None, max_length=120)
    metadata: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class DevicePairingRequestCreate(BaseModel):
    business_slug: str = Field(..., min_length=2, max_length=120)
    device_type: Literal["kiosk", "kitchen", "counter"] = "kiosk"
    device_name: Optional[str] = Field(None, max_length=120)
    location_label: Optional[str] = Field(None, max_length=120)
    app_version: Optional[str] = Field(None, max_length=80)
    user_agent: Optional[str] = Field(None, max_length=240)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class DeviceActivationCodeCreate(BaseModel):
    device_type: Literal["kiosk", "kitchen", "counter"] = "kiosk"
    device_name: Optional[str] = Field(None, max_length=120)
    location_label: Optional[str] = Field(None, max_length=120)
    expires_in_minutes: int = Field(10, ge=5, le=60)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class DevicePairingApprove(BaseModel):
    device_name: Optional[str] = Field(None, max_length=120)
    location_label: Optional[str] = Field(None, max_length=120)


class DevicePairingClaim(BaseModel):
    polling_secret: Optional[str] = Field(None, min_length=16, max_length=160)
    app_version: Optional[str] = Field(None, max_length=80)
    user_agent: Optional[str] = Field(None, max_length=240)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class DeviceActivate(BaseModel):
    activation_code: str = Field(..., min_length=6, max_length=12, pattern=r"^[A-Za-z0-9-]+$")
    device_name: Optional[str] = Field(None, max_length=120)
    location_label: Optional[str] = Field(None, max_length=120)
    app_version: Optional[str] = Field(None, max_length=80)
    user_agent: Optional[str] = Field(None, max_length=240)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class DeviceSessionExchange(BaseModel):
    expected_type: Optional[Literal["kiosk", "kitchen", "counter"]] = None


class AlertStatusUpdate(BaseModel):
    business_id: UUID
    status: Literal["open", "acknowledged", "resolved"]

class OrderStatusUpdate(BaseModel):
    business_id: UUID
    status: OrderStatus
    changed_by: Optional[UUID] = None
    cancel_reason: Optional[str] = Field(None, max_length=240)


class Order(BaseModel):
    id: UUID
    business_id: UUID
    order_number: Optional[int] = None
    public_token: Optional[str] = None
    status: OrderStatus
    order_type: OrderType
    table_label: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    subtotal: float
    tax_amount: float
    discount_amount: float
    total_amount: float
    payment_status: PaymentStatus
    payment_method: Optional[str] = None
    notes: Optional[str] = None
    placed_at: datetime
    prep_started_at: Optional[datetime] = None
    ready_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    cancel_reason: Optional[str] = None
    order_items: Optional[List[Dict[str, Any]]] = None


class DashboardStats(BaseModel):
    revenue_today: float
    active_orders: int
    orders_today: int
    orders_last_hour: int
    orders_past_7_days: int
    items_sold: int = 0
    average_order_value: float
    top_selling_item: Optional[Dict[str, Any]] = None
    top_selling_items: List[Dict[str, Any]] = Field(default_factory=list)
    gross_sales_today: float = 0
    discounts_today: float = 0
    refunds_today: float = 0
    cancellations_today: float = 0
    net_sales_today: float = 0
    weekly_revenue: List[Dict[str, Any]]
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None
    completed_orders: int = 0
    period_gross_sales: float = 0
    period_discounts: float = 0
    period_refunds: float = 0
    period_cancellations: float = 0
    period_net_sales: float = 0
    period_average_order_value: float = 0
    order_type_summary: Dict[str, int] = Field(default_factory=dict)
    payment_method_summary: Dict[str, int] = Field(default_factory=dict)
    order_funnel: Dict[str, int] = Field(default_factory=dict)


class HomeActivation(BaseModel):
    state: Literal["new", "returning"]
    completed_order_count: int
