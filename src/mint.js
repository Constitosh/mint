// src/mint.js
import fs from 'fs';
import { Lucid, Blockfrost } from 'lucid-cardano';
import { CONFIG } from './config.js';
import { build721 } from './build721.js';

const tddPolicy = JSON.parse(fs.readFileSync(CONFIG.paths.tddPolicy, 'utf8'));
const trixPolicy = JSON.parse(fs.readFileSync(CONFIG.paths.trixPolicy, 'utf8'));

// Read the policy signing keys (cardano-cli .skey JSON has cborHex)
const tddSkeyCbor = JSON.parse(fs.readFileSync('./policies/tdd/policy.skey', 'utf8')).cborHex;
const trixSkeyCbor = JSON.parse(fs.readFileSync('./policies/trix2056/policy.skey', 'utf8')).cborHex;

function extractBeforeSlot(policy) {
  // If the policy has a time lock like {"type":"before","slot":1234}, return that slot (or null)
  if (policy?.type === 'before') return policy.slot ?? null;
  if (policy?.type === 'all' || policy?.type === 'any' || policy?.type === 'atLeast') {
    const arr = policy.scripts || [];
    for (const s of arr) {
      const slot = extractBeforeSlot(s);
      if (slot != null) return slot;
    }
  }
  return null;
}

export async function makeLucid() {
  const lucid = await Lucid.new(
    new Blockfrost("https://cardano-mainnet.blockfrost.io/api/v0", CONFIG.blockfrostKey),
    CONFIG.network
  );
  await lucid.selectWalletFromSeed(CONFIG.seedPhrase);

  // Sanity-check the policy IDs match the scripts actually loaded
  const tddComputed = lucid.utils.mintingPolicyToId(tddPolicy);
  const trixComputed = lucid.utils.mintingPolicyToId(trixPolicy);
  if (tddComputed !== CONFIG.tddPolicyId) {
    throw new Error(`TDD policyId mismatch. Script=${tddComputed} env=${CONFIG.tddPolicyId}`);
  }
  if (trixComputed !== CONFIG.trixPolicyId) {
    throw new Error(`TRIX policyId mismatch. Script=${trixComputed} env=${CONFIG.trixPolicyId}`);
  }

  // If TRIX policy has a time lock, make sure it hasn't expired
  const beforeSlot = extractBeforeSlot(trixPolicy);
  if (beforeSlot != null) {
    const tip = await lucid.awaitBlock(0); // get latest block header
    // lucid.awaitBlock(0) returns latest block but not slot; safer: use lucid.currentSlot() if available
    const currentSlot = await lucid.utils.currentSlot(); // lucid >=0.10
    if (currentSlot >= beforeSlot) {
      throw new Error(`TRIX policy timelock expired: currentSlot=${currentSlot} >= beforeSlot=${beforeSlot}`);
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
      .attachMintingPolicy(tddPolicy)
      .attachMintingPolicy(trixPolicy)
      .mintAssets({ [tddUnit]: 1n, [trixUnit]: 1n })
      .payToAddress(toAddress, { [tddUnit]: 1n, [trixUnit]: 1n }) // Lucid will add min-ADA automatically
      .attachMetadata(721, metadata)
      .complete();

    // Add signatures from BOTH policy keys, then sign with your hot wallet (fees/change)
    const signed = await tx
      .signWithPrivateKey(tddSkeyCbor)
      .signWithPrivateKey(trixSkeyCbor)
      .sign()
      .complete();

    const txHash = await signed.submit();
    return txHash;
  } catch (e) {
    // surface the reason clearly back to the worker logs
    const msg = e?.info || e?.message || String(e);
    throw new Error(`mintBothTo failed: ${msg}`);
  }
}
