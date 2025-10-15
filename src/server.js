import express from 'express';
import { CONFIG } from './config.js';
import { init } from './db.js';

init();

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(CONFIG.port, () => {
  console.log(`API running on :${CONFIG.port}`);
});
