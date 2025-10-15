// WATCHER.JS

import fetch from 'node-fetch';
import { CONFIG } from './config.js';
import { makeLucid, mintBothTo } from './mint.js';
import { init, savePayment, nextUnprocessedPayment, markPaymentProcessed,
         pickRandomAvailable, markMinted, releaseReservation, recordMint } from './db.js';
import fs from 'fs';

const TDD_LIST = JSON.parse(fs.readFileSync(CONFIG.paths.tddJson));
const TRIX_LIST = JSON.parse(fs.readFileSync(CONFIG.paths.trixJson));

init();

const lovelace = (ada) => BigInt(Math.floor(ada * 1_000_000));

async function getIncomingTxs(address) {
  // 1) Pull recent txs to your mint address (Blockfrost paging can be added if needed)
  const resp = await fetch(`https://cardano-mainnet.blockfrost.io/api/v0/addresses/${address}/transactions?order=desc&count=25`, {
    headers: { project_id: CONFIG.blockfrostKey }
  });
  if (!resp.ok) throw new Error(`Blockfrost address txs ${resp.status}`);
  const txs = await resp.json();
  return txs; // [{ tx_hash, ... }]
}

async function getTxUtxos(tx_hash) {
  const resp = await fetch(`https://cardano-mainnet.blockfrost.io/api/v0/txs/${tx_hash}/utxos`, {
    headers: { project_id: CONFIG.blockfrostKey }
  });
  if (!resp.ok) throw new Error(`Blockfrost utxos ${resp.status}`);
  return resp.json();
}

async function scanPayments() {
  try {
    const txs = await getIncomingTxs(CONFIG.mintAddress);
    for (const t of txs) {
      const utxos = await getTxUtxos(t.tx_hash);
      // Find output to our mint address
      const out = utxos.outputs.find(o => o.address === CONFIG.mintAddress);
      if (!out) continue;
      const amountL = BigInt(out.amount.find(a => a.unit === 'lovelace')?.quantity || '0');
      if (amountL < lovelace(CONFIG.priceAda)) continue; // not enough
      // Guess payer as first input address
      const payer = utxos.inputs[0]?.address || 'unknown';
      savePayment(t.tx_hash, payer, Number(amountL));
    }
  } catch (e) {
    console.error('[scanPayments]', e.message);
  }
}

async function fulfill() {
  // pick next unprocessed paid tx ≥ price
  const payment = nextUnprocessedPayment(Number(lovelace(CONFIG.priceAda)));
  if (!payment) return;

  const lucid = await makeLucid();
  const payer = payment.payer_address;

  // Reserve assets (atomic)
  const tddRow = pickRandomAvailable('TDD');
  const trixRow = pickRandomAvailable('TRIX_2056');
  if (!tddRow || !trixRow) {
    console.error('Sold out or inventory empty.');
    markPaymentProcessed(payment.tx_hash);
    return;
  }

  // Find full asset objects by name from our JSON lists
  const tddAsset = TDD_LIST.find(x => x.name === tddRow.asset_name);
  const trixAsset = TRIX_LIST.find(x => x.name === trixRow.asset_name);

  try {
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
  // keep payment unprocessed so it retries after you fix
}

    // Do not mark payment processed; worker will retry next loop
  }

async function loop() {
  await scanPayments();
  await fulfill();
  setTimeout(loop, CONFIG.pollInterval * 1000);
}
loop();
