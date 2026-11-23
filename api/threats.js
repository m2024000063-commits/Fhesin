'use strict';
/* Vercel Function — مؤشرات التهديدات: GET /api/threats */
const core = require('./_lib/core.js');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return core.preflight(res);
  const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
  if (!core.rateOk(ip)) return core.send(res, 429, { ok: false, error: 'rate limit exceeded' });
  const out = core.threats();
  return core.send(res, out.status, out.body);
};
