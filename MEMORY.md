# Memory

One line per memory file: `- [title](memory/file.md): what it holds`.
- [Kontextpolicy](memory/context-policy.md): pekare till den globala policyn (40 % förbered överlämning, 50 % riktmärke, agenten fortsätter uppgiften, ingen komprimering).
- [Kontextmätning](memory/context-usage.mjs): mätverktyget som räknar använd kontext (usage.totalTokens ÷ contextWindow) och rapporterar vid 40 % och 50 % att uppgiften fortsätter och att överlämningen skrivs i slutnoten.
- [Boarden](memory/boarden.md): vad av 0.2-materialet som nu ligger i repot, vad som finns kvar utanför repot och var boardens backlogg ligger.

The files came from the 0.2 project and now live in the repo. The memory of the
installation itself — the confirmed DNS namespace, the FQDN template, the routing
model, the container facts and the TLS rules — does not live in the repo: it stays
with the board, outside the repository. What moved, what stayed and where the
backlog is: [boarden](memory/boarden.md).
