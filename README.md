# claude-mods

Claude Code mods by Yasir, published as the `yasir-mods` marketplace.

| Mod | What it does |
| --- | --- |
| [token-weather](plugins/token-weather) | Band above the prompt: weather word (Clear → Compact soon), % used, tokens / window, 12-turn chart. |
| [context-bar](plugins/context-bar) | Bar above the prompt showing context use by category, with the auto-compact point. `/context-bar` toggles. |
| [agents-panel](plugins/agents-panel) | Pane listing `.claude/agents` with a ▶ run button each. `/agents-panel` toggles. |
| [blast-radius](plugins/blast-radius) | Holds `rm -r`, `git reset --hard`, `git clean`, `git push --force`; a pane lists the files or commits affected, with Cancel (default) and Proceed. |
| [next-steps](plugins/next-steps) | After each answer of 80+ characters, up to three suggested next prompts (your skills and slash commands included) as buttons above the prompt. A click, or 1/2/3 in an empty prompt box, drafts it; never sends. |
| [hover-reveal](plugins/hover-reveal) | Desktop app only: API keys, tokens and passwords in replies and tool rows show as `••••••••`; hover the `🔒 n hidden values` line under the row to see them. Display only: Claude still reads the real values. |
| [model-router](plugins/model-router) | Before each turn, Haiku classifies the prompt as mechanical, ordinary or hard; requests get effort low/medium/high and subagents the cheap or strong model. Moves up on weak evidence, down only when confident; logs each decision; sends requests unchanged on any failure. Main-model switching is off by default (it resets the prompt cache); turn it on in `/config`. |
| [plugin-confetti](plugins/plugin-confetti) | When an MCP tool call finishes, the plugin's real logo (Simple Icons, 43 brands) with a short confetti burst above the prompt: an animated SVG card in the Desktop app, block-pixel logo and falling confetti in the terminal. Unknown plugins get a neutral plug. `/confetti <name>` previews any logo. |
| [decision-picker](plugins/decision-picker) | When a reply lists decisions D1, D2, … and asks for approval, toggles above the prompt (all on). Approve drafts `approved, implement D1, D3 and D4; skip D2` in the prompt box; never sends. |
| [local-sync](plugins/local-sync) | After Claude edits a file under a source folder (or a shell command changes some), copies each one to the same path under a target folder, one file at a time (50+ at once: none). Status line: copied, and whether a browser has looked since. Set the folders with `/plugin configure local-sync@yasir-mods`; `/local-sync [on|off]`. |
| [fuel](plugins/fuel) | Shows only when you are near a limit (context ≥ 70% or any plan limit ≥ 80%, both set in `/config`). One band above the prompt: context window % with tokens, each plan limit with a reset countdown, and cache age against a warm window (an estimate; set the window in `/config`), as smooth clay → amber → red gauges (true-colour cells in the terminal, an SVG card in the Desktop app). Gauges without a number are left out. A Compact button runs only when pressed; `/fuel` prints one line. |
| [recorder](plugins/recorder) | Records each tool call of a turn (name, short target, duration, error) and `/recorder` opens a timeline pane: coloured dot by category, target shortened in the middle, duration bar scaled to the slowest call, Prev/Next over the last 10 turns, Copy path drafts into the prompt box. One-line toast when a turn ends. Observe only; never keeps file contents or output. |
| [pulse](plugins/pulse) | A slim glowing bar above the prompt with what Claude is doing in plain words (`Reading src/app.ts`, `Calling Zapier`): soft breathing idle, gentle wave thinking, flowing gradient in the tool's colour, one green sweep when done, one red pulse on an error. Stops after a minute idle. `/pulse`, `/pulse off`. Observe only. |

## Install on a machine (all sessions, user scope)

```bash
claude plugin marketplace add yasirshabbirservices/claude-mods
claude plugin install token-weather@yasir-mods --scope user
claude plugin install context-bar@yasir-mods --scope user
claude plugin install agents-panel@yasir-mods --scope user
claude plugin install blast-radius@yasir-mods --scope user
claude plugin install next-steps@yasir-mods --scope user
claude plugin install hover-reveal@yasir-mods --scope user
claude plugin install model-router@yasir-mods --scope user
claude plugin install plugin-confetti@yasir-mods --scope user
claude plugin install decision-picker@yasir-mods --scope user
claude plugin install local-sync@yasir-mods --scope user
claude plugin install fuel@yasir-mods --scope user
claude plugin install recorder@yasir-mods --scope user
claude plugin install pulse@yasir-mods --scope user
```

## Cloud sessions (claude.ai/code)

Cloud sessions read the project's `.claude/settings.json`. Copy [`.claude/settings.json`](.claude/settings.json) from this repo into the repo you open in the cloud and commit it; the mods load when the session starts.

## Layout

```
.claude-plugin/marketplace.json   lists every mod
plugins/<mod>/                    one plugin each: .claude-plugin/plugin.json, hooks/, types/, tests/
```

Check a mod: `claude plugin validate plugins/<mod>` and `claude plugin test plugins/<mod>`.
