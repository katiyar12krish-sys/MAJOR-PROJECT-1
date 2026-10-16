import { sound } from '../audio/soundFX.js';
import confetti from 'canvas-confetti';

export function setupEventHandlers(pathfindingSim, mapRenderer, imuSim, diagnosticsUI) {
  // 1. Audio Mute/Unmute Toggle
  const audioToggleBtn = document.getElementById('btn-audio-toggle');
  const audioIcon = document.getElementById('icon-audio');
  if (audioToggleBtn) {
    audioToggleBtn.addEventListener('click', () => {
      const enabled = sound.toggleAudio();
      if (audioIcon) {
        audioIcon.innerText = enabled ? 'volume_up' : 'volume_off';
      }
      audioToggleBtn.classList.toggle('border-cyan-400', enabled);
      audioToggleBtn.classList.toggle('text-cyan-400', enabled);
      if (enabled) sound.playClick();
    });
  }

  // Mobile Menu Drawer Toggle
  const btnMobileMenu = document.getElementById('btn-mobile-menu');
  const mobileNavDrawer = document.getElementById('mobile-nav-drawer');
  if (btnMobileMenu && mobileNavDrawer) {
    btnMobileMenu.addEventListener('click', () => {
      mobileNavDrawer.classList.toggle('hidden');
      sound.playClick();
    });

    const mobileLinks = document.querySelectorAll('.mobile-nav-link');
    mobileLinks.forEach((link) => {
      link.addEventListener('click', () => {
        mobileNavDrawer.classList.add('hidden');
      });
    });
  }

  // 2. Weight & CoG Bias Sliders
  const sliderWeight = document.getElementById('slider-weight');
  const valWeight = document.getElementById('val-weight');
  const sliderCog = document.getElementById('slider-cog');
  const valCog = document.getElementById('val-cog');

  if (sliderWeight) {
    sliderWeight.addEventListener('input', (e) => {
      const weight = Number(e.target.value);
      if (valWeight) valWeight.innerText = `${weight} kg`;
      imuSim.setWeight(weight);
      diagnosticsUI.addLog('LOAD', `Payload adjusted to ${weight} kg.`);
    });
  }

  if (sliderCog) {
    sliderCog.addEventListener('input', (e) => {
      const offset = Number(e.target.value) / 100; // -1 to 1
      if (valCog) {
        valCog.innerText = offset === 0 ? 'Centered' : offset < 0 ? `${Math.abs(Math.round(offset * 100))}% Left` : `${Math.round(offset * 100)}% Right`;
      }
      imuSim.setCoGOffset(offset, 0);
    });
  }

  // 3. Mission Control Buttons
  const btnStartMission = document.getElementById('btn-start-mission');
  const btnPauseMission = document.getElementById('btn-pause-mission');
  const btnResetMission = document.getElementById('btn-reset-mission');
  const btnSpawnObstacle = document.getElementById('btn-spawn-obstacle');
  const btnClearObstacles = document.getElementById('btn-clear-obstacles');

  if (btnStartMission) {
    btnStartMission.addEventListener('click', () => {
      pathfindingSim.startMission();
      sound.playSonarPulse();
      diagnosticsUI.addLog('NAV', 'Mission Started: A* Trajectory active.');
    });
  }

  if (btnPauseMission) {
    btnPauseMission.addEventListener('click', () => {
      pathfindingSim.pauseMission();
      const isPaused = pathfindingSim.state === 'PAUSED';
      btnPauseMission.innerText = isPaused ? 'Resume Mission' : 'Pause';
      sound.playClick();
      diagnosticsUI.addLog('NAV', isPaused ? 'Mission Paused.' : 'Mission Resumed.');
    });
  }

  if (btnResetMission) {
    btnResetMission.addEventListener('click', () => {
      pathfindingSim.resetMission();
      sound.playClick();
      diagnosticsUI.addLog('SYS', 'AGV returned to Docking Origin.');
    });
  }

  if (btnSpawnObstacle) {
    btnSpawnObstacle.addEventListener('click', () => {
      const obstacle = pathfindingSim.spawnRandomObstacle();
      if (obstacle) {
        sound.playObstacleAlert();
        diagnosticsUI.addLog('ALARM', `Dynamic obstacle at [X:${obstacle.x}, Y:${obstacle.y}]! Recalculating path...`);
      }
    });
  }

  if (btnClearObstacles) {
    btnClearObstacles.addEventListener('click', () => {
      pathfindingSim.clearDynamicObstacles();
      sound.playClick();
      diagnosticsUI.addLog('SYS', 'Grid map reset to default.');
    });
  }

  // 4. Interactive Map Mode Selector Buttons
  const mapModeButtons = document.querySelectorAll('[data-map-mode]');
  mapModeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-map-mode');
      mapRenderer.setClickMode(mode);
      sound.playClick();

      mapModeButtons.forEach((b) => {
        b.classList.remove('bg-cyan-400', 'text-slate-950', 'font-bold');
        b.classList.add('bg-white/5', 'text-gray-300');
      });
      btn.classList.add('bg-cyan-400', 'text-slate-950', 'font-bold');
      btn.classList.remove('bg-white/5', 'text-gray-300');
    });
  });

  // 5. Emergency E-STOP
  const btnEstop = document.getElementById('btn-estop');
  if (btnEstop) {
    btnEstop.addEventListener('click', () => {
      pathfindingSim.state = 'PAUSED';
      sound.startOverloadAlarm();
      diagnosticsUI.addLog('EMERGENCY', 'E-STOP ACTIVATED! Motors locked.');
    });
  }

  // 6. Subscribe to Mission Complete
  pathfindingSim.subscribe((sim, event) => {
    if (event === 'MISSION_COMPLETE') {
      sound.playMissionComplete();
      diagnosticsUI.addLog('NAV', 'Mission Completed: Cargo package delivered.');
      confetti({
        particleCount: 70,
        spread: 60,
        origin: { y: 0.6 },
        colors: ['#00E5FF', '#10B981', '#F59E0B'],
      });
    }
  });
}
