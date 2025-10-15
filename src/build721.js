import fs from 'fs';
import { CONFIG } from './config.js';

const POLYFILL_DESC = JSON.parse(fs.readFileSync(CONFIG.paths.collectionDescriptions, 'utf8')); 
// { "<policyId>": { "description": "..." } }

function toHex(text) {
  return Buffer.from(text, 'utf8').toString('hex');
}

function withDescription(policyId, obj) {
  // Attach a description if not present (marketplaces like it)
  if (!obj.description && POLYFILL_DESC[policyId]?.description) {
    obj.description = POLYFILL_DESC[policyId].description;
  }
  // (Optional) normalize traits->attributes without mutating source
  if (obj.traits && !obj.attributes) {
    obj.attributes = obj.traits;
  }
  return obj;
}

export function build721(tddAssetObj, trixAssetObj) {
  const tddKey = toHex(tddAssetObj.name);
  const trixKey = toHex(trixAssetObj.name);

  const tddObj = withDescription(CONFIG.tddPolicyId, structuredClone(tddAssetObj));
  const trixObj = withDescription(CONFIG.trixPolicyId, structuredClone(trixAssetObj));

  // Add files[] helper for previews if missing
  if (!tddObj.files) tddObj.files = [{ src: tddObj.image, mediaType: tddObj.mediaType }];
  if (!trixObj.files) trixObj.files = [{ src: trixObj.image, mediaType: trixObj.mediaType }];

  return {
    721: {
      [CONFIG.tddPolicyId]: { [tddKey]: tddObj },
      [CONFIG.trixPolicyId]: { [trixKey]: trixObj },
      version: '2.0',
    },
  };
}
