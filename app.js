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
    myOrder: {}, // per-day custom order of my-timetable grid stages, e.g. { fri: ["mainstage", "loc:Freedom entrance"] }
    myName: "",
    priorities: {}, // itemId -> 2 for must-see
    friends: [],    // [{ name, color, plan: { starredSetIds, customSets } }]
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
  // "23:50" -> "11:50 PM" (times are already Europe/Brussels local)
  function fmt12(t) {
    const [h0, m] = t.split(":").map(Number);
    const h = h0 % 12 || 12;
    const ap = h0 >= 12 ? "PM" : "AM";
    return m ? `${h}:${String(m).padStart(2, "0")} ${ap}` : `${h} ${ap}`;
  }
  const fmtRange = (s, e) => `${fmt12(s)}–${fmt12(e)}`;

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

  // rough stage positions on a 0-100 grid of the Boom grounds (approximated from public
  // festival maps of recent editions) — used only to estimate walking minutes between sets
  const STAGE_POS = {
    "mainstage": [85, 80],
    "freedom-by-bud": [25, 25],
    "the-great-library": [55, 45],
    "atmosphere": [30, 35],
    "core": [15, 75],
    "melodia-by-corona": [20, 50],
    "the-rose-garden": [50, 60],
    "elixir": [60, 55],
    "cage": [35, 20],
    "the-rave-cave": [45, 30],
    "planaxis": [75, 60],
    "crystal-garden": [40, 70],
    "house-of-fortune-by-jbl": [65, 35],
    "celestia-by-kucoin": [55, 75],
    "moose-bar": [35, 50],
  };
  function walkMinutes(stageA, stageB) {
    if (!stageA || !stageB || stageA === stageB) return 0;
    const a = STAGE_POS[stageA], b = STAGE_POS[stageB];
    if (!a || !b) return 0;
    const min = Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) * 0.25);
    return Math.max(2, Math.min(20, min));
  }

  const b64e = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64d = s => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

  // setId -> friends who starred it
  let FMAP = new Map();
  function refreshFmap() {
    FMAP = new Map();
    state.friends.forEach((f, fi) => {
      (f.plan.starredSetIds || []).forEach(id => {
        if (!FMAP.has(id)) FMAP.set(id, []);
        FMAP.get(id).push(f);
      });
      (f.plan.customSets || []).forEach(cs => FMAP.set("fc:" + fi + ":" + cs.id, [f]));
    });
  }
  function chipsHTML(id) {
    const fs = FMAP.get(id);
    if (!fs || !fs.length) return "";
    return `<span class="fchips">${fs.map(f =>
      `<span class="fchip" style="background:${f.color}" title="${esc(f.name)}">${esc((f.name || "?")[0].toUpperCase())}</span>`).join("")}</span>`;
  }
  const isMust = id => state.priorities[id] === 2;

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
    return { dayId: day ? day.id : null, min, date };
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
      dayPicker.hidden = activeTab === "stages"; // stages prefs are day-independent
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
      <span class="time">${fmtRange(set.start, set.end)}</span>
      <span class="artist">${esc(set.artist)}${chipsHTML(set.id)}</span>
      <span class="star">${starred && isMust(set.id) ? "★★" : "★"}</span>
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
    const ord = state.myOrder[state.lastDay] || [];
    const defIdx = e => e.key.startsWith("loc:") ? 1e9 : state.stageOrder.indexOf(e.key);
    const ordIdx = e => { const i = ord.indexOf(e.key); return i < 0 ? 1e9 : i; };
    return [...byKey.values()]
      .map(e => { e.sets.sort((a, b) => toMin(a.start) - toMin(b.start)); return e; })
      .sort((a, b) => (ordIdx(a) - ordIdx(b)) || (defIdx(a) - defIdx(b)));
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
    const h = (12 + Math.floor(min / 60)) % 24;
    return `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}`;
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
    let cls = "";
    if (opts.mine) {
      const meta = (opts.meta && opts.meta[set.id]) || {};
      if (meta.ghost) cls = "ghost";
      else if (opts.clashes.has(set.id)) cls = "clash";
      if (!meta.ghost && isMust(set.id)) cls += " must";
    } else if (state.starredSetIds.includes(set.id)) {
      cls = "starred" + (isMust(set.id) ? " must" : "");
    }
    return `<div class="cal-block ${cls}" data-set="${set.id}"
      style="${style};--set-color:${color}">
      <div class="b-artist">${esc(set.artist)}</div><div class="b-time">${fmtRange(set.start, set.end)}</div>
      ${chipsHTML(set.id)}
    </div>`;
  }

  function bindBlocks(box, opts) {
    box.querySelectorAll(".cal-block").forEach(b => {
      b.addEventListener("click", () => {
        const id = b.dataset.set;
        if (opts.mine) {
          // custom entry → edit; starred set → remove; friend's ghost set → add to my plan
          if (state.customSets.some(s => s.id === id)) { openModal(id); return; }
          if (state.starredSetIds.includes(id)) {
            state.starredSetIds = state.starredSetIds.filter(x => x !== id);
            delete state.priorities[id];
          } else if (setsById[id]) {
            state.starredSetIds.push(id);
          } else {
            return; // a friend's custom entry — nothing to add
          }
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
      head += `<div class="cal-head-cell${opts.mine ? " draggable" : ""}" style="width:${COL}px;--head-color:${e.color}">${esc(e.label)}</div>`;
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
    if (opts.mine) makeDraggable(sc, entries, "x", COL, ".cal-head-cell");
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
      html += `<div class="tl-row"><div class="tl-row-label${opts.mine ? " draggable" : ""}" style="width:${LBL}px;height:${ROW}px;--head-color:${e.color}">${esc(e.label)}</div>`;
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
    if (opts.mine) makeDraggable(sc, entries, "y", ROW, ".tl-row-label");
  }

  // hold a stage name, then drag along `axis` to reorder my-timetable grids;
  // a quick swipe before the hold fires scrolls the container instead
  function makeDraggable(sc, entries, axis, size, sel) {
    const cells = [...sc.querySelectorAll(sel)];
    cells.forEach((cell, startIdx) => {
      cell.addEventListener("contextmenu", e => e.preventDefault());
      cell.addEventListener("pointerdown", e => {
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        let mode = "press", lastX = startX, lastY = startY, targetIdx = startIdx;
        const timer = setTimeout(() => {
          if (mode === "press") { mode = "drag"; cell.classList.add("drag-src"); }
        }, 350);
        try { cell.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }

        const move = ev => {
          const dx = ev.clientX - startX, dy = ev.clientY - startY;
          if (mode === "press" && Math.hypot(dx, dy) > 8) { clearTimeout(timer); mode = "scroll"; }
          if (mode === "scroll") {
            sc.scrollLeft -= ev.clientX - lastX;
            sc.scrollTop -= ev.clientY - lastY;
          } else if (mode === "drag") {
            const d = axis === "x" ? dx : dy;
            const t = v => axis === "x" ? `translateX(${v}px)` : `translateY(${v}px)`;
            cell.style.transform = t(d);
            targetIdx = Math.max(0, Math.min(cells.length - 1, startIdx + Math.round(d / size)));
            cells.forEach((c, i) => {
              if (c === cell) return;
              let shift = 0;
              if (startIdx < targetIdx && i > startIdx && i <= targetIdx) shift = -size;
              else if (targetIdx < startIdx && i >= targetIdx && i < startIdx) shift = size;
              c.style.transform = shift ? t(shift) : "";
            });
          }
          lastX = ev.clientX; lastY = ev.clientY;
        };
        const up = () => {
          clearTimeout(timer);
          cell.removeEventListener("pointermove", move);
          cell.removeEventListener("pointerup", up);
          cell.removeEventListener("pointercancel", up);
          if (mode === "drag") {
            cell.classList.remove("drag-src");
            if (targetIdx !== startIdx) {
              const keys = entries.map(en => en.key);
              const [k] = keys.splice(startIdx, 1);
              keys.splice(targetIdx, 0, k);
              state.myOrder[state.lastDay] = keys;
              save();
            }
            renderMine();
          }
        };
        cell.addEventListener("pointermove", move);
        cell.addEventListener("pointerup", up);
        cell.addEventListener("pointercancel", up);
      });
    });
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

  // my items plus friends' items (ghosts), deduped: my copy wins
  function planItemsForDay(dayId) {
    const map = new Map();
    myItemsForDay(dayId).forEach(s => map.set(s.id, { set: s, mine: true, ghost: false }));
    state.friends.forEach((f, fi) => {
      (f.plan.starredSetIds || []).forEach(id => {
        const s = setsById[id];
        if (!s || s.dayId !== dayId || map.has(id)) return;
        map.set(id, { set: s, mine: false, ghost: true });
      });
      (f.plan.customSets || []).forEach(cs => {
        if (cs.dayId !== dayId) return;
        const id = "fc:" + fi + ":" + cs.id;
        map.set(id, { set: Object.assign({}, cs, { id }), mine: false, ghost: true });
      });
    });
    return [...map.values()].sort((a, b) =>
      toMin(a.set.start) - toMin(b.set.start) || toMin(a.set.end) - toMin(b.set.end));
  }

  // pinned "what's happening for me right now" card (uses today's date, not the selected day)
  function renderNowStrip() {
    const box = el("nowStrip");
    const now = brusselsNow();
    if (!now.dayId) {
      const first = FESTIVAL.days[0];
      const diff = Math.ceil((new Date(first.date) - new Date(now.date)) / 86400000);
      box.innerHTML = diff > 0
        ? `<div class="now-card countdown">🎪 ${diff} day${diff === 1 ? "" : "s"} until ${first.label}, July 24</div>`
        : "";
      return;
    }
    const items = myItemsForDay(now.dayId);
    const cur = items.filter(s => toMin(s.start) <= now.min && now.min < toMin(s.end));
    const next = items.find(s => toMin(s.start) > now.min);
    if (!cur.length && !next) { box.innerHTML = ""; return; }
    let html = `<div class="now-card">`;
    cur.forEach(s => {
      html += `<div class="now-row"><span class="tag now-tag">NOW</span><b>${esc(s.artist)}</b>&nbsp;· ${esc(stageName(s))} · until ${fmt12(s.end)}</div>`;
    });
    if (next) {
      const mins = toMin(next.start) - now.min;
      const from = cur.length ? cur[cur.length - 1] : null;
      const walk = from ? walkMinutes(from.stageId, next.stageId) : 0;
      html += `<div class="now-row"><span class="tag next-tag">NEXT</span><b>${esc(next.artist)}</b>&nbsp;· ${esc(stageName(next))} · in ${mins} min${walk ? ` · ~${walk} min walk` : ""}</div>`;
    }
    box.innerHTML = html + `</div>`;
  }

  function renderMine() {
    const box = el("myList");
    const now = brusselsNow();
    const dayLabel = FESTIVAL.days.find(d => d.id === state.lastDay).label;
    myViewSwitch.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.view === state.myView));
    renderNowStrip();

    const wrapped = planItemsForDay(state.lastDay);
    const mineItems = wrapped.filter(w => w.mine).map(w => w.set);

    if (!wrapped.length) {
      box.innerHTML = `<div class="empty">Nothing planned for ${dayLabel} yet.<br>Star sets in the Timetable tab, or tap + to add your own entry.</div>`;
      return;
    }

    // clash detection (my items only) + tight transitions given walking distance
    const clashes = computeClashes(mineItems);
    const tight = {};
    for (let i = 0; i + 1 < mineItems.length; i++) {
      const a = mineItems[i], b = mineItems[i + 1];
      const gap = toMin(b.start) - toMin(a.end);
      const walk = walkMinutes(a.stageId, b.stageId);
      if (gap >= 0 && walk > 0 && gap < walk) tight[b.id] = { walk, gap };
    }

    if (state.myView !== "list") {
      const meta = {};
      wrapped.forEach(w => { meta[w.set.id] = { ghost: w.ghost }; });
      const opts = { mine: true, clashes, meta };
      const sets = wrapped.map(w => w.set);
      if (state.myView === "calendar") renderCalendarView(box, now, myEntries(sets), opts);
      else renderTimelineView(box, now, myEntries(sets), opts);
      return;
    }

    let html = "";
    let nowLinePlaced = false;
    wrapped.forEach(({ set: it, mine, ghost }) => {
      const isCustom = !!it.custom && mine;
      const playing = now.dayId === state.lastDay && now.min >= toMin(it.start) && now.min < toMin(it.end);
      if (now.dayId === state.lastDay && !nowLinePlaced && (playing || toMin(it.start) > now.min)) {
        html += `<div class="now-line">now</div>`;
        nowLinePlaced = true;
      }
      const badges =
        (playing ? `<span class="badge now">NOW</span>` : "") +
        (mine && clashes.has(it.id) ? `<span class="badge clash">CLASH</span>` : "") +
        (mine && tight[it.id] ? `<span class="badge tight">~${tight[it.id].walk}m walk · ${tight[it.id].gap}m gap</span>` : "") +
        (mine && isMust(it.id) ? `<span class="badge mustb">MUST</span>` : "");
      const color = it.stageId ? stageColor(it.stageId) : "#8a8a9a";
      const prioBtn = `<button class="prio ${isMust(it.id) ? "on" : ""}" data-id="${it.id}" title="Toggle must-see">★★</button>`;
      html += `<div class="my-set ${playing ? "now-playing" : ""} ${ghost ? "ghost" : ""}" style="border-left-color:${color}">
        <div class="info">
          <div class="artist">${esc(it.artist)}${chipsHTML(it.id)}</div>
          <div class="meta">${fmtRange(it.start, it.end)} · ${esc(stageName(it))}</div>
        </div>
        <div class="badges">${badges}</div>
        ${ghost
          ? (setsById[it.id] ? `<button class="addghost" data-id="${it.id}" title="Add to my plan">＋</button>` : "")
          : isCustom
            ? prioBtn + `<button class="edit" data-id="${it.id}" title="Edit">✎</button>`
            : prioBtn + `<button class="unstar" data-id="${it.id}" title="Remove">★</button>`}
      </div>`;
    });
    if (now.dayId === state.lastDay && !nowLinePlaced) html += `<div class="now-line">now</div>`;
    box.innerHTML = html;

    box.querySelectorAll("button.unstar").forEach(b => b.addEventListener("click", () => {
      state.starredSetIds = state.starredSetIds.filter(id => id !== b.dataset.id);
      delete state.priorities[b.dataset.id];
      save(); renderMine();
      if (!views.timetable.hidden) renderTimetable();
    }));
    box.querySelectorAll("button.edit").forEach(b => b.addEventListener("click", () => openModal(b.dataset.id)));
    box.querySelectorAll("button.prio").forEach(b => b.addEventListener("click", () => {
      const id = b.dataset.id;
      if (state.priorities[id] === 2) delete state.priorities[id]; else state.priorities[id] = 2;
      save(); renderMine();
    }));
    box.querySelectorAll("button.addghost").forEach(b => b.addEventListener("click", () => {
      state.starredSetIds.push(b.dataset.id);
      save(); renderMine();
    }));
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

    // a stage counts as "on your plan" once any set there is starred (or a custom entry uses it)
    const starCount = id =>
      state.starredSetIds.filter(sid => setsById[sid] && setsById[sid].stageId === id).length +
      state.customSets.filter(s => s.stageId === id).length;

    const visitedCount = orderedStages().filter(st => starCount(st.id) > 0).length;

    const row = (stage, done) => {
      const hidden = state.hiddenStageIds.includes(stage.id);
      const n = starCount(stage.id);
      return `<div class="stage-pref ${hidden ? "hidden-stage" : ""}" data-stage="${stage.id}">
        <span class="check ${done ? "done" : ""}">${done ? "✓" : ""}</span>
        <input type="color" value="${stageColor(stage.id)}" title="Stage color">
        <span class="name">${esc(stage.name)}${done ? ` <span class="sub">${n} starred</span>` : ""}</span>
        <button class="vis" title="${hidden ? "Show" : "Hide"}">${hidden ? "🚫" : "👁"}</button>
      </div>`;
    };

    let html = `<div class="day-group-label">On your plan · ${visitedCount}/${FESTIVAL.stages.length} stages</div>`;
    orderedStages().forEach(st => { html += row(st, starCount(st.id) > 0); });
    box.innerHTML = html;

    box.querySelectorAll(".stage-pref").forEach(rowEl => {
      const id = rowEl.dataset.stage;
      rowEl.querySelector(".vis").addEventListener("click", () => {
        const i = state.hiddenStageIds.indexOf(id);
        if (i >= 0) state.hiddenStageIds.splice(i, 1); else state.hiddenStageIds.push(id);
        save(); renderStages();
      });
      rowEl.querySelector("input[type=color]").addEventListener("change", e => {
        state.stageColors[id] = e.target.value;
        save(); renderStages();
      });
    });

    renderFriends();
  }

  // ---------- share & friends ----------
  const FRIEND_COLORS = ["#f2a33c", "#3d9df2", "#2ecc71", "#d75ce6", "#ff7043", "#f5d90a", "#1abc9c", "#e6483d"];

  el("sharePlanBtn").addEventListener("click", async () => {
    if (!state.myName) {
      const n = prompt("Your name (shown on friends' timetables):");
      if (!n || !n.trim()) return;
      state.myName = n.trim().slice(0, 20);
      save();
    }
    const payload = {
      v: 1, name: state.myName,
      starredSetIds: state.starredSetIds,
      customSets: state.customSets,
      priorities: state.priorities,
    };
    const url = location.origin + location.pathname + "#share=" + b64e(JSON.stringify(payload));
    if (navigator.share) {
      try { await navigator.share({ title: "My Tomorrowland W2 plan", url }); } catch (e) { /* user cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        alert("Share link copied — paste it in the group chat.");
      } catch (e) {
        prompt("Copy this link:", url);
      }
    }
  });

  function renderFriends() {
    const box = el("friendList");
    box.innerHTML = state.friends.map((f, i) => `
      <div class="friend-row">
        <span class="fchip big" style="background:${f.color}">${esc((f.name || "?")[0].toUpperCase())}</span>
        <span class="name">${esc(f.name)} <span class="sub">${(f.plan.starredSetIds || []).length + (f.plan.customSets || []).length} items</span></span>
        <button class="rm" data-i="${i}" title="Remove">✕</button>
      </div>`).join("");
    box.querySelectorAll(".rm").forEach(b => b.addEventListener("click", () => {
      state.friends.splice(+b.dataset.i, 1);
      save(); refreshFmap(); renderStages();
    }));
  }

  function handleIncomingShare() {
    const m = location.hash.match(/share=([A-Za-z0-9\-_]+)/);
    if (!m) return;
    history.replaceState(null, "", location.pathname + location.search);
    let p;
    try { p = JSON.parse(b64d(m[1])); } catch (e) { return; }
    if (!p || !Array.isArray(p.starredSetIds)) return;
    showShareSheet(p);
  }

  function showShareSheet(p) {
    const name = String(p.name || "A friend").slice(0, 20);
    const n = p.starredSetIds.length + (p.customSets || []).length;
    const bd = document.createElement("div");
    bd.className = "modal-backdrop";
    bd.innerHTML = `<div class="modal">
      <h2>${esc(name)} shared a plan</h2>
      <p class="hint">${n} item${n === 1 ? "" : "s"}. Add it as an overlay on your timetable, or replace your own plan with it.</p>
      <div class="modal-btns stacked">
        <button class="primary" data-act="friend">Add as friend</button>
        <button data-act="mine">Make it my plan</button>
        <button data-act="close">Dismiss</button>
      </div>
    </div>`;
    document.body.appendChild(bd);
    bd.addEventListener("click", e => {
      const act = e.target.dataset ? e.target.dataset.act : null;
      if (e.target === bd || act === "close") { bd.remove(); return; }
      if (act === "friend") {
        const plan = { starredSetIds: p.starredSetIds, customSets: p.customSets || [] };
        const existing = state.friends.find(f => f.name === name);
        if (existing) existing.plan = plan;
        else state.friends.push({ name, color: FRIEND_COLORS[state.friends.length % FRIEND_COLORS.length], plan });
        save(); refreshFmap(); render();
        bd.remove();
      } else if (act === "mine") {
        if (!confirm("Replace your current plan? Your stars and custom entries will be overwritten.")) return;
        state.starredSetIds = p.starredSetIds;
        state.customSets = p.customSets || [];
        state.priorities = p.priorities || {};
        save(); render();
        bd.remove();
      }
    });
  }

  // ---------- day image export (renders in the style of the active view) ----------
  const F = w => `${w} -apple-system, "Segoe UI", Roboto, sans-serif`;

  function exportSetup(W, H, day) {
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#12101a"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#b18cff"; ctx.font = F("700 34px");
    ctx.fillText("TOMORROWLAND W2 2026", 48, 82);
    ctx.fillStyle = "#f0edf7"; ctx.font = F("800 58px");
    ctx.fillText(day.label + (state.myName ? " · " + state.myName : ""), 48, 152);
    return { cv, ctx };
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function fitLine(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
  }

  // wrap into at most maxLines lines, ellipsizing what doesn't fit
  function wrapText(ctx, text, maxW, maxLines) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = "";
    words.forEach(w => {
      const test = cur ? cur + " " + w : w;
      if (!cur || ctx.measureText(test).width <= maxW) cur = test;
      else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      const rest = lines.slice(maxLines - 1).join(" ");
      lines.length = maxLines - 1;
      lines.push(rest);
    }
    return lines.map(l => fitLine(ctx, l, maxW));
  }

  // longest time format that fits: "7:40 PM–8:40 PM" → "7:40–8:40" → "7:40"
  function fitTime(ctx, set, maxW) {
    const short = t => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")}`; };
    const options = [fmtRange(set.start, set.end), `${short(set.start)}–${short(set.end)}`, short(set.start)];
    for (const o of options) if (ctx.measureText(o).width <= maxW) return o;
    return "";
  }

  function itemSpan(items) {
    let start = Infinity, end = 0;
    items.forEach(s => {
      start = Math.min(start, toMin(s.start));
      end = Math.max(end, toMin(s.end));
    });
    return { startMin: Math.floor(start / 60) * 60, endMin: Math.ceil(end / 60) * 60 };
  }

  function exportListImage(day, items) {
    const W = 1080, headH = 200, rowH = 96, footH = 90;
    const H = headH + items.length * rowH + footH;
    const { cv, ctx } = exportSetup(W, H, day);
    const clashes = computeClashes(items);
    items.forEach((it, i) => {
      const y = headH + i * rowH;
      ctx.fillStyle = it.stageId ? stageColor(it.stageId) : "#8a8a9a";
      ctx.fillRect(48, y + 12, 10, rowH - 30);
      ctx.fillStyle = "#f0edf7"; ctx.font = F("700 38px");
      ctx.fillText((isMust(it.id) ? "★ " : "") + it.artist.slice(0, 42), 84, y + 46);
      ctx.fillStyle = "#9a93b0"; ctx.font = F("500 30px");
      ctx.fillText(`${fmtRange(it.start, it.end)} · ${stageName(it)}`, 84, y + 84);
      if (clashes.has(it.id)) {
        ctx.fillStyle = "#ff5c6e"; ctx.font = F("700 26px");
        ctx.fillText("CLASH", W - 160, y + 50);
      }
    });
    return { cv, ctx };
  }

  function exportCalendarImage(day, items) {
    const entries = myEntries(items);
    const { startMin, endMin } = itemSpan(items);
    const GUT = 120, COL = 260, headH = 190, stageH = 64, PPM = 2, footH = 80;
    const W = Math.max(760, GUT + entries.length * COL + 40);
    const gridTop = headH + stageH;
    const H = gridTop + (endMin - startMin) * PPM + footH;
    const { cv, ctx } = exportSetup(W, H, day);

    entries.forEach((e, i) => {
      const x = GUT + i * COL;
      ctx.fillStyle = e.color; ctx.fillRect(x, gridTop - 12, COL - 16, 6);
      ctx.fillStyle = "#f0edf7"; ctx.font = F("700 26px");
      ctx.fillText(e.label.slice(0, 18), x, gridTop - 26);
    });
    for (let m = startMin; m <= endMin; m += 60) {
      const y = gridTop + (m - startMin) * PPM;
      ctx.strokeStyle = "#262336"; ctx.beginPath();
      ctx.moveTo(GUT - 12, y); ctx.lineTo(W - 24, y); ctx.stroke();
      ctx.fillStyle = "#9a93b0"; ctx.font = F("500 24px");
      ctx.fillText(hourLabel(m), 24, y + 9);
    }
    entries.forEach((e, i) => {
      layoutLanes(e.sets).forEach(({ set, lane, lanes }) => {
        const w = (COL - 20) / lanes;
        const x = GUT + i * COL + lane * w;
        const y = gridTop + (toMin(set.start) - startMin) * PPM;
        const h = (toMin(set.end) - toMin(set.start)) * PPM;
        ctx.fillStyle = e.color + "30";
        rr(ctx, x, y + 2, w - 8, h - 4, 10); ctx.fill();
        ctx.fillStyle = e.color; ctx.fillRect(x, y + 2, 6, h - 4);
        const maxW = w - 30;
        ctx.fillStyle = "#f0edf7"; ctx.font = F("700 24px");
        const nameLines = wrapText(ctx, (isMust(set.id) ? "★ " : "") + set.artist, maxW, h >= 94 ? 2 : 1);
        nameLines.forEach((ln, li) => ctx.fillText(ln, x + 16, y + 34 + li * 27));
        const timeY = 34 + nameLines.length * 27;
        if (timeY <= h - 6) {
          ctx.fillStyle = "#9a93b0"; ctx.font = F("500 19px");
          const ts = fitTime(ctx, set, maxW);
          if (ts) ctx.fillText(ts, x + 16, y + timeY);
        }
      });
    });
    return { cv, ctx };
  }

  function exportTimelineImage(day, items) {
    const entries = myEntries(items);
    const { startMin, endMin } = itemSpan(items);
    const LBL = 250, ROW = 120, headH = 190, timeH = 50, PPM = 3, footH = 80;
    const W = LBL + (endMin - startMin) * PPM + 60;
    const gridTop = headH + timeH;
    const H = gridTop + entries.length * ROW + footH;
    const { cv, ctx } = exportSetup(W, H, day);

    for (let m = startMin; m <= endMin; m += 60) {
      const x = LBL + (m - startMin) * PPM;
      ctx.strokeStyle = "#262336"; ctx.beginPath();
      ctx.moveTo(x, gridTop - 12); ctx.lineTo(x, gridTop + entries.length * ROW); ctx.stroke();
      ctx.fillStyle = "#9a93b0"; ctx.font = F("500 24px");
      ctx.fillText(hourLabel(m), x - 26, headH + 30);
    }
    entries.forEach((e, i) => {
      const y = gridTop + i * ROW;
      ctx.fillStyle = e.color; ctx.fillRect(LBL - 30, y + 14, 6, ROW - 28);
      ctx.fillStyle = "#f0edf7"; ctx.font = F("700 26px");
      ctx.fillText(e.label.slice(0, 13), 40, y + ROW / 2 + 9);
      layoutLanes(e.sets).forEach(({ set, lane, lanes }) => {
        const h = (ROW - 20) / lanes;
        const x = LBL + (toMin(set.start) - startMin) * PPM;
        const w = (toMin(set.end) - toMin(set.start)) * PPM;
        const yy = y + 10 + lane * h;
        ctx.fillStyle = e.color + "30";
        rr(ctx, x + 2, yy, w - 6, h - 4, 10); ctx.fill();
        ctx.fillStyle = e.color; ctx.fillRect(x + 2, yy, 6, h - 4);
        const maxW = w - 32;
        ctx.fillStyle = "#f0edf7"; ctx.font = F("700 24px");
        const nameLines = wrapText(ctx, (isMust(set.id) ? "★ " : "") + set.artist, maxW, h >= 92 ? 2 : 1);
        nameLines.forEach((ln, li) => ctx.fillText(ln, x + 18, yy + 32 + li * 27));
        const timeY = 32 + nameLines.length * 27;
        if (timeY <= h - 6) {
          ctx.fillStyle = "#9a93b0"; ctx.font = F("500 19px");
          const ts = fitTime(ctx, set, maxW);
          if (ts) ctx.fillText(ts, x + 18, yy + timeY);
        }
      });
    });
    return { cv, ctx };
  }

  el("dayExportBtn").addEventListener("click", () => {
    const day = FESTIVAL.days.find(d => d.id === state.lastDay);
    const items = myItemsForDay(state.lastDay);
    if (!items.length) { alert("Nothing planned for " + day.label + " yet."); return; }
    const { cv, ctx } =
      state.myView === "calendar" ? exportCalendarImage(day, items) :
      state.myView === "timeline" ? exportTimelineImage(day, items) :
      exportListImage(day, items);
    ctx.fillStyle = "#9a93b0"; ctx.font = F("500 26px");
    ctx.fillText(location.host + location.pathname, 48, cv.height - 32);
    cv.toBlob(async blob => {
      const file = new File([blob], `tml-w2-${day.id}-${state.myView}.png`, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: "My " + day.label + " at Tomorrowland" }); return; } catch (e) { /* cancelled */ }
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    });
  });

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
    refreshFmap();
    dayPicker.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.day === state.lastDay));
    if (activeTab === "timetable") renderTimetable();
    else if (activeTab === "mine") renderMine();
    else renderStages();
  }
  render();
  handleIncomingShare();

  // refresh "now" highlighting every minute (grid views move the rule in place to keep scroll position)
  setInterval(() => {
    if (activeTab === "stages") return;
    if (activeTab === "mine") renderNowStrip();
    if (document.querySelector(".cal-scroll")) updateNowRules();
    else if (activeTab === "mine") renderMine();
    else renderTimetable();
  }, 60 * 1000);

  // ---------- service worker ----------
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline install just won't work */ });
  }
})();
