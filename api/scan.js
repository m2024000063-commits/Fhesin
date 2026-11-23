'use strict';
/* Vercel Function — فحص رابط: GET /api/scan?url=...&source=... أو POST JSON {url, source} */
const core = require('./_lib/core.js');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return core.preflight(res);
  const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
  if (!core.rateOk(ip)) return core.send(res, 429, { ok: false, error: 'rate limit exceeded' });

  let url = req.query && req.query.url;
  let source = req.query && req.query.source;
  if (!url && req.body && typeof req.body === 'object') {
    url = req.body.url;
    source = req.body.source || source;
  }
  /* تقوية: بعض المستهلكين يرسلون JSON بدون ترويسة Content-Type الصحيحة فيصل النص خاماً —
     كان يُتجاهل فيُرجع 400 رغم أن الرابط صحيح (report.js كانت تفكك النص والفحص لا) */
  if (!url && typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      if (parsed && typeof parsed === 'object') {
        url = parsed.url;
        source = parsed.source || source;
      }
    } catch (e) { /* نص غير JSON — يُترك ويُعاد 400 لاحقاً إن لم يوجد url */ }
  }
  const fmt = (req.query && req.query.format) || (req.body && req.body.format) || '';
  const out = await core.scan(url, source, fmt);
  if (out.textResponse) return core.send(res, out.status, out.body, 'text/plain; charset=utf-8');
  return core.send(res, out.status, out.body);
};
