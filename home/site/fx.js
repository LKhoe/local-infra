// Visual effects for www.khoe.dev: starfield, card tilt/spotlight, cursor glow and the
// "warp" transition when leaving for an app. No data is sent anywhere; the page works without it.
(() => {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const root = document.documentElement;

  // ---- starfield with constellations that follow the pointer
  const canvas = document.querySelector(".sky");
  const ctx = canvas && canvas.getContext("2d");
  let stars = [], galaxy = [], w = 0, h = 0, dpr = 1, raf = 0;
  const G = { x: 0, y: 0, R: 0, tilt: -0.38, flat: 0.42 };
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

  // Spiral galaxy off to the side of the content: two main arms + two faint ones, inner stars orbit faster.
  function buildGalaxy() {
    const wide = w >= 720;
    G.x = wide ? w * 0.74 : w * 0.62; G.y = wide ? h * 0.3 : h * 0.2;
    G.R = Math.max(w, h) * (wide ? 0.4 : 0.5);
    const count = Math.min(2200, Math.round((w * h) / 600));
    const arms = 4;
    galaxy = Array.from({ length: count }, () => {
      const arm = Math.floor(Math.random() * arms);
      const k = Math.pow(Math.random(), 1.7);                  // denser near the core
      const r = G.R * k;
      const spread = (0.32 * (1 - k) + 0.08) * (arm % 2 ? 1.5 : 1);
      const theta = (arm / arms) * Math.PI * 2 + k * 4.2 + gauss() * spread;
      const warm = k < 0.18;
      const hue = warm ? 40 + Math.random() * 15 : [215, 235, 265, 290, 320][Math.floor(Math.random() * 5)];
      return {
        r: r + gauss() * 6, theta,
        speed: 0.00055 * (1.25 - k * 0.8),
        size: Math.random() < 0.05 ? 2 : Math.random() * 1.1 + 0.6,
        a: (warm ? 0.95 : 0.85) * (arm % 2 ? 0.5 : 1) * (1 - k * 0.5),
        color: `hsl(${hue}, ${warm ? 90 : 85}%, ${warm ? 82 : 72}%)`,
      };
    });
  }

  function drawGalaxy() {
    const cos = Math.cos(G.tilt), sin = Math.sin(G.tilt);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // dust / nebula haze along the disc
    ctx.save();
    ctx.translate(G.x, G.y); ctx.rotate(G.tilt); ctx.scale(1, G.flat);
    let g = ctx.createRadialGradient(0, 0, 0, 0, 0, G.R * 0.9);
    g.addColorStop(0, "rgba(150, 120, 255, 0.28)");
    g.addColorStop(0.4, "rgba(90, 70, 210, 0.12)");
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, G.R * 0.9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    for (const p of galaxy) {
      if (!reduce) p.theta += p.speed;
      const ex = Math.cos(p.theta) * p.r, ey = Math.sin(p.theta) * p.r * G.flat;
      const x = G.x + ex * cos - ey * sin, y = G.y + ex * sin + ey * cos;
      if (x < -4 || x > w + 4 || y < -4 || y > h + 4) continue;
      ctx.globalAlpha = p.a;
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y, p.size, p.size);
    }
    // bright core
    ctx.globalAlpha = 1;
    g = ctx.createRadialGradient(G.x, G.y, 0, G.x, G.y, G.R * 0.2);
    g.addColorStop(0, "rgba(255, 245, 225, 0.9)");
    g.addColorStop(0.15, "rgba(255, 215, 170, 0.45)");
    g.addColorStop(0.5, "rgba(220, 150, 200, 0.12)");
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(G.x, G.y, G.R * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  const pointer = { x: -9999, y: -9999 };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(140, Math.round((w * h) / 9000));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.15,
      r: Math.random() * 1.4 + 0.3, t: Math.random() * Math.PI * 2,
      hue: [200, 220, 250, 40][Math.floor(Math.random() * 4)],
    }));
    buildGalaxy();
  }

  function draw(time) {
    ctx.clearRect(0, 0, w, h);
    drawGalaxy();
    for (const s of stars) {
      if (!reduce) {
        s.x += s.vx; s.y += s.vy;
        // pointer gently attracts nearby stars
        const dx = pointer.x - s.x, dy = pointer.y - s.y, d2 = dx * dx + dy * dy;
        if (d2 < 160 * 160) { s.x += dx * 0.004; s.y += dy * 0.004; }
        if (s.x < -10) s.x = w + 10; else if (s.x > w + 10) s.x = -10;
        if (s.y < -10) s.y = h + 10; else if (s.y > h + 10) s.y = -10;
      }
      const tw = reduce ? 0.8 : 0.55 + 0.45 * Math.sin(time / 700 + s.t);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${s.hue}, 60%, 88%, ${tw})`;
      ctx.fill();
    }
    // constellation lines between stars close to the pointer
    for (let i = 0; i < stars.length; i++) {
      const a = stars[i];
      const pa = Math.hypot(pointer.x - a.x, pointer.y - a.y);
      if (pa > 180) continue;
      for (let j = i + 1; j < stars.length; j++) {
        const b = stars[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 110) {
          ctx.strokeStyle = `rgba(167, 139, 250, ${(1 - d / 110) * (1 - pa / 180) * 0.8})`;
          ctx.lineWidth = 0.7;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    if (!reduce) raf = requestAnimationFrame(draw);
  }

  if (ctx) {
    resize();
    window.addEventListener("resize", () => { resize(); if (reduce) draw(0); });
    if (reduce) draw(0); else raf = requestAnimationFrame(draw);
    document.addEventListener("visibilitychange", () => {
      if (reduce) return;
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(draw);
    });
  }

  // ---- pointer: glow, tilt and spotlight (mouse/trackpad only)
  if (finePointer && !reduce) {
    window.addEventListener("pointermove", (e) => {
      pointer.x = e.clientX; pointer.y = e.clientY;
      root.classList.add("has-pointer");
      root.style.setProperty("--gx", e.clientX + "px");
      root.style.setProperty("--gy", e.clientY + "px");
    }, { passive: true });
    document.addEventListener("pointerleave", () => {
      pointer.x = pointer.y = -9999;
      root.classList.remove("has-pointer");
    });

    document.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        card.style.setProperty("--mx", px * 100 + "%");
        card.style.setProperty("--my", py * 100 + "%");
        card.style.setProperty("--ry", (px - 0.5) * 14 + "deg");
        card.style.setProperty("--rx", (0.5 - py) * 14 + "deg");
      });
      card.addEventListener("pointerleave", () => {
        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
      });
    });
  }

  // ---- leaving: warp from the clicked card into the app's colours, then navigate
  const warp = document.querySelector(".warp");
  const label = document.querySelector(".warp-label");
  let leaving = false;

  document.querySelectorAll(".card, .github").forEach((link) => {
    link.addEventListener("click", (e) => {
      // new tab / window / download: let the browser do its thing
      if (reduce || leaving || e.defaultPrevented || e.button !== 0 ||
          e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      leaving = true;

      const r = link.getBoundingClientRect();
      const cs = getComputedStyle(link);
      warp.style.setProperty("--wx", r.left + r.width / 2 + "px");
      warp.style.setProperty("--wy", r.top + r.height / 2 + "px");
      warp.style.setProperty("--c", cs.getPropertyValue("--c"));
      warp.style.setProperty("--c2", cs.getPropertyValue("--c2"));
      const name = link.querySelector(".name");
      label.textContent = name ? name.textContent : "GitHub";

      link.classList.add("chosen");
      root.classList.add("leaving");
      setTimeout(() => { window.location.href = link.href; }, 850);
    });
  });

  // Back button (bfcache): undo the warp so the page isn't stuck covered.
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    leaving = false;
    root.classList.remove("leaving");
    document.querySelectorAll(".chosen").forEach((el) => el.classList.remove("chosen"));
  });
})();
