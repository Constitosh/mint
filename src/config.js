import 'dotenv/config';

export const CONFIG = {
  network: process.env.NETWORK || 'Mainnet',
  blockfrostKey: process.env.BLOCKFROST_KEY,
  seedPhrase: process.env.SEED_PHRASE,
  mintAddress: process.env.MINT_ADDRESS,
  priceAda: Number(process.env.PRICE_ADA || 30),
  port: Number(process.env.PORT || 3005),
  pollInterval: Number(process.env.POLL_INTERVAL || 8),
  tddPolicyId: process.env.TDD_POLICY_ID,
  trixPolicyId: process.env.TRIX_POLICY_ID,

  paths: {
    tddPolicy: './policies/tdd/policy.script',
    trixPolicy: './policies/trix2056/policy.script',
    tddJson: './data/combined_metadata_TDD.json',
    trixJson: './data/combined_metadata_2056.json',
    collectionDescriptions: './data/collection_descriptions.json',
    sqlite: './data/mint.sqlite',
  },
};
