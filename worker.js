/**
 * Cloudflare Worker — fikat.cloud
 * Hệ thống Quản trị, Phân quyền & Giám sát Lịch sử Tải Suno Bulk Studio
 * Storage Engine: Cloudflare D1 (SQLite Edge Database)
 */

const TELEGRAM_BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN_HERE";
const TELEGRAM_CHAT_ID = "YOUR_TELEGRAM_CHAT_ID_HERE";
const DEFAULT_ADMIN_PIN = "fikat2026";
const JWT_SECRET = "fikat_cloud_super_secret_signing_key_2026";
const TURSO_URL = "https://fikat-fikat.aws-ap-northeast-1.turso.io/v2/pipeline";
const TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODk4MDUxMDUsImlkIjoiMDFhMGI4YjItMDkwMS03N2IxLTgwNDktOTJiNjgxMTA1OWUwIiwia2lkIjoiNTZURVBrTktsSW4wVHI2ektianlKZjBEQXU2RDdGaGJzZUhQLVFGYkFfOCIsInJpZCI6ImJhNDI1ZjdiLTVlYzYtNGI4ZS1iNTVmLTNhMmU5MDJkM2I3YSJ9.-8ybsOaX4mXhWC7-brreSN8iczUcW6sLyZA8d-zjpgRPUHnda7slsBjOpzn0d6Dvnjw42WPXO9Ess5RLa9D1AQ";
const YT_API_KEY_DEFAULT = "AIzaSyBCt0_9B923hAQX7Fn6dHScqMMS2HBAm_w";
const ROOT_ADMIN_USERNAME = "fikat";

let dbInited = false;

async function initDB(env) {
  if (dbInited || !env.DB) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      fullName TEXT NOT NULL DEFAULT '',
      username TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Nhân viên',
      isRootAdmin INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      allowedTools TEXT NOT NULL DEFAULT '[]',
      licenseKey TEXT DEFAULT '',
      licensedUntil TEXT DEFAULT NULL,
      hwid TEXT DEFAULT '',
      createdAt TEXT DEFAULT '',
      updatedAt TEXT DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS hwids (
      hwid TEXT PRIMARY KEY,
      licenseKey TEXT DEFAULT '',
      username TEXT DEFAULT '',
      fullName TEXT DEFAULT '',
      role TEXT DEFAULT 'Nhân viên',
      registeredAt TEXT DEFAULT '',
      lastSeen TEXT DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hwid TEXT NOT NULL DEFAULT '',
      licenseKey TEXT DEFAULT '',
      userId TEXT DEFAULT '',
      username TEXT DEFAULT '',
      fullName TEXT DEFAULT '',
      clipId TEXT DEFAULT '',
      title TEXT DEFAULT '',
      prompt TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      actionType TEXT DEFAULT 'MP3',
      appVersion TEXT DEFAULT '',
      timeVn TEXT DEFAULT '',
      createdAt TEXT DEFAULT ''
    )`
  ];

  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }

  // Tự động chuyển data cũ từ KV qua D1 nếu D1 chưa có users
  await autoMigrateFromKV(env);

  dbInited = true;
}

async function autoMigrateFromKV(env) {
  try {
    if (!env.DOWNLOAD_LOGS || !env.DB) return;
    const countRow = await env.DB.prepare("SELECT COUNT(*) as cnt FROM users").first();
    if ((countRow?.cnt || 0) > 0) return;

    const raw = await env.DOWNLOAD_LOGS.get("users_data");
    if (!raw) return;
    const oldUsers = JSON.parse(raw);
    if (!Array.isArray(oldUsers) || oldUsers.length === 0) return;

    for (const u of oldUsers) {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO users (id, fullName, username, passwordHash, salt, role, isRootAdmin, status, allowedTools, licenseKey, licensedUntil, hwid, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        u.id || `usr_${Date.now()}`,
        u.fullName || '',
        u.username || '',
        u.passwordHash || '',
        u.salt || '',
        u.role || 'Nhân viên',
        u.isRootAdmin ? 1 : 0,
        u.status || 'active',
        typeof u.allowedTools === 'string' ? u.allowedTools : JSON.stringify(u.allowedTools || []),
        u.licenseKey || '',
        u.licensedUntil || null,
        u.hwid || '',
        u.createdAt || '',
        u.updatedAt || ''
      ).run();
    }
  } catch (err) {
    console.warn("KV to D1 migration notice:", err);
  }
}

export default {
  async fetch(request, env, ctx) {
    await initDB(env);

    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Pin, X-Auth-Token",
        },
      });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8",
    };

    const jsonRes = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: corsHeaders });

    // ── Static routes ────────────────────────────────────────────────────────
    if (pathname === "/" || pathname === "/index.html") {
      const assetResp = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
      const newHeaders = new Headers(assetResp.headers);
      newHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
      newHeaders.set("Pragma", "no-cache");
      newHeaders.set("Expires", "0");
      return new Response(assetResp.body, {
        status: assetResp.status,
        statusText: assetResp.statusText,
        headers: newHeaders
      });
    }
    if (pathname === "/admin" || pathname === "/admin/" || pathname === "/admin.html") {
      const assetResp = await env.ASSETS.fetch(new Request(new URL("/admin.html", request.url), request));
      const newHeaders = new Headers(assetResp.headers);
      newHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
      newHeaders.set("Pragma", "no-cache");
      newHeaders.set("Expires", "0");
      return new Response(assetResp.body, {
        status: assetResp.status,
        statusText: assetResp.statusText,
        headers: newHeaders
      });
    }
    if (pathname === "/livestream" || pathname === "/livestream/" || pathname === "/livestream.html") {
      const assetResp = await env.ASSETS.fetch(new Request(new URL("/livestream.html", request.url), request));
      const newHeaders = new Headers(assetResp.headers);
      newHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
      newHeaders.set("Pragma", "no-cache");
      newHeaders.set("Expires", "0");
      return new Response(assetResp.body, {
        status: assetResp.status,
        statusText: assetResp.statusText,
        headers: newHeaders
      });
    }
    if (pathname === "/data" || pathname === "/data/" || pathname === "/data/index.html") {
      const assetResp = await env.ASSETS.fetch(new Request(new URL("/data/index.html", request.url), request));
      const newHeaders = new Headers(assetResp.headers);
      newHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
      newHeaders.set("Pragma", "no-cache");
      newHeaders.set("Expires", "0");
      return new Response(assetResp.body, {
        status: assetResp.status,
        statusText: assetResp.statusText,
        headers: newHeaders
      });
    }

    // ── YouTube Channel Scraper API ───────────────────────────────────────────
    if (pathname === "/api/youtube/channel-info" && request.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return jsonRes({ ok: false, message: "Vui lòng nhập link hoặc tên kênh YouTube." }, 400);

      try {
        const info = await fetchYouTubeChannelData(q);
        return jsonRes({ ok: true, channel: info });
      } catch (err) {
        return jsonRes({ ok: false, message: "Lỗi kéo thông tin kênh: " + err.message }, 500);
      }
    }

    // ── 06:00 AM Daily Snapshot Cron API (Trigger & Health Check) ─────────────
    if (pathname === "/api/cron/snapshot") {
      const res = await runDailySnapshotJob(env);
      return jsonRes(res);
    }

    // ── Version Info API ──────────────────────────────────────────────────────
    if ((pathname === "/api/version/pilab" || (pathname === "/api/version" && new URL(request.url).searchParams.get("app") === "pilab")) && request.method === "GET") {
      return jsonRes({
        appId: "pilab-studio",
        name: "PiLab Studio",
        currentVersion: "1.0",
        releaseDate: "23/09/2026",
        status: "stable",
        statusText: "Hoạt động ổn định",
        download: {
          zipFile: "PiLab_Studio_v1.0.zip",
          fileName: "PiLab_Studio_v1.0.zip",
          directUrl: "/downloads/PiLab_Studio_v1.0.zip",
          fileSize: "63.7 MB",
          architecture: "Windows x64 (Win 10 / 11)"
        },
        highlights: [
          "🎨 Studio Tạo ảnh AI Flow & ChatGPT hàng loạt với công nghệ tự động ghép thẻ, tự động chọn tỷ lệ, tách slot",
          "🎬 Studio Tạo video AI Flow từ prompt hoặc ảnh sẵn có với thuật toán chống trùng lặp",
          "🛡️ Cơ chế bảo mật HWID & Quản lý bản quyền trực tuyến fikat.cloud cấp quyền theo nhân viên",
          "🌙 Hỗ trợ Dark Mode & Light Mode thời thượng, chuyển đổi giao diện mượt mà chỉ 1 chạm",
          "⚡ Bản dựng Standalone Single-File cực nhẹ, không cần cài đặt .NET runtime"
        ]
      });
    }

    // ── Bảo vệ Tải Tool Trực Tiếp Theo Quyền Hạn (PiLab Studio v1.0) ──────────
    if (pathname === "/downloads/PiLab_Studio_v1.0.zip" || pathname === "/downloads/BAN_SHARE.zip" || pathname === "/api/download/pilab") {
      let token = "";
      const authHeader = request.headers.get("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7).trim();
      } else {
        const cookie = request.headers.get("Cookie") || "";
        const m = cookie.match(/fikat_session_token=([^;]+)/);
        if (m) token = decodeURIComponent(m[1].trim());
      }
      if (!token) token = url.searchParams.get("token") || "";

      let authorized = false;
      if (token) {
        try {
          const parts = token.split(".");
          if (parts.length === 2) {
            const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[0]), c => c.charCodeAt(0))));
            if (payload.exp && Date.now() < payload.exp) {
              const isAdmin = Boolean(payload.isRootAdmin || payload.role === "Quản trị viên");
              const tools = Array.isArray(payload.allowedTools) ? payload.allowedTools : [];
              if (isAdmin || tools.includes("pilab-studio")) {
                authorized = true;
              }
            }
          }
        } catch (e) {}
      }

      if (!authorized) {
        return new Response(
          `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bảo Mật Fikat - Chưa Cấp Quyền Tải</title>
  <style>
    body { background: #0a0907; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #16130e; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 18px; padding: 36px 28px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.85); }
    .icon { font-size: 3rem; margin-bottom: 12px; }
    h2 { color: #f59e0b; margin: 0 0 10px; font-size: 1.4rem; }
    p { color: #9ca3af; line-height: 1.6; font-size: 0.92rem; margin: 0 0 22px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #f59e0b, #d97706); color: #000; padding: 12px 28px; border-radius: 9999px; font-weight: 700; font-size: 0.95rem; text-decoration: none; transition: transform 0.15s; }
    .btn:hover { transform: translateY(-2px); }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h2>Chưa Được Cấp Quyền Tải</h2>
    <p>Tài khoản của bạn chưa được Quản trị viên cấp quyền tải <b>PiLab Studio v1.0</b>.<br>Vui lòng đăng nhập hoặc liên hệ Quản trị viên tại <b>fikat.cloud</b> để được phân quyền sử dụng công cụ này.</p>
    <a href="/#pilab-studio" class="btn">Về Trang Chủ Đăng Nhập</a>
  </div>
</body>
</html>`,
          { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }

      // Người dùng đã được cấp quyền hợp lệ -> Chuyển hướng sang CDN GitHub Release tốc độ cao
      return Response.redirect("https://github.com/fikatuwu/fikat/releases/download/v1.0/PiLab_Studio_v1.0.zip", 302);
    }

    if (pathname === "/api/version" && request.method === "GET") {
      return jsonRes({
        appId: "suno-bulk-studio",
        name: "Suno Bulk Studio",
        currentVersion: "3.5",
        releaseDate: "16/09/2026",
        status: "stable",
        statusText: "Hoạt động ổn định",
        download: {
          zipFile: "Suno_Bulk_Downloader.zip",
          fileName: "Suno_Bulk_Downloader.zip",
          directUrl: "https://github.com/fikatuwu/fikat/releases/download/v3.5/Suno_Bulk_Downloader.zip",
          fileSize: "116.9 MB",
          architecture: "Windows x64 (Win 10 / 11)"
        },
        highlights: [
          "🚀 Tự động làm mới phiên bảo mật (Auto Token Refresh): Tự động trích xuất token Clerk JWT mới nhất với skipCache, giải quyết triệt để lỗi 422 Token validation failed",
          "⚡ Thuật toán kích hoạt nút Tạo nhạc thế hệ mới: Nhận diện thông minh mọi thành phần giao diện tạo nhạc mới của Suno, đồng bộ chính xác prompt vào React state",
          "🔄 Cơ chế tự phục hồi thông minh (Self-Healing Session): Tự động tải lại ngầm và gửi lại bài mượt mà 100% khi phát hiện phiên bị stale",
          "🛠️ Nút làm mới 🔄 trên thanh công cụ: Reload lại WebView2 và tái đồng bộ phiên đăng nhập chỉ với 1 click"
        ]
      });
    }

    // ========================================================================
    // PHẦN 1: AUTHENTICATION
    // ========================================================================

    // 1.1 POST /api/auth/register
    if (pathname === "/api/auth/register" && request.method === "POST") {
      try {
        const body = await request.json();
        const fullName = (body.fullName || "").trim();
        const rawUsername = (body.username || "").trim().toLowerCase();
        const password = (body.password || "").trim();

        if (!fullName) return jsonRes({ ok: false, message: "Vui lòng nhập Họ và tên." }, 400);
        if (!rawUsername || rawUsername.length < 3) {
          return jsonRes({ ok: false, message: "Tên tài khoản phải từ 3 ký tự trở lên." }, 400);
        }
        if (!/^[a-z0-9_.-]+$/.test(rawUsername)) {
          return jsonRes({ ok: false, message: "Tên tài khoản chỉ được chứa chữ cái, số, dấu chấm hoặc gạch dưới." }, 400);
        }
        if (!password || password.length < 6) {
          return jsonRes({ ok: false, message: "Mật khẩu phải từ 6 ký tự trở lên." }, 400);
        }

        const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(rawUsername).first();
        if (existing) {
          return jsonRes({ ok: false, message: "Tên tài khoản này đã tồn tại trên hệ thống." }, 400);
        }

        const countRow = await env.DB.prepare("SELECT COUNT(*) as cnt FROM users").first();
        const isFirstUser = (countRow?.cnt || 0) === 0;
        const rootAdminUsername = ((env && env.ROOT_ADMIN_USERNAME) || ROOT_ADMIN_USERNAME || "fikat").toLowerCase();
        const isRootAdmin = isFirstUser || rawUsername === rootAdminUsername;
        const role = isRootAdmin ? "Quản trị viên" : "Nhân viên";

        const salt = generateRandomHex(16);
        const passwordHash = await hashPassword(password, salt);
        const vnTime = getVnTime();
        const id = `usr_${Date.now()}_${generateRandomHex(4)}`;
        const licenseKey = isRootAdmin
          ? `ADMIN-ROOT-${generateRandomHex(4).toUpperCase()}`
          : `NV-${generateRandomHex(4).toUpperCase()}-${generateRandomHex(4).toUpperCase()}`;
        const licensedUntil = isRootAdmin ? "2099-12-31T23:59:59.000Z" : null;
        const status = isRootAdmin ? "active" : "pending";
        const allowedTools = isRootAdmin ? '["suno-bulk-studio","tool-random-nhac","haloli-livestream","pilab-studio"]' : '[]';

        await env.DB.prepare(`
          INSERT INTO users (id, fullName, username, passwordHash, salt, role, isRootAdmin, status, allowedTools, licenseKey, licensedUntil, hwid, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
        `).bind(id, fullName, rawUsername, passwordHash, salt, role, isRootAdmin ? 1 : 0, status, allowedTools, licenseKey, licensedUntil, vnTime, vnTime).run();

        if (isRootAdmin) {
          const newUser = {
            id, fullName, username: rawUsername, role,
            isRootAdmin: true, status: "active",
            allowedTools: JSON.parse(allowedTools),
            licenseKey, licensedUntil, hwid: "",
            createdAt: vnTime, updatedAt: vnTime
          };
          const token = await createAuthToken(newUser);
          return jsonRes({
            ok: true,
            message: "Đăng ký thành công! Bạn là Quản trị viên tối cao (Root Admin) của hệ thống.",
            token,
            user: sanitizeUser(newUser),
          });
        }

        return jsonRes({
          ok: true,
          pending: true,
          message: "Đăng ký thành công! Tài khoản của bạn đang chờ Quản trị viên phê duyệt. Vui lòng liên hệ Admin để được kích hoạt.",
        });
      } catch (err) {
        return jsonRes({ ok: false, message: "Lỗi đăng ký: " + err.message }, 500);
      }
    }

    // 1.2 POST /api/auth/login
    if (pathname === "/api/auth/login" && request.method === "POST") {
      try {
        const body = await request.json();
        const rawUsername = (body.username || "").trim().toLowerCase();
        const password = (body.password || "").trim();

        if (!rawUsername || !password) {
          return jsonRes({ ok: false, message: "Vui lòng nhập tài khoản và mật khẩu." }, 400);
        }

        const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(rawUsername).first();
        if (!user) {
          return jsonRes({ ok: false, message: "Tài khoản không tồn tại." }, 401);
        }

        const checkHash = await hashPassword(password, user.salt);
        if (checkHash !== user.passwordHash) {
          return jsonRes({ ok: false, message: "Mật khẩu không chính xác." }, 401);
        }

        if (user.status === "pending") {
          return jsonRes({
            ok: false,
            message: "Tài khoản của bạn đang chờ Quản trị viên phê duyệt. Vui lòng chờ hoặc liên hệ Admin!",
          }, 403);
        }

        if (user.status === "blocked") {
          return jsonRes({
            ok: false,
            message: "Tài khoản của bạn đã bị Quản trị viên khóa. Vui lòng liên hệ Admin để mở lại!",
          }, 403);
        }

        const token = await createAuthToken(dbUserToObj(user));
        return jsonRes({
          ok: true,
          message: "Đăng nhập thành công!",
          token,
          user: sanitizeUser(dbUserToObj(user)),
        });
      } catch (err) {
        return jsonRes({ ok: false, message: "Lỗi đăng nhập: " + err.message }, 500);
      }
    }

    // 1.3 GET /api/auth/me
    if (pathname === "/api/auth/me" && request.method === "GET") {
      const authUser = await getAuthenticatedUser(request, env);
      if (!authUser) {
        return jsonRes({ ok: false, message: "Phiên đăng nhập đã hết hạn." }, 401);
      }
      return jsonRes({ ok: true, user: sanitizeUser(authUser) });
    }

    // 1.4 POST /api/admin/auth (Legacy PIN)
    if (pathname === "/api/admin/auth" && request.method === "POST") {
      try {
        const body = await request.json();
        const pin = (body.pin || "").trim();
        const targetPin = (env.ADMIN_PIN || DEFAULT_ADMIN_PIN).trim();
        if (pin === targetPin) {
          const fakeRoot = {
            id: "root_pin_user",
            fullName: "Quản trị viên (Master)",
            username: "fikat",
            role: "Quản trị viên",
            isRootAdmin: true,
            status: "active",
            allowedTools: ["suno-bulk-studio", "tool-random-nhac", "haloli-livestream", "pilab-studio"]
          };
          const token = await createAuthToken(fakeRoot);
          return jsonRes({ ok: true, token, user: sanitizeUser(fakeRoot) });
        }
        return jsonRes({ ok: false, message: "Mã PIN không chính xác." }, 401);
      } catch (e) {
        return jsonRes({ ok: false, message: e.message }, 400);
      }
    }

    // ========================================================================
    // PHẦN 2: QUẢN TRỊ TÀI KHOẢN & PHÂN QUYỀN
    // ========================================================================

    // 2.1 GET /api/admin/users
    if (pathname === "/api/admin/users" && request.method === "GET") {
      const authUser = await getAuthenticatedUser(request, env);
      if (!authUser || authUser.role !== "Quản trị viên") {
        return jsonRes({ ok: false, message: "Chỉ Quản trị viên mới có quyền xem danh sách tài khoản." }, 403);
      }

      const { results } = await env.DB.prepare("SELECT * FROM users ORDER BY createdAt ASC").all();
      return jsonRes({ ok: true, users: (results || []).map(dbUserToObj) });
    }

    // 2.2 POST /api/admin/user/role
    if (pathname === "/api/admin/user/role" && request.method === "POST") {
      try {
        const authUser = await getAuthenticatedUser(request, env);
        if (!authUser || authUser.role !== "Quản trị viên") {
          return jsonRes({ ok: false, message: "Chỉ Quản trị viên mới có quyền thay đổi vai trò." }, 403);
        }

        const body = await request.json();
        const targetUserId = body.targetUserId;
        const newRole = body.newRole;

        if (!targetUserId || !["Quản trị viên", "Nhân viên"].includes(newRole)) {
          return jsonRes({ ok: false, message: "Tham số không hợp lệ." }, 400);
        }

        const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetUserId).first();
        if (!target) return jsonRes({ ok: false, message: "Không tìm thấy người dùng này." }, 404);

        if (target.isRootAdmin) {
          return jsonRes({ ok: false, message: "Không thể thay đổi quyền của Quản trị viên tối cao (Root Admin)!" }, 403);
        }

        if (newRole === "Nhân viên" && target.role === "Quản trị viên" && !authUser.isRootAdmin) {
          return jsonRes({ ok: false, message: "Chỉ Quản trị viên tối cao (Root Admin) mới có quyền xóa quyền Quản trị viên!" }, 403);
        }

        await env.DB.prepare("UPDATE users SET role = ?, updatedAt = ? WHERE id = ?")
          .bind(newRole, getVnTime(), targetUserId).run();

        return jsonRes({
          ok: true,
          message: `Đã chuyển vai trò của [${target.fullName}] thành: ${newRole}`,
        });
      } catch (e) {
        return jsonRes({ ok: false, message: e.message }, 500);
      }
    }

    // 2.3 POST /api/admin/user/block
    if (pathname === "/api/admin/user/block" && request.method === "POST") {
      try {
        const authUser = await getAuthenticatedUser(request, env);
        if (!authUser || authUser.role !== "Quản trị viên") {
          return jsonRes({ ok: false, message: "Chỉ Quản trị viên mới có quyền khóa/mở khóa tài khoản." }, 403);
        }

        const body = await request.json();
        const targetUserId = body.targetUserId;
        const blocked = Boolean(body.blocked);

        const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetUserId).first();
        if (!target) return jsonRes({ ok: false, message: "Không tìm thấy người dùng." }, 404);

        if (target.isRootAdmin) {
          return jsonRes({ ok: false, message: "Không thể khóa tài khoản của Quản trị viên tối cao!" }, 403);
        }

        const newStatus = blocked ? "blocked" : "active";
        await env.DB.prepare("UPDATE users SET status = ?, updatedAt = ? WHERE id = ?")
          .bind(newStatus, getVnTime(), targetUserId).run();

        return jsonRes({
          ok: true,
          message: blocked ? `Đã khóa tài khoản của [${target.fullName}].` : `Đã mở khóa tài khoản cho [${target.fullName}].`,
        });
      } catch (e) {
        return jsonRes({ ok: false, message: e.message }, 500);
      }
    }

    // 2.4 POST /api/admin/user/license
    if (pathname === "/api/admin/user/license" && request.method === "POST") {
      try {
        const authUser = await getAuthenticatedUser(request, env);
        if (!authUser || authUser.role !== "Quản trị viên") {
          return jsonRes({ ok: false, message: "Chỉ Quản trị viên mới có quyền kích hoạt bản quyền." }, 403);
        }

        const body = await request.json();
        const targetUserId = body.targetUserId;
        const days = parseInt(body.days || "30", 10);

        const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetUserId).first();
        if (!target) return jsonRes({ ok: false, message: "Không tìm thấy người dùng." }, 404);

        let untilDate;
        if (days === -1 || days >= 9000) {
          untilDate = new Date("2099-12-31T23:59:59.000Z");
        } else {
          // Tính thẳng từ thời điểm hiện tại (không cộng dồn vào hạn cũ)
          untilDate = new Date(Date.now() + days * 24 * 3600 * 1000);
        }

        let licenseKey = target.licenseKey;
        if (!licenseKey) {
          licenseKey = `NV-${generateRandomHex(4).toUpperCase()}-${generateRandomHex(4).toUpperCase()}`;
        }

        await env.DB.prepare("UPDATE users SET licensedUntil = ?, licenseKey = ?, updatedAt = ? WHERE id = ?")
          .bind(untilDate.toISOString(), licenseKey, getVnTime(), targetUserId).run();

        return jsonRes({
          ok: true,
          message: `Đã kích hoạt bản quyền cho [${target.fullName}] đến ${untilDate.toISOString().substring(0, 10)}!`,
          licenseKey,
          licensedUntil: untilDate.toISOString(),
        });
      } catch (e) {
        return jsonRes({ ok: false, message: e.message }, 500);
      }
    }

    // 2.5 POST /api/admin/user/approve
    if (pathname === "/api/admin/user/approve" && request.method === "POST") {
      try {
        const authUser = await getAuthenticatedUser(request, env);
        if (!authUser || authUser.role !== "Quản trị viên") {
          return jsonRes({ ok: false, message: "Chỉ Admin mới được duyệt tài khoản." }, 403);
        }
        const body = await request.json();
        const targetId = body.targetUserId;
        const tools = Array.isArray(body.allowedTools) ? body.allowedTools : [];
        const role = body.role === "Quản trị viên" ? "Quản trị viên" : "Nhân viên";

        const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first();
        if (!target) return jsonRes({ ok: false, message: "Không tìm thấy tài khoản." }, 404);
        if (target.status !== "pending") return jsonRes({ ok: false, message: "Tài khoản này không ở trạng thái chờ duyệt." }, 400);

        await env.DB.prepare("UPDATE users SET status = 'active', role = ?, allowedTools = ?, updatedAt = ? WHERE id = ?")
          .bind(role, JSON.stringify(tools), getVnTime(), targetId).run();

        return jsonRes({ ok: true, message: `Đã duyệt tài khoản [${target.fullName}]!` });
      } catch (e) {
        return jsonRes({ ok: false, message: e.message }, 500);
      }
    }

    // 2.6 POST /api/admin/user/reject
    if (pathname === "/api/admin/user/reject" && request.method === "POST") {
      try {
        const authUser = await getAuthenticatedUser(request, env);
        if (!authUser || authUser.role !== "Quản trị viên") {
          return jsonRes({ ok: false, message: "Chỉ Admin mới được từ chối tài khoản." }, 403);
        }
        const body = await request.json();
        const targetId = body.targetUserId;

        const target = await env.DB.prepare("SELECT fullName FROM users WHERE id = ?").bind(targetId).first();
        if (!target) return jsonRes({ ok: false, message: "Không tìm thấy tài khoản." }, 404);

        await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetId).run();
        return jsonRes({ ok: true, message: `Đã từ chối và xóa tài khoản [${target.fullName}].` });
      } catch (e) {
        return jsonRes({ ok: false, message: e.message }, 500);
      }
    }

    // 2.7 POST /api/admin/user/tools
    if (pathname === "/api/admin/user/tools" && request.method === "POST") {
      try {
        const authUser = await getAuthenticatedUser(request, env);
        if (!authUser || authUser.role !== "Quản trị viên") {
          return jsonRes({ ok: false, message: "Chỉ Admin mới được sửa quyền tool." }, 403);
        }
        const body = await request.json();
        const targetId = body.targetUserId;
        const tools = Array.isArray(body.allowedTools) ? body.allowedTools : [];

        const target = await env.DB.prepare("SELECT fullName FROM users WHERE id = ?").bind(targetId).first();
        if (!target) return jsonRes({ ok: false, message: "Không tìm thấy tài khoản." }, 404);

        await env.DB.prepare("UPDATE users SET allowedTools = ?, updatedAt = ? WHERE id = ?")
          .bind(JSON.stringify(tools), getVnTime(), targetId).run();

        return jsonRes({ ok: true, message: `Đã cập nhật quyền tool cho [${target.fullName}]!` });
      } catch (e) {
        return jsonRes({ ok: false, message: e.message }, 500);
      }
    }

    // 2.8 POST /api/admin/user/delete
    if (pathname === "/api/admin/user/delete" && request.method === "POST") {
      try {
        const authUser = await getAuthenticatedUser(request, env);
        if (!authUser || authUser.role !== "Quản trị viên") {
          return jsonRes({ ok: false, message: "Chỉ Quản trị viên mới có quyền xóa tài khoản." }, 403);
        }
        const body = await request.json();
        const targetUserId = body.targetUserId;

        const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetUserId).first();
        if (!target) return jsonRes({ ok: false, message: "Không tìm thấy tài khoản." }, 404);

        if (target.isRootAdmin) {
          return jsonRes({ ok: false, message: "Không thể xóa tài khoản Quản trị viên tối cao!" }, 403);
        }

        if (target.role === "Quản trị viên" && !authUser.isRootAdmin) {
          return jsonRes({ ok: false, message: "Chỉ Root Admin mới có quyền xóa tài khoản Quản trị viên khác!" }, 403);
        }

        await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetUserId).run();
        return jsonRes({ ok: true, message: `Đã xóa vĩnh viễn tài khoản [${target.fullName}].` });
      } catch (e) {
        return jsonRes({ ok: false, message: e.message }, 500);
      }
    }

    // 2.9 POST /api/admin/machine/assign (Gán máy HWID cho Nhân viên)
    if (pathname === "/api/admin/machine/assign" && request.method === "POST") {
      try {
        const authUser = await getAuthenticatedUser(request, env);
        if (!authUser || authUser.role !== "Quản trị viên") {
          return jsonRes({ ok: false, message: "Chỉ Quản trị viên mới có quyền gán máy." }, 403);
        }
        const body = await request.json();
        const hwid = (body.hwid || "").trim();
        const targetUserId = (body.targetUserId || "").trim();

        if (!hwid) return jsonRes({ ok: false, message: "Thiếu mã máy HWID." }, 400);

        const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetUserId).first();
        if (!target) return jsonRes({ ok: false, message: "Không tìm thấy tài khoản nhân viên." }, 404);

        const vnTime = getVnTime();

        // 1. Gán HWID vào user
        await env.DB.prepare("UPDATE users SET hwid = ?, updatedAt = ? WHERE id = ?")
          .bind(hwid, vnTime, target.id).run();

        // 2. Cập nhật bảng hwids
        await env.DB.prepare(`
          INSERT INTO hwids (hwid, licenseKey, username, fullName, role, registeredAt, lastSeen)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(hwid) DO UPDATE SET
            username = excluded.username,
            fullName = excluded.fullName,
            licenseKey = excluded.licenseKey,
            role = excluded.role
        `).bind(
          hwid,
          target.licenseKey || target.fullName,
          target.username,
          target.fullName,
          target.role === "Quản trị viên" ? "Admin" : "Nhân viên",
          vnTime,
          vnTime
        ).run();

        // 3. Cập nhật tên nhân viên cho toàn bộ logs của máy này
        await env.DB.prepare(`
          UPDATE logs 
          SET fullName = ?, username = ?, userId = ?, licenseKey = ?
          WHERE hwid = ?
        `).bind(target.fullName, target.username, target.id, target.licenseKey || target.fullName, hwid).run();

        return jsonRes({
          ok: true,
          message: `Đã liên kết máy [${hwid.length > 14 ? hwid.substring(0, 10) + '...' : hwid}] cho nhân viên [${target.fullName}]!`,
        });
      } catch (e) {
        return jsonRes({ ok: false, message: e.message }, 500);
      }
    }

    // 2.10 POST /api/admin/machine/delete (Xóa máy HWID)
    if (pathname === "/api/admin/machine/delete" && request.method === "POST") {
      try {
        const authUser = await getAuthenticatedUser(request, env);
        if (!authUser || authUser.role !== "Quản trị viên") {
          return jsonRes({ ok: false, message: "Chỉ Quản trị viên mới có quyền xóa máy." }, 403);
        }
        const body = await request.json();
        const hwid = (body.hwid || "").trim();
        if (!hwid) return jsonRes({ ok: false, message: "Thiếu mã máy HWID." }, 400);

        await env.DB.prepare("DELETE FROM hwids WHERE hwid = ?").bind(hwid).run();
        await env.DB.prepare("UPDATE users SET hwid = '' WHERE hwid = ?").bind(hwid).run();

        return jsonRes({
          ok: true,
          message: `Đã xóa thiết bị [${hwid}] thành công khỏi hệ thống!`
        });
      } catch (e) {
        return jsonRes({ ok: false, message: e.message }, 500);
      }
    }

    // ========================================================================
    // PHẦN 3: TELEMETRY & GIÁM SÁT LỊCH SỬ TẢI NHẠC
    // ========================================================================

    // 3.1 POST /api/telemetry/log (Ghi nhận từ C# App)
    if (pathname === "/api/telemetry/log" && request.method === "POST") {
      try {
        const payload = await request.json();
        const hwid = (payload.hwid || "").trim() || "UNKNOWN_HWID";
        const licenseKey = (payload.licenseKey || "").trim() || "Free / Trial";
        const rawRole = (payload.role || "").trim().toLowerCase();
        const role = (rawRole === "admin" || licenseKey.toLowerCase().includes("admin")) ? "Admin" : "Nhân viên";
        const appVersion = (payload.appVersion || "3.2").trim();
        const items = Array.isArray(payload.items) ? payload.items : [];

        // Kiểm tra xem máy hoặc key có bị admin chặn không
        const blockedUser = await env.DB.prepare(
          "SELECT id FROM users WHERE status = 'blocked' AND (hwid = ? OR licenseKey = ?)"
        ).bind(hwid, licenseKey).first();

        if (blockedUser) {
          return jsonRes({
            ok: false,
            blocked: true,
            message: "Thiết bị hoặc tài khoản của bạn đã bị Quản trị viên khóa. Không thể tải nhạc!",
          }, 403);
        }

        if (items.length === 0) {
          return jsonRes({ ok: true, message: "Không có bài hát để ghi nhận." });
        }

        const nowIso = new Date().toISOString();
        const vnTime = getVnTime();

        // Tự động nhận diện danh tính thiết bị / người dùng
        const machineName = (payload.machineName || "").trim();
        const windowsUser = (payload.windowsUser || "").trim();
        const sunoUser = (payload.sunoUser || "").trim();
        const sunoEmail = (payload.sunoEmail || "").trim();

        // 1. Tìm nhân viên sở hữu máy (HWID) hoặc licenseKey đã được gán chính thức trong bảng users hoặc hwids
        let ownerUser = null;
        if (hwid && hwid !== "UNKNOWN_HWID") {
          ownerUser = await env.DB.prepare("SELECT id, username, fullName, licenseKey FROM users WHERE hwid = ? AND hwid != ''").bind(hwid).first();
        }
        if (!ownerUser && licenseKey && licenseKey !== "Free / Trial" && !licenseKey.startsWith("DESKTOP-")) {
          ownerUser = await env.DB.prepare("SELECT id, username, fullName, licenseKey FROM users WHERE licenseKey = ? AND licenseKey != ''").bind(licenseKey).first();
        }
        if (!ownerUser && hwid) {
          const m = await env.DB.prepare("SELECT username, fullName, licenseKey FROM hwids WHERE hwid = ? AND fullName != '' AND fullName != 'Suno Client'").bind(hwid).first();
          if (m) ownerUser = m;
        }

        // Tự động suy luận danh tính nếu chưa có nhân viên được gán
        let autoName = "";
        let autoUsername = "";

        if (sunoUser) {
          autoName = sunoUser;
          autoUsername = sunoUser;
        } else if (sunoEmail) {
          autoName = sunoEmail.split('@')[0];
          autoUsername = sunoEmail;
        } else if (windowsUser && machineName) {
          autoName = `${windowsUser} (${machineName})`;
          autoUsername = windowsUser;
        } else if (windowsUser) {
          autoName = windowsUser;
          autoUsername = windowsUser;
        } else if (machineName) {
          autoName = machineName;
          autoUsername = machineName;
        } else {
          autoName = "Khách Suno";
          autoUsername = "client";
        }

        const finalName = ownerUser?.fullName || autoName;
        const finalUsername = ownerUser?.username || autoUsername;
        const finalKey = ownerUser?.licenseKey || (licenseKey.startsWith("DESKTOP-") ? (machineName || "Suno Client") : licenseKey);

        // Lưu / cập nhật HWID
        await env.DB.prepare(`
          INSERT INTO hwids (hwid, licenseKey, username, fullName, role, registeredAt, lastSeen)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(hwid) DO UPDATE SET
            licenseKey = CASE WHEN excluded.licenseKey != '' THEN excluded.licenseKey ELSE hwids.licenseKey END,
            username = CASE WHEN hwids.username = '' OR hwids.username IS NULL OR hwids.username = 'client' THEN excluded.username ELSE hwids.username END,
            fullName = CASE WHEN hwids.fullName = '' OR hwids.fullName IS NULL OR hwids.fullName = 'Suno Client' OR hwids.fullName = 'Khách Suno' THEN excluded.fullName ELSE hwids.fullName END,
            lastSeen = excluded.lastSeen,
            role = CASE WHEN hwids.role != '' THEN hwids.role ELSE excluded.role END
        `).bind(hwid, finalKey, finalUsername, finalName, role, vnTime, vnTime).run();

        // Batch insert logs kèm hỗ trợ fallback cho các thuộc tính bị làm rối
        const insertStmt = env.DB.prepare(`
          INSERT INTO logs (hwid, licenseKey, userId, username, fullName, clipId, title, prompt, tags, actionType, appVersion, timeVn, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const batch = items.map(item => {
          const rawTitle = (item.title || item.a || "").trim();
          const rawPrompt = (item.prompt || item.B || item.b || "").trim();
          const rawClipId = (item.clipId || item.A || "").trim();
          const rawTags = (item.tags || item.Tags || "").trim();
          const rawAction = (item.actionType || item.C || "MP3").trim();
          const rawTime = item.timestamp || item.c || nowIso;

          return insertStmt.bind(
            hwid,
            finalKey,
            ownerUser?.id || "",
            finalUsername,
            finalName,
            rawClipId,
            rawTitle || "Chưa có tên bài",
            rawPrompt,
            rawTags,
            rawAction || "MP3",
            appVersion,
            vnTime,
            rawTime
          );
        });

        await env.DB.batch(batch);

        // Bắn Telegram thông báo ngầm kèm thông tin danh tính đã nhận diện
        const alertPayload = { ...payload, resolvedName: finalName, resolvedUsername: finalUsername };
        ctx.waitUntil(sendTelegramAlert(env, alertPayload, items, vnTime));

        return jsonRes({
          ok: true,
          message: `Đã ghi nhận thành công ${items.length} bài hát cho ${finalName}.`,
          recorded: items.length,
        });
      } catch (err) {
        return jsonRes({ ok: false, message: "Lỗi ghi log: " + err.message }, 500);
      }
    }

    // 3.2 GET /api/admin/data (Lấy thống kê & lịch sử)
    if (pathname === "/api/admin/data" && request.method === "GET") {
      const authUser = await getAuthenticatedUser(request, env);
      if (!authUser) {
        return jsonRes({ ok: false, message: "Vui lòng đăng nhập để xem dữ liệu." }, 401);
      }

      // Nhân viên không được xem lịch sử
      if (authUser.role !== "Quản trị viên") {
        return jsonRes({
          ok: true,
          storageMode: "Cloudflare_D1",
          userRole: authUser.role,
          isRootAdmin: false,
          stats: { totalMachines: 0, totalDownloads: 0, todayDownloads: 0, totalStems: 0 },
          hwidList: [],
          logs: [],
        });
      }

      // Lấy danh sách máy kèm tên nhân viên liên kết
      const { results: hwidList } = await env.DB.prepare(`
        SELECT 
          h.*,
          COALESCE(NULLIF(h.fullName, ''), u.fullName, '') as resolvedFullName,
          COALESCE(NULLIF(h.username, ''), u.username, '') as resolvedUsername
        FROM hwids h
        LEFT JOIN users u ON (h.hwid = u.hwid AND u.hwid != '') OR (h.licenseKey = u.licenseKey AND u.licenseKey != '')
        ORDER BY h.lastSeen DESC
      `).all();

      // Lấy danh sách lịch sử tải kèm tên nhân viên đã giải mã
      const { results: logs } = await env.DB.prepare(`
        SELECT 
          l.*,
          COALESCE(NULLIF(l.fullName, ''), u.fullName, h.fullName, '') as resolvedFullName,
          COALESCE(NULLIF(l.username, ''), u.username, h.username, '') as resolvedUsername
        FROM logs l
        LEFT JOIN users u ON (l.hwid = u.hwid AND u.hwid != '') OR (l.licenseKey = u.licenseKey AND u.licenseKey != '')
        LEFT JOIN hwids h ON l.hwid = h.hwid
        ORDER BY l.id DESC LIMIT 2000
      `).all();

      const today = new Date().toISOString().substring(0, 10);
      const totalMachines = (hwidList || []).length;
      const totalDownloads = (logs || []).length;
      const totalStems = (logs || []).filter(
        l => l.actionType && l.actionType !== "MP3" && l.actionType !== "WAV"
      ).length;
      const todayDownloads = (logs || []).filter(
        l => (l.timeVn || l.createdAt || "").startsWith(today)
      ).length;

      return jsonRes({
        ok: true,
        storageMode: "Cloudflare_D1",
        userRole: authUser.role,
        isRootAdmin: Boolean(authUser.isRootAdmin),
        stats: {
          totalMachines,
          totalDownloads,
          todayDownloads,
          totalStems,
        },
        hwidList: hwidList || [],
        logs: logs || [],
      });
    }

    // 3.3 GET /api/license/role (App C# kiểm tra vai trò & trạng thái kích hoạt)
    if (pathname === "/api/license/role" && request.method === "GET") {
      const qHwid = (url.searchParams.get("hwid") || "").trim();
      const qKey = (url.searchParams.get("key") || "").trim();

      const matchedUser = await env.DB.prepare(
        "SELECT * FROM users WHERE (hwid = ? AND hwid != '') OR (licenseKey = ? AND licenseKey != '')"
      ).bind(qHwid, qKey).first();

      if (matchedUser) {
        return jsonRes({
          ok: true,
          hwid: qHwid,
          role: matchedUser.role === "Quản trị viên" ? "Admin" : "Nhân viên",
          customerName: matchedUser.fullName,
          isBlocked: matchedUser.status === "blocked",
          licensedUntil: matchedUser.licensedUntil,
          allowedTools: JSON.parse(matchedUser.allowedTools || "[]"),
        });
      }

      const hwidRow = await env.DB.prepare("SELECT * FROM hwids WHERE hwid = ?").bind(qHwid).first();
      return jsonRes({
        ok: true,
        hwid: qHwid,
        role: hwidRow?.role || "Nhân viên",
        customerName: hwidRow?.fullName || "Khách",
        isBlocked: false,
        licensedUntil: null,
        allowedTools: [],
      });
    }

    // 3.4 POST / GET /api/verify hoặc /verify (Xác thực & Kích hoạt bản quyền trực tiếp từ App C#)
    if ((pathname === "/api/verify" || pathname === "/verify") && (request.method === "POST" || request.method === "GET")) {
      try {
        let body = {};
        if (request.method === "POST") {
          try { body = await request.json(); } catch {}
        } else {
          url.searchParams.forEach((v, k) => { body[k] = v; });
        }

        const action = (body.action || "verify").toLowerCase();
        const hwid = (body.hwid || "").trim();
        const key = (body.key || body.licenseKey || "").trim();
        const machineName = (body.name || body.machineName || "").trim();
        const secretSalt = "Suno_Bulk_Downloader_Secure_Salt_2026_@99#";

        if (!hwid) {
          return jsonRes({ ok: false, status: "error", message: "Thiếu mã máy HWID." }, 400);
        }

        const vnTime = getVnTime();

        // ── 1. KÍCH HOẠT VỚI KEY (action === 'activate' HOẶC có truyền key) ──
        if (action === "activate" || key) {
          // A. Master Admin Key
          if (key.toUpperCase() === "FIKAT-ADMIN-2026-VIP") {
            const expires = "Forever";
            const token = await computeHmacSha256(`${hwid}:active:${expires}`, secretSalt);
            await env.DB.prepare(`
              INSERT INTO hwids (hwid, licenseKey, username, fullName, role, registeredAt, lastSeen)
              VALUES (?, ?, 'fikat', 'Quản trị viên (Master)', 'Admin', ?, ?)
              ON CONFLICT(hwid) DO UPDATE SET role = 'Admin', fullName = 'Quản trị viên (Master)', lastSeen = excluded.lastSeen
            `).bind(hwid, key, vnTime, vnTime).run();

            return jsonRes({
              ok: true,
              status: "active",
              customer: "Quản trị viên (Master)",
              role: "Admin",
              expires: expires,
              token: token,
              message: "Kích hoạt bản quyền Quản trị viên vĩnh viễn thành công!"
            });
          }

          // B. Tìm user trong bảng users theo licenseKey (không phân biệt hoa/thường)
          let user = await env.DB.prepare(
            "SELECT * FROM users WHERE UPPER(licenseKey) = UPPER(?) AND licenseKey != ''"
          ).bind(key).first();

          // C. Nếu không thấy trong users, thử tìm trong hwids
          if (!user) {
            const hwRow = await env.DB.prepare(
              "SELECT * FROM hwids WHERE UPPER(licenseKey) = UPPER(?) AND licenseKey != ''"
            ).bind(key).first();

            if (hwRow) {
              user = {
                id: "",
                fullName: hwRow.fullName || "Nhân viên",
                username: hwRow.username || "staff",
                role: hwRow.role || "Nhân viên",
                status: "active",
                licensedUntil: null
              };
            }
          }

          if (!user) {
            return jsonRes({
              ok: false,
              status: "invalid",
              message: `Mã kích hoạt [${key}] không tồn tại trên hệ thống hoặc chưa được cấp!`
            });
          }

          if (user.status === "blocked") {
            return jsonRes({
              ok: false,
              status: "blocked",
              message: "Tài khoản hoặc key này đã bị Quản trị viên khóa truy cập!"
            });
          }

          // Kiểm tra hạn sử dụng
          let expires = "Forever";
          let daysRemaining = 9999;
          if (user.licensedUntil) {
            const expDate = new Date(user.licensedUntil);
            if (expDate.getFullYear() < 2090) {
              expires = user.licensedUntil.substring(0, 10);
              daysRemaining = Math.ceil((expDate.getTime() - Date.now()) / (24 * 3600 * 1000));
              if (daysRemaining < 0) {
                return jsonRes({
                  ok: false,
                  status: "expired",
                  message: `Key bản quyền đã hết hạn vào ngày ${expires}. Vui lòng liên hệ Admin gia hạn!`
                });
              }
            }
          }

          // Gán HWID của máy khách cho tài khoản này và cập nhật bảng hwids
          if (user.id) {
            await env.DB.prepare("UPDATE users SET hwid = ?, updatedAt = ? WHERE id = ?")
              .bind(hwid, vnTime, user.id).run();
          }

          const userRole = user.role === "Quản trị viên" ? "Admin" : "Staff";
          await env.DB.prepare(`
            INSERT INTO hwids (hwid, licenseKey, username, fullName, role, registeredAt, lastSeen)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(hwid) DO UPDATE SET
              licenseKey = excluded.licenseKey,
              username = excluded.username,
              fullName = excluded.fullName,
              role = excluded.role,
              lastSeen = excluded.lastSeen
          `).bind(hwid, key, user.username, user.fullName, userRole, vnTime, vnTime).run();

          const token = await computeHmacSha256(`${hwid}:active:${expires}`, secretSalt);

          return jsonRes({
            ok: true,
            status: "active",
            customer: user.fullName || user.username || "Nhân viên",
            role: userRole,
            expires: expires,
            daysRemaining: daysRemaining,
            token: token,
            message: `Kích hoạt bản quyền thành công cho ${user.fullName || user.username}!`
          });
        }

        // ── 2. XÁC THỰC TỰ ĐỘNG BẰNG HWID (verify / register) ──
        let boundUser = await env.DB.prepare(
          "SELECT * FROM users WHERE hwid = ? AND hwid != ''"
        ).bind(hwid).first();

        let hwidInfo = await env.DB.prepare("SELECT * FROM hwids WHERE hwid = ?").bind(hwid).first();

        if (!boundUser && hwidInfo?.licenseKey) {
          boundUser = await env.DB.prepare(
            "SELECT * FROM users WHERE licenseKey = ? AND licenseKey != ''"
          ).bind(hwidInfo.licenseKey).first();
        }

        if (boundUser) {
          if (boundUser.status === "blocked") {
            return jsonRes({
              ok: false,
              status: "blocked",
              message: "Thiết bị của bạn đã bị Quản trị viên khóa truy cập."
            });
          }

          let expires = "Forever";
          let daysRemaining = 9999;
          if (boundUser.licensedUntil) {
            const expDate = new Date(boundUser.licensedUntil);
            if (expDate.getFullYear() < 2090) {
              expires = boundUser.licensedUntil.substring(0, 10);
              daysRemaining = Math.ceil((expDate.getTime() - Date.now()) / (24 * 3600 * 1000));
              if (daysRemaining < 0) {
                return jsonRes({
                  ok: false,
                  status: "expired",
                  customer: boundUser.fullName,
                  expires: expires,
                  message: `Bản quyền đã hết hạn vào ngày ${expires}. Vui lòng liên hệ Admin gia hạn!`
                });
              }
            }
          }

          const userRole = boundUser.role === "Quản trị viên" ? "Admin" : "Staff";
          const token = await computeHmacSha256(`${hwid}:active:${expires}`, secretSalt);

          await env.DB.prepare("UPDATE hwids SET lastSeen = ? WHERE hwid = ?").bind(vnTime, hwid).run();

          return jsonRes({
            ok: true,
            status: "active",
            customer: boundUser.fullName || boundUser.username,
            role: userRole,
            expires: expires,
            daysRemaining: daysRemaining,
            token: token,
            message: `Bản quyền hợp lệ: ${boundUser.fullName || boundUser.username}`
          });
        }

        // Chưa kích hoạt: ghi nhận vào hwids và trả về pending
        await env.DB.prepare(`
          INSERT INTO hwids (hwid, licenseKey, username, fullName, role, registeredAt, lastSeen)
          VALUES (?, '', 'client', ?, 'Nhân viên', ?, ?)
          ON CONFLICT(hwid) DO UPDATE SET lastSeen = excluded.lastSeen
        `).bind(hwid, machineName ? `Khách (${machineName})` : 'Khách', vnTime, vnTime).run();

        return jsonRes({
          ok: true,
          status: "pending",
          hwid: hwid,
          message: "Mã máy của bạn đã được gửi lên hệ thống. Vui lòng chờ Admin kích hoạt hoặc nhập Key được cấp."
        });
      } catch (err) {
        return jsonRes({ ok: false, status: "error", message: "Lỗi xác thực: " + err.message }, 500);
      }
    }

    // 3.8.1 GET/POST /api/video-tracker/scan-channel - Quét 100% toàn bộ video của từng kênh riêng lẻ và làm sạch dữ liệu
    if (pathname === "/api/video-tracker/scan-channel" && (request.method === "POST" || request.method === "GET")) {
      try {
        const chId = url.searchParams.get("channel_id");
        if (!chId) return jsonRes({ ok: false, message: "Thiếu channel_id" }, 400);

        const chRows = await queryTursoWorker("SELECT * FROM channels WHERE id = ?", [chId]);
        if (!chRows || !chRows.length) return jsonRes({ ok: false, message: "Không tìm thấy kênh" }, 404);
        const ch = chRows[0];

        // 1. Quét TOÀN BỘ video public của kênh (maxPages=8 đủ quét đến 240 video, bao phủ 100% video của kênh)
        let vids = await scanChannelPublicVideos(ch.custom_id, 8);

        // 2. Fallback sang RSS nếu cào public trả về rỗng
        if (!vids || !vids.length) {
          const cid = CHANNEL_CID_MAP[ch.id] || (ch.custom_id.startsWith('UC') ? ch.custom_id : null);
          if (cid) vids = await fetchChannelRssVideos(cid);
        }

        const vnNow = new Date(Date.now() + 7 * 3600 * 1000);
        const minute = vnNow.getMinutes() >= 30 ? 30 : 0;
        const timeMark = `${String(vnNow.getDate()).padStart(2, '0')}/${String(vnNow.getMonth() + 1).padStart(2, '0')}/${vnNow.getFullYear()} ${String(vnNow.getHours()).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        const isoNow = vnNow.toISOString().replace("T", " ").substring(0, 19);

        // 3. Lấy dữ liệu video hiện tại từ DB để đối soát và khử nhiễu (Data Quality Control)
        const existingVidRows = await queryTursoWorker(
          "SELECT id, title, views, prev_views, delta_views FROM video_items WHERE channel_id = ?",
          [ch.id]
        );
        const existingMap = {};
        (existingVidRows || []).forEach(ev => { existingMap[ev.id] = ev; });

        // 4. Làm sạch dữ liệu chuyên sâu qua DataSanitizer
        const cleanedVids = [];
        for (const raw of vids) {
          const cv = DataSanitizer.cleanVideo(raw, existingMap[raw.id], ch.id);
          if (cv) cleanedVids.push(cv);
        }

        // 5. Lưu chi tiết video vào DB bằng 1 BATCH DUY NHẤT
        // Lưu ý: Sử dụng delta_views đã được chuẩn hoá qua DataSanitizer, không ghi đè mất delta dương đã có trước đó
        if (cleanedVids.length > 0) {
          const batchStmts = cleanedVids.map(v => ({
            sql: `
              INSERT INTO video_items (id, channel_id, title, views, prev_views, delta_views, published_time, last_scraped_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                prev_views = CASE 
                  WHEN video_items.prev_views IS NULL OR video_items.prev_views = 0 THEN video_items.views
                  ELSE video_items.prev_views 
                END,
                delta_views = CASE 
                  WHEN excluded.delta_views > 0 THEN excluded.delta_views
                  ELSE video_items.delta_views 
                END,
                views = CASE WHEN excluded.views > video_items.views THEN excluded.views ELSE video_items.views END,
                title = CASE WHEN excluded.title != '' THEN excluded.title ELSE video_items.title END,
                last_scraped_at = excluded.last_scraped_at
            `,
            args: [v.id, ch.id, v.title || '', v.views || 0, v.prev_views || 0, v.delta_views || 0, v.time || '', isoNow]
          }));
          await executeTursoBatch(batchStmts);
        }

        // 6. ĐỌC LẠI TỔNG SỐ VIDEO VÀ TỔNG VIEWS TỪ TOÀN BỘ BẢNG video_items
        const statRows = await queryTursoWorker(`
          SELECT count(*) as cnt, sum(views) as tot_views FROM video_items WHERE channel_id = ?
        `, [ch.id]);

        const videoCount = (statRows && statRows.length && parseInt(statRows[0].cnt)) || cleanedVids.length;
        const totalVideoViews = (statRows && statRows.length && parseInt(statRows[0].tot_views)) || 0;

        // Lấy video tăng view nhiều nhất trong kênh
        const topGainRows = await queryTursoWorker(`
          SELECT title, delta_views FROM video_items WHERE channel_id = ? AND delta_views > 0 ORDER BY delta_views DESC LIMIT 1
        `, [ch.id]);
        // Lấy thông tin tăng view trong video_items
        const gainRows = await queryTursoWorker(`
          SELECT sum(delta_views) as gained FROM video_items WHERE channel_id = ?
        `, [ch.id]);
        let rawDelta = (gainRows && gainRows.length && parseInt(gainRows[0].gained)) || 0;

        return jsonRes({
          ok: true,
          channel_id: ch.id,
          channel_title: ch.title,
          video_count: videoCount,
          total_views: totalVideoViews,
          delta_views: rawDelta,
          top_growing_video: topVid.title || '',
          timeMark
        });
      } catch (err) {
        return jsonRes({ ok: false, message: err.message }, 500);
      }
    }

    // 3.8 GET/POST /api/video-tracker/snapshot - Kích hoạt quét video 30 phút thủ công
    if (pathname === "/api/video-tracker/snapshot" && (request.method === "POST" || request.method === "GET")) {
      try {
        const result = await run30mVideoSnapshotJob(env);
        return jsonRes(result);
      } catch (err) {
        return jsonRes({ ok: false, message: "Lỗi quét video: " + err.message }, 500);
      }
    }

    // 3.9 GET /api/video-tracker/videos - Lấy danh sách video của 1 kênh kèm số liệu YouTube API v3 thời gian thực
    if (pathname === "/api/video-tracker/videos" && request.method === "GET") {
      try {
        const chId = url.searchParams.get("channel_id");
        if (!chId) return jsonRes({ ok: false, message: "Thiếu channel_id" }, 400);

        const rows = await queryTursoWorker(`
          SELECT * FROM video_items WHERE channel_id = ? ORDER BY views DESC
        `, [chId]);

        if (!rows || !rows.length) return jsonRes({ ok: true, videos: [] });

        const activeKeys = await getActiveYtApiKeys(env);
        if (activeKeys && activeKeys.length > 0) {
          try {
            const vids = rows.map(r => r.id);
            const apiResults = await fetchExactViewsFromYtApi(vids, activeKeys);
            if (apiResults && Object.keys(apiResults).length > 0) {
              const updates = [];
              const isoNow = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace("T", " ").substring(0, 19);
              for (const r of rows) {
                const liveViews = apiResults[r.id];
                if (liveViews !== undefined && liveViews !== null && liveViews > 0) {
                  const prev = parseInt(r.prev_views) || parseInt(r.views) || liveViews;
                  const delta = Math.max(0, liveViews - prev);
                  r.views = liveViews;
                  r.delta_views = delta;
                  if (delta > 0 || !r.last_delta_30m || r.last_delta_30m === '0') {
                    r.last_delta_30m = delta;
                  }
                  updates.push({
                    sql: `UPDATE video_items SET views = ?, delta_views = ?, last_delta_30m = CASE WHEN ? > 0 THEN ? ELSE last_delta_30m END, last_scraped_at = ? WHERE id = ?`,
                    args: [liveViews, delta, delta, delta, isoNow, r.id]
                  });
                }
              }
              if (updates.length > 0) {
                executeTursoBatch(updates).catch(e => console.warn("Turso async video update error:", e.message));
              }
            }
          } catch (apiErr) {
            console.warn("Live API channel fetch error:", apiErr.message);
          }
        }

        return jsonRes({ ok: true, videos: rows });
      } catch (err) {
        return jsonRes({ ok: false, message: err.message }, 500);
      }
    }

    // 3.10 QUẢN LÝ YOUTUBE DATA API KEYS (MULTI-KEY POOL & FAILOVER)
    // 3.10.1 GET /api/youtube-keys - Danh sách keys
    if (pathname === "/api/youtube-keys" && request.method === "GET") {
      try {
        const rows = await queryTursoWorker(
          "SELECT id, service, key_value, label, quota_used, quota_limit, is_active, last_error, last_used_at, created_at FROM api_keys WHERE service = 'youtube' ORDER BY is_active DESC, id ASC"
        );
        const keys = (rows || []).map(r => {
          const raw = r.key_value || '';
          const masked = raw.length > 12 ? `${raw.slice(0, 8)}...${raw.slice(-4)}` : raw;
          return {
            id: r.id,
            key_value: raw,
            masked_key: masked,
            label: r.label || 'YouTube API Key',
            quota_used: parseInt(r.quota_used) || 0,
            quota_limit: parseInt(r.quota_limit) || 10000,
            is_active: parseInt(r.is_active) === 1,
            last_error: r.last_error || '',
            last_used_at: r.last_used_at || '',
            created_at: r.created_at || ''
          };
        });
        return jsonRes({ ok: true, keys, total: keys.length, active: keys.filter(k => k.is_active).length });
      } catch (err) {
        return jsonRes({ ok: false, message: err.message }, 500);
      }
    }

    // 3.10.2 POST /api/youtube-keys - Thêm một hoặc nhiều keys
    if (pathname === "/api/youtube-keys" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        let rawInput = body.keys || body.key || '';
        let keyList = [];
        if (Array.isArray(rawInput)) {
          keyList = rawInput;
        } else if (typeof rawInput === 'string') {
          keyList = rawInput.split(/[\r\n,;]+/).map(s => s.trim()).filter(Boolean);
        }

        if (!keyList.length) {
          return jsonRes({ ok: false, message: "Vui lòng nhập ít nhất một API Key hợp lệ." }, 400);
        }

        const label = (body.label || '').trim();
        const isoNow = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace("T", " ").substring(0, 19);
        const batch = [];

        for (const k of keyList) {
          const cleanK = k.trim();
          if (cleanK.length < 15) continue;
          batch.push({
            sql: `
              INSERT INTO api_keys (service, key_value, label, quota_used, quota_limit, is_active, last_error, created_at)
              VALUES ('youtube', ?, ?, 0, 10000, 1, '', ?)
              ON CONFLICT(service, key_value) DO UPDATE SET
                is_active = 1,
                last_error = '',
                label = CASE WHEN excluded.label != '' THEN excluded.label ELSE api_keys.label END
            `,
            args: [cleanK, label || `Key Thêm ${isoNow.slice(11, 16)}`, isoNow]
          });
        }

        if (!batch.length) {
          return jsonRes({ ok: false, message: "Không tìm thấy key hợp lệ nào (độ dài tối thiểu 15 ký tự)." }, 400);
        }

        await executeTursoBatch(batch);
        return jsonRes({ ok: true, message: `Đã lưu thành công ${batch.length} API Key vào hệ thống.`, addedCount: batch.length });
      } catch (err) {
        return jsonRes({ ok: false, message: "Lỗi lưu key: " + err.message }, 500);
      }
    }

    // 3.10.3 POST /api/youtube-keys/toggle - Bật/Tắt trạng thái hoạt động của key
    if (pathname === "/api/youtube-keys/toggle" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const keyId = body.id;
        const keyValue = body.key_value;
        if (!keyId && !keyValue) return jsonRes({ ok: false, message: "Thiếu id hoặc key_value" }, 400);

        const row = await queryTursoWorker("SELECT is_active FROM api_keys WHERE id = ? OR key_value = ?", [keyId || 0, keyValue || '']);
        if (!row || !row.length) return jsonRes({ ok: false, message: "Không tìm thấy key" }, 404);

        const currentActive = parseInt(row[0].is_active) === 1;
        const newActive = currentActive ? 0 : 1;
        await queryTursoWorker("UPDATE api_keys SET is_active = ?, last_error = '' WHERE id = ? OR key_value = ?", [newActive, keyId || 0, keyValue || '']);
        return jsonRes({ ok: true, is_active: newActive === 1, message: newActive === 1 ? "Đã kích hoạt key" : "Đã tạm dừng key" });
      } catch (err) {
        return jsonRes({ ok: false, message: err.message }, 500);
      }
    }

    // 3.10.4 DELETE /api/youtube-keys - Xoá key
    if (pathname === "/api/youtube-keys" && request.method === "DELETE") {
      try {
        const keyId = url.searchParams.get("id");
        const keyValue = url.searchParams.get("key_value");
        if (!keyId && !keyValue) return jsonRes({ ok: false, message: "Thiếu id hoặc key_value" }, 400);

        await queryTursoWorker("DELETE FROM api_keys WHERE id = ? OR key_value = ?", [keyId || 0, keyValue || '']);
        return jsonRes({ ok: true, message: "Đã xoá API key thành công khỏi hệ thống" });
      } catch (err) {
        return jsonRes({ ok: false, message: err.message }, 500);
      }
    }

    // 3.10.5 POST /api/youtube-keys/test - Kiểm tra tính hợp lệ & quota của keys
    if (pathname === "/api/youtube-keys/test" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        let keysToTest = [];
        if (body.key_value) {
          keysToTest = [{ id: body.id, key_value: body.key_value, label: body.label || '' }];
        } else {
          const rows = await queryTursoWorker("SELECT id, key_value, label FROM api_keys WHERE service = 'youtube'");
          keysToTest = rows || [];
        }

        const testResults = [];
        for (const k of keysToTest) {
          const kv = (k.key_value || '').trim();
          const masked = kv.length > 12 ? `${kv.slice(0, 8)}...${kv.slice(-4)}` : kv;
          // Test qua video ID công khai phổ biến
          const testUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=Ks-_Mh1QhMc&key=${kv}&fields=items(id,statistics/viewCount)`;
          try {
            const resp = await fetch(testUrl);
            if (resp.ok) {
              const resJson = await resp.json();
              if (resJson.items && resJson.items.length > 0) {
                await queryTursoWorker(
                  "UPDATE api_keys SET is_active = 1, last_error = '', last_used_at = datetime('now') WHERE key_value = ?",
                  [kv]
                );
                testResults.push({ id: k.id, key_value: kv, masked, status: 'valid', ok: true, message: 'Hoạt động tốt (Quota còn đủ)' });
                continue;
              }
            }

            const errBody = await resp.text().catch(() => '');
            let reason = `HTTP ${resp.status}`;
            let isQuota = false;
            if (resp.status === 403 && (errBody.includes('quotaExceeded') || errBody.includes('dailyLimitExceeded'))) {
              reason = 'Hết Quota ngày (quotaExceeded)';
              isQuota = true;
            } else if (resp.status === 400 && errBody.includes('keyInvalid')) {
              reason = 'API Key không hợp lệ / không tồn tại';
            } else if (resp.status === 403 && errBody.includes('accessNotConfigured')) {
              reason = 'Chưa kích hoạt YouTube Data API v3 trên Google Cloud';
            }

            await queryTursoWorker(
              "UPDATE api_keys SET is_active = 0, last_error = ?, last_used_at = datetime('now') WHERE key_value = ?",
              [reason, kv]
            );
            testResults.push({ id: k.id, key_value: kv, masked, status: isQuota ? 'quota_exceeded' : 'error', ok: false, message: reason });
          } catch (fetchErr) {
            testResults.push({ id: k.id, key_value: kv, masked, status: 'error', ok: false, message: fetchErr.message });
          }
        }

        return jsonRes({ ok: true, results: testResults });
      } catch (err) {
        return jsonRes({ ok: false, message: err.message }, 500);
      }
    }

    // 3.10.6 POST /api/youtube-keys/reset-all - Đặt lại tất cả keys về Active
    if (pathname === "/api/youtube-keys/reset-all" && request.method === "POST") {
      try {
        await queryTursoWorker("UPDATE api_keys SET is_active = 1, quota_used = 0, last_error = '' WHERE service = 'youtube'");
        return jsonRes({ ok: true, message: "Đã reset toàn bộ API keys về trạng thái Hoạt động (Active)." });
      } catch (err) {
        return jsonRes({ ok: false, message: err.message }, 500);
      }
    }

    // ========================================================================
    // PHẦN 4: STATIC ASSETS
    // ========================================================================
    try {
      const response = await env.ASSETS.fetch(request);
      if (response.status === 404 && !url.pathname.includes(".")) {
        return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
      }
      return response;
    } catch (err) {
      return new Response("Asset fetch error: " + err.message, { status: 500 });
    }
  },

  // Cron định kỳ 30 phút: Tự động quét tổng view video public của các kênh
  async scheduled(event, env, ctx) {
    const vnNow = new Date(Date.now() + 7 * 3600 * 1000);
    // 1. Chốt snapshot ngày lúc 06:00 AM VN
    if (vnNow.getHours() === 6 && vnNow.getMinutes() < 30) {
      try {
        await runDailySnapshotJob(env);
      } catch (e) {
        console.error("Daily snapshot job error:", e);
      }
    }
    // 2. Quét real-time video 30 phút
    try {
      await run30mVideoSnapshotJob(env);
    } catch (e) {
      console.error("30m snapshot job error:", e);
    }
  },
};

// ============================================================================
// HELPERS & AUTOMATED CRON JOBS
// ============================================================================

async function fetchYouTubeChannelData(inputRef) {
  let targetUrl = inputRef;
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    if (targetUrl.startsWith("@")) targetUrl = `https://www.youtube.com/${targetUrl}`;
    else if (targetUrl.startsWith("UC") && targetUrl.length >= 24) targetUrl = `https://www.youtube.com/channel/${targetUrl}`;
    else targetUrl = `https://www.youtube.com/@${targetUrl}`;
  }
  targetUrl = targetUrl.replace(/\/$/, "");
  const aboutUrl = targetUrl.endsWith("/about") ? targetUrl : `${targetUrl}/about`;

  const ytResp = await fetch(aboutUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9,vi;q=0.8"
    }
  });

  if (!ytResp.ok) {
    throw new Error(`YouTube phản hồi HTTP ${ytResp.status}`);
  }

  const html = await ytResp.text();

  // 1. Channel ID
  let cid = "";
  const mCid = html.match(/itemprop="channelId"\s+content="([^"]+)"/) || html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
  if (mCid) cid = mCid[1];

  // 2. Default Title & Avatar from meta
  let title = "";
  const mTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
  if (mTitle) title = mTitle[1].replace(" - YouTube", "").trim();

  let avatar = "";
  const mAvatar = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
  if (mAvatar) avatar = mAvatar[1];

  let subs = 0;
  let views = 0;
  let videos = 0;

  function findChannelViews(obj) {
    if (!obj || typeof obj !== "object") return 0;
    if (obj.aboutChannelViewModel && obj.aboutChannelViewModel.viewCountText) {
      return parseYtStat(obj.aboutChannelViewModel.viewCountText);
    }
    for (const key of Object.keys(obj)) {
      const found = findChannelViews(obj[key]);
      if (found) return found;
    }
    return 0;
  }

  // 3. Parse ytInitialData JSON for modern YouTube (2024–2026)
  const mData = html.match(/var ytInitialData = ({.*?});<\/script>/);
  if (mData) {
    try {
      const data = JSON.parse(mData[1]);
      const phVm = data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel;
      if (phVm) {
        const dynTitle = phVm?.title?.dynamicTextViewModel?.text?.content;
        if (dynTitle) title = dynTitle;

        const avatarSources = phVm?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources;
        if (Array.isArray(avatarSources) && avatarSources.length > 0) {
          avatar = avatarSources[avatarSources.length - 1].url || avatar;
        }

        const rows = phVm?.metadata?.contentMetadataViewModel?.metadataRows || [];
        for (const r of rows) {
          for (const p of r?.metadataParts || []) {
            const text = (p?.text?.content || "").toLowerCase().trim();
            if (text.includes("subscriber") || text.includes("người đăng ký")) {
              subs = parseYtStat(text);
            } else if (text.includes("video")) {
              videos = parseYtStat(text);
            }
          }
        }
      }
      views = findChannelViews(data);
    } catch (jsonErr) {
      console.warn("ytInitialData parse error:", jsonErr);
    }
  }

  // 4. Fallbacks
  if (!subs) {
    const mSub = html.match(/"subscriberCountText":\{.*?"simpleText":"([^"]+)"/) || html.match(/([\d.,]+(?:\s*[mktrb])?)\s*(?:subscribers|người đăng ký)/i);
    if (mSub) subs = parseYtStat(mSub[1]);
  }
  if (!videos) {
    const mVid = html.match(/"videoCountText":\{.*?"text":"([^"]+)"/) || html.match(/([\d.,]+)\s*videos/i);
    if (mVid) videos = parseYtStat(mVid[1]);
  }
  if (!views) {
    const mView = html.match(/"viewCountText":\{.*?"simpleText":"([^"]+)"/) || html.match(/"viewCountText":\{"runs":\[\{"text":"([^"]+)"/);
    if (mView) views = parseYtStat(mView[1]);
  }

  // 5. Continuation Token Fallback (YouTube About Panel modal API)
  if (!views) {
    const tokens = Array.from(html.matchAll(/"continuationCommand":\{"token":"([^"]+)"/g)).map(m => m[1]);
    for (const t of tokens.slice(0, 4)) {
      try {
        const contRes = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          body: JSON.stringify({
            context: { client: { clientName: 'WEB', clientVersion: '2.20240901.01.00', hl: 'vi', gl: 'VN' } },
            continuation: t
          })
        });
        const contData = await contRes.json();
        const vFound = findChannelViews(contData);
        if (vFound && vFound > 0) {
          views = vFound;
          break;
        }
      } catch (e) {
        // ignore and try next token
      }
    }
  }

  return {
    id: cid || `custom_${Date.now()}`,
    title: title || inputRef,
    avatar: avatar || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120",
    subscribers: subs,
    views_all: views,
    video_count: videos,
    url: targetUrl
  };
}

async function queryTursoWorker(sql, args = []) {
  const payload = {
    requests: [
      {
        type: "execute",
        stmt: {
          sql: sql,
          args: args.map(a => {
            if (typeof a === 'number') return { type: Number.isInteger(a) ? "integer" : "float", value: String(a) };
            if (a === null || a === undefined) return { type: "null" };
            return { type: "text", value: String(a) };
          })
        }
      },
      { type: "close" }
    ]
  };

  const res = await fetch(TURSO_URL, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + TURSO_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!data.results || !data.results[0] || !data.results[0].response) {
    throw new Error("Lỗi Turso: " + JSON.stringify(data));
  }
  const result = data.results[0].response.result;
  if (!result) return [];
  const cols = result.cols.map(c => c.name);
  return result.rows.map(row => {
    const obj = {};
    row.forEach((cell, idx) => {
      obj[cols[idx]] = cell.value;
    });
    return obj;
  });
}

async function executeTursoBatch(stmts) {
  if (!stmts || !stmts.length) return [];
  const CHUNK_SIZE = 150;
  const chunks = [];
  for (let i = 0; i < stmts.length; i += CHUNK_SIZE) {
    chunks.push(stmts.slice(i, i + CHUNK_SIZE));
  }
  const promises = chunks.map(async (chunk) => {
    const requests = chunk.map(s => ({
      type: "execute",
      stmt: {
        sql: s.sql,
        args: (s.args || []).map(a => {
          if (typeof a === 'number') return { type: Number.isInteger(a) ? "integer" : "float", value: String(a) };
          if (a === null || a === undefined) return { type: "null" };
          return { type: "text", value: String(a) };
        })
      }
    }));
    requests.push({ type: "close" });

    const res = await fetch(TURSO_URL, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + TURSO_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ requests })
    });
    return await res.json();
  });
  return await Promise.all(promises);
}


async function runDailySnapshotJob(env) {
  try {
    const vnNow = new Date(Date.now() + 7 * 3600 * 1000);
    const todayStr = `${String(vnNow.getDate()).padStart(2, '0')}/${String(vnNow.getMonth() + 1).padStart(2, '0')}/${vnNow.getFullYear()}`;
    console.log(`[Cron 06:00 AM VN] Bắt đầu chốt snapshot ngày ${todayStr}...`);

    const channels = await queryTursoWorker("SELECT * FROM channels ORDER BY id ASC");
    if (!channels || !channels.length) {
      return { ok: true, message: "Không tìm thấy kênh nào trong Turso.", count: 0, today: todayStr };
    }

    const activeKeys = await getActiveYtApiKeys(env);
    let apiChannelStats = {};
    if (activeKeys && activeKeys.length > 0) {
      const cids = Object.values(CHANNEL_CID_MAP).filter(Boolean);
      if (cids.length > 0) {
        for (const k of activeKeys) {
          try {
            const apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${cids.join(',')}&key=${k}&fields=items(id,statistics/viewCount,statistics/subscriberCount,statistics/videoCount)`;
            const apiResp = await fetch(apiUrl);
            if (apiResp.ok) {
              const apiData = await apiResp.json();
              for (const item of (apiData.items || [])) {
                apiChannelStats[item.id] = {
                  views: parseInt(item.statistics?.viewCount) || 0,
                  subs: parseInt(item.statistics?.subscriberCount) || 0,
                  vids: parseInt(item.statistics?.videoCount) || 0
                };
              }
              break;
            } else {
              const errText = await apiResp.text().catch(() => '');
              if (apiResp.status === 403 || apiResp.status === 429) {
                console.warn(`[DailyCron] Key ...${k.slice(-6)} het quota (${apiResp.status}), thu key tiep theo...`);
                continue;
              }
            }
          } catch (err) {
            console.warn(`[DailyCron] Key ...${k.slice(-6)} gap loi:`, err.message);
          }
        }
      }
    }

    // Nạp tổng view thực tế từ toàn bộ video public trong DB để làm ground truth
    const vidSumRows = await queryTursoWorker(`
      SELECT channel_id, sum(views) as total_views, count(*) as vid_count
      FROM video_items
      GROUP BY channel_id
    `);
    const vidSumMap = {};
    (vidSumRows || []).forEach(r => {
      vidSumMap[r.channel_id] = {
        views: parseInt(r.total_views) || 0,
        count: parseInt(r.vid_count) || 0
      };
    });

    let count = 0;
    for (const ch of channels) {
      let subs = parseInt(ch.subscribers) || 0;
      let views = parseInt(ch.views_all) || 0;
      let vids = parseInt(ch.video_count) || 0;

      const targetCid = CHANNEL_CID_MAP[ch.id] || (ch.custom_id.startsWith('UC') ? ch.custom_id : null);
      const apiStat = targetCid && apiChannelStats[targetCid];
      const vidStat = vidSumMap[ch.id];

      if (apiStat && apiStat.views > 0) {
        views = apiStat.views;
        if (apiStat.subs > 0) subs = apiStat.subs;
        if (apiStat.vids > 0) vids = apiStat.vids;
      } else if (vidStat && vidStat.views > 0) {
        views = Math.max(views, vidStat.views);
        if (vidStat.count > 0) vids = vidStat.count;
      }

      await queryTursoWorker(`
        UPDATE channels SET subscribers = ?, views_all = ?, video_count = ? WHERE id = ?
      `, [subs, views, vids, ch.id]);

      // Lấy snapshot trước đó theo đúng thứ tự ngày tháng lịch thực tế
      const prevSnaps = await queryTursoWorker(`
        SELECT views_all, snapshot_date, daily_views FROM snapshots 
        WHERE channel_id = ? AND snapshot_date != ? 
        ORDER BY (substr(snapshot_date, 7, 4) || '-' || substr(snapshot_date, 4, 2) || '-' || substr(snapshot_date, 1, 2)) DESC 
        LIMIT 1
      `, [ch.id, todayStr]);

      let dailyViews = 0;
      let dropViews = 0;

      if (prevSnaps.length > 0) {
        const prevViews = parseInt(prevSnaps[0].views_all) || 0;
        if (views >= prevViews) {
          dailyViews = views - prevViews;
          dropViews = 0;
        } else {
          // Xử lý khi đối thủ ẩn/xóa video: views tổng bị tụt
          // 1. Ghi nhận số view bị mất vào dropViews
          dropViews = prevViews - views;
          // 2. View tăng trưởng thực tế của các video còn lại vẫn được tính chuẩn xác từ tổng delta 30 phút trong 24h
          const gain24h = await queryTursoWorker(`
            SELECT sum(delta_30m) as g24
            FROM (
              SELECT delta_30m FROM video_view_snapshots
              WHERE channel_id = ?
              ORDER BY id DESC LIMIT 48
            )
          `, [ch.id]);
          dailyViews = (gain24h && gain24h[0] && parseInt(gain24h[0].g24)) || 0;
        }
      } else {
        // Nếu chưa có snapshot hôm trước: lấy tổng 24h thực tế từ video_view_snapshots thay vì gán số giả
        const gain24h = await queryTursoWorker(`
          SELECT sum(delta_30m) as g24
          FROM (
            SELECT delta_30m FROM video_view_snapshots
            WHERE channel_id = ?
            ORDER BY id DESC LIMIT 48
          )
        `, [ch.id]);
        dailyViews = (gain24h && gain24h[0] && parseInt(gain24h[0].g24)) || 0;
      }

      // Chốt snapshot ngày hôm nay vào Turso
      await queryTursoWorker(`
        INSERT INTO snapshots (channel_id, snapshot_date, subs, views_all, video_count, daily_views, drop_views, relist_views)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(channel_id, snapshot_date) DO UPDATE SET
          subs = excluded.subs,
          views_all = excluded.views_all,
          video_count = excluded.video_count,
          daily_views = excluded.daily_views,
          drop_views = excluded.drop_views
      `, [ch.id, todayStr, subs, views, vids, dailyViews, dropViews]);

      count++;
    }

    const resMsg = `✅ [Cron 06:00 AM VN] Đã chốt snapshot tự động thành công cho ${count}/${channels.length} kênh ngày ${todayStr}!`;
    console.log(resMsg);
    return { ok: true, message: resMsg, today: todayStr, count };
  } catch (err) {
    console.error("[Cron 06:00 AM VN] Lỗi thực hiện chốt snapshot:", err);
    return { ok: false, message: err.message };
  }
}

const CHANNEL_CID_MAP = {
  100: "UCTndVAXVr8p2lF1wDz-LKSg", // TopBeat Music
  101: "UCM-XT_vM8HKwnD9KFtkgJMw", // TopGlow Music
  102: "UCMSoyXgiTclo_urz2WWn7hg", // Top Hits Studio
  103: "UChaXOWYKCQFyaY-9yjE8Mbg", // VELU MUSIC
  104: "UCRZLwOrC02HQO9mzzIVoAUQ", // Acoustic Therapy
  105: "UCQXFoHWmqwIhy13sYQyJFHA", // Pure Tracks
  106: "UCZnMji47f7CGRowcYSrnGFA", // Cynthia PoP Acoustic
  107: "UCdguZvvmY0IU0jiFmii1Wyg", // TopWave Music
  108: "UC4bYOCZNw0GosZQ598Hp5iw", // LoFi Chill Music
  110: "UCfpIKaaqQyFA6XNoq7gFkAQ", // Tune Top Music
  111: "UCcYS1a9E2n3C5pieN9azLig", // GlowBeat
  112: "UCfObHH4zc3qlYd6E5FAWOkA", // PoP Infinity 2026!
};

async function fetchChannelRssVideos(cid) {
  if (!cid) return [];
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${cid}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    const vids = [];
    for (const e of entries) {
      const mId = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const mTitle = e.match(/<title>([^<]+)<\/title>/);
      const mViews = e.match(/views="(\d+)"/);
      const mPub = e.match(/<published>([^<]+)<\/published>/);
      if (mId) {
        let pubDate = '';
        if (mPub && mPub[1]) {
          const d = new Date(mPub[1]);
          if (!isNaN(d)) pubDate = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        }
        vids.push({
          id: mId[1],
          title: mTitle ? mTitle[1] : '',
          views: mViews ? parseInt(mViews[1]) : 0,
          time: pubDate || 'Mới phát hành'
        });
      }
    }
    return vids;
  } catch (err) {
    console.warn("fetchChannelRssVideos error for", cid, err.message);
    return [];
  }
}

// ── DATA SANITIZER & ETL CLEANSING SUITE (DATA ANALYST QUALITY LAYER) ─────────
// Giới hạn vận tốc tăng trưởng thực tế theo phân tích kênh (Data Velocity Baselines)
class DataSanitizer {
  /**
   * Làm sạch chuỗi văn bản: bóc tách HTML, decode HTML entities, normalize unicode, strip khoảng trắng
   */
  static cleanText(raw) {
    if (!raw) return '';
    return String(raw)
      .replace(/<[^>]*>?/gm, '') // Strip HTML tags
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#x2F;/g, '/')
      .replace(/&nbsp;/g, ' ')
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Strip control chars
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Làm sạch và chuẩn hóa bản ghi video:
   * 1. ID video YouTube chuẩn 11 ký tự
   * 2. Tiêu đề sạch không dính mojibake/HTML
   * 3. Tính đơn điệu không giảm: views không bao giờ tụt do lỗi scrape mạng
   * 4. Zero-Delta cho video mới: khi phát hiện video mới cào lần đầu, khởi tạo baseline với delta = 0
   *    (ngăn chặn triệt để lỗi cộng dồn view lịch sử của video cũ vào view tăng trưởng 30 phút)
   * 5. Delta thực tế không giới hạn: tôn trọng 100% số view tăng tự nhiên thực tế của video
   */
  static cleanVideo(rawVid, existingVid, channelId) {
    if (!rawVid || !rawVid.id) return null;
    const cleanId = String(rawVid.id).trim();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(cleanId)) return null;

    const cleanTitle = this.cleanText(rawVid.title) || (existingVid ? existingVid.title : 'Video YouTube');
    const parsedViews = Math.max(0, parseInt(rawVid.views) || 0);
    const prevViews = existingVid ? Math.max(0, parseInt(existingVid.views) || 0) : 0;
    const baselineViews = existingVid ? Math.max(0, parseInt(existingVid.prev_views) || prevViews) : parsedViews;

    // Quy tắc 1: Chấp nhận view giảm hợp lệ — delta không bao giờ âm
    // View có thể giảm do: YouTube audit fake views, video bị ẩn/xóa rồi relist, đối thủ xóa video
    // Chỉ từ chối khi API trả về 0 hoàn toàn (scrape error / network fail thực sự)
    let finalViews = parsedViews;
    if (parsedViews === 0 && prevViews > 0) {
      // Trường hợp duy nhất không chấp nhận: API trả về 0 khi video đang có views
      // → Khả năng cao là lỗi mạng / API timeout, không phải video bị xóa thật
      console.warn(`[DataSanitizer] API tra ve 0 cho video ${cleanId} (DB: ${prevViews}). Giu nguyen.`);
      finalViews = prevViews;
    }
    // Nếu views giảm hợp lệ (video bị YouTube audit, hoặc video xóa rồi relist với view thấp hơn):
    // → Chấp nhận số thấp hơn, cập nhật vào DB
    // → delta sẽ = 0 (không âm), không làm ô nhiễm tổng delta kênh

    // Quy tắc 2: Video mới cào lần đầu → baseline khởi tạo, delta = 0
    let delta = 0;
    if (!existingVid || prevViews === 0) {
      delta = 0; // Video mới: không cộng view lịch sử vào delta
    } else if (finalViews > baselineViews) {
      delta = finalViews - baselineViews;
    }
    // Nếu finalViews <= baselineViews: delta = 0 (view giảm hoặc không đổi → không âm)

    return {
      id: cleanId,
      channel_id: channelId,
      title: cleanTitle,
      views: finalViews,
      prev_views: prevViews,
      delta_views: delta,
      time: rawVid.time || ''
    };
  }

  /**
   * Chuẩn hoá snapshot 30m của kênh theo công thức B - A
   */
  static cleanSnapshot(channelId, rawDelta, curTotalViews, prevSnapTotalViews, topVideo, hour = 12) {
    // Tôn trọng 100% dữ liệu thực tế từ YouTube API (tính đúng, không ép số, không áp baseline nhân tạo)
    const finalDelta = Math.max(0, parseInt(rawDelta) || 0);

    const topDelta = Math.min(finalDelta, Math.max(0, parseInt(topVideo?.delta_views || topVideo?.last_delta_30m) || 0));
    const topTitle = this.cleanText(topVideo?.title || 'Đang theo dõi');

    return {
      channel_id: channelId,
      total_video_views: curTotalViews,
      delta_30m: finalDelta,
      top_title: topTitle,
      top_delta: topDelta
    };
  }
}

// ── QUÉT TOÀN BỘ VIDEO PUBLIC & CHỐT SNAPSHOT REAL-TIME 30 PHÚT ──────────────
async function run30mVideoSnapshotJob(env) {
  try {
    const vnNow = new Date(Date.now() + 7 * 3600 * 1000);
    const minute = vnNow.getMinutes() >= 30 ? 30 : 0;
    const timeMark = `${String(vnNow.getDate()).padStart(2, '0')}/${String(vnNow.getMonth() + 1).padStart(2, '0')}/${vnNow.getFullYear()} ${String(vnNow.getHours()).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const isoNow = vnNow.toISOString().replace("T", " ").substring(0, 19);

    const channels = await queryTursoWorker("SELECT id, title, custom_id FROM channels ORDER BY id ASC");
    if (!channels || !channels.length) return { ok: true, count: 0, message: "Không có kênh nào." };

    // Ngân sách subrequest nghiêm ngặt: giới hạn 35 request để không bao giờ vi phạm trần 50 của Cloudflare
    const budget = { count: 0, max: 35 };

    // 0. Nạp dữ liệu video hiện tại từ DB để DataSanitizer đối soát và khử nhiễu
    const existingVidRows = await queryTursoWorker(
      "SELECT id, channel_id, title, views, prev_views, delta_views, last_delta_30m FROM video_items"
    );
    const existingMap = {};
    const channelVidsCount = {};
    (existingVidRows || []).forEach(ev => {
      existingMap[ev.id] = ev;
      channelVidsCount[ev.channel_id] = (channelVidsCount[ev.channel_id] || 0) + 1;
    });

    const activeKeys = await getActiveYtApiKeys(env);

    // ── TỰ ĐỘNG PHÁT HIỆN KÊNH MỚI THÊM (CHƯA CÓ VIDEO TRONG DB) ─────────────────
    // Nếu phát hiện kênh nào trong danh sách có 0 video: Quét nạp toàn bộ video qua API ngay lập tức!
    const emptyChannels = channels.filter(ch => !channelVidsCount[ch.id]);
    if (emptyChannels.length > 0 && activeKeys && activeKeys.length > 0) {
      for (const ech of emptyChannels) {
        try {
          console.log(`[Auto-New-Channel] Phat hien kenh moi "${ech.title}" (ch${ech.id}) chua co video, tien hanh nap qua API...`);
          const newVids = await fetchChannelAllVideosYtApi(ech.custom_id, activeKeys);
          if (newVids && newVids.length > 0) {
            const newVidBatch = [];
            for (const nv of newVids) {
              existingMap[nv.id] = { id: nv.id, channel_id: ech.id, title: nv.title, views: nv.views, prev_views: nv.views, delta_views: 0 };
              newVidBatch.push({
                sql: `
                  INSERT INTO video_items (id, channel_id, title, views, prev_views, delta_views, published_time, last_scraped_at)
                  VALUES (?, ?, ?, ?, ?, 0, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET
                    views = excluded.views,
                    prev_views = excluded.prev_views,
                    last_scraped_at = excluded.last_scraped_at
                `,
                args: [nv.id, ech.id, nv.title, nv.views, nv.views, nv.time || '', isoNow]
              });
            }
            await executeTursoBatch(newVidBatch);
            console.log(`[Auto-New-Channel] Da nap thanh cong ${newVids.length} video cho kenh moi "${ech.title}"!`);
          }
        } catch (echErr) {
          console.warn(`[Auto-New-Channel] Loi quet kenh ${ech.title}:`, echErr.message);
        }
      }
    }

    // ── BƯỚC 1: YouTube Data API v3 (PRIMARY - Số chính xác từng view) ──────────
    // Dùng API lấy số view chính xác 100% cho tất cả video đã biết (chuẩn từng 1 view)
    // Nếu lỗi / hết quota: tự động fallback sang cào HTML ở Bước 2
    let apiSucceeded = false;

    if (activeKeys && activeKeys.length > 0 && Object.keys(existingMap).length > 0) {
      try {
        const allVideoIds = Object.keys(existingMap);
        const apiResults = await fetchExactViewsFromYtApi(allVideoIds, activeKeys);
        if (apiResults && Object.keys(apiResults).length > 0) {
          const apiUpdateBatch = [];
          for (const [videoId, exactViews] of Object.entries(apiResults)) {
            const existing = existingMap[videoId];
            if (!existing) continue;
            const cv = DataSanitizer.cleanVideo(
              { id: videoId, views: exactViews, title: existing.title, time: existing.published_time },
              existing,
              existing.channel_id
            );
            if (!cv || cv.views <= 0) continue;
            apiUpdateBatch.push({
              sql: `
                INSERT INTO video_items (id, channel_id, title, views, prev_views, delta_views, last_scraped_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  prev_views = CASE 
                    WHEN video_items.prev_views IS NULL OR video_items.prev_views = 0 THEN video_items.views
                    ELSE video_items.prev_views 
                  END,
                  views = excluded.views,
                  delta_views = excluded.delta_views,
                  last_scraped_at = excluded.last_scraped_at
              `,
              args: [cv.id, cv.channel_id, cv.title, cv.views, cv.prev_views, cv.delta_views, isoNow]
            });
          }
          if (apiUpdateBatch.length > 0) {
            await executeTursoBatch(apiUpdateBatch);
            apiSucceeded = true;
            console.log(`[YT API v3] Cap nhat chinh xac ${apiUpdateBatch.length}/${allVideoIds.length} video`);
          }

          // ── PHÁT HIỆN VIDEO BỊ ẨN / XÓA ────────────────────────────────────────
          // API v3 chỉ trả về video PUBLIC. Video không có trong response = bị ẩn / xóa / private.
          // Logic: 2 lần liên tiếp không thấy → xác nhận ẩn/xóa (tránh false positive do API fluke)
          const returnedIds = new Set(Object.keys(apiResults));
          const hiddenEventBatch = [];

          for (const videoId of allVideoIds) {
            const existing = existingMap[videoId];
            if (!existing || !existing.views || existing.views <= 0) continue; // Bỏ qua video chưa có views

            if (!returnedIds.has(videoId)) {
              // Video không xuất hiện trong API response lần này
              const prevMisses = parseInt(existing.consecutive_misses) || 0;
              const newMisses = prevMisses + 1;
              const wasPublic = !existing.status || existing.status === 'public';

              if (newMisses >= 2 && wasPublic) {
                // Xác nhận: ẩn/xóa (2 lần liên tiếp không thấy)
                console.warn(`[HIDDEN DETECTED] ch${existing.channel_id} video ${videoId} "${existing.title?.slice(0,40)}" last_views=${existing.views}`);
                hiddenEventBatch.push({
                  sql: `INSERT OR IGNORE INTO video_events (video_id, channel_id, event_type, video_title, last_known_views, detected_at)
                        VALUES (?, ?, 'hidden_detected', ?, ?, ?)`,
                  args: [videoId, existing.channel_id, existing.title || '', existing.views, timeMark]
                });
                // Cập nhật status = 'hidden' trong video_items
                hiddenEventBatch.push({
                  sql: `UPDATE video_items SET status='hidden', status_changed_at=?, consecutive_misses=? WHERE id=?`,
                  args: [timeMark, newMisses, videoId]
                });
              } else {
                // Lần đầu không thấy: chỉ tăng counter, chưa kết luận
                hiddenEventBatch.push({
                  sql: `UPDATE video_items SET consecutive_misses=? WHERE id=?`,
                  args: [newMisses, videoId]
                });
              }
            } else {
              // Video xuất hiện lại → có thể đã được restore
              const wasHidden = existing.status === 'hidden';
              const prevMisses = parseInt(existing.consecutive_misses) || 0;
              if (wasHidden || prevMisses > 0) {
                if (wasHidden) {
                  console.log(`[RESTORED] ch${existing.channel_id} video ${videoId} "${existing.title?.slice(0,40)}" restored`);
                  hiddenEventBatch.push({
                    sql: `INSERT OR IGNORE INTO video_events (video_id, channel_id, event_type, video_title, last_known_views, detected_at)
                          VALUES (?, ?, 'restored', ?, ?, ?)`,
                    args: [videoId, existing.channel_id, existing.title || '', existing.views, timeMark]
                  });
                }
                hiddenEventBatch.push({
                  sql: `UPDATE video_items SET status='public', consecutive_misses=0, status_changed_at=? WHERE id=?`,
                  args: [timeMark, videoId]
                });
              }
            }
          }

          if (hiddenEventBatch.length > 0) {
            await executeTursoBatch(hiddenEventBatch);
          }
        }
      } catch (apiErr) {
        console.warn('[YT API v3] Loi, tu dong fallback sang HTML scraping:', apiErr.message);
      }
    }


    // ── BƯỚC 2: HTML Scraping (FALLBACK - Backup khi API lỗi/không có key) ──────
    // QUAN TRỌNG: Khi API v3 thành công, tắt HTML scraping hoàn toàn để không vượt giới hạn
    // 50 subrequest của Cloudflare (17 API batch + 8 Turso = 25, còn dư 25 buffer)
    // Khi API lỗi (apiSucceeded=false): chạy HTML scraping bình thường (max 35 budget)
    if (apiSucceeded) budget.max = 0; // Tắt HTML scraping khi API đã xử lý đủ
    const allVideoBatch = [];
    for (const ch of channels) {
      let vids = [];
      if (budget.count < budget.max) {
        vids = await scanChannelPublicVideos(ch.custom_id, 4, budget);
      }
      if (!vids || !vids.length) {
        const cid = CHANNEL_CID_MAP[ch.id] || (ch.custom_id.startsWith('UC') ? ch.custom_id : null);
        if (cid && budget.count < budget.max) {
          budget.count++;
          vids = await fetchChannelRssVideos(cid);
        }
      }

      for (const v of vids) {
        // Nếu API đã cập nhật video này rồi: chỉ giữ lại nếu là video MỚI chưa có trong DB
        if (apiSucceeded && existingMap[v.id]) continue;

        const cv = DataSanitizer.cleanVideo(v, existingMap[v.id], ch.id);
        if (cv && cv.views > 0) {
          allVideoBatch.push({
            sql: `
              INSERT INTO video_items (id, channel_id, title, views, prev_views, delta_views, published_time, last_scraped_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                prev_views = CASE 
                  WHEN video_items.prev_views IS NULL OR video_items.prev_views = 0 THEN video_items.views
                  ELSE video_items.prev_views 
                END,
                delta_views = CASE 
                  WHEN excluded.delta_views > 0 THEN excluded.delta_views
                  ELSE video_items.delta_views 
                END,
                views = CASE WHEN excluded.views > video_items.views THEN excluded.views ELSE video_items.views END,
                title = CASE WHEN excluded.title != '' THEN excluded.title ELSE video_items.title END,
                last_scraped_at = excluded.last_scraped_at
            `,
            args: [cv.id, ch.id, cv.title, cv.views, cv.prev_views, cv.delta_views, cv.time, isoNow]
          });
        }
      }
    }

    // 2. Ghi toàn bộ video vào Turso trong 1 Batch duy nhất
    if (allVideoBatch.length > 0) {
      await executeTursoBatch(allVideoBatch);
    }

    // 3. Lấy tổng số video và tổng view hiện tại của từng kênh từ video_items
    const statRows = await queryTursoWorker(`
      SELECT channel_id, count(*) as vid_count, sum(views) as total_views
      FROM video_items
      GROUP BY channel_id
    `);
    const countMap = {};
    (statRows || []).forEach(r => {
      countMap[r.channel_id] = {
        count: parseInt(r.vid_count) || 0,
        views: parseInt(r.total_views) || 0
      };
    });

    // 4. Lấy snapshot gần nhất trước đó (chỉ lấy 50 dòng mới nhất để tối ưu tốc độ & bộ nhớ)
    const prevSnaps = await queryTursoWorker(`
      SELECT channel_id, total_video_views, captured_at
      FROM video_view_snapshots
      WHERE captured_at != ?
      ORDER BY id DESC
      LIMIT 50
    `, [timeMark]);
    const prevMap = {};
    let lastCapturedAt = null;
    (prevSnaps || []).forEach(s => {
      if (!prevMap[s.channel_id]) {
        prevMap[s.channel_id] = parseInt(s.total_video_views) || 0;
        if (!lastCapturedAt && s.captured_at) lastCapturedAt = s.captured_at;
      }
    });

    // Phát hiện khuyết mốc (gap > 30m): Tự động tính các mốc bị thiếu để nội suy chia đều view (không để dồn cục tạo cột lạ)
    const missedIntervals = [];
    if (lastCapturedAt) {
      try {
        const parts = lastCapturedAt.split(' ');
        const dParts = parts[0].split('/');
        const tParts = parts[1].split(':');
        const lastDate = new Date(parseInt(dParts[2]), parseInt(dParts[1]) - 1, parseInt(dParts[0]), parseInt(tParts[0]), parseInt(tParts[1]));
        const diffMs = vnNow.getTime() - lastDate.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin >= 45 && diffMin <= 24 * 60) {
          const numSteps = Math.round(diffMin / 30);
          for (let s = 1; s < numSteps; s++) {
            const stepDate = new Date(lastDate.getTime() + s * 30 * 60000);
            const sMin = stepDate.getMinutes() >= 30 ? 30 : 0;
            const sTimeMark = `${String(stepDate.getDate()).padStart(2, '0')}/${String(stepDate.getMonth() + 1).padStart(2, '0')}/${stepDate.getFullYear()} ${String(stepDate.getHours()).padStart(2, '0')}:${String(sMin).padStart(2, '0')}`;
            if (sTimeMark !== timeMark && sTimeMark !== lastCapturedAt && !missedIntervals.includes(sTimeMark)) {
              missedIntervals.push(sTimeMark);
            }
          }
        }
      } catch (e) {
        console.warn("[Auto-Interpolation] Parse date error:", e.message);
      }
    }

    // 5. Lấy tổng delta_views và video tăng view nhiều nhất của từng kênh
    const [gainRows, topVids] = await Promise.all([
      queryTursoWorker(`
        SELECT channel_id, sum(delta_views) as gained
        FROM video_items
        WHERE delta_views > 0
        GROUP BY channel_id
      `),
      queryTursoWorker(`
        SELECT channel_id, title, delta_views
        FROM video_items
        WHERE delta_views > 0
        ORDER BY delta_views DESC
      `)
    ]);

    const gainMap = {};
    (gainRows || []).forEach(g => {
      gainMap[g.channel_id] = parseInt(g.gained) || 0;
    });

    const topMap = {};
    (topVids || []).forEach(t => {
      if (!topMap[t.channel_id]) topMap[t.channel_id] = t;
    });

    // 6. Chuẩn hoá snapshot và ghi vào Turso trong 1 Batch duy nhất
    const snapBatch = [];
    const totalSteps = missedIntervals.length + 1;

    for (const ch of channels) {
      const cur = countMap[ch.id] || { count: 0, views: 0 };
      const prevTot = prevMap[ch.id] || 0;
      // Công thức view tăng trưởng theo chỉ đạo của người dùng:
      // Ưu tiên tổng delta_views của toàn bộ video trong kênh (tính chính xác từng view từ YouTube Data API v3).
      // Đồng thời so sánh với (cur.views - prevTot) để không bỏ sót video mới được bổ sung.
      const vidGain = gainMap[ch.id] || 0;
      const totalDiff = prevTot > 0 ? (cur.views - prevTot) : 0;
      const bMinusA = Math.max(0, vidGain, totalDiff);
      const top = topMap[ch.id] || { title: 'Đang theo dõi', delta_views: bMinusA };

      // Chạy qua DataSanitizer
      const cleanSnap = DataSanitizer.cleanSnapshot(ch.id, bMinusA, cur.views, prevTot, top, vnNow.getHours());

      if (missedIntervals.length > 0 && prevTot > 0 && cleanSnap.delta_30m > 0) {
        // Tự động chia đều delta cho từng khoảng 30 phút đã bị khuyết
        const stepDelta = Math.floor(cleanSnap.delta_30m / totalSteps);
        const topStepDelta = Math.floor(cleanSnap.top_delta / totalSteps);

        // Bù các mốc bị thiếu
        for (let i = 0; i < missedIntervals.length; i++) {
          const interTime = missedIntervals[i];
          const interViews = prevTot + (stepDelta * (i + 1));
          snapBatch.push({
            sql: `
              INSERT INTO video_view_snapshots (channel_id, captured_at, total_video_views, video_count, delta_30m, top_growing_video_title, top_growing_video_delta)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(channel_id, captured_at) DO UPDATE SET
                total_video_views = excluded.total_video_views,
                video_count = excluded.video_count,
                delta_30m = excluded.delta_30m,
                top_growing_video_title = excluded.top_growing_video_title,
                top_growing_video_delta = excluded.top_growing_video_delta
            `,
            args: [ch.id, interTime, interViews, cur.count, stepDelta, cleanSnap.top_title, topStepDelta]
          });
        }

        // Mốc hiện tại lấy phần delta còn lại để khớp 100% tổng delta thực tế
        const curDelta = cleanSnap.delta_30m - (stepDelta * missedIntervals.length);
        const curTopDelta = Math.max(0, cleanSnap.top_delta - (topStepDelta * missedIntervals.length));
        snapBatch.push({
          sql: `
            INSERT INTO video_view_snapshots (channel_id, captured_at, total_video_views, video_count, delta_30m, top_growing_video_title, top_growing_video_delta)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(channel_id, captured_at) DO UPDATE SET
              total_video_views = excluded.total_video_views,
              video_count = excluded.video_count,
              delta_30m = excluded.delta_30m,
              top_growing_video_title = excluded.top_growing_video_title,
              top_growing_video_delta = excluded.top_growing_video_delta
          `,
          args: [ch.id, timeMark, cleanSnap.total_video_views, cur.count, curDelta, cleanSnap.top_title, curTopDelta]
        });
      } else {
        // Chu kỳ bình thường 30 phút
        snapBatch.push({
          sql: `
            INSERT INTO video_view_snapshots (channel_id, captured_at, total_video_views, video_count, delta_30m, top_growing_video_title, top_growing_video_delta)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(channel_id, captured_at) DO UPDATE SET
              total_video_views = excluded.total_video_views,
              video_count = excluded.video_count,
              delta_30m = excluded.delta_30m,
              top_growing_video_title = excluded.top_growing_video_title,
              top_growing_video_delta = excluded.top_growing_video_delta
          `,
          args: [ch.id, timeMark, cleanSnap.total_video_views, cur.count, cleanSnap.delta_30m, cleanSnap.top_title, cleanSnap.top_delta]
        });
      }
    }

    await executeTursoBatch(snapBatch);

    // 7. Chốt xong snapshot: Lưu delta 30 phút vừa qua vào last_delta_30m để popup luôn xem được,
    // sau đó cập nhật prev_views = views và reset delta_views = 0 cho chu kỳ tiếp theo!
    await queryTursoWorker(`
      UPDATE video_items 
      SET last_delta_30m = delta_views,
          prev_views = views, 
          delta_views = 0 
      WHERE views > 0
    `);

    const msg = `✅ [Cron 30m] Đã chốt snapshot video real-time thành công cho toàn bộ ${channels.length} kênh lúc ${timeMark}!`;
    console.log(msg);
    return { ok: true, message: msg, timeMark, count: channels.length };
  } catch (err) {
    console.error("[Cron 30m] Lỗi snapshot video:", err);
    return { ok: false, message: err.message };
  }
}

// ── YOUTUBE DATA API v3: QUẢN LÝ POOL KEYS & TỰ ĐỘNG FAILOVER (XOAY VÒNG KEY) ──────
async function getActiveYtApiKeys(env) {
  let keys = [];
  try {
    const rows = await queryTursoWorker(
      "SELECT key_value FROM api_keys WHERE service = 'youtube' AND is_active = 1 ORDER BY quota_used ASC, id ASC"
    );
    if (rows && rows.length > 0) {
      keys = rows.map(r => (r.key_value || '').trim()).filter(k => k.length >= 15);
    }
  } catch (e) {
    console.warn("[API Keys Pool] Loi query api_keys:", e.message);
  }

  // Bổ sung các key từ env nếu chưa có trong DB
  const envKeys = [];
  if (env && env.YT_API_KEYS) {
    envKeys.push(...env.YT_API_KEYS.split(/[\r\n,;]+/).map(s => s.trim()).filter(Boolean));
  }
  if (env && env.YT_API_KEY) {
    envKeys.push(env.YT_API_KEY.trim());
  }
  if (typeof YT_API_KEY_DEFAULT !== 'undefined' && YT_API_KEY_DEFAULT) {
    envKeys.push(YT_API_KEY_DEFAULT.trim());
  }

  for (const ek of envKeys) {
    if (ek && ek.length >= 15 && !keys.includes(ek)) {
      keys.push(ek);
    }
  }

  return keys;
}

// Lấy view chính xác từng view với hồ chứa đa keys (Multi-Key Failover)
// Nếu key 1 bị lỗi 403 quotaExceeded / rateLimit, tự động đánh dấu và chuyển sang key 2, 3...
async function fetchExactViewsFromYtApi(videoIds, apiKeyOrEnv) {
  if (!videoIds || !videoIds.length) return {};

  let keyPool = [];
  if (Array.isArray(apiKeyOrEnv)) {
    keyPool = [...apiKeyOrEnv].map(k => (k || '').trim()).filter(k => k.length >= 15);
  } else if (typeof apiKeyOrEnv === 'string' && apiKeyOrEnv.trim().length >= 15) {
    keyPool = [apiKeyOrEnv.trim()];
  } else {
    keyPool = await getActiveYtApiKeys(apiKeyOrEnv);
  }

  if (!keyPool.length) {
    if (typeof YT_API_KEY_DEFAULT !== 'undefined' && YT_API_KEY_DEFAULT) {
      keyPool = [YT_API_KEY_DEFAULT];
    } else {
      return {};
    }
  }

  const BATCH = 50;
  const resultMap = {};
  const chunks = [];
  for (let i = 0; i < videoIds.length; i += BATCH) {
    chunks.push(videoIds.slice(i, i + BATCH));
  }

  let activeKeyIndex = 0;
  const keyUsageMap = {};

  async function fetchChunkWithFailover(chunk) {
    const ids = chunk.join(',');
    let lastErr = null;

    while (activeKeyIndex < keyPool.length) {
      const currentKey = keyPool[activeKeyIndex];
      const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}&key=${currentKey}&fields=items(id,statistics/viewCount)`;

      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const data = await resp.json();
          if (data.items) {
            for (const item of data.items) {
              const vc = item.statistics && item.statistics.viewCount;
              if (vc !== undefined && vc !== null) {
                resultMap[item.id] = parseInt(vc, 10) || 0;
              }
            }
          }
          // Đếm quota đã dùng trong bộ nhớ để gom 1 batch Turso duy nhất, tránh spam 17 subrequests
          keyUsageMap[currentKey] = (keyUsageMap[currentKey] || 0) + 1;
          return;
        }

        const errText = await resp.text().catch(() => '');
        const isQuota = resp.status === 403 && (
          errText.includes('quotaExceeded') || 
          errText.includes('dailyLimitExceeded') || 
          errText.includes('rateLimitExceeded')
        );
        const isInvalid = resp.status === 400 && errText.includes('keyInvalid');

        if (isQuota || isInvalid || resp.status === 403 || resp.status === 429) {
          const reason = isQuota ? 'Hết Quota (403 quotaExceeded)' : (isInvalid ? 'Key không hợp lệ' : `Lỗi HTTP ${resp.status}`);
          console.warn(`[YT API Failover] Key ...${currentKey.slice(-6)} bị ${reason}. Tự động chuyển sang key tiếp theo trong pool!`);

          queryTursoWorker(
            "UPDATE api_keys SET is_active = 0, last_error = ?, last_used_at = datetime('now') WHERE key_value = ?",
            [reason, currentKey]
          ).catch(() => {});

          activeKeyIndex++;
          lastErr = new Error(reason);
          continue;
        }

        throw new Error(`YT API HTTP ${resp.status}: ${errText.slice(0, 120)}`);
      } catch (err) {
        if (activeKeyIndex < keyPool.length - 1 && (err.message.includes('quota') || err.message.includes('403') || err.message.includes('429'))) {
          activeKeyIndex++;
          lastErr = err;
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Tất cả ${keyPool.length} YouTube API Keys trong pool đều đã hết quota hoặc lỗi: ${lastErr?.message || 'Unknown'}`);
  }

  await Promise.all(chunks.map(chunk => fetchChunkWithFailover(chunk)));

  // Gom ghi nhận quota đã dùng vào Turso trong 1 request batch duy nhất (tiết kiệm subrequests)
  const usageEntries = Object.entries(keyUsageMap);
  if (usageEntries.length > 0) {
    const quotaBatch = usageEntries.map(([k, count]) => ({
      sql: "UPDATE api_keys SET quota_used = quota_used + ?, last_used_at = datetime('now') WHERE key_value = ?",
      args: [count, k]
    }));
    executeTursoBatch(quotaBatch).catch(() => {});
  }

  return resultMap;
}

// Quét toàn bộ video công khai của 1 kênh mới thêm thông qua YouTube Data API v3
// Sử dụng Uploads Playlist (UU...) cho tốc độ cực nhanh (50 video/request) và độ chính xác 100%
async function fetchChannelAllVideosYtApi(customId, apiKeyOrPool) {
  if (!customId) return [];
  const keyPool = Array.isArray(apiKeyOrPool) ? apiKeyOrPool : [apiKeyOrPool];
  const apiKey = keyPool[0];
  if (!apiKey) return [];

  let channelId = customId;
  let uploadsPlaylistId = '';

  try {
    if (customId.startsWith('UC') && customId.length >= 24) {
      channelId = customId;
      uploadsPlaylistId = 'UU' + customId.substring(2);
    } else {
      // Custom ID dạng handle (@name) hoặc URL name -> Tìm channel ID qua API
      const handle = customId.replace(/^@/, '');
      const chUrl = `https://www.googleapis.com/youtube/v3/channels?part=id,contentDetails&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`;
      const chResp = await fetch(chUrl);
      if (chResp.ok) {
        const chData = await chResp.json();
        if (chData.items && chData.items[0]) {
          channelId = chData.items[0].id;
          uploadsPlaylistId = chData.items[0].contentDetails?.relatedPlaylists?.uploads || ('UU' + channelId.substring(2));
        }
      }
      if (!uploadsPlaylistId && channelId.startsWith('UC')) {
        uploadsPlaylistId = 'UU' + channelId.substring(2);
      }
    }

    if (!uploadsPlaylistId) return [];

    // Phân trang lấy tối đa 500 video từ playlist uploads
    const vids = [];
    let pageToken = '';
    let pageCount = 0;
    while (pageCount < 10) {
      const plUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${uploadsPlaylistId}&maxResults=50&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const plResp = await fetch(plUrl);
      if (!plResp.ok) break;
      const plData = await plResp.json();
      if (!plData.items || !plData.items.length) break;

      for (const it of plData.items) {
        const vidId = it.contentDetails?.videoId;
        if (vidId && /^[a-zA-Z0-9_-]{11}$/.test(vidId)) {
          vids.push({
            id: vidId,
            title: it.snippet?.title || 'Video YouTube',
            time: it.snippet?.publishedAt || ''
          });
        }
      }

      pageToken = plData.nextPageToken || '';
      pageCount++;
      if (!pageToken) break;
    }

    if (!vids.length) return [];

    // Lấy viewCount chính xác cho tất cả video qua API
    const vidIds = vids.map(v => v.id);
    const viewsMap = await fetchExactViewsFromYtApi(vidIds, apiKeyOrPool);

    return vids.map(v => ({
      id: v.id,
      title: v.title,
      views: viewsMap[v.id] || 0,
      time: v.time
    }));
  } catch (err) {
    console.warn(`[fetchChannelAllVideosYtApi] Loi fetch video cho ${customId}:`, err.message);
    return [];
  }
}

async function scanChannelPublicVideos(customId, maxPages = 8, budgetRef = null) {
  if (!customId) return [];
  if (budgetRef && budgetRef.count >= budgetRef.max) return [];
  if (budgetRef) budgetRef.count++;

  const targetUrl = customId.startsWith('@') 
    ? `https://www.youtube.com/${customId}/videos`
    : (customId.startsWith('UC') ? `https://www.youtube.com/channel/${customId}/videos` : `https://www.youtube.com/${customId}/videos`);

  const vidsMap = {};
  let resolvedCid = customId.startsWith('UC') ? customId : '';

  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    const html = await res.text();

    if (!resolvedCid) {
      const mCid = html.match(/\"externalId\":\"(UC[a-zA-Z0-9_-]{22})\"/) || html.match(/channel_id=(UC[a-zA-Z0-9_-]{22})/);
      if (mCid) resolvedCid = mCid[1];
    }

    const mInit = html.match(/var ytInitialData = ({.*?});<\/script>/);
    if (mInit) {
      const data = JSON.parse(mInit[1]);
      const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
      let grid = null;
      for (const t of tabs) {
        if (t?.tabRenderer?.content?.richGridRenderer) {
          grid = t.tabRenderer.content.richGridRenderer;
          break;
        }
      }

      if (grid) {
        const contents = grid.contents || [];
        let contToken = null;
        for (const it of contents) {
          const v = extractVideoFromItem(it);
          if (v) vidsMap[v.id] = v;
          if (it.continuationItemRenderer) {
            contToken = it.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
          }
        }

        // Paginate up to maxPages (hoặc tới khi hết continuation token)
        let page = 2;
        while (contToken && page <= maxPages) {
          if (budgetRef && budgetRef.count >= budgetRef.max) break;
          if (budgetRef) budgetRef.count++;

          try {
            const browseRes = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              },
              body: JSON.stringify({
                context: { client: { clientName: 'WEB', clientVersion: '2.20240901.00.00', hl: 'vi', gl: 'VN' } },
                continuation: contToken
              })
            });
            const d2 = await browseRes.json();
            const actions = d2?.onResponseReceivedActions || [];
            let nextItems = [];
            contToken = null;
            for (const act of actions) {
              const ci = act?.appendContinuationItemsAction?.continuationItems;
              if (ci) { nextItems = ci; break; }
            }
            if (!nextItems.length) break;
            for (const it of nextItems) {
              const v = extractVideoFromItem(it);
              if (v) vidsMap[v.id] = v;
              if (it.continuationItemRenderer) {
                contToken = it.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
              }
            }
            page++;
          } catch {
            break;
          }
        }
      }
    }
  } catch (err) {
    console.warn("Scan videos warning:", customId, err.message);
  }

  return Object.values(vidsMap);
}

function extractVideoFromItem(it) {
  if (!it) return null;
  // Modern 2024-2026 lockupViewModel
  const lvm = it.richItemRenderer?.content?.lockupViewModel || it.lockupViewModel;
  if (lvm && lvm.contentId) {
    const vidId = lvm.contentId;
    const meta = lvm.metadata?.lockupMetadataViewModel;
    const title = meta?.title?.content || '';
    const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
    let viewText = '';
    let timeText = '';
    for (const r of rows) {
      for (const p of (r.metadataParts || [])) {
        const txt = p?.text?.content || '';
        if (txt.toLowerCase().includes('lượt xem') || txt.toLowerCase().includes('view')) viewText = txt;
        else if (txt.toLowerCase().includes('trước') || txt.toLowerCase().includes('ago')) timeText = txt;
      }
    }
    return { id: vidId, title, views: parseYtStat(viewText), time: timeText };
  }

  // Classic videoRenderer fallback
  const vr = it.richItemRenderer?.content?.videoRenderer || it.videoRenderer;
  if (vr && vr.videoId) {
    const vidId = vr.videoId;
    const title = vr.title?.runs?.[0]?.text || vr.title?.simpleText || '';
    const viewText = vr.viewCountText?.simpleText || vr.viewCountText?.runs?.[0]?.text || vr.shortViewCountText?.simpleText || '';
    const timeText = vr.publishedTimeText?.simpleText || '';
    return { id: vidId, title, views: parseYtStat(viewText), time: timeText };
  }

  return null;
}

function dbUserToObj(row) {
  if (!row) return null;
  return {
    ...row,
    isRootAdmin: Boolean(row.isRootAdmin),
    allowedTools: (() => {
      try {
        return typeof row.allowedTools === "string" ? JSON.parse(row.allowedTools) : (row.allowedTools || []);
      } catch {
        return [];
      }
    })(),
  };
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, salt, ...safe } = user;
  return safe;
}

function parseYtStat(str) {
  if (!str) return 0;
  const s = String(str).toLowerCase().trim();
  const multiMatch = s.match(/([\d.,]+)\s*(triệu|tr|nghìn|ngàn|tỷ|m|k|b|n)(?![a-zà-ỹ0-9])/i);
  if (multiMatch) {
    let rawNum = multiMatch[1].replace(/,/g, '.');
    if ((rawNum.match(/\./g) || []).length > 1) {
      rawNum = rawNum.replace(/\./g, '');
    }
    const val = parseFloat(rawNum);
    const unit = multiMatch[2].toLowerCase();
    if (['triệu', 'tr', 'm'].includes(unit)) return Math.round(val * 1000000);
    if (['nghìn', 'ngàn', 'k', 'n'].includes(unit)) return Math.round(val * 1000);
    if (['tỷ', 'b'].includes(unit)) return Math.round(val * 1000000000);
  }
  const numOnly = s.match(/[\d.,]+/);
  if (!numOnly) return 0;
  const cleaned = numOnly[0].replace(/[.,]/g, '');
  return parseInt(cleaned, 10) || 0;
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(`${password}:${salt}:fikat_salt_2026`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function computeHmacSha256(data, secretKey) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase();
}

function generateRandomHex(len = 8) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function createAuthToken(user) {
  const payload = {
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    isRootAdmin: Boolean(user.isRootAdmin),
    allowedTools: user.allowedTools || [],
    exp: Date.now() + 7 * 24 * 3600 * 1000,
  };
  const base64Payload = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const sig = await hashPassword(base64Payload, JWT_SECRET);
  return `${base64Payload}.${sig.substring(0, 16)}`;
}

async function getAuthenticatedUser(request, env) {
  const pinHeader = request.headers.get("X-Admin-Pin");
  if (pinHeader && pinHeader === (env.ADMIN_PIN || DEFAULT_ADMIN_PIN).trim()) {
    return {
      id: "root_pin_user",
      fullName: "Quản trị viên (Master)",
      username: "fikat",
      role: "Quản trị viên",
      isRootAdmin: true,
      status: "active",
      allowedTools: ["suno-bulk-studio", "tool-random-nhac", "haloli-livestream", "bi-thuat", "pilab-studio"]
    };
  }

  const authHeader = request.headers.get("Authorization") || request.headers.get("X-Auth-Token") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  try {
    const [base64Payload, clientSig] = token.split(".");
    if (!base64Payload || !clientSig) return null;
    const expectedSig = (await hashPassword(base64Payload, JWT_SECRET)).substring(0, 16);
    if (clientSig !== expectedSig) return null;

    const payload = JSON.parse(decodeURIComponent(escape(atob(base64Payload))));
    if (Date.now() > payload.exp) return null;

    const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(payload.userId).first();
    if (!row || row.status === "blocked") return null;
    return dbUserToObj(row);
  } catch {
    return null;
  }
}

function getVnTime() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().replace("T", " ").substring(0, 19);
}

async function sendTelegramAlert(env, payload, items, vnTime) {
  const botToken = (env.TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = (env.TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID || "").trim();
  if (!botToken || !chatId || botToken === "YOUR_TELEGRAM_BOT_TOKEN_HERE") return;

  const hwid = payload.hwid || "UNKNOWN";
  const shortHwid = hwid.length > 16 ? hwid.substring(0, 8) + "..." + hwid.slice(-6) : hwid;
  const key = payload.licenseKey || "Free / Trial";
  const roleIcon = payload.role === "Admin" ? "👑 ADMIN" : "💼 NHÂN VIÊN";
  const userName = payload.resolvedName || payload.sunoUser || payload.windowsUser || "Suno Client";
  const userHandle = payload.resolvedUsername ? ` (@${payload.resolvedUsername})` : "";

  let songListText = "";
  items.slice(0, 6).forEach((item, i) => {
    const itTitle = item.title || item.a || "Không có tên";
    const itAction = item.actionType || item.C || "MP3";
    songListText += `  ${i + 1}. 🎵 <b>${escapeHtml(itTitle)}</b> [<i>${escapeHtml(itAction)}</i>]\n`;
  });
  if (items.length > 6) songListText += `  ... và ${items.length - 6} bài khác.\n`;

  const message =
    `🚀 <b>[Suno Bulk Studio] Khách vừa tải nhạc!</b>\n\n` +
    `👤 <b>Người dùng:</b> <b>${escapeHtml(userName)}${escapeHtml(userHandle)}</b>\n` +
    `💼 <b>Vai trò:</b> <b>${roleIcon}</b>\n` +
    `💻 <b>HWID:</b> <code>${shortHwid}</code>\n` +
    `🔑 <b>Key:</b> <code>${escapeHtml(key)}</code>\n` +
    `📦 <b>Số lượng:</b> <b>${items.length}</b> bài\n` +
    `📋 <b>Danh sách:</b>\n${songListText}\n` +
    `⏰ <b>Thời gian:</b> <i>${vnTime} (Giờ VN)</i>`;

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
