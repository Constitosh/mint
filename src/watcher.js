// WATCHER.JS
import fetch from 'node-fetch';
import fs from 'fs';
import { CONFIG } from './config.js';
import { makeLucid, mintBothTo } from './mint.js';
import {
  init,
  savePayment,
  nextUnprocessedPayment,
  markPaymentProcessed,
  pickRandomAvailable,
  markMinted,
  releaseReservation,
  recordMint,
  expireOldReservations,
  expireAllOnStartup,
  getInventoryCounts
} from './db.js';

init();

// Load catalogs once
const TDD_LIST  = JSON.parse(fs.readFileSync(CONFIG.paths.tddJson));
const TRIX_LIST = JSON.parse(fs.readFileSync(CONFIG.paths.trixJson));

// Free stale reservations on boot
expireAllOnStartup(600);

// -------- Settings --------
const PRICE_ADA = Number(CONFIG.priceAda || 30);
const TOLERANCE_ADA = Number(CONFIG.priceToleranceAda ?? 0.5); // set to 0.0 for exact 30.000000
const adaToLovelace = (ada) => BigInt(Math.round(ada * 1_000_000));
const MIN_ACCEPT = adaToLovelace(PRICE_ADA - TOLERANCE_ADA);
const MAX_ACCEPT = adaToLovelace(PRICE_ADA + TOLERANCE_ADA);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Simple in-process lock to avoid UTxO collisions
let MINTING = false;

// Cache a set of "our addresses" (mint address + wallet addresses)
const OUR_ADDRS = new Set([CONFIG.mintAddress]);

(async () => {
  try {
    const lucid = await makeLucid();
    // Base (payment) address the wallet would use
    const walletAddr = await lucid.wallet.address();
    // Change address (often different)
    const changeAddr = await lucid.wallet.changeAddress();
    OUR_ADDRS.add(walletAddr);
    OUR_ADDRS.add(changeAddr);
    console.log('[watcher] Our addresses cached:', [...OUR_ADDRS].map(a => a.slice(0,24)+'...'));
  } catch (e) {
    console.warn('[watcher] Could not preload wallet addresses (will still work):', e?.message || e);
  }
})();

// -------- Blockfrost helpers --------
async function getIncomingTxs(address) {
  const url = `https://cardano-mainnet.blockfrost.io/api/v0/addresses/${address}/transactions?order=desc&count=25`;
  const resp = await fetch(url, { headers: { project_id: CONFIG.blockfrostKey } });
  if (!resp.ok) throw new Error(`Blockfrost address txs ${resp.status}`);
  return resp.json(); // [{ tx_hash, ... }]
}

async function getTxUtxos(tx_hash) {
  const url = `https://cardano-mainnet.blockfrost.io/api/v0/txs/${tx_hash}/utxos`;
  const resp = await fetch(url, { headers: { project_id: CONFIG.blockfrostKey } });
  if (!resp.ok) throw new Error(`Blockfrost utxos ${resp.status}`);
  return resp.json();
}

async function hasLabel721(tx_hash) {
  const url = `https://cardano-mainnet.blockfrost.io/api/v0/txs/${tx_hash}/metadata`;
  const resp = await fetch(url, { headers: { project_id: CONFIG.blockfrostKey } });
  if (!resp.ok) return false;
  const items = await resp.json();
  return Array.isArray(items) && items.some((m) => m.label === "721");
}

function lovelaceToOurAddress(utxos, ourAddr) {
  let total = 0n;
  for (const out of utxos.outputs || []) {
    if (out.address !== ourAddr) continue;
    const ll = BigInt(out.amount.find((a) => a.unit === 'lovelace')?.quantity || '0');
    total += ll;
  }
  return total;
}

/**
 * tx is "from us" only if ALL inputs belong to our known addresses.
 * (User payments should have zero inputs from OUR_ADDRS.)
 */
function isFromUs(utxos) {
  const ins = utxos.inputs || [];
  if (!ins.length) return false;
  return ins.every((i) => OUR_ADDRS.has(i.address));
}

// -------- Scan payments --------
async function scanPayments() {
  try {
    const txs = await getIncomingTxs(CONFIG.mintAddress);

    for (const t of txs) {
      const txHash = t.tx_hash;
      const utxos = await getTxUtxos(txHash);
      const amt = lovelaceToOurAddress(utxos, CONFIG.mintAddress);

      if (amt === 0n) {
        // no ada to us
        continue;
      }

      // Guard 1: skip if tx is ours (all inputs from our own wallet/addrs)
      const fromUs = isFromUs(utxos);
      if (fromUs) {
        // console.log(`[scan] skip (from us): ${txHash}`);
        continue;
      }

      // Guard 2: skip if tx already has 721 metadata (likely our own mint tx)
      const meta721 = await hasLabel721(txHash);
      if (meta721) {
        // console.log(`[scan] skip (has 721): ${txHash}`);
        continue;
      }

      // Amount window
      if (amt < MIN_ACCEPT || amt > MAX_ACCEPT) {
        console.log(`[scan] ignore amount ${Number(amt)/1e6}₳ (accept ${Number(MIN_ACCEPT)/1e6}–${Number(MAX_ACCEPT)/1e6}) tx=${txHash}`);
        continue;
      }

      const payer = utxos.inputs?.[0]?.address || null;
      if (!payer) {
        console.log(`[scan] skip (no payer addr) tx=${txHash}`);
        continue;
      }

      // Save payment (idempotent via unique key)
      savePayment(txHash, payer, Number(amt));
      console.log(`[scan] payment recorded: ${Number(amt)/1e6}₳ from ${payer.slice(0,32)}... tx=${txHash}`);
    }
  } catch (e) {
    console.error('[scanPayments]', e?.stack || e?.message || e);
  }
}

// -------- Fulfill exactly one payment --------
async function fulfill() {
  // expire reservations
  const freed = expireOldReservations(600);
  if (freed) console.log(`[reserve-expiry] freed ${freed} stale reservations`);

  if (MINTING) return;

  const payment = nextUnprocessedPayment(Number(MIN_ACCEPT));
  if (!payment) return;

  MINTING = true;
  try {
    const lucid = await makeLucid();
    const payer = payment.payer_address;

    // reserve inventory
    const tddRow  = pickRandomAvailable('TDD');
    const trixRow = pickRandomAvailable('TRIX_2056');
    if (!tddRow || !trixRow) {
      console.error('Sold out or inventory empty.', getInventoryCounts());
      return;
    }

    const tddAsset  = TDD_LIST.find((x) => x.name === tddRow.asset_name);
    const trixAsset = TRIX_LIST.find((x) => x.name === trixRow.asset_name);
    if (!tddAsset)  throw new Error(`TDD asset not found in JSON: ${tddRow.asset_name}`);
    if (!trixAsset) throw new Error(`TRIX 2056 asset not found in JSON: ${trixRow.asset_name}`);

    try {
      const txHash = await mintBothTo(lucid, payer, tddAsset, trixAsset);

      // wait for confirmation to avoid double-spending change
      await lucid.awaitTx(txHash);

      // persist
      markMinted(tddRow.id);
      markMinted(trixRow.id);
      recordMint(payer, txHash, tddRow.asset_name, trixRow.asset_name);
      markPaymentProcessed(payment.tx_hash);

      console.log(`[MINTED] ${tddRow.asset_name} + ${trixRow.asset_name} -> ${payer} | ${txHash}`);

      // small backoff
      await sleep(1500);
    } catch (e) {
      console.error('[mint error] releasing reservations', e?.stack || e?.message || e);
      releaseReservation(tddRow.id);
      releaseReservation(trixRow.id);
      // leave payment unprocessed; will retry next loop
    }
  } finally {
    MINTING = false;
  }
}

// -------- Loop --------
async function loop() {
  await scanPayments();
  await fulfill();
  setTimeout(loop, CONFIG.pollInterval * 1000);
}
loop();