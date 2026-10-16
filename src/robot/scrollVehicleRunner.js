/**
 * ScrollVehicleRunner - Interactive Scroll-Driven AGV Truck with Spinning Wheels & Dynamic Tire Dust
 */
import { sound } from '../audio/soundFX.js';

export class ScrollVehicleRunner {
  constructor() {
    this.container = null;
    this.truckEl = null;
    this.canvasDust = null;
    this.ctxDust = null;
    this.hudEl = null;

    this.scrollY = window.scrollY;
    this.targetScrollY = window.scrollY;
    this.scrollVelocity = 0;
    this.lastScrollY = window.scrollY;
    this.lastTime = performance.now();

    this.wheelRotation = 0;
    this.chassisTilt = 0;
    this.currentDirection = 1; // 1 = forward (right), -1 = backward (left)
    this.truckX = -250; // starts off-screen
    this.targetTruckX = 50;
    this.truckY = 0;
    this.targetTruckY = 0;
    this.isDocked = false;
    this.hasEntered = false;
    this.isEnabled = true;

    // Dust & smoke particles
    this.particles = [];
    this.maxParticles = 80;

    // Wheel offsets relative to truck width/height (in %)
    this.wheelNodes = [];

    this.init();
  }

  init() {
    this.createDOMElements();
    const truckImg = document.getElementById('scroll-truck-img');
    if (truckImg) {
      truckImg.src = '/intramove_side_agv_transparent.png';
      truckImg.classList.remove('opacity-0');
      truckImg.classList.add('opacity-100');
    }
    this.bindEvents();
    this.triggerEntranceAnimation();

    // Start requestAnimationFrame physics & particle loop
    requestAnimationFrame(this.renderLoop.bind(this));
  }

  createDOMElements() {
    // 1. Fixed Screen Canvas for Dust Particles
    const dustCanvas = document.createElement('canvas');
    dustCanvas.id = 'scroll-dust-canvas';
    dustCanvas.className = 'fixed inset-0 pointer-events-none z-40';
    dustCanvas.style.width = '100vw';
    dustCanvas.style.height = '100vh';
    document.body.appendChild(dustCanvas);
    this.canvasDust = dustCanvas;
    this.ctxDust = dustCanvas.getContext('2d');
    this.resizeCanvas();

    // 2. Fixed Floating Container for the INTRAMOVE Supercar
    const runnerContainer = document.createElement('div');
    runnerContainer.id = 'scroll-runner-stage';
    runnerContainer.className = 'fixed bottom-6 left-0 w-full pointer-events-none z-50 transition-opacity duration-300';
    
    runnerContainer.innerHTML = `
      <!-- Moving AGV Unit -->
      <div id="scroll-truck-unit" class="absolute bottom-1 sm:bottom-2 left-0 pointer-events-auto cursor-pointer select-none group" style="transform: translate3d(-300px, 0px, 0);">
        
        <!-- Speech / Status Milestone Bubble -->
        <div id="truck-status-bubble" class="absolute -top-9 sm:-top-11 left-1/2 -translate-x-1/2 bg-white/95 border border-cyan-500/80 px-3 py-1 rounded-full font-mono text-[9px] sm:text-[11px] text-slate-800 whitespace-nowrap shadow-xl backdrop-blur-md flex items-center gap-1.5 transition-all duration-300 pointer-events-none">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span id="truck-status-text">INTRAMOVE 6X // SCROLL TO DRIVE</span>
        </div>

        <!-- AGV Visual Assembly -->
        <div id="truck-body-wrapper" class="relative w-52 sm:w-72 md:w-84 h-24 sm:h-32 md:h-36 transition-transform duration-100 ease-out">
          
          <!-- Front Headlight Volumetric Beam Cone -->
          <div id="truck-headlight-beam" class="absolute top-[48%] -left-20 sm:-left-32 w-28 sm:w-44 h-12 sm:h-18 bg-gradient-to-l from-amber-300/35 via-amber-100/15 to-transparent pointer-events-none rounded-l-full blur-sm" style="clip-path: polygon(100% 40%, 0% 0%, 0% 100%, 100% 60%);"></div>

          <!-- Ground Contact Shadow & Subtle Underglow -->
          <div class="absolute -bottom-2 left-4 sm:left-6 right-4 sm:right-6 h-5 sm:h-6 bg-cyan-500/15 rounded-full blur-md"></div>
          <div class="absolute -bottom-1 left-3 sm:left-4 right-3 sm:right-4 h-3 sm:h-4 bg-slate-900/20 rounded-full blur-sm"></div>

          <!-- Stylized INTRAMOVE 6X Side AGV Cutout -->
          <img 
            id="scroll-truck-img"
            src="/intramove_side_agv_transparent.png" 
            alt="INTRAMOVE 6X Autonomous AGV" 
            class="w-full h-full object-contain pointer-events-none transition-opacity duration-300 drop-shadow-[0_10px_20px_rgba(15,23,42,0.25)]"
          />

          <!-- 3 Dynamic Rotating Wheel Hubs overlaid on the 3 wheels -->
          <div class="scroll-wheel-overlay absolute bottom-[4%] right-[11%] w-[21%] aspect-square rounded-full border border-cyan-500/50 bg-slate-800/40 flex items-center justify-center shadow-lg overflow-hidden">
            <div class="w-1.5 h-1.5 rounded-full bg-cyan-400"></div>
          </div>
          <div class="scroll-wheel-overlay absolute bottom-[4%] left-[43%] w-[21%] aspect-square rounded-full border border-cyan-500/50 bg-slate-800/40 flex items-center justify-center shadow-lg overflow-hidden">
            <div class="w-1.5 h-1.5 rounded-full bg-cyan-400"></div>
          </div>
          <div class="scroll-wheel-overlay absolute bottom-[4%] left-[16%] w-[21%] aspect-square rounded-full border border-cyan-500/50 bg-slate-800/40 flex items-center justify-center shadow-lg overflow-hidden">
            <div class="w-1.5 h-1.5 rounded-full bg-cyan-400"></div>
          </div>

          <!-- Roof Beacon Flashing LEDs -->
          <div class="absolute top-[8%] left-[24%] w-2 h-2 rounded-full bg-red-500 shadow-[0_0_10px_#ef4444] animate-ping"></div>
          <div class="absolute top-[8%] left-[18%] w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981] animate-pulse"></div>

        </div>

      </div>

      <!-- Quick Escort Floating HUD Pill (Bottom-Right) -->
      <div id="escort-hud-pill" class="absolute bottom-1.5 sm:bottom-2 right-2 sm:right-4 bg-white/90 backdrop-blur-md border border-slate-200 px-3 sm:px-4 py-1.5 sm:py-2 rounded-2xl text-[10px] sm:text-[11px] font-mono text-slate-700 flex items-center gap-2 sm:gap-3 pointer-events-auto shadow-lg">
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span class="text-slate-900 font-bold hidden xs:inline">INTRAMOVE 6X</span>
        </div>
        <div class="text-cyan-600 font-bold" id="hud-speed-val">0.0 KM/H</div>
        <div class="h-3 w-px bg-slate-300"></div>
        <button id="btn-honk-truck" class="text-cyan-600 hover:text-cyan-700 font-bold flex items-center gap-1 transition-colors" title="Sound Horn">
          <span class="material-symbols-outlined text-xs">volume_up</span>
          <span>HORN</span>
        </button>
      </div>
    `;

    document.body.appendChild(runnerContainer);
    this.container = runnerContainer;
    this.truckEl = document.getElementById('scroll-truck-unit');
    this.hudEl = document.getElementById('hud-speed-val');
    this.wheelNodes = Array.from(document.querySelectorAll('.scroll-wheel-overlay'));
  }

  resizeCanvas() {
    if (!this.canvasDust) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvasDust.width = window.innerWidth * dpr;
    this.canvasDust.height = window.innerHeight * dpr;
    this.ctxDust.scale(dpr, dpr);
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.resizeCanvas();
    });

    window.addEventListener('scroll', () => {
      this.targetScrollY = window.scrollY;
    }, { passive: true });

    // Click truck to honk / jump bounce
    if (this.truckEl) {
      this.truckEl.addEventListener('click', () => {
        this.triggerHonkBounce();
      });
    }

    // Honk button on HUD
    const btnHonk = document.getElementById('btn-honk-truck');
    if (btnHonk) {
      btnHonk.addEventListener('click', (e) => {
        e.stopPropagation();
        this.triggerHonkBounce();
      });
    }
  }

  triggerEntranceAnimation() {
    // Initial entrance driving in from left onto screen
    let start = performance.now();
    const duration = 1800; // ms

    const animateEntry = (time) => {
      const elapsed = time - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);

      this.truckX = -250 + ease * 330; // lands at x: 80px
      this.wheelRotation += 12 * (1 - ease * 0.7);

      // Emit initial drive-in tire dust puffs
      if (progress < 0.95 && Math.random() > 0.3) {
        this.emitTireDust(this.truckX + 40, window.innerHeight - 30, 2);
        this.emitTireDust(this.truckX + 110, window.innerHeight - 30, 2);
        this.emitTireDust(this.truckX + 180, window.innerHeight - 30, 2);
      }

      if (progress < 1) {
        requestAnimationFrame(animateEntry);
      } else {
        this.hasEntered = true;
        sound.playBootSound();
        this.updateStatusText('READY // SCROLL DOWN TO EXPLORE');
      }
    };

    requestAnimationFrame(animateEntry);
  }

  triggerHonkBounce() {
    this.updateStatusText('⚡ 6-WHEEL DRIVE READY');

    // Burst of dust & sparks from all 6 wheels
    const rect = this.truckEl.getBoundingClientRect();
    for (let i = 0; i < 24; i++) {
      this.emitTireDust(rect.left + 50 + Math.random() * 120, rect.bottom - 10, 4);
    }

    // Suspension Jump Bounce
    const wrapper = document.getElementById('truck-body-wrapper');
    if (wrapper) {
      wrapper.style.transform = 'translateY(-22px) scale(1.05)';
      setTimeout(() => {
        wrapper.style.transform = 'translateY(0px) scale(1)';
      }, 250);
    }
  }

  updateStatusText(text) {
    const el = document.getElementById('truck-status-text');
    if (el) el.innerText = text;
  }

  emitTireDust(x, y, count = 1) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) {
        this.particles.shift();
      }

      const isReverse = this.currentDirection < 0;
      const angle = isReverse ? (Math.random() * 0.6 - 0.3) : (Math.PI + Math.random() * 0.6 - 0.3);
      const speed = 1.5 + Math.random() * 3.5;

      this.particles.push({
        x: x + (Math.random() * 20 - 10),
        y: y + (Math.random() * 10 - 5),
        vx: Math.cos(angle) * speed + (isReverse ? 1 : -1) * (Math.abs(this.scrollVelocity) * 0.3),
        vy: -0.5 - Math.random() * 2.0,
        radius: 4 + Math.random() * 8,
        maxRadius: 22 + Math.random() * 18,
        alpha: 0.65 + Math.random() * 0.3,
        color: Math.random() > 0.4 ? 'rgba(0, 229, 255,' : 'rgba(210, 180, 140,', // blend cyan cyber dust & sand dust
        life: 0,
        maxLife: 40 + Math.random() * 30,
      });
    }
  }

  renderLoop(currentTime) {
    requestAnimationFrame(this.renderLoop.bind(this));

    const delta = Math.min((currentTime - this.lastTime) / 1000, 0.1);
    this.lastTime = currentTime;

    // 1. Calculate Scroll Delta & Velocity
    const scrollDelta = this.targetScrollY - this.scrollY;
    this.scrollY += scrollDelta * 0.12; // smooth lerp
    this.scrollVelocity = (this.scrollY - this.lastScrollY) / (delta * 1000);
    this.lastScrollY = this.scrollY;

    const docHeight = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const scrollProgress = Math.min(1, Math.max(0, this.scrollY / docHeight));
    const isScrolling = Math.abs(this.scrollVelocity) > 0.05;

    // 2. Multi-Section Driving Track Journey
    // Map scroll progress across the screen:
    // When scrolling, the truck drives across the screen from Left -> Right in each section,
    // and loops across smoothly as you scroll down through all sections!
    if (this.hasEntered) {
      const screenW = window.innerWidth;
      const truckWidth = 260;

      // Calculate path segments across 4 sections:
      // Segment count = 4
      const segmentProgress = (scrollProgress * 4) % 1;
      const currentSectionIdx = Math.floor(scrollProgress * 4);

      // Alternating driving lanes / directions:
      // Even sections: Drive Left -> Right
      // Odd sections: Drive Right -> Left
      const isEvenSection = currentSectionIdx % 2 === 0;

      let targetX;
      if (isEvenSection) {
        this.currentDirection = 1;
        targetX = -100 + segmentProgress * (screenW + 200 - truckWidth);
      } else {
        this.currentDirection = -1;
        targetX = screenW - segmentProgress * (screenW + 200 - truckWidth);
      }

      // Smooth lerp to target X
      this.truckX += (targetX - this.truckX) * 0.15;

      // Rotate Wheels proportional to movement
      const moveDistance = Math.abs(scrollDelta) * 0.8;
      this.wheelRotation += (scrollDelta > 0 ? 1 : -1) * moveDistance;

      // Suspension Tilt on acceleration/braking
      const targetTilt = Math.min(4, Math.max(-4, this.scrollVelocity * 1.5));
      this.chassisTilt += (targetTilt - this.chassisTilt) * 0.1;

      // Update Section Milestone Badges
      if (scrollProgress < 0.15) {
        this.updateStatusText('INTRAMOVE // HYPER-SERIES 01 ACTIVE');
      } else if (scrollProgress < 0.4) {
        this.updateStatusText('PERCEPTION // 64-ZONE ToF LASER SCAN');
      } else if (scrollProgress < 0.65) {
        this.updateStatusText('NAVIGATION // AUTONOMOUS A* TRAJECTORY');
      } else if (scrollProgress < 0.88) {
        this.updateStatusText('CHASSIS // 50:50 MPU6050 BALANCE');
      } else {
        this.updateStatusText('DESTINATION REACHED // 100% SUCCESS');
      }
    }

    // 3. Emit Tire Dust when Moving
    if (isScrolling && this.hasEntered) {
      const speedMagnitude = Math.abs(this.scrollVelocity);
      const dustRate = Math.min(5, Math.ceil(speedMagnitude * 3));
      
      const rect = this.truckEl.getBoundingClientRect();
      const wheelY = window.innerHeight - 25;

      // Emit behind the 3 wheels
      if (this.currentDirection > 0) {
        // Driving Right: dust flies to the left (rear)
        this.emitTireDust(rect.left + 45, wheelY, dustRate);
        this.emitTireDust(rect.left + 115, wheelY, Math.ceil(dustRate * 0.6));
      } else {
        // Driving Left: dust flies to the right (rear)
        this.emitTireDust(rect.right - 45, wheelY, dustRate);
        this.emitTireDust(rect.right - 115, wheelY, Math.ceil(dustRate * 0.6));
      }
    }

    // 4. Update Truck DOM Transform
    if (this.truckEl) {
      const flipScale = this.currentDirection < 0 ? -1 : 1;
      const bobY = isScrolling ? Math.sin(currentTime * 0.02) * 3 : Math.sin(currentTime * 0.003) * 2;

      this.truckEl.style.transform = `translate3d(${this.truckX}px, ${bobY}px, 0)`;

      const wrapper = document.getElementById('truck-body-wrapper');
      if (wrapper) {
        wrapper.style.transform = `scaleX(${flipScale}) rotate(${this.chassisTilt * flipScale}deg)`;
      }

      // Rotate Wheel Overlays
      this.wheelNodes.forEach((wheel) => {
        wheel.style.transform = `rotate(${this.wheelRotation}deg)`;
      });
    }

    // 5. Update HUD Speed Readout
    if (this.hudEl) {
      const speedKmH = isScrolling ? (Math.abs(this.scrollVelocity) * 18.5).toFixed(1) : '0.0';
      this.hudEl.innerText = `${speedKmH} KM/H`;
    }

    // 6. Draw Dust Particles on 2D Canvas
    this.renderDustParticles(delta);
  }

  renderDustParticles(delta) {
    if (!this.ctxDust) return;
    const ctx = this.ctxDust;
    const w = window.innerWidth;
    const h = window.innerHeight;

    ctx.clearRect(0, 0, w, h);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy *= 0.96; // air resistance
      p.vx *= 0.94;
      p.vy -= 0.02; // slight thermal updraft

      const progress = p.life / p.maxLife;
      const currentRadius = p.radius + (p.maxRadius - p.radius) * progress;
      const currentAlpha = Math.max(0, p.alpha * (1 - progress));

      // Draw soft expanding dust particle puff
      ctx.beginPath();
      ctx.arc(p.x, p.y, currentRadius, 0, Math.PI * 2);
      ctx.fillStyle = `${p.color} ${currentAlpha})`;
      ctx.fill();

      // Remove expired particles
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
      }
    }
  }
}
