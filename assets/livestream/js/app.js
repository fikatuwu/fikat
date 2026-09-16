/**
 * HaloLi - Livestream Dashboard Application
 * Integrated into fikat.cloud
 */

function getApiBase() {
  const customHost = localStorage.getItem('fikat_livestream_endpoint');
  if (customHost) return customHost.replace(/\/+$/, '') + '/api/livestream';
  if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
    return '/api/livestream';
  }
  return 'http://127.0.0.1:8787/api/livestream';
}

const API_BASE = getApiBase();

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// State
const state = {
  activeTab: new URLSearchParams(window.location.search).get('tab') || 'vps',
  vpsList: [],
  videoFolders: [],
  audioFolders: [],
  streams: [],
  saEmail: 'haloli-bot@haloli-508807.iam.gserviceaccount.com',
  folderFiles: {}, // folderId -> files[]
  loading: false,
};

// Radial Gauge Component Helper
function renderRadialGauge(percent, label, size = 56) {
  const p = Math.min(Math.max(Number(percent) || 0, 0), 100);
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (p / 100) * circumference;

  let strokeColor = '#10b981'; // green
  if (p > 70) strokeColor = '#f97316'; // orange
  if (p > 85) strokeColor = '#ef4444'; // red

  return `
    <div class="flex flex-col items-center">
      <div class="relative flex items-center justify-center" style="width:${size}px; height:${size}px;">
        <svg class="transform -rotate-90" width="${size}" height="${size}" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="${radius}" stroke="#e5e7eb" stroke-width="4" fill="none" />
          <circle cx="28" cy="28" r="${radius}" stroke="${strokeColor}" stroke-width="4" fill="none"
                  stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round" />
        </svg>
        <span class="absolute text-xs font-semibold text-gray-800">${p}%</span>
      </div>
      <span class="text-[11px] font-medium text-gray-500 uppercase mt-1 tracking-wider">${label}</span>
    </div>
  `;
}

// Utility
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(sec) {
  if (!sec) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function switchTab(tabName) {
  state.activeTab = tabName;
  const url = new URL(window.location);
  url.searchParams.set('tab', tabName);
  window.history.pushState({}, '', url);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.className = 'tab-btn flex items-center gap-2 border-b-2 border-indigo-600 px-4 py-3 text-sm font-semibold text-indigo-600 transition-colors';
    } else {
      btn.className = 'tab-btn flex items-center gap-2 border-b-2 border-transparent px-4 py-3 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700 transition-colors';
    }
  });

  document.querySelectorAll('.tab-content').forEach(pane => {
    pane.classList.toggle('hidden', pane.id !== `tab-pane-${tabName}`);
  });

  if (tabName === 'vps') loadVPS();
  if (tabName === 'drive') loadDrive();
  if (tabName === 'streams') loadStreams();
}

// Data Loaders
async function loadSAEmail() {
  try {
    const res = await fetch(`${API_BASE}/drive/sa-email`);
    const data = await res.json();
    if (data.email) {
      state.saEmail = data.email;
      document.querySelectorAll('.sa-email-display').forEach(el => el.textContent = data.email);
    }
  } catch (err) {
    console.warn('Cannot load SA email', err);
  }
}

async function loadVPS() {
  try {
    const res = await fetch(`${API_BASE}/vps`);
    const data = await res.json();
    state.vpsList = data.vps || [];
    renderVPSGrid();
  } catch (err) {
    console.error('Failed to load VPS', err);
  }
}

async function loadDrive() {
  try {
    const [vidRes, audRes] = await Promise.all([
      fetch(`${API_BASE}/drive/folders?kind=video`),
      fetch(`${API_BASE}/drive/folders?kind=audio`)
    ]);
    const vidData = await vidRes.json();
    const audData = await audRes.json();
    state.videoFolders = vidData.folders || [];
    state.audioFolders = audData.folders || [];
    renderDriveTab();
  } catch (err) {
    console.error('Failed to load Drive folders', err);
  }
}

async function loadStreams() {
  try {
    const res = await fetch(`${API_BASE}/streams`);
    const data = await res.json();
    state.streams = data.streams || [];
    renderStreamsTable();
  } catch (err) {
    console.error('Failed to load streams', err);
  }
}

// Render Functions
function renderVPSGrid() {
  const container = document.getElementById('vps-grid-container');
  if (!container) return;

  if (state.vpsList.length === 0) {
    container.innerHTML = `
      <div class="col-span-full rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">
        Chưa có VPS. Bấm "<strong>+ Thêm VPS</strong>" để bắt đầu thiết lập cụm live.
      </div>
    `;
    return;
  }

  container.innerHTML = state.vpsList.map(vps => {
    const isOnline = vps.status === 'online';
    const statusDot = isOnline
      ? '<span class="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600"><span class="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span> Đang hoạt động</span>'
      : '<span class="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400"><span class="h-2 w-2 rounded-full bg-gray-400"></span> Ngoại tuyến</span>';

    const expireBadge = vps.expiresAt
      ? `<span class="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Hết hạn: ${vps.expiresAt}</span>`
      : '';

    return `
      <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
        <div class="h-1.5 ${isOnline ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-gray-300'}"></div>
        <div class="p-5">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 font-bold">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="3" width="20" height="8" rx="2"></rect>
                  <rect x="2" y="13" width="20" height="8" rx="2"></rect>
                  <line x1="6" y1="7" x2="6.01" y2="7"></line>
                  <line x1="6" y1="17" x2="6.01" y2="17"></line>
                </svg>
              </div>
              <div>
                <h3 class="font-bold text-gray-900 text-base">${vps.name}</h3>
                <p class="font-mono text-xs text-gray-500">${vps.sshUsername || 'root'}@${vps.ipAddress}:${vps.sshPort || 22}</p>
              </div>
            </div>
            <div>${statusDot}</div>
          </div>

          <!-- Gauges -->
          <div class="my-5 grid grid-cols-3 gap-2 border-y border-gray-100 py-4">
            ${renderRadialGauge(vps.cpuPercent, 'CPU')}
            ${renderRadialGauge(vps.ramPercent, 'RAM')}
            ${renderRadialGauge(vps.diskPercent, 'DISK')}
          </div>

          <!-- Info & Actions -->
          <div class="space-y-2 text-xs text-gray-600">
            <div class="flex items-center justify-between">
              <span class="text-gray-400">FFmpeg:</span>
              <span class="font-mono truncate max-w-[180px] text-right font-medium text-gray-700" title="${vps.ffmpegVersion || ''}">
                ${vps.ffmpegVersion ? '✓ ' + vps.ffmpegVersion.slice(0, 22) : 'Chưa có'}
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-gray-400">Kiểm tra cuối:</span>
              <span class="text-gray-700 font-mono">${vps.lastCheckAt ? new Date(vps.lastCheckAt).toLocaleTimeString() : 'Chưa'}</span>
            </div>
            ${expireBadge ? `<div class="pt-1">${expireBadge}</div>` : ''}
          </div>

          <div class="mt-5 flex items-center justify-between border-t border-gray-100 pt-3">
            <button onclick="testVPS(${vps.id})" class="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">
              Kiểm tra
            </button>
            <div class="flex items-center gap-3">
              <button onclick="installVPS(${vps.id})" class="text-xs text-gray-500 hover:text-gray-800" title="Cài FFmpeg/Rclone tự động">
                Cài đặt
              </button>
              <button onclick="deleteVPS(${vps.id})" class="text-xs text-red-500 hover:text-red-700">
                Xoá
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderDriveTab() {
  renderFolderTable('video', state.videoFolders, 'video-folders-tbody');
  renderFolderTable('audio', state.audioFolders, 'audio-folders-tbody');
}

function renderFolderTable(kind, folders, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  if (folders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="px-6 py-8 text-center text-sm text-gray-400">
          Chưa có folder ${kind === 'video' ? 'video' : 'audio'}. Share folder cho SA email rồi dán link/Folder ID ở trên.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = folders.map(f => `
    <tr class="hover:bg-gray-50 border-b border-gray-100 transition-colors">
      <td class="px-6 py-4">
        <div class="flex items-center gap-2">
          <span class="text-lg">${kind === 'video' ? '📁' : '🎵'}</span>
          <div>
            <div class="font-medium text-gray-900 text-sm">${f.name}</div>
            <div class="text-xs font-mono text-gray-400">${f.drive_folder_id}</div>
          </div>
        </div>
      </td>
      <td class="px-6 py-4 text-sm text-gray-600 font-semibold">${f.file_count} file</td>
      <td class="px-6 py-4 text-sm text-gray-600">${formatBytes(f.total_size_bytes)}</td>
      <td class="px-6 py-4 text-xs text-gray-400 font-mono">${f.last_sync_at ? new Date(f.last_sync_at).toLocaleString() : 'Chưa'}</td>
      <td class="px-6 py-4 text-right text-xs font-medium space-x-3">
        <button onclick="viewFolderFiles(${f.id}, '${f.name}')" class="text-indigo-600 hover:text-indigo-900">Xem file</button>
        <button onclick="syncFolder(${f.id})" class="text-emerald-600 hover:text-emerald-900">Đồng bộ</button>
        <a href="https://drive.google.com/drive/folders/${f.drive_folder_id}" target="_blank" class="text-gray-500 hover:text-gray-800">Mở Drive</a>
        <button onclick="deleteFolder(${f.id})" class="text-red-500 hover:text-red-700">Xoá</button>
      </td>
    </tr>
  `).join('');
}

function renderStreamsTable() {
  const tbody = document.getElementById('streams-tbody');
  if (!tbody) return;

  if (state.streams.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="px-6 py-12 text-center text-sm text-gray-500">
          Chưa có luồng nào. Bấm "<strong>+ Tạo luồng</strong>" để bắt đầu phát HLS lên YouTube.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.streams.map(s => {
    let statusBadge = '<span class="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">Đã dừng</span>';
    if (s.status === 'running') {
      statusBadge = '<span class="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 animate-pulse">● Đang đẩy</span>';
    } else if (s.status === 'starting') {
      statusBadge = '<span class="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 animate-pulse">⏳ Đang chuẩn bị...</span>';
    } else if (s.status === 'scheduled') {
      statusBadge = '<span class="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">⏱ Lên lịch</span>';
    } else if (s.status === 'error' || s.status === 'dead') {
      statusBadge = `<span class="inline-flex rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 cursor-pointer" title="${(s.last_error || '').replace(/"/g, '&quot;')}">✕ ${s.status === 'dead' ? 'Chết' : 'Lỗi'}</span>`;
    }

    const isRunning = s.status === 'running' || s.status === 'starting';

    return `
      <tr class="hover:bg-gray-50 border-b border-gray-100">
        <td class="px-6 py-4">
          <div class="font-semibold text-gray-900 text-sm">${s.title}</div>
          <div class="text-xs text-gray-400">${s.orientation === 'portrait' ? '📱 Dọc (Shorts)' : '🖥 Ngang (16:9)'} • Audio: ${s.audio_mode}</div>
          ${s.last_error ? `<div class="text-[11px] text-red-500 font-mono mt-0.5 truncate max-w-xs" title="${(s.last_error).replace(/"/g, '&quot;')}">⚠️ ${s.last_error}</div>` : ''}
        </td>
        <td class="px-6 py-4 text-xs text-gray-600">
          <div><strong>VPS:</strong> ${s.vps_name || 'N/A'}</div>
          <div><strong>Folder:</strong> ${s.folder_name || 'N/A'}</div>
        </td>
        <td class="px-6 py-4 text-xs font-medium ${s.status === 'error' ? 'text-red-500' : 'text-emerald-600'}">${s.health_status || 'Ổn định'}</td>
        <td class="px-6 py-4 text-xs text-gray-400 font-mono">
          ${s.scheduled_start_at ? 'Hẹn: ' + new Date(s.scheduled_start_at).toLocaleTimeString() : (s.created_at ? new Date(s.created_at).toLocaleTimeString() : '')}
        </td>
        <td class="px-6 py-4">${statusBadge}</td>
        <td class="px-6 py-4 text-right text-xs space-x-2 font-medium">
          ${isRunning
            ? `<button onclick="stopStream(${s.id})" class="inline-flex items-center rounded bg-red-50 px-2.5 py-1 text-red-600 hover:bg-red-100 font-semibold transition">■ Dừng</button>`
            : `<button onclick="startStream(${s.id}, this)" class="inline-flex items-center rounded bg-emerald-50 px-2.5 py-1 text-emerald-600 hover:bg-emerald-100 font-semibold transition">▶ Phát</button>`
          }
          <button onclick="restartStream(${s.id})" class="text-gray-500 hover:text-gray-800" title="Khởi động lại">⟳</button>
          <button onclick="viewFfmpegLog(${s.id})" class="text-indigo-600 hover:text-indigo-900" title="Xem log FFmpeg">Log</button>
          <button onclick="deleteStream(${s.id})" class="text-red-500 hover:text-red-700" title="Xoá luồng">Xoá</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Action Handlers
async function testVPS(vpsId) {
  try {
    const res = await fetch(`${API_BASE}/vps/${vpsId}/test`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    await loadVPS();
  } catch (err) {
    alert('Kiểm tra thất bại: ' + err.message);
  }
}

async function installVPS(vpsId) {
  if (!confirm('Chạy cài đặt tự động FFmpeg và Rclone trên VPS này?')) return;
  try {
    const res = await fetch(`${API_BASE}/vps/${vpsId}/install`, { method: 'POST' });
    const data = await res.json();
    alert('Cài đặt hoàn tất: ' + (data.output || 'OK'));
    await loadVPS();
  } catch (err) {
    alert('Cài đặt thất bại: ' + err.message);
  }
}

async function deleteVPS(vpsId) {
  if (!confirm('Xoá VPS này khỏi cụm?')) return;
  try {
    await fetch(`${API_BASE}/vps/${vpsId}`, { method: 'DELETE' });
    await loadVPS();
  } catch (err) {
    alert('Xoá thất bại: ' + err.message);
  }
}

async function handleAddFolder(kind) {
  const inputId = kind === 'video' ? 'input-add-video-folder' : 'input-add-audio-folder';
  const input = document.getElementById(inputId);
  if (!input || !input.value.trim()) {
    alert('Vui lòng nhập Link hoặc Folder ID');
    return;
  }
  const raw = input.value.trim();
  try {
    const res = await fetch(`${API_BASE}/drive/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drive_folder_id: raw, kind })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Thêm folder thất bại');
    }
    input.value = '';
    await loadDrive();
  } catch (err) {
    alert(err.message);
  }
}

async function syncFolder(folderId) {
  try {
    const res = await fetch(`${API_BASE}/drive/folders/${folderId}/sync`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    await loadDrive();
  } catch (err) {
    alert('Đồng bộ thất bại: ' + err.message);
  }
}

async function deleteFolder(folderId) {
  if (!confirm('Xoá folder này và toàn bộ cache trên VPS?\n(File gốc trên Google Drive KHÔNG bị ảnh hưởng)')) return;
  try {
    await fetch(`${API_BASE}/drive/folders/${folderId}`, { method: 'DELETE' });
    await loadDrive();
  } catch (err) {
    alert('Xoá thất bại: ' + err.message);
  }
}

async function viewFolderFiles(folderId, folderName) {
  try {
    const res = await fetch(`${API_BASE}/drive/folders/${folderId}/files`);
    const data = await res.json();
    const files = data.files || [];

    const modal = document.getElementById('modal-files-viewer');
    document.getElementById('modal-files-title').textContent = `Thư mục: ${folderName} (${files.length} file)`;
    const tbody = document.getElementById('modal-files-tbody');

    if (files.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-gray-400">Không có file nào</td></tr>';
    } else {
      tbody.innerHTML = files.map(f => `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
          <td class="px-4 py-2 text-sm font-medium text-gray-800">${f.name}</td>
          <td class="px-4 py-2 text-xs font-mono text-gray-500">${f.resolution || 'N/A'}</td>
          <td class="px-4 py-2 text-xs font-mono text-gray-500">${formatDuration(f.duration_seconds)}</td>
          <td class="px-4 py-2 text-xs font-mono text-gray-500">${formatBytes(f.size_bytes)}</td>
        </tr>
      `).join('');
    }

    modal.classList.remove('hidden');
  } catch (err) {
    alert('Không tải được danh sách file: ' + err.message);
  }
}

// Streams Actions
async function startStream(streamId, btn) {
  const target = state.streams.find(s => s.id === streamId);
  if (target) {
    target.status = 'starting';
    renderStreamsTable();
  }
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Đang khởi động...';
    btn.classList.add('opacity-70', 'animate-pulse');
  }
  try {
    const res = await fetch(`${API_BASE}/streams/${streamId}/start`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Khởi động thất bại');
    }
    await loadStreams();
  } catch (err) {
    alert(err.message);
    await loadStreams();
  }
}

async function stopStream(streamId) {
  try {
    const res = await fetch(`${API_BASE}/streams/${streamId}/stop`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    await loadStreams();
  } catch (err) {
    alert('Dừng thất bại: ' + err.message);
  }
}

async function restartStream(streamId) {
  try {
    const res = await fetch(`${API_BASE}/streams/${streamId}/restart`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    await loadStreams();
  } catch (err) {
    alert('Khởi động lại thất bại: ' + err.message);
  }
}

async function deleteStream(streamId) {
  if (!confirm('Xoá luồng phát này?')) return;
  try {
    await fetch(`${API_BASE}/streams/${streamId}`, { method: 'DELETE' });
    await loadStreams();
  } catch (err) {
    alert('Xoá thất bại: ' + err.message);
  }
}

async function viewFfmpegLog(streamId) {
  try {
    const res = await fetch(`${API_BASE}/streams/${streamId}/ffmpeg-log`);
    const data = await res.json();
    document.getElementById('modal-log-title').textContent = `FFmpeg Output (Stream #${streamId})`;
    document.getElementById('modal-log-content').textContent = data.log || 'Chưa có log.';
    document.getElementById('modal-log-viewer').classList.remove('hidden');
  } catch (err) {
    alert('Lỗi đọc log: ' + err.message);
  }
}

// Create Stream Modal Logic
let selectedFileIds = new Set();
let priorityFileIds = new Set();

async function openCreateStreamModal() {
  await Promise.all([loadVPS(), loadDrive()]);

  // Populate VPS dropdown
  const vpsSelect = document.getElementById('create-stream-vps');
  vpsSelect.innerHTML = '<option value="">— Chọn VPS online —</option>' +
    state.vpsList.map(v => `<option value="${v.id}">${v.name} (${v.ipAddress})</option>`).join('');

  // Populate Video folder dropdown
  const folderSelect = document.getElementById('create-stream-folder');
  folderSelect.innerHTML = '<option value="">— Chọn folder video —</option>' +
    state.videoFolders.map(f => `<option value="${f.id}">${f.name} (${f.file_count} file)</option>`).join('');

  // Populate Music folder dropdown
  const musicSelect = document.getElementById('create-stream-music-folder');
  musicSelect.innerHTML = '<option value="">— Chọn thư mục nhạc —</option>' +
    state.audioFolders.map(f => `<option value="${f.id}">${f.name} (${f.file_count} file)</option>`).join('');

  selectedFileIds.clear();
  priorityFileIds.clear();
  document.getElementById('create-stream-files-list').innerHTML = '';

  document.getElementById('modal-create-stream').classList.remove('hidden');
}

async function onVideoFolderSelected(folderId) {
  if (!folderId) {
    document.getElementById('create-stream-files-list').innerHTML = '';
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/drive/folders/${folderId}/files`);
    const data = await res.json();
    const files = data.files || [];
    selectedFileIds = new Set(files.map(f => f.drive_file_id || f.id));
    priorityFileIds.clear();
    renderFilePickerList(files);
  } catch (err) {
    console.error('Error loading files for stream create', err);
  }
}

function renderFilePickerList(files) {
  const container = document.getElementById('create-stream-files-list');
  container.innerHTML = files.map(f => {
    const fid = f.drive_file_id || f.id;
    const isChecked = selectedFileIds.has(fid);
    const isStar = priorityFileIds.has(fid);

    return `
      <div class="flex items-center justify-between border-b border-gray-100 py-1.5 px-2 hover:bg-indigo-50/40 rounded text-xs">
        <label class="flex items-center gap-2 cursor-pointer truncate max-w-[80%]">
          <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleFileSelection('${fid}', this.checked)" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
          <span class="truncate text-gray-800">${f.name}</span>
        </label>
        <button type="button" onclick="toggleFilePriority('${fid}')" class="text-sm px-1.5 py-0.5 rounded ${isStar ? 'text-amber-500 font-bold' : 'text-gray-300 hover:text-amber-400'}" title="Đánh dấu ưu tiên phát trước">
          ★
        </button>
      </div>
    `;
  }).join('');
  updateSelectedStats(files.length);
}

function toggleFileSelection(fid, checked) {
  if (checked) selectedFileIds.add(fid);
  else selectedFileIds.delete(fid);
  updateSelectedStats();
}

function toggleFilePriority(fid) {
  if (priorityFileIds.has(fid)) priorityFileIds.delete(fid);
  else priorityFileIds.add(fid);
  // Re-render
  const curFolder = document.getElementById('create-stream-folder').value;
  if (curFolder) onVideoFolderSelected(curFolder);
}

function updateSelectedStats(total) {
  const statsEl = document.getElementById('create-stream-file-stats');
  if (statsEl) {
    statsEl.textContent = `(${selectedFileIds.size} đã chọn, ${priorityFileIds.size} ★ ưu tiên)`;
  }
}

function selectAllFiles(check) {
  const container = document.getElementById('create-stream-files-list');
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.checked = check;
  });
  if (!check) selectedFileIds.clear();
  else {
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      // populate
    });
  }
  const curFolder = document.getElementById('create-stream-folder').value;
  if (curFolder) onVideoFolderSelected(curFolder);
}

// Submit Create Stream Form
async function submitCreateStream(e) {
  e.preventDefault();
  const form = document.getElementById('form-create-stream');

  const title = document.getElementById('create-stream-title').value.trim();
  const desc = document.getElementById('create-stream-desc').value.trim();
  const streamKey = document.getElementById('create-stream-key').value.trim();
  const vpsId = parseInt(document.getElementById('create-stream-vps').value);
  const folderId = parseInt(document.getElementById('create-stream-folder').value);

  if (!title || !streamKey || !vpsId || !folderId || selectedFileIds.size === 0) {
    alert('Vui lòng nhập đủ: Tiêu đề, VPS, Thư mục, Stream Key và chọn ít nhất 1 file video.');
    return;
  }

  const audioMode = document.getElementById('create-stream-audio-mode').value;
  const musicFolderId = document.getElementById('create-stream-music-folder').value;

  if (audioMode !== 'none' && !musicFolderId) {
    alert('Vui lòng chọn thư mục nhạc nền khi dùng chế độ Mix/Replace nhạc.');
    return;
  }

  const orientation = document.getElementById('create-stream-orientation').value;
  const loopEnabled = document.getElementById('create-stream-loop').checked;
  const autoDelete = document.getElementById('create-stream-autodelete').checked;

  const isScheduled = document.getElementById('schedule-option-scheduled').checked;
  const scheduleStart = isScheduled ? document.getElementById('create-stream-schedule-start').value : null;
  const scheduleEnd = isScheduled ? document.getElementById('create-stream-schedule-end').value : null;

  const payload = {
    title,
    description: desc,
    vps_id: vpsId,
    video_folder_id: folderId,
    stream_key: streamKey,
    file_ids: Array.from(selectedFileIds),
    priority_file_ids: Array.from(priorityFileIds),
    priority_pick_mode: document.getElementById('create-stream-p-mode').value,
    remaining_pick_mode: document.getElementById('create-stream-r-mode').value,
    audio_mode: audioMode,
    music_folder_id: musicFolderId ? parseInt(musicFolderId) : null,
    orientation,
    loop_enabled: loopEnabled,
    auto_delete_files: autoDelete,
    scheduled_start_at: scheduleStart ? new Date(scheduleStart).toISOString() : null,
    scheduled_end_at: scheduleEnd ? new Date(scheduleEnd).toISOString() : null,
  };

  try {
    const res = await fetch(`${API_BASE}/streams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Tạo luồng thất bại');
    }
    document.getElementById('modal-create-stream').classList.add('hidden');
    await loadStreams();
    switchTab('streams');
  } catch (err) {
    alert(err.message);
  }
}

// Add VPS Submit
async function submitAddVPS(e) {
  e.preventDefault();
  const name = document.getElementById('add-vps-name').value.trim();
  const ip = document.getElementById('add-vps-ip').value.trim();
  const port = parseInt(document.getElementById('add-vps-port').value || '22');
  const user = document.getElementById('add-vps-user').value.trim() || 'root';
  const pass = document.getElementById('add-vps-pass').value;
  const expire = document.getElementById('add-vps-expire').value;

  if (!name || !ip) {
    alert('Vui lòng nhập Tên VPS và IP');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/vps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        ip_address: ip,
        ssh_port: port,
        ssh_username: user,
        password: pass,
        expires_at: expire || null,
      })
    });
    if (!res.ok) throw new Error(await res.text());
    document.getElementById('modal-add-vps').classList.add('hidden');
    await loadVPS();
  } catch (err) {
    alert('Thêm VPS thất bại: ' + err.message);
  }
}

// Copy to clipboard helper
function copySAEmail() {
  navigator.clipboard.writeText(state.saEmail);
  alert('Đã copy email Service Account vào bộ nhớ tạm!');
}

// Initialization on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  loadSAEmail();
  switchTab(state.activeTab);
  
  // Auto refresh streams every 4 seconds to show live status
  setInterval(() => {
    if (state.activeTab === 'streams') {
      loadStreams();
    }
  }, 4000);
});
