import fs from 'fs';
import path from 'path';
import { randomUUID } from 'uuid';

const DB_PATH = path.resolve('data/inventory.json');
const TDD_SRC = path.resolve('data/combined_metadata_TDD.json');
const TRIX_SRC = path.resolve('data/combined_metadata_2056.json');

let db = { orders: [], assets: [] };
let lock = false;

const readJson = (p) => JSON.parse(fs.readFileSync(p,'utf8'));
const writeDb = () => fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

export function initDb() {
  if (!fs.existsSync(DB_PATH)) writeDb();
  db = readJson(DB_PATH);

  // Seed assets if empty
  if (!db.assets || db.assets.length === 0) {
    const tdd = readJson(TDD_SRC);
    const trix = readJson(TRIX_SRC);

    const rows = [];
    for (const it of tdd) {
      rows.push({
        id: randomUUID(),
        collection: "TDD",
        name: it.name,
        image: it.image,
        mediaType: it.mediaType,
        traits: it.traits || {},
        policyId: null,         // filled at mint time
        status: "available",
        reservedUntil: null,
        mintedTx: null
      });
    }
    for (const it of trix) {
      rows.push({
        id: randomUUID(),
        collection: "TRIX_2056",
        name: it.name,
        image: it.image,
        mediaType: it.mediaType,
        traits: it.traits || it.attributes || {},
        policyId: null,
        status: "available",
        reservedUntil: null,
        mintedTx: null
      });
    }
    db.assets = rows;
    writeDb();
  }
}

function withLock(fn) {
  return async (...args) => {
    while (lock) await new Promise(r=>setTimeout(r,25));
    lock = true;
    try {
      const res = await fn(...args);
      writeDb();
      return res;
    } finally {
      lock = false;
    }
  };
}

export const createOrder = withLock(async (payerHint=null) => {
  const order = {
    id: randomUUID(),
    status: "awaiting_payment",
    payerAddress: null,
    paymentTx: null,
    createdAt: Date.now(),
    tddAssetId: null,
    trixAssetId: null
  };
  db.orders.push(order);
  return order;
});

export const findOrder = (id) => db.orders.find(o=>o.id===id);

export const markPaid = withLock(async (orderId, payerAddress, paymentTx) => {
  const o = db.orders.find(o=>o.id===orderId);
  if (!o) return null;
  o.status = "paid";
  o.payerAddress = payerAddress;
  o.paymentTx = paymentTx;
  return o;
});

export const reservePair = withLock(async (orderId) => {
  const o = db.orders.find(o=>o.id===orderId);
  if (!o || o.status !== "paid") return null;

  const pick = (coll) => db.assets.find(a => a.collection===coll && a.status==="available");

  // Randomize by shuffle-ish scan
  const indices = db.assets.map((_,i)=>i).sort(()=>Math.random()-0.5);

  const tddIdx = indices.find(i => db.assets[i].collection==="TDD" && db.assets[i].status==="available");
  const trixIdx = indices.find(i => db.assets[i].collection==="TRIX_2056" && db.assets[i].status==="available");
  if (tddIdx===undefined || trixIdx===undefined) return null;

  db.assets[tddIdx].status = "reserved";
  db.assets[tddIdx].reservedUntil = Date.now()+10*60*1000; // 10 min
  db.assets[trixIdx].status = "reserved";
  db.assets[trixIdx].reservedUntil = Date.now()+10*60*1000;

  o.tddAssetId = db.assets[tddIdx].id;
  o.trixAssetId = db.assets[trixIdx].id;

  return {
    tdd: db.assets[tddIdx],
    trix: db.assets[trixIdx],
  };
});

export const markMinted = withLock(async (orderId, txHash) => {
  const o = db.orders.find(o=>o.id===orderId);
  if (!o) return null;
  const tdd = db.assets.find(a=>a.id===o.tddAssetId);
  const trix = db.assets.find(a=>a.id===o.trixAssetId);
  if (tdd) { tdd.status="minted"; tdd.mintedTx=txHash; }
  if (trix) { trix.status="minted"; trix.mintedTx=txHash; }
  o.status = "minted";
  o.mintTx = txHash;
  return o;
});
