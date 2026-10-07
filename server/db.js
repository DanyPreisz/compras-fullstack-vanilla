import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGODB_URI || "";
const dbName = process.env.MONGODB_DB || "compras";
let db;

export function isReady() { return Boolean(db); }

export async function connect() {
  if (!uri) throw new Error("Falta MONGODB_URI");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  db = client.db(dbName);
  await db.collection("users").createIndex({ username: 1 }, { unique: true });
  await db.collection("items").createIndex({ userId: 1, bought: 1, createdAt: -1 });
  console.log(`MongoDB conectado (${dbName})`);
  return db;
}

export const users = () => db.collection("users");
export const items = () => db.collection("items");
export function toId(value) {
  if (!ObjectId.isValid(value)) return null;
  return new ObjectId(String(value));
}
export function mapItem(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    qty: doc.qty,
    unit: doc.unit || "",
    aisle: doc.aisle || "General",
    bought: Boolean(doc.bought),
    createdAt: doc.createdAt,
  };
}
