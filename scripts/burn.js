// scripts/burn.js
// Usage: NODE_OPTIONS=--experimental-fetch node scripts/burn.js
// Burns the listed assets (1 unit each). Uses policy keys + wallet seed from config.

import fs from "fs";
import fetch from "node-fetch";
import { Lucid, Blockfrost } from "lucid-cardano";
import { CONFIG } from "../src/config.js";

// =======================================
// 🔥 LIST OF ASSETS TO BURN
// =======================================
const TO_BURN = [
  // ===== TRIX policy =====
  { policyId: "0ecb97dba8b3dbcaf004410717df9a214d526b1732bc88d14ca58237", name: "2056_2" },
  { policyId: "0ecb97dba8b3dbcaf004410717df9a214d526b1732bc88d14ca58237", name: "2056_21" },
  { policyId: "0ecb97dba8b3dbcaf004410717df9a214d526b1732bc88d14ca58237", name: "2056_31" },
  { policyId: "0ecb97dba8b3dbcaf004410717df9a214d526b1732bc88d14ca58237", name: "2056_35" },
  { policyId: "0ecb97dba8b3dbcaf004410717df9a214d526b1732bc88d14ca58237", name: "2056_36" },
  { policyId: "0ecb97dba8b3dbcaf004410717df9a214d526b1732bc88d14ca58237", name: "2056_44" },
  { policyId: "0ecb97dba8b3dbcaf004410717df9a214d526b1732bc88d14ca58237", name: "2056_46" },
  { policyId: "0ecb97dba8b3dbcaf004410717df9a214d526b1732bc88d14ca58237", name: "2056_50" },
  { policyId: "0ecb97dba8b3dbcaf004410717df9a214d526b1732bc88d14ca58237", name: "2056_53" },
  { policyId: "0ecb97dba8b3dbcaf004410717df9a214d526b1732bc88d14ca58237", name: "2056_60" },
  { policyId: "0ecb97dba8b3dbcaf004410717df9a214d526b1732bc88d14ca58237", name: "2056_84" },
  { policyId: "0ecb97dba8b3dbcaf004410717df9a214d526b1732bc88d14ca58237", name: "2056_93" },
  { policyId: "0ecb97dba8b3dbcaf004410717df9a214d526b1732bc88d14ca58237", name: "2056_104" },
  { policyId: "0ecb97dba8b3dbcaf004410717df9a214d526b1732bc88d14ca58237", name: "2056_111" },

  // ===== TDD policy =====
  { policyId: "a6483566f21614f3587273fa965edec30917dbd2b62d7c08d6a89dfb", name: "DDCXXXII_18" },
  { policyId: "a6483566f21614f3587273fa965edec30917dbd2b62d7c08d6a89dfb", name: "DDCXXXII_25" },
  { policyId: "a6483566f21614f3587273fa965edec30917dbd2b62d7c08d6a89dfb", name: "DDCXXXII_36" },
  { policyId: "a6483566f21614f3587273fa965edec30917dbd2b62d7c08d6a89dfb", name: "DDCXXXII_38" },
  { policyId: "a6483566f21614f3587273fa965edec30917dbd2b62d7c08d6a89dfb", name: "DDCXXXII_44" },
  { policyId: "a6483566f21614f3587273fa965edec30917dbd2b62d7c08d6a89dfb", name: "DDCXXXII_47" },
  { policyId: "a6483566f21614f3587273fa965edec30917dbd2b62d7c08d6a89dfb", name: "DDCXXXII_48" },
  { policyId: "a6483566f21614f3587273fa965edec30917dbd2b62d7c08d6a89dfb", name: "DDCXXXII_49" },
  { policyId: "a6483566f21614f3587273fa965edec30917dbd2b62d7c08d6a89dfb", name: "DDCXXXII_50" },
  { policyId: "a6483566f21614f3587273fa965edec30917dbd2b62d7c08d6a89dfb", name: "DDCXXXII_59" },
  { policyId: "a6483566f21614f3587273fa965edec30917dbd2b62d7c08d6a89dfb", name: "DDCXXXII_64" },
  { policyId: "a6483566f21614f3587273fa965edec30917dbd2b62d7c08d6a89dfb", name: "DDCXXXII_84" },
  { policyId: "a6483566f21614f3587273fa965edec30917dbd2b62d7c08d6a89dfb", name: "DDCXXXII_86" },
  { policyId: "a6483566f21614f3587273fa965edec30917dbd2b62d7c08d6a89dfb", name: "DDCXXXII_90" },
  { policyId: "a6483566f21614f3587273fa965edec30917dbd2b62d7c08d6a89dfb", name: "tddtddCXXXI-0040" },
];

// ✅ Toggle to test without sending a real transaction
const DRY_RUN = false;

// =======================================
// 🗝️ FILE PATHS
// =======================================
const TRIX_POLICY_FILE = "./policies/trix2056/policy.script";
const TRIX_SKEY_FILE   = "./policies/trix2056/policy.skey";
const TDD_POLICY_FILE  = "./policies/tdd/policy.script";
const TDD_SKEY_FILE    = "./policies/tdd/policy.skey";

// Wallet seed for fees
const SEED = CONFIG.seedPhrase;

// =======================================
// 🔧 HELPERS
// =======================================

// Return raw 32-byte private key hex (strip CBOR prefix 5820 if present)
function readPolicyKeyRaw(path) {
  const json = JSON.parse(fs.readFileSync(path, "utf8"));
  const hex = json.cborHex || json.cborhex || "";
  return hex.startsWith("5820") ? hex.slice(4) : hex;
}

function toUnit(policyId, assetName) {
  const hexName = Buffer.from(assetName, "utf8").toString("hex");
  return policyId + hexName;
}

// 🔍 Check wallet holdings before burning (via Blockfrost)
async function walletHasAssets(blockfrostKey, walletAddr, units) {
  const missing = [];
  const resp = await fetch(`https://cardano-mainnet.blockfrost.io/api/v0/addresses/${walletAddr}/utxos`, {
    headers: { project_id: blockfrostKey },
  });
  if (!resp.ok) throw new Error("Blockfrost utxo fetch failed: " + resp.status);
  const utxos = await resp.json();
  const owned = new Set();
  for (const u of utxos) for (const amt of u.amount) if (amt.unit !== "lovelace") owned.add(amt.unit);
  for (const u of units) if (!owned.has(u)) missing.push(u);
  return { ok: missing.length === 0, missing, utxos };
}

// Map each unit → one UTxO that contains it (so we can collectFrom() exactly those)
function pickUtxosForUnits(utxos, units) {
  const unitSet = new Set(units);
  const chosen = new Map(); // unit -> utxo
  for (const utxo of utxos) {
    for (const amt of utxo.amount) {
      if (unitSet.has(amt.unit) && !chosen.has(amt.unit) && BigInt(amt.quantity) > 0n) {
        chosen.set(amt.unit, utxo);
      }
    }
    if (chosen.size === unitSet.size) break;
  }
  return chosen;
}

// =======================================
// 🧠 MAIN
// =======================================
async function main() {
  if (!TO_BURN.length) {
    console.log("No assets in TO_BURN. Exiting.");
    process.exit(1);
  }

  const lucid = await Lucid.new(
    new Blockfrost("https://cardano-mainnet.blockfrost.io/api/v0", CONFIG.blockfrostKey),
    CONFIG.network
  );
  await lucid.selectWalletFromSeed(SEED);

  const walletAddr = await lucid.wallet.address();
  console.log("🔥 Using wallet address:", walletAddr);

  // Load both policies and raw private keys (no bech32 conversion)
  const policies = {};
  policies[CONFIG.trixPolicyId] = {
    scriptJson: JSON.parse(fs.readFileSync(TRIX_POLICY_FILE, "utf8")),
    raw: readPolicyKeyRaw(TRIX_SKEY_FILE),
  };
  policies[CONFIG.tddPolicyId] = {
    scriptJson: JSON.parse(fs.readFileSync(TDD_POLICY_FILE, "utf8")),
    raw: readPolicyKeyRaw(TDD_SKEY_FILE),
  };

  // Convert to native scripts & sanity-check policy IDs
  const nativePolicies = {};
  for (const pid of Object.keys(policies)) {
    const native = lucid.utils.nativeScriptFromJson(policies[pid].scriptJson);
    const computed = lucid.utils.mintingPolicyToId(native);
    if (computed !== pid) throw new Error(`PolicyId mismatch for ${pid.slice(0,8)}… — computed ${computed}`);
    nativePolicies[pid] = native;
  }

  // Build burn map and collect all units
  const burnByPolicy = {};
  const allUnits = [];
  for (const it of TO_BURN) {
    if (!burnByPolicy[it.policyId]) burnByPolicy[it.policyId] = {};
    const unit = toUnit(it.policyId, it.name);
    burnByPolicy[it.policyId][unit] = -1n; // burn 1
    allUnits.push(unit);
  }

  // Verify holdings + get UTxOs
  console.log("Checking wallet holdings via Blockfrost...");
  const check = await walletHasAssets(CONFIG.blockfrostKey, walletAddr, allUnits);
  if (!check.ok) {
    console.error("🚫 Missing assets in wallet. Cannot burn these units:");
    for (const u of check.missing) console.error(" - " + u);
    process.exit(1);
  }
  console.log("✅ All assets are present in the wallet.");

  // Choose the exact UTxOs that carry each asset unit
  const chosen = pickUtxosForUnits(check.utxos, allUnits);
  if (chosen.size !== allUnits.length) {
    console.error("🚫 Could not find a UTxO for every unit. Missing:");
    const chosenSet = new Set([...chosen.keys()]);
    for (const u of allUnits) if (!chosenSet.has(u)) console.error(" - " + u);
    process.exit(1);
  }

  const toLucidUtxo = (bf) => ({
    txHash: bf.tx_hash,
    outputIndex: bf.output_index,
    address: bf.address,
    assets: Object.fromEntries(
      bf.amount.map((a) => [a.unit === "lovelace" ? "lovelace" : a.unit, BigInt(a.quantity)])
    )
  });
  const utxosToCollect = [...chosen.values()].map(toLucidUtxo);

  try {
    let builder = lucid.newTx()
      .collectFrom(utxosToCollect);

    // Attach policies and add negative mints
    for (const pid of Object.keys(burnByPolicy)) {
      builder = builder.attachMintingPolicy(nativePolicies[pid]);
    }
    for (const pid of Object.keys(burnByPolicy)) {
      builder = builder.mintAssets(burnByPolicy[pid]);
    }

    const tx = await builder.complete();

    if (DRY_RUN) {
      console.log("──────────────────────────────────────────────");
      console.log("Dry-run mode ON — transaction NOT submitted.");
      console.log("Would burn these assets:");
      for (const it of TO_BURN)
        console.log(` • ${it.policyId.slice(0,8)}…${it.policyId.slice(-6)} : ${it.name}`);
      console.log("──────────────────────────────────────────────");
      console.log("Estimated minimum ADA fee:", tx.txComplete.body().fee().to_str());
      process.exit(0);
    }

    // 🔐 Sign with raw CBOR private keys (no bech32) + wallet
    let signed = tx;
    for (const pid of Object.keys(burnByPolicy)) {
      const raw = policies[pid].raw;            // 64-char hex (32 bytes), CBOR prefix already stripped
      console.log(`Signing with policy ${pid.slice(0,8)}…`);
      signed = await signed.signWithPrivateKey(raw);
    }
    signed = await signed.sign().complete();

    const txHash = await signed.submit();
    console.log("✅ Burn tx submitted:", txHash);
    process.exit(0);
  } catch (e) {
    console.error("Burn failed:", e);
    process.exit(1);
  }
}

main();
