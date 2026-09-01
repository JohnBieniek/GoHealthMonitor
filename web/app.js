const systems = document.querySelector("#systems");
const refresh = document.querySelector("#refresh");
let snapshot = null;
let filter = "all";

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function card(item) {
  const isProduction = item.environment === "production";
  const tag = isProduction ? "a" : "article";
  const link = isProduction ? ` href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHTML(item.name)}"` : "";
  return `<${tag} class="card ${item.environment} ${isProduction ? "card-link " : ""}${item.healthy ? "" : "down"}"${link}>
    <div><h2>${escapeHTML(item.name)}</h2><p class="meta">${escapeHTML(item.group)} · ${escapeHTML(item.environment)}</p></div>
    <span class="badge">${item.healthy ? "OPERATIONAL" : "DEGRADED"}</span>
    <div class="metrics"><span>HTTP <b>${item.statusCode || "ERR"}</b></span><span>LATENCY <b>${item.latencyMs} ms</b></span><span>CHECKED <b>${new Date(item.checkedAt).toLocaleTimeString()}</b></span></div>
  </${tag}>`;
}

function pairedCards(results) {
  const projects = new Map();
  results.forEach((item) => {
    if (!projects.has(item.project)) projects.set(item.project, []);
    projects.get(item.project).push(item);
  });
  return [...projects.values()].map((items) => {
    const production = items.filter((item) => item.environment === "production");
    const betas = items.filter((item) => item.environment === "beta");
    return `<section class="system-pair">
      <div class="pair-column">${production.map(card).join("")}</div>
      <div class="pair-column">${betas.map(card).join("")}</div>
    </section>`;
  }).join("");
}

function render() {
  if (!snapshot) return;
  const visible = snapshot.results.filter((item) => filter === "all" || item.environment === filter);
  const healthy = snapshot.results.filter((item) => item.healthy).length;
  const latencies = snapshot.results.map((item) => item.latencyMs).sort((a, b) => a - b);
  document.querySelector("#healthy").textContent = `${healthy}/${snapshot.results.length}`;
  document.querySelector("#unhealthy").textContent = String(snapshot.results.length - healthy);
  document.querySelector("#latency").textContent = `${latencies[Math.floor(latencies.length / 2)] || 0} ms`;
  document.querySelector("#checked").textContent = new Date(snapshot.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  systems.classList.toggle("paired", filter === "all");
  systems.innerHTML = filter === "all" ? pairedCards(visible) : visible.map(card).join("");
}

async function load(path = "/api/status", options) {
  refresh.disabled = true;
  refresh.textContent = "Checking…";
  try {
    const response = await fetch(path, options);
    if (!response.ok) throw new Error(`Monitor returned ${response.status}`);
    snapshot = await response.json();
    render();
  } catch (error) {
    systems.innerHTML = `<p class="loading">${escapeHTML(error.message)}. Try again shortly.</p>`;
  } finally {
    refresh.disabled = false;
    refresh.textContent = "Run checks now";
  }
}

document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
  document.querySelector("[data-filter].active").classList.remove("active");
  button.classList.add("active");
  filter = button.dataset.filter;
  render();
}));
refresh.addEventListener("click", () => load("/api/refresh", { method: "POST" }));
load();
