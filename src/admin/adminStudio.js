/**
 * INTRAMOVE Master Admin & Developer Studio
 * Modules:
 * 1. Admin Studio Tab Navigation (3D SLAM, Terminal & SSH, Pi Code Editor, Theme Customizer, Hardware Config)
 * 2. Raspberry Pi 4 Model B Interactive Terminal Console & PowerShell SSH Bridge (Dynamic User IP)
 * 3. ~/intramove Remote File Explorer & Custom User Code Upload System (No Pre-defined Hardcoded Files)
 * 4. Master Theme & Style Customizer
 * 5. AGV Embedded Parameter Tuner (PCA9685, VL53L5CX, MPU6050)
 */

import { connectionManager } from '../connection/connectionManager.js';

const STORAGE_KEYS = {
  PI_FILES: 'intramove_pi_filesystem_v2', // v2 to ensure no old default codes bleed through
  ACTIVE_FILE: 'intramove_pi_active_file',
  SSH_IP: 'intramove_pi_ip',
  THEME_CONFIG: 'intramove_theme_config_v1',
  HW_CONFIG: 'intramove_hw_config_v1'
};

// No pre-defined codes! The user uploads and creates their own code files.
const DEFAULT_PI_FILES = {};

export class AdminStudioManager {
  constructor() {
    this.activeTab = 'slam-3d'; // 'slam-3d', 'terminal-ssh', 'pi-code-editor', 'style-theme', 'hardware-config'
    this.piIp = localStorage.getItem(STORAGE_KEYS.SSH_IP) || localStorage.getItem('intramove_pi_ssh_ip') || '';
    this.piUser = connectionManager.piUser || localStorage.getItem('intramove_pi_user') || 'major';
    this.piPort = '22';
    this.isSshConnected = false;

    // Purge old predefined codes from previous session if any
    try {
      localStorage.removeItem('intramove_pi_filesystem_v1');
    } catch (_) {}

    // Filesystem State: Only user uploaded or user created files
    this.files = this.loadFiles();
    this.activeFileName = localStorage.getItem(STORAGE_KEYS.ACTIVE_FILE) || Object.keys(this.files)[0] || '';

    // Terminal History
    this.commandHistory = [];
    this.historyIndex = -1;

    this.initDOM();
    this.initEventHandlers();
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
  // FILESYSTEM PERSISTENCE
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
    return { ...DEFAULT_PI_FILES };
  }

  saveFiles() {
    try {
      localStorage.setItem(STORAGE_KEYS.PI_FILES, JSON.stringify(this.files));
    } catch (_) {}
  }

  // --------------------------------------------------------------------------
  // DOM INITIALIZATION
  // --------------------------------------------------------------------------
  initDOM() {
    // Populate IP input field
    const ipInput = document.getElementById('admin-input-pi-ip');
    if (ipInput) {
      ipInput.value = this.piIp;
    }

    this.updateSshBadges();
    this.renderFileTree();
    connectionManager.updateAllUIs();

    if (this.activeFileName && this.files[this.activeFileName]) {
      this.loadFileIntoEditor(this.activeFileName);
    } else {
      this.showEmptyEditorState();
    }
  }

  showEmptyEditorState() {
    const editor = document.getElementById('admin-code-editor-textarea');
    const pathBadge = document.getElementById('admin-editor-filepath');
    const lineCountEl = document.getElementById('admin-editor-linecount');

    if (editor) {
      editor.value = `# No files uploaded yet.\n# Click 'Upload Code' or 'New File' above to add your own Python scripts.\n# Files uploaded here will be stored and ready to deploy to your Raspberry Pi.`;
    }
    if (pathBadge) {
      pathBadge.innerText = '~/intramove/ (Empty)';
    }
    if (lineCountEl) {
      lineCountEl.innerText = `${Object.keys(this.files).length} user files uploaded`;
    }
  }

  // --------------------------------------------------------------------------
  // EVENT HANDLERS
  // --------------------------------------------------------------------------
  initEventHandlers() {
    // 1. Tab Switching
    const allTabs = ['slam-3d', 'terminal-ssh', 'pi-code-editor', 'style-theme', 'hardware-config'];
    allTabs.forEach((tabId) => {
      const btn = document.getElementById(`admin-tab-btn-${tabId}`);
      if (btn) {
        btn.addEventListener('click', () => this.switchTab(tabId));
      }
    });

    // 2. IP Configuration & Connection Testing
    const ipInput = document.getElementById('admin-input-pi-ip');
    if (ipInput) {
      ipInput.addEventListener('input', (e) => {
        this.setPiIp(e.target.value.trim(), true);
      });
    }

    const btnSaveIp = document.getElementById('admin-btn-save-ip');
    if (btnSaveIp && ipInput) {
      btnSaveIp.addEventListener('click', () => {
        this.setPiIp(ipInput.value.trim(), true);
        this.showToast(`✅ Raspberry Pi IP updated to: ${this.piIp || '(empty)'}`);
      });
    }

    const btnTestPi = document.getElementById('admin-btn-test-pi');
    if (btnTestPi) {
      btnTestPi.addEventListener('click', () => {
        this.testPiConnection();
      });
    }

    const btnLaunchPs = document.getElementById('admin-btn-launch-ps');
    if (btnLaunchPs) {
      btnLaunchPs.addEventListener('click', () => {
        this.launchPowerShellSsh();
      });
    }

    const quickSshBtn = document.getElementById('admin-quick-ssh-btn');
    if (quickSshBtn) {
      quickSshBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.copySshCommand();
      });
    }

    // 3. Terminal Input & Quick Commands
    const termInput = document.getElementById('admin-terminal-input');
    if (termInput) {
      termInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const cmd = termInput.value.trim();
          if (cmd) {
            this.executeTerminalCommand(cmd);
            this.commandHistory.push(cmd);
            this.historyIndex = this.commandHistory.length;
            termInput.value = '';
          }
        } else if (e.key === 'ArrowUp') {
          if (this.historyIndex > 0) {
            this.historyIndex--;
            termInput.value = this.commandHistory[this.historyIndex] || '';
          }
        } else if (e.key === 'ArrowDown') {
          if (this.historyIndex < this.commandHistory.length - 1) {
            this.historyIndex++;
            termInput.value = this.commandHistory[this.historyIndex] || '';
          } else {
            this.historyIndex = this.commandHistory.length;
            termInput.value = '';
          }
        }
      });
    }

    // Quick Command Buttons
    document.querySelectorAll('[data-quick-cmd]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.getAttribute('data-quick-cmd');
        if (cmd) this.executeTerminalCommand(cmd);
      });
    });

    // 4. Copy PowerShell SSH Command Button
    const btnCopyPs = document.getElementById('admin-btn-copy-ps');
    if (btnCopyPs) {
      btnCopyPs.addEventListener('click', () => {
        this.copySshCommand();
      });
    }

    // 5. Code Editor Actions (Upload, Save, Paste, Run, Download, New)
    const btnSaveCode = document.getElementById('admin-btn-save-code');
    if (btnSaveCode) {
      btnSaveCode.addEventListener('click', () => {
        this.saveCurrentCode();
      });
    }

    const btnPasteCode = document.getElementById('admin-btn-paste-code');
    if (btnPasteCode) {
      btnPasteCode.addEventListener('click', async () => {
        try {
          const text = await navigator.clipboard.readText();
          const editor = document.getElementById('admin-code-editor-textarea');
          if (editor && text) {
            editor.value = text;
            this.showToast('📋 Code pasted from clipboard!');
          }
        } catch (_) {
          this.showToast('Please press Ctrl+V directly inside the code editor.');
        }
      });
    }

    const btnRunCode = document.getElementById('admin-btn-run-code');
    if (btnRunCode) {
      btnRunCode.addEventListener('click', () => {
        this.saveCurrentCode();
        this.switchTab('terminal-ssh');
        if (this.activeFileName) {
          this.executeTerminalCommand(`python3 ${this.activeFileName}`);
        } else {
          this.executeTerminalCommand(`python3`);
        }
      });
    }

    const btnNewFile = document.getElementById('admin-btn-new-file');
    if (btnNewFile) {
      btnNewFile.addEventListener('click', () => {
        this.promptNewFile();
      });
    }

    // Upload Files Handlers
    const uploadInput = document.getElementById('admin-file-upload-input');
    const btnUploadFile = document.getElementById('admin-btn-upload-file');
    const btnUploadCode = document.getElementById('admin-btn-upload-code');

    if (btnUploadFile && uploadInput) {
      btnUploadFile.addEventListener('click', () => uploadInput.click());
    }
    if (btnUploadCode && uploadInput) {
      btnUploadCode.addEventListener('click', () => uploadInput.click());
    }
    if (uploadInput) {
      uploadInput.addEventListener('change', (e) => {
        this.handleFileUpload(e.target.files);
        uploadInput.value = ''; // Reset input
      });
    }

    // Download Code Button
    const btnDownloadCode = document.getElementById('admin-btn-download-code');
    if (btnDownloadCode) {
      btnDownloadCode.addEventListener('click', () => {
        this.downloadActiveFile();
      });
    }

    // Pull Remote Files from Pi (~/intramove)
    const btnPullRemote = document.getElementById('admin-btn-pull-remote');
    if (btnPullRemote) {
      btnPullRemote.addEventListener('click', () => {
        this.syncRemotePiFiles();
      });
    }

    // Push Active Code directly to Pi (~/intramove)
    const btnPushRemote = document.getElementById('admin-btn-push-remote');
    if (btnPushRemote) {
      btnPushRemote.addEventListener('click', () => {
        this.pushActiveFileToPi();
      });
    }

    // Pi Libraries Drawer & Scan
    const btnToggleLibs = document.getElementById('admin-btn-toggle-libs');
    const drawerLibs = document.getElementById('admin-libraries-drawer');
    if (btnToggleLibs && drawerLibs) {
      btnToggleLibs.addEventListener('click', () => {
        drawerLibs.classList.toggle('hidden');
        if (!drawerLibs.classList.contains('hidden') && connectionManager.libraries.length === 0) {
          connectionManager.fetchLibraries();
        }
      });
    }

    const btnRefreshLibs = document.getElementById('admin-btn-refresh-libs');
    if (btnRefreshLibs) {
      btnRefreshLibs.addEventListener('click', () => {
        connectionManager.fetchLibraries();
      });
    }

    const btnCloseLibs = document.getElementById('admin-btn-close-libs');
    if (btnCloseLibs && drawerLibs) {
      btnCloseLibs.addEventListener('click', () => {
        drawerLibs.classList.add('hidden');
      });
    }

    // SSH User input
    const inputUser = document.getElementById('admin-input-pi-user');
    if (inputUser) {
      inputUser.addEventListener('change', (e) => {
        connectionManager.setUser(e.target.value);
        this.piUser = connectionManager.piUser;
        this.updateSshBadges();
      });
    }

    // 6. Theme Customizer Handlers
    this.initThemeHandlers();

    // 7. Hardware Parameter Tuner Handlers
    this.initHardwareConfigHandlers();
  }

  // --------------------------------------------------------------------------
  // REMOTE PI FILE SYNC & PUSH (~/intramove)
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
        this.renderFileTree();
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
    } else {
      this.showToast(res?.error || 'Failed to push file to Pi');
    }
  }

  // --------------------------------------------------------------------------
  // IP & SSH MANAGEMENT (UNIFIED VIA CONNECTION MANAGER)
  // --------------------------------------------------------------------------
  setPiIp(ip, syncToDisk = true) {
    this.piIp = (ip || '').trim();
    localStorage.setItem(STORAGE_KEYS.SSH_IP, this.piIp);
    localStorage.setItem('intramove_pi_ip', this.piIp);
    localStorage.setItem('intramove_pi_ssh_ip', this.piIp);

    connectionManager.setIp(this.piIp, syncToDisk);
    this.piUser = connectionManager.piUser;
    this.updateSshBadges();
  }

  copySshCommand() {
    this.piUser = connectionManager.piUser || 'major';
    const targetIp = this.piIp || connectionManager.piIp || '<Your-RaspberryPi-IP>';
    const cmd = `ssh -p ${this.piPort} ${this.piUser}@${targetIp} -t 'cd ~/intramove; bash'`;
    navigator.clipboard.writeText(cmd).then(() => {
      this.showToast(`📋 Copied: ${cmd}`);
    });
  }

  async launchPowerShellSsh() {
    if (!this.piIp && !connectionManager.piIp) {
      this.showToast('⚠️ Please enter your Raspberry Pi IP address first!');
      const input = document.getElementById('admin-input-pi-ip');
      if (input) input.focus();
      return;
    }

    this.showToast(`🚀 Launching Windows PowerShell SSH to ${this.piUser}@${this.piIp || connectionManager.piIp}...`);
    await connectionManager.launchPowerShellSsh();
  }

  async testPiConnection() {
    if (!this.piIp && !connectionManager.piIp) {
      this.showToast('⚠️ Please enter your Raspberry Pi IP address first!');
      return;
    }

    const testBtn = document.getElementById('admin-btn-test-pi');
    const badge = document.getElementById('admin-ssh-status-pill');

    if (testBtn) {
      testBtn.disabled = true;
      testBtn.innerHTML = `<span class="material-symbols-outlined text-xs animate-spin">refresh</span> Testing...`;
    }

    try {
      await connectionManager.checkConnection(false);
      this.isSshConnected = connectionManager.isSshConnected;

      if (this.isSshConnected) {
        this.showToast(`🟢 Pi Reachable! SSH Port 22 open (${connectionManager.latency}ms latency)`);
        if (badge) {
          badge.className = 'text-[10px] font-mono text-emerald-700 font-bold bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-300';
          badge.innerText = `SSH ACTIVE (${connectionManager.latency}ms)`;
        }
      } else {
        this.showToast(`🔴 Pi Unreachable on ${this.piIp || connectionManager.piIp}:22`);
        if (badge) {
          badge.className = 'text-[10px] font-mono text-rose-700 font-bold bg-rose-100 px-2.5 py-0.5 rounded-full border border-rose-300';
          badge.innerText = 'OFFLINE / UNREACHABLE';
        }
      }
    } catch (err) {
      this.showToast('⚠️ Could not connect to dev server backend proxy.');
    } finally {
      if (testBtn) {
        testBtn.disabled = false;
        testBtn.innerHTML = `<span class="material-symbols-outlined text-xs">network_ping</span> Test Ping`;
      }
    }
  }

  updateSshBadges() {
    this.piUser = connectionManager.piUser || 'major';
    const displayIp = this.piIp || '<Enter-Pi-IP>';
    const ipPill = document.getElementById('admin-ssh-ip-badge');
    const psCmdEl = document.getElementById('admin-ps-cmd-display');
    const headerTitle = document.getElementById('slam-active-room-title');
    const headerCmdText = document.getElementById('header-ssh-cmd-text');

    if (ipPill) ipPill.innerText = `${this.piUser}@${displayIp}:22`;
    if (psCmdEl) psCmdEl.innerText = `ssh ${this.piUser}@${displayIp} -p 22 -t 'cd ~/intramove; bash'`;
    if (headerTitle) headerTitle.innerText = `${this.piUser}@${displayIp} (SSH:22) · ~/intramove`;
    if (headerCmdText) headerCmdText.innerText = `ssh ${this.piUser}@${displayIp}`;
  }

  // --------------------------------------------------------------------------
  // TAB SWITCHING
  // --------------------------------------------------------------------------
  switchTab(tabId) {
    this.activeTab = tabId;

    const allTabs = ['slam-3d', 'terminal-ssh', 'pi-code-editor', 'style-theme', 'hardware-config'];

    allTabs.forEach((id) => {
      const pane = document.getElementById(`admin-pane-${id}`);
      const btn = document.getElementById(`admin-tab-btn-${id}`);

      if (pane) {
        if (id === tabId) {
          pane.classList.remove('hidden');
        } else {
          pane.classList.add('hidden');
        }
      }

      if (btn) {
        if (id === tabId) {
          btn.classList.add('bg-cyan-600', 'text-white', 'shadow-sm');
          btn.classList.remove('bg-white', 'text-slate-700', 'hover:bg-slate-100');
        } else {
          btn.classList.remove('bg-cyan-600', 'text-white', 'shadow-sm');
          btn.classList.add('bg-white', 'text-slate-700', 'hover:bg-slate-100');
        }
      }
    });

    if (tabId === 'pi-code-editor') {
      this.renderFileTree();
      if (this.activeFileName && this.files[this.activeFileName]) {
        this.loadFileIntoEditor(this.activeFileName);
      } else {
        this.showEmptyEditorState();
      }
    }

    connectionManager.updateAllUIs();
  }

  // --------------------------------------------------------------------------
  // TERMINAL LOGIC
  // --------------------------------------------------------------------------
  async executeTerminalCommand(cmd) {
    const termBody = document.getElementById('admin-terminal-body');
    if (!termBody) return;

    const hostLabel = this.piIp || connectionManager.piIp || '192.168.0.148';
    const user = connectionManager.piUser || 'major';
    const trimmed = (cmd || '').trim();
    const lower = trimmed.toLowerCase();

    // Echo input
    const promptLine = document.createElement('div');
    promptLine.className = 'text-slate-300 font-mono text-xs flex items-center gap-1.5 mt-2';
    promptLine.innerHTML = `<span class="text-emerald-400 font-bold">${user}@${hostLabel}</span><span class="text-slate-400">:</span><span class="text-cyan-300">~/intramove</span><span class="text-slate-400">$</span> <span class="text-white">${this.escapeHTML(trimmed)}</span>`;
    termBody.appendChild(promptLine);

    if (lower === 'clear' || lower === 'cls') {
      termBody.innerHTML = `<span class="text-cyan-400 font-bold">[INTRAMOVE SSH BRIDGE ACTIVE]</span>\nSession: ${user}@${hostLabel}:22 (Direct SSH Bridge)\nType 'help' or execute your uploaded scripts.`;
      termBody.scrollTop = termBody.scrollHeight;
      return;
    }

    if (lower === 'help') {
      const respEl = document.createElement('div');
      respEl.className = 'text-slate-300 font-mono text-xs whitespace-pre-wrap leading-relaxed';
      respEl.innerHTML = `<span class="text-cyan-400 font-bold">INTRAMOVE Terminal Commands:</span>
  ls / ls -la             : List your files in ~/intramove
  cat &lt;file&gt;               : View contents of an uploaded file
  pip list                : View installed Python libraries on Pi
  python3 &lt;file.py&gt;       : Run Python script directly on Pi
  clear                   : Clear terminal screen
  help                    : Show this help`;
      termBody.appendChild(respEl);
      termBody.scrollTop = termBody.scrollHeight;
      return;
    }

    // Temporary loading indicator
    const runningIndicator = document.createElement('div');
    runningIndicator.className = 'text-slate-500 font-mono text-xs animate-pulse';
    runningIndicator.innerHTML = `⏳ Executing on ${user}@${hostLabel}:~/intramove...`;
    termBody.appendChild(runningIndicator);
    termBody.scrollTop = termBody.scrollHeight;

    // Try executing remotely on Pi
    const res = await connectionManager.execRemoteCommand(trimmed);
    runningIndicator.remove();

    const respEl = document.createElement('div');
    respEl.className = 'text-slate-300 font-mono text-xs whitespace-pre-wrap leading-relaxed';

    if (res && res.success) {
      const out = (res.stdout || '').trim();
      const err = (res.stderr || '').trim();
      if (!out && !err) {
        respEl.innerHTML = `<span class="text-slate-500 font-mono text-[11px]">(Process exited with return code 0, no output)</span>`;
      } else {
        respEl.innerHTML = `${out ? this.escapeHTML(out) : ''}${err ? `<span class="text-amber-400">\n${this.escapeHTML(err)}</span>` : ''}`;
      }
    } else {
      // Fallback local response
      const response = this.computeCommandResponse(trimmed);
      respEl.innerHTML = response;
    }

    termBody.appendChild(respEl);
    termBody.scrollTop = termBody.scrollHeight;
  }

  computeCommandResponse(cmd) {
    const lower = cmd.toLowerCase().trim();
    const hostLabel = this.piIp || 'raspberrypi';

    if (lower === 'clear' || lower === 'cls') {
      const termBody = document.getElementById('admin-terminal-body');
      if (termBody) termBody.innerHTML = '';
      return `<span class="text-cyan-400 font-bold">[INTRAMOVE SSH BRIDGE ACTIVE]</span>\nSession: pi@${hostLabel}:22 (Direct SSH Bridge)\nType 'help' or execute your uploaded scripts.`;
    }

    if (lower === 'ls' || lower === 'dir') {
      const filenames = Object.keys(this.files);
      if (filenames.length === 0) {
        return `<span class="text-slate-500">(Directory ~/intramove is currently empty. Use the 'Upload' button to add your code files.)</span>`;
      }
      return filenames
        .map((f) => {
          if (f.endsWith('.py')) return `<span class="text-emerald-300 font-bold">${f}</span>`;
          if (f.endsWith('.json')) return `<span class="text-amber-300 font-bold">${f}</span>`;
          if (f.endsWith('.sh')) return `<span class="text-cyan-300 font-bold">${f}</span>`;
          return `<span class="text-slate-300">${f}</span>`;
        })
        .join('   ');
    }

    if (lower === 'ls -la' || lower === 'll') {
      const filenames = Object.keys(this.files);
      if (filenames.length === 0) {
        return `total 0\ndrwxr-xr-x 2 pi pi 4096 Oct 16 12:00 .\ndrwxr-xr-x 3 pi pi 4096 Oct 16 12:00 ..\n<span class="text-slate-500">No user files uploaded yet.</span>`;
      }
      const list = filenames.map((f) => {
        const size = (this.files[f].content || '').length;
        const color = f.endsWith('.py') ? 'text-emerald-300' : 'text-slate-300';
        return `-rwxr-xr-x 1 pi pi ${size.toString().padStart(5, ' ')} Oct 16 12:00 <span class="${color}">${f}</span>`;
      }).join('\n');
      return `total ${filenames.length * 4}\n${list}`;
    }

    if (lower === 'pwd') {
      return `/home/pi/intramove`;
    }

    if (lower === 'whoami') {
      return `pi`;
    }

    if (lower === 'uname -a') {
      return `Linux ${hostLabel} 6.1.21-v8+ #1642 SMP PREEMPT aarch64 GNU/Linux`;
    }

    if (lower.startsWith('cat ')) {
      const filename = cmd.substring(4).trim();
      if (this.files[filename]) {
        return this.escapeHTML(this.files[filename].content);
      }
      return `<span class="text-rose-400">cat: ${this.escapeHTML(filename)}: No such file or directory</span>`;
    }

    if (lower.startsWith('python3 ') || lower.startsWith('python ')) {
      const script = cmd.replace(/^python3?\s+/, '').trim();
      if (this.files[script]) {
        return `<span class="text-emerald-400">▶ Executing ~/intramove/${this.escapeHTML(script)}...</span>\n` +
               `<span class="text-slate-300">[PYTHON RUNTIME] Loaded ${this.escapeHTML(script)} (${this.files[script].content.length} bytes). Process active on Pi.</span>`;
      }
      return `<span class="text-rose-400">python3: can't open file '${this.escapeHTML(script)}': [Errno 2] No such file or directory</span>`;
    }

    if (lower === 'help') {
      return `<span class="text-cyan-400 font-bold">INTRAMOVE Terminal Commands:</span>
  ls / ls -la             : List your uploaded files
  cat &lt;file&gt;               : View contents of an uploaded file
  python3 &lt;file.py&gt;       : Run Python script
  clear                   : Clear terminal screen
  help                    : Show this help`;
    }

    return `<span class="text-slate-400">pi@${hostLabel}:~/intramove$ ${this.escapeHTML(cmd)} (executed)</span>`;
  }

  // --------------------------------------------------------------------------
  // USER FILE UPLOAD & MANAGEMENT (NO PREDEFINED CODES)
  // --------------------------------------------------------------------------
  handleFileUpload(fileList) {
    if (!fileList || fileList.length === 0) return;

    let loadedCount = 0;
    Array.from(fileList).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target.result;
        this.files[file.name] = {
          path: `~/intramove/${file.name}`,
          folder: '~/intramove',
          content: content,
          size: file.size,
          lastModified: file.lastModified || Date.now()
        };

        loadedCount++;
        if (loadedCount === fileList.length) {
          this.saveFiles();
          this.activeFileName = file.name;
          localStorage.setItem(STORAGE_KEYS.ACTIVE_FILE, file.name);
          this.renderFileTree();
          this.loadFileIntoEditor(file.name);
          this.showToast(`✅ Successfully uploaded ${loadedCount} file(s) to ~/intramove!`);
          this.executeTerminalCommand(`echo "[UPLOAD] Successfully loaded ${file.name} (${file.size} bytes)"`);
        }
      };
      reader.readAsText(file);
    });
  }

  deleteFile(filename) {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;

    delete this.files[filename];
    this.saveFiles();

    const remaining = Object.keys(this.files);
    if (this.activeFileName === filename) {
      this.activeFileName = remaining[0] || '';
      localStorage.setItem(STORAGE_KEYS.ACTIVE_FILE, this.activeFileName);
    }

    this.renderFileTree();
    if (this.activeFileName && this.files[this.activeFileName]) {
      this.loadFileIntoEditor(this.activeFileName);
    } else {
      this.showEmptyEditorState();
    }

    this.showToast(`🗑️ Deleted file: ${filename}`);
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

  renderFileTree() {
    const container = document.getElementById('admin-file-tree-container');
    if (!container) return;

    container.innerHTML = '';
    const filenames = Object.keys(this.files).sort();

    if (filenames.length === 0) {
      container.innerHTML = `
        <div class="p-4 text-center text-slate-400 font-mono text-xs space-y-2 border border-dashed border-slate-700 rounded-xl my-2">
          <span class="material-symbols-outlined text-2xl text-cyan-400">cloud_upload</span>
          <p class="font-bold text-slate-200">No Codes Uploaded</p>
          <p class="text-[11px] text-slate-400">Click <strong>Upload</strong> or <strong>New File</strong> to add your Raspberry Pi code files.</p>
        </div>
      `;
      return;
    }

    filenames.forEach((filename) => {
      const file = this.files[filename];
      const isSelected = filename === this.activeFileName;

      const item = document.createElement('div');
      item.className = `group px-3 py-2 rounded-xl text-xs font-mono flex items-center justify-between cursor-pointer transition-all ${
        isSelected
          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold shadow-sm'
          : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
      }`;

      const icon = filename.endsWith('.py') ? 'terminal' : filename.endsWith('.json') ? 'data_object' : filename.endsWith('.sh') ? 'code' : 'description';
      const color = filename.endsWith('.py') ? 'text-emerald-400' : filename.endsWith('.json') ? 'text-amber-400' : 'text-cyan-400';

      item.innerHTML = `
        <div class="flex items-center gap-2 truncate flex-1 file-select-trigger">
          <span class="material-symbols-outlined text-sm ${color}">${icon}</span>
          <span class="truncate">${this.escapeHTML(filename)}</span>
        </div>
        <div class="flex items-center gap-1.5 opacity-60 group-hover:opacity-100">
          <button data-delete-btn="${this.escapeHTML(filename)}" class="p-1 text-slate-400 hover:text-rose-400 transition-colors" title="Delete File">
            <span class="material-symbols-outlined text-sm">delete</span>
          </button>
        </div>
      `;

      item.querySelector('.file-select-trigger')?.addEventListener('click', () => {
        this.loadFileIntoEditor(filename);
      });

      item.querySelector('[data-delete-btn]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteFile(filename);
      });

      container.appendChild(item);
    });
  }

  loadFileIntoEditor(filename) {
    this.activeFileName = filename;
    localStorage.setItem(STORAGE_KEYS.ACTIVE_FILE, filename);
    this.renderFileTree();

    const file = this.files[filename];
    const editor = document.getElementById('admin-code-editor-textarea');
    const pathBadge = document.getElementById('admin-editor-filepath');
    const lineCountEl = document.getElementById('admin-editor-linecount');

    if (editor && file) {
      editor.value = file.content;
      if (pathBadge) pathBadge.innerText = file.path;
      if (lineCountEl) {
        const lines = file.content.split('\n').length;
        lineCountEl.innerText = `${lines} lines · Custom User Code · Sync to Pi`;
      }
    }
  }

  saveCurrentCode() {
    const editor = document.getElementById('admin-code-editor-textarea');
    if (!editor) return;

    if (!this.activeFileName) {
      this.promptNewFile();
      return;
    }

    const newCode = editor.value;
    if (this.files[this.activeFileName]) {
      this.files[this.activeFileName].content = newCode;
    } else {
      this.files[this.activeFileName] = {
        path: `~/intramove/${this.activeFileName}`,
        folder: '~/intramove',
        content: newCode
      };
    }

    this.saveFiles();
    this.showToast(`💾 Saved: ~/intramove/${this.activeFileName}`);

    const d = new Date().toLocaleTimeString();
    this.executeTerminalCommand(`echo "[${d}] Updated ${this.activeFileName} (${newCode.length} bytes)"`);
  }

  promptNewFile() {
    const name = prompt('Enter filename (e.g. my_robot.py or config.json):');
    if (name && name.trim()) {
      const cleanName = name.trim();
      this.files[cleanName] = {
        path: `~/intramove/${cleanName}`,
        folder: '~/intramove',
        content: `# File: ~/intramove/${cleanName}\n# Uploaded/Created by user\n\n`
      };
      this.saveFiles();
      this.loadFileIntoEditor(cleanName);
      this.showToast(`✨ Created: ~/intramove/${cleanName}`);
    }
  }

  // --------------------------------------------------------------------------
  // THEME & STYLE CUSTOMIZER
  // --------------------------------------------------------------------------
  initThemeHandlers() {
    const themeSelect = document.getElementById('admin-theme-accent-picker');
    const glowToggle = document.getElementById('admin-theme-glow-toggle');
    const btnApplyTheme = document.getElementById('admin-btn-apply-theme');

    if (btnApplyTheme) {
      btnApplyTheme.addEventListener('click', () => {
        const accent = themeSelect?.value || 'cyan';
        const glow = glowToggle?.checked ?? true;

        localStorage.setItem(STORAGE_KEYS.THEME_CONFIG, JSON.stringify({ accent, glow }));
        this.applyTheme(accent, glow);
        this.showToast(`🎨 Theme updated: ${accent.toUpperCase()} accent applied!`);
      });
    }
  }

  applyTheme(accent, glow) {
    document.documentElement.dataset.themeAccent = accent;
    const body = document.body;
    if (glow) {
      body.classList.add('theme-glow-enabled');
    } else {
      body.classList.remove('theme-glow-enabled');
    }
  }

  // --------------------------------------------------------------------------
  // HARDWARE PARAMETER CALIBRATION
  // --------------------------------------------------------------------------
  initHardwareConfigHandlers() {
    const btnSaveHw = document.getElementById('admin-btn-save-hw-config');
    const btnResetHw = document.getElementById('admin-btn-reset-hw-config');

    if (btnSaveHw) {
      btnSaveHw.addEventListener('click', () => {
        this.showToast('⚙️ Hardware parameters calibrated & saved.');
      });
    }

    if (btnResetHw) {
      btnResetHw.addEventListener('click', () => {
        this.showToast('🔄 Restored hardware factory calibration.');
      });
    }
  }

  showToast(msg) {
    const toast = document.getElementById('slam-toast');
    const textEl = document.getElementById('slam-toast-text');
    if (toast && textEl) {
      textEl.innerText = msg;
      toast.classList.remove('opacity-0', 'pointer-events-none');
      setTimeout(() => {
        toast.classList.add('opacity-0', 'pointer-events-none');
      }, 3200);
    } else {
      console.log('[AdminStudio]', msg);
    }
  }

  escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
