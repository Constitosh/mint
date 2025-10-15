// src/utils.js
import fs from "fs";

/**
 * Sleep helper (await sleep(ms))
 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Simple timestamped logger
 */
export function log(...args) {
  const msg = `[${new Date().toISOString()}] ${args.join(" ")}`;
  console.log(msg);
}

/**
 * Read JSON safely
 */
export function readJSON(path) {
  try {
    const data = fs.readFileSync(path, "utf8");
    return JSON.parse(data);
  } catch (e) {
    log("⚠️ readJSON error:", path, e.message);
    return null;
  }
}

/**
 * Write JSON safely (pretty)
 */
export function writeJSON(path, obj) {
  try {
    fs.writeFileSync(path, JSON.stringify(obj, null, 2));
  } catch (e) {
    log("⚠️ writeJSON error:", path, e.message);
  }
}

/**
 * Generate random integer [0, max)
 */
export function randInt(max) {
  return Math.floor(Math.random() * max);
}

/**
 * Pick random element from array (no mutation)
 */
export function pickRandom(arr) {
  if (!arr?.length) return null;
  return arr[randInt(arr.length)];
}

/**
 * Convert ADA to lovelace (BigInt)
 */
export function adaToLovelace(ada) {
  return BigInt(Math.floor(Number(ada) * 1_000_000));
}

/**
 * Convert lovelace (string or bigint) to ADA (number)
 */
export function lovelaceToAda(lovelace) {
  return Number(lovelace) / 1_000_000;
}

/**
 * Format address short (for logs)
 */
export function shortAddr(addr) {
  if (!addr) return "";
  return addr.slice(0, 8) + "..." + addr.slice(-6);
}

/**
 * Retry wrapper (e.g. for flaky Blockfrost calls)
 */
export async function retry(fn, retries = 3, delay = 1000) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (e) {
      attempt++;
      log(`⚠️ Retry ${attempt}/${retries}: ${e.message}`);
      if (attempt < retries) await sleep(delay);
    }
  }
  throw new Error("Max retries reached");
}
