/**
 * Cloudflare Worker — fikat.cloud
 * Hệ thống Quản trị, Phân quyền & Giám sát Lịch sử Tải Suno Bulk Studio
 * Storage Engine: Cloudflare D1 (SQLite Edge Database)
 */

const TELEGRAM_BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN_HERE";
const TELEGRAM_CHAT_ID = "YOUR_TELEGRAM_CHAT_ID_HERE";
const DEFAULT_ADMIN_PIN = "fikat2026";
const ROOT_ADMIN_USERNAME = "fikat";
const JWT_SECRET = "fikat_cloud_super_secret_signing_key_2026";

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
      return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
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

    // ── Version Info API ──────────────────────────────────────────────────────
    if (pathname === "/api/version" && request.method === "GET") {
      return jsonRes({
        appId: "suno-bulk-studio",
        name: "Suno Bulk Studio",
        currentVersion: "3.3",
        releaseDate: "16/09/2026",
        status: "stable",
        statusText: "Hoạt động ổn định",
        download: {
          zipFile: "Suno_Bulk_Downloader.zip",
          fileName: "Suno_Bulk_Downloader.zip",
          directUrl: "https://github.com/fikatuwu/fikat/releases/download/v3.3/Suno_Bulk_Downloader.zip",
          fileSize: "116.8 MB",
          architecture: "Windows x64 (Win 10 / 11)"
        },
        highlights: [
          "✨ Giao diện độc lập hoàn toàn, đăng nhập popup riêng biệt và tự động cập nhật In-App",
          "🚀 Tái cấu trúc bộ xử lý âm thanh Native Direct Stream: Lưu nhạc MP3 từ Suno tức thì 0ms, bảo tồn 100% chất lượng gốc không nén lại",
          "🛠️ Khắc phục triệt để lỗi FFmpeg mã 69 [mp3float Header missing] bằng bộ nhận diện định dạng âm thanh chuyên sâu 8 lớp (DetectAudioContainer)",
          "🧹 Tự động dọn dẹp file hỏng: Xóa sạch ngay lập tức file rác dở dang < 50KB, loại bỏ hoàn toàn tình trạng sinh ra các file 00s/01s và duplicate _2, _3, _4",
          "📥 Tích hợp tính năng Tải bản cập nhật trực tiếp ngay trong ứng dụng kèm thanh tiến trình siêu tốc và nút mở chạy ngay",
          "🔄 Đồng bộ hóa toàn diện các cải tiến cho cả hai phiên bản Online v3.3 và Offline Studio v2.0"
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
        const isRootAdmin = isFirstUser || rawUsername === ROOT_ADMIN_USERNAME;
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
        const allowedTools = isRootAdmin ? '["suno-bulk-studio","tool-random-nhac"]' : '[]';

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
            allowedTools: ["suno-bulk-studio", "tool-random-nhac"]
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
          const currentExpiry = target.licensedUntil ? new Date(target.licensedUntil) : new Date();
          const baseTime = currentExpiry > new Date() ? currentExpiry.getTime() : Date.now();
          untilDate = new Date(baseTime + days * 24 * 3600 * 1000);
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

        // Tìm nhân viên sở hữu máy (HWID) hoặc licenseKey
        let ownerUser = null;
        if (hwid && hwid !== "UNKNOWN_HWID") {
          ownerUser = await env.DB.prepare("SELECT id, username, fullName, licenseKey FROM users WHERE hwid = ? AND hwid != ''").bind(hwid).first();
        }
        if (!ownerUser && licenseKey && licenseKey !== "Free / Trial" && !licenseKey.startsWith("DESKTOP-")) {
          ownerUser = await env.DB.prepare("SELECT id, username, fullName, licenseKey FROM users WHERE licenseKey = ? AND licenseKey != ''").bind(licenseKey).first();
        }
        if (!ownerUser && hwid) {
          const m = await env.DB.prepare("SELECT username, fullName, licenseKey FROM hwids WHERE hwid = ? AND fullName != '' AND fullName NOT LIKE 'DESKTOP-%'").bind(hwid).first();
          if (m) ownerUser = m;
        }

        const finalName = ownerUser?.fullName || "";
        const finalUsername = ownerUser?.username || "";
        const finalKey = ownerUser?.licenseKey || (licenseKey.startsWith("DESKTOP-") ? "Suno Client" : licenseKey);

        // Lưu / cập nhật HWID
        await env.DB.prepare(`
          INSERT INTO hwids (hwid, licenseKey, username, fullName, role, registeredAt, lastSeen)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(hwid) DO UPDATE SET
            licenseKey = CASE WHEN excluded.licenseKey != '' AND excluded.licenseKey NOT LIKE 'DESKTOP-%' THEN excluded.licenseKey ELSE hwids.licenseKey END,
            username = CASE WHEN excluded.username != '' THEN excluded.username ELSE hwids.username END,
            fullName = CASE WHEN excluded.fullName != '' THEN excluded.fullName ELSE hwids.fullName END,
            lastSeen = excluded.lastSeen,
            role = excluded.role
        `).bind(hwid, finalKey, finalUsername, finalName, role, vnTime, vnTime).run();

        // Batch insert logs
        const insertStmt = env.DB.prepare(`
          INSERT INTO logs (hwid, licenseKey, userId, username, fullName, clipId, title, prompt, tags, actionType, appVersion, timeVn, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const batch = items.map(item => insertStmt.bind(
          hwid,
          finalKey,
          ownerUser?.id || "",
          finalUsername,
          finalName,
          item.clipId || "",
          item.title || "Chưa có tên bài",
          item.prompt || "",
          item.tags || "",
          item.actionType || "MP3",
          appVersion,
          vnTime,
          item.timestamp || nowIso
        ));

        await env.DB.batch(batch);

        // Bắn Telegram thông báo ngầm
        ctx.waitUntil(sendTelegramAlert(env, payload, items, vnTime));

        return jsonRes({
          ok: true,
          message: `Đã ghi nhận thành công ${items.length} bài hát.`,
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
};

// ============================================================================
// HELPERS
// ============================================================================

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

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(`${password}:${salt}:fikat_salt_2026`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
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
      allowedTools: ["suno-bulk-studio", "tool-random-nhac"]
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

  let songListText = "";
  items.slice(0, 6).forEach((item, i) => {
    songListText += `  ${i + 1}. 🎵 <b>${escapeHtml(item.title || "Không có tên")}</b> [<i>${escapeHtml(item.actionType || "MP3")}</i>]\n`;
  });
  if (items.length > 6) songListText += `  ... và ${items.length - 6} bài khác.\n`;

  const message =
    `🚀 <b>[Suno Bulk Studio] Khách vừa tải nhạc!</b>\n\n` +
    `👤 <b>Vai trò:</b> <b>${roleIcon}</b>\n` +
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
