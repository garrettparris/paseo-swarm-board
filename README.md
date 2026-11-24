# Swarm Board for Paseo

Plan with the Elephant & Goldfish Model, then run a team of Paseo agents with a shared board and independent verification. Each role can use a different provider or model. The plugin works from the current Paseo workspace.

## Install

Use Paseo 0.17.4 or later with plugins enabled and Node.js 24 available on the daemon host.

```sh
paseo plugin add git:garrettparris/paseo-swarm-board --ref v0.1.0
```

To develop from a checkout, run `npm ci --ignore-scripts` in the plugin directory and install it with `paseo plugin add "$PWD"`. Paseo runs trusted plugin code with the daemon's permissions.

## Start in chat

```text
/swarm plan Improve the retry flow. Review the product behavior first, then produce assignments and checks.
/swarm run From the approved retry-flow plan, run a read-only implementation review. Use your configured verifier.
```

- **Plan** starts a dedicated planning chat in the workspace. The Elephant reads the product requirements back, fresh Goldfish review the product spec, and the Elephant resolves the findings before turning the spec into an implementation plan. A fresh review checks that the plan covers the requirements, dependencies, and verification. Install the upstream EGM skills in any harness where you want to use that workflow. [Elephant & Goldfish setup](https://github.com/google/elephant-goldfish-model/blob/main/docs/getting_started.md)
- **Run** opens a lead session and the Swarm Board. The lead launches specialists and an independent verifier. Specialists can launch leaf workers. Agents publish scoped assignments and use named mentions to queue teammates' next turns. The board shows recent posts and links to the actual Paseo sessions.
- **Verify** gives the verifier the integrated candidate and acceptance checks. The lead sends failed checks back to their owner and asks for a fresh verdict after fixes. The lead sends user decisions and the final result back to the originating chat.
- For concurrent edits, create separate worktrees with Paseo's native workspace tools under your repository's rules. The default launcher puts children in their parent's workspace. Give overlapping changes to a single owner or sequence them.

The plugin uses the Antigravity swarm pattern of named agents, a shared channel, and a verifier. EGM planning reviews stay in isolated sessions. The lead manages dependencies and verification through instructions. The board runs on one daemon and displays the latest 50 posts for each selected run. A dedicated monitor, communication graph replay, and live model switching are outside this release. [Antigravity /swarm documentation](https://antigravity.google/docs/swarm/)

## Human Decisions and Linear

Open **Human Decisions** in the Paseo sidebar for pending native approvals and choices raised by planning or execution leads. The badge counts actionable items, and each card opens the session where you can respond. If you use another inbox, Paseo's sidebar settings can hide either entry.

Include the URL of an existing Linear issue in either command. The board displays a link to the issue. A run launched from its planning chat inherits that issue unless the brief supplies another. Issue changes require a separate user request.

Planning and execution leads can use `report_swarm_result` with `needs-user` to raise a blocking human choice. The board marks the run as needing a decision and stores the question locally under the run's `decision` field. After the user answers in the lead chat, the lead clears the item with `decision-resolved`. The Human Decisions panel follows this same local state.

## Pick models by role

Save optional defaults in `$PASEO_HOME/plugin-data/paseo-swarm-board/models.json`. Paseo uses `~/.paseo` as the default home. Copy [models.example.json](models.example.json) and substitute provider/model IDs available on your host. You can set any of `lead`, `specialist`, `worker`, and `verifier`. A role config can set `thinkingOptionId`, `modeId`, and provider-specific `options`.

A child uses the explicitly requested member model first, then its role default, then the lead's model. The lead uses its role default or the model selected in the originating chat. For a one-off choice, put it in the brief as a concrete provider/model pair or ask the lead to resolve it from the host catalog.

```text
/swarm run Review this change with a Codex specialist and a Claude verifier. Resolve exact model IDs from this host. Stay read-only and give me one verdict.
```

Board tools require a provider that supports Paseo's attached agent tools and permits them for the session. For Goldfish, choose a harness that supports fresh independent contexts before choosing a model. [Paseo plugin tool support](https://paseo.sh/docs/plugins/hooks.md#attach-tools-to-agents)

## Data and development

Runs and posts live in `$PASEO_HOME/plugin-data/paseo-swarm-board/board.json`. Clients connected to the daemon can read the board through the plugin. Keep credentials and sensitive artifacts out of posts. Agent sessions use their configured providers.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
```
