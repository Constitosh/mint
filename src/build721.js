import fs from 'fs';
import { CONFIG } from './config.js';

const DESCR = JSON.parse(fs.readFileSync(CONFIG.paths.collectionDescriptions, 'utf8'));

function toHex(s){ return Buffer.from(s, 'utf8').toString('hex'); }

function withDesc(policyId, obj){
  if (!obj.attributes && obj.traits) obj.attributes = obj.traits;
  if (!obj.files) obj.files = [{ src: obj.image, mediaType: obj.mediaType }];
  if (!obj.description && DESCR[policyId]?.description) obj.description = DESCR[policyId].description;
  return obj;
}

export function build721(tddAssetObj, trixAssetObj){
  const tddKey  = toHex(tddAssetObj.name);
  const trixKey = toHex(trixAssetObj.name);

  const tddObj  = withDesc(CONFIG.tddPolicyId,  { ...tddAssetObj });
  const trixObj = withDesc(CONFIG.trixPolicyId, { ...trixAssetObj });

  // NOTE: return the inner map directly
  return {
    [CONFIG.tddPolicyId]:  { [tddKey]:  tddObj },
    [CONFIG.trixPolicyId]: { [trixKey]: trixObj },
    version: "2.0",
  };
}