# claude-mods

Claude Code mods by Yasir, published as the `yasir-mods` marketplace.

| Mod | What it does |
| --- | --- |
| [token-weather](plugins/token-weather) | Band above the prompt: weather word (Clear → Compact soon), % used, tokens / window, 12-turn chart. |
| [context-bar](plugins/context-bar) | Bar above the prompt showing context use by category, with the auto-compact point. `/context-bar` toggles. |
| [agents-panel](plugins/agents-panel) | Pane listing `.claude/agents` with a ▶ run button each. `/agents-panel` toggles. |
| [blast-radius](plugins/blast-radius) | Holds `rm -r`, `git reset --hard`, `git clean`, `git push --force`; a pane lists the files or commits affected, with Cancel (default) and Proceed. |
| [next-steps](plugins/next-steps) | After each answer of 80+ characters, up to three suggested next prompts (your skills and slash commands included) as buttons above the prompt. A click, or 1/2/3 in an empty prompt box, drafts it; never sends. |

## Install on a machine (all sessions, user scope)

```bash
claude plugin marketplace add yasirshabbirservices/claude-mods
claude plugin install token-weather@yasir-mods --scope user
claude plugin install context-bar@yasir-mods --scope user
claude plugin install agents-panel@yasir-mods --scope user
claude plugin install blast-radius@yasir-mods --scope user
claude plugin install next-steps@yasir-mods --scope user
```

## Cloud sessions (claude.ai/code)

Cloud sessions read the project's `.claude/settings.json`. Copy [`.claude/settings.json`](.claude/settings.json) from this repo into the repo you open in the cloud and commit it; the mods load when the session starts.

## Layout

```
.claude-plugin/marketplace.json   lists every mod
plugins/<mod>/                    one plugin each: .claude-plugin/plugin.json, hooks/, types/, tests/
```

Check a mod: `claude plugin validate plugins/<mod>` and `claude plugin test plugins/<mod>`.
