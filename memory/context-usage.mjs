#!/usr/bin/env node
// Mäter kontextbeläggning för agent-sessioner i det här projektet.
// Källa: pi sparar varje session som JSONL i ~/.pi/agent/sessions/<cwd-kodad>/,
// varje assistant-rad bär usage.totalTokens; fönstret finns i ~/.pi/agent/models.json
// och ~/.pi/agent/models-store.json.
// Policy: /home/node/projects/pi-setup/README.md -> "Kontextpolicy (2026-10-24)"
// Användning: node memory/context-usage.mjs [projektfilter]

import fs from 'node:fs';
import path from 'node:path';

const filter = process.argv[2] || 'bricktory-landing';
// Två nivåer - se /home/node/projects/pi-setup/README.md "Kontextpolicy (2026-10-24)".
// PLAN = 40 %: planera åtgärd (mindre sessioner, sammanfatta tidigt, ctx_execute).
// THRESHOLD = 50 %: riktmärke - rapportera beläggningen och agera.
// Över 50 % är inte förbjudet, men ska aldrig bli en överraskning: åtgärden ska vara
// planerad redan vid 40 %.
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
    /* fil saknas -> hoppas över */
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
      ? dir.replace(/^--home-node-\.herdr-worktrees-/, '').replace(/--$/, '').replace(new RegExp(`^${filter}-`), '')
      : dir.includes('threads-')
        ? dir.replace(/^--home-node-\.herdr-projects-.*-threads-/, '').replace(/--$/, '')
        : 'koordinator (projektfolder)';
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
    `${flag}${String(r.pct ?? '?').padStart(4)}%  ${String(r.tokens).padStart(7)}/${String(r.win).padStart(7)}  ${r.model}  comp=${r.compactions}  aktiv ${r.ageMin} min  ${r.label}`,
  );
}

const worst = rows.reduce((max, r) => (r.pct !== null && r.pct > (max?.pct ?? -1) ? r : max), null);
if (!worst) {
  console.log('inga sessioner hittade for', filter);
} else if (worst.pct >= THRESHOLD) {
  console.log(
    `RIKTMARKE OVERSTIGET: ${worst.pct}% (${worst.label}). Rapportera belaggningen och agera - dela upp arbetet i mindre sessioner.`,
  );
} else if (worst.pct >= PLAN) {
  console.log(
    `PLANERA AATGARD: ${worst.pct}% (${worst.label}). Dela upp arbetet i mindre sessioner, sammanfatta tidigt, skriv ut stora utskrifter med ctx_execute, och skriv ut planen i naesta svar.`,
  );
} else {
  console.log(`OK: hoggsta belaggning ${worst.pct}% (${worst.label}) - mät bara, ingen rapportering.`);
}
