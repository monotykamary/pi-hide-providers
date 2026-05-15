import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  HIDE_COMMAND_DESCRIPTION,
  CONFIG_FILENAME,
  type HideRule,
  type HideProvidersConfig,
  isHidden,
  parseRule,
  formatRule,
  deduplicateRules,
} from "./src/index.js";
import { HideProviderSelectorComponent, type HideProviderSelectorResult } from "./src/provider-selector.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * pi-hide-providers — hide providers and models from pi's model selector.
 *
 * Strategy: monkey-patches modelRegistry accessor methods (getAvailable, getAll, find)
 * to filter out models matched by hide rules.
 *
 * This is the only mechanism that completely removes models from ALL lists:
 * the /model selector, Ctrl+P cycling, --list-models CLI, and session restoration.
 * It survives modelRegistry.refresh() because our patches wrap the originals.
 * No settings.json is touched — no 250+ entry explosion, no allowlist semantics.
 */

// Config paths
const globalConfigDir = join(homedir(), ".pi", "agent");
const globalConfigPath = join(globalConfigDir, CONFIG_FILENAME);

function getProjectConfigPath(cwd: string): string {
  return join(cwd, ".pi", CONFIG_FILENAME);
}

// Read config from disk (project overrides global)
function readConfig(cwd: string): HideProvidersConfig {
  const projectPath = getProjectConfigPath(cwd);
  const path = existsSync(projectPath) ? projectPath : globalConfigPath;

  if (!existsSync(path)) {
    return { hide: [] };
  }

  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as HideProvidersConfig;
    if (!Array.isArray(parsed.hide)) {
      return { hide: [] };
    }
    return { hide: deduplicateRules(parsed.hide) };
  } catch {
    return { hide: [] };
  }
}

// Write config to disk
function writeConfig(cwd: string, config: HideProvidersConfig): string {
  const projectPath = getProjectConfigPath(cwd);
  const path = existsSync(getProjectConfigPath(cwd)) ? projectPath : globalConfigPath;
  const dir = path === projectPath ? join(cwd, ".pi") : globalConfigDir;

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
  return path;
}

// Monkey-patching helpers

const PATCH_KEY = "__hide_providers_patched";

interface PatchedRegistry {
  [PATCH_KEY]: boolean;
  getAvailable(): unknown[];
  getAll(): unknown[];
  find(provider: string, modelId: string): unknown | undefined;
  __hide_providers_get_rules: () => HideRule[];
  __hide_providers_orig_getAvailable: () => unknown[];
  __hide_providers_orig_getAll: () => unknown[];
  __hide_providers_orig_find: (provider: string, modelId: string) => unknown | undefined;
}

// Patch a model registry to filter out hidden models.
// If already patched (e.g. after reload), just updates the rules source.
function patchRegistry(
  registry: PatchedRegistry,
  getRules: () => HideRule[],
): void {
  if (registry[PATCH_KEY]) {
    registry.__hide_providers_get_rules = getRules;
    return;
  }

  registry[PATCH_KEY] = true;
  registry.__hide_providers_get_rules = getRules;

  // Save originals
  registry.__hide_providers_orig_getAvailable = registry.getAvailable.bind(registry);
  registry.__hide_providers_orig_getAll = registry.getAll.bind(registry);
  registry.__hide_providers_orig_find = registry.find.bind(registry);

  // Patch getAvailable — used by model selector, Ctrl+P cycle, resolveModelScope
  registry.getAvailable = function (this: PatchedRegistry) {
    const rules = this.__hide_providers_get_rules();
    const all = this.__hide_providers_orig_getAvailable();
    return all.filter(
      (m: any) => !isHidden(rules, m.provider, m.id),
    );
  };

  // Patch getAll — used by --list-models and CLI model resolution
  registry.getAll = function (this: PatchedRegistry) {
    const rules = this.__hide_providers_get_rules();
    const all = this.__hide_providers_orig_getAll();
    return all.filter(
      (m: any) => !isHidden(rules, m.provider, m.id),
    );
  };

  // Patch find — used by session restoration. Hides hidden models from being restored.
  registry.find = function (
    this: PatchedRegistry,
    provider: string,
    modelId: string,
  ) {
    const rules = this.__hide_providers_get_rules();
    if (isHidden(rules, provider, modelId)) return undefined;
    return this.__hide_providers_orig_find(provider, modelId);
  };
}

// Restore original methods on a patched registry.
function unpatchRegistry(registry: PatchedRegistry): void {
  if (!registry[PATCH_KEY]) return;

  registry.getAvailable = registry.__hide_providers_orig_getAvailable;
  registry.getAll = registry.__hide_providers_orig_getAll;
  registry.find = registry.__hide_providers_orig_find;

  delete (registry as any)[PATCH_KEY];
  delete (registry as any).__hide_providers_get_rules;
  delete (registry as any).__hide_providers_orig_getAvailable;
  delete (registry as any).__hide_providers_orig_getAll;
  delete (registry as any).__hide_providers_orig_find;
}

// Extension

export default function (pi: ExtensionAPI) {
  let currentRules: HideRule[] = [];

  pi.on("session_start", async (_event, ctx) => {
    const config = readConfig(ctx.cwd);
    currentRules = config.hide;

    if (currentRules.length > 0) {
      patchRegistry(ctx.modelRegistry as unknown as PatchedRegistry, () => currentRules);

      if (ctx.hasUI) {
        ctx.ui.notify(
          `pi-hide-providers: ${currentRules.length} rule(s) active — getAvailable/getAll/find patched to filter hidden models`,
          "info",
        );
      }
    }
  });

  // Safety net: block selection of hidden models if they somehow show up
  pi.on("model_select", async (event, ctx) => {
    if (isHidden(currentRules, event.model.provider, event.model.id)) {
      ctx.ui.notify(
        `Blocked: ${event.model.provider}/${event.model.id} is hidden by pi-hide-providers`,
        "warning",
      );
    }
  });

  // /hide-models command — interactive management
  pi.registerCommand("hide-models", {
    description: HIDE_COMMAND_DESCRIPTION,
    getArgumentCompletions(prefix: string) {
      const subcommands = ["add", "remove", "status", "list", "apply", "reset"];
      const matches = subcommands.filter((s) => s.startsWith(prefix));
      return matches.length > 0 ? matches.map((s) => ({ value: s, label: s })) : null;
    },
    handler: async (args, ctx) => {
      await handleHideCommand(ctx, args.trim(), currentRules, (rules) => {
        currentRules = rules;
      });
    },
  });
}

async function handleHideCommand(
  ctx: ExtensionCommandContext,
  args: string,
  currentRules: HideRule[],
  setRules: (rules: HideRule[]) => void,
): Promise<void> {
  const parts = args.split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? "";
  const rest = parts.slice(1).join(" ");

  // /hide-models — open interactive TUI selector (default action)
  if (!subcommand) {
    await showHideSelector(ctx, currentRules, setRules);
    return;
  }

  // /hide-models list — show rules
  if (subcommand === "list") {
    showStatus(ctx, currentRules);
    return;
  }

  // /hide-models add <rule> — add a hide rule
  if (subcommand === "add") {
    if (!rest) {
      ctx.ui.notify(
        "Usage: /hide-models add <provider> | <provider/model-id> | <provider/*>",
        "warning",
      );
      return;
    }

    const rule = parseRule(rest);
    if (!rule) {
      ctx.ui.notify(
        `Invalid rule: "${rest}". Use "provider" or "provider/model-id".`,
        "error",
      );
      return;
    }

    const updated = deduplicateRules([...currentRules, rule]);
    const configPath = writeConfig(ctx.cwd, { hide: updated });
    setRules(updated);
    ctx.ui.notify(
      `Added: ${formatRule(rule)} (config: ${configPath}). Changes take effect immediately.`,
      "info",
    );
    return;
  }

  // /hide-models remove <rule> — remove a hide rule
  if (subcommand === "remove") {
    if (!rest) {
      ctx.ui.notify(
        "Usage: /hide-models remove <provider> | <provider/model-id> | <provider/*>",
        "warning",
      );
      return;
    }

    const rule = parseRule(rest);
    if (!rule) {
      ctx.ui.notify(
        `Invalid rule: "${rest}". Use "provider" or "provider/model-id".`,
        "error",
      );
      return;
    }

    const key = formatRule(rule);
    const before = currentRules.length;
    const updated = currentRules.filter((r) => formatRule(r) !== key);

    if (updated.length === before) {
      ctx.ui.notify(`Rule not found: ${key}`, "warning");
      return;
    }

    writeConfig(ctx.cwd, { hide: updated });
    setRules(updated);
    ctx.ui.notify(
      `Removed: ${key}. Changes take effect immediately.`,
      "info",
    );
    return;
  }

  // /hide-models status — show current status
  if (subcommand === "status") {
    showStatus(ctx, currentRules);
    return;
  }

  // /hide-models apply — notification (changes already active via patched methods)
  if (subcommand === "apply") {
    if (currentRules.length === 0) {
      ctx.ui.notify("No hide rules configured. Use /hide-models add to create rules.", "warning");
      return;
    }

    const total = countTotalFromUnpatched(ctx);
    const hidden = hiddenFromUnpatched(ctx, currentRules);

    ctx.ui.notify(
      `Applied: ${currentRules.length} rule(s) active — ${total - hidden} visible, ${hidden} hidden (registry methods are patched)`,
      "info",
    );
    return;
  }

  // /hide-models reset — unpatch registry (takes effect immediately)
  if (subcommand === "reset") {
    const registry = ctx.modelRegistry as unknown as PatchedRegistry;
    if (!registry[PATCH_KEY]) {
      ctx.ui.notify("Registry is not patched. Nothing to reset.", "info");
      return;
    }

    unpatchRegistry(registry);
    ctx.ui.notify(
      "Reset: registry unpatched — all models restored immediately.",
      "info",
    );
    return;
  }

  // /hide-models help
  if (subcommand === "help") {
    ctx.ui.notify(
      [
        "pi-hide-providers commands:",
        "  /hide-models              Open interactive TUI to select providers/models to hide",
        "  /hide-models status      Show current rules and status",
        "  /hide-models list         Same as /hide-models status",
        "  /hide-models add <rule>   Add a hide rule (e.g. ollama, openrouter/cheap-model)",
        "  /hide-models remove <rule> Remove a hide rule",
        "  /hide-models apply        Show current hide state",
        "  /hide-models reset        Unpatch registry — restore all models",
        "  /hide-models help         This message",
        "",
        "Rule formats:",
        '  "provider"           Hide entire provider',
        '  "provider/*"         Hide entire provider (explicit)',
        '  "provider/model-id"  Hide specific model',
        "",
        "Mechanism: monkey-patches modelRegistry.getAvailable(),",
        "  getAll(), and find() to filter out hidden models.",
        "  Takes effect immediately. No settings.json modifications.",
        "  Survives refresh().",
      ].join("\n"),
      "info",
    );
    return;
  }

  ctx.ui.notify(
    `Unknown subcommand: "${subcommand}". Use /hide-models help for usage.`,
    "warning",
  );
}

// Open the interactive TUI selector for hiding providers/models.
async function showHideSelector(
  ctx: ExtensionCommandContext,
  currentRules: HideRule[],
  setRules: (rules: HideRule[]) => void,
): Promise<void> {
  // Get all models from the unpatched registry (so we see everything)
  const registry = ctx.modelRegistry as unknown as PatchedRegistry;
  const allModels = registry.__hide_providers_orig_getAll?.() ?? ctx.modelRegistry.getAll();

  const models = (allModels as any[]).map((m: any) => ({
    provider: m.provider as string,
    id: m.id as string,
    name: (m.name ?? m.id) as string,
  }));

  const result = await ctx.ui.custom<HideProviderSelectorResult>(
    (tui, theme, _kb, done) => {
      const selector = new HideProviderSelectorComponent(
        theme,
        models,
        currentRules,
        (result) => done(result),
      );

      return {
        render(width: number) {
          return selector.render(width);
        },
        invalidate() {
          selector.invalidate();
        },
        handleInput(data: string) {
          selector.handleInput(data);
          tui.requestRender();
        },
      };
    },
  );

  if (!result || result.cancelled) {
    ctx.ui.notify("Hide selector cancelled.", "info");
    return;
  }

  // Apply the new rules
  const newRules = result.rules;
  const configPath = writeConfig(ctx.cwd, { hide: newRules });
  setRules(newRules);

  if (newRules.length === 0) {
    // No rules left — unpatch the registry
    unpatchRegistry(registry);
    ctx.ui.notify("All models visible. Registry unpatched.", "info");
  } else {
    // Ensure the registry is patched
    patchRegistry(registry, () => newRules);
    ctx.ui.notify(
      `Hide rules updated: ${newRules.length} rule(s) active (config: ${configPath})`,
      "info",
    );
  }
}

// Count total models using the original (unpatched) getAll.
function countTotalFromUnpatched(ctx: ExtensionCommandContext): number {
  const registry = ctx.modelRegistry as unknown as PatchedRegistry;
  const all = registry.__hide_providers_orig_getAll?.();
  if (all) return all.length;
  try {
    return (ctx.modelRegistry.getAll() as any[]).length;
  } catch {
    return 0;
  }
}

// Count hidden models using the original (unpatched) getAll.
function hiddenFromUnpatched(
  ctx: ExtensionCommandContext,
  rules: ReadonlyArray<HideRule>,
): number {
  const registry = ctx.modelRegistry as unknown as PatchedRegistry;
  const all = registry.__hide_providers_orig_getAll?.();
  if (all) {
    return (all as any[]).filter((m: any) => isHidden(rules, m.provider, m.id)).length;
  }
  try {
    return (ctx.modelRegistry.getAll() as any[]).filter(
      (m: any) => isHidden(rules, m.provider, m.id),
    ).length;
  } catch {
    return 0;
  }
}

function showStatus(
  ctx: ExtensionCommandContext,
  rules: ReadonlyArray<HideRule>,
): void {
  const lines: string[] = [];

  if (rules.length === 0) {
    lines.push("No hide rules configured. Use /hide-models add to create rules.");
  } else {
    lines.push(`Hide rules (${rules.length}):`);
    for (let i = 0; i < rules.length; i++) {
      lines.push(`  ${i + 1}. ${formatRule(rules[i])}`);
    }
  }

  const registry = ctx.modelRegistry as unknown as PatchedRegistry;
  if (registry[PATCH_KEY]) {
    lines.push("");
    lines.push("Status: PATCHED — getAvailable/getAll/find filter hidden models");
  }

  try {
    const all = registry.__hide_providers_orig_getAll?.() ?? [];
    if (all.length > 0) {
      const hidden = (all as any[]).filter((m: any) => isHidden(rules, m.provider, m.id));
      lines.push("");
      lines.push(`Models: ${all.length - hidden.length} visible, ${hidden.length} hidden`);
      if (hidden.length > 0) {
        const preview = hidden.slice(0, 10);
        for (const m of preview) {
          lines.push(`  ${m.provider}/${m.id}`);
        }
        if (hidden.length > 10) {
          lines.push(`  ... and ${hidden.length - 10} more`);
        }
      }
    }
  } catch {
    // ignore
  }

  ctx.ui.notify(lines.join("\n"), "info");
}
