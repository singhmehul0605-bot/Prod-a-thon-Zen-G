(() => {
  "use strict";

  const prefersReducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------------
   * Sticky bottom nav — keep a --nav-height custom property in sync
   * so the sheet can pad itself clear of the fixed bar underneath.
   * Measured rather than computed in CSS because it depends on
   * env(safe-area-inset-bottom), which a sibling can't read directly.
   * ------------------------------------------------------------- */
  const bottomNav = document.querySelector(".bottomnav");
  if (bottomNav && "ResizeObserver" in window) {
    const syncNavHeight = () => {
      document.documentElement.style.setProperty(
        "--nav-height",
        `${bottomNav.getBoundingClientRect().height}px`
      );
    };
    new ResizeObserver(syncNavHeight).observe(bottomNav);
    syncNavHeight();
  }

  /* ---------------------------------------------------------------
   * Minimal critically-damped spring (Apple's damping/response model).
   * Used anywhere a value should settle continuously rather than jump
   * or run a fixed-duration CSS transition — interruptible mid-flight.
   * ------------------------------------------------------------- */
  function spring({ from = 0, to = 1, damping = 1, response = 0.35, velocity = 0, onUpdate, onDone }) {
    if (prefersReducedMotion()) {
      onUpdate(to);
      onDone && onDone();
      return { cancel() {} };
    }
    const stiffness = (2 * Math.PI / response) ** 2;
    const dampingCoef = 2 * damping * Math.sqrt(stiffness);
    let value = from;
    let v = velocity;
    let raf = null;
    let last = performance.now();

    function tick(now) {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const force = -stiffness * (value - to) - dampingCoef * v;
      v += force * dt;
      value += v * dt;
      onUpdate(value);

      const settled = Math.abs(to - value) < 0.001 && Math.abs(v) < 0.001;
      if (settled) {
        onUpdate(to);
        onDone && onDone();
        return;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return { cancel() { raf && cancelAnimationFrame(raf); } };
  }

  /* ---------------------------------------------------------------
   * Passenger counter
   * ------------------------------------------------------------- */
  const PRICE_PER_PERSON = 60;
  const MIN_PASSENGERS = 1;
  const MAX_PASSENGERS = 6;

  const counterValueEl = document.getElementById("counterValue");
  const payAmountEl = document.getElementById("payAmount");
  const minusBtn = document.getElementById("counterMinus");
  const plusBtn = document.getElementById("counterPlus");

  let passengers = MIN_PASSENGERS;

  function renderCounter() {
    counterValueEl.textContent = String(passengers);
    payAmountEl.textContent = String(passengers * PRICE_PER_PERSON);
    minusBtn.disabled = passengers <= MIN_PASSENGERS;
    plusBtn.disabled = passengers >= MAX_PASSENGERS;

    counterValueEl.classList.remove("is-popping");
    // restart the animation on the next frame
    requestAnimationFrame(() => counterValueEl.classList.add("is-popping"));
  }

  function bumpPassengers(delta) {
    const next = Math.min(MAX_PASSENGERS, Math.max(MIN_PASSENGERS, passengers + delta));
    if (next === passengers) return;
    passengers = next;
    renderCounter();
  }

  minusBtn.addEventListener("click", () => bumpPassengers(-1));
  plusBtn.addEventListener("click", () => bumpPassengers(1));

  /* ---------------------------------------------------------------
   * Swap From / To — spin the button with a spring, cross-fade values
   * ------------------------------------------------------------- */
  const swapBtn = document.getElementById("swapBtn");
  const fromValueEl = document.getElementById("fromValue");
  const toValueEl = document.getElementById("toValue");

  let swapRotation = 0;

  swapBtn.addEventListener("click", () => {
    const target = swapRotation + 180;

    spring({
      from: swapRotation,
      to: target,
      damping: 0.8,
      response: 0.4,
      onUpdate(v) {
        swapBtn.style.transform = `rotate(${v}deg)`;
      },
      onDone() {
        swapRotation = target % 360;
      },
    });

    spring({
      from: 1,
      to: 0,
      damping: 1,
      response: 0.16,
      onUpdate(v) {
        fromValueEl.style.opacity = v;
        toValueEl.style.opacity = v;
      },
      onDone() {
        const tmp = fromValueEl.textContent;
        fromValueEl.textContent = toValueEl.textContent;
        toValueEl.textContent = tmp;

        spring({
          from: 0,
          to: 1,
          damping: 1,
          response: 0.22,
          onUpdate(v) {
            fromValueEl.style.opacity = v;
            toValueEl.style.opacity = v;
          },
        });
      },
    });
  });

  /* ---------------------------------------------------------------
   * Top nav tab switching — indicator + label weight follow the tap
   * ------------------------------------------------------------- */
  const tabs = Array.from(document.querySelectorAll(".tab"));
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => {
        t.classList.toggle("tab--active", t === tab);
        t.setAttribute("aria-selected", String(t === tab));
      });
    });
  });

  /* ---------------------------------------------------------------
   * Bottom nav — active state follows the tap (mock destinations)
   * ------------------------------------------------------------- */
  const bnavItems = Array.from(document.querySelectorAll(".bnav-item"));
  bnavItems.forEach((item) => {
    item.addEventListener("click", () => {
      bnavItems.forEach((i) => i.classList.toggle("bnav-item--active", i === item));
    });
  });

  /* ---------------------------------------------------------------
   * Ambient mode
   * Paints the current video frame into a tiny canvas that CSS blurs
   * and scales up behind the page (the YouTube ambient-mode trick),
   * then samples that frame to drive the page's colour wash so the
   * whole surface glows with whatever is on screen.
   * ------------------------------------------------------------- */
  const heroVideo = document.getElementById("heroVideo");
  const canvas = document.getElementById("ambientCanvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const SAMPLE_INTERVAL = 90;   // ms between frames — ~11fps is plenty once blurred
  const SMOOTHING = 0.12;       // per-sample lerp toward the new colour
  const BANDS = ["--amb-top", "--amb-mid", "--amb-bottom"];

  let canSample = true;
  let running = false;
  let lastSample = 0;
  let rafId = null;

  // live values, lerped toward the sampled target so colours drift instead of cutting
  const current = [[58, 24, 28], [36, 16, 20], [20, 12, 16]];

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [h, s, l];
  }

  function hueToRgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function hslToRgb(h, s, l) {
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      hueToRgb(p, q, h + 1 / 3) * 255,
      hueToRgb(p, q, h) * 255,
      hueToRgb(p, q, h - 1 / 3) * 255,
    ];
  }

  // Push saturation up and pin lightness into a usable band, the way ambient
  // lighting reads on screen — a literal average is muddy and too bright.
  function vivify(r, g, b) {
    const [h, s, l] = rgbToHsl(r, g, b);
    return hslToRgb(h, Math.min(1, s * 1.5 + 0.08), Math.min(0.55, Math.max(0.12, l)));
  }

  function sampleBand(data, width, fromRow, toRow) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = fromRow; y < toRow; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2];
        n++;
      }
    }
    return vivify(r / n, g / n, b / n);
  }

  function updateColours() {
    const { width, height } = canvas;
    let data;
    try {
      data = ctx.getImageData(0, 0, width, height).data;
    } catch {
      canSample = false;   // cross-origin frame — keep the blurred canvas, drop sampling
      return;
    }

    const third = Math.floor(height / 3);
    const targets = [
      sampleBand(data, width, 0, third),
      sampleBand(data, width, third, third * 2),
      sampleBand(data, width, third * 2, height),
    ];

    targets.forEach((target, i) => {
      const live = current[i];
      for (let c = 0; c < 3; c++) {
        live[c] += (target[c] - live[c]) * SMOOTHING;
      }
      document.documentElement.style.setProperty(
        BANDS[i],
        live.map((v) => Math.round(v)).join(", ")
      );
    });
  }

  function frame(now) {
    if (!running) return;
    if (now - lastSample >= SAMPLE_INTERVAL && heroVideo.readyState >= 2) {
      lastSample = now;
      ctx.drawImage(heroVideo, 0, 0, canvas.width, canvas.height);
      if (canSample) updateColours();
    }
    rafId = requestAnimationFrame(frame);
  }

  function startAmbient() {
    if (running || prefersReducedMotion()) return;
    running = true;
    rafId = requestAnimationFrame(frame);
  }

  function stopAmbient() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  heroVideo.addEventListener("playing", startAmbient);
  heroVideo.addEventListener("pause", stopAmbient);
  heroVideo.addEventListener("ended", stopAmbient);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAmbient();
    else if (!heroVideo.paused) startAmbient();
  });

  // Don't burn frames on an off-screen hero
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !heroVideo.paused) startAmbient();
        else if (!entry.isIntersecting) stopAmbient();
      },
      { threshold: 0.01 }
    ).observe(document.getElementById("hero"));
  }

  if (prefersReducedMotion()) {
    heroVideo.removeAttribute("autoplay");
    heroVideo.pause();
  } else {
    heroVideo.play().catch(() => {
      /* autoplay refused — the poster stays up, ambient keeps its default tint */
    });
  }

  /* ---------------------------------------------------------------
   * Change city / T&C — placeholders until those flows exist
   * ------------------------------------------------------------- */
  document.getElementById("changeCity").addEventListener("click", () => {
    console.info("Change city tapped — wire up the city picker sheet here.");
  });
  document.getElementById("payBtn").addEventListener("click", () => {
    console.info("Pay tapped — wire up checkout here.");
  });

  renderCounter();
})();
