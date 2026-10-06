import { auth } from "@/lib/auth";
import type {
  AuthSession,
  AuthUser,
  AlertRecord,
  AlertSummary,
  AvailabilityRule,
  Business,
  Category,
  Combo,
  ComboOption,
  ComboPayload,
  ComboSection,
  DashboardStats,
  HomeActivation,
  KioskMenu,
  KioskSetupOverview,
  KioskSetupStep,
  KioskTestOrderPayload,
  ModifierGroup,
  OnboardingStatus,
  Order,
  OrderStatus,
  PaymentAccount,
  PaymentRecord,
  Product,
  SignupStartResponse,
  StaffMember,
  StaffRole,
  BusinessLocation,
  AdministrationActivity,
  AdministrationOverview,
  DeviceRecord,
  DevicePairingRequest,
  DeviceSession,
  LiveDeviceContext,
  ResolvedAvailability,
} from "@/lib/types";

export type PromotionRecord = { id: string; name: string; description?: string | null; status: string; discount_type: string; discount_value: number; starts_at?: string | null; ends_at?: string | null; placements?: string[]; location_ids?: string[]; targets?: { target_type: string; target_id: string }[] };
export type QrCodeRecord = { id: string; name: string; destination_type: string; destination_id?: string | null; table_token?: string | null; active: boolean; expires_at?: string | null; url: string };
export type KioskVersionRecord = { id: string; version_number: number; config_signature: string; published_at: string; published_by?: string | null; source_draft_id?: string | null; change_count?: number; changed_areas?: string[] };
export type KioskVersionSnapshot = { version: KioskVersionRecord; snapshot: { business: Record<string, unknown>; products: Product[]; categories: Category[] } };

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api";
const DEFAULT_TIMEOUT_MS = 15000;
const UPLOAD_TIMEOUT_MS = 60000;

type ApiEnvelope<T> = {
  status?: string;
  message?: string;
  data?: T;
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

type ValidationIssue = {
  loc?: Array<string | number>;
  msg?: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
};

export type PexelsPhoto = {
  id: number;
  alt: string;
  photographer?: string | null;
  url?: string | null;
  thumb: string;
  image: string;
};

type OrderQueryOptions = {
  status?: "active" | "completed" | "done";
  start?: string;
  end?: string;
  locationId?: string | null;
  limit?: number;
};

type KioskTestSession = {
  id: string;
  business_id: string;
  business_slug?: string;
  expires_at: string;
  token?: string;
};

type KioskExperienceTestOrder = {
  id: string;
  business_id: string;
  status: string;
  order_type: Order["order_type"];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  completed_at?: string | null;
};

const inFlightGetRequests = new Map<string, Promise<unknown>>();
let refreshInFlight: Promise<boolean> | null = null;

export function apiRequest<T>(
  path: string,
  options: RequestInit & { auth?: boolean; timeoutMs?: number } = {}
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  if (method !== "GET" || options.signal) return performApiRequest<T>(path, options);
  const key = `${API_BASE}${path}`;
  const existing = inFlightGetRequests.get(key);
  if (existing) return existing as Promise<T>;
  const request = performApiRequest<T>(path, options).finally(() => inFlightGetRequests.delete(key));
  inFlightGetRequests.set(key, request);
  return request;
}

async function performApiRequest<T>(
  path: string,
  options: RequestInit & { auth?: boolean; timeoutMs?: number } = {},
  allowRefresh = true
): Promise<T> {
  const { auth: useAuth = true, timeoutMs, ...fetchOptions } = options;
  const headers = new Headers(options.headers);
  const isForm = options.body instanceof FormData;

  if (!isForm && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const requestTimeout = timeoutMs ?? (isForm ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  let timedOut = false;
  const abortRequest = () => controller.abort();
  if (fetchOptions.signal) {
    if (fetchOptions.signal.aborted) abortRequest();
    else fetchOptions.signal.addEventListener("abort", abortRequest, { once: true });
  }
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeout);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
      credentials: fetchOptions.credentials ?? "include",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(timedOut ? "The server is taking too long to respond. Please try again." : "The request was cancelled.");
    }
    if (err instanceof TypeError) {
      throw new Error("Could not connect to PlaceURorder. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    fetchOptions.signal?.removeEventListener("abort", abortRequest);
  }

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { detail: "The service returned an unexpected response. Please try again." };
  }

  if (!response.ok) {
    const errorPayload =
      payload && typeof payload === "object"
        ? (payload as { detail?: unknown; message?: unknown; error?: { message?: unknown } })
        : null;
    const detail = errorPayload?.error?.message ?? errorPayload?.detail ?? errorPayload?.message ?? "Request failed.";
    const message = formatApiError(detail);
    if (useAuth !== false && response.status === 401) {
      if (allowRefresh && path !== "/auth/refresh" && await refreshAuthSession()) {
        return performApiRequest<T>(path, options, false);
      }
      auth.clear();
    }
    if (response.status >= 500 && /internal server error|request failed/i.test(message)) {
      throw new Error("The server could not complete this request. Please try again.");
    }
    throw new ApiError(message, response.status);
  }

  const method = (fetchOptions.method ?? "GET").toUpperCase();
  if (typeof window !== "undefined" && method !== "GET" && /businesses|products|categories|modifier|combos|combo-/.test(path)) {
    window.dispatchEvent(new CustomEvent("menutap:configuration-saved"));
  }

  return payload as T;
}

function refreshAuthSession() {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE}/auth/refresh`, { method: "POST", credentials: "include" })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

function formatApiError(detail: unknown) {
  if (typeof detail === "string") return detail || "Request failed.";

  if (Array.isArray(detail)) {
    const messages = detail.map(formatValidationIssue).filter(Boolean);
    return messages.length ? messages.join(" ") : "Please check the highlighted fields and try again.";
  }

  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.msg === "string") return formatValidationIssue(record as ValidationIssue);
  }

  return "Request failed. Please check the details and try again.";
}

function formatValidationIssue(issue: ValidationIssue) {
  const label = fieldLabel(issue.loc);
  const message = issue.msg || "Invalid value.";

  if (
    label === "Kiosk URL slug" &&
    /at least 2 characters|min_length/i.test(message)
  ) {
    return "Kiosk URL slug must be at least 2 characters. Try a longer slug like \"hello\".";
  }

  return `${label}: ${sentenceCase(message)}`;
}

function fieldLabel(loc?: Array<string | number>) {
  const field = loc?.filter((part) => part !== "body").at(-1);
  const key = String(field || "field");
  const labels: Record<string, string> = {
    slug: "Kiosk URL slug",
    name: "Business name",
    email: "Email",
    password: "Password",
  };

  return labels[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function sentenceCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function apiData<T>(path: string, options?: RequestInit & { auth?: boolean; timeoutMs?: number }) {
  const envelope = await apiRequest<ApiEnvelope<T>>(path, options);
  return envelope.data as T;
}

export const api = {
  adminBootstrap: () => apiRequest<{
    user: AuthUser;
    onboarding: OnboardingStatus;
    business: Business | null;
    role?: StaffRole | null;
    setup?: KioskSetupOverview | null;
    alerts: AlertSummary;
  }>("/admin/bootstrap"),
  login: (payload: { email: string; password: string }) =>
    apiRequest<AuthSession>("/auth/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    }),
  signup: (payload: { email: string; password: string; full_name?: string }) =>
    apiRequest<SignupStartResponse>("/auth/signup", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    }),
  verifyEmail: (payload: { email: string; code: string }) =>
    apiRequest<AuthSession>("/auth/verify-email", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    }),
  resendVerification: (email: string) =>
    apiRequest<SignupStartResponse>("/auth/resend-verification", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email }),
    }),
  me: () => apiRequest<AuthUser>("/auth/me"),
  forgotPassword: (email: string) =>
    apiRequest<{ message: string; reset_url?: string | null }>("/auth/forgot-password", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email }),
    }),
  resetPassword: (payload: { token: string; password: string }) =>
    apiData<null>("/auth/reset-password", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    }),
  logout: () => apiRequest("/auth/logout", { method: "POST" }),
  staff: (businessId: string) =>
    apiRequest<{ staff: StaffMember[] }>(`/businesses/${businessId}/staff`),
  inviteStaff: (businessId: string, payload: { email: string; role: StaffRole; full_name?: string }) =>
    apiData<StaffMember>(`/businesses/${businessId}/staff`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateStaff: (businessId: string, staffId: string, payload: { role?: StaffRole; full_name?: string }) =>
    apiData<StaffMember>(`/businesses/${businessId}/staff/${staffId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  removeStaff: (businessId: string, staffId: string) =>
    apiRequest(`/businesses/${businessId}/staff/${staffId}`, {
      method: "DELETE",
    }),
  onboardingStatus: () => apiRequest<OnboardingStatus>("/onboarding/status", { timeoutMs: 5000 }),
  myBusiness: () => apiRequest<{ business: Business | null; role?: StaffRole | null }>("/businesses/me"),
  slugOptions: (payload: { name?: string; slug?: string }) => {
    const params = new URLSearchParams();
    if (payload.name) params.set("name", payload.name);
    if (payload.slug) params.set("slug", payload.slug);
    return apiRequest<{ slug: string; available: boolean; suggestions: string[] }>(
      `/businesses/slug-options?${params.toString()}`
    );
  },
  createBusiness: (payload: Partial<Business>) =>
    apiData<Business>("/businesses", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateBusiness: (businessId: string, payload: Partial<Business>) =>
    apiData<Business>(`/businesses/${businessId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  kioskSetup: (businessId: string) => apiRequest<KioskSetupOverview>(`/businesses/${businessId}/setup`),
  updateKioskSetup: (businessId: string, payload: { expected_revision: number; current_step?: KioskSetupStep; intro_pending?: boolean; active?: boolean }) =>
    apiRequest<KioskSetupOverview>(`/businesses/${businessId}/setup`, { method: "PATCH", body: JSON.stringify(payload) }),
  attestKioskPreview: (businessId: string) =>
    apiRequest<KioskSetupOverview & { attestation: { id: string } }>(`/businesses/${businessId}/setup/preview-attestations`, { method: "POST", body: JSON.stringify({ event_version: 1 }) }),
  createKioskTestOrder: (businessId: string, payload: KioskTestOrderPayload) =>
    apiRequest<KioskSetupOverview & { test_order: Order; attestation: { id: string } }>(`/businesses/${businessId}/setup/test-orders`, { method: "POST", body: JSON.stringify(payload) }),
  createKioskTestSession: (businessId: string) =>
    apiRequest<{ session: KioskTestSession & { token: string } }>(`/businesses/${businessId}/setup/test-sessions`, { method: "POST" }),
  currentKioskTestSession: (businessId: string) =>
    apiRequest<{ session: KioskTestSession | null }>(`/businesses/${businessId}/setup/test-sessions`),
  resetKioskTestSession: (businessId: string) =>
    apiRequest<{ session: KioskTestSession & { token: string } }>(`/businesses/${businessId}/setup/test-sessions/reset`, { method: "POST" }),
  endKioskTestSession: (businessId: string) =>
    apiRequest<{ status: string }>(`/businesses/${businessId}/setup/test-sessions`, { method: "DELETE" }),
  exchangeKioskTestSession: (token: string) =>
    apiRequest<{ session: KioskTestSession }>("/kiosk/test/session/exchange", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ token }),
    }),
  completeKioskTestExperience: (payload: {
    event_version: 1;
    order_type: Order["order_type"];
    items: Array<{ preset_id: string; name: string; quantity: number }>;
  }) =>
    apiData<KioskExperienceTestOrder>("/kiosk/test/session/experience-complete", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    }),
  clearKioskTestSession: () =>
    apiRequest("/kiosk/test/session", {
      method: "DELETE",
      auth: false,
    }),
  testKioskSessionMenu: () => apiRequest<KioskMenu>("/kiosk/test/session/menu", { auth: false }),
  testRuntimeContext: (appType: "kiosk" | "counter" | "kitchen") =>
    apiRequest<{ session: { id: string; business_id: string; expires_at: string; app_type: string } }>(`/kiosk/test/session/context/${appType}`, { auth: false }),
  testRuntimeCreateOrder: (payload: Record<string, unknown>) =>
    apiData<Record<string, unknown>>("/test/runtime/counter/orders", { method: "POST", auth: false, body: JSON.stringify(payload) }),
  testRuntimeCreateKioskOrder: (payload: Record<string, unknown>) =>
    apiData<Record<string, unknown>>("/test/runtime/kiosk/orders", { method: "POST", auth: false, body: JSON.stringify(payload) }),
  testRuntimeMarkPaid: (orderId: string) => apiData<Record<string, unknown>>(`/test/runtime/counter/orders/${orderId}/mark-paid`, { method: "POST", auth: false }),
  testCounterPendingPayments: () => apiRequest<{ orders: Record<string, unknown>[] }>("/test/runtime/counter/pending-payments", { auth: false }),
  testCounterKitchenOrders: () => apiRequest<{ orders: Record<string, unknown>[] }>("/test/runtime/counter/kitchen-orders", { auth: false }),
  testCounterHandoverHistory: () => apiRequest<{ orders: Record<string, unknown>[] }>("/test/runtime/counter/handover-history", { auth: false }),
  testCounterHandover: (orderId: string) => apiData<Record<string, unknown>>(`/test/runtime/counter/orders/${orderId}/handover`, { method: "POST", auth: false, body: JSON.stringify({}) }),
  testRuntimeReset: () => apiRequest("/test/runtime/counter/orders", { method: "DELETE", auth: false }),
  testKitchenOrders: () => apiRequest<{ orders: Record<string, unknown>[] }>("/test/runtime/kitchen/orders", { auth: false }),
  testKitchenCompleted: () => apiRequest<{ orders: Record<string, unknown>[] }>("/test/runtime/kitchen/history", { auth: false }),
  testKitchenSummary: () => apiRequest<Record<string, number>>("/test/runtime/kitchen/summary", { auth: false }),
  testKitchenAction: (action: "start" | "hold" | "resume" | "ready" | "recall", orderId: string, payload: Record<string, unknown> = {}) => apiData<Record<string, unknown>>(`/test/runtime/kitchen/orders/${orderId}/${action}`, { method: "POST", auth: false, body: JSON.stringify(payload) }),
  testKitchenItem: (orderId: string, itemId: string, completedQuantity: number) => apiData<Record<string, unknown>>(`/test/runtime/kitchen/orders/${orderId}/items/${itemId}`, { method: "PATCH", auth: false, body: JSON.stringify({ completed_quantity: completedQuantity }) }),
  testKitchenAvailability: () => apiRequest<{ products: Product[] }>("/test/runtime/kitchen/availability", { auth: false }),
  testKitchenSetAvailability: (productId: string, isAvailable: boolean) => apiData<Record<string, unknown>>(`/test/runtime/kitchen/availability/${productId}`, { method: "PUT", auth: false, body: JSON.stringify({ is_available: isAvailable }) }),
  kioskDraftMenu: (businessId: string, locationId?: string | null) =>
    apiRequest<KioskMenu>(`/businesses/${businessId}/setup/draft-menu${locationId ? `?location_id=${encodeURIComponent(locationId)}` : ""}`),
  availability: (businessId: string, locationId?: string | null) =>
    apiRequest<{ rules: AvailabilityRule[]; locations: BusinessLocation[]; resolved: ResolvedAvailability[] }>(`/businesses/${businessId}/availability${locationId ? `?location_id=${encodeURIComponent(locationId)}` : ""}`),
  createAvailabilityRule: (businessId: string, payload: Omit<AvailabilityRule, "id" | "business_id" | "created_at" | "updated_at">) =>
    apiData<AvailabilityRule>(`/businesses/${businessId}/availability/rules`, { method: "POST", body: JSON.stringify(payload) }),
  updateAvailabilityRule: (businessId: string, ruleId: string, payload: Partial<AvailabilityRule>) =>
    apiData<AvailabilityRule>(`/businesses/${businessId}/availability/rules/${ruleId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteAvailabilityRule: (businessId: string, ruleId: string) =>
    apiRequest(`/businesses/${businessId}/availability/rules/${ruleId}`, { method: "DELETE" }),
  publishKioskSetup: (businessId: string, expectedRevision: number, allowUntested = false) =>
    apiRequest<KioskSetupOverview>(`/businesses/${businessId}/setup/publish`, { method: "POST", body: JSON.stringify({ expected_revision: expectedRevision, allow_untested: allowUntested }) }),
  promotions: (businessId: string) => apiRequest<{ promotions: PromotionRecord[] }>(`/businesses/${businessId}/promotions`),
  createPromotion: (businessId: string, payload: Record<string, unknown>) => apiRequest<PromotionRecord>(`/businesses/${businessId}/promotions`, { method: "POST", body: JSON.stringify(payload) }),
  updatePromotion: (businessId: string, promotionId: string, payload: Record<string, unknown>) => apiRequest<PromotionRecord>(`/businesses/${businessId}/promotions/${promotionId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deletePromotion: (businessId: string, promotionId: string) => apiRequest(`/businesses/${businessId}/promotions/${promotionId}`, { method: "DELETE" }),
  qrCodes: (businessId: string) => apiRequest<{ qr_codes: QrCodeRecord[] }>(`/businesses/${businessId}/qr-codes`),
  createQrCode: (businessId: string, payload: Record<string, unknown>) => apiRequest<QrCodeRecord>(`/businesses/${businessId}/qr-codes`, { method: "POST", body: JSON.stringify(payload) }),
  kioskVersions: (businessId: string) => apiRequest<{ versions: KioskVersionRecord[] }>(`/businesses/${businessId}/kiosk-versions`),
  kioskVersionSnapshot: (businessId: string, versionId: string) => apiRequest<KioskVersionSnapshot>(`/businesses/${businessId}/kiosk-versions/${versionId}/snapshot`),
  compareKioskVersion: (businessId: string, versionId: string, against: "live" | "draft") => apiRequest<{ version: KioskVersionRecord; against: string; domains: { key: string; label: string; changed: number }[] }>(`/businesses/${businessId}/kiosk-versions/${versionId}/compare?against=${against}`),
  restoreKioskVersion: (businessId: string, versionId: string, expectedRevision: number) => apiRequest<{ draft_id: string; setup?: { revision?: number } }>(`/businesses/${businessId}/kiosk-versions/${versionId}/restore?expected_revision=${expectedRevision}`, { method: "POST" }),
  setOwnerPin: (businessId: string, pin: string, confirmPin: string, currentPin?: string) =>
    apiData<{ pin_configured: boolean; owner_pin_set_at?: string | null }>(`/businesses/${businessId}/owner-pin`, {
      method: "POST",
      body: JSON.stringify({ pin, confirm_pin: confirmPin, current_pin: currentPin || undefined }),
    }),
  dashboard: (businessId: string, options: { start?: string; end?: string; locationId?: string | null } = {}) => {
    const params = new URLSearchParams();
    if (options.start) params.set("start", apiDate(options.start, false));
    if (options.end) params.set("end", apiDate(options.end, true));
    if (options.locationId) params.set("location_id", options.locationId);
    const query = params.toString();
    return apiRequest<DashboardStats>(`/businesses/${businessId}/dashboard${query ? `?${query}` : ""}`);
  },
  insights: (businessId: string, options: { start?: string; end?: string; locationId?: string | null; comparison?: string } = {}) => {
    const params = new URLSearchParams();
    if (options.start) params.set("start", apiDate(options.start, false));
    if (options.end) params.set("end", apiDate(options.end, true));
    if (options.locationId) params.set("location_id", options.locationId);
    if (options.comparison) params.set("comparison", options.comparison);
    const query = params.toString();
    return apiRequest<Record<string, unknown>>(`/businesses/${businessId}/insights${query ? `?${query}` : ""}`);
  },
  homeActivation: (businessId: string, locationId?: string | null) =>
    apiRequest<HomeActivation>(`/businesses/${businessId}/home-activation${locationId ? `?location_id=${encodeURIComponent(locationId)}` : ""}`),
  categories: (businessId: string) =>
    apiRequest<{ categories: Category[] }>(`/businesses/${businessId}/categories`),
  createCategory: (businessId: string, payload: Partial<Category>) =>
    apiData<Category>(`/businesses/${businessId}/categories`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateCategory: (categoryId: string, payload: Partial<Category>) =>
    apiData<Category>(`/categories/${categoryId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteCategory: (categoryId: string) =>
    apiRequest(`/categories/${categoryId}`, {
      method: "DELETE",
    }),
  products: (businessId: string, includeUnavailable = true) =>
    apiRequest<{ products: Product[] }>(
      `/businesses/${businessId}/products?include_unavailable=${includeUnavailable}`
    ),
  createProduct: (businessId: string, payload: Partial<Product>) =>
    apiData<Product>(`/businesses/${businessId}/products`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateProduct: (productId: string, payload: Partial<Product>) =>
    apiData<Product>(`/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  updateStockLimit: (
    productId: string,
    payload: Pick<Product, "track_stock"> &
      Partial<
        Pick<
          Product,
          "stock_quantity" | "daily_limit" | "availability_start_time" | "availability_end_time" | "metadata"
        >
      >
  ) =>
    apiData<Product>(`/products/${productId}/stock-limit`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteProduct: (productId: string) =>
    apiRequest(`/products/${productId}`, {
      method: "DELETE",
    }),
  setAvailability: (productId: string, isAvailable: boolean) =>
    apiData<Product>(`/products/${productId}/availability`, {
      method: "PATCH",
      body: JSON.stringify({ is_available: isAvailable }),
    }),
  modifierGroups: (productId: string) =>
    apiRequest<{ modifier_groups: ModifierGroup[] }>(`/products/${productId}/modifier-groups`),
  createModifierGroup: (
    productId: string,
    payload: {
      name: string;
      min_select?: number;
      max_select?: number;
      is_required?: boolean;
      sort_order?: number;
      options: { name: string; price_delta: number; is_default?: boolean; is_available?: boolean; sort_order?: number }[];
    }
  ) =>
    apiData<ModifierGroup>(`/products/${productId}/modifier-groups`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteModifierGroup: (groupId: string) =>
    apiRequest(`/modifier-groups/${groupId}`, {
      method: "DELETE",
    }),
  combos: (businessId: string) =>
    apiRequest<{ combos: Combo[] }>(`/businesses/${businessId}/combos`),
  combo: (comboId: string) =>
    apiRequest<{ combo: Combo }>(`/combos/${comboId}`),
  comboItems: (businessId: string) =>
    apiRequest<{ products: Product[] }>(`/businesses/${businessId}/combo-items`),
  createCombo: (businessId: string, payload: ComboPayload) =>
    apiData<Combo>(`/businesses/${businessId}/combos`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateCombo: (comboId: string, payload: Partial<ComboPayload>) =>
    apiData<Combo>(`/combos/${comboId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteCombo: (comboId: string) =>
    apiRequest(`/combos/${comboId}`, { method: "DELETE" }),
  duplicateCombo: (comboId: string) =>
    apiData<Combo>(`/combos/${comboId}/duplicate`, { method: "POST" }),
  createComboSection: (comboId: string, payload: Partial<ComboSection>) =>
    apiData<ComboSection>(`/combos/${comboId}/sections`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateComboSection: (sectionId: string, payload: Partial<ComboSection>) =>
    apiData<ComboSection>(`/combo-sections/${sectionId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteComboSection: (sectionId: string) =>
    apiRequest(`/combo-sections/${sectionId}`, { method: "DELETE" }),
  createComboOption: (sectionId: string, payload: Partial<ComboOption>) =>
    apiData<ComboOption>(`/combo-sections/${sectionId}/options`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateComboOption: (optionId: string, payload: Partial<ComboOption>) =>
    apiData<ComboOption>(`/combo-options/${optionId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteComboOption: (optionId: string) =>
    apiRequest(`/combo-options/${optionId}`, { method: "DELETE" }),
  uploadProductImage: (businessId: string, file: File) => uploadFile(businessId, file, "product-image"),
  uploadBrandAsset: (businessId: string, file: File) => uploadFile(businessId, file, "brand-asset"),
  searchPexels: (query: string, perPage = 12) =>
    apiRequest<{ photos: PexelsPhoto[] }>(
      `/media/pexels/search?q=${encodeURIComponent(query)}&per_page=${perPage}`
    ),
  orders: (businessId: string, statusOrOptions?: "active" | "completed" | "done" | OrderQueryOptions) => {
    const options = typeof statusOrOptions === "string" ? { status: statusOrOptions } : statusOrOptions ?? {};
    const suffix = options.status ? `/${options.status}` : "";
    const params = new URLSearchParams();
    if (options.start) params.set("start", apiDate(options.start, false));
    if (options.end) params.set("end", apiDate(options.end, true));
    if (options.locationId) params.set("location_id", options.locationId);
    params.set("limit", String(options.limit ?? 100));
    const query = params.toString();
    return apiRequest<{ orders: Order[] }>(`/businesses/${businessId}/orders${suffix}${query ? `?${query}` : ""}`);
  },
  updateOrderStatus: (orderId: string, businessId: string, status: OrderStatus, cancelReason?: string) =>
    apiData<Order>(`/orders/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ business_id: businessId, status, cancel_reason: cancelReason }),
    }),
  payments: (businessId: string) =>
    apiRequest<{
      payments: PaymentRecord[];
      has_more?: boolean;
      accounts: PaymentAccount[];
      summary: { total_collected: number; paid_count: number; pending_count: number; failed_count: number; enabled_methods: string[] };
    }>(`/businesses/${businessId}/payments?limit=100`),
  paymentAccounts: (businessId: string) =>
    apiRequest<{ accounts: PaymentAccount[] }>(`/businesses/${businessId}/payment-accounts`),
  connectPaymentAccount: (
    businessId: string,
    provider: "stripe" | "razorpay" | "paytm",
    providerAccountId?: string,
    extra?: { display_name?: string; provider_merchant_id?: string; is_enabled?: boolean }
  ) =>
    apiData<{ account: PaymentAccount; onboarding_url?: string | null; setup_required?: boolean }>(
      `/businesses/${businessId}/payment-accounts/${provider}/connect`,
      {
        method: "POST",
        body: JSON.stringify({ provider_account_id: providerAccountId || undefined, ...extra }),
      }
    ),
  updatePaymentAccount: (
    businessId: string,
    provider: "stripe" | "razorpay" | "paytm",
    payload: { is_enabled?: boolean; is_default?: boolean; display_name?: string; provider_account_id?: string; provider_merchant_id?: string }
  ) =>
    apiData<{ account: PaymentAccount }>(`/businesses/${businessId}/payment-accounts/${provider}`, {
      method: "PATCH",
      body: JSON.stringify({ business_id: businessId, ...payload }),
    }),
  refreshPaymentAccount: (businessId: string, provider: "stripe" | "razorpay" | "paytm") =>
    apiData<{ account: PaymentAccount }>(`/businesses/${businessId}/payment-accounts/${provider}/refresh`, {
      method: "POST",
    }),
  disconnectPaymentAccount: (businessId: string, provider: "stripe" | "razorpay" | "paytm") =>
    apiData<{ account: PaymentAccount }>(`/businesses/${businessId}/payment-accounts/${provider}/disconnect`, {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    }),
  administrationOverview: (businessId: string) => apiRequest<AdministrationOverview>(`/businesses/${businessId}/administration/overview`),
  administrationLocations: (businessId: string, search = "") => apiRequest<{ locations: BusinessLocation[] }>(`/businesses/${businessId}/administration/locations${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  createAdministrationLocation: (businessId: string, payload: Partial<BusinessLocation>) => apiData<BusinessLocation>(`/businesses/${businessId}/administration/locations`, { method: "POST", body: JSON.stringify(payload) }),
  updateAdministrationLocation: (businessId: string, locationId: string, payload: Partial<BusinessLocation> & { use_business_defaults?: boolean }) => apiData<BusinessLocation>(`/businesses/${businessId}/administration/locations/${locationId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deactivateAdministrationLocation: (businessId: string, locationId: string) => apiData<BusinessLocation>(`/businesses/${businessId}/administration/locations/${locationId}/deactivate`, { method: "POST" }),
  deleteAdministrationLocation: (businessId: string, locationId: string) => apiRequest(`/businesses/${businessId}/administration/locations/${locationId}`, { method: "DELETE" }),
  administrationActivity: (businessId: string, search = "", offset = 0) => apiRequest<{ events: AdministrationActivity[]; has_more: boolean }>(`/businesses/${businessId}/administration/activity-log?limit=50&offset=${offset}${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  paymentLocationAssignments: (businessId: string) => apiRequest<{ assignments: Array<Record<string, unknown>> }>(`/businesses/${businessId}/administration/payment-location-assignments`),
  savePaymentLocationAssignment: (businessId: string, locationId: string, payload: Record<string, unknown>) => apiData<Record<string, unknown>>(`/businesses/${businessId}/administration/locations/${locationId}/payment-assignment`, { method: "PUT", body: JSON.stringify(payload) }),
  administrationInvitations: (businessId: string) => apiRequest<{ invitations: Array<Record<string, unknown>> }>(`/businesses/${businessId}/administration/invitations`),
  createAdministrationInvitation: (businessId: string, payload: Record<string, unknown>) => apiData<Record<string, unknown>>(`/businesses/${businessId}/administration/invitations`, { method: "POST", body: JSON.stringify(payload) }),
  revokeAdministrationInvitation: (businessId: string, invitationId: string) => apiRequest(`/businesses/${businessId}/administration/invitations/${invitationId}/revoke`, { method: "POST" }),
  resendAdministrationInvitation: (businessId: string, invitationId: string) => apiData<Record<string, unknown>>(`/businesses/${businessId}/administration/invitations/${invitationId}/resend`, { method: "POST" }),
  acceptAdministrationInvitation: (businessId: string, payload: Record<string, unknown>) => apiData<Record<string, unknown>>(`/businesses/${businessId}/administration/invitations/accept`, { method: "POST", body: JSON.stringify(payload) }),
  customRoles: (businessId: string) => apiRequest<{ roles: Array<Record<string, unknown>> }>(`/businesses/${businessId}/administration/custom-roles`),
  createCustomRole: (businessId: string, payload: Record<string, unknown>) => apiData<Record<string, unknown>>(`/businesses/${businessId}/administration/custom-roles`, { method: "POST", body: JSON.stringify(payload) }),
  assignCustomRole: (businessId: string, staffId: string, payload: Record<string, unknown>) => apiData<Record<string, unknown>>(`/businesses/${businessId}/administration/staff/${staffId}/custom-role`, { method: "POST", body: JSON.stringify(payload) }),
  securityPolicy: (businessId: string) => apiRequest<Record<string, unknown>>(`/businesses/${businessId}/administration/security-policy`),
  updateSecurityPolicy: (businessId: string, payload: Record<string, unknown>) => apiData<Record<string, unknown>>(`/businesses/${businessId}/administration/security-policy`, { method: "PUT", body: JSON.stringify(payload) }),
  administrationSessions: (businessId: string) => apiRequest<{ sessions: Array<Record<string, unknown>> }>(`/businesses/${businessId}/administration/sessions`),
  revokeAdministrationSession: (businessId: string, sessionId: string) => apiRequest(`/businesses/${businessId}/administration/sessions/${sessionId}/revoke`, { method: "POST" }),
  revokeOtherAdministrationSessions: (businessId: string) => apiRequest(`/businesses/${businessId}/administration/sessions/revoke-others`, { method: "POST" }),
  integrations: (businessId: string) => apiRequest<{ integrations: Array<Record<string, unknown>> }>(`/businesses/${businessId}/administration/integrations`),
  createIntegration: (businessId: string, payload: Record<string, unknown>) => apiData<Record<string, unknown>>(`/businesses/${businessId}/administration/integrations`, { method: "POST", body: JSON.stringify(payload) }),
  integrationApiKeys: (businessId: string) => apiRequest<{ api_keys: Array<Record<string, unknown>> }>(`/businesses/${businessId}/administration/api-keys`),
  createIntegrationApiKey: (businessId: string, payload: Record<string, unknown>) => apiData<Record<string, unknown>>(`/businesses/${businessId}/administration/api-keys`, { method: "POST", body: JSON.stringify(payload) }),
  rotateIntegrationApiKey: (businessId: string, keyId: string) => apiData<Record<string, unknown>>(`/businesses/${businessId}/administration/api-keys/${keyId}/rotate`, { method: "POST" }),
  revokeIntegrationApiKey: (businessId: string, keyId: string) => apiRequest(`/businesses/${businessId}/administration/api-keys/${keyId}/revoke`, { method: "POST" }),
  integrationWebhooks: (businessId: string) => apiRequest<{ webhooks: Array<Record<string, unknown>> }>(`/businesses/${businessId}/administration/webhooks`),
  createIntegrationWebhook: (businessId: string, payload: Record<string, unknown>) => apiData<Record<string, unknown>>(`/businesses/${businessId}/administration/webhooks`, { method: "POST", body: JSON.stringify(payload) }),
  enableIntegrationWebhook: (businessId: string, webhookId: string) => apiData<Record<string, unknown>>(`/businesses/${businessId}/administration/webhooks/${webhookId}/enable`, { method: "POST" }),
  disableIntegrationWebhook: (businessId: string, webhookId: string) => apiData<Record<string, unknown>>(`/businesses/${businessId}/administration/webhooks/${webhookId}/disable`, { method: "POST" }),
  deleteIntegrationWebhook: (businessId: string, webhookId: string) => apiRequest(`/businesses/${businessId}/administration/webhooks/${webhookId}`, { method: "DELETE" }),
  webhookDeliveries: (businessId: string, webhookId: string) => apiRequest<{ deliveries: Array<Record<string, unknown>> }>(`/businesses/${businessId}/administration/webhooks/${webhookId}/deliveries`),
  retryWebhookDelivery: (businessId: string, webhookId: string, deliveryId: string) => apiData<Record<string, unknown>>(`/businesses/${businessId}/administration/webhooks/${webhookId}/deliveries/${deliveryId}/retry`, { method: "POST" }),
  integrationActivity: (businessId: string) => apiRequest<{ events: Array<Record<string, unknown>> }>(`/businesses/${businessId}/administration/integration-activity`),
  markCounterPaymentPaid: (paymentId: string, businessId: string, payload?: { amount?: number; method?: string }) =>
    apiData<PaymentRecord>(`/payments/${paymentId}/counter-paid`, {
      method: "PATCH",
      body: JSON.stringify({ business_id: businessId, ...payload }),
    }),
  completeCounterOrder: (orderId: string, businessId: string) =>
    apiData<Order>(`/orders/${orderId}/counter-complete`, {
      method: "PATCH",
      body: JSON.stringify({ business_id: businessId }),
    }),
  devices: (businessId: string) =>
    apiRequest<{ devices: DeviceRecord[] }>(`/businesses/${businessId}/devices`),
  devicePairingRequests: (businessId: string) =>
    apiRequest<{ requests: DevicePairingRequest[] }>(`/businesses/${businessId}/device-pairing-requests`),
  createDeviceActivationCode: (
    businessId: string,
    payload: { device_type: string; device_name?: string; location_label?: string; expires_in_minutes?: number; metadata?: Record<string, unknown> }
  ) =>
    apiData<DevicePairingRequest>(`/businesses/${businessId}/device-activation-codes`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  approveDevicePairingRequest: (businessId: string, requestId: string, payload: { device_name?: string; location_label?: string } = {}) =>
    apiData<DevicePairingRequest>(`/businesses/${businessId}/device-pairing-requests/${requestId}/approve`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  rejectDevicePairingRequest: (businessId: string, requestId: string) =>
    apiData<DevicePairingRequest>(`/businesses/${businessId}/device-pairing-requests/${requestId}/reject`, { method: "POST" }),
  createDevice: (businessId: string, payload: { name: string; device_id?: string; device_type?: string; assigned_kiosk_slug?: string; location_label?: string; metadata?: Record<string, unknown> }) =>
    apiData<DeviceRecord>(`/businesses/${businessId}/devices`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateDevice: (businessId: string, deviceId: string, payload: { name?: string; device_type?: string; location_label?: string; is_active?: boolean; metadata?: Record<string, unknown> }) =>
    apiData<DeviceRecord>(`/businesses/${businessId}/devices/${deviceId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  regenerateDeviceLink: (businessId: string, deviceId: string) =>
    apiData<DeviceRecord>(`/businesses/${businessId}/devices/${deviceId}/regenerate-link`, { method: "POST" }),
  disableDevice: (businessId: string, deviceId: string) =>
    apiData<DeviceRecord>(`/businesses/${businessId}/devices/${deviceId}/disable`, { method: "POST" }),
  deleteDevice: (businessId: string, deviceId: string) =>
    apiRequest(`/businesses/${businessId}/devices/${deviceId}`, { method: "DELETE" }),
  requestDevicePairing: (payload: { business_slug: string; device_type: string; device_name?: string; location_label?: string; app_version?: string; user_agent?: string; metadata?: Record<string, unknown> }) =>
    apiData<DevicePairingRequest>("/devices/pairing/request", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    }),
  devicePairingStatus: (pairingCode: string, pollingSecret?: string) => {
    const query = pollingSecret ? `?polling_secret=${encodeURIComponent(pollingSecret)}` : "";
    return apiRequest<DevicePairingRequest>(`/devices/pairing/${encodeURIComponent(pairingCode)}${query}`, { auth: false });
  },
  claimDevicePairing: (
    pairingCode: string,
    payload: { polling_secret?: string; app_version?: string; user_agent?: string; metadata?: Record<string, unknown> } = {}
  ) =>
    apiData<DeviceSession>(`/devices/pairing/${encodeURIComponent(pairingCode)}/claim`, {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    }),
  activateDevice: (payload: { activation_code: string; device_name?: string; location_label?: string; app_version?: string; user_agent?: string; metadata?: Record<string, unknown> }) =>
    apiData<DeviceSession>("/devices/activate", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    }),
  exchangeLiveDeviceToken: (deviceToken: string, expectedType?: "kiosk" | "kitchen" | "counter") =>
    apiData<LiveDeviceContext>(`/devices/live/${encodeURIComponent(deviceToken)}/session`, {
      method: "POST",
      auth: false,
      body: JSON.stringify({ expected_type: expectedType }),
    }),
  liveDeviceSessionContext: (expectedType?: "kiosk" | "kitchen" | "counter") => {
    const query = expectedType ? `?expected_type=${encodeURIComponent(expectedType)}` : "";
    return apiRequest<LiveDeviceContext>(`/devices/live/session${query}`, { auth: false });
  },
  clearLiveDeviceSession: () =>
    apiRequest("/devices/live/session", {
      method: "DELETE",
      auth: false,
    }),
  liveDeviceSessionHeartbeat: (payload: { app_version?: string; user_agent?: string; current_route?: string; last_error?: string; metadata?: Record<string, unknown> }) =>
    apiData<DeviceRecord>("/devices/live/session/heartbeat", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    }),
  liveCounterSessionPayments: () =>
    apiRequest<{ business: LiveDeviceContext["business"]; device: DeviceRecord; payments: PaymentRecord[] }>("/counter/live/session/payments", { auth: false }),
  liveCounterSessionMarkPaid: (paymentId: string, payload: { business_id: string; amount?: number; method?: string }) =>
    apiData<PaymentRecord>(`/counter/live/session/payments/${paymentId}/counter-paid`, {
      method: "PATCH",
      auth: false,
      body: JSON.stringify(payload),
    }),
  liveCounterSessionCompleteOrder: (orderId: string, payload: { business_id: string }) =>
    apiData<Order>(`/counter/live/session/orders/${orderId}/complete`, {
      method: "PATCH",
      auth: false,
      body: JSON.stringify(payload),
    }),
  liveCounterSessionMenu: () => apiRequest<KioskMenu & { device: DeviceRecord }>("/counter/live/session/menu", { auth: false }),
  liveCounterPendingPayments: () => apiRequest<{ payments: PaymentRecord[] }>("/counter/live/session/pending-payments", { auth: false }),
  liveCounterClaimPayment: (paymentId: string) => apiData<Record<string, unknown>>(`/counter/live/session/payments/${paymentId}/claim`, { method: "POST", auth: false }),
  liveCounterReleasePayment: (paymentId: string) => apiData<Record<string, unknown>>(`/counter/live/session/payments/${paymentId}/release`, { method: "POST", auth: false }),
  liveCounterOverride: (payload: { action: "cancel_pending_payment"; reason: string; pin: string }) => apiData<{ override_token: string; expires_at: string }>("/counter/live/session/overrides", { method: "POST", auth: false, body: JSON.stringify(payload) }),
  liveCounterCancelPendingPayment: (paymentId: string, payload: { override_token: string; reason: string }) => apiData<Record<string, unknown>>(`/counter/live/session/payments/${paymentId}/cancel`, { method: "POST", auth: false, body: JSON.stringify(payload) }),
  liveCounterSessionCreateOrder: (payload: Record<string, unknown>, idempotencyKey: string) => apiData<Order>("/counter/live/session/orders", { method: "POST", auth: false, headers: { "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify(payload) }),
  liveCounterKitchenOrders: (status = "active") => apiRequest<{ business: Business; device: DeviceRecord; orders: Order[] }>(`/counter/live/session/kitchen-orders?status=${encodeURIComponent(status)}`, { auth: false }),
  liveCounterHandoverHistory: () => apiRequest<{ business: Business; device: DeviceRecord; orders: Order[] }>("/counter/live/session/handover-history", { auth: false }),
  liveCounterHeldOrders: () => apiRequest<{ held_orders: Array<Record<string, unknown>> }>("/counter/live/session/held-orders", { auth: false }),
  liveCounterHoldOrder: (payload: Record<string, unknown>, reference?: string) => apiData<Record<string, unknown>>(`/counter/live/session/held-orders${reference ? `?reference=${encodeURIComponent(reference)}` : ""}`, { method: "POST", auth: false, body: JSON.stringify(payload) }),
  liveCounterResumeHeldOrder: (heldId: string) => apiData<Record<string, unknown>>(`/counter/live/session/held-orders/${heldId}/resume`, { method: "POST", auth: false }),
  liveCounterCancelHeldOrder: (heldId: string) => apiRequest(`/counter/live/session/held-orders/${heldId}`, { method: "DELETE", auth: false }),
  liveKitchenSessionOrders: (status = "active") =>
    apiRequest<{ business: LiveDeviceContext["business"]; device: DeviceRecord; orders: Order[] }>(`/kitchen/live/session/orders?status=${encodeURIComponent(status)}`, { auth: false }),
  liveKitchenSessionUpdateOrderStatus: (orderId: string, payload: { business_id: string; status: OrderStatus; cancel_reason?: string }) =>
    apiData<Order>(`/kitchen/live/session/orders/${orderId}/status`, {
      method: "PATCH",
      auth: false,
      body: JSON.stringify(payload),
    }),
  liveKitchenBoard: () => apiRequest<{ business: Business; device: DeviceRecord; orders: Order[] }>("/kitchen/live/session/board", { auth: false }),
  liveKitchenCompleted: () => apiRequest<{ business: Business; device: DeviceRecord; orders: Order[] }>("/kitchen/live/session/completed", { auth: false }),
  liveKitchenStart: (orderId: string, payload: { event_id: string }) => apiData<Order>(`/kitchen/live/session/orders/${orderId}/start`, { method: "POST", auth: false, body: JSON.stringify(payload) }),
  liveKitchenHold: (orderId: string, payload: { event_id: string; reason: string }) => apiData<Order>(`/kitchen/live/session/orders/${orderId}/hold`, { method: "POST", auth: false, body: JSON.stringify(payload) }),
  liveKitchenResume: (orderId: string, payload: { event_id: string }) => apiData<Order>(`/kitchen/live/session/orders/${orderId}/resume`, { method: "POST", auth: false, body: JSON.stringify(payload) }),
  liveKitchenReady: (orderId: string, payload: { event_id: string; reason?: string; override_token?: string }) => apiData<Order>(`/kitchen/live/session/orders/${orderId}/ready`, { method: "POST", auth: false, body: JSON.stringify(payload) }),
  liveKitchenRecall: (orderId: string, payload: { event_id: string; reason: string; override_token: string }) => apiData<Order>(`/kitchen/live/session/orders/${orderId}/recall`, { method: "POST", auth: false, body: JSON.stringify(payload) }),
  liveKitchenItem: (orderId: string, itemId: string, payload: { event_id: string; completed_quantity: number }) => apiData<Order>(`/kitchen/live/session/orders/${orderId}/items/${itemId}`, { method: "PATCH", auth: false, body: JSON.stringify(payload) }),
  liveKitchenAllDay: () => apiRequest<{ items: Array<Record<string, unknown>> }>("/kitchen/live/session/all-day", { auth: false }),
  liveKitchenAvailability: () => apiRequest<{ products: Product[] }>("/kitchen/live/session/availability", { auth: false }),
  liveKitchenSetAvailability: (productId: string, payload: { event_id: string; status: "available" | "temporarily_unavailable" | "out_of_stock" }) => apiData<Product>(`/kitchen/live/session/availability/${productId}`, { method: "PATCH", auth: false, body: JSON.stringify(payload) }),
  liveKitchenOverride: (payload: { action: "ready_incomplete" | "recall"; reason: string; pin: string }) => apiData<{ override_token: string }>("/kitchen/live/session/overrides", { method: "POST", auth: false, body: JSON.stringify(payload) }),
  liveKitchenPreferences: () => apiRequest<{ sound_enabled: boolean; sound_volume: number }>("/kitchen/live/session/preferences", { auth: false }),
  liveKitchenSetPreferences: (payload: { sound_enabled?: boolean; sound_volume?: number }) => apiData<{ sound_enabled: boolean; sound_volume: number }>("/kitchen/live/session/preferences", { method: "PATCH", auth: false, body: JSON.stringify(payload) }),
  alerts: (businessId: string) =>
    apiRequest<{ alerts: AlertRecord[]; summary: AlertSummary }>(`/businesses/${businessId}/alerts`),
  alertSummary: (businessId: string) =>
    apiRequest<AlertSummary>(`/businesses/${businessId}/alerts/summary`),
  updateAlert: (alertId: string, businessId: string, status: AlertRecord["status"]) =>
    apiData<AlertRecord>(`/alerts/${alertId}`, {
      method: "PATCH",
      body: JSON.stringify({ business_id: businessId, status }),
    }),
  kioskMenu: (slug: string, locationId?: string | null) =>
    apiRequest<KioskMenu>(`/kiosk/${slug}/menu${locationId ? `?location_id=${encodeURIComponent(locationId)}` : ""}`, { auth: false }),
  liveKioskSessionMenu: () =>
    apiRequest<KioskMenu>("/kiosk/live/session/menu", { auth: false }),
  kioskHeartbeat: (slug: string, payload: { device_id: string; name?: string; device_type?: string; metadata?: Record<string, unknown> }) =>
    apiData<DeviceRecord>(`/kiosk/${slug}/device-heartbeat`, {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    }),
  liveKioskSessionHeartbeat: (payload: { app_version?: string; user_agent?: string; current_route?: string; last_error?: string; metadata?: Record<string, unknown> }) =>
    apiData<DeviceRecord>("/kiosk/live/session/heartbeat", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    }),
  verifyOwnerPin: (slug: string, pin: string) =>
    apiRequest<{ ok: boolean }>(`/kiosk/${slug}/owner-pin/verify`, {
      method: "POST",
      auth: false,
      body: JSON.stringify({ pin }),
    }),
  verifyLiveSessionOwnerPin: (pin: string) =>
    apiRequest<{ ok: boolean; device_id?: string; unlock_expires_in_seconds?: number }>("/kiosk/live/session/owner-pin/verify", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ pin }),
    }),
  createPaytmDynamicQr: (businessId: string, paymentId: string, paymentToken: string) =>
    apiData<{
      id: string;
      order_id?: string | null;
      provider?: string | null;
      status: string;
      amount: number;
      currency: string;
      payment_method?: string | null;
      provider_order_id?: string | null;
      qr?: { qr_data?: string; amount?: string; reference_id?: string; expires_at?: string | null } | null;
    }>(`/payments/paytm/dynamic-qr/create`, {
      method: "POST",
      auth: false,
      body: JSON.stringify({ business_id: businessId, payment_id: paymentId, payment_token: paymentToken }),
    }),
  paymentStatus: (paymentId: string, paymentToken: string) =>
    apiRequest<{
      id: string;
      order_id?: string | null;
      provider?: string | null;
      status: string;
      amount: number;
      currency: string;
      payment_method?: string | null;
      provider_order_id?: string | null;
      qr?: { qr_data?: string; amount?: string; reference_id?: string; expires_at?: string | null } | null;
    }>(`/payments/${paymentId}/status`, {
      method: "POST",
      auth: false,
      body: JSON.stringify({ payment_token: paymentToken }),
    }),
  placeKioskOrder: (
    slug: string,
    payload: {
      order_type: string;
      table_label?: string;
      customer_name?: string;
      customer_phone?: string;
      notes?: string;
      payment_method?: string;
      items: { product_id: string; quantity: number; notes?: string; customizations?: unknown[] }[];
    }
  ) =>
    apiData<Order>(`/kiosk/${slug}/orders`, {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    }),
  placeLiveKioskSessionOrder: (
    payload: {
      order_type: string;
      table_label?: string;
      customer_name?: string;
      customer_phone?: string;
      notes?: string;
      payment_method?: string;
      items: { product_id: string; quantity: number; notes?: string; customizations?: unknown[] }[];
    }
  ) =>
    apiData<Order>("/kiosk/live/session/orders", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    }),
};

async function uploadFile(businessId: string, file: File, kind: "product-image" | "brand-asset") {
  const form = new FormData();
  form.append("file", file);
  return apiData<{ bucket: string; path: string; public_url: string }>(
    `/businesses/${businessId}/uploads/${kind}`,
    {
      method: "POST",
      body: form,
    }
  );
}

export function money(value: number | string | null | undefined, symbol = "Rs") {
  return formatCurrency(Number(value ?? 0), symbol);
}

function apiDate(value: string, endOfDay: boolean) {
  return value.includes("T") ? value : `${value}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
}

export function assetUrl(path?: string | null) {
  if (!path) return null;
  if (path.startsWith("blob:") || path.startsWith("data:")) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (path.startsWith("/menutap-images/")) return path;
  if (path.startsWith("/onboarding-menu/")) return path;
  if (path.startsWith("menutap-images/")) return `/${path}`;
  if (path.startsWith("onboarding-menu/")) return `/${path}`;
  const apiRoot = API_BASE.replace(/\/api\/?$/, "");
  if (path.startsWith("/uploads/")) return `${apiRoot}${path}`;
  if (path.startsWith("uploads/")) return `${apiRoot}/${path}`;
  return `${apiRoot}/uploads/${path.replace(/^\/+/, "")}`;
}

import { formatCurrency } from "@/lib/formatters";
