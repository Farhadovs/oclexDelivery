# Paid booking WhatsApp alerts

The alert is sent only after Stripe confirms a paid Checkout Session. The Stripe webhook URL is:

`https://oclex.co.uk/api/stripe-webhook`

## Cloudflare Pages configuration

Add these variables/secrets to the production Pages project:

- `STRIPE_WEBHOOK_SECRET` — Stripe endpoint signing secret (`whsec_...`); store as a secret.
- `WHATSAPP_ACCESS_TOKEN` — Meta WhatsApp Cloud API access token; store as a secret.
- `WHATSAPP_PHONE_NUMBER_ID` — Meta sender phone number ID.
- `WHATSAPP_DISPATCH_TO` — dispatch recipient number in international format, e.g. `447...`.
- `WHATSAPP_GRAPH_API_VERSION` — current Graph API version, e.g. `vXX.X`.
- `WHATSAPP_BOOKING_TEMPLATE` — approved WhatsApp utility template name.
- `WHATSAPP_TEMPLATE_LANGUAGE` — template language code; defaults to `en_GB`.

Create a Cloudflare KV namespace and bind it to the Pages project as `BOOKING_EVENTS` to prevent duplicate alerts when Stripe retries a webhook.

## Stripe webhook

Create a Stripe webhook endpoint for the URL above and subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

Copy that endpoint's signing secret into the Cloudflare `STRIPE_WEBHOOK_SECRET` secret.

## WhatsApp template

Create and get approval for a utility template (for example, `oclex_paid_booking`) with these body variables in this exact order:

```text
Paid courier booking {{1}}
Customer: {{2}} ({{3}})
Vehicle: {{4}}
Service: {{5}}
Collection: {{6}}
Delivery: {{7}}
Delivery contact: {{8}}
Parcel: {{9}}
Notes: {{10}}
Estimated miles: {{11}}
Amount paid: {{12}}
```

The access token, sender number ID, recipient number, and template must belong to a WhatsApp Business Platform / Cloud API setup. Do not put access tokens in GitHub or the page source.
