"use strict";

// ===================== 定数 =====================

const STORAGE_KEY = "areyatta:v1";
const DATA_VERSION = 1;
const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 10;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const EMOJIS = [
  "✅", "💪", "🏃", "🚶", "🧘", "🏋️", "🚴", "🏊", "⚽", "🎾", "📖", "📚",
  "✍️", "📝", "💻", "🧠", "🗣️", "🎧", "🎹", "🎸", "🎨", "🧹", "🧺", "🍳",
  "🥗", "🍎", "💧", "💊", "🦷", "🛁", "🛏️", "😴", "🌅", "⏰", "🌱", "🐕",
  "🐈", "💰", "📵", "🙏", "😊", "☀️",
];

// ===================== 状態 =====================

let state = { version: DATA_VERSION, tasks: [] };
let reorderMode = false;
let editingTaskId = null;
let currentDetailId = null;
let lastRenderedDay = null;

// ===================== 日付ユーティリティ =====================
// 日付境界は端末ローカル時刻の深夜0時。日付は "YYYY-MM-DD" 文字列で扱う。

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isValidDateStr(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseDate(s);
  return !Number.isNaN(d.getTime()) && fmtDate(d) === s;
}

function today() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// 週は月曜始まり
function startOfWeek(d) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const offset = (r.getDay() + 6) % 7;
  r.setDate(r.getDate() - offset);
  return r;
}

// a から b までの日数差（丸めで DST 等の誤差を吸収）
function diffDays(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// ===================== 永続化 =====================

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state = normalizeData(data);
  } catch (err) {
    console.error("データの読み込みに失敗しました", err);
    showToast("保存データの読み込みに失敗しました");
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("データの保存に失敗しました", err);
    showToast("データの保存に失敗しました（容量不足の可能性）");
  }
}

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// インポート/読み込みデータの検証と正規化
function normalizeData(data) {
  const rawTasks = Array.isArray(data) ? data : data && Array.isArray(data.tasks) ? data.tasks : null;
  if (!rawTasks) throw new Error("invalid data format");

  const todayStr = fmtDate(today());
  const seenIds = new Set();
  const tasks = [];

  for (const raw of rawTasks) {
    if (!raw || typeof raw !== "object") continue;
    const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 20) : "";
    if (!title) continue;

    const icon = typeof raw.icon === "string" && raw.icon.trim() && raw.icon.length <= 8 ? raw.icon.trim() : "✅";

    let weeklyGoal = Number.parseInt(raw.weeklyGoal, 10);
    if (!Number.isFinite(weeklyGoal)) weeklyGoal = 1;
    weeklyGoal = Math.min(7, Math.max(1, weeklyGoal));

    // checks はオブジェクト（{"YYYY-MM-DD": true}）と配列（["YYYY-MM-DD"]）の両形式を受け付ける
    const checks = {};
    const rawChecks = raw.checks;
    const keys = Array.isArray(rawChecks)
      ? rawChecks
      : rawChecks && typeof rawChecks === "object"
        ? Object.keys(rawChecks).filter((k) => rawChecks[k])
        : [];
    for (const k of keys) {
      if (isValidDateStr(k) && k <= todayStr) checks[k] = true;
    }

    const checkDates = Object.keys(checks).sort();
    let createdAt = isValidDateStr(raw.createdAt) ? raw.createdAt : null;
    if (!createdAt) createdAt = checkDates[0] || todayStr;
    if (createdAt > todayStr) createdAt = todayStr;

    let id = typeof raw.id === "string" && raw.id ? raw.id : uid();
    if (seenIds.has(id)) id = uid();
    seenIds.add(id);

    const order = Number.isFinite(Number(raw.order)) ? Number(raw.order) : tasks.length;

    tasks.push({ id, title, icon, weeklyGoal, createdAt, checks, order });
  }

  tasks.sort((a, b) => a.order - b.order);
  tasks.forEach((t, i) => { t.order = i; });

  return { version: DATA_VERSION, tasks };
}

// ===================== 統計 =====================

function checkedDates(task) {
  return Object.keys(task.checks).filter((k) => task.checks[k]).sort();
}

// 今週（月曜始まり）の実行日数
function weekCount(task) {
  const start = startOfWeek(today());
  let count = 0;
  for (let i = 0; i < 7; i++) {
    if (task.checks[fmtDate(addDays(start, i))]) count++;
  }
  return count;
}

// 達成率 = 実行日数 ÷ 記録開始日から今日までの経過日数
// 記録開始日は「作成日」と「最初のチェック日」の早い方
function taskStats(task) {
  const dates = checkedDates(task);
  const t0 = today();
  let start = parseDate(task.createdAt);
  if (dates.length && parseDate(dates[0]) < start) start = parseDate(dates[0]);
  const totalDays = Math.max(1, diffDays(start, t0) + 1);
  const done = dates.length;
  const rate = Math.round((100 * done) / totalDays);

  // 現在の連続日数（今日が未チェックなら昨日から遡って数える）
  let cursor = t0;
  if (!task.checks[fmtDate(cursor)]) cursor = addDays(cursor, -1);
  let current = 0;
  while (task.checks[fmtDate(cursor)]) {
    current++;
    cursor = addDays(cursor, -1);
  }

  // 最長の連続日数
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const s of dates) {
    const d = parseDate(s);
    run = prev && diffDays(prev, d) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }

  return { rate, done, current, longest, startDate: start };
}

// ===================== DOM ヘルパー =====================

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add("hidden"), 2500);
}

let confirmResolve = null;

function showConfirm(message, okLabel = "OK") {
  const dialog = $("confirmDialog");
  $("confirmMessage").textContent = message;
  $("confirmOkBtn").textContent = okLabel;
  dialog.showModal();
  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

// ===================== 長押し操作 =====================

function attachLongPress(target, onTrigger) {
  let timer = null;
  let startX = 0;
  let startY = 0;

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    target.classList.remove("holding");
  };

  target.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cancel();
    startX = e.clientX;
    startY = e.clientY;
    target.classList.add("holding");
    timer = setTimeout(() => {
      timer = null;
      target.classList.remove("holding");
      if (navigator.vibrate) navigator.vibrate(30);
      onTrigger();
    }, LONG_PRESS_MS);
  });

  target.addEventListener("pointermove", (e) => {
    if (timer === null) return;
    if (Math.abs(e.clientX - startX) > MOVE_CANCEL_PX || Math.abs(e.clientY - startY) > MOVE_CANCEL_PX) {
      cancel();
    }
  });

  target.addEventListener("pointerup", cancel);
  target.addEventListener("pointerleave", cancel);
  target.addEventListener("pointercancel", cancel);
  target.addEventListener("contextmenu", (e) => e.preventDefault());
}

// ===================== ホーム画面 =====================

function sortedTasks() {
  return [...state.tasks].sort((a, b) => a.order - b.order);
}

function toggleCheck(taskId, dateStr) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (task.checks[dateStr]) {
    delete task.checks[dateStr];
  } else {
    task.checks[dateStr] = true;
  }
  saveState();
  renderHome();
}

function renderHome() {
  lastRenderedDay = fmtDate(today());
  const list = $("taskList");
  list.replaceChildren();

  const tasks = sortedTasks();
  $("emptyState").classList.toggle("hidden", tasks.length > 0);
  $("homeHint").classList.toggle("hidden", tasks.length === 0);
  $("reorderDoneBtn").classList.toggle("hidden", !reorderMode);

  const t0 = today();
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(t0, -i));
  const todayStr = fmtDate(t0);

  for (const task of tasks) {
    const card = el("div", "task-card");

    // ヘッダー行：アイコン + タイトル + 今週の進捗（or 並び替えハンドル）
    const header = el("div", "task-card-header");
    const titleBtn = el("button", "task-title-btn");
    titleBtn.type = "button";
    titleBtn.append(el("span", "task-icon", task.icon), el("span", null, task.title), el("span", "chevron", "›"));
    titleBtn.addEventListener("click", () => {
      if (!reorderMode) location.hash = `#/task/${encodeURIComponent(task.id)}`;
    });
    header.append(titleBtn);

    if (reorderMode) {
      const handles = el("div", "reorder-handles");
      const upBtn = el("button", "reorder-btn", "↑");
      const downBtn = el("button", "reorder-btn", "↓");
      upBtn.type = "button";
      downBtn.type = "button";
      upBtn.disabled = task.order === 0;
      downBtn.disabled = task.order === tasks.length - 1;
      upBtn.addEventListener("click", () => moveTask(task.id, -1));
      downBtn.addEventListener("click", () => moveTask(task.id, 1));
      handles.append(upBtn, downBtn);
      header.append(handles);
    } else {
      const count = weekCount(task);
      const progress = el("div", "week-progress");
      const label = el("div");
      const countSpan = el("span", count >= task.weeklyGoal ? "achieved" : null, String(count));
      label.append("今週 ", countSpan, ` / ${task.weeklyGoal}日`);
      const bar = el("div", "week-progress-bar");
      const fill = el("div");
      fill.style.width = `${Math.min(100, (100 * count) / task.weeklyGoal)}%`;
      bar.append(fill);
      progress.append(label, bar);
      header.append(progress);
    }
    card.append(header);

    // 過去7日セル
    const dayRow = el("div", "day-row");
    for (const d of days) {
      const ds = fmtDate(d);
      const cell = el("div", "day-cell");
      if (task.checks[ds]) cell.classList.add("checked");
      if (ds === todayStr) cell.classList.add("today");
      cell.append(
        el("span", "dow", ds === todayStr ? "今日" : WEEKDAYS[d.getDay()]),
        el("span", "num", String(d.getDate())),
        el("span", "mark", "✓"),
      );
      cell.setAttribute("role", "button");
      cell.setAttribute("aria-label", `${ds} ${task.title} ${task.checks[ds] ? "実行済み" : "未実行"}`);
      if (!reorderMode) {
        attachLongPress(cell, () => toggleCheck(task.id, ds));
        // キーボード・支援技術からも操作できるようにする（長押し不要）
        cell.tabIndex = 0;
        cell.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleCheck(task.id, ds);
          }
        });
      }
      dayRow.append(cell);
    }
    card.append(dayRow);

    list.append(card);
  }
}

function moveTask(taskId, dir) {
  const tasks = sortedTasks();
  const index = tasks.findIndex((t) => t.id === taskId);
  const swapWith = index + dir;
  if (index < 0 || swapWith < 0 || swapWith >= tasks.length) return;
  const a = tasks[index];
  const b = tasks[swapWith];
  [a.order, b.order] = [b.order, a.order];
  saveState();
  renderHome();
}

// ===================== 詳細画面 =====================

function renderDetail(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) {
    location.hash = "";
    return;
  }
  lastRenderedDay = fmtDate(today());
  currentDetailId = taskId;

  $("detailIcon").textContent = task.icon;
  $("detailTitle").textContent = task.title;

  const stats = taskStats(task);
  setStatValue("statRate", String(stats.rate), "%");
  setStatValue("statWeek", `${weekCount(task)} / ${task.weeklyGoal}`, "日");
  setStatValue("statStreak", String(stats.current), "日");
  setStatValue("statLongest", String(stats.longest), "日");
  setStatValue("statTotal", String(stats.done), "日");
  const sd = stats.startDate;
  setStatValue("statSince", `${sd.getFullYear()}/${sd.getMonth() + 1}/${sd.getDate()}`, "");

  renderHeatmap(task);
}

function setStatValue(id, value, unit) {
  const node = $(id);
  node.replaceChildren(document.createTextNode(value));
  if (unit) node.append(el("span", "unit", unit));
}

function renderHeatmap(task) {
  const grid = $("heatmap");
  grid.replaceChildren();

  const t0 = today();
  const todayStr = fmtDate(t0);
  const start = startOfWeek(addDays(t0, -364));

  let prevMonth = -1;
  for (let ws = start; ws <= t0; ws = addDays(ws, 7)) {
    // 各列 = 1週間（月曜始まり）。1行目は月ラベル、2〜8行目が月〜日。
    const month = ws.getMonth();
    const label = el("div", "hm-month", month !== prevMonth ? `${month + 1}月` : "");
    prevMonth = month;
    grid.append(label);

    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      const ds = fmtDate(d);
      const cell = el("div", "hm-cell");
      if (ds > todayStr) {
        cell.classList.add("future");
      } else if (task.checks[ds]) {
        cell.classList.add("checked");
      }
      cell.title = `${ds}${task.checks[ds] ? " ✅" : ""}`;
      grid.append(cell);
    }
  }

  // 直近（右端）までスクロール
  requestAnimationFrame(() => {
    const scroll = $("heatmapScroll");
    scroll.scrollLeft = scroll.scrollWidth;
  });
}

// ===================== タスク登録・編集ダイアログ =====================

let selectedEmoji = EMOJIS[0];
let selectedGoal = 3;

function buildEmojiGrid() {
  const grid = $("emojiGrid");
  for (const emoji of EMOJIS) {
    const btn = el("button", "emoji-btn", emoji);
    btn.type = "button";
    btn.dataset.emoji = emoji;
    btn.setAttribute("aria-label", `アイコン ${emoji}`);
    btn.addEventListener("click", () => selectEmoji(emoji));
    grid.append(btn);
  }
}

function selectEmoji(emoji) {
  selectedEmoji = emoji;
  for (const btn of $("emojiGrid").children) {
    btn.classList.toggle("selected", btn.dataset.emoji === emoji);
  }
}

function buildGoalPicker() {
  const picker = $("goalPicker");
  for (let n = 1; n <= 7; n++) {
    const btn = el("button", "goal-btn", String(n));
    btn.type = "button";
    btn.dataset.goal = String(n);
    btn.setAttribute("aria-label", `週${n}日以上`);
    btn.addEventListener("click", () => selectGoal(n));
    picker.append(btn);
  }
}

function selectGoal(n) {
  selectedGoal = n;
  for (const btn of $("goalPicker").children) {
    btn.classList.toggle("selected", Number(btn.dataset.goal) === n);
  }
}

function openTaskDialog(taskId) {
  editingTaskId = taskId || null;
  const task = taskId ? state.tasks.find((t) => t.id === taskId) : null;

  $("taskDialogTitle").textContent = task ? "タスクを編集" : "新しいタスク";
  $("taskTitleInput").value = task ? task.title : "";
  selectEmoji(task ? task.icon : EMOJIS[0]);
  selectGoal(task ? task.weeklyGoal : 3);

  // プリセットにないアイコン（旧データ等）の場合は先頭を選択状態にする
  if (task && !EMOJIS.includes(task.icon)) selectEmoji(EMOJIS[0]);

  $("taskDialog").showModal();
}

function handleTaskFormSubmit(e) {
  e.preventDefault();
  const title = $("taskTitleInput").value.trim().slice(0, 20);
  if (!title) {
    showToast("タイトルを入力してください");
    return;
  }

  if (editingTaskId) {
    const task = state.tasks.find((t) => t.id === editingTaskId);
    if (task) {
      task.title = title;
      task.icon = selectedEmoji;
      task.weeklyGoal = selectedGoal;
    }
  } else {
    state.tasks.push({
      id: uid(),
      title,
      icon: selectedEmoji,
      weeklyGoal: selectedGoal,
      createdAt: fmtDate(today()),
      checks: {},
      order: state.tasks.length,
    });
  }

  saveState();
  $("taskDialog").close();
  route();
  showToast(editingTaskId ? "タスクを更新しました" : "タスクを登録しました");
}

async function deleteCurrentTask() {
  const task = state.tasks.find((t) => t.id === currentDetailId);
  if (!task) return;
  const ok = await showConfirm(`「${task.title}」を削除します。\nチェック履歴もすべて削除されます。よろしいですか？`, "削除する");
  if (!ok) return;
  state.tasks = state.tasks.filter((t) => t.id !== task.id);
  sortedTasks().forEach((t, i) => { t.order = i; });
  saveState();
  location.hash = "";
  showToast("タスクを削除しました");
}

// ===================== エクスポート / インポート =====================

function exportData() {
  const payload = {
    app: "areyatta",
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    tasks: sortedTasks(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `areyatta-backup-${fmtDate(today()).replaceAll("-", "")}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("エクスポートしました");
}

async function importData(file) {
  let normalized;
  try {
    const text = await file.text();
    normalized = normalizeData(JSON.parse(text));
  } catch (err) {
    console.error("インポートに失敗しました", err);
    showToast("インポートできない形式のファイルです");
    return;
  }
  if (!normalized.tasks.length) {
    showToast("有効なタスクが含まれていません");
    return;
  }
  const ok = await showConfirm(
    `${normalized.tasks.length}件のタスクをインポートします。\n現在のデータはすべて上書きされます。よろしいですか？`,
    "インポート",
  );
  if (!ok) return;
  state = normalized;
  saveState();
  location.hash = "";
  route();
  showToast("インポートしました");
}

// ===================== ルーティング =====================

function route() {
  const hash = location.hash;
  const match = hash.match(/^#\/task\/(.+)$/);
  if (match) {
    let id;
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      // 外部由来の不正なパーセントエンコード列はホームにフォールバック
      location.hash = "";
      return;
    }
    $("homeView").classList.add("hidden");
    $("detailView").classList.remove("hidden");
    renderDetail(id);
  } else {
    currentDetailId = null;
    $("detailView").classList.add("hidden");
    $("homeView").classList.remove("hidden");
    renderHome();
  }
}

// ===================== 初期化 =====================

function wireEvents() {
  $("addTaskBtn").addEventListener("click", () => openTaskDialog(null));
  $("taskForm").addEventListener("submit", handleTaskFormSubmit);
  $("taskCancelBtn").addEventListener("click", () => $("taskDialog").close());

  $("backBtn").addEventListener("click", () => {
    location.hash = "";
  });
  $("editTaskBtn").addEventListener("click", () => openTaskDialog(currentDetailId));
  $("deleteTaskBtn").addEventListener("click", deleteCurrentTask);

  $("menuBtn").addEventListener("click", () => $("menuDialog").showModal());
  $("menuClose").addEventListener("click", () => $("menuDialog").close());
  $("menuReorder").addEventListener("click", () => {
    $("menuDialog").close();
    reorderMode = true;
    renderHome();
  });
  $("reorderDoneBtn").addEventListener("click", () => {
    reorderMode = false;
    renderHome();
  });
  $("menuExport").addEventListener("click", () => {
    $("menuDialog").close();
    exportData();
  });
  $("menuImport").addEventListener("click", () => {
    $("menuDialog").close();
    $("importFileInput").click();
  });
  $("importFileInput").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importData(file);
    e.target.value = "";
  });

  const confirmDialog = $("confirmDialog");
  $("confirmOkBtn").addEventListener("click", () => {
    confirmDialog.close();
    if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
  });
  $("confirmCancelBtn").addEventListener("click", () => {
    confirmDialog.close();
    if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
  });
  confirmDialog.addEventListener("cancel", () => {
    if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
  });

  window.addEventListener("hashchange", route);

  // 日付をまたいでアプリに戻ってきたときに表示を最新化する
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && lastRenderedDay && lastRenderedDay !== fmtDate(today())) {
      route();
    }
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((err) => {
        console.error("Service Worker の登録に失敗しました", err);
      });
    });
  }
}

loadState();
buildEmojiGrid();
buildGoalPicker();
wireEvents();
route();
registerServiceWorker();
