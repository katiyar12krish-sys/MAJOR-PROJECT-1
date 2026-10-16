/**
 * Procedural Web Audio API Sound Synthesizer (Silenced)
 * All beep sounds, oscillator tones, and auditory alarms have been removed/disabled.
 */

class SoundFX {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.isSirenPlaying = false;
  }

  init() {
    // Sound disabled
  }

  toggleAudio(state) {
    this.enabled = false;
    return false;
  }

  playBootSound() {
    // Beep sound removed
  }

  playClick() {
    // Click beep removed
  }

  playSonarPulse() {
    // Sonar pulse beep removed
  }

  playObstacleAlert() {
    // Obstacle alert beep removed
  }

  playMissionComplete() {
    // Mission complete beep removed
  }

  startOverloadAlarm() {
    // Alarm siren beep removed
  }

  stopOverloadAlarm() {
    this.isSirenPlaying = false;
  }
}

export const sound = new SoundFX();
