// scripts/burn.js
// Usage: NODE_OPTIONS=--experimental-fetch node scripts/burn.js
// Put asset units to burn in the `TO_BURN` array as objects { policyId, name }.
// It will burn 1 unit of each listed asset under its policy.

import fs from "fs";
import { Lucid, Blockfrost, C } from "lucid-cardano";
import { CONFIG } from "../src/config.js"; // adjust path if needed

// EDIT THIS: list of assets to burn (policy + plain name)
// Example: { policyId: "0ecb97...", name: "2056_35" }
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


// path to policy script JSON and skey for that policy (adjust names)
const TRIX_POLICY_FILE = "./policies/trix2056/policy.script";
const TRIX_SKEY_FILE   = "./policies/trix2056/policy.skey";
const TDD_POLICY_FILE  = "./policies/tdd/policy.script";
const TDD_SKEY_FILE    = "./policies/tdd/policy.skey";

// wallet seed (the hot wallet that holds tokens & will pay fees)
// Make sure CONFIG.seedPhrase is correct and present in your config
const SEED = CONFIG.seedPhrase;

function readCborHex(path) {
  return JSON.parse(fs.readFileSync(path, "utf8")).cborHex;
}
function skeyCborHexToBech32(cborHex) {
  const bytes = Buffer.from(cborHex, "hex");
  const isCborBytes = bytes.length === 34 && bytes[0] === 0x58 && bytes[1] === 0x20;
  const raw = isCborBytes ? bytes.slice(2) : bytes;
  const prv = C.PrivateKey.from_normal_bytes(raw);
  return prv.to_bech32();
}

async function main() {
  if (!TO_BURN.length) {
    console.log("No assets in TO_BURN. Edit scripts/burn.js and add entries. Exiting.");
    process.exit(1);
  }

  const lucid = await Lucid.new(
    new Blockfrost("https://cardano-mainnet.blockfrost.io/api/v0", CONFIG.blockfrostKey),
    CONFIG.network
  );
  await lucid.selectWalletFromSeed(SEED);

  // load policy objects / keys
  const policies = {};
  // TRIX
  policies[CONFIG.trixPolicyId] = {
    scriptJson: JSON.parse(fs.readFileSync(TRIX_POLICY_FILE, "utf8")),
    skeyBech: skeyCborHexToBech32(readCborHex(TRIX_SKEY_FILE))
  };
  // TDD
  policies[CONFIG.tddPolicyId] = {
    scriptJson: JSON.parse(fs.readFileSync(TDD_POLICY_FILE, "utf8")),
    skeyBech: skeyCborHexToBech32(readCborHex(TDD_SKEY_FILE))
  };

  // convert scripts -> native policies Lucid understands
  const nativePolicies = {};
  for (const pid of Object.keys(policies)) {
    nativePolicies[pid] = lucid.utils.nativeScriptFromJson(policies[pid].scriptJson);
  }

  // build mint object: negative counts to burn
  // Note: Lucid requires ONE mintAssets() call per policy (it is allowed to chain)
  // We'll aggregate per policy
  const burnByPolicy = {};
  for (const it of TO_BURN) {
    if (!burnByPolicy[it.policyId]) burnByPolicy[it.policyId] = {};
    const hexName = Buffer.from(it.name, "utf8").toString("hex");
    const unit = it.policyId + hexName;
    // burn 1 copy
    burnByPolicy[it.policyId][unit] = -1n;
  }

  try {
    let builder = lucid.newTx();

    // attach relevant policies
    for (const pid of Object.keys(burnByPolicy)) {
      const native = nativePolicies[pid];
      if (!native) throw new Error("Missing native policy " + pid);
      builder = builder.attachMintingPolicy(native);
    }

    // add one mintAssets() per policy with negative counts
    for (const pid of Object.keys(burnByPolicy)) {
      const assets = burnByPolicy[pid]; // { unit: -1n, ... }
      builder = builder.mintAssets(assets);
    }

    // pay fees from wallet (no outputs needed because we are burning tokens)
    const tx = await builder.complete();

    // sign with policy keys (bech32) then sign with wallet
    let signed = tx;
    for (const pid of Object.keys(burnByPolicy)) {
      const skey = policies[pid].skeyBech;
      signed = await signed.signWithPrivateKey(skey);
    }
    signed = await signed.sign().complete();

    const txHash = await signed.submit();
    console.log("Burn tx submitted:", txHash);
    process.exit(0);
  } catch (e) {
    console.error("Burn failed:", e);
    process.exit(1);
  }
}

main();
