/**
 * High-Tech ToF Laser Mapping & 2D Occupancy Grid Canvas Renderer
 */

export class MapRenderer {
  constructor(canvasElement, pathfindingSim) {
    this.canvas = canvasElement;
    this.sim = pathfindingSim;
    this.scanAngle = 0;
    this.clickMode = 'obstacle'; // 'obstacle', 'start', 'dest'
    this.tofPointClouds = []; // simulated laser hit points

    if (!this.canvas) {
      this.ctx = null;
      return;
    }
    this.ctx = this.canvas.getContext('2d');
    this.init();
  }

  init() {
    this.resize();
    window.addEventListener('resize', this.resize.bind(this));

    // Interactive canvas click & touch
    this.canvas.addEventListener('click', this.handleClick.bind(this));
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0]) {
        this.handleClick(e.touches[0]);
      }
    }, { passive: true });
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  setClickMode(mode) {
    this.clickMode = mode;
  }

  handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const cellW = this.width / this.sim.cols;
    const cellH = this.height / this.sim.rows;

    const gridX = Math.floor(clickX / cellW);
    const gridY = Math.floor(clickY / cellH);

    if (this.clickMode === 'start') {
      this.sim.setWaypoint('start', gridX, gridY);
    } else if (this.clickMode === 'dest') {
      this.sim.setWaypoint('dest', gridX, gridY);
    } else {
      this.sim.toggleObstacle(gridX, gridY);
    }
  }

  render(delta) {
    if (!this.ctx) return;
    this.scanAngle += delta * 2.8;

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cols = this.sim.cols;
    const rows = this.sim.rows;
    const cellW = w / cols;
    const cellH = h / rows;

    // 1. Clear background with cybernetic glass gradient
    const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.5, 30, w * 0.5, h * 0.5, Math.max(w, h));
    bgGrad.addColorStop(0, '#0a1426');
    bgGrad.addColorStop(0.65, '#070e1b');
    bgGrad.addColorStop(1, '#040810');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. Draw Sleek Glass Grid Lines
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cellW, 0);
      ctx.lineTo(c * cellW, h);
      ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * cellH);
      ctx.lineTo(w, r * cellH);
      ctx.stroke();
    }

    // 3. Draw Obstacles / Warehouse Racks (Frosted Glass Aesthetic)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (this.sim.grid[r][c] === 1) {
          const isOuterWall =
            r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
          
          if (isOuterWall) {
            ctx.fillStyle = 'rgba(17, 24, 39, 0.85)';
            ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
            ctx.strokeRect(c * cellW, r * cellH, cellW, cellH);
          } else {
            // Dynamic Glass Obstacle
            ctx.fillStyle = 'rgba(255, 59, 92, 0.28)';
            ctx.fillRect(c * cellW + 1, r * cellH + 1, cellW - 2, cellH - 2);
            ctx.strokeStyle = '#ff3366';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(c * cellW + 1, r * cellH + 1, cellW - 2, cellH - 2);

            // Inner glass highlight
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.fillRect(c * cellW + 2, r * cellH + 2, cellW - 4, 2);

            // Cross hatch
            ctx.beginPath();
            ctx.moveTo(c * cellW + 3, r * cellH + 3);
            ctx.lineTo((c + 1) * cellW - 3, (r + 1) * cellH - 3);
            ctx.strokeStyle = 'rgba(255, 59, 92, 0.45)';
            ctx.stroke();
          }
        }
      }
    }

    // 4. Draw Planned Path (Glowing Dashed Line)
    if (this.sim.path.length > 1) {
      ctx.beginPath();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 10;

      this.sim.path.forEach((pt, idx) => {
        const px = (pt.x + 0.5) * cellW;
        const py = (pt.y + 0.5) * cellH;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      // Draw Path Waypoint Dots
      this.sim.path.forEach((pt) => {
        const px = (pt.x + 0.5) * cellW;
        const py = (pt.y + 0.5) * cellH;
        ctx.fillStyle = '#00f0ff';
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // 5. Draw Start & Destination Markers
    const startPx = (this.sim.start.x + 0.5) * cellW;
    const startPy = (this.sim.start.y + 0.5) * cellH;
    ctx.fillStyle = '#00ff9d';
    ctx.beginPath();
    ctx.arc(startPx, startPy, cellW * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 9px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('S', startPx, startPy);

    const destPx = (this.sim.destination.x + 0.5) * cellW;
    const destPy = (this.sim.destination.y + 0.5) * cellH;
    ctx.fillStyle = '#ffb800';
    ctx.beginPath();
    ctx.arc(destPx, destPy, cellW * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.fillText('D', destPx, destPy);

    // 6. Draw AGV Robot Position & ToF Sweep Beam
    const rx = (this.sim.robotPos.x + 0.5) * cellW;
    const ry = (this.sim.robotPos.y + 0.5) * cellH;

    // ToF Radar Sweep Cone
    const sweepRange = cellW * 5;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.arc(rx, ry, sweepRange, this.scanAngle, this.scanAngle + 0.6);
    ctx.closePath();
    const grad = ctx.createRadialGradient(rx, ry, 0, rx, ry, sweepRange);
    grad.addColorStop(0, 'rgba(0, 240, 255, 0.4)');
    grad.addColorStop(1, 'rgba(0, 240, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // Robot Body
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(this.sim.robotHeading);

    // Chassis Box
    ctx.fillStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;
    ctx.fillRect(-cellW * 0.4, -cellH * 0.3, cellW * 0.8, cellH * 0.6);
    ctx.shadowBlur = 0;

    // Heading Arrow
    ctx.fillStyle = '#05070b';
    ctx.beginPath();
    ctx.moveTo(cellW * 0.35, 0);
    ctx.lineTo(-cellW * 0.2, -cellH * 0.2);
    ctx.lineTo(-cellW * 0.2, cellH * 0.2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // 7. Mini 8x8 ToF Distance Heatmap Overlay on top-left of canvas
    this.renderToFMatrixOverlay(ctx, 12, 12, 64, 64);
  }

  renderToFMatrixOverlay(ctx, x, y, size, sizeH) {
    ctx.save();
    ctx.fillStyle = 'rgba(10, 18, 34, 0.72)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, size + 16, sizeH + 26);
    ctx.strokeRect(x, y, size + 16, sizeH + 26);

    // Glass top edge highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(x + 1, y + 1, size + 14, 1);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '8px JetBrains Mono';
    ctx.textAlign = 'left';
    ctx.fillText('VL53L5CX 8x8', x + 6, y + 10);

    const cellSize = size / 8;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        // Simulated distance intensity
        const val = Math.sin(Date.now() * 0.003 + r * 0.5 + c * 0.5) * 0.5 + 0.5;
        const colorVal = Math.floor(val * 255);
        ctx.fillStyle = `rgb(0, ${colorVal}, ${255 - colorVal})`;
        ctx.fillRect(x + 8 + c * cellSize, y + 14 + r * cellSize, cellSize - 1, cellSize - 1);
      }
    }
    ctx.restore();
  }
}
