'use strict';
/* Vercel Function — بلاغ مستخدم: POST /api/report  {url, note?, level?, source?} */
const core = require('./_lib/core.js');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return core.preflight(res);
  if (req.method !== 'POST') return core.send(res, 405, { ok: false, error: 'POST only' });
  const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
  if (!core.rateOk(ip)) return core.send(res, 429, { ok: false, error: 'rate limit exceeded' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const out = core.report(body || null);
  return core.send(res, out.status, out.body);
};
