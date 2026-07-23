# omp-governance

An [Oh My Pi](https://github.com/gyoz-ai/omp) plugin that enforces a fixed set of session-wide engineering rules — dispatch discipline for the chief agent, a comment ban, a test skip-marker ban, a `Cargo.lock` guard, and a mandatory post-task verification checklist.

Bash-command filtering (hard blocks, ask-first prompts, per-project-kind blocks) has moved to the companion [`omp-bash-guard`](https://github.com/gyoz-ai/omp-bash-guard) plugin. Install both together if you want the full governance surface.

## How it works

The plugin hooks four lifecycle events:

- **`before_agent_start`** — injects `<top_priority_rules>` (the 8 absolute rules: no commits, no unapproved comments, no weakened tests, no lazy/skip-marker tests, no low-utility abstractions, no inline fully-qualified paths, ask before mutating commands, search memory first), `<adhd_output_style>` (10 rules for ADHD-friendly output, adapted from [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd): lead with the next action, number steps, end with one next action, suppress tangents, restate state, give concrete time estimates, surface wins, matter-of-fact errors, cap lists at 5, no preamble/recap/closers), and `<technical_writing_style>` (12 rules for written documentation/prose, following ASD-STE100 Simplified Technical English Issue 9 Jan 2025: one word per meaning, one verb per action, active voice, imperative instructions, present tense, short sentences, one instruction per sentence, no subordinate-clause padding or decorative language, keep articles, no ambiguous pronouns) into every agent's system prompt. The chief additionally gets `<chief_delegation>` (dispatch-only framing); subagents get `<executor_checklist>` (format/test/fix-before-yield framing).
- **`tool_call`** — four checks, each returning `{ block: true, reason }` to deny the call:
  - **Chief dispatch-only gating**: when `ctx.hasUI` is true (the chief), only `task`, `todo`, `ask`, `irc`, `job`, `resolve`, `memorysearch`, `search_tool_bm25` are allowed. Every other tool is blocked at the tool layer, forcing the chief to delegate.
  - **Memory-search-first**: the chief's first `task` dispatch each session is blocked unless `memorysearch` has already been called.
  - **Comment ban**: `write`/`edit` calls that add new comment lines (`//`, `/* */`, `///`, `#`, `--`) to a code file (`.rs`, `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`) are blocked.
  - **Test-marker ban**: `write`/`edit` calls touching a test file (`tests/`, `__tests__/`, `*.test.*`, `*.spec.*`) that introduce `TODO`, `FIXME`, `for now`, `will do later`, `skip`, or `tbd` are blocked.
  - **Cargo.lock guard**: any `write`/`edit` targeting a path ending in `Cargo.lock` is blocked; callers are told to use `cargo update`/`cargo add`/`cargo check` instead.
- **`tool_result`** — after every `task` tool result, appends a `MANDATORY SUBAGENT VERIFICATION` checklist (8 items: was format/test actually run, were skip-markers added, were tests weakened, was a commit made, is the diff minimal, did it delegate further, low-utility abstractions, inline fully-qualified paths) so the chief audits subagent output before trusting it.

All state (whether `memorysearch` has been called, the outstanding `task` call stack) is reset on `session_start`.

## Install

```sh
omp plugin install github:gyoz-ai/omp-governance
```

This runs `bun install` against `~/.omp/plugins`, symlinks the package into `node_modules`, and validates that `index.ts` resolves and exports a plugin factory before enabling it.

### Local development (symlink)

Symlink the repo directory itself into the extensions folder — the loader treats any top-level subdirectory of `~/.omp/agent/extensions/` containing an `index.ts` as one plugin:

```sh
ln -s "$(pwd)" ~/.omp/agent/extensions/governance
```

Or for a project-local install:

```sh
ln -s "$(pwd)" <project>/.omp/extensions/governance
```

The extension loads at startup and live-reloads on file changes — no restart needed after pulling updates.

## Files

- `index.ts` — plugin entry point, registers the lifecycle hooks.
- `rules.ts` — the prompt text blocks (`COMMON_RULES`, `ADHD_OUTPUT_STYLE`, `STE_TECHNICAL_ENGLISH`, `CHIEF_DELEGATION`, `EXECUTOR_CHECKLIST`, `VERIFICATION_CHECKLIST`).
- `tool-guards.ts` — pure helpers for the `tool_call` checks (allowed-tool set, comment/marker detection, edit-input parsing).
- `lib/code-files.ts` — vendored copy of the shared `isCodeFile`/`isRustFile`/`isTsLikeFile` helpers.
