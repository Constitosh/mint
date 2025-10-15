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

// Catalogs (kept in memory for fast lookup)
const TDD_LIST  = JSON.parse(fs.readFileSync(CONFIG.paths.tddJson));
const TRIX_LIST = JSON.parse(fs.readFileSync(CONFIG.paths.trixJson));

// Free stale reservations on startup (10 minutes)
expireAllOnStartup(600);

// Helpers
const adaToLovelace = (ada) => BigInt(Math.floor(ada * 1_000_000));
const PRICE = Number(CONFIG.priceAda || 30);
const TOLERANCE_ADA = 0.5;                           // +/- 0.5 ₳ window
const MIN_ACCEPT = adaToLovelace(PRICE - TOLERANCE_ADA);
const MAX_ACCEPT = adaToLovelace(PRICE + TOLERANCE_ADA);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Simple in-process mutex so only one mint runs at a time
let MINTING = false;

// ------------ Blockfrost helpers ------------
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

// Sum all lovelace sent to our mint address within this tx
function lovelaceToOurAddress(utxos, ourAddr) {
  let total = 0n;
  for (const out of utxos.outputs || []) {
    if (out.address !== ourAddr) continue;
    const ll = BigInt(out.amount.find((a) => a.unit === 'lovelace')?.quantity || '0');
    total += ll;
  }
  return total;
}

// ------------ Scan payments ------------
async function scanPayments() {
  try {
    const txs = await getIncomingTxs(CONFIG.mintAddress);
    for (const t of txs) {
      const utxos = await getTxUtxos(t.tx_hash);
      const amt = lovelaceToOurAddress(utxos, CONFIG.mintAddress);
      if (amt === 0n) continue;

      // accept only 30 ₳ ± tolerance
      if (amt < MIN_ACCEPT || amt > MAX_ACCEPT) {
        // Ignore unexpected amounts; optionally log
        // console.log(`[scanPayments] Ignored ${Number(amt)/1e6} ₳ (out of range) for tx ${t.tx_hash}`);
        continue;
      }

      // Guess payer as the address of the first input
      const payer = utxos.inputs?.[0]?.address || 'unknown';
      savePayment(t.tx_hash, payer, Number(amt));
    }
  } catch (e) {
    console.error('[scanPayments]', e?.stack || e?.message || e);
  }
}

// ------------ Fulfill a single payment ------------
async function fulfill() {
  // Free stale reservations every loop (10 minutes)
  const freed = expireOldReservations(600);
  if (freed) console.log(`[reserve-expiry] freed ${freed} stale reservations`);

  // Only one mint in flight
  if (MINTING) return;

  // Next paid but unprocessed tx
  const payment = nextUnprocessedPayment(Number(MIN_ACCEPT));
  if (!payment) return;

  MINTING = true;
  try {
    const lucid = await makeLucid();
    const payer = payment.payer_address;

    // Reserve random assets
    const tddRow  = pickRandomAvailable('TDD');
    const trixRow = pickRandomAvailable('TRIX_2056');

    if (!tddRow || !trixRow) {
      console.error('Sold out or inventory empty.', getInventoryCounts());
      // Do NOT mark as processed; you might restock or handle refund separately
      return;
    }

    // Lookup full metadata entries
    const tddAsset  = TDD_LIST.find((x) => x.name === tddRow.asset_name);
    const trixAsset = TRIX_LIST.find((x) => x.name === trixRow.asset_name);
    if (!tddAsset)  throw new Error(`TDD asset not found in JSON: ${tddRow.asset_name}`);
    if (!trixAsset) throw new Error(`TRIX 2056 asset not found in JSON: ${trixRow.asset_name}`);

    try {
      const txHash = await mintBothTo(lucid, payer, tddAsset, trixAsset);

      // Wait for confirmation so our change UTxOs are spendable next time
      await lucid.awaitTx(txHash);

      // Persist + mark done
      markMinted(tddRow.id);
      markMinted(trixRow.id);
      recordMint(payer, txHash, tddRow.asset_name, trixRow.asset_name);
      markPaymentProcessed(payment.tx_hash);

      console.log(`[MINTED] ${tddRow.asset_name} + ${trixRow.asset_name} -> ${payer} | ${txHash}`);

      // Small backoff to avoid racing next loop
      await sleep(1500);
    } catch (e) {
      console.error('[mint error] releasing reservations', e?.stack || e?.message || e);
      // Free assets; keep payment unprocessed so it retries after fix
      releaseReservation(tddRow.id);
      releaseReservation(trixRow.id);
    }
  } finally {
    MINTING = false;
  }
}

// ------------ Main loop ------------
async function loop() {
  await scanPayments();
  await fulfill();
  setTimeout(loop, CONFIG.pollInterval * 1000);
}
loop();
