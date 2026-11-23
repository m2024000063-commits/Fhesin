'use strict';
/* Vercel Function — جاهزية الخدمة: GET /api/health */
const core = require('./_lib/core.js');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return core.preflight(res);
  const out = core.health();
  return core.send(res, out.status, out.body);
};
