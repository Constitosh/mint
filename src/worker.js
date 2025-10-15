import fetch from "node-fetch";
import { CFG } from "./config.js";
import { delay } from "./util.js";
import { findOrder, markPaid, reservePair, markMinted } from "./inventory.js";
import { mintPair } from "./minter.js";

const BF = "https://cardano-mainnet.blockfrost.io/api/v0";

async function getAddressTxs(address, count=10) {
  const r = await fetch(`${BF}/addresses/${address}/transactions?order=desc&count=${count}`, {
    headers: { project_id: CFG.blockfrostKey }
  });
  if (!r.ok) return [];
  return await r.json();
}

async function getTxUtxos(hash) {
  const r = await fetch(`${BF}/txs/${hash}/utxos`, {
    headers: { project_id: CFG.blockfrostKey }
  });
  if (!r.ok) return null;
  return await r.json();
}

async function scan() {
  const txs = await getAddressTxs(CFG.receiveAddress, 25);
  for (const t of txs) {
    // Inspect UTXOs to see outputs to our address with exact 30 ADA and an order id metadata (optional)
    const utx = await getTxUtxos(t.tx_hash);
    if (!utx) continue;

    // Find output to receiveAddress
    const out = utx.outputs.find(o => o.address === CFG.receiveAddress);
    if (!out) continue;

    const lovelace = out.amount.find(a => a.unit === "lovelace");
    if (!lovelace) continue;

    const paid = BigInt(lovelace.quantity);
    if (paid !== CFG.price) continue;            // exact 30 ADA

    // Determine payer address from inputs (first input's address is fine)
    const payerAddr = utx.inputs?.[0]?.address;
    if (!payerAddr) continue;

    // If this tx already processed, skip
    // We key by tx hash (server marks orders by matching metadata on frontend; here we do queue)
    // For simplicity, we assume user provided `order_id` via frontend to backend BEFORE payment,
    // and the backend returned a short code the frontend adds to tx metadata.
    // If no metadata matching, we just assign the next awaiting order.

    // Pick the oldest awaiting order
    const awaiting = global.db?.orders?.find?.(o => o.status === "awaiting_payment");
    if (!awaiting) continue;

    await markPaid(awaiting.id, payerAddr, t.tx_hash);

    //
