import type { AuthSession, BusinessLocation, OnboardingStatus } from "@/lib/types";
import { apiRequest as request } from "@/lib/api";

export type KioskLayoutId = "side-navigation" | "top-navigation" | "category-first";

export type WelcomeScreenConfiguration = {
  enabled: boolean;
  heading: string;
  supporting_text: string;
  instruction_text: string;
  start_button_text: string;
  text_position: "top" | "middle" | "bottom";
  touch_anywhere_to_start: boolean;
  show_business_logo: boolean;
};

export type Business = {
  id: string;
  name: string;
  slug: string;
  type: string;
  business_subtype?: string | null;
  tagline?: string | null;
  contact_phone?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  timezone?: string | null;
  currency_code?: string | null;
  logo_path?: string | null;
  brand_color: string;
  kiosk_layout_id: KioskLayoutId;
  kiosk_screen_orientation?: "landscape" | "portrait";
  welcome_screen: WelcomeScreenConfiguration;
  tax_percent: number;
  currency_symbol: string;
  order_modes: string[];
  idle_timeout_seconds: number;
  order_reset_seconds: number;
  kiosk_order_settings?: {
    require_customer_name?: boolean;
    require_customer_phone?: boolean;
    checkout_enabled?: boolean;
    default_payment_method?: string;
  };
  payment_summary?: { enabled_methods?: string[]; default_payment_method?: string | null };
  onboarding_step?: number;
  onboarding_completed?: boolean;
};

export type Category = { id: string; name: string; is_active: boolean; sort_order: number };
export type Product = {
  id: string;
  category_id: string | null;
  name: string;
  description?: string | null;
  price: number;
  is_available: boolean;
  menu_status: string;
  sort_order: number;
  image_path?: string | null;
  food_type?: "veg" | "non-veg";
  is_experience_preset?: boolean;
};
export type Order = {
  id: string;
  order_number?: number | null;
  public_token?: string | null;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status?: string;
  order_type?: string;
  created_at?: string;
};

export type SetupOverview = {
  setup: { revision: number };
  status: {
    businessComplete: boolean;
    menuComplete: boolean;
    kioskSettingsComplete: boolean;
    welcomeScreenComplete: boolean;
    previewComplete: boolean;
    successfulTestComplete: boolean;
    publishable: boolean;
    published: boolean;
  };
  requirements: { key: string; label: string; complete: boolean; href: string }[];
  unpublishedChanges: number;
};

type Envelope<T> = { status?: string; data?: T; message?: string };
export type RequestOptions = RequestInit & { timeoutMs?: number };

async function data<T>(path: string, options?: RequestOptions): Promise<T> {
  const response = await request<Envelope<T>>(path, options);
  if (response.data === undefined) throw new Error(response.message || "The server returned no data.");
  return response.data;
}

type SessionUser = { id: string; email: string; full_name?: string | null };

export const api = {
  login: (email: string, password: string) =>
    request<{ user: SessionUser }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  startGoogleOAuth: () =>
    request<{ authorization_url: string }>("/auth/oauth/google/start"),
  exchangeGoogleOAuth: (code: string) =>
    request<AuthSession>("/auth/oauth/google/exchange", { method: "POST", body: JSON.stringify({ code }) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  signup: (email: string, password: string) =>
    request<{ requires_verification: boolean; email: string; message: string; dev_otp?: string | null }>("/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) }),
  startSignup: (email: string) =>
    request<{ requires_verification: boolean; email: string; message: string; dev_otp?: string | null }>("/auth/signup/start", { method: "POST", body: JSON.stringify({ email }) }),
  acceptSignupLink: (access_token: string, refresh_token: string) =>
    request<{ email: string; message: string }>("/auth/signup/accept", { method: "POST", body: JSON.stringify({ access_token, refresh_token }) }),
  verifySignup: (email: string, code: string) =>
    request<{ email: string; message: string }>("/auth/signup/verify", { method: "POST", body: JSON.stringify({ email, code }) }),
  completeSignup: (password: string) =>
    request<{ user: SessionUser }>("/auth/signup/complete", { method: "POST", body: JSON.stringify({ password }) }),
  verifyEmail: (email: string, code: string) =>
    request<{ user: SessionUser }>("/auth/verify-email", { method: "POST", body: JSON.stringify({ email, code }) }),
  resendVerification: (email: string) =>
    request<{ requires_verification: boolean; email: string; message: string; dev_otp?: string | null }>("/auth/resend-verification", { method: "POST", body: JSON.stringify({ email }) }),
  forgotPassword: (email: string) =>
    request<{ message: string; reset_url?: string | null }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    data("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) }),
  onboardingStatus: () =>
    request<OnboardingStatus>("/onboarding/status"),
  onboardingBusinessType: (options?: RequestOptions) => request<{ business_type: string | null; business_description: string | null }>("/onboarding/business-type", options),
  saveOnboardingBusinessType: (businessType: string, businessDescription?: string, options?: RequestOptions) =>
    request<{ business_type: string; business_description: string | null }>("/onboarding/business-type", { ...options, method: "PUT", body: JSON.stringify({ business_type: businessType, business_description: businessDescription || null }) }),
  myBusiness: () => request<{ business: Business | null }>("/businesses/me"),
  locations: (businessId: string) => request<{ locations: BusinessLocation[] }>(`/businesses/${businessId}/administration/locations`),
  createBusiness: (payload: Record<string, unknown>) => data<Business>("/businesses", { method: "POST", body: JSON.stringify(payload) }),
  updateBusiness: (id: string, payload: Record<string, unknown>) => data<Business>(`/businesses/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  categories: (businessId: string) => request<{ categories: Category[] }>(`/businesses/${businessId}/categories`),
  products: (businessId: string) => request<{ products: Product[] }>(`/businesses/${businessId}/products`),
  createCategory: (businessId: string, name: string) => data<Category>(`/businesses/${businessId}/categories`, { method: "POST", body: JSON.stringify({ name }) }),
  createProduct: (businessId: string, payload: Record<string, unknown>) => data<Product>(`/businesses/${businessId}/products`, { method: "POST", body: JSON.stringify(payload) }),
  uploadBrandAsset: async (businessId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return data<{ path: string }>(`/businesses/${businessId}/uploads/brand-asset`, { method: "POST", body: form, timeoutMs: 60000 });
  },
  setup: (businessId: string) => request<SetupOverview>(`/businesses/${businessId}/setup`),
  testSession: (businessId: string) => request<{ session: { id: string; business_id: string; expires_at: string; created_at?: string; last_used_at?: string | null } | null }>(`/businesses/${businessId}/setup/test-sessions`),
  createTestSession: (businessId: string) => request<{ session: { id: string; business_id: string; expires_at: string; token: string; business_slug: string } }>(`/businesses/${businessId}/setup/test-sessions`, { method: "POST" }),
  resetTestSession: (businessId: string) => request<{ session: { id: string; business_id: string; expires_at: string; token: string; business_slug: string } }>(`/businesses/${businessId}/setup/test-sessions/reset`, { method: "POST" }),
  endTestSession: (businessId: string) => request(`/businesses/${businessId}/setup/test-sessions`, { method: "DELETE" }),
  previewAttestation: (businessId: string) => request(`/businesses/${businessId}/setup/preview-attestations`, { method: "POST", body: JSON.stringify({ event_version: 1 }) }),
  publish: (businessId: string, revision: number) => request(`/businesses/${businessId}/setup/publish`, { method: "POST", body: JSON.stringify({ expected_revision: revision, allow_untested: false }) }),
  orders: (businessId: string, limit = 20) => request<{ orders: Order[] }>(`/businesses/${businessId}/orders?limit=${limit}`),
};
