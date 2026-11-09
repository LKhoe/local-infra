// Effects for www.khoe.dev: particle title, card tilt/spotlight and the water transition when
// leaving for an app. Nothing is sent anywhere; without this script the page still works.
(() => {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const root = document.documentElement;

  // ---------------------------------------------------------------- particle title
  // The text is sampled from an offscreen canvas; each lit pixel (every `step` px) becomes a
  // particle that gathers into place, is pushed by the pointer, bursts on click and drifts at rest.
  const title = document.querySelector(".title");
  const canvas = document.querySelector(".title-canvas");
  const ctx = canvas && canvas.getContext("2d");
  if (title && ctx) {
    const TEXT = title.querySelector(".title-text").textContent.trim();
    const REST = [228, 231, 235];      // particle colour at rest
    const HOT = [159, 176, 196];       // colour while moving (muted steel blue)
    const opts = { gather: 1800, pour: 1100, drip: 380, repel: 42, radius: 110, drift: 0.7, size: 2.2 };
    let parts = [], W = 0, H = 0, CH = 0, dpr = 1, start = 0, raf = 0, running = false, played = false;
    const logo = document.querySelector(".logo");
    const ptr = { x: -1e4, y: -1e4 };

    root.classList.add("particles");

    // intro: the first time, particles pour out of the logo; later rebuilds (resize) just redraw.
    function build(intro = !played) {
      const cs = getComputedStyle(title);
      const fontSize = parseFloat(cs.fontSize);
      const font = `${cs.fontWeight} ${fontSize}px ${cs.fontFamily}`;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      // measure the text to size the canvas
      ctx.font = font;
      const m = ctx.measureText(TEXT);
      // full content width, so particles flying out to the sides are never clipped
      W = title.clientWidth || window.innerWidth;
      H = Math.ceil(fontSize * 1.35);
      if (!(W > 0 && H > 0)) return false;   // not laid out yet (e.g. a background tab): retry later

      // The canvas grows upward (negative margin, so the layout doesn't move) until it covers the
      // logo: the particles start behind the logo and drip out of it into the letters.
      canvas.style.marginTop = "0px";
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      const cr = canvas.getBoundingClientRect();
      const lr = logo ? logo.getBoundingClientRect() : null;
      const extra = lr && lr.width ? Math.max(0, Math.round(cr.top - (lr.top + lr.height * 0.25))) : 0;
      const below = 70;                       // room under the text for drops that overshoot
      CH = H + extra + below;
      canvas.width = W * dpr; canvas.height = CH * dpr;
      canvas.style.height = CH + "px"; canvas.style.marginTop = -extra + "px"; canvas.style.marginBottom = -below + "px";
      // logo box in canvas coordinates
      const L = lr && lr.width
        ? { x: lr.left + lr.width / 2 - cr.left, top: lr.top - cr.top + extra, w: lr.width, h: lr.height }
        : { x: W / 2, top: 0, w: W / 3, h: extra || H / 2 };

      // sample glyph pixels
      const off = document.createElement("canvas");
      off.width = W; off.height = H;
      const o = off.getContext("2d");
      o.font = font; o.textAlign = "center"; o.textBaseline = "middle"; o.fillStyle = "#fff";
      o.fillText(TEXT, W / 2, H / 2 + fontSize * 0.04);
      const data = o.getImageData(0, 0, W, H).data;
      const step = W < 360 ? 3 : 4;
      parts = [];
      for (let y = 0; y < H; y += step) {
        for (let x = 0; x < W; x += step) {
          if (data[(y * W + x) * 4 + 3] > 140) {
            const ty = y + extra;
            const pour = intro && !reduce;
            parts.push({
              tx: x, ty,
              // start inside the lower half of the logo (hidden behind it), slightly spread
              x: pour ? L.x + (Math.random() - 0.5) * L.w * 0.6 : x,
              y: pour ? L.top + L.h * (0.55 + Math.random() * 0.4) : ty,
              vx: pour ? (Math.random() - 0.5) * 0.8 : 0,
              vy: pour ? 1 + Math.random() * 1.5 : 0,
              delay: pour ? Math.random() * opts.pour : 0,
              ph: Math.random() * Math.PI * 2,
            });
          }
        }
      }
      makeSprites();
      start = performance.now();
      if (intro && !reduce && logo) {
        played = true;
        logo.classList.add("pouring");
        setTimeout(() => logo.classList.remove("pouring"), opts.pour + opts.drip + 300);
      }
      return true;
    }

    function init(tries = 0) {
      if (build()) run();
      else if (tries < 50) setTimeout(() => init(tries + 1), 200);
    }

    // Pre-rendered dot sprites: drawImage of a tiny bitmap is much cheaper than thousands of
    // arcs per frame, especially in Firefox, which draws canvas on the CPU on macOS.
    function sprite(px, paint) {
      const c = document.createElement("canvas");
      c.width = c.height = px;
      paint(c.getContext("2d"), px);
      return c;
    }
    let dotRest, dotHot, glow;
    function makeSprites() {
      const s = Math.ceil(opts.size * dpr) + 2;
      const dot = (rgb) => sprite(s, (g, n) => { g.fillStyle = `rgb(${rgb})`; g.beginPath(); g.arc(n / 2, n / 2, (opts.size * dpr) / 2, 0, Math.PI * 2); g.fill(); });
      dotRest = dot(REST); dotHot = dot(HOT);
      const gs = Math.ceil(opts.size * 4 * dpr);
      glow = sprite(gs, (g, n) => {
        const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
        gr.addColorStop(0, `rgba(${HOT}, 0.35)`); gr.addColorStop(1, `rgba(${HOT}, 0)`);
        g.fillStyle = gr; g.fillRect(0, 0, n, n);
      });
    }

    let last = 0, visible = true, calm = 0;
    function frame(now) {
      // Physics in "60 fps frames" of real time, so motion keeps its speed when frames drop.
      const dt = last ? Math.max(0, Math.min((now - last) / 16.667, 3)) : 1;
      last = now;
      const t = now - start;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const k = (0.06 + Math.min(t / opts.gather, 1) * 0.04) * dt;  // spring stiffens as the text forms
      const damp = Math.pow(0.8, dt);
      const R2 = opts.radius * opts.radius;
      const near = ptr.x > -opts.radius && ptr.x < W + opts.radius && ptr.y > -opts.radius && ptr.y < CH + opts.radius;
      const ds = dotRest.width / 2, gs = glow.width / 2;
      let moving = 0;
      for (const p of parts) {
        if (!reduce && t > p.delay) {
          const dx = opts.drift * Math.sin(now / 900 + p.ph), dy = opts.drift * Math.cos(now / 1100 + p.ph);
          const age = t - p.delay;
          if (age < opts.drip) {            // just left the logo: falls like a drop, spring barely pulls
            p.vy += 0.22 * dt;
            p.vx += (p.tx - p.x) * k * 0.15;
            p.vy += (p.ty - p.y) * k * 0.15;
          } else {
            p.vx += (p.tx + dx - p.x) * k;
            p.vy += (p.ty + dy - p.y) * k;
          }
          if (near) {
            const ex = p.x - ptr.x, ey = p.y - ptr.y, d2 = ex * ex + ey * ey;
            if (d2 < R2 && d2 > 0.01) {
              const d = Math.sqrt(d2), f = (1 - d / opts.radius) * opts.repel * 0.08 * dt;
              p.vx += (ex / d) * f; p.vy += (ey / d) * f;
            }
          }
          p.vx *= damp; p.vy *= damp;
          p.x += p.vx * dt; p.y += p.vy * dt;
        }
        if (t <= p.delay && !reduce) continue;   // still inside the logo
        const x = p.x * dpr, y = p.y * dpr;
        if (Math.abs(p.x - p.tx) + Math.abs(p.y - p.ty) > 3) {
          moving++;
          ctx.drawImage(glow, x - gs, y - gs);
          ctx.drawImage(dotHot, x - ds, y - ds);
        } else {
          ctx.drawImage(dotRest, x - ds, y - ds);
        }
      }
      // Once the text has formed and nothing is pushing it, stop redrawing (saves CPU/battery);
      // the pointer or a click starts it again.
      calm = (!moving && !near && t > opts.pour + opts.drip + 300) ? calm + 1 : 0;
      if (reduce || !visible || calm > 45) { running = false; return; }
      raf = requestAnimationFrame(frame);
    }

    // Pause while the title is scrolled out of view.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) run(); }).observe(canvas);
    }

    function run() {
      if (running || !parts.length) return;
      running = true; last = 0; calm = 0;
      raf = requestAnimationFrame(frame);
    }

    function toLocal(e) {
      const b = canvas.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    }
    if (!reduce) {
      window.addEventListener("pointermove", (e) => {
        const p = toLocal(e); ptr.x = p.x; ptr.y = p.y;
        if (p.x > -opts.radius && p.x < W + opts.radius && p.y > -opts.radius && p.y < CH + opts.radius) run();
      }, { passive: true });
      document.addEventListener("pointerleave", () => { ptr.x = ptr.y = -1e4; });
      title.addEventListener("pointerdown", (e) => {   // the canvas itself ignores the pointer
        const c = toLocal(e), R = opts.radius * 2;
        for (const p of parts) {
          const ex = p.x - c.x, ey = p.y - c.y, d = Math.hypot(ex, ey) || 1;
          if (d < R) { const f = (1 - d / R) * 22; p.vx += (ex / d) * f; p.vy += (ey / d) * f; }
        }
        run();
      });
      document.addEventListener("visibilitychange", () => {
        cancelAnimationFrame(raf); running = false;
        if (!document.hidden) run();
      });
    }

    const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    ready.then(() => init());
    let lastW = window.innerWidth, rt = 0;
    window.addEventListener("resize", () => {
      if (window.innerWidth === lastW) return;   // ignore mobile URL-bar height changes
      lastW = window.innerWidth;
      clearTimeout(rt);
      rt = setTimeout(() => { if (build()) { if (reduce) frame(performance.now()); else run(); } }, 150);
    });
  }

  // ---------------------------------------------------------------- card tilt + spotlight
  if (finePointer && !reduce) {
    document.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        card.style.setProperty("--mx", px * 100 + "%");
        card.style.setProperty("--my", py * 100 + "%");
        card.style.setProperty("--ry", (px - 0.5) * 10 + "deg");
        card.style.setProperty("--rx", (0.5 - py) * 10 + "deg");
      });
      card.addEventListener("pointerleave", () => {
        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
      });
    });
  }

  // ---------------------------------------------------------------- leaving: water dissolve
  const melt = document.getElementById("melt-map");
  const label = document.querySelector(".veil-label");
  let leaving = false;

  document.querySelectorAll(".card, .github").forEach((link) => {
    link.addEventListener("click", (e) => {
      if (reduce || leaving || e.defaultPrevented || e.button !== 0 ||
          e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      leaving = true;
      const name = link.querySelector(".name");
      label.textContent = name ? name.textContent : "GitHub";
      root.classList.add("leaving");
      const t0 = performance.now(), dur = 900;
      const step = (now) => {
        const k = Math.min((now - t0) / dur, 1);
        if (melt) melt.setAttribute("scale", String(Math.round(180 * k * k)));
        if (k < 1 && leaving) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      setTimeout(() => { window.location.href = link.href; }, 1000);
    });
  });

  // Back button (bfcache): undo the transition so the page isn't left dissolved.
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    leaving = false;
    root.classList.remove("leaving");
    if (melt) melt.setAttribute("scale", "0");
  });
})();
