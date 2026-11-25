export async function onRequestPost(context) {
  const { request, env } = context;

  const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  try {
    if (!env.STRIPE_SECRET_KEY) {
      return new Response(
        JSON.stringify({ error: 'Stripe is not configured on the server.' }),
        { status: 500, headers: jsonHeaders }
      );
    }

    const body = await request.json();
    const {
      ref,
      pickup,
      pickupPostcode,
      dropoff,
      dropoffPostcode,
      vehicleName,
      miles,
      urgencyLabel,
      parcelDetails,
      bookingNotes,
      customerName,
      customerContact,
      totalPrice
    } = body;

    const amountPence = Math.round(Number(totalPrice) * 100);
    if (!ref || !pickup || !dropoff || !customerName || !customerContact || !parcelDetails || !amountPence || amountPence < 100) {
      return new Response(
        JSON.stringify({ error: 'Missing required booking details or invalid price.' }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const origin = new URL(request.url).origin;
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerContact.trim());

    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', `${origin}/?paid=1&ref=${encodeURIComponent(ref)}&session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url', `${origin}/?cancelled=1`);

    // Avoid asking for email twice: pre-fill if user entered email, otherwise let Stripe collect email for receipt
    if (isEmail) {
      params.append('customer_email', customerContact.trim());
    }

    params.append('line_items[0][price_data][currency]', 'gbp');
    params.append('line_items[0][price_data][unit_amount]', String(amountPence));
    params.append(
      'line_items[0][price_data][product_data][name]',
      `OCLEX Dedicated Courier — ${vehicleName} (${pickupPostcode} to ${dropoffPostcode})`
    );
    params.append(
      'line_items[0][price_data][product_data][description]',
      `Ref: ${ref} | ${urgencyLabel} | ~${miles} mi | Parcel: ${parcelDetails.slice(0, 120)}`
    );
    params.append('line_items[0][quantity]', '1');

    // Full booking metadata for dispatch in Stripe Dashboard & webhooks
    const metadata = {
      booking_ref: ref,
      customer_name: customerName.slice(0, 200),
      customer_contact: customerContact.slice(0, 200),
      pickup_postcode: pickupPostcode || '',
      pickup_address: pickup.slice(0, 250),
      dropoff_postcode: dropoffPostcode || '',
      dropoff_address: dropoff.slice(0, 250),
      vehicle: vehicleName || '',
      est_miles: String(miles || ''),
      urgency: urgencyLabel || '',
      parcel_details: parcelDetails.slice(0, 400),
      notes: (bookingNotes || '').slice(0, 400),
      terms_accepted: 'true'
    };

    for (const [key, value] of Object.entries(metadata)) {
      params.append(`metadata[${key}]`, value);
      params.append(`payment_intent_data[metadata][${key}]`, value);
    }

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }, 
      body: params.toString()
    });

    const stripeData = await stripeRes.json();

    if (!stripeRes.ok) {
      return new Response(
        JSON.stringify({ error: stripeData.error?.message || 'Stripe Checkout error.' }),
        { status: stripeRes.status, headers: jsonHeaders }
      );
    }

    return new Response(
      JSON.stringify({ url: stripeData.url, id: stripeData.id }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Server error creating checkout session.' }),
      { status: 500, headers: jsonHeaders }
    );
  }
}