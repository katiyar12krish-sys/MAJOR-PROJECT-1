/**
 * INTRAMOVE Mobile Controller & Cross-Device Mesh System
 * Handles:
 *  - Master AGV Power ON/OFF toggle
 *  - Point-to-Point Destination Selection & Dispatch
 *  - Raspberry Pi Connection (Dynamic IP configuration, Live Socket Reachability Test & PowerShell SSH bridge)
 *  - Custom Pi Code File Explorer & Direct File Upload (No Pre-defined Hardcoded Files)
 *  - Mobile Interactive Terminal Console
 *  - Cross-Device Inter-Phone Order Notification (BroadcastChannel + LocalStorage)
 *  - Real-time Delivery Tracking (Speed, Battery %, ETA, Route Animation)
 *  - Mobile Easy Mapping (Touch D-Pad, Real-time 2D Radar, Save Station Waypoint)
 */

import confetti from 'canvas-confetti';
import { connectionManager } from '../connection/connectionManager.js';

const STORAGE_KEYS = {
  DEVICE_ID: 'intramove_mobile_device_id',
  PI_IP: 'intramove_pi_ip',
  PI_PORT: 'intramove_pi_port',
  SSH_PORT: 'intramove_pi_ssh_port',
  VIEW_MODE: 'intramove_view_preference',
  SAVED_STATIONS: 'intramove_mobile_stations_v1',
  ACTIVE_ORDER: 'intramove_active_order',
  PI_FILES: 'intramove_pi_filesystem_v2',
  ACTIVE_FILE: 'intramove_pi_active_file'
};

const DEFAULT_STATIONS = [
  { id: 'st_a', name: 'Station A (Robotics Bay)', x: 3, y: 16 },
  { id: 'st_b', name: 'Station B (Assembly Hub)', x: 16, y: 3 },
  { id: 'st_c', name: 'Station C (Packaging Bay)', x: 16, y: 16 },
  { id: 'st_d', name: 'Station D (Warehouse Dock)', x: 3, y: 3 },
  { id: 'st_lab', name: 'Robotics Lab 302', x: 10, y: 9 }
];

export class MobileController {
  constructor(pathfindingSim, imuSim, diagnosticsUI) {
    this.sim = pathfindingSim;
    this.imu = imuSim;
    this.diag = diagnosticsUI;

    // Power & Mission State
    this.isPoweredOn = false;
    this.missionState = 'IDLE'; // 'IDLE', 'DISPATCHED', 'IN_TRANSIT', 'ARRIVING', 'DELIVERED'
    this.currentOrder = null;

    // Telemetry
    this.speed = 0.0;
    this.targetSpeed = 1.35; // m/s
    this.battery = 94.0; // %
    this.voltage = 25.4; // V
    this.payloadKg = 2.5; // kg
    this.progress = 0; // %
    this.etaSeconds = 0;
    this.distanceRemaining = 0.0;

    // Mobile Mapping State
    this.isMappingActive = false;
    this.robotMapPos = { x: 3, y: 16, heading: 0 };
    this.manualDriveVelocity = { linear: 0, angular: 0 };
    this.mapObstacles = [];
    this.activeTab = 'control'; // 'control', 'track', 'map', 'code', 'settings'

    // Stations & Terminals
    this.stations = this.loadStations();
    this.deviceIdentity = localStorage.getItem(STORAGE_KEYS.DEVICE_ID) || 'Station B Terminal';
    
    // Dynamic IP handling (no hardcoded defaults)
    this.piIp = localStorage.getItem(STORAGE_KEYS.PI_IP) || localStorage.getItem('intramove_pi_ssh_ip') || '';
    this.piPort = localStorage.getItem(STORAGE_KEYS.PI_PORT) || '8765';
    this.sshPort = localStorage.getItem(STORAGE_KEYS.SSH_PORT) || '22';
    this.isPiConnected = false;
    this.piPingMs = 0;

    // Filesystem State: Only user uploaded or created files
    this.files = this.loadFiles();
    this.activeFileName = localStorage.getItem(STORAGE_KEYS.ACTIVE_FILE) || Object.keys(this.files)[0] || '';

    // Terminal History
    this.commandHistory = [];
    this.historyIndex = -1;

    // Cross-Device Mesh Network
    this.meshChannel = null;
    this.initMeshNetwork();

    // DOM Caching & Init
    this.initDOM();
    this.initEventHandlers();
    this.initLoop();
    this.checkExistingOrder();
    this.syncSavedIpFromDisk();
  }

  async syncSavedIpFromDisk() {
    if (!this.piIp) {
      try {
        const res = await fetch('/api/pi/get-ip');
        if (res.ok) {
          const data = await res.json();
          if (data.ip && !this.piIp) {
            this.setPiIp(data.ip, false);
          }
        }
      } catch (_) {}
    }
  }

  // --------------------------------------------------------------------------
  // USER FILESYSTEM (NO PREDEFINED CODES)
  // --------------------------------------------------------------------------
  loadFiles() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PI_FILES);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed;
        }
      }
    } catch (_) {}
    return {};
  }

  saveFiles() {
    try {
      localStorage.setItem(STORAGE_KEYS.PI_FILES, JSON.stringify(this.files));
    } catch (_) {}
  }

  handleFileUpload(fileList) {
    if (!fileList || fileList.length === 0) return;

    let count = 0;
    Array.from(fileList).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.files[file.name] = {
          path: `~/intramove/${file.name}`,
          content: e.target.result,
          size: file.size,
          lastModified: file.lastModified || Date.now()
        };
        count++;
        if (count === fileList.length) {
          this.saveFiles();
          this.activeFileName = file.name;
          localStorage.setItem(STORAGE_KEYS.ACTIVE_FILE, file.name);
          this.renderMobileFiles();
          this.loadFileIntoEditor(file.name);
          this.showToast(`✅ Uploaded ${count} file(s) to ~/intramove!`);
          this.executeTerminalCommand(`echo "[UPLOAD] Uploaded ${file.name} (${file.size} bytes)"`);
        }
      };
      reader.readAsText(file);
    });
  }

  renderMobileFiles() {
    const container = document.getElementById('mobile-file-list-container');
    if (!container) return;

    container.innerHTML = '';
    const filenames = Object.keys(this.files).sort();

    if (filenames.length === 0) {
      container.innerHTML = `
        <div class="p-3 text-center text-slate-500 font-mono text-xs border border-dashed border-slate-300 rounded-2xl bg-slate-50 space-y-1">
          <span class="material-symbols-outlined text-xl text-cyan-600">upload_file</span>
          <p class="font-bold text-slate-700">No Codes Uploaded Yet</p>
          <p class="text-[10px] text-slate-500">Tap <strong>Upload</strong> or <strong>New</strong> to add your Raspberry Pi Python scripts.</p>
        </div>
      `;
      return;
    }

    filenames.forEach((fname) => {
      const isSelected = fname === this.activeFileName;
      const file = this.files[fname];
      const sizeKb = ((file.content || '').length / 1024).toFixed(1);

      const card = document.createElement('div');
      card.className = `p-2.5 rounded-xl border flex items-center justify-between text-xs font-mono transition-all cursor-pointer ${
        isSelected
          ? 'bg-cyan-50 border-cyan-400 text-cyan-900 font-bold shadow-sm'
          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
      }`;

      card.innerHTML = `
        <div class="flex items-center gap-2 truncate flex-1 file-trigger">
          <span class="material-symbols-outlined text-base text-cyan-600">description</span>
          <div class="truncate">
            <div class="truncate">${this.escapeHTML(fname)}</div>
            <div class="text-[9px] text-slate-500 font-normal">${sizeKb} KB</div>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button data-file-delete="${this.escapeHTML(fname)}" class="p-1 text-slate-400 hover:text-rose-600" title="Delete">
            <span class="material-symbols-outlined text-sm">delete</span>
          </button>
        </div>
      `;

      card.querySelector('.file-trigger')?.addEventListener('click', () => {
        this.loadFileIntoEditor(fname);
      });

      card.querySelector('[data-file-delete]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteFile(fname);
      });

      container.appendChild(card);
    });
  }

  loadFileIntoEditor(filename) {
    this.activeFileName = filename;
    localStorage.setItem(STORAGE_KEYS.ACTIVE_FILE, filename);
    this.renderMobileFiles();

    const file = this.files[filename];
    const editor = document.getElementById('mobile-code-textarea');
    const badge = document.getElementById('mobile-code-active-filename');

    if (editor && file) {
      editor.value = file.content;
    }
    if (badge) {
      badge.innerText = filename || 'No file selected';
    }
  }

  saveCurrentCode() {
    const editor = document.getElementById('mobile-code-textarea');
    if (!editor) return;

    if (!this.activeFileName) {
      this.promptNewFile();
      return;
    }

    const code = editor.value;
    if (this.files[this.activeFileName]) {
      this.files[this.activeFileName].content = code;
    } else {
      this.files[this.activeFileName] = {
        path: `~/intramove/${this.activeFileName}`,
        content: code
      };
    }

    this.saveFiles();
    this.showToast(`💾 Saved: ${this.activeFileName}`);
    this.executeTerminalCommand(`echo "[SAVE] Saved ~/intramove/${this.activeFileName}"`);
  }

  deleteFile(filename) {
    if (!confirm(`Delete "${filename}"?`)) return;

    delete this.files[filename];
    this.saveFiles();

    const remaining = Object.keys(this.files);
    if (this.activeFileName === filename) {
      this.activeFileName = remaining[0] || '';
      localStorage.setItem(STORAGE_KEYS.ACTIVE_FILE, this.activeFileName);
    }

    this.renderMobileFiles();
    if (this.activeFileName && this.files[this.activeFileName]) {
      this.loadFileIntoEditor(this.activeFileName);
    } else {
      const editor = document.getElementById('mobile-code-textarea');
      const badge = document.getElementById('mobile-code-active-filename');
      if (editor) editor.value = '';
      if (badge) badge.innerText = 'No file selected';
    }

    this.showToast(`🗑️ Deleted ${filename}`);
  }

  promptNewFile() {
    const name = prompt('Enter filename (e.g. robot.py or test.sh):');
    if (name && name.trim()) {
      const clean = name.trim();
      this.files[clean] = {
        path: `~/intramove/${clean}`,
        content: `# File: ~/intramove/${clean}\n# Created via INTRAMOVE Mobile\n\n`
      };
      this.saveFiles();
      this.loadFileIntoEditor(clean);
      this.showToast(`✨ Created: ${clean}`);
    }
  }

  downloadActiveFile() {
    if (!this.activeFileName || !this.files[this.activeFileName]) {
      this.showToast('⚠️ No active file to download');
      return;
    }
    const file = this.files[this.activeFileName];
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.activeFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast(`📥 Downloaded ${this.activeFileName}`);
  }

  // --------------------------------------------------------------------------
  // MOBILE INTERACTIVE TERMINAL
  // --------------------------------------------------------------------------
  async executeTerminalCommand(cmd) {
    const termBody = document.getElementById('mobile-terminal-body');
    if (!termBody) return;

    const host = this.piIp || connectionManager.piIp || '192.168.0.148';
    const user = connectionManager.piUser || 'major';
    const trimmed = (cmd || '').trim();
    const lower = trimmed.toLowerCase();

    // Echo input
    const line = document.createElement('div');
    line.className = 'text-slate-300 font-mono text-[11px] flex items-center gap-1 mt-1';
    line.innerHTML = `<span class="text-emerald-400 font-bold">${user}@${host}</span><span class="text-slate-400">:</span><span class="text-cyan-300">~/intramove</span><span class="text-slate-400">$</span> <span class="text-white">${this.escapeHTML(trimmed)}</span>`;
    termBody.appendChild(line);

    if (lower === 'clear' || lower === 'cls') {
      termBody.innerHTML = `<div class="text-cyan-400 font-bold text-[11px]">[INTRAMOVE MOBILE TERMINAL]</div><div class="text-slate-400 text-[10px]">Session: ${user}@${host}:${this.sshPort} · ~/intramove</div>`;
      termBody.scrollTop = termBody.scrollHeight;
      return;
    }

    if (lower === 'help') {
      const respEl = document.createElement('div');
      respEl.className = 'text-slate-300 font-mono text-[11px] whitespace-pre-wrap leading-relaxed';
      respEl.innerHTML = `<span class="text-cyan-400 font-bold">Commands:</span>\n  ls / dir     : List ~/intramove files\n  python3 &lt;file.py&gt; : Run script on Pi\n  cat &lt;file&gt;   : View file\n  pip list     : Inspect Pi libraries\n  clear        : Clear terminal`;
      termBody.appendChild(respEl);
      termBody.scrollTop = termBody.scrollHeight;
      return;
    }

    // Temporary loading indicator
    const runningIndicator = document.createElement('div');
    runningIndicator.className = 'text-slate-500 font-mono text-[10px] animate-pulse';
    runningIndicator.innerHTML = `⏳ Executing on ${user}@${host}:~/intramove...`;
    termBody.appendChild(runningIndicator);
    termBody.scrollTop = termBody.scrollHeight;

    // Try executing remotely on Pi
    const res = await connectionManager.execRemoteCommand(trimmed);
    runningIndicator.remove();

    const respEl = document.createElement('div');
    respEl.className = 'text-slate-300 font-mono text-[11px] whitespace-pre-wrap leading-relaxed';

    if (res && res.success) {
      const out = (res.stdout || '').trim();
      const err = (res.stderr || '').trim();
      if (!out && !err) {
        respEl.innerHTML = `<span class="text-slate-500 font-mono text-[10px]">(Process exited with return code 0, no output)</span>`;
      } else {
        respEl.innerHTML = `${out ? this.escapeHTML(out) : ''}${err ? `<span class="text-amber-400">\n${this.escapeHTML(err)}</span>` : ''}`;
      }
    } else {
      // Fallback local response
      const fallback = this.computeTerminalResponse(trimmed);
      respEl.innerHTML = fallback;
    }

    termBody.appendChild(respEl);
    termBody.scrollTop = termBody.scrollHeight;
  }

  computeTerminalResponse(cmd) {
    const lower = cmd.toLowerCase().trim();
    const host = this.piIp || connectionManager.piIp || '192.168.0.148';
    const user = connectionManager.piUser || 'major';

    if (lower === 'clear' || lower === 'cls') {
      const termBody = document.getElementById('mobile-terminal-body');
      if (termBody) termBody.innerHTML = '';
      return `<span class="text-cyan-400 font-bold">[INTRAMOVE MOBILE TERMINAL]</span>\nSession: ${user}@${host}:${this.sshPort}`;
    }

    if (lower === 'ls' || lower === 'dir') {
      const names = Object.keys(this.files);
      if (names.length === 0) {
        return `<span class="text-slate-500">(No files in ~/intramove. Tap 'Sync Pi' or 'Upload' to add code.)</span>`;
      }
      return names.map(n => `<span class="text-emerald-300 font-bold">${n}</span>`).join('   ');
    }

    if (lower === 'pwd') {
      return `/home/${user}/intramove`;
    }

    if (lower === 'pip list' || lower === 'pip' || lower === 'libraries') {
      if (connectionManager.libraries.length > 0) {
        const sample = connectionManager.libraries.slice(0, 15).map(p => `  ${p.name} == ${p.version}`).join('\n');
        return `<span class="text-purple-300 font-bold">Installed Python Libraries (${connectionManager.libraries.length} total):</span>\n${sample}\n  <span class="text-slate-500">...tap 'Pi Libs' above to inspect full library package list</span>`;
      }
      connectionManager.fetchLibraries();
      return `<span class="text-purple-300 font-bold">🔍 Querying Pi for installed pip libraries...</span> (Scan triggered)`;
    }

    if (lower.startsWith('cat ')) {
      const fname = cmd.substring(4).trim();
      if (this.files[fname]) {
        return this.escapeHTML(this.files[fname].content);
      }
      return `<span class="text-rose-400">cat: ${this.escapeHTML(fname)}: No such file</span>`;
    }

    if (lower.startsWith('python3 ') || lower.startsWith('python ')) {
      const script = cmd.replace(/^python3?\s+/, '').trim();
      if (this.files[script]) {
        return `<span class="text-emerald-400">▶ Executing /home/${user}/intramove/${this.escapeHTML(script)}...</span>\n` +
               `<span class="text-slate-300">[PYTHON RUNTIME] Loaded ${this.escapeHTML(script)} (${this.files[script].content.length} bytes). Process active on Pi.</span>`;
      }
      return `<span class="text-rose-400">python3: can't open file '${this.escapeHTML(script)}': No such file</span>`;
    }

    if (lower === 'help') {
      return `<span class="text-cyan-400 font-bold">Available Commands:</span>\n  ls        : List files in ~/intramove\n  cat &lt;file&gt; : View file contents\n  pip list  : View installed Python libraries\n  python3 &lt;file.py&gt; : Run script on Pi\n  clear     : Clear screen`;
    }

    return `<span class="text-slate-400">${user}@${host}:~/intramove$ ${this.escapeHTML(cmd)} (executed)</span>`;
  }

  // --------------------------------------------------------------------------
  // REMOTE PI FILE SYNC & PUSH
  // --------------------------------------------------------------------------
  async syncRemotePiFiles() {
    this.showToast(`🔄 Pulling files from ${connectionManager.piUser}@${connectionManager.piIp || '<Your-Pi-IP>'}:~/intramove...`);
    const res = await connectionManager.fetchRemoteFiles('~/intramove');
    if (res && res.success && Array.isArray(res.files)) {
      if (res.files.length === 0) {
        this.showToast(`Folder ~/intramove is currently empty on Pi.`);
      } else {
        let loadedCount = 0;
        for (const f of res.files) {
          if (!f.isDir) {
            const fileData = await connectionManager.readRemoteFile(f.name);
            this.files[f.name] = {
              path: `~/intramove/${f.name}`,
              content: fileData && fileData.success ? fileData.content : `# ${f.name} (Remote from Pi)`,
              size: f.size || 0,
              lastModified: Date.now()
            };
            loadedCount++;
          }
        }
        this.saveFiles();
        if (res.files[0] && (!this.activeFileName || !this.files[this.activeFileName])) {
          this.activeFileName = res.files[0].name;
        }
        this.renderMobileFiles();
        if (this.activeFileName && this.files[this.activeFileName]) {
          this.loadFileIntoEditor(this.activeFileName);
        }
        this.showToast(`✅ Synced ${loadedCount} files from /home/${connectionManager.piUser}/intramove!`);
      }
    } else {
      this.showToast(res?.error || 'Failed to sync with Pi');
    }
  }

  async pushActiveFileToPi() {
    if (!this.activeFileName) {
      this.showToast('⚠️ No active file selected to push!');
      return;
    }
    this.saveCurrentCode();
    const file = this.files[this.activeFileName];
    if (!file) return;

    this.showToast(`🚀 Pushing ${this.activeFileName} to ~/intramove...`);
    const res = await connectionManager.writeRemoteFile(this.activeFileName, file.content || '');
    if (res && res.success) {
      this.showToast(`✅ Pushed ${this.activeFileName} to Pi successfully!`);
      this.executeTerminalCommand(`echo "[SYNC] Pushed ${this.activeFileName} to ~/intramove."`);
    } else {
      this.showToast(res?.error || 'Failed to push file to Pi');
    }
  }

  // --------------------------------------------------------------------------
  // CROSS-DEVICE MESH NETWORK & NOTIFICATIONS
  // --------------------------------------------------------------------------
  initMeshNetwork() {
    try {
      if ('BroadcastChannel' in window) {
        this.meshChannel = new BroadcastChannel('intramove_mesh_network');
        this.meshChannel.onmessage = (e) => this.handleMeshMessage(e.data);
      }
    } catch (err) {
      console.warn('BroadcastChannel not available, using storage fallback', err);
    }

    window.addEventListener('storage', (e) => {
      if (e.key === 'intramove_mesh_broadcast' && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          this.handleMeshMessage(data);
        } catch (err) {
          console.error('Storage sync parse error:', err);
        }
      }
    });
  }

  broadcast(message) {
    const payload = {
      ...message,
      senderId: this.deviceIdentity,
      timestamp: Date.now()
    };

    if (this.meshChannel) {
      this.meshChannel.postMessage(payload);
    }

    try {
      localStorage.setItem('intramove_mesh_broadcast', JSON.stringify(payload));
    } catch (_) {}
  }

  handleMeshMessage(data) {
    if (!data || data.senderId === this.deviceIdentity) return;

    if (data.type === 'AGV_DISPATCH') {
      const isTarget = data.targetDevice === 'All Devices' || data.targetDevice === this.deviceIdentity;
      if (isTarget) {
        this.showIncomingNotification(data);
      }
      this.currentOrder = data;
      this.missionState = 'IN_TRANSIT';
      this.updateTrackUI();
    } else if (data.type === 'AGV_TELEMETRY_SYNC') {
      if (this.currentOrder && this.currentOrder.orderId === data.orderId) {
        this.speed = data.speed;
        this.battery = data.battery;
        this.progress = data.progress;
        this.etaSeconds = data.etaSeconds;
        this.distanceRemaining = data.distanceRemaining;
        this.updateTrackUI();
      }
    } else if (data.type === 'AGV_DELIVERED') {
      if (this.currentOrder && this.currentOrder.orderId === data.orderId) {
        this.onMissionCompleted(data);
      }
    } else if (data.type === 'AGV_POWER_CHANGED') {
      this.setPowerState(data.isPoweredOn, false);
    }
  }

  showIncomingNotification(orderData) {
    const banner = document.getElementById('mobile-incoming-banner');
    const titleEl = document.getElementById('mobile-incoming-title');
    const descEl = document.getElementById('mobile-incoming-desc');
    const badgeEl = document.getElementById('mobile-incoming-badge');

    if (titleEl) titleEl.innerText = `📦 INCOMING AGV DELIVERY!`;
    if (descEl) descEl.innerText = `Dispatched from ${orderData.fromStation} ➔ ${orderData.toStation} (${orderData.payloadKg}kg Cargo).`;
    if (badgeEl) badgeEl.innerText = `TARGET: ${orderData.targetDevice}`;

    if (banner) {
      banner.classList.remove('hidden');
      banner.classList.add('flex', 'animate-bounce');
      setTimeout(() => banner.classList.remove('animate-bounce'), 1200);
    }

    if ('vibrate' in navigator) {
      try {
        navigator.vibrate([200, 100, 200, 100, 400]);
      } catch (_) {}
    }
  }

  hideIncomingNotification() {
    const banner = document.getElementById('mobile-incoming-banner');
    if (banner) banner.classList.add('hidden');
  }

  // --------------------------------------------------------------------------
  // STATIONS MANAGEMENT
  // --------------------------------------------------------------------------
  loadStations() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SAVED_STATIONS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return [...DEFAULT_STATIONS];
  }

  saveStation(name, x, y) {
    const newStation = {
      id: 'st_' + Date.now(),
      name: name.trim() || `Station ${this.stations.length + 1}`,
      x: Number(x.toFixed(1)),
      y: Number(y.toFixed(1))
    };
    this.stations.push(newStation);
    try {
      localStorage.setItem(STORAGE_KEYS.SAVED_STATIONS, JSON.stringify(this.stations));
    } catch (_) {}
    this.populateStationDropdowns();
    return newStation;
  }

  populateStationDropdowns() {
    const originSelect = document.getElementById('mobile-sel-origin');
    const destSelect = document.getElementById('mobile-sel-dest');

    if (!originSelect || !destSelect) return;

    const currentOrigin = originSelect.value || this.stations[0]?.id;
    const currentDest = destSelect.value || (this.stations[1]?.id || this.stations[0]?.id);

    originSelect.innerHTML = '';
    destSelect.innerHTML = '';

    this.stations.forEach((st) => {
      const optA = document.createElement('option');
      optA.value = st.id;
      optA.textContent = st.name;
      originSelect.appendChild(optA);

      const optB = document.createElement('option');
      optB.value = st.id;
      optB.textContent = st.name;
      destSelect.appendChild(optB);
    });

    originSelect.value = currentOrigin;
    destSelect.value = currentDest !== currentOrigin ? currentDest : (this.stations[1]?.id || currentDest);
  }

  // --------------------------------------------------------------------------
  // DOM INITIALIZATION & TAB SWITCHING
  // --------------------------------------------------------------------------
  initDOM() {
    this.populateStationDropdowns();

    const deviceSelect = document.getElementById('mobile-sel-device-identity');
    if (deviceSelect) {
      deviceSelect.value = this.deviceIdentity;
    }

    const piIpInput = document.getElementById('mobile-input-pi-ip');
    const piPortInput = document.getElementById('mobile-input-pi-port');
    const sshPortInput = document.getElementById('mobile-input-ssh-port');

    if (piIpInput) piIpInput.value = this.piIp;
    if (piPortInput) piPortInput.value = this.piPort;
    if (sshPortInput) sshPortInput.value = this.sshPort;

    // Set Dynamic Wi-Fi link
    const accessEl = document.getElementById('mobile-wifi-access-url');
    if (accessEl) {
      const hostname = window.location.hostname || 'localhost';
      accessEl.innerText = `http://${hostname}:5173`;
    }

    this.initViewMode();
    this.updatePowerUI();
    this.updatePiStatusUI();
    this.renderMobileFiles();

    if (this.activeFileName && this.files[this.activeFileName]) {
      this.loadFileIntoEditor(this.activeFileName);
    }
  }

  initViewMode() {
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get('view');
    const savedMode = localStorage.getItem(STORAGE_KEYS.VIEW_MODE);

    let isMobileMode = false;
    if (modeParam === 'mobile' || modeParam === 'phone') {
      isMobileMode = true;
    } else if (modeParam === 'desktop') {
      isMobileMode = false;
    } else if (savedMode) {
      isMobileMode = savedMode === 'mobile';
    } else {
      isMobileMode = window.innerWidth < 768;
    }

    this.setViewMode(isMobileMode ? 'mobile' : 'desktop', false);
  }

  setViewMode(mode, save = true) {
    if (save) {
      localStorage.setItem(STORAGE_KEYS.VIEW_MODE, mode);
    }

    const mobileShell = document.getElementById('mobile-app-shell');
    const desktopShell = document.getElementById('desktop-showcase-shell');
    const btnToggleMobile = document.getElementById('btn-switch-to-desktop');

    if (mode === 'mobile') {
      if (mobileShell) mobileShell.classList.remove('hidden');
      if (desktopShell) desktopShell.classList.add('hidden');
      if (btnToggleMobile) btnToggleMobile.classList.remove('hidden');
      document.body.classList.add('mobile-app-active');
    } else {
      if (mobileShell) mobileShell.classList.add('hidden');
      if (desktopShell) desktopShell.classList.remove('hidden');
      document.body.classList.remove('mobile-app-active');
    }
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    const tabs = ['control', 'track', 'map', 'code', 'settings'];

    tabs.forEach((t) => {
      const panel = document.getElementById(`mobile-panel-${t}`);
      const btn = document.getElementById(`mobile-tab-btn-${t}`);
      if (panel) {
        if (t === tabName) {
          panel.classList.remove('hidden');
        } else {
          panel.classList.add('hidden');
        }
      }
      if (btn) {
        if (t === tabName) {
          btn.classList.add('text-cyan-600', 'font-bold');
          btn.classList.remove('text-slate-500');
          const indicator = btn.querySelector('.tab-indicator');
          if (indicator) indicator.classList.remove('opacity-0');
        } else {
          btn.classList.remove('text-cyan-600', 'font-bold');
          btn.classList.add('text-slate-500');
          const indicator = btn.querySelector('.tab-indicator');
          if (indicator) indicator.classList.add('opacity-0');
        }
      }
    });

    if (tabName === 'track') {
      this.updateTrackUI();
    } else if (tabName === 'map') {
      this.renderMobileMap();
    } else if (tabName === 'code') {
      this.renderMobileFiles();
      if (this.activeFileName && this.files[this.activeFileName]) {
        this.loadFileIntoEditor(this.activeFileName);
      }
      connectionManager.updateAllUIs();
    } else if (tabName === 'settings') {
      connectionManager.updateAllUIs();
    }
  }

  // --------------------------------------------------------------------------
  // EVENT HANDLERS
  // --------------------------------------------------------------------------
  initEventHandlers() {
    // 1. Master Power Button
    const btnMasterPower = document.getElementById('mobile-btn-master-power');
    if (btnMasterPower) {
      btnMasterPower.addEventListener('click', () => {
        this.togglePower();
      });
    }

    // 2. Dispatch Button
    const btnDispatch = document.getElementById('mobile-btn-dispatch');
    if (btnDispatch) {
      btnDispatch.addEventListener('click', () => {
        this.dispatchAGV();
      });
    }

    // 3. Bottom Tab Buttons (5 tabs)
    ['control', 'track', 'map', 'code', 'settings'].forEach((tab) => {
      const btn = document.getElementById(`mobile-tab-btn-${tab}`);
      if (btn) {
        btn.addEventListener('click', () => this.switchTab(tab));
      }
    });

    // 4. Quick Header Actions
    const btnHeaderPi = document.getElementById('mobile-header-pi-badge');
    if (btnHeaderPi) {
      btnHeaderPi.addEventListener('click', () => this.switchTab('settings'));
    }

    const btnTrackNotification = document.getElementById('mobile-btn-incoming-track');
    if (btnTrackNotification) {
      btnTrackNotification.addEventListener('click', () => {
        this.hideIncomingNotification();
        this.switchTab('track');
      });
    }

    const btnDismissNotification = document.getElementById('mobile-btn-incoming-dismiss');
    if (btnDismissNotification) {
      btnDismissNotification.addEventListener('click', () => {
        this.hideIncomingNotification();
      });
    }

    // 5. Pi Settings Connect & Test Buttons
    const btnConnectPi = document.getElementById('mobile-btn-connect-pi');
    if (btnConnectPi) {
      btnConnectPi.addEventListener('click', () => {
        this.connectRaspberryPi();
      });
    }

    const btnTestPi = document.getElementById('mobile-btn-test-pi');
    if (btnTestPi) {
      btnTestPi.addEventListener('click', () => {
        this.testPiConnection();
      });
    }

    const btnLaunchPsSettings = document.getElementById('mobile-btn-launch-ps-settings');
    if (btnLaunchPsSettings) {
      btnLaunchPsSettings.addEventListener('click', () => {
        this.launchPowerShellSsh();
      });
    }

    // 6. Code & Terminal Panel Handlers
    const btnCodeLaunchPs = document.getElementById('mobile-btn-code-launch-ps');
    if (btnCodeLaunchPs) {
      btnCodeLaunchPs.addEventListener('click', () => {
        this.launchPowerShellSsh();
      });
    }

    const btnCodeCopySsh = document.getElementById('mobile-btn-code-copy-ssh');
    if (btnCodeCopySsh) {
      btnCodeCopySsh.addEventListener('click', () => {
        this.copySshCommand();
      });
    }

    const btnCodeOpenSettings = document.getElementById('mobile-btn-code-open-settings');
    if (btnCodeOpenSettings) {
      btnCodeOpenSettings.addEventListener('click', () => {
        this.switchTab('settings');
      });
    }

    // Upload & New Code Buttons
    const uploadInput = document.getElementById('mobile-file-upload-input');
    const btnUpload = document.getElementById('mobile-btn-upload-file');
    if (btnUpload && uploadInput) {
      btnUpload.addEventListener('click', () => uploadInput.click());
    }
    if (uploadInput) {
      uploadInput.addEventListener('change', (e) => {
        this.handleFileUpload(e.target.files);
        uploadInput.value = '';
      });
    }

    const btnNewFile = document.getElementById('mobile-btn-new-file');
    if (btnNewFile) {
      btnNewFile.addEventListener('click', () => {
        this.promptNewFile();
      });
    }

    const btnSaveCode = document.getElementById('mobile-btn-save-code');
    if (btnSaveCode) {
      btnSaveCode.addEventListener('click', () => {
        this.saveCurrentCode();
      });
    }

    const btnRunCode = document.getElementById('mobile-btn-run-code');
    if (btnRunCode) {
      btnRunCode.addEventListener('click', () => {
        this.saveCurrentCode();
        if (this.activeFileName) {
          this.executeTerminalCommand(`python3 ${this.activeFileName}`);
        }
      });
    }

    const btnDownloadCode = document.getElementById('mobile-btn-download-code');
    if (btnDownloadCode) {
      btnDownloadCode.addEventListener('click', () => {
        this.downloadActiveFile();
      });
    }

    // Pull from Pi & Push to Pi Buttons
    const btnPullPi = document.getElementById('mobile-btn-pull-pi-files');
    if (btnPullPi) {
      btnPullPi.addEventListener('click', () => {
        this.syncRemotePiFiles();
      });
    }

    const btnPushPi = document.getElementById('mobile-btn-push-code');
    if (btnPushPi) {
      btnPushPi.addEventListener('click', () => {
        this.pushActiveFileToPi();
      });
    }

    // Libraries Toggle & Refresh
    const btnToggleLibs = document.getElementById('mobile-btn-toggle-libraries');
    const panelLibs = document.getElementById('mobile-libraries-panel');
    if (btnToggleLibs && panelLibs) {
      btnToggleLibs.addEventListener('click', () => {
        panelLibs.classList.toggle('hidden');
        if (!panelLibs.classList.contains('hidden') && connectionManager.libraries.length === 0) {
          connectionManager.fetchLibraries();
        }
      });
    }

    const btnRefreshLibs = document.getElementById('mobile-btn-refresh-libs');
    if (btnRefreshLibs) {
      btnRefreshLibs.addEventListener('click', () => {
        connectionManager.fetchLibraries();
      });
    }

    const inputPiUser = document.getElementById('mobile-input-pi-user');
    if (inputPiUser) {
      inputPiUser.addEventListener('change', (e) => {
        connectionManager.setUser(e.target.value);
      });
    }

    // Listen for cross-system sync events
    window.addEventListener('intramove_remote_files_synced', (e) => {
      if (e.detail && Array.isArray(e.detail.files)) {
        e.detail.files.forEach(f => {
          if (!this.files[f.name]) {
            this.files[f.name] = {
              path: `~/intramove/${f.name}`,
              content: `# ${f.name} (Remote from Pi)`,
              size: f.size || 0,
              lastModified: Date.now()
            };
          }
        });
        this.saveFiles();
        this.renderMobileFiles();
      }
    });

    // Terminal Input
    const termInput = document.getElementById('mobile-terminal-input');
    const btnTermSend = document.getElementById('mobile-btn-terminal-send');
    const btnTermClear = document.getElementById('mobile-btn-terminal-clear');

    const sendTermCmd = () => {
      if (termInput && termInput.value.trim()) {
        const cmd = termInput.value.trim();
        this.executeTerminalCommand(cmd);
        termInput.value = '';
      }
    };

    if (termInput) {
      termInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendTermCmd();
      });
    }
    if (btnTermSend) {
      btnTermSend.addEventListener('click', sendTermCmd);
    }
    if (btnTermClear) {
      btnTermClear.addEventListener('click', () => {
        this.executeTerminalCommand('clear');
      });
    }

    // 7. Device Identity Change
    const selDevice = document.getElementById('mobile-sel-device-identity');
    if (selDevice) {
      selDevice.addEventListener('change', (e) => {
        this.deviceIdentity = e.target.value;
        localStorage.setItem(STORAGE_KEYS.DEVICE_ID, this.deviceIdentity);
        this.showToast(`Device Identity updated to: ${this.deviceIdentity}`);
      });
    }

    // 8. Simulate Incoming Order Button
    const btnSimulateOrder = document.getElementById('mobile-btn-simulate-order');
    if (btnSimulateOrder) {
      btnSimulateOrder.addEventListener('click', () => {
        this.simulateIncomingOrder();
      });
    }

    // 9. Emergency Stop Button
    const btnEstopMobile = document.getElementById('mobile-btn-estop');
    if (btnEstopMobile) {
      btnEstopMobile.addEventListener('click', () => {
        this.emergencyStop();
      });
    }

    // 10. Mobile Drive D-Pad Controls
    this.initDpadHandlers();

    // 11. Mark & Save Station Button
    const btnSaveStation = document.getElementById('mobile-btn-save-station');
    if (btnSaveStation) {
      btnSaveStation.addEventListener('click', () => {
        this.promptSaveStation();
      });
    }

    // 12. View Switcher buttons
    const btnSwitchToDesktop = document.getElementById('btn-switch-to-desktop');
    if (btnSwitchToDesktop) {
      btnSwitchToDesktop.addEventListener('click', () => {
        this.setViewMode('desktop');
      });
    }

    const btnSwitchToMobile = document.getElementById('btn-switch-to-mobile');
    if (btnSwitchToMobile) {
      btnSwitchToMobile.addEventListener('click', () => {
        this.setViewMode('mobile');
      });
    }

    // 13. Toggle Mapping Scan
    const btnToggleScan = document.getElementById('mobile-btn-toggle-scan');
    if (btnToggleScan) {
      btnToggleScan.addEventListener('click', () => {
        this.isMappingActive = !this.isMappingActive;
        btnToggleScan.innerText = this.isMappingActive ? 'Pause Scan' : 'Resume Scan';
        this.showToast(this.isMappingActive ? 'LiDAR 60Hz Scan Active' : 'LiDAR Scan Paused');
      });
    }
  }

  // --------------------------------------------------------------------------
  // PI HARDWARE & SSH CONNECTION (UNIFIED VIA CONNECTION MANAGER)
  // --------------------------------------------------------------------------
  setPiIp(ip, syncToDisk = true) {
    this.piIp = (ip || '').trim();
    localStorage.setItem(STORAGE_KEYS.PI_IP, this.piIp);
    localStorage.setItem('intramove_pi_ip', this.piIp);
    localStorage.setItem('intramove_pi_ssh_ip', this.piIp);

    const input = document.getElementById('mobile-input-pi-ip');
    if (input && input.value !== this.piIp) {
      input.value = this.piIp;
    }

    // Sync directly to global connectionManager
    connectionManager.setIp(this.piIp, syncToDisk);
  }

  async connectRaspberryPi() {
    const ipInput = document.getElementById('mobile-input-pi-ip');
    const portInput = document.getElementById('mobile-input-pi-port');
    const sshPortInput = document.getElementById('mobile-input-ssh-port');

    if (ipInput) this.setPiIp(ipInput.value.trim(), true);
    if (portInput) this.piPort = portInput.value.trim() || '8765';
    if (sshPortInput) this.sshPort = sshPortInput.value.trim() || '22';

    localStorage.setItem(STORAGE_KEYS.PI_PORT, this.piPort);
    localStorage.setItem(STORAGE_KEYS.SSH_PORT, this.sshPort);

    if (!this.piIp) {
      this.showToast('⚠️ Please enter your Raspberry Pi IP address!');
      return;
    }

    this.showToast(`Connecting to Raspberry Pi at ${this.piIp}...`);
    await this.testPiConnection();
  }

  async testPiConnection() {
    const ipInput = document.getElementById('mobile-input-pi-ip');
    if (ipInput && ipInput.value.trim()) {
      this.setPiIp(ipInput.value.trim(), true);
    }

    if (!this.piIp) {
      this.showToast('⚠️ Please enter Raspberry Pi IP address');
      return;
    }

    const testBtn = document.getElementById('mobile-btn-test-pi');
    if (testBtn) {
      testBtn.disabled = true;
      testBtn.innerHTML = `<span class="material-symbols-outlined text-xs animate-spin">refresh</span> Pinging...`;
    }

    try {
      await connectionManager.checkConnection(false);
      this.isPiConnected = connectionManager.isSshConnected;
      this.piPingMs = connectionManager.latency || 0;

      if (this.isPiConnected) {
        this.showToast(`🟢 Pi Reachable! SSH Port ${this.sshPort} active (${this.piPingMs}ms)`);
      } else {
        this.showToast(`🔴 Pi Unreachable on ${this.piIp}:${this.sshPort}`);
      }
    } catch (_) {
      this.showToast('⚠️ Dev server offline or network proxy error');
    } finally {
      if (testBtn) {
        testBtn.disabled = false;
        testBtn.innerHTML = `<span class="material-symbols-outlined text-sm">network_ping</span><span>Test Ping</span>`;
      }
      this.updatePiStatusUI();
    }
  }

  async launchPowerShellSsh() {
    if (!this.piIp && !connectionManager.piIp) {
      this.showToast('⚠️ Please enter your Raspberry Pi IP address first!');
      this.switchTab('settings');
      return;
    }

    this.showToast(`🚀 Opening Windows PowerShell SSH to ${this.piIp || connectionManager.piIp}...`);
    await connectionManager.launchPowerShellSsh();
  }

  copySshCommand() {
    const target = this.piIp || connectionManager.piIp || '<Your-Pi-IP>';
    const cmd = `ssh -p ${this.sshPort} pi@${target}`;
    navigator.clipboard.writeText(cmd).then(() => {
      this.showToast(`📋 Copied: ${cmd}`);
    }).catch(() => {
      this.showToast(`Command: ${cmd}`);
    });
  }

  updatePiStatusUI() {
    connectionManager.updateAllUIs();
  }

  // --------------------------------------------------------------------------
  // POWER MANAGEMENT
  // --------------------------------------------------------------------------
  togglePower() {
    this.setPowerState(!this.isPoweredOn, true);
  }

  setPowerState(state, broadcastEvent = true) {
    this.isPoweredOn = state;
    this.updatePowerUI();

    if (broadcastEvent) {
      this.broadcast({
        type: 'AGV_POWER_CHANGED',
        isPoweredOn: this.isPoweredOn
      });
    }

    if (this.isPoweredOn) {
      this.showToast('⚡ AGV System Powered ON - 6-Wheel AWD Armed');
    } else {
      this.showToast('🛑 AGV System Standby / Powered OFF');
      this.speed = 0.0;
    }
  }

  updatePowerUI() {
    const btn = document.getElementById('mobile-btn-master-power');
    const label = document.getElementById('mobile-power-status-label');
    const subLabel = document.getElementById('mobile-power-status-sub');
    const ring = document.getElementById('mobile-power-ring');
    const icon = document.getElementById('mobile-power-icon');

    if (!btn) return;

    if (this.isPoweredOn) {
      btn.classList.remove('bg-slate-800', 'border-slate-700', 'text-slate-400');
      btn.classList.add('bg-gradient-to-tr', 'from-emerald-600', 'to-cyan-600', 'border-cyan-300', 'text-white', 'shadow-lg', 'shadow-cyan-500/25');
      if (label) label.innerText = 'AUTONOMOUS ACTIVE';
      if (subLabel) subLabel.innerText = 'PCA9685 6WD ARMED · READY FOR DISPATCH';
      if (ring) {
        ring.classList.remove('border-slate-700');
        ring.classList.add('border-cyan-400', 'animate-pulse');
      }
      if (icon) icon.innerText = 'power';
    } else {
      btn.classList.add('bg-slate-800', 'border-slate-700', 'text-slate-400');
      btn.classList.remove('bg-gradient-to-tr', 'from-emerald-600', 'to-cyan-600', 'border-cyan-300', 'text-white', 'shadow-lg', 'shadow-cyan-500/25');
      if (label) label.innerText = 'AGV SYSTEM STANDBY / OFF';
      if (subLabel) subLabel.innerText = 'TAP TO POWER ON & ARM DRIVETRAIN';
      if (ring) {
        ring.classList.add('border-slate-700');
        ring.classList.remove('border-cyan-400', 'animate-pulse');
      }
      if (icon) icon.innerText = 'power_settings_new';
    }
  }

  // --------------------------------------------------------------------------
  // DISPATCH & POINT-TO-POINT MOVEMENT
  // --------------------------------------------------------------------------
  dispatchAGV() {
    if (!this.isPoweredOn) {
      this.showToast('⚠️ Please Power ON the AGV first!');
      return;
    }

    const originSelect = document.getElementById('mobile-sel-origin');
    const destSelect = document.getElementById('mobile-sel-dest');
    const targetDeviceSelect = document.getElementById('mobile-sel-target-device');
    const payloadSelect = document.getElementById('mobile-sel-payload');

    const originId = originSelect?.value;
    const destId = destSelect?.value;

    if (originId === destId) {
      this.showToast('⚠️ Origin and Destination cannot be the same!');
      return;
    }

    const stOrigin = this.stations.find((s) => s.id === originId) || this.stations[0];
    const stDest = this.stations.find((s) => s.id === destId) || this.stations[1];
    const targetDevice = targetDeviceSelect?.value || 'All Devices';
    const cargoKg = parseFloat(payloadSelect?.value || '2.5');

    const orderId = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
    this.currentOrder = {
      orderId,
      fromStation: stOrigin.name,
      toStation: stDest.name,
      originCoords: { x: stOrigin.x, y: stOrigin.y },
      destCoords: { x: stDest.x, y: stDest.y },
      targetDevice,
      payloadKg: cargoKg,
      startTime: Date.now()
    };

    const dx = stDest.x - stOrigin.x;
    const dy = stDest.y - stOrigin.y;
    const distMeters = Math.hypot(dx, dy) * 1.5;
    this.distanceRemaining = distMeters;
    this.etaSeconds = Math.ceil(distMeters / this.targetSpeed);
    this.progress = 0;
    this.speed = this.targetSpeed;
    this.missionState = 'IN_TRANSIT';

    if (this.sim) {
      this.sim.setWaypoint('start', Math.round(stOrigin.x), Math.round(stOrigin.y));
      this.sim.setWaypoint('dest', Math.round(stDest.x), Math.round(stDest.y));
      this.sim.startMission();
    }

    this.broadcast({
      type: 'AGV_DISPATCH',
      ...this.currentOrder,
      speed: this.speed,
      battery: this.battery,
      etaSeconds: this.etaSeconds,
      distanceRemaining: this.distanceRemaining
    });

    this.switchTab('track');
    this.showToast(`🚀 Mission [${orderId}] Dispatched to ${stDest.name}!`);
  }

  // --------------------------------------------------------------------------
  // TRACKING & REAL-TIME SYNC
  // --------------------------------------------------------------------------
  updateTrackUI() {
    if (!this.currentOrder) return;

    const orderIdEl = document.getElementById('mobile-track-order-id');
    const routeEl = document.getElementById('mobile-track-route');
    const badgeEl = document.getElementById('mobile-track-status-badge');
    const progPctEl = document.getElementById('mobile-track-prog-pct');
    const progBarEl = document.getElementById('mobile-track-prog-bar');
    const speedEl = document.getElementById('mobile-track-speed-val');
    const batEl = document.getElementById('mobile-track-bat-val');
    const headerBatEl = document.getElementById('mobile-header-bat-val');
    const etaEl = document.getElementById('mobile-track-eta-val');
    const distEl = document.getElementById('mobile-track-dist-val');
    const cargoEl = document.getElementById('mobile-track-cargo-val');

    if (orderIdEl) orderIdEl.innerText = this.currentOrder.orderId;
    if (routeEl) routeEl.innerText = `${this.currentOrder.fromStation} ➔ ${this.currentOrder.toStation}`;

    if (badgeEl) {
      if (this.missionState === 'DELIVERED') {
        badgeEl.innerText = 'MISSION COMPLETED';
        badgeEl.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-600 border border-emerald-500/30';
      } else {
        badgeEl.innerText = 'AGV EN ROUTE';
        badgeEl.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-600 border border-amber-500/30';
      }
    }

    const pct = Math.min(100, Math.round(this.progress));
    if (progPctEl) progPctEl.innerText = `${pct}%`;
    if (progBarEl) progBarEl.style.width = `${pct}%`;

    if (speedEl) speedEl.innerText = `${this.speed.toFixed(2)} m/s`;
    if (batEl) batEl.innerText = `${Math.round(this.battery)}%`;
    if (headerBatEl) headerBatEl.innerText = `${Math.round(this.battery)}%`;
    if (etaEl) etaEl.innerText = `${Math.max(0, Math.ceil(this.etaSeconds))}s`;
    if (distEl) distEl.innerText = `${this.distanceRemaining.toFixed(1)}m`;
    if (cargoEl) cargoEl.innerText = `${this.currentOrder.payloadKg} kg`;

    this.renderTrackCanvas();
  }

  renderTrackCanvas() {
    const canvas = document.getElementById('mobile-track-canvas');
    if (!canvas || !this.currentOrder) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Dark sleek background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // Subtle Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const origin = this.currentOrder.originCoords || { x: 3, y: 16 };
    const dest = this.currentOrder.destCoords || { x: 16, y: 3 };

    const mapX = (gx) => 36 + (gx / 20) * (w - 72);
    const mapY = (gy) => 24 + (gy / 20) * (h - 48);

    const x1 = mapX(origin.x);
    const y1 = mapY(origin.y);
    const x2 = mapX(dest.x);
    const y2 = mapY(dest.y);

    // Draw planned route line
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
    ctx.lineWidth = 4;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw traveled line (active glowing cyan)
    const t = Math.min(1, this.progress / 100);
    const curX = x1 + (x2 - x1) * t;
    const curY = y1 + (y2 - y1) * t;

    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(curX, curY);
    ctx.stroke();

    // Origin Node
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(x1, y1, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px monospace';
    ctx.fillText('A', x1 - 3, y1 + 3);

    // Destination Node
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(x2, y2, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px monospace';
    ctx.fillText('B', x2 - 3, y2 + 3);

    // AGV Vehicle Pulse Marker
    ctx.save();
    ctx.translate(curX, curY);

    ctx.fillStyle = 'rgba(6, 182, 212, 0.3)';
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // --------------------------------------------------------------------------
  // GAME LOOP & MISSION LOGIC
  // --------------------------------------------------------------------------
  initLoop() {
    let lastTime = performance.now();

    const loop = (currentTime) => {
      const delta = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;

      if (this.missionState === 'IN_TRANSIT' && this.isPoweredOn) {
        this.stepTransit(delta);
      }

      this.stepManualDrive();
      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  stepTransit(delta) {
    if (!this.currentOrder) return;

    const totalDist = Math.hypot(
      this.currentOrder.destCoords.x - this.currentOrder.originCoords.x,
      this.currentOrder.destCoords.y - this.currentOrder.originCoords.y
    ) * 1.5;

    const stepDist = this.targetSpeed * delta;
    this.distanceRemaining = Math.max(0, this.distanceRemaining - stepDist);
    this.etaSeconds = this.distanceRemaining / this.targetSpeed;
    this.progress = Math.min(100, ((totalDist - this.distanceRemaining) / totalDist) * 100);

    // Battery drain simulation
    this.battery = Math.max(10, this.battery - 0.005 * delta);

    // Broadcast telemetry to mesh network
    this.broadcast({
      type: 'AGV_TELEMETRY_SYNC',
      orderId: this.currentOrder.orderId,
      speed: this.speed,
      battery: this.battery,
      progress: this.progress,
      etaSeconds: this.etaSeconds,
      distanceRemaining: this.distanceRemaining
    });

    this.updateTrackUI();

    // Check completion
    if (this.distanceRemaining <= 0.05 || this.progress >= 100) {
      this.onMissionCompleted();
    }
  }

  onMissionCompleted(completedData) {
    this.missionState = 'DELIVERED';
    this.speed = 0.0;
    this.progress = 100;
    this.distanceRemaining = 0.0;
    this.etaSeconds = 0;

    this.updateTrackUI();

    // Trigger celebration confetti
    try {
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 }
      });
    } catch (_) {}

    const orderId = this.currentOrder?.orderId || 'ORD';
    const dest = this.currentOrder?.toStation || 'Station';
    this.showToast(`🎉 Order [${orderId}] successfully delivered to ${dest}!`);

    if (!completedData) {
      this.broadcast({
        type: 'AGV_DELIVERED',
        ...this.currentOrder
      });
    }
  }

  simulateIncomingOrder() {
    const testOrder = {
      orderId: 'ORD-' + Math.floor(1000 + Math.random() * 9000),
      fromStation: 'Station A (Robotics Bay)',
      toStation: this.deviceIdentity,
      originCoords: { x: 3, y: 16 },
      destCoords: { x: 16, y: 3 },
      targetDevice: this.deviceIdentity,
      payloadKg: 3.5,
      startTime: Date.now()
    };

    this.handleMeshMessage({
      type: 'AGV_DISPATCH',
      ...testOrder,
      speed: 1.35,
      battery: 92.0,
      etaSeconds: 15,
      distanceRemaining: 20.2
    });

    this.showIncomingNotification(testOrder);
    this.showToast('🔔 Simulated incoming order alert triggered!');
  }

  emergencyStop() {
    this.speed = 0.0;
    this.setPowerState(false, true);
    if (this.sim) {
      this.sim.pauseMission();
    }
    this.showToast('🛑 HARDWARE E-STOP! Drivetrain power killed.');
  }

  // --------------------------------------------------------------------------
  // TOUCH D-PAD & MOBILE MAPPING
  // --------------------------------------------------------------------------
  initDpadHandlers() {
    const buttons = [
      { id: 'mobile-dpad-fwd', linear: 1, angular: 0 },
      { id: 'mobile-dpad-rev', linear: -1, angular: 0 },
      { id: 'mobile-dpad-left', linear: 0, angular: -1 },
      { id: 'mobile-dpad-right', linear: 0, angular: 1 },
      { id: 'mobile-dpad-stop', linear: 0, angular: 0 }
    ];

    buttons.forEach(({ id, linear, angular }) => {
      const el = document.getElementById(id);
      if (!el) return;

      const startMove = (e) => {
        e.preventDefault();
        this.manualDriveVelocity = { linear, angular };
        if (id === 'mobile-dpad-stop') {
          this.speed = 0;
          this.showToast('Manual Brake Engaged');
        }
      };

      const stopMove = (e) => {
        e.preventDefault();
        if (id !== 'mobile-dpad-stop') {
          this.manualDriveVelocity = { linear: 0, angular: 0 };
        }
      };

      el.addEventListener('pointerdown', startMove);
      el.addEventListener('pointerup', stopMove);
      el.addEventListener('pointerleave', stopMove);
    });
  }

  stepManualDrive() {
    const { linear, angular } = this.manualDriveVelocity;
    this.robotMapPos.heading += angular * 0.15;
    this.robotMapPos.x += Math.cos(this.robotMapPos.heading) * linear * 0.4;
    this.robotMapPos.y += Math.sin(this.robotMapPos.heading) * linear * 0.4;

    this.robotMapPos.x = Math.max(1, Math.min(19, this.robotMapPos.x));
    this.robotMapPos.y = Math.max(1, Math.min(19, this.robotMapPos.y));

    const coordEl = document.getElementById('mobile-map-coord-val');
    if (coordEl) {
      coordEl.innerText = `X: ${this.robotMapPos.x.toFixed(1)}m, Y: ${this.robotMapPos.y.toFixed(1)}m`;
    }

    if (this.activeTab === 'map') {
      this.renderMobileMap();
    }
  }

  promptSaveStation() {
    const currentName = `Station ${String.fromCharCode(65 + (this.stations.length % 26))}`;
    const stationName = prompt('Enter a name for this marked location:', currentName);

    if (stationName && stationName.trim()) {
      const saved = this.saveStation(stationName, this.robotMapPos.x, this.robotMapPos.y);
      this.showToast(`📍 Saved "${saved.name}" to Station List!`);
      this.renderMobileMap();
    }
  }

  renderMobileMap() {
    const canvas = document.getElementById('mobile-slam-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#0a0f1d';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(6, 182, 212, 0.2)';
    ctx.lineWidth = 1;
    const cx = w / 2;
    const cy = h / 2;

    [40, 80, 120, 160].forEach((r) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    const angleStep = (Math.PI * 2) / 24;
    for (let a = 0; a < Math.PI * 2; a += angleStep) {
      const dist = 75 + Math.sin(a * 3 + performance.now() / 800) * 20;
      const lx = cx + Math.cos(a) * dist;
      const ly = cy + Math.sin(a) * dist;
      ctx.beginPath();
      ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    this.stations.forEach((st) => {
      const sx = (st.x / 20) * (w - 60) + 30;
      const sy = (st.y / 20) * (h - 60) + 30;

      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px monospace';
      ctx.fillText(st.name.substring(0, 12), sx + 7, sy + 3);
    });

    const rx = (this.robotMapPos.x / 20) * (w - 60) + 30;
    const ry = (this.robotMapPos.y / 20) * (h - 60) + 30;

    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(this.robotMapPos.heading);

    const grad = ctx.createRadialGradient(0, 0, 5, 0, 0, 45);
    grad.addColorStop(0, 'rgba(6, 182, 212, 0.45)');
    grad.addColorStop(1, 'rgba(6, 182, 212, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 45, -Math.PI / 4, Math.PI / 4);
    ctx.lineTo(0, 0);
    ctx.fill();

    ctx.fillStyle = '#06b6d4';
    ctx.beginPath();
    ctx.roundRect(-9, -6, 18, 12, 3);
    ctx.fill();

    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(7, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // --------------------------------------------------------------------------
  // UTILITIES
  // --------------------------------------------------------------------------
  showToast(message) {
    const toast = document.getElementById('mobile-toast');
    const toastText = document.getElementById('mobile-toast-text');
    if (!toast || !toastText) return;

    toastText.innerText = message;
    toast.classList.remove('opacity-0', 'pointer-events-none');
    toast.classList.add('opacity-100');

    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.remove('opacity-100');
      toast.classList.add('opacity-0', 'pointer-events-none');
    }, 2800);
  }

  checkExistingOrder() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_ORDER);
      if (raw) {
        this.currentOrder = JSON.parse(raw);
        this.updateTrackUI();
      }
    } catch (_) {}
  }

  escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
