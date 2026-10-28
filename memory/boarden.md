# Boarden

Översikt över vad som flyttats från 0.2-projektet
(`/home/node/.herdr-projects-legacy/traefik-api/`) in i repot, vad som finns kvar där, och var
boardens backlogg för repot ligger.

## Nu i repot

- `MEMORY.md` — indexet över minnesfilerna.
- `memory/traefik-namespace.md` — de bekräftade faktorna (DNS-namnrymden, FQDN-mallen,
  routingmodellen, containerfakta, TLS-reglerna) plus en kronologisk logg över indexsidan och
  de beslut som följde efteråt.
- `memory/context-policy.md` — pekare till den globala kontextpolicyn (uppgiften fortsätter,
  överlämningen skrivs i slutnoten).
- `memory/context-usage.mjs` — mätverktyget för kontextbeläggning (40 % / 50 %).
- `memory/boarden.md` — den här filen.

## Finns kvar i /home/node/.herdr-projects-legacy/traefik-api/

- `AGENTS.md` (och `CLAUDE.md`, en symlänk dit) — projektets stående instruktioner. Det som
  gäller dev-servern finns redan i repot: `skills/dev-gateway/SKILL.md`, `README.md` och
  `docs/traefik.md`.
- `PROJECT.md` — projektets namn, mål och rollinställningar (goal, `[[repos]]`).
- `TASKS.md` — 0.2-projektets backlogg. Den var tom.
- `threads/` — sju trådar, `t-0001` till `t-0007`, med `.md`, `.task.md` och `.toml` per tråd.
- `library/` — materialet trådarna producerade: `t-0002` sparade Traefik-konfigurationen som
  json/yaml, `t-0007` sparade "daylight"-världen och kandidaterna.
- `routines/pr-followup.md` — rutinen för att följa upp en PR.
- `inbox/`, `scratch/`, `uploads/`, `.state/` — herdr-projects egen drift (ingång, lås, tickare,
  coordinator-state). Inte material.

## Var backloggen ligger

Uppgifterna för repot ligger på boarden, inte i repot. Boardens *to do*-lista visas av
`herdr-projects list`, och uppgifterna för det här repot heter `traefik-api/<n>` (till exempel
`traefik-api/1`, den här uppgiften). `TASKS.md` i 0.2-projektet var tom och stannar kvar som
historia.
