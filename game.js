(() => {
  const canvas = document.querySelector("#gameCanvas");
  const ctx = canvas.getContext("2d");
  const scoreNode = document.querySelector("#score");
  const bestNode = document.querySelector("#bestScore");
  const restartButton = document.querySelector("#restartButton");
  const startOverlay = document.querySelector("#startOverlay");
  const gameoverOverlay = document.querySelector("#gameoverOverlay");
  const startButton = document.querySelector("#startButton");
  const againButton = document.querySelector("#againButton");
  const finalScoreNode = document.querySelector("#finalScore");
  const chargeWrap = document.querySelector(".charge-wrap");
  const chargeBar = document.querySelector("#chargeBar");
  const tip = document.querySelector("#tip");

  const STORAGE_KEY = "light-jump-best-score";
  const MAX_HOLD = 1120;
  const MAX_JUMP_DISTANCE = 392;
  const JUMP_ARC = 152;
  const ISO_Y = 0.72;
  const SHADOW_SLOPE = 0.44;

  const blockThemes = [
    { top: "#58c6a8", left: "#2c967f", right: "#257b70", trim: "#dffaf0", motif: "petal", tone: 0 },
    { top: "#f4bc65", left: "#ce8440", right: "#a96936", trim: "#fff0bb", motif: "sun", tone: 1 },
    { top: "#74a8f2", left: "#4b78c7", right: "#3c63aa", trim: "#e7f1ff", motif: "wave", tone: 2 },
    { top: "#e98578", left: "#c85f56", right: "#a84d4b", trim: "#ffe0dc", motif: "spark", tone: 3 },
    { top: "#96cf72", left: "#68a94f", right: "#518c44", trim: "#edffd9", motif: "leaf", tone: 4 },
    { top: "#d598e4", left: "#a866bd", right: "#874fa2", trim: "#f8e6ff", motif: "rune", tone: 5 },
    { top: "#68d4d9", left: "#319da4", right: "#287e91", trim: "#d9fbff", motif: "orbit", tone: 6 },
    { top: "#f49bb0", left: "#c45d7a", right: "#9d4964", trim: "#ffe1ec", motif: "cross", tone: 7 },
  ];
  const blockShapes = ["cube", "cylinder", "prism", "disc"];

  let width = 0;
  let height = 0;
  let dpr = 1;
  let lastTime = performance.now();
  let bestScore = readBestScore();
  const audio = createAudioController();
  const haptics = createHapticsController();

  const game = {
    blocks: [],
    currentIndex: 0,
    nextIndex: 1,
    status: "ready",
    score: 0,
    combo: 0,
    centerBonus: 0,
    charge: 0,
    holdStart: 0,
    jump: null,
    fall: null,
    landImpact: null,
    particles: [],
    chargeParticleTimer: 0,
    tipTimer: 0,
    player: {
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
    },
    view: {
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      baseY: 0,
    },
  };

  bestNode.textContent = String(bestScore);

  function readBestScore() {
    try {
      return Number(localStorage.getItem(STORAGE_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  function writeBestScore(value) {
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Local files can disable storage in some browsers.
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function moveToward(value, target, step) {
    if (value < target) {
      return Math.min(target, value + step);
    }
    return Math.max(target, value - step);
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function getDifficulty() {
    return clamp(game.score / 95, 0, 1);
  }

  function createAudioController() {
    const AudioClass = window.AudioContext || window.webkitAudioContext;
    let audioContext = null;
    let chargeOsc = null;
    let chargeGain = null;
    let chargeFilter = null;
    let chargeLfo = null;
    let chargeLfoGain = null;

    function ensure() {
      if (!AudioClass) {
        return null;
      }
      if (!audioContext) {
        audioContext = new AudioClass();
      }
      if (audioContext.state === "suspended") {
        audioContext.resume();
      }
      return audioContext;
    }

    function makeEnvelope(startGain, peakGain, endGain, duration) {
      const context = ensure();
      if (!context) {
        return null;
      }
      const gain = context.createGain();
      const now = context.currentTime;
      gain.gain.setValueAtTime(startGain, now);
      gain.gain.linearRampToValueAtTime(peakGain, now + duration * 0.16);
      gain.gain.exponentialRampToValueAtTime(Math.max(endGain, 0.0001), now + duration);
      gain.connect(context.destination);
      return { context, gain, now };
    }

    function startCharge() {
      const context = ensure();
      if (!context || chargeOsc) {
        return;
      }
      chargeOsc = context.createOscillator();
      chargeGain = context.createGain();
      chargeFilter = context.createBiquadFilter();
      chargeLfo = context.createOscillator();
      chargeLfoGain = context.createGain();
      chargeOsc.type = "sine";
      chargeOsc.frequency.setValueAtTime(180, context.currentTime);
      chargeLfo.type = "sine";
      chargeLfo.frequency.setValueAtTime(8, context.currentTime);
      chargeLfoGain.gain.setValueAtTime(1.5, context.currentTime);
      chargeLfo.connect(chargeLfoGain);
      chargeLfoGain.connect(chargeOsc.frequency);
      chargeFilter.type = "lowpass";
      chargeFilter.frequency.setValueAtTime(1100, context.currentTime);
      chargeGain.gain.setValueAtTime(0.0001, context.currentTime);
      chargeGain.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.08);
      chargeOsc.connect(chargeFilter);
      chargeFilter.connect(chargeGain);
      chargeGain.connect(context.destination);
      chargeOsc.start();
      chargeLfo.start();
    }

    function updateCharge(power) {
      if (!audioContext || !chargeOsc || !chargeGain || !chargeFilter) {
        return;
      }
      const now = audioContext.currentTime;
      const frequency = 180 + power * 580;
      chargeOsc.frequency.setTargetAtTime(frequency, now, 0.03);
      chargeFilter.frequency.setTargetAtTime(900 + power * 1300, now, 0.04);
      chargeGain.gain.setTargetAtTime(0.035 + power * 0.06, now, 0.04);
      if (chargeLfo && chargeLfoGain) {
        chargeLfo.frequency.setTargetAtTime(7 + power * 7, now, 0.05);
        chargeLfoGain.gain.setTargetAtTime(1.5 + power * 9, now, 0.05);
      }
    }

    function stopCharge() {
      if (!audioContext || !chargeOsc || !chargeGain) {
        return;
      }
      const osc = chargeOsc;
      const gain = chargeGain;
      const lfo = chargeLfo;
      const now = audioContext.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0.0001, now, 0.035);
      osc.stop(now + 0.12);
      if (lfo) {
        lfo.stop(now + 0.12);
      }
      chargeOsc = null;
      chargeGain = null;
      chargeFilter = null;
      chargeLfo = null;
      chargeLfoGain = null;
    }

    function playJump(power) {
      stopCharge();
      const pack = makeEnvelope(0.0001, 0.13, 0.0001, 0.26 + power * 0.1);
      if (!pack) {
        return;
      }
      const { context, gain, now } = pack;
      const osc = context.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(220 + power * 520, now);
      osc.frequency.exponentialRampToValueAtTime(132 + power * 230, now + 0.22 + power * 0.14);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.34 + power * 0.12);

      const click = context.createOscillator();
      const clickGain = context.createGain();
      click.type = "sine";
      click.frequency.setValueAtTime(150 + power * 190, now);
      click.frequency.exponentialRampToValueAtTime(260 + power * 420, now + 0.06 + power * 0.03);
      clickGain.gain.setValueAtTime(0.018 + power * 0.018, now);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08 + power * 0.03);
      click.connect(clickGain);
      clickGain.connect(context.destination);
      click.start(now);
      click.stop(now + 0.1 + power * 0.04);

      const whoosh = context.createBufferSource();
      const whooshGain = context.createGain();
      const whooshFilter = context.createBiquadFilter();
      const duration = 0.16 + power * 0.08;
      const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
      const buffer = context.createBuffer(1, frameCount, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frameCount; i += 1) {
        const fade = 1 - i / frameCount;
        data[i] = (Math.random() * 2 - 1) * fade * fade;
      }
      whoosh.buffer = buffer;
      whooshFilter.type = "bandpass";
      whooshFilter.frequency.setValueAtTime(520 + power * 900, now);
      whooshFilter.Q.setValueAtTime(0.9, now);
      whooshGain.gain.setValueAtTime(0.025 + power * 0.035, now);
      whooshGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      whoosh.connect(whooshFilter);
      whooshFilter.connect(whooshGain);
      whooshGain.connect(context.destination);
      whoosh.start(now);
      whoosh.stop(now + duration);
    }

    function playLand(kind = "normal", tone = 0) {
      const isPerfect = kind === "perfect";
      const notes = [261.63, 293.66, 329.63, 392, 440, 493.88, 523.25, 587.33];
      const base = notes[tone % notes.length];
      const pack = makeEnvelope(0.0001, isPerfect ? 0.15 : 0.09, 0.0001, isPerfect ? 0.36 : 0.18);
      if (!pack) {
        return;
      }
      const { context, gain, now } = pack;
      const osc = context.createOscillator();
      osc.type = isPerfect ? "sine" : "triangle";
      osc.frequency.setValueAtTime(isPerfect ? base * 2 : base, now);
      osc.frequency.exponentialRampToValueAtTime(isPerfect ? base * 3 : base * 0.76, now + (isPerfect ? 0.28 : 0.16));
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + (isPerfect ? 0.38 : 0.2));

      const knock = context.createOscillator();
      const knockGain = context.createGain();
      knock.type = "square";
      knock.frequency.setValueAtTime(isPerfect ? 184 : 118, now);
      knockGain.gain.setValueAtTime(isPerfect ? 0.035 : 0.052, now);
      knockGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
      knock.connect(knockGain);
      knockGain.connect(context.destination);
      knock.start(now);
      knock.stop(now + 0.07);

      const color = context.createOscillator();
      const colorGain = context.createGain();
      color.type = "sine";
      color.frequency.setValueAtTime(base * (isPerfect ? 4 : 2), now + 0.05);
      colorGain.gain.setValueAtTime(isPerfect ? 0.045 : 0.026, now + 0.05);
      colorGain.gain.exponentialRampToValueAtTime(0.0001, now + (isPerfect ? 0.42 : 0.22));
      color.connect(colorGain);
      colorGain.connect(context.destination);
      color.start(now + 0.05);
      color.stop(now + (isPerfect ? 0.44 : 0.24));
    }

    function playMiss() {
      stopCharge();
      const pack = makeEnvelope(0.0001, 0.065, 0.0001, 0.42);
      if (!pack) {
        return;
      }
      const { context, gain, now } = pack;
      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(230, now);
      osc.frequency.exponentialRampToValueAtTime(128, now + 0.36);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.44);

      const soft = context.createOscillator();
      const softGain = context.createGain();
      soft.type = "triangle";
      soft.frequency.setValueAtTime(172, now + 0.03);
      soft.frequency.exponentialRampToValueAtTime(96, now + 0.34);
      softGain.gain.setValueAtTime(0.022, now + 0.03);
      softGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      soft.connect(softGain);
      softGain.connect(context.destination);
      soft.start(now + 0.03);
      soft.stop(now + 0.42);
    }

    function playBack() {
      const pack = makeEnvelope(0.0001, 0.055, 0.0001, 0.13);
      if (!pack) {
        return;
      }
      const { context, gain, now } = pack;
      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(230, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.12);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.14);
    }

    return {
      startCharge,
      updateCharge,
      stopCharge,
      playJump,
      playLand,
      playMiss,
      playBack,
    };
  }

  function createHapticsController() {
    function vibrate(pattern) {
      if ("vibrate" in navigator) {
        navigator.vibrate(pattern);
      }
    }

    return {
      chargeStart() {
        vibrate(8);
      },
      jump(power) {
        if (power > 0.76) {
          vibrate([18, 24, 18]);
        } else {
          vibrate(power > 0.38 ? 18 : 10);
        }
      },
      land(perfect) {
        vibrate(perfect ? [12, 26, 20] : 14);
      },
      miss() {
        vibrate([30, 26, 42]);
      },
      back() {
        vibrate(8);
      },
    };
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    game.view.baseY = height < 620 ? height * 0.72 : height * 0.67;
    updateViewTarget(true);
  }

  function makeBlock(x, y, index, start = false) {
    const theme = blockThemes[index % blockThemes.length];
    const difficulty = getDifficulty();
    const radius = start ? 68 : rand(54 - difficulty * 18, 72 - difficulty * 24);
    const shape = start ? "cube" : blockShapes[(index - 1) % blockShapes.length];
    const depth = shape === "disc" ? rand(42, 56 - difficulty * 7) : rand(64, 86 - difficulty * 13);
    return {
      x,
      y,
      radius: Math.max(32, radius),
      depth: start ? 78 : depth,
      shape,
      colors: theme,
      index,
      motif: theme.motif,
      tone: theme.tone,
      revealed: start,
      pulse: start ? 0.8 : 0,
      wobble: 0,
      squash: 0,
      appear: start ? 1 : 0,
    };
  }

  function makeNextBlock(from, index) {
    const difficulty = getDifficulty();
    const direction = Math.random() > 0.5 ? 1 : -1;
    const roll = Math.random();
    let screenDistance = 0;
    if (roll < 0.28) {
      screenDistance = rand(86 + difficulty * 8, 122 + difficulty * 12);
    } else if (roll < 0.72) {
      screenDistance = rand(132 + difficulty * 8, 178 + difficulty * 14);
    } else {
      screenDistance = rand(186 + difficulty * 8, 226 + difficulty * 12);
    }
    return makeBlock(from.x + direction * screenDistance, from.y - screenDistance / ISO_Y, index);
  }

  function resetGame(showMenu = false) {
    const first = makeBlock(0, 0, 0, true);
    const second = makeNextBlock(first, 1);
    game.blocks = [first, second];
    game.currentIndex = 0;
    game.nextIndex = 1;
    game.status = showMenu ? "menu" : "ready";
    game.score = 0;
    game.combo = 0;
    game.centerBonus = 0;
    game.charge = 0;
    game.holdStart = 0;
    game.jump = null;
    game.fall = null;
    game.landImpact = null;
    game.particles = [];
    game.chargeParticleTimer = 0;
    game.tipTimer = 0;
    game.player.x = first.x;
    game.player.y = first.y;
    game.player.z = 0;
    game.player.rotation = 0;
    game.player.scaleX = 1;
    game.player.scaleY = 1;
    game.player.alpha = 1;
    scoreNode.textContent = "0";
    scoreNode.classList.remove("score-pop");
    finalScoreNode.textContent = "0";
    restartButton.hidden = true;
    startOverlay.classList.toggle("is-hidden", !showMenu);
    gameoverOverlay.classList.add("is-hidden");
    hideTip();
    setChargeVisible(false);
    updateViewTarget(true);
  }

  function startGame() {
    resetGame(false);
  }

  function showGameOver() {
    finalScoreNode.textContent = String(game.score);
    restartButton.hidden = true;
    gameoverOverlay.classList.remove("is-hidden");
  }

  function updateViewTarget(immediate = false) {
    if (!game.blocks.length) {
      return;
    }
    const current = game.blocks[game.currentIndex] || game.blocks[0];
    const next = game.blocks[game.nextIndex] || current;
    game.view.targetX = current.x * 0.52 + next.x * 0.48;
    game.view.targetY = current.y * 0.56 + next.y * 0.44 - 36;
    if (immediate) {
      game.view.x = game.view.targetX;
      game.view.y = game.view.targetY;
    }
  }

  function worldToScreen(point) {
    return {
      x: point.x - game.view.x + width / 2,
      y: (point.y - game.view.y) * ISO_Y + game.view.baseY,
    };
  }

  function setChargeVisible(visible) {
    chargeWrap.classList.toggle("is-active", visible);
  }

  function hideTip() {
    tip.textContent = "";
    tip.classList.add("is-hidden");
    tip.classList.remove("is-quiet");
  }

  function showTip(text, quiet = false) {
    tip.textContent = text;
    tip.classList.toggle("is-quiet", quiet);
    tip.classList.remove("is-hidden");
    game.tipTimer = 980;
  }

  function popScore() {
    scoreNode.classList.remove("score-pop");
    void scoreNode.offsetWidth;
    scoreNode.classList.add("score-pop");
  }

  function startCharge() {
    if (game.status === "gameover") {
      return;
    }
    if (game.status !== "ready") {
      return;
    }
    game.status = "charging";
    game.landImpact = null;
    game.holdStart = performance.now();
    game.charge = 0;
    game.player.scaleX = 1;
    game.player.scaleY = 1;
    setChargeVisible(true);
    hideTip();
    audio.startCharge();
    haptics.chargeStart();
  }

  function releaseCharge() {
    if (game.status !== "charging") {
      return;
    }
    const held = performance.now() - game.holdStart;
    const rawCharge = clamp(held / MAX_HOLD, 0, 1);
    const tunedCharge = clamp((rawCharge - 0.035) / 0.965, 0, 1);
    const charge = Math.pow(tunedCharge, 1.72);
    audio.playJump(rawCharge);
    haptics.jump(rawCharge);
    const next = game.blocks[game.nextIndex];
    const dx = next.x - game.player.x;
    const dy = next.y - game.player.y;
    const length = Math.hypot(dx, dy) || 1;
    const distance = charge * MAX_JUMP_DISTANCE;
    const effectPower = clamp(distance / MAX_JUMP_DISTANCE, 0, 1);
    game.status = "jumping";
    const current = game.blocks[game.currentIndex];
    if (current) {
      current.squash = -0.15 - rawCharge * 0.13;
    }
    game.jump = {
      elapsed: 0,
      duration: 330 + rawCharge * 240,
      startX: game.player.x,
      startY: game.player.y,
      endX: game.player.x + (dx / length) * distance,
      endY: game.player.y + (dy / length) * distance,
      startRotation: game.player.rotation,
      direction: Math.sign(dx) || 1,
      spin: (Math.sign(dx) || 1) * Math.PI * 2,
      power: rawCharge,
      effectPower,
      trailTimer: 0,
    };
    takeoffDust(game.jump.startX, game.jump.startY, effectPower);
    game.charge = 0;
    game.player.scaleX = 1;
    game.player.scaleY = 1;
    setChargeVisible(false);
  }

  function getLandingInfo(block) {
    const dx = game.player.x - block.x;
    const dy = game.player.y - block.y;
    const topHalfHeight = block.radius * 0.54;
    const diamondDistance =
      Math.abs(dx) / (block.radius * 1.18) + Math.abs(dy) / (topHalfHeight * 1.18);
    const ellipseDistance =
      (dx * dx) / Math.pow(block.radius * 0.98, 2) + (dy * dy) / Math.pow(topHalfHeight * 1.1, 2);
    const isRoundTop = block.shape === "cylinder" || block.shape === "disc";
    return {
      block,
      dx,
      dy,
      centerDistance: Math.hypot(dx / block.radius, dy / topHalfHeight),
      isOnTop: isRoundTop ? ellipseDistance <= 1 : diamondDistance <= 1.08,
    };
  }

  function evaluateLanding() {
    const current = game.blocks[game.currentIndex];
    const next = game.blocks[game.nextIndex];
    const nextLanding = getLandingInfo(next);
    const currentLanding = getLandingInfo(current);

    if (nextLanding.isOnTop) {
      const { block, centerDistance } = nextLanding;
      let gain = 1;
      const centerLimit = 0.18 + getDifficulty() * 0.06;
      if (centerDistance < centerLimit) {
        game.combo += 1;
        game.centerBonus += 2;
        gain = 1 + game.centerBonus;
        game.player.x = block.x;
        game.player.y = block.y;
        revealBlock(block, true);
        showTip(game.combo > 1 ? `中心连跳 +${gain}` : `中心 +${gain}`);
        audio.playLand("perfect", block.tone);
        haptics.land(true);
        centerCelebration(block, game.combo);
      } else {
        game.combo = 0;
        game.centerBonus = 0;
        revealBlock(block, false);
        showTip(`+${gain}`, true);
        audio.playLand("normal", block.tone);
        haptics.land(false);
      }

      game.score += gain;
      scoreNode.textContent = String(game.score);
      popScore();
      if (game.score > bestScore) {
        bestScore = game.score;
        bestNode.textContent = String(bestScore);
        writeBestScore(bestScore);
      }

      game.currentIndex = game.nextIndex;
      game.blocks.push(makeNextBlock(block, game.blocks.length));
      game.nextIndex = game.blocks.length - 1;
      game.status = "ready";
      updateViewTarget();
      return;
    }

    if (currentLanding.isOnTop) {
      game.combo = 0;
      game.centerBonus = 0;
      game.status = "ready";
      game.player.rotation = 0;
      game.player.alpha = 1;
      showTip("再远一点", true);
      audio.playBack();
      haptics.back();
      updateViewTarget();
      return;
    }

    game.status = "falling";
    game.combo = 0;
    game.centerBonus = 0;
    game.fall = {
      elapsed: 0,
      duration: 680,
      startZ: game.player.z,
    };
    showTip("落空了");
    audio.playMiss();
    haptics.miss();
  }

  function burst(x, y, color, count, delay = 0, spread = 1) {
    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(26, 82) * spread;
      game.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.55,
        life: rand(420, 760),
        maxLife: 760,
        size: rand(2, 5),
        color,
        type: "spark",
        delay,
      });
    }
  }

  function ring(x, y, radius, delay = 0) {
    game.particles.push({
      x,
      y,
      radius,
      life: 520,
      maxLife: 520,
      color: "rgba(255, 250, 190, 0.9)",
      type: "ring",
      delay,
    });
  }

  function startLandingImpact(block, perfect) {
    game.landImpact = {
      block,
      elapsed: 0,
      duration: perfect ? 260 : 210,
      amount: perfect ? 0.36 : 0.24,
    };
  }

  function updateLandingImpact(dt) {
    if (!game.landImpact) {
      return;
    }
    const impact = game.landImpact;
    impact.elapsed += dt;
    const t = clamp(impact.elapsed / impact.duration, 0, 1);
    const downPoint = 0.46;
    const squash =
      t < downPoint ? impact.amount * (t / downPoint) : impact.amount * (1 - (t - downPoint) / (1 - downPoint));

    if (impact.block) {
      impact.block.squash = Math.max(0, squash);
    }
    if (game.status === "ready") {
      game.player.scaleX = 1 + squash * 0.78;
      game.player.scaleY = 1 - squash * 0.68;
    }
    if (t >= 1) {
      if (impact.block) {
        impact.block.squash = 0;
      }
      if (game.status === "ready") {
        game.player.scaleX = 1;
        game.player.scaleY = 1;
      }
      game.landImpact = null;
    }
  }

  function centerCelebration(block, combo) {
    for (let i = 0; i < combo; i += 1) {
      const delay = i * 115;
      ring(block.x, block.y, block.radius * (1.08 + i * 0.08), delay);
      burst(block.x, block.y, block.colors.trim, 18 + i * 3, delay, 1 + i * 0.06);
    }
  }

  function revealBlock(block, perfect) {
    block.revealed = true;
    block.pulse = perfect ? 1.35 : 0.9;
    block.wobble = perfect ? 1 : 0.55;
    startLandingImpact(block, perfect);
    for (let i = 0; i < (perfect ? 16 : 8); i += 1) {
      const angle = (Math.PI * 2 * i) / (perfect ? 16 : 8);
      game.particles.push({
        x: block.x + Math.cos(angle) * block.radius * rand(0.12, 0.58),
        y: block.y + Math.sin(angle) * block.radius * 0.32 * rand(0.12, 0.9),
        vx: Math.cos(angle) * rand(14, 42),
        vy: Math.sin(angle) * rand(8, 32),
        life: rand(360, 680),
        maxLife: 680,
        size: rand(2, 4),
        color: block.colors.trim,
        type: "spark",
        delay: 0,
      });
    }
  }

  function emitChargeParticles() {
    const power = game.charge;
    if (power <= 0.02) {
      return;
    }
    const count = 1 + Math.floor(power * 8);
    const radiusBase = lerp(42, 16, power);
    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, Math.PI * 2);
      const radius = radiusBase + rand(-8, 14);
      const startX = game.player.x + Math.cos(angle) * radius;
      const startY = game.player.y + Math.sin(angle) * radius * 0.12;
      game.particles.push({
        x: startX,
        y: startY,
        targetX: game.player.x + rand(-3, 3),
        targetY: game.player.y + rand(-3, 4),
        screenOffsetY: rand(-62, -34),
        targetScreenOffsetY: rand(-8, 4),
        vx: 0,
        vy: 0,
        life: 320 + power * 240,
        maxLife: 560,
        size: rand(1.8, 3.9) * (0.84 + power * 1.05),
        color: i % 2 ? "rgba(255, 239, 172, 0.9)" : "rgba(108, 221, 205, 0.84)",
        type: "charge",
        delay: 0,
      });
    }
  }

  function takeoffDust(x, y, power) {
    const count = Math.round(6 + power * 10);
    for (let i = 0; i < count; i += 1) {
      const angle = rand(Math.PI * 0.88, Math.PI * 1.18);
      const speed = rand(18, 48 + power * 26);
      game.particles.push({
        x: x + rand(-8, 8),
        y: y + rand(-5, 6),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.28,
        life: rand(260, 430),
        maxLife: 430,
        size: rand(2.2, 4.8) * (0.8 + power * 0.6),
        color: i % 2 ? "rgba(255, 241, 181, 0.9)" : "rgba(102, 221, 198, 0.82)",
        type: "trail",
        delay: 0,
      });
    }
  }

  function emitJumpTrail() {
    if (!game.jump) {
      return;
    }
    const power = game.jump.effectPower;
    const count = power > 0.72 ? 3 : 2;
    for (let i = 0; i < count; i += 1) {
      game.particles.push({
        x: game.player.x - game.jump.direction * rand(7, 18),
        y: game.player.y + rand(-7, 7),
        screenOffsetY: -30 + rand(-16, 6),
        vx: -game.jump.direction * rand(10, 34),
        vy: rand(-14, 14),
        life: rand(250, 430),
        maxLife: 430,
        size: rand(2, 4.6) * (0.8 + power * 0.72),
        color: i % 2 ? "rgba(255, 246, 176, 0.9)" : "rgba(110, 224, 206, 0.84)",
        type: "trail",
        delay: 0,
      });
    }
  }

  function update(dt) {
    game.view.x += (game.view.targetX - game.view.x) * 0.08;
    game.view.y += (game.view.targetY - game.view.y) * 0.08;

    if (game.tipTimer > 0) {
      game.tipTimer -= dt;
      if (game.tipTimer <= 0 && game.status !== "gameover") {
        hideTip();
      }
    }

    if (game.status === "charging") {
      game.charge = clamp((performance.now() - game.holdStart) / MAX_HOLD, 0, 1);
      audio.updateCharge(game.charge);
      chargeBar.style.transform = `scaleX(${game.charge})`;
      const squash = game.charge * 0.31;
      game.player.scaleX = 1 + squash * 0.78;
      game.player.scaleY = 1 - squash * 0.92;
      const current = game.blocks[game.currentIndex];
      if (current) {
        current.squash = squash;
      }
      game.chargeParticleTimer -= dt;
      if (game.chargeParticleTimer <= 0) {
        game.chargeParticleTimer = 88 - game.charge * 68;
        emitChargeParticles();
      }
    } else {
      chargeBar.style.transform = "scaleX(0)";
      game.chargeParticleTimer = 0;
    }

    if (game.status === "jumping" && game.jump) {
      game.jump.elapsed += dt;
      const t = clamp(game.jump.elapsed / game.jump.duration, 0, 1);
      const eased = smoothstep(t);
      const spinEase = easeInOutCubic(t);
      game.player.x = lerp(game.jump.startX, game.jump.endX, eased);
      game.player.y = lerp(game.jump.startY, game.jump.endY, eased);
      game.player.z = Math.sin(t * Math.PI) * JUMP_ARC * (0.82 + game.jump.power * 0.18);
      game.player.rotation =
        game.jump.startRotation + game.jump.spin * spinEase + Math.sin(t * Math.PI) * 0.05 * game.jump.direction;
      const spring = Math.max(0, 1 - t * 5.4) * (0.16 + game.jump.power * 0.08);
      const airStretch = Math.sin(t * Math.PI) * (0.1 + game.jump.power * 0.055);
      const landingSquash = t > 0.72 ? ((t - 0.72) / 0.28) * (0.12 + game.jump.power * 0.065) : 0;
      game.player.scaleX = 1 - spring * 0.45 - airStretch * 0.55 + landingSquash * 1.25;
      game.player.scaleY = 1 + spring * 1.65 + airStretch * 1.18 - landingSquash * 1.1;
      game.jump.trailTimer -= dt;
      if (t < 0.92 && game.jump.trailTimer <= 0) {
        game.jump.trailTimer = 42 - game.jump.power * 18;
        emitJumpTrail();
      }
      if (t >= 1) {
        game.player.z = 0;
        game.player.rotation = 0;
        game.player.scaleX = 1;
        game.player.scaleY = 1;
        evaluateLanding();
      }
    }

    if (game.status === "falling" && game.fall) {
      game.fall.elapsed += dt;
      const t = clamp(game.fall.elapsed / game.fall.duration, 0, 1);
      game.player.z = game.fall.startZ - easeOutCubic(t) * 126;
      game.player.rotation = lerp(game.player.rotation, 0, 0.18);
      game.player.alpha = 1 - t * 0.86;
      if (t >= 1) {
        game.status = "gameover";
        game.player.rotation = 0;
        showTip(`本局 ${game.score} 分`);
        showGameOver();
      }
    }

    updateLandingImpact(dt);

    for (const block of game.blocks) {
      block.appear = Math.min(1, (block.appear || 0) + dt / 420);
      const isChargingBlock = game.status === "charging" && block === game.blocks[game.currentIndex];
      const isImpactBlock = game.landImpact && game.landImpact.block === block;
      if (!isChargingBlock && !isImpactBlock) {
        block.squash = moveToward(block.squash || 0, 0, dt * 0.00135);
        if (Math.abs(block.squash) < 0.002) {
          block.squash = 0;
        }
      }
      block.pulse = Math.max(0, block.pulse - dt / 520);
      block.wobble = Math.max(0, block.wobble - dt / 420);
    }

    updateParticles(dt);
  }

  function updateParticles(dt) {
    for (const particle of game.particles) {
      if (particle.delay > 0) {
        particle.delay -= dt;
        continue;
      }
      particle.life -= dt;
      if (particle.type === "spark" || particle.type === "trail") {
        const seconds = dt / 1000;
        particle.x += particle.vx * seconds;
        particle.y += particle.vy * seconds;
        particle.vy += (particle.type === "spark" ? 80 : 24) * seconds;
      } else if (particle.type === "charge") {
        particle.x += (particle.targetX - particle.x) * 0.11;
        particle.y += (particle.targetY - particle.y) * 0.11;
        particle.screenOffsetY += ((particle.targetScreenOffsetY || 0) - (particle.screenOffsetY || 0)) * 0.11;
      }
    }
    game.particles = game.particles.filter((particle) => particle.life > 0 || particle.delay > 0);
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    drawBackdrop();

    const blocks = [...game.blocks].sort((a, b) => a.y - b.y);
    for (const block of blocks) {
      drawBlock(block);
    }

    drawParticles();
    drawPlayer();
    drawChargeAura();
  }

  function drawChargeAura() {
    if (game.status !== "charging" || game.charge <= 0.02) {
      return;
    }
    const p = worldToScreen(game.player);
    const power = game.charge;
    const now = performance.now() * 0.005;
    const waistY = p.y - 58;
    const footY = p.y - 5;
    const count = 3 + Math.floor(power * 25);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i += 1) {
      const lane = i / count;
      const flow = (lane + now * (0.08 + power * 0.13)) % 1;
      const a = i * 2.399 + now * (0.46 + power * 0.5);
      const radius = lerp(29 + power * 9, 5 + power * 3, flow);
      const squeeze = 0.62 + Math.sin(now * 1.7 + i) * 0.16;
      const x = p.x + Math.cos(a) * radius;
      const y = lerp(waistY, footY, flow) + Math.sin(a) * radius * 0.18 * squeeze;
      ctx.globalAlpha = (0.22 + power * 0.62) * (0.65 + flow * 0.42);
      ctx.fillStyle = i % 3 === 0 ? "#ffe25e" : "#21d8c2";
      ctx.beginPath();
      ctx.arc(x, y, (2.1 + power * 4.4) * (0.76 + flow * 0.34), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.18 + power * 0.34;
    ctx.strokeStyle = "#21d8c2";
    ctx.lineWidth = 1.4 + power * 1.8;
    ctx.beginPath();
    ctx.ellipse(p.x, footY, 18 + power * 16, 5 + power * 4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBackdrop() {
    ctx.save();
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#efe0dd");
    bg.addColorStop(0.54, "#ead7d4");
    bg.addColorStop(1, "#d9c1c3");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(width * 0.52, height * 0.4, width * 0.64, height * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    const groundY = height * 0.58;
    const ground = ctx.createLinearGradient(0, groundY, 0, height);
    ground.addColorStop(0, "rgba(132, 106, 108, 0.04)");
    ground.addColorStop(1, "rgba(132, 106, 108, 0.16)");
    ctx.fillStyle = ground;
    ctx.fillRect(0, groundY, width, height - groundY);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 5; i += 1) {
      const x = ((i * 211 - game.view.x * 0.18) % (width + 240)) - 120;
      const y = 72 + ((i * 47 - game.view.y * 0.08) % Math.max(height * 0.48, 260));
      drawSoftCloud(x, y, 36 + (i % 3) * 13);
    }
    ctx.restore();
  }

  function drawSoftCloud(x, y, size) {
    ctx.beginPath();
    ctx.ellipse(x, y, size, size * 0.34, 0, 0, Math.PI * 2);
    ctx.ellipse(x + size * 0.42, y - size * 0.08, size * 0.56, size * 0.38, 0, 0, Math.PI * 2);
    ctx.ellipse(x - size * 0.44, y, size * 0.5, size * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function getBlockVisual(block) {
    const base = worldToScreen(block);
    const appear = clamp(block.appear ?? 1, 0, 1);
    const pop = easeOutBack(appear);
    const scale = clamp(0.72 + pop * 0.28, 0.68, 1.08);
    const squash = block.squash || 0;
    return {
      p: {
        x: base.x,
        y: base.y - (1 - appear) * 58 + Math.max(pop - 1, 0) * 10 + squash * 18,
      },
      r: block.radius * scale * (1 + squash * 0.56),
      h: block.radius * 0.56 * scale * (1 - squash * 0.78),
      d: block.depth * scale * (1 - squash * 0.5),
      squash,
    };
  }

  function translatePoint(point, offset) {
    return {
      x: point.x + offset.x,
      y: point.y + offset.y,
    };
  }

  function drawBlockShadow(p, r, h, d, squash, strength = 1) {
    const press = clamp(squash, -0.3, 0.42);
    const castLength = r * (1.34 + press * 0.28);
    const offset = { x: -castLength, y: castLength * SHADOW_SLOPE };
    const back = { x: p.x, y: p.y - h + d };
    const left = { x: p.x - r, y: p.y + d };
    const front = { x: p.x, y: p.y + h + d };
    const right = { x: p.x + r, y: p.y + d };

    ctx.save();
    ctx.globalAlpha = 0.22 * strength;
    ctx.fillStyle = "#a89596";
    drawPolygon([left, front, translatePoint(front, offset), translatePoint(left, offset)]);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.1 * strength;
    ctx.fillStyle = "#8f7f80";
    drawPolygon([back, left, front, right]);
    ctx.fill();
    ctx.restore();
  }

  function drawRoundBlock(block, p, r, h, d, pulse, wobble, squash) {
    const isDisc = block.shape === "disc";
    const rx = r * (isDisc ? 1.04 : 0.86);
    const ry = h * (isDisc ? 0.72 : 0.82);
    const topY = p.y + wobble;
    const bottomY = topY + d + (isDisc ? 4 : 10);

    drawBlockShadow({ x: p.x, y: topY }, rx, ry, d, squash, isDisc ? 0.88 : 1);

    ctx.save();
    const sideGradient = ctx.createLinearGradient(p.x - rx, topY, p.x + rx, bottomY + ry);
    sideGradient.addColorStop(0, block.colors.left);
    sideGradient.addColorStop(0.5, block.colors.top);
    sideGradient.addColorStop(1, block.colors.right);
    ctx.fillStyle = sideGradient;
    ctx.beginPath();
    ctx.moveTo(p.x - rx, topY);
    ctx.bezierCurveTo(p.x - rx, topY + ry * 0.62, p.x + rx, topY + ry * 0.62, p.x + rx, topY);
    ctx.lineTo(p.x + rx, bottomY);
    ctx.bezierCurveTo(p.x + rx, bottomY + ry * 0.62, p.x - rx, bottomY + ry * 0.62, p.x - rx, bottomY);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.38;
    ctx.fillStyle = "#172a2a";
    ctx.beginPath();
    ctx.ellipse(p.x, bottomY, rx, ry, 0, 0, Math.PI);
    ctx.fill();
    ctx.globalAlpha = 1;

    const topGradient = ctx.createLinearGradient(p.x - rx, topY - ry, p.x + rx, topY + ry);
    topGradient.addColorStop(0, block.colors.trim);
    topGradient.addColorStop(0.28, block.colors.top);
    topGradient.addColorStop(1, block.colors.left);
    ctx.fillStyle = topGradient;
    ctx.beginPath();
    ctx.ellipse(p.x, topY, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(35, 42, 51, 0.2)";
    ctx.beginPath();
    ctx.ellipse(p.x, topY, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(p.x - rx * 0.1, topY - ry * 0.08, rx * 0.48, ry * 0.32, 0, Math.PI * 1.03, Math.PI * 1.88);
    ctx.stroke();

    if (block.revealed) {
      drawBlockMotif(block, { x: p.x, y: topY }, r, h);
    } else {
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = block.colors.trim;
      ctx.beginPath();
      ctx.ellipse(p.x, topY, r * 0.18, h * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (pulse > 0) {
      ctx.globalAlpha = 0.42 * pulse;
      ctx.strokeStyle = block.colors.trim;
      ctx.lineWidth = 2 + pulse * 2;
      ctx.beginPath();
      ctx.ellipse(p.x, topY, rx * (0.42 + pulse * 0.54), ry * (0.34 + pulse * 0.48), 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#111e22";
    ctx.fillRect(p.x - rx * 0.92, topY + d * 0.52, rx * 1.84, Math.max(3, d * 0.12));
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawPrismBlock(block, p, r, h, d, pulse, wobble, squash) {
    const top = { x: p.x, y: p.y - h * 0.92 + wobble };
    const left = { x: p.x - r * 0.98, y: p.y + h * 0.18 + wobble };
    const right = { x: p.x + r * 0.98, y: p.y + h * 0.18 + wobble };
    const front = { x: p.x, y: p.y + h * 0.92 + wobble };

    drawBlockShadow(p, r, h, d, squash);

    ctx.save();
    ctx.fillStyle = block.colors.left;
    drawPolygon([
      left,
      front,
      { x: front.x, y: front.y + d },
      { x: left.x, y: left.y + d },
    ]);
    ctx.fill();

    ctx.fillStyle = block.colors.right;
    drawPolygon([
      right,
      front,
      { x: front.x, y: front.y + d },
      { x: right.x, y: right.y + d },
    ]);
    ctx.fill();

    ctx.globalAlpha = 0.32;
    ctx.fillStyle = "rgba(255, 255, 255, 0.56)";
    drawPolygon([
      { x: left.x, y: left.y + d * 0.34 },
      { x: front.x, y: front.y + d * 0.34 },
      { x: front.x, y: front.y + d * 0.54 },
      { x: left.x, y: left.y + d * 0.54 },
    ]);
    ctx.fill();
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = "rgba(26, 35, 40, 0.38)";
    drawPolygon([
      { x: right.x, y: right.y + d * 0.72 },
      { x: front.x, y: front.y + d * 0.72 },
      { x: front.x, y: front.y + d * 0.92 },
      { x: right.x, y: right.y + d * 0.92 },
    ]);
    ctx.fill();
    ctx.globalAlpha = 1;

    const topGradient = ctx.createLinearGradient(p.x - r, top.y, p.x + r, front.y);
    topGradient.addColorStop(0, block.colors.trim);
    topGradient.addColorStop(0.36, block.colors.top);
    topGradient.addColorStop(1, block.colors.left);
    ctx.fillStyle = topGradient;
    drawPolygon([top, right, front, left]);
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(35, 42, 51, 0.2)";
    drawPolygon([top, right, front, left]);
    ctx.stroke();

    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = "#1c3b3d";
    ctx.beginPath();
    ctx.moveTo(top.x, top.y + 3);
    ctx.lineTo(front.x, front.y - 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (block.revealed) {
      drawBlockMotif(block, { x: p.x, y: p.y + wobble }, r, h);
    } else {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = block.colors.trim;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + wobble, r * 0.2, h * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (pulse > 0) {
      ctx.globalAlpha = 0.42 * pulse;
      ctx.strokeStyle = block.colors.trim;
      ctx.lineWidth = 2 + pulse * 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + wobble, r * (0.4 + pulse * 0.55), h * (0.24 + pulse * 0.4), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBlock(block) {
    const visual = getBlockVisual(block);
    const p = visual.p;
    const r = visual.r;
    const h = visual.h;
    const d = visual.d;
    const squash = visual.squash;
    const pulse = block.pulse || 0;
    const wobble = Math.sin((1 - (block.wobble || 0)) * Math.PI * 3) * (block.wobble || 0) * 2;

    if (block.shape === "cylinder" || block.shape === "disc") {
      drawRoundBlock(block, p, r, h, d, pulse, wobble, squash);
      return;
    }
    if (block.shape === "prism") {
      drawPrismBlock(block, p, r, h, d, pulse, wobble, squash);
      return;
    }

    const left = { x: p.x - r, y: p.y };
    const right = { x: p.x + r, y: p.y };
    const top = { x: p.x, y: p.y - h + wobble };
    const bottom = { x: p.x, y: p.y + h + wobble };

    drawBlockShadow(p, r, h, d, squash);

    ctx.save();
    ctx.fillStyle = block.colors.left;
    drawPolygon([
      left,
      bottom,
      { x: bottom.x, y: bottom.y + d },
      { x: left.x, y: left.y + d },
    ]);
    ctx.fill();

    ctx.fillStyle = block.colors.right;
    drawPolygon([
      right,
      bottom,
      { x: bottom.x, y: bottom.y + d },
      { x: right.x, y: right.y + d },
    ]);
    ctx.fill();

    ctx.globalAlpha = 0.42;
    ctx.fillStyle = "rgba(255, 255, 255, 0.74)";
    drawPolygon([
      { x: left.x, y: left.y + d * 0.36 },
      { x: bottom.x, y: bottom.y + d * 0.36 },
      { x: bottom.x, y: bottom.y + d * 0.58 },
      { x: left.x, y: left.y + d * 0.58 },
    ]);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.46)";
    drawPolygon([
      { x: right.x, y: right.y + d * 0.34 },
      { x: bottom.x, y: bottom.y + d * 0.34 },
      { x: bottom.x, y: bottom.y + d * 0.56 },
      { x: right.x, y: right.y + d * 0.56 },
    ]);
    ctx.fill();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "rgba(26, 35, 40, 0.46)";
    drawPolygon([
      { x: left.x, y: left.y + d * 0.76 },
      { x: bottom.x, y: bottom.y + d * 0.76 },
      { x: bottom.x, y: bottom.y + d * 0.94 },
      { x: left.x, y: left.y + d * 0.94 },
    ]);
    ctx.fill();
    ctx.fillStyle = "rgba(26, 35, 40, 0.34)";
    drawPolygon([
      { x: right.x, y: right.y + d * 0.74 },
      { x: bottom.x, y: bottom.y + d * 0.74 },
      { x: bottom.x, y: bottom.y + d * 0.92 },
      { x: right.x, y: right.y + d * 0.92 },
    ]);
    ctx.fill();
    ctx.globalAlpha = 1;

    const topGradient = ctx.createLinearGradient(p.x - r, p.y - h, p.x + r, p.y + h);
    topGradient.addColorStop(0, block.colors.trim);
    topGradient.addColorStop(0.24, block.colors.top);
    topGradient.addColorStop(1, block.colors.left);
    ctx.fillStyle = topGradient;
    drawPolygon([top, right, bottom, left]);
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(35, 42, 51, 0.18)";
    drawPolygon([top, right, bottom, left]);
    ctx.stroke();

    ctx.globalAlpha = 0.36;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(top.x + 3, top.y + 2);
    ctx.lineTo(right.x - 8, right.y - 2);
    ctx.stroke();

    if (block.revealed) {
      drawBlockMotif(block, p, r, h);
    } else {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = block.colors.trim;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r * 0.22, h * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (pulse > 0) {
      ctx.globalAlpha = 0.42 * pulse;
      ctx.strokeStyle = block.colors.trim;
      ctx.lineWidth = 2 + pulse * 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r * (0.4 + pulse * 0.55), h * (0.24 + pulse * 0.4), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBlockMotif(block, p, r, h) {
    ctx.save();
    ctx.globalAlpha = 0.32 + Math.min(block.pulse || 0, 1) * 0.18;
    ctx.fillStyle = block.colors.trim;
    ctx.strokeStyle = block.colors.trim;
    ctx.lineWidth = Math.max(2, r * 0.045);
    ctx.lineCap = "round";

    if (block.motif === "petal") {
      for (let i = 0; i < 4; i += 1) {
        const angle = (Math.PI / 2) * i;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.ellipse(r * 0.16, 0, r * 0.2, h * 0.18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (block.motif === "sun") {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 8; i += 1) {
        const a = (Math.PI * 2 * i) / 8;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * r * 0.28, p.y + Math.sin(a) * h * 0.28);
        ctx.lineTo(p.x + Math.cos(a) * r * 0.46, p.y + Math.sin(a) * h * 0.46);
        ctx.stroke();
      }
    } else if (block.motif === "wave") {
      for (let i = -1; i <= 1; i += 1) {
        ctx.beginPath();
        for (let x = -r * 0.45; x <= r * 0.45; x += 8) {
          const y = Math.sin((x / r) * Math.PI * 2 + i) * h * 0.08 + i * h * 0.18;
          if (x === -r * 0.45) ctx.moveTo(p.x + x, p.y + y);
          else ctx.lineTo(p.x + x, p.y + y);
        }
        ctx.stroke();
      }
    } else if (block.motif === "spark") {
      drawPolygon([
        { x: p.x, y: p.y - h * 0.42 },
        { x: p.x + r * 0.11, y: p.y - h * 0.08 },
        { x: p.x + r * 0.36, y: p.y },
        { x: p.x + r * 0.1, y: p.y + h * 0.09 },
        { x: p.x, y: p.y + h * 0.42 },
        { x: p.x - r * 0.1, y: p.y + h * 0.09 },
        { x: p.x - r * 0.36, y: p.y },
        { x: p.x - r * 0.11, y: p.y - h * 0.08 },
      ]);
      ctx.fill();
    } else if (block.motif === "leaf") {
      ctx.beginPath();
      ctx.ellipse(p.x - r * 0.1, p.y, r * 0.24, h * 0.18, -0.35, 0, Math.PI * 2);
      ctx.ellipse(p.x + r * 0.14, p.y, r * 0.24, h * 0.18, 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(p.x - r * 0.35, p.y + h * 0.18);
      ctx.lineTo(p.x + r * 0.36, p.y - h * 0.18);
      ctx.stroke();
    } else if (block.motif === "rune") {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - r * 0.2, p.y + h * 0.25);
      ctx.lineTo(p.x, p.y - h * 0.26);
      ctx.lineTo(p.x + r * 0.22, p.y + h * 0.18);
      ctx.stroke();
    } else if (block.motif === "orbit") {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r * 0.34, h * 0.16, 0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x + r * 0.2, p.y - h * 0.06, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(p.x - r * 0.28, p.y);
      ctx.lineTo(p.x + r * 0.28, p.y);
      ctx.moveTo(p.x, p.y - h * 0.3);
      ctx.lineTo(p.x, p.y + h * 0.3);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawPolygon(points) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
  }

  function drawPlayerShadow(p, lift, alpha) {
    const distance = clamp(lift / 190, 0, 1);
    const castScale = clamp(1 - distance * 0.55, 0.42, 1);
    const press = clamp((game.player.scaleX - 1) * 3.4, 0, 0.95);
    const castLength = (48 + lift * 0.22) * castScale * (1 + press * 0.18);
    const offset = { x: -castLength, y: castLength * SHADOW_SLOPE };
    const foot = [
      { x: p.x, y: p.y - 6 + press * 4 },
      { x: p.x - 18 * castScale, y: p.y + 2 + press * 3 },
      { x: p.x, y: p.y + 9 + press * 2 },
      { x: p.x + 18 * castScale, y: p.y + 2 + press * 3 },
    ];

    ctx.save();
    ctx.globalAlpha = alpha * clamp(0.24 - distance * 0.15, 0.05, 0.24);
    ctx.fillStyle = "#9b8a8b";
    drawPolygon([
      foot[0],
      foot[1],
      foot[2],
      foot[3],
      translatePoint(foot[3], offset),
      translatePoint(foot[2], offset),
      translatePoint(foot[1], offset),
      translatePoint(foot[0], offset),
    ]);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = alpha * clamp(0.16 - distance * 0.12, 0.02, 0.16);
    ctx.fillStyle = "#7f7273";
    drawPolygon(foot);
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer() {
    const p = worldToScreen(game.player);
    const z = game.player.z;
    const alpha = game.player.alpha;
    const lift = Math.max(z, 0);
    drawPlayerShadow(p, lift, alpha);

    ctx.save();
    ctx.translate(p.x, p.y - z);
    ctx.rotate(game.player.rotation);
    ctx.scale(game.player.scaleX, game.player.scaleY);
    ctx.globalAlpha = alpha;

    const baseGradient = ctx.createLinearGradient(-22, -11, 22, 6);
    baseGradient.addColorStop(0, "#566788");
    baseGradient.addColorStop(0.52, "#26354d");
    baseGradient.addColorStop(1, "#182338");
    ctx.fillStyle = baseGradient;
    ctx.beginPath();
    ctx.ellipse(0, -1.5, 22, 8.2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#182338";
    ctx.beginPath();
    ctx.ellipse(0, -12, 17, 5.8, 0, 0, Math.PI * 2);
    ctx.fill();

    const bodyGradient = ctx.createLinearGradient(-18, -72, 20, -10);
    bodyGradient.addColorStop(0, "#8da0c6");
    bodyGradient.addColorStop(0.48, "#4b5f86");
    bodyGradient.addColorStop(1, "#23324e");
    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.moveTo(-8, -62);
    ctx.bezierCurveTo(-18, -54, -15.5, -20, -11.5, -10);
    ctx.quadraticCurveTo(0, -4.2, 11.5, -10);
    ctx.bezierCurveTo(15.5, -20, 18, -54, 8, -62);
    ctx.closePath();
    ctx.fill();

    const neckGradient = ctx.createLinearGradient(-11, -66, 11, -54);
    neckGradient.addColorStop(0, "#7285ad");
    neckGradient.addColorStop(1, "#30415f");
    ctx.fillStyle = neckGradient;
    ctx.beginPath();
    ctx.ellipse(0, -61, 10.8, 5.7, 0, 0, Math.PI * 2);
    ctx.fill();

    const headGradient = ctx.createRadialGradient(-5, -86, 2, 0, -80, 16.5);
    headGradient.addColorStop(0, "#c4d1ec");
    headGradient.addColorStop(0.55, "#607499");
    headGradient.addColorStop(1, "#25334d");
    ctx.fillStyle = headGradient;
    ctx.beginPath();
    ctx.arc(0, -80, 15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 255, 255, 0.34)";
    ctx.beginPath();
    ctx.ellipse(-6, -86, 3.6, 6.8, -0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 178, 56, 0.82)";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-14, -31);
    ctx.quadraticCurveTo(0, -24, 14, -31);
    ctx.stroke();

    ctx.restore();
  }

  function roundedRect(x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawParticles() {
    for (const particle of game.particles) {
      if (particle.delay > 0) {
        continue;
      }
      const p = worldToScreen(particle);
      p.y += particle.screenOffsetY || 0;
      const t = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = t;
      if (particle.type === "ring") {
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, particle.radius * (1.4 - t * 0.4), particle.radius * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, particle.size * (0.5 + t), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function onPointerDown(event) {
    event.preventDefault();
    startCharge();
  }

  function onPointerUp(event) {
    event.preventDefault();
    releaseCharge();
  }

  function onKeyDown(event) {
    if (event.code !== "Space" || event.repeat) {
      return;
    }
    event.preventDefault();
    startCharge();
  }

  function onKeyUp(event) {
    if (event.code !== "Space") {
      return;
    }
    event.preventDefault();
    releaseCharge();
  }

  function loop(now) {
    const dt = Math.min(now - lastTime, 34);
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("selectstart", (event) => event.preventDefault());
  window.addEventListener("dragstart", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  restartButton.addEventListener("click", () => resetGame(false));
  startButton.addEventListener("click", startGame);
  againButton.addEventListener("click", startGame);

  resize();
  resetGame(true);
  requestAnimationFrame(loop);
})();
