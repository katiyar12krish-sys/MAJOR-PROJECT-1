import './style.css';
import { PathfindingSimulator } from './simulation/pathfinding.js';
import { MapRenderer } from './simulation/mapRenderer.js';
import { IMUSimulator } from './simulation/imuSimulator.js';
import { DiagnosticsUIManager } from './ui/diagnosticsUI.js';
import { setupEventHandlers } from './ui/eventHandlers.js';
import { sound } from './audio/soundFX.js';
import { ScrollVehicleRunner } from './robot/scrollVehicleRunner.js';
import { SlamMappingStudio } from './slam-mapping.js';
import { MobileController } from './mobile/mobileController.js';
import { connectionManager } from './connection/connectionManager.js';

window.addEventListener('DOMContentLoaded', () => {
  // Initialize 3D SLAM & Smartelex VL53L5CX Multi-Location Memory Studio if present
  if (document.getElementById('slam-3d-viewport')) {
    new SlamMappingStudio();
  }

  // Desktop Pi Connection & Activity Monitor Modal Handlers
  // Desktop Pi Connection & Activity Monitor Modal Handlers
  const btnDesktopPiStatus = document.getElementById('btn-desktop-pi-status');
  const desktopConnModal = document.getElementById('desktop-conn-modal');
  const desktopConnCard = document.getElementById('desktop-conn-card');
  const btnCloseDesktopConnModal = document.getElementById('btn-close-desktop-conn-modal');
  const btnToggleActivityLogs = document.getElementById('btn-toggle-activity-logs');
  const desktopActivityLogsDrawer = document.getElementById('desktop-activity-logs-drawer');
  const btnCloseActivityLogsDrawer = document.getElementById('btn-close-activity-logs-drawer');
  const btnToggleModalFullscreen = document.getElementById('btn-toggle-modal-fullscreen');
  const iconModalFullscreen = document.getElementById('icon-modal-fullscreen');

  const desktopInputPiIp = document.getElementById('desktop-input-pi-ip');
  const desktopInputPiDir = document.getElementById('desktop-input-pi-dir');
  const desktopBtnSaveIp = document.getElementById('desktop-btn-save-ip');
  const desktopBtnTestPing = document.getElementById('desktop-btn-test-ping');
  const desktopBtnLaunchPs = document.getElementById('desktop-btn-launch-ps');
  const desktopBtnClearLogs = document.getElementById('desktop-btn-clear-logs');
  const mobileBtnClearConnLogs = document.getElementById('mobile-btn-clear-conn-logs');

  const desktopInputUser = document.getElementById('desktop-input-pi-user');
  const desktopInputPass = document.getElementById('desktop-input-pi-pass');
  const desktopBtnTogglePass = document.getElementById('desktop-btn-toggle-pass');
  const desktopPassEyeIcon = document.getElementById('desktop-pass-eye-icon');
  const desktopBtnSyncRemote = document.getElementById('desktop-btn-sync-remote');
  const desktopBtnScanLibs = document.getElementById('desktop-btn-scan-libs');
  const desktopBtnCloseLibs = document.getElementById('desktop-btn-close-libs');
  const desktopLibrariesDrawer = document.getElementById('desktop-libraries-drawer');

  // In-App Interactive Web Terminal Elements
  const desktopBtnToggleTerminal = document.getElementById('desktop-btn-toggle-terminal');
  const desktopTerminalDrawer = document.getElementById('desktop-terminal-drawer');
  const desktopTerminalScreen = document.getElementById('desktop-terminal-screen');
  const desktopTermInput = document.getElementById('desktop-term-input');
  const desktopBtnTermRun = document.getElementById('desktop-btn-term-run');
  const desktopBtnClearTerm = document.getElementById('desktop-btn-clear-term');
  const desktopBtnTermExpand = document.getElementById('desktop-btn-term-expand');
  const iconTermExpand = document.getElementById('icon-term-expand');
  const textTermExpand = document.getElementById('text-term-expand');

  // Remote File Explorer & Code Editor Elements
  const desktopActiveFileTitle = document.getElementById('desktop-active-file-title');
  const desktopFileStatusBadge = document.getElementById('desktop-file-status-badge');
  const desktopCodeEditor = document.getElementById('desktop-code-editor');
  const desktopEditorStats = document.getElementById('desktop-editor-stats');
  const desktopEditorTargetPath = document.getElementById('desktop-editor-target-path');
  const desktopBtnSaveCode = document.getElementById('desktop-btn-save-code');
  const desktopBtnRunCode = document.getElementById('desktop-btn-run-code');
  const desktopBtnReloadCode = document.getElementById('desktop-btn-reload-code');

  // Fullscreen State (Inverted: defaults to FULL SCREEN on open, user clicks to shrink)
  let isModalFullscreen = true;

  function applyModalScreenState(isFull) {
    if (!desktopConnModal || !desktopConnCard) return;
    isModalFullscreen = isFull;
    if (isModalFullscreen) {
      desktopConnModal.classList.add('p-0');
      desktopConnModal.classList.remove('p-2', 'sm:p-4');
      desktopConnCard.classList.remove('max-w-6xl', 'rounded-3xl', 'max-h-[92vh]', 'my-auto');
      desktopConnCard.classList.add('max-w-none', 'w-full', 'min-h-screen', 'max-h-none', 'rounded-none', 'my-0');
      if (iconModalFullscreen) {
        iconModalFullscreen.innerText = 'fullscreen_exit';
      }
      if (btnToggleModalFullscreen) {
        btnToggleModalFullscreen.title = 'Exit Full Screen / Shrink View';
      }
    } else {
      desktopConnModal.classList.remove('p-0');
      desktopConnModal.classList.add('p-2', 'sm:p-4');
      desktopConnCard.classList.add('max-w-6xl', 'rounded-3xl', 'max-h-[92vh]', 'my-auto');
      desktopConnCard.classList.remove('max-w-none', 'w-full', 'min-h-screen', 'max-h-none', 'rounded-none', 'my-0');
      if (iconModalFullscreen) {
        iconModalFullscreen.innerText = 'fullscreen';
      }
      if (btnToggleModalFullscreen) {
        btnToggleModalFullscreen.title = 'Expand to Full Screen';
      }
    }
  }

  if (btnToggleModalFullscreen && desktopConnModal && desktopConnCard) {
    btnToggleModalFullscreen.addEventListener('click', () => {
      applyModalScreenState(!isModalFullscreen);
    });
  }

  // Activity Logs Drawer Toggle
  if (btnToggleActivityLogs && desktopActivityLogsDrawer) {
    btnToggleActivityLogs.addEventListener('click', () => {
      const isHidden = desktopActivityLogsDrawer.classList.contains('hidden');
      if (isHidden) {
        desktopActivityLogsDrawer.classList.remove('hidden');
        connectionManager.renderLogs();
      } else {
        desktopActivityLogsDrawer.classList.add('hidden');
      }
    });
  }

  if (btnCloseActivityLogsDrawer && desktopActivityLogsDrawer) {
    btnCloseActivityLogsDrawer.addEventListener('click', () => {
      desktopActivityLogsDrawer.classList.add('hidden');
    });
  }

  // Terminal Full View Toggle
  let isTermExpanded = false;
  if (desktopBtnTermExpand && desktopTerminalScreen) {
    desktopBtnTermExpand.addEventListener('click', () => {
      isTermExpanded = !isTermExpanded;
      if (isTermExpanded) {
        desktopTerminalScreen.classList.remove('h-36');
        desktopTerminalScreen.classList.add('h-[55vh]');
        if (iconTermExpand) iconTermExpand.innerText = 'fullscreen_exit';
        if (textTermExpand) textTermExpand.innerText = 'Normal View';
      } else {
        desktopTerminalScreen.classList.remove('h-[55vh]');
        desktopTerminalScreen.classList.add('h-36');
        if (iconTermExpand) iconTermExpand.innerText = 'fullscreen';
        if (textTermExpand) textTermExpand.innerText = 'Full View';
      }
      desktopTerminalScreen.scrollTop = desktopTerminalScreen.scrollHeight;
    });
  }

  if (btnDesktopPiStatus && desktopConnModal) {
    btnDesktopPiStatus.addEventListener('click', () => {
      // Pehle badi screen (Full Screen) aayegi, user toggle karke chota kar sakein
      applyModalScreenState(true);
      desktopConnModal.classList.remove('hidden');
      if (desktopInputPiIp) desktopInputPiIp.value = connectionManager.piIp;
      if (desktopInputUser) desktopInputUser.value = connectionManager.piUser;
      if (desktopInputPass) desktopInputPass.value = connectionManager.piPass;
      if (desktopInputPiDir) desktopInputPiDir.value = connectionManager.remoteDir;
      connectionManager.updateAllUIs();
      connectionManager.renderRemoteFilesUI();
    });
  }

  if (btnCloseDesktopConnModal && desktopConnModal) {
    btnCloseDesktopConnModal.addEventListener('click', () => {
      desktopConnModal.classList.add('hidden');
    });
  }

  if (desktopConnModal) {
    desktopConnModal.addEventListener('click', (e) => {
      if (e.target === desktopConnModal) desktopConnModal.classList.add('hidden');
    });
  }

  // Password visibility toggle
  if (desktopBtnTogglePass && desktopInputPass) {
    desktopBtnTogglePass.addEventListener('click', () => {
      const isPass = desktopInputPass.type === 'password';
      desktopInputPass.type = isPass ? 'text' : 'password';
      if (desktopPassEyeIcon) {
        desktopPassEyeIcon.innerText = isPass ? 'visibility_off' : 'visibility';
      }
    });
  }

  if (desktopBtnSaveIp && desktopInputPiIp) {
    desktopBtnSaveIp.addEventListener('click', () => {
      if (desktopInputUser && desktopInputUser.value) {
        connectionManager.setUser(desktopInputUser.value);
      }
      if (desktopInputPass) {
        connectionManager.setPass(desktopInputPass.value);
      }
      connectionManager.setIp(desktopInputPiIp.value);
    });
  }

  if (desktopInputUser) {
    desktopInputUser.addEventListener('change', () => {
      connectionManager.setUser(desktopInputUser.value);
    });
  }

  if (desktopInputPass) {
    desktopInputPass.addEventListener('input', () => {
      connectionManager.piPass = desktopInputPass.value;
    });
    desktopInputPass.addEventListener('change', () => {
      connectionManager.setPass(desktopInputPass.value);
    });
  }

  if (desktopBtnTestPing) {
    desktopBtnTestPing.addEventListener('click', () => {
      if (desktopInputUser && desktopInputUser.value) {
        connectionManager.setUser(desktopInputUser.value);
      }
      if (desktopInputPass) {
        connectionManager.setPass(desktopInputPass.value);
      }
      if (desktopInputPiIp && desktopInputPiIp.value) {
        connectionManager.setIp(desktopInputPiIp.value);
      }
      connectionManager.checkConnection(false);
    });
  }

  // In-App Terminal Toggle & Runner
  if (desktopBtnToggleTerminal && desktopTerminalDrawer) {
    desktopBtnToggleTerminal.addEventListener('click', () => {
      desktopTerminalDrawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (desktopTermInput) desktopTermInput.focus();
    });
  }

  async function executeTerminalCommand(cmdText) {
    const rawCmd = (cmdText || '').trim();
    if (!rawCmd) return;

    if (!desktopTerminalScreen) return;

    // Handle clear
    if (rawCmd === 'clear' || rawCmd === 'cls') {
      desktopTerminalScreen.innerHTML = `<div class="text-slate-500 font-mono text-[10px]">Terminal cleared.</div>`;
      return;
    }

    const user = connectionManager.piUser || 'major';
    const host = connectionManager.piIp || 'pi';

    // Append Command prompt line
    const cmdLine = document.createElement('div');
    cmdLine.className = 'font-mono text-[11px] pt-1';
    cmdLine.innerHTML = `<span class="text-purple-400 font-bold">${connectionManager.escapeHTML(user)}@${connectionManager.escapeHTML(host)}</span>:<span class="text-cyan-400 font-bold">~/intramove$</span> <span class="text-white font-bold">${connectionManager.escapeHTML(rawCmd)}</span>`;
    desktopTerminalScreen.appendChild(cmdLine);

    // Indicator
    const indicator = document.createElement('div');
    indicator.className = 'text-slate-500 font-mono text-[10px] animate-pulse';
    indicator.innerHTML = `⏳ Executing on ${user}@${host}...`;
    desktopTerminalScreen.appendChild(indicator);
    desktopTerminalScreen.scrollTop = desktopTerminalScreen.scrollHeight;

    // Run command
    const res = await connectionManager.execRemoteCommand(rawCmd);
    indicator.remove();

    const outputEl = document.createElement('div');
    outputEl.className = 'font-mono text-[11px] whitespace-pre-wrap leading-relaxed select-text';

    if (res && res.success) {
      const out = (res.stdout || '').trim();
      const err = (res.stderr || '').trim();
      if (!out && !err) {
        outputEl.innerHTML = `<span class="text-slate-500 text-[10px]">(Process exited with return code 0, no output)</span>`;
      } else {
        outputEl.innerHTML = `${out ? `<span class="text-slate-200">${connectionManager.escapeHTML(out)}</span>` : ''}${err ? `<span class="text-amber-400">\n${connectionManager.escapeHTML(err)}</span>` : ''}`;
      }
    } else {
      const errMsg = (res && res.error) || 'Execution failed';
      outputEl.innerHTML = `<span class="text-rose-400 font-bold">❌ ${connectionManager.escapeHTML(errMsg)}</span>`;
    }

    desktopTerminalScreen.appendChild(outputEl);
    desktopTerminalScreen.scrollTop = desktopTerminalScreen.scrollHeight;
  }

  if (desktopBtnTermRun && desktopTermInput) {
    desktopBtnTermRun.addEventListener('click', () => {
      const cmd = desktopTermInput.value;
      desktopTermInput.value = '';
      executeTerminalCommand(cmd);
    });
  }

  if (desktopTermInput) {
    desktopTermInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const cmd = desktopTermInput.value;
        desktopTermInput.value = '';
        executeTerminalCommand(cmd);
      }
    });
  }

  // Quick Action Chips in Terminal
  document.querySelectorAll('.quick-term-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.innerText.trim();
      if (desktopTermInput) desktopTermInput.value = cmd;
      executeTerminalCommand(cmd);
    });
  });

  if (desktopBtnClearTerm && desktopTerminalScreen) {
    desktopBtnClearTerm.addEventListener('click', () => {
      desktopTerminalScreen.innerHTML = `<div class="text-slate-500 font-mono text-[10px]">Terminal cleared.</div>`;
    });
  }

  if (desktopBtnLaunchPs) {
    desktopBtnLaunchPs.addEventListener('click', () => {
      if (desktopInputUser && desktopInputUser.value) {
        connectionManager.setUser(desktopInputUser.value);
      }
      connectionManager.launchPowerShellSsh();
    });
  }

  // Directory Input sync
  if (desktopInputPiDir) {
    desktopInputPiDir.value = connectionManager.remoteDir;
    desktopInputPiDir.addEventListener('change', () => {
      connectionManager.setRemoteDir(desktopInputPiDir.value);
      if (desktopEditorTargetPath) {
        desktopEditorTargetPath.innerText = `${connectionManager.remoteDir}/${activeFilename}`;
      }
    });
  }

  // --------------------------------------------------------------------------
  // REMOTE FILE EXPLORER & EMBEDDED CODE EDITOR CONTROLLER
  // --------------------------------------------------------------------------
  let activeFilename = 'amr_all_in_one.py';

  function updateEditorStats() {
    if (!desktopCodeEditor || !desktopEditorStats) return;
    const text = desktopCodeEditor.value || '';
    const chars = text.length;
    const lines = text.split('\n').length;
    desktopEditorStats.innerText = `Characters: ${chars} | Lines: ${lines}`;
  }

  if (desktopCodeEditor) {
    desktopCodeEditor.addEventListener('input', updateEditorStats);
  }

  async function loadRemoteFileIntoEditor(filename) {
    if (!filename) return;
    activeFilename = filename;

    if (desktopActiveFileTitle) desktopActiveFileTitle.innerText = filename;
    if (desktopEditorTargetPath) {
      desktopEditorTargetPath.innerText = `${connectionManager.remoteDir}/${filename}`;
    }
    if (desktopFileStatusBadge) {
      desktopFileStatusBadge.innerText = 'Loading...';
      desktopFileStatusBadge.className = 'text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300';
    }

    const res = await connectionManager.readRemoteFile(filename, connectionManager.remoteDir);
    if (desktopCodeEditor) {
      if (res && res.content) {
        desktopCodeEditor.value = res.content;
        if (desktopFileStatusBadge) {
          desktopFileStatusBadge.innerText = res.isCached ? 'Cached in Memory' : 'Live from Pi';
          desktopFileStatusBadge.className = 'text-[10px] px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-400';
        }
      } else {
        // Sample default code boilerplate for files not yet fetched over network
        const defaultScript = `#!/usr/bin/env python3\n"""\nINTRAMOVE Autonomous Robot System\nFile: ${filename}\nDirectory: ${connectionManager.remoteDir}\n"""\nimport time\nimport sys\n\ndef main():\n    print("🤖 Executing ${filename} on Raspberry Pi 4...")\n    # Insert your robot logic here\n\nif __name__ == "__main__":\n    main()\n`;
        desktopCodeEditor.value = defaultScript;
        connectionManager.saveCachedContent(filename, defaultScript);
        if (desktopFileStatusBadge) {
          desktopFileStatusBadge.innerText = 'Template Initialized';
          desktopFileStatusBadge.className = 'text-[10px] px-2 py-0.5 rounded bg-indigo-950 border border-indigo-800 text-indigo-300';
        }
      }
      updateEditorStats();
    }
  }

  // Bind click delegations for remote file chips
  function setupFileChipsListeners() {
    document.querySelectorAll('.file-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        if (e.target.closest('.btn-quick-run-file')) return;
        const fname = chip.getAttribute('data-file-name');
        if (fname) loadRemoteFileIntoEditor(fname);
      });
    });

    document.querySelectorAll('.btn-quick-run-file').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rfile = btn.getAttribute('data-run-file');
        if (rfile) {
          executeTerminalCommand(`python3 ${connectionManager.remoteDir}/${rfile}`);
          if (desktopTerminalDrawer) {
            desktopTerminalDrawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      });
    });
  }

  // Save / Upload Code to Pi
  if (desktopBtnSaveCode && desktopCodeEditor) {
    desktopBtnSaveCode.addEventListener('click', async () => {
      const code = desktopCodeEditor.value;
      const originalText = desktopBtnSaveCode.innerHTML;
      desktopBtnSaveCode.disabled = true;
      desktopBtnSaveCode.innerHTML = `<span class="material-symbols-outlined text-xs animate-spin">refresh</span><span>Uploading...</span>`;

      const result = await connectionManager.writeRemoteFile(activeFilename, code, connectionManager.remoteDir);
      desktopBtnSaveCode.disabled = false;
      if (result && result.success) {
        desktopBtnSaveCode.innerHTML = `<span class="material-symbols-outlined text-xs">check</span><span>Saved &amp; Uploaded!</span>`;
        if (desktopFileStatusBadge) {
          desktopFileStatusBadge.innerText = result.cachedOnly ? 'Cached Locally' : 'Uploaded to Pi';
          desktopFileStatusBadge.className = 'text-[10px] px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-300';
        }
      } else {
        desktopBtnSaveCode.innerHTML = `<span class="material-symbols-outlined text-xs">error</span><span>Upload Failed</span>`;
      }
      setTimeout(() => {
        desktopBtnSaveCode.innerHTML = originalText;
      }, 2500);
    });
  }

  // Run Script directly on Pi from Editor
  if (desktopBtnRunCode) {
    desktopBtnRunCode.addEventListener('click', () => {
      executeTerminalCommand(`python3 ${connectionManager.remoteDir}/${activeFilename}`);
      if (desktopTerminalDrawer) {
        desktopTerminalDrawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  // Reload Active File from Pi
  if (desktopBtnReloadCode) {
    desktopBtnReloadCode.addEventListener('click', () => {
      loadRemoteFileIntoEditor(activeFilename);
    });
  }

  // Sync Remote Files button
  if (desktopBtnSyncRemote) {
    desktopBtnSyncRemote.addEventListener('click', async () => {
      const targetDir = desktopInputPiDir ? desktopInputPiDir.value : '~/intra_move';
      desktopBtnSyncRemote.disabled = true;
      desktopBtnSyncRemote.innerHTML = `<span class="material-symbols-outlined text-xs animate-spin">refresh</span><span>Syncing...</span>`;
      await connectionManager.fetchRemoteFiles(targetDir);
      desktopBtnSyncRemote.disabled = false;
      desktopBtnSyncRemote.innerHTML = `<span class="material-symbols-outlined text-xs">sync</span><span>Sync Remote Files</span>`;
      setupFileChipsListeners();
    });
  }

  window.addEventListener('intramove_remote_files_synced', () => {
    setupFileChipsListeners();
  });

  if (desktopBtnScanLibs) {
    desktopBtnScanLibs.addEventListener('click', () => {
      if (desktopLibrariesDrawer) desktopLibrariesDrawer.classList.remove('hidden');
      connectionManager.fetchLibraries();
    });
  }

  if (desktopBtnCloseLibs && desktopLibrariesDrawer) {
    desktopBtnCloseLibs.addEventListener('click', () => {
      desktopLibrariesDrawer.classList.add('hidden');
    });
  }

  if (desktopBtnClearLogs) {
    desktopBtnClearLogs.addEventListener('click', () => {
      connectionManager.clearLogs();
    });
  }

  if (mobileBtnClearConnLogs) {
    mobileBtnClearConnLogs.addEventListener('click', () => {
      connectionManager.clearLogs();
    });
  }

  // Initialize Remote Files & Editor
  connectionManager.renderRemoteFilesUI();
  setupFileChipsListeners();
  loadRemoteFileIntoEditor('amr_all_in_one.py');

  // Initial update
  connectionManager.updateAllUIs();

  // Cursor Glow Follower
  const cursorDot = document.getElementById('cursor-glow-dot');
  if (cursorDot) {
    window.addEventListener('pointermove', (e) => {
      cursorDot.style.left = `${e.clientX}px`;
      cursorDot.style.top = `${e.clientY}px`;
    });
  }

  // 1. INTRAMOVE Hero Supercar 3D Parallax & Rev Engine Interaction
  const heroStageArena = document.getElementById('hero-stage-arena');
  const heroCarContainer = document.getElementById('hero-car-interactive');
  const heroCarBody = document.getElementById('hero-car-body');
  const heroGiantLetters = document.getElementById('hero-giant-letters');
  const btnHeroRev = document.getElementById('btn-hero-rev');
  const heroBubble = document.getElementById('hero-car-bubble');
  const heroBubbleText = document.getElementById('hero-car-bubble-text');

  if (heroStageArena && heroCarBody) {
    heroStageArena.addEventListener('mousemove', (e) => {
      const rect = heroStageArena.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      heroCarBody.style.transform = `perspective(1000px) rotateY(${x * 10}deg) rotateX(${-y * 4}deg) translateY(0px) scale(1.01)`;
      if (heroGiantLetters) {
        heroGiantLetters.style.transform = `translate(${-x * 12}px, ${-y * 6}px)`;
      }
    });

    heroStageArena.addEventListener('mouseleave', () => {
      heroCarBody.style.transform = 'perspective(1000px) rotateY(0deg) rotateX(0deg) translateY(0px) scale(1)';
      if (heroGiantLetters) {
        heroGiantLetters.style.transform = 'translate(0px, 0px)';
      }
    });
  }

  if (heroCarContainer && heroCarBody) {
    const triggerRev = () => {
      if (heroBubble) {
        const revMessages = [
          'PCA9685 6-WHEEL DRIVE ARMED ⚡',
          'ToF LIDAR SCAN MATRIX 60Hz 🛰️',
          '5 KG PAYLOAD MATRIX READY 📦',
          'MPU6050 CHASSIS STABILIZED 📐'
        ];
        if (heroBubbleText) {
          heroBubbleText.textContent = revMessages[Math.floor(Math.random() * revMessages.length)];
        }
        heroBubble.classList.remove('opacity-0');
        heroBubble.classList.add('opacity-100');
        setTimeout(() => {
          heroBubble.classList.remove('opacity-100');
          heroBubble.classList.add('opacity-0');
        }, 2400);
      }
      // Suspension power rev without lifting off the floor
      heroCarBody.style.transform = 'scale(1.02) rotate(0.6deg)';
      setTimeout(() => {
        heroCarBody.style.transform = 'scale(1) rotate(0deg) translateY(0px)';
      }, 250);
    };

    heroCarContainer.addEventListener('click', triggerRev);
    if (btnHeroRev) {
      btnHeroRev.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerRev();
      });
    }
  }

  // Animated numbers when scrolled into view
  const statPills = document.querySelectorAll('.stat-pill');
  if (statPills.length > 0) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const numEl = entry.target.querySelector('.font-extrabold');
          if (numEl && !numEl.dataset.counted) {
            numEl.dataset.counted = 'true';
            const rawText = numEl.textContent.trim();
            const targetNum = parseInt(rawText, 10);
            if (!isNaN(targetNum)) {
              let current = 0;
              const duration = 1000;
              const stepTime = Math.max(25, Math.floor(duration / targetNum));
              const timer = setInterval(() => {
                current++;
                numEl.textContent = rawText.includes('x') ? `${current}x` : (rawText.includes('Hz') ? `${current}Hz` : current);
                if (current >= targetNum) clearInterval(timer);
              }, stepTime);
            }
          }
        }
      });
    }, { threshold: 0.4 });

    statPills.forEach(p => observer.observe(p));
  }

  // 2. Interactive Scroll-Driven INTRAMOVE Vehicle Escort disabled
  // new ScrollVehicleRunner();

  // 3. Initialize Simulation Engines
  const pathfindingSim = new PathfindingSimulator(20, 20);
  const tofMapCanvas = document.getElementById('tof-map-canvas');
  const mapRenderer = new MapRenderer(tofMapCanvas, pathfindingSim);

  const imuSim = new IMUSimulator();
  const diagnosticsUI = new DiagnosticsUIManager();

  // 4. Setup Event Handlers
  setupEventHandlers(pathfindingSim, mapRenderer, imuSim, diagnosticsUI);

  // 5. Initial UI Render
  const motorCardsContainer = document.getElementById('motor-cards-container');
  diagnosticsUI.renderMotorCards(motorCardsContainer);
  diagnosticsUI.renderLogStream();

  // 6. Initialize Mobile Controller & Cross-Device Mesh Network
  const mobileController = new MobileController(pathfindingSim, imuSim, diagnosticsUI);

  // 6. Real-time Telemetry & Simulation Sync Loop
  let lastTime = performance.now();

  function syncLoop(currentTime) {
    requestAnimationFrame(syncLoop);

    const delta = Math.min((currentTime - lastTime) / 1000, 0.1);
    lastTime = currentTime;

    // Update A* Simulation
    pathfindingSim.update(delta);

    // Update Map Canvas
    mapRenderer.render(delta);

    // Update IMU Simulation
    const isMoving = pathfindingSim.state === 'RUNNING';
    imuSim.update(delta, isMoving, pathfindingSim.speed);

    // Update 6 Motors
    diagnosticsUI.updateMotors(isMoving, pathfindingSim.speed, imuSim.isOverloaded);
    diagnosticsUI.renderMotorCards(motorCardsContainer);

    // Render Artificial Horizon Canvas
    const horizonCanvas = document.getElementById('horizon-canvas');
    if (horizonCanvas) {
      imuSim.renderArtificialHorizon(horizonCanvas);
    }

    // Update DOM Telemetry Elements
    updateDOM(pathfindingSim, imuSim, diagnosticsUI);
  }

  requestAnimationFrame(syncLoop);
});


function updateDOM(sim, imu, diag) {
  // Mission Status
  const badge = document.getElementById('sim-status-badge');
  if (badge) {
    badge.innerText = `${sim.state} (${sim.subState})`;
    badge.className = `text-xs font-mono font-bold ${
      sim.state === 'RUNNING'
        ? 'text-emerald-400'
        : sim.state === 'REROUTING'
        ? 'text-amber-400'
        : sim.state === 'COMPLETED'
        ? 'text-cyan-400'
        : 'text-gray-400'
    }`;
  }

  // Coordinates & Metrics
  const coordRobot = document.getElementById('coord-robot');
  if (coordRobot) {
    coordRobot.innerText = `[${sim.robotPos.x.toFixed(1)}, ${sim.robotPos.y.toFixed(1)}]`;
  }
  const metricDist = document.getElementById('metric-dist');
  if (metricDist) {
    metricDist.innerText = `${sim.totalDistance.toFixed(1)} m`;
  }
  const metricEta = document.getElementById('metric-eta');
  if (metricEta) {
    metricEta.innerText = `${sim.etaSeconds} sec`;
  }

  // Progress Bar
  const progPct = sim.totalDistance > 0 ? Math.min(100, Math.round((sim.traversedDistance / sim.totalDistance) * 100)) : 0;
  const progressText = document.getElementById('mission-progress-pct');
  const progressBar = document.getElementById('mission-progress-bar');
  if (progressText) progressText.innerText = `${progPct}%`;
  if (progressBar) progressBar.style.width = `${progPct}%`;

  // Hero Status
  const heroPitch = document.getElementById('hero-pitch');
  if (heroPitch) heroPitch.innerText = `${imu.pitch >= 0 ? '+' : ''}${imu.pitch.toFixed(1)}°`;
  const heroLoad = document.getElementById('hero-load');
  if (heroLoad) heroLoad.innerText = `${imu.totalWeightKg} KG`;

  // Telemetry Section
  const telePitch = document.getElementById('tele-pitch');
  if (telePitch) telePitch.innerText = `${imu.pitch >= 0 ? '+' : ''}${imu.pitch.toFixed(1)}°`;
  const teleRoll = document.getElementById('tele-roll');
  if (teleRoll) teleRoll.innerText = `${imu.roll >= 0 ? '+' : ''}${imu.roll.toFixed(1)}°`;
  const teleAccel = document.getElementById('tele-accel');
  if (teleAccel) teleAccel.innerText = `${imu.accelZ.toFixed(2)}g`;

  // Overload Alert Banner
  const alertBanner = document.getElementById('overload-alert-banner');
  if (alertBanner) {
    alertBanner.style.display = imu.isOverloaded || imu.isImbalanced ? 'flex' : 'none';
  }

  // 6-Zone Weight Heatmap UI
  const zones = ['fl', 'fr', 'ml', 'mr', 'rl', 'rr'];
  zones.forEach((z) => {
    const el = document.getElementById(`hm-${z}`);
    const valEl = document.getElementById(`hm-${z}-val`);
    const load = imu.zoneLoads[z.toUpperCase()];
    if (valEl) valEl.innerText = `${load} kg`;

    if (el) {
      if (load > 65 || imu.isOverloaded) {
        el.className = 'p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-white flex flex-col justify-between transition-all';
      } else if (load > 40) {
        el.className = 'p-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-white flex flex-col justify-between transition-all';
      } else {
        el.className = 'p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-white flex flex-col justify-between transition-all';
      }
    }
  });
}

// 3D Parallax Tilt for Open Vehicle Stages
document.querySelectorAll('.interactive-anatomy-stage').forEach((stage) => {
  const carEl = stage.querySelector('.anatomy-tilt-target');
  if (!carEl) return;

  stage.addEventListener('mousemove', (e) => {
    const rect = stage.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    carEl.style.transform = `perspective(1200px) rotateY(${x * 16}deg) rotateX(${-y * 12}deg) scale3d(1.04, 1.04, 1.04)`;
  });

  stage.addEventListener('mouseleave', () => {
    carEl.style.transform = '';
  });
});
