// src/mint.js
import fs from 'fs';
import fetch from 'node-fetch';
import { Lucid, Blockfrost } from 'lucid-cardano';
import { CONFIG } from './config.js';
import { build721 } from './build721.js';

// Load JSON native scripts from disk
const tddPolicyJson  = JSON.parse(fs.readFileSync(CONFIG.paths.tddPolicy, 'utf8'));
const trixPolicyJson = JSON.parse(fs.readFileSync(CONFIG.paths.trixPolicy, 'utf8'));

// Read the policy signing keys (cardano-cli .skey JSON has cborHex)
const tddSkeyCbor  = JSON.parse(fs.readFileSync('./policies/tdd/policy.skey', 'utf8')).cborHex;
const trixSkeyCbor = JSON.parse(fs.readFileSync('./policies/trix2056/policy.skey', 'utf8')).cborHex;

// Module-scoped holders for the processed/native policies
let TDD_NATIVE_POLICY  = null;
let TRIX_NATIVE_POLICY = null;

function extractBeforeSlot(policy) {
  if (!policy) return null;
  if (policy.type === 'before') return policy.slot ?? null;
  const arr = policy.scripts || [];
  for (const s of arr) {
    const x = extractBeforeSlot(s);
    if (x != null) return x;
  }
  return null;
}

async function getLatestMainnetSlot() {
  const r = await fetch("https://cardano-mainnet.blockfrost.io/api/v0/blocks/latest", {
    headers: { project_id: CONFIG.blockfrostKey }
  });
  if (!r.ok) throw new Error(`Blockfrost blocks/latest ${r.status}`);
  const j = await r.json();
  return Number(j.slot);
}

export async function makeLucid() {
  const lucid = await Lucid.new(
    new Blockfrost("https://cardano-mainnet.blockfrost.io/api/v0", CONFIG.blockfrostKey),
    CONFIG.network
  );
  await lucid.selectWalletFromSeed(CONFIG.seedPhrase);

  // 🔄 Convert plain JSON scripts -> Native minting policies Lucid understands
  TDD_NATIVE_POLICY  = lucid.utils.nativeScriptFromJson(tddPolicyJson);
  TRIX_NATIVE_POLICY = lucid.utils.nativeScriptFromJson(trixPolicyJson);

  // ✅ Sanity-check the policy IDs computed from the actual policies
  const tddComputed  = lucid.utils.mintingPolicyToId(TDD_NATIVE_POLICY);
  const trixComputed = lucid.utils.mintingPolicyToId(TRIX_NATIVE_POLICY);

  if (tddComputed !== CONFIG.tddPolicyId) {
    throw new Error(`TDD policyId mismatch. Script=${tddComputed} env=${CONFIG.tddPolicyId}`);
  }
  if (trixComputed !== CONFIG.trixPolicyId) {
    throw new Error(`TRIX policyId mismatch. Script=${trixComputed} env=${CONFIG.trixPolicyId}`);
  }

  // ⏱ Timelock guard for TRIX (if present)
  const beforeSlot = extractBeforeSlot(trixPolicyJson);
  if (beforeSlot != null) {
    const now = await getLatestMainnetSlot();
    if (now >= beforeSlot) {
      throw new Error(`TRIX policy timelock expired (now=${now} >= before=${beforeSlot})`);
    }
  }

  return lucid;
}

export async function mintBothTo(lucid, toAddress, tddAssetObj, trixAssetObj) {
  if (!tddAssetObj || !trixAssetObj) throw new Error("Asset lookup failed");

  const tddNameHex  = Buffer.from(tddAssetObj.name,  'utf8').toString('hex');
  const trixNameHex = Buffer.from(trixAssetObj.name, 'utf8').toString('hex');

  const tddUnit  = CONFIG.tddPolicyId  + tddNameHex;
  const trixUnit = CONFIG.trixPolicyId + trixNameHex;

  const metadata = build721(tddAssetObj, trixAssetObj);

  try {
    const tx = await lucid
      .newTx()
      // 🔗 Attach the processed/native policies (NOT the raw JSON)
      .attachMintingPolicy(TDD_NATIVE_POLICY)
      .attachMintingPolicy(TRIX_NATIVE_POLICY)
      .mintAssets({ [tddUnit]: 1n, [trixUnit]: 1n })
      .payToAddress(toAddress, { [tddUnit]: 1n, [trixUnit]: 1n }) // Lucid sets min-ADA as needed
      .attachMetadata(721, metadata)
      .complete();

    // 🔑 Add signatures from BOTH policy keys, then sign with your hot wallet (fees/change)
    const signed = await tx
      .signWithPrivateKey(tddSkeyCbor)
      .signWithPrivateKey(trixSkeyCbor)
      .sign()
      .complete();

    const txHash = await signed.submit();
    return txHash;
  } catch (e) {
    const msg = e?.info || e?.message || String(e);
    throw new Error(`mintBothTo failed: ${msg}`);
  }
}
