CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_order_number(p_business_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  allocated_number integer;
BEGIN
  INSERT INTO public.order_counters AS counters (business_id, counter_date, next_number)
  VALUES (p_business_id, current_date, 2)
  ON CONFLICT (business_id, counter_date)
  DO UPDATE SET next_number = counters.next_number + 1
  RETURNING next_number - 1 INTO allocated_number;

  RETURN allocated_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_daily_product_sales()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE public.products
  SET sold_today = 0,
      is_available = CASE
        WHEN track_stock AND stock_quantity IS NOT NULL AND stock_quantity <= 0 THEN false
        ELSE true
      END;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.next_order_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.reset_daily_product_sales() FROM PUBLIC, anon, authenticated;

DROP INDEX IF EXISTS public.business_payment_accounts_business_provider_uidx;
DROP INDEX IF EXISTS public.device_pairing_requests_pairing_code_uidx;

DROP TABLE IF EXISTS public.password_reset_tokens;
DROP TABLE IF EXISTS public.email_verification_codes;
