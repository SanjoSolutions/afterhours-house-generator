(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const ui = {
    start: $("#startButton"), scene: $("#sceneName"),
    bpm: $("#bpm"), key: $("#key"), phase: $("#phase"), bar: $("#barCount"),
    next: $("#nextChange"), fill: $("#timelineFill"), toast: $("#toast"), canvas: $("#visualizer")
  };

  const names = {
    deep: ["Velvet Transit", "Midnight Lobby", "Soft Concrete", "Blue Hour Motion", "Low Light Ritual"],
    classic: ["Warehouse Memory", "Sunday Service", "Red Room Theory", "Piano at Dawn", "The Long Groove"],
    disco: ["Chrome Reflections", "Mirrorball Weather", "Afterglow Avenue", "Golden Frequency", "Nightline Express"],
    acid: ["Silver Circuit", "Neon Spiral", "Voltage Garden", "303 Afterimage", "Liquid Hardware"]
  };
  const roots = ["C", "D", "E", "F", "G", "A", "Bb"];
  const phases = ["WARM UP", "LOCKED IN", "OPEN FLOOR", "LATE PEAK", "DEEP RELEASE"];
  const progressions = [[0, 5, 3, 4], [0, 3, 5, 4], [0, 4, 5, 3], [0, 5, 4, 3], [0, 3, 4, 0]];
  const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, Bb: 10 };
  const minor = [0, 2, 3, 5, 7, 8, 10];
  const chordTypes = [[0, 3, 7, 10], [0, 3, 7, 12], [0, 4, 7, 10]];
  const voiceKeys = ["kick", "clapFilter", "clap", "hat", "openHat", "perc", "bass", "chords", "stab", "noise"];
  const scheduleAhead = { foreground: .12, background: 3 };
  let engine = null, running = false, raf = 0, toastTimer;
  let journeyFlavor = "deep", journeyEnergy = .58, journeyCount = 0;

  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const chance = (p) => Math.random() < p;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const midiNote = (m) => Tone.Frequency(m, "midi").toNote();

  function makeScene() {
    if (journeyCount && chance(.16)) journeyFlavor = pick(["deep", "classic", "disco", "acid"].filter(x => x !== journeyFlavor));
    const flavor = journeyFlavor;
    const root = pick(roots);
    journeyEnergy = clamp(journeyEnergy + (Math.random() - .46) * .22, .38, .86);
    const energy = journeyEnergy;
    journeyCount++;
    const bpmBase = { deep: 120, classic: 124, disco: 122, acid: 126 }[flavor];
    const progression = pick(progressions);
    const kickSkip = chance(.35) ? pick([7, 14, 15]) : -1;
    const bassMask = Array.from({ length: 16 }, (_, i) => (i % 4 === 2 || (i % 4 === 3 && chance(.42)) || (i === 11 && chance(.6))));
    const hatMask = Array.from({ length: 16 }, (_, i) => i % 2 === 1 && (chance(.88) || i % 4 === 2));
    const percMask = Array.from({ length: 16 }, (_, i) => chance(.12 + energy * .13) && i % 4 !== 0);
    return {
      flavor, root, rootMidi: 36 + semis[root], energy,
      bpm: bpmBase + Math.floor(Math.random() * 5) - 2,
      name: pick(names[flavor]), phase: pick(phases), progression,
      kickSkip, bassMask, hatMask, percMask,
      bassOctave: chance(.28) ? 12 : 0,
      swing: .52 + Math.random() * .12,
      chordType: flavor === "disco" ? 2 : pick([0, 0, 1, 2]),
      brightness: .35 + Math.random() * .55, room: .24 + Math.random() * .32,
      bars: pick([24, 32, 32, 40])
    };
  }

  function createVoices(drumBus, bassBus, musicBus, delay, reverb) {
    const kick = new Tone.MembraneSynth({ pitchDecay: .025, octaves: 6, oscillator: { type: "sine" }, envelope: { attack: .001, decay: .28, sustain: .01, release: .12 } }).connect(drumBus);
    const clapFilter = new Tone.Filter(1800, "highpass").connect(drumBus);
    const clap = new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: .001, decay: .11, sustain: 0 } }).connect(clapFilter);
    const hat = new Tone.MetalSynth({ frequency: 220, envelope: { attack: .001, decay: .055, release: .01 }, harmonicity: 5.1, modulationIndex: 24, resonance: 3100, octaves: 1.3, volume: -14 }).connect(drumBus);
    const openHat = new Tone.MetalSynth({ frequency: 185, envelope: { attack: .001, decay: .24, release: .04 }, harmonicity: 5.1, modulationIndex: 20, resonance: 2800, octaves: 1.2, volume: -17 }).connect(drumBus);
    const perc = new Tone.MembraneSynth({ pitchDecay: .008, octaves: 2, envelope: { attack: .001, decay: .09, sustain: 0, release: .03 }, volume: -13 }).connect(drumBus);
    const bass = new Tone.MonoSynth({ oscillator: { type: "square" }, filter: { Q: 2, type: "lowpass", rolloff: -24 }, envelope: { attack: .008, decay: .15, sustain: .18, release: .09 }, filterEnvelope: { attack: .005, decay: .16, sustain: .2, release: .1, baseFrequency: 80, octaves: 2.8 }, volume: -3 }).connect(bassBus);
    const chords = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle8" }, envelope: { attack: .018, decay: .22, sustain: .08, release: .65 }, volume: -8 }).connect(musicBus);
    const stab = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: .006, decay: .08, sustain: 0, release: .16 }, volume: -13 }).connect(musicBus);
    stab.connect(delay);
    const noise = new Tone.NoiseSynth({ noise: { type: "brown" }, envelope: { attack: .3, decay: 1.4, sustain: 0, release: .4 }, volume: -20 }).connect(reverb);
    return { kick, clapFilter, clap, hat, openHat, perc, bass, chords, stab, noise };
  }

  function buildEngine() {
    const master = new Tone.Gain(0.78);
    const lowCut = new Tone.Filter(28, "highpass");
    const compressor = new Tone.Compressor({ threshold: -16, ratio: 3, attack: .02, release: .22, knee: 12 });
    const limiter = new Tone.Limiter(-1);
    master.chain(lowCut, compressor, limiter, Tone.getDestination());
    const analyser = new Tone.Analyser("fft", 64);
    master.connect(analyser);

    const drumBus = new Tone.Channel({ volume: -3 }).connect(master);
    const bassFilter = new Tone.Filter(700, "lowpass", -24);
    const bassBus = new Tone.Channel({ volume: -7 }).connect(bassFilter);
    bassFilter.connect(master);
    const musicFilter = new Tone.Filter(2600, "lowpass", -12);
    const musicBus = new Tone.Channel({ volume: -12 }).connect(musicFilter);
    musicFilter.connect(master);

    const reverb = new Tone.Reverb({ decay: 3.2, preDelay: .035, wet: .28 }).connect(master);
    const delay = new Tone.PingPongDelay(.375, .28).connect(reverb);
    const send = new Tone.Gain(.18).connect(reverb);
    musicBus.connect(send);
    const voices = createVoices(drumBus, bassBus, musicBus, delay, reverb);

    return {
      master, analyser, drumBus, bassBus, musicBus, bassFilter, musicFilter, reverb, delay, ...voices,
      retiredVoices: [], scene: null, pendingScene: null, transitionStep: -1,
      step: 0, bar: 0, chordIndex: 0, transition: false,
      nextStepTime: 0, bpmFrom: 120, targetBpm: 120, bpmRampStart: 0, bpmRampEnd: 0,
      schedulerWorker: null, schedulerUrl: null
    };
  }

  function sceneChord(scene, degree, octave = 60) {
    const root = octave + semis[scene.root];
    const base = root + minor[degree];
    return chordTypes[scene.chordType].map(n => midiNote(base + n));
  }

  function ramp(parameter, value, duration, time) {
    if (time === undefined) parameter.rampTo(value, duration);
    else parameter.rampTo(value, duration, time);
  }

  function tempoAt(time) {
    const e = engine;
    if (!e || time >= e.bpmRampEnd) return e?.targetBpm || 120;
    if (time <= e.bpmRampStart) return e.bpmFrom;
    const progress = (time - e.bpmRampStart) / (e.bpmRampEnd - e.bpmRampStart);
    return e.bpmFrom + (e.targetBpm - e.bpmFrom) * progress;
  }

  function applyScene(scene, first = false, time) {
    const e = engine, at = time === undefined ? Tone.immediate() : time;
    const currentTempo = tempoAt(at);
    e.scene = scene;
    e.bpmFrom = currentTempo;
    e.targetBpm = scene.bpm;
    e.bpmRampStart = at;
    e.bpmRampEnd = at + (first ? .1 : 8);
    ramp(e.bassFilter.frequency, 260 + scene.energy * 1050 + (scene.flavor === "acid" ? 800 : 0), first ? .1 : 6, time);
    ramp(e.musicFilter.frequency, 900 + scene.brightness * 4600, first ? .1 : 7, time);
    ramp(e.drumBus.volume, -7 + scene.energy * 6, 5, time);
    ramp(e.bassBus.volume, -11 + scene.energy * 6, 5, time);
    ramp(e.musicBus.volume, -17 + scene.energy * 8, 7, time);
    ramp(e.reverb.wet, scene.room, first ? .1 : 8, time);
    ramp(e.delay.delayTime, 45 / scene.bpm, first ? .1 : 8, time);
    if (time === undefined) updateMeta();
    else Tone.getDraw().schedule(updateMeta, time);
  }

  function scheduleStep(time) {
    const e = engine;
    if (e.transition && e.step === e.transitionStep) completeTransition(time);
    const s = e.scene, step = e.step % 16;
    const beat = Math.floor(step / 4), bar = e.bar;
    const energy = s.energy, quarter = 60 / tempoAt(time);

    if (step % 4 === 0 && step !== s.kickSkip) e.kick.triggerAttackRelease("C1", quarter * .5, time, .78 + energy * .2);
    if (step === 4 || step === 12) e.clap.triggerAttackRelease(quarter * .25, time, .58 + energy * .25);
    if (s.hatMask[step] && !(bar % 8 === 7 && step > 11)) e.hat.triggerAttackRelease(quarter * .125, time, .24 + Math.random() * .22);
    if (step === 6 || (step === 14 && energy > .45)) e.openHat.triggerAttackRelease(quarter * .25, time, .2 + energy * .2);
    if (s.percMask[step]) e.perc.triggerAttackRelease(pick(["G2", "A2", "D3"]), quarter * .125, time, .28);

    if (s.bassMask[step]) {
      const degree = step === 11 && chance(.45) ? pick([3, 4, 5]) : s.progression[beat];
      const note = s.rootMidi + minor[degree] + s.bassOctave;
      const adjacentHit = s.bassMask[(step + 1) % 16];
      const duration = quarter * (adjacentHit ? .125 : (step % 4 === 3 ? .25 : .5));
      e.bass.triggerAttackRelease(midiNote(note), duration, time, .52 + energy * .28);
    }

    if (step === 0 && bar % 2 === 0) {
      const degree = s.progression[Math.floor(bar / 2) % 4];
      e.chords.triggerAttackRelease(sceneChord(s, degree), quarter * (s.flavor === "deep" ? 4 : 2), time, .25 + energy * .15);
    }
    if ((step === 3 || step === 10) && energy > .48 && chance(.62)) {
      const degree = s.progression[beat];
      e.stab.triggerAttackRelease(sceneChord(s, degree, 72), quarter * .25, time, .16 + energy * .14);
    }

    if (step === 0) {
      if (bar > 0 && bar % 8 === 7) e.noise.triggerAttackRelease(quarter * 2, time, .12 + energy * .14);
      e.bar++;
      Tone.getDraw().schedule(updateProgress, time);
      if (e.bar >= s.bars && !e.transition) transitionScene(time);
    }
    e.step++;
  }

  function schedulerTick() {
    const e = engine;
    if (!running || !e || Tone.getContext().state !== "running") return;
    const now = Tone.immediate();
    disposeRetiredVoices(now);

    // Never replay a backlog after the tab or main thread was suspended.
    if (e.nextStepTime < now - .05) e.nextStepTime = now + .05;

    const hidden = document.hidden;
    const horizon = now + (hidden ? scheduleAhead.background : scheduleAhead.foreground);
    const maxBatch = hidden ? 40 : 4;
    let scheduled = 0;
    while (e.nextStepTime < horizon && scheduled < maxBatch) {
      const time = e.nextStepTime, step = e.step % 16;
      scheduleStep(time);
      const sixteenth = 15 / tempoAt(time), swing = e.scene.swing;
      e.nextStepTime += sixteenth * (step % 2 === 0 ? 2 * swing : 2 * (1 - swing));
      scheduled++;
    }
    if (scheduled === maxBatch && e.nextStepTime < horizon) e.nextStepTime = now + .05;
  }

  function schedule() {
    const e = engine;
    e.nextStepTime = Tone.immediate() + .1;
    const source = `
      let active = false, timer = 0;
      const queue = () => { timer = setTimeout(() => { if (active) postMessage("tick"); }, 25); };
      onmessage = ({ data }) => {
        if (data === "start" && !active) { active = true; postMessage("tick"); }
        else if (data === "ack" && active) queue();
        else if (data === "stop") { active = false; clearTimeout(timer); }
      };
    `;
    e.schedulerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    e.schedulerWorker = new Worker(e.schedulerUrl);
    e.schedulerWorker.onmessage = () => {
      try { schedulerTick(); }
      catch (err) { console.error(err); }
      finally { if (running) e.schedulerWorker.postMessage("ack"); }
    };
    e.schedulerWorker.postMessage("start");
  }

  function transitionScene(time) {
    const e = engine;
    e.transition = true;
    const next = makeScene();
    e.pendingScene = next;
    e.transitionStep = e.step + 16;
    ramp(e.musicFilter.frequency, 420, 3.5, time);
    ramp(e.bassBus.volume, -22, 3.2, time);
    Tone.getDraw().schedule(() => showToast("MIXING INTO " + next.name.toUpperCase()), time);
  }

  function rotateVoices(time) {
    const e = engine;
    const previous = Object.fromEntries(voiceKeys.map(key => [key, e[key]]));
    Object.assign(e, createVoices(e.drumBus, e.bassBus, e.musicBus, e.delay, e.reverb));
    e.retiredVoices.push({ voices: previous, disposeAt: time + 4 });
  }

  function disposeRetiredVoices(time) {
    const e = engine;
    e.retiredVoices = e.retiredVoices.filter(entry => {
      if (entry.disposeAt > time) return true;
      voiceKeys.forEach(key => entry.voices[key].dispose());
      return false;
    });
  }

  function completeTransition(time) {
    const e = engine, next = e.pendingScene;
    e.bar = 0; e.chordIndex = 0;
    rotateVoices(time);
    applyScene(next, false, time);
    e.noise.triggerAttackRelease(60 / next.bpm * 4, time, .16);
    e.pendingScene = null;
    e.transitionStep = -1;
    e.transition = false;
  }

  async function start() {
    if (running) return;
    ui.start.disabled = true;
    ui.start.querySelector("b").textContent = "TUNING THE ROOM…";
    try {
      Tone.setContext(new Tone.Context({ clockSource: "timeout", latencyHint: "playback", lookAhead: .1, updateInterval: .05 }), true);
      await Tone.start();
      engine = buildEngine();
      applyScene(makeScene(), true);
      running = true;
      schedule();
      document.body.classList.add("started");
      draw();
      showToast("SESSION LIVE");
      setTimeout(() => $("#console").scrollIntoView({ behavior: "smooth", block: "end" }), 450);
    } catch (err) {
      console.error(err);
      running = false;
      engine?.schedulerWorker?.terminate();
      if (engine?.schedulerUrl) URL.revokeObjectURL(engine.schedulerUrl);
      ui.start.disabled = false;
      ui.start.querySelector("b").textContent = "TRY AGAIN";
      showToast("AUDIO COULD NOT START");
    }
  }

  function updateMeta() {
    if (!engine?.scene) return;
    const s = engine.scene;
    ui.scene.textContent = s.name; ui.bpm.textContent = s.bpm; ui.key.textContent = s.root + " MIN"; ui.phase.textContent = s.phase;
  }
  function updateProgress() {
    const s = engine.scene, bar = Math.min(engine.bar, s.bars), left = Math.max(0, s.bars - bar);
    ui.bar.textContent = `BAR ${String(bar || 1).padStart(2, "0")} / ${s.bars}`;
    ui.next.textContent = engine.transition ? "TRANSITION IN PROGRESS" : `NEXT EVOLUTION IN ${left} BAR${left === 1 ? "" : "S"}`;
    ui.fill.style.width = `${bar / s.bars * 100}%`;
  }
  function showToast(message) {
    ui.toast.textContent = message; ui.toast.classList.add("show"); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 1900);
  }

  ui.start.addEventListener("click", start);

  const ctx = ui.canvas.getContext("2d");
  function draw() {
    const c = ui.canvas, rect = c.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
    // Canvas dimensions are integers. Comparing them with fractional CSS pixel
    // values caused the backing store to be reallocated on every frame at many
    // Windows display scales, eventually making the page appear frozen.
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (c.width !== pixelWidth || c.height !== pixelHeight) { c.width = pixelWidth; c.height = pixelHeight; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const values = engine?.analyser ? engine.analyser.getValue() : new Float32Array(96).fill(-100);
    const count = 48, gap = 5, usable = rect.width * .48, barW = Math.max(2, (usable - gap * count) / count), startX = rect.width * .56;
    ctx.save(); ctx.translate(0, rect.height / 2); ctx.fillStyle = "rgba(216,255,62,.44)";
    for (let i = 0; i < count; i++) {
      const value = clamp((values[i] + 100) / 76, 0.015, 1), h = value * rect.height * .34;
      ctx.fillRect(startX + i * (barW + gap), -h, barW, h * 2);
    }
    ctx.restore();
    if (running) raf = requestAnimationFrame(draw);
  }
  draw();
  window.addEventListener("resize", () => { if (!running) draw(); });
  document.addEventListener("visibilitychange", () => {
    if (!running) return;
    if (document.hidden) {
      // Fill the wider buffer before Chrome begins background throttling.
      schedulerTick();
    } else {
      Tone.start().then(() => {
        schedulerTick();
        updateMeta();
        updateProgress();
      });
    }
  });
})();
