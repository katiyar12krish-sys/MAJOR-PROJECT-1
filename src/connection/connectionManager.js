/**
 * INTRAMOVE Unified Connection & Activity Telemetry Manager
 * Synchronizes real-time Raspberry Pi connection state, port statuses,
 * disconnect/reconnect events, and activity logs across both:
 *  - Phone View (mobile-app-shell)
 *  - Laptop / Desktop View (desktop-showcase-shell & slam-mapping.html)
 */

const STORAGE_KEYS = {
  PI_IP: 'intramove_pi_ip',
  PI_USER: 'intramove_pi_user',
  PI_PASS: 'intramove_pi_pass',
  SSH_PORT: 'intramove_pi_ssh_port',
  WS_PORT: 'intramove_pi_port',
  LOGS: 'intramove_connection_logs_v1',
  HEARTBEAT: 'intramove_auto_heartbeat',
  REMOTE_DIR: 'intramove_pi_remote_dir',
  CACHED_FILES: 'intramove_cached_remote_files',
  CACHED_CONTENTS: 'intramove_cached_file_contents'
};

export class ConnectionManager {
  constructor() {
    this.piIp = localStorage.getItem(STORAGE_KEYS.PI_IP) || localStorage.getItem('intramove_pi_ssh_ip') || '';
    this.piUser = localStorage.getItem(STORAGE_KEYS.PI_USER) || 'major';
    this.piPass = localStorage.getItem(STORAGE_KEYS.PI_PASS) || '';
    this.sshPort = localStorage.getItem(STORAGE_KEYS.SSH_PORT) || '22';
    this.wsPort = localStorage.getItem(STORAGE_KEYS.WS_PORT) || '8765';
    this.webPort = window.location.port || '5173';
    this.remoteDir = localStorage.getItem(STORAGE_KEYS.REMOTE_DIR) || '~/intra_move';

    this.isSshConnected = false;
    this.isWsConnected = false;
    this.latency = null;
    this.currentActivity = this.piIp ? `Ready to connect to ${this.piUser}@${this.piIp}` : 'Standby · No IP configured';
    this.autoHeartbeat = localStorage.getItem(STORAGE_KEYS.HEARTBEAT) !== 'false';

    this.logs = this.loadLogs();
    this.libraries = [];
    this.remoteFiles = this.loadCachedFiles();
    this.cachedContents = this.loadCachedContents();
    this.channel = null;
    this.heartbeatTimer = null;
    this.isChecking = false;

    this.initBroadcast();
    this.initHeartbeat();
    this.syncSavedIpFromDisk();

    // Initial log if empty
    if (this.logs.length === 0) {
      this.addLog(`Connection Manager active. Target: ${this.piUser}@${this.piIp || '<Your-Pi-IP>'}:22 (Dir: ~/intramove)`, 'info', 'SYS');
    }
  }

  async syncSavedIpFromDisk() {
    try {
      const res = await fetch('/api/pi/get-ip');
      if (res.ok) {
        const data = await res.json();
        if (data.ip && !this.piIp) {
          this.setIp(data.ip, false);
        }
        if (data.user) {
          this.setUser(data.user, false);
        }
        if (data.password && !this.piPass) {
          this.setPass(data.password, false);
        }
      }
    } catch (_) {}
  }

  // --------------------------------------------------------------------------
  // BROADCAST & STORAGE SYNC (PHONE VIEW <-> DESKTOP VIEW)
  // --------------------------------------------------------------------------
  initBroadcast() {
    try {
      if ('BroadcastChannel' in window) {
        this.channel = new BroadcastChannel('intramove_conn_channel');
        this.channel.onmessage = (e) => {
          this.handleBroadcastMessage(e.data);
        };
      }
    } catch (_) {}

    window.addEventListener('storage', (e) => {
      if (e.key === 'intramove_conn_event' && e.newValue) {
        try {
          this.handleBroadcastMessage(JSON.parse(e.newValue));
        } catch (_) {}
      }
    });
  }

  broadcast(data) {
    const payload = { ...data, timestamp: Date.now() };
    if (this.channel) {
      this.channel.postMessage(payload);
    }
    try {
      localStorage.setItem('intramove_conn_event', JSON.stringify(payload));
    } catch (_) {}
  }

  handleBroadcastMessage(data) {
    if (!data) return;

    if (data.type === 'IP_CHANGED') {
      this.piIp = data.piIp;
      this.updateAllUIs();
    } else if (data.type === 'USER_CHANGED') {
      this.piUser = data.piUser;
      this.updateAllUIs();
    } else if (data.type === 'PASS_CHANGED') {
      this.piPass = data.piPass;
      this.updateAllUIs();
    } else if (data.type === 'STATUS_UPDATE') {
      this.isSshConnected = data.isSshConnected;
      this.latency = data.latency;
      this.currentActivity = data.currentActivity;
      this.updateAllUIs();
    } else if (data.type === 'NEW_LOG') {
      if (!this.logs.some(l => l.id === data.log.id)) {
        this.logs.unshift(data.log);
        if (this.logs.length > 50) this.logs.pop();
        this.renderLogs();
      }
    }
  }

  loadLogs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LOGS);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return [];
  }

  saveLogs() {
    try {
      localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(this.logs.slice(0, 50)));
    } catch (_) {}
  }

  addLog(text, level = 'info', tag = 'PORT 22') {
    const d = new Date();
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    const logItem = {
      id: 'log_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      time,
      tag,
      level, // 'success', 'error', 'warn', 'info'
      text
    };

    this.logs.unshift(logItem);
    if (this.logs.length > 50) this.logs.pop();
    this.saveLogs();
    this.renderLogs();

    this.broadcast({ type: 'NEW_LOG', log: logItem });
  }

  clearLogs() {
    this.logs = [];
    this.saveLogs();
    this.renderLogs();
    this.addLog('Activity logs cleared by user.', 'info', 'SYS');
  }

  // --------------------------------------------------------------------------
  // IP, USER, PASSWORD & CONNECTION CONTROL
  // --------------------------------------------------------------------------
  setPass(pass, syncToDisk = true) {
    const cleanPass = (pass || '').trim();
    if (cleanPass === this.piPass && !syncToDisk) return;
    this.piPass = cleanPass;
    localStorage.setItem(STORAGE_KEYS.PI_PASS, cleanPass);

    if (syncToDisk) {
      fetch('/api/pi/save-ip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: this.piIp, user: this.piUser, password: cleanPass })
      }).catch(() => {});
    }

    if (cleanPass) {
      this.addLog(`SSH Password configured for [${this.piUser}@${this.piIp || 'Pi'}]. Ready for direct remote commands & library scan.`, 'success', 'AUTH');
    }
    this.broadcast({ type: 'PASS_CHANGED', piPass: this.piPass });
    this.updateAllUIs();
  }

  setIp(ipOrUserHost, syncToDisk = true) {
    let raw = (ipOrUserHost || '').trim();
    if (raw.includes('@')) {
      const parts = raw.split('@');
      this.setUser(parts[0], syncToDisk);
      raw = parts[1];
    }
    const cleanIp = raw.trim();
    if (cleanIp === this.piIp) return;

    const oldIp = this.piIp;
    this.piIp = cleanIp;
    localStorage.setItem(STORAGE_KEYS.PI_IP, cleanIp);
    localStorage.setItem('intramove_pi_ip', cleanIp);
    localStorage.setItem('intramove_pi_ssh_ip', cleanIp);

    if (cleanIp) {
      this.addLog(`Target Pi host updated: [${this.piUser}@${cleanIp}]`, 'info', 'CONFIG');
      this.currentActivity = `Target updated to ${this.piUser}@${cleanIp}. Testing port 22...`;
    } else {
      this.addLog(`Raspberry Pi IP cleared. Running in local simulation mode.`, 'warn', 'CONFIG');
      this.currentActivity = `Standby · No IP configured`;
      this.isSshConnected = false;
    }

    if (syncToDisk && cleanIp) {
      fetch('/api/pi/save-ip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: cleanIp, user: this.piUser, password: this.piPass })
      }).catch(() => {});
    }

    this.broadcast({ type: 'IP_CHANGED', piIp: this.piIp, piUser: this.piUser });
    this.updateAllUIs();

    if (cleanIp) {
      this.checkConnection(false);
    }
  }

  setUser(user, syncToDisk = true) {
    const cleanUser = (user || 'major').trim();
    if (cleanUser === this.piUser) return;
    this.piUser = cleanUser;
    localStorage.setItem(STORAGE_KEYS.PI_USER, cleanUser);

    if (syncToDisk && this.piIp) {
      fetch('/api/pi/save-ip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: this.piIp, user: cleanUser, password: this.piPass })
      }).catch(() => {});
    }

    this.addLog(`SSH Username set to [${cleanUser}] (Target: ${cleanUser}@${this.piIp || '...'}:~/intramove)`, 'info', 'CONFIG');
    this.broadcast({ type: 'USER_CHANGED', piUser: this.piUser });
    this.updateAllUIs();
  }

  async checkConnection(silent = false) {
    if (!this.piIp) {
      if (!silent) this.addLog('Cannot test connection: No IP address entered.', 'warn', 'PORT 22');
      this.isSshConnected = false;
      this.updateAllUIs();
      return;
    }

    if (this.isChecking) return;
    this.isChecking = true;

    if (!silent) {
      this.currentActivity = `Pinging Raspberry Pi [${this.piUser}@${this.piIp}:${this.sshPort}]...`;
      this.updateAllUIs();
    }

    try {
      const res = await fetch(`/api/pi/test-connection?ip=${encodeURIComponent(this.piIp)}&port=${this.sshPort}`);
      const data = await res.json();

      if (data.success) {
        const wasConnected = this.isSshConnected;
        this.isSshConnected = true;
        this.latency = data.latency;
        this.currentActivity = `SSH Active on ${this.piUser}@${this.piIp}:${this.sshPort} (${data.latency}ms)`;

        if (!wasConnected) {
          this.addLog(`🟢 CONNECTED to Raspberry Pi [${this.piUser}@${this.piIp}] on Port 22 (SSH)! Latency: ${data.latency}ms`, 'success', 'PORT 22');
        } else if (!silent) {
          this.addLog(`Ping response from [${this.piIp}:22]: ${data.latency}ms (SSH OK)`, 'success', 'PORT 22');
        }
      } else {
        const wasConnected = this.isSshConnected;
        this.isSshConnected = false;
        this.latency = null;
        this.currentActivity = `Disconnected from ${this.piIp} (${data.error || 'Port closed'})`;

        if (wasConnected) {
          this.addLog(`❌ CONNECTION BROKEN! Lost connection to Raspberry Pi [${this.piIp}] on Port 22. Reason: ${data.error || 'Host Unreachable'}`, 'error', 'PORT 22');
        } else if (!silent) {
          this.addLog(`🔴 Connection Failed to [${this.piIp}:22] (${data.error || 'Unreachable'})`, 'error', 'PORT 22');
        }
      }
    } catch (err) {
      const wasConnected = this.isSshConnected;
      this.isSshConnected = false;
      this.latency = null;
      this.currentActivity = `Connection Error: ${err.message}`;

      if (wasConnected) {
        this.addLog(`❌ CONNECTION DROPPED! Pi [${this.piIp}] disconnected.`, 'error', 'PORT 22');
      } else if (!silent) {
        this.addLog(`Network test failed: ${err.message}`, 'error', 'SYS');
      }
    } finally {
      this.isChecking = false;
      this.updateAllUIs();
      this.broadcast({
        type: 'STATUS_UPDATE',
        isSshConnected: this.isSshConnected,
        latency: this.latency,
        currentActivity: this.currentActivity
      });
    }
  }

  // --------------------------------------------------------------------------
  // AUTO-HEARTBEAT
  // --------------------------------------------------------------------------
  initHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(() => {
      if (this.autoHeartbeat && this.piIp) {
        this.checkConnection(true);
      }
    }, 4500);
  }

  toggleHeartbeat(enabled) {
    this.autoHeartbeat = enabled;
    localStorage.setItem(STORAGE_KEYS.HEARTBEAT, enabled ? 'true' : 'false');
    this.addLog(`Auto-Heartbeat monitoring ${enabled ? 'ENABLED (every 4.5s)' : 'PAUSED'}`, 'info', 'SYS');
    this.updateAllUIs();
  }

  async launchPowerShellSsh() {
    if (!this.piIp) {
      this.addLog('⚠️ Cannot launch PowerShell: Please enter Pi IP address first.', 'warn', 'SSH');
      return;
    }

    try {
      this.addLog(`🚀 Spawning PowerShell SSH: ${this.piUser}@${this.piIp} ➔ cd ~/intramove...`, 'info', 'SSH');
      const res = await fetch(`/api/pi/launch-ssh?ip=${encodeURIComponent(this.piIp)}&user=${encodeURIComponent(this.piUser)}&port=${this.sshPort}`);
      const data = await res.json();
      if (data.success) {
        this.addLog(`✅ Native PowerShell SSH session spawned for ${this.piUser}@${this.piIp} into ~/intramove`, 'success', 'SSH');
      } else {
        this.addLog(`PowerShell spawn notice: ${data.error || 'Please run CONNECT_PI_POWERSHELL.bat'}`, 'warn', 'SSH');
      }
    } catch (_) {
      this.addLog(`Command to run: ssh -p ${this.sshPort} ${this.piUser}@${this.piIp}`, 'info', 'SSH');
    }
  }

  // --------------------------------------------------------------------------
  // REMOTE PI FILESYSTEM & CACHE MEMORY
  // --------------------------------------------------------------------------
  loadCachedFiles() {
    try {
      const cached = localStorage.getItem(STORAGE_KEYS.CACHED_FILES);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    // Seed default scripts discovered from user's Raspberry Pi
    return [
      { name: 'amr_all_in_one.py', size: 14200, isDir: false },
      { name: 'tof_obstacle.py', size: 6850, isDir: false },
      { name: 'servo_pca.py', size: 5400, isDir: false },
      { name: 'test_all_ultrasonic.py', size: 4200, isDir: false },
      { name: 'leds.py', size: 2300, isDir: false },
      { name: 'test_four_ultrasonic.py', size: 3100, isDir: false },
      { name: 'utils.py', size: 3800, isDir: false },
      { name: 'requirements.txt', size: 850, isDir: false }
    ];
  }

  loadCachedContents() {
    try {
      const cached = localStorage.getItem(STORAGE_KEYS.CACHED_CONTENTS);
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return {};
  }

  saveCachedContent(filename, content) {
    if (!filename) return;
    this.cachedContents[filename] = content;
    try {
      localStorage.setItem(STORAGE_KEYS.CACHED_CONTENTS, JSON.stringify(this.cachedContents));
    } catch (_) {}
  }

  getCachedContent(filename) {
    return this.cachedContents[filename] || null;
  }

  setRemoteDir(dir) {
    if (!dir) return;
    this.remoteDir = dir.trim();
    try {
      localStorage.setItem(STORAGE_KEYS.REMOTE_DIR, this.remoteDir);
    } catch (_) {}
    this.updateAllUIs();
  }

  async fetchRemoteFiles(dir = null) {
    const targetDir = (dir || this.remoteDir || '~/intra_move').trim();
    this.setRemoteDir(targetDir);

    if (!this.piIp) {
      this.addLog('⚠️ Cannot fetch remote files: No IP configured.', 'warn', 'REMOTE');
      return { success: false, error: 'No IP configured', files: this.remoteFiles };
    }

    this.addLog(`🔄 Connecting to ${this.piUser}@${this.piIp} ➔ Reading folder ${targetDir}...`, 'info', 'REMOTE');
    try {
      const res = await fetch(`/api/pi/list-remote-files?ip=${encodeURIComponent(this.piIp)}&user=${encodeURIComponent(this.piUser)}&port=${this.sshPort}&dir=${encodeURIComponent(targetDir)}&pass=${encodeURIComponent(this.piPass || '')}`);
      const data = await res.json();

      if (data.success && Array.isArray(data.files)) {
        this.remoteFiles = data.files;
        if (data.dir) this.setRemoteDir(data.dir);
        try {
          localStorage.setItem(STORAGE_KEYS.CACHED_FILES, JSON.stringify(this.remoteFiles));
        } catch (_) {}
        this.addLog(`🟢 Successfully synced & cached ${data.files.length} files from ${this.piUser}@${this.piIp}:${targetDir}!`, 'success', 'REMOTE');
        this.renderRemoteFilesUI();
        window.dispatchEvent(new CustomEvent('intramove_remote_files_synced', { detail: data }));
        return data;
      } else {
        const errMsg = data.error || 'Failed to list files';
        this.addLog(`❌ Could not fetch files: ${errMsg}`, 'error', 'REMOTE');
        if (data.needKey && !this.piPass) {
          this.addLog(`💡 Enter your Raspberry Pi password above in the "Pass:" field and try again.`, 'warn', 'AUTH');
        }
        return { ...data, files: this.remoteFiles };
      }
    } catch (err) {
      this.addLog(`❌ Remote file sync error: ${err.message}`, 'error', 'REMOTE');
      return { success: false, error: err.message, files: this.remoteFiles };
    }
  }

  async readRemoteFile(filename, dir = null) {
    if (!filename) return null;
    const targetDir = (dir || this.remoteDir || '~/intra_move').trim();

    // Check online read
    if (this.piIp) {
      try {
        const res = await fetch(`/api/pi/read-remote-file?ip=${encodeURIComponent(this.piIp)}&user=${encodeURIComponent(this.piUser)}&port=${this.sshPort}&dir=${encodeURIComponent(targetDir)}&file=${encodeURIComponent(filename)}&pass=${encodeURIComponent(this.piPass || '')}`);
        const data = await res.json();
        if (data && data.success && typeof data.content === 'string') {
          this.saveCachedContent(filename, data.content);
          return data;
        }
      } catch (_) {}
    }

    // Fallback to cache memory
    const cached = this.getCachedContent(filename);
    if (cached !== null) {
      return { success: true, filename, content: cached, isCached: true };
    }
    return { success: false, filename, error: 'File content not yet loaded from Pi' };
  }

  async writeRemoteFile(filename, content, dir = null) {
    if (!filename) return { success: false, error: 'No filename specified' };
    const targetDir = (dir || this.remoteDir || '~/intra_move').trim();

    // Always save into local cache memory first
    this.saveCachedContent(filename, content);

    // Make sure file is in remoteFiles list
    if (!this.remoteFiles.find(f => f.name === filename)) {
      this.remoteFiles.push({ name: filename, size: content.length, isDir: false });
      try {
        localStorage.setItem(STORAGE_KEYS.CACHED_FILES, JSON.stringify(this.remoteFiles));
      } catch (_) {}
    }

    if (!this.piIp) {
      this.addLog(`💾 Saved ${filename} locally in browser cache (Pi offline).`, 'warn', 'REMOTE');
      return { success: true, filename, size: content.length, cachedOnly: true };
    }

    this.addLog(`💾 Pushing ${targetDir}/${filename} to Raspberry Pi...`, 'info', 'REMOTE');
    try {
      const res = await fetch('/api/pi/write-remote-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: this.piIp,
          user: this.piUser,
          port: this.sshPort,
          dir: targetDir,
          filename,
          content,
          password: this.piPass || ''
        })
      });
      const data = await res.json();
      if (data.success) {
        this.addLog(`✅ Saved & Uploaded ${targetDir}/${filename} (${data.size} bytes) directly on Pi!`, 'success', 'REMOTE');
      } else {
        this.addLog(`❌ Save failed for ${targetDir}/${filename}: ${data.error}`, 'error', 'REMOTE');
      }
      return data;
    } catch (err) {
      this.addLog(`❌ Save error: ${err.message}`, 'error', 'REMOTE');
      return { success: false, error: err.message };
    }
  }

  renderRemoteFilesUI() {
    const containers = document.querySelectorAll('.pi-remote-files-container');
    if (!containers || containers.length === 0) return;

    const files = this.remoteFiles || [];
    containers.forEach(container => {
      if (files.length === 0) {
        container.innerHTML = `<div class="p-3 text-center text-slate-500 text-xs">No files synced yet. Click "Sync Files" to fetch.</div>`;
        return;
      }

      let html = `<div class="flex flex-wrap gap-1.5 p-1 max-h-40 overflow-y-auto">`;
      files.forEach(f => {
        const isPy = f.name.endsWith('.py');
        const badgeColor = isPy ? 'border-cyan-700/80 bg-cyan-950/40 text-cyan-300' : 'border-slate-700 bg-slate-800/80 text-slate-300';
        const icon = f.isDir ? 'folder' : (isPy ? 'code' : 'description');
        const sizeKb = f.size ? `${(f.size / 1024).toFixed(1)} KB` : '';

        html += `
          <div class="file-chip group flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border ${badgeColor} text-xs font-mono transition-all hover:scale-[1.02] cursor-pointer" data-file-name="${this.escapeHTML(f.name)}">
            <span class="material-symbols-outlined text-sm text-cyan-400">${icon}</span>
            <span class="font-bold text-white">${this.escapeHTML(f.name)}</span>
            ${sizeKb ? `<span class="text-[10px] text-slate-400">(${sizeKb})</span>` : ''}
            ${isPy ? `
              <button type="button" class="btn-quick-run-file ml-1 p-0.5 rounded hover:bg-cyan-600 text-cyan-300 hover:text-white transition-colors" title="Run on Pi" data-run-file="${this.escapeHTML(f.name)}">
                <span class="material-symbols-outlined text-xs">play_arrow</span>
              </button>
            ` : ''}
          </div>
        `;
      });
      html += `</div>`;
      container.innerHTML = html;
    });
  }

  async fetchLibraries() {
    if (!this.piIp) {
      this.addLog('⚠️ Cannot scan libraries: No IP configured.', 'warn', 'PIP');
      return { success: false, error: 'No IP configured' };
    }

    this.addLog(`🔍 Querying installed Python libraries on Pi (${this.piUser}@${this.piIp})...`, 'info', 'PIP');
    try {
      const res = await fetch(`/api/pi/list-libraries?ip=${encodeURIComponent(this.piIp)}&user=${encodeURIComponent(this.piUser)}&port=${this.sshPort}&pass=${encodeURIComponent(this.piPass || '')}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.libraries)) {
        this.libraries = data.libraries;
        this.addLog(`📦 Detected ${data.libraries.length} Python libraries on Pi!`, 'success', 'PIP');
        this.renderLibrariesUI();
        window.dispatchEvent(new CustomEvent('intramove_libraries_synced', { detail: data.libraries }));
        return data;
      } else {
        const errDetail = data.error || 'Check SSH connection';
        this.addLog(`❌ Failed to scan libraries: ${errDetail}`, 'error', 'PIP');
        if (data.needKey && !this.piPass) {
          this.addLog(`🔑 Enter your Raspberry Pi password in the "Pass:" field above and click "Scan Pi Libraries" again.`, 'warn', 'AUTH');
        }
        this.renderLibrariesUI(errDetail);
        return data;
      }
    } catch (err) {
      this.addLog(`❌ Libraries scan error: ${err.message}`, 'error', 'PIP');
      this.renderLibrariesUI(err.message);
      return { success: false, error: err.message };
    }
  }

  // --------------------------------------------------------------------------
  // REMOTE PI SHELL / PYTHON EXECUTION
  // --------------------------------------------------------------------------
  async execRemoteCommand(cmd) {
    if (!this.piIp) {
      this.addLog('⚠️ Cannot execute: No Raspberry Pi IP configured.', 'warn', 'EXEC');
      return { success: false, error: 'No IP configured. Please set Raspberry Pi IP first.' };
    }

    const trimmedCmd = (cmd || '').trim();
    if (!trimmedCmd) return { success: true, stdout: '', stderr: '' };

    this.addLog(`▶ Executing on Pi: ${trimmedCmd}`, 'info', 'EXEC');
    try {
      const res = await fetch('/api/pi/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: this.piIp,
          user: this.piUser || 'major',
          port: this.sshPort || 22,
          cmd: `cd ${this.remoteDir || '~/intra_move'} 2>/dev/null || cd ~/intra_move 2>/dev/null || cd ~/intramove 2>/dev/null || cd /home/${this.piUser}/intra_move 2>/dev/null; ${trimmedCmd}`,
          password: this.piPass || ''
        })
      });
      const data = await res.json();
      if (data.success) {
        this.addLog(`✔ Executed: ${trimmedCmd.slice(0, 30)}...`, 'success', 'EXEC');
      } else {
        this.addLog(`⚠️ Exec notice: ${data.error || 'Check SSH authentication'}`, 'warn', 'EXEC');
      }
      return data;
    } catch (err) {
      this.addLog(`❌ Exec error: ${err.message}`, 'error', 'EXEC');
      return { success: false, error: err.message };
    }
  }

  // --------------------------------------------------------------------------
  // REMOTE PI PACKAGE MANAGEMENT (INSTALL / UNINSTALL / LIST)
  // --------------------------------------------------------------------------
  async installLibrary(pkgName) {
    const pkg = (pkgName || '').trim();
    if (!pkg) return { success: false, error: 'No package name specified' };
    if (!this.piIp) {
      this.addLog('⚠️ Cannot install library: No IP configured.', 'warn', 'PIP');
      return { success: false, error: 'No IP configured' };
    }

    this.addLog(`📦 Running: pip install "${pkg}" on ${this.piUser}@${this.piIp}...`, 'info', 'PIP');
    try {
      const res = await fetch('/api/pi/install-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: this.piIp,
          user: this.piUser,
          port: this.sshPort,
          password: this.piPass || '',
          pkg
        })
      });
      const data = await res.json();
      if (data.success) {
        this.addLog(`✅ Successfully installed '${pkg}' on Raspberry Pi!`, 'success', 'PIP');
        await this.fetchLibraries();
      } else {
        const errDetail = data.error || (data.stderr || 'Installation failed');
        this.addLog(`❌ Failed to install '${pkg}': ${errDetail}`, 'error', 'PIP');
      }
      return data;
    } catch (err) {
      this.addLog(`❌ Install error: ${err.message}`, 'error', 'PIP');
      return { success: false, error: err.message };
    }
  }

  async uninstallLibrary(pkgName) {
    const pkg = (pkgName || '').trim();
    if (!pkg) return { success: false, error: 'No package name specified' };
    if (!this.piIp) {
      this.addLog('⚠️ Cannot uninstall library: No IP configured.', 'warn', 'PIP');
      return { success: false, error: 'No IP configured' };
    }

    this.addLog(`🗑️ Running: pip uninstall -y "${pkg}" on ${this.piUser}@${this.piIp}...`, 'info', 'PIP');
    try {
      const res = await fetch('/api/pi/uninstall-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: this.piIp,
          user: this.piUser,
          port: this.sshPort,
          password: this.piPass || '',
          pkg
        })
      });
      const data = await res.json();
      if (data.success) {
        this.addLog(`✅ Successfully uninstalled '${pkg}' from Raspberry Pi!`, 'success', 'PIP');
        await this.fetchLibraries();
      } else {
        const errDetail = data.error || (data.stderr || 'Uninstall failed');
        this.addLog(`❌ Failed to uninstall '${pkg}': ${errDetail}`, 'error', 'PIP');
      }
      return data;
    } catch (err) {
      this.addLog(`❌ Uninstall error: ${err.message}`, 'error', 'PIP');
      return { success: false, error: err.message };
    }
  }

  renderLibrariesUI(errorMessage = null) {
    const containers = document.querySelectorAll('.pi-libraries-container');
    if (containers.length === 0) return;

    let html = '';
    const installBarHtml = `
      <!-- 1-Click Install New Python Library Bar -->
      <div class="p-2.5 rounded-xl bg-purple-950/30 border border-purple-800/50 space-y-2">
        <div class="flex items-center gap-2">
          <input type="text" id="lib-install-name" placeholder="Install new package (e.g. opencv-python, smbus2, vl53l5cx)..." class="flex-1 px-3 py-1.5 text-xs rounded-xl bg-black/80 border border-purple-700/60 text-white focus:outline-none focus:border-purple-400 placeholder:text-slate-500 font-mono" />
          <button id="lib-install-btn" class="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer shrink-0 transition-all shadow-sm">
            <span class="material-symbols-outlined text-sm">add_box</span>
            <span>+ Install</span>
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-[10px] text-slate-400 font-mono">
          <span class="text-slate-500 font-bold">Popular:</span>
          <button type="button" class="lib-quick-suggest text-cyan-300 hover:text-cyan-200 underline cursor-pointer">numpy</button>
          <button type="button" class="lib-quick-suggest text-cyan-300 hover:text-cyan-200 underline cursor-pointer">opencv-python</button>
          <button type="button" class="lib-quick-suggest text-cyan-300 hover:text-cyan-200 underline cursor-pointer">smbus2</button>
          <button type="button" class="lib-quick-suggest text-cyan-300 hover:text-cyan-200 underline cursor-pointer">spidev</button>
          <button type="button" class="lib-quick-suggest text-cyan-300 hover:text-cyan-200 underline cursor-pointer">RPi.GPIO</button>
          <button type="button" class="lib-quick-suggest text-cyan-300 hover:text-cyan-200 underline cursor-pointer">pyserial</button>
        </div>
      </div>
    `;

    if (errorMessage) {
      html = `
        ${installBarHtml}
        <div class="p-3 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-300 font-mono text-xs space-y-1.5">
          <div class="font-bold flex items-center gap-1.5">
            <span class="material-symbols-outlined text-sm">lock</span>
            <span>Authentication / Scan Error</span>
          </div>
          <div class="text-[11px] leading-relaxed text-slate-300">${this.escapeHTML(errorMessage)}</div>
          ${!this.piPass ? '<div class="text-[11px] text-amber-300 pt-1 font-semibold">👉 Enter your Pi password in the "Pass:" field above and click "Scan Pi Libraries" again.</div>' : ''}
        </div>
      `;
    } else if (this.libraries.length === 0) {
      html = `
        ${installBarHtml}
        <div class="p-4 text-center text-slate-500 font-mono text-xs space-y-1">
          <div>${!this.piPass ? 'Enter your Pi password in the "Pass:" field above and click "Scan Pi Libraries".' : 'No libraries loaded yet. Click "Scan Pi Libraries" or install a package above.'}</div>
        </div>
      `;
    } else {
      html = `
        ${installBarHtml}
        <div class="space-y-2 font-mono text-xs">
          <div class="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-800">
            <div class="text-[11px] text-purple-300 font-bold">
              Found ${this.libraries.length} Installed Packages
            </div>
            <input type="text" id="lib-search-input" placeholder="Search installed packages..." class="px-2.5 py-1 text-[11px] rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-purple-400 placeholder:text-slate-500 w-52 font-mono" />
          </div>
          <div id="lib-package-list" class="space-y-1 max-h-52 overflow-y-auto pr-1">
            ${this.renderPackageRows(this.libraries)}
          </div>
        </div>
      `;
    }

    containers.forEach(c => {
      c.innerHTML = html;

      // Search Filter
      const searchInput = c.querySelector('#lib-search-input');
      const listContainer = c.querySelector('#lib-package-list');
      if (searchInput && listContainer) {
        searchInput.addEventListener('input', (e) => {
          const query = (e.target.value || '').toLowerCase().trim();
          const filtered = this.libraries.filter(p => (p.name || '').toLowerCase().includes(query));
          listContainer.innerHTML = this.renderPackageRows(filtered);
          this.bindRowDeleteButtons(listContainer);
        });
      }

      // Install Button
      const installInput = c.querySelector('#lib-install-name');
      const installBtn = c.querySelector('#lib-install-btn');
      if (installInput && installBtn) {
        const handleInstall = async () => {
          const pkg = installInput.value.trim();
          if (!pkg) return;
          installBtn.disabled = true;
          installBtn.innerHTML = `<span class="material-symbols-outlined text-xs animate-spin">refresh</span><span>Installing...</span>`;
          await this.installLibrary(pkg);
          installBtn.disabled = false;
          installBtn.innerHTML = `<span class="material-symbols-outlined text-xs">add_box</span><span>+ Install</span>`;
          installInput.value = '';
        };

        installBtn.addEventListener('click', handleInstall);
        installInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') handleInstall();
        });
      }

      // Quick Suggest Chips
      c.querySelectorAll('.lib-quick-suggest').forEach(chip => {
        chip.addEventListener('click', () => {
          if (installInput) {
            installInput.value = chip.innerText.trim();
            installInput.focus();
          }
        });
      });

      // Bind initial delete/uninstall buttons
      if (listContainer) {
        this.bindRowDeleteButtons(listContainer);
      }
    });
  }

  bindRowDeleteButtons(container) {
    if (!container) return;
    container.querySelectorAll('.btn-uninstall-pkg').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pkg = btn.getAttribute('data-pkg');
        if (!pkg) return;
        const confirmed = confirm(`Are you sure you want to uninstall '${pkg}' from your Raspberry Pi?`);
        if (confirmed) {
          btn.disabled = true;
          btn.innerHTML = `<span class="material-symbols-outlined text-xs animate-spin">refresh</span>`;
          await this.uninstallLibrary(pkg);
        }
      });
    });
  }

  renderPackageRows(pkgList) {
    if (!pkgList || pkgList.length === 0) {
      return `<div class="p-2 text-center text-slate-500 text-[11px]">No matching packages found.</div>`;
    }
    return pkgList.map(pkg => `
      <div class="flex items-center justify-between py-1 px-2.5 rounded-lg bg-black/40 border border-slate-800/80 hover:border-purple-500/50 text-[11px] transition-colors group">
        <span class="text-cyan-300 font-bold truncate">${this.escapeHTML(pkg.name)}</span>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-emerald-400 font-mono bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.2 rounded text-[10px]">${this.escapeHTML(pkg.version || 'installed')}</span>
          <button type="button" class="btn-uninstall-pkg text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-rose-950/50 cursor-pointer transition-colors" data-pkg="${this.escapeHTML(pkg.name)}" title="Uninstall ${this.escapeHTML(pkg.name)} from Pi">
            <span class="material-symbols-outlined text-xs">delete</span>
          </button>
        </div>
      </div>
    `).join('');
  }

  // --------------------------------------------------------------------------
  // UI RENDERING & DOM SYNC (ACROSS ALL VIEWS)
  // --------------------------------------------------------------------------
  updateAllUIs() {
    const isConn = this.isSshConnected;
    const ip = this.piIp;
    const latency = this.latency ? `${this.latency}ms` : '';

    // 1. Phone View Elements
    const mobileHeaderBadge = document.getElementById('mobile-header-pi-badge');
    const mobileCodeIpBadge = document.getElementById('mobile-code-ip-badge');
    const mobilePiStatusText = document.getElementById('mobile-pi-status-text');
    const mobilePiIndicator = document.getElementById('mobile-pi-indicator');
    const mobileInputIp = document.getElementById('mobile-input-pi-ip');

    if (mobileInputIp && mobileInputIp.value !== ip) {
      mobileInputIp.value = ip;
    }

    if (mobileHeaderBadge) {
      if (isConn) {
        mobileHeaderBadge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-50 border border-emerald-300 text-emerald-800 cursor-pointer shadow-sm';
        mobileHeaderBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span><span>Pi:22 Online (${latency})</span>`;
      } else if (ip) {
        mobileHeaderBadge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-rose-50 border border-rose-300 text-rose-800 cursor-pointer shadow-sm';
        mobileHeaderBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span><span>Pi Offline</span>`;
      } else {
        mobileHeaderBadge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-amber-50 border border-amber-300 text-amber-800 cursor-pointer shadow-sm';
        mobileHeaderBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span><span>Set Pi IP</span>`;
      }
    }

    // Sync User, Password, and IP Input fields
    const mobileInputUser = document.getElementById('mobile-input-pi-user');
    const desktopInputUser = document.getElementById('desktop-input-pi-user');
    const mobileInputPass = document.getElementById('mobile-input-pi-pass');
    const desktopInputPass = document.getElementById('desktop-input-pi-pass');

    if (mobileInputUser && mobileInputUser.value !== this.piUser) {
      mobileInputUser.value = this.piUser;
    }
    if (desktopInputUser && desktopInputUser.value !== this.piUser) {
      desktopInputUser.value = this.piUser;
    }
    if (mobileInputPass && mobileInputPass.value !== this.piPass) {
      mobileInputPass.value = this.piPass;
    }
    if (desktopInputPass && desktopInputPass.value !== this.piPass) {
      desktopInputPass.value = this.piPass;
    }

    document.querySelectorAll('[data-pi-ip-badge]').forEach(el => {
      el.innerText = ip || '192.168.0.xxx';
    });

    if (mobileCodeIpBadge) {
      mobileCodeIpBadge.innerText = ip ? `${this.piUser}@${ip}:${this.sshPort}` : 'Not Configured';
    }

    if (mobilePiIndicator) {
      mobilePiIndicator.className = `w-3 h-3 rounded-full ${isConn ? 'bg-emerald-500 animate-pulse' : ip ? 'bg-rose-500' : 'bg-slate-400'}`;
    }

    if (mobilePiStatusText) {
      if (isConn) {
        mobilePiStatusText.className = 'text-xs font-mono text-emerald-800 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 font-bold';
        mobilePiStatusText.innerText = `Connected to Raspberry Pi at ${this.piUser}@${ip} on Port 22 (${latency})`;
      } else if (ip) {
        mobilePiStatusText.className = 'text-xs font-mono text-rose-800 bg-rose-50 p-2.5 rounded-xl border border-rose-200 font-semibold';
        mobilePiStatusText.innerText = `Disconnected from ${this.piUser}@${ip} (Port 22 SSH unreachable)`;
      } else {
        mobilePiStatusText.className = 'text-xs font-mono text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-200';
        mobilePiStatusText.innerText = `Standby · Please enter Raspberry Pi IP (e.g. ${this.piUser}@192.168.0.148)`;
      }
    }

    // 2. Desktop View Elements
    const desktopStatusBtn = document.getElementById('btn-desktop-pi-status');
    const desktopDot = document.getElementById('desktop-pi-indicator-dot');
    const desktopBadge = document.getElementById('desktop-pi-status-badge');
    const desktopPorts = document.getElementById('desktop-pi-ports-preview');

    if (desktopStatusBtn && desktopBadge && desktopDot) {
      if (isConn) {
        desktopStatusBtn.className = 'px-3 py-1.5 rounded-xl border flex items-center gap-2 text-xs font-mono font-bold transition-all shadow-sm cursor-pointer bg-emerald-50 border-emerald-300 text-emerald-900 hover:bg-emerald-100';
        desktopDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
        desktopBadge.innerText = `${this.piUser}@Pi:22 (${latency})`;
        if (desktopPorts) desktopPorts.innerText = `SSH:22 · WS:${this.wsPort}`;
      } else if (ip) {
        desktopStatusBtn.className = 'px-3 py-1.5 rounded-xl border flex items-center gap-2 text-xs font-mono font-bold transition-all shadow-sm cursor-pointer bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100';
        desktopDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
        desktopBadge.innerText = `${this.piUser}@Pi:22 Offline`;
        if (desktopPorts) desktopPorts.innerText = `${ip}`;
      } else {
        desktopStatusBtn.className = 'px-3 py-1.5 rounded-xl border flex items-center gap-2 text-xs font-mono font-bold transition-all shadow-sm cursor-pointer bg-slate-50 border-slate-300 text-slate-700 hover:border-cyan-400';
        desktopDot.className = 'w-2.5 h-2.5 rounded-full bg-slate-400';
        desktopBadge.innerText = `Pi: Standby`;
        if (desktopPorts) desktopPorts.innerText = `Set IP`;
      }
    }

    // Update Port indicators & Latency meters in both view cards
    document.querySelectorAll('[data-pi-ip-text]').forEach(el => {
      el.innerText = ip ? `${this.piUser}@${ip}` : 'Not Configured';
    });
    document.querySelectorAll('[data-pi-user-badge]').forEach(el => {
      el.innerText = this.piUser;
    });
    document.querySelectorAll('[data-pi-ssh-pill]').forEach(el => {
      if (isConn) {
        el.className = 'text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded';
        el.innerText = `PORT 22: CONNECTED (${latency})`;
      } else if (ip) {
        el.className = 'text-[10px] font-mono font-bold bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 rounded';
        el.innerText = `PORT 22: DISCONNECTED`;
      } else {
        el.className = 'text-[10px] font-mono font-bold bg-slate-100 text-slate-600 border border-slate-300 px-2 py-0.5 rounded';
        el.innerText = `PORT 22: STANDBY`;
      }
    });

    document.querySelectorAll('[data-pi-activity-text]').forEach(el => {
      el.innerText = this.currentActivity;
    });

    this.renderLogs();
  }

  renderLogs() {
    const containers = document.querySelectorAll('.connection-log-stream');
    if (containers.length === 0) return;

    const html = this.logs.length === 0
      ? `<div class="text-slate-500 font-mono text-[10px] text-center py-2">No connection events recorded yet.</div>`
      : this.logs.slice(0, 30).map(l => {
          const color = l.level === 'success' ? 'text-emerald-400'
                      : l.level === 'error' ? 'text-rose-400 font-bold'
                      : l.level === 'warn' ? 'text-amber-400'
                      : 'text-cyan-300';
          const tagBg = l.level === 'success' ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                      : l.level === 'error' ? 'bg-rose-950/80 text-rose-300 border-rose-800'
                      : l.level === 'warn' ? 'bg-amber-950/80 text-amber-300 border-amber-800'
                      : 'bg-cyan-950/80 text-cyan-300 border-cyan-800';
          return `
            <div class="flex items-start gap-1.5 py-0.5 font-mono text-[11px] leading-tight select-text">
              <span class="text-slate-500 shrink-0 text-[10px]">[${l.time}]</span>
              <span class="px-1 rounded text-[9px] font-bold border ${tagBg} shrink-0">${l.tag}</span>
              <span class="${color} break-all">${this.escapeHTML(l.text)}</span>
            </div>
          `;
        }).join('');

    containers.forEach(c => {
      c.innerHTML = html;
    });
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

// Global singleton instance so all files and controllers share the exact same connection state
export const connectionManager = new ConnectionManager();
