# CLAUDE.md

Claude Code project file. The canonical agent contract is in `AGENTS.md` — read it first.

@AGENTS.md

## Claude-Code-specific guidance

Only Claude-harness behavior goes here. Anything agent-neutral belongs in `AGENTS.md`.

### Verify, then claim done

Before reporting any task complete, **run the relevant make target and report its outcome**. Do not infer success from a clean diff. Minimum bars for common changes:

| Change touches | Required verification |
|---|---|
| Any code | `make typecheck` |
| Renderer, IPC, database, or workers | `make rebuild-node && make test` |
| Electron lifecycle, packaging, or worker bootstrap | `make ci-full` (includes startup smoke) |
| UI component | Build dev, check visually in a browser, and run any relevant perf E2E |

If verification is impossible in the current environment, say so explicitly. Don't claim a UI change "works" without opening the app.

### Workflow conventions

- Use **Plan Mode** for anything that modifies more than one file or touches an unfamiliar subsystem. Skip it for typo fixes, log additions, or one-line renames — describing the diff in one sentence is the bar.
- For investigations across the codebase, **delegate to subagents** (`Explore`, `Plan`, or the `gsd-*` family). Their context window is separate; preserve yours for the work itself.
- When working inside `.planning/`, prefer the project's GSD skills (`/gsd-plan-phase`, `/gsd-execute-phase`, `/gsd-code-review`, etc.) over ad-hoc edits. They enforce the repo's planning conventions automatically.

### Memory and auto-memory

Project-level memory lives under `~/.claude/projects/-home-bernt-popp-development-VarLens/memory/`. When saving memory, keep it to the four categories the harness defines (user, feedback, project, reference) and avoid duplicating facts that already exist in `AGENTS.md` — memory is for things the files can't say.

### Permissions and auto mode

`make ci-full` is the canonical go/no-go command. If a user asks for autonomous work, `--permission-mode auto` with `make ci-full` as the final gate is the expected pattern. Do not weaken CI to make autonomous runs succeed.

### Skills over free-form instructions

If a skill exists for what you're about to do (brainstorming, TDD, finishing-a-branch, code review, debugging, GSD workflow), invoke it instead of improvising. Skills encode the repo's conventions; improvisation drifts.
