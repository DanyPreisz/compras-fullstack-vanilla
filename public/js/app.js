import { api, setSession, clearSession, getToken } from "./api.js";

const authView = document.querySelector("#auth-view");
const appView = document.querySelector("#app-view");
const authForm = document.querySelector("#auth-form");
const authError = document.querySelector("#auth-error");
const authSubmit = document.querySelector("#auth-submit");
const listEl = document.querySelector("#list");
const aislesEl = document.querySelector("#aisles");
const filtersEl = document.querySelector("#filters");
const form = document.querySelector("#item-form");
const formError = document.querySelector("#form-error");
let mode = "login";
let aisle = "Todas";
let filter = "open";
let query = "";
let timer;
const showError = (el, message) => { el.hidden = !message; el.textContent = message || ""; };

function setMode(next) {
  mode = next;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  authSubmit.textContent = mode === "login" ? "Entrar" : "Crear cuenta";
}
function renderFilters() {
  filtersEl.innerHTML = "";
  [["open", "Pendientes"], ["bought", "Comprados"], ["all", "Todos"]].forEach(([value, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab${filter === value ? " active" : ""}`;
    button.textContent = label;
    button.addEventListener("click", async () => { filter = value; await refresh(); });
    filtersEl.append(button);
  });
}
async function loadAisles() {
  const data = await api("/api/aisles");
  const items = [{ name: "Todas", count: data.aisles.reduce((sum, item) => sum + item.count, 0) }, ...data.aisles];
  aislesEl.innerHTML = "";
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `aisle${item.name === aisle ? " active" : ""}`;
    button.textContent = `${item.name} (${item.count})`;
    button.addEventListener("click", async () => { aisle = item.name; await refresh(); });
    aislesEl.append(button);
  });
}
async function loadItems() {
  const params = new URLSearchParams({ filter });
  if (query) params.set("q", query);
  if (aisle !== "Todas") params.set("aisle", aisle);
  const data = await api(`/api/items?${params}`);
  document.querySelector("#open-count").textContent = `${data.open} pendiente${data.open === 1 ? "" : "s"}`;
  listEl.innerHTML = "";
  if (!data.items.length) {
    const empty = document.createElement("li");
    empty.textContent = "No hay productos.";
    listEl.append(empty);
    return;
  }
  data.items.forEach((item) => {
    const li = document.createElement("li");
    li.className = `item${item.bought ? " bought" : ""}`;
    const check = document.createElement("button");
    check.className = "check";
    check.type = "button";
    check.textContent = item.bought ? "v" : "o";
    check.addEventListener("click", async () => { await api(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ bought: !item.bought }) }); await refresh(); });
    const text = document.createElement("span");
    text.textContent = `${item.qty} ${item.unit} ${item.name}`.replace("  ", " ");
    const meta = document.createElement("small");
    meta.textContent = item.aisle;
    const del = document.createElement("button");
    del.className = "ghost";
    del.type = "button";
    del.textContent = "Borrar";
    del.addEventListener("click", async () => { await api(`/api/items/${item.id}`, { method: "DELETE" }); await refresh(); });
    li.append(check, text, meta, del);
    listEl.append(li);
  });
}
async function refresh() { renderFilters(); await loadAisles(); await loadItems(); }
async function boot() {
  if (!getToken()) return;
  try {
    const { user } = await api("/api/auth/me");
    authView.classList.add("hidden");
    appView.classList.remove("hidden");
    document.querySelector("#user-name").textContent = user.username;
    await refresh();
  } catch { clearSession(); }
}
document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError(authError, "");
  const fd = new FormData(authForm);
  try {
    const data = await api(mode === "login" ? "/api/auth/login" : "/api/auth/register", { method: "POST", body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") }) });
    setSession(data.token);
    authForm.reset();
    await boot();
  } catch (err) { showError(authError, err.message); }
});
document.querySelector("#logout").addEventListener("click", () => { clearSession(); appView.classList.add("hidden"); authView.classList.remove("hidden"); });
document.querySelector("#search").addEventListener("input", (event) => { clearTimeout(timer); timer = setTimeout(async () => { query = event.target.value.trim(); await loadItems(); }, 200); });
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError(formError, "");
  try {
    await api("/api/items", { method: "POST", body: JSON.stringify({ name: document.querySelector("#name").value.trim(), qty: document.querySelector("#qty").value, unit: document.querySelector("#unit").value.trim(), aisle: document.querySelector("#aisle").value.trim() }) });
    form.reset();
    document.querySelector("#qty").value = 1;
    await refresh();
  } catch (err) { showError(formError, err.message); }
});
document.querySelector("#clear-bought").addEventListener("click", async () => { await api("/api/items", { method: "DELETE" }); await refresh(); });
boot();
