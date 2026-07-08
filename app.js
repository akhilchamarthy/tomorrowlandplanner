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
    timetableView: "list",
    myView: "list",
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

  const viewSwitch = el("viewSwitch");
  viewSwitch.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      state.timetableView = btn.dataset.view;
      save(); renderTimetable();
    });
  });

  const myViewSwitch = el("myViewSwitch");
  myViewSwitch.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      state.myView = btn.dataset.view;
      save(); renderMine();
    });
  });

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
    viewSwitch.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.view === state.timetableView));

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

    if (state.timetableView !== "list") {
      const entries = visibleStagesWithSets(state.lastDay);
      if (!entries.length) {
        box.innerHTML = `<div class="empty">All stages are hidden. Unhide some in the Stages tab.</div>`;
        return;
      }
      const opts = { mine: false };
      if (state.timetableView === "calendar") renderCalendarView(box, now, entries, opts);
      else renderTimelineView(box, now, entries, opts);
      return;
    }
    renderListView(box, now);
  }

  function renderListView(box, now) {
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

  // ---------- grid views ----------
  // grid column/row entries: { label, color, sets }
  function visibleStagesWithSets(dayId) {
    return orderedStages()
      .filter(st => !state.hiddenStageIds.includes(st.id))
      .map(st => ({
        label: st.name,
        color: stageColor(st.id),
        sets: FESTIVAL.sets
          .filter(s => s.stageId === st.id && s.dayId === dayId)
          .sort((a, b) => toMin(a.start) - toMin(b.start)),
      }))
      .filter(e => e.sets.length);
  }

  // group my-timetable items into entries per stage / custom location
  function myEntries(items) {
    const byKey = new Map();
    items.forEach(it => {
      const key = it.stageId || "loc:" + (it.location || "Custom");
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          label: stageName(it),
          color: it.stageId ? stageColor(it.stageId) : "#8a8a9a",
          sets: [],
        });
      }
      byKey.get(key).sets.push(it);
    });
    const idx = e => e.key.startsWith("loc:") ? 1e9 : state.stageOrder.indexOf(e.key);
    return [...byKey.values()]
      .map(e => { e.sets.sort((a, b) => toMin(a.start) - toMin(b.start)); return e; })
      .sort((a, b) => idx(a) - idx(b));
  }

  function computeClashes(items) {
    const clashes = new Set();
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (toMin(items[j].start) < toMin(items[i].end) && toMin(items[i].start) < toMin(items[j].end)) {
          clashes.add(items[i].id); clashes.add(items[j].id);
        }
      }
    }
    return clashes;
  }

  function dayEndMin(entries) {
    let end = 780; // at least until 01:00
    entries.forEach(e => e.sets.forEach(s => { end = Math.max(end, toMin(s.end)); }));
    return Math.ceil(end / 60) * 60;
  }

  // my-timetable grids start at the first planned item instead of noon
  function gridStartMin(entries, opts) {
    if (!opts.mine) return 0;
    let start = Infinity;
    entries.forEach(e => e.sets.forEach(s => { start = Math.min(start, toMin(s.start)); }));
    return Math.floor(start / 60) * 60;
  }

  function hourLabel(min) {
    return String((12 + Math.floor(min / 60)) % 24).padStart(2, "0") + ":00";
  }

  // side-by-side lanes for sets that overlap on the same stage
  function layoutLanes(sets) {
    const out = [];
    let cluster = [], clusterEnd = -1;
    const flush = () => {
      if (!cluster.length) return;
      const laneEnds = [];
      const placed = cluster.map(s => {
        let lane = laneEnds.findIndex(e => e <= toMin(s.start));
        if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
        laneEnds[lane] = toMin(s.end);
        return { set: s, lane };
      });
      placed.forEach(p => out.push({ set: p.set, lane: p.lane, lanes: laneEnds.length }));
      cluster = []; clusterEnd = -1;
    };
    sets.forEach(s => {
      if (cluster.length && toMin(s.start) >= clusterEnd) flush();
      cluster.push(s);
      clusterEnd = Math.max(clusterEnd, toMin(s.end));
    });
    flush();
    return out;
  }

  function blockHTML(set, style, color, opts) {
    const cls = opts.mine
      ? (opts.clashes.has(set.id) ? "clash" : "")
      : (state.starredSetIds.includes(set.id) ? "starred" : "");
    return `<div class="cal-block ${cls}" data-set="${set.id}"
      style="${style};--set-color:${color}">
      <div class="b-artist">${esc(set.artist)}</div><div class="b-time">${set.start}–${set.end}</div>
    </div>`;
  }

  function bindBlocks(box, opts) {
    box.querySelectorAll(".cal-block").forEach(b => {
      b.addEventListener("click", () => {
        const id = b.dataset.set;
        if (opts.mine) {
          // custom entry → edit; starred set → remove from plan
          if (state.customSets.some(s => s.id === id)) { openModal(id); return; }
          state.starredSetIds = state.starredSetIds.filter(x => x !== id);
          save(); renderMine();
        } else {
          const i = state.starredSetIds.indexOf(id);
          if (i >= 0) state.starredSetIds.splice(i, 1); else state.starredSetIds.push(id);
          save();
          b.classList.toggle("starred", i < 0);
        }
      });
    });
  }

  function sizeScroller(sc) {
    const top = sc.getBoundingClientRect().top;
    const tab = document.querySelector(".tabbar").offsetHeight;
    sc.style.height = Math.max(220, window.innerHeight - top - tab - 10) + "px";
  }
  window.addEventListener("resize", () => {
    const sc = document.querySelector(".cal-scroll");
    if (sc) sizeScroller(sc);
  });

  // columns across the top, time down the left
  function renderCalendarView(box, now, entries, opts) {
    const COL = 120, PPM = 1.1, GUT = 46, HEAD = 34;
    const startMin = gridStartMin(entries, opts);
    const endMin = dayEndMin(entries);
    const H = (endMin - startMin) * PPM;

    let head = `<div class="cal-head"><div class="cal-corner" style="width:${GUT}px;height:${HEAD}px"></div>`;
    entries.forEach(e => {
      head += `<div class="cal-head-cell" style="width:${COL}px;--head-color:${e.color}">${esc(e.label)}</div>`;
    });
    head += `</div>`;

    let gutter = `<div class="cal-gutter" style="width:${GUT}px;height:${H}px">`;
    for (let m = startMin + 60; m <= endMin; m += 60) {
      gutter += `<div class="gutter-label" style="top:${(m - startMin) * PPM}px">${hourLabel(m)}</div>`;
    }
    gutter += `</div>`;

    let canvas = `<div class="cal-canvas" style="width:${entries.length * COL}px;height:${H}px;background:` +
      `repeating-linear-gradient(180deg, var(--bg3) 0, var(--bg3) 1px, transparent 1px, transparent ${60 * PPM}px),` +
      `repeating-linear-gradient(90deg, transparent 0, transparent ${COL - 1}px, var(--bg3) ${COL - 1}px, var(--bg3) ${COL}px)">`;
    entries.forEach((e, i) => {
      layoutLanes(e.sets).forEach(({ set, lane, lanes }) => {
        const w = (COL - 6) / lanes;
        canvas += blockHTML(set,
          `left:${i * COL + 2 + lane * w}px;top:${(toMin(set.start) - startMin) * PPM + 1}px;` +
          `width:${w - 2}px;height:${(toMin(set.end) - toMin(set.start)) * PPM - 3}px`,
          e.color, opts);
      });
    });
    if (now.dayId === state.lastDay && now.min >= startMin && now.min <= endMin) {
      canvas += `<div class="now-rule h" data-ppm="${PPM}" data-start="${startMin}" style="top:${(now.min - startMin) * PPM}px"></div>`;
    }
    canvas += `</div>`;

    box.innerHTML = `<div class="cal-scroll">${head}<div class="cal-body">${gutter}${canvas}</div></div>`;
    const sc = box.firstElementChild;
    sizeScroller(sc);
    if (now.dayId === state.lastDay) sc.scrollTop = Math.max(0, (now.min - startMin) * PPM - 150);
    bindBlocks(box, opts);
  }

  // rows down the left, time across the top
  function renderTimelineView(box, now, entries, opts) {
    const LBL = 88, ROW = 50, PPM = 3, HEAD = 24;
    const startMin = gridStartMin(entries, opts);
    const endMin = dayEndMin(entries);
    const W = (endMin - startMin) * PPM;
    const showNow = now.dayId === state.lastDay && now.min >= startMin && now.min <= endMin;

    let html = `<div class="cal-scroll">`;
    html += `<div class="cal-head"><div class="cal-corner" style="width:${LBL}px;height:${HEAD}px"></div>` +
      `<div class="tl-head-canvas" style="width:${W}px;height:${HEAD}px">`;
    for (let m = startMin + 60; m < endMin; m += 60) {
      html += `<div class="tl-head-label" style="left:${(m - startMin) * PPM}px">${hourLabel(m)}</div>`;
    }
    html += `</div></div>`;

    entries.forEach(e => {
      html += `<div class="tl-row"><div class="tl-row-label" style="width:${LBL}px;height:${ROW}px;--head-color:${e.color}">${esc(e.label)}</div>`;
      html += `<div class="tl-row-canvas" style="width:${W}px;height:${ROW}px;background:` +
        `repeating-linear-gradient(90deg, var(--bg3) 0, var(--bg3) 1px, transparent 1px, transparent ${60 * PPM}px)">`;
      layoutLanes(e.sets).forEach(({ set, lane, lanes }) => {
        const h = (ROW - 4) / lanes;
        html += blockHTML(set,
          `left:${(toMin(set.start) - startMin) * PPM + 1}px;top:${2 + lane * h}px;` +
          `width:${(toMin(set.end) - toMin(set.start)) * PPM - 3}px;height:${h - 2}px`,
          e.color, opts);
      });
      if (showNow) html += `<div class="now-rule v" data-ppm="${PPM}" data-start="${startMin}" style="left:${(now.min - startMin) * PPM}px"></div>`;
      html += `</div></div>`;
    });
    html += `</div>`;

    box.innerHTML = html;
    const sc = box.firstElementChild;
    sizeScroller(sc);
    if (showNow) sc.scrollLeft = Math.max(0, (now.min - startMin) * PPM - 120);
    bindBlocks(box, opts);
  }

  // move the "now" rule without a full re-render (avoids scroll jumps)
  function updateNowRules() {
    const now = brusselsNow();
    document.querySelectorAll(".now-rule").forEach(r => {
      if (now.dayId !== state.lastDay) { r.remove(); return; }
      const ppm = parseFloat(r.dataset.ppm);
      const off = (now.min - (parseFloat(r.dataset.start) || 0)) * ppm;
      if (r.classList.contains("h")) r.style.top = off + "px";
      else r.style.left = off + "px";
    });
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
    myViewSwitch.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.view === state.myView));

    if (!items.length) {
      box.innerHTML = `<div class="empty">Nothing planned for ${dayLabel} yet.<br>Star sets in the Timetable tab, or tap + to add your own entry.</div>`;
      return;
    }

    // clash detection: overlapping intervals
    const clashes = computeClashes(items);

    if (state.myView !== "list") {
      const opts = { mine: true, clashes };
      if (state.myView === "calendar") renderCalendarView(box, now, myEntries(items), opts);
      else renderTimelineView(box, now, myEntries(items), opts);
      return;
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

  // refresh "now" highlighting every minute (grid views move the rule in place to keep scroll position)
  setInterval(() => {
    if (activeTab === "stages") return;
    if (document.querySelector(".cal-scroll")) updateNowRules();
    else if (activeTab === "mine") renderMine();
    else renderTimetable();
  }, 60 * 1000);

  // ---------- service worker ----------
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline install just won't work */ });
  }
})();
