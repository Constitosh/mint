import fs from 'fs';
import { CONFIG } from './config.js';

const DESCR = JSON.parse(fs.readFileSync(CONFIG.paths.collectionDescriptions, 'utf8'));

function withDesc(policyId, obj){
  // helpful normalizations
  if (!obj.attributes && obj.traits) obj.attributes = obj.traits;
  if (!obj.files) obj.files = [{ src: obj.image, mediaType: obj.mediaType }];
  if (!obj.description && DESCR[policyId]?.description) obj.description = DESCR[policyId].description;
  return obj;
}

export function build721(tddAssetObj, trixAssetObj){
  // ❗ use the plain (string) asset names as keys
  const tddKey  = tddAssetObj.name;
  const trixKey = trixAssetObj.name;

  const tddObj  = withDesc(CONFIG.tddPolicyId,  { ...tddAssetObj });
  const trixObj = withDesc(CONFIG.trixPolicyId, { ...trixAssetObj });

  // return the inner map directly (no extra "721" wrapper)
  return {
    [CONFIG.tddPolicyId]:  { [tddKey]:  tddObj },
    [CONFIG.trixPolicyId]: { [trixKey]: trixObj },
    version: "2.0",
  };
}
