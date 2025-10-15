// src/build721.js
import fs from "fs";
import { CONFIG } from "./config.js";

const DESCR =
  fs.existsSync(CONFIG.paths.collectionDescriptions)
    ? JSON.parse(fs.readFileSync(CONFIG.paths.collectionDescriptions, "utf8"))
    : {};

function ensureFiles(meta) {
  if (!meta.files) {
    meta.files = [{ src: meta.image, mediaType: meta.mediaType }];
  }
}

function baseMeta(asset, policyId) {
  const meta = {
    name: asset.name,
    image: asset.image,
    mediaType: asset.mediaType,
    cid: asset.cid,
  };
  // optional collection-wide description
  const colDesc = DESCR[policyId]?.description;
  if (asset.description) meta.description = asset.description;
  else if (colDesc) meta.description = colDesc;
  return meta;
}

function flattenTraitsInto(meta, asset) {
  // Prefer "traits" if present; otherwise "attributes"
  const src = asset.traits ?? asset.attributes ?? {};
  for (const [k, v] of Object.entries(src)) {
    // pool.pm is fine with strings; coerce simple values
    meta[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  // Do NOT keep nested copies:
  // (no meta.traits, no meta.attributes)
}

export function build721(tddAssetObj, trixAssetObj) {
  // Keys MUST be the plain asset names (not hex) for CIP-25
  const tddKey  = tddAssetObj.name;
  const trixKey = trixAssetObj.name;

  // ---- TDD ----
  const tddMeta = baseMeta(tddAssetObj, CONFIG.tddPolicyId);
  flattenTraitsInto(tddMeta, tddAssetObj);
  ensureFiles(tddMeta);

  // ---- TRIX (2056) ----
  const trixMeta = baseMeta(trixAssetObj, CONFIG.trixPolicyId);
  flattenTraitsInto(trixMeta, trixAssetObj);
  ensureFiles(trixMeta);

  // Return the inner policy map (no outer "721" wrapper)
  return {
    [CONFIG.tddPolicyId]:  { [tddKey]:  tddMeta },
    [CONFIG.trixPolicyId]: { [trixKey]: trixMeta },
    version: "2.0",
  };
}
