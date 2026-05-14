# pi-hide-providers

Hide providers and models from [pi](https://github.com/badlogic/pi)'s model selector — filter the `/model` list and `Ctrl+P` cycling via a configurable blocklist.

## The problem

Pi's model selector shows **every** available model from every configured provider. If you have Ollama running with 20 local models, or an OpenRouter account with hundreds of options, the model list becomes noisy and slow to navigate. There's no built-in way to say "I never want to see these providers/models in the selector."

Pi has `enabledModels` in settings.json as an allowlist, but maintaining it manually is tedious — you have to list every model you *do* want, and clobber `settings.json` with hundreds of entries. What you really want is a **blocklist**: "hide everything from these providers, except the ones I explicitly use."

## The solution

`pi-hide-providers` gives you a blocklist that **completely removes** models from all lists — not an allowlist, not a scoped subset:

- Define hide rules in a config file (`~/.pi/agent/hide-providers.json` or `.pi/hide-providers.json`)
- On session start, the extension monkey-patches `modelRegistry.getAvailable()`, `getAll()`, and `find()` to filter out hidden models
- The `/model` selector, `Ctrl+P` cycling, `--list-models`, and session restoration all see only visible models
- `/hide reset` unpatches the registry — all models return immediately
- Changes via `/hide add` and `/hide remove` take effect immediately (no reload needed)
- Interactive `/hide` command for adding, removing, and inspecting rules

No `settings.json` is modified. No 250+ entry explosion. No allowlist semantics.

## Usage

### Interactive commands

| Command | What it does |
|---------|-------------|
| `/hide` | Show current rules, patch status, and hidden model count |
| `/hide add ollama` | Hide the entire `ollama` provider |
| `/hide add openrouter/cheap-model` | Hide a specific model from `openrouter` |
| `/hide add openrouter/*` | Hide the entire `openrouter` provider (explicit) |
| `/hide remove ollama` | Remove the hide rule for `ollama` |
| `/hide apply` | Show current hide state (changes are already active) |
| `/hide reset` | Unpatch registry — all models return immediately |
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
  → Monkey-patches modelRegistry:
      getAvailable() → original result filtered by isHidden()
      getAll()       → original result filtered by isHidden()
      find(p, m)    → returns undefined if isHidden(p, m)
  → All downstream consumers see only visible models:
      /model selector, Ctrl+P, --list-models, session restoration

/hide add or /hide remove:
  → Config updated on disk
  → currentRules updated in memory
  → Patched methods read latest rules via closure
  → Changes take effect immediately (no reload)

/hide reset:
  → Unpatches registry (restores original methods)
  → All models return immediately
```

The SDK doesn't provide a mechanism to remove models from the registry — `registerProvider({ models: [] })` is treated as "no models to register" (override-only), not "remove all models." Monkey-patching the accessor methods is the only way to completely remove models from all lists without touching `settings.json`.

The patches survive `modelRegistry.refresh()` because they wrap the original methods. On reload, the extension detects the registry is already patched and just updates the rules source.

## Comparison with alternatives

| Approach | Pros | Cons |
|----------|------|------|
| **pi-hide-providers** (this) | Blocklist — completely removes models from all lists; no settings.json writes; changes take effect immediately; survives refresh() | Monkey-patches modelRegistry methods (not an official SDK mechanism) |
| `enabledModels` in settings.json (manual) | Built-in, no extension needed | Allowlist — must list every model you want individually; no blocklist support; clobbers settings with hundreds of entries |
| `--models` CLI flag | Per-session scoping | Must pass every time; no persistence |
| `pi.unregisterProvider()` | Restores built-in models after override | Only works for providers registered via `pi.registerProvider()`; can't hide entire providers (empty models array is a no-op) |
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
