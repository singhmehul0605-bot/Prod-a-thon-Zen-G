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

  // this whole widget (counter, swap, change-city, pay) is homepage-only —
  // other pages that share this script just skip it
  const hasSearchWidget = counterValueEl && payAmountEl && minusBtn && plusBtn;
  if (hasSearchWidget) {
    minusBtn.addEventListener("click", () => bumpPassengers(-1));
    plusBtn.addEventListener("click", () => bumpPassengers(1));
  }

  /* ---------------------------------------------------------------
   * Swap From / To — spin the button with a spring, cross-fade values
   * ------------------------------------------------------------- */
  const swapBtn = document.getElementById("swapBtn");
  const fromValueEl = document.getElementById("fromValue");
  const toValueEl = document.getElementById("toValue");

  let swapRotation = 0;

  if (swapBtn && fromValueEl && toValueEl) {
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
  }

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

  // pages without a video hero (e.g. bus-buddy.html's static promo banner)
  // skip ambient sampling and the drag-carousel entirely
  if (heroVideo && canvas) {
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
   * Hero slider — draggable 3-panel (prev/current/next) carousel that
   * auto-advances every 10s. Shared across every page that reuses the
   * hero component verbatim, so the homepage and the ticket page get
   * the same content and the same physics.
   *
   * Direct manipulation: the track follows the pointer 1:1 while
   * dragging, a release hands off the gesture's velocity into a
   * momentum projection (Apple's decay formula) to decide which panel
   * it settles on, and grabbing again mid-settle reads the track's
   * live position rather than its target — so it never jumps.
   * ------------------------------------------------------------- */
  const HERO_SLIDES = [
    {
      video: "assets/hero-video.mp4",
      title: "Take metro to Coldplay",
      subtitle: "Happening on 5 Aug at NICE Grounds",
    },
    {
      video: "assets/hero-video-2.mp4",
      title: "Take metro to Harris Jayaraj",
      subtitle: "Happening on 12 Aug at NICE Grounds",
    },
  ];
  const SLIDE_INTERVAL = 10000;

  const heroOverlay = document.querySelector(".hero__overlay");
  const heroTrack = document.getElementById("heroTrack");
  const heroTrackRow = document.getElementById("heroTrackRow");
  const heroDotsEl = document.querySelector(".hero__dots");
  const heroSource = heroVideo.querySelector("source");
  const panelEls = heroTrackRow ? Array.from(heroTrackRow.children) : [];

  if (heroOverlay && heroTrack && heroTrackRow && heroDotsEl && heroSource && panelEls.length === 3 && HERO_SLIDES.length > 1) {
    const N = HERO_SLIDES.length;
    const mod = (n) => ((n % N) + N) % N;

    // dots are generated to match the real slide count, rather than a
    // fixed markup that could drift out of sync with the data above
    heroDotsEl.innerHTML = "";
    const dotEls = HERO_SLIDES.map((_, i) => {
      const dot = document.createElement("span");
      dot.className = i === 0 ? "dot dot--active" : "dot";
      dot.addEventListener("click", () => {
        // the 3-panel window only ever hops one slide at a time, so a
        // click jumps toward whichever neighbour that panel actually is
        if (i === currentIndex) return;
        if (i === mod(currentIndex + 1)) goRelative(1);
        else if (i === mod(currentIndex - 1)) goRelative(-1);
      });
      heroDotsEl.appendChild(dot);
      return dot;
    });

    let currentIndex = 0;
    let trackWidth = heroTrack.getBoundingClientRect().width;
    let liveX = -trackWidth; // presentation value — always the source of truth
    let activeAnim = null;
    let slideTimer = null;
    let pointerId = null;
    let startClientX = 0;
    let startX = 0;
    let history = [];

    window.addEventListener("resize", () => {
      const prevWidth = trackWidth;
      trackWidth = heroTrack.getBoundingClientRect().width;
      const wasIdle = pointerId === null && !activeAnim;
      if (activeAnim) {
        activeAnim.cancel();
        activeAnim = null;
      }
      // rescale the live position proportionally rather than re-centring
      // outright — keeps mid-drag/mid-settle state visually consistent
      setX(wasIdle ? -trackWidth : (liveX / prevWidth) * trackWidth);
    });

    function renderPanels() {
      [-1, 0, 1].forEach((offset, panelI) => {
        const slide = HERO_SLIDES[mod(currentIndex + offset)];
        panelEls[panelI].querySelector(".hero__title").textContent = slide.title;
        panelEls[panelI].querySelector(".hero__subtitle").textContent = slide.subtitle;
      });
      dotEls.forEach((d, i) => d.classList.toggle("dot--active", i === currentIndex));
    }

    function setX(px) {
      liveX = px;
      heroTrackRow.style.transform = `translateX(${px}px)`;
      // dim the video toward whichever neighbour is being revealed —
      // continuous, 1:1 feedback during the gesture, not just at release
      const drag = Math.min(1, Math.abs(px - -trackWidth) / trackWidth);
      heroVideo.style.opacity = String(1 - drag * 0.85);
    }

    function loadSlide(i) {
      const slide = HERO_SLIDES[i];
      heroSource.setAttribute("src", slide.video);
      heroVideo.load();
      if (!prefersReducedMotion()) heroVideo.play().catch(() => {});
    }

    // Apple's momentum-projection formula (Designing Fluid Interfaces, WWDC18):
    // where a flick "would" land if it kept decelerating naturally.
    function project(velocity, decel = 0.998) {
      return (velocity / 1000) * decel / (1 - decel);
    }

    function settle(targetOffset, velocity) {
      if (activeAnim) activeAnim.cancel();
      const target = -trackWidth * (1 + targetOffset);
      const changed = targetOffset !== 0;

      if (prefersReducedMotion()) {
        setX(target);
        finishSettle(targetOffset, changed);
        return;
      }
      const flicked = Math.abs(velocity) > 60;
      activeAnim = spring({
        from: liveX,
        to: target,
        velocity,
        damping: flicked ? 0.8 : 1,
        response: flicked ? 0.4 : 0.32,
        onUpdate: setX,
        onDone: () => finishSettle(targetOffset, changed),
      });
    }

    function finishSettle(targetOffset, changed) {
      activeAnim = null;
      if (!changed) return;
      currentIndex = mod(currentIndex + targetOffset);
      renderPanels();
      setX(-trackWidth); // re-centre the window — content already matches
      loadSlide(currentIndex);
    }

    function goRelative(offset) {
      settle(offset, 0);
    }

    function velocityFromHistory() {
      if (history.length < 2) return 0;
      const last = history[history.length - 1];
      const first = history[0];
      const dt = last.t - first.t;
      return dt > 0 ? ((last.x - first.x) / dt) * 1000 : 0;
    }

    function onPointerDown(e) {
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      try {
        heroTrack.setPointerCapture(pointerId);
      } catch (err) {}
      if (activeAnim) activeAnim.cancel(); // grab it mid-flight, from where it visually is
      startClientX = e.clientX;
      startX = liveX;
      history = [{ x: e.clientX, t: performance.now() }];
      stopSlider();
    }

    function onPointerMove(e) {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - startClientX;
      const next = Math.max(-2 * trackWidth, Math.min(0, startX + dx));
      setX(next);
      history.push({ x: e.clientX, t: performance.now() });
      if (history.length > 6) history.shift();
    }

    function onPointerUp(e) {
      if (e.pointerId !== pointerId) return;
      // capture can already be gone (e.g. lost to a scroll) — release is
      // best-effort cleanup, never a reason to abort the settle below
      try {
        heroTrack.releasePointerCapture(pointerId);
      } catch (err) {}
      pointerId = null;

      const velocity = velocityFromHistory();
      const projected = liveX + project(velocity);
      const candidates = [0, -trackWidth, -2 * trackWidth];
      const nearest = candidates.reduce((a, b) =>
        Math.abs(b - projected) < Math.abs(a - projected) ? b : a
      );
      // candidates are trackWidth * {0, -1, -2} for {prev, current, next};
      // map back to a -1/0/+1 offset relative to the current index
      const targetOffset = Math.round(-1 * (nearest / trackWidth + 1));
      settle(targetOffset, velocity);
      startSlider();
    }

    heroTrack.addEventListener("pointerdown", onPointerDown);
    heroTrack.addEventListener("pointermove", onPointerMove);
    heroTrack.addEventListener("pointerup", onPointerUp);
    heroTrack.addEventListener("pointercancel", onPointerUp);

    function startSlider() {
      if (slideTimer || prefersReducedMotion()) return;
      slideTimer = setInterval(() => goRelative(1), SLIDE_INTERVAL);
    }
    function stopSlider() {
      clearInterval(slideTimer);
      slideTimer = null;
    }

    renderPanels();
    setX(-trackWidth);
    startSlider();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopSlider();
      else if (pointerId === null) startSlider();
    });
  }
  } // end if (heroVideo && canvas)

  /* ---------------------------------------------------------------
   * Change city / T&C — placeholders until those flows exist
   * ------------------------------------------------------------- */
  const changeCityBtn = document.getElementById("changeCity");
  const payBtn = document.getElementById("payBtn");
  if (changeCityBtn) {
    changeCityBtn.addEventListener("click", () => {
      console.info("Change city tapped — wire up the city picker sheet here.");
    });
  }
  if (payBtn) {
    payBtn.addEventListener("click", () => {
      window.location.href = "metro-buddy.html";
    });
  }

  const searchBusesBtn = document.getElementById("searchBusesBtn");
  if (searchBusesBtn) {
    searchBusesBtn.addEventListener("click", () => {
      window.location.href = "bus-buddy.html";
    });
  }

  if (hasSearchWidget) renderCounter();

  /* ---------------------------------------------------------------
   * Ticket details page — close button + copy-to-clipboard
   * ------------------------------------------------------------- */
  const ticketClose = document.getElementById("ticketClose");
  if (ticketClose) {
    ticketClose.addEventListener("click", () => {
      if (document.referrer) window.history.back();
      else window.location.href = ticketClose.dataset.back || "metro-home.html";
    });
  }

  /* ---------------------------------------------------------------
   * Bus Buddy tabs — only "Ticket details" has content in this build,
   * so the rest just take the active state without swapping a panel
   * ------------------------------------------------------------- */
  const busTabs = document.querySelectorAll(".bus-tab");
  busTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      busTabs.forEach((t) => t.classList.toggle("bus-tab--active", t === tab));
      tab.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    });
  });

  /* ---------------------------------------------------------------
   * Bus homepage — day pills + woman-mode toggle
   * ------------------------------------------------------------- */
  const dayPills = document.querySelectorAll(".bh-daypill");
  dayPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      dayPills.forEach((p) => p.classList.toggle("bh-daypill--active", p === pill));
    });
  });

  const bhToggle = document.querySelector(".bh-toggle");
  if (bhToggle) {
    bhToggle.addEventListener("click", () => {
      const on = bhToggle.getAttribute("aria-checked") === "true";
      bhToggle.setAttribute("aria-checked", String(!on));
    });
  }

  document.querySelectorAll(".copy-btn[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.classList.add("is-copied");
        setTimeout(() => btn.classList.remove("is-copied"), 900);
      } catch {
        /* clipboard permission denied — no-op */
      }
    });
  });
})();
