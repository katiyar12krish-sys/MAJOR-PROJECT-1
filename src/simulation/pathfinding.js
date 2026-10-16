/**
 * A* Pathfinding Algorithm & Autonomous Cargo AGV Mission State Machine
 */

export class PathfindingSimulator {
  constructor(gridCols = 20, gridRows = 20) {
    this.cols = gridCols;
    this.rows = gridRows;
    this.grid = []; // 0 = empty, 1 = obstacle
    this.start = { x: 2, y: 17 };
    this.destination = { x: 17, y: 2 };
    this.robotPos = { x: 2, y: 17 };
    this.robotHeading = 0; // radians
    this.path = []; // array of {x, y}
    this.currentWaypointIndex = 0;
    this.state = 'IDLE'; // IDLE, RUNNING, PAUSED, COMPLETED, REROUTING
    this.subState = 'PICKUP'; // PICKUP, TRANSIT, DROPOFF, RETURN
    this.speed = 2.5; // units per second
    this.totalDistance = 0;
    this.traversedDistance = 0;
    this.startTime = 0;
    this.etaSeconds = 0;
    this.subscribers = [];

    this.initGrid();
  }

  initGrid() {
    this.grid = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        // Create default warehouse layout with shelving racks
        const isWall =
          r === 0 || r === this.rows - 1 || c === 0 || c === this.cols - 1;
        const isRack1 = (r >= 4 && r <= 7) && (c >= 4 && c <= 8);
        const isRack2 = (r >= 4 && r <= 7) && (c >= 12 && c <= 16);
        const isRack3 = (r >= 11 && r <= 14) && (c >= 4 && c <= 8);
        const isRack4 = (r >= 11 && r <= 14) && (c >= 12 && c <= 16);

        if (isWall || isRack1 || isRack2 || isRack3 || isRack4) {
          row.push(1);
        } else {
          row.push(0);
        }
      }
      this.grid.push(row);
    }

    // Ensure start & dest are open
    this.grid[this.start.y][this.start.x] = 0;
    this.grid[this.destination.y][this.destination.x] = 0;
    this.calculatePath();
  }

  setWaypoint(type, x, y) {
    if (x < 1 || x >= this.cols - 1 || y < 1 || y >= this.rows - 1) return;
    if (this.grid[y][x] === 1) return; // Blocked

    if (type === 'start') {
      this.start = { x, y };
      this.robotPos = { x, y };
    } else {
      this.destination = { x, y };
    }
    this.calculatePath();
    this.notify();
  }

  toggleObstacle(x, y) {
    if (x < 1 || x >= this.cols - 1 || y < 1 || y >= this.rows - 1) return;
    // Don't block start or destination
    if ((x === this.start.x && y === this.start.y) || (x === this.destination.x && y === this.destination.y)) return;

    this.grid[y][x] = this.grid[y][x] === 1 ? 0 : 1;
    this.calculatePath();
    this.notify();
  }

  spawnRandomObstacle() {
    // Pick a point along the current remaining path or adjacent to it
    const candidateNodes = this.path.slice(this.currentWaypointIndex + 1);
    let chosen = null;

    if (candidateNodes.length > 0) {
      const idx = Math.floor(Math.random() * candidateNodes.length);
      chosen = candidateNodes[idx];
    } else {
      // Pick random empty space
      for (let i = 0; i < 50; i++) {
        const rx = Math.floor(Math.random() * (this.cols - 2)) + 1;
        const ry = Math.floor(Math.random() * (this.rows - 2)) + 1;
        if (
          this.grid[ry][rx] === 0 &&
          !(rx === this.start.x && ry === this.start.y) &&
          !(rx === this.destination.x && ry === this.destination.y)
        ) {
          chosen = { x: rx, y: ry };
          break;
        }
      }
    }

    if (chosen) {
      this.grid[chosen.y][chosen.x] = 1;
      this.state = 'REROUTING';
      this.calculatePath();
      this.notify();
      return chosen;
    }
    return null;
  }

  clearDynamicObstacles() {
    this.initGrid();
    this.notify();
  }

  // A* Algorithm implementation
  calculatePath() {
    const startNode = {
      x: Math.round(this.robotPos.x),
      y: Math.round(this.robotPos.y),
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    };
    const target = this.subState === 'RETURN' ? this.start : this.destination;
    const endNode = { x: target.x, y: target.y };

    const openList = [startNode];
    const closedList = new Set();
    const nodeKey = (n) => `${n.x},${n.y}`;

    let foundPath = false;
    let finalNode = null;

    const directions = [
      { x: 0, y: -1 }, // North
      { x: 1, y: 0 },  // East
      { x: 0, y: 1 },  // South
      { x: -1, y: 0 }, // West
      { x: 1, y: -1 }, // Diagonal NE
      { x: 1, y: 1 },  // Diagonal SE
      { x: -1, y: 1 }, // Diagonal SW
      { x: -1, y: -1 } // Diagonal NW
    ];

    while (openList.length > 0) {
      // Find lowest f cost
      let lowestIdx = 0;
      for (let i = 1; i < openList.length; i++) {
        if (openList[i].f < openList[lowestIdx].f) {
          lowestIdx = i;
        }
      }

      const current = openList.splice(lowestIdx, 1)[0];
      closedList.add(nodeKey(current));

      // Reached target
      if (current.x === endNode.x && current.y === endNode.y) {
        foundPath = true;
        finalNode = current;
        break;
      }

      // Check neighbors
      for (const dir of directions) {
        const nx = current.x + dir.x;
        const ny = current.y + dir.y;

        if (nx < 0 || nx >= this.cols || ny < 0 || ny >= this.rows) continue;
        if (this.grid[ny][nx] === 1) continue; // Wall/Obstacle

        // Diagonal corner cutting check
        if (dir.x !== 0 && dir.y !== 0) {
          if (this.grid[current.y][nx] === 1 || this.grid[ny][current.x] === 1) {
            continue; // Prevent cutting through solid corners
          }
        }

        const neighborKey = `${nx},${ny}`;
        if (closedList.has(neighborKey)) continue;

        const moveCost = (dir.x !== 0 && dir.y !== 0) ? 1.414 : 1.0;
        const gScore = current.g + moveCost;
        const hScore = Math.hypot(nx - endNode.x, ny - endNode.y); // Euclidean heuristic
        const fScore = gScore + hScore;

        const existingOpen = openList.find((n) => n.x === nx && n.y === ny);
        if (existingOpen) {
          if (gScore < existingOpen.g) {
            existingOpen.g = gScore;
            existingOpen.f = fScore;
            existingOpen.parent = current;
          }
        } else {
          openList.push({
            x: nx,
            y: ny,
            g: gScore,
            h: hScore,
            f: fScore,
            parent: current,
          });
        }
      }
    }

    if (foundPath && finalNode) {
      const generatedPath = [];
      let curr = finalNode;
      while (curr) {
        generatedPath.unshift({ x: curr.x, y: curr.y });
        curr = curr.parent;
      }
      this.path = generatedPath;
      this.currentWaypointIndex = 0;
      this.calculateMetrics();
    } else {
      this.path = [];
      this.etaSeconds = 0;
    }
  }

  calculateMetrics() {
    let dist = 0;
    for (let i = 0; i < this.path.length - 1; i++) {
      dist += Math.hypot(
        this.path[i + 1].x - this.path[i].x,
        this.path[i + 1].y - this.path[i].y
      );
    }
    this.totalDistance = dist;
    this.etaSeconds = this.speed > 0 ? Math.round(dist / this.speed) : 0;
  }

  startMission() {
    this.state = 'RUNNING';
    this.subState = 'TRANSIT';
    this.calculatePath();
    this.startTime = Date.now();
    this.notify();
  }

  pauseMission() {
    this.state = this.state === 'RUNNING' ? 'PAUSED' : 'RUNNING';
    this.notify();
  }

  resetMission() {
    this.state = 'IDLE';
    this.subState = 'PICKUP';
    this.robotPos = { x: this.start.x, y: this.start.y };
    this.currentWaypointIndex = 0;
    this.traversedDistance = 0;
    this.calculatePath();
    this.notify();
  }

  update(delta) {
    if (this.state !== 'RUNNING') return;
    if (this.path.length === 0 || this.currentWaypointIndex >= this.path.length) {
      // Completed current leg
      if (this.subState === 'TRANSIT') {
        // Reached destination, now return
        this.subState = 'RETURN';
        this.calculatePath();
        return;
      } else if (this.subState === 'RETURN') {
        this.state = 'COMPLETED';
        this.notify('MISSION_COMPLETE');
        return;
      }
    }

    const targetWaypoint = this.path[this.currentWaypointIndex];
    if (!targetWaypoint) return;

    const dx = targetWaypoint.x - this.robotPos.x;
    const dy = targetWaypoint.y - this.robotPos.y;
    const dist = Math.hypot(dx, dy);

    this.robotHeading = Math.atan2(dy, dx);

    const step = this.speed * delta;
    if (dist <= step) {
      this.robotPos.x = targetWaypoint.x;
      this.robotPos.y = targetWaypoint.y;
      this.currentWaypointIndex++;
      this.traversedDistance += dist;
    } else {
      this.robotPos.x += (dx / dist) * step;
      this.robotPos.y += (dy / dist) * step;
      this.traversedDistance += step;
    }

    this.notify();
  }

  subscribe(callback) {
    this.subscribers.push(callback);
  }

  notify(event = null) {
    this.subscribers.forEach((cb) => cb(this, event));
  }
}
