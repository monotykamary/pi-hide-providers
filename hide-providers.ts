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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * pi-hide-providers — hide providers and models from pi's model selector.
 *
 * Strategy:
 *   - Reads a blocklist from ~/.pi/agent/hide-providers.json (or .pi/hide-providers.json)
 *   - On session_start, reads enabledModels from settings.json, computes the complement
 *     of hidden models, and writes back the allowlist to enabledModels
 *   - Provides /hide command for interactive management (add, remove, list, apply, reset)
 *   - model_select event blocks selection of hidden providers/models
 *
 * The extension uses the enabledModels setting as the mechanism to filter the /model
 * selector and Ctrl+P cycling. This is the same approach used by pi-model-router's
 * scope-shim, but as a dedicated, minimal extension.
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

// Read settings.json
interface Settings {
  enabledModels?: string[];
  [key: string]: unknown;
}

function readSettings(settingsPath: string): Settings {
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8")) as Settings;
  } catch {
    return {};
  }
}

function writeSettings(settingsPath: string, settings: Settings): void {
  const dir = settingsPath.replace(/\/[^/]+$/, "");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

// Build enabledModels allowlist from the full model list minus hidden rules
function buildAllowlist(
  allModels: ReadonlyArray<{ provider: string; id: string; name?: string }>,
  rules: ReadonlyArray<HideRule>,
): string[] {
  const allowlist: string[] = [];

  for (const model of allModels) {
    if (!isHidden(rules, model.provider, model.id)) {
      allowlist.push(`${model.provider}/${model.id}`);
    }
  }

  return allowlist;
}

// Apply hide rules to settings.json by computing and setting enabledModels
function applyToSettings(
  cwd: string,
  models: ReadonlyArray<{ provider: string; id: string; name?: string }>,
  rules: ReadonlyArray<HideRule>,
  settingsPath: string,
): { allowlist: string[]; hidden: number } {
  const allowlist = buildAllowlist(models, rules);
  const hidden = models.length - allowlist.length;

  const settings = readSettings(settingsPath);
  settings.enabledModels = allowlist;
  writeSettings(settingsPath, settings);

  return { allowlist, hidden };
}

// Clear enabledModels from settings.json (restores "show all" behavior)
function resetSettings(settingsPath: string): void {
  const settings = readSettings(settingsPath);
  delete settings.enabledModels;
  writeSettings(settingsPath, settings);
}

export default function (pi: ExtensionAPI) {
  let currentRules: HideRule[] = [];
  let configPath: string = globalConfigPath;

  // On session start, load config and auto-apply if rules exist
  pi.on("session_start", async (_event, ctx) => {
    const config = readConfig(ctx.cwd);
    currentRules = config.hide;
    configPath = existsSync(getProjectConfigPath(ctx.cwd))
      ? getProjectConfigPath(ctx.cwd)
      : globalConfigPath;

    if (currentRules.length > 0) {
      const available = ctx.modelRegistry.getAvailable();
      const settingsPath = join(globalConfigDir, "settings.json");
      const { hidden } = applyToSettings(ctx.cwd, available, currentRules, settingsPath);

      if (hidden > 0 && ctx.hasUI) {
        ctx.ui.notify(
          `pi-hide-providers: ${hidden} model(s) hidden (${currentRules.length} rule(s))`,
          "info",
        );
      }
    }
  });

  // Block selection of hidden providers/models
  pi.on("model_select", async (event, ctx) => {
    if (isHidden(currentRules, event.model.provider, event.model.id)) {
      ctx.ui.notify(
        `Blocked: ${event.model.provider}/${event.model.id} is hidden by pi-hide-providers`,
        "warning",
      );
      // Return previous model selection unchanged by not taking further action.
      // The model_select event is notification-only for extensions.
    }
  });

  // /hide command — interactive management
  pi.registerCommand("hide", {
    description: HIDE_COMMAND_DESCRIPTION,
    getArgumentCompletions(prefix: string) {
      const subcommands = ["add", "remove", "list", "apply", "reset"];
      const matches = subcommands.filter((s) => s.startsWith(prefix));
      return matches.length > 0 ? matches.map((s) => ({ value: s, label: s })) : null;
    },
    handler: async (args, ctx) => {
      await handleHideCommand(pi, ctx, args.trim(), currentRules, (rules) => {
        currentRules = rules;
      });
    },
  });
}

async function handleHideCommand(
  _pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  args: string,
  currentRules: HideRule[],
  setRules: (rules: HideRule[]) => void,
): Promise<void> {
  const parts = args.split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? "";
  const rest = parts.slice(1).join(" ");

  // /hide — show current status
  if (!subcommand) {
    showStatus(ctx, currentRules);
    return;
  }

  // /hide list — show rules
  if (subcommand === "list") {
    showStatus(ctx, currentRules);
    return;
  }

  // /hide add <rule> — add a hide rule
  if (subcommand === "add") {
    if (!rest) {
      ctx.ui.notify("Usage: /hide add <provider> | <provider/model-id> | <provider/*>", "warning");
      return;
    }

    const rule = parseRule(rest);
    if (!rule) {
      ctx.ui.notify(`Invalid rule: "${rest}". Use "provider" or "provider/model-id".`, "error");
      return;
    }

    const updated = deduplicateRules([...currentRules, rule]);
    const configPath = writeConfig(ctx.cwd, { hide: updated });
    setRules(updated);
    ctx.ui.notify(`Added: ${formatRule(rule)} (config: ${configPath})`, "info");
    return;
  }

  // /hide remove <rule> — remove a hide rule
  if (subcommand === "remove") {
    if (!rest) {
      ctx.ui.notify("Usage: /hide remove <provider> | <provider/model-id> | <provider/*>", "warning");
      return;
    }

    const rule = parseRule(rest);
    if (!rule) {
      ctx.ui.notify(`Invalid rule: "${rest}". Use "provider" or "provider/model-id".`, "error");
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
    ctx.ui.notify(`Removed: ${key}`, "info");
    return;
  }

  // /hide apply — recompute enabledModels from current rules + available models
  if (subcommand === "apply") {
    const available = ctx.modelRegistry.getAvailable();
    const settingsPath = join(globalConfigDir, "settings.json");
    const { allowlist, hidden } = applyToSettings(ctx.cwd, available, currentRules, settingsPath);

    if (currentRules.length === 0) {
      ctx.ui.notify("No hide rules configured. Use /hide add to create rules.", "warning");
      return;
    }

    ctx.ui.notify(
      `Applied: ${allowlist.length} models visible, ${hidden} hidden (${currentRules.length} rule(s))`,
      "info",
    );
    return;
  }

  // /hide reset — clear enabledModels to restore "show all" behavior
  if (subcommand === "reset") {
    const settingsPath = join(globalConfigDir, "settings.json");
    resetSettings(settingsPath);
    ctx.ui.notify("Reset: all models now visible (enabledModels cleared)", "info");
    return;
  }

  // /hide help
  if (subcommand === "help") {
    ctx.ui.notify(
      [
        "pi-hide-providers commands:",
        "  /hide              Show current rules and status",
        "  /hide list         Same as /hide",
        "  /hide add <rule>   Add a hide rule (e.g. ollama, openrouter/cheap-model)",
        "  /hide remove <rule> Remove a hide rule",
        "  /hide apply        Recompute enabledModels from current rules",
        "  /hide reset        Clear enabledModels — show all models",
        "  /hide help         This message",
        "",
        "Rule formats:",
        '  "provider"           Hide entire provider',
        '  "provider/*"         Hide entire provider (explicit)',
        '  "provider/model-id"  Hide specific model',
      ].join("\n"),
      "info",
    );
    return;
  }

  ctx.ui.notify(`Unknown subcommand: "${subcommand}". Use /hide help for usage.`, "warning");
}

function showStatus(ctx: ExtensionCommandContext, rules: ReadonlyArray<HideRule>): void {
  if (rules.length === 0) {
    ctx.ui.notify("No hide rules configured. Use /hide add to create rules.", "info");
    return;
  }

  const lines = [
    `Hide rules (${rules.length}):`,
    ...rules.map((r, i) => `  ${i + 1}. ${formatRule(r)}`),
  ];

  const available = ctx.modelRegistry.getAvailable();
  const hidden = available.filter((m) => isHidden(rules, m.provider, m.id));

  if (hidden.length > 0) {
    lines.push("");
    lines.push(`Hidden models (${hidden.length}):`);
    const preview = hidden.slice(0, 10);
    for (const m of preview) {
      lines.push(`  ${m.provider}/${m.id}`);
    }
    if (hidden.length > 10) {
      lines.push(`  ... and ${hidden.length - 10} more`);
    }
  }

  ctx.ui.notify(lines.join("\n"), "info");
}
