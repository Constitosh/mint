// scripts/burn.js
// Usage: NODE_OPTIONS=--experimental-fetch node scripts/burn.js
// Burns the listed assets (1 unit each). Uses policy keys + wallet seed from config.

import fs from "fs";
import { Lucid, Blockfrost, C } from "lucid-cardano";
import { CONFIG } from "../src/config.js"; // adjust path if needed

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
];

// ✅ Toggle to test without sending a real transaction
const DRY_RUN = true;

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

function readPolicyKey(path) {
  const json = JSON.parse(fs.readFileSync(path, "utf8"));
  let hex = json.cborHex;
  if (hex.startsWith("5820")) hex = hex.slice(4); // remove CBOR prefix
  return hex;
}

function toBech32FromHexKey(hex) {
  const bytes = Buffer.from(hex, "hex");
  const prv = C.PrivateKey.from_normal_bytes(bytes);
  return prv.to_bech32(); // e.g. ed25519_sk1...
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

  // Load both policy objects and convert keys
  const policies = {};

  const trixHex = readPolicyKey(TRIX_SKEY_FILE);
  policies[CONFIG.trixPolicyId] = {
    scriptJson: JSON.parse(fs.readFileSync(TRIX_POLICY_FILE, "utf8")),
    bech32: toBech32FromHexKey(trixHex)
  };

  const tddHex = readPolicyKey(TDD_SKEY_FILE);
  policies[CONFIG.tddPolicyId] = {
    scriptJson: JSON.parse(fs.readFileSync(TDD_POLICY_FILE, "utf8")),
    bech32: toBech32FromHexKey(tddHex)
  };

  // Convert scripts to Lucid nativeScript
  const nativePolicies = {};
  for (const pid of Object.keys(policies)) {
    nativePolicies[pid] = lucid.utils.nativeScriptFromJson(policies[pid].scriptJson);
  }

  // Build mint object: negative counts for burning
  const burnByPolicy = {};
  for (const it of TO_BURN) {
    if (!burnByPolicy[it.policyId]) burnByPolicy[it.policyId] = {};
    const hexName = Buffer.from(it.name, "utf8").toString("hex");
    const unit = it.policyId + hexName;
    burnByPolicy[it.policyId][unit] = -1n;
  }

  try {
    let builder = lucid.newTx();

    for (const pid of Object.keys(burnByPolicy)) {
      const native = nativePolicies[pid];
      if (!native) throw new Error("Missing native policy " + pid);
      builder = builder.attachMintingPolicy(native);
    }

    for (const pid of Object.keys(burnByPolicy)) {
      builder = builder.mintAssets(burnByPolicy[pid]);
    }

    const tx = await builder.complete();

    // 🧪 Dry-run (no submission)
    if (DRY_RUN) {
      console.log("──────────────────────────────────────────────");
      console.log("Dry-run mode ON — transaction NOT submitted.");
      console.log("Would burn these assets:");
      for (const it of TO_BURN)
        console.log(` • ${it.policyId.slice(0,8)}…${it.policyId.slice(-6)} : ${it.name}`);
      console.log("──────────────────────────────────────────────");
      const fee = tx.txComplete.body().fee().to_str();
      console.log("Estimated minimum ADA fee:", fee);
      process.exit(0);
    }

    // 🔐 Sign with both policy keys and wallet
    let signed = tx;
    for (const pid of Object.keys(burnByPolicy)) {
      const bech = policies[pid].bech32;
      console.log(`Signing with policy ${pid.slice(0,8)}...`);
      signed = await signed.signWithPrivateKey(bech);
    }
    signed = await signed.sign().complete();

    // 🪓 Submit
    const txHash = await signed.submit();
    console.log("✅ Burn tx submitted:", txHash);
    process.exit(0);

  } catch (e) {
    console.error("Burn failed:", e);
    process.exit(1);
  }
}

main();
