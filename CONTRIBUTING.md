# Contributing to BEACON

BEACON is currently in early design and foundation development. Collaboration should be reviewable, tested, and respectful of offline and privacy requirements.

## Team roles
- **Product owner:** Chooses priorities and accepts feature scope.
- **ChatGPT:** Helps with architecture, planning, acceptance tests and review.
- **Claude / Codex:** Can implement scoped tasks in isolated branches and independently review each other's changes.
- Roles are flexible; no model is automatically authoritative.

## Recommended workflow
1. Read [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md) if using Claude, [ARCHITECTURE.md](ARCHITECTURE.md), [ROADMAP.md](ROADMAP.md), [TASKS.md](TASKS.md) and [DECISIONS.md](DECISIONS.md).
2. Pick one task ID from TASKS.md, e.g. B-001.
3. Create a branch such as `feat/B-001-tauri-shell`.
4. Make the minimum viable, testable change. Do not mix refactors or speculative new features.
5. Test, document the actual test commands and results, update tasks/ADRs if needed.
6. Open a pull request and get review before merging.

Do not commit directly to `main` for feature work once collaboration begins. Avoid two agents working on the same task or shared files at the same time.

## Pull-request template
Use this format in PR descriptions:

```md
## Objective
Task ID and user-visible outcome.

## Changes
Files and behavior changed.

## Verification
Exact commands run and observed results.
Offline/device checks performed.

## Risk and limits
Security, privacy, platform gaps, assumptions.

## Handoff
Next suggested task; documentation updated.
```

## Quality rules
- Work offline at a cold start: no required cloud calls, sign-ins or external AI.
- Use strict input and path validation; imported content is untrusted.
- Never commit secrets, private Project E content, test credentials or copyrighted material without permission.
- Preserve source attribution, original bytes where practical, and licensing notes.
- Include tests for errors, not just happy paths.
- Don't claim a feature is complete without running it or making the limitation explicit.
- Document actual commands once the scaffold exists. Do not invent setup scripts or pass statuses.

## Versioning
Proposed milestone: **0.1.0 First Light**. Releases follow observed functionality, not the calendar.
