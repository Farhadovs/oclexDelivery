function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

export async function onRequestGet({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({ error: "Stripe is not configured on the server." }, 500);
  }

  const sessionId = new URL(request.url).searchParams.get("session_id") || "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return jsonResponse({ error: "Missing or invalid checkout session." }, 400);
  }

  const stripeResponse = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }
  );
  const session = await stripeResponse.json();

  if (!stripeResponse.ok) {
    return jsonResponse({ error: "Could not verify payment with Stripe." }, 502);
  }
  if (session.payment_status !== "paid" || !session.metadata?.booking_ref) {
    return jsonResponse({ error: "Payment has not been confirmed yet." }, 409);
  }

  const metadata = session.metadata;
  return jsonResponse({
    paid: true,
    ref: metadata.booking_ref,
    booking: {
      pickup: metadata.pickup_address || "",
      dropoff: metadata.dropoff_address || "",
      customerName: metadata.customer_name || "",
      customerContact: metadata.customer_contact || "",
      deliveryPhone: metadata.delivery_contact_phone || metadata.customer_contact || "",
      vehicleName: metadata.vehicle || "",
      miles: Number(metadata.est_miles || 0),
      urgencyLabel: metadata.urgency || "",
      parcelDetails: metadata.parcel_details || "",
      bookingNotes: metadata.notes || "",
      totalPrice: Number(session.amount_total || 0) / 100
    }
  });
}
