import Database from 'better-sqlite3';
import fs from 'fs';
import { CONFIG } from './config.js';

const db = new Database(CONFIG.paths.sqlite);

export function init() {
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection TEXT NOT NULL,            -- 'TDD' | 'TRIX_2056'
      asset_name TEXT NOT NULL,            -- e.g., 'DDCXXXII_1' or '2056_23'
      policy_id TEXT NOT NULL,
      ipfs_cid TEXT NOT NULL,
      media_type TEXT NOT NULL,
      minted INTEGER NOT NULL DEFAULT 0,
      reserved INTEGER NOT NULL DEFAULT 0,
      reserved_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_unique
      ON assets(collection, asset_name);

    CREATE TABLE IF NOT EXISTS payments (
      tx_hash TEXT PRIMARY KEY,
      payer_address TEXT NOT NULL,
      amount_lovelace INTEGER NOT NULL,
      processed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS mints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_hash TEXT NOT NULL,
      payer_address TEXT NOT NULL,
      tdd_asset_name TEXT NOT NULL,
      trix_asset_name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

export function insertCatalog(collection, policyId, list) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO assets
    (collection, asset_name, policy_id, ipfs_cid, media_type)
    VALUES (?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const it of list) {
      stmt.run(collection, it.name, policyId, (it.cid || (it.image || '').replace('ipfs://', '')), it.mediaType);
    }
  });
  tx();
}

export function pickRandomAvailable(collection) {
  const row = db.prepare(`
    SELECT * FROM assets
    WHERE collection=? AND minted=0 AND reserved=0
    ORDER BY RANDOM() LIMIT 1
  `).get(collection);
  if (!row) return null;
  db.prepare(`UPDATE assets SET reserved=1, reserved_at=strftime('%s','now') WHERE id=?`).run(row.id);
  return row;
}

export function markMinted(assetId) {
  db.prepare(`UPDATE assets SET minted=1, reserved=0 WHERE id=?`).run(assetId);
}

export function releaseReservation(assetId) {
  db.prepare(`UPDATE assets SET reserved=0 WHERE id=?`).run(assetId);
}

export function savePayment(tx_hash, payer, amount) {
  db.prepare(`INSERT OR IGNORE INTO payments (tx_hash, payer_address, amount_lovelace) VALUES (?, ?, ?)`)
    .run(tx_hash, payer, amount);
}
export function nextUnprocessedPayment(minLovelace) {
  return db.prepare(`SELECT * FROM payments WHERE processed=0 AND amount_lovelace>=? ORDER BY rowid ASC`).get(minLovelace);
}
export function markPaymentProcessed(tx_hash) {
  db.prepare(`UPDATE payments SET processed=1 WHERE tx_hash=?`).run(tx_hash);
}

export function recordMint(payer, tx_hash, tddName, trixName) {
  db.prepare(`INSERT INTO mints (tx_hash, payer_address, tdd_asset_name, trix_asset_name, created_at)
              VALUES (?, ?, ?, ?, strftime('%s','now'))`)
    .run(tx_hash, payer, tddName, trixName);
}

if (process.argv.includes('--init')) {
  init();
  // seed catalogs from JSON
  const tdd = JSON.parse(fs.readFileSync(CONFIG.paths.tddJson));
  const trix = JSON.parse(fs.readFileSync(CONFIG.paths.trixJson));
  insertCatalog('TDD', CONFIG.tddPolicyId, tdd);
  insertCatalog('TRIX_2056', CONFIG.trixPolicyId, trix);
  console.log('DB initialized & catalogs seeded.');
}

export default db;
