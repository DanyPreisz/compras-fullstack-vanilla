import { URL } from "node:url";
import { connect, isReady, users, items, toId, mapItem } from "./db.js";
import { createApp, readJson, sendEmpty, sendJson, serveStatic } from "./http.js";
import { getUserFromRequest, hashPassword, signToken, verifyPassword } from "./middleware/auth.js";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
function usernameQuery(username) { return new RegExp("^" + username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i"); }
function requireUser(req, res) { const user = getUserFromRequest(req); if (!user) { sendJson(res, 401, { error: "No autenticado" }); return null; } return user; }
function cleanAisle(value) { return String(value || "").trim().slice(0, 24) || "General"; }
function qtyOf(value) { const qty = Number(value); if (!Number.isFinite(qty) || qty <= 0) return 1; return Math.round(qty * 100) / 100; }

const server = createApp(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const { pathname, searchParams } = url;
  const method = req.method || "GET";
  if (pathname === "/health") return sendJson(res, 200, { ok: true, db: isReady() });
  if (pathname.startsWith("/api/") && !isReady()) return sendJson(res, 503, { error: "Base no lista" });
  if (!pathname.startsWith("/api/")) return serveStatic(req, res);

  if (method === "POST" && pathname === "/api/auth/register") {
    const body = await readJson(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!USERNAME_RE.test(username)) return sendJson(res, 400, { error: "Usuario: 3-20 caracteres, letras, numeros y _" });
    if (password.length < 6) return sendJson(res, 400, { error: "La contrasena debe tener al menos 6 caracteres" });
    if (await users().findOne({ username: usernameQuery(username) })) return sendJson(res, 409, { error: "Ese usuario ya existe" });
    const result = await users().insertOne({ username, passwordHash: hashPassword(password), createdAt: new Date() });
    const user = { id: String(result.insertedId), username };
    return sendJson(res, 201, { user, token: signToken(user) });
  }
  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await readJson(req);
    const username = String(body.username || "").trim();
    const row = await users().findOne({ username: usernameQuery(username) });
    if (!row || !verifyPassword(String(body.password || ""), row.passwordHash)) return sendJson(res, 401, { error: "Usuario o contrasena incorrectos" });
    const user = { id: String(row._id), username: row.username };
    return sendJson(res, 200, { user, token: signToken(user) });
  }
  if (method === "GET" && pathname === "/api/auth/me") {
    const user = requireUser(req, res);
    if (!user) return;
    const row = await users().findOne({ _id: toId(user.id) });
    if (!row) return sendJson(res, 401, { error: "Usuario no encontrado" });
    return sendJson(res, 200, { user: { id: String(row._id), username: row.username } });
  }

  if (pathname === "/api/items" || pathname.startsWith("/api/items/") || pathname === "/api/aisles") {
    const user = requireUser(req, res);
    if (!user) return;
    const userId = user.id;
    if (method === "GET" && pathname === "/api/aisles") {
      const rows = await items().aggregate([{ $match: { userId } }, { $group: { _id: "$aisle", count: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray();
      return sendJson(res, 200, { aisles: rows.map((row) => ({ name: row._id, count: row.count })) });
    }
    if (method === "GET" && pathname === "/api/items") {
      const q = String(searchParams.get("q") || "").trim();
      const aisle = String(searchParams.get("aisle") || "").trim();
      const filter = String(searchParams.get("filter") || "open");
      const query = { userId };
      if (aisle && aisle !== "Todas") query.aisle = aisle;
      if (filter === "open") query.bought = false;
      if (filter === "bought") query.bought = true;
      if (q) query.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      const rows = await items().find(query).sort({ bought: 1, createdAt: -1 }).limit(200).toArray();
      const open = await items().countDocuments({ userId, bought: false });
      return sendJson(res, 200, { items: rows.map(mapItem), open });
    }
    if (method === "POST" && pathname === "/api/items") {
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      if (!name) return sendJson(res, 400, { error: "El producto es obligatorio" });
      const result = await items().insertOne({ userId, name: name.slice(0, 80), qty: qtyOf(body.qty), unit: String(body.unit || "").slice(0, 12), aisle: cleanAisle(body.aisle), bought: false, createdAt: new Date() });
      return sendJson(res, 201, { item: mapItem(await items().findOne({ _id: result.insertedId })) });
    }
    if (method === "DELETE" && pathname === "/api/items") {
      await items().deleteMany({ userId, bought: true });
      return sendEmpty(res, 204);
    }
    const match = pathname.match(/^\/api\/items\/([a-fA-F0-9]{24})$/);
    if (match) {
      const id = toId(match[1]);
      if (method === "PATCH") {
        const existing = await items().findOne({ _id: id, userId });
        if (!existing) return sendJson(res, 404, { error: "Item no encontrado" });
        const body = await readJson(req);
        const name = body.name !== undefined ? String(body.name).trim() : existing.name;
        if (!name) return sendJson(res, 400, { error: "El producto no puede estar vacio" });
        await items().updateOne({ _id: id, userId }, { $set: { name: name.slice(0, 80), qty: body.qty !== undefined ? qtyOf(body.qty) : existing.qty, unit: body.unit !== undefined ? String(body.unit).slice(0, 12) : existing.unit, aisle: body.aisle !== undefined ? cleanAisle(body.aisle) : existing.aisle, bought: body.bought !== undefined ? Boolean(body.bought) : existing.bought } });
        return sendJson(res, 200, { item: mapItem(await items().findOne({ _id: id })) });
      }
      if (method === "DELETE") {
        const result = await items().deleteOne({ _id: id, userId });
        if (!result.deletedCount) return sendJson(res, 404, { error: "Item no encontrado" });
        return sendEmpty(res, 204);
      }
    }
  }
  sendJson(res, 404, { error: "Ruta no encontrada" });
});

server.listen(PORT, HOST, () => console.log(`Compras en http://${HOST}:${PORT}`));
async function bootDb() { for (;;) { try { await connect(); return; } catch (err) { console.error("Mongo no disponible:", err.message); await new Promise((resolve) => setTimeout(resolve, 5000)); } } }
bootDb();
