/**
 * Cloudflare Worker for fikat.cloud
 * Features:
 * - Telemetry & Download Logging per Machine (HWID / License Key)
 * - Cloudflare KV Persistent Storage (with In-Memory Fallback)
 * - Instant Telegram Bot Alerts to Admin
 * - Admin API for fikat.cloud/admin Dashboard
 * - Static Assets Proxy & SPA Routing
 */

// ==========================================================================
// CẤU HÌNH ADMIN & TELEGRAM BOT
// Bạn có thể điền Token & Chat ID vào đây (hoặc cấu hình trong Cloudflare Environment Variables)
// ==========================================================================
const TELEGRAM_BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN_HERE"; // Điền token bot telegram vào đây
const TELEGRAM_CHAT_ID = "YOUR_TELEGRAM_CHAT_ID_HERE";     // Điền chat_id của bạn vào đây
const DEFAULT_ADMIN_PIN = "fikat2026";                     // Mật khẩu mặc định vào trang Admin

// In-memory fallback if Cloudflare KV is not yet bound
const inMemoryHWIDs = new Map();
const inMemoryLogs = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS preflight handling
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Pin",
        },
      });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8",
    };

    // ------------------------------------------------------------------------
    // Route: /admin -> redirect or serve admin.html
    // ------------------------------------------------------------------------
    if (pathname === "/admin" || pathname === "/admin/") {
      return await env.ASSETS.fetch(new Request(new URL("/admin.html", request.url), request));
    }

    // ------------------------------------------------------------------------
    // API Route: POST /api/telemetry/log (Received from C# Client)
    // ------------------------------------------------------------------------
    if (pathname === "/api/telemetry/log" && request.method === "POST") {
      try {
        const payload = await request.json();
        const hwid = (payload.hwid || "").trim() || "UNKNOWN_HWID";
        const licenseKey = (payload.licenseKey || "").trim() || "Free / Trial";
        const appVersion = (payload.appVersion || "3.1").trim();
        const items = Array.isArray(payload.items) ? payload.items : [];

        if (items.length === 0) {
          return new Response(JSON.stringify({ ok: true, message: "No items to log" }), { headers: corsHeaders });
        }

        const nowIso = new Date().toISOString();
        const vnTime = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace("T", " ").substring(0, 19);

        // Chuẩn hóa từng bản ghi
        const processedItems = items.map((item, idx) => ({
          id: `${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
          hwid,
          licenseKey,
          clipId: item.clipId || "",
          title: item.title || "Chưa có tên bài",
          prompt: item.prompt || "",
          tags: item.tags || "",
          actionType: item.actionType || "MP3",
          appVersion,
          timestamp: item.timestamp || nowIso,
          timeVn: vnTime,
        }));

        // 1. Lưu trữ vào Cloudflare KV hoặc In-Memory
        if (env.DOWNLOAD_LOGS) {
          // A. Cập nhật Index HWID
          let hwidIndex = [];
          try {
            const rawIndex = await env.DOWNLOAD_LOGS.get("hwids_index");
            if (rawIndex) hwidIndex = JSON.parse(rawIndex);
          } catch (e) {}

          let existingHwid = hwidIndex.find((h) => h.hwid === hwid);
          if (!existingHwid) {
            existingHwid = {
              hwid,
              licenseKey,
              firstSeen: vnTime,
              lastSeen: vnTime,
              totalDownloads: 0,
            };
            hwidIndex.unshift(existingHwid);
          } else {
            existingHwid.lastSeen = vnTime;
            if (licenseKey && licenseKey !== "Free / Trial") existingHwid.licenseKey = licenseKey;
          }
          existingHwid.totalDownloads = (existingHwid.totalDownloads || 0) + processedItems.length;

          // Lưu lại index (tối đa 1000 máy gần nhất)
          if (hwidIndex.length > 1000) hwidIndex = hwidIndex.slice(0, 1000);
          await env.DOWNLOAD_LOGS.put("hwids_index", JSON.stringify(hwidIndex));

          // B. Cập nhật Logs theo HWID
          let hwidLogs = [];
          try {
            const rawLogs = await env.DOWNLOAD_LOGS.get(`logs:${hwid}`);
            if (rawLogs) hwidLogs = JSON.parse(rawLogs);
          } catch (e) {}

          hwidLogs = [...processedItems, ...hwidLogs].slice(0, 1000);
          await env.DOWNLOAD_LOGS.put(`logs:${hwid}`, JSON.stringify(hwidLogs));
        } else {
          // Fallback In-Memory
          let hInfo = inMemoryHWIDs.get(hwid) || {
            hwid,
            licenseKey,
            firstSeen: vnTime,
            lastSeen: vnTime,
            totalDownloads: 0,
          };
          hInfo.lastSeen = vnTime;
          hInfo.totalDownloads += processedItems.length;
          inMemoryHWIDs.set(hwid, hInfo);

          let currentLogs = inMemoryLogs.get(hwid) || [];
          inMemoryLogs.set(hwid, [...processedItems, ...currentLogs].slice(0, 1000));
        }

        // 2. Bắn thông báo Telegram (chạy nền bất đồng bộ)
        if (ctx && ctx.waitUntil) {
          ctx.waitUntil(sendTelegramAlert(env, payload, processedItems, vnTime));
        } else {
          sendTelegramAlert(env, payload, processedItems, vnTime).catch(() => {});
        }

        return new Response(
          JSON.stringify({
            ok: true,
            loggedCount: processedItems.length,
            hwid,
            timestamp: nowIso,
          }),
          { headers: corsHeaders }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ ok: false, error: err.message }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // ------------------------------------------------------------------------
    // API Route: POST /api/admin/auth (Kiểm tra mã PIN Admin)
    // ------------------------------------------------------------------------
    if (pathname === "/api/admin/auth" && request.method === "POST") {
      try {
        const body = await request.json();
        const pin = (body.pin || "").trim();
        const targetPin = (env.ADMIN_PIN || DEFAULT_ADMIN_PIN).trim();

        if (pin === targetPin) {
          return new Response(
            JSON.stringify({
              ok: true,
              token: btoa(`${pin}:${Date.now()}`),
              expiresIn: 86400,
            }),
            { headers: corsHeaders }
          );
        }
        return new Response(
          JSON.stringify({ ok: false, message: "Mã PIN Admin không chính xác" }),
          { status: 401, headers: corsHeaders }
        );
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 400, headers: corsHeaders });
      }
    }

    // ------------------------------------------------------------------------
    // API Route: GET /api/admin/data (Lấy dữ liệu bảng điều khiển Admin)
    // ------------------------------------------------------------------------
    if (pathname === "/api/admin/data" && request.method === "GET") {
      const pinHeader = request.headers.get("X-Admin-Pin") || url.searchParams.get("pin");
      const targetPin = (env.ADMIN_PIN || DEFAULT_ADMIN_PIN).trim();

      if (pinHeader !== targetPin) {
        return new Response(
          JSON.stringify({ ok: false, message: "Không có quyền truy cập Admin." }),
          { status: 401, headers: corsHeaders }
        );
      }

      const targetHwid = url.searchParams.get("hwid");

      let hwidList = [];
      let logs = [];

      if (env.DOWNLOAD_LOGS) {
        try {
          const rawIndex = await env.DOWNLOAD_LOGS.get("hwids_index");
          if (rawIndex) hwidList = JSON.parse(rawIndex);
        } catch (e) {}

        if (targetHwid) {
          try {
            const rawLogs = await env.DOWNLOAD_LOGS.get(`logs:${targetHwid}`);
            if (rawLogs) logs = JSON.parse(rawLogs);
          } catch (e) {}
        } else {
          // Lấy gộp 500 bài gần nhất từ các máy hàng đầu
          const topHwids = hwidList.slice(0, 10);
          for (const h of topHwids) {
            try {
              const rawLogs = await env.DOWNLOAD_LOGS.get(`logs:${h.hwid}`);
              if (rawLogs) {
                const subLogs = JSON.parse(rawLogs);
                logs.push(...subLogs.slice(0, 50));
              }
            } catch (e) {}
          }
          logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          logs = logs.slice(0, 500);
        }
      } else {
        // Fallback In-Memory
        hwidList = Array.from(inMemoryHWIDs.values());
        if (targetHwid) {
          logs = inMemoryLogs.get(targetHwid) || [];
        } else {
          for (const lList of inMemoryLogs.values()) {
            logs.push(...lList.slice(0, 50));
          }
          logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          logs = logs.slice(0, 500);
        }
      }

      // Thống kê tổng hợp
      const totalMachines = hwidList.length;
      const totalDownloads = hwidList.reduce((sum, h) => sum + (h.totalDownloads || 0), 0);
      const todayStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().substring(0, 10);
      const todayDownloads = logs.filter(
        (l) => (l.timestamp || "").startsWith(todayStr) || (l.timeVn || "").startsWith(todayStr)
      ).length;
      const totalStems = logs.filter(
        (l) => (l.actionType || "").toLowerCase().includes("stem")
      ).length;

      return new Response(
        JSON.stringify({
          ok: true,
          storageMode: env.DOWNLOAD_LOGS ? "Cloudflare_KV" : "InMemory_Fallback",
          stats: {
            totalMachines,
            totalDownloads,
            todayDownloads,
            totalStems,
          },
          hwidList,
          logs,
        }),
        { headers: corsHeaders }
      );
    }

    // ------------------------------------------------------------------------
    // Static Assets Proxy & SPA Fallback
    // ------------------------------------------------------------------------
    try {
      const response = await env.ASSETS.fetch(request);
      if (response.status === 404) {
        if (!url.pathname.includes(".")) {
          return await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
        }
      }
      return response;
    } catch (err) {
      return new Response("Asset fetch error: " + err.message, { status: 500 });
    }
  },
};

/**
 * Gửi thông báo Telegram Bot tức thì về điện thoại
 */
async function sendTelegramAlert(env, payload, items, vnTime) {
  const botToken = (env.TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = (env.TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID || "").trim();

  // Bỏ qua nếu chưa cấu hình
  if (
    !botToken ||
    !chatId ||
    botToken === "YOUR_TELEGRAM_BOT_TOKEN_HERE" ||
    chatId === "YOUR_TELEGRAM_CHAT_ID_HERE"
  ) {
    return;
  }

  try {
    const hwid = payload.hwid || "UNKNOWN";
    const shortHwid =
      hwid.length > 16 ? hwid.substring(0, 8) + "..." + hwid.substring(hwid.length - 6) : hwid;
    const key = payload.licenseKey || "Free / Trial";
    const count = items.length;

    let songListText = "";
    items.slice(0, 6).forEach((item, idx) => {
      const title = item.title || "Không có tên";
      const action = item.actionType || "MP3";
      songListText += `  ${idx + 1}. 🎵 <b>${escapeHtml(title)}</b> [<i>${escapeHtml(action)}</i>]\n`;
    });
    if (items.length > 6) {
      songListText += `  ... và ${items.length - 6} bài khác.\n`;
    }

    const message =
      `🚀 <b>[Suno Bulk Studio] Khách vừa tải nhạc!</b>\n\n` +
      `💻 <b>Mã máy (HWID):</b> <code>${shortHwid}</code>\n` +
      `🔑 <b>Key / Tên:</b> <code>${escapeHtml(key)}</code>\n` +
      `📦 <b>Số lượng:</b> <b>${count}</b> bài / stems\n` +
      `📋 <b>Danh sách bài:</b>\n${songListText}\n` +
      `⏰ <b>Thời gian:</b> <i>${vnTime} (Giờ VN)</i>`;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    console.warn("Telegram notification error:", err);
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
