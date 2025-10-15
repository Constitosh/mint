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

const TDD_LIST = JSON.parse(fs.readFileSync(CONFIG.paths.tddJson));
const TRIX_LIST = JSON.parse(fs.readFileSync(CONFIG.paths.trixJson));

init();
// free any stale reservations older than 10 minutes at startup
expireAllOnStartup(600);

const lovelace = (ada) => BigInt(Math.floor(ada * 1_000_000));

async function getIncomingTxs(address) {
  const resp = await fetch(
    `https://cardano-mainnet.blockfrost.io/api/v0/addresses/${address}/transactions?order=desc&count=25`,
    { headers: { project_id: CONFIG.blockfrostKey } }
  );
  if (!resp.ok) throw new Error(`Blockfrost address txs ${resp.status}`);
  return resp.json(); // [{ tx_hash, ... }]
}

async function getTxUtxos(tx_hash) {
  const resp = await fetch(
    `https://cardano-mainnet.blockfrost.io/api/v0/txs/${tx_hash}/utxos`,
    { headers: { project_id: CONFIG.blockfrostKey } }
  );
  if (!resp.ok) throw new Error(`Blockfrost utxos ${resp.status}`);
  return resp.json();
}

async function scanPayments() {
  try {
    const txs = await getIncomingTxs(CONFIG.mintAddress);
    for (const t of txs) {
      const utxos = await getTxUtxos(t.tx_hash);
      // Find output to our mint address
      const out = utxos.outputs.find((o) => o.address === CONFIG.mintAddress);
      if (!out) continue;

      const amountL = BigInt(out.amount.find((a) => a.unit === 'lovelace')?.quantity || '0');
      if (amountL < lovelace(CONFIG.priceAda)) continue; // not enough

      // Guess payer as first input address
      const payer = utxos.inputs[0]?.address || 'unknown';
      savePayment(t.tx_hash, payer, Number(amountL));
    }
  } catch (e) {
    console.error('[scanPayments]', e?.stack || e?.message || e);
  }
}

async function fulfill() {
  // 🔁 Free stale reservations every loop (10 minutes)
  const freed = expireOldReservations(600);
  if (freed) console.log(`[reserve-expiry] freed ${freed} stale reservations`);

  // pick next unprocessed paid tx ≥ price
  const payment = nextUnprocessedPayment(Number(lovelace(CONFIG.priceAda)));
  if (!payment) return;

  const lucid = await makeLucid();
  const payer = payment.payer_address;

  // Reserve assets (atomic)
  const tddRow = pickRandomAvailable('TDD');
  const trixRow = pickRandomAvailable('TRIX_2056');

  if (!tddRow || !trixRow) {
    console.error('Sold out or inventory empty.', getInventoryCounts());
    // you can choose to mark processed + manual refund path instead
    return;
  }

  // Find full asset objects by name from our JSON lists
  const tddAsset = TDD_LIST.find((x) => x.name === tddRow.asset_name);
  const trixAsset = TRIX_LIST.find((x) => x.name === trixRow.asset_name);

  try {
    if (!tddAsset) throw new Error(`TDD asset not found in JSON: ${tddRow.asset_name}`);
    if (!trixAsset) throw new Error(`TRIX 2056 asset not found in JSON: ${trixRow.asset_name}`);

    const txHash = await mintBothTo(lucid, payer, tddAsset, trixAsset);

    markMinted(tddRow.id);
    markMinted(trixRow.id);
    recordMint(payer, txHash, tddRow.asset_name, trixRow.asset_name);
    markPaymentProcessed(payment.tx_hash);

    console.log(`[MINTED] ${tddRow.asset_name} + ${trixRow.asset_name} -> ${payer} | ${txHash}`);
  } catch (e) {
    console.error('[mint error] releasing reservations', e?.stack || e?.message || e);
    releaseReservation(tddRow.id);
    releaseReservation(trixRow.id);
    // keep payment unprocessed so it retries after you fix the cause
  }
}

async function loop() {
  await scanPayments();
  await fulfill();
  setTimeout(loop, CONFIG.pollInterval * 1000);
}
loop();
