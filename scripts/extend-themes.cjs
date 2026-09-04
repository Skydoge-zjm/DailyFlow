// -*- coding: utf-8 -*-
// 向三个主题 CSS 追加新增组件的主题化样式
const fs = require("fs");

const refined = `
/* ===== 深度轮新增组件（refined-minimal） ===== */
.stat-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(86px, 1fr)); gap: 10px; margin-bottom: 18px; }
.stat-card { background: var(--card); border: 1px solid var(--border-soft); border-radius: 14px; padding: 11px 13px 10px; box-shadow: var(--shadow-soft); transition: transform 0.16s; }
.stat-card:hover { transform: translateY(-1.5px); }
.stat-value { font-size: 21px; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.1; }
.stat-label { font-size: 10.5px; color: var(--text-faint); margin-top: 3px; letter-spacing: 1px; text-transform: uppercase; }
.stat-card.hot .stat-value { color: var(--accent); }
.stat-card.danger .stat-value { color: var(--red); }
.stat-card.warn .stat-value { color: var(--red); opacity: 0.8; }
.stat-card.goal .stat-value { color: var(--green); }
.stat-card.calm .stat-value { color: var(--text-dim); }
.overdue-label { color: var(--red); }
.overdue-group .task-item { background: var(--card); }
.task-inline-input { font-size: 14px; padding: 5px 10px; border-radius: 9px; background: var(--bg-soft); border: 1.5px solid var(--accent); outline: none; width: 100%; color: var(--text); font-family: inherit; }
.toast-undo { margin-left: 12px; padding: 3px 12px; border-radius: 7px; background: var(--accent); color: var(--bg); font-size: 12px; font-weight: 650; }
.week-cal-head { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.week-cal-head h3 { flex: 1; margin-bottom: 0; }
.week-nav { width: 22px; height: 22px; border-radius: 7px; font-size: 14px; color: var(--text-faint); display: inline-flex; align-items: center; justify-content: center; }
.week-nav:hover { background: var(--card-hover); color: var(--accent); }
.empty-title { font-size: 14px; font-weight: 600; color: var(--text-dim); margin-top: 4px; }
.empty-hint { font-size: 11px; margin-top: 7px; }
.note-dot { width: 12px; height: 12px; border-radius: 4px; flex-shrink: 0; margin-top: 3px; border: 1px solid var(--border-soft); }
.note-resize { position: fixed; right: 2px; bottom: 2px; width: 15px; height: 15px; cursor: nwse-resize; z-index: 10; background: linear-gradient(135deg, transparent 50%, var(--text-faint) 50%); opacity: 0.3; }
.note-resize:hover { opacity: 0.8; }
.ring-fg.done-all { stroke: var(--green); }
.ring-label.done-all { color: var(--green); }
`;

const glass = `
/* ===== 深度轮新增组件（glassmorphism） ===== */
.stat-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(86px, 1fr)); gap: 9px; margin-bottom: 16px; }
.stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 15px; padding: 11px 13px 10px; backdrop-filter: blur(20px) saturate(1.5); box-shadow: 0 4px 18px rgba(0,0,0,0.2); transition: all 0.2s; }
.stat-card:hover { transform: translateY(-1.5px); border-color: var(--border-glow); }
.stat-value { font-size: 21px; font-weight: 750; font-variant-numeric: tabular-nums; line-height: 1.1; }
.stat-label { font-size: 10.5px; color: var(--text-faint); margin-top: 3px; letter-spacing: 0.5px; }
.stat-card.hot .stat-value { color: var(--accent); }
.stat-card.danger { border-color: rgba(255,107,122,0.4); }
.stat-card.danger .stat-value { color: var(--red); }
.stat-card.warn .stat-value { color: var(--red); opacity: 0.85; }
.stat-card.goal .stat-value { color: var(--green); }
.stat-card.calm .stat-value { color: var(--text-dim); }
.overdue-label { color: var(--red); }
.overdue-group .task-item { border-color: rgba(255,107,122,0.3); }
.task-inline-input { font-size: 14px; padding: 5px 10px; border-radius: 9px; background: var(--bg-soft); border: 1.5px solid var(--accent); outline: none; width: 100%; color: var(--text); font-family: inherit; }
.toast-undo { margin-left: 12px; padding: 3px 12px; border-radius: 8px; background: linear-gradient(135deg, var(--accent), #ff7b3d); color: #fff; font-size: 12px; font-weight: 700; }
.week-cal-head { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.week-cal-head h3 { flex: 1; margin-bottom: 0; }
.week-nav { width: 22px; height: 22px; border-radius: 8px; font-size: 14px; color: var(--text-faint); display: inline-flex; align-items: center; justify-content: center; transition: all 0.15s; }
.week-nav:hover { background: var(--card-hover); color: var(--accent); }
.empty-title { font-size: 14px; font-weight: 650; color: var(--text-dim); margin-top: 4px; }
.empty-hint { font-size: 11px; margin-top: 7px; }
.note-dot { width: 12px; height: 12px; border-radius: 4px; flex-shrink: 0; margin-top: 3px; border: 1px solid var(--border-glow); box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
.note-resize { position: fixed; right: 2px; bottom: 2px; width: 15px; height: 15px; cursor: nwse-resize; z-index: 10; background: linear-gradient(135deg, transparent 50%, var(--text-faint) 50%); opacity: 0.35; }
.note-resize:hover { opacity: 0.8; }
.ring-fg.done-all { stroke: var(--green); }
.ring-label.done-all { color: var(--green); }
`;

const warm = `
/* ===== 深度轮新增组件（warm-journal） ===== */
.stat-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(86px, 1fr)); gap: 9px; margin-bottom: 16px; }
.stat-card { background: var(--card); border: 1.5px dashed var(--border-dashed); border-radius: 14px; padding: 11px 13px 10px; box-shadow: var(--shadow-soft); transition: all 0.18s; }
.stat-card:hover { transform: translateY(-1.5px) rotate(-0.4deg); border-color: var(--accent); border-style: solid; }
.stat-value { font-size: 21px; font-weight: 750; font-variant-numeric: tabular-nums; line-height: 1.1; }
.stat-label { font-size: 10.5px; color: var(--text-faint); margin-top: 3px; letter-spacing: 0.5px; }
.stat-card.hot .stat-value { color: var(--accent); }
.stat-card.danger .stat-value { color: var(--red); }
.stat-card.warn .stat-value { color: var(--red); opacity: 0.85; }
.stat-card.goal .stat-value { color: var(--green); }
.stat-card.calm .stat-value { color: var(--text-dim); }
.overdue-label { color: var(--red); }
.overdue-label::before { content: "· "; color: var(--red); }
.task-inline-input { font-size: 14px; padding: 5px 10px; border-radius: 10px; background: var(--bg-soft); border: 1.5px solid var(--accent); outline: none; width: 100%; color: var(--text); font-family: inherit; }
.toast-undo { margin-left: 12px; padding: 3px 12px; border-radius: 9px; background: var(--accent); color: #fff; font-size: 12px; font-weight: 750; }
.week-cal-head { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.week-cal-head h3 { flex: 1; margin-bottom: 0; }
.week-cal-head h3::before { content: "✿ "; color: var(--accent); font-size: 11px; }
.week-nav { width: 22px; height: 22px; border-radius: 8px; font-size: 14px; color: var(--text-faint); display: inline-flex; align-items: center; justify-content: center; }
.week-nav:hover { background: var(--card-hover); color: var(--accent); }
.empty-title { font-size: 14px; font-weight: 750; color: var(--text-dim); margin-top: 4px; }
.empty-hint { font-size: 11px; margin-top: 7px; }
.note-dot { width: 12px; height: 12px; border-radius: 4px; flex-shrink: 0; margin-top: 3px; border: 1px dashed var(--border-dashed); }
.note-resize { position: fixed; right: 2px; bottom: 2px; width: 15px; height: 15px; cursor: nwse-resize; z-index: 10; background: linear-gradient(135deg, transparent 50%, var(--text-faint) 50%); opacity: 0.35; }
.note-resize:hover { opacity: 0.8; }
.ring-fg.done-all { stroke: var(--green); }
.ring-label.done-all { color: var(--green); }
`;

fs.appendFileSync("src/themes/refined-minimal.css", refined);
fs.appendFileSync("src/themes/glassmorphism.css", glass);
fs.appendFileSync("src/themes/warm-journal.css", warm);
console.log("theme css extended");
