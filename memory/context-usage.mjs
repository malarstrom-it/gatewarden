#!/usr/bin/env node
// Measures the context usage of the agent sessions in this project.
// Source: pi saves every session as JSONL in ~/.pi/agent/sessions/<cwd-encoded>/,
// every assistant row carries usage.totalTokens; the window is in ~/.pi/agent/models.json
// and ~/.pi/agent/models-store.json.
// Policy: README.md in the project `pi-setup` -> "Kontextpolicy (2026-10-24)" (the context policy)
// Usage: node memory/context-usage.mjs [project filter]

import fs from 'node:fs';
import path from 'node:path';

const filter = process.argv[2] || 'traefik-api';
// Two levels - see README.md in the project `pi-setup` "Kontextpolicy (2026-10-24)" (the context policy)
// and policy.json in the plugin `context-ledger-plugin` (the source of truth).
// PLAN = 40 %: the agent continues the ongoing task and prepares the handover.
// THRESHOLD = 50 %: the marker - the same rule, the usage is reported in the handover.
// Over 50 % is not forbidden, but shall never become a surprise: the handover is kept
// up to date already from 40 %.
const PLAN = 40;
const THRESHOLD = 50;

function windowsFrom(file) {
  const out = {};
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        if (node.id && node.contextWindow) out[node.id] = node.contextWindow;
        for (const value of Object.values(node)) {
          if (value && typeof value === 'object') walk(value);
        }
      }
    };
    walk(json);
  } catch {
    /* the file is missing -> skipped */
  }
  return out;
}

const windows = {
  ...windowsFrom(path.join(process.env.HOME, '.pi/agent/models-store.json')),
  ...windowsFrom(path.join(process.env.HOME, '.pi/agent/models.json')),
};

const root = path.join(process.env.HOME, '.pi/agent/sessions');
const rows = [];

for (const dir of fs.readdirSync(root)) {
  if (!dir.includes(filter)) continue;
  for (const file of fs.readdirSync(path.join(root, dir))) {
    const full = path.join(root, dir, file);
    const stat = fs.statSync(full);
    let last = null;
    let model = null;
    let compactions = 0;
    for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
      if (!line) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type === 'compaction' || entry.compaction) compactions += 1;
      const message = entry.message;
      if (message?.role === 'assistant' && message.usage) {
        last = message.usage;
        model = message.model || model;
      }
    }
    if (!last) continue;
    const win = windows[model] || 0;
    const pct = win ? Math.round((100 * last.totalTokens) / win) : null;
    const label = dir.includes('worktrees')
      ? dir.replace(/^--home-[^.-]+-\.herdr-worktrees-/, '').replace(/--$/, '').replace(new RegExp(`^${filter}-`), '')
      : dir.includes('threads-')
        ? dir.replace(/^--home-[^.-]+-\.herdr-projects-.*-threads-/, '').replace(/--$/, '')
        : 'coordinator (project folder)';
    rows.push({
      label,
      model: model || '?',
      tokens: last.totalTokens,
      win,
      pct,
      compactions,
      ageMin: Math.round((Date.now() - stat.mtimeMs) / 60000),
    });
  }
}

rows.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
for (const r of rows) {
  const flag = r.pct === null ? ' ? ' : r.pct >= THRESHOLD ? '!! ' : r.pct >= PLAN ? '! ' : '   ';
  console.log(
    `${flag}${String(r.pct ?? '?').padStart(4)}%  ${String(r.tokens).padStart(7)}/${String(r.win).padStart(7)}  ${r.model}  comp=${r.compactions}  active ${r.ageMin} min  ${r.label}`,
  );
}

const worst = rows.reduce((max, r) => (r.pct !== null && r.pct > (max?.pct ?? -1) ? r : max), null);
if (!worst) {
  console.log('no sessions found for', filter);
} else if (worst.pct >= THRESHOLD) {
  console.log(
    `MARKER EXCEEDED: ${worst.pct}% (${worst.label}). Continue the ongoing task - do not interrupt it. Summarise early and print large outputs with ctx_execute. When the session ends, write the handover in the closing note - what is done, what remains, which files and branch, the next concrete step - and report the usage in the handover (usage against the window and the percentage).`,
  );
} else if (worst.pct >= PLAN) {
  console.log(
    `HANDOVER PREPARED: ${worst.pct}% (${worst.label}). Continue the ongoing task - do not interrupt it. Summarise early and print large outputs with ctx_execute. Keep the handover up to date: when the session ends, write the handover in the closing note - what is done, what remains, which files and branch, the next concrete step - and report the usage in the handover (usage against the window and the percentage).`,
  );
} else {
  console.log(`OK: highest usage ${worst.pct}% (${worst.label}) - measure only, no reporting.`);
}
