"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { IconButton } from "@astryxdesign/core/IconButton";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Minus, Plus } from "lucide-react";
import { AstryxDashboardProviders } from "@/components/dashboard/AstryxDashboardProviders";
import { DetailDrawer, DetailRow, EmptyBlock, NoticeBanner, StatusBadge } from "@/components/dashboard/kit";
import { api, assetUrl } from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";
import type { KioskMenu, ModifierGroup, Order, Product, QrOrderOption, QrOrderPayload, QrStoreStatus } from "@/lib/types";

type CartLine = { key: string; product: Product; quantity: number; options: QrOrderOption[] };
type Sheet = { product: Product; selected: Record<string, string[]> };
type OrderType = "dine_in" | "takeaway";

const money = (value: number, currency: string) => formatCurrency(Math.round(value * 100) / 100, currency || "INR");

/** Mirrors the server's active price rule so the customer sees the amount that will be charged. */
export function activeUnitPrice(product: Product, now = Date.now()): number {
  const price = Number(product.price || 0);
  const value = Number(product.discount_value || 0);
  if (!product.discount_type || product.discount_type === "none" || value <= 0) return price;
  const starts = product.discount_starts_at ? Date.parse(product.discount_starts_at) : null;
  const ends = product.discount_ends_at ? Date.parse(product.discount_ends_at) : null;
  if (starts !== null && now < starts) return price;
  if (ends !== null && now > ends) return price;
  if (product.discount_type === "percentage") return Math.max(price - (price * Math.min(value, 100)) / 100, 0);
  if (product.discount_type === "fixed") return Math.max(price - value, 0);
  return price;
}

const optionsTotal = (options: QrOrderOption[]) => options.reduce((sum, option) => sum + Number(option.price_delta || 0), 0);
const lineTotal = (line: CartLine) => (activeUnitPrice(line.product) + optionsTotal(line.options)) * line.quantity;
const lineKey = (productId: string, options: QrOrderOption[]) => `${productId}|${options.map((option) => option.option_id).sort().join(",")}`;

function defaultSelection(product: Product): Record<string, string[]> {
  return Object.fromEntries((product.modifier_groups || []).map((group) => [
    group.id,
    group.options.filter((option) => option.is_default && option.is_available).slice(0, group.max_select || undefined).map((option) => option.id),
  ]));
}

function selectionError(product: Product, selected: Record<string, string[]>): string {
  for (const group of product.modifier_groups || []) {
    const count = (selected[group.id] || []).length;
    const min = group.is_required ? Math.max(group.min_select, 1) : group.min_select;
    if (count < min) return `Choose ${group.name} before adding ${product.name}.`;
    if (group.max_select && count > group.max_select) return `Select no more than ${group.max_select} ${group.name} options.`;
  }
  return "";
}

function optionsFromSelection(product: Product, selected: Record<string, string[]>): QrOrderOption[] {
  return (product.modifier_groups || []).flatMap((group) => group.options
    .filter((option) => (selected[group.id] || []).includes(option.id))
    .map((option) => ({ group_id: group.id, group_name: group.name, option_id: option.id, name: option.name, price_delta: option.price_delta })));
}

function toggleSelection(group: ModifierGroup, current: string[], optionId: string): string[] {
  if (current.includes(optionId)) return current.filter((id) => id !== optionId);
  if (group.max_select === 1) return [optionId];
  if (group.max_select && current.length >= group.max_select) return current;
  return [...current, optionId];
}

export function QrOrderApp() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const slug = String(params.slug || "");
  const tableParam = search.get("table") || "";
  const focusItem = search.get("item");
  const focusCategory = search.get("category");

  const [store, setStore] = useState<QrStoreStatus | null>(null);
  const [menu, setMenu] = useState<KioskMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [sheetError, setSheetError] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>(tableParam ? "dine_in" : search.get("order_type") === "dine_in" ? "dine_in" : "takeaway");
  const [table, setTable] = useState(tableParam);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [placed, setPlaced] = useState<Order | null>(null);
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextStore, nextMenu] = await Promise.all([api.qrStoreStatus(slug), api.kioskMenu(slug)]);
      setStore(nextStore);
      setMenu(nextMenu);
      const item = focusItem ? nextMenu.products.find((product) => product.id === focusItem) : undefined;
      const target = item?.category_id || focusCategory;
      if (target && nextMenu.categories.some((candidate) => candidate.id === target)) setCategory(target);
      if (focusItem) window.setTimeout(() => document.getElementById(`item-${focusItem}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This store isn't available right now.");
    } finally {
      setLoading(false);
    }
  }, [focusCategory, focusItem, slug]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const currency = store?.currency_symbol || menu?.business.currency_symbol || "";
  const canOrder = Boolean(store?.qr_ordering_enabled && store?.is_open);
  const categories = useMemo(() => (menu?.categories || []).filter((candidate) => candidate.is_active), [menu?.categories]);
  const products = useMemo(() => (menu?.products || []).filter((product) => category === "all" || product.category_id === category), [category, menu?.products]);
  const subtotal = cart.reduce((sum, line) => sum + lineTotal(line), 0);
  const tax = subtotal * (store?.tax_percent || 0) / 100;
  const total = subtotal + tax;
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);

  const addLine = (product: Product, options: QrOrderOption[]) => {
    const key = lineKey(product.id, options);
    setCart((current) => {
      const existing = current.find((line) => line.key === key);
      return existing
        ? current.map((line) => (line.key === key ? { ...line, quantity: line.quantity + 1 } : line))
        : [...current, { key, product, quantity: 1, options }];
    });
  };

  const changeQuantity = (key: string, delta: number) => {
    setCart((current) => current.map((line) => (line.key === key ? { ...line, quantity: line.quantity + delta } : line)).filter((line) => line.quantity > 0));
  };

  const addProduct = (product: Product) => {
    if (!canOrder || !product.is_available) return;
    if (product.modifier_groups?.length) {
      setSheetError("");
      setSheet({ product, selected: defaultSelection(product) });
      return;
    }
    addLine(product, []);
  };

  const confirmSheet = () => {
    if (!sheet) return;
    const problem = selectionError(sheet.product, sheet.selected);
    if (problem) {
      setSheetError(problem);
      return;
    }
    addLine(sheet.product, optionsFromSelection(sheet.product, sheet.selected));
    setSheet(null);
  };

  const checkoutProblem = (): string => {
    if (orderType === "dine_in" && !table.trim()) return "Add your table number to place a dine-in order.";
    if (store?.require_customer_name && !name.trim()) return "Add your name so the counter can call you.";
    if (store?.require_customer_phone && !phone.trim()) return "Add a phone number for this order.";
    return "";
  };

  const placeOrder = async () => {
    if (!cart.length || !canOrder) return;
    const problem = checkoutProblem();
    if (problem) {
      setNotice(problem);
      return;
    }
    const payload: QrOrderPayload = {
      order_type: orderType,
      table_label: orderType === "dine_in" ? table.trim() : undefined,
      customer_name: name.trim() || undefined,
      customer_phone: phone.trim() || undefined,
      notes: store?.allow_customer_notes && notes.trim() ? notes.trim() : undefined,
      payment_method: "pay_at_counter",
      items: cart.map((line) => ({ product_id: line.product.id, quantity: line.quantity, customizations: line.options })),
    };
    // Reusing the key for an unchanged retry means a flaky connection can never place the same order twice.
    const fingerprint = JSON.stringify(payload);
    const key = submission.current?.fingerprint === fingerprint ? submission.current.key : `qr-${crypto.randomUUID()}`;
    submission.current = { fingerprint, key };
    setSubmitting(true);
    setNotice("");
    try {
      const order = await api.qrOrder(slug, payload, key);
      submission.current = null;
      setPlaced(order);
      setCart([]);
      setNotes("");
      setCheckoutOpen(false);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Your order could not be placed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const shell = (children: ReactNode) => (
    <AstryxDashboardProviders>
      <VStack gap={0} style={{ minHeight: "100vh", background: "var(--color-background-muted)" }}>
        <VStack gap={1} style={{ background: "var(--color-background-card)", borderBottom: "1px solid var(--color-border)", padding: "18px 16px" }}>
          <Text type="supporting" color="secondary">Order online</Text>
          <Heading level={2} weight="semibold">{store?.name || menu?.business.name || "Menu"}</Heading>
          <HStack gap={2} wrap="wrap" style={{ paddingTop: 4 }}>
            {store && <StatusBadge tone={store.is_open ? "success" : "warning"}>{store.is_open ? "Open now" : "Closed right now"}</StatusBadge>}
            {orderType === "dine_in" && table && <StatusBadge tone="info">{`Table ${table}`}</StatusBadge>}
          </HStack>
        </VStack>
        {children}
      </VStack>
    </AstryxDashboardProviders>
  );

  if (placed) {
    return shell(
      <VStack gap={5} hAlign="center" style={{ maxWidth: 560, width: "100%", margin: "0 auto", padding: "32px 16px", textAlign: "center" }}>
        <StatusBadge tone="success">Order received</StatusBadge>
        <Heading level={2} weight="semibold">{`Order #${placed.order_number || placed.public_token}`}</Heading>
        <Text type="body" color="secondary">The kitchen has your order. Show this number at the counter when you collect it and pay there.</Text>
        <Card padding={4} elevation="low" width="100%">
          <VStack gap={2}>
            {(placed.order_items || []).map((item) => (
              <HStack key={item.id} hAlign="between">
                <Text type="body" color="primary">{`${item.quantity} × ${item.product_name}`}</Text>
                <Text type="body" color="primary">{money(item.total_price, currency)}</Text>
              </HStack>
            ))}
            <HStack hAlign="between" style={{ borderTop: "1px solid var(--color-border)", paddingTop: 8 }}>
              <Text type="body" weight="semibold" color="primary">Total</Text>
              <Text type="body" weight="semibold" color="primary">{money(placed.total_amount, currency)}</Text>
            </HStack>
          </VStack>
        </Card>
        <Button label="Order again" variant="secondary" onClick={() => setPlaced(null)} />
      </VStack>,
    );
  }

  if (loading && !menu) {
    return shell(<VStack gap={3} style={{ padding: 24 }}><Text type="body" color="secondary">Loading the menu…</Text></VStack>);
  }

  if (error || !store || !menu) {
    return shell(
      <VStack gap={4} style={{ maxWidth: 560, width: "100%", margin: "0 auto", padding: 16 }}>
        <NoticeBanner tone="danger" title="This store isn't available right now" description={error || "Please try again in a moment."} action={<Button label="Try again" variant="secondary" onClick={() => void load()} />} role="alert" />
      </VStack>,
    );
  }

  return shell(
    <>
      <VStack gap={4} style={{ maxWidth: 560, width: "100%", margin: "0 auto", padding: "16px 16px 120px" }}>
        {!store.qr_ordering_enabled && (
          <NoticeBanner tone="info" title="Online ordering isn't available right now" description="You can still browse the menu. Please order at the counter." />
        )}
        {store.qr_ordering_enabled && !store.is_open && (
          <NoticeBanner tone="warning" title="We're closed right now" description="You can browse the menu. Orders open again during opening hours." />
        )}

        <HStack gap={2} wrap="wrap">
          <Button label="All" variant={category === "all" ? "primary" : "secondary"} size="sm" onClick={() => setCategory("all")} />
          {categories.map((item) => (
            <Button key={item.id} label={item.name} variant={category === item.id ? "primary" : "secondary"} size="sm" onClick={() => setCategory(item.id)} />
          ))}
        </HStack>

        {products.length ? (
          <VStack gap={3}>
            {products.map((product) => {
              const simpleLine = cart.find((line) => line.product.id === product.id && line.options.length === 0);
              const inCart = cart.filter((line) => line.product.id === product.id).reduce((sum, line) => sum + line.quantity, 0);
              const discounted = activeUnitPrice(product) < Number(product.price || 0);
              return (
                <Card key={product.id} id={`item-${product.id}`} padding={3} elevation="low">
                  <HStack gap={3} vAlign="center" hAlign="between">
                    <HStack gap={3} vAlign="center" style={{ minWidth: 0, flex: 1 }}>
                      <Avatar size="lg" shape="rounded" name={product.name} src={assetUrl(product.primary_image_path) || undefined} tooltip={false} />
                      <VStack gap={0} style={{ minWidth: 0 }}>
                        <Text type="body" weight="semibold" color="primary">{product.name}</Text>
                        {product.description && <Text type="supporting" color="secondary">{product.description}</Text>}
                        <HStack gap={2} vAlign="center" wrap="wrap">
                          <Text type="body" color="primary">{money(activeUnitPrice(product), currency)}</Text>
                          {discounted && <Text type="supporting" color="secondary">{`was ${money(Number(product.price), currency)}`}</Text>}
                          {!product.is_available && <StatusBadge tone="neutral">Unavailable</StatusBadge>}
                          {product.modifier_groups?.length ? <Text type="supporting" color="secondary">Customisable</Text> : null}
                        </HStack>
                      </VStack>
                    </HStack>
                    {simpleLine ? (
                      <HStack gap={2} vAlign="center">
                        <IconButton label={`Remove one ${product.name}`} variant="secondary" size="sm" icon={<Minus size={14} aria-hidden="true" />} onClick={() => changeQuantity(simpleLine.key, -1)} />
                        <Text type="body" weight="semibold" color="primary">{String(simpleLine.quantity)}</Text>
                        <IconButton label={`Add one more ${product.name}`} variant="secondary" size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={() => changeQuantity(simpleLine.key, 1)} />
                      </HStack>
                    ) : (
                      <VStack gap={1} hAlign="end">
                        <Button label="Add" variant="secondary" size="sm" isDisabled={!canOrder || !product.is_available} onClick={() => addProduct(product)} />
                        {inCart > 0 && <Text type="supporting" color="secondary">{`${inCart} in order`}</Text>}
                      </VStack>
                    )}
                  </HStack>
                </Card>
              );
            })}
          </VStack>
        ) : (
          <EmptyBlock title="Nothing in this category" description="Choose another category to see more items." />
        )}
      </VStack>

      {count > 0 && (
        <div style={{ position: "sticky", bottom: 12, zIndex: 5, maxWidth: 560, width: "calc(100% - 32px)", margin: "0 auto" }}>
          <Card padding={3} elevation="med" width="100%">
            <HStack gap={3} vAlign="center" hAlign="between">
              <VStack gap={0}>
                <Text type="body" weight="semibold" color="primary">{`${count} ${count === 1 ? "item" : "items"}`}</Text>
                <Text type="supporting" color="secondary">{money(total, currency)}</Text>
              </VStack>
              <Button label="View order" variant="primary" onClick={() => setCheckoutOpen(true)} />
            </HStack>
          </Card>
        </div>
      )}

      {sheet && (
        <DetailDrawer
          title={sheet.product.name}
          isOpen
          onClose={() => setSheet(null)}
          footer={
            <HStack gap={2} hAlign="end">
              <Button label="Cancel" variant="secondary" onClick={() => setSheet(null)} />
              <Button label={`Add to order · ${money(activeUnitPrice(sheet.product) + optionsTotal(optionsFromSelection(sheet.product, sheet.selected)), currency)}`} variant="primary" onClick={confirmSheet} />
            </HStack>
          }
        >
          <VStack gap={5}>
            {sheetError && <NoticeBanner tone="danger" title={sheetError} role="alert" />}
            {(sheet.product.modifier_groups || []).map((group) => {
              const max = group.max_select || 0;
              const required = group.is_required || group.min_select > 0;
              return (
                <VStack key={group.id} gap={2}>
                  <Text type="label" color="primary">{`${group.name}${required ? " · required" : ""}${max ? ` · up to ${max}` : ""}`}</Text>
                  {group.options.filter((option) => option.is_available).map((option) => (
                    <CheckboxInput
                      key={option.id}
                      label={`${option.name}${option.price_delta ? ` · +${money(option.price_delta, currency)}` : ""}`}
                      value={(sheet.selected[group.id] || []).includes(option.id)}
                      onChange={() => setSheet((current) => current && { ...current, selected: { ...current.selected, [group.id]: toggleSelection(group, current.selected[group.id] || [], option.id) } })}
                    />
                  ))}
                </VStack>
              );
            })}
          </VStack>
        </DetailDrawer>
      )}

      {checkoutOpen && (
        <DetailDrawer
          title="Your order"
          isOpen
          onClose={() => setCheckoutOpen(false)}
          footer={
            <Button label="Place order" variant="primary" width="100%" isLoading={submitting} isDisabled={submitting || !canOrder || !cart.length} onClick={() => void placeOrder()} />
          }
        >
          <VStack gap={5}>
            <VStack gap={3}>
              {cart.map((line) => (
                <HStack key={line.key} gap={3} vAlign="start" hAlign="between">
                  <HStack gap={2} vAlign="center">
                    <IconButton label={`Remove one ${line.product.name}`} variant="secondary" size="sm" icon={<Minus size={14} aria-hidden="true" />} onClick={() => changeQuantity(line.key, -1)} />
                    <Text type="body" weight="semibold" color="primary">{String(line.quantity)}</Text>
                    <IconButton label={`Add one more ${line.product.name}`} variant="secondary" size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={() => changeQuantity(line.key, 1)} />
                  </HStack>
                  <VStack gap={0} style={{ flex: 1, minWidth: 0 }}>
                    <Text type="body" weight="semibold" color="primary">{line.product.name}</Text>
                    {line.options.length > 0 && <Text type="supporting" color="secondary">{line.options.map((option) => option.name).join(", ")}</Text>}
                  </VStack>
                  <Text type="body" color="primary">{money(lineTotal(line), currency)}</Text>
                </HStack>
              ))}
            </VStack>
            <VStack gap={1}>
              <DetailRow label="Subtotal">{money(subtotal, currency)}</DetailRow>
              {tax > 0 && <DetailRow label="Tax">{money(tax, currency)}</DetailRow>}
              <DetailRow label="Total">{money(total, currency)}</DetailRow>
            </VStack>

            {store.order_modes.length > 1 && (
              <SegmentedControl label="How you'll collect" value={orderType} onChange={(value) => setOrderType(value as OrderType)}>
                <SegmentedControlItem value="takeaway" label="Takeaway" />
                <SegmentedControlItem value="dine_in" label="Dine in" />
              </SegmentedControl>
            )}
            {orderType === "dine_in" && <TextInput label="Table number" value={table} onChange={setTable} placeholder="e.g. 4" />}
            <TextInput label={store.require_customer_name ? "Your name (required)" : "Your name"} value={name} onChange={setName} />
            <TextInput label={store.require_customer_phone ? "Phone (required)" : "Phone (optional)"} value={phone} onChange={setPhone} />
            {store.allow_customer_notes && <TextArea label="Note for the kitchen" rows={2} value={notes} onChange={setNotes} />}

            <Text type="supporting" color="secondary">You pay at the counter when you collect your order.</Text>
            {notice && <NoticeBanner tone="danger" title={notice} role="alert" />}
          </VStack>
        </DetailDrawer>
      )}
    </>,
  );
}
