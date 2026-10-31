/* Navigasi, tema, tab, dan pager untuk semua halaman dokumentasi Floci */
(function () {
  const PAGES = [
    { g: "Mulai" },
    { f: "index.html", t: "Beranda", i: "🏠" },
    { f: "konsep.html", t: "Konsep Dasar", i: "💡" },
    { f: "penggunaan.html", t: "Cara Memakai", i: "🚀" },
    { g: "Belajar AWS dari Nol" },
    { f: "belajar.html", t: "Peta Belajar", i: "🧭" },
    { f: "belajar-0.html", t: "Modul 0 · Persiapan", i: "🧰" },
    { f: "belajar-1.html", t: "Modul 1 · S3", i: "🪣" },
    { f: "belajar-2.html", t: "Modul 2 · SQS", i: "📨" },
    { f: "belajar-3.html", t: "Modul 3 · SNS", i: "📣" },
    { f: "belajar-4.html", t: "Modul 4 · DynamoDB", i: "🗃️" },
    { f: "belajar-5.html", t: "Modul 5 · Lambda", i: "λ" },
    { f: "belajar-6.html", t: "Modul 6 · IAM", i: "🔑" },
    { f: "belajar-7.html", t: "Modul 7 · Proyek Akhir", i: "🏁" },
    { g: "Cara Kerja" },
    { f: "arsitektur.html", t: "Arsitektur", i: "🏛️" },
    { f: "alur-request.html", t: "Alur Request", i: "🔀" },
    { f: "protokol.html", t: "Protokol AWS", i: "📡" },
    { f: "storage.html", t: "Penyimpanan Data", i: "💾" },
    { f: "keamanan.html", t: "Akun, IAM & Partisi", i: "🔐" },
    { f: "lifecycle.html", t: "Siklus Hidup & Hooks", i: "♻️" },
    { f: "lambda.html", t: "Lambda & Container", i: "λ" },
    { f: "event.html", t: "Alur Event Antar Layanan", i: "🔔" },
    { g: "Referensi" },
    { f: "layanan.html", t: "Katalog Layanan", i: "📚" },
    { f: "konfigurasi.html", t: "Konfigurasi & Port", i: "⚙️" },
    { f: "kontribusi.html", t: "Panduan Kontributor", i: "🛠️" },
    { f: "glosarium.html", t: "Glosarium", i: "📖" },
  ];
  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  // Tema
  const root = document.documentElement;
  try { const s = localStorage.getItem("floci-doc-theme"); if (s) root.dataset.theme = s; } catch (e) {}
  function currentDark() {
    if (root.dataset.theme) return root.dataset.theme === "dark";
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const side = document.querySelector(".sidebar");
    if (side) {
      let n = 0;
      let html = `<a class="brand" href="index.html">
        <svg class="logo" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="14" cy="22" r="9" fill="#6b9cff"/><circle cx="24" cy="16" r="10" fill="#2f6fdf"/>
          <circle cx="28" cy="25" r="8" fill="#7a4fd6"/><circle cx="18" cy="27" r="7" fill="#138a97"/></svg>
        <span>Floci<small>Dokumentasi Lengkap</small></span></a><nav class="nav">`;
      for (const p of PAGES) {
        if (p.g) { html += `<div class="nav-group">${p.g}</div>`; continue; }
        n++;
        html += `<a href="${p.f}" class="${p.f === here ? "active" : ""}"><span class="num">${n}</span><span>${p.i}</span><span>${p.t}</span></a>`;
      }
      html += `</nav><button class="theme-btn" type="button">🌓 Ganti tema</button>`;
      side.innerHTML = html;
      side.querySelector(".theme-btn").addEventListener("click", () => {
        const next = currentDark() ? "light" : "dark";
        root.dataset.theme = next;
        try { localStorage.setItem("floci-doc-theme", next); } catch (e) {}
      });
    }
    const top = document.querySelector(".topbar button");
    if (top) top.addEventListener("click", () => document.body.classList.toggle("nav-open"));
    document.querySelector(".main")?.addEventListener("click", (e) => {
      if (!e.target.closest(".topbar")) document.body.classList.remove("nav-open");
    });

    // Pager
    const list = PAGES.filter((p) => p.f);
    const idx = list.findIndex((p) => p.f === here);
    const pager = document.querySelector(".pager");
    if (pager && idx >= 0) {
      const prev = list[idx - 1], next = list[idx + 1];
      pager.innerHTML = (prev ? `<a href="${prev.f}">← ${prev.t}</a>` : "<span></span>") +
        (next ? `<a href="${next.f}">${next.t} →</a>` : "<span></span>");
    }

    // Tabs
    document.querySelectorAll("[data-tabs]").forEach((box) => {
      const btns = box.querySelectorAll(".tabs button");
      const panels = box.querySelectorAll(".tab-panel");
      btns.forEach((b, i) => b.addEventListener("click", () => {
        btns.forEach((x) => x.classList.remove("on"));
        panels.forEach((x) => x.classList.remove("on"));
        b.classList.add("on"); panels[i].classList.add("on");
      }));
    });
  });
})();
