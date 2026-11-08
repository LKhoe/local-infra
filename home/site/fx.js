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
    const opts = { gather: 1600, stagger: 420, scatter: 190, repel: 42, radius: 120, drift: 0.8, size: 2.2 };
    let parts = [], W = 0, H = 0, dpr = 1, start = 0, raf = 0, running = false;
    const ptr = { x: -1e4, y: -1e4 };

    root.classList.add("particles");

    function build() {
      const cs = getComputedStyle(title);
      const fontSize = parseFloat(cs.fontSize);
      const font = `${cs.fontWeight} ${fontSize}px ${cs.fontFamily}`;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      // measure the text to size the canvas
      ctx.font = font;
      const m = ctx.measureText(TEXT);
      const pad = 24;
      W = Math.min(Math.ceil(m.width) + pad * 2, title.clientWidth || window.innerWidth);
      H = Math.ceil(fontSize * 1.35);
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + "px"; canvas.style.height = H + "px";

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
            const a = Math.random() * Math.PI * 2, d = opts.scatter * (0.4 + Math.random() * 0.6);
            parts.push({
              tx: x, ty: y,
              x: reduce ? x : x + Math.cos(a) * d, y: reduce ? y : y + Math.sin(a) * d,
              vx: 0, vy: 0,
              delay: Math.random() * opts.stagger,
              ph: Math.random() * Math.PI * 2,
            });
          }
        }
      }
      start = performance.now();
    }

    function frame(now) {
      const t = now - start;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const restPath = new Path2D(), hotPath = new Path2D();
      const r = opts.size / 2;
      const k = 0.045 + Math.min(t / opts.gather, 1) * 0.03;   // spring stiffens as the text forms
      let moving = 0;
      for (const p of parts) {
        if (!reduce && t > p.delay) {
          const dx = opts.drift * Math.sin(now / 900 + p.ph), dy = opts.drift * Math.cos(now / 1100 + p.ph);
          p.vx += (p.tx + dx - p.x) * k;
          p.vy += (p.ty + dy - p.y) * k;
          const ex = p.x - ptr.x, ey = p.y - ptr.y, d2 = ex * ex + ey * ey;
          if (d2 < opts.radius * opts.radius && d2 > 0.01) {
            const d = Math.sqrt(d2), f = (1 - d / opts.radius) * opts.repel * 0.06;
            p.vx += (ex / d) * f; p.vy += (ey / d) * f;
          }
          p.vx *= 0.82; p.vy *= 0.82;
          p.x += p.vx; p.y += p.vy;
        }
        const off = Math.abs(p.x - p.tx) + Math.abs(p.y - p.ty);
        const path = off > 3 ? hotPath : restPath;
        if (off > 3) moving++;
        path.moveTo(p.x + r, p.y);
        path.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = `rgb(${REST})`;
      ctx.fill(restPath);
      ctx.save();
      ctx.fillStyle = `rgb(${HOT})`;
      ctx.shadowColor = `rgba(${HOT}, 0.8)`;
      ctx.shadowBlur = 8;
      ctx.fill(hotPath);
      ctx.restore();
      if (reduce) { running = false; return; }
      raf = requestAnimationFrame(frame);
    }

    function run() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(frame);
    }

    function toLocal(e) {
      const b = canvas.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    }
    if (!reduce) {
      window.addEventListener("pointermove", (e) => { const p = toLocal(e); ptr.x = p.x; ptr.y = p.y; }, { passive: true });
      document.addEventListener("pointerleave", () => { ptr.x = ptr.y = -1e4; });
      canvas.addEventListener("pointerdown", (e) => {
        const c = toLocal(e), R = opts.radius * 2;
        for (const p of parts) {
          const ex = p.x - c.x, ey = p.y - c.y, d = Math.hypot(ex, ey) || 1;
          if (d < R) { const f = (1 - d / R) * 22; p.vx += (ex / d) * f; p.vy += (ey / d) * f; }
        }
      });
      document.addEventListener("visibilitychange", () => {
        cancelAnimationFrame(raf); running = false;
        if (!document.hidden) run();
      });
    }

    const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    ready.then(() => { build(); run(); });
    let lastW = window.innerWidth, rt = 0;
    window.addEventListener("resize", () => {
      if (window.innerWidth === lastW) return;   // ignore mobile URL-bar height changes
      lastW = window.innerWidth;
      clearTimeout(rt);
      rt = setTimeout(() => { build(); if (reduce) frame(performance.now()); else run(); }, 150);
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
