import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { normalizeUsdaFood } from './domain.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const assets = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/domain.js': ['domain.js', 'text/javascript'], '/data/foods.json': ['data/foods.json', 'application/json'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };

export function createAppServer({ apiKey = process.env.USDA_API_KEY || '', fetchImpl = fetch } = {}) {
  const cache = new Map();
  let windowStart = Date.now(), requestCount = 0;
  return createServer(async (req, res) => {
    const send = (status, data, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
      res.end(req.method === 'HEAD' ? undefined : (type === 'application/json' ? JSON.stringify(data) : data));
    };
    if (!['GET', 'HEAD'].includes(req.method)) return send(405, { error: '仅支持读取请求。' });
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return send(400, { error: '请求地址无效。' }); }
    if (url.pathname === '/api/foods') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q || q.length > 120 || [...url.searchParams.keys()].some(k => k !== 'q') || url.searchParams.getAll('q').length !== 1) return send(400, { error: '请只提供 1–120 字的食物搜索词。' });
      if (!apiKey) return send(503, { error: '尚未配置 USDA 密钥。你仍可添加自定义食物和使用本地记录。', code: 'NO_API_KEY' });
      const cached = cache.get(q);
      if (cached && Date.now() - cached.at < 300000) return send(200, cached.data);
      if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); requestCount = 0; }
      if (++requestCount > 30) return send(429, { error: '查询较频繁，请一分钟后重试。' });
      try {
        const upstream = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
        upstream.searchParams.set('query', q);
        upstream.searchParams.set('api_key', apiKey);
        upstream.searchParams.set('pageSize', '20');
        upstream.searchParams.set('dataType', 'Foundation,SR Legacy,Survey (FNDDS)');
        const response = await fetchImpl(upstream, { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' } });
        if (!response.ok) return send(response.status === 429 ? 429 : 502, { error: response.status === 429 ? 'USDA 查询配额暂时用完，请稍后重试。' : 'USDA 暂不可用，请稍后重试或使用本地食物。' });
        const json = await response.json();
        if (!Array.isArray(json.foods)) throw new Error('Invalid upstream shape');
        const data = { foods: json.foods.map(normalizeUsdaFood).filter(Boolean) };
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(q, { at: Date.now(), data });
        return send(200, data);
      } catch { return send(502, { error: '连接 USDA 失败或超时。本地记录不受影响。' }); }
    }
    const asset = assets[url.pathname];
    if (!asset) return send(404, { error: '未找到页面。' });
    try { const content = await readFile(resolve(root, asset[0])); send(200, asset[1] === 'application/json' ? JSON.parse(content) : content, asset[1]); }
    catch { send(500, { error: '无法读取页面文件。' }); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createAppServer();
  const port = Number(process.env.PORT || 4180), host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`食衡 · http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
