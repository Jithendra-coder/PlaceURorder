# PlaceURorder Privacy Notice — Review Draft

**NOT EFFECTIVE. This is not ready for publication or user consent. Complete every marked item and obtain legal/privacy review before launch.**

- Operator name supplied by owner: **Jithendra Muttum**
- Legal entity / capacity: **[CONFIRM]**
- Business / registered address and privacy contact: **[REQUIRED]**
- Contact email: **muttumjithendra@gmail.com**
- Intended primary jurisdiction: **India; applicability and commencement dates require review**
- Effective date and version: **[REQUIRED]**

This draft describes the product areas observed in the repository. It is not a representation that any statutory compliance assessment is complete. The operator’s legal role, each merchant’s role, and whether the kiosk transaction model attracts additional e-commerce duties must be confirmed before publication.

## Information the Services may process

- **Account and authentication:** email, account/profile information, authentication and session data needed to sign in and protect accounts.
- **Business workspace:** business and location names, business type, addresses/contact details, staff roles, menu/catalog, prices, branding, settings, and device configuration.
- **Orders and operations:** order contents, quantities, selected modifiers, order/payment status, timestamps, and—where configured or required—customer name, phone, table or delivery details, and customer-entered notes. Do not submit full payment-card credentials to free-text fields, support, or Ask AI.
- **Uploads and integrations:** uploaded logos and images; data needed to connect configured payment, webhook, email, analytics, or media-search integrations.
- **Security and diagnostics:** audit events, request identifiers, rate-limit counters, device/session metadata, and technical error information. Exact hosting-provider logs and retention are **[REQUIRED: confirm]**.
- **Ask AI questions:** the assistant searches this product guide and may retrieve authorized business setup fields, limited menu rows, aggregate order counts, and aggregate paid-sales values. Those live business results are returned directly by MenuTap and are not sent to Gemini. When `GEMINI_API_KEY` is configured and a product-help question matches guide content, only the question and matching product-guide excerpts are sent to Google's Gemini API to draft an answer. Gemini receives no database/API tools. The application does not save chat history; the Gemini request sets `store: false`, but Google may process submitted question and guide text under the applicable account terms and service tier. Do not include personal data, card data, secrets, or tokens in a question.

## How information is used

Information is used to authenticate users, enforce business and role access, display and operate configured dashboards/kiosks, process orders through enabled integrations, support devices and staff workflows, protect the Services, and diagnose failures. The final notice must identify the precise legal purposes and applicable lawful bases and must not imply that an optional integration is enabled for every customer.

## Service providers and disclosures

The codebase integrates with Supabase Auth/Postgres/Storage, configurable SMTP email, optional payment, webhook, and Pexels image-search services, and—when configured—Google Gemini for product-help answer generation. A merchant’s configured webhooks may receive event payloads selected by that merchant. Gemini receives the user's product-help question and matching product-guide excerpts only; live business lookup results stay in MenuTap. Gemini cannot invoke app tools or query the database. Google’s current terms, processing, retention, and free/paid-tier data-use settings apply; Google's pricing page currently says free-tier submitted data may be used to improve products, while paid-tier data is not. **[REQUIRED: verify the Google account tier and data-use terms, publish the actual hosting region, complete subprocessor list, data locations/transfers, provider privacy links, and contractual safeguards.]**

Without a Gemini key, Ask AI returns the matching help-guide passages and keeps questions/source data within the app backend. With a key, product-help questions and matching guide excerpts may be sent to Google; live business query results remain in MenuTap. Generation must not be enabled for production until this notice, user disclosures, any required consent/contract terms, and the applicable Google data-use settings have been reviewed. Gemini has no SQL, URL, or app API access.

## Retention, security, and rights

**[REQUIRED: set retention periods for accounts, order records, logs, uploads, backups, and support records; define deletion/export and backup expiry.]** Retention must account for merchant instructions and applicable bookkeeping, tax, payment, consumer, and security obligations. The application uses authenticated sessions and business-role checks; specific encryption, backup, incident-response, and access-review commitments must be verified against production operations before they are stated as guarantees.

The final notice must explain how a person can request access, correction, deletion, withdrawal/objection where available, grievance redressal, or appeal; identify the responsible contact and any Data Protection Officer or grievance officer required by applicable law; and explain response and escalation periods. Merchants must provide appropriate notices to their own end customers and handle requests relating to merchant-controlled order data, with the operator’s assistance as required by the final contract and law.

## Children, transfers, and changes

The intended customer is a business operator. The Services are not designed for children to create merchant accounts. Merchants must not collect children’s personal data through an ordering flow unless they have reviewed the applicable requirements and configured the flow lawfully. Cross-border hosting or provider transfers are **[REQUIRED: confirm from production configuration]**.

The final notice must specify how material updates are announced and their effective date. Do not treat this draft’s date as an effective date.

## Required launch review

Confirm the legal entity/contact address; who determines purposes for merchant and end-customer data; exact data fields and purposes per surface; lawful basis/consent and required notices; current DPDP Act/Rules commencement and applicability; e-commerce/grievance duties; hosting and storage regions; provider/subprocessor agreements; data retention and deletion; user rights workflow; security/incident response; international transfers; and the final notice/consent UI.

## Official legal references for counsel

- [Digital Personal Data Protection Act, 2023 — India Code](https://www.indiacode.nic.in/indiacode/handle/123456789/22037?view_type=browse)
- [Digital Personal Data Protection Rules, 2025 and enforcement timeline — MeitY](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digit)
- [Consumer Protection Act and rules, including E-Commerce Rules — Department of Consumer Affairs](https://consumeraffairs.nic.in/acts-and-rules/consumer-protection/consumer-protection)
- [Gemini API keys and security — Google AI for Developers](https://ai.google.dev/gemini-api/docs/api-key)
- [Gemini API pricing and service-tier data use — Google AI for Developers](https://ai.google.dev/gemini-api/docs/pricing)
