/*
 * FlowDiagram — mesin animasi diagram alur kecil (tanpa library).
 * Diagram didefinisikan sebagai data: node, zona, dan langkah (step).
 * Setiap langkah menggerakkan "paket" dari satu node ke node lain,
 * menyorot keduanya, dan menampilkan penjelasan di panel samping.
 */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  function center(n) { return { x: n.x + n.w / 2, y: n.y + n.h / 2 }; }
  function border(n, toward) {
    const c = center(n), dx = toward.x - c.x, dy = toward.y - c.y;
    if (!dx && !dy) return c;
    const t = Math.min((n.w / 2 + 2) / Math.abs(dx || 1e-9), (n.h / 2 + 2) / Math.abs(dy || 1e-9));
    return { x: c.x + dx * t, y: c.y + dy * t };
  }
  function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function mount(host, cfg) {
    const nodes = {};
    cfg.nodes.forEach((n) => { nodes[n.id] = Object.assign({ w: 150, h: 54 }, n); });
    const steps = cfg.steps;

    host.classList.add("flow");
    host.innerHTML = `
      <div class="flow-head">
        <div class="flow-title">🎬 ${esc(cfg.title || "Animasi alur")}</div>
        <div class="flow-ctrl">
          <button type="button" data-a="prev" title="Langkah sebelumnya">⏮</button>
          <button type="button" data-a="play" class="primary">▶ Putar</button>
          <button type="button" data-a="next" title="Langkah berikutnya">⏭</button>
          <button type="button" data-a="reset" title="Ulang dari awal">↺</button>
          <select data-a="speed" title="Kecepatan">
            <option value="0.6">0.6×</option><option value="1" selected>1×</option>
            <option value="1.6">1.6×</option><option value="2.5">2.5×</option>
          </select>
        </div>
      </div>
      <div class="flow-progress"><i></i></div>
      <div class="flow-body">
        <div class="flow-canvas"></div>
        <div class="flow-side">
          <div class="flow-now"><div class="k">Siap</div><h4>${esc(cfg.intro || "Tekan ▶ Putar")}</h4>
            <p>${esc(cfg.introText || "Animasi akan berjalan langkah demi langkah. Klik nama langkah di bawah untuk melompat.")}</p></div>
          <ol class="flow-list"></ol>
        </div>
      </div>`;

    const canvas = host.querySelector(".flow-canvas");
    const svg = el("svg", { viewBox: `0 0 ${cfg.width} ${cfg.height}`, role: "img", "aria-label": cfg.title || "diagram" }, canvas);
    const defs = el("defs", {}, svg);
    const mk = el("marker", { id: "arw-" + (cfg.id || Math.random().toString(36).slice(2)), viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0,0 L10,5 L0,10 z", style: "fill: var(--accent)" }, mk);
    const markerId = mk.id;

    // Zona (kotak pengelompokan)
    (cfg.zones || []).forEach((z) => {
      const g = el("g", { class: "fn k-zone" }, svg);
      el("rect", { x: z.x, y: z.y, width: z.w, height: z.h, rx: 12 }, g);
      const t = el("text", { x: z.x + 12, y: z.y + 18 }, g); t.textContent = z.label;
    });

    // Edge
    const edgeLayer = el("g", {}, svg);
    const edges = {};
    const pairs = (cfg.edges || []).slice();
    steps.forEach((s) => { if (s.from !== s.to) pairs.push([s.from, s.to]); });
    pairs.forEach(([a, b]) => {
      const key = [a, b].sort().join("|");
      if (edges[key] || !nodes[a] || !nodes[b]) return;
      const p1 = border(nodes[a], center(nodes[b])), p2 = border(nodes[b], center(nodes[a]));
      edges[key] = el("line", { class: "fe", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }, edgeLayer);
    });

    // Node
    const nodeEls = {};
    Object.values(nodes).forEach((n) => {
      const g = el("g", { class: "fn k-" + (n.kind || "svc") }, svg);
      el("rect", { x: n.x, y: n.y, width: n.w, height: n.h, rx: 9 }, g);
      const lines = String(n.label).split("\n");
      const subH = n.sub ? 14 : 0;
      const total = lines.length * 16 + subH;
      lines.forEach((ln, i) => {
        const t = el("text", { x: n.x + n.w / 2, y: n.y + n.h / 2 - total / 2 + 12 + i * 16, "text-anchor": "middle" }, g);
        t.textContent = (i === 0 && n.icon ? n.icon + " " : "") + ln;
      });
      if (n.sub) {
        const t = el("text", { class: "sub", x: n.x + n.w / 2, y: n.y + n.h / 2 + total / 2 - 2, "text-anchor": "middle" }, g);
        t.textContent = n.sub;
      }
      nodeEls[n.id] = g;
    });

    // Paket
    const packet = el("g", { class: "packet", opacity: 0 }, svg);
    const pRect = el("rect", { rx: 9, ry: 9, height: 18 }, packet);
    const pText = el("text", { "text-anchor": "middle", y: 4 }, packet);
    const pulse = el("rect", { class: "pulse", opacity: 0, rx: 12 }, svg);

    // Daftar langkah
    const list = host.querySelector(".flow-list");
    steps.forEach((s, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<b>${i + 1}</b><span>${esc(s.title)}</span>`;
      li.addEventListener("click", () => { stop(); go(i); });
      list.appendChild(li);
    });
    const lis = list.querySelectorAll("li");
    const now = host.querySelector(".flow-now");
    const bar = host.querySelector(".flow-progress i");
    const playBtn = host.querySelector('[data-a="play"]');
    const speedSel = host.querySelector('[data-a="speed"]');

    let cur = -1, playing = false, raf = 0, timer = 0;
    const speed = () => parseFloat(speedSel.value) || 1;

    function clearHot() {
      Object.values(nodeEls).forEach((g) => g.classList.remove("hot"));
      Object.values(edges).forEach((e) => { e.classList.remove("hot"); e.removeAttribute("marker-end"); e.style.color = ""; });
      pulse.setAttribute("opacity", 0);
    }

    function go(i) {
      cancelAnimationFrame(raf); clearTimeout(timer);
      if (i < 0) i = 0;
      if (i >= steps.length) { finish(); return; }
      cur = i;
      const s = steps[i];
      clearHot();
      lis.forEach((li, j) => { li.classList.toggle("on", j === i); li.classList.toggle("done", j < i); });
      lis[i].scrollIntoView({ block: "nearest" });
      bar.style.width = ((i + 1) / steps.length * 100) + "%";
      now.innerHTML = `<div class="k">Langkah ${i + 1} / ${steps.length}${s.tag ? " · " + esc(s.tag) : ""}</div>
        <h4>${esc(s.title)}</h4><p>${s.text}</p>`;

      const a = nodes[s.from], b = nodes[s.to];
      nodeEls[s.from] && nodeEls[s.from].classList.add("hot");
      nodeEls[s.to] && nodeEls[s.to].classList.add("hot");
      packet.setAttribute("class", "packet " + (s.kind || ""));
      const label = s.tag || "";
      pText.textContent = label;
      const w = Math.max(20, label.length * 6.4 + 16);
      pRect.setAttribute("width", w); pRect.setAttribute("x", -w / 2); pRect.setAttribute("y", -9);

      if (!a || !b || s.from === s.to) {
        const n = a || b;
        if (n) {
          pulse.setAttribute("x", n.x - 4); pulse.setAttribute("y", n.y - 4);
          pulse.setAttribute("width", n.w + 8); pulse.setAttribute("height", n.h + 8);
          pulse.setAttribute("opacity", 1);
          const c = center(n);
          packet.setAttribute("transform", `translate(${c.x},${n.y - 4})`);
          packet.setAttribute("opacity", label ? 1 : 0);
        }
        scheduleNext(1300);
        return;
      }
      const key = [s.from, s.to].sort().join("|");
      const edge = edges[key];
      if (edge) {
        edge.classList.add("hot");
        // arah panah
        const p1 = border(a, center(b)), p2 = border(b, center(a));
        edge.setAttribute("x1", p1.x); edge.setAttribute("y1", p1.y);
        edge.setAttribute("x2", p2.x); edge.setAttribute("y2", p2.y);
        edge.setAttribute("marker-end", `url(#${markerId})`);
        edge.style.color = "var(--accent)";
      }
      const c1 = border(a, center(b)), c2 = border(b, center(a));
      const dur = reduce ? 1 : 1100 / speed();
      const t0 = performance.now();
      packet.setAttribute("opacity", 1);
      (function frame(t) {
        const k = Math.min(1, (t - t0) / dur), e = ease(k);
        packet.setAttribute("transform", `translate(${c1.x + (c2.x - c1.x) * e},${c1.y + (c2.y - c1.y) * e})`);
        if (k < 1) raf = requestAnimationFrame(frame);
        else scheduleNext(0);
      })(t0);
    }

    function scheduleNext(extra) {
      if (!playing) return;
      timer = setTimeout(() => go(cur + 1), (1900 + extra) / speed());
    }
    function finish() {
      playing = false; playBtn.textContent = "▶ Ulangi";
      lis.forEach((li) => { li.classList.remove("on"); li.classList.add("done"); });
      now.innerHTML = `<div class="k">Selesai</div><h4>${esc(cfg.outro || "Alur selesai ✅")}</h4><p>${cfg.outroText || "Tekan ▶ Ulangi untuk menonton lagi, atau klik salah satu langkah."}</p>`;
      packet.setAttribute("opacity", 0); clearHot(); cur = steps.length;
    }
    function play() {
      if (cur >= steps.length - 1 && cur !== -1) cur = -1;
      playing = true; playBtn.textContent = "⏸ Jeda";
      go(cur + 1);
    }
    function stop() { playing = false; clearTimeout(timer); playBtn.textContent = "▶ Putar"; }

    host.querySelector(".flow-ctrl").addEventListener("click", (e) => {
      const a = e.target.closest("button")?.dataset.a;
      if (!a) return;
      if (a === "play") playing ? stop() : play();
      if (a === "next") { stop(); go(Math.min(cur + 1, steps.length - 1)); }
      if (a === "prev") { stop(); go(Math.max(cur - 1, 0)); }
      if (a === "reset") { stop(); cur = -1; clearHot(); packet.setAttribute("opacity", 0); bar.style.width = 0;
        lis.forEach((li) => li.classList.remove("on", "done")); }
    });

    // Putar otomatis sekali saat diagram terlihat
    if (cfg.autoplay !== false && "IntersectionObserver" in window && !reduce) {
      const io = new IntersectionObserver((ents) => {
        if (ents.some((x) => x.isIntersecting)) { io.disconnect(); if (cur === -1) play(); }
      }, { threshold: 0.45 });
      io.observe(host);
    }
  }

  window.FlowDiagram = { mount };
})();
