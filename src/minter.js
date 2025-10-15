import { Lucid, Blockfrost, fromText } from "lucid-cardano";
import fs from "fs";
import { CFG } from "./config.js";
import { fromTextToHex } from "./util.js";

let lucid;

export async function getLucid() {
  if (lucid) return lucid;
  lucid = await Lucid.new(
    new Blockfrost("https://cardano-mainnet.blockfrost.io/api/v0", CFG.blockfrostKey),
    "Mainnet"
  );
  const skeyCbor = JSON.parse(fs.readFileSync(CFG.mintWalletSkeyPath, "utf8"));
  lucid.selectWalletFromPrivateKey(skeyCbor.cborHex ?? skeyCbor);
  return lucid;
}

function loadPolicy(scriptPath) {
  return JSON.parse(fs.readFileSync(scriptPath, "utf8"));
}

export async function mintPair({ orderId, payerAddress, tdd, trix, tddTraits, trixTraits }) {
  const l = await getLucid();

  // Load policies
  const tddPolicyScript = loadPolicy(CFG.tddScriptPath);
  const trixPolicyScript = loadPolicy(CFG.trixScriptPath);

  const tddPolicyId = CFG.tddPolicyId;
  const trixPolicyId = CFG.trixPolicyId;

  // Units
  const tddUnit = tddPolicyId + fromText(tdd.name);
  const trixUnit = trixPolicyId + fromText(trix.name);

  // CIP-25 v2
  const md = {
    "721": {
      [tddPolicyId]: {
        [fromTextToHex(tdd.name)]: {
          name: tdd.name,
          image: tdd.image,
          mediaType: tdd.mediaType,
          attributes: tdd.traits ?? tddTraits ?? {},
          files: [{ src: tdd.image, mediaType: tdd.mediaType }]
        }
      },
      [trixPolicyId]: {
        [fromTextToHex(trix.name)]: {
          name: trix.name,
          image: trix.image,
          mediaType: trix.mediaType,
          attributes: trix.traits ?? trixTraits ?? {},
          files: [{ src: trix.image, mediaType: trix.mediaType }]
        }
      },
      "version": "2.0"
    }
  };

  const tx = await l
    .newTx()
    .attachMintingPolicy(tddPolicyScript)
    .attachMintingPolicy(trixPolicyScript)
    .mintAssets({ [tddUnit]: 1n, [trixUnit]: 1n })
    .payToAddress(payerAddress, { [tddUnit]: 1n, [trixUnit]: 1n })
    .attachMetadata(721, md)
    .complete();

  // Sign with both policy keys + hot wallet
  const tddPolicySkey = fs.readFileSync(CFG.tddSkeyPath, "utf8");
  const trixPolicySkey = fs.readFileSync(CFG.trixSkeyPath, "utf8");

  const signed = await tx
    .signWithPrivateKey(tddPolicySkey)
    .signWithPrivateKey(trixPolicySkey)
    .sign();

  const txHash = await signed.submit();
  return txHash;
}
