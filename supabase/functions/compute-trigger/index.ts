const ANALYTICS_URL = Deno.env.get("ANALYTICS_SERVICE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("ANALYTICS_SERVICE_KEY") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!ANALYTICS_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Analytics service not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await req.json();
  const { strategy_id, trigger } = body;

  if (!strategy_id) {
    return new Response(JSON.stringify({ error: "Missing strategy_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Idempotency: check if already computing
  // The analytics service handles this via computation_status = "computing" guard

  try {
    const res = await fetch(`${ANALYTICS_URL}/api/compute-analytics`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Key": SERVICE_KEY,
      },
      body: JSON.stringify({ strategy_id }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Unknown error" }));
      console.error(`Compute failed for ${strategy_id} (trigger: ${trigger}):`, err);
      return new Response(JSON.stringify({ error: err.detail, strategy_id }), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await res.json();
    return new Response(JSON.stringify({ ...result, trigger }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`Compute trigger error for ${strategy_id}:`, err);
    return new Response(JSON.stringify({ error: "Analytics service unreachable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
});
