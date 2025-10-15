// src/mint.js
import fs from 'fs';
import { Lucid, Blockfrost } from 'lucid-cardano';
import { CONFIG } from './config.js';
import { build721 } from './build721.js';

const tddPolicy = JSON.parse(fs.readFileSync(CONFIG.paths.tddPolicy, 'utf8'));
const trixPolicy = JSON.parse(fs.readFileSync(CONFIG.paths.trixPolicy, 'utf8'));

// 👇 Read the policy signing keys (cardano-cli .skey JSON has cborHex)
const tddSkeyCbor = JSON.parse(fs.readFileSync('./policies/tdd/policy.skey', 'utf8')).cborHex;
const trixSkeyCbor = JSON.parse(fs.readFileSync('./policies/trix2056/policy.skey', 'utf8')).cborHex;

export async function makeLucid() {
  const lucid = await Lucid.new(
    new Blockfrost("https://cardano-mainnet.blockfrost.io/api/v0", CONFIG.blockfrostKey),
    CONFIG.network
  );
  await lucid.selectWalletFromSeed(CONFIG.seedPhrase);

  // (Optional but recommended) sanity-check the policy IDs match the scripts:
  const tddComputed = lucid.utils.mintingPolicyToId(tddPolicy);
  const trixComputed = lucid.utils.mintingPolicyToId(trixPolicy);
  if (tddComputed !== CONFIG.tddPolicyId) {
    throw new Error(`TDD policyId mismatch. Script=${tddComputed} env=${CONFIG.tddPolicyId}`);
  }
  if (trixComputed !== CONFIG.trixPolicyId) {
    throw new Error(`TRIX policyId mismatch. Script=${trixComputed} env=${CONFIG.trixPolicyId}`);
  }

  return lucid;
}

export async function mintBothTo(lucid, toAddress, tddAssetObj, trixAssetObj) {
  if (!tddAssetObj || !trixAssetObj) throw new Error("Asset lookup failed");

  const tddNameHex = Buffer.from(tddAssetObj.name, 'utf8').toString('hex');
  const trixNameHex = Buffer.from(trixAssetObj.name, 'utf8').toString('hex');

  const tddUnit = CONFIG.tddPolicyId + tddNameHex;
  const trixUnit = CONFIG.trixPolicyId + trixNameHex;

  const metadata = build721(tddAssetObj, trixAssetObj);

  const tx = await lucid
    .newTx()
    .attachMintingPolicy(tddPolicy)
    .attachMintingPolicy(trixPolicy)
    .mintAssets({ [tddUnit]: 1n, [trixUnit]: 1n })
    .payToAddress(toAddress, { [tddUnit]: 1n, [trixUnit]: 1n })
    .attachMetadata(721, metadata)
    .complete();

  // 🔑 Add signatures from BOTH policy keys, then sign with your hot wallet
  const signed = await tx
    .signWithPrivateKey(tddSkeyCbor)
    .signWithPrivateKey(trixSkeyCbor)
    .sign() // hot wallet from seedPhrase (fees/change)
    .complete();

  const txHash = await signed.submit();
  return txHash;
}
