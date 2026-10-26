# Kontextpolicy (2026-10-24)

Pekare till den globala policyn: `/home/node/projects/pi-setup/README.md` →
avsnittet **"Kontextpolicy (2026-10-24)"**. Dit gäller:

- **pi komprimerar inte medvetet** (`compaction.enabled = false` i `~/.pi/agent/settings.json`,
  eftersom context-mode ska hålla kontexten liten) — det finns ingen komprimering att falla
  tillbaka på; överlämning till en ny session är mekanismen.
- **under 40 %:** mät bara, ingen rapportering.
- **från 40 %:** planera åtgärd — dela upp arbetet i mindre sessioner, sammanfatta tidigt,
  skriv ut stora utskrifter med `ctx_execute` — och skriv ut planen i nästa svar.
- **från 50 %:** rapportera beläggningen och agera. Över 50 % är inte förbjudet, men ska
  aldrig bli en överraskning: åtgärden ska vara planerad redan vid 40 %.
- **Mätning:** sessions-JSONL i `~/.pi/agent/sessions/<cwd-kodad>/`, `usage.totalTokens` ÷
  `contextWindow` (MiniMax: 1 000 000 i `models-store.json`; Codex: 500 000 i `models.json`).
- **Mätverktyg att kopiera in:** `/home/node/.herdr-projects/bricktory-landing/memory/context-usage.mjs`
  (`PLAN = 40`, `THRESHOLD = 50`).

## Maskinläsbar sanningskalla (2026-10-25)

Trösklarna **40 % / 50 %** och regeltexterna ligger nu i pluginens policyfil:

    /home/node/projects/context-ledger-plugin/policy.json

Extensionen laddas av **varje** pi-process (shim i `/.pi/agent/extensions/context-ledger/),
så reglerna injiceras i agentens egen prompt i stället för att behöva läsas härifrån.
Se context-ledger-plugin/docs/context-policy-injection.md för mekanismen och begränsningarna.
Den här filen är pekare - sanningskällan är policy.json.
