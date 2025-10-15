import fs from 'fs';
import { Lucid, Blockfrost } from 'lucid-cardano';
import { CONFIG } from './config.js';
import { build721 } from './build721.js';

const tddPolicy = JSON.parse(fs.readFileSync(CONFIG.paths.tddPolicy));
const trixPolicy = JSON.parse(fs.readFileSync(CONFIG.paths.trixPolicy));

export async function makeLucid() {
  const lucid = await Lucid.new(
    new Blockfrost("https://cardano-mainnet.blockfrost.io/api/v0", CONFIG.blockfrostKey),
    CONFIG.network
  );
  await lucid.selectWalletFromSeed(CONFIG.seedPhrase);
  return lucid;
}

export async function mintBothTo(lucid, toAddress, tddAssetObj, trixAssetObj) {
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

  const signed = await tx
    // Signs with your hot wallet; native scripts check policy key hashes
    .sign()
    .complete();

  const txHash = await signed.submit();
  return txHash;
}
