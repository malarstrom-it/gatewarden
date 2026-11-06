# Memory

One line per memory file: `- [title](memory/file.md): what it holds`.
- [Context policy](memory/context-policy.md): pointer to the global policy (40 % prepares the handover, 50 % is the marker, the agent continues the task, no compaction).
- [Context measurement](memory/context-usage.mjs): the measuring tool that counts the used context (usage.totalTokens ÷ contextWindow) and reports at 40 % and 50 % that the task continues and that the handover is written in the closing note.
- [The board](memory/boarden.md): what of the 0.2 material now lives in the repository, what is left outside the repository, and where the board's backlog lives.

The files came from the 0.2 project and now live in the repo. The memory of the
installation itself — the confirmed DNS namespace, the FQDN template, the routing
model, the container facts and the TLS rules — does not live in the repo: it stays
with the board, outside the repository. What moved, what stayed and where the
backlog is: [the board](memory/boarden.md).
