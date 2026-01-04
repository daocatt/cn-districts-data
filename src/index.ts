export interface Env {
    BUCKET: R2Bucket;
    TENCENT_MAP_KEY: string;
    R2_FILE_NAME: string;
    R2_BUCKET_NAME: string;
}

interface PCANode {
    c: string | number; // code
    n: string; // name
    ch?: PCANode[]; // children
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const fileName = env.R2_FILE_NAME || 'pca-districts.json';
        const origin = url.origin;

        // 1. 数据下载接口
        if (url.pathname === '/api/data') {
            const obj = await env.BUCKET.get(fileName);
            if (!obj) {
                return new Response(JSON.stringify({ error: 'Data not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            const headers = new Headers();
            obj.writeHttpMetadata(headers);
            headers.set('etag', obj.httpEtag);
            headers.set('Content-Type', 'application/json');
            headers.set('Content-Disposition', `attachment; filename="${fileName}"`);
            if (obj.uploaded) headers.set('Last-Modified', obj.uploaded.toUTCString());
            return new Response(obj.body, { headers });
        }

        // 2. 隐藏触发逻辑 (通过 ?zwqme=1 触发)
        let syncMessage = '';
        if (url.searchParams.get('zwqme') === '1') {
            ctx.waitUntil(updateDistricts(env, origin));
            syncMessage = '<div class="alert">✅ 同步指令已发出，请稍后刷新查看。</div>';
        }

        // 3. UI 页面 (移除按钮)
        const obj = await env.BUCKET.head(fileName);
        const lastUpdate = obj?.uploaded ? new Date(obj.uploaded).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '从未更新';
        const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>District Portal</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;800&display=swap" rel="stylesheet">
    <style>
        :root { --primary: #6366f1; --bg: #0f172a; --card: rgba(30, 41, 59, 0.7); --text: #f8fafc; --text-muted: #94a3b8; --accent: #10b981; }
        body { font-family: 'Outfit', sans-serif; background: radial-gradient(circle at top left, #1e1b4b, #0f172a); color: var(--text); display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .card { background: var(--card); backdrop-filter: blur(12px); padding: 3rem; border-radius: 2rem; border: 1px solid rgba(255, 255, 255, 0.1); width: 100%; max-width: 440px; text-align: center; }
        h1 { margin-top: 0; background: linear-gradient(to right, #818cf8, #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 2.5rem; letter-spacing: -0.02em; }
        .status { margin: 2rem 0; padding: 1.5rem; background: rgba(255, 255, 255, 0.05); border-radius: 1.25rem; }
        .status-time { font-size: 1.4rem; font-weight: 700; color: var(--accent); margin-top: 0.5rem; }
        .btn-primary { display: block; width: 100%; padding: 1.25rem; border-radius: 1.1rem; font-weight: 700; text-decoration: none; background: var(--primary); color: white; border: none; font-size: 1.1rem; box-shadow: 0 10px 20px -10px var(--primary); transition: transform 0.2s; }
        .btn-primary:hover { transform: translateY(-2px); }
        .alert { margin-bottom: 2rem; padding: 1rem; background: rgba(16, 185, 129, 0.1); border: 1px solid var(--accent); border-radius: 1rem; color: var(--accent); font-weight: 700; font-size: 0.9rem; }
    </style>
</head>
<body>
    <div class="card">
        ${syncMessage}
        <h1>District Portal</h1>
        <p style="color: var(--text-muted); margin-bottom: 2rem;">Chinese Administrative Districts Data Center</p>
        <div class="status">
            <div style="color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em;">Last Updated</div>
            <div class="status-time">${lastUpdate}</div>
        </div>
        <div class="actions">
            <a href="/api/data" class="btn-primary">Download JSON</a>
        </div>
    </div>
</body>
</html>`;
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    },

    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
        const defaultReferer = `https://${env.R2_BUCKET_NAME}.workers.dev`;
        ctx.waitUntil(updateDistricts(env, defaultReferer));
    },
};

async function updateDistricts(env: Env, referer: string) {
    const key = env.TENCENT_MAP_KEY.trim();
    if (!key) return;

    try {
        const url = `https://apis.map.qq.com/ws/district/v1/list?key=${key}&struct_type=1`;
        const response = await fetch(url, {
            headers: { 'Referer': referer, 'User-Agent': 'Mozilla/5.0' }
        });
        const body: any = await response.json();
        if (body.status !== 0) throw new Error(body.message);

        const result = body.result;
        const provinces = result[0];

        const formatNode = (node: any, level: number): PCANode => {
            let code = node.id;
            if (level === 0) code = parseInt(node.id.substring(0, 2));
            else if (level === 1) code = node.id.substring(0, 4);
            else code = node.id.substring(0, 6);

            const formatted: PCANode = {
                c: code,
                n: node.fullname
            };

            if (level < 2 && node.children && Array.isArray(node.children) && node.children.length > 0) {
                formatted.ch = node.children.map((child: any) => formatNode(child, level + 1));
            }
            return formatted;
        };

        const tree = provinces.map((p: any) => formatNode(p, 0));
        const fileName = env.R2_FILE_NAME || 'pca-districts.json';
        await env.BUCKET.put(fileName, JSON.stringify(tree), {
            httpMetadata: { contentType: 'application/json' },
            customMetadata: { updatedAt: new Date().toISOString() }
        });
        console.log(`[FAST SYNC] Success! Saved to ${fileName}`);
    } catch (error) {
        console.error('[FAST SYNC] Error:', error);
    }
}
