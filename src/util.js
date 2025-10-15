export const fromTextToHex = (s) =>
  Buffer.from(s, "utf8").toString("hex");

export const delay = (ms) => new Promise(r => setTimeout(r, ms));
