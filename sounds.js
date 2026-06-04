// ============================================================
// Saydaliyati · Sound effects
//   Generated via Web Audio API — no audio files to ship.
//   Browsers block audio until user interacts with the page,
//   so we lazily create / resume the AudioContext on first
//   click or keypress.
// ============================================================

const SOUNDS_MUTE_KEY = "saydaliyati_sounds_muted";

let _audioCtx = null;
let _muted = localStorage.getItem(SOUNDS_MUTE_KEY) === "1";

function _getCtx() {
  if (_muted) return null;
  if (!_audioCtx) {
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return null;
    }
  }
  if (_audioCtx.state === "suspended") {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

// One audible tone with attack + exponential decay.
function _tone(freq, duration, { type = "sine", volume = 0.15, delay = 0 } = {}) {
  const ctx = _getCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.value = freq;

  const start = ctx.currentTime + delay;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.start(start);
  osc.stop(start + duration);
}

// Soft 2-tone "tink" — quick, friendly, doesn't startle.
function playChatSound() {
  _tone(880, 0.10, { volume: 0.12, delay: 0 });     // A5
  _tone(1175, 0.14, { volume: 0.10, delay: 0.06 }); // D6
}

// 3-tone ascending chime — more attention-grabbing for status changes / new orders.
function playNotificationSound() {
  _tone(523, 0.14, { volume: 0.14, delay: 0 });     // C5
  _tone(659, 0.14, { volume: 0.13, delay: 0.10 });  // E5
  _tone(784, 0.28, { volume: 0.14, delay: 0.20 });  // G5
}

// Mute toggle (call from a settings UI later if needed).
function setSoundsMuted(muted) {
  _muted = !!muted;
  localStorage.setItem(SOUNDS_MUTE_KEY, _muted ? "1" : "0");
}
function areSoundsMuted() { return _muted; }

// Unlock AudioContext on first user interaction (browser autoplay policies).
(function () {
  if (typeof document === "undefined") return;
  const unlock = () => {
    _getCtx();
    document.removeEventListener("click", unlock);
    document.removeEventListener("keydown", unlock);
    document.removeEventListener("touchstart", unlock);
  };
  document.addEventListener("click", unlock, { once: true });
  document.addEventListener("keydown", unlock, { once: true });
  document.addEventListener("touchstart", unlock, { once: true });
})();
