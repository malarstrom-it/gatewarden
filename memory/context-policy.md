# Kontextpolicy (2026-10-24)

Pekare till den globala policyn: `/home/node/projects/pi-setup/README.md` →
avsnittet **"Kontextpolicy (2026-10-24)"**. Dit gäller:

- **pi komprimerar inte medvetet** (`compaction.enabled = false` i `~/.pi/agent/settings.json`,
  eftersom context-mode ska hålla kontexten liten) — det finns ingen komprimering att falla
  tillbaka på; överlämning till en ny session är mekanismen.
- **under 40 %:** mät bara, ingen rapportering.
- **från 40 %:** agenten **fortsätter den pågående uppgiften** så länge det går. Uppgiften
  avbryts inte mitt i. Sammanfatta tidigt och skriv ut stora utskrifter med `ctx_execute`
  i stället för att dra in dem rakt in i kontexten. Håll samtidigt överlämningen aktuell,
  så att den kan skrivas när som helst.
- **från 50 %:** samma regel — fortsätt den pågående uppgiften. Det finns ingen
  komprimering att falla tillbaka på. Över 50 % är inte förbjudet, men ska aldrig bli en
  överraskning: beläggningen redovisas i överlämningen när sessionen avslutas.
- **Överlämningen** är sessionens **slutnot**. Den skrivs när sessionen avslutas — aldrig
  mitt i en pågående uppgift — och ska räcka för att en ny agent kan fortsätta precis där
  den gamla slutade. Den innehåller:
  - vad som är gjort;
  - vad som kvarstår;
  - vilka filer som är rörda och vilken branch (och worktree) som håller arbetet,
    inklusive ocommittat arbete;
  - nästa konkreta steg;
  - beläggningen: tokens / kontextfönster och procenten.
- **Mätning:** sessions-JSONL i `~/.pi/agent/sessions/<cwd-kodad>/`, `usage.totalTokens` ÷
  `contextWindow` (MiniMax: 1 000 000 i `models-store.json`; Codex: 500 000 i `models.json`).
- **Mätverktyg i det här repot:** `memory/context-usage.mjs` (`PLAN = 40`, `THRESHOLD = 50`).
  Det skriver ut samma regeltexter som policyfilen: att uppgiften fortsätter och att
  överlämningen skrivs i slutnoten.

## Maskinläsbar sanningskalla (2026-10-25)

Trösklarna **40 % / 50 %** och regeltexterna ligger nu i pluginens policyfil:

    /home/node/projects/context-ledger-plugin/policy.json

Extensionen laddas av **varje** pi-process (shim i `/.pi/agent/extensions/context-ledger/),
så reglerna injiceras i agentens egen prompt i stället för att behöva läsas härifrån.
Se context-ledger-plugin/docs/context-policy-injection.md för mekanismen och begränsningarna.
Den här filen är pekare - sanningskällan är policy.json.
