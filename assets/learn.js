/*
 * learn.js — fitur interaktif untuk modul "Belajar AWS dari Nol":
 *  - checklist per langkah (disimpan di browser, localStorage)
 *  - progres per modul dan progres keseluruhan di halaman Peta Belajar
 *  - tombol "Salin" di setiap blok kode
 *  - kuis pilihan ganda
 */
(function () {
  const KEY = "floci-learn-v1";
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }

  document.addEventListener("DOMContentLoaded", () => {
    const data = load();
    const mod = document.body.dataset.module;

    // ----- Checklist langkah di halaman modul -----
    if (mod !== undefined) {
      const steps = [...document.querySelectorAll(".step[data-id]")];
      const st = data["m" + mod] = data["m" + mod] || {};
      const bar = document.querySelector(".mod-progress .progress > div");
      const label = document.querySelector(".mod-progress b");
      function refresh() {
        const done = steps.filter((s) => st[s.dataset.id]).length;
        if (bar) bar.style.width = (steps.length ? done / steps.length * 100 : 0) + "%";
        if (label) label.textContent = `${done} / ${steps.length} langkah`;
        data["t" + mod] = steps.length;
        save(data);
      }
      steps.forEach((s, i) => {
        const head = s.querySelector(".step-head");
        if (!head.querySelector(".step-num")) head.insertAdjacentHTML("afterbegin", `<span class="step-num">${i + 1}</span>`);
        const lab = document.createElement("label");
        lab.className = "check";
        lab.innerHTML = `<input type="checkbox"> Selesai`;
        const cb = lab.querySelector("input");
        cb.checked = !!st[s.dataset.id];
        s.classList.toggle("done", cb.checked);
        cb.addEventListener("change", () => {
          if (cb.checked) st[s.dataset.id] = true; else delete st[s.dataset.id];
          s.classList.toggle("done", cb.checked);
          refresh();
        });
        head.appendChild(lab);
      });
      refresh();
    }

    // ----- Peta belajar: status tiap modul + progres total -----
    const roads = document.querySelectorAll(".road[data-mod]");
    if (roads.length) {
      let all = 0, done = 0;
      roads.forEach((r) => {
        const m = r.dataset.mod;
        const total = data["t" + m] || parseInt(r.dataset.total, 10) || 0;
        const d = Object.keys(data["m" + m] || {}).length;
        all += total; done += Math.min(d, total);
        const st = r.querySelector(".st");
        if (st) st.textContent = d >= total && total ? "✔ Selesai" : d ? `${d}/${total} langkah` : "Belum dimulai";
        r.classList.toggle("complete", d >= total && total > 0);
      });
      const ob = document.querySelector("#overall > div");
      const ol = document.getElementById("overall-label");
      requestAnimationFrame(() => { if (ob) ob.style.width = (all ? done / all * 100 : 0) + "%"; });
      if (ol) ol.textContent = `${done} dari ${all} langkah praktik selesai (${all ? Math.round(done / all * 100) : 0}%)`;
      const rb = document.getElementById("reset-progress");
      if (rb) rb.addEventListener("click", () => {
        if (confirm("Hapus semua progres belajar yang tersimpan di browser ini?")) { save({}); location.reload(); }
      });
    }

    // ----- Tombol salin pada blok kode (kecuali contoh hasil) -----
    document.querySelectorAll("pre").forEach((pre) => {
      if (pre.closest(".out") || pre.closest(".flow")) return;
      const b = document.createElement("button");
      b.type = "button"; b.className = "copy-btn"; b.textContent = "Salin";
      b.addEventListener("click", () => {
        const text = (pre.querySelector("code") || pre).innerText;
        const ok = () => { b.textContent = "✔ Tersalin"; setTimeout(() => (b.textContent = "Salin"), 1500); };
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(ok, () => fallback(text, ok));
        else fallback(text, ok);
      });
      pre.appendChild(b);
    });
    function fallback(text, ok) {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); ok(); } catch (e) {}
      ta.remove();
    }

    // ----- Kuis -----
    document.querySelectorAll(".quiz[data-answer]").forEach((qz) => {
      const right = parseInt(qz.dataset.answer, 10);
      const opts = [...qz.querySelectorAll("button.opt")];
      opts.forEach((o, i) => o.addEventListener("click", () => {
        opts.forEach((x, j) => { x.disabled = true; if (j === right) x.classList.add("right"); });
        if (i !== right) o.classList.add("wrong");
        qz.classList.add("answered");
        const w = qz.querySelector(".why");
        if (w) w.insertAdjacentHTML("afterbegin", i === right ? "<b style='color:var(--ok)'>Benar! </b>" : "<b style='color:var(--bad)'>Belum tepat. </b>");
      }));
    });
  });
})();
