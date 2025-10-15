import 'dotenv/config';

export const CFG = {
  blockfrostKey: process.env.BLOCKFROST_KEY,
  price: BigInt(process.env.PRICE || "30000000"),
  receiveAddress: process.env.RECEIVE_ADDRESS,

  tddPolicyId: process.env.TDD_POLICY_ID,
  tddScriptPath: process.env.TDD_POLICY_SCRIPT_JSON_PATH,
  tddSkeyPath: process.env.TDD_POLICY_SKEY_PATH,

  trixPolicyId: process.env.TRIX_POLICY_ID,
  trixScriptPath: process.env.TRIX_POLICY_SCRIPT_JSON_PATH,
  trixSkeyPath: process.env.TRIX_POLICY_SKEY_PATH,

  mintWalletSkeyPath: process.env.MINT_WALLET_SKEY_CBOR,

  pollMs: Number(process.env.POLL_MS || 6000),
};
