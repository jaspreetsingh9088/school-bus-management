// Vercel serverless entry. `npm run vercel-build` compiles src/ to dist/ first.
process.env.REALTIME = process.env.REALTIME || 'off';
process.env.DB_POOL_MAX = process.env.DB_POOL_MAX || '3';
const { createServer } = require('../dist/serverless');

let ready;
module.exports = async (req, res) => {
  ready = ready || createServer();
  const handler = await ready;
  return handler(req, res);
};
