# Context policy (2026-10-24)

A pointer to the global policy: README.md in the project `pi-setup` →
the section **"Kontextpolicy (2026-10-24)"** (the context policy of that project).
There the following holds:

- **pi does not compact on purpose** (`compaction.enabled = false` in `~/.pi/agent/settings.json`,
  because context-mode shall keep the context small) — there is no compaction to fall back
  to; the handover to a new session is the mechanism.
- **under 40 %:** measure only, no reporting.
- **from 40 %:** the agent **continues the ongoing task** for as long as it goes. The task is
  not interrupted halfway. Summarise early and print large outputs with `ctx_execute`
  instead of pulling them straight into the context. Keep the handover up to date
  at the same time, so that it can be written at any moment.
- **from 50 %:** the same rule — continue the ongoing task. There is no
  compaction to fall back to. Over 50 % is not forbidden, but shall never become a
  surprise: the usage is reported in the handover when the session ends.
- **The handover** is the **closing note** of the session. It is written when the session ends — never
  halfway through an ongoing task — and shall be enough for a new agent to continue exactly where
  the old one stopped. It contains:
  - what has been done;
  - what remains;
  - which files are touched and which branch (and worktree) holds the work,
    including uncommitted work;
  - the next concrete step;
  - the usage: tokens / context window and the percentage.
- **Measuring:** the session JSONL in `~/.pi/agent/sessions/<cwd-encoded>/`, `usage.totalTokens` ÷
  `contextWindow` (MiniMax: 1 000 000 in `models-store.json`; Codex: 500 000 in `models.json`).
- **Measuring tool in this repository:** `memory/context-usage.mjs` (`PLAN = 40`, `THRESHOLD = 50`).
  It prints the same rule texts as the policy file, in English: that the task continues and that
  the handover is written in the closing note.

## Machine-readable source of truth (2026-10-25)

The thresholds **40 % / 50 %** and the rule texts now live in the policy file of the plugin:

    context-ledger-plugin/policy.json

The extension is loaded by **every** pi process (shim in `~/.pi/agent/extensions/context-ledger/`),
so the rules are injected into the agent's own prompt instead of having to be read from here.
See context-ledger-plugin/docs/context-policy-injection.md for the mechanism and the limitations.
This file is a pointer - the source of truth is policy.json.
