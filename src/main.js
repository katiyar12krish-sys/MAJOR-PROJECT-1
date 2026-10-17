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
  const btnDesktopPiStatus = document.getElementById('btn-desktop-pi-status');
  const desktopConnModal = document.getElementById('desktop-conn-modal');
  const btnCloseDesktopConnModal = document.getElementById('btn-close-desktop-conn-modal');
  const desktopInputPiIp = document.getElementById('desktop-input-pi-ip');
  const desktopBtnSaveIp = document.getElementById('desktop-btn-save-ip');
  const desktopBtnTestPing = document.getElementById('desktop-btn-test-ping');
  const desktopBtnLaunchPs = document.getElementById('desktop-btn-launch-ps');
  const desktopBtnClearLogs = document.getElementById('desktop-btn-clear-logs');
  const mobileBtnClearConnLogs = document.getElementById('mobile-btn-clear-conn-logs');

  const desktopInputUser = document.getElementById('desktop-input-pi-user');
  const desktopBtnSyncRemote = document.getElementById('desktop-btn-sync-remote');
  const desktopBtnScanLibs = document.getElementById('desktop-btn-scan-libs');
  const desktopBtnCloseLibs = document.getElementById('desktop-btn-close-libs');
  const desktopLibrariesDrawer = document.getElementById('desktop-libraries-drawer');

  if (btnDesktopPiStatus && desktopConnModal) {
    btnDesktopPiStatus.addEventListener('click', () => {
      desktopConnModal.classList.remove('hidden');
      if (desktopInputPiIp) desktopInputPiIp.value = connectionManager.piIp;
      if (desktopInputUser) desktopInputUser.value = connectionManager.piUser;
      connectionManager.updateAllUIs();
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

  if (desktopBtnSaveIp && desktopInputPiIp) {
    desktopBtnSaveIp.addEventListener('click', () => {
      if (desktopInputUser && desktopInputUser.value) {
        connectionManager.setUser(desktopInputUser.value);
      }
      connectionManager.setIp(desktopInputPiIp.value);
    });
  }

  if (desktopInputUser) {
    desktopInputUser.addEventListener('change', () => {
      connectionManager.setUser(desktopInputUser.value);
    });
  }

  if (desktopBtnTestPing) {
    desktopBtnTestPing.addEventListener('click', () => {
      if (desktopInputUser && desktopInputUser.value) {
        connectionManager.setUser(desktopInputUser.value);
      }
      if (desktopInputPiIp && desktopInputPiIp.value) {
        connectionManager.setIp(desktopInputPiIp.value);
      }
      connectionManager.checkConnection(false);
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

  if (desktopBtnSyncRemote) {
    desktopBtnSyncRemote.addEventListener('click', () => {
      connectionManager.fetchRemoteFiles('~/intramove');
    });
  }

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
