import targets from "../../config/targets.json";

type Target = (typeof targets)[number];
type CheckResult = Target & {
  statusCode: number;
  latencyMs: number;
  checkedAt: string;
  healthy: boolean;
  error?: string;
};

const snapshotKey = "status:latest";

async function checkTarget(target: Target): Promise<CheckResult> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), 8_000);
  try {
    const response = await fetch(target.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "GoHealthMonitor-Edge/1.0" },
    });
    return {
      ...target,
      statusCode: response.status,
      latencyMs: Math.round(performance.now() - started),
      checkedAt: new Date().toISOString(),
      healthy: response.status >= 200 && response.status < 400,
    };
  } catch (error) {
    return {
      ...target,
      statusCode: 0,
      latencyMs: Math.round(performance.now() - started),
      checkedAt: new Date().toISOString(),
      healthy: false,
      error: error instanceof Error ? error.message : "Request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function collect(env: Env): Promise<{ checkedAt: string; results: CheckResult[] }> {
  const results = await Promise.all(targets.map((target) => checkTarget(target)));
  const snapshot = { checkedAt: new Date().toISOString(), results };
  await env.STATUS.put(snapshotKey, JSON.stringify(snapshot));
  console.log(JSON.stringify({ message: "health checks complete", healthy: results.filter((item) => item.healthy).length, total: results.length }));
  return snapshot;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/status") {
        const stored = await env.STATUS.get(snapshotKey, "json");
        return stored ? json(stored) : json(await collect(env));
      }
      if (url.pathname === "/api/refresh" && request.method === "POST") {
        return json(await collect(env));
      }
      if (url.pathname === "/api/health") {
        return json({ status: "ok", targetCount: targets.length });
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(JSON.stringify({ message: "request failed", error: message, path: url.pathname }));
      return json({ error: "Health data is temporarily unavailable" }, 503);
    }
  },
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(collect(env));
  },
} satisfies ExportedHandler<Env>;
