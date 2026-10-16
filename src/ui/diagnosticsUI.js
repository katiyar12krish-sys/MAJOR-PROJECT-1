/**
 * 6-Motor Drivetrain & Diagnostics UI Telemetry Manager
 */

export class DiagnosticsUIManager {
  constructor() {
    this.motors = [
      { id: 'M1', name: 'Front-Left', rpm: 0, current: 0.4, temp: 32, load: 15, dir: 'FWD', status: 'OK' },
      { id: 'M2', name: 'Front-Right', rpm: 0, current: 0.4, temp: 32, load: 15, dir: 'FWD', status: 'OK' },
      { id: 'M3', name: 'Mid-Left', rpm: 0, current: 0.5, temp: 34, load: 18, dir: 'FWD', status: 'OK' },
      { id: 'M4', name: 'Mid-Right', rpm: 0, current: 0.5, temp: 34, load: 18, dir: 'FWD', status: 'OK' },
      { id: 'M5', name: 'Rear-Left', rpm: 0, current: 0.4, temp: 33, load: 14, dir: 'FWD', status: 'OK' },
      { id: 'M6', name: 'Rear-Right', rpm: 0, current: 0.4, temp: 33, load: 14, dir: 'FWD', status: 'OK' },
    ];

    this.battery = {
      soc: 94,
      voltage: 25.4,
      currentDraw: 2.8,
      temp: 29,
    };

    this.logMessages = [
      { time: '00:00:01', tag: 'BOOT', text: 'PCA9685 I2C 16-Ch PWM Driver initialized.' },
      { time: '00:00:02', tag: 'IMU', text: 'MPU6050 6-Axis DMP calibration complete.' },
      { time: '00:00:03', tag: 'TOF', text: 'VL53L5CX 8x8 multizone matrix online (60Hz).' },
      { time: '00:00:04', tag: 'SYS', text: '6-Motor H-Bridge Drivetrain in STANDBY mode.' },
    ];
  }

  addLog(tag, text) {
    const d = new Date();
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    this.logMessages.unshift({ time, tag, text });
    if (this.logMessages.length > 20) this.logMessages.pop();
    this.renderLogStream();
  }

  updateMotors(isMoving, speed, isOverloaded = false, headingTurn = 0) {
    const baseRPM = isMoving ? Math.round(speed * 75) : 0;
    const baseCurrent = isMoving ? 1.4 : 0.3;
    const loadMultiplier = isOverloaded ? 2.2 : 1.0;

    this.motors.forEach((m) => {
      let turnFactor = 1.0;
      if (headingTurn !== 0) {
        if (m.name.includes('Left')) turnFactor = 1.0 - headingTurn * 0.4;
        if (m.name.includes('Right')) turnFactor = 1.0 + headingTurn * 0.4;
      }

      m.rpm = Math.max(0, Math.round(baseRPM * turnFactor + (Math.random() * 4 - 2)));
      m.current = Number((baseCurrent * loadMultiplier + (m.rpm / 300) * 1.8 + Math.random() * 0.1).toFixed(2));
      m.load = Math.min(100, Math.round((m.current / 4.5) * 100));
      m.temp = Math.min(85, Math.round(32 + (m.load / 100) * 28));

      if (isOverloaded || m.load > 85) {
        m.status = 'WARN';
      } else {
        m.status = 'OK';
      }
    });

    const totalAmps = this.motors.reduce((sum, m) => sum + m.current, 0) + 0.8;
    this.battery.currentDraw = Number(totalAmps.toFixed(1));
    this.battery.voltage = Number((25.6 - (totalAmps * 0.08)).toFixed(2));
    if (isMoving) {
      this.battery.soc = Math.max(1, Number((this.battery.soc - 0.003).toFixed(2)));
    }
  }

  renderMotorCards(container) {
    if (!container) return;

    container.innerHTML = this.motors.map((m) => {
      const isWarn = m.status === 'WARN';
      const statusBadge = isWarn
        ? `<span class="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold bg-red-100 text-red-700 border border-red-200">HIGH LOAD</span>`
        : `<span class="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">OK</span>`;

      return `
        <div class="p-3.5 rounded-2xl bg-white border ${isWarn ? 'border-red-300' : 'border-slate-200'} transition-all shadow-sm hover:shadow-md">
          <div class="flex items-center justify-between mb-2.5">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full ${isWarn ? 'bg-red-500 animate-ping' : 'bg-emerald-500'}"></span>
              <span class="text-xs font-mono font-bold text-slate-800">${m.id}: ${m.name}</span>
            </div>
            ${statusBadge}
          </div>

          <div class="grid grid-cols-3 gap-1.5 text-center text-xs font-mono mb-2.5">
            <div class="bg-indigo-50 p-1.5 rounded-lg border border-indigo-100">
              <div class="text-slate-400 text-[9px]">RPM</div>
              <div class="text-sm font-bold text-indigo-700">${m.rpm}</div>
            </div>
            <div class="bg-orange-50 p-1.5 rounded-lg border border-orange-100">
              <div class="text-slate-400 text-[9px]">AMP</div>
              <div class="text-sm font-bold text-orange-600">${m.current}A</div>
            </div>
            <div class="bg-slate-50 p-1.5 rounded-lg border border-slate-200">
              <div class="text-slate-400 text-[9px]">TEMP</div>
              <div class="text-sm font-bold ${m.temp > 55 ? 'text-red-600' : 'text-slate-700'}">${m.temp}°C</div>
            </div>
          </div>

          <div>
            <div class="flex justify-between text-[10px] font-mono text-slate-400 mb-1">
              <span>Torque Load</span>
              <span class="${m.load > 80 ? 'text-red-600 font-bold' : 'text-slate-600 font-semibold'}">${m.load}%</span>
            </div>
            <div class="w-full bg-indigo-50 rounded-full h-2 overflow-hidden border border-indigo-100">
              <div class="h-full rounded-full transition-all duration-300 ${m.load > 80 ? 'bg-red-500' : 'bg-gradient-to-r from-indigo-500 to-cyan-500'}" style="width:${m.load}%"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  renderLogStream() {
    const logContainer = document.getElementById('diagnostics-log-stream');
    if (!logContainer) return;

    logContainer.innerHTML = this.logMessages.map((log) => `
      <div class="flex items-start gap-2 text-xs font-mono py-1 border-b border-slate-100">
        <span class="text-slate-400 text-[11px]">${log.time}</span>
        <span class="px-1.5 py-0.5 rounded-lg text-[9px] font-bold ${
          log.tag === 'WARN' || log.tag === 'ALARM'
            ? 'bg-red-100 text-red-700 border border-red-200'
            : log.tag === 'TOF' || log.tag === 'NAV'
            ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
            : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
        }">[${log.tag}]</span>
        <span class="text-slate-600 flex-1 leading-tight">${log.text}</span>
      </div>
    `).join('');
  }
}
