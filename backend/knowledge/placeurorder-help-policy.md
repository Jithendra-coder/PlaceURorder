# PlaceURorder Product Help Policy

Version: 1.1.0
Reviewed: 2026-10-11
Owner: Product owner (review required before customer launch)

This guide is the source of truth for the dashboard Ask AI lookup. Keep it aligned with shipped product behavior. It is product help, not a contract, privacy notice, legal opinion, payment-provider promise, or service-level commitment.

## What PlaceURorder does

PlaceURorder provides a merchant dashboard and ordering/operations surfaces for kiosks, counter POS, kitchen display (KDS), and paired devices. The codebase defines these business types: restaurant, cafe, retail, bakery, pizza, burger, salon, grocery, ice cream, and other. Available screens and controls vary by business type and configuration.

## Business setup and onboarding

The dashboard setup flow tracks business details, menu, kiosk settings, welcome screen, preview, test completion, and publish readiness. A business must have core business, menu, kiosk settings, and welcome-screen configuration before publishing. The service also checks whether the required preview or successful test has been completed, depending on setup state. If a requirement is missing or the draft changes during publishing, review the returned requirement list and test the current draft again.

Choose the intended business during onboarding and confirm the selected business in the dashboard before changing its menu or settings. The dashboard can switch business locations; a location filter may change which records a page displays.

## Test, preview, and live orders

Test-device and onboarding test orders are stored as test records and use a test payment result. They are not proof that a live payment provider, live customer checkout, or production device is working. A preview records a preview attestation; a successful test records a separate test attestation. Publish the reviewed draft through the normal dashboard flow to make a kiosk configuration live.

Do not treat test orders as sales. If an order or payment result is unclear, inspect the corresponding order and provider status in the dashboard; Ask AI does not change or refund orders.

## Menu and availability

The dashboard manages categories, products, item prices, modifiers, availability, promotions, QR codes, branding, and kiosk presentation. The Ask AI live menu lookup reads the current editable catalog in Postgres (up to 30 listed items per answer); it does not resolve location schedules or certify that an item appears in the currently published kiosk snapshot. Confirm a price and availability in the menu editor and kiosk preview before relying on it.

## Orders, sales, and payments

The Ask AI order lookup returns only order counts grouped by status for the rolling last 24 hours. It does not fetch customer names, phone numbers, notes, individual order details, or payment credentials.

The Ask AI sales lookup is available only to roles permitted to view business administration data. It reports the count and total of completed orders marked paid or authorized in the rolling last 24 hours. It is not an accounting statement; refunds, settlement timing, taxes, provider fees, and business-local calendar cutoffs may affect reconciliation. Use the dashboard and payment provider records for an authoritative reconciliation.

The application contains integrations for Stripe, Razorpay, Paytm, and pay-at-counter flows. Each requires the appropriate merchant configuration and provider availability. Ask AI cannot confirm a provider account, settle a payment, or promise a refund.

## Roles and access

Business owners and administrators have full business access. The API defines additional manager, kitchen, cashier, salon-staff, kiosk, and viewer roles with different capabilities. Ask AI checks membership for the selected business and applies the same read-role boundaries as the corresponding dashboard data: catalog access for menu details, order-view access for order counts, and admin access for sales figures. A denial is expected when a role lacks the required access; ask a business administrator to review the role rather than sharing credentials.

## Ask AI behavior and limits

Ask AI retrieves cited passages from this guide and uses a small, explicit read-only method allowlist for current business setup, menu, order-count, and sales summaries. When `GEMINI_API_KEY` is unset or Google is unavailable, it returns an extractive source-only response. When configured, it sends the question and retrieved excerpts to Google Gemini to draft a concise answer; the model has no tools, SQL, or app API access. Each live method uses the signed-in user, selected business, role authorization, parameterized tenant-scoped SQL, and returns a source timestamp. The application does not store chat history.

Ask AI does not search legal drafts. It must not invent product behavior, prices, provider status, legal rights, hardware compatibility, or uptime. If a source is missing, stale, incomplete, or outside the allowlist, it should say so and point to the relevant dashboard area or support contact. Do not enter customer personal data, payment card data, secrets, or authentication tokens into the question field.

## Troubleshooting

- **A live-data answer is unavailable:** confirm you are signed in, the correct business is selected, and your role has access to that dashboard area.
- **Menu answer differs from the kiosk:** the lookup reflects current editable catalog rows and does not certify publication or location-specific availability. Review the publish state and preview.
- **Order counts look different from a dashboard date filter:** Ask AI uses a rolling 24-hour window; dashboard reports may use another date range, timezone, or location.
- **A test did not verify payment:** test payments are simulated. Configure and verify the actual provider separately before taking live orders.
- **The guide does not answer a question:** follow the relevant dashboard screen and contact the product operator at the support address shown in the current legal notice.
