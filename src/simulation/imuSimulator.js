import { sound } from '../audio/soundFX.js';

/**
 * MPU6050 6-Axis IMU & 6-Zone Payload Deck Weight Distribution Simulator
 */

export class IMUSimulator {
  constructor() {
    this.pitch = 0; // degrees (-45 to 45)
    this.roll = 0;  // degrees (-45 to 45)
    this.yaw = 0;   // degrees
    this.accelX = 0; // g
    this.accelY = 0; // g
    this.accelZ = 1.0; // 1g gravity

    this.totalWeightKg = 180; // 0 to 500 kg
    this.cogOffsetX = 0; // -1 (left bias) to +1 (right bias)
    this.cogOffsetY = 0; // -1 (rear bias) to +1 (front bias)

    this.isOverloaded = false;
    this.isImbalanced = false;
    this.alarmActive = false;

    this.zoneLoads = {
      FL: 30, FR: 30,
      ML: 30, MR: 30,
      RL: 30, RR: 30
    };

    this.subscribers = [];
  }

  setWeight(weightKg) {
    this.totalWeightKg = Math.max(0, Math.min(500, weightKg));
    this.recalculate();
  }

  setCoGOffset(offsetX, offsetY = 0) {
    this.cogOffsetX = Math.max(-1, Math.min(1, offsetX));
    this.cogOffsetY = Math.max(-1, Math.min(1, offsetY));
    this.recalculate();
  }

  recalculate() {
    const base = this.totalWeightKg / 6;
    
    // Front vs Rear factor
    const frontFactor = 1 + this.cogOffsetY * 0.5;
    const rearFactor = 1 - this.cogOffsetY * 0.5;

    // Left vs Right factor
    const leftFactor = 1 - this.cogOffsetX * 0.5;
    const rightFactor = 1 + this.cogOffsetX * 0.5;

    this.zoneLoads.FL = Number((base * frontFactor * leftFactor).toFixed(1));
    this.zoneLoads.FR = Number((base * frontFactor * rightFactor).toFixed(1));
    this.zoneLoads.ML = Number((base * leftFactor).toFixed(1));
    this.zoneLoads.MR = Number((base * rightFactor).toFixed(1));
    this.zoneLoads.RL = Number((base * rearFactor * leftFactor).toFixed(1));
    this.zoneLoads.RR = Number((base * rearFactor * rightFactor).toFixed(1));

    // Check thresholds: Max recommended total = 350kg, max per-zone = 75kg
    const maxZone = Math.max(...Object.values(this.zoneLoads));
    this.isOverloaded = this.totalWeightKg > 350 || maxZone > 75;
    this.isImbalanced = Math.abs(this.cogOffsetX) > 0.45 || Math.abs(this.cogOffsetY) > 0.45;

    if (this.isOverloaded || this.isImbalanced) {
      if (!this.alarmActive) {
        this.alarmActive = true;
        sound.startOverloadAlarm();
      }
    } else {
      if (this.alarmActive) {
        this.alarmActive = false;
        sound.stopOverloadAlarm();
      }
    }

    this.notify();
  }

  update(delta, robotMoving = false, speed = 0) {
    // Dynamic IMU noise & acceleration tilt
    const time = Date.now() * 0.003;
    const noisePitch = (Math.sin(time * 1.5) * 0.4);
    const noiseRoll = (Math.cos(time * 1.8) * 0.4);

    const accelPitch = robotMoving ? (speed * 2.2) : 0;
    const loadPitch = this.cogOffsetY * 4.0;
    const loadRoll = this.cogOffsetX * 4.5;

    this.pitch = Number((loadPitch + accelPitch + noisePitch).toFixed(2));
    this.roll = Number((loadRoll + noiseRoll).toFixed(2));
    this.yaw = (this.yaw + (robotMoving ? speed * 15 * delta : 0)) % 360;

    this.accelX = Number(((this.roll / 45) * 0.5).toFixed(3));
    this.accelY = Number(((this.pitch / 45) * 0.5 + (robotMoving ? 0.2 : 0)).toFixed(3));
    this.accelZ = Number((0.98 + (robotMoving ? Math.sin(time * 8) * 0.04 : 0)).toFixed(3));

    this.notify();
  }

  renderArtificialHorizon(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    // Artificial horizon circle clip
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, cx - 4, 0, Math.PI * 2);
    ctx.clip();

    // Sky & Ground
    ctx.fillStyle = '#0f172a'; // Sky
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((this.roll * Math.PI) / 180);
    const pitchOffset = (this.pitch / 45) * (h / 3);
    ctx.translate(0, pitchOffset);

    // Ground
    ctx.fillStyle = 'rgba(0, 240, 255, 0.15)';
    ctx.fillRect(-w, 0, w * 2, h);

    // Horizon line
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.lineTo(w, 0);
    ctx.stroke();

    // Pitch ladder lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    [-20, -10, 10, 20].forEach((p) => {
      const py = -(p / 45) * (h / 3);
      ctx.beginPath();
      ctx.moveTo(-15, py);
      ctx.lineTo(15, py);
      ctx.stroke();
    });

    ctx.restore();

    // Center crosshair (Fixed aircraft symbol)
    ctx.strokeStyle = '#ffb800';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy);
    ctx.lineTo(cx - 6, cy);
    ctx.moveTo(cx + 6, cy);
    ctx.lineTo(cx + 20, cy);
    ctx.moveTo(cx, cy - 4);
    ctx.lineTo(cx, cy + 4);
    ctx.stroke();

    ctx.restore();

    // Outer Ring
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, cx - 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  subscribe(callback) {
    this.subscribers.push(callback);
  }

  notify() {
    this.subscribers.forEach((cb) => cb(this));
  }
}
