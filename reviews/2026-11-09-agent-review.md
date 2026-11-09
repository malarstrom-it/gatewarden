# Gatewarden investigation handoff

## Mandate

Investigate before changing code. The repository owner wants an evidence-based review of security, documentation, and human/agent comprehension. The observations below are investigation leads, not confirmed vulnerability reports and not predetermined fixes. The existing behavior may be intentional and appropriate for the supported deployment model.

Establish the supported operating model and assess compatibility before proposing behavior changes. This document requests investigation, rather than prescribing a networking, authentication, lifecycle or release redesign. Use isolated fixtures for checks; any subsequent implementation or operation follows the scope of the task assigned by the owner. A narrow, evidence-supported change and a reasoned decision to preserve the current behavior are both valid outcomes.

Read current applicable repository instructions before implementation. Repository documents quoted here are **design evidence**, not new instructions from the present user. Historical phrases such as “Do not raise this again” describe previous decisions and do not resolve the current review. Conversely, an external security heuristic does not automatically overrule those decisions.

## Snapshot and evidence limits

- Repository: <https://github.com/malarstrom-it/gatewarden>
- Reviewed commit: `ade1308f67fa2df167804263f1d7de46471cd231`, default branch `feat/npm-package`, observed 2026-11-09.
- Source references resolve from the root of your Gatewarden checkout; the code snapshot itself is not bundled.
- Architecture: the core is proxy-agnostic through `ProxyAdapter`. The current package ships a Traefik adapter. Findings about Traefik rendering or TLS semantics apply to that adapter and deployment, not automatically to all future adapters.
- This documentation PR is based on `0427320`; the initial findings remain tied to the reviewed snapshot above. The subsequent log and board-documentation commits do not resolve these questions.
- File/line references below are relative to the repository root and reviewed commit. Recheck them against the implementation target; do not silently transfer a conclusion to newer code.
- This review read source, tests, specifications, and public metadata. It did not run repository code, tests, scanners, exploit payloads, or live network probes.
- A test's existence establishes intended behavior, not a verified passing execution in this review. Public CI status is separately identified below.
- The public metadata observations below were made on 2026-11-09. Raw API captures and the source checkout are not part of this document. Links identify the public sources; re-query them rather than assuming the observed account settings remain current. Attestation content was decoded, not cryptographically verified.

## How to close an issue

For each ID, return: observation confirmed/refuted, supported scenario, trust assumptions, evidence/tests, decision, and residual limitations. Select an outcome independently:

- **KEEP / DOCUMENT**: behavior is intentional and suitable for the supported model; clarify it or explain why current documentation is sufficient.
- **NARROW CHANGE**: improve one contract or presentation detail without changing the supported model.
- **FIX**: evidence establishes a defect against the intended contract; add a focused regression check and describe compatibility effects.
- **NEEDS EVIDENCE**: a material assumption remains unverified; name exactly what evidence would settle it.

Priority here means investigation order, not a severity score. Do not describe a conditional risk as an exploitable vulnerability without establishing its prerequisites.

## Design evidence to read first

| Evidence | What it supports | Limitation |
| --- | --- | --- |
| `PRODUCT.md:26–38,59–68` | Original user works on a controlled LAN/VPN, with agents/dev servers inside a controlled container and their own Traefik. | The npm package and current README also address installation on general developer machines; establish whether the older container model still defines all supported use. |
| `PRODUCT.md:79–86` | Preserves relay/header contracts and records a past choice to have no configured registry secret. | This is an older product record, not a present instruction to dismiss contrary evidence. No configured secret is different from no supported secret mechanism. |
| `specs/tech-architecture/traefik-dev-gateway.md:644,654–657` | Broad Docker-network trust and deriving the container's IPv6 /64 were deliberate: proxy DNS could select IPv4 or IPv6 and an exact source address was not known in advance. | A container network decision may or may not be suitable for a host-native installation on changing networks. |
| `specs/tech-architecture/gatewarden.md:268–311` | Registry source-address checks, additive `registryAllowedCidrs`, optional per-listener secret checks, and loopback health exception are deliberate. | The spec does not by itself establish which source ranges should be added automatically on every platform. |
| `specs/tech-architecture/traefik-dev-gateway.md:37,413–419` | Browser→Traefik HTTPS and Traefik→container HTTP are explicit design choices. | The security of the second hop depends on deployment assumptions. |
| `docs/AGENTS.md:1–18` | Consumers should use the returned URL rather than reconstruct a hostname, and remove routes when stopping servers. | This is a portable consumer integration block. It does not instruct a reviewer to start/publish a server merely to read the repository. |
| `MEMORY.md:8–13` | Some installation-specific facts and TLS/routing decisions remain outside the repository. | Missing context may justify NEEDS EVIDENCE rather than inventing a deployment assumption. |

## Product and implementation investigations

### GW-NET-001 — Effective IPv6 trust expansion

**Observation, high confidence:** `src/core/config.ts:54–56` has loopback-only `DEFAULT_CONFIG.allowedCidrs` and an empty secret. `loadConfigWithReport` appends values from `detectIpv6Prefixes()` to the merged allowlist at `:320–325`, after loading explicit file/override values. `detectIpv6Prefixes` inspects all host interfaces at `:112–128`, excludes internal and link-local addresses, and derives /64 strings. It does not test whether an interface is a Docker interface. The runtime therefore differs from just the static default. `test/net.test.ts:63–76` deliberately checks the automatic container-prefix behavior.

**Conditional concern:** if a machine has a non-loopback IPv6 interface, the derived prefix is valid and routable, and another host in that prefix can reach a listener, that host may satisfy source-address authorization even if the owner supplied a narrower list. If the secret is empty, no header secret is then required. This concern needs network conditions; a firewall or fully trusted isolated network changes its significance. It is not a claim that all Internet hosts can connect.

**Possible legitimate reasons:** dual-stack Docker name resolution, dynamic container addresses, and deliberate trust of the entire isolated development network are recorded in the historical architecture. An empty secret may be an accepted choice inside that boundary.

**Questions and discriminating checks:**

1. Is the supported boundary “all peers on these development networks,” “the proxy,” or a configurable choice? Does the same answer apply to host-native macOS/Linux and container installations?
2. In an isolated fixture with mocked network interfaces, what is the effective list for no configuration, an explicit proxy /128, a custom override, and a newly attached non-Docker /64? Preserve current tests as evidence rather than automatically rewriting them.
3. Does a supplied allowlist mean exhaustive authorization or extra authorization on top of discovered prefixes? Can users express an exhaustive list today?
4. Check compressed IPv6 and multiple-interface cases when validating derived prefixes. Do not assume string splitting reliably identifies a subnet without checking representative addresses.
5. Does setup/doctor display the effective runtime ranges clearly enough before the user relies on the boundary?

**Acceptable conclusions:** KEEP / DOCUMENT if whole-network trust is supported and knowingly selected; NARROW CHANGE if effective policy needs clearer presentation or an explicit policy choice; FIX if runtime expansion violates an established exhaustive-list contract; NEEDS EVIDENCE if deployment scope cannot be established. Any change must preserve supported dual-stack proxy reachability or identify an explicit migration.

### GW-NET-002 — IPv6 configuration serialization and policy round trips

**Observation, high confidence:** `configFileContent` at `src/core/config.ts:561–569` filters `allowedCidrs` to entries containing no colon plus the static loopback values. Thus an explicitly configured non-loopback IPv6 /128 or /64 is omitted when this serialization function is used. `writeConfigFile` calls it at `:593–597`. Runtime discovery can later add a /64 back; that is separate from preserving the owner's explicit entry.

**Conditional concern:** if the configuration writer is expected to preserve explicit user authorization, write/reload can lose or change that policy. Losing a /128 may break reachability; replacing an exact intended source with an automatically inferred /64 can also broaden the effective policy. The precise consequence depends on interfaces and the writer caller.

**Possible legitimate reasons:** the comment at `config.ts:551–559` explicitly aims to avoid persisting ephemeral network-derived prefixes. Existing representation may assume all non-loopback IPv6 values are derived. This can be adequate for an installation that never supplies explicit IPv6 peers.

**Questions and discriminating checks:** enumerate every call site of `configFileContent` and distinguish display from persisted configuration; build a pure round-trip fixture with explicit IPv4, IPv6 /128, explicit IPv6 /64, discovered /64, and `registryAllowedCidrs`; compare semantic authorization before and after saving/reloading. Establish whether IPv6 peer entries are supported user input or should be rejected/documented as unsupported. Ask whether derived and explicit values are intentionally conflated in the data model.

**Acceptable conclusions:** KEEP / DOCUMENT if serialization intentionally excludes unsupported values and the boundary is clear; NARROW CHANGE to distinguish explicit/derived values if warranted; FIX for a reproduced loss of supported configuration; NEEDS EVIDENCE for ambiguous writer contracts. Resolve separately from GW-NET-001: one may be intentional while the other is a persistence defect.

### GW-SEC-001 — Gateway authentication headers reaching the dev upstream

**Observation, high confidence:** Traefik rendering injects `X-Relay-Secret` when configured (`src/adapters/traefik.ts:180–182`). `filterHeaders` in `src/core/relay.ts:19–43` removes a fixed hop-by-hop set but does not remove the relay secret or dispatch header. It is used for ordinary HTTP at `:78–84` and WebSocket request reconstruction at `:161–169`. Source address plus optional secret are checked before forwarding (`:54–61,143–147`; `src/core/trust.ts:141–155`). A test deliberately verifies forwarding of the WS dispatch header (`test/websocket.test.ts:123–136`); dispatch and authentication headers need not have identical contracts.

**Conditional concern:** a dev app, request logger, error page, or plugin can receive the installation-wide relay secret. That matters if these components are less trusted than the gateway/proxy or disclose request headers. Knowledge of the secret alone does not bypass the source allowlist. A dev app controlled by the same fully trusted owner may already have other access to configuration, reducing the practical impact.

**Possible legitimate reasons:** broad transparent forwarding and upstream debugging; the original operating model treats dev apps/agents inside one controlled container as trusted. The dispatch header may be part of existing diagnostics or integration expectations. No reviewed design passage establishes a specific need for upstream access to the authentication secret.

**Questions and discriminating checks:** capture upstream headers in isolated HTTP and WebSocket fixtures with and without configured secret; identify any legitimate upstream consumer of the secret separately from `X-Dev-Target`; trace whether upstream code already can read the same config; identify log/error reflection paths; determine whether registry and relay intentionally share one credential and whether that changes consequences. Preserve required `Host`, `X-Forwarded-*`, HMR and streaming behavior in any candidate change.

**Acceptable conclusions:** KEEP / DOCUMENT if upstreams are explicitly within the credential trust boundary and propagation is needed; NARROW CHANGE if an unnecessary internal header can be omitted without contract changes; FIX if disclosure crosses the intended boundary; NEEDS EVIDENCE if trust or consumers are unknown. Do not silently remove all custom/proxy headers.

### GW-SEC-002 — Secret visibility in configuration command output

**Observation, high confidence:** `commandConfig` writes `configFileContent(config)` to JSON (`src/cli/index.ts:530–543`) and iterates raw configuration values for text output (`:545–548`). The configuration contains `secret`. In contrast, status has `secretConfigured` (`src/core/status.ts:110,156`).

**Conditional concern:** users/agents may paste routine diagnostics into issues, chat, CI artifacts, or logs. A credential may then leave its intended boundary. This is a user-invoked command, not evidence of unauthenticated network exfiltration. Existing consumers may intentionally depend on full-fidelity JSON.

**Possible legitimate reasons:** the config command is an inspection/serialization interface for the owner, and full output aids scripting, backup, or reproducibility. A local authorized user may already read the configuration file.

**Questions and discriminating checks:** establish whether `config --json` is a stable machine interface and which consumers read the secret field; compare normal status/doctor/config outputs; verify documentation examples and support instructions; determine whether an explicit raw-secret mode would preserve real use cases if masking is proposed. Any redaction must not accidentally redact persisted configuration or change the secret when writing it.

**Acceptable conclusions:** KEEP / DOCUMENT with explicit guidance on sensitive output; NARROW CHANGE with compatible redaction/explicit disclosure if justified; FIX if an established diagnostic safety contract is violated; NEEDS EVIDENCE about consumers. Do not describe a deliberate local config export as a remote leak.

### GW-FS-001 — Configuration file and directory permissions

**Observation, high confidence:** `src/core/config.ts:593–597` creates the parent directory recursively and writes the config without explicit mode. `SECURITY.md:166–168` already documents default permissions (0644 subject to umask) and advises `chmod 600` on multi-user machines. `scripts/postinstall.mjs:81–97` calls the writer only if the config is absent and creates configuration/state/cache directories. Other writers and migrations need separate tracing.

**Conditional concern:** when a secret is configured and another local account can traverse its parent path, file permissions/ACLs may allow that account to read it. Parent directory permissions, platform defaults, umask, container isolation, and ACLs can eliminate or change this risk. Existing files may keep their mode when rewritten; a creation-only mode is not necessarily a complete migration.

**Possible legitimate reasons:** single-user container/host model, administrator-managed configuration readable by a shared group, standard platform permissions, and not wanting to modify an existing owner's ACL policy.

**Questions and discriminating checks:** trace every config create/write/migration path; test a fresh file with permissive POSIX umask and a pre-existing shared-mode file; inspect parent directory traversal assumptions; determine Windows behavior separately; investigate symlink and atomic-write requirements only within the owner's actual threat model, without expanding into a blanket filesystem redesign. Establish whether secure owner-only files conflict with any supported shared deployment.

**Acceptable conclusions:** KEEP / DOCUMENT if the supported isolation and permission contract are sufficient; NARROW CHANGE for safer creation defaults while preserving intentional sharing; FIX for a demonstrated violation of supported multi-user isolation; NEEDS EVIDENCE if platform or deployment facts are missing. Do not apply recursive chmod/ACL changes across user directories.

### GW-URL-001 — Returned URL scheme and actual frontend TLS semantics

**Observation, high confidence:** `src/core/status.ts:36` constructs `https://` unconditionally and CLI register prints `https://` at `src/cli/index.ts:321`. The Traefik renderer adds an explicit TLS block only when `certResolver` and a route zone are available (`src/adapters/traefik.ts:169–175`). The README configuration table describes an empty resolver as no TLS block/plain HTTP. Browser→proxy TLS, proxy→relay HTTP, and relay→loopback HTTP are different hops.

**Conditional concern:** a returned HTTPS URL may overpromise availability in a supported configuration that only serves HTTP. Conversely, **an empty `certResolver` is not sufficient evidence that Traefik serves HTTP**: entrypoint TLS defaults, existing certificates, or externally managed TLS may make HTTPS correct. Changing the URL to HTTP solely because the resolver is empty could break valid installations or reduce transport protection.

**Possible legitimate reasons:** Gatewarden's supported product contract may require HTTPS at the proxy regardless of certificate ownership. Historical specs explicitly delegate TLS to the owner's proxy and intentionally use HTTP on the backend hop (`specs/tech-architecture/traefik-dev-gateway.md:413–419`). Returning the desired address may be distinct from proving current availability.

**Questions and discriminating checks:** define whether `url` is an intended endpoint, derived configured endpoint, or verified reachable endpoint; test/document proxies with router TLS, entrypoint-default TLS, HTTP-only frontend, existing certificates without resolver, and incomplete setup; compare doctor and publish checks; check schema consumers before adding any field or scheme configuration. Use isolated fixtures or a designated test proxy, not the user's live proxy by default.

**Acceptable conclusions:** KEEP / DOCUMENT if HTTPS is an explicit prerequisite/desired-address contract; NARROW CHANGE to clarify verification or separate intended/observed status; FIX if a supported mode demonstrably returns the wrong scheme; NEEDS EVIDENCE if effective proxy defaults are unavailable. Backend HTTP is an intentional architecture choice unless current scope establishes otherwise; do not automatically add mTLS or replace proxy wiring.

## Supply-chain and external assessment investigations

These items concern build/release evidence and project governance. Keep them separate from runtime exposure findings. A badge cannot close GW-NET/SEC/FS/URL issues.

### GW-SC-001 — Reproducibility and mutability of workflow dependencies

**Observation:** workflow files reference `actions/checkout@v4` and `actions/setup-node@v4` (`.github/workflows/ci.yml:52–53`, repeated elsewhere and in publish). `publish.yml:163` installs `npm@latest`. CI declares `contents: read` (`ci.yml:43–44`). Publish grants `contents: read` and `id-token: write` at job scope. CI has an audit job (`ci.yml:71–82`).

**Conditional concern:** mutable references can alter execution without a repository change. This is a supply-chain/reproducibility consideration, not proof of a compromised dependency. A supported mutable release policy and rapid maintenance can be a deliberate tradeoff.

**Investigation:** inspect current action/release immutability, permission scope and credential lifetime; determine whether release npm can be pinned while meeting staged publishing requirements; check for automated dependency updates and owner maintenance capacity. A static workflow omission is not proof that a GitHub feature is disabled.

**Possible outcomes:** KEEP / DOCUMENT a justified update policy; NARROW CHANGE to reviewed SHA/version pins with an update mechanism; FIX if an existing reproducibility policy is violated; NEEDS EVIDENCE. GitHub's guidance supports SHA pinning/minimum token permissions: <https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions>.

### GW-SC-002 — Required review and ruleset evidence

**Observation:** the [public ruleset response](https://api.github.com/repos/malarstrom-it/gatewarden/rulesets/26320596) observed on 2026-11-09 shows active organization ruleset `26320596` for `feat/npm-package`, requiring PR, workflow `ci.yml`, no deletion, and no non-fast-forward updates. `required_approving_review_count` is 0. `require_last_push_approval` is false. `required_status_checks` is empty **but the separate required-workflow rule is present**. No tag ruleset appeared in the [public ruleset list](https://api.github.com/repos/malarstrom-it/gatewarden/rulesets) observed on that date. Public response does not establish all bypass settings. CI for reviewed commit succeeded: <https://github.com/malarstrom-it/gatewarden/actions/runs/42606144051>.

**Conditional concern:** requiring a PR is not the same as independent human review. Review separation may be infeasible for a solo-maintainer project; that does not make all changes unsafe. The open [PR #52](https://github.com/malarstrom-it/gatewarden/pull/52) described its red run as an intentional bypass test and is not evidence that current defaultbranch CI fails.

**Investigation:** compare public settings with authenticated owner-visible bypass/release-tag rules; establish a workable review policy; inspect how security-sensitive changes receive independent scrutiny. Do not require an imaginary second maintainer or treat AI review as human separation.

**Possible outcomes:** KEEP / DOCUMENT a solo-maintainer limitation; NARROW CHANGE to review/tag rules where practical; FIX an unintended bypass; NEEDS EVIDENCE about privileged settings. Ruleset: <https://github.com/malarstrom-it/gatewarden/rules/26320596>.

### GW-SC-003 — Published provenance, scanning, and external scores

**Observation:** npm latest was 0.1.2 in the [public package metadata](https://registry.npmjs.org/@malarstrom%2fgatewarden/latest). An attestation was retrieved from the [npm attestation endpoint](https://registry.npmjs.org/-/npm/v1/attestations/@malarstrom%2fgatewarden@0.1.2) and its statement decoded; it references `publish.yml`, tag `v0.1.2`, commit `835b78fb4e0ada02836f358ff6d9910a47e13576` and run <https://github.com/malarstrom-it/gatewarden/actions/runs/42533239529>. Signature validity was not cryptographically checked. GitHub Releases API returned an empty list. The Scorecard API returned 404, meaning no result was obtained, not a low score. Only CI and publish workflows were found in the checkout; CodeQL default setup or other server-side features could still be enabled.

**Conditional concern:** describing intended workflow settings as verified package integrity or absence of a workflow as absence of scanning would overstate the evidence. Provenance identifies origin/build context; it does not prove the code is vulnerability-free.

**Investigation:** verify the actual published package with appropriate signature tooling; inspect npm trusted-publisher stage-only/disallow-token settings and GitHub scanning/settings with authorized access; obtain and inspect a real Scorecard result. Identify useful release/SBOM consumers before adding new artifacts. Recheck current scanner detection rules rather than assuming npm provenance satisfies GitHub release-signature checks.

**Possible outcomes:** KEEP / DOCUMENT verified current evidence; NARROW CHANGE for missing verification instructions or useful scanning; FIX a demonstrated release policy mismatch; NEEDS EVIDENCE. npm guidance: <https://docs.npmjs.com/trusted-publishers/>. Scorecard check definitions and limitations, including exclusion of AI/bot reviews from human `Code-Review`: <https://github.com/ossf/scorecard/blob/main/docs/checks.md>.

## Documentation policy investigation

### GW-DOC-001 — Current product contract versus historical deployment record

**Observation:** historical product/spec files describe a controlled-container LAN/VPN deployment, while current installation language covers general developer machines. `SECURITY.md:118–119` names static loopback defaults without explaining GW-NET-001's runtime expansion. Its “only answers the proxy” heading at `:113` is less precise than the source-address/optional-secret implementation. `SECURITY.md:184–186` says the secret is the only barrier despite the always-applied CIDR check. The optional-secret policy and HTTP backend are explicitly recorded design choices, not automatically defects.

**Conditional concern:** humans and agents may reason from the simplified promise, apply it to a different deployment, or generate patches based on stale requirements. Conversely, deleting old context without preserving its rationale can cause needless reimplementation and regressions.

**Investigation:** distinguish normative current contracts from historical decisions; mark superseded installation-specific assumptions; reconcile README, SECURITY, specs and consumer agent instructions after resolving the relevant implementation questions. Verify whether users understand that authenticating the proxy to the relay does not authenticate the person visiting the proxy. Establish whether exposing a route means LAN/VPN-only, or simply whatever reachability and frontend authorization the operator configured.

**Possible outcomes:** KEEP / DOCUMENT an explicit supported deployment model; NARROW CHANGE to statements/links/diagrams without behavior changes; FIX materially false current guidance; NEEDS EVIDENCE for missing owner context. Do not remove nuanced design rationale or add unverified claims such as “audited”, “zero trust”, “end-to-end encrypted”, “secure by default”, or a predicted assessment score.

## Suggested final investigation record

For each stable ID, fill in this small record so a later reviewer can distinguish an intentional design from an unresolved concern:

```text
ID:
Reviewed revision:
Observation: confirmed / refuted / changed since snapshot
Supported scenario and trust boundary:
Design rationale considered:
Evidence or focused test result:
Decision: KEEP / DOCUMENT | NARROW CHANGE | FIX | NEEDS EVIDENCE
Reason:
Compatibility and operational implications:
Remaining uncertainty:
```

This handoff intentionally does not choose those decisions for the implementing agent.
