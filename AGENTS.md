# Shared Agent Working Agreement

This document applies equally to Claude, ChatGPT, and any future coding agent working on Project BEACON.

## Source of truth and handoffs
- **Repository documents and code are authoritative.** No agent should treat another chat's remembered plans as more current than this repository.
- Read README.md, ARCHITECTURE.md, ROADMAP.md, DECISIONS.md, TASKS.md, and CONTRIBUTING.md before changing scope.
- The human owner sets product priorities and approves major architectural tradeoffs.
- Each agent should leave a durable handoff in its pull request or commit description: objective, changed files, tests run, limitations, and next steps.
- Avoid simultaneous edits to the same branch or file; use independent branches and review the diff before merging.
- Disagreement between agents is resolved by tests, documented tradeoffs and the product owner's decision, not by asserting that one model is correct.

## Implementation guardrails
- Ship vertical slices and automated tests, not unverified scaffolds.
- Offline-first means the actual core functions work from a clean cold start without connectivity.
- Tauri 2 + React/TypeScript + Rust + SQLite/FTS5 is the planned stack. A change requires documenting the reason in DECISIONS.md.
- No required logins, telemetry, remote AI, or cloud APIs.
- Treat all imports as untrusted. Avoid execution, path traversal, data leaks and unsafe deserialization.
- Never introduce secrets or private documents into git.
- Keep the Convergence Model and biblical interpretation as optional research content, not as authoritative emergency instructions.
- Do not make unsupported claims about source reliability, offline compatibility, cryptographic safety, or tests.

## Definition of done
1. Acceptance criteria are stated and satisfied or explicitly marked incomplete.
2. Changed code is reviewed, formatted, and tested using the available project commands.
3. Documentation reflects the current code rather than hypothetical behavior.
4. Offline functionality has an appropriate offline test.
5. A concise handoff identifies remaining risks and next work.
