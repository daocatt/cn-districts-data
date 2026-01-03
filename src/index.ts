export interface Env {
	BUCKET: R2Bucket;
	TENCENT_MAP_KEY: string;
}

interface DistrictItem {
	id: string;
	name: string;
	fullname: string;
	pinyin: string[];
	location: {
		lat: number;
		lng: number;
	};
	cpoint?: {
		lat: number;
		lng: number;
	};
	children?: DistrictItem[];
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/api/data') {
			const obj = await env.BUCKET.get('districts.json');
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
			headers.set('Content-Disposition', 'attachment; filename="districts.json"');

			return new Response(obj.body, { headers });
		}

		if (url.pathname === '/api/trigger' && request.method === 'POST') {
			// Manual trigger for testing
			ctx.waitUntil(updateDistricts(env));
			return new Response(JSON.stringify({ message: 'Update triggered' }), {
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// UI Page
		const obj = await env.BUCKET.head('districts.json');
		const lastUpdate = obj?.uploaded ? new Date(obj.uploaded).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '从未更新';
		const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>中国行政区划数据更新服务</title>
    <style>
        :root {
            --primary: #2563eb;
            --primary-hover: #1d4ed8;
            --bg: #f8fafc;
            --card: #ffffff;
            --text: #1e293b;
            --text-muted: #64748b;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg);
            color: var(--text);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
        }
        .card {
            background: var(--card);
            padding: 2.5rem;
            border-radius: 1.5rem;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
            width: 100%;
            max-width: 450px;
            text-align: center;
        }
        h1 {
            margin-top: 0;
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--text);
        }
        .status {
            margin: 2rem 0;
            padding: 1.5rem;
            background: #f1f5f9;
            border-radius: 1rem;
        }
        .status-label {
            font-size: 0.875rem;
            color: var(--text-muted);
            margin-bottom: 0.5rem;
        }
        .status-time {
            font-size: 1.125rem;
            font-weight: 600;
            font-variant-numeric: tabular-nums;
        }
        .actions {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0.75rem 1.5rem;
            border-radius: 0.75rem;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.2s;
            cursor: pointer;
            border: none;
        }
        .btn-primary {
            background: var(--primary);
            color: white;
        }
        .btn-primary:hover {
            background: var(--primary-hover);
            transform: translateY(-1px);
        }
        .btn-outline {
            background: white;
            color: var(--text);
            border: 1px solid #e2e8f0;
        }
        .btn-outline:hover {
            background: #f8fafc;
            border-color: #cbd5e1;
        }
        .footer {
            margin-top: 2rem;
            font-size: 0.75rem;
            color: var(--text-muted);
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>行政区划数据服务</h1>
        <p style="color: var(--text-muted)">定时从腾讯地图同步最新数据并保存至 R2</p>
        
        <div class="status">
            <div class="status-label">最后同步时间</div>
            <div class="status-time" id="last-update">${lastUpdate}</div>
        </div>

        <div class="actions">
            <a href="/api/data" class="btn btn-primary">下载 districts.json</a>
            <button onclick="triggerUpdate()" id="update-btn" class="btn btn-outline">立即手动同步</button>
        </div>

        <div class="footer">
            数据来源：腾讯地图 WebService API
        </div>
    </div>

    <script>
        async function triggerUpdate() {
            const btn = document.getElementById('update-btn');
            const originalText = btn.innerText;
            btn.disabled = true;
            btn.innerText = '正在触发...';
            
            try {
                const res = await fetch('/api/trigger', { method: 'POST' });
                if (res.ok) {
                    alert('已触发后台同步任务，请稍后刷新页面查看结果。');
                } else {
                    alert('触发失败：' + (await res.text()));
                }
            } catch (e) {
                alert('网络错误');
            } finally {
                btn.disabled = false;
                btn.innerText = originalText;
            }
        }
    </script>
</body>
</html>`;
		return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
	},

	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(updateDistricts(env));
	},
};

async function updateDistricts(env: Env) {
	console.log('Starting districts update...');
	const key = env.TENCENT_MAP_KEY;
	if (!key) {
		console.error('TENCENT_MAP_KEY is not defined');
		return;
	}

	try {
		const response = await fetch(`https://apis.map.qq.com/ws/district/v1/getlist?key=${key}`);
		const body: any = await response.json();

		if (body.status !== 0) {
			console.error('Tencent API Error:', body.message);
			return;
		}

		const [provinces, cities, districts] = body.result;

		// Reorganize into tree structure
		const tree = provinces.map((p: any) => {
			const province: DistrictItem = {
				id: p.id,
				name: p.name,
				fullname: p.fullname,
				pinyin: p.pinyin,
				location: p.location,
				children: [],
			};

			// Find cities for this province
			const provincePrefix = p.id.substring(0, 2);
			const provinceCities = cities.filter((c: any) => c.id.startsWith(provincePrefix));

			province.children = provinceCities.map((c: any) => {
				const city: DistrictItem = {
					id: c.id,
					name: c.name,
					fullname: c.fullname,
					pinyin: c.pinyin,
					location: c.location,
					children: [],
				};

				// Find districts for this city
				// Tencent Map IDs: Province (2) + City (2) + District (2)
				const cityPrefix = c.id.substring(0, 4);
				const cityDistricts = districts.filter((d: any) => d.id.startsWith(cityPrefix));

				city.children = cityDistricts.map((d: any) => ({
					id: d.id,
					name: d.name,
					fullname: d.fullname,
					pinyin: d.pinyin,
					location: d.location,
				}));

				return city;
			});

			return province;
		});

		const data = JSON.stringify(tree);
		await env.BUCKET.put('districts.json', data, {
			httpMetadata: {
				contentType: 'application/json',
			},
			customMetadata: {
				updatedAt: new Date().toISOString(),
			},
		});

		console.log('Districts update completed successfully');
	} catch (error) {
		console.error('Update failed:', error);
	}
}
