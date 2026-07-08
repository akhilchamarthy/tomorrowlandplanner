/* TML W2 2026 personal timetable planner */
(function () {
  "use strict";

  // ---------- state ----------
  const STORE_KEY = "tml-w2-2026-plan";
  const defaults = () => ({
    starredSetIds: [],
    customSets: [],
    hiddenStageIds: [],
    stageOrder: FESTIVAL.stages.map(s => s.id),
    stageColors: {},
    lastDay: "fri",
  });

  let state = load();
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaults();
      const parsed = JSON.parse(raw);
      const st = Object.assign(defaults(), parsed);
      // keep stageOrder in sync with dataset (add new stages at the end)
      const known = new Set(st.stageOrder);
      FESTIVAL.stages.forEach(s => { if (!known.has(s.id)) st.stageOrder.push(s.id); });
      st.stageOrder = st.stageOrder.filter(id => FESTIVAL.stages.some(s => s.id === id));
      return st;
    } catch (e) {
      return defaults();
    }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage full/unavailable */ }
  }

  // ---------- helpers ----------
  const stagesById = {};
  FESTIVAL.stages.forEach(s => { stagesById[s.id] = s; });
  const setsById = {};
  FESTIVAL.sets.forEach(s => { setsById[s.id] = s; });

  // minutes from noon; 00:00–06:00 belongs to the previous festival day
  function toMin(t) {
    const [h, m] = t.split(":").map(Number);
    const v = h * 60 + m - 720;
    return v < 0 ? v + 1440 : v;
  }
  function stageColor(id) {
    return state.stageColors[id] || (stagesById[id] ? stagesById[id].color : "#b18cff");
  }
  function stageName(set) {
    if (set.stageId && stagesById[set.stageId]) return stagesById[set.stageId].name;
    return set.location || "Custom";
  }
  function orderedStages() {
    return state.stageOrder.map(id => stagesById[id]);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // current festival day + minutes-from-noon in Europe/Brussels
  function brusselsNow() {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: FESTIVAL.tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date());
    const get = t => parts.find(p => p.type === t).value;
    let date = `${get("year")}-${get("month")}-${get("day")}`;
    let min = (+get("hour")) * 60 + (+get("minute")) - 720;
    if (min < 0) {
      min += 1440;
      // 00:00–06:00 counts as the previous festival day
      const d = new Date(date + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - 1);
      date = d.toISOString().slice(0, 10);
    }
    const day = FESTIVAL.days.find(d => d.date === date);
    return { dayId: day ? day.id : null, min };
  }

  // ---------- tabs & day picker ----------
  const views = { timetable: el("view-timetable"), mine: el("view-mine"), stages: el("view-stages") };
  function el(id) { return document.getElementById(id); }

  let activeTab = "timetable";
  document.querySelectorAll(".tabbar .tab").forEach(btn => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll(".tabbar .tab").forEach(b => b.classList.toggle("active", b === btn));
      Object.entries(views).forEach(([k, v]) => { v.hidden = k !== activeTab; });
      render();
    });
  });

  const dayPicker = el("dayPicker");
  FESTIVAL.days.forEach(d => {
    const b = document.createElement("button");
    b.textContent = d.label;
    b.dataset.day = d.id;
    b.addEventListener("click", () => { state.lastDay = d.id; save(); render(); });
    dayPicker.appendChild(b);
  });

  // ---------- timetable tab ----------
  const searchInput = el("searchInput");
  searchInput.addEventListener("input", renderTimetable);

  const openStages = new Set(); // per-session collapse state

  function setRowHTML(set, cls) {
    const starred = state.starredSetIds.includes(set.id);
    return `<div class="set-row ${starred ? "starred" : ""} ${cls || ""}" data-set="${set.id}">
      <span class="time">${set.start}–${set.end}</span>
      <span class="artist">${esc(set.artist)}</span>
      <span class="star">★</span>
    </div>`;
  }

  function renderTimetable() {
    const box = el("timetableList");
    const q = searchInput.value.trim().toLowerCase();
    const now = brusselsNow();

    if (q) {
      // flat search results across all days
      const matches = FESTIVAL.sets.filter(s => s.artist.toLowerCase().includes(q));
      if (!matches.length) { box.innerHTML = `<div class="empty">No artists match “${esc(q)}”.</div>`; return; }
      let html = "";
      FESTIVAL.days.forEach(day => {
        const dayMatches = matches.filter(s => s.dayId === day.id).sort((a, b) => toMin(a.start) - toMin(b.start));
        if (!dayMatches.length) return;
        html += `<div class="day-group-label">${day.label}</div>`;
        dayMatches.forEach(s => {
          html += `<div class="stage-section open"><div class="stage-head" style="border-left-color:${stageColor(s.stageId)}">${esc(stageName(s))}</div><div class="stage-body">${setRowHTML(s)}</div></div>`;
        });
      });
      box.innerHTML = html;
      bindSetRows(box);
      return;
    }

    let html = "";
    orderedStages().forEach(stage => {
      if (state.hiddenStageIds.includes(stage.id)) return;
      const sets = FESTIVAL.sets
        .filter(s => s.stageId === stage.id && s.dayId === state.lastDay)
        .sort((a, b) => toMin(a.start) - toMin(b.start));
      if (!sets.length) return;
      const open = openStages.has(stage.id);
      html += `<div class="stage-section ${open ? "open" : ""}" data-stage="${stage.id}">
        <button class="stage-head" style="border-left-color:${stageColor(stage.id)}">
          <span class="chev">▶</span> ${esc(stage.name)} <span class="count">${sets.length} sets</span>
        </button>
        <div class="stage-body">`;
      sets.forEach(s => {
        const playing = now.dayId === state.lastDay && now.min >= toMin(s.start) && now.min < toMin(s.end);
        html += setRowHTML(s, playing ? "now-playing" : "");
      });
      html += `</div></div>`;
    });
    box.innerHTML = html || `<div class="empty">All stages are hidden. Unhide some in the Stages tab.</div>`;

    box.querySelectorAll(".stage-head").forEach(head => {
      head.addEventListener("click", () => {
        const sec = head.closest(".stage-section");
        const id = sec.dataset.stage;
        sec.classList.toggle("open");
        if (sec.classList.contains("open")) openStages.add(id); else openStages.delete(id);
      });
    });
    bindSetRows(box);
  }

  function bindSetRows(root) {
    root.querySelectorAll(".set-row").forEach(row => {
      row.addEventListener("click", () => {
        const id = row.dataset.set;
        const i = state.starredSetIds.indexOf(id);
        if (i >= 0) state.starredSetIds.splice(i, 1); else state.starredSetIds.push(id);
        save();
        row.classList.toggle("starred", i < 0);
        if (activeTab === "mine") renderMine();
      });
    });
  }

  // ---------- my timetable tab ----------
  function myItemsForDay(dayId) {
    const starred = state.starredSetIds.map(id => setsById[id]).filter(Boolean).filter(s => s.dayId === dayId);
    const custom = state.customSets.filter(s => s.dayId === dayId);
    return starred.concat(custom).sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(a.end) - toMin(b.end));
  }

  function renderMine() {
    const box = el("myList");
    const items = myItemsForDay(state.lastDay);
    const now = brusselsNow();
    const dayLabel = FESTIVAL.days.find(d => d.id === state.lastDay).label;

    if (!items.length) {
      box.innerHTML = `<div class="empty">Nothing planned for ${dayLabel} yet.<br>Star sets in the Timetable tab, or tap + to add your own entry.</div>`;
      return;
    }

    // clash detection: overlapping intervals
    const clashes = new Set();
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (toMin(items[j].start) < toMin(items[i].end) && toMin(items[i].start) < toMin(items[j].end)) {
          clashes.add(items[i].id); clashes.add(items[j].id);
        }
      }
    }

    let html = "";
    let nowLinePlaced = false;
    items.forEach(it => {
      const isCustom = !!it.custom;
      const playing = now.dayId === state.lastDay && now.min >= toMin(it.start) && now.min < toMin(it.end);
      if (now.dayId === state.lastDay && !nowLinePlaced && (playing || toMin(it.start) > now.min)) {
        html += `<div class="now-line">now</div>`;
        nowLinePlaced = true;
      }
      const badges =
        (playing ? `<span class="badge now">NOW</span>` : "") +
        (clashes.has(it.id) ? `<span class="badge clash">CLASH</span>` : "");
      const color = isCustom && !it.stageId ? "#8a8a9a" : stageColor(it.stageId);
      html += `<div class="my-set ${playing ? "now-playing" : ""}" style="border-left-color:${color}">
        <div class="info">
          <div class="artist">${esc(it.artist)}</div>
          <div class="meta">${it.start}–${it.end} · ${esc(stageName(it))}</div>
        </div>
        <div class="badges">${badges}</div>
        ${isCustom
          ? `<button class="edit" data-id="${it.id}" title="Edit">✎</button>`
          : `<button class="unstar" data-id="${it.id}" title="Remove">★</button>`}
      </div>`;
    });
    if (now.dayId === state.lastDay && !nowLinePlaced) html += `<div class="now-line">now</div>`;
    box.innerHTML = html;

    box.querySelectorAll("button.unstar").forEach(b => b.addEventListener("click", () => {
      state.starredSetIds = state.starredSetIds.filter(id => id !== b.dataset.id);
      save(); renderMine();
      if (!views.timetable.hidden) renderTimetable();
    }));
    box.querySelectorAll("button.edit").forEach(b => b.addEventListener("click", () => openModal(b.dataset.id)));
  }

  // ---------- custom entry modal ----------
  const backdrop = el("modalBackdrop");
  const cDay = el("cDay"), cStage = el("cStage"), cName = el("cName"),
        cStart = el("cStart"), cEnd = el("cEnd"), cLoc = el("cLoc"),
        cLocLabel = el("cLocLabel"), cDelete = el("cDelete");
  let editingId = null;

  FESTIVAL.days.forEach(d => cDay.add(new Option(d.label, d.id)));
  FESTIVAL.stages.forEach(s => cStage.add(new Option(s.name, s.id)));
  cStage.add(new Option("Other location…", "__other"));
  cStage.addEventListener("change", () => { cLocLabel.hidden = cStage.value !== "__other"; });

  function openModal(id) {
    editingId = id || null;
    el("modalTitle").textContent = id ? "Edit entry" : "Add entry";
    cDelete.hidden = !id;
    if (id) {
      const it = state.customSets.find(s => s.id === id);
      cName.value = it.artist; cDay.value = it.dayId;
      cStage.value = it.stageId || "__other";
      cLoc.value = it.location || "";
      cStart.value = it.start; cEnd.value = it.end;
    } else {
      cName.value = ""; cDay.value = state.lastDay; cStage.value = "__other"; cLoc.value = "";
      cStart.value = "18:00"; cEnd.value = "19:00";
    }
    cLocLabel.hidden = cStage.value !== "__other";
    backdrop.hidden = false;
  }
  function closeModal() { backdrop.hidden = true; editingId = null; }

  el("addCustomBtn").addEventListener("click", () => openModal());
  el("cCancel").addEventListener("click", closeModal);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) closeModal(); });
  cDelete.addEventListener("click", () => {
    state.customSets = state.customSets.filter(s => s.id !== editingId);
    save(); closeModal(); renderMine();
  });
  el("customForm").addEventListener("submit", e => {
    e.preventDefault();
    const entry = {
      id: editingId || "custom-" + Date.now(),
      custom: true,
      artist: cName.value.trim(),
      dayId: cDay.value,
      stageId: cStage.value === "__other" ? null : cStage.value,
      location: cStage.value === "__other" ? (cLoc.value.trim() || "Custom") : null,
      start: cStart.value,
      end: cEnd.value,
    };
    if (!entry.artist) return;
    if (editingId) {
      const i = state.customSets.findIndex(s => s.id === editingId);
      state.customSets[i] = entry;
    } else {
      state.customSets.push(entry);
    }
    state.lastDay = entry.dayId;
    save(); closeModal(); render();
  });

  // ---------- stages tab ----------
  function renderStages() {
    const box = el("stageList");
    let html = "";
    orderedStages().forEach((stage, i) => {
      const hidden = state.hiddenStageIds.includes(stage.id);
      html += `<div class="stage-pref ${hidden ? "hidden-stage" : ""}" data-stage="${stage.id}">
        <input type="color" value="${stageColor(stage.id)}" title="Stage color">
        <span class="name">${esc(stage.name)}</span>
        <button class="up" ${i === 0 ? "disabled" : ""} title="Move up">↑</button>
        <button class="down" ${i === state.stageOrder.length - 1 ? "disabled" : ""} title="Move down">↓</button>
        <button class="vis" title="${hidden ? "Show" : "Hide"}">${hidden ? "🚫" : "👁"}</button>
      </div>`;
    });
    box.innerHTML = html;

    box.querySelectorAll(".stage-pref").forEach(row => {
      const id = row.dataset.stage;
      row.querySelector(".up").addEventListener("click", () => moveStage(id, -1));
      row.querySelector(".down").addEventListener("click", () => moveStage(id, 1));
      row.querySelector(".vis").addEventListener("click", () => {
        const i = state.hiddenStageIds.indexOf(id);
        if (i >= 0) state.hiddenStageIds.splice(i, 1); else state.hiddenStageIds.push(id);
        save(); renderStages();
      });
      row.querySelector("input[type=color]").addEventListener("change", e => {
        state.stageColors[id] = e.target.value;
        save(); renderStages();
      });
    });
  }
  function moveStage(id, dir) {
    const i = state.stageOrder.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= state.stageOrder.length) return;
    [state.stageOrder[i], state.stageOrder[j]] = [state.stageOrder[j], state.stageOrder[i]];
    save(); renderStages();
  }

  // ---------- backup ----------
  el("exportBtn").addEventListener("click", () => {
    const box = el("backupBox");
    box.value = JSON.stringify(state);
    box.focus(); box.select();
  });
  el("importBtn").addEventListener("click", () => {
    const box = el("backupBox");
    try {
      const parsed = JSON.parse(box.value);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.starredSetIds)) throw new Error("bad shape");
      state = Object.assign(defaults(), parsed);
      save(); render();
      box.value = "";
      alert("Plan imported.");
    } catch (e) {
      alert("That doesn't look like a valid exported plan.");
    }
  });

  // ---------- render ----------
  function render() {
    dayPicker.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.day === state.lastDay));
    if (activeTab === "timetable") renderTimetable();
    else if (activeTab === "mine") renderMine();
    else renderStages();
  }
  render();

  // refresh "now" highlighting every minute
  setInterval(() => { if (activeTab !== "stages") render(); }, 60 * 1000);

  // ---------- service worker ----------
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline install just won't work */ });
  }
})();
