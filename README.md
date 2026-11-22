# dsh-plugin-cost-guard

A [DeepSeek Harness](https://github.com/deepseek-ai) plugin that shows, at a glance, whether you're burning tokens at **peak (2×)** DeepSeek pricing or off-peak, plus a heuristic for context-cache usage.

## What it adds

- **Always-visible badge** — top-right, with a configurable offset below the DSH top bar (and below the native window controls in the desktop app). Double-click collapses it to a small dot (keeping the live color) and back.
- **`Cost Guard` sidebar tab** — full details and configuration.
- **`cost_status` agent tool** — the same state, machine-readable.

| State | Color | Meaning |
|---|---|---|
| `PEAK` | 🔴 `#e5484d` | DeepSeek peak pricing (2× tokens) |
| `CACHE HIT (est.)` | 🟢 `#30a46c` | Off-peak + recent tab activity (context cache likely warm) |
| `OFF-PEAK` | 🟡 `#9acd32` | Off-peak, no cache data or cache miss |

Priority: **peak > cache hit > off-peak**.

## Peak hours

Peak is defined in Beijing time (UTC+8, no DST), Monday–Friday, in two windows:

- **09:00–12:00**
- **14:00–18:00**

Everything else is off-peak, including weekends and **Chinese national holidays** (built in for **2025–2027**, sourced from the State Council `gov.cn` notices). Make-up workdays (调休上班) that fall on weekends stay off-peak under the strict Mon–Fri rule.

For years outside 2025–2027 the tool reports `holidayData: "none"` and asks you to verify holidays manually.

## Cache estimation

DeepSeek does not publish a fixed context-cache TTL. This plugin **estimates** a cache hit from recent tab activity: if the session saw activity within the cache TTL (default **60 min**), the state is `CACHE HIT (est.)`. The label is explicit about being an estimate.

Switching the model inside a session resets the estimate: DeepSeek's context cache is per-model, so the new model starts cold. The plugin watches the active session's model selection (`uiSession` + `modelDirectories`) and clears the activity timestamp on a model switch, falling back to `unknown` (yellow-green) instead of claiming a cache hit.

## Install

From GitHub:

```
plugin_manager install_bundle github:cbittel/dsh-plugin-cost-guard
```

From npm:

```
plugin_manager install_bundle dsh-plugin-cost-guard
```

Then **restart DeepSeek Harness** so the client bundle is served (client bundles are snapshotted at app start).

## Configuration

In the **Cost Guard** sidebar tab:

- **Cache TTL (minutes)** — activity within this window counts as an estimated cache hit.
- **Badge top offset (px)** — vertical clearance below the DSH top bar; raise it if the badge still overlaps the shell controls (default `56`).
- **Extra holidays** — add `YYYY-MM-DD` Beijing dates (one per line) beyond the built-in 2025–2027 list.

### Badge behavior

- **Double-click** the badge to collapse it to a small dot (it keeps the live state color); double-click again to expand it.

## Requirements

- DeepSeek Harness `>=0.2.2-rc.1` (declared via `engines.dsh`).

## Development

```
npm test
```

Runs the pure-logic and host plugin-shape tests (Node's built-in test runner, no dependencies).

## License

[MIT](./LICENSE)
