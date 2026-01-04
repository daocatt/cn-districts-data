# China Districts Data Worker

这是一个基于 Cloudflare Workers 的中国行政区划数据自动同步工具。它定期从腾讯地图 WebService API 获取最新的省市区数据，整理为标准的 PCA (Province-City-Area) JSON 格式并存储在 Cloudflare R2 中。

## 功能特点

- **极速同步**：采用腾讯地图全量嵌套接口，单次请求即可完成全国 3000+ 区县的同步。
- **标准格式**：输出 `c` (code), `n` (name), `ch` (children) 结构的嵌套 JSON。
- **自动触发**：支持每日 Cron 定时同步。
- **隐藏触发**：支持通过特定 URL 参数手动刷新数据。
- **现代化 UI**：内置简约的 Glassmorphism 风格数据下载入口。

## 部署地址

查看与下载地址：[https://cn-districts-data.zwq.me](https://cn-districts-data.zwq.me)

## 部署说明

### 1. 准备工作
- 在 Cloudflare 控制台创建一个 R2 Bucket（例如：`cn-districts-data`）。
- 准备一个腾讯地图 [WebService Key](https://lbs.qq.com/dev/console/key/manage)。

### 2. 配置变量
修改 `wrangler.jsonc` 确保绑定了正确的 R2 Bucket 名称。

### 3. 设置 Secrets
在终端执行以下命令设置必要的密钥：

```bash
# 设置腾讯地图 Key
npx wrangler secret put TENCENT_MAP_KEY

# (可选) 设置自定义文件名，默认为 pca-districts.json
npx wrangler secret put R2_FILE_NAME
```

### 4. 发布
```bash
npm run deploy
```

## 测试与手动同步

- **查看数据状态**：直接访问 [https://cn-districts-data.zwq.me](https://cn-districts-data.zwq.me) 查看最后更新时间并下载 JSON。
- **手动触发同步**：在地址栏访问主页并加上参数 `?zwqme=1`，例如：
  `https://your-domain/?zwqme=1`
  页面会提示同步指令已发出。

## 本地开发

1. 复制 `.env.example` 为 `.dev.vars`。
2. 填入你的 `TENCENT_MAP_KEY`。
3. 运行 `npm run dev`。
