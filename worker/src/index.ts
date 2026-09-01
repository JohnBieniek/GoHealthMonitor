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
const alertKeyPrefix = "alert:";

type Issue = {
  kind: "down" | "latency";
  result: CheckResult;
};

type AlertState = {
  kind: Issue["kind"];
  alertedAt: string;
};

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

function issueFor(result: CheckResult, threshold: number): Issue | null {
  if (!result.healthy) return { kind: "down", result };
  if (result.latencyMs > threshold) return { kind: "latency", result };
  return null;
}

function escapeHTML(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function sendAlerts(env: Env, results: CheckResult[]): Promise<void> {
  const threshold = Number(env.LATENCY_THRESHOLD_MS);
  const issues = results.map((result) => issueFor(result, threshold)).filter((issue): issue is Issue => issue !== null);
  const states = await Promise.all(results.map((result) => env.STATUS.get<AlertState>(`${alertKeyPrefix}${result.id}`, "json")));
  const newIssues = issues.filter((issue) => {
    const index = results.findIndex((result) => result.id === issue.result.id);
    return states[index]?.kind !== issue.kind;
  });

  const activeIDs = new Set(issues.map((issue) => issue.result.id));
  await Promise.all(results.filter((result) => !activeIDs.has(result.id) && states[results.indexOf(result)] !== null)
    .map((result) => env.STATUS.delete(`${alertKeyPrefix}${result.id}`)));
  if (newIssues.length === 0) return;

  const lines = newIssues.map(({ kind, result }) => [
    `${result.name}: ${kind === "down" ? "DOWN" : "LATENCY SPIKE"}`,
    `URL: ${result.url}`,
    `HTTP: ${result.statusCode || "ERR"}`,
    `Latency: ${result.latencyMs} ms`,
    `Checked: ${result.checkedAt}`,
  ].join("\n"));
  const rows = newIssues.map(({ kind, result }) => `<tr>
    <td style="padding:8px;border-bottom:1px solid #d7ddd9"><strong>${escapeHTML(result.name)}</strong></td>
    <td style="padding:8px;border-bottom:1px solid #d7ddd9">${kind === "down" ? "Down" : "Latency spike"}</td>
    <td style="padding:8px;border-bottom:1px solid #d7ddd9">${result.statusCode || "ERR"}</td>
    <td style="padding:8px;border-bottom:1px solid #d7ddd9">${result.latencyMs} ms</td>
  </tr>`).join("");
  const count = newIssues.length;
  const response = await env.ALERT_EMAIL.send({
    to: env.ALERT_TO,
    from: { email: env.ALERT_FROM, name: "Whimsy's Warden" },
    subject: `[Whimsy's Warden] ${count} new service alert${count === 1 ? "" : "s"}`,
    text: `Whimsy's Warden detected ${count} new incident${count === 1 ? "" : "s"}.\n\n${lines.join("\n\n")}\n\nDashboard: https://go-health-monitor.redacted.workers.dev/`,
    html: `<div style="font-family:Arial,sans-serif;color:#111014"><h1 style="color:#4b0c83">Whimsy's Warden</h1>
      <p>Detected ${count} new incident${count === 1 ? "" : "s"}.</p>
      <table style="border-collapse:collapse;width:100%"><thead><tr><th align="left">Service</th><th align="left">Alert</th><th align="left">HTTP</th><th align="left">Latency</th></tr></thead><tbody>${rows}</tbody></table>
      <p><a href="https://go-health-monitor.redacted.workers.dev/" style="color:#4b0c83">Open Whimsy's Warden</a></p></div>`,
  });
  const alertedAt = new Date().toISOString();
  await Promise.all(newIssues.map((issue) => env.STATUS.put(`${alertKeyPrefix}${issue.result.id}`, JSON.stringify({ kind: issue.kind, alertedAt } satisfies AlertState))));
  console.log(JSON.stringify({ message: "monitor alerts accepted", messageId: response.messageId, alerts: count }));
}

async function collect(env: Env, alert = false): Promise<{ checkedAt: string; results: CheckResult[] }> {
  const results = await Promise.all(targets.map((target) => checkTarget(target)));
  const snapshot = { checkedAt: new Date().toISOString(), results };
  await env.STATUS.put(snapshotKey, JSON.stringify(snapshot));
  if (alert) await sendAlerts(env, results);
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
    ctx.waitUntil(collect(env, true));
  },
} satisfies ExportedHandler<Env>;
