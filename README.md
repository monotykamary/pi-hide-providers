# pi-hide-providers

Hide providers and models from [pi](https://github.com/badlogic/pi)'s model selector — filter the `/model` list and `Ctrl+P` cycling via a configurable blocklist.

## The problem

Pi's model selector shows **every** available model from every configured provider. If you have Ollama running with 20 local models, or an OpenRouter account with hundreds of options, the model list becomes noisy and slow to navigate. There's no built-in way to say "I never want to see these providers/models in the selector."

The `enabledModels` setting works as an allowlist, but maintaining it manually is tedious — you have to list every model you *do* want, and update it when new models are added. What you really want is a **blocklist**: "hide everything from these providers, except the ones I explicitly use."

## The solution

`pi-hide-providers` gives you a blocklist approach:

- Define hide rules in a config file (`~/.pi/agent/hide-providers.json` or `.pi/hide-providers.json`)
- On session start, the extension computes the complement (all models minus hidden ones) and writes it to `enabledModels` in `settings.json`
- The `/model` selector and `Ctrl+P` cycling only show the visible models
- Interactive `/hide` command for adding, removing, and inspecting rules

## Usage

### Interactive commands

| Command | What it does |
|---------|-------------|
| `/hide` | Show current rules and how many models are hidden |
| `/hide add ollama` | Hide the entire `ollama` provider |
| `/hide add openrouter/cheap-model` | Hide a specific model from `openrouter` |
| `/hide add openrouter/*` | Hide the entire `openrouter` provider (explicit) |
| `/hide remove ollama` | Remove the hide rule for `ollama` |
| `/hide apply` | Recompute `enabledModels` from current rules + available models |
| `/hide reset` | Clear `enabledModels` — restore "show all" behavior |
| `/hide help` | Show usage reference |

### Config file

Create `~/.pi/agent/hide-providers.json` (global) or `.pi/hide-providers.json` (project-local):

```json
{
  "hide": [
    { "provider": "ollama" },
    { "provider": "openrouter", "model": "cheap-model" },
    { "provider": "github-copilot", "model": "gpt-3.5-turbo" }
  ]
}
```

Rule formats:

| Rule | Effect |
|------|--------|
| `{ "provider": "ollama" }` | Hide all models from the `ollama` provider |
| `{ "provider": "ollama", "model": "*" }` | Same — explicit wildcard |
| `{ "provider": "openrouter", "model": "cheap-model" }` | Hide only `openrouter/cheap-model` |

Project config (`.pi/hide-providers.json`) takes priority over global config (`~/.pi/agent/hide-providers.json`).

## Installation

```bash
pi install git:github.com:monotykamary/pi-hide-providers.git
```

Or in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "git:github.com:monotykamary/pi-hide-providers.git"
  ]
}
```

Then `/reload` or restart pi.

For quick one-off tests:

```bash
pi -e ./hide-providers.ts
```

## How it works

```
Session starts
  → Extension reads hide-providers.json
  → Gets all available models from modelRegistry.getAvailable()
  → Computes allowlist: all models NOT matched by any hide rule
  → Writes allowlist to settings.json as enabledModels
  → Pi's /model selector and Ctrl+P only show visible models
```

This uses the same mechanism as the `--models` CLI flag and `enabledModels` setting — the extension just computes the allowlist automatically from your blocklist.

After adding or removing rules with `/hide add` and `/hide remove`, run `/hide apply` to recompute the allowlist, or `/reload` to trigger a fresh session start.

## Comparison with alternatives

| Approach | Pros | Cons |
|----------|------|------|
| **pi-hide-providers** (this) | Blocklist — only list what you don't want; auto-computes allowlist | Writes to `settings.json` on startup; needs `/hide apply` after changes |
| `enabledModels` in settings.json | Built-in, no extension needed | Allowlist — must list every model you want; manual maintenance |
| `--models` CLI flag | Per-session scoping | Must pass every time; no persistence |
| `pi.unregisterProvider()` | Removes provider entirely | Only works for dynamically registered providers; can't remove built-in providers |
| `pi-model-router` scope shim | Dynamic scoping with routing | Heavyweight — full routing system just to filter the model list |

## Development

```bash
npm install
npm test          # Vitest unit tests
npm run typecheck # TypeScript validation
npm run lint:dead # Dead code detection (knip)
```

### Structure

```
.
├── hide-providers.ts   # Main extension
├── src/
│   └── index.ts        # Constants, types, and utilities
├── __tests__/
│   └── unit/
│       └── hide-providers.test.ts
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── knip.json
```

## License

MIT
