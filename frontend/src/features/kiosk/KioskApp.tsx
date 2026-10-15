"use client";

// Purpose: Public customer kiosk experience, including start screen, menu, modifiers, cart, and checkout.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Gift,
  Grid2X2,
  Loader2,
  LockKeyhole,
  Minus,
  Pencil,
  Phone,
  Pizza,
  Plus,
  QrCode,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Star,
  Store,
  Trash2,
  Utensils,
  User,
  X,
} from "lucide-react";
import { BusinessLogo } from "@/app/_components/business-logo";
import { KioskCategoryCarousel, type KioskCategoryCarouselItem } from "@/app/_components/kiosk-category-carousel";
import {
  KioskProductCard,
  type KioskCarouselItem,
} from "@/app/_components/kiosk-product-carousel";
import { api, assetUrl, money } from "@/lib/api";
import { useAutoReconnect } from "@/lib/connectivity";
import { loadDraftKioskMenu, loadRealKioskMenu } from "@/features/kiosk-real/realKioskData";
import { placeRealKioskOrder } from "@/features/kiosk-real/realOrderService";
import { businessCapabilitiesFor, capabilityHasAnyFilter, capabilityHasFilter, type BusinessCapability } from "@/lib/business-capabilities";
import { normalizeKioskScreenOrientation, normalizeKioskTemplateId, parseKioskThemeSelection } from "@/lib/constants";
import {
  effectiveKioskCardStyle,
  kioskBusinessConfig,
  resolveKioskDisplaySettings,
  type KioskCardStyle,
  type KioskCategoryStyle,
  type KioskLayoutId,
  type KioskProductDisplayStyle,
} from "@/lib/kiosk/kiosk-business-config";
import { kioskAccentStyle } from "@/lib/kiosk/kiosk-accent";
import {
  mapProductToKioskCarouselItem,
} from "@/lib/kiosk/kiosk-mappers";
import { kioskStartCopy } from "@/lib/kiosk/start-screen-copy";
import { fallbackProductImage } from "@/lib/product-media";
import { discountBadge, effectivePrice } from "@/lib/product-utils";
import { getStoreAvailability } from "@/lib/store-schedule";
import type { Business, BusinessType, Category, KioskScreenOrientation, ModifierOption, Order, OrderType, Product } from "@/lib/types";
import { TypewriterText } from "@/components/ui/typewriter";
import { testOrder } from "@/features/test-runtime";

type CartItem = {
  id: string;
  product: Product;
  quantity: number;
  note: string;
  selectedOptions: SelectedOption[];
};

type StoredCartItem = {
  productId: string;
  quantity: number;
  note: string;
  selectedOptions: SelectedOption[];
};

type SelectedOption = {
  group_id: string;
  group_name: string;
  option_id: string;
  name: string;
  price_delta: number;
};

type PaymentMethod = "pay_at_counter" | "cash" | "upi" | "card" | "stripe" | "razorpay" | "paytm";
type KioskPageState =
  | "start"
  | "menu"
  | "category"
  | "deals"
  | "cart"
  | "payment"
  | "paytm_payment"
  | "order_confirmed";

type CategoryTab = {
  id: string;
  label: string;
  icon: ReactNode;
  imageUrl?: string;
};

type KioskFilters = {
  veg: boolean;
  nonVeg: boolean;
  egg: boolean;
  vegan: boolean;
  spicy: boolean;
  popular: boolean;
  new: boolean;
  bestseller: boolean;
  recommended: boolean;
  hot: boolean;
  iced: boolean;
  milkBased: boolean;
  nonCoffee: boolean;
  priceSort: "none" | "low_high" | "high_low";
  deals: boolean;
  combos: boolean;
  discounted: boolean;
  available: boolean;
};

const DEFAULT_KIOSK_FILTERS: KioskFilters = {
  veg: false,
  nonVeg: false,
  egg: false,
  vegan: false,
  spicy: false,
  popular: false,
  new: false,
  bestseller: false,
  recommended: false,
  hot: false,
  iced: false,
  milkBased: false,
  nonCoffee: false,
  priceSort: "none",
  deals: false,
  combos: false,
  discounted: false,
  available: false,
};

const QUICK_NOTES: Record<BusinessType, string[]> = {
  restaurant: ["Less Spicy", "Medium Spicy", "Extra Spicy", "Less Oil", "No Onion", "No Garlic", "Extra Gravy", "Dry Preparation", "Serve Hot", "Extra Portion"],
  cafe: ["Extra Hot", "Less Sugar", "No Sugar", "Extra Sugar", "Less Ice", "Extra Ice", "Extra Shot", "Decaf", "Extra Cream", "Take Away"],
  retail: ["Gift Wrap", "Remove Price Tag", "Separate Packing", "Eco-Friendly Bag", "Premium Packaging", "Fragile Item", "Urgent Packing", "Include Gift Message"],
  bakery: ["Warm It Up", "Fresh Cream Extra", "Less Cream", "Extra Chocolate", "Extra Toppings", "Birthday Message", "Anniversary Message", "Slice the Cake", "Add Candles", "Add Knife", "Pack Carefully", "Ready to Serve"],
  pizza: ["Less Spicy", "Medium Spicy", "Extra Spicy", "Less Oil", "Extra Gravy", "No Onion", "No Garlic"],
  burger: ["Extra Patty", "Double Patty", "Extra Cheese", "No Cheese", "No Onion", "No Pickles", "Extra Sauce", "Less Sauce", "Well Toasted", "Extra Crispy", "No Mayo", "Spicy Mayo"],
  grocery: ["Ripe Items Only", "Freshest Available", "Small Size", "Medium Size", "Large Size", "Substitute Similar Item", "No Substitutions", "Separate Fragile Items", "Eco-Friendly Bag", "Fast Delivery Packing"],
  salon: ["Short Length", "Medium Length", "Keep Current Length", "Extra Styling", "Beard Trim", "Clean Shave", "Natural Look", "Premium Products", "Hair Wash Included", "Quick Service"],
  ice_cream: ["Extra Scoop", "Extra Syrup", "Extra Nuts", "Extra Chocolate", "Less Sweet", "No Nuts", "Extra Sprinkles", "Serve Immediately", "Extra Crunch", "Mix Flavors"],
  other: ["Urgent Request", "Handle Carefully", "Premium Service", "Budget Friendly", "Best Recommendation", "Extra Attention", "Gift Packaging", "Contact Before Processing"],
};

function initialKioskPage(business: Business): KioskPageState {
  const selection = parseKioskThemeSelection(business.kiosk_theme);
  const selectedLayout = normalizeKioskTemplateId(selection.templateId);
  return selectedLayout === "category_gate" ? "category" : "menu";
}

export type KioskExperienceData = {
  business: Business;
  categories: Category[];
  products: Product[];
};

type KioskRuntimeProps = {
  routeSlug?: string;
  deviceSession?: boolean;
  operationalMode?: "production" | "preview" | "test";
  sessionId?: string;
  draftBusinessId?: string;
  locationId?: string | null;
  experienceData?: KioskExperienceData;
  contained?: boolean;
  forcedOrientation?: KioskScreenOrientation;
  initialView?: "start" | "menu";
  onKioskEvent?: (event: string, payload?: Record<string, unknown>) => void;
};

export default function KioskPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const requestedMode = searchParams.get("mode");
  const operationalMode = requestedMode === "preview" || requestedMode === "test" ? requestedMode : "production";
  const sessionId = searchParams.get("session") ?? "standalone";
  const draftBusinessId = searchParams.get("business") ?? undefined;
  return <KioskRuntime routeSlug={String(params.id ?? "")} operationalMode={operationalMode} sessionId={sessionId} draftBusinessId={draftBusinessId} locationId={searchParams.get("location")} />;
}

export function KioskRuntime({
  routeSlug = "",
  deviceSession = false,
  operationalMode = "production",
  sessionId = "standalone",
  draftBusinessId,
  locationId,
  experienceData,
  contained = false,
  forcedOrientation,
  initialView = "start",
  onKioskEvent,
}: KioskRuntimeProps) {
  const router = useRouter();
  const slug = routeSlug;
  const usesDeviceSession = Boolean(deviceSession);
  const isLiveDeviceRoute = usesDeviceSession;
  const isTemporaryExperience = Boolean(experienceData);
  const [business, setBusiness] = useState<Business | null>(() => experienceData?.business ?? null);
  const [categories, setCategories] = useState<Category[]>(() => experienceData?.categories ?? []);
  const [products, setProducts] = useState<Product[]>(() => experienceData?.products ?? []);
  const [activeCategory, setActiveCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<KioskFilters>(DEFAULT_KIOSK_FILTERS);
  const [started, setStarted] = useState(() => initialView === "menu" || experienceData?.business.kiosk_start_screen_enabled === false);
  const [activePage, setActivePage] = useState<KioskPageState>(() =>
    initialView === "menu" && experienceData ? initialKioskPage(experienceData.business) : "start"
  );
  useEffect(() => {
    if (!experienceData) return;
    const task = window.setTimeout(() => {
      setBusiness(experienceData.business);
      setCategories(experienceData.categories);
      setProducts(experienceData.products);
    }, 0);
    return () => window.clearTimeout(task);
  }, [experienceData]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [configuringProduct, setConfiguringProduct] = useState<Product | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [orderType, setOrderType] = useState<OrderType>("dine_in");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pay_at_counter");
  const [paytmStatus, setPaytmStatus] = useState<{
    paymentId: string;
    paymentToken: string;
    order: Order;
    qr?: { qr_data?: string; amount?: string; reference_id?: string; expires_at?: string | null } | null;
    status: string;
  } | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [ownerPinOpen, setOwnerPinOpen] = useState(false);
  const [ownerPinMode, setOwnerPinMode] = useState<"exit" | "unlock">("exit");
  const [ownerPin, setOwnerPin] = useState("");
  const [ownerPinError, setOwnerPinError] = useState<string | null>(null);
  const [verifyingOwnerPin, setVerifyingOwnerPin] = useState(false);
  const [successCountdown, setSuccessCountdown] = useState(18);
  const [loading, setLoading] = useState(() => !experienceData);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydratedCartKey, setHydratedCartKey] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<CartItem | null>(null);
  const [viewportOrientation, setViewportOrientation] = useState<KioskScreenOrientation>(forcedOrientation ?? "landscape");
  const idleTimerRef = useRef<number | null>(null);
  const ownerUnlockedUntilRef = useRef(0);

  const emitKioskEvent = useCallback((event: string, payload?: Record<string, unknown>) => {
    onKioskEvent?.(event, payload);
    if (operationalMode === "production" || window.parent === window || !business) return;
    window.parent.postMessage({ source: "menutap-kiosk", version: 1, event, kioskId: slug, businessId: business.id, mode: operationalMode, sessionId, timestamp: new Date().toISOString(), payload }, window.location.origin);
  }, [business, onKioskEvent, operationalMode, sessionId, slug]);

  const kioskStorageKey = isTemporaryExperience ? "" : isLiveDeviceRoute ? "live.device" : operationalMode === "production" ? slug : `${slug}.${operationalMode}.${sessionId}`;
  const cartStorageKey = useMemo(() => (kioskStorageKey ? `menutap.kiosk.cart.${kioskStorageKey}` : ""), [kioskStorageKey]);
  const cartHydrated = isTemporaryExperience || hydratedCartKey === cartStorageKey;

  useEffect(() => {
    if (forcedOrientation) return;
    const updateViewportOrientation = () => {
      setViewportOrientation(window.innerHeight > window.innerWidth ? "portrait" : "landscape");
    };
    updateViewportOrientation();
    window.addEventListener("resize", updateViewportOrientation);
    window.addEventListener("orientationchange", updateViewportOrientation);
    return () => {
      window.removeEventListener("resize", updateViewportOrientation);
      window.removeEventListener("orientationchange", updateViewportOrientation);
    };
  }, [forcedOrientation]);

  const loadKiosk = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const menu = experienceData
        ? experienceData
        : operationalMode !== "production" && draftBusinessId
        ? await loadDraftKioskMenu(draftBusinessId, locationId)
        : operationalMode === "test" ? await api.testKioskSessionMenu()
        : isLiveDeviceRoute ? await api.liveKioskSessionMenu() : await loadRealKioskMenu(slug, locationId);
      setBusiness(menu.business);
      setCategories(menu.categories);
      setProducts(menu.products);
      const modes = businessCapabilitiesFor(menu.business).allowedOrderModes;
      setOrderType((current) => (modes.includes(current) ? current : modes[0]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load kiosk.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [draftBusinessId, experienceData, isLiveDeviceRoute, locationId, operationalMode, slug]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadKiosk();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadKiosk]);

  useEffect(() => {
    if (business && cartHydrated) emitKioskEvent("kiosk-ready");
  }, [business, cartHydrated, emitKioskEvent, operationalMode]);

  useEffect(() => {
    const retryAfterReconnect = () => {
      if (!error || cart.length > 0 || activePage === "payment" || placing) return;
      void loadKiosk(true);
    };
    window.addEventListener("online", retryAfterReconnect);
    return () => window.removeEventListener("online", retryAfterReconnect);
  }, [activePage, cart.length, error, loadKiosk, placing]);

  useEffect(() => {
    if (!business?.id || isTemporaryExperience) return;
    const interval = window.setInterval(() => {
      if (!placing) void loadKiosk(true);
    }, 45000);
    return () => window.clearInterval(interval);
  }, [business?.id, isTemporaryExperience, loadKiosk, placing]);

  const resetKioskSession = useCallback(() => {
    setConfiguringProduct(null);
    setSupportOpen(false);
    setShowFilters(false);
    setSelectedProductId(null);
    setQuery("");
    setFilters(DEFAULT_KIOSK_FILTERS);
    setActivePage(
      business && (initialView === "menu" || business.kiosk_start_screen_enabled === false)
        ? initialKioskPage(business)
        : "start"
    );
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setOrderNotes("");
    setPaymentMethod(defaultPaymentMethodForBusiness(business, isLiveDeviceRoute));
    setPendingRemoval(null);
    setStarted(initialView === "menu" || business?.kiosk_start_screen_enabled === false);
    setError(null);
    if (cartStorageKey) window.localStorage.removeItem(cartStorageKey);
  }, [business, cartStorageKey, initialView, isLiveDeviceRoute]);

  const idleTimeoutMs = useMemo(() => {
    const seconds = Number(business?.idle_timeout_seconds ?? 60);
    return Math.max(15, Math.min(600, seconds)) * 1000;
  }, [business?.idle_timeout_seconds]);

  const markKioskActivity = useCallback(() => {
    if (!business || order || operationalMode === "preview") return;
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(resetKioskSession, idleTimeoutMs);
  }, [business, idleTimeoutMs, operationalMode, order, resetKioskSession]);

  const openOwnerPin = useCallback((mode: "exit" | "unlock") => {
    setOwnerPinMode(mode);
    setOwnerPin("");
    setOwnerPinError(null);
    setOwnerPinOpen(true);
  }, []);

  useEffect(() => {
    markKioskActivity();
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [
    markKioskActivity,
    cart.length,
    started,
    activePage,
    configuringProduct,
    supportOpen,
    customerName,
    customerPhone,
    orderNotes,
    paymentMethod,
    query,
    showFilters,
  ]);

  useEffect(() => {
    if (isTemporaryExperience || !cartStorageKey || loading || cartHydrated || !business) return;
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(cartStorageKey);
        if (!raw) {
          setCart([]);
          setActivePage(business.kiosk_start_screen_enabled === false ? initialKioskPage(business) : "start");
          setStarted(business.kiosk_start_screen_enabled === false);
          setHydratedCartKey(cartStorageKey);
          return;
        }
        const stored = JSON.parse(raw) as {
          cart?: StoredCartItem[];
          orderType?: OrderType;
          started?: boolean;
        };
        const byId = new Map(products.map((product) => [product.id, product]));
        const hydratedCart = (stored.cart ?? [])
          .map((item) => {
            const product = byId.get(item.productId);
            if (!product || !canOrderProduct(product)) return null;
            return {
              id: crypto.randomUUID(),
              product,
              quantity: Math.max(1, Math.min(Number(item.quantity) || 1, 99)),
              note: item.note ?? "",
              selectedOptions: item.selectedOptions ?? [],
            };
          })
          .filter((item): item is CartItem => Boolean(item));
        setCart(hydratedCart);
        setActivePage(
          Boolean(stored.started) && hydratedCart.length > 0
            ? "menu"
            : business.kiosk_start_screen_enabled === false
              ? initialKioskPage(business)
              : "start"
        );
        if (stored.orderType && businessCapabilitiesFor(business).allowedOrderModes.includes(stored.orderType)) {
          setOrderType(stored.orderType);
        }
        setStarted((Boolean(stored.started) && hydratedCart.length > 0) || business.kiosk_start_screen_enabled === false);
      } catch {
        window.localStorage.removeItem(cartStorageKey);
        setCart([]);
        setActivePage(business.kiosk_start_screen_enabled === false ? initialKioskPage(business) : "start");
        setStarted(business.kiosk_start_screen_enabled === false);
      } finally {
        setHydratedCartKey(cartStorageKey);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [business, cartHydrated, cartStorageKey, isTemporaryExperience, loading, products]);

  useEffect(() => {
    if (isTemporaryExperience || !cartStorageKey || !cartHydrated) return;
    const storedCart: StoredCartItem[] = cart.map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
      note: item.note,
      selectedOptions: item.selectedOptions,
    }));
    if (!storedCart.length) {
      window.localStorage.removeItem(cartStorageKey);
      return;
    }
    window.localStorage.setItem(
      cartStorageKey,
      JSON.stringify({
        cart: storedCart,
        orderType,
        started,
      })
    );
  }, [cart, cartHydrated, cartStorageKey, isTemporaryExperience, orderType, started]);

  useEffect(() => {
    if (!business || !isLiveDeviceRoute) return;
    let cancelled = false;
    const sendHeartbeat = async () => {
      try {
        const payload = {
          app_version: "web",
          user_agent: navigator.userAgent,
          current_route: "/kiosk/live",
          metadata: {
            path: "/kiosk/live",
            orientation: viewportOrientation,
            active_page: activePage,
          },
        };
        await api.liveKioskSessionHeartbeat(payload);
      } catch {
        // Heartbeat must never interrupt customer ordering.
      }
    };
    void sendHeartbeat();
    const interval = window.setInterval(() => {
      if (!cancelled) void sendHeartbeat();
    }, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activePage, business, isLiveDeviceRoute, viewportOrientation]);

  useEffect(() => {
    if (operationalMode !== "production" || !business?.kiosk_lock_settings?.enabled || !started) return;
    if (document.fullscreenElement) return;
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, [business?.kiosk_lock_settings?.enabled, operationalMode, started]);

  useEffect(() => {
    if (operationalMode !== "production" || !business?.kiosk_lock_settings?.enabled || !started || business.kiosk_lock_settings?.require_pin_to_exit === false) return;
    const enforceFullscreenLock = () => {
      const hasFreshUnlock = ownerUnlockedUntilRef.current > Date.now();
      if (!document.fullscreenElement && !hasFreshUnlock && !ownerPinOpen) {
        openOwnerPin("unlock");
      }
    };
    document.addEventListener("fullscreenchange", enforceFullscreenLock);
    document.addEventListener("visibilitychange", enforceFullscreenLock);
    window.addEventListener("focus", enforceFullscreenLock);
    return () => {
      document.removeEventListener("fullscreenchange", enforceFullscreenLock);
      document.removeEventListener("visibilitychange", enforceFullscreenLock);
      window.removeEventListener("focus", enforceFullscreenLock);
    };
  }, [business?.kiosk_lock_settings?.enabled, business?.kiosk_lock_settings?.require_pin_to_exit, operationalMode, ownerPinOpen, openOwnerPin, started]);

  useEffect(() => {
    if (operationalMode !== "production" || !business?.kiosk_lock_settings?.enabled || !started || business.kiosk_lock_settings?.require_pin_to_exit === false) return;
    window.history.pushState({ menutapKioskLock: true }, "", window.location.href);
    const handlePopState = () => {
      window.history.pushState({ menutapKioskLock: true }, "", window.location.href);
      openOwnerPin("exit");
    };
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (ownerUnlockedUntilRef.current > Date.now()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [business?.kiosk_lock_settings?.enabled, business?.kiosk_lock_settings?.require_pin_to_exit, openOwnerPin, operationalMode, started]);

  const capability = useMemo(() => businessCapabilitiesFor(business), [business]);
  const catalogProducts = products;
  const tabs = useMemo(() => {
    const builtTabs = buildTabs(categories, catalogProducts);
    if (business?.display_show_category_images === false) {
      return builtTabs.map((tab) => ({ ...tab, imageUrl: undefined }));
    }
    return builtTabs;
  }, [business?.display_show_category_images, categories, catalogProducts]);

  const selectedCategory = useMemo(
    () => (activeCategory === "all" || tabs.some((tab) => tab.id === activeCategory) ? activeCategory : "all"),
    [activeCategory, tabs]
  );
  const visibleProducts = useMemo(() => {
    const available = catalogProducts.filter((product) => {
      if (business?.display_show_unavailable === false && !product.is_available) return false;
      if (selectedCategory === "popular") {
        return productTagIds(product).includes("tag:popular");
      }
      if (selectedCategory === "new") return productTagIds(product).includes("tag:new");
      if (selectedCategory === "all") return true;
      if (selectedCategory === "deals") return isDealProduct(product);
      if (selectedCategory === "combo") return hasCombo(product);
      if (isTagTab(selectedCategory)) return productTagIds(product).includes(selectedCategory);
      return product.category_id === selectedCategory;
    });
    const refined = available.filter((product) => {
      const tags = productTags(product).map((tag) => tag.toLowerCase());
      const selectedFoodTypes =
        (capabilityHasFilter(capability, "veg") && filters.veg) ||
        (capabilityHasFilter(capability, "nonVeg") && filters.nonVeg) ||
        (capabilityHasFilter(capability, "egg") && filters.egg) ||
        (capabilityHasFilter(capability, "vegan") && filters.vegan) ||
        (capabilityHasFilter(capability, "spicy") && filters.spicy);
      if (selectedFoodTypes) {
        const matchesFoodType =
          (filters.veg && capabilityHasFilter(capability, "veg") && product.item_type === "veg") ||
          (filters.nonVeg && capabilityHasFilter(capability, "nonVeg") && product.item_type === "non_veg") ||
          (filters.egg && capabilityHasFilter(capability, "egg") && tags.includes("egg")) ||
          (filters.vegan && capabilityHasFilter(capability, "vegan") && tags.includes("vegan")) ||
          (filters.spicy && capabilityHasFilter(capability, "spicy") && tags.includes("spicy"));
        if (!matchesFoodType) return false;
      }
      if (filters.popular && capabilityHasFilter(capability, "popular") && !tags.includes("popular")) return false;
      if (filters.new && capabilityHasFilter(capability, "new") && !tags.includes("new")) return false;
      if (filters.bestseller && capabilityHasFilter(capability, "bestseller") && !tags.includes("bestseller")) return false;
      if (filters.recommended && capabilityHasFilter(capability, "recommended") && !tags.includes("recommended")) return false;
      if (filters.hot && capabilityHasFilter(capability, "hot") && !tags.includes("hot")) return false;
      if (filters.iced && capabilityHasFilter(capability, "iced") && !tags.includes("iced")) return false;
      if (filters.milkBased && capabilityHasFilter(capability, "milkBased") && !tags.some((tag) => tag.includes("milk"))) return false;
      if (filters.nonCoffee && capabilityHasFilter(capability, "nonCoffee") && !tags.some((tag) => tag.includes("non coffee") || tag.includes("non-coffee"))) return false;
      if (filters.deals && !(discountBadge(product) || tags.some((tag) => tag.includes("deal") || tag.includes("offer")))) return false;
      if (filters.combos && !hasCombo(product)) return false;
      if (filters.discounted && !discountBadge(product)) return false;
      if (filters.available && !product.is_available) return false;
      return true;
    });
    const sorted = selectedCategory === "new" ? [...refined].slice(-12).reverse() : [...refined];
    if (filters.priceSort === "low_high") sorted.sort((a, b) => effectivePrice(a) - effectivePrice(b));
    if (filters.priceSort === "high_low") sorted.sort((a, b) => effectivePrice(b) - effectivePrice(a));
    return sorted;
  }, [business?.display_show_unavailable, capability, catalogProducts, filters, selectedCategory]);

  const subtotal = cart.reduce((sum, item) => sum + cartItemPrice(item) * item.quantity, 0);
  const tax = Math.round(subtotal * (Number(business?.tax_percent ?? 0) / 100) * 100) / 100;
  const total = subtotal + tax;
  const quantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  const productQuantities = useMemo(() => {
    const quantities: Record<string, number> = {};
    cart.forEach((item) => {
      quantities[item.product.id] = (quantities[item.product.id] ?? 0) + item.quantity;
    });
    return quantities;
  }, [cart]);
  const symbol = business?.currency_symbol || "Rs";
  const orderModes = capability.allowedOrderModes;
  const orderSettings = business?.kiosk_order_settings ?? {};
  const publicOrderingAllowed = operationalMode !== "production" || isLiveDeviceRoute || orderSettings.public_online_ordering_enabled === true;
  const checkoutEnabled = publicOrderingAllowed && orderSettings.checkout_enabled !== false && orderSettings.checkout_mode !== "display";
  const allowCustomerNotes = orderSettings.allow_customer_notes !== false;
  const paymentOptions = useMemo(() => {
    if (operationalMode === "test") {
      return [{ id: "pay_at_counter" as PaymentMethod, icon: <ShieldCheck size={22} />, title: "Test Payment", subtitle: "This is a test order. No real payment is required, and no production systems will be affected." }];
    }
    return paymentOptionsForBusiness(business, isLiveDeviceRoute);
  }, [business, isLiveDeviceRoute, operationalMode]);
  const selectedPaymentAvailable = paymentOptions.some((option) => option.id === paymentMethod);
  const effectivePaymentMethod = selectedPaymentAvailable ? paymentMethod : defaultPaymentMethodForBusiness(business, isLiveDeviceRoute);
  const resetSeconds = Math.min(10, Math.max(5, Number(business?.order_reset_seconds ?? 5)));
  const isOpen = operationalMode !== "production" || (business ? isBusinessOpen(business) : false);
  const logoImage = assetUrl(business?.logo_path);
  const heroImage = assetUrl(business?.offer_image_path) ?? catalogProducts.map((product) => kioskProductImage(product, categories, catalogProducts)).find(Boolean) ?? null;
  const startScreenEnabled = business?.kiosk_start_screen_enabled !== false;
  const showStartScreen = startScreenEnabled && activePage === "start";
  const canPlaceOrder =
    isOpen &&
    checkoutEnabled &&
    paymentOptions.length > 0 &&
    (!orderSettings.require_customer_name || customerName.trim().length > 0) &&
    (!orderSettings.require_customer_phone || customerPhone.trim().length > 0) &&
    (allowCustomerNotes || orderNotes.trim().length === 0) &&
    cart.length > 0 &&
    cart.every((item) =>
      (item.product.modifier_groups ?? []).every(
        (group) =>
          !group.is_required ||
          item.selectedOptions.filter((option) => option.group_id === group.id).length >= group.min_select
      )
    );
  const openSupport = () => setSupportOpen(true);

  const addToCart = (product: Product) => {
    if (operationalMode === "preview") return;
    if (!canOrderProduct(product) || !isOpen) return;
    setSelectedProductId(product.id);
    if ((product.modifier_groups ?? []).some((group) => group.options.some((option) => option.is_available))) {
      setConfiguringProduct(product);
      return;
    }
    addConfiguredItem(product, 1, "", []);
  };

  const addConfiguredItem = (
    product: Product,
    itemQuantity: number,
    note: string,
    selectedOptions: SelectedOption[]
  ) => {
    if (operationalMode === "preview") return;
    const trimmedNote = note.trim();
    const selectedKey = optionsKey(selectedOptions);
    setCart((items) => {
      const existingIndex = items.findIndex(
        (item) =>
          item.product.id === product.id &&
          item.note.trim() === trimmedNote &&
          optionsKey(item.selectedOptions) === selectedKey
      );

      if (existingIndex >= 0) {
        return items.map((item, index) =>
          index === existingIndex ? { ...item, quantity: item.quantity + itemQuantity } : item
        );
      }

      return [
        ...items,
        {
          id: crypto.randomUUID(),
          product,
          quantity: itemQuantity,
          note: trimmedNote,
          selectedOptions,
        },
      ];
    });
    emitKioskEvent("item-added", { productId: product.id });
  };

  const updateQuantity = (id: string, change: number) => {
    setCart((items) =>
      items
        .map((item) => (item.id === id ? { ...item, quantity: Math.max(0, item.quantity + change) } : item))
        .filter((item) => item.quantity > 0)
    );
  };

  const decrementProduct = (productId: string) => {
    const target = cart.find((item) => item.product.id === productId);
    if (target?.quantity === 1) {
      setPendingRemoval(target);
      return;
    }
    setCart((items) => {
      const index = items.findIndex((item) => item.product.id === productId);
      if (index < 0) return items;
      return items
        .map((item, itemIndex) =>
          itemIndex === index ? { ...item, quantity: Math.max(0, item.quantity - 1) } : item
        )
        .filter((item) => item.quantity > 0);
    });
  };

  const incrementProduct = (productId: string) => {
    setCart((items) => {
      const index = items.findIndex((item) => item.product.id === productId);
      if (index < 0) return items;
      return items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, quantity: item.quantity + 1 } : item
      );
    });
  };

  const removeItem = (id: string) => {
    setCart((items) => items.filter((item) => item.id !== id));
  };

  const updateOption = (itemId: string, groupId: string, groupName: string, option: ModifierOption) => {
    setCart((items) =>
      items.map((item) => {
        if (item.id !== itemId) return item;
        const group = item.product.modifier_groups?.find((entry) => entry.id === groupId);
        const selectedInGroup = item.selectedOptions.filter((entry) => entry.group_id === groupId);
        const alreadySelected = selectedInGroup.some((entry) => entry.option_id === option.id);
        let selectedOptions = item.selectedOptions.filter((entry) => entry.option_id !== option.id);

        if (!alreadySelected) {
          if ((group?.max_select ?? 1) <= 1) {
            selectedOptions = selectedOptions.filter((entry) => entry.group_id !== groupId);
          } else if (selectedInGroup.length >= (group?.max_select ?? 1)) {
            return item;
          }
          selectedOptions.push({
            group_id: groupId,
            group_name: groupName,
            option_id: option.id,
            name: option.name,
            price_delta: Number(option.price_delta || 0),
          });
        }
        return { ...item, selectedOptions };
      })
    );
  };

  const placeOrder = async () => {
    if (placing || !canPlaceOrder) return;
    setPlacing(true);
    setError(null);
    try {
      const orderPayload = {
        order_type: orderType,
        customer_name: customerName.trim() || undefined,
        customer_phone: customerPhone.trim() || undefined,
        notes: allowCustomerNotes ? orderNotes.trim() || undefined : undefined,
        payment_method: effectivePaymentMethod,
        items: cart.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
          customizations: item.selectedOptions.map((option) => ({
            group_id: option.group_id,
            group_name: option.group_name,
            option_id: option.option_id,
            name: option.name,
            price_delta: option.price_delta,
          })),
        })),
      };
      if (operationalMode === "preview") {
        throw new Error("Preview mode cannot place orders. Launch Test Kiosk to complete checkout.");
      }
      const created: Order = operationalMode === "test"
        ? isTemporaryExperience
          ? await api.completeKioskTestExperience({
              event_version: 1,
              order_type: orderType,
              items: cart.map((item) => ({
                preset_id: item.product.id,
                name: item.product.name,
                quantity: item.quantity,
              })),
            }).then((response) => ({
              id: response.id,
              business_id: business?.id ?? "test",
              order_number: null,
              public_token: `TEST-${response.id.slice(0, 8).toUpperCase()}`,
              status: "pending",
              order_type: orderType,
              customer_name: customerName.trim() || null,
              customer_phone: customerPhone.trim() || null,
              subtotal,
              tax_amount: tax,
              discount_amount: 0,
              total_amount: total,
              payment_status: "paid",
              payment_method: "test_payment",
              notes: orderNotes.trim() || null,
              placed_at: new Date().toISOString(),
              order_items: cart.map((item) => ({
                id: crypto.randomUUID(),
                order_id: response.id,
                business_id: business?.id ?? "test",
                product_id: item.product.id,
                product_name: item.product.name,
                quantity: item.quantity,
                unit_price: cartItemPrice(item),
                total_price: cartItemPrice(item) * item.quantity,
                notes: item.note || null,
              })),
            } satisfies Order))
          : await api.testRuntimeCreateKioskOrder({
            source: "kiosk",
            order_type: orderType === "dine_in" ? "dine_in" : "takeaway",
            notes: allowCustomerNotes ? orderNotes.trim() || undefined : undefined,
            items: cart.map((item) => ({
              product_id: item.product.id,
              quantity: item.quantity,
              modifiers: item.selectedOptions.map((option) => ({ option_id: option.option_id, name: option.name, price_delta: option.price_delta })),
            })),
          }).then((response) => testOrder(response, business!.id))
        : isLiveDeviceRoute
          ? await api.placeLiveKioskSessionOrder(orderPayload)
          : await placeRealKioskOrder(slug, orderPayload);
      const checkoutUrl = created.payment?.checkout_url;
      const createdPayment = created.payment?.payment;
      if (created.payment?.provider === "paytm" && createdPayment?.id) {
        setPaytmStatus({
          paymentId: createdPayment.id,
          paymentToken: createdPayment.provider_reference || created.public_token || "",
          order: created,
          qr: created.payment.qr ?? (createdPayment.raw_payload?.paytm_qr as { qr_data?: string; amount?: string; reference_id?: string; expires_at?: string | null } | undefined) ?? null,
          status: createdPayment.status,
        });
        setActivePage("paytm_payment");
        setCart([]);
        if (cartStorageKey) window.localStorage.removeItem(cartStorageKey);
        return;
      }
      setSuccessCountdown(resetSeconds);
      setCart([]);
      setCustomerName("");
      setCustomerPhone("");
      setOrderNotes("");
      setPaymentMethod(defaultPaymentMethodForBusiness(business, isLiveDeviceRoute));
      if (cartStorageKey) window.localStorage.removeItem(cartStorageKey);
      if (checkoutUrl) {
        ownerUnlockedUntilRef.current = Date.now() + 30000;
        window.location.href = checkoutUrl;
        return;
      }
      if (operationalMode === "test" || orderSettings.show_confirmation !== false) setOrder(created);
      if (operationalMode === "test" && (isTemporaryExperience || effectivePaymentMethod !== "pay_at_counter")) {
        emitKioskEvent("test-payment-completed", { success: true, testOrderId: created.id });
      }
      setActivePage(operationalMode !== "test" && orderSettings.show_confirmation === false && business ? initialKioskPage(business) : "order_confirmed");
      setStarted(false);
      if (experienceData) {
        setProducts(experienceData.products);
      } else {
        const menu = operationalMode !== "production" && draftBusinessId
          ? await loadDraftKioskMenu(draftBusinessId, locationId)
          : operationalMode === "test" ? await api.testKioskSessionMenu()
          : isLiveDeviceRoute ? await api.liveKioskSessionMenu() : await loadRealKioskMenu(slug, locationId);
        setProducts(menu.products);
      }
      window.setTimeout(() => {
        setOrder(null);
        resetKioskSession();
      }, orderSettings.show_confirmation === false ? 800 : resetSeconds * 1000);
    } catch (err) {
      if (operationalMode === "test") emitKioskEvent("kiosk-error", { message: err instanceof Error ? err.message : "Test order failed." });
      setError(err instanceof Error ? err.message : "Could not place order.");
    } finally {
      setPlacing(false);
    }
  };

  useEffect(() => {
    if (!order) return;
    if (operationalMode === "test") emitKioskEvent("confirmation-shown", { testOrderId: order.id });
    const interval = window.setInterval(() => {
      setSuccessCountdown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [emitKioskEvent, operationalMode, order]);

  useEffect(() => {
    if (!paytmStatus || activePage !== "paytm_payment") return;
    let cancelled = false;
    const checkStatus = async () => {
      try {
        const status = await api.paymentStatus(paytmStatus.paymentId, paytmStatus.paymentToken);
        if (cancelled) return;
        setPaytmStatus((current) =>
          current
            ? {
                ...current,
                status: status.status,
                qr: status.qr ?? current.qr,
              }
            : current
        );
        if (status.status === "paid") {
          setOrder({ ...paytmStatus.order, payment_status: "paid" });
          setPaytmStatus(null);
          setSuccessCountdown(resetSeconds);
          setActivePage("order_confirmed");
          window.setTimeout(() => {
            setOrder(null);
            resetKioskSession();
          }, resetSeconds * 1000);
        }
      } catch {
        // Payment polling must not interrupt the QR screen.
      }
    };
    void checkStatus();
    const interval = window.setInterval(checkStatus, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activePage, paytmStatus, resetKioskSession, resetSeconds]);

  if (loading || (business && !cartHydrated)) {
    return <KioskLoadingState />;
  }

  if (!business) {
    return <KioskUnavailableState hasError={Boolean(error)} onRetry={loadKiosk} />;
  }

  const kioskOrientation = normalizeKioskScreenOrientation(business.kiosk_screen_orientation);
  const effectiveKioskOrientation = forcedOrientation ?? viewportOrientation ?? kioskOrientation;
  const kioskSelection = parseKioskThemeSelection(business.kiosk_theme);
  const selectedLayout = normalizeKioskTemplateId(kioskSelection.templateId) as KioskLayoutId;
  const lockSettings = business.kiosk_lock_settings ?? {};
  const ownerPinConfigured = Boolean(lockSettings.owner_pin_configured);
  const lockMisconfigured = Boolean(lockSettings.enabled && !ownerPinConfigured);
  const lockModeEnabled = Boolean(lockSettings.enabled && ownerPinConfigured);
  const ownerPinRequired = lockModeEnabled && lockSettings.require_pin_to_exit !== false;

  const completeOwnerExit = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // Browser fullscreen exit can fail if not currently user-activated.
    }
    ownerUnlockedUntilRef.current = Date.now() + 30000;
    router.push("/admin");
  };

  const requestOwnerExit = () => {
    setOwnerPinError(null);
    if (ownerPinRequired) {
      openOwnerPin("exit");
      return;
    }
    void completeOwnerExit();
  };

  const verifyOwnerPin = async () => {
    if (!ownerPin.trim() || verifyingOwnerPin) return;
    setVerifyingOwnerPin(true);
    setOwnerPinError(null);
    try {
      await (isLiveDeviceRoute
        ? api.verifyLiveSessionOwnerPin(ownerPin.trim())
        : api.verifyOwnerPin(business.slug, ownerPin.trim()));
      ownerUnlockedUntilRef.current = Date.now() + 30000;
      setOwnerPin("");
      setOwnerPinOpen(false);
      if (ownerPinMode === "exit") {
        await completeOwnerExit();
      } else {
        await document.documentElement.requestFullscreen?.().catch(() => undefined);
      }
    } catch (err) {
      if (operationalMode === "test") emitKioskEvent("TEST_RESULT", { success: false, message: err instanceof Error ? err.message : "Test order failed." });
      setOwnerPinError(err instanceof Error ? err.message : "Invalid owner PIN.");
    } finally {
      setVerifyingOwnerPin(false);
    }
  };

  return (
    <main
      data-testid="kiosk-root"
      style={kioskAccentStyle(kioskSelection.accentColor, business.brand_color)}
      className={`kiosk-ui kiosk-stage overflow-hidden text-[#0F172A] ${contained ? "h-full w-full" : "h-[100dvh] w-[100dvw]"}`}
      onPointerDown={markKioskActivity}
      onKeyDown={markKioskActivity}
      onInput={markKioskActivity}
      onScrollCapture={markKioskActivity}
    >
      <div className="relative h-full w-full overflow-hidden bg-[#0F172A]">
        <div className="kiosk-device-screen kiosk-order-flow relative flex h-full w-full flex-col overflow-hidden bg-white">
          {lockMisconfigured && (
            <div className="absolute left-3 top-3 z-40 max-w-[min(520px,calc(100vw-96px))] rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black leading-5 text-amber-950 shadow-lg">
              Kiosk lock is enabled but no owner PIN is configured. Lock controls are disabled; open admin advanced settings to create a kiosk PIN.
            </div>
          )}
          {lockModeEnabled && (
            <button
              type="button"
              onClick={requestOwnerExit}
              className="absolute right-3 top-3 z-40 grid h-11 w-11 place-items-center rounded-full border border-white/25 bg-slate-950/35 text-white shadow-lg backdrop-blur-md"
              aria-label="Owner controls"
              title="Owner controls"
            >
              <LockKeyhole size={18} />
            </button>
          )}
          {order ? (
            <OrderConfirmedScreen
              business={business}
              capability={capability}
              logoImage={logoImage}
              order={order}
              isContrast={kioskSelection.mode === "premium_contrast"}
              countdown={successCountdown}
              resetSeconds={resetSeconds}
              onSupport={openSupport}
              onStartNew={() => {
                setOrder(null);
                resetKioskSession();
              }}
            />
          ) : showStartScreen ? (
            <StartScreen
              business={business}
              orientation={effectiveKioskOrientation}
              capability={capability}
              logoImage={logoImage}
              heroImage={heroImage}
              orderModes={orderModes}
              isOpen={isOpen}
              isContrast={kioskSelection.mode === "premium_contrast"}
              onSupport={openSupport}
              onStart={(mode) => {
                setOrderType(mode);
                setStarted(true);
                setActiveCategory(
                  selectedLayout === "category_gate"
                    ? "all"
                    : tabs.find((tab) => tab.id !== "deals")?.id ?? tabs[0]?.id ?? "all"
                );
                setActivePage(selectedLayout === "category_gate" ? "category" : "menu");
              }}
            />
          ) : activePage === "paytm_payment" && paytmStatus ? (
            <PaytmQrPaymentScreen
              business={business}
              logoImage={logoImage}
              status={paytmStatus.status}
              qr={paytmStatus.qr}
              amount={total || paytmStatus.order.total_amount}
              symbol={symbol}
              orderNumber={paytmStatus.order.order_number ?? paytmStatus.order.public_token ?? paytmStatus.order.id.slice(0, 8)}
              onBack={() => setActivePage("payment")}
              onRetry={() => setActivePage("payment")}
              onSupport={openSupport}
            />
          ) : activePage === "cart" || activePage === "payment" ? (
            <CartScreen
              business={business}
              capability={capability}
              logoImage={logoImage}
              cart={cart}
              symbol={symbol}
              subtotal={subtotal}
              tax={tax}
              total={total}
              orderType={orderType}
              orderModes={orderModes}
              customerName={customerName}
              customerPhone={customerPhone}
              orderNotes={orderNotes}
              paymentMethod={effectivePaymentMethod}
              paymentOptions={paymentOptions}
              placing={placing}
              isOpen={isOpen}
              isContrast={kioskSelection.mode === "premium_contrast"}
              canPlaceOrder={canPlaceOrder}
              testMode={operationalMode === "test"}
              page={activePage}
              onPageChange={(page) => {
                setActivePage(page);
                if (page === "payment") {
                  emitKioskEvent("checkout-reached");
                  if (operationalMode === "test") emitKioskEvent("test-payment-started", { method: "test_payment" });
                }
              }}
              onBack={() => setActivePage(selectedLayout === "category_gate" ? "category" : "menu")}
              onOrderType={setOrderType}
              onCustomerName={setCustomerName}
              onCustomerPhone={setCustomerPhone}
              onOrderNotes={setOrderNotes}
              onPaymentMethod={(method) => {
                setPaymentMethod(method);
                if (operationalMode === "test") emitKioskEvent("test-payment-started", { method: "test_payment" });
              }}
              onQuantity={updateQuantity}
              onRemove={(id) => setPendingRemoval(cart.find((item) => item.id === id) ?? null)}
              onOption={updateOption}
              onSupport={openSupport}
              onPlaceOrder={placeOrder}
            />
          ) : (
            <MenuScreen
              business={business}
              orientation={effectiveKioskOrientation}
              capability={capability}
              logoImage={logoImage}
              categories={categories}
              tabs={tabs}
              products={visibleProducts}
              catalogProducts={catalogProducts}
              activeCategory={selectedCategory}
              showFilters={showFilters}
              filters={filters}
              quantity={quantity}
              productQuantities={productQuantities}
              total={total}
              symbol={symbol}
              isOpen={isOpen}
              selectedProductId={selectedProductId}
              error={error}
              onTab={(value) => {
                emitKioskEvent("category-selected", { categoryId: value });
                setActiveCategory(value);
                setActivePage(
                  value === "deals"
                    ? "deals"
                    : selectedLayout === "category_gate" && value === "all"
                      ? "category"
                      : "menu"
                );
              }}
              onToggleFilters={() => setShowFilters((value) => !value)}
              onSupport={openSupport}
              onFilterChange={(key, value) => setFilters((current) => ({ ...current, [key]: value }))}
              onResetFilters={() => setFilters(DEFAULT_KIOSK_FILTERS)}
              onSelect={setSelectedProductId}
              onAdd={addToCart}
              onIncrement={incrementProduct}
              onDecrement={decrementProduct}
              onCart={() => {
                if (operationalMode === "preview") return;
                setActivePage("cart");
                emitKioskEvent("cart-opened");
              }}
            />
          )}
          {configuringProduct && (
            <ModifierSheet
              product={configuringProduct}
              capability={capability}
              symbol={symbol}
              onClose={() => setConfiguringProduct(null)}
              onAdd={(product, itemQuantity, selectedOptions) => {
                addConfiguredItem(product, itemQuantity, "", selectedOptions);
                setConfiguringProduct(null);
              }}
            />
          )}
          {supportOpen && <SupportDialog business={business} onClose={() => setSupportOpen(false)} />}
          {pendingRemoval && (
            <ConfirmRemovalDialog
              itemName={pendingRemoval.product.name}
              onCancel={() => setPendingRemoval(null)}
              onConfirm={() => {
                removeItem(pendingRemoval.id);
                setPendingRemoval(null);
              }}
            />
          )}
          {ownerPinOpen && (
            <OwnerPinModal
              pin={ownerPin}
              error={ownerPinError}
              verifying={verifyingOwnerPin}
              mode={ownerPinMode}
              onPin={setOwnerPin}
              onClose={() => {
                if (ownerPinMode === "unlock") return;
                if (verifyingOwnerPin) return;
                setOwnerPinOpen(false);
                setOwnerPin("");
                setOwnerPinError(null);
              }}
              onVerify={() => void verifyOwnerPin()}
            />
          )}
        </div>
      </div>

    </main>
  );
}

function OwnerPinModal({
  pin,
  error,
  verifying,
  mode,
  onPin,
  onClose,
  onVerify,
}: {
  pin: string;
  error: string | null;
  verifying: boolean;
  mode: "exit" | "unlock";
  onPin: (value: string) => void;
  onClose: () => void;
  onVerify: () => void;
}) {
  const locked = mode === "unlock";
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-slate-950/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="owner-pin-title">
      <section className="w-full max-w-sm rounded-2xl border border-white/15 bg-white p-5 text-[#0F172A] shadow-2xl">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#F8FAFC] text-[#050608]">
          <LockKeyhole size={22} />
        </div>
        <h2 id="owner-pin-title" className="mt-4 text-center text-xl font-black">
          {locked ? "Kiosk locked" : "Owner PIN required"}
        </h2>
        <p className="mt-2 text-center text-sm font-semibold text-[#64748B]">
          {locked ? "Enter the owner PIN to restore fullscreen and continue." : "Enter the owner PIN to leave the kiosk."}
        </p>
        <input
          value={pin}
          onChange={(event) => onPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(event) => {
            if (event.key === "Enter") onVerify();
          }}
          inputMode="numeric"
          type="password"
          autoFocus
          className="mt-4 min-h-12 w-full rounded-xl border border-[#D7DEE8] px-3 text-center text-2xl font-black tracking-[0.25em] outline-none focus:border-[#050608] focus:ring-4 focus:ring-neutral-200"
        />
        {error && <p className="mt-3 text-center text-sm font-bold text-rose-600">{error}</p>}
        <div className={`mt-5 grid gap-2 ${locked ? "" : "sm:grid-cols-2"}`}>
          {!locked && (
            <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-[#D7DEE8] bg-white px-4 text-sm font-black">
              Cancel
            </button>
          )}
          <button type="button" disabled={verifying || pin.length < 4 || pin.length > 6} onClick={onVerify} className="min-h-11 rounded-xl bg-[#050608] px-4 text-sm font-black text-white disabled:opacity-50">
            {verifying ? "Checking..." : "Unlock"}
          </button>
        </div>
      </section>
    </div>
  );
}

function KioskLoadingState() {
  return (
    <main className="kiosk-ui kiosk-stage grid min-h-screen place-items-center p-4 text-[#0F172A]">
      <section className="w-full max-w-[360px] rounded-[32px] border border-[#E2E8F0] bg-white p-5 shadow-[0_20px_54px_rgba(15,23,42,0.10)]">
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 animate-pulse rounded-2xl bg-[#EEF2F6]" />
          <div className="min-w-0 flex-1">
            <div className="h-4 w-32 animate-pulse rounded-full bg-[#EEF2F6]" />
            <div className="mt-3 h-3 w-24 animate-pulse rounded-full bg-[#F1F5F9]" />
          </div>
        </div>
        <div className="mt-5 h-12 animate-pulse rounded-2xl bg-[#F8FAFC]" />
        <div className="mt-4 h-32 animate-pulse rounded-[24px] bg-[#F1F5F9]" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="h-36 animate-pulse rounded-2xl bg-[#F8FAFC]" />
          <div className="h-36 animate-pulse rounded-2xl bg-[#F8FAFC]" />
        </div>
      </section>
    </main>
  );
}

function KioskUnavailableState({ hasError, onRetry }: { hasError: boolean; onRetry: () => void }) {
  const { isReconnecting, probeNow } = useAutoReconnect({
    isError: hasError,
    onReconnect: onRetry,
    intervalMs: 3000,
  });

  return (
    <main className="kiosk-ui kiosk-stage grid min-h-screen place-items-center p-4 text-[#0F172A]">
      <section className="w-full max-w-[400px] rounded-[32px] border border-[#E2E8F0] bg-white p-6 text-center shadow-[0_20px_54px_rgba(15,23,42,0.10)]">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#F8FAFC] text-[#050608]">
          <Store size={28} />
        </div>
        <h1 className="mt-5 text-2xl font-black tracking-tight">This kiosk is unavailable</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#64748B]">
          {hasError
            ? "We could not load this kiosk right now. It will automatically reload when the server connection is restored."
            : "This customer screen is not ready for ordering yet."}
        </p>
        {hasError && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#B2DDFF] bg-[#EFF8FF] px-3.5 py-1.5 text-xs font-semibold text-[#175CD3]">
            <span className="h-2 w-2 animate-ping rounded-full bg-[#155EEF]" />
            {isReconnecting ? "Checking connection…" : "Auto-reloading when available…"}
          </div>
        )}
        <button
          type="button"
          onClick={() => void (hasError ? probeNow() : onRetry())}
          className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#050608] px-5 text-sm font-black text-white shadow-[0_14px_28px_rgba(15,23,42,0.18)]"
        >
          {isReconnecting ? "Connecting…" : "Retry now"}
          <ArrowRight size={18} />
        </button>
      </section>
    </main>
  );
}

function KioskHeader({
  business,
  capability,
  logoImage,
  isContrast,
  onSupport,
  onBack,
}: {
  business: Business;
  capability: BusinessCapability;
  logoImage: string | null;
  isContrast: boolean;
  onSupport: () => void;
  onBack?: () => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <header className={`grid min-h-[74px] shrink-0 grid-cols-[minmax(116px,0.9fr)_minmax(0,1.75fr)_minmax(54px,0.55fr)] items-center gap-2 border-b px-[2.7%] py-2 sm:grid-cols-[minmax(150px,220px)_minmax(0,1fr)_minmax(110px,220px)] sm:gap-3 ${isContrast ? "border-white/10 bg-[#171827] text-white" : "border-slate-200 bg-white text-slate-950"}`}>
      <div className="flex min-w-0 items-center gap-3">
        {onBack && (
          <button type="button" onClick={onBack} className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl border shadow-sm ${isContrast ? "border-white/10 bg-white/10" : "border-slate-200 bg-white"}`} aria-label="Go back">
            <ArrowLeft size={22} />
          </button>
        )}
        <div className="min-w-0">
          <p className={`truncate text-[clamp(11px,0.9vw,15px)] font-black leading-tight ${isContrast ? "text-white/72" : "text-slate-600"}`}>{greetingFor(now)}</p>
          <p className="mt-0.5 truncate text-[clamp(13px,1.1vw,18px)] font-black leading-tight tabular-nums">{formatKioskTime(now)}</p>
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-center gap-3 text-center">
        <Logo business={business} logoImage={logoImage} size={44} />
        <div className="min-w-0">
          <h1 className="truncate text-[clamp(21px,2.25vw,36px)] font-black leading-none">{business.name}</h1>
          {business.display_show_tagline !== false && (
            <p className={`mt-1 truncate text-[clamp(11px,1vw,15px)] font-bold ${isContrast ? "text-white/60" : "text-slate-500"}`}>
              {business.tagline || businessFallbackTagline(capability)}
            </p>
          )}
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSupport}
          className={`grid h-11 w-11 place-items-center rounded-xl border shadow-sm transition ${isContrast ? "border-white/10 bg-white/10" : "border-slate-200 bg-white hover:border-slate-400"}`}
          aria-label="Contact business"
          title="Contact business"
        >
          <Phone size={18} />
        </button>
      </div>
    </header>
  );
}

function StartScreen({
  business,
  orientation,
  capability,
  logoImage,
  heroImage,
  orderModes,
  isOpen,
  isContrast,
  onSupport,
  onStart,
}: {
  business: Business;
  orientation: KioskScreenOrientation;
  capability: BusinessCapability;
  logoImage: string | null;
  heroImage: string | null;
  orderModes: OrderType[];
  isOpen: boolean;
  isContrast: boolean;
  onSupport: () => void;
  onStart: (mode: OrderType) => void;
}) {
  const availability = kioskAvailabilityCopy(business, isOpen);
  const kioskConfig = kioskBusinessConfig(business.type);
  const primaryMode = orderModes[0] ?? "pickup";
  const portrait = orientation === "portrait";
  const startCopy = kioskStartCopy(business, business.kiosk_start_screen_settings);
  const startButtonLabel = business.offer_cta?.trim() || kioskConfig.startLabel;
  const textOnImage = business.offer_background === "black" ? "text-slate-950" : "text-white";
  const textPosition = business.kiosk_start_text_position ?? "middle";
  const touchToStart = business.kiosk_touch_to_start === true;
  const startSettings = business.kiosk_start_screen_settings ?? {};
  const contentPosition = startSettings.content_position === "bottom_center" || startSettings.content_position === "center" ? startSettings.content_position : textPosition === "bottom" ? "bottom_left" : "center";
  const readability = startSettings.readability === "light" || startSettings.readability === "strong" ? startSettings.readability : "auto";
  const focalX = typeof startSettings.focal_x === "number" ? startSettings.focal_x : 0.5;
  const focalY = typeof startSettings.focal_y === "number" ? startSettings.focal_y : 0.5;
  const availabilityPosition =
    textPosition === "bottom"
      ? portrait
        ? "right-[5%] top-[3%] max-w-[72%]"
        : "right-[5%] top-[4%] max-w-[420px]"
      : portrait
        ? "bottom-[3%] left-[7%] right-[7%]"
        : "bottom-[4%] right-[5%] max-w-[420px]";
  return (
    <section data-testid="kiosk-start-screen" className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#F6F3EE] text-slate-950">
      <KioskHeader business={business} capability={capability} logoImage={logoImage} isContrast={isContrast} onSupport={onSupport} />
      <main
        className={`relative min-h-0 flex-1 overflow-hidden ${touchToStart && isOpen ? "cursor-pointer" : ""}`}
        onClick={touchToStart && isOpen ? () => onStart(primaryMode) : undefined}
        onKeyDown={
          touchToStart && isOpen
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") onStart(primaryMode);
              }
            : undefined
        }
        role={touchToStart && isOpen ? "button" : undefined}
        tabIndex={touchToStart && isOpen ? 0 : undefined}
        aria-label={touchToStart && isOpen ? "Touch anywhere to start ordering" : undefined}
      >
        {heroImage ? (
          <Image src={heroImage} alt="" fill sizes="100vw" unoptimized className="object-cover" style={{ objectPosition: `${focalX * 100}% ${focalY * 100}%` }} />
        ) : (
          <div className="absolute inset-0 bg-slate-100" />
        )}
        <div
          className={`absolute inset-0 ${readability === "light" ? "bg-gradient-to-r from-slate-950/35 via-slate-950/20 to-transparent" : readability === "strong" ? "bg-gradient-to-r from-slate-950/95 via-slate-950/72 to-slate-950/42" : business.offer_background === "black" ? "bg-gradient-to-r from-white/86 via-white/62 to-white/22" : "bg-gradient-to-r from-slate-950/82 via-slate-950/58 to-slate-950/28"}`}
        />
        <div className={`relative z-10 flex h-full min-h-0 flex-col ${contentPosition === "bottom_left" ? "items-start text-left" : "items-center text-center"} ${contentPosition === "bottom_center" || contentPosition === "bottom_left" ? "justify-end" : "justify-center"} px-[7%] py-[5%] ${textOnImage}`}>
          <div className={`${portrait ? "max-w-[94%]" : "max-w-[76%]"} min-w-0 ${contentPosition === "bottom_center" || contentPosition === "bottom_left" ? "pb-[2%]" : ""}`}>
            <p className="mb-4 max-w-4xl truncate text-[clamp(18px,1.45vw,28px)] font-black uppercase leading-[1.15] tracking-[0.04em] text-[var(--kiosk-accent)]">
              {startCopy.welcomeText}
            </p>
            <h2 className={`${portrait ? "text-[clamp(82px,12vw,178px)]" : "text-[clamp(102px,10.2vw,218px)]"} line-clamp-2 max-w-6xl break-words font-black leading-[0.9]`}>
              {startCopy.landingText}
            </h2>
            <p className="mt-5 max-w-4xl text-[clamp(42px,4.4vw,76px)] font-black leading-[1.08] text-[var(--kiosk-accent)]">
              {startCopy.instructionText}
            </p>
            {startCopy.subtitleTexts.length > 0 && (
              <p className="mt-5 min-h-[2.32em] line-clamp-2 max-w-4xl text-[clamp(24px,2.4vw,40px)] font-bold leading-[1.2] opacity-90">
                <TypewriterText texts={startCopy.subtitleTexts} typewriterKey={startCopy.subtitleKey} speedMs={54} deleteSpeedMs={32} waitMs={1600} cursorClassName="text-[var(--kiosk-accent)]" />
              </p>
            )}
            {touchToStart ? (
              <p className="mt-7 w-fit rounded-2xl border border-white/35 bg-black/40 px-8 py-5 text-[clamp(24px,2.6vw,40px)] font-black text-white shadow-xl backdrop-blur-md">
                Touch anywhere
              </p>
            ) : (
              <button
                type="button"
                disabled={!isOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  onStart(primaryMode);
                }}
                className="mt-9 flex min-h-20 min-w-[280px] max-w-full items-center justify-center gap-4 rounded-2xl bg-[var(--kiosk-primary)] px-10 text-[clamp(24px,2.6vw,40px)] font-black text-[var(--kiosk-primary-foreground)] shadow-[0_18px_36px_var(--kiosk-accent-ring)] transition hover:bg-[var(--kiosk-primary)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--kiosk-accent-ring)] disabled:bg-slate-400 disabled:text-white"
              >
                {startButtonLabel}
                <ArrowRight size={24} />
              </button>
            )}
          </div>
          <div className={`absolute ${availabilityPosition} w-fit rounded-2xl border border-white/20 bg-black/60 px-4 py-3 text-left text-white shadow-xl backdrop-blur-md`}>
            <p className="max-w-[360px] text-[clamp(13px,1.15vw,19px)] font-black leading-tight text-white">{isOpen ? "We hope you're having a good day" : availability.title}</p>
            <p className="mt-1 max-w-[360px] text-[clamp(11px,0.98vw,16px)] font-bold leading-tight text-white">
              {isOpen
                ? business.closing_time
                  ? `Store closes at ${formatBusinessTime(business.closing_time) || business.closing_time.slice(0, 5)}`
                  : "Store hours are available from staff."
                : availability.message}
            </p>
          </div>
        </div>
      </main>
    </section>
  );
}

function OrderConfirmedScreen({
  business,
  capability,
  logoImage,
  order,
  isContrast,
  countdown,
  resetSeconds,
  onSupport,
  onStartNew,
}: {
  business: Business;
  capability: BusinessCapability;
  logoImage: string | null;
  order: Order;
  isContrast: boolean;
  countdown: number;
  resetSeconds: number;
  onSupport: () => void;
  onStartNew: () => void;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const confirmation = confirmationContent(capability, order);
  const showEstimatedTime = business.kiosk_order_settings?.show_estimated_time !== false;
  const progress = Math.max(0, Math.min(100, ((resetSeconds - countdown) / resetSeconds) * 100));
  const rateExperience = (value: number) => {
    setRating(value);
    window.localStorage.setItem(`menutap.kiosk.experience-rating.${order.id}`, String(value));
  };
  return (
    <section data-testid="kiosk-confirmation-screen" data-guided-test="success" data-kiosk-theme={isContrast ? "premium-black" : "light-white"} className={`flex h-full min-h-0 flex-col overflow-hidden ${isContrast ? "bg-[#070B14] text-white" : "bg-white text-slate-950"}`}>
      <KioskHeader business={business} capability={capability} logoImage={logoImage} isContrast={isContrast} onSupport={onSupport} />
      <main className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-[3%]">
        <div className="grid w-full max-w-4xl gap-5 rounded-[26px] border border-slate-200 bg-white p-[clamp(20px,3vw,42px)] text-slate-950 shadow-[0_24px_70px_rgba(0,0,0,0.22)] md:grid-cols-[0.58fr_1.42fr] md:items-center">
          <div className="grid place-items-center">
            <div
              className="grid aspect-square w-[min(42vw,220px)] place-items-center rounded-full p-3"
              style={{ background: `conic-gradient(var(--kiosk-accent) ${progress}%, var(--kiosk-accent-soft) 0)` }}
            >
              <div className="grid h-full w-full place-items-center rounded-full bg-white text-center shadow-inner">
                <CheckCircle2 size={72} className="text-emerald-700" />
              </div>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-black uppercase tracking-[0.12em] text-[var(--kiosk-accent)]">
              {confirmation.referenceLabel} #{confirmation.referenceValue}
            </p>
            <h2 className="mt-3 text-[clamp(30px,4vw,52px)] font-black leading-[1.03]">{confirmation.title}</h2>
            <p className="mt-3 text-base font-semibold leading-7 text-slate-600">{confirmation.message}</p>
            <div className={`mt-5 grid gap-3 ${showEstimatedTime ? "sm:grid-cols-2" : ""}`}>
              {showEstimatedTime && (
                <div className="rounded-2xl bg-slate-100 p-5">
                  <p className="text-xs font-black uppercase tracking-[0.1em] text-slate-500">{confirmation.statusLabel}</p>
                  <p className="mt-2 text-3xl font-black">{confirmation.statusValue}</p>
                  <p className="mt-1 text-sm font-bold text-slate-500">{confirmation.statusMeta}</p>
                </div>
              )}
              <div className="rounded-2xl bg-[var(--kiosk-accent-soft)] p-5">
                <p className="text-base font-black">{confirmation.nextTitle}</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{confirmation.nextBody}</p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-lg font-black text-slate-950">Rate your experience</p>
              <p className="mt-1 text-sm font-bold text-slate-600">
                {rating ? `Thank you. You rated this experience ${rating} out of 5.` : "Your rating is counted only after this order has been placed."}
              </p>
              <div className="mt-3 flex gap-2" aria-label="Rate your experience">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => rateExperience(value)}
                    aria-label={`${value} star${value === 1 ? "" : "s"}`}
                    className={`grid h-12 w-12 place-items-center rounded-xl border ${rating != null && value <= rating ? "border-amber-400 bg-amber-400 text-slate-950" : "border-amber-200 bg-white text-amber-500"}`}
                  >
                    <Star size={23} fill={rating != null && value <= rating ? "currentColor" : "none"} />
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={onStartNew}
              className="mt-5 flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[var(--kiosk-accent)] px-6 text-base font-black text-[var(--kiosk-accent-foreground)] shadow-[0_18px_34px_var(--kiosk-accent-ring)] transition hover:bg-[var(--kiosk-accent-hover)]"
            >
              {capability.serviceBookingEnabled ? "Book Another Service" : "Start New Order"}
              <ArrowRight size={22} />
            </button>
            <p className="mt-3 text-center text-sm font-bold text-slate-500">Returning to the welcome screen in {countdown}s</p>
          </div>
        </div>
      </main>
    </section>
  );
}

function SupportDialog({ business, onClose }: { business: Business; onClose: () => void }) {
  const phone = business.contact_phone?.trim();
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-[#0F172A]/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[28px] border border-[#E2E8F0] bg-white p-5 text-[#0F172A] shadow-[0_28px_70px_rgba(15,23,42,0.20)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase text-[#64748B]">Contact</p>
            <h2 className="mt-1 text-2xl font-black">Need assistance?</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full border border-[#E2E8F0] bg-white text-[#0F172A]"
            aria-label="Close contact"
          >
            <X size={18} />
          </button>
        </div>
        <div className="mt-5 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
          <p className="text-sm font-bold text-[#64748B]">Ask counter staff for assistance, or call the business directly.</p>
          <p className="mt-3 text-xl font-black">{phone || "Counter assistance is available"}</p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onClose} className="min-h-12 rounded-2xl border border-[#E2E8F0] bg-white px-4 text-sm font-black">
            Back to kiosk
          </button>
          {phone ? (
            <a href={`tel:${phone}`} className="grid min-h-12 place-items-center rounded-2xl bg-[#050608] px-4 text-sm font-black text-white">
              Call business
            </a>
          ) : (
            <button type="button" onClick={onClose} className="min-h-12 rounded-2xl bg-[#050608] px-4 text-sm font-black text-white">
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuScreen({
  business,
  orientation,
  capability,
  logoImage,
  categories,
  tabs,
  products,
  catalogProducts,
  activeCategory,
  showFilters,
  filters,
  quantity,
  productQuantities,
  total,
  symbol,
  isOpen,
  selectedProductId,
  error,
  onTab,
  onToggleFilters,
  onSupport,
  onFilterChange,
  onResetFilters,
  onSelect,
  onAdd,
  onIncrement,
  onDecrement,
  onCart,
}: {
  business: Business;
  orientation: KioskScreenOrientation;
  capability: BusinessCapability;
  logoImage: string | null;
  categories: Category[];
  tabs: CategoryTab[];
  products: Product[];
  catalogProducts: Product[];
  activeCategory: string;
  showFilters: boolean;
  filters: KioskFilters;
  quantity: number;
  productQuantities: Record<string, number>;
  total: number;
  symbol: string;
  isOpen: boolean;
  selectedProductId: string | null;
  error: string | null;
  onTab: (value: string) => void;
  onToggleFilters: () => void;
  onSupport: () => void;
  onFilterChange: <Key extends keyof KioskFilters>(key: Key, value: KioskFilters[Key]) => void;
  onResetFilters: () => void;
  onSelect: (id: string) => void;
  onAdd: (product: Product) => void;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onCart: () => void;
}) {
  const kioskTheme = parseKioskThemeSelection(business.kiosk_theme);
  const displaySettings = resolveKioskDisplaySettings(business.type, {
    selectedLayout: kioskTheme.templateRecognized ? (kioskTheme.templateId as KioskLayoutId) : undefined,
    cardStyle: kioskTheme.cardStyle,
    categoryStyle: kioskTheme.categoryStyle,
    productDisplayStyle: kioskTheme.productDisplayStyle,
    actionBehavior: kioskTheme.actionBehavior,
  });
  const templateId = displaySettings.selectedLayout;
  const isDark = kioskTheme.mode === "premium_contrast";
  const isPortrait = orientation === "portrait";
  const kioskConfig = kioskBusinessConfig(business.type);
  const cardStyle = effectiveKioskCardStyle(business.type, displaySettings.cardStyle);
  const availability = kioskAvailabilityCopy(business, isOpen);
  const activeLabel =
    activeCategory === "all"
      ? `All ${kioskConfig.itemNounPlural}`
      : activeCategory === "popular"
        ? `Popular ${kioskConfig.itemNounPlural}`
        : tabLabel(tabs, activeCategory);
  const visibleTabs = tabs;
  const selectedTab =
    activeCategory === "all" || visibleTabs.some((tab) => tab.id === activeCategory) ? activeCategory : "all";
  const currentProducts = products;
  const checkoutEnabled = business.kiosk_order_settings?.checkout_enabled !== false && business.kiosk_order_settings?.checkout_mode !== "display";
  const productItems = currentProducts.map((product) => {
    const item = mapProductToKioskCarouselItem(
      product,
      business.type,
      productQuantities[product.id] ?? 0,
      business.display_show_category_images === false ? undefined : kioskProductImage(product, categories, catalogProducts) ?? undefined
    );
    return {
      ...item,
      imageUrl: business.display_show_category_images === false ? undefined : item.imageUrl,
      description: business.display_show_item_descriptions === false ? undefined : item.description,
      showPrice: business.display_show_prices !== false,
      disabled: item.disabled || !checkoutEnabled,
      hideActions: !checkoutEnabled,
      statusLabel: !checkoutEnabled ? "Ordering disabled" : item.statusLabel,
    };
  });
  const categoryItems: KioskCategoryCarouselItem[] = visibleTabs.map((tab) => {
    const product = catalogProducts.find((item) =>
      tab.id === "deals" ? isDealProduct(item) && Boolean(item.primary_image_path) : item.category_id === tab.id && Boolean(item.primary_image_path)
    );
    return {
      id: tab.id,
      name: tab.label,
      imageUrl: business.display_show_category_images === false ? undefined : tab.imageUrl || (product ? assetUrl(product.primary_image_path) || undefined : undefined),
      itemCount:
        tab.id === "deals"
          ? catalogProducts.filter(isDealProduct).length
          : catalogProducts.filter((item) => item.category_id === tab.id).length,
    };
  });
  const productById = new Map(currentProducts.map((product) => [product.id, product]));
  const addMappedItem = (item: KioskCarouselItem) => {
    const product = productById.get(String(item.id));
    if (product) onAdd(product);
  };
  const incrementMappedItem = (item: KioskCarouselItem) => onIncrement(String(item.id));
  const decrementMappedItem = (item: KioskCarouselItem) => onDecrement(String(item.id));
  const layoutProps = {
    business,
    capability,
    tabs: visibleTabs,
    products: currentProducts,
    activeCategory: selectedTab,
    activeLabel,
    showFilters,
    filters,
    productQuantities,
    symbol,
    isOpen,
    isDark,
    selectedProductId,
    productItems,
    categoryItems,
    hasCatalogItems: catalogProducts.length > 0,
    cardStyle,
    categoryStyle: displaySettings.categoryStyle,
    productDisplayStyle: displaySettings.productDisplayStyle,
    flowType: kioskConfig.flowType,
    onTab,
    onToggleFilters,
    onSupport,
    onFilterChange,
    onResetFilters,
    onSelect,
    onAdd,
    onDecrement,
    onAddMappedItem: addMappedItem,
    onIncrementMappedItem: incrementMappedItem,
    onDecrementMappedItem: decrementMappedItem,
    orientation,
  };

  return (
    <div data-testid="kiosk-menu-screen" data-kiosk-theme={isDark ? "premium-black" : "light-white"} className={`flex h-full flex-col overflow-hidden ${isDark ? "bg-[#070B14] text-white" : "bg-white text-[#0F172A]"}`}>
      <KioskHeader business={business} capability={capability} logoImage={logoImage} isContrast={isDark} onSupport={onSupport} />

      <main data-testid="kiosk-menu-content" className={`kiosk-readable-text relative min-h-0 flex-1 overflow-hidden ${isPortrait ? "p-[2%]" : "px-[2.1%] pb-[1.2%] pt-[1.4%]"}`}>
        {error && (
          <div className="absolute left-[2%] right-[2%] top-[1%] z-20 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] font-bold text-rose-700">
            {error}
          </div>
        )}
        {!isOpen && (
          <div className="absolute left-[2%] right-[2%] top-[1%] z-20 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-bold text-amber-800">
            {availability.message}
          </div>
        )}
        {showFilters && <KioskFilterOverlay capability={capability} filters={filters} onFilterChange={onFilterChange} onResetFilters={onResetFilters} onClose={onToggleFilters} />}
        {templateId === "left_category" ? (
          <LandscapeLeftCategoryLayout {...layoutProps} />
        ) : templateId === "category_gate" ? (
          <LandscapeCategoryGateLayout {...layoutProps} />
        ) : (
          <LandscapeTopCategoryLayout {...layoutProps} />
        )}
      </main>

      <footer data-testid="kiosk-bottom-bar" className={`kiosk-readable-text flex shrink-0 items-center justify-center border-t px-[2%] shadow-[0_-10px_30px_rgba(15,23,42,0.06)] ${isPortrait ? "min-h-[128px] py-4" : "min-h-[88px] py-2"} ${isDark ? "border-white/10 bg-[#0D1320]" : "border-[#E9ECEF] bg-white"}`}>
        <button
          type="button"
          data-guided-test="open-cart"
          onClick={onCart}
          disabled={quantity === 0}
          className={`grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center rounded-[24px] border text-left shadow-[0_18px_38px_rgba(0,0,0,0.32)] transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--kiosk-accent-ring)] disabled:cursor-not-allowed disabled:opacity-55 ${isDark ? "border-[#E5E7EB] bg-white text-[#111827] hover:bg-[#F8FAFC]" : "border-black/80 bg-gradient-to-b from-[#252932] to-[#171A20] text-white shadow-[0_18px_38px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.14)] hover:from-[#2D323C] hover:to-[#1C2027]"} ${isPortrait ? "min-h-[104px] max-w-[97%] gap-3 px-5" : "min-h-[66px] max-w-[720px] gap-3 px-5"}`}
          aria-label={quantity === 0 ? "Your cart is empty" : "View cart and continue"}
        >
          <span className={`flex min-w-0 items-center ${isPortrait ? "gap-4" : "gap-3"}`}>
            <ShoppingCart size={isPortrait ? 34 : 26} className="shrink-0" strokeWidth={2.15} />
            <span className={`${isPortrait ? "text-[clamp(24px,2.35vw,37px)]" : "text-[clamp(17px,1.55vw,24px)]"} truncate font-black leading-none`}>View Cart</span>
          </span>
          <span className={`whitespace-nowrap rounded-[16px] font-black shadow-[0_2px_7px_rgba(0,0,0,0.18)] ${isPortrait ? "px-5 py-3 text-[clamp(16px,1.35vw,22px)]" : "px-3 py-2 text-[clamp(11px,0.95vw,14px)]"} ${isDark ? "bg-[#EEF1F5] text-[#111827]" : "bg-white text-[#111827]"}`}>
            {quantity} {quantity === 1 ? "item" : "items"}
          </span>
          <span className={`flex min-w-0 items-center border-l ${isPortrait ? "pl-5" : "pl-3"} ${isDark ? "border-[#CBD5E1]" : "border-white/30"}`}>
            <span className={`${isPortrait ? "text-[clamp(26px,2.7vw,42px)]" : "text-[clamp(17px,1.55vw,24px)]"} truncate font-black leading-none`}>{money(total, symbol)}</span>
          </span>
        </button>
      </footer>
    </div>
  );
}

function ConfirmRemovalDialog({
  itemName,
  onCancel,
  onConfirm,
}: {
  itemName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/48 p-4 backdrop-blur-sm">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remove-item-title"
        className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-6 text-slate-950 shadow-[0_30px_90px_rgba(15,23,42,0.28)]"
      >
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 text-rose-600">
          <Trash2 size={22} />
        </span>
        <h2 id="remove-item-title" className="mt-5 text-2xl font-black tracking-tight">
          Remove this item?
        </h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
          {itemName} will be removed from this order.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-13 rounded-2xl border border-slate-200 bg-white px-5 text-sm font-black"
          >
            Keep item
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-13 rounded-2xl bg-rose-600 px-5 text-sm font-black text-white shadow-[0_12px_24px_rgba(225,29,72,0.2)]"
          >
            Remove item
          </button>
        </div>
      </section>
    </div>
  );
}

type LandscapeMenuLayoutProps = {
  business: Business;
  capability: BusinessCapability;
  tabs: CategoryTab[];
  products: Product[];
  activeCategory: string;
  activeLabel: string;
  showFilters: boolean;
  filters: KioskFilters;
  productQuantities: Record<string, number>;
  symbol: string;
  isOpen: boolean;
  isDark: boolean;
  selectedProductId: string | null;
  productItems: KioskCarouselItem[];
  categoryItems: KioskCategoryCarouselItem[];
  hasCatalogItems: boolean;
  cardStyle: Exclude<KioskCardStyle, "auto">;
  categoryStyle: KioskCategoryStyle;
  productDisplayStyle: KioskProductDisplayStyle;
  flowType: "cart" | "booking";
  onTab: (value: string) => void;
  onToggleFilters: () => void;
  onSupport: () => void;
  onFilterChange: <Key extends keyof KioskFilters>(key: Key, value: KioskFilters[Key]) => void;
  onResetFilters: () => void;
  onSelect: (id: string) => void;
  onAdd: (product: Product) => void;
  onDecrement: (productId: string) => void;
  onAddMappedItem: (item: KioskCarouselItem) => void;
  onIncrementMappedItem: (item: KioskCarouselItem) => void;
  onDecrementMappedItem: (item: KioskCarouselItem) => void;
  orientation: KioskScreenOrientation;
};

function LandscapeTopCategoryLayout(props: LandscapeMenuLayoutProps) {
  const isPortrait = props.orientation === "portrait";
  return (
    <div className={`flex h-full min-h-0 flex-col ${isPortrait ? "gap-[clamp(14px,2.2vh,22px)] pt-[clamp(16px,3vh,30px)]" : "gap-2 pt-0"}`}>
      {isPortrait ? (
        <div className="flex min-h-[clamp(52px,7vh,64px)] shrink-0 items-center gap-[1.5%]">
          <div className="min-w-0 flex-1">
            <h2 className={`truncate text-[clamp(28px,2.6vw,42px)] font-black ${props.isDark ? "text-white" : "text-[#0F172A]"}`}>
              {kioskBrowseTitle(props.business.type)}
            </h2>
          </div>
          <KioskFilterButton {...props} className="w-[30%]" />
        </div>
      ) : (
        <div className="flex min-h-[34px] shrink-0 items-center">
          <h2 className={`truncate text-[clamp(18px,1.45vw,24px)] font-black leading-tight ${props.isDark ? "text-white" : "text-[#0F172A]"}`}>
            {kioskBrowseTitle(props.business.type)}
          </h2>
        </div>
      )}
      <KioskCategoryCarousel
        categories={props.categoryItems}
        activeCategoryId={props.activeCategory}
        onCategoryChange={(id) => props.onTab(String(id))}
        businessType={props.business.type}
        categoryStyle={props.categoryStyle}
        density={isPortrait ? "normal" : "compact"}
        className="shrink-0"
      />
      <KioskItemCollection {...props} title={props.activeLabel} />
    </div>
  );
}

function LandscapeLeftCategoryLayout(props: LandscapeMenuLayoutProps) {
  const isPortrait = props.orientation === "portrait";
  return (
    <div className={`grid h-full min-h-0 grid-cols-1 gap-[2%] ${isPortrait ? "md:grid-cols-[22%_1fr]" : "md:grid-cols-[9%_1fr]"}`}>
      <aside data-testid="kiosk-side-category-rail" className={`hidden min-h-0 flex-col overflow-y-auto pr-1 pt-1 no-scrollbar md:flex ${isPortrait ? "gap-4" : "gap-2"}`}>
        {props.tabs.slice(0, 8).map((tab) => <KioskSideCategory key={tab.id} tab={tab} active={props.activeCategory === tab.id} {...props} />)}
      </aside>
      <section className={`flex min-h-0 flex-col ${isPortrait ? "gap-[clamp(14px,2vh,20px)]" : "gap-[clamp(10px,1.4vh,16px)]"}`}>
        <KioskCategoryCarousel
          categories={props.categoryItems}
          activeCategoryId={props.activeCategory}
          onCategoryChange={(id) => props.onTab(String(id))}
          businessType={props.business.type}
          categoryStyle={props.categoryStyle}
          density={isPortrait ? "normal" : "compact"}
          className="md:hidden"
        />
        <div className={`${isPortrait ? "min-h-[56px]" : "min-h-[42px]"} flex shrink-0 items-center justify-between gap-[2%]`}>
          <div className="min-w-0">
            <h2 className={`truncate ${isPortrait ? "text-3xl" : "text-[clamp(28px,2.4vw,38px)]"} font-black ${props.isDark ? "text-white" : "text-[#0F172A]"}`}>{props.activeLabel}</h2>
          </div>
          <KioskFilterButton {...props} className={isPortrait ? "w-[28%]" : "w-[15%]"} />
        </div>
        <KioskItemCollection {...props} title={props.activeLabel} hideHeading sideRail />
      </section>
    </div>
  );
}

function LandscapeCategoryGateLayout(props: LandscapeMenuLayoutProps) {
  const categorySelected = props.activeCategory !== "all";

  if (!categorySelected) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-[2%]">
        <div className={`${props.orientation === "portrait" ? "min-h-20" : "min-h-12"} flex shrink-0 items-center`}>
          <div className="min-w-0">
            <h2 className={`truncate ${props.orientation === "portrait" ? "text-xl" : "text-2xl"} font-black`}>Choose a category</h2>
            <p className={`mt-1 font-bold ${props.orientation === "portrait" ? "text-sm" : "text-xs"} ${props.isDark ? "text-white/60" : "text-[#64748B]"}`}>Tap a category to continue</p>
          </div>
        </div>
        <div data-testid="kiosk-category-gate" className={`grid min-h-0 flex-1 content-start overflow-y-auto pr-1 no-scrollbar ${
          props.orientation === "portrait" ? "grid-cols-2 gap-5" : "grid-cols-4 gap-3"
        }`}>
          {props.categoryItems.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => props.onTab(String(category.id))}
              className={`${props.orientation === "portrait" ? "aspect-[5/4] rounded-2xl" : "aspect-[5/3.05] rounded-xl"} relative min-w-0 overflow-hidden border border-slate-200 bg-white text-left shadow-[0_14px_34px_rgba(15,23,42,0.08)] transition hover:-translate-y-1 hover:border-[var(--kiosk-accent)] hover:shadow-[0_20px_42px_var(--kiosk-accent-ring)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--kiosk-accent-ring)]`}
            >
              <span
                className="absolute inset-0 grid place-items-center bg-[linear-gradient(145deg,#F8FAFC,#E2E8F0)] bg-cover bg-center text-slate-500"
                style={category.imageUrl ? { backgroundImage: `url(${category.imageUrl})` } : undefined}
              >
                {!category.imageUrl && <Grid2X2 size={36} />}
              </span>
              <span className={`${props.orientation === "portrait" ? "min-h-20 px-4 pb-4 pt-10" : "min-h-12 px-3 pb-3 pt-7"} absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-slate-950/94 via-slate-950/58 to-transparent text-white`}>
                <span className="min-w-0">
                  <span className={`${props.orientation === "portrait" ? "text-[clamp(20px,2vw,30px)]" : "text-[clamp(14px,1.35vw,20px)]"} line-clamp-2 break-words font-black leading-[1.05]`}>{category.name}</span>
                </span>
                <ArrowRight size={26} className="shrink-0 text-white" />
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-[1.5%]">
      <div className={`${props.orientation === "portrait" ? "min-h-16" : "min-h-12"} flex shrink-0 items-center gap-[1.5%]`}>
        <button
          type="button"
          onClick={() => props.onTab("all")}
          className={`${props.orientation === "portrait" ? "min-h-14 rounded-2xl px-4" : "min-h-10 rounded-xl px-3"} flex shrink-0 items-center gap-2 border border-slate-200 bg-white text-sm font-black shadow-sm`}
        >
          <ArrowLeft size={18} />
          Categories
        </button>
      </div>
      <KioskItemCollection {...props} title={props.activeLabel} />
    </div>
  );
}

function KioskFilterButton(props: LandscapeMenuLayoutProps & { className?: string }) {
  return (
    <button type="button" onClick={props.onToggleFilters} className={`flex items-center justify-center gap-2 bg-[var(--kiosk-accent)] font-black text-[var(--kiosk-accent-foreground)] shadow-[0_10px_22px_var(--kiosk-accent-ring)] transition hover:bg-[var(--kiosk-accent-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--kiosk-accent-ring)] ${props.orientation === "portrait" ? "h-[60%] min-h-14 rounded-2xl px-4 text-base" : "min-h-11 rounded-xl px-4 text-sm"} ${props.className ?? ""}`}>
      <SlidersHorizontal size={18} />
      Filters
    </button>
  );
}

function kioskBrowseTitle(type: BusinessType) {
  const titles: Record<BusinessType, string> = {
    restaurant: "Select your meal",
    cafe: "Select your meal",
    retail: "Select your products",
    bakery: "Select your meal",
    pizza: "Select your meal",
    burger: "Select your meal",
    grocery: "Select your groceries",
    salon: "Select your service",
    ice_cream: "Select your meal",
    other: "Select your items",
  };
  return titles[type] ?? "Select your items";
}

function KioskSectionHeading(props: LandscapeMenuLayoutProps & { title: string }) {
  const isPortrait = props.orientation === "portrait";
  if (!isPortrait) {
    return (
      <div className="flex min-h-[36px] shrink-0 items-center justify-between gap-3">
        <h2 className={`min-w-0 truncate text-[clamp(18px,1.5vw,24px)] font-black leading-tight ${props.isDark ? "text-white" : "text-[#0F172A]"}`}>{props.title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {props.activeCategory !== "all" && (
            <button type="button" onClick={() => props.onTab("all")} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-black text-[var(--kiosk-accent)]">
              View all <ArrowRight size={13} />
            </button>
          )}
          <button type="button" onClick={props.onToggleFilters} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-[var(--kiosk-accent)] px-4 text-xs font-black text-[var(--kiosk-accent-foreground)] shadow-[0_10px_22px_var(--kiosk-accent-ring)] transition hover:bg-[var(--kiosk-accent-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--kiosk-accent-ring)]">
            <SlidersHorizontal size={15} />
            Filters
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`relative flex shrink-0 items-center justify-center gap-4 ${isPortrait ? "min-h-[clamp(44px,6vh,64px)]" : "min-h-[34px]"}`}>
      <div className={`${isPortrait ? "px-[142px]" : "px-16"} min-w-0 text-center`}>
        <h2 className={`truncate ${isPortrait ? "text-3xl" : "text-[clamp(18px,1.5vw,24px)]"} font-black leading-tight ${props.isDark ? "text-white" : "text-[#0F172A]"}`}>{props.title}</h2>
      </div>
      <div className="absolute right-0 flex items-center gap-2">
        {props.activeCategory !== "all" && (
          <button type="button" onClick={() => props.onTab("all")} className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[#E2E8F0] bg-white px-4 text-sm font-black text-[var(--kiosk-accent)]">
            View all <ArrowRight size={16} />
          </button>
        )}
        <button type="button" onClick={props.onToggleFilters} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--kiosk-accent)] px-4 text-sm font-black text-[var(--kiosk-accent-foreground)] shadow-[0_10px_22px_var(--kiosk-accent-ring)] transition hover:bg-[var(--kiosk-accent-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--kiosk-accent-ring)]">
          <SlidersHorizontal size={16} />
          Filters
        </button>
      </div>
    </div>
  );
}

function KioskItemCollection(
  props: LandscapeMenuLayoutProps & {
    title: string;
    forceDisplayStyle?: KioskProductDisplayStyle;
    hideHeading?: boolean;
    sideRail?: boolean;
  }
) {
  const displayStyle = props.forceDisplayStyle ?? props.productDisplayStyle;
  if (!props.productItems.length) {
    return (
      <KioskEmptyState
        hasCatalogItems={props.hasCatalogItems}
        onSupport={props.onSupport}
      />
    );
  }

  const denseMode = displayStyle === "dense_fast_add_list";
  const sideRailPortrait = Boolean(props.sideRail && props.orientation === "portrait");
  const landscapeGridClass = denseMode
    ? "grid-cols-[repeat(auto-fit,minmax(152px,176px))] auto-rows-[188px] gap-3.5 pb-6 pt-1.5"
    : displayStyle === "simple_item"
      ? "grid-cols-[repeat(auto-fit,minmax(158px,182px))] auto-rows-[220px] gap-3.5 pb-6 pt-1.5"
      : "grid-cols-[repeat(auto-fit,minmax(178px,212px))] auto-rows-[252px] gap-3.5 pb-6 pt-1.5";
  const productCardDensity =
    props.orientation === "portrait"
      ? props.business.display_show_item_descriptions === false
        ? "compact"
        : "normal"
      : "landscape";
  return (
    <section className={`flex min-h-0 flex-1 flex-col ${props.orientation === "portrait" ? "gap-4" : "gap-2.5"}`}>
      {!props.hideHeading && <KioskSectionHeading {...props} title={props.title} />}
      <div
        data-testid="kiosk-product-grid"
        className={`grid min-h-0 flex-1 content-start justify-start overflow-y-auto px-1 no-scrollbar ${
          props.orientation !== "portrait"
            ? landscapeGridClass
            : denseMode
              ? sideRailPortrait
                ? "grid-cols-3 auto-rows-[220px] gap-4 pb-2 pt-2"
                : "grid-cols-4 auto-rows-[250px] gap-6 pb-2 pt-3"
              : sideRailPortrait
                ? displayStyle === "simple_item"
                  ? "grid-cols-3 auto-rows-[214px] gap-4 pb-2 pt-2"
                  : "grid-cols-2 auto-rows-[300px] gap-5 pb-2 pt-2"
                : "grid-cols-3 auto-rows-[390px] gap-6 pb-2 pt-3"
        }`}
      >
        {props.productItems.map((item) => (
          <KioskProductCard
            key={item.id}
            item={item}
            businessType={props.business.type}
            currencySymbol={props.symbol}
            cardStyle={denseMode ? "fast_add" : props.cardStyle}
            displayStyle={displayStyle}
            density={productCardDensity}
            className={sideRailPortrait ? "rounded-xl" : undefined}
            onAdd={props.onAddMappedItem}
            onIncrease={props.onIncrementMappedItem}
            onDecrease={props.onDecrementMappedItem}
          />
        ))}
      </div>
    </section>
  );
}

function KioskSideCategory(props: LandscapeMenuLayoutProps & { tab: CategoryTab; active: boolean }) {
  return (
    <button type="button" onClick={() => props.onTab(props.tab.id)} className={`relative aspect-[5/4] overflow-hidden border text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--kiosk-accent-ring)] ${props.orientation === "portrait" ? "min-h-12 rounded-2xl" : "min-h-8 rounded-xl"} ${props.categoryStyle === "motion_tabs" || props.categoryStyle === "simple_button" ? props.active ? "-translate-y-0.5 scale-[1.02]" : "" : ""} ${props.active ? "border-[var(--kiosk-accent)] shadow-[0_14px_28px_var(--kiosk-accent-ring)] ring-2 ring-[var(--kiosk-accent-ring)]" : props.isDark ? "border-white/10 bg-white/8" : "border-[#E2E8F0] bg-white"}`}>
      <span
        className="absolute inset-0 grid place-items-center bg-[var(--kiosk-accent-soft)] bg-cover bg-center text-[var(--kiosk-accent)]"
        style={props.tab.imageUrl ? { backgroundImage: `url(${props.tab.imageUrl})` } : undefined}
      >
        {!props.tab.imageUrl && props.tab.icon}
      </span>
      <span className={`${props.orientation === "portrait" ? "px-2 pb-3 pt-8" : "px-1.5 pb-1.5 pt-5"} absolute inset-x-0 bottom-0 flex min-h-[46%] items-end justify-center bg-gradient-to-t from-slate-950/92 via-slate-950/58 to-transparent text-center text-white`}>
        <span className={`${props.orientation === "portrait" ? "text-[clamp(12px,1.05vw,18px)]" : "text-[clamp(9px,0.72vw,12px)]"} line-clamp-2 break-words font-black leading-tight`}>{props.tab.label}</span>
      </span>
      {props.active && <span className="absolute inset-x-3 bottom-0 h-1 rounded-t-full bg-[var(--kiosk-accent)]" />}
    </button>
  );
}

function KioskEmptyState({
  compact = false,
  hasCatalogItems,
  onSupport,
}: {
  compact?: boolean;
  hasCatalogItems: boolean;
  onSupport: () => void;
}) {
  return (
    <div className={`grid place-items-center rounded-3xl border border-[#E2E8F0] bg-white/95 p-6 text-center text-[#0F172A] shadow-[0_16px_36px_rgba(15,23,42,0.06)] ${compact ? "col-span-3 h-full" : "min-h-56"}`}>
      <div className="max-w-md">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[var(--kiosk-accent-soft)] text-[var(--kiosk-accent)]">
          {hasCatalogItems ? <Grid2X2 size={30} /> : <Utensils size={30} />}
        </span>
        <p className="mt-4 text-xl font-black">
          {hasCatalogItems ? "No matching items found" : "No menu items available right now"}
        </p>
        <p className="mt-2 text-sm font-semibold text-[#64748B]">
          {hasCatalogItems ? "Try another category." : "Please ask staff for help."}
        </p>
        {!hasCatalogItems && (
          <button
            type="button"
            onClick={onSupport}
            className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--kiosk-accent)] px-5 text-sm font-black text-[var(--kiosk-accent-foreground)] shadow-[0_12px_24px_var(--kiosk-accent-ring)] transition hover:bg-[var(--kiosk-accent-hover)]"
          >
            <Phone size={18} />
            Call Staff
          </button>
        )}
      </div>
    </div>
  );
}

function PaytmQrPaymentScreen({
  business,
  logoImage,
  status,
  qr,
  amount,
  symbol,
  orderNumber,
  onBack,
  onRetry,
  onSupport,
}: {
  business: Business;
  logoImage: string | null;
  status: string;
  qr?: { qr_data?: string; amount?: string; reference_id?: string; expires_at?: string | null } | null;
  amount: number;
  symbol: string;
  orderNumber: string | number;
  onBack: () => void;
  onRetry: () => void;
  onSupport: () => void;
}) {
  const failed = ["failed", "cancelled", "expired"].includes(status);
  const paid = status === "paid";
  const qrData = qr?.qr_data || "";
  const qrIsImage = /^https?:\/\//i.test(qrData) || qrData.startsWith("data:image");
  return (
    <div data-testid="kiosk-paytm-screen" className="flex h-full min-h-0 flex-col bg-white text-[#0F172A]">
      <KioskHeader business={business} capability={businessCapabilitiesFor(business)} logoImage={logoImage} isContrast={false} onSupport={onSupport} />
      <main className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-[3%]">
        <section className="w-full max-w-[720px] rounded-[28px] border border-[#E2E8F0] bg-white p-6 text-center shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-[var(--kiosk-accent-soft)] text-[var(--kiosk-accent)]">
            <QrCode size={34} />
          </span>
          <h2 className="mt-5 text-3xl font-black">Paytm Dynamic QR</h2>
          <p className="mt-2 text-sm font-bold text-[#64748B]">Order {orderNumber} · {money(amount, symbol)}</p>
          <div className="mx-auto mt-6 grid min-h-[280px] max-w-[320px] place-items-center rounded-[24px] border border-[#E2E8F0] bg-[#F8FAFC] p-4">
            {qrIsImage ? (
              <Image src={qrData} alt="Paytm payment QR" width={260} height={260} sizes="260px" unoptimized className="h-full max-h-[260px] w-full object-contain" />
            ) : qrData ? (
              <div className="break-all rounded-2xl bg-white p-4 text-xs font-black leading-5 text-[#0F172A] shadow-sm">{qrData}</div>
            ) : (
              <Loader2 className="animate-spin text-[#64748B]" size={40} />
            )}
          </div>
          <div className="mt-5 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
            <p className="text-sm font-black">
              {paid ? "Payment verified" : failed ? "Payment not completed" : qrData ? "Waiting for backend confirmation" : "Creating secure QR"}
            </p>
            <p className="mt-1 text-xs font-bold text-[#64748B]">
              The kiosk only updates after Paytm webhook/status verification from the backend.
            </p>
          </div>
          {failed && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={onBack} className="min-h-12 rounded-2xl border border-[#E2E8F0] bg-white px-4 text-sm font-black">
                Back to payment
              </button>
              <button type="button" onClick={onRetry} className="min-h-12 rounded-2xl bg-[#050608] px-4 text-sm font-black text-white">
                Retry
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function KioskFilterOverlay({
  capability,
  filters,
  onFilterChange,
  onResetFilters,
  onClose,
}: {
  capability: BusinessCapability;
  filters: KioskFilters;
  onFilterChange: <Key extends keyof KioskFilters>(key: Key, value: KioskFilters[Key]) => void;
  onResetFilters: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-[2%] top-[2%] z-30 w-[min(760px,96%)] rounded-3xl border border-[#E2E8F0] bg-white p-4 text-[#0F172A] shadow-[0_22px_54px_rgba(15,23,42,0.18)]">
      <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
        <h3 className="text-base font-black">Filters</h3>
        <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl bg-[#F8FAFC]"><X size={18} /></button>
      </div>
      <div className="grid gap-4 py-4 md:grid-cols-4">
        {capabilityHasAnyFilter(capability, ["veg", "nonVeg", "egg", "vegan", "spicy", "hot", "iced", "milkBased", "nonCoffee"]) && (
          <FilterGroup title={capability.type === "cafe" ? "Drink Type" : capability.showFoodTypeBadges ? "Food Type" : "Type"}>
            {capabilityHasFilter(capability, "veg") && <FilterCheck label="Veg" checked={filters.veg} onChange={() => onFilterChange("veg", !filters.veg)} />}
            {capabilityHasFilter(capability, "nonVeg") && <FilterCheck label="Non-Veg" checked={filters.nonVeg} onChange={() => onFilterChange("nonVeg", !filters.nonVeg)} />}
            {capabilityHasFilter(capability, "egg") && <FilterCheck label="Egg" checked={filters.egg} onChange={() => onFilterChange("egg", !filters.egg)} />}
            {capabilityHasFilter(capability, "vegan") && <FilterCheck label="Vegan" checked={filters.vegan} onChange={() => onFilterChange("vegan", !filters.vegan)} />}
            {capabilityHasFilter(capability, "spicy") && <FilterCheck label="Spicy" checked={filters.spicy} onChange={() => onFilterChange("spicy", !filters.spicy)} />}
            {capabilityHasFilter(capability, "hot") && <FilterCheck label="Hot" checked={filters.hot} onChange={() => onFilterChange("hot", !filters.hot)} />}
            {capabilityHasFilter(capability, "iced") && <FilterCheck label="Iced" checked={filters.iced} onChange={() => onFilterChange("iced", !filters.iced)} />}
            {capabilityHasFilter(capability, "milkBased") && <FilterCheck label="Milk-based" checked={filters.milkBased} onChange={() => onFilterChange("milkBased", !filters.milkBased)} />}
            {capabilityHasFilter(capability, "nonCoffee") && <FilterCheck label="Non-coffee" checked={filters.nonCoffee} onChange={() => onFilterChange("nonCoffee", !filters.nonCoffee)} />}
          </FilterGroup>
        )}
        {capabilityHasFilter(capability, "priceSort") && (
          <FilterGroup title="Price">
            <FilterRadio label="Low to high" checked={filters.priceSort === "low_high"} onChange={() => onFilterChange("priceSort", filters.priceSort === "low_high" ? "none" : "low_high")} />
            <FilterRadio label="High to low" checked={filters.priceSort === "high_low"} onChange={() => onFilterChange("priceSort", filters.priceSort === "high_low" ? "none" : "high_low")} />
          </FilterGroup>
        )}
        {capabilityHasAnyFilter(capability, ["popular", "new", "bestseller", "recommended"]) && (
          <FilterGroup title="Highlights">
            {capabilityHasFilter(capability, "popular") && <FilterCheck label="Popular" checked={filters.popular} onChange={() => onFilterChange("popular", !filters.popular)} />}
            {capabilityHasFilter(capability, "new") && <FilterCheck label="New" checked={filters.new} onChange={() => onFilterChange("new", !filters.new)} />}
            {capabilityHasFilter(capability, "bestseller") && <FilterCheck label="Bestseller" checked={filters.bestseller} onChange={() => onFilterChange("bestseller", !filters.bestseller)} />}
            {capabilityHasFilter(capability, "recommended") && <FilterCheck label="Recommended" checked={filters.recommended} onChange={() => onFilterChange("recommended", !filters.recommended)} />}
          </FilterGroup>
        )}
        {capabilityHasAnyFilter(capability, ["deals", "combos", "discounted", "available"]) && (
          <FilterGroup title="Promotions">
            {capabilityHasFilter(capability, "deals") && <FilterCheck label="Deals" checked={filters.deals} onChange={() => onFilterChange("deals", !filters.deals)} />}
            {capabilityHasFilter(capability, "combos") && <FilterCheck label="Combos" checked={filters.combos} onChange={() => onFilterChange("combos", !filters.combos)} />}
            {capabilityHasFilter(capability, "discounted") && <FilterCheck label="Discounted" checked={filters.discounted} onChange={() => onFilterChange("discounted", !filters.discounted)} />}
            {capabilityHasFilter(capability, "available") && <FilterCheck label="Available" checked={filters.available} onChange={() => onFilterChange("available", !filters.available)} />}
          </FilterGroup>
        )}
      </div>
      <div className="grid gap-3 border-t border-[#E2E8F0] pt-3 sm:grid-cols-2">
        <button type="button" onClick={onResetFilters} className="min-h-12 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 text-sm font-black">Clear All</button>
        <button type="button" onClick={onClose} className="min-h-12 rounded-2xl bg-[#050608] px-4 text-sm font-black text-white">Apply Filters</button>
      </div>
    </div>
  );
}

function CartScreen({
  page,
  onPageChange,
  business,
  capability,
  logoImage,
  cart,
  symbol,
  subtotal,
  tax,
  total,
  orderType,
  orderModes,
  customerName,
  customerPhone,
  orderNotes,
  paymentMethod,
  paymentOptions,
  placing,
  isOpen,
  isContrast,
  canPlaceOrder,
  testMode,
  onBack,
  onOrderType,
  onCustomerName,
  onCustomerPhone,
  onOrderNotes,
  onPaymentMethod,
  onQuantity,
  onRemove,
  onOption,
  onSupport,
  onPlaceOrder,
}: {
  page: KioskPageState;
  onPageChange: (page: KioskPageState) => void;
  business: Business;
  capability: BusinessCapability;
  logoImage: string | null;
  cart: CartItem[];
  symbol: string;
  subtotal: number;
  tax: number;
  total: number;
  orderType: OrderType;
  orderModes: OrderType[];
  customerName: string;
  customerPhone: string;
  orderNotes: string;
  paymentMethod: PaymentMethod;
  paymentOptions: Array<{ id: PaymentMethod; icon: ReactNode; title: string; subtitle: string }>;
  placing: boolean;
  isOpen: boolean;
  isContrast: boolean;
  canPlaceOrder: boolean;
  testMode: boolean;
  onBack: () => void;
  onOrderType: (type: OrderType) => void;
  onCustomerName: (value: string) => void;
  onCustomerPhone: (value: string) => void;
  onOrderNotes: (value: string) => void;
  onPaymentMethod: (method: PaymentMethod) => void;
  onQuantity: (id: string, change: number) => void;
  onRemove: (id: string) => void;
  onOption: (itemId: string, groupId: string, groupName: string, option: ModifierOption) => void;
  onSupport: () => void;
  onPlaceOrder: () => void;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const quantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  const savings = cart.reduce(
    (sum, item) => sum + Math.max(0, Number(item.product.price || 0) - effectivePrice(item.product)) * item.quantity,
    0
  );
  const payableTotal = total;
  const isPaymentStep = page === "payment";
  const isReviewStep = !isPaymentStep;
  const isPortraitCheckout = normalizeKioskScreenOrientation(business.kiosk_screen_orientation) === "portrait";
  const availability = kioskAvailabilityCopy(business, isOpen);
  const addOnsTotal = cart.reduce(
    (sum, item) => sum + item.selectedOptions.reduce((optionSum, option) => optionSum + Number(option.price_delta || 0), 0) * item.quantity,
    0
  );
  const stepTitle = isPaymentStep ? "Payment" : "Your Cart";
  const stepSubtitle = isPaymentStep
    ? `Choose how to pay ${money(payableTotal, symbol)}`
    : `${quantity} ${quantity === 1 ? "item" : "items"} selected - Total ${money(payableTotal, symbol)}`;
  const orderSettings = business.kiosk_order_settings ?? {};
  const paymentMethodAvailable = paymentOptions.some((option) => option.id === paymentMethod);
  const defaultPaymentMethod = paymentOptions[0]?.id ?? "pay_at_counter";
  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [page]);

  useEffect(() => {
    if (!paymentMethodAvailable) {
      onPaymentMethod(defaultPaymentMethod);
    }
  }, [defaultPaymentMethod, onPaymentMethod, paymentMethodAvailable]);

  const checkoutEnabled = orderSettings.checkout_enabled !== false && orderSettings.checkout_mode !== "display";
  const primaryActionLabel = !isOpen
    ? unavailableActionLabel(capability)
    : !checkoutEnabled
      ? "Ordering Disabled"
    : isReviewStep
      ? "Proceed to Payment"
      : testMode ? "Proceed with Test Payment" : "Place Order";
  const primaryDisabled = placing || cart.length === 0 || !isOpen || !checkoutEnabled || (isPaymentStep && !canPlaceOrder);
  const handlePrimaryAction = () => {
    if (isReviewStep) {
      onPageChange("payment");
      return;
    }
    onPlaceOrder();
  };

  return (
    <div data-testid="kiosk-checkout-screen" data-page={page} data-kiosk-theme={isContrast ? "premium-black" : "light-white"} className={`flex h-full flex-col ${isContrast ? "bg-[#070B14] text-white" : "bg-white text-[#0F172A]"}`}>
      <KioskHeader
        business={business}
        capability={capability}
        logoImage={logoImage}
        isContrast={isContrast}
        onSupport={onSupport}
        onBack={() => (isPaymentStep ? onPageChange("cart") : onBack())}
      />

      <div ref={scrollContainerRef} className="kiosk-readable-text min-h-0 flex-1 overflow-y-auto px-[3%] py-[1%] no-scrollbar">
        <CheckoutStepper page={page} isContrast={isContrast} />
        <div className="mb-3 mt-2">
          <h2 className="text-[clamp(28px,2.7vw,42px)] font-black leading-[1.1]">{stepTitle}</h2>
          <p className={`mt-1 text-[clamp(15px,1.45vw,22px)] font-bold leading-[1.3] ${isContrast ? "text-white/68" : "text-[#64748B]"}`}>{stepSubtitle}</p>
        </div>
        {!isOpen && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-lg font-black text-amber-900">{availability.title}</p>
            <p className="mt-1 text-base font-bold leading-6 text-amber-800">{availability.message}</p>
          </div>
        )}

        <div className="kiosk-checkout-layout mx-auto grid w-full max-w-[1500px] grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(350px,410px)] xl:items-start">
          <div className="min-w-0 space-y-4">
            {isReviewStep ? (
              <>
                {cart.length === 0 ? (
                  <div className="grid min-h-60 place-items-center rounded-2xl border border-dashed border-[#E2E8F0] bg-white text-center shadow-sm">
                    <div>
                      <ShoppingCart size={42} className="mx-auto text-[#94A3B8]" />
                      <p className="mt-3 text-2xl font-black">{capability.emptyCartTitle}</p>
                      <button onClick={onBack} className="mt-4 min-h-12 rounded-xl bg-[#050608] px-5 text-base font-black text-white">
                        {capability.addItemsLabel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <section className="rounded-2xl border border-[#E9ECEF] bg-white p-3 text-[#0F172A] shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-black leading-[1.2]">Items in your cart</h3>
                        <p className="mt-1 text-sm font-bold leading-[1.35] text-[#64748B]">{quantity} item{quantity === 1 ? "" : "s"} selected</p>
                      </div>
                      <button type="button" onClick={onBack} className="min-h-10 rounded-xl border border-[#E2E8F0] bg-white px-3 text-sm font-black">Add items</button>
                    </div>
                    <div className="space-y-3">
                    {cart.map((item) => (
                      <PremiumCartItem
                        key={item.id}
                        item={item}
                        capability={capability}
                        symbol={symbol}
                        onQuantity={onQuantity}
                        onRemove={onRemove}
                        onOption={onOption}
                        onAddItems={onBack}
                        addItemsLabel={capability.addItemsLabel}
                        showFoodTypeBadge={capability.showFoodTypeBadges}
                      />
                    ))}
                    </div>
                  </section>
                )}

                <div className="grid gap-4 xl:grid-cols-2">
                  <section className="rounded-2xl border border-[#E9ECEF] bg-white p-4 text-[#0F172A] shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
                    <div className="mb-3 flex items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--kiosk-accent-soft)] text-[var(--kiosk-accent)]">
                        <ShoppingCart size={20} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-xl font-black leading-[1.25]">{capability.orderModeLabel}</h3>
                        <p className="mt-1 text-sm font-bold leading-[1.35] text-[#64748B]">{orderModePrompt(capability)}</p>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {orderModes.map((mode) => {
                        const selected = orderType === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            data-guided-test="order-type"
                            onClick={() => onOrderType(mode)}
                            className={`min-h-24 rounded-2xl border p-3 text-left shadow-sm transition ${
                              selected ? "border-[var(--kiosk-accent)] bg-[var(--kiosk-accent-soft)] ring-2 ring-[var(--kiosk-accent-ring)]" : "border-[#E2E8F0] bg-white"
                            }`}
                          >
                            <span className="flex items-center justify-between gap-3">
                              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-[var(--kiosk-accent)] shadow-sm">{orderModeIcon(mode)}</span>
                              <span className={`grid h-6 w-6 place-items-center rounded-full border-2 ${selected ? "border-[var(--kiosk-accent)]" : "border-[#CBD5E1]"}`}>
                                {selected && <span className="h-3 w-3 rounded-full bg-[var(--kiosk-accent)]" />}
                              </span>
                            </span>
                            <span className="mt-3 block text-base font-black leading-[1.25]">{labelOrderType(mode, capability)}</span>
                            <span className="mt-1 block text-sm font-bold leading-[1.35] text-[#64748B]">{orderModeDescription(mode, capability)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-[#E9ECEF] bg-white p-4 text-[#0F172A] shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
                    <h3 className="text-xl font-black leading-[1.25]">Customer details</h3>
                    <div className="mt-3 grid gap-3">
                      <KioskTextField
                        label={orderSettings.require_customer_name ? "Name required" : "Name"}
                        value={customerName}
                        onChange={onCustomerName}
                        placeholder="Guest name"
                      />
                      <KioskTextField
                        label={orderSettings.require_customer_phone ? "Phone required" : "Phone"}
                        value={customerPhone}
                        onChange={onCustomerPhone}
                        placeholder="Mobile number"
                        inputMode="tel"
                      />
                    </div>
                  </section>
                </div>
                {orderSettings.allow_customer_notes !== false && (
                  <QuickNoteChips
                    businessType={business.type}
                    options={orderSettings.quick_note_chips}
                    value={orderNotes}
                    onChange={onOrderNotes}
                    title="Quick notes"
                  />
                )}
              </>
            ) : (
              <>
                <section className="rounded-2xl border border-[#E9ECEF] bg-white p-5 text-[#0F172A] shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
                  <div className="mb-4 flex items-start gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--kiosk-accent-soft)] text-[var(--kiosk-accent)]">
                      <CreditCard size={22} />
                    </span>
                    <div>
                      <h3 className="text-2xl font-black leading-[1.2]">Payment method</h3>
                      <p className="mt-1.5 text-base font-bold leading-[1.4] text-[#64748B]">Choose one option to place your order</p>
                    </div>
                  </div>
                  {paymentOptions.length === 0 ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
                      No payment method is currently enabled. Please ask staff for assistance.
                    </div>
                  ) : (
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
                      {paymentOptions.map((option) => (
                        <PaymentTile
                          key={option.id}
                          icon={option.icon}
                          title={option.title}
                          subtitle={option.subtitle}
                          selected={paymentMethod === option.id}
                          onSelect={() => onPaymentMethod(option.id)}
                        />
                      ))}
                    </div>
                  )}
                  <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                    <ShieldCheck size={22} className="shrink-0 text-emerald-700" />
                    <div>
                      <p className="text-base font-black leading-[1.3]">Secure payment</p>
                      <p className="mt-0.5 text-sm font-bold leading-[1.45] text-[#64748B]">Payment information is protected.</p>
                    </div>
                  </div>
                </section>
                <section className="grid gap-3 rounded-2xl border border-[#E9ECEF] bg-white p-5 text-[#0F172A] shadow-[0_8px_24px_rgba(0,0,0,0.08)] [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
                  <OrderInfo label="Order ID" value="Assigned after placement" />
                  <OrderInfo label="Order time" value={new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
                  <OrderInfo label="Order type" value={labelOrderType(orderType, capability)} />
                </section>
              </>
            )}
          </div>

          <CheckoutSummaryPanel
            cart={cart}
            business={business}
            capability={capability}
            symbol={symbol}
            subtotal={subtotal}
            addOnsTotal={addOnsTotal}
            savings={savings}
            tax={tax}
            total={payableTotal}
            isPaymentStep={isPaymentStep}
            isContrast={isContrast}
          />
        </div>
      </div>
      <footer data-testid="kiosk-checkout-bottom-bar" className={`kiosk-readable-text flex shrink-0 items-center justify-center border-t px-[2%] shadow-[0_-10px_30px_rgba(15,23,42,0.06)] ${isPortraitCheckout ? "min-h-[128px] py-4" : "min-h-[88px] py-2"} ${isContrast ? "border-white/10 bg-[#0D1320]" : "border-[#E9ECEF] bg-white"}`}>
        <button
          type="button"
          data-guided-test="primary-action"
          onClick={handlePrimaryAction}
          disabled={primaryDisabled}
          className={`grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center rounded-[24px] border text-left shadow-[0_18px_38px_rgba(0,0,0,0.25)] transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--kiosk-accent-ring)] disabled:cursor-not-allowed disabled:opacity-55 ${isPortraitCheckout ? "min-h-[104px] max-w-[97%] gap-3 px-5" : "min-h-[66px] max-w-[720px] gap-3 px-5"} border-[var(--kiosk-accent)] bg-[var(--kiosk-accent)] text-[var(--kiosk-accent-foreground)] hover:bg-[var(--kiosk-accent-hover)]`}
          aria-label={primaryActionLabel}
        >
          <span className={`flex min-w-0 items-center ${isPortraitCheckout ? "gap-4" : "gap-3"}`}>
            {placing ? <Loader2 size={isPortraitCheckout ? 34 : 26} className="shrink-0 animate-spin" /> : <ShoppingCart size={isPortraitCheckout ? 34 : 26} className="shrink-0" strokeWidth={2.15} />}
            <span className={`${isPortraitCheckout ? "text-[clamp(24px,2.35vw,37px)]" : "text-[clamp(17px,1.55vw,24px)]"} truncate font-black leading-none`}>{primaryActionLabel}</span>
          </span>
          <span className={`whitespace-nowrap rounded-[16px] bg-white font-black text-[#111827] shadow-[0_2px_7px_rgba(0,0,0,0.18)] ${isPortraitCheckout ? "px-5 py-3 text-[clamp(16px,1.35vw,22px)]" : "px-3 py-2 text-[clamp(11px,0.95vw,14px)]"}`}>
            {quantity} {quantity === 1 ? "item" : "items"}
          </span>
          <span className={`flex min-w-0 items-center border-l border-white/35 ${isPortraitCheckout ? "pl-5" : "pl-3"}`}>
            <span className={`${isPortraitCheckout ? "text-[clamp(26px,2.7vw,42px)]" : "text-[clamp(17px,1.55vw,24px)]"} truncate font-black leading-none`}>{money(payableTotal, symbol)}</span>
          </span>
        </button>
      </footer>
    </div>
  );
}

function CheckoutStepper({ page, isContrast }: { page: KioskPageState; isContrast: boolean }) {
  const steps = [
    { id: "review", label: "Review" },
    { id: "payment", label: "Payment" },
  ];
  const activeIndex = page === "payment" ? 1 : 0;

  return (
    <div className="grid max-w-xl grid-cols-2 gap-3">
      {steps.map((entry, index) => {
        const active = index === activeIndex;
        const complete = index < activeIndex;
        return (
          <div key={entry.id} className="flex min-w-0 items-center gap-1.5">
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] font-black ${
                complete
                  ? "border-[var(--kiosk-accent)] bg-[var(--kiosk-accent)] text-[var(--kiosk-accent-foreground)]"
                  : active
                    ? "border-[var(--kiosk-accent)] bg-white text-[#050608]"
                    : isContrast
                      ? "border-white/20 bg-white/10 text-white/60"
                      : "border-[#D7DEE8] bg-white text-[#64748B]"
              }`}
            >
              {complete ? <CheckCircle2 size={14} /> : index + 1}
            </span>
      <span className={`min-w-0 truncate text-base font-black leading-[1.3] ${active || complete ? (isContrast ? "text-white" : "text-[#0F172A]") : isContrast ? "text-white/52" : "text-[#64748B]"}`}>
              {entry.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? "font-black" : ""}`}>
      <span className={`min-w-0 break-words leading-[1.45] ${strong ? "text-[#050608]" : "text-[#475569]"}`}>{label}</span>
      <span className={`shrink-0 tabular-nums leading-[1.45] ${strong ? "text-[#050608]" : "text-[#0F172A]"}`}>{value}</span>
    </div>
  );
}

function OrderInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-[#F8FAFC] p-4">
      <p className="text-sm font-black uppercase leading-[1.35] text-[#64748B]">{label}</p>
      <p className="mt-1.5 break-words text-lg font-black leading-[1.3] text-[#0F172A]">{value}</p>
    </div>
  );
}

function CheckoutSummaryPanel({
  cart,
  business,
  capability,
  symbol,
  subtotal,
  addOnsTotal,
  savings,
  tax,
  total,
  isPaymentStep,
  isContrast,
}: {
  cart: CartItem[];
  business: Business;
  capability: BusinessCapability;
  symbol: string;
  subtotal: number;
  addOnsTotal: number;
  savings: number;
  tax: number;
  total: number;
  isPaymentStep: boolean;
  isContrast: boolean;
}) {
  const receiptSettings = business.receipt_settings ?? {};
  const receiptLogo = assetUrl(receiptSettings.logo_path || business.logo_path);
  const title = isPaymentStep ? "Your Bill" : "Order Summary";
  const totalLabel = isPaymentStep ? totalPayableLabel(capability) : totalAmountLabel(capability);

  return (
    <aside data-guided-test="bill-summary" className={`rounded-[24px] border p-3 shadow-[0_14px_34px_rgba(15,23,42,0.08)] ${isContrast ? "border-white/10 bg-[#0D1320] text-white" : "border-[#E5E7EB] bg-white text-[#0F172A]"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {receiptSettings.show_logo !== false && receiptLogo ? (
            <Image src={receiptLogo} alt="" width={40} height={40} sizes="40px" unoptimized className="h-10 w-10 shrink-0 rounded-xl border border-[#E5E7EB] bg-white object-contain p-1" />
          ) : (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--kiosk-accent-soft)] text-[var(--kiosk-accent)]">
              <ShoppingCart size={20} />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-[clamp(20px,1.75vw,28px)] font-black leading-[1.15]">{title}</h3>
            <p className={`mt-1 truncate text-sm font-bold leading-[1.35] ${isContrast ? "text-white/64" : "text-[#64748B]"}`}>{receiptSettings.business_name || business.name}</p>
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-2.5 border-t border-[#E5E7EB] pt-3">
        {cart.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-4 text-center">
            <p className="text-base font-black">No items selected</p>
            <p className="mt-1 text-sm font-bold text-[#64748B]">Add items to review the bill.</p>
          </div>
        ) : (
          cart.map((item) => {
            const image = assetUrl(item.product.primary_image_path) || fallbackProductImage(item.product);
            return (
              <div key={`summary-${item.id}`} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-2xl bg-[#F8FAFC] p-2.5">
                <div className="h-12 w-12 overflow-hidden rounded-xl bg-white bg-cover bg-center shadow-inner" style={image ? { backgroundImage: `url(${image})` } : undefined} />
                <div className="min-w-0">
                  <p className="truncate text-base font-black leading-[1.3] text-[#0F172A]">{item.product.name}</p>
                  <p className="mt-0.5 text-sm font-bold leading-[1.4] text-[#64748B]">{item.quantity} item{item.quantity === 1 ? "" : "s"}</p>
                  {item.selectedOptions.length > 0 && (
                    <p className="mt-1 line-clamp-2 text-xs font-semibold leading-[1.45] text-[#64748B]">
                      {item.selectedOptions.map((option) => option.name).join(", ")}
                    </p>
                  )}
                </div>
                <p className="shrink-0 text-base font-black text-[#0F172A]">{money(cartItemPrice(item) * item.quantity, symbol)}</p>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-3 space-y-1.5 border-t border-[#E5E7EB] pt-3 text-base font-bold">
        <SummaryRow label="Subtotal" value={money(Math.max(0, subtotal - addOnsTotal), symbol)} />
        {addOnsTotal > 0 && <SummaryRow label="Add-ons" value={money(addOnsTotal, symbol)} />}
        {savings > 0 && <SummaryRow label="Discount" value={`- ${money(savings, symbol)}`} strong />}
        <SummaryRow label={`Tax (${Number(business.tax_percent || 0)}%)`} value={money(tax, symbol)} />
      </div>

      <div className="mt-4 rounded-[20px] bg-[#F8FAFC] p-3">
        <p className="text-sm font-black uppercase leading-[1.35] text-[#64748B]">{totalLabel}</p>
        <p className="mt-1 text-[clamp(30px,2.55vw,40px)] font-black leading-none text-[#0F172A]">{money(total, symbol)}</p>
      </div>

    </aside>
  );
}

function QuickNoteChips({
  businessType,
  options: configuredOptions,
  value,
  onChange,
  title,
  compact = false,
}: {
  businessType: BusinessType;
  options?: string[];
  value: string;
  onChange: (value: string) => void;
  title: string;
  compact?: boolean;
}) {
  const options = configuredOptions?.length ? configuredOptions : QUICK_NOTES[businessType] ?? QUICK_NOTES.other;
  const selected = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => options.includes(entry));
  const grouped = quickNoteGroups(options);

  const toggle = (option: string) => {
    const next = selected.includes(option)
      ? selected.filter((entry) => entry !== option)
      : [...selected, option];
    onChange(next.join(", "));
  };

  return (
    <section className={`${compact ? "mt-3 border-t border-[#E2E8F0] pt-3" : "rounded-2xl border border-[#E9ECEF] bg-white p-3 text-[#0F172A] shadow-[0_8px_24px_rgba(0,0,0,0.08)]"}`}>
      <div className="mb-2.5">
        <h3 className={`${compact ? "text-base" : "text-lg"} font-black leading-[1.2]`}>{title}</h3>
        <p className="mt-1 text-sm font-bold leading-[1.35] text-[#64748B]">Tap one or more options</p>
      </div>
      <div className="space-y-2">
        {grouped.map((group) => (
          <div key={group.label}>
            <p className="mb-2 text-xs font-black uppercase leading-[1.3] text-[#64748B]">{group.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.options.map((option) => {
                const active = selected.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggle(option)}
                    aria-pressed={active}
                    className={`min-h-8 rounded-full border px-3 text-xs font-black leading-[1.25] transition ${
                      active
                        ? "border-[var(--kiosk-accent)] bg-[var(--kiosk-accent-soft)] text-[#0F172A] ring-2 ring-[var(--kiosk-accent-ring)]"
                        : "border-[#D7DEE8] bg-white text-[#475569] hover:border-[var(--kiosk-accent)]"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PremiumCartItem({
  item,
  capability,
  symbol,
  addItemsLabel,
  showFoodTypeBadge,
  onQuantity,
  onRemove,
  onOption,
  onAddItems,
}: {
  item: CartItem;
  capability: BusinessCapability;
  symbol: string;
  addItemsLabel: string;
  showFoodTypeBadge: boolean;
  onQuantity: (id: string, change: number) => void;
  onRemove: (id: string) => void;
  onOption: (itemId: string, groupId: string, groupName: string, option: ModifierOption) => void;
  onAddItems: () => void;
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const image = assetUrl(item.product.primary_image_path) || fallbackProductImage(item.product);
  const oldPrice = Number(item.product.price || 0);
  const currentPrice = cartItemPrice(item);
  const hasDeal = oldPrice > effectivePrice(item.product);
  const selectedLabels = item.selectedOptions.map((option) => option.name).join(", ");
  const hasOptions = (item.product.modifier_groups ?? []).some((group) => group.options.some((option) => option.is_available));
  const optionLabel = capability.serviceBookingEnabled
    ? "options"
    : capability.type === "grocery" || capability.type === "retail"
      ? "variants"
      : "add-ons";
  return (
    <article data-guided-test="cart-item" className="kiosk-cart-item rounded-2xl border border-[#D7DEE8] bg-white p-3 shadow-[0_9px_22px_rgba(15,23,42,0.06)]">
      <div className="kiosk-cart-item-layout grid gap-2.5">
        <div
          className="aspect-square rounded-xl bg-[#F8FAFC] bg-cover bg-center shadow-inner"
          style={image ? { backgroundImage: `url(${image})` } : undefined}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="min-w-0 truncate text-lg font-black leading-[1.2]">{item.product.name}</h3>
            {showFoodTypeBadge && (
              <span className="rounded-md bg-[#F1F5F9] px-2 py-0.5 text-[11px] font-black text-[#0F172A]">
                {labelItemType(item.product.item_type)}
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-[1.35] text-[#53635B]">
            {selectedLabels || displayProductDescription(item.product, capability)}
          </p>
          {hasOptions && (
            <button
              type="button"
              onClick={() => setOptionsOpen((value) => !value)}
              className="mt-2 flex min-h-9 items-center gap-2 text-sm font-black leading-[1.35] text-[#050608]"
            >
              <Pencil size={15} />
              {optionsOpen ? `Hide ${optionLabel}` : `Edit ${optionLabel}`}
            </button>
          )}
        </div>
        <div className="kiosk-cart-item-controls flex min-w-0 gap-2.5">
          <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
            <button
              type="button"
              onClick={() => (item.quantity === 1 ? onRemove(item.id) : onQuantity(item.id, -1))}
              className="grid h-9 w-9 place-items-center bg-[#F4F7F5]"
            >
              <Minus size={15} />
            </button>
            <span className="grid h-9 min-w-9 place-items-center text-sm font-black">{item.quantity}</span>
            <button type="button" onClick={() => onQuantity(item.id, 1)} className="grid h-9 w-9 place-items-center bg-[#F4F7F5] text-[#050608]">
              <Plus size={15} />
            </button>
          </div>
          <div className="max-w-full text-right">
            <p className="whitespace-nowrap text-lg font-black leading-[1.2]">{money(currentPrice * item.quantity, symbol)}</p>
            {hasDeal && <p className="mt-0.5 text-sm font-black leading-[1.35] text-[#64748B] line-through">{money(oldPrice * item.quantity, symbol)}</p>}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onAddItems} className="flex min-h-10 items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 text-sm font-black">
          <Plus size={15} />
          {addItemsLabel}
        </button>
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          className="grid h-10 w-10 place-items-center rounded-xl border border-rose-100 bg-rose-50 text-rose-500"
          aria-label={`Remove ${item.product.name}`}
        >
          <Trash2 size={16} />
        </button>
      </div>
      {hasOptions && optionsOpen && (
        <div className="mt-3 grid gap-2.5">
          {(item.product.modifier_groups ?? []).map((group) => (
            <div key={group.id} className="rounded-xl border border-[#E4EBE7] bg-[#FAFCFB] p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2.5">
                <p className="text-[11px] font-black uppercase leading-[1.35] tracking-[0.12em] text-[#64748B]">{group.name}</p>
                <p className="text-[11px] font-black leading-[1.35] text-[#047857]">{group.is_required ? "Required" : "Optional"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.options.filter((option) => option.is_available).map((option) => {
                  const selected = item.selectedOptions.some((entry) => entry.option_id === option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => onOption(item.id, group.id, group.name, option)}
                      className={`rounded-lg border px-2.5 py-2 text-xs font-black leading-[1.35] transition ${
                        selected ? "border-[#047857] bg-emerald-50 text-[#047857]" : "border-[#E2E8F0] bg-white text-[#475569]"
                      }`}
                    >
                      {option.name} {Number(option.price_delta) ? `+ ${money(option.price_delta, symbol)}` : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function ModifierSheet({
  product,
  capability,
  symbol,
  onClose,
  onAdd,
}: {
  product: Product;
  capability: BusinessCapability;
  symbol: string;
  onClose: () => void;
  onAdd: (product: Product, quantity: number, selectedOptions: SelectedOption[]) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<SelectedOption[]>(() => defaultSelectedOptions(product));
  const image = assetUrl(product.primary_image_path) || fallbackProductImage(product);
  const unitTotal =
    effectivePrice(product) + selectedOptions.reduce((sum, option) => sum + Number(option.price_delta || 0), 0);
  const finalTotal = unitTotal * quantity;
  const missingRequired = (product.modifier_groups ?? []).find((group) => {
    if (!group.is_required) return false;
    return selectedOptions.filter((option) => option.group_id === group.id).length < group.min_select;
  });
  const modifierCopy = modifierSheetCopy(capability);

  const toggleOption = (groupId: string, groupName: string, option: ModifierOption) => {
    const group = product.modifier_groups?.find((entry) => entry.id === groupId);
    if (!group || !option.is_available) return;
    setSelectedOptions((current) => {
      const selectedInGroup = current.filter((entry) => entry.group_id === groupId);
      const alreadySelected = selectedInGroup.some((entry) => entry.option_id === option.id);
      if (alreadySelected) {
        return current.filter((entry) => entry.option_id !== option.id);
      }
      let next = current;
      if (group.max_select <= 1) {
        next = next.filter((entry) => entry.group_id !== groupId);
      } else if (selectedInGroup.length >= group.max_select) {
        return current;
      }
      return [
        ...next,
        {
          group_id: groupId,
          group_name: groupName,
          option_id: option.id,
          name: option.name,
          price_delta: Number(option.price_delta || 0),
        },
      ];
    });
  };

  return (
    <div className="absolute inset-0 z-40 flex items-end bg-black/58 backdrop-blur-sm">
      <section className="mx-auto max-h-[92dvh] w-full max-w-[1480px] animate-[slideUp_180ms_ease-out] overflow-hidden rounded-t-[28px] bg-white text-[#0F172A] shadow-[0_-22px_70px_rgba(0,0,0,0.26)]">
        <div className="mx-auto mt-2.5 h-1 w-14 rounded-full bg-[#CBD5E1]" />
        <div className="grid max-h-[calc(92dvh-8px)] grid-rows-[auto_minmax(0,1fr)_auto]">
          <header className="flex items-center gap-3.5 px-4 pb-3 pt-3 sm:px-5">
            <button
              type="button"
              onClick={onClose}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#E2E8F0] bg-white shadow-sm"
              aria-label="Close item options"
            >
              <X size={18} />
            </button>
            <div
              className="h-20 w-20 shrink-0 rounded-xl bg-[#F8FAFC] bg-cover bg-center shadow-sm"
              style={image ? { backgroundImage: `url(${image})` } : undefined}
            />
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 text-xl font-black">{product.name}</h2>
              <p className="mt-1 text-xs font-semibold text-[#64748B]">
                {modifierCopy.subtitle}
              </p>
            </div>
            <div className="text-right">
              {discountBadge(product) && (
                <p className="text-xs font-black text-[#64748B] line-through">{money(product.price, symbol)}</p>
              )}
              <p className="text-xl font-black text-[var(--kiosk-accent)]">{money(effectivePrice(product), symbol)}</p>
              {discountBadge(product) && (
                <p className="text-xs font-black text-[#047857]">{discountBadge(product)}</p>
              )}
            </div>
          </header>

          <div className="overflow-y-auto px-4 pb-3 no-scrollbar sm:px-5">
            {(product.modifier_groups ?? []).some((group) => group.options.some((option) => option.is_default)) && (
              <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-xs font-bold text-emerald-900">
                Popular choices are preselected to speed up ordering.
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              {(product.modifier_groups ?? []).map((group) => {
                const groupSelected = selectedOptions.filter((option) => option.group_id === group.id);
                const isSingle = group.max_select <= 1;
                return (
                  <section key={group.id} className="min-w-0">
                  <div className="mb-2">
                    <h3 className="text-lg font-black">{group.name}</h3>
                    <p className="text-xs font-semibold text-[#64748B]">
                      {group.is_required ? `Select ${group.min_select || 1}` : "Choose any optional"}
                      {group.max_select > 1 ? `, up to ${group.max_select}` : ""}
                    </p>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
                    {group.options
                      .filter((option) => option.is_available)
                      .map((option) => {
                        const selected = groupSelected.some((entry) => entry.option_id === option.id);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => toggleOption(group.id, group.name, option)}
                            className={`flex min-h-12 w-full items-center gap-2.5 border-b border-[#E8EFEB] px-3 py-2 text-left last:border-b-0 transition ${
                              selected ? "bg-emerald-50" : "bg-white"
                            }`}
                          >
                            <span
                              className={`grid h-6 w-6 shrink-0 place-items-center border-2 ${
                                isSingle ? "rounded-full" : "rounded-md"
                              } ${selected ? "border-[#047857] bg-[#047857]" : "border-[#CBD5E1]"}`}
                            >
                              {selected && <CheckCircle2 size={14} className="text-white" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-black">{option.name}</span>
                              {option.is_default && <span className="text-xs font-bold text-[#047857]">Default choice</span>}
                            </span>
                            <span className="text-xs font-black text-[#475569]">
                              {Number(option.price_delta) ? `+ ${money(option.price_delta, symbol)}` : "Included"}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </section>
                );
              })}
            </div>

            {missingRequired && (
              <p className="mt-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-black text-amber-800">
                Please complete: {missingRequired.name}
              </p>
            )}
          </div>

          <footer className="grid grid-cols-[132px_minmax(0,1fr)] gap-3 border-t border-[#E2E8F0] bg-white/96 px-4 py-3 shadow-[0_-12px_26px_rgba(15,23,42,0.07)] sm:px-5">
            <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
              <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} className="grid place-items-center text-[#047857]">
                <Minus size={16} />
              </button>
              <span className="grid place-items-center text-lg font-black">{quantity}</span>
              <button type="button" onClick={() => setQuantity((value) => value + 1)} className="grid place-items-center text-[#047857]">
                <Plus size={16} />
              </button>
            </div>
            <button
              type="button"
              disabled={Boolean(missingRequired)}
              onClick={() => onAdd(product, quantity, selectedOptions)}
              className="min-h-12 rounded-xl bg-[var(--kiosk-accent)] text-base font-black text-[var(--kiosk-accent-foreground)] shadow-[0_12px_24px_var(--kiosk-accent-ring)] transition hover:-translate-y-0.5 hover:bg-[var(--kiosk-accent-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--kiosk-accent-ring)] disabled:bg-[#C9D5CF]"
            >
              Add {capability.productNoun} | {money(finalTotal, symbol)}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}

function Logo({
  business,
  logoImage,
  size = 48,
}: {
  business: Business;
  logoImage: string | null;
  size?: number;
}) {
  return (
    <BusinessLogo
      src={logoImage}
      scale={business.logo_scale}
      positionX={business.logo_position_x}
      positionY={business.logo_position_y}
      size={size}
      fallback={initials(business.name)}
      className="text-[30px] shadow-[0_7px_16px_rgba(15,23,42,0.11)]"
    />
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-black uppercase tracking-[0.06em] text-[#64748B]">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function FilterCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button type="button" onClick={onChange} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-xs font-black transition hover:bg-[#F8FAFC]">
      <span className={`grid h-5 w-5 place-items-center rounded border ${checked ? "border-[#050608] bg-[#050608]" : "border-[#CBD5E1] bg-white"}`}>
        {checked && <CheckCircle2 size={14} className="text-white" />}
      </span>
      {label}
    </button>
  );
}

function FilterRadio({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button type="button" onClick={onChange} className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-xs font-black transition hover:bg-[#F8FAFC]">
      <span className={`grid h-5 w-5 place-items-center rounded-full border ${checked ? "border-[#050608]" : "border-[#CBD5E1]"}`}>
        {checked && <span className="h-2.5 w-2.5 rounded-full bg-[#050608]" />}
      </span>
      {label}
    </button>
  );
}

function PaymentTile({
  icon,
  title,
  subtitle,
  selected,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-guided-test="payment-method"
      onClick={onSelect}
      className={`flex min-h-24 w-full min-w-0 items-center gap-4 rounded-2xl border bg-white p-4 text-left shadow-[0_8px_20px_rgba(15,23,42,0.05)] transition ${
        selected ? "border-[var(--kiosk-accent)] bg-[var(--kiosk-accent-soft)] ring-2 ring-[var(--kiosk-accent-ring)]" : "border-[#D7DEE8] hover:border-[var(--kiosk-accent)]"
      }`}
    >
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${selected ? "bg-[var(--kiosk-accent)] text-[var(--kiosk-accent-foreground)]" : "bg-[#F1F5F9] text-[#0F172A]"}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-black">{title}</span>
        <span className="mt-1 block text-sm font-semibold text-[#64748B]">{subtitle}</span>
      </span>
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${selected ? "border-[var(--kiosk-accent)]" : "border-[#94A3B8]"}`}>
        {selected && <span className="h-3 w-3 rounded-full bg-[var(--kiosk-accent)]" />}
      </span>
    </button>
  );
}

function KioskTextField({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search";
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-black text-[#334155]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="min-h-12 w-full rounded-xl border border-[#D7DEE8] bg-white px-3 text-base font-bold text-[#0F172A] outline-none focus:border-[var(--kiosk-accent)] focus:ring-4 focus:ring-[var(--kiosk-accent-ring)]"
      />
    </label>
  );
}

function buildTabs(categories: Category[], products: Product[]): CategoryTab[] {
  const dealProducts = products.filter(isDealProduct);
  const dealImage =
    dealProducts
      .map((product) => kioskProductImage(product, categories, products))
      .find(Boolean) ?? undefined;
  return [
    ...(dealProducts.length
      ? [{ id: "deals", label: "Deals", icon: <Gift size={15} />, imageUrl: dealImage }]
      : []),
    ...categories
      .filter((category) => category.is_active)
      .map((category) => {
        const categoryProducts = products.filter((product) => product.category_id === category.id);
        const customImage = assetUrl((category as Category & { image_path?: string | null }).image_path);
        const itemImage =
          categoryProducts.map((product) => assetUrl(product.primary_image_path)).find(Boolean) ?? undefined;
        return {
          id: category.id,
          label: category.name,
          icon: iconForCategory(category.name),
          imageUrl: customImage || itemImage,
          itemCount: categoryProducts.length,
        };
      })
      .filter((category) => category.itemCount > 0),
  ];
}

function isDealProduct(product: Product) {
  const tags = productTags(product).map((tag) => tag.toLowerCase());
  return Boolean(discountBadge(product)) || tags.some((tag) => tag.includes("deal") || tag.includes("offer"));
}

function kioskProductImage(product: Product, categories: Category[], products: Product[]) {
  const itemImage = assetUrl(product.primary_image_path);
  if (itemImage) return itemImage;
  if (!product.category_id) return null;
  const category = categories.find((entry) => entry.id === product.category_id);
  const customImage = assetUrl((category as Category & { image_path?: string | null } | undefined)?.image_path);
  if (customImage) return customImage;
  const categoryImageProduct = products.find(
    (entry) => entry.category_id === product.category_id && Boolean(entry.primary_image_path)
  );
  return assetUrl(categoryImageProduct?.primary_image_path);
}

function isTagTab(value: string) {
  return value.startsWith("tag:");
}

function productTags(product: Product) {
  const raw = product.metadata?.tags;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  return values
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .map((tag) => tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase())
    .filter((tag, index, list) => list.indexOf(tag) === index);
}

function productTagIds(product: Product) {
  return productTags(product).map((tag) => `tag:${tag.toLowerCase().replace(/\s+/g, "-")}`);
}

function productDescriptionFallback(capability: BusinessCapability) {
  if (capability.serviceBookingEnabled) return "Available for this visit.";
  if (capability.type === "grocery" || capability.type === "retail") return "Available for pickup.";
  if (capability.type === "cafe") return "Prepared fresh for you.";
  if (capability.type === "bakery") return "Baked fresh for today.";
  if (capability.type === "burger") return "Ready to customize with add-ons.";
  if (capability.type === "ice_cream") return "Made fresh for you.";
  return "Freshly prepared for this order.";
}

function displayProductDescription(product: Product, capability: BusinessCapability) {
  const description = product.description?.trim();
  if (!description) return productDescriptionFallback(capability);
  const looksFoodDefault = /\b(freshly prepared|made for this order|cooking requests?|extra spicy|no onions?|delicious combos?)\b/i.test(description);
  if (
    looksFoodDefault &&
    (capability.serviceBookingEnabled ||
      capability.type === "grocery" ||
      capability.type === "retail" ||
      capability.type === "other")
  ) {
    return productDescriptionFallback(capability);
  }
  return description;
}

function iconForCategory(name: string) {
  const value = name.toLowerCase();
  if (value.includes("pizza")) return <Pizza size={15} />;
  if (value.includes("burger")) return <ShoppingCart size={15} />;
  if (value.includes("ice") || value.includes("sundae") || value.includes("scoop") || value.includes("cone") || value.includes("shake")) return <Sparkles size={15} />;
  if (value.includes("snack")) return <Star size={15} />;
  if (value.includes("hair") || value.includes("facial") || value.includes("service") || value.includes("staff")) return <User size={15} />;
  if (value.includes("produce") || value.includes("fruit") || value.includes("dairy") || value.includes("retail")) return <Store size={15} />;
  if (value.includes("side") || value.includes("fries")) return <Store size={15} />;
  if (value.includes("main") || value.includes("meal")) return <Utensils size={15} />;
  return <Grid2X2 size={15} />;
}

function tabLabel(tabs: CategoryTab[], id: string) {
  return tabs.find((tab) => tab.id === id)?.label ?? "Items";
}

function hasCombo(product: Product) {
  return (product.modifier_groups ?? []).some((group) => group.name.toLowerCase().includes("combo"));
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatBusinessTime(value?: string | null) {
  if (!value) return "";
  return value.slice(0, 5);
}

function kioskAvailabilityCopy(business: Business, isOpen: boolean) {
  const extras = business as Business & Record<string, unknown>;
  const maintenanceMode = Boolean(extras.maintenance_mode || extras.service_mode_enabled || extras.kiosk_service_mode_enabled);
  const capability = businessCapabilitiesFor(business);
  const transactionLabel =
    capability.cartNoun === "booking"
      ? "bookings"
      : capability.type === "grocery" || capability.type === "retail"
        ? "shopping checkout"
        : "orders";
  const scheduledAvailability = getStoreAvailability(business);
  if (isOpen) {
    return {
      status: "OPEN",
      title: `Accepting ${transactionLabel}`,
      shortMessage: scheduledAvailability.shortMessage,
      message: capability.cartNoun === "booking" ? "You can create a booking now." : scheduledAvailability.message,
    };
  }
  if (maintenanceMode) {
    return {
      status: "Service mode",
      title: "Temporarily under service",
      shortMessage: "Try again after some minutes.",
      message: "This kiosk is temporarily under service. Please try again after some minutes.",
    };
  }
  return {
    status: business.is_active ? "Closed" : "Paused",
    title: scheduledAvailability.title,
    shortMessage: scheduledAvailability.shortMessage,
    message: scheduledAvailability.message,
  };
}

function businessFallbackTagline(capability: BusinessCapability) {
  switch (capability.type) {
    case "grocery":
      return "Daily essentials, quick checkout.";
    case "salon":
      return "Book services with ease.";
    case "retail":
      return "Shop products in one tap.";
    case "ice_cream":
      return "Scoops and shakes made fresh.";
    case "bakery":
      return "Fresh bakes and easy pickup.";
    case "cafe":
      return "Coffee and quick bites.";
    case "burger":
      return "Combos, sides, and fast checkout.";
    case "pizza":
      return "Fresh pizzas and smart savings.";
    case "restaurant":
      return "Meals served hot.";
    default:
      return "Tap to browse and checkout.";
  }
}

function orderModePrompt(capability: BusinessCapability) {
  if (capability.type === "grocery" || capability.type === "retail") return "Choose pickup or delivery.";
  if (capability.type === "bakery") return "Choose takeaway or pre-order pickup.";
  return "Choose how you want to continue.";
}

function orderModeDescription(mode: OrderType, capability: BusinessCapability) {
  if (mode === "dine_in") return "Eat at the restaurant";
  if (mode === "takeaway") return capability.type === "bakery" ? "Collect at the bakery" : "Collect at counter";
  if (mode === "delivery") return "Send to customer address";
  if (capability.type === "bakery") return "Reserve pickup time";
  if (capability.type === "grocery" || capability.type === "retail") return "Collect from store";
  return "Staff will prepare it";
}

function totalPayableLabel(capability: BusinessCapability) {
  if (capability.type === "salon") return "Booking Total";
  return "Total Payable";
}

function totalAmountLabel(capability: BusinessCapability) {
  if (capability.type === "salon") return "Service Total";
  return "Total Amount";
}

function unavailableActionLabel(capability: BusinessCapability) {
  if (capability.type === "salon") return "Bookings unavailable";
  if (capability.type === "grocery" || capability.type === "retail") return "Checkout unavailable";
  return "Orders unavailable";
}

function modifierSheetCopy(capability: BusinessCapability) {
  switch (capability.type) {
    case "grocery":
    case "retail":
      return { subtitle: "Choose available variants" };
    case "salon":
      return { subtitle: "Choose service preferences" };
    case "bakery":
      return { subtitle: "Choose flavor, size, or pickup options" };
    case "cafe":
      return { subtitle: "Choose drink options" };
    case "ice_cream":
      return { subtitle: "Choose serving style, flavor, and toppings" };
    default:
      return { subtitle: "Make it your way" };
  }
}

function confirmationContent(capability: BusinessCapability, order: Order) {
  const referenceValue = order.order_number ?? order.public_token ?? order.id.slice(0, 8);
  const paymentStatus = labelItemType(order.payment_status || "pending");
  const mode = labelOrderType(order.order_type, capability);

  if (capability.type === "salon") {
    return {
      title: capability.confirmationTitle,
      message: capability.confirmationMessage,
      referenceLabel: "Booking",
      referenceValue,
      detailLine: "Your booking is confirmed.",
      statusLabel: "Status",
      statusValue: "Booked",
      statusMeta: paymentStatus,
      nextTitle: "Booking saved",
      nextBody: "Please arrive at your selected time. Staff can confirm service and payment details.",
    };
  }

  if (capability.type === "grocery") {
    return {
      title: capability.confirmationTitle,
      message: capability.confirmationMessage,
      referenceLabel: "Order",
      referenceValue,
      detailLine: `${mode} selected.`,
      statusLabel: "Status",
      statusValue: "Placed",
      statusMeta: paymentStatus,
      nextTitle: "Shopping order saved",
      nextBody: "Staff will prepare your products and update pickup or delivery status.",
    };
  }

  if (capability.type === "retail") {
    return {
      title: capability.confirmationTitle,
      message: capability.confirmationMessage,
      referenceLabel: "Order",
      referenceValue,
      detailLine: `${mode} selected.`,
      statusLabel: "Status",
      statusValue: "Confirmed",
      statusMeta: paymentStatus,
      nextTitle: "Purchase saved",
      nextBody: "Staff will prepare the selected products and confirm pickup or delivery.",
    };
  }

  if (capability.type === "bakery") {
    return {
      title: capability.confirmationTitle,
      message: capability.confirmationMessage,
      referenceLabel: "Order",
      referenceValue,
      detailLine: `${mode} order confirmed.`,
      statusLabel: "Status",
      statusValue: "Confirmed",
      statusMeta: paymentStatus,
      nextTitle: "Bakery order saved",
      nextBody: "Pickup timing and custom cake details remain attached to this order.",
    };
  }

  if (capability.type === "ice_cream") {
    return {
      title: capability.confirmationTitle,
      message: capability.confirmationMessage,
      referenceLabel: "Order",
      referenceValue,
      detailLine: `${mode} order placed.`,
      statusLabel: "Status",
      statusValue: "Placed",
      statusMeta: paymentStatus,
      nextTitle: "Treats being prepared",
      nextBody: "Staff will prepare your ice cream items and call your order number when they are ready.",
    };
  }

  return {
    title: capability.confirmationTitle,
    message: capability.confirmationMessage,
    referenceLabel: "Order",
    referenceValue,
    detailLine: `${mode} order placed.`,
    statusLabel: "Estimated Time",
    statusValue: "08:12",
    statusMeta: "Minutes",
    nextTitle: order.order_type === "dine_in" ? "Please stay near your table" : "Please wait near the counter",
    nextBody: "Your order is being prepared. Staff will call your order number when it is ready.",
  };
}

function quickNoteGroups(options: string[]) {
  const preparationTerms = [
    "spicy", "oil", "gravy", "dry", "hot", "sugar", "ice", "shot", "decaf", "cream",
    "warm", "chocolate", "toppings", "cheese", "sausage", "chicken", "done", "crispy",
    "sauce", "toast", "mayo", "ripe", "fresh", "serve", "scoop", "syrup", "nuts",
    "sprinkles", "crunch", "flavors",
  ];
  const packagingTerms = [
    "take away", "wrap", "price tag", "packing", "bag", "packaging", "fragile", "message",
    "candles", "knife", "slices", "contact",
  ];
  const groups = {
    Preparation: [] as string[],
    Customization: [] as string[],
    "Packaging & Service": [] as string[],
  };

  options.forEach((option) => {
    const normalized = option.toLowerCase();
    if (packagingTerms.some((term) => normalized.includes(term))) {
      groups["Packaging & Service"].push(option);
    } else if (preparationTerms.some((term) => normalized.includes(term))) {
      groups.Preparation.push(option);
    } else {
      groups.Customization.push(option);
    }
  });

  return Object.entries(groups)
    .filter(([, entries]) => entries.length > 0)
    .map(([label, entries]) => ({ label, options: entries }));
}

function greetingFor(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

function formatKioskTime(date: Date) {
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function labelItemType(type: string) {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function orderModeIcon(type: OrderType) {
  if (type === "dine_in") return <Utensils size={17} />;
  if (type === "takeaway" || type === "pickup") return <ShoppingCart size={17} />;
  return <Store size={17} />;
}

function labelOrderType(type: OrderType, capability?: BusinessCapability) {
  if (capability?.serviceBookingEnabled) return "Appointment";
  if (type === "pickup") {
    if (capability?.type === "bakery") return "Pre-order";
    return "Pickup";
  }
  if (type === "delivery") return "Delivery";
  return type === "dine_in" ? "Dine In" : type === "takeaway" ? "Take Away" : labelItemType(type);
}

function cartItemPrice(item: CartItem) {
  return (
    effectivePrice(item.product) +
    item.selectedOptions.reduce((sum, option) => sum + Number(option.price_delta || 0), 0)
  );
}

function optionsKey(options: SelectedOption[]) {
  return options
    .map((option) => option.option_id)
    .sort()
    .join("|");
}

function defaultSelectedOptions(product: Product): SelectedOption[] {
  const selected: SelectedOption[] = [];
  for (const group of product.modifier_groups ?? []) {
    const availableOptions = group.options.filter((option) => option.is_available);
    if (!availableOptions.length) continue;
    const explicitDefaults = availableOptions.filter((option) => option.is_default);
    const defaults =
      explicitDefaults.length > 0
        ? explicitDefaults.slice(0, Math.max(1, group.max_select))
        : group.is_required || group.min_select > 0
          ? availableOptions.slice(0, Math.max(1, group.min_select))
          : [];
    defaults.forEach((option) => {
      selected.push({
        group_id: group.id,
        group_name: group.name,
        option_id: option.id,
        name: option.name,
        price_delta: Number(option.price_delta || 0),
      });
    });
  }
  return selected;
}

function canOrderProduct(product: Product) {
  if (!product.is_available) return false;
  if (product.track_stock && typeof product.stock_quantity === "number" && product.stock_quantity <= 0) {
    return false;
  }
  if (typeof product.daily_limit === "number" && product.sold_today >= product.daily_limit) {
    return false;
  }
  if (!productDayAvailable(product)) return false;
  return productTimeAvailable(product);
}

function paymentOptionsForBusiness(business: Business | null, isLiveDeviceRoute = true): Array<{ id: PaymentMethod; icon: ReactNode; title: string; subtitle: string }> {
  if (!business) return [];
  const settings = business.kiosk_order_settings ?? {};
  const summaryMethods = business.payment_summary?.enabled_methods;
  const rawMethods = summaryMethods?.length
    ? summaryMethods
    : [
        settings.pay_at_counter !== false ? "pay_at_counter" : null,
        settings.online_payments !== false ? "upi" : null,
        settings.online_payments !== false ? "card" : null,
      ].filter((value): value is string => Boolean(value));
  const seen = new Set<string>();
  return rawMethods
    .map(normalizeFrontendPaymentMethod)
    .filter((method): method is PaymentMethod => Boolean(method))
    .filter((method) => isLiveDeviceRoute || !["pay_at_counter", "cash"].includes(method))
    .filter((method) => {
      if (seen.has(method)) return false;
      seen.add(method);
      return true;
    })
    .map((method) => {
      if (method === "cash") {
        return { id: method, icon: <Store size={22} />, title: "Cash", subtitle: "Pay cash to staff at the counter" };
      }
      if (method === "pay_at_counter") {
        return { id: method, icon: <Store size={22} />, title: "Pay at Counter", subtitle: "Staff collects payment before handoff" };
      }
      if (method === "upi") {
        return { id: method, icon: <QrCode size={22} />, title: "UPI", subtitle: "Pay online through Razorpay UPI" };
      }
      if (method === "razorpay") {
        return { id: method, icon: <QrCode size={22} />, title: "Razorpay", subtitle: "Secure Razorpay checkout" };
      }
      if (method === "paytm") {
        return { id: method, icon: <QrCode size={22} />, title: "Paytm Dynamic QR", subtitle: "Scan and wait for backend confirmation" };
      }
      if (method === "stripe") {
        return { id: method, icon: <CreditCard size={22} />, title: "Stripe", subtitle: "Secure Stripe checkout" };
      }
      return { id: method, icon: <CreditCard size={22} />, title: "Card", subtitle: "Pay online by card" };
    });
}

function defaultPaymentMethodForBusiness(business: Business | null, isLiveDeviceRoute = true): PaymentMethod {
  const options = paymentOptionsForBusiness(business, isLiveDeviceRoute);
  const configured = normalizeFrontendPaymentMethod(business?.payment_summary?.default_payment_method ?? business?.kiosk_order_settings?.default_payment_method);
  if (configured && options.some((option) => option.id === configured)) return configured;
  return options[0]?.id ?? "pay_at_counter";
}

function normalizeFrontendPaymentMethod(value?: string | null): PaymentMethod | null {
  const method = String(value || "").toLowerCase();
  if (method === "counter") return "pay_at_counter";
  if (["pay_at_counter", "cash", "upi", "card", "stripe", "razorpay", "paytm"].includes(method)) {
    return method as PaymentMethod;
  }
  return null;
}

function productTimeAvailable(product: Product) {
  if (!product.availability_start_time || !product.availability_end_time) return true;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(product.availability_start_time);
  const end = toMinutes(product.availability_end_time);
  if (start == null || end == null) return true;
  if (start <= end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function isBusinessOpen(business: Business) {
  return getStoreAvailability(business).isOpen;
}

function productDayAvailable(product: Product) {
  if (product.availability_type !== "scheduled") return true;
  if (!product.available_days?.length) return true;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  return product.available_days.map((day) => day.toLowerCase()).includes(today);
}

function toMinutes(value: string) {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
}
