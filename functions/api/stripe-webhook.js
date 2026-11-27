const encoder = new TextEncoder();

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  return new Uint8Array(hex.match(/.{2}/g).map((byte) => parseInt(byte, 16)));
}

async function verifyStripeSignature(payload, signatureHeader, secret) {
  const parts = (signatureHeader || "").split(",").map((part) => part.trim().split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  const timestampNumber = Number(timestamp);

  if (!timestamp || !Number.isFinite(timestampNumber) || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - timestampNumber) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signedPayload = encoder.encode(`${timestamp}.${payload}`);

  for (const signature of signatures) {
    const signatureBytes = hexToBytes(signature);
    if (signatureBytes && await crypto.subtle.verify("HMAC", key, signatureBytes, signedPayload)) return true;
  }
  return false;
}

function clean(value, maxLength = 250) {
  return String(value || "Not provided").replace(/[\r\n]+/g, " ").slice(0, maxLength);
}

function phoneForWhatsApp(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `44${digits.slice(1)}`;
  return digits;
}

async function sendBookingTemplate(session, env) {
  const metadata = session.metadata || {};
  // These values must match {{1}} through {{12}} in the approved WhatsApp template.
  const values = [
    clean(metadata.booking_ref, 40),
    clean(metadata.customer_name, 100),
    clean(metadata.customer_contact, 40),
    clean(metadata.vehicle, 60),
    clean(metadata.urgency, 60),
    clean(metadata.pickup_address, 250),
    clean(metadata.dropoff_address, 250),
    clean(metadata.delivery_contact_phone || metadata.customer_contact, 40),
    clean(metadata.parcel_details, 250),
    clean(metadata.notes, 250),
    clean(metadata.est_miles, 20),
    `£${(Number(session.amount_total || 0) / 100).toFixed(2)} ${String(session.currency || "gbp").toUpperCase()}`
  ];

  const response = await fetch(
    `https://graph.facebook.com/${env.WHATSAPP_GRAPH_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phoneForWhatsApp(env.WHATSAPP_DISPATCH_TO),
        type: "template",
        template: {
          name: env.WHATSAPP_BOOKING_TEMPLATE,
          language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE || "en_GB" },
          components: [{
            type: "body",
            parameters: values.map((text) => ({ type: "text", text }))
          }]
        }
      })
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("WhatsApp booking notification failed:", response.status, errorBody.slice(0, 1000));
    throw new Error("WhatsApp notification could not be sent.");
  }
}

export async function onRequestPost({ request, env }) {
  if (
    !env.STRIPE_WEBHOOK_SECRET ||
    !env.WHATSAPP_ACCESS_TOKEN ||
    !env.WHATSAPP_PHONE_NUMBER_ID ||
    !env.WHATSAPP_DISPATCH_TO ||
    !env.WHATSAPP_BOOKING_TEMPLATE ||
    !env.WHATSAPP_GRAPH_API_VERSION ||
    !env.BOOKING_EVENTS
  ) {
    return jsonResponse({ error: "Booking notifications are not configured." }, 503);
  }

  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  let validSignature = false;

  try {
    validSignature = await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error("Stripe signature verification failed.", error);
  }

  if (!validSignature) return jsonResponse({ error: "Invalid Stripe signature." }, 400);

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return jsonResponse({ error: "Invalid webhook payload." }, 400);
  }

  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
    return jsonResponse({ received: true });
  }

  const session = event.data?.object;
  if (!session || session.payment_status !== "paid") return jsonResponse({ received: true });

  const eventKey = `stripe:${event.id}`;
  if (await env.BOOKING_EVENTS.get(eventKey)) return jsonResponse({ received: true, duplicate: true });

  try {
    await sendBookingTemplate(session, env);
    await env.BOOKING_EVENTS.put(eventKey, "sent", { expirationTtl: 60 * 60 * 24 * 30 });
    return jsonResponse({ received: true, notified: true });
  } catch (error) {
    console.error("Paid booking notification failed:", error);
    return jsonResponse({ error: "Booking notification failed; Stripe should retry." }, 500);
  }
}
