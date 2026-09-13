/* ==========================================================================
   PORTFOLIO & REALTIME LIVE UPDATE ENGINE
   ========================================================================== */

(function () {
  'use strict';

  let currentAppVersion = null;
  let isCheckingUpdate = false;

  // DOM Elements
  const heroVersionBadge = document.getElementById('heroVersionBadge');
  const heroDownloadBtn = document.getElementById('heroDownloadBtn');
  const heroFileSize = document.getElementById('heroFileSize');
  const heroReleaseDate = document.getElementById('heroReleaseDate');
  const cardVersionChip = document.getElementById('cardVersionChip');
  const cardDownloadBtn = document.getElementById('cardDownloadBtn');
  const checkUpdateBtn = document.getElementById('checkUpdateBtn');
  const projectsGrid = document.getElementById('projectsGrid');
  const changelogTimeline = document.getElementById('changelogTimeline');
  const liveToast = document.getElementById('liveToast');
  const toastMsg = document.getElementById('toastMsg');
  const toastDownloadBtn = document.getElementById('toastDownloadBtn');
  const toastDismissBtn = document.getElementById('toastDismissBtn');

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    loadVersionData();
    loadProjectsData();
    setupTabs();
    setupFilters();
    setupEventListeners();

    // Live polling every 20 seconds for real-time update detection
    setInterval(() => {
      checkForUpdatesSilent();
    }, 20000);
  });

  /* --------------------------------------------------------------------------
     Helper: Fetch latest release from GitHub API or local JSON fallback
     -------------------------------------------------------------------------- */
  async function fetchVersionPayload() {
    let data = window.__INITIAL_VERSION__ ? JSON.parse(JSON.stringify(window.__INITIAL_VERSION__)) : null;

    // 1. Try local data/version.json first if available
    try {
      const response = await fetch(`data/version.json?_t=${Date.now()}`);
      if (response.ok) {
        data = await response.json();
      }
    } catch (e) {}

    // 2. Query GitHub Releases API for real-time release info (always up to date)
    try {
      const ghRes = await fetch('https://api.github.com/repos/fikatuwu/fikat/releases/latest', {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });
      if (ghRes.ok) {
        const gh = await ghRes.json();
        const rawTag = gh.tag_name || '';
        const cleanVer = rawTag.replace(/^[vV]\.?/, '');
        const zipAsset = (gh.assets || []).find(a => (a.name || '').endsWith('.zip')) || (gh.assets || [])[0];
        
        if (cleanVer) {
          if (!data) data = {};
          data.currentVersion = cleanVer;
          if (gh.published_at) {
            const d = new Date(gh.published_at);
            data.releaseDate = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
          }
          if (!data.download) data.download = {};
          if (zipAsset) {
            data.download.directUrl = zipAsset.browser_download_url;
            data.download.fileName = zipAsset.name;
            if (zipAsset.size) {
              data.download.fileSize = (zipAsset.size / (1024 * 1024)).toFixed(1) + ' MB';
            }
          }
        }
      }
    } catch (e) {
      console.warn('GitHub API check warning:', e);
    }

    return data || window.__INITIAL_VERSION__;
  }

  /* --------------------------------------------------------------------------
     1. Version & Release Data Loader (Realtime)
     -------------------------------------------------------------------------- */
  async function loadVersionData(showFeedback = false) {
    if (isCheckingUpdate) return;
    isCheckingUpdate = true;

    if (checkUpdateBtn && showFeedback) {
      checkUpdateBtn.innerHTML = '🔄 Đang kiểm tra...';
      checkUpdateBtn.disabled = true;
    }

    try {
      const data = await fetchVersionPayload();
      if (!data) throw new Error('Không thể lấy thông tin phiên bản.');

      const newVersion = data.currentVersion;
      const isFirstLoad = currentAppVersion === null;
      const hasNewerVersion = currentAppVersion !== null && newVersion !== currentAppVersion;

      currentAppVersion = newVersion;

      // Update UI elements
      if (heroVersionBadge) heroVersionBadge.textContent = `v${data.currentVersion}`;
      if (cardVersionChip) cardVersionChip.textContent = `v${data.currentVersion} • ${(data.status || 'STABLE').toUpperCase()}`;
      if (heroFileSize && data.download) heroFileSize.textContent = data.download.fileSize;
      if (heroReleaseDate) heroReleaseDate.textContent = data.releaseDate;

      // Update download links
      const downloadPath = (data.download && data.download.directUrl) ? data.download.directUrl : `./downloads/${data.download ? data.download.fileName : 'Suno_Bulk_Downloader.zip'}`;
      const fileName = data.download ? data.download.fileName : 'Suno_Bulk_Downloader.zip';
      if (heroDownloadBtn) {
        heroDownloadBtn.href = downloadPath;
        heroDownloadBtn.setAttribute('download', fileName);
      }
      if (cardDownloadBtn) {
        cardDownloadBtn.href = downloadPath;
        cardDownloadBtn.setAttribute('download', fileName);
      }
      if (toastDownloadBtn) {
        toastDownloadBtn.href = downloadPath;
        toastDownloadBtn.setAttribute('download', fileName);
      }

      // Render Changelog
      if (data.changelog) renderChangelog(data.changelog);

      // Trigger Toast notification if new update is detected in realtime
      if (hasNewerVersion) {
        showToast(`Phiên bản mới v${newVersion} đã sẵn sàng! (${data.releaseDate})`);
      } else if (showFeedback) {
        showToast(`Bạn đang ở phiên bản mới nhất: v${currentAppVersion} (${data.statusText || 'Hoạt động ổn định'})`);
      }
    } catch (err) {
      console.warn('Lỗi kiểm tra phiên bản:', err);
      if (showFeedback) {
        showToast('Không thể kết nối máy chủ kiểm tra cập nhật.');
      }
    } finally {
      isCheckingUpdate = false;
      if (checkUpdateBtn && showFeedback) {
        setTimeout(() => {
          checkUpdateBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
            Kiểm tra cập nhật
          `;
          checkUpdateBtn.disabled = false;
        }, 1000);
      }
    }
  }

  async function checkForUpdatesSilent() {
    try {
      const data = await fetchVersionPayload();
      if (data && currentAppVersion && data.currentVersion !== currentAppVersion) {
        loadVersionData(false);
      }
    } catch (e) { }
  }

  /* --------------------------------------------------------------------------
     2. Dynamic Projects Catalog Loader
     -------------------------------------------------------------------------- */
  async function loadProjectsData() {
    if (!projectsGrid) return;

    let projects;
    try {
      const response = await fetch(`data/projects.json?_t=${Date.now()}`);
      if (response.ok) projects = await response.json();
      else projects = window.__INITIAL_PROJECTS__;
    } catch (err) {
      projects = window.__INITIAL_PROJECTS__;
    }

    if (projects && projects.length > 0) {
      if (currentAppVersion && projects[0]) {
        projects[0].version = currentAppVersion;
      }
      renderProjects(projects);
    } else {
      projectsGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 40px;">
          Chưa thể nạp danh sách dự án.
        </div>
      `;
    }
  }

  function renderProjects(projects, filterCategory = 'all') {
    if (!projectsGrid) return;
    projectsGrid.innerHTML = '';

    const filtered = filterCategory === 'all'
      ? projects
      : projects.filter(p => p.category === filterCategory);

    filtered.forEach(p => {
      const card = document.createElement('div');
      card.className = `project-card ${p.featured ? 'featured-card' : ''}`;

      const techTagsHtml = (p.techStack || [])
        .map(t => `<span class="tech-tag">${escapeHtml(t)}</span>`)
        .join('');

      card.innerHTML = `
        <div>
          <div class="card-top">
            <span class="project-badge">${escapeHtml(p.badge || 'Công cụ')}</span>
            <span class="project-version">${escapeHtml(p.version || 'v1.0')}</span>
          </div>
          <h3 class="project-title">${escapeHtml(p.name)}</h3>
          <p class="project-desc">${escapeHtml(p.shortDesc)}</p>
          <div class="tech-tags">${techTagsHtml}</div>
        </div>
        <div class="card-footer">
          <span style="font-size: 0.8rem; color: var(--text-dim);">${escapeHtml(p.categoryLabel || '')}</span>
          ${p.downloadUrl && p.downloadUrl !== '#'
            ? `<a href="${p.downloadUrl}" class="card-link" download>Tải về ⬇</a>`
            : `<a href="#featured" class="card-link">Chi tiết ➔</a>`
          }
        </div>
      `;
      projectsGrid.appendChild(card);
    });
  }

  /* --------------------------------------------------------------------------
     3. Changelog Renderer
     -------------------------------------------------------------------------- */
  function renderChangelog(changelogList) {
    if (!changelogTimeline || !changelogList) return;
    changelogTimeline.innerHTML = '';

    changelogList.forEach(item => {
      const el = document.createElement('div');
      el.className = 'timeline-item';

      const listHtml = (item.highlights || [])
        .map(h => `<li>${escapeHtml(h)}</li>`)
        .join('');

      const badgeHtml = item.badge === 'latest'
        ? '<span class="status-pill" style="font-size: 0.72rem; padding: 2px 8px;">Bản mới nhất</span>'
        : '';

      el.innerHTML = `
        <div class="timeline-card">
          <div class="timeline-header">
            <div class="timeline-title">
              <span>v${escapeHtml(item.version)}</span>
              ${badgeHtml}
            </div>
            <span class="timeline-date">${escapeHtml(item.date)}</span>
          </div>
          <ul class="timeline-list">
            ${listHtml}
          </ul>
        </div>
      `;
      changelogTimeline.appendChild(el);
    });
  }

  /* --------------------------------------------------------------------------
     4. Interactive Feature Tabs
     -------------------------------------------------------------------------- */
  function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        const targetPane = document.getElementById(targetId);
        if (targetPane) {
          targetPane.classList.add('active');
        }
      });
    });
  }

  /* --------------------------------------------------------------------------
     5. Category Filter Buttons
     -------------------------------------------------------------------------- */
  function setupFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const cat = btn.getAttribute('data-filter');

        fetch(`data/projects.json?_t=${Date.now()}`)
          .then(r => r.json())
          .then(data => renderProjects(data, cat))
          .catch(() => {});
      });
    });
  }

  /* --------------------------------------------------------------------------
     6. Event Listeners & Toast Notifications
     -------------------------------------------------------------------------- */
  function setupEventListeners() {
    if (checkUpdateBtn) {
      checkUpdateBtn.addEventListener('click', (e) => {
        e.preventDefault();
        loadVersionData(true);
      });
    }

    if (toastDismissBtn && liveToast) {
      toastDismissBtn.addEventListener('click', () => {
        liveToast.classList.remove('show');
      });
    }

    // Copy to clipboard buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const textToCopy = btn.getAttribute('data-copy');
        if (!textToCopy) return;

        navigator.clipboard.writeText(textToCopy).then(() => {
          const originalContent = btn.innerHTML;
          btn.innerHTML = '<span>✓ Đã chép</span>';
          showToast(`Đã sao chép: ${textToCopy}`);
          setTimeout(() => {
            btn.innerHTML = originalContent;
          }, 2200);
        }).catch(() => {
          showToast(`Hãy sao chép thủ công: ${textToCopy}`);
        });
      });
    });
  }

  function showToast(message) {
    if (!liveToast || !toastMsg) return;
    toastMsg.textContent = message;
    liveToast.classList.add('show');

    // Auto dismiss after 6 seconds
    setTimeout(() => {
      liveToast.classList.remove('show');
    }, 6000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

})();
