// ============================================================
// 御坂御坂夸赞计数器 — Cloudflare Worker
// ------------------------------------------------------------
// 部署：Workers 免费版 + 绑定 KV（变量名 PRAISE_KV）
// 路由：
//   GET /          → 夸赞落地页（README 按钮跳转到这里）
//   GET /badge.svg → 粉色徽章（直接嵌入 README）
//   GET /count     → JSON（备选：供 shields.io endpoint 徽章使用）
// 特性：
//   - 按 IP + 上海时区日期去重：每人每天最多夸 1 次
//   - 只存 IP 哈希（SHA-256 + 盐），不存明文 IP
//   - 重复点击返回「明天再来吧」提示页
// ============================================================

const SALT = "misaka-10032-railgun";     // 混淆盐，防止明文存储 IP
const KV_NAME = "PRAISE_KV";             // KV 绑定变量名

// calm_pink 配色
const C = {
  left:  "#E3B9BC",   // 徽章左侧粉
  right: "#FBEDEF",   // 徽章右侧浅粉
  text:  "#4A484C",   // 深灰粉文字
  heart: "#C46A6A",   // 爱心粉
};

// 上海时区日期 YYYY-MM-DD
const todayShanghai = () =>
  new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

// IP → SHA-256 哈希（取前 16 位十六进制）
async function hashIp(ip) {
  const data = new TextEncoder().encode(`${ip}|${SALT}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

// 估算文字像素宽度（中文≈11px，ASCII≈6.5px）
function textWidth(s, size = 11) {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 255 ? size : size * 0.6;
  return w;
}

// ---------- 徽章 SVG（仿 shields 样式，粉色 calm_pink 系） ----------
function badgeSvg(total) {
  const label = "夸夸御坂御坂";
  const msg = `${total} 次`;
  const pad = 12;
  const lw = Math.ceil(textWidth(label) + pad);
  const rw = Math.ceil(textWidth(msg) + pad);
  const H = 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="${H}">
  <rect x="0" y="0" width="${lw}" height="${H}" rx="4" fill="${C.left}"/>
  <path d="M ${lw} 0 h ${rw} a 4 4 0 0 1 4 4 v ${H - 8} a 4 4 0 0 1 -4 4 h -${rw} z" fill="${C.right}"/>
  <text x="8" y="14" font-family="Verdana, 'Microsoft YaHei', sans-serif" font-size="11" fill="${C.text}">${label}</text>
  <text x="${lw + 8}" y="14" font-family="Verdana, 'Microsoft YaHei', sans-serif" font-size="11" fill="${C.heart}">${msg}</text>
</svg>`;
}

// ---------- 夸赞落地页 HTML ----------
function pageHtml(ok, total) {
  const title = ok ? "夸赞成功！" : "今天已经夸过啦";
  const emoji = ok ? "⚡" : "😝";
  const line = ok
    ? `御坂御坂已被夸奖 <b>${total}</b> 次，谢谢你的喜欢！`
    : "你今天已经夸了御坂御坂，明天再来吧！";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:linear-gradient(135deg,#FBEDEF 0%,#F4F4F5 100%);
         font-family:'Microsoft YaHei',sans-serif; color:#4A484C; }
  .card { background:#fff; border-radius:20px; padding:48px 56px; text-align:center;
          box-shadow:0 8px 32px rgba(196,106,106,.18); max-width:420px; }
  .emoji { font-size:64px; }
  h1 { margin:12px 0 8px; color:#C46A6A; }
  p { font-size:16px; line-height:1.7; margin:0 0 24px; }
  b { color:#C46A6A; font-size:20px; }
  a { display:inline-block; text-decoration:none; color:#fff; background:#E3B9BC;
      padding:10px 28px; border-radius:999px; font-size:14px; }
  a:hover { background:#d5a3a6; }
</style>
</head>
<body>
  <div class="card">
    <div class="emoji">${emoji}</div>
    <h1>${title}</h1>
    <p>${line}</p>
    <a href="https://github.com/DinoCatKiller">回到主页 →</a>
  </div>
</body>
</html>`;
}

// ---------- 主逻辑 ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const id = await hashIp(ip);
    const date = todayShanghai();

    // 徽章 SVG（README 直接嵌入）
    if (url.pathname === "/badge.svg") {
      const total = (await env[KV_NAME].get("total")) || "0";
      return new Response(badgeSvg(total), {
        headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    // JSON（备选：供 shields.io endpoint 徽章使用）
    if (url.pathname === "/count") {
      const total = (await env[KV_NAME].get("total")) || "0";
      return new Response(
        JSON.stringify({ schemaVersion: 1, label: "御坂御坂已被夸奖", message: `${total} 次`, color: "ff69b4" }),
        { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }
      );
    }

    // 夸赞落地页（点击按钮跳转到这里）
    if (url.pathname === "/" || url.pathname === "") {
      const todayKey = `daily:${date}:${id}`;
      const already = await env[KV_NAME].get(todayKey);
      const total = (await env[KV_NAME].get("total")) || "0";

      if (already) {
        // 今天夸过了 → 提示明天再来
        return new Response(pageHtml(false, total), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // 首次夸赞 → 计数 +1 并记录
      const next = String(Number(total) + 1);
      await env[KV_NAME].put("total", next);
      // daily key 只保留 2 天，自动过期清理，避免历史记录无限累积
      await env[KV_NAME].put(todayKey, "1", { expirationTtl: 172800 });
      return new Response(pageHtml(true, next), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("404 Not Found", { status: 404 });
  },
};
