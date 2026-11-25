export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const amountPence = Math.round(Number(body.amountIncVat) * 100);

    if (!amountPence || amountPence < 50) {
      return new Response(JSON.stringify({ error: "Invalid quote amount" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const origin = new URL(request.url).origin;
    const refCode = String(body.refCode || "OCX-0000");

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("payment_method_types[0]", "card");
    params.append("line_items[0][price_data][currency]", "gbp");
    params.append("line_items[0][price_data][unit_amount]", String(amountPence));
    params.append("line_items[0][price_data][product_data][name]", `OCLEX Same-Day (${body.vehicle || "Courier"})`);
    params.append(
      "line_items[0][price_data][product_data][description]",
      `Ref ${refCode}: ${body.pickup || ""} -> ${body.dropoff || ""}`
    );
    params.append("line_items[0][quantity]", "1");
    params.append("metadata[refCode]", refCode);
    params.append("metadata[pickup]", String(body.pickup || ""));
    params.append("metadata[dropoff]", String(body.dropoff || ""));
    params.append("metadata[pickupNotes]", String(body.pickupNotes || ""));
    params.append("metadata[dropoffNotes]", String(body.dropoffNotes || ""));
    params.append("metadata[contact]", String(body.contact || ""));
    params.append("success_url", `${origin}/?paid=1&ref=${encodeURIComponent(refCode)}`);
    params.append("cancel_url", `${origin}/?cancelled=1`);

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const session = await stripeRes.json();
    if (!stripeRes.ok || !session.url) {
      return new Response(JSON.stringify({ error: session.error?.message || "Stripe error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Server error creating checkout session" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}