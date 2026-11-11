import type { Business, StoreDaySchedule, StoreScheduleSettings, StoreTimeSlot } from "@/lib/types";

export const STORE_DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type StoreDayKey = (typeof STORE_DAY_KEYS)[number];

export type NormalizedStoreSchedule = {
  enabled: boolean;
  weekly: Record<StoreDayKey, StoreDaySchedule>;
  overrides: NonNullable<StoreScheduleSettings["overrides"]>;
  emergency_closed: boolean;
  emergency_message: string;
};

export type StoreAvailability = {
  isOpen: boolean;
  title: string;
  message: string;
  shortMessage: string;
};

type StoreAvailabilityBusiness = Pick<Business, "id" | "is_active" | "timezone" | "opening_time" | "closing_time" | "store_schedule">;

const DAY_INDEX: Record<string, StoreDayKey> = {
  Mon: "monday", Tue: "tuesday", Wed: "wednesday", Thu: "thursday", Fri: "friday", Sat: "saturday", Sun: "sunday",
};

const operatingStatusCache = new Map<string, StoreAvailability>();

export async function fetchServerOperatingStatus(businessId: string): Promise<StoreAvailability | null> {
  try {
    const res = await fetch(`/api/businesses/${businessId}/operating-status`);
    if (res.ok) {
      const data: StoreAvailability = await res.json();
      operatingStatusCache.set(businessId, data);
      return data;
    }
  } catch {}
  return null;
}

export function normalizeStoreSchedule(business: Pick<Business, "opening_time" | "closing_time" | "store_schedule">): NormalizedStoreSchedule {
  const opening = business.opening_time?.slice(0, 5) || "09:00";
  const closing = business.closing_time?.slice(0, 5) || "22:00";
  const source = business.store_schedule ?? {};
  const weekly = Object.fromEntries(
    STORE_DAY_KEYS.map((day) => {
      const saved = source.weekly?.[day];
      return [day, { closed: saved?.closed ?? false, slots: normalizeSlots(saved?.slots, opening, closing) }];
    })
  ) as Record<StoreDayKey, StoreDaySchedule>;

  return {
    enabled: source.enabled ?? true,
    weekly,
    overrides: (source.overrides ?? []).map((override) => ({ ...override, slots: normalizeSlots(override.slots, opening, closing) })),
    emergency_closed: source.emergency_closed ?? false,
    emergency_message: source.emergency_message?.trim() || "We are temporarily unavailable. Please check back shortly.",
  };
}

export function getStoreAvailability(business: StoreAvailabilityBusiness, now = new Date()): StoreAvailability {
  if (business?.id && operatingStatusCache.has(business.id)) {
    return operatingStatusCache.get(business.id)!;
  }
  if (!business.is_active) {
    return { isOpen: false, title: "Orders are paused", message: "This location is not accepting new orders right now.", shortMessage: "Not accepting orders" };
  }

  const schedule = normalizeStoreSchedule(business);
  if (schedule.emergency_closed) {
    return { isOpen: false, title: "Temporarily unavailable", message: schedule.emergency_message, shortMessage: "Temporarily unavailable" };
  }

  const clock = zonedClock(now, business.timezone || "Asia/Kolkata");
  const override = schedule.overrides.find((entry) => entry.date === clock.date);
  const daySchedule = override ?? schedule.weekly[clock.day];
  if (!schedule.enabled) return legacyAvailability(business, clock.minutes);

  if (daySchedule.closed) {
    return {
      isOpen: false,
      title: override?.label ? `${override.label}: closed` : "Store closed",
      message: nextOpeningMessage(schedule, clock.day),
      shortMessage: "Closed today",
    };
  }

  const activeSlot = daySchedule.slots.find((slot) => isWithinSlot(clock.minutes, slot));
  if (activeSlot) {
    return { isOpen: true, title: "Open now", message: `Open until ${formatClock(activeSlot.close)}.`, shortMessage: `Open until ${formatClock(activeSlot.close)}` };
  }

  if (!override) {
    const [year, month, date] = clock.date.split("-").map(Number);
    const previousDate = new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10);
    const previousDay = STORE_DAY_KEYS[(STORE_DAY_KEYS.indexOf(clock.day) + STORE_DAY_KEYS.length - 1) % STORE_DAY_KEYS.length];
    const previousOverride = schedule.overrides.find((entry) => entry.date === previousDate);
    const previousSchedule = previousOverride ?? schedule.weekly[previousDay];
    const overnightTail = !previousSchedule.closed && previousSchedule.slots.find((slot) => isOvernightTail(clock.minutes, slot));
    if (overnightTail) {
      return { isOpen: true, title: "Open now", message: `Open until ${formatClock(overnightTail.close)}.`, shortMessage: `Open until ${formatClock(overnightTail.close)}` };
    }
  }

  if (daySchedule.slots.length === 0) {
    return {
      isOpen: false,
      title: override?.label ? `${override.label}: closed` : "Store closed",
      message: nextOpeningMessage(schedule, clock.day),
      shortMessage: "Closed today",
    };
  }

  const nextToday = daySchedule.slots.find((slot) => clock.minutes < toMinutes(slot.open));
  return {
    isOpen: false,
    title: "Store closed",
    message: nextToday ? `Ordering opens today at ${formatClock(nextToday.open)}.` : nextOpeningMessage(schedule, clock.day),
    shortMessage: nextToday ? `Opens at ${formatClock(nextToday.open)}` : "Closed",
  };
}

function normalizeSlots(slots: StoreTimeSlot[] | undefined, opening: string, closing: string) {
  const valid = (slots ?? []).filter((slot) => slot.open && slot.close);
  return valid.length ? valid : [{ open: opening, close: closing }];
}

function zonedClock(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: DAY_INDEX[value("weekday")] ?? "monday",
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour") || 0) * 60 + Number(value("minute") || 0),
  };
}

function legacyAvailability(business: Pick<Business, "opening_time" | "closing_time">, minutes: number): StoreAvailability {
  if (!business.opening_time || !business.closing_time) {
    return { isOpen: true, title: "Open now", message: "Ready for orders.", shortMessage: "Ready for orders" };
  }
  const slot = { open: business.opening_time.slice(0, 5), close: business.closing_time.slice(0, 5) };
  return isWithinSlot(minutes, slot) || isOvernightTail(minutes, slot)
    ? { isOpen: true, title: "Open now", message: `Open until ${formatClock(slot.close)}.`, shortMessage: `Open until ${formatClock(slot.close)}` }
    : { isOpen: false, title: "Store closed", message: `Ordering opens at ${formatClock(slot.open)}.`, shortMessage: `Opens at ${formatClock(slot.open)}` };
}

function isWithinSlot(minutes: number, slot: StoreTimeSlot) {
  const open = toMinutes(slot.open);
  const close = toMinutes(slot.close);
  return open === close ? true : open < close ? minutes >= open && minutes < close : minutes >= open;
}

function isOvernightTail(minutes: number, slot: StoreTimeSlot) {
  return toMinutes(slot.open) > toMinutes(slot.close) && minutes < toMinutes(slot.close);
}

function nextOpeningMessage(schedule: NormalizedStoreSchedule, currentDay: StoreDayKey) {
  const start = STORE_DAY_KEYS.indexOf(currentDay);
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = STORE_DAY_KEYS[(start + offset) % STORE_DAY_KEYS.length];
    const entry = schedule.weekly[day];
    if (!entry.closed && entry.slots[0]) {
      return `Ordering opens ${day.charAt(0).toUpperCase() + day.slice(1)} at ${formatClock(entry.slots[0].open)}.`;
    }
  }
  return "This location is not accepting new orders right now.";
}

function toMinutes(value: string) {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

function formatClock(value: string) {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return new Date(2000, 0, 1, hour || 0, minute || 0).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
