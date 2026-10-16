import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AdminStudioManager } from './admin/adminStudio.js';

// ============================================================================
// INTRAMOVE DEDICATED SLAM MAPPING STUDIO & MULTI-LOCATION MEMORY SYSTEM (V4)
// ============================================================================

const STORAGE_KEY = 'INTRAMOVE_SLAM_FACILITIES_V5';

export class SlamStudioApp {
  constructor() {
    this.canvasContainer = document.getElementById('slam-canvas-container');
    if (!this.canvasContainer) return;

    // Three.js Core
    this.scene = null;
    this.camera = null;
    this.orthoCamera = null;
    this.currentCamera = null;
    this.renderer = null;
    this.controls = null;
    this.is2DMode = false;

    // 3D Scene Elements
    this.agvGroup = null;
    this.lidarTurret = null;
    this.raysGroup = null;
    this.occupancyGridMesh = null;
    this.gridTexture = null;
    this.gridCanvas = null;
    this.gridCtx = null;
    this.pathLine = null;
    this.wallsGroup = null;
    this.obstaclesGroup = null;

    // Occupancy Grid Constants (240x240 cells, 0.05m resolution = 12m x 12m)
    this.gridSize = 240;
    this.gridResolution = 0.05;
    // 0 = Unknown (#0a0f1d), 1 = Free space (#e2e8f0), 2 = Wall/Obstacle (#000000)
    this.gridData = new Uint8Array(this.gridSize * this.gridSize).fill(0);

    // AGV Navigation State
    this.agvPos = { x: 0, z: 0, heading: 0 };
    this.lastAgvPos = { x: 0, z: 0 };
    this.simSpeed = 0.04;
    this.simAngle = 0;
    this.simTurn = 0.02;
    this.pathPoints = [];
    this.isScanning = false;
    this.isHardwareConnected = false;
    this.ws = null;
    this.wsUrl = 'ws://192.168.1.100:8765';

    // VL53L5CX 8x8 Depth Matrix (64 zones in mm)
    this.matrix64 = new Float32Array(64).fill(3000);

    // Waypoint Navigation (Starting Point A & Ending Point B)
    this.pointA = null; // { x: number, z: number }
    this.pointB = null; // { x: number, z: number }
    this.pickingMode = null; // 'A' | 'B' | null
    this.markerA = null; // THREE.Group
    this.markerB = null; // THREE.Group
    this.waypointGuideLine = null; // THREE.Line
    this.totalOdometry = 0.0; // Cumulative meters traveled in scan

    // Raycaster for map picking
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Multi-Facility & Room Memory
    this.facilities = this.loadFacilitiesFromStorage();
    this.expandedFacilityId = 'fac_home'; // Open Home by default in vertical list
    this.currentActiveRoom = null;

    this.initThree();
    this.initOccupancyCanvas();
    this.initUI();
    this.initFormHandlers();
    this.initStandbyState();
    this.renderVerticalFacilitiesList();

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  // --------------------------------------------------------------------------
  // THREE.JS SCENE SETUP (CLEAN HIGH-CONTRAST CAD VIEWPORT)
  // --------------------------------------------------------------------------
  initThree() {
    const w = this.canvasContainer.clientWidth || 900;
    const h = this.canvasContainer.clientHeight || 560;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0f1d); // Deep RViz slate black

    // Perspective Camera (3D Isometric)
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    this.camera.position.set(0, 14, 12);

    // Orthographic Camera (Exact RViz 2D Top-Down)
    const aspect = w / h;
    const d = 7.5;
    this.orthoCamera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, 100);
    this.orthoCamera.position.set(0, 25, 0);
    this.orthoCamera.up.set(0, 0, -1);
    this.orthoCamera.lookAt(0, 0, 0);

    this.currentCamera = this.camera;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.canvasContainer.appendChild(this.renderer.domElement);

    // Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.target.set(0, 0, 0);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.95);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(8, 16, 8);
    this.scene.add(dirLight);

    // RViz Grid lines
    const rvizGrid = new THREE.GridHelper(12, 24, 0x1e293b, 0x0f172a);
    rvizGrid.position.y = -0.005;
    this.scene.add(rvizGrid);

    // Groups
    this.wallsGroup = new THREE.Group();
    this.obstaclesGroup = new THREE.Group();
    this.scene.add(this.wallsGroup);
    this.scene.add(this.obstaclesGroup);

    // 3D AGV Model
    this.buildAgvModel();

    // Trajectory Path Line
    const pathGeo = new THREE.BufferGeometry();
    const pathMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, linewidth: 2 });
    this.pathLine = new THREE.Line(pathGeo, pathMat);
    this.scene.add(this.pathLine);

    // Waypoint Guide Line (Point A to Point B)
    const wpGeo = new THREE.BufferGeometry();
    const wpMat = new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 3 });
    this.waypointGuideLine = new THREE.Line(wpGeo, wpMat);
    this.scene.add(this.waypointGuideLine);

    // Canvas Click Listener for Interactive Point Picking
    this.canvasContainer.addEventListener('pointerdown', (e) => this.handleCanvasMapClick(e));

    // Window Resize Handler
    window.addEventListener('resize', () => {
      if (!this.canvasContainer) return;
      const nw = this.canvasContainer.clientWidth;
      const nh = this.canvasContainer.clientHeight;
      this.camera.aspect = nw / nh;
      this.camera.updateProjectionMatrix();

      const na = nw / nh;
      this.orthoCamera.left = -d * na;
      this.orthoCamera.right = d * na;
      this.orthoCamera.top = d;
      this.orthoCamera.bottom = -d;
      this.orthoCamera.updateProjectionMatrix();

      this.renderer.setSize(nw, nh);
    });
  }

  // --------------------------------------------------------------------------
  // OCCUPANCY GRID MESH & REAL-TIME 2D CANVAS TEXTURE
  // --------------------------------------------------------------------------
  initOccupancyCanvas() {
    this.gridCanvas = document.createElement('canvas');
    this.gridCanvas.width = this.gridSize;
    this.gridCanvas.height = this.gridSize;
    this.gridCtx = this.gridCanvas.getContext('2d');

    // Fill with unexplored dark (#0a0f1d)
    this.gridCtx.fillStyle = '#0a0f1d';
    this.gridCtx.fillRect(0, 0, this.gridSize, this.gridSize);

    // Draw subtle origin crosshairs and radar ring
    this.drawStandbyGridOverlay();

    // Texture mapped onto 3D plane
    this.gridTexture = new THREE.CanvasTexture(this.gridCanvas);
    this.gridTexture.magFilter = THREE.NearestFilter;
    this.gridTexture.minFilter = THREE.NearestFilter;

    const planeGeo = new THREE.PlaneGeometry(12, 12);
    const planeMat = new THREE.MeshBasicMaterial({
      map: this.gridTexture,
      transparent: false
    });
    this.occupancyGridMesh = new THREE.Mesh(planeGeo, planeMat);
    this.occupancyGridMesh.rotation.x = -Math.PI / 2;
    this.occupancyGridMesh.position.y = 0;
    this.scene.add(this.occupancyGridMesh);
  }

  drawStandbyGridOverlay() {
    this.gridCtx.fillStyle = '#0a0f1d';
    this.gridCtx.fillRect(0, 0, this.gridSize, this.gridSize);

    const c = this.gridSize / 2;

    // Subtle 1m grid dots
    this.gridCtx.fillStyle = '#1e293b';
    for (let x = 20; x < this.gridSize; x += 20) {
      for (let y = 20; y < this.gridSize; y += 20) {
        this.gridCtx.fillRect(x - 1, y - 1, 2, 2);
      }
    }

    // Origin crosshair
    this.gridCtx.strokeStyle = '#334155';
    this.gridCtx.lineWidth = 1;
    this.gridCtx.beginPath();
    this.gridCtx.moveTo(c - 16, c);
    this.gridCtx.lineTo(c + 16, c);
    this.gridCtx.moveTo(c, c - 16);
    this.gridCtx.lineTo(c, c + 16);
    this.gridCtx.stroke();

    // Concentric range rings (2m, 4m)
    this.gridCtx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
    this.gridCtx.setLineDash([4, 4]);
    this.gridCtx.beginPath();
    this.gridCtx.arc(c, c, 40, 0, Math.PI * 2);
    this.gridCtx.arc(c, c, 80, 0, Math.PI * 2);
    this.gridCtx.stroke();
    this.gridCtx.setLineDash([]);
  }

  initStandbyState() {
    this.isScanning = false;
    this.agvPos = { x: 0, z: 0, heading: 0 };
    this.lastAgvPos = { x: 0, z: 0 };
    this.agvGroup.position.set(0, 0, 0);
    this.agvGroup.rotation.y = 0;

    const titleEl = document.getElementById('slam-active-room-title');
    if (titleEl) titleEl.innerText = 'Standby Grid · Ready for Scan / Hardware Input';

    const areaEl = document.getElementById('slam-room-area-val');
    if (areaEl) areaEl.innerText = '0.0 m²';

    const hwBadge = document.getElementById('slam-hw-badge');
    if (hwBadge) {
      hwBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-cyan-600"></span><span>HARDWARE READY · STANDBY</span>';
      hwBadge.className = 'px-3 py-1.5 rounded-full text-xs font-mono font-bold bg-cyan-50 text-cyan-800 border border-cyan-200 flex items-center gap-2 shadow-sm';
    }

    const agvStatus = document.getElementById('slam-agv-nav-status');
    if (agvStatus) agvStatus.innerText = 'PARKED AT ORIGIN (0, 0)';

    const agvPosEl = document.getElementById('slam-agv-pos-val');
    if (agvPosEl) agvPosEl.innerText = 'X: 0.00m, Z: 0.00m';
  }

  buildAgvModel() {
    this.agvGroup = new THREE.Group();

    // Chassis Box
    const bodyGeo = new THREE.BoxGeometry(0.9, 0.3, 0.55);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.3, metalness: 0.3 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.22;
    this.agvGroup.add(body);

    // Heading Arrow (Green heading indicator)
    const arrowDir = new THREE.Vector3(1, 0, 0);
    const arrowOrigin = new THREE.Vector3(0, 0.45, 0);
    const arrow = new THREE.ArrowHelper(arrowDir, arrowOrigin, 0.8, 0x10b981, 0.25, 0.15);
    this.agvGroup.add(arrow);

    // Elevated LiDAR Turret
    const turret = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.1, 0.14, 16),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2 })
    );
    turret.position.set(0.3, 0.42, 0);
    this.agvGroup.add(turret);

    // Smartelex Sensor Lens
    const lens = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee })
    );
    lens.position.set(0.35, 0.43, 0);
    this.agvGroup.add(lens);

    // 6 Wheels
    const wGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12);
    const wMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });
    [-0.3, 0, 0.3].forEach(x => {
      const wl = new THREE.Mesh(wGeo, wMat);
      wl.rotation.x = Math.PI / 2;
      wl.position.set(x, 0.12, 0.3);
      this.agvGroup.add(wl);

      const wr = new THREE.Mesh(wGeo, wMat);
      wr.rotation.x = Math.PI / 2;
      wr.position.set(x, 0.12, -0.3);
      this.agvGroup.add(wr);
    });

    // 64-Ray Sensor Cone
    this.raysGroup = new THREE.Group();
    this.agvGroup.add(this.raysGroup);
    this.buildLidarRays();

    this.agvGroup.position.set(0, 0, 0);
    this.scene.add(this.agvGroup);
  }

  buildLidarRays() {
    const rayMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.25 });
    for (let i = 0; i < 64; i++) {
      const c = i % 8;
      const r = Math.floor(i / 8);
      const hAngle = ((c - 3.5) / 3.5) * 0.39;
      const vAngle = ((r - 3.5) / 3.5) * 0.39;

      const pts = [
        new THREE.Vector3(0.35, 0.43, 0),
        new THREE.Vector3(0.35 + Math.cos(hAngle) * 2.8, 0.43 + Math.sin(vAngle) * 1.5, Math.sin(hAngle) * 2.8)
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.raysGroup.add(new THREE.Line(geo, rayMat));
    }
  }

  // --------------------------------------------------------------------------
  // INTERACTIVE WAYPOINT SELECTION (Point A & Point B)
  // --------------------------------------------------------------------------
  handleCanvasMapClick(event) {
    if (!this.pickingMode) return;

    const rect = this.canvasContainer.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.currentCamera);
    const targetPoint = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, targetPoint);

    if (hit) {
      const clampedX = Math.max(-5.5, Math.min(5.5, Number(targetPoint.x.toFixed(2))));
      const clampedZ = Math.max(-5.5, Math.min(5.5, Number(targetPoint.z.toFixed(2))));

      if (this.pickingMode === 'A') {
        this.setStartingPoint(clampedX, clampedZ);
      } else if (this.pickingMode === 'B') {
        this.setEndingPoint(clampedX, clampedZ);
      }

      this.setPickingMode(null);
    }
  }

  setPickingMode(mode) {
    this.pickingMode = mode;

    const btnA = document.getElementById('slam-btn-set-point-a');
    const btnB = document.getElementById('slam-btn-set-point-b');
    const labelA = document.getElementById('slam-btn-label-a');
    const labelB = document.getElementById('slam-btn-label-b');
    const hintText = document.getElementById('slam-picker-hint-text');
    const activeBadge = document.getElementById('slam-picker-active-badge');

    // Reset styles
    if (btnA) {
      btnA.className = 'px-4 py-2 rounded-xl text-xs font-mono font-bold bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200 hover:border-emerald-400 transition-all flex items-center gap-2 shadow-sm cursor-pointer group hover-lift';
      if (labelA) labelA.innerText = this.pointA ? `Start Point (A): [${this.pointA.x}, ${this.pointA.z}]` : 'Set Starting Point (A)';
    }
    if (btnB) {
      btnB.className = 'px-4 py-2 rounded-xl text-xs font-mono font-bold bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200 hover:border-rose-400 transition-all flex items-center gap-2 shadow-sm cursor-pointer group hover-lift';
      if (labelB) labelB.innerText = this.pointB ? `End Point (B): [${this.pointB.x}, ${this.pointB.z}]` : 'Set Ending Point (B)';
    }

    if (mode === 'A') {
      if (btnA) {
        btnA.className = 'px-4 py-2 rounded-xl text-xs font-mono font-bold bg-emerald-600 text-white border-2 border-emerald-400 shadow-md shadow-emerald-600/20 flex items-center gap-2 cursor-pointer animate-pulse';
        if (labelA) labelA.innerText = 'Click on Map for Point A...';
      }
      if (hintText) hintText.innerText = 'MODE ACTIVE: Click anywhere on the 3D/2D map canvas to place Starting Point (A).';
      if (activeBadge) {
        activeBadge.innerText = 'Click Map for Point A';
        activeBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse';
        activeBadge.classList.remove('hidden');
      }
      this.showToast('Click anywhere on the map to set Starting Point (A)');
    } else if (mode === 'B') {
      if (btnB) {
        btnB.className = 'px-4 py-2 rounded-xl text-xs font-mono font-bold bg-rose-600 text-white border-2 border-rose-400 shadow-md shadow-rose-600/20 flex items-center gap-2 cursor-pointer animate-pulse';
        if (labelB) labelB.innerText = 'Click on Map for Point B...';
      }
      if (hintText) hintText.innerText = 'MODE ACTIVE: Click anywhere on the 3D/2D map canvas to place Ending Point (B).';
      if (activeBadge) {
        activeBadge.innerText = 'Click Map for Point B';
        activeBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-100 text-rose-800 border border-rose-300 animate-pulse';
        activeBadge.classList.remove('hidden');
      }
      this.showToast('Click anywhere on the map to set Ending Point (B)');
    } else {
      if (hintText) hintText.innerText = 'Standby: Select a button above to choose Starting or Ending Point on the map.';
      if (activeBadge) activeBadge.classList.add('hidden');
    }
  }

  setStartingPoint(x, z) {
    this.pointA = { x, z };

    if (this.markerA) {
      this.scene.remove(this.markerA);
      this.markerA = null;
    }

    this.markerA = this.buildWaypointMarkerMesh('A', 0x10b981, '#10b981');
    this.markerA.position.set(x, 0, z);
    this.scene.add(this.markerA);

    this.agvPos.x = x;
    this.agvPos.z = z;
    this.lastAgvPos.x = x;
    this.lastAgvPos.z = z;
    this.agvGroup.position.set(x, 0, z);

    const coordA = document.getElementById('slam-coord-a-val');
    if (coordA) coordA.innerText = `X: ${x}m, Z: ${z}m`;

    const statusA = document.getElementById('slam-coord-a-status');
    if (statusA) statusA.innerText = 'Pinned on map';

    const agvStatus = document.getElementById('slam-agv-nav-status');
    if (agvStatus) agvStatus.innerText = 'PARKED AT POINT (A)';

    const agvPosEl = document.getElementById('slam-agv-pos-val');
    if (agvPosEl) agvPosEl.innerText = `X: ${x}m, Z: ${z}m`;

    this.updateWaypointDistanceAndGuide();
    this.showToast(`Starting Point (A) pinned at [X: ${x}m, Z: ${z}m]!`);
  }

  setEndingPoint(x, z) {
    this.pointB = { x, z };

    if (this.markerB) {
      this.scene.remove(this.markerB);
      this.markerB = null;
    }

    this.markerB = this.buildWaypointMarkerMesh('B', 0xf43f5e, '#f43f5e');
    this.markerB.position.set(x, 0, z);
    this.scene.add(this.markerB);

    const coordB = document.getElementById('slam-coord-b-val');
    if (coordB) coordB.innerText = `X: ${x}m, Z: ${z}m`;

    const statusB = document.getElementById('slam-coord-b-status');
    if (statusB) statusB.innerText = 'Pinned on map';

    this.updateWaypointDistanceAndGuide();
    this.showToast(`Ending Point (B) pinned at [X: ${x}m, Z: ${z}m]!`);
  }

  buildWaypointMarkerMesh(label, colorHex, colorCss) {
    const group = new THREE.Group();

    // Beacon pole
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.05, 1.2, 16);
    const poleMat = new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.8, roughness: 0.2 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 0.6;
    group.add(pole);

    // Beacon top orb
    const orbGeo = new THREE.SphereGeometry(0.16, 16, 16);
    const orbMat = new THREE.MeshBasicMaterial({ color: colorHex });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.y = 1.25;
    group.add(orb);

    // Ground target ring
    const ringGeo = new THREE.RingGeometry(0.35, 0.42, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);

    // Text Sprite Tag
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = colorCss;
    ctx.roundRect(4, 4, 120, 56, 12);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`POINT ${label}`, 64, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(0, 1.65, 0);
    sprite.scale.set(0.9, 0.45, 1);
    group.add(sprite);

    return group;
  }

  updateWaypointDistanceAndGuide() {
    const distEl = document.getElementById('slam-metric-distance-ab');

    if (this.pointA && this.pointB) {
      const dx = this.pointB.x - this.pointA.x;
      const dz = this.pointB.z - this.pointA.z;
      const dist = Math.hypot(dx, dz);

      if (distEl) distEl.innerText = dist.toFixed(2);

      const pts = [
        new THREE.Vector3(this.pointA.x, 0.08, this.pointA.z),
        new THREE.Vector3(this.pointB.x, 0.08, this.pointB.z)
      ];
      this.waypointGuideLine.geometry.setFromPoints(pts);

      const agvStatus = document.getElementById('slam-agv-nav-status');
      if (agvStatus && !this.isScanning) {
        agvStatus.innerText = `READY (TARGET: ${dist.toFixed(2)}m)`;
      }
    } else {
      if (distEl) distEl.innerText = '--';
      this.waypointGuideLine.geometry.setFromPoints([]);
    }
  }

  resetWaypoints() {
    if (this.markerA) {
      this.scene.remove(this.markerA);
      this.markerA = null;
    }
    if (this.markerB) {
      this.scene.remove(this.markerB);
      this.markerB = null;
    }
    this.pointA = null;
    this.pointB = null;
    this.setPickingMode(null);

    this.waypointGuideLine.geometry.setFromPoints([]);

    const distEl = document.getElementById('slam-metric-distance-ab');
    if (distEl) distEl.innerText = '--';

    const coordA = document.getElementById('slam-coord-a-val');
    if (coordA) coordA.innerText = 'X: --, Z: --';
    const statusA = document.getElementById('slam-coord-a-status');
    if (statusA) statusA.innerText = 'Not placed yet';

    const coordB = document.getElementById('slam-coord-b-val');
    if (coordB) coordB.innerText = 'X: --, Z: --';
    const statusB = document.getElementById('slam-coord-b-status');
    if (statusB) statusB.innerText = 'Not placed yet';

    const agvStatus = document.getElementById('slam-agv-nav-status');
    if (agvStatus) agvStatus.innerText = 'STANDBY / READY';

    this.showToast('Starting and Ending points reset.');
  }

  // --------------------------------------------------------------------------
  // SLAM SIMULATION & OCCUPANCY GRID UPDATES
  // --------------------------------------------------------------------------
  updateSLAM() {
    if (!this.isScanning) return;

    this.simAngle += this.simTurn;
    const nextX = this.agvPos.x + Math.cos(this.simAngle) * this.simSpeed;
    const nextZ = this.agvPos.z + Math.sin(this.simAngle) * this.simSpeed;

    const step = Math.hypot(nextX - this.agvPos.x, nextZ - this.agvPos.z);
    this.totalOdometry += step;

    this.agvPos.x = nextX;
    this.agvPos.z = nextZ;

    const limit = 4.2;
    if (Math.abs(this.agvPos.x) > limit || Math.abs(this.agvPos.z) > limit) {
      this.simAngle += Math.PI * 0.65;
      this.agvPos.x = Math.max(-limit, Math.min(limit, this.agvPos.x));
      this.agvPos.z = Math.max(-limit, Math.min(limit, this.agvPos.z));
    }

    this.agvGroup.position.set(this.agvPos.x, 0, this.agvPos.z);
    this.agvGroup.rotation.y = -this.simAngle;

    const odomEl = document.getElementById('slam-metric-scanning-distance');
    if (odomEl) odomEl.innerText = this.totalOdometry.toFixed(2);

    const agvPosEl = document.getElementById('slam-agv-pos-val');
    if (agvPosEl) agvPosEl.innerText = `X: ${this.agvPos.x.toFixed(2)}m, Z: ${this.agvPos.z.toFixed(2)}m`;

    const agvStatus = document.getElementById('slam-agv-nav-status');
    if (agvStatus) agvStatus.innerText = 'AUTONOMOUS SCANNING...';

    if (Math.random() < 0.3) {
      this.pathPoints.push(new THREE.Vector3(this.agvPos.x, 0.02, this.agvPos.z));
      if (this.pathPoints.length > 250) this.pathPoints.shift();
      this.pathLine.geometry.setFromPoints(this.pathPoints);
    }

    this.castToFOccupancyGrid();
  }

  castToFOccupancyGrid() {
    const agvWorldX = this.agvPos.x;
    const agvWorldZ = this.agvPos.z;
    const heading = this.agvGroup.rotation.y;

    const centerX = this.gridSize / 2;
    const centerZ = this.gridSize / 2;
    const scale = 20;

    const agvCellX = Math.round(centerX + agvWorldX * scale);
    const agvCellZ = Math.round(centerZ + agvWorldZ * scale);

    const obstacles = this.currentActiveRoom ? this.currentActiveRoom.obstacles : [
      { x: -2.0, z: 1.8, w: 1.2, d: 1.2 },
      { x: 2.2, z: -1.5, w: 1.4, d: 1.0 },
      { x: 0.0, z: -2.8, w: 1.0, d: 0.8 }
    ];

    let minD = 9999;
    let sumD = 0;

    for (let i = 0; i < 64; i++) {
      const c = i % 8;
      const r = Math.floor(i / 8);
      const hAngle = ((c - 3.5) / 3.5) * 0.39;
      const rayAngle = heading + hAngle;

      let distMeters = 3.6;
      const cosA = Math.cos(rayAngle);
      const sinA = Math.sin(rayAngle);

      if (cosA > 0.01) distMeters = Math.min(distMeters, (4.8 - agvWorldX) / cosA);
      if (cosA < -0.01) distMeters = Math.min(distMeters, (-4.8 - agvWorldX) / cosA);
      if (sinA > 0.01) distMeters = Math.min(distMeters, (4.8 - agvWorldZ) / sinA);
      if (sinA < -0.01) distMeters = Math.min(distMeters, (-4.8 - agvWorldZ) / sinA);

      obstacles.forEach(obs => {
        const dx = obs.x - agvWorldX;
        const dz = obs.z - agvWorldZ;
        const d = Math.sqrt(dx * dx + dz * dz);
        const a = Math.atan2(dz, dx);
        if (Math.abs(rayAngle - a) < 0.22 && d > 0.2) {
          distMeters = Math.min(distMeters, d);
        }
      });

      distMeters = Math.max(0.15, Math.min(4.0, distMeters));
      const distMm = distMeters * 1000;
      this.matrix64[i] = distMm;
      if (distMm < minD) minD = distMm;
      sumD += distMm;

      const hitCellX = Math.round(centerX + (agvWorldX + Math.cos(rayAngle) * distMeters) * scale);
      const hitCellZ = Math.round(centerZ + (agvWorldZ + Math.sin(rayAngle) * distMeters) * scale);

      this.traceRayOntoGrid(agvCellX, agvCellZ, hitCellX, hitCellZ);
    }

    this.gridTexture.needsUpdate = true;
    this.updateMatrixDOM(minD, sumD / 64);
  }

  traceRayOntoGrid(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1;
    let sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let cx = x0;
    let cy = y0;

    while (true) {
      if (cx >= 0 && cx < this.gridSize && cy >= 0 && cy < this.gridSize) {
        if (cx === x1 && cy === y1) {
          this.gridCtx.fillStyle = '#000000';
          this.gridCtx.fillRect(cx - 1, cy - 1, 3, 3);
          this.gridData[cy * this.gridSize + cx] = 2;
          break;
        } else {
          if (this.gridData[cy * this.gridSize + cx] !== 2) {
            this.gridCtx.fillStyle = '#e2e8f0';
            this.gridCtx.fillRect(cx, cy, 2, 2);
            if (this.gridData[cy * this.gridSize + cx] === 0) {
              this.gridData[cy * this.gridSize + cx] = 1;
            }
          }
        }
      }

      if (cx === x1 && cy === y1) break;
      let e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }
  }

  // --------------------------------------------------------------------------
  // FORM HANDLERS & LOCATION PROFILE REGISTRATION
  // --------------------------------------------------------------------------
  initFormHandlers() {
    const catSelect = document.getElementById('form-loc-category');
    const customContainer = document.getElementById('form-custom-loc-container');
    const customInput = document.getElementById('form-custom-loc-name');

    if (catSelect && customContainer) {
      catSelect.addEventListener('change', (e) => {
        if (e.target.value === 'Other') {
          customContainer.classList.remove('hidden');
          if (customInput) customInput.focus();
        } else {
          customContainer.classList.add('hidden');
        }
      });
    }

    const form = document.getElementById('slam-location-reg-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleFormSubmit();
      });
    }

    const scrollBtn = document.getElementById('slam-btn-scroll-to-form');
    if (scrollBtn) {
      scrollBtn.addEventListener('click', () => {
        const section = document.getElementById('section-save-form');
        if (section) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
          section.classList.add('ring-4', 'ring-cyan-500/30');
          setTimeout(() => section.classList.remove('ring-4', 'ring-cyan-500/30'), 2500);
        }
      });
    }
  }

  handleFormSubmit() {
    const locCategory = document.getElementById('form-loc-category')?.value || 'Home (Residence)';
    const customInput = document.getElementById('form-custom-loc-name');
    const zoneType = document.getElementById('form-zone-type')?.value || 'Living Room';
    const roomName = document.getElementById('form-room-name')?.value?.trim();
    const notes = document.getElementById('form-room-notes')?.value?.trim() || '';

    if (!roomName) {
      alert('Please enter a specific room name.');
      return;
    }

    let facilityName = locCategory;
    if (locCategory === 'Other') {
      facilityName = customInput?.value?.trim() || 'Custom Facility';
    }

    // Find or create facility
    let targetFac = this.facilities.find(f => f.name.toLowerCase() === facilityName.toLowerCase());
    if (!targetFac) {
      targetFac = {
        id: `fac_${Date.now()}`,
        name: facilityName,
        category: locCategory === 'Other' ? 'Custom Location' : locCategory,
        icon: this.getIconForCategory(facilityName),
        description: `Multi-zone facility profile for ${facilityName}.`,
        rooms: []
      };
      this.facilities.unshift(targetFac);
    }

    const newRoom = {
      id: `room_${Date.now()}`,
      name: roomName,
      zoneType: zoneType,
      dimensions: 'Pending Hardware Scan',
      areaSqM: '--',
      scannedDate: new Date().toISOString().split('T')[0],
      color: this.getColorForZone(zoneType),
      obstaclesCount: 0,
      obstaclesList: 'To be detected via ToF LiDAR',
      obstacles: [],
      notes: notes || `Registered ${zoneType} under ${facilityName}. Ready for mapping.`
    };

    targetFac.rooms.unshift(newRoom);
    this.expandedFacilityId = targetFac.id;

    this.saveFacilitiesToStorage();
    this.renderVerticalFacilitiesList();

    const facCard = document.getElementById(`fac-vertical-card-${targetFac.id}`);
    if (facCard) {
      facCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      facCard.classList.add('ring-4', 'ring-cyan-500/40');
      setTimeout(() => facCard.classList.remove('ring-4', 'ring-cyan-500/40'), 3000);
    }

    this.showToast(`Saved "${roomName}" under "${targetFac.name}"!`);

    const roomNameInput = document.getElementById('form-room-name');
    if (roomNameInput) roomNameInput.value = '';
    const notesInput = document.getElementById('form-room-notes');
    if (notesInput) notesInput.value = '';
  }

  getIconForCategory(cat) {
    if (cat.includes('Home')) return 'home';
    if (cat.includes('College')) return 'school';
    if (cat.includes('Industry')) return 'factory';
    if (cat.includes('Hospital')) return 'local_hospital';
    if (cat.includes('Office')) return 'business';
    return 'location_on';
  }

  getColorForZone(zone) {
    if (zone.includes('Living')) return '#f5efe6';
    if (zone.includes('Bedroom')) return '#fef08a';
    if (zone.includes('Bathroom')) return '#a9d8ea';
    if (zone.includes('Corridor') || zone.includes('Hallway')) return '#caa986';
    if (zone.includes('Balcony')) return '#dcd8cd';
    if (zone.includes('Robotics') || zone.includes('Lab')) return '#c7d2fe';
    if (zone.includes('Warehouse')) return '#bbf7d0';
    return '#e2e8f0';
  }

  // --------------------------------------------------------------------------
  // MULTI-LOCATION & VERTICAL MEMORY STORAGE
  // --------------------------------------------------------------------------
  loadFacilitiesFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Facility load error:', e);
    }

    return [
      {
        id: 'fac_home',
        name: 'Home (Residence)',
        category: 'Home (Residence)',
        icon: 'home',
        description: 'Architectural residential blueprint with interconnected living, bed, and service areas.',
        rooms: [
          {
            id: 'room_home_living',
            name: 'Living Room and Kitchen',
            zoneType: 'Living Room & Kitchen',
            dimensions: '6.8m × 7.2m',
            areaSqM: 48,
            scannedDate: '2026-09-02',
            color: '#f5efe6',
            obstaclesCount: 5,
            obstaclesList: 'Lounge Sofa, Coffee Table, Dining Table, Kitchen Island Counter',
            obstacles: [
              { x: -1.8, z: 2.2, w: 2.4, d: 1.0, label: 'Lounge Sofa' },
              { x: -0.2, z: 2.0, w: 1.2, d: 0.8, label: 'Coffee Table' },
              { x: -1.8, z: -2.0, w: 1.6, d: 2.0, label: '6-Seat Dining Table' },
              { x: 1.8, z: -2.2, w: 2.2, d: 1.0, label: 'Kitchen Island Counter' }
            ],
            notes: 'Open-concept living space with integrated L-shaped kitchen, dining suite, and balcony access.'
          },
          {
            id: 'room_home_balcony',
            name: 'Balcony',
            zoneType: 'Balcony / Terrace',
            dimensions: '2.8m × 5.4m',
            areaSqM: 15,
            scannedDate: '2026-09-02',
            color: '#dcd8cd',
            obstaclesCount: 2,
            obstaclesList: 'Patio Bistro Table & Chairs, Planter Box',
            obstacles: [
              { x: -0.5, z: 1.2, w: 1.0, d: 1.0, label: 'Patio Bistro Table & Chairs' },
              { x: 0.8, z: -1.8, w: 0.6, d: 0.6, label: 'Planter Box' }
            ],
            notes: 'Exterior stone terrace with safety balustrade and outdoor seating.'
          },
          {
            id: 'room_home_bathroom',
            name: 'Bathroom',
            zoneType: 'Bathroom',
            dimensions: '2.4m × 3.0m',
            areaSqM: 7,
            scannedDate: '2026-09-03',
            color: '#a9d8ea',
            obstaclesCount: 3,
            obstaclesList: 'Curved Corner Shower, Toilet Fixture, Vanity Washbasin',
            obstacles: [
              { x: 0.4, z: -0.8, w: 0.9, d: 0.9, label: 'Curved Corner Shower' },
              { x: -0.6, z: 0.0, w: 0.5, d: 0.6, label: 'Toilet Fixture' },
              { x: -0.6, z: 0.9, w: 0.6, d: 0.8, label: 'Vanity Washbasin' }
            ],
            notes: 'Ceramic tile floor with quadrant shower stall and water-resistant door seal.'
          },
          {
            id: 'room_home_hallway',
            name: 'Hallway',
            zoneType: 'Corridor / Hallway',
            dimensions: '2.2m × 4.5m',
            areaSqM: 10,
            scannedDate: '2026-09-03',
            color: '#caa986',
            obstaclesCount: 1,
            obstaclesList: 'Entry Credenza',
            obstacles: [
              { x: 0.0, z: 0.0, w: 0.4, d: 1.2, label: 'Entry Credenza' }
            ],
            notes: 'Central circulation corridor connecting entrance, bedroom, and living quarters.'
          },
          {
            id: 'room_home_bedroom',
            name: 'Bedroom',
            zoneType: 'Bedroom',
            dimensions: '4.2m × 4.5m',
            areaSqM: 19,
            scannedDate: '2026-09-04',
            color: '#fef08a',
            obstaclesCount: 3,
            obstaclesList: 'Double Bed, Nightstands, Wardrobe Storage',
            obstacles: [
              { x: 0.5, z: 0.2, w: 2.0, d: 2.2, label: 'Double Bed & Nightstands' },
              { x: -1.5, z: 0.8, w: 0.8, d: 1.8, label: 'Wardrobe Storage' }
            ],
            notes: 'Quiet sleeping zone with king bed suite, wardrobe closet, and window aperture.'
          }
        ]
      },
      {
        id: 'fac_college',
        name: 'College (Campus)',
        category: 'College (Campus)',
        icon: 'school',
        description: 'Academic robotics wing with research laboratories and seminar halls.',
        rooms: [
          {
            id: 'room_college_302',
            name: 'Robotics Lab 302',
            zoneType: 'Robotics Lab / Workshop',
            dimensions: '7.5m × 9.0m',
            areaSqM: 68,
            scannedDate: '2026-09-01',
            color: '#c7d2fe',
            obstaclesCount: 4,
            obstaclesList: 'Robotics Workstation, Soldering Bench',
            obstacles: [
              { x: -2.5, z: 2.5, w: 2.4, d: 1.2, label: 'Robotics Workstation' },
              { x: 2.2, z: -2.5, w: 2.0, d: 1.2, label: 'Soldering Bench' }
            ],
            notes: 'Houses automatic battery charging pads and heavy electronic test benches.'
          },
          {
            id: 'room_college_auditorium',
            name: 'Main Seminar Hall',
            zoneType: 'Custom Room',
            dimensions: '12.0m × 15.0m',
            areaSqM: 180,
            scannedDate: '2026-09-02',
            color: '#fed7aa',
            obstaclesCount: 3,
            obstaclesList: 'Stage Platform',
            obstacles: [
              { x: 0.0, z: -4.0, w: 4.5, d: 1.5, label: 'Stage Platform' }
            ],
            notes: 'Large open auditorium floor with tiered boundary.'
          }
        ]
      },
      {
        id: 'fac_industry',
        name: 'Industry (Warehouse Bay)',
        category: 'Industry (Warehouse Bay)',
        icon: 'factory',
        description: 'Industrial logistics hub with heavy pallet racks and forklift bays.',
        rooms: [
          {
            id: 'room_ind_bay4',
            name: 'Assembly Bay 4',
            zoneType: 'Warehouse Assembly Bay',
            dimensions: '14.0m × 16.0m',
            areaSqM: 224,
            scannedDate: '2026-09-03',
            color: '#bbf7d0',
            obstaclesCount: 4,
            obstaclesList: 'Pallet Rack North, Pallet Rack South',
            obstacles: [
              { x: -4.0, z: 0.0, w: 1.5, d: 5.0, label: 'Pallet Rack North' },
              { x: 4.0, z: 0.0, w: 1.5, d: 5.0, label: 'Pallet Rack South' }
            ],
            notes: 'High-traffic forklift corridor with yellow safety boundary striping.'
          }
        ]
      }
    ];
  }

  saveFacilitiesToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.facilities));
    } catch (e) {
      console.warn('Storage write error:', e);
    }
  }

  // --------------------------------------------------------------------------
  // VERTICAL SAVED LOCATIONS STACK RENDERER (CLICK TO OPEN MAP ON TOP & ROOMS BELOW)
  // --------------------------------------------------------------------------
  renderVerticalFacilitiesList() {
    const container = document.getElementById('slam-vertical-locations-container');
    const badge = document.getElementById('slam-total-facilities-badge');
    if (!container) return;

    if (badge) badge.innerText = `${this.facilities.length} Facilities Saved`;
    container.innerHTML = '';

    this.facilities.forEach(fac => {
      const isExpanded = this.expandedFacilityId === fac.id;
      const totalArea = fac.rooms.reduce((sum, r) => {
        const val = typeof r.areaSqM === 'number' ? r.areaSqM : parseFloat(r.areaSqM);
        return sum + (isNaN(val) ? 0 : val);
      }, 0);

      const card = document.createElement('div');
      card.id = `fac-vertical-card-${fac.id}`;
      card.className = `rounded-2xl transition-all duration-300 overflow-hidden shadow-sm ${
        isExpanded
          ? 'border-2 border-cyan-500 ring-2 ring-cyan-500/20 bg-white shadow-md'
          : 'border border-slate-200/80 bg-white hover:border-slate-300 hover:shadow-md'
      }`;

      // 1. TOP HEADER BAR OF VERTICAL CARD (ALWAYS VISIBLE)
      const headerRow = document.createElement('div');
      headerRow.className = 'p-5 flex flex-wrap items-center justify-between gap-4 cursor-pointer select-none';
      headerRow.innerHTML = `
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl flex items-center justify-center ${
            isExpanded ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30' : 'bg-slate-100 text-cyan-700'
          } transition-all">
            <span class="material-symbols-outlined text-2xl">${fac.icon || 'domain'}</span>
          </div>

          <div>
            <div class="flex items-center gap-2">
              <h3 class="text-base sm:text-lg font-bold font-['DM_Sans'] text-slate-900">${fac.name}</h3>
              <span class="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-slate-100 text-slate-700 border border-slate-200 font-bold">
                ${fac.category || 'Facility'}
              </span>
            </div>
            <p class="text-xs text-slate-500 font-mono mt-0.5">${fac.description}</p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div class="hidden sm:flex items-center gap-2 text-xs font-mono">
            <span class="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 font-bold">
              ${fac.rooms.length} Areas
            </span>
            <span class="px-2.5 py-1 rounded-lg ${totalArea > 0 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-slate-100 text-slate-600 border border-slate-200'} font-bold">
              ${totalArea > 0 ? `${totalArea.toFixed(1)} m² Total` : 'Pending Scan'}
            </span>
          </div>

          <button class="px-4 py-2 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 transition-all ${
            isExpanded
              ? 'bg-cyan-600 text-white shadow-sm'
              : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
          }">
            <span>${isExpanded ? 'Close Map' : 'Open Map & Rooms'}</span>
            <span class="material-symbols-outlined text-sm transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}">expand_more</span>
          </button>
        </div>
      `;

      headerRow.addEventListener('click', () => {
        this.expandedFacilityId = (this.expandedFacilityId === fac.id) ? null : fac.id;
        this.renderVerticalFacilitiesList();
      });

      card.appendChild(headerRow);

      // 2. EXPANDABLE DETAILS BODY: MAP ON TOP + ROOMS DETAILS BELOW
      if (isExpanded) {
        const detailsBody = document.createElement('div');
        detailsBody.className = 'px-5 pb-6 pt-2 space-y-6 border-t border-slate-100 anim-slide-down';

        // 2A. TOP PART: EMPTY MAP AREA (RESERVED FOR LIVE HARDWARE MAPPING)
        const mapContainer = document.createElement('div');
        mapContainer.className = 'bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-3';
        
        mapContainer.innerHTML = `
          <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
            <div>
              <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-amber-50 text-amber-700 border border-amber-200 font-bold flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                  EMPTY MAP AREA (STANDBY)
                </span>
                <span class="text-xs text-slate-500 font-mono">Location: ${fac.name}</span>
              </div>
              <h4 class="text-base font-bold font-['DM_Sans'] text-slate-900 mt-0.5">
                ${fac.name} - Map Space (Empty)
              </h4>
            </div>

            <div class="flex items-center gap-2">
              <span class="px-2.5 py-1 rounded-lg text-xs font-mono text-slate-600 bg-slate-100 border border-slate-200">
                Awaiting Hardware SLAM Scan
              </span>
            </div>
          </div>

          <div id="fac-map-viewport-${fac.id}" class="w-full">
            <!-- Clean Empty Map Space container rendered below -->
          </div>
        `;

        detailsBody.appendChild(mapContainer);

        // 2B. BOTTOM PART: ROOM DETAILS LIST
        const roomsSection = document.createElement('div');
        roomsSection.className = 'space-y-3';
        roomsSection.innerHTML = `
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-bold font-['DM_Sans'] text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <span class="material-symbols-outlined text-cyan-600 text-base">meeting_room</span>
              <span>REGISTERED AREAS & ROOMS (${fac.rooms.length})</span>
            </h4>
            <span class="text-xs font-mono text-slate-500">Click inspect to view in 3D studio</span>
          </div>

          <div id="fac-rooms-grid-${fac.id}" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            <!-- Room cards rendered below -->
          </div>
        `;

        detailsBody.appendChild(roomsSection);
        card.appendChild(detailsBody);

        // Render the empty map area and room cards
        setTimeout(() => {
          this.renderSpecificFacilityMap(fac);
          this.renderSpecificFacilityRoomCards(fac);
        }, 10);
      }

      container.appendChild(card);
    });
  }

  // --------------------------------------------------------------------------
  // RENDER EMPTY MAP SPACE FOR SPECIFIC FACILITY (CLEAN EMPTY AREA)
  // --------------------------------------------------------------------------
  renderSpecificFacilityMap(fac) {
    const mapViewport = document.getElementById(`fac-map-viewport-${fac.id}`);
    if (!mapViewport) return;

    // Clean Empty Map Space placeholder
    mapViewport.innerHTML = `
      <div class="relative w-full bg-slate-50/70 rounded-xl border-2 border-dashed border-slate-300 hover:border-cyan-400/80 transition-colors overflow-hidden p-6 sm:p-8 flex flex-col items-center justify-center min-h-[300px] sm:min-h-[340px] text-center select-none">
        
        <!-- Subtle drafting CAD grid in background -->
        <svg class="absolute inset-0 w-full h-full opacity-20 pointer-events-none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="empty-map-dots-${fac.id}" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="12" cy="12" r="1" fill="#64748b" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#empty-map-dots-${fac.id})" />
          
          <!-- Crosshair -->
          <line x1="50%" y1="20" x2="50%" y2="calc(100% - 20)" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4 4"/>
          <line x1="20" y1="50%" x2="calc(100% - 20)" y2="50%" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4 4"/>
        </svg>

        <!-- Centered Empty State Content -->
        <div class="relative z-10 max-w-md space-y-3 px-4">
          <div class="w-14 h-14 mx-auto rounded-2xl bg-white border border-slate-200 text-cyan-600 flex items-center justify-center shadow-sm">
            <span class="material-symbols-outlined text-3xl">crop_free</span>
          </div>

          <div>
            <h5 class="text-base font-bold font-['DM_Sans'] text-slate-800 flex items-center justify-center gap-2">
              <span>Empty Map Area</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-200 text-slate-700 font-semibold">EMPTY</span>
            </h5>
            <p class="text-xs text-slate-500 font-mono mt-1.5 leading-relaxed">
              Yeh jagah <span class="text-slate-800 font-bold">${fac.name}</span> ke SLAM map ke liye reserved empty space hai. Jab hardware connect hoga aur AGV scan karegi, tab yahan actual map live generate ho jayega.
            </p>
          </div>

          <!-- Standby Badges -->
          <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
            <span class="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold bg-white text-slate-600 border border-slate-200 shadow-sm">
              AREA: EMPTY SPACE
            </span>
            <span class="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold bg-amber-50 text-amber-700 border border-amber-200 shadow-sm flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
              STANDBY · NO MAP DATA YET
            </span>
            <span class="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold bg-white text-cyan-700 border border-slate-200 shadow-sm">
              HARDWARE: READY TO RECEIVE
            </span>
          </div>
        </div>

      </div>
    `;
  }

  // --------------------------------------------------------------------------
  // RENDER SMALL ROOM CARDS
  // --------------------------------------------------------------------------
  renderSpecificFacilityRoomCards(fac) {
    const grid = document.getElementById(`fac-rooms-grid-${fac.id}`);
    if (!grid) return;
    grid.innerHTML = '';

    fac.rooms.forEach(room => {
      const isPending = !room.areaSqM || room.areaSqM === '--' || room.dimensions === 'Pending Hardware Scan';
      const card = document.createElement('div');
      card.id = `room-item-card-${room.id}`;
      card.className = 'border border-slate-200 hover:border-cyan-500/70 bg-white rounded-xl p-4 shadow-sm transition-all space-y-3 flex flex-col justify-between hover-lift';

      card.innerHTML = `
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${isPending ? 'bg-amber-100/80 text-amber-900 border border-amber-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}">
              ${room.dimensions}
            </span>
            <span class="text-[10px] font-mono text-slate-400">${room.scannedDate}</span>
          </div>

          <h5 class="text-sm font-bold text-slate-900 font-['DM_Sans']">${room.name}</h5>
          ${room.notes ? `<p class="text-xs text-slate-500 font-mono leading-relaxed line-clamp-2">${room.notes}</p>` : ''}
        </div>

        <div class="space-y-2.5 pt-2 border-t border-slate-100 text-xs font-mono">
          <div class="flex items-center justify-between">
            <span class="text-slate-500">Floor Area:</span>
            <span class="${isPending ? 'text-slate-400' : 'text-emerald-700'} font-bold">
              ${(typeof room.areaSqM === 'number' && room.areaSqM > 0) ? `${room.areaSqM} m²` : 'Pending Scan'}
            </span>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-slate-500">Obstacles:</span>
            <span class="text-slate-800 font-bold truncate max-w-[130px] text-right" title="${room.obstaclesList || ''}">
              ${(typeof room.obstaclesCount === 'number' && room.obstaclesCount > 0) ? `${room.obstaclesCount} Items` : 'Pending Scan'}
            </span>
          </div>

          <div class="flex items-center gap-2 pt-1">
            <button class="btn-inspect-studio flex-1 py-1.5 px-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono font-bold transition-all flex items-center justify-center gap-1 shadow-sm cursor-pointer hover-lift">
              <span class="material-symbols-outlined text-xs">open_in_browser</span>
              <span>Inspect in 3D</span>
            </button>

            <button class="btn-del-room p-1.5 rounded-lg bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer shadow-sm" title="Delete Room">
              <span class="material-symbols-outlined text-sm">delete</span>
            </button>
          </div>
        </div>
      `;

      card.querySelector('.btn-inspect-studio').addEventListener('click', () => {
        this.loadRoomIntoStudio(fac, room);
      });

      card.querySelector('.btn-del-room').addEventListener('click', () => {
        if (confirm(`Delete room "${room.name}" from ${fac.name}?`)) {
          fac.rooms = fac.rooms.filter(r => r.id !== room.id);
          this.saveFacilitiesToStorage();
          this.renderVerticalFacilitiesList();
          this.showToast('Room removed from memory.');
        }
      });

      grid.appendChild(card);
    });
  }

  loadRoomIntoStudio(fac, room) {
    this.currentActiveRoom = room;

    this.gridCtx.fillStyle = '#0a0f1d';
    this.gridCtx.fillRect(0, 0, this.gridSize, this.gridSize);
    this.gridData.fill(0);
    this.pathPoints = [];
    this.pathLine.geometry.setFromPoints([]);

    while (this.obstaclesGroup.children.length > 0) {
      this.obstaclesGroup.remove(this.obstaclesGroup.children[0]);
    }

    if (room.obstacles && room.obstacles.length > 0) {
      room.obstacles.forEach(obs => {
        const geo = new THREE.BoxGeometry(obs.w, 1.2, obs.d);
        const mat = new THREE.MeshStandardMaterial({
          color: 0x0284c7,
          roughness: 0.4,
          metalness: 0.2
        });
        const m = new THREE.Mesh(geo, mat);
        m.position.set(obs.x, 0.6, obs.z);
        this.obstaclesGroup.add(m);

        const wire = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0x38bdf8 })
        );
        wire.position.copy(m.position);
        this.obstaclesGroup.add(wire);
      });

      // Seed free space
      this.gridCtx.fillStyle = '#e2e8f0';
      this.gridCtx.fillRect(40, 40, 160, 160);

      // Seed walls in black
      this.gridCtx.fillStyle = '#000000';
      this.gridCtx.fillRect(38, 38, 164, 4);
      this.gridCtx.fillRect(38, 198, 164, 4);
      this.gridCtx.fillRect(38, 38, 4, 164);
      this.gridCtx.fillRect(198, 38, 4, 164);

      room.obstacles.forEach(obs => {
        const ox = Math.round(120 + obs.x * 20);
        const oz = Math.round(120 + obs.z * 20);
        const ow = Math.round(obs.w * 20);
        const od = Math.round(obs.d * 20);
        this.gridCtx.fillRect(ox - ow / 2, oz - od / 2, ow, od);
      });
    } else {
      this.drawStandbyGridOverlay();
    }

    this.gridTexture.needsUpdate = true;

    const titleEl = document.getElementById('slam-active-room-title');
    if (titleEl) titleEl.innerText = `${fac.name} ➔ ${room.name}`;

    const areaEl = document.getElementById('slam-room-area-val');
    if (areaEl) areaEl.innerText = `${room.areaSqM} m²`;

    this.canvasContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.showToast(`Loaded "${room.name}" into 3D SLAM Studio!`);
  }

  // --------------------------------------------------------------------------
  // UI BUTTON EVENTS & HARDWARE BRIDGE
  // --------------------------------------------------------------------------
  initUI() {
    const viewModeBtn = document.getElementById('slam-btn-viewmode');
    if (viewModeBtn) {
      viewModeBtn.addEventListener('click', () => {
        this.is2DMode = !this.is2DMode;
        if (this.is2DMode) {
          this.currentCamera = this.orthoCamera;
          this.orthoCamera.position.set(0, 25, 0);
          this.orthoCamera.up.set(0, 0, -1);
          this.orthoCamera.lookAt(0, 0, 0);
          this.controls.enabled = false;
          viewModeBtn.innerHTML = '<span class="material-symbols-outlined text-sm text-cyan-600">view_in_ar</span><span>Switch to 3D View</span>';
          this.showToast('Switched to RViz 2D Top-Down Ortho View');
        } else {
          this.currentCamera = this.camera;
          this.camera.position.set(0, 14, 12);
          this.controls.enabled = true;
          this.controls.target.set(0, 0, 0);
          this.controls.update();
          viewModeBtn.innerHTML = '<span class="material-symbols-outlined text-sm text-cyan-600">crop_free</span><span>Switch to 2D RViz Ortho</span>';
          this.showToast('Switched to 3D Isometric View');
        }
      });
    }

    const scanBtn = document.getElementById('slam-btn-scan');
    if (scanBtn) {
      scanBtn.addEventListener('click', () => {
        this.isScanning = !this.isScanning;
        scanBtn.innerHTML = this.isScanning
          ? '<span class="material-symbols-outlined text-sm">pause</span><span>Pause Live Scan</span>'
          : '<span class="material-symbols-outlined text-sm">play_arrow</span><span>Start Live Scan</span>';
        scanBtn.className = this.isScanning
          ? 'px-4 py-1.5 rounded-xl text-xs font-mono font-bold bg-amber-500 hover:bg-amber-400 text-white flex items-center gap-1.5 shadow-md transition-all cursor-pointer'
          : 'px-4 py-1.5 rounded-xl text-xs font-mono font-bold bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-1.5 shadow-md transition-all cursor-pointer';

        const hwBadge = document.getElementById('slam-hw-badge');
        if (hwBadge) {
          if (this.isScanning) {
            hwBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span><span>LIVE SLAM SCAN ACTIVE</span>';
            hwBadge.className = 'px-3 py-1.5 rounded-full text-xs font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 flex items-center gap-2 shadow-sm';
          } else {
            hwBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-cyan-600"></span><span>HARDWARE READY · STANDBY</span>';
            hwBadge.className = 'px-3 py-1.5 rounded-full text-xs font-mono font-bold bg-cyan-50 text-cyan-800 border border-cyan-200 flex items-center gap-2 shadow-sm';
          }
        }
      });
    }

    const resetBtn = document.getElementById('slam-btn-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.camera.position.set(0, 14, 12);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
      });
    }

    const btnPointA = document.getElementById('slam-btn-set-point-a');
    if (btnPointA) {
      btnPointA.addEventListener('click', () => {
        this.setPickingMode(this.pickingMode === 'A' ? null : 'A');
      });
    }

    const btnPointB = document.getElementById('slam-btn-set-point-b');
    if (btnPointB) {
      btnPointB.addEventListener('click', () => {
        this.setPickingMode(this.pickingMode === 'B' ? null : 'B');
      });
    }

    const btnResetPts = document.getElementById('slam-btn-reset-points');
    if (btnResetPts) {
      btnResetPts.addEventListener('click', () => this.resetWaypoints());
    }

    const hwConnectBtn = document.getElementById('slam-btn-hw-connect');
    if (hwConnectBtn) {
      hwConnectBtn.addEventListener('click', () => {
        const url = prompt('Enter ESP32 / Raspberry Pi ToF WebSocket IP:', this.wsUrl);
        if (url) {
          this.wsUrl = url;
          this.connectWebSocket();
        }
      });
    }

    const mContainer = document.getElementById('slam-8x8-matrix-container');
    if (mContainer) {
      mContainer.innerHTML = '';
      for (let i = 0; i < 64; i++) {
        const d = document.createElement('div');
        d.className = 'w-full aspect-square rounded flex items-center justify-center text-[9px] font-mono font-bold select-none shadow-sm';
        d.innerText = '300';
        mContainer.appendChild(d);
      }
    }
  }

  connectWebSocket() {
    const badge = document.getElementById('slam-hw-badge');
    if (badge) {
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span> Connecting ToF...';
    }

    try {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => {
        this.isHardwareConnected = true;
        if (badge) {
          badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span> AGV HARDWARE ONLINE';
          badge.className = 'px-3 py-1.5 rounded-full text-xs font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 flex items-center gap-2 shadow-sm';
        }
        this.showToast('Hardware connected! Live ToF feed active.');
      };
      this.ws.onclose = () => {
        this.isHardwareConnected = false;
        if (badge) {
          badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-cyan-600"></span> HARDWARE READY · STANDBY';
          badge.className = 'px-3 py-1.5 rounded-full text-xs font-mono font-bold bg-cyan-50 text-cyan-800 border border-cyan-200 flex items-center gap-2 shadow-sm';
        }
      };
    } catch (e) {
      console.log('WS offline');
    }
  }

  updateMatrixDOM(minD, avgD) {
    const gridEl = document.getElementById('slam-8x8-matrix-container');
    if (!gridEl) return;

    for (let i = 0; i < 64; i++) {
      const d = this.matrix64[i];
      const cell = gridEl.children[i];
      if (cell) {
        let bg = 'rgba(6, 182, 212, 0.15)';
        let textCol = '#0891b2';
        if (d < 350) {
          bg = '#ef4444';
          textCol = '#ffffff';
        } else if (d < 700) {
          bg = '#f59e0b';
          textCol = '#ffffff';
        } else if (d < 1200) {
          bg = '#10b981';
          textCol = '#ffffff';
        }
        cell.style.background = bg;
        cell.style.color = textCol;
        cell.innerText = `${Math.round(d / 10)}`;
      }
    }

    const minEl = document.getElementById('slam-stat-min-val');
    const avgEl = document.getElementById('slam-stat-avg-val');
    if (minEl) minEl.innerText = `${Math.round(minD / 10)} cm`;
    if (avgEl) avgEl.innerText = `${Math.round(avgD / 10)} cm`;
  }

  showToast(msg) {
    const toast = document.getElementById('slam-toast-msg');
    const text = document.getElementById('slam-toast-text');
    if (!toast) return;
    if (text) text.innerText = msg;
    toast.classList.remove('opacity-0', 'pointer-events-none');
    toast.classList.add('opacity-100');
    setTimeout(() => {
      toast.classList.remove('opacity-100');
      toast.classList.add('opacity-0', 'pointer-events-none');
    }, 2800);
  }

  animate() {
    requestAnimationFrame(this.animate);
    this.updateSLAM();
    if (this.controls && !this.is2DMode) {
      this.controls.update();
    }
    if (this.renderer && this.scene && this.currentCamera) {
      this.renderer.render(this.scene, this.currentCamera);
    }
  }
}

// Auto instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  new SlamStudioApp();
  window.adminStudio = new AdminStudioManager();
});
