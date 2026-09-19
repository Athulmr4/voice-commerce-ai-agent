// DB abstraction: sqlite via node:sqlite (default, zero native deps) + mysql (docker-compose).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export interface DbRow { [k: string]: unknown }

let sqlite: DatabaseSync | null = null;

function sqlitePath(): string {
  return process.env.SQLITE_PATH ?? './data/voice-commerce.db';
}

export function dbProvider(): 'sqlite' | 'mysql' {
  return process.env.DB_PROVIDER === 'mysql' ? 'mysql' : 'sqlite';
}

export function getSqlite(): DatabaseSync {
  if (sqlite) return sqlite;
  const p = sqlitePath();
  if (p !== ':memory:') fs.mkdirSync(path.dirname(p), { recursive: true });
  sqlite = new DatabaseSync(p);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrateSqlite(sqlite);
  seedSqlite(sqlite);
  return sqlite;
}

/** Test helper: fresh in-memory DB. */
export function resetTestDb(): void {
  if (sqlite) { try { sqlite.close(); } catch { /* ignore */ } }
  process.env.SQLITE_PATH = ':memory:';
  sqlite = null;
  getSqlite();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
  category TEXT NOT NULL, price REAL NOT NULL, brand TEXT NOT NULL, color TEXT
);
CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), size TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
  variant_id TEXT REFERENCES product_variants(id), size TEXT, quantity INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS discounts (code TEXT PRIMARY KEY, percent REAL NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), status TEXT NOT NULL,
  subtotal REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, shipping REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL, estimated_delivery TEXT
);
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
);
`;

function migrateSqlite(db: DatabaseSync): void {
  db.exec(SCHEMA);
}

const SEED_PRODUCTS = [
  { id: 'P100', name: 'Nike Revolution 7', description: 'Lightweight running shoes', category: 'running shoes', price: 2499, brand: 'Nike', color: 'black' },
  { id: 'P101', name: 'Adidas Duramo SL', description: 'Daily running shoes', category: 'running shoes', price: 2999, brand: 'Adidas', color: 'blue' },
  { id: 'P102', name: 'Puma Velocity Nitro', description: 'Responsive running shoes', category: 'running shoes', price: 3499, brand: 'Puma', color: 'red' },
  { id: 'P103', name: 'Adidas Grand Court', description: 'Classic black sneakers', category: 'sneakers', price: 2799, brand: 'Adidas', color: 'black' },
  { id: 'P104', name: 'Nike Court Vision', description: 'Street sneakers', category: 'sneakers', price: 3299, brand: 'Nike', color: 'white' },
  { id: 'P105', name: 'HP 15s Laptop', description: '15.6 inch laptop for everyday use', category: 'laptop', price: 48500, brand: 'HP', color: 'silver' },
  { id: 'P106', name: 'Lenovo IdeaPad Slim 3', description: 'Lightweight laptop', category: 'laptop', price: 52000, brand: 'Lenovo', color: 'grey' },
  { id: 'P107', name: 'Campus North Plus', description: 'Budget red running shoes', category: 'running shoes', price: 1799, brand: 'Campus', color: 'red' },
];

function seedSqlite(db: DatabaseSync): void {
  const row = db.prepare('SELECT COUNT(*) as c FROM products').get() as unknown as { c: number };
  if (Number(row.c) > 0) return;
  db.exec('BEGIN');
  try {
    db.prepare("INSERT OR IGNORE INTO users (id,name) VALUES ('U1','Athul')").run();
    db.prepare('INSERT OR IGNORE INTO discounts (code,percent) VALUES (?,?)').run('SUMMER10', 10);
    db.prepare("INSERT OR IGNORE INTO orders (id,user_id,status,subtotal,discount,shipping,total,estimated_delivery) VALUES ('KW12345','U1','SHIPPED',2499,0,100,2599,'Tomorrow')").run();
    const ins = db.prepare('INSERT INTO products (id,name,description,category,price,brand,color) VALUES (?,?,?,?,?,?,?)');
    const invSt = db.prepare('INSERT INTO inventory (id,product_id,size,quantity) VALUES (?,?,?,?)');
    for (const p of SEED_PRODUCTS) {
      ins.run(p.id, p.name, p.description, p.category, p.price, p.brand, p.color);
      for (const size of ['7', '8', '9', '10']) {
        invSt.run(`${p.id}-${size}`, p.id, size, size === '10' && p.id === 'P100' ? 0 : 8);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

import { createPool, type Pool } from 'mysql2/promise';
let pool: Pool | null = null;
function getPool(): Pool {
  if (pool) return pool;
  pool = createPool({
    host: process.env.MYSQL_HOST ?? 'localhost',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'voice',
    password: process.env.MYSQL_PASSWORD ?? 'voice',
    database: process.env.MYSQL_DATABASE ?? 'voice_commerce',
  });
  return pool;
}

export async function queryAll(text: string, params: unknown[] = []): Promise<DbRow[]> {
  if (dbProvider() === 'mysql') {
    const [rows] = await getPool().query(text, params as never[]);
    return rows as DbRow[];
  }
  const db = getSqlite();
  return db.prepare(text).all(...(params as never[])) as unknown as DbRow[];
}

export function runStmt(text: string, params: unknown[] = []): void {
  if (dbProvider() !== 'mysql') {
    getSqlite().prepare(text).run(...(params as never[]));
    return;
  }
  void getPool().execute(text, params as never[]);
}
