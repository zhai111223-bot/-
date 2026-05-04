(() => {
  const canvas = document.querySelector("#gameCanvas");
  const ctx = canvas.getContext("2d");
  const scoreNode = document.querySelector("#score");
  const bestNode = document.querySelector("#bestScore");
  const restartButton = document.querySelector("#restartButton");
  const chargeWrap = document.querySelector(".charge-wrap");
  const chargeBar = document.querySelector("#chargeBar");
  const tip = document.querySelector("#tip");

  const STORAGE_KEY = "light-jump-best-score";
  const MAX_HOLD = 1380;
  const MAX_JUMP_DISTANCE = 322;
  const JUMP_ARC = 118;

  const palette = [
    { top: "#58c6a8", left: "#2c967f", right: "#257b70", trim: "#dffaf0" },
    { top: "#f4bc65", left: "#ce8440", right: "#a96936", trim: "#fff0bb" },
    { top: "#74a8f2", left: "#4b78c7", right: "#3c63aa", trim: "#e7f1ff" },
    { top: "#e98578", left: "#c85f56", right: "#a84d4b", trim: "#ffe0dc" },
    { top: "#96cf72", left: "#68a94f", right: "#518c44", trim: "#edffd9" },
    { top: "#d598e4", left: "#a866bd", right: "#874fa2", trim: "#f8e6ff" },
  ];

  let width = 0;
  let height = 0;
  let dpr = 1;
  let lastTime = performance.now();
  let bestScore = readBestScore();
  const audio = createAudioController();

  const game = {
    blocks: [],
    currentIndex: 0,
    nextIndex: 1,
    status: "ready",
    score: 0,
    combo: 0,
    charge: 0,
    holdStart: 0,
    jump: null,
    fall: null,
    particles: [],
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

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function rand(min, max) {
    return Math.random() * (max - min) + min;
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
      osc.frequency.setValueAtTime(280 + power * 420, now);
      osc.frequency.exponentialRampToValueAtTime(150 + power * 220, now + 0.26 + power * 0.1);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.34 + power * 0.12);

      const click = context.createOscillator();
      const clickGain = context.createGain();
      click.type = "square";
      click.frequency.setValueAtTime(92 + power * 90, now);
      clickGain.gain.setValueAtTime(0.028, now);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
      click.connect(clickGain);
      clickGain.connect(context.destination);
      click.start(now);
      click.stop(now + 0.07);

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

    function playLand(kind = "normal") {
      const isPerfect = kind === "perfect";
      const pack = makeEnvelope(0.0001, isPerfect ? 0.15 : 0.09, 0.0001, isPerfect ? 0.36 : 0.18);
      if (!pack) {
        return;
      }
      const { context, gain, now } = pack;
      const osc = context.createOscillator();
      osc.type = isPerfect ? "sine" : "triangle";
      osc.frequency.setValueAtTime(isPerfect ? 660 : 260, now);
      osc.frequency.exponentialRampToValueAtTime(isPerfect ? 990 : 190, now + (isPerfect ? 0.28 : 0.16));
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
    }

    function playMiss() {
      stopCharge();
      const pack = makeEnvelope(0.0001, 0.11, 0.0001, 0.28);
      if (!pack) {
        return;
      }
      const { context, gain, now } = pack;
      const osc = context.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(62, now + 0.24);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.3);
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

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    game.view.baseY = height < 620 ? height * 0.68 : height * 0.63;
    updateViewTarget(true);
  }

  function makeBlock(x, y, index, start = false) {
    const colors = palette[index % palette.length];
    const radius = start ? 52 : rand(42, 56);
    return {
      x,
      y,
      radius,
      depth: start ? 34 : rand(27, 38),
      colors,
      index,
      mark: Math.floor(rand(0, 4)),
    };
  }

  function makeNextBlock(from, index) {
    const direction = Math.random() > 0.5 ? 1 : -1;
    const distance = rand(164, 262);
    const rise = rand(58, 98);
    return makeBlock(from.x + direction * distance, from.y - rise, index);
  }

  function resetGame() {
    const first = makeBlock(0, 0, 0, true);
    const second = makeNextBlock(first, 1);
    game.blocks = [first, second];
    game.currentIndex = 0;
    game.nextIndex = 1;
    game.status = "ready";
    game.score = 0;
    game.combo = 0;
    game.charge = 0;
    game.holdStart = 0;
    game.jump = null;
    game.fall = null;
    game.particles = [];
    game.tipTimer = 0;
    game.player.x = first.x;
    game.player.y = first.y;
    game.player.z = 0;
    game.player.rotation = 0;
    game.player.scaleX = 1;
    game.player.scaleY = 1;
    game.player.alpha = 1;
    scoreNode.textContent = "0";
    restartButton.hidden = true;
    hideTip();
    setChargeVisible(false);
    updateViewTarget(true);
  }

  function updateViewTarget(immediate = false) {
    if (!game.blocks.length) {
      return;
    }
    const current = game.blocks[game.currentIndex] || game.blocks[0];
    const next = game.blocks[game.nextIndex] || current;
    game.view.targetX = (current.x + next.x) / 2;
    game.view.targetY = (current.y + next.y) / 2 - 22;
    if (immediate) {
      game.view.x = game.view.targetX;
      game.view.y = game.view.targetY;
    }
  }

  function worldToScreen(point) {
    return {
      x: point.x - game.view.x + width / 2,
      y: point.y - game.view.y + game.view.baseY,
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

  function startCharge() {
    if (game.status === "gameover") {
      resetGame();
      return;
    }
    if (game.status !== "ready") {
      return;
    }
    game.status = "charging";
    game.holdStart = performance.now();
    game.charge = 0;
    game.player.scaleX = 1;
    game.player.scaleY = 1;
    setChargeVisible(true);
    hideTip();
    audio.startCharge();
  }

  function releaseCharge() {
    if (game.status !== "charging") {
      return;
    }
    const held = performance.now() - game.holdStart;
    const charge = clamp(held / MAX_HOLD, 0, 1);
    audio.playJump(charge);
    const next = game.blocks[game.nextIndex];
    const dx = next.x - game.player.x;
    const dy = next.y - game.player.y;
    const length = Math.hypot(dx, dy) || 1;
    const distance = charge * MAX_JUMP_DISTANCE;
    game.status = "jumping";
    const flipTurns = charge > 0.72 ? 2 : 1;
    game.jump = {
      elapsed: 0,
      duration: 445 + charge * 250,
      startX: game.player.x,
      startY: game.player.y,
      endX: game.player.x + (dx / length) * distance,
      endY: game.player.y + (dy / length) * distance,
      startRotation: game.player.rotation,
      direction: Math.sign(dx) || 1,
      spin: (Math.sign(dx) || 1) * Math.PI * 2 * flipTurns,
    };
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
    return {
      block,
      dx,
      dy,
      centerDistance: Math.hypot(dx / block.radius, dy / topHalfHeight),
      isOnTop: diamondDistance <= 1,
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
      if (centerDistance < 0.18) {
        game.combo += 1;
        gain += game.combo;
        game.player.x = block.x;
        game.player.y = block.y;
        showTip(`完美 +${gain}`);
        audio.playLand("perfect");
        burst(block.x, block.y, "#fff5b5", 18);
        ring(block.x, block.y, block.radius);
      } else {
        game.combo = 0;
        showTip(`+${gain}`, true);
        audio.playLand("normal");
      }

      game.score += gain;
      scoreNode.textContent = String(game.score);
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
      game.status = "ready";
      game.player.rotation = 0;
      game.player.alpha = 1;
      showTip("再远一点", true);
      audio.playBack();
      updateViewTarget();
      return;
    }

    game.status = "falling";
    game.combo = 0;
    game.fall = {
      elapsed: 0,
      duration: 680,
      startZ: game.player.z,
    };
    showTip("落空了");
    audio.playMiss();
  }

  function burst(x, y, color, count) {
    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(26, 82);
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
      });
    }
  }

  function ring(x, y, radius) {
    game.particles.push({
      x,
      y,
      radius,
      life: 520,
      maxLife: 520,
      color: "rgba(255, 250, 190, 0.9)",
      type: "ring",
    });
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
      const squash = game.charge * 0.18;
      game.player.scaleX = 1 + squash * 0.68;
      game.player.scaleY = 1 - squash;
    } else {
      chargeBar.style.transform = "scaleX(0)";
    }

    if (game.status === "jumping" && game.jump) {
      game.jump.elapsed += dt;
      const t = clamp(game.jump.elapsed / game.jump.duration, 0, 1);
      const eased = easeOutCubic(t);
      game.player.x = lerp(game.jump.startX, game.jump.endX, eased);
      game.player.y = lerp(game.jump.startY, game.jump.endY, eased);
      game.player.z = Math.sin(t * Math.PI) * JUMP_ARC;
      game.player.rotation =
        game.jump.startRotation + game.jump.spin * t + Math.sin(t * Math.PI) * 0.08 * game.jump.direction;
      if (t >= 1) {
        game.player.z = 0;
        game.player.rotation = 0;
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
        restartButton.hidden = false;
        showTip(`本局 ${game.score} 分`);
      }
    }

    updateParticles(dt);
  }

  function updateParticles(dt) {
    for (const particle of game.particles) {
      particle.life -= dt;
      if (particle.type === "spark") {
        const seconds = dt / 1000;
        particle.x += particle.vx * seconds;
        particle.y += particle.vy * seconds;
        particle.vy += 80 * seconds;
      }
    }
    game.particles = game.particles.filter((particle) => particle.life > 0);
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
  }

  function drawBackdrop() {
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(0, height * 0.56);
    ctx.lineTo(width, height * 0.46);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#79b8aa";
    for (let i = -2; i < 7; i += 1) {
      const y = height * 0.56 + i * 86 - (game.view.y % 86);
      ctx.beginPath();
      ctx.moveTo(-80, y);
      ctx.lineTo(width + 80, y - 72);
      ctx.lineTo(width + 80, y - 36);
      ctx.lineTo(-80, y + 36);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 8; i += 1) {
      const x = ((i * 211 - game.view.x * 0.18) % (width + 240)) - 120;
      const y = 72 + ((i * 47 - game.view.y * 0.08) % Math.max(height * 0.48, 260));
      drawSoftCloud(x, y, 36 + (i % 3) * 13);
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.strokeStyle = "#4f6f69";
    ctx.lineWidth = 1;
    for (let i = -4; i < 12; i += 1) {
      const y = height * 0.72 + i * 42 - (game.view.y % 42);
      ctx.beginPath();
      ctx.moveTo(-40, y);
      ctx.lineTo(width + 40, y - 64);
      ctx.stroke();
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

  function drawBlock(block) {
    const p = worldToScreen(block);
    const r = block.radius;
    const h = r * 0.54;
    const d = block.depth;
    const left = { x: p.x - r, y: p.y };
    const right = { x: p.x + r, y: p.y };
    const top = { x: p.x, y: p.y - h };
    const bottom = { x: p.x, y: p.y + h };

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#263835";
    ctx.beginPath();
    ctx.ellipse(p.x + 5, p.y + h + d + 15, r * 1.08, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

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

    const topGradient = ctx.createLinearGradient(p.x - r, p.y - h, p.x + r, p.y + h);
    topGradient.addColorStop(0, block.colors.trim);
    topGradient.addColorStop(0.24, block.colors.top);
    topGradient.addColorStop(1, block.colors.left);
    ctx.fillStyle = topGradient;
    drawPolygon([top, right, bottom, left]);
    ctx.fill();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
    drawPolygon([top, right, bottom, left]);
    ctx.stroke();

    ctx.globalAlpha = 0.36;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(top.x + 3, top.y + 2);
    ctx.lineTo(right.x - 8, right.y - 2);
    ctx.stroke();

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = block.colors.trim;
    if (block.mark === 0) {
      drawPolygon([
        { x: p.x, y: p.y - h * 0.36 },
        { x: p.x + r * 0.34, y: p.y },
        { x: p.x, y: p.y + h * 0.36 },
        { x: p.x - r * 0.34, y: p.y },
      ]);
      ctx.fill();
    } else if (block.mark === 1) {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r * 0.33, h * 0.33, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (block.mark === 2) {
      ctx.fillRect(p.x - r * 0.28, p.y - 2, r * 0.56, 4);
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

  function drawPlayer() {
    const p = worldToScreen(game.player);
    const z = game.player.z;
    const alpha = game.player.alpha;
    const lift = Math.max(z, 0);
    const shadowScale = clamp(1 - lift / 170, 0.35, 1);

    ctx.save();
    ctx.globalAlpha = clamp(alpha * (1 - lift / 190), 0, 0.2);
    ctx.fillStyle = "#233936";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 3, 20 * shadowScale, 5.8 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(p.x, p.y - z);
    ctx.rotate(game.player.rotation);
    ctx.scale(game.player.scaleX, game.player.scaleY);
    ctx.globalAlpha = alpha;

    ctx.fillStyle = "#222a36";
    ctx.beginPath();
    ctx.ellipse(0, -1.5, 17, 6.4, 0, 0, Math.PI * 2);
    ctx.fill();

    const bodyGradient = ctx.createLinearGradient(-16, -48, 20, -7);
    bodyGradient.addColorStop(0, "#5d6f91");
    bodyGradient.addColorStop(0.55, "#30405c");
    bodyGradient.addColorStop(1, "#1d2637");
    ctx.fillStyle = bodyGradient;
    roundedRect(-15, -39, 30, 35, 13);
    ctx.fill();

    ctx.fillStyle = "#ffb238";
    roundedRect(-16, -25, 32, 7, 4);
    ctx.fill();

    ctx.fillStyle = "#f7f2df";
    ctx.beginPath();
    ctx.arc(0, -49, 13, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#38445f";
    ctx.beginPath();
    ctx.arc(0, -56, 11, Math.PI, 0);
    ctx.lineTo(12, -49);
    ctx.quadraticCurveTo(1, -52, -12, -49);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#1f2937";
    ctx.beginPath();
    ctx.arc(-4, -50, 1.8, 0, Math.PI * 2);
    ctx.arc(5, -50, 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(31, 41, 55, 0.55)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(1, -46, 4, 0.2, Math.PI - 0.2);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
    ctx.beginPath();
    ctx.ellipse(-6, -32, 4, 9, -0.25, 0, Math.PI * 2);
    ctx.fill();

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
      const p = worldToScreen(particle);
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
  restartButton.addEventListener("click", resetGame);

  resize();
  resetGame();
  requestAnimationFrame(loop);
})();
