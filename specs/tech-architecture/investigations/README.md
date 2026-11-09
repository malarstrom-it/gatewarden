# Design and security investigations

These notes are maintainer-facing investigation inputs, not resolved findings or
new runtime requirements. Each note records its source revision, design rationale,
conditional concerns and questions that can distinguish an intentional tradeoff
from a defect.

- [2026-11-09 agent review](2026-11-09-agent-review.md): networking, credentials,
  configuration, URL semantics and dated supply-chain observations. No code change
  is prescribed; each item needs an explicit investigation decision.

Review notes stay in the source repository rather than the npm package. New
vulnerability reports should follow the private reporting process in
[the security policy](../../../SECURITY.md).
