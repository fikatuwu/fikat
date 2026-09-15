/**
 * Cloudflare Worker for fikat.cloud
 * Hệ thống Quản trị, Phân quyền & Giám sát Lịch sử Tải Suno Bulk Studio
 * 
 * Tính năng chính:
 * 1. Đăng ký & Đăng nhập tài khoản (Họ và tên, Tài khoản, Mật khẩu)
 * 2. Phân quyền chặt chẽ (Quản trị viên & Nhân viên):
 *    - Tài khoản Root Admin (tài khoản đầu tiên hoặc tài khoản của bạn): Toàn quyền, DUY NHẤT được xóa quyền Admin.
 *    - Admin: Được nâng tài khoản khác lên Admin, được quyền chặn và kích hoạt key của Nhân viên.
 *    - Không Admin nào được xóa quyền Admin (ngoại trừ Root Admin).
 *    - Nhân viên: Xem thông tin cá nhân, key bản quyền, hạn dùng và lịch sử tải của chính mình.
 * 3. Ghi nhận Telemetry & Lịch sử tải nhạc realtime per HWID / User
 * 4. Thông báo Telegram Bot tự động
 * 5. Tương thích Cloudflare KV Storage + In-Memory Fallback
 */

// Cấu hình Telegram Bot & Admin Gốc mặc định
const TELEGRAM_BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN_HERE";
const TELEGRAM_CHAT_ID = "YOUR_TELEGRAM_CHAT_ID_HERE";
const DEFAULT_ADMIN_PIN = "fikat2026";
const ROOT_ADMIN_USERNAME = "fikat"; // Tên tài khoản gốc mặc định nếu đăng ký
const JWT_SECRET = "fikat_cloud_super_secret_signing_key_2026";

// Bộ đệm in-memory (fallback nếu Cloudflare KV chưa được bind)
const inMemoryUsers = new Map();
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
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Pin, X-Auth-Token",
        },
      });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8",
    };

    // Helper trả về JSON
    const jsonRes = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: corsHeaders });

    // ------------------------------------------------------------------------
    // Route: / và /index.html -> Luôn phục vụ trang chủ (không cần đăng nhập)
    // ------------------------------------------------------------------------
    if (pathname === "/" || pathname === "/index.html") {
      return await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
    }

    // ------------------------------------------------------------------------
    // Route: /admin -> Phục vụ admin.html (cần đăng nhập)
    // ------------------------------------------------------------------------
    if (pathname === "/admin" || pathname === "/admin/") {
      return await env.ASSETS.fetch(new Request(new URL("/admin.html", request.url), request));
    }

    // ========================================================================
    // PHẦN 1: AUTHENTICATION (ĐĂNG KÝ, ĐĂNG NHẬP, PROFILE)
    // ========================================================================

    // 1.1 POST /api/auth/register (Đăng ký tài khoản)
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

        const users = await getAllUsers(env);
        const existing = users.find(u => u.username === rawUsername);
        if (existing) {
          return jsonRes({ ok: false, message: "Tên tài khoản này đã tồn tại trên hệ thống." }, 400);
        }

        // Kiểm tra quyền Root Admin:
        // - Tài khoản đăng ký đầu tiên trên hệ thống HOẶC username là ROOT_ADMIN_USERNAME
        const isFirstUser = users.length === 0;
        const isRootAdmin = isFirstUser || rawUsername === ROOT_ADMIN_USERNAME;
        const role = isRootAdmin ? "Quản trị viên" : "Nhân viên";

        const salt = generateRandomHex(16);
        const passwordHash = await hashPassword(password, salt);
        const nowIso = new Date().toISOString();
        const vnTime = getVnTime();

        // Key bản quyền mặc định
        const licenseKey = isRootAdmin 
          ? `ADMIN-ROOT-${generateRandomHex(4).toUpperCase()}` 
          : `NV-${generateRandomHex(4).toUpperCase()}-${generateRandomHex(4).toUpperCase()}`;

        const newUser = {
          id: `usr_${Date.now()}_${generateRandomHex(4)}`,
          fullName,
          username: rawUsername,
          passwordHash,
          salt,
          role,
          isRootAdmin,
          status: isRootAdmin ? "active" : "pending", // pending = chờ Admin duyệt
          allowedTools: isRootAdmin ? ["suno-bulk-studio", "tool-random-nhac"] : [], // Tools được phép
          licenseKey,
          licensedUntil: isRootAdmin ? "2099-12-31T23:59:59.000Z" : null,
          hwid: "",
          createdAt: vnTime,
          updatedAt: vnTime,
        };

        users.push(newUser);
        await saveAllUsers(env, users);

        if (isRootAdmin) {
          const token = await createAuthToken(newUser);
          return jsonRes({
            ok: true,
            message: "Đăng ký thành công! Bạn là Quản trị viên tối cao (Root Admin) của hệ thống.",
            token,
            user: sanitizeUser(newUser),
          });
        }

        // Nhân viên mới → chờ duyệt, KHÔNG cấp token
        return jsonRes({
          ok: true,
          pending: true,
          message: "Đăng ký thành công! Tài khoản của bạn đang chờ Quản trị viên phê duyệt. Vui lòng liên hệ Admin để được kích hoạt.",
        });
      } catch (err) {
        return jsonRes({ ok: false, message: "Lỗi đăng ký: " + err.message }, 500);
      }
    }

    // 1.2 POST /api/auth/login (Đăng nhập tài khoản)
    if (pathname === "/api/auth/login" && request.method === "POST") {
      try {
        const body = await request.json();
        const rawUsername = (body.username || "").trim().toLowerCase();
        const password = (body.password || "").trim();

        if (!rawUsername || !password) {
          return jsonRes({ ok: false, message: "Vui lòng nhập tài khoản và mật khẩu." }, 400);
        }

        const users = await getAllUsers(env);
        const user = users.find(u => u.username === rawUsername);

        if (!user) {
          return jsonRes({ ok: false, message: "Tài khoản không tồn tại." }, 401);
        }

        const checkHash = await hashPassword(password, user.salt);
        if (checkHash !== user.passwordHash) {
          return jsonRes({ ok: false, message: "Mật khẩu không chính xác." }, 401);
        }

        // Kiểm tra tài khoản đang chờ duyệt
        if (user.status === "pending") {
          return jsonRes({ 
            ok: false, 
            message: "Tài khoản của bạn đang chờ Quản trị viên phê duyệt. Vui lòng chờ hoặc liên hệ Admin!" 
          }, 403);
        }

        // Kiểm tra tài khoản có bị khóa không
        if (user.status === "blocked") {
          return jsonRes({ 
            ok: false, 
            message: "Tài khoản của bạn đã bị Quản trị viên khóa. Vui lòng liên hệ Admin để mở lại!" 
          }, 403);
        }

        const token = await createAuthToken(user);
        return jsonRes({
          ok: true,
          message: "Đăng nhập thành công!",
          token,
          user: sanitizeUser(user),
        });
      } catch (err) {
        return jsonRes({ ok: false, message: "Lỗi đăng nhập: " + err.message }, 500);
      }
    }

    // 1.3 GET /api/auth/me (Lấy thông tin tài khoản hiện tại)
    if (pathname === "/api/auth/me" && request.method === "GET") {
      const authUser = await getAuthenticatedUser(request, env);
      if (!authUser) {
        return jsonRes({ ok: false, message: "Phiên đăng nhập đã hết hạn." }, 401);
      }
      return jsonRes({ ok: true, user: sanitizeUser(authUser) });
    }

    // 1.4 POST /api/admin/auth (Tương thích ngược với mã PIN cũ)
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
    // PHẦN 2: QUẢN TRỊ PHÂN QUYỀN (DÀNH CHO ADMIN & ROOT ADMIN)
    // ========================================================================

    // 2.1 GET /api/admin/users (Lấy danh sách tất cả tài khoản)
    if (pathname === "/api/admin/users" && request.method === "GET") {
      const authUser = await getAuthenticatedUser(request, env);
      if (!authUser || authUser.role !== "Quản trị viên") {
        return jsonRes({ ok: false, message: "Yêu cầu quyền Quản trị viên." }, 403);
      }

      const users = await getAllUsers(env);
      const safeUsers = users.map(u => sanitizeUser(u));
      return jsonRes({
        ok: true,
        users: safeUsers,
        currentUser: sanitizeUser(authUser),
      });
    }

    // 2.2 POST /api/admin/user/role (Nâng / Hạ quyền)
    // QUY TẮC:
    // - Bất kỳ Admin nào cũng được nâng Nhân viên lên Admin ("admin được quyền nâng tài khoản khác lên admin")
    // - CHỈ DUY NHẤT tài khoản của bạn (Root Admin) mới được quyền xóa quyền admin ("chỉ riêng tài khoản của tôi được xóa quyền admin")
    if (pathname === "/api/admin/user/role" && request.method === "POST") {
      const authUser = await getAuthenticatedUser(request, env);
      if (!authUser || authUser.role !== "Quản trị viên") {
        return jsonRes({ ok: false, message: "Yêu cầu quyền Quản trị viên." }, 403);
      }

      try {
        const body = await request.json();
        const targetUserId = (body.targetUserId || "").trim();
        const newRole = (body.newRole || "").trim(); // "Quản trị viên" | "Nhân viên"

        if (!targetUserId || (newRole !== "Quản trị viên" && newRole !== "Nhân viên")) {
          return jsonRes({ ok: false, message: "Dữ liệu phân quyền không hợp lệ." }, 400);
        }

        const users = await getAllUsers(env);
        const targetUser = users.find(u => u.id === targetUserId);
        if (!targetUser) {
          return jsonRes({ ok: false, message: "Không tìm thấy người dùng này." }, 404);
        }

        // Không ai được can thiệp vào tài khoản Root Admin
        if (targetUser.isRootAdmin && !authUser.isRootAdmin) {
          return jsonRes({ ok: false, message: "Không thể chỉnh sửa tài khoản Quản trị viên tối cao!" }, 403);
        }

        // Nếu muốn XÓA QUYỀN ADMIN (Hạ từ Quản trị viên xuống Nhân viên):
        if (targetUser.role === "Quản trị viên" && newRole === "Nhân viên") {
          if (!authUser.isRootAdmin) {
            return jsonRes({ 
              ok: false, 
              message: "TỪ CHỐI: Chỉ riêng tài khoản Quản trị viên tối cao (Chủ sở hữu) mới có quyền xóa quyền Quản trị viên!" 
            }, 403);
          }
          if (targetUser.id === authUser.id) {
            return jsonRes({ ok: false, message: "Bạn không thể tự tước quyền Quản trị viên của chính mình!" }, 400);
          }
        }

        // Nâng lên Admin hoặc hạ xuống Nhân viên bởi Root Admin
        targetUser.role = newRole;
        targetUser.updatedAt = getVnTime();

        await saveAllUsers(env, users);

        return jsonRes({
          ok: true,
          message: `Đã chuyển vai trò của [${targetUser.fullName}] thành: ${newRole}`,
          user: sanitizeUser(targetUser),
        });
      } catch (e) {
        return jsonRes({ ok: false, message: e.message }, 500);
      }
    }

    // 2.3 POST /api/admin/user/block (Chặn hoặc Mở khóa tài khoản Nhân viên)
    if (pathname === "/api/admin/user/block" && request.method === "POST") {
      const authUser = await getAuthenticatedUser(request, env);
      if (!authUser || authUser.role !== "Quản trị viên") {
        return jsonRes({ ok: false, message: "Yêu cầu quyền Quản trị viên." }, 403);
      }

      try {
        const body = await request.json();
        const targetUserId = (body.targetUserId || "").trim();
        const blocked = Boolean(body.blocked);

        const users = await getAllUsers(env);
        const targetUser = users.find(u => u.id === targetUserId);
        if (!targetUser) {
          return jsonRes({ ok: false, message: "Không tìm thấy người dùng này." }, 404);
        }

        // Không được phép chặn Admin khác (chỉ Root Admin mới có thể chặn Admin, và không ai được chặn Root Admin)
        if (targetUser.role === "Quản trị viên" && !authUser.isRootAdmin) {
          return jsonRes({ ok: false, message: "Bạn chỉ được quyền chặn tài khoản Nhân viên, không thể chặn Quản trị viên!" }, 403);
        }
        if (targetUser.isRootAdmin) {
          return jsonRes({ ok: false, message: "Không thể chặn tài khoản Quản trị viên tối cao!" }, 403);
        }

        targetUser.status = blocked ? "blocked" : "active";
        targetUser.updatedAt = getVnTime();

        await saveAllUsers(env, users);

        return jsonRes({
          ok: true,
          message: blocked 
            ? `Đã khóa (chặn) tài khoản [${targetUser.fullName}] thành công!` 
            : `Đã mở khóa tài khoản [${targetUser.fullName}] thành công!`,
          user: sanitizeUser(targetUser),
        });
      } catch (e) {
        return jsonRes({ ok: false, message: e.message }, 500);
      }
    }

    // 2.4 POST /api/admin/user/license (Kích hoạt bản quyền / cấp Key cho Nhân viên)
    if (pathname === "/api/admin/user/license" && request.method === "POST") {
      const authUser = await getAuthenticatedUser(request, env);
      if (!authUser || authUser.role !== "Quản trị viên") {
        return jsonRes({ ok: false, message: "Yêu cầu quyền Quản trị viên." }, 403);
      }

      try {
        const body = await request.json();
        const targetUserId = (body.targetUserId || "").trim();
        const days = parseInt(body.days || 30, 10); // 30, 90, 365, 9999 (Vĩnh viễn)

        const users = await getAllUsers(env);
        const targetUser = users.find(u => u.id === targetUserId);
        if (!targetUser) {
          return jsonRes({ ok: false, message: "Không tìm thấy người dùng này." }, 404);
        }

        let untilDate;
        if (days >= 9999) {
          untilDate = new Date("2099-12-31T23:59:59.000Z");
        } else {
          const currentExpiry = targetUser.licensedUntil ? new Date(targetUser.licensedUntil) : new Date();
          const baseTime = currentExpiry > new Date() ? currentExpiry.getTime() : Date.now();
          untilDate = new Date(baseTime + days * 24 * 3600 * 1000);
        }

        if (!targetUser.licenseKey) {
          targetUser.licenseKey = `NV-${generateRandomHex(4).toUpperCase()}-${generateRandomHex(4).toUpperCase()}`;
        }

        targetUser.licensedUntil = untilDate.toISOString();
        targetUser.updatedAt = getVnTime();

        await saveAllUsers(env, users);

        return jsonRes({
          ok: true,
          message: `Đã kích hoạt bản quyền cho [${targetUser.fullName}] đến ${targetUser.licensedUntil.substring(0, 10)}!`,
          licenseKey: targetUser.licenseKey,
          licensedUntil: targetUser.licensedUntil,
          user: sanitizeUser(targetUser),
        });
      } catch (e) {
        return jsonRes({ ok: false, message: e.message }, 500);
      }
    }

    // 2.5 POST /api/admin/user/approve (Duyệt tài khoản chờ & gán tools)
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

        const users = await getAllUsers(env);
        const target = users.find(u => u.id === targetId);
        if (!target) return jsonRes({ ok: false, message: "Không tìm thấy tài khoản." }, 404);
        if (target.status !== "pending") return jsonRes({ ok: false, message: "Tài khoản này không ở trạng thái chờ duyệt." }, 400);

        target.status = "active";
        target.role = role;
        target.allowedTools = tools;
        target.updatedAt = getVnTime();

        await saveAllUsers(env, users);
        return jsonRes({ ok: true, message: `Đã duyệt tài khoản [${target.fullName}] với ${tools.length} tool!`, user: sanitizeUser(target) });
      } catch (e) {
        return jsonRes({ ok: false, message: e.message }, 500);
      }
    }

    // 2.6 POST /api/admin/user/reject (Từ chối & xóa tài khoản chờ)
    if (pathname === "/api/admin/user/reject" && request.method === "POST") {
      try {
        const authUser = await getAuthenticatedUser(request, env);
        if (!authUser || authUser.role !== "Quản trị viên") {
          return jsonRes({ ok: false, message: "Chỉ Admin mới được từ chối tài khoản." }, 403);
        }
        const body = await request.json();
        const targetId = body.targetUserId;

        let users = await getAllUsers(env);
        const target = users.find(u => u.id === targetId);
        if (!target) return jsonRes({ ok: false, message: "Không tìm thấy tài khoản." }, 404);

        users = users.filter(u => u.id !== targetId);
        await saveAllUsers(env, users);
        return jsonRes({ ok: true, message: `Đã từ chối và xóa tài khoản [${target.fullName}].` });
      } catch (e) {
        return jsonRes({ ok: false, message: e.message }, 500);
      }
    }

    // 2.7 POST /api/admin/user/tools (Cập nhật Tools được phép của user)
    if (pathname === "/api/admin/user/tools" && request.method === "POST") {
      try {
        const authUser = await getAuthenticatedUser(request, env);
        if (!authUser || authUser.role !== "Quản trị viên") {
          return jsonRes({ ok: false, message: "Chỉ Admin mới được sửa quyền tool." }, 403);
        }
        const body = await request.json();
        const targetId = body.targetUserId;
        const tools = Array.isArray(body.allowedTools) ? body.allowedTools : [];

        const users = await getAllUsers(env);
        const target = users.find(u => u.id === targetId);
        if (!target) return jsonRes({ ok: false, message: "Không tìm thấy tài khoản." }, 404);

        target.allowedTools = tools;
        target.updatedAt = getVnTime();
        await saveAllUsers(env, users);
        return jsonRes({ ok: true, message: `Đã cập nhật quyền tool cho [${target.fullName}]!`, user: sanitizeUser(target) });
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
        const appVersion = (payload.appVersion || "3.1").trim();
        const items = Array.isArray(payload.items) ? payload.items : [];

        // Kiểm tra xem máy hoặc key có bị admin chặn không
        const isBlocked = await checkIsBlocked(env, hwid, licenseKey);
        if (isBlocked) {
          return jsonRes({ 
            ok: false, 
            blocked: true, 
            message: "Thiết bị hoặc tài khoản của bạn đã bị Quản trị viên khóa. Không thể tải nhạc!" 
          }, 403);
        }

        if (items.length === 0) {
          return jsonRes({ ok: true, message: "Không có bài hát để ghi nhận." });
        }

        const nowIso = new Date().toISOString();
        const vnTime = getVnTime();

        // ── Tìm nhân viên sở hữu key này để gắn log vào tài khoản ──
        const allUsers = await getAllUsers(env);
        const ownerUser = allUsers.find(u => u.licenseKey && u.licenseKey === licenseKey);
        const ownerUserId   = ownerUser ? ownerUser.id        : null;
        const ownerUsername = ownerUser ? ownerUser.username  : null;
        const ownerFullName = ownerUser ? ownerUser.fullName  : null;

        const processedItems = items.map((item, idx) => ({
          id: `${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
          hwid,
          licenseKey,
          role,
          // ── Liên kết tài khoản nhân viên ──
          userId: ownerUserId,
          username: ownerUsername,
          fullName: ownerFullName,
          clipId: item.clipId || "",
          title: item.title || "Chưa có tên bài",
          prompt: item.prompt || "",
          tags: item.tags || "",
          actionType: item.actionType || "MP3",
          appVersion,
          timestamp: item.timestamp || nowIso,
          timeVn: vnTime,
        }));

        // Lưu vào KV hoặc Fallback In-memory
        if (env.DOWNLOAD_LOGS) {
          // Index HWID
          let hwidIndex = [];
          try {
            const rawIndex = await env.DOWNLOAD_LOGS.get("hwids_index");
            if (rawIndex) hwidIndex = JSON.parse(rawIndex);
          } catch (e) {}

          let existingHwid = hwidIndex.find(h => h.hwid === hwid);
          if (!existingHwid) {
            existingHwid = {
              hwid,
              licenseKey,
              role,
              firstSeen: vnTime,
              lastSeen: vnTime,
              totalDownloads: 0,
            };
            hwidIndex.unshift(existingHwid);
          } else {
            existingHwid.lastSeen = vnTime;
            if (role === "Admin") existingHwid.role = "Admin";
            if (licenseKey && licenseKey !== "Free / Trial") existingHwid.licenseKey = licenseKey;
          }
          existingHwid.totalDownloads = (existingHwid.totalDownloads || 0) + processedItems.length;
          if (hwidIndex.length > 1000) hwidIndex = hwidIndex.slice(0, 1000);
          await env.DOWNLOAD_LOGS.put("hwids_index", JSON.stringify(hwidIndex));

          // Logs theo HWID
          let hwidLogs = [];
          try {
            const rawLogs = await env.DOWNLOAD_LOGS.get(`logs:${hwid}`);
            if (rawLogs) hwidLogs = JSON.parse(rawLogs);
          } catch (e) {}
          hwidLogs = [...processedItems, ...hwidLogs].slice(0, 1000);
          await env.DOWNLOAD_LOGS.put(`logs:${hwid}`, JSON.stringify(hwidLogs));
        } else {
          let hInfo = inMemoryHWIDs.get(hwid) || {
            hwid,
            licenseKey,
            role,
            firstSeen: vnTime,
            lastSeen: vnTime,
            totalDownloads: 0,
          };
          hInfo.lastSeen = vnTime;
          if (role === "Admin") hInfo.role = "Admin";
          hInfo.totalDownloads += processedItems.length;
          inMemoryHWIDs.set(hwid, hInfo);

          let currentLogs = inMemoryLogs.get(hwid) || [];
          inMemoryLogs.set(hwid, [...processedItems, ...currentLogs].slice(0, 1000));
        }

        // Bắn Telegram thông báo
        if (ctx && ctx.waitUntil) {
          ctx.waitUntil(sendTelegramAlert(env, { ...payload, role }, processedItems, vnTime));
        } else {
          sendTelegramAlert(env, { ...payload, role }, processedItems, vnTime).catch(() => {});
        }

        return jsonRes({
          ok: true,
          loggedCount: processedItems.length,
          hwid,
          timestamp: nowIso,
        });
      } catch (err) {
        return jsonRes({ ok: false, error: err.message }, 500);
      }
    }

    // 3.2 GET /api/admin/data (Lấy thống kê & lịch sử tải)
    if (pathname === "/api/admin/data" && request.method === "GET") {
      const authUser = await getAuthenticatedUser(request, env);
      if (!authUser) {
        return jsonRes({ ok: false, message: "Chưa đăng nhập." }, 401);
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
        } else if (authUser.role === "Quản trị viên") {
          // Admin xem top 500 bài của mọi máy
          const topHwids = hwidList.slice(0, 15);
          for (const h of topHwids) {
            try {
              const rawLogs = await env.DOWNLOAD_LOGS.get(`logs:${h.hwid}`);
              if (rawLogs) {
                const subLogs = JSON.parse(rawLogs);
                logs.push(...subLogs.slice(0, 40));
              }
            } catch (e) {}
          }
          logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          logs = logs.slice(0, 500);
        } else {
          // Nhân viên KHÔNG được xem lịch sử tải nhạc
          logs = [];
        }
      } else {
        hwidList = Array.from(inMemoryHWIDs.values());
        if (targetHwid) {
          logs = inMemoryLogs.get(targetHwid) || [];
        } else if (authUser.role === "Quản trị viên") {
          for (const lList of inMemoryLogs.values()) {
            logs.push(...lList.slice(0, 40));
          }
          logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          logs = logs.slice(0, 500);
        } else {
          // Nhân viên KHÔNG được xem lịch sử tải nhạc (in-memory)
          logs = [];
        }
      }

      // ── Làm giàu hwidList với thông tin nhân viên sở hữu key ──
      const usersForEnrich = await getAllUsers(env);
      hwidList = hwidList.map(h => {
        const owner = usersForEnrich.find(u => u.licenseKey && u.licenseKey === h.licenseKey);
        return {
          ...h,
          ownerUserId:   owner ? owner.id       : null,
          ownerUsername: owner ? owner.username  : null,
          ownerFullName: owner ? owner.fullName  : null,
        };
      });

      // ── Làm giàu log cũ chưa có userId bằng cách tra licenseKey ──
      logs = logs.map(l => {
        if (!l.userId && l.licenseKey) {
          const owner = usersForEnrich.find(u => u.licenseKey === l.licenseKey);
          if (owner) return { ...l, userId: owner.id, username: owner.username, fullName: owner.fullName };
        }
        return l;
      });

      // Thống kê
      const totalMachines = hwidList.length;
      const totalDownloads = hwidList.reduce((sum, h) => sum + (h.totalDownloads || 0), 0);
      const todayStr = getVnTime().substring(0, 10);
      const todayDownloads = logs.filter(
        l => (l.timeVn || l.timestamp || "").startsWith(todayStr)
      ).length;
      const totalStems = logs.filter(
        l => (l.actionType || "").toLowerCase().includes("stem")
      ).length;

      return jsonRes({
        ok: true,
        storageMode: env.DOWNLOAD_LOGS ? "Cloudflare_KV" : "InMemory_Fallback",
        userRole: authUser.role,
        isRootAdmin: Boolean(authUser.isRootAdmin),
        stats: {
          totalMachines,
          totalDownloads,
          todayDownloads,
          totalStems,
        },
        hwidList: authUser.role === "Quản trị viên" ? hwidList : [],
        logs,
      });
    }

    // 3.3 GET /api/license/role (App C# kiểm tra vai trò & trạng thái kích hoạt)
    if (pathname === "/api/license/role" && request.method === "GET") {
      const qHwid = (url.searchParams.get("hwid") || "").trim();
      const qKey = (url.searchParams.get("key") || "").trim();

      let role = "Nhân viên";
      let customerName = "Nhân viên";
      let isBlocked = false;
      let licensedUntil = null;

      // Tìm trong User Database xem có gắn HWID hoặc Key này không
      const users = await getAllUsers(env);
      const matchedUser = users.find(
        u => (qHwid && u.hwid === qHwid) || (qKey && u.licenseKey === qKey)
      );

      if (matchedUser) {
        role = matchedUser.role === "Quản trị viên" ? "Admin" : "Nhân viên";
        customerName = matchedUser.fullName;
        isBlocked = matchedUser.status === "blocked";
        licensedUntil = matchedUser.licensedUntil;
      } else {
        if (env.DOWNLOAD_LOGS) {
          try {
            const raw = await env.DOWNLOAD_LOGS.get("hwids_index");
            if (raw) {
              const idx = JSON.parse(raw);
              const found = idx.find(h => h.hwid === qHwid);
              if (found) {
                role = found.role || "Nhân viên";
                customerName = found.licenseKey || role;
                isBlocked = Boolean(found.blocked);
              }
            }
          } catch (e) {}
        }
      }

      return jsonRes({
        ok: true,
        hwid: qHwid,
        role,
        customerName,
        isBlocked,
        licensedUntil,
      });
    }

    // ========================================================================
    // PHẦN 4: STATIC ASSETS & SPA ROUTING
    // ========================================================================
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

// ============================================================================
// CÁC HÀM TIỆN ÍCH (HELPERS & CRYPTO)
// ============================================================================

/**
 * Lấy danh sách toàn bộ Users từ KV hoặc in-memory
 */
async function getAllUsers(env) {
  if (env.DOWNLOAD_LOGS) {
    try {
      const raw = await env.DOWNLOAD_LOGS.get("users_data");
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  }
  return Array.from(inMemoryUsers.values());
}

/**
 * Lưu danh sách Users vào KV hoặc in-memory
 */
async function saveAllUsers(env, users) {
  if (env.DOWNLOAD_LOGS) {
    await env.DOWNLOAD_LOGS.put("users_data", JSON.stringify(users));
  } else {
    inMemoryUsers.clear();
    users.forEach(u => inMemoryUsers.set(u.id, u));
  }
}

/**
 * Lọc bỏ mật khẩu trước khi trả về client
 */
function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, salt, ...safe } = user;
  return safe;
}

/**
 * Hash mật khẩu bằng SHA-256 kèm Salt
 */
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(`${password}:${salt}:fikat_salt_2026`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Tạo Random Hex string
 */
function generateRandomHex(len = 8) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Tạo token phiên đăng nhập
 */
async function createAuthToken(user) {
  const payload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    isRootAdmin: Boolean(user.isRootAdmin),
    exp: Date.now() + 7 * 24 * 3600 * 1000, // 7 ngày
  };
  const str = JSON.stringify(payload);
  const base64Payload = btoa(unescape(encodeURIComponent(str)));
  const sig = await hashPassword(base64Payload, JWT_SECRET);
  return `${base64Payload}.${sig.substring(0, 16)}`;
}

/**
 * Xác thực token từ request header
 */
async function getAuthenticatedUser(request, env) {
  // Hỗ trợ mã PIN gốc cho backward compatibility
  const pinHeader = request.headers.get("X-Admin-Pin");
  const targetPin = (env.ADMIN_PIN || DEFAULT_ADMIN_PIN).trim();
  if (pinHeader && pinHeader === targetPin) {
    return {
      id: "root_pin_user",
      fullName: "Quản trị viên (Master)",
      username: "fikat",
      role: "Quản trị viên",
      isRootAdmin: true,
      status: "active",
    };
  }

  // Lấy token từ Authorization: Bearer <token> hoặc X-Auth-Token
  const authHeader = request.headers.get("Authorization") || request.headers.get("X-Auth-Token") || "";
  let token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const base64Payload = parts[0];
    const clientSig = parts[1];

    const expectedSig = (await hashPassword(base64Payload, JWT_SECRET)).substring(0, 16);
    if (clientSig !== expectedSig) return null;

    const jsonStr = decodeURIComponent(escape(atob(base64Payload)));
    const payload = JSON.parse(jsonStr);

    if (Date.now() > payload.exp) return null; // Hết hạn

    const users = await getAllUsers(env);
    const user = users.find(u => u.id === payload.userId || u.username === payload.username);
    if (!user || user.status === "blocked") return null;

    return user;
  } catch (e) {
    return null;
  }
}

/**
 * Kiểm tra xem máy hoặc key có bị admin chặn không
 */
async function checkIsBlocked(env, hwid, licenseKey) {
  const users = await getAllUsers(env);
  const blockedUser = users.find(
    u => u.status === "blocked" && ((hwid && u.hwid === hwid) || (licenseKey && u.licenseKey === licenseKey))
  );
  if (blockedUser) return true;

  if (env.DOWNLOAD_LOGS) {
    try {
      const raw = await env.DOWNLOAD_LOGS.get("hwids_index");
      if (raw) {
        const idx = JSON.parse(raw);
        const found = idx.find(h => h.hwid === hwid);
        if (found && found.blocked) return true;
      }
    } catch (e) {}
  }
  return false;
}

/**
 * Lấy giờ Việt Nam định dạng YYYY-MM-DD HH:mm:ss
 */
function getVnTime() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().replace("T", " ").substring(0, 19);
}

/**
 * Bắn thông báo Telegram
 */
async function sendTelegramAlert(env, payload, items, vnTime) {
  const botToken = (env.TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = (env.TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID || "").trim();

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
    const roleIcon = payload.role === "Admin" ? "👑 ADMIN" : "💼 NHÂN VIÊN";
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
      `👤 <b>Vai trò:</b> <b>${roleIcon}</b>\n` +
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
