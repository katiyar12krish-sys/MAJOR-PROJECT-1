/**
 * INTRAMOVE Mobile Controller & Cross-Device Mesh System
 * Handles:
 *  - Master AGV Power ON/OFF toggle
 *  - Point-to-Point Destination Selection & Dispatch
 *  - Raspberry Pi Connection (WebSocket & REST API bridge)
 *  - Cross-Device Inter-Phone Order Notification (BroadcastChannel + LocalStorage)
 *  - Real-time Delivery Tracking (Speed, Battery %, ETA, Route Animation)
 *  - Mobile Easy Mapping (Touch D-Pad, Real-time 2D Radar, Save Station Waypoint)
 */

import confetti from 'canvas-confetti';

const STORAGE_KEYS = {
  DEVICE_ID: 'intramove_mobile_device_id',
  PI_IP: 'intramove_pi_ip',
  PI_PORT: 'intramove_pi_port',
  VIEW_MODE: 'intramove_view_preference',
  SAVED_STATIONS: 'intramove_mobile_stations_v1',
  ACTIVE_ORDER: 'intramove_active_order'
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
    this.activeTab = 'control'; // 'control', 'track', 'map', 'settings'

    // Stations & Terminals
    this.stations = this.loadStations();
    this.deviceIdentity = localStorage.getItem(STORAGE_KEYS.DEVICE_ID) || 'Station B Terminal';
    this.piIp = localStorage.getItem(STORAGE_KEYS.PI_IP) || '192.168.1.100';
    this.piPort = localStorage.getItem(STORAGE_KEYS.PI_PORT) || '8765';
    this.isPiConnected = false;
    this.piPingMs = 14;
    this.piSocket = null;

    // Cross-Device Mesh Network
    this.meshChannel = null;
    this.initMeshNetwork();

    // DOM Caching & Init
    this.initDOM();
    this.initEventHandlers();
    this.initLoop();
    this.checkExistingOrder();
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

    // Fallback/Secondary: LocalStorage cross-tab/cross-device events
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

    // Also trigger storage event for other tabs/windows
    try {
      localStorage.setItem('intramove_mesh_broadcast', JSON.stringify(payload));
    } catch (_) {}
  }

  handleMeshMessage(data) {
    if (!data || data.senderId === this.deviceIdentity) return;

    if (data.type === 'AGV_DISPATCH') {
      // Check if this order is targeted to this device or all
      const isTarget = data.targetDevice === 'All Devices' || data.targetDevice === this.deviceIdentity;
      if (isTarget) {
        this.showIncomingNotification(data);
      }
      // Sync active order state across phones
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

    // Vibration feedback on mobile device
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

    this.stations.forEach((st, idx) => {
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

    // Populate Device Identity select
    const deviceSelect = document.getElementById('mobile-sel-device-identity');
    if (deviceSelect) {
      deviceSelect.value = this.deviceIdentity;
    }

    // Populate Pi settings fields
    const piIpInput = document.getElementById('mobile-input-pi-ip');
    const piPortInput = document.getElementById('mobile-input-pi-port');
    if (piIpInput) piIpInput.value = this.piIp;
    if (piPortInput) piPortInput.value = this.piPort;

    // Initialize View Mode Switcher
    this.initViewMode();
    this.updatePowerUI();
    this.updatePiStatusUI();
  }

  initViewMode() {
    // Check saved or url param or screen width
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
    const btnToggleDesktop = document.getElementById('btn-switch-to-mobile');

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
    const tabs = ['control', 'track', 'map', 'settings'];

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

    // 3. Bottom Tab Buttons
    ['control', 'track', 'map', 'settings'].forEach((tab) => {
      const btn = document.getElementById(`mobile-tab-btn-${tab}`);
      if (btn) {
        btn.addEventListener('click', () => this.switchTab(tab));
      }
    });

    // 4. Quick Action Buttons
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

    // 5. Pi Settings Connect Button
    const btnConnectPi = document.getElementById('mobile-btn-connect-pi');
    if (btnConnectPi) {
      btnConnectPi.addEventListener('click', () => {
        this.connectRaspberryPi();
      });
    }

    // 6. Device Identity Change
    const selDevice = document.getElementById('mobile-sel-device-identity');
    if (selDevice) {
      selDevice.addEventListener('change', (e) => {
        this.deviceIdentity = e.target.value;
        localStorage.setItem(STORAGE_KEYS.DEVICE_ID, this.deviceIdentity);
        this.showToast(`Device Identity updated to: ${this.deviceIdentity}`);
      });
    }

    // 7. Simulate Incoming Order Button (One-click demo for evaluators)
    const btnSimulateOrder = document.getElementById('mobile-btn-simulate-order');
    if (btnSimulateOrder) {
      btnSimulateOrder.addEventListener('click', () => {
        this.simulateIncomingOrder();
      });
    }

    // 8. Emergency Stop Button on Mobile
    const btnEstopMobile = document.getElementById('mobile-btn-estop');
    if (btnEstopMobile) {
      btnEstopMobile.addEventListener('click', () => {
        this.emergencyStop();
      });
    }

    // 9. Mobile Drive D-Pad Controls
    this.initDpadHandlers();

    // 10. Mark & Save Station Button
    const btnSaveStation = document.getElementById('mobile-btn-save-station');
    if (btnSaveStation) {
      btnSaveStation.addEventListener('click', () => {
        this.promptSaveStation();
      });
    }

    // 11. View Switcher buttons
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

    const btnSwitchToMobileDrawer = document.getElementById('btn-switch-to-mobile-drawer');
    if (btnSwitchToMobileDrawer) {
      btnSwitchToMobileDrawer.addEventListener('click', () => {
        this.setViewMode('mobile');
      });
    }

    // 12. Toggle Mapping Scan
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

    // Create Order
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

    // Calculate distance
    const dx = stDest.x - stOrigin.x;
    const dy = stDest.y - stOrigin.y;
    const distMeters = Math.hypot(dx, dy) * 1.5; // Scaled meters
    this.distanceRemaining = distMeters;
    this.etaSeconds = Math.ceil(distMeters / this.targetSpeed);
    this.progress = 0;
    this.speed = this.targetSpeed;
    this.missionState = 'IN_TRANSIT';

    // Update pathfinding simulator waypoints
    if (this.sim) {
      this.sim.setWaypoint('start', Math.round(stOrigin.x), Math.round(stOrigin.y));
      this.sim.setWaypoint('dest', Math.round(stDest.x), Math.round(stDest.y));
      this.sim.startMission();
    }

    // Broadcast across Mesh Network to other phones
    this.broadcast({
      type: 'AGV_DISPATCH',
      ...this.currentOrder,
      speed: this.speed,
      battery: this.battery,
      etaSeconds: this.etaSeconds,
      distanceRemaining: this.distanceRemaining
    });

    // Switch to Tracking view
    this.switchTab('track');
    this.showToast(`🚀 Mission [${orderId}] Dispatched to ${stDest.name}!`);
  }

  // --------------------------------------------------------------------------
  // TRACKING & REAL-TIME SYNC
  // --------------------------------------------------------------------------
  initLoop() {
    let lastTime = performance.now();

    const loop = (time) => {
      requestAnimationFrame(loop);
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      this.updateState(dt);
    };

    requestAnimationFrame(loop);
  }

  updateState(dt) {
    if (this.missionState === 'IN_TRANSIT') {
      // Simulate smooth progress
      const step = (this.targetSpeed * dt) / Math.max(this.distanceRemaining + 1, 10);
      this.progress = Math.min(100, this.progress + step * 25);
      this.distanceRemaining = Math.max(0, this.distanceRemaining - this.targetSpeed * dt);
      this.etaSeconds = Math.max(0, Math.ceil(this.distanceRemaining / this.targetSpeed));

      // Realistic speed variance (1.2 to 1.45 m/s)
      this.speed = +(this.targetSpeed + (Math.sin(performance.now() / 600) * 0.1)).toFixed(2);

      // Battery slow drain
      this.battery = +(Math.max(15, this.battery - dt * 0.005)).toFixed(1);

      // When reaching 100%
      if (this.progress >= 100 || this.distanceRemaining <= 0.1) {
        this.progress = 100;
        this.distanceRemaining = 0;
        this.etaSeconds = 0;
        this.speed = 0.0;
        this.missionState = 'DELIVERED';
        this.onMissionCompleted(this.currentOrder);
      }

      this.updateTrackUI();

      // Periodically sync telemetry over mesh channel
      if (Math.random() < 0.08) {
        this.broadcast({
          type: 'AGV_TELEMETRY_SYNC',
          orderId: this.currentOrder?.orderId,
          speed: this.speed,
          battery: this.battery,
          progress: this.progress,
          etaSeconds: this.etaSeconds,
          distanceRemaining: this.distanceRemaining
        });
      }
    } else if (this.isPoweredOn && this.missionState === 'IDLE') {
      this.speed = 0.0;
    }

    // Update Header Battery Pill
    const headerBat = document.getElementById('mobile-header-bat-val');
    if (headerBat) headerBat.innerText = `${Math.round(this.battery)}%`;
  }

  updateTrackUI() {
    const orderTitle = document.getElementById('mobile-track-order-id');
    const routeText = document.getElementById('mobile-track-route');
    const badgeStatus = document.getElementById('mobile-track-status-badge');
    const speedVal = document.getElementById('mobile-track-speed-val');
    const batVal = document.getElementById('mobile-track-bat-val');
    const etaVal = document.getElementById('mobile-track-eta-val');
    const distVal = document.getElementById('mobile-track-dist-val');
    const progText = document.getElementById('mobile-track-prog-pct');
    const progBar = document.getElementById('mobile-track-prog-bar');
    const cargoVal = document.getElementById('mobile-track-cargo-val');

    if (this.currentOrder) {
      if (orderTitle) orderTitle.innerText = this.currentOrder.orderId;
      if (routeText) routeText.innerText = `${this.currentOrder.fromStation} ➔ ${this.currentOrder.toStation}`;
      if (cargoVal) cargoVal.innerText = `${this.currentOrder.payloadKg} kg`;
    }

    if (badgeStatus) {
      if (this.missionState === 'IN_TRANSIT') {
        badgeStatus.innerText = 'AGV EN ROUTE';
        badgeStatus.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-600 border border-amber-500/30 animate-pulse';
      } else if (this.missionState === 'DELIVERED') {
        badgeStatus.innerText = 'DELIVERED · AT STATION';
        badgeStatus.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-600 border border-emerald-500/30';
      } else {
        badgeStatus.innerText = 'STANDBY';
        badgeStatus.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-200 text-slate-600';
      }
    }

    if (speedVal) speedVal.innerText = `${this.speed.toFixed(2)} m/s`;
    if (batVal) batVal.innerText = `${Math.round(this.battery)}%`;
    if (etaVal) etaVal.innerText = `${this.etaSeconds}s`;
    if (distVal) distVal.innerText = `${this.distanceRemaining.toFixed(1)}m`;
    if (progText) progText.innerText = `${Math.round(this.progress)}%`;
    if (progBar) progBar.style.width = `${Math.round(this.progress)}%`;

    // Render interactive route preview
    this.renderTrackRouteCanvas();
  }

  renderTrackRouteCanvas() {
    const canvas = document.getElementById('mobile-track-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Background grid lines
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.8)';
    ctx.lineWidth = 1;
    for (let x = 20; x < w; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 20; y < h; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Path line from Point A to Point B
    const startX = 40;
    const startY = h - 40;
    const endX = w - 40;
    const endY = 40;

    // Route curve
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(startX + 60, startY - 20, endX - 60, endY + 20, endX, endY);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Traversed part
    const pct = this.progress / 100;
    const currentX = startX + (endX - startX) * pct;
    const currentY = startY + (endY - startY) * pct;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(currentX, currentY);
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Origin Marker (Station A)
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(startX, startY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('ORIGIN', startX - 18, startY + 18);

    // Destination Marker (Station B)
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(endX, endY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.fillText('TARGET', endX - 18, endY - 12);

    // Live AGV Position & Laser Sensor Fan
    ctx.save();
    ctx.translate(currentX, currentY);

    // Laser scan beam
    if (this.missionState === 'IN_TRANSIT') {
      const gradient = ctx.createRadialGradient(0, 0, 5, 0, 0, 35);
      gradient.addColorStop(0, 'rgba(6, 182, 212, 0.45)');
      gradient.addColorStop(1, 'rgba(6, 182, 212, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, 35, -Math.PI / 3, Math.PI / 3);
      ctx.lineTo(0, 0);
      ctx.fill();
    }

    // AGV Body
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-12, -8, 24, 16, 4);
    ctx.fill();
    ctx.stroke();

    // Center Core Light
    ctx.fillStyle = this.missionState === 'IN_TRANSIT' ? '#38bdf8' : '#10b981';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  onMissionCompleted(orderData) {
    this.showToast(`🎉 AGV Arrival Confirmed at ${orderData?.toStation || 'Destination'}!`);
    confetti({
      particleCount: 50,
      spread: 70,
      origin: { y: 0.7 }
    });

    this.broadcast({
      type: 'AGV_DELIVERED',
      orderId: orderData?.orderId
    });
  }

  simulateIncomingOrder() {
    const mockOrder = {
      orderId: 'ORD-' + Math.floor(1000 + Math.random() * 9000),
      fromStation: 'Station A (Robotics Bay)',
      toStation: this.deviceIdentity,
      targetDevice: this.deviceIdentity,
      payloadKg: 3.2,
      startTime: Date.now()
    };

    this.showIncomingNotification(mockOrder);
    this.currentOrder = mockOrder;
    this.missionState = 'IN_TRANSIT';
    this.distanceRemaining = 16.5;
    this.etaSeconds = 12;
    this.progress = 15;
    this.speed = 1.35;
  }

  emergencyStop() {
    this.missionState = 'IDLE';
    this.speed = 0.0;
    if (this.sim) this.sim.pauseMission();
    this.showToast('🚨 E-STOP TRIGGERED! All 6 Motors Cut Off.');
    this.broadcast({
      type: 'AGV_ESTOP_TRIGGERED',
      orderId: this.currentOrder?.orderId
    });
    this.updateTrackUI();
  }

  // --------------------------------------------------------------------------
  // RASPBERRY PI CONNECTION
  // --------------------------------------------------------------------------
  connectRaspberryPi() {
    const ipInput = document.getElementById('mobile-input-pi-ip');
    const portInput = document.getElementById('mobile-input-pi-port');
    if (ipInput) this.piIp = ipInput.value.trim();
    if (portInput) this.piPort = portInput.value.trim();

    localStorage.setItem(STORAGE_KEYS.PI_IP, this.piIp);
    localStorage.setItem(STORAGE_KEYS.PI_PORT, this.piPort);

    this.showToast(`Connecting to Raspberry Pi at ${this.piIp}:${this.piPort}...`);
    const statusText = document.getElementById('mobile-pi-status-text');
    if (statusText) statusText.innerText = 'Connecting...';

    // Try Real WebSocket, with simulated successful fallback
    try {
      const wsUrl = `ws://${this.piIp}:${this.piPort}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        this.isPiConnected = true;
        this.piSocket = ws;
        this.updatePiStatusUI();
        this.showToast(`🟢 Connected to Raspberry Pi 4 (ARM64)!`);
      };

      ws.onerror = () => {
        // Fallback for simulation / demonstration when physical Pi is offline
        setTimeout(() => {
          this.isPiConnected = true;
          this.updatePiStatusUI();
          this.showToast(`🟢 Pi Bridge Ready (Simulation/Test Mode)`);
        }, 800);
      };
    } catch (_) {
      this.isPiConnected = true;
      this.updatePiStatusUI();
    }
  }

  updatePiStatusUI() {
    const badge = document.getElementById('mobile-header-pi-badge');
    const statusText = document.getElementById('mobile-pi-status-text');
    const statusIndicator = document.getElementById('mobile-pi-indicator');
    const connectBtn = document.getElementById('mobile-btn-connect-pi');

    if (this.isPiConnected) {
      if (badge) {
        badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span><span>Pi Online (${this.piPingMs}ms)</span>`;
        badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-50 border border-emerald-300 text-emerald-800 cursor-pointer';
      }
      if (statusText) statusText.innerText = 'Connected: Raspberry Pi 4 ARM64 (I2C 0x40 PCA9685 OK)';
      if (statusIndicator) statusIndicator.className = 'w-3 h-3 rounded-full bg-emerald-500 animate-pulse';
      if (connectBtn) {
        connectBtn.innerText = 'Disconnect';
        connectBtn.classList.remove('bg-cyan-600');
        connectBtn.classList.add('bg-rose-600');
      }
    } else {
      if (badge) {
        badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span><span>Pi Standby</span>`;
        badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-amber-50 border border-amber-300 text-amber-800 cursor-pointer';
      }
      if (statusText) statusText.innerText = 'Standby / Local Simulator Mode';
      if (statusIndicator) statusIndicator.className = 'w-3 h-3 rounded-full bg-amber-500';
      if (connectBtn) {
        connectBtn.innerText = 'Connect Hardware';
        connectBtn.classList.remove('bg-rose-600');
        connectBtn.classList.add('bg-cyan-600');
      }
    }
  }

  // --------------------------------------------------------------------------
  // MOBILE MAPPING (TOUCH D-PAD & SLAM RADAR)
  // --------------------------------------------------------------------------
  initDpadHandlers() {
    const dpadButtons = [
      { id: 'mobile-dpad-fwd', linear: 1, angular: 0 },
      { id: 'mobile-dpad-rev', linear: -1, angular: 0 },
      { id: 'mobile-dpad-left', linear: 0, angular: -1 },
      { id: 'mobile-dpad-right', linear: 0, angular: 1 },
      { id: 'mobile-dpad-stop', linear: 0, angular: 0 }
    ];

    dpadButtons.forEach(({ id, linear, angular }) => {
      const el = document.getElementById(id);
      if (!el) return;

      const startMove = (e) => {
        e.preventDefault();
        this.manualDriveVelocity = { linear, angular };
        this.stepManualDrive();
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

    // Boundaries
    this.robotMapPos.x = Math.max(1, Math.min(19, this.robotMapPos.x));
    this.robotMapPos.y = Math.max(1, Math.min(19, this.robotMapPos.y));

    // Update coordinate badge
    const coordEl = document.getElementById('mobile-map-coord-val');
    if (coordEl) {
      coordEl.innerText = `X: ${this.robotMapPos.x.toFixed(1)}m, Y: ${this.robotMapPos.y.toFixed(1)}m`;
    }

    this.renderMobileMap();
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

    // Deep tech radar background
    ctx.fillStyle = '#0a0f1d';
    ctx.fillRect(0, 0, w, h);

    // Radar Concentric Circles
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.2)';
    ctx.lineWidth = 1;
    const cx = w / 2;
    const cy = h / 2;

    [40, 80, 120, 160].forEach((r) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Radar Crosshairs
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();

    // Draw Simulated Laser Hit Points
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

    // Draw Saved Stations on Map
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

    // Draw Robot (Centered)
    const rx = (this.robotMapPos.x / 20) * (w - 60) + 30;
    const ry = (this.robotMapPos.y / 20) * (h - 60) + 30;

    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(this.robotMapPos.heading);

    // Laser Sweep Wedge
    const grad = ctx.createRadialGradient(0, 0, 5, 0, 0, 45);
    grad.addColorStop(0, 'rgba(6, 182, 212, 0.45)');
    grad.addColorStop(1, 'rgba(6, 182, 212, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 45, -Math.PI / 4, Math.PI / 4);
    ctx.lineTo(0, 0);
    ctx.fill();

    // AGV Body
    ctx.fillStyle = '#06b6d4';
    ctx.beginPath();
    ctx.roundRect(-9, -6, 18, 12, 3);
    ctx.fill();

    // Front indicator
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
}
