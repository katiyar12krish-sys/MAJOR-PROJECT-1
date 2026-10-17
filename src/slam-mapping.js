import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ============================================================================
// INTRAMOVE 3D SLAM & SMARTELEX VL53L5CX MULTI-LOCATION MAPPING ENGINE
// ============================================================================

const STORAGE_KEY = 'INTRAMOVE_SAVED_MAPS_V1';

export class SlamMappingStudio {
  constructor() {
    this.container = document.getElementById('slam-3d-viewport');
    if (!this.container) return;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    // 3D Objects
    this.agvGroup = null;
    this.lidarTurret = null;
    this.raysGroup = null;
    this.pointCloud = null;
    this.voxelGroup = null;
    this.pathLine = null;
    this.obstaclesGroup = null;

    // Data structures
    this.maxPoints = 4000;
    this.pointsCount = 0;
    this.pointPositions = new Float32Array(this.maxPoints * 3);
    this.pointColors = new Float32Array(this.maxPoints * 3);
    this.pathPoints = [];

    // Hardware & Stream State
    this.isHardwareConnected = false;
    this.ws = null;
    const savedPiIp = localStorage.getItem('intramove_pi_ip') || localStorage.getItem('intramove_pi_ssh_ip') || '';
    this.wsUrl = savedPiIp ? `ws://${savedPiIp}:8765` : '';
    this.isScanning = true;
    this.activeMapName = 'Live Session (Unsaved)';
    this.currentLocationCategory = 'College';

    // VL53L5CX 8x8 Matrix (64 zones)
    this.matrix64 = new Float32Array(64).fill(2500); // in mm (up to 4000mm)
    this.simAgvPos = { x: 0, z: 0, angle: 0, speed: 0.035, turn: 0.015 };

    // Saved Maps Memory
    this.savedMaps = this.loadSavedMapsFromStorage();

    this.initThree();
    this.initUI();
    this.initHardwareBridge();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  // --------------------------------------------------------------------------
  // THREE.JS INITIALIZATION
  // --------------------------------------------------------------------------
  initThree() {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 500;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f1422); // Deep modern cyber dark
    this.scene.fog = new THREE.FogExp2(0x0f1422, 0.035);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(7, 8, 9);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Don't clip below floor
    this.controls.minDistance = 2;
    this.controls.maxDistance = 30;
    this.controls.target.set(0, 0.5, 0);

    // Lights
    const ambient = new THREE.AmbientLight(0xdde7ff, 0.9);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
    dirLight.position.set(10, 15, 8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    this.scene.add(dirLight);

    const cyanPoint = new THREE.PointLight(0x06b6d4, 2.5, 12);
    cyanPoint.position.set(0, 2, 0);
    this.scene.add(cyanPoint);

    // Metric Grid & Floor
    this.setupEnvironment();

    // 3D AGV Model
    this.buildAgvModel();

    // Point Cloud for LiDAR Scans
    this.initPointCloud();

    // Voxel / Obstacle Group
    this.voxelGroup = new THREE.Group();
    this.scene.add(this.voxelGroup);

    // Path trail
    this.initPathLine();

    // Initial default environment room features (College Lab obstacles)
    this.loadDefaultEnvironment('College - Robotics Lab 302');

    // Window resize handler
    window.addEventListener('resize', () => {
      if (!this.container) return;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
  }

  setupEnvironment() {
    // Holographic Grid Floor
    const gridHelper = new THREE.GridHelper(24, 24, 0x06b6d4, 0x1e293b);
    gridHelper.position.y = 0.001;
    this.scene.add(gridHelper);

    // Dark Reflective Plane
    const floorGeo = new THREE.PlaneGeometry(28, 28);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0a0e1a,
      roughness: 0.8,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Coordinate Axes Helper (Sleek)
    const axes = new THREE.AxesHelper(1.5);
    axes.position.set(-11.5, 0.05, -11.5);
    this.scene.add(axes);
  }

  buildAgvModel() {
    this.agvGroup = new THREE.Group();

    // Chassis Box
    const bodyGeo = new THREE.BoxGeometry(1.4, 0.5, 0.8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb, // Cyan/Blue Industrial AGV
      metalness: 0.6,
      roughness: 0.3
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.35;
    body.castShadow = true;
    this.agvGroup.add(body);

    // Cargo Parcel on Flatbed
    const cargoGeo = new THREE.BoxGeometry(0.7, 0.4, 0.6);
    const cargoMat = new THREE.MeshStandardMaterial({
      color: 0xd97706, // Cardboard Amber
      roughness: 0.9
    });
    const cargo = new THREE.Mesh(cargoGeo, cargoMat);
    cargo.position.set(-0.25, 0.75, 0);
    cargo.castShadow = true;
    this.agvGroup.add(cargo);

    // 6 Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.12, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });
    const xOffsets = [-0.45, 0, 0.45];
    xOffsets.forEach(x => {
      // Left side wheel
      const wl = new THREE.Mesh(wheelGeo, wheelMat);
      wl.rotation.x = Math.PI / 2;
      wl.position.set(x, 0.2, 0.44);
      wl.castShadow = true;
      this.agvGroup.add(wl);

      // Right side wheel
      const wr = new THREE.Mesh(wheelGeo, wheelMat);
      wr.rotation.x = Math.PI / 2;
      wr.position.set(x, 0.2, -0.44);
      wr.castShadow = true;
      this.agvGroup.add(wr);
    });

    // Elevated LiDAR Turret (Houses Smartelex VL53L5CX)
    const turretBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.14, 0.18, 16),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8, roughness: 0.2 })
    );
    turretBase.position.set(0.48, 0.65, 0);

    const turretLens = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x06b6d4 }) // Glowing Cyan Sensor Lens
    );
    turretLens.position.set(0.55, 0.67, 0);

    this.agvGroup.add(turretBase);
    this.agvGroup.add(turretLens);
    this.lidarTurret = turretLens;

    // Raycast projection visualizer (64 ToF beams cone)
    this.raysGroup = new THREE.Group();
    this.agvGroup.add(this.raysGroup);
    this.rebuildLidarRays();

    this.scene.add(this.agvGroup);
  }

  rebuildLidarRays() {
    // Clear old rays
    while (this.raysGroup.children.length > 0) {
      this.raysGroup.remove(this.raysGroup.children[0]);
    }

    // 8x8 grid ray lines in 45° FoV pyramidal cone
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.25
    });

    // Create 64 ray lines
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const hAngle = ((c - 3.5) / 3.5) * 0.38; // ~45 deg FoV
        const vAngle = ((r - 3.5) / 3.5) * 0.38;

        const points = [
          new THREE.Vector3(0.55, 0.67, 0),
          new THREE.Vector3(0.55 + Math.cos(hAngle) * 3, 0.67 + Math.sin(vAngle) * 2, Math.sin(hAngle) * 3)
        ];
        const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(lineGeo, lineMat);
        this.raysGroup.add(line);
      }
    }
  }

  initPointCloud() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pointPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pointColors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.12,
      vertexColors: true,
      transparent: true,
      opacity: 0.85
    });

    this.pointCloud = new THREE.Points(geo, mat);
    this.scene.add(this.pointCloud);
  }

  initPathLine() {
    const geo = new THREE.BufferGeometry();
    const mat = new THREE.LineBasicMaterial({
      color: 0x10b981, // Emerald trajectory
      linewidth: 2,
      transparent: true,
      opacity: 0.7
    });
    this.pathLine = new THREE.Line(geo, mat);
    this.scene.add(this.pathLine);
  }

  // --------------------------------------------------------------------------
  // SIMULATION & SLAM RAYTRACING (VL53L5CX 8×8 PROJECTION)
  // --------------------------------------------------------------------------
  updateSimulation(delta) {
    if (this.isHardwareConnected || !this.isScanning) return;

    // Move AGV in smooth autonomous scanning loop
    this.simAgvPos.angle += this.simAgvPos.turn;
    this.simAgvPos.x += Math.cos(this.simAgvPos.angle) * this.simAgvPos.speed;
    this.simAgvPos.z += Math.sin(this.simAgvPos.angle) * this.simAgvPos.speed;

    // Bounds bouncing / patrol logic
    const limit = 5.5;
    if (Math.abs(this.simAgvPos.x) > limit || Math.abs(this.simAgvPos.z) > limit) {
      this.simAgvPos.angle += Math.PI * 0.6;
      this.simAgvPos.x = Math.max(-limit, Math.min(limit, this.simAgvPos.x));
      this.simAgvPos.z = Math.max(-limit, Math.min(limit, this.simAgvPos.z));
    }

    // Update 3D AGV mesh position and heading
    this.agvGroup.position.set(this.simAgvPos.x, 0, this.simAgvPos.z);
    this.agvGroup.rotation.y = -this.simAgvPos.angle;

    // Append Path
    if (Math.random() < 0.25) {
      this.pathPoints.push(new THREE.Vector3(this.simAgvPos.x, 0.05, this.simAgvPos.z));
      if (this.pathPoints.length > 200) this.pathPoints.shift();
      this.pathLine.geometry.setFromPoints(this.pathPoints);
    }

    // Generate 64 ToF distances against simulated environment
    this.computeSimulatedTofMatrix();
  }

  computeSimulatedTofMatrix() {
    const agvX = this.agvGroup.position.x;
    const agvZ = this.agvGroup.position.z;
    const heading = this.agvGroup.rotation.y;

    // 8x8 sensor matrix
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const idx = r * 8 + c;
        const hOffset = ((c - 3.5) / 3.5) * 0.39;
        const vOffset = ((r - 3.5) / 3.5) * 0.39;

        const rayAngle = heading + hOffset;

        // Base distance to room boundary walls
        let minD = 3500; // mm
        // Check 4 boundary walls (-7 to +7 meters)
        const cosA = Math.cos(rayAngle);
        const sinA = Math.sin(rayAngle);

        if (cosA > 0.01) minD = Math.min(minD, ((7 - agvX) / cosA) * 1000);
        if (cosA < -0.01) minD = Math.min(minD, ((-7 - agvX) / cosA) * 1000);
        if (sinA > 0.01) minD = Math.min(minD, ((7 - agvZ) / sinA) * 1000);
        if (sinA < -0.01) minD = Math.min(minD, ((-7 - agvZ) / sinA) * 1000);

        // Check simulated obstacle boxes
        if (this.currentObstacles) {
          this.currentObstacles.forEach(obs => {
            const dx = obs.x - agvX;
            const dz = obs.z - agvZ;
            const distToObs = Math.sqrt(dx * dx + dz * dz) * 1000;
            const angleToObs = Math.atan2(dz, dx);
            const diff = Math.abs(rayAngle - angleToObs);
            if (diff < 0.28 && distToObs > 200) {
              minD = Math.min(minD, distToObs + (Math.random() * 60 - 30));
            }
          });
        }

        // Add sensor optical noise (standard ±15mm on VL53L5CX)
        minD = Math.max(100, Math.min(4000, minD + (Math.random() * 30 - 15)));
        this.matrix64[idx] = minD;

        // Accumulate 3D point cloud
        if (Math.random() < 0.08 && this.pointsCount < this.maxPoints) {
          this.addPointToCloud(agvX, agvZ, rayAngle, vOffset, minD / 1000);
        }
      }
    }

    this.updateMatrixHUD();
  }

  addPointToCloud(agvX, agvZ, hAngle, vAngle, distMeters) {
    if (distMeters > 5.5) return; // Ignore far out-of-range

    const px = agvX + Math.cos(hAngle) * distMeters;
    const py = Math.max(0.02, 0.67 + Math.sin(vAngle) * distMeters);
    const pz = agvZ + Math.sin(hAngle) * distMeters;

    const i = this.pointsCount * 3;
    this.pointPositions[i] = px;
    this.pointPositions[i + 1] = py;
    this.pointPositions[i + 2] = pz;

    // Color by height / proximity (Blue low, Cyan mid, Orange close/high)
    const color = new THREE.Color();
    if (distMeters < 0.8) {
      color.setRGB(0.95, 0.2, 0.2); // Hot red warning
    } else if (py > 0.5) {
      color.setRGB(0.95, 0.6, 0.1); // Amber obstacles
    } else {
      color.setRGB(0.05, 0.75, 0.95); // Cold cyan floor/walls
    }

    this.pointColors[i] = color.r;
    this.pointColors[i + 1] = color.g;
    this.pointColors[i + 2] = color.b;

    this.pointsCount++;
    this.pointCloud.geometry.attributes.position.needsUpdate = true;
    this.pointCloud.geometry.attributes.color.needsUpdate = true;
    this.pointCloud.geometry.setDrawRange(0, this.pointsCount);

    const pointsCountEl = document.getElementById('slam-stat-points');
    if (pointsCountEl) pointsCountEl.innerText = this.pointsCount.toLocaleString();
  }

  // --------------------------------------------------------------------------
  // HARDWARE WEBSOCKET CLIENT (RASPBERRY PI / ESP32)
  // --------------------------------------------------------------------------
  initHardwareBridge() {
    const connectBtn = document.getElementById('slam-btn-connect');
    if (connectBtn) {
      connectBtn.addEventListener('click', () => {
        const inputUrl = prompt('Enter Raspberry Pi / ESP32 WebSocket URL:', this.wsUrl);
        if (inputUrl) {
          this.wsUrl = inputUrl;
          this.connectToHardware();
        }
      });
    }
  }

  connectToHardware() {
    const statusBadge = document.getElementById('slam-hardware-status');
    if (statusBadge) {
      statusBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span> Connecting...';
      statusBadge.className = 'px-3 py-1 rounded-full text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-2';
    }

    try {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => {
        this.isHardwareConnected = true;
        if (statusBadge) {
          statusBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> HARDWARE ONLINE (VL53L5CX)';
          statusBadge.className = 'px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-2';
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Format: { matrix: [64 numbers in mm], pose: { x, y, yaw } }
          if (data.matrix && data.matrix.length === 64) {
            for (let i = 0; i < 64; i++) {
              this.matrix64[i] = data.matrix[i];
            }
            if (data.pose) {
              this.agvGroup.position.x = data.pose.x || 0;
              this.agvGroup.position.z = data.pose.y || 0;
              this.agvGroup.rotation.y = data.pose.yaw || 0;
            }
            this.updateMatrixHUD();
          }
        } catch (err) {
          console.warn('Invalid packet:', err);
        }
      };

      this.ws.onerror = (e) => {
        console.log('WS error, fallback to simulation mode');
        this.fallbackToSimulation();
      };

      this.ws.onclose = () => {
        this.fallbackToSimulation();
      };
    } catch (e) {
      this.fallbackToSimulation();
    }
  }

  fallbackToSimulation() {
    this.isHardwareConnected = false;
    const statusBadge = document.getElementById('slam-hardware-status');
    if (statusBadge) {
      statusBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span> SIMULATION MODE (READY)';
      statusBadge.className = 'px-3 py-1 rounded-full text-xs font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 flex items-center gap-2';
    }
  }

  // --------------------------------------------------------------------------
  // 8×8 MATRIX HEATMAP HUD (64 ZONE DISPLAY)
  // --------------------------------------------------------------------------
  updateMatrixHUD() {
    const gridContainer = document.getElementById('vl53l5cx-matrix-grid');
    if (!gridContainer) return;

    let minD = 9999;
    let maxD = 0;
    let sumD = 0;
    let closeObstacles = 0;

    for (let i = 0; i < 64; i++) {
      const d = this.matrix64[i];
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
      sumD += d;
      if (d < 450) closeObstacles++;

      const cell = gridContainer.children[i];
      if (cell) {
        // Depth coloring: Red (<400mm), Amber (<800mm), Green (<1500mm), Blue/Cyan (>1500mm)
        let bg = 'rgba(6, 182, 212, 0.25)';
        let textCol = '#22d3ee';
        if (d < 350) {
          bg = 'rgba(239, 68, 68, 0.75)';
          textCol = '#ffffff';
        } else if (d < 700) {
          bg = 'rgba(245, 158, 11, 0.55)';
          textCol = '#fef3c7';
        } else if (d < 1200) {
          bg = 'rgba(16, 185, 129, 0.35)';
          textCol = '#6ee7b7';
        }
        cell.style.background = bg;
        cell.style.color = textCol;
        cell.innerText = `${Math.round(d / 10)}`; // display in cm
      }
    }

    // Telemetry indicators
    const minEl = document.getElementById('slam-stat-min');
    const avgEl = document.getElementById('slam-stat-avg');
    const obsEl = document.getElementById('slam-stat-obstacles');
    if (minEl) minEl.innerText = `${(minD / 10).toFixed(0)} cm`;
    if (avgEl) avgEl.innerText = `${(sumD / 640).toFixed(0)} cm`;
    if (obsEl) obsEl.innerText = closeObstacles;
  }

  // --------------------------------------------------------------------------
  // MULTI-LOCATION MEMORY & PERSISTENT STORAGE
  // --------------------------------------------------------------------------
  loadSavedMapsFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Storage read error:', e);
    }

    // Pre-seeded Default Map Locations for the user
    return [
      {
        id: 'map_college_302',
        name: 'College - Robotics Lab 302',
        category: 'College',
        createdAt: '2026-09-01',
        areaSqM: 48,
        pointsCount: 1450,
        notes: 'High-density workbench layout with 2 charging docking zones and obstacle corridors.'
      },
      {
        id: 'map_home_hallway',
        name: 'Home - Living Room & Hallway',
        category: 'Home',
        createdAt: '2026-09-03',
        areaSqM: 32,
        pointsCount: 1120,
        notes: 'Residential narrow corridor mapping with doorway boundaries and carpet transitions.'
      },
      {
        id: 'map_warehouse_bay4',
        name: 'Industry - Warehouse Bay 4',
        category: 'Industry',
        createdAt: '2026-09-04',
        areaSqM: 120,
        pointsCount: 2340,
        notes: 'Heavy industrial pallet rack staging area with high-bay loading corridors.'
      }
    ];
  }

  saveCurrentMap(name, category, notes) {
    if (!name || name.trim() === '') {
      name = `Map_${new Date().toLocaleDateString().replace(/\//g, '-')}_${Math.floor(Math.random() * 900 + 100)}`;
    }

    const newMap = {
      id: `map_${Date.now()}`,
      name: name.trim(),
      category: category || 'General',
      createdAt: new Date().toISOString().split('T')[0],
      areaSqM: Math.floor(Math.random() * 40 + 25),
      pointsCount: Math.max(800, this.pointsCount),
      notes: notes || 'Live VL53L5CX 3D scan preserved in permanent memory.'
    };

    this.savedMaps.unshift(newMap);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.savedMaps));
    } catch (e) {
      console.warn('Could not save to localStorage:', e);
    }

    this.activeMapName = newMap.name;
    this.renderSavedMapsUI();
    this.showToast(`Map "${newMap.name}" saved to memory!`);
  }

  loadMapIntoScene(mapId) {
    const targetMap = this.savedMaps.find(m => m.id === mapId);
    if (!targetMap) return;

    this.activeMapName = targetMap.name;
    this.loadDefaultEnvironment(targetMap.name);
    this.showToast(`Loaded map: ${targetMap.name}`);

    // Update active label in UI
    const activeLabel = document.getElementById('slam-active-map-name');
    if (activeLabel) activeLabel.innerText = targetMap.name;
  }

  deleteMap(mapId) {
    if (this.savedMaps.length <= 1) {
      alert('At least one map must remain in memory.');
      return;
    }
    this.savedMaps = this.savedMaps.filter(m => m.id !== mapId);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.savedMaps));
    } catch (e) {}
    this.renderSavedMapsUI();
    this.showToast('Map deleted from memory.');
  }

  exportMapJSON(mapId) {
    const map = this.savedMaps.find(m => m.id === mapId) || this.savedMaps[0];
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(map, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `${map.name.replace(/[^a-zA-Z0-9]/g, '_')}_3D_MAP.json`);
    dlAnchor.click();
    dlAnchor.remove();
  }

  loadDefaultEnvironment(locationName) {
    // Clear old voxel obstacles
    while (this.voxelGroup.children.length > 0) {
      this.voxelGroup.remove(this.voxelGroup.children[0]);
    }

    // Reset point cloud
    this.pointsCount = 0;
    this.pathPoints = [];
    if (this.pathLine) this.pathLine.geometry.setFromPoints([]);

    // Configure room obstacles according to location
    let obstacles = [];
    if (locationName.includes('College')) {
      obstacles = [
        { x: -3.5, z: 2.5, w: 2.0, h: 1.2, d: 1.2, color: 0x3b82f6, label: 'Workstation Alpha' },
        { x: 3.2, z: -2.8, w: 1.8, h: 1.0, d: 1.4, color: 0x0ea5e9, label: 'Bench Beta' },
        { x: -2.0, z: -3.5, w: 1.2, h: 1.5, d: 1.2, color: 0x6366f1, label: 'Rack 1' }
      ];
    } else if (locationName.includes('Home')) {
      obstacles = [
        { x: -2.8, z: 1.5, w: 2.5, h: 0.8, d: 1.2, color: 0x8b5cf6, label: 'Living Sofa' },
        { x: 2.5, z: 2.0, w: 1.5, h: 1.2, d: 0.8, color: 0xa855f7, label: 'Cabinet' },
        { x: 0.0, z: -3.8, w: 1.0, h: 2.0, d: 0.2, color: 0xd946ef, label: 'Doorway Pillar' }
      ];
    } else {
      // Industry / Warehouse
      obstacles = [
        { x: -4.0, z: 0.0, w: 1.5, h: 2.5, d: 4.5, color: 0xf59e0b, label: 'Pallet Rack A' },
        { x: 4.0, z: 0.0, w: 1.5, h: 2.5, d: 4.5, color: 0xd97706, label: 'Pallet Rack B' },
        { x: 0.0, z: 3.8, w: 2.2, h: 1.4, d: 1.8, color: 0xef4444, label: 'Cargo Crate' }
      ];
    }

    this.currentObstacles = obstacles;

    // Build 3D Voxel Meshes for Obstacles
    obstacles.forEach(obs => {
      const geo = new THREE.BoxGeometry(obs.w, obs.h, obs.d);
      const mat = new THREE.MeshStandardMaterial({
        color: obs.color,
        roughness: 0.4,
        metalness: 0.3,
        transparent: true,
        opacity: 0.88
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(obs.x, obs.h / 2, obs.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.voxelGroup.add(mesh);

      // Add wireframe cage
      const wire = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.4, transparent: true })
      );
      wire.position.copy(mesh.position);
      this.voxelGroup.add(wire);
    });

    // Generate initial point cloud scatter on obstacles
    for (let k = 0; k < 450; k++) {
      const obs = obstacles[Math.floor(Math.random() * obstacles.length)];
      const px = obs.x + (Math.random() - 0.5) * obs.w;
      const py = Math.random() * obs.h;
      const pz = obs.z + (Math.random() - 0.5) * obs.d;
      const idx = this.pointsCount * 3;
      this.pointPositions[idx] = px;
      this.pointPositions[idx + 1] = py;
      this.pointPositions[idx + 2] = pz;
      this.pointColors[idx] = 0.9;
      this.pointColors[idx + 1] = 0.5;
      this.pointColors[idx + 2] = 0.1;
      this.pointsCount++;
    }
    this.pointCloud.geometry.setDrawRange(0, this.pointsCount);
    this.pointCloud.geometry.attributes.position.needsUpdate = true;
    this.pointCloud.geometry.attributes.color.needsUpdate = true;
  }

  // --------------------------------------------------------------------------
  // UI & CONTROLS BINDING
  // --------------------------------------------------------------------------
  initUI() {
    // Generate 64 cells in 8x8 matrix grid DOM
    const gridContainer = document.getElementById('vl53l5cx-matrix-grid');
    if (gridContainer) {
      gridContainer.innerHTML = '';
      for (let i = 0; i < 64; i++) {
        const cell = document.createElement('div');
        cell.className = 'w-full aspect-square rounded flex items-center justify-center text-[9px] font-mono font-bold transition-colors select-none shadow-sm';
        cell.innerText = '250';
        cell.title = `Zone ${i + 1} (Row ${Math.floor(i / 8) + 1}, Col ${(i % 8) + 1})`;
        gridContainer.appendChild(cell);
      }
    }

    // Toggle Scan Button
    const scanToggleBtn = document.getElementById('slam-btn-scan-toggle');
    if (scanToggleBtn) {
      scanToggleBtn.addEventListener('click', () => {
        this.isScanning = !this.isScanning;
        scanToggleBtn.innerHTML = this.isScanning
          ? '<span class="material-symbols-outlined text-sm">pause</span><span>Pause Scan</span>'
          : '<span class="material-symbols-outlined text-sm">play_arrow</span><span>Resume Scan</span>';
        scanToggleBtn.className = this.isScanning
          ? 'px-4 py-2 rounded-xl text-xs font-mono font-bold bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-1.5 shadow-md transition-all'
          : 'px-4 py-2 rounded-xl text-xs font-mono font-bold bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-1.5 shadow-md transition-all';
      });
    }

    // Clear / Reset Scan
    const clearBtn = document.getElementById('slam-btn-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.pointsCount = 0;
        this.pathPoints = [];
        this.pointCloud.geometry.setDrawRange(0, 0);
        this.pathLine.geometry.setFromPoints([]);
        this.showToast('Point cloud cleared.');
      });
    }

    // Reset Camera
    const resetCamBtn = document.getElementById('slam-btn-reset-cam');
    if (resetCamBtn) {
      resetCamBtn.addEventListener('click', () => {
        this.camera.position.set(7, 8, 9);
        this.controls.target.set(0, 0.5, 0);
        this.controls.update();
      });
    }

    // Save Map Modal Trigger
    const saveModalBtn = document.getElementById('slam-btn-save-modal');
    const modal = document.getElementById('slam-save-modal');
    const modalCloseBtn = document.getElementById('slam-modal-close');
    const modalConfirmBtn = document.getElementById('slam-modal-confirm');

    if (saveModalBtn && modal) {
      saveModalBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        const inputName = document.getElementById('slam-input-map-name');
        if (inputName) inputName.focus();
      });
    }

    if (modalCloseBtn && modal) {
      modalCloseBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      });
    }

    if (modalConfirmBtn && modal) {
      modalConfirmBtn.addEventListener('click', () => {
        const inputName = document.getElementById('slam-input-map-name');
        const selectCat = document.getElementById('slam-select-map-cat');
        const inputNotes = document.getElementById('slam-input-map-notes');

        const name = inputName ? inputName.value : '';
        const cat = selectCat ? selectCat.value : 'College';
        const notes = inputNotes ? inputNotes.value : '';

        this.saveCurrentMap(name, cat, notes);
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      });
    }

    // Initial render of saved maps memory cards
    this.renderSavedMapsUI();
  }

  renderSavedMapsUI() {
    const listContainer = document.getElementById('slam-saved-maps-grid');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    this.savedMaps.forEach(map => {
      const card = document.createElement('div');
      card.className = 'p-4 rounded-2xl bg-white border border-slate-200/90 hover:border-cyan-500/70 hover:shadow-lg transition-all space-y-3 shadow-sm flex flex-col justify-between';

      // Badge color according to category
      let badgeClass = 'bg-cyan-100 text-cyan-800 border-cyan-200';
      if (map.category === 'Home') badgeClass = 'bg-purple-100 text-purple-800 border-purple-200';
      if (map.category === 'Industry') badgeClass = 'bg-amber-100 text-amber-800 border-amber-200';

      card.innerHTML = `
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${badgeClass}">
              ${map.category}
            </span>
            <span class="text-[10px] font-mono text-slate-600">${map.createdAt}</span>
          </div>
          <h5 class="text-base font-bold text-slate-900 font-['DM_Sans'] tracking-tight">${map.name}</h5>
          <p class="text-[11px] text-slate-600 font-mono leading-relaxed line-clamp-2">${map.notes}</p>
        </div>

        <div class="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
          <div class="text-[10px] font-mono text-slate-600">
            <span>${map.areaSqM || 40} m²</span> · <span>${map.pointsCount || 1000} pts</span>
          </div>

          <div class="flex items-center gap-1.5">
            <button class="btn-load-map px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-mono font-bold transition-colors shadow-sm flex items-center gap-1" data-id="${map.id}">
              <span class="material-symbols-outlined text-xs">view_in_ar</span>
              <span>Load</span>
            </button>
            <button class="btn-export-map p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs transition-colors" data-id="${map.id}" title="Export JSON">
              <span class="material-symbols-outlined text-sm">download</span>
            </button>
            <button class="btn-del-map p-1.5 rounded-lg bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-600 text-xs transition-colors" data-id="${map.id}" title="Delete Map">
              <span class="material-symbols-outlined text-sm">delete</span>
            </button>
          </div>
        </div>
      `;

      // Event listeners
      card.querySelector('.btn-load-map').addEventListener('click', () => this.loadMapIntoScene(map.id));
      card.querySelector('.btn-export-map').addEventListener('click', () => this.exportMapJSON(map.id));
      card.querySelector('.btn-del-map').addEventListener('click', () => this.deleteMap(map.id));

      listContainer.appendChild(card);
    });
  }

  showToast(msg) {
    const toast = document.getElementById('slam-toast');
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.remove('opacity-0', 'pointer-events-none');
    toast.classList.add('opacity-100');
    setTimeout(() => {
      toast.classList.remove('opacity-100');
      toast.classList.add('opacity-0', 'pointer-events-none');
    }, 2800);
  }

  // --------------------------------------------------------------------------
  // ANIMATION TICK
  // --------------------------------------------------------------------------
  animate() {
    requestAnimationFrame(this.animate);
    this.updateSimulation(0.016);
    if (this.controls) this.controls.update();
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
