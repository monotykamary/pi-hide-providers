/**
 * HideProviderSelectorComponent — an interactive TUI for selecting which
 * providers/models to hide from pi's model selector.
 *
 * Uses the same patterns as pi's built-in ScopedModelsSelectorComponent:
 * - Lists all available models grouped by provider
 * - Search/filter via Input component
 * - Enter toggles hide/show for selected item
 * - Tab toggles provider-level hide/show
 * - Ctrl+A / Ctrl+D bulk hide/show (respects search filter)
 * - Ctrl+S to save and close
 * - Changes take effect immediately through the patched registry
 * - Results are returned as HideRule[] array
 */

import {
  Container,
  type Component,
  fuzzyFilter,
  getKeybindings,
  Input,
  Key,
  matchesKey,
  Spacer,
  Text,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, keyText } from "@earendil-works/pi-coding-agent";
import {
  type HideRule,
  isHidden,
  deduplicateRules,
} from "./index.js";

// ---------------------------------------------------------------------------
// Internal state for one display row
// ---------------------------------------------------------------------------

interface DisplayItem {
  /** fullId = provider/id */
  fullId: string;
  provider: string;
  modelId: string;
  modelName: string;
  hidden: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface HideProviderSelectorResult {
  /** The final set of hide rules after the user closes the selector. */
  rules: HideRule[];
  /** If true, the user cancelled (esc) and rules should not be applied. */
  cancelled: boolean;
}

export class HideProviderSelectorComponent implements Component {
  // ---- injected dependencies ----
  private theme: Theme;
  private done: (result: HideProviderSelectorResult) => void;

  // ---- model data ----
  private allItems: DisplayItem[] = [];

  // ---- current hide rules ----
  private hiddenRules: HideRule[] = [];

  // ---- UI state ----
  private filteredItems: DisplayItem[] = [];
  private selectedIndex = 0;
  private maxVisible = 10;
  private searchInput: Input;
  private listContainer: Container;
  private footerText: Text;
  private hasChanges = false;

  // Focusable — propagate to search input for IME cursor positioning
  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  constructor(
    theme: Theme,
    allModels: Array<{ provider: string; id: string; name: string }>,
    currentRules: HideRule[],
    done: (result: HideProviderSelectorResult) => void,
  ) {
    this.theme = theme;
    this.done = done;
    this.hiddenRules = deduplicateRules(currentRules);

    // Build display items
    for (const m of allModels) {
      this.allItems.push({
        fullId: `${m.provider}/${m.id}`,
        provider: m.provider,
        modelId: m.id,
        modelName: m.name,
        hidden: isHidden(currentRules, m.provider, m.id),
      });
    }
    this.filteredItems = [...this.allItems];

    this.searchInput = new Input();
    this.listContainer = new Container();
    this.footerText = new Text(this.getFooterText(), 0, 0);

    // Wire search input enter to toggle first visible item
    this.searchInput.onSubmit = () => {
      if (this.filteredItems[this.selectedIndex]) {
        this.toggleItem(this.filteredItems[this.selectedIndex]);
      }
    };

    this.updateList();
  }

  // ---- Component interface ----

  render(width: number): string[] {
    const lines: string[] = [];

    lines.push(...new DynamicBorder((s) => this.theme.fg("accent", s)).render(width));
    lines.push("");
    lines.push(this.theme.fg("accent", this.theme.bold("Hide Provider Configuration")));
    lines.push(
      this.theme.fg(
        "muted",
        `Select providers or models to hide from the model selector.`,
      ),
    );
    lines.push("");
    lines.push(...this.searchInput.render(width));
    lines.push("");
    lines.push(...this.listContainer.render(width));
    lines.push("");
    lines.push(...this.footerText.render(width));
    lines.push(...new DynamicBorder((s) => this.theme.fg("accent", s)).render(width));

    return lines;
  }

  handleInput(data: string): void {
    const kb = getKeybindings();

    if (kb.matches(data, "tui.select.up")) {
      if (this.filteredItems.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === 0
          ? this.filteredItems.length - 1
          : this.selectedIndex - 1;
      this.updateList();
      return;
    }

    if (kb.matches(data, "tui.select.down")) {
      if (this.filteredItems.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === this.filteredItems.length - 1
          ? 0
          : this.selectedIndex + 1;
      this.updateList();
      return;
    }

    // Tab — toggle the provider of the selected item
    if (kb.matches(data, "tui.input.tab")) {
      const item = this.filteredItems[this.selectedIndex];
      if (item) {
        this.toggleProvider(item.provider);
      }
      return;
    }

    // Enter — toggle selected item
    if (kb.matches(data, "tui.select.confirm")) {
      const item = this.filteredItems[this.selectedIndex];
      if (item) {
        this.toggleItem(item);
      }
      return;
    }

    // Ctrl+A — hide all (filtered if search active)
    if (matchesKey(data, Key.ctrl("a"))) {
      const targets = this.getFilterTargets();
      this.hideModels(targets);
      this.hasChanges = true;
      this.refresh();
      return;
    }

    // Ctrl+D — show all (filtered if search active)
    if (matchesKey(data, Key.ctrl("d"))) {
      const targets = this.getFilterTargets();
      this.showModels(targets);
      this.hasChanges = true;
      this.refresh();
      return;
    }

    // Ctrl+S — save and close
    if (matchesKey(data, Key.ctrl("s"))) {
      this.finish(false);
      return;
    }

    // Escape — cancel
    if (matchesKey(data, Key.escape)) {
      this.finish(true);
      return;
    }

    // Ctrl+C — clear search or cancel if empty
    if (matchesKey(data, Key.ctrl("c"))) {
      if (this.searchInput.getValue()) {
        this.searchInput.setValue("");
        this.refresh();
      } else {
        this.finish(true);
      }
      return;
    }

    // Pass everything else to search input
    this.searchInput.handleInput(data);
    this.refresh();
  }

  invalidate(): void {
    this.searchInput.invalidate();
    this.listContainer.invalidate();
    this.footerText.invalidate();
  }

  // ---- Internal helpers ----

  private getFilterTargets(): DisplayItem[] {
    const query = this.searchInput.getValue();
    return query ? this.filteredItems : this.allItems;
  }

  private getFooterText(): string {
    const allCount = this.allItems.length;
    const hiddenCount = this.allItems.filter(
      (i) => isHidden(this.hiddenRules, i.provider, i.modelId),
    ).length;
    const visibleCount = allCount - hiddenCount;

    const parts: string[] = [
      `${keyText("tui.select.confirm")} toggle`,
      `tab provider`,
      `ctrl+a hide all`,
      `ctrl+d show all`,
      `ctrl+s done`,
      `${visibleCount} visible · ${hiddenCount} hidden`,
    ];

    const text = parts.join(" · ");
    return this.hasChanges
      ? this.theme.fg("dim", `  ${text} `) + this.theme.fg("warning", "(unsaved)")
      : this.theme.fg("dim", `  ${text}`);
  }

  private refresh(): void {
    const query = this.searchInput.getValue();
    this.filteredItems = query
      ? fuzzyFilter(
          this.allItems,
          query,
          (i) => `${i.provider} ${i.modelId} ${i.provider}/${i.modelId} ${i.modelName}`,
        )
      : [...this.allItems];

    // Update hidden status on all items (rules may have changed)
    for (const item of this.filteredItems) {
      item.hidden = isHidden(this.hiddenRules, item.provider, item.modelId);
    }

    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.filteredItems.length - 1),
    );
    this.updateList();
  }

  private updateList(): void {
    this.listContainer.clear();

    if (this.filteredItems.length === 0) {
      this.listContainer.addChild(
        new Text(this.theme.fg("muted", "  No matching models"), 0, 0),
      );
      this.footerText.setText(this.getFooterText());
      return;
    }

    const startIndex = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(this.maxVisible / 2),
        this.filteredItems.length - this.maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);

    for (let i = startIndex; i < endIndex; i++) {
      const item = this.filteredItems[i];
      if (!item) continue;

      const isSelected = i === this.selectedIndex;
      const prefix = isSelected ? this.theme.fg("accent", "→ ") : "  ";
      const modelText = isSelected
        ? this.theme.fg("accent", item.modelId)
        : item.modelId;
      const providerBadge = this.theme.fg("muted", ` [${item.provider}]`);
      const status = item.hidden
        ? this.theme.fg("warning", " ✗")
        : this.theme.fg("success", " ✓");

      this.listContainer.addChild(
        new Text(`${prefix}${modelText}${providerBadge}${status}`, 0, 0),
      );
    }

    // Scroll indicator
    if (startIndex > 0 || endIndex < this.filteredItems.length) {
      this.listContainer.addChild(
        new Text(
          this.theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredItems.length})`),
          0,
          0,
        ),
      );
    }

    // Model name + provider status for the selected item
    if (this.filteredItems.length > 0) {
      const selected = this.filteredItems[this.selectedIndex];
      this.listContainer.addChild(new Spacer(1));
      this.listContainer.addChild(
        new Text(this.theme.fg("muted", `  Model Name: ${selected.modelName}`), 0, 0),
      );

      const providerItems = this.allItems.filter(
        (i) => i.provider === selected.provider,
      );
      const hiddenInProvider = providerItems.filter(
        (i) => isHidden(this.hiddenRules, i.provider, i.modelId),
      ).length;
      this.listContainer.addChild(
        new Text(
          this.theme.fg(
            "dim",
            `  Provider: ${selected.provider} — ${providerItems.length - hiddenInProvider} visible, ${hiddenInProvider} hidden`,
          ),
          0,
          0,
        ),
      );
    }

    this.footerText.setText(this.getFooterText());
  }

  /** Toggle a single item between hidden and visible. */
  private toggleItem(item: DisplayItem): void {
    if (item.hidden) {
      // Remove the matching rule
      this.hiddenRules = this.hiddenRules.filter(
        (r) =>
          !(r.provider === item.provider &&
            (r.model === item.modelId || r.model === undefined)),
      );
    } else {
      // Add a rule for this specific model
      this.hiddenRules = deduplicateRules([
        ...this.hiddenRules,
        { provider: item.provider, model: item.modelId },
      ]);
    }
    this.hasChanges = true;
    this.refresh();
  }

  /** Toggle all models for a provider between hidden and visible. */
  private toggleProvider(provider: string): void {
    const providerItems = this.allItems.filter((i) => i.provider === provider);
    const hiddenCount = providerItems.filter(
      (i) => isHidden(this.hiddenRules, i.provider, i.modelId),
    ).length;

    if (hiddenCount > 0) {
      // Show all — remove all rules for this provider
      this.hiddenRules = this.hiddenRules.filter(
        (r) => r.provider !== provider,
      );
    } else {
      // Hide all — add a single provider-level rule
      this.hiddenRules = deduplicateRules([
        ...this.hiddenRules,
        { provider },
      ]);
    }
    this.hasChanges = true;
    this.refresh();
  }

  /** Add hide rules for the given items. */
  private hideModels(items: DisplayItem[]): void {
    const byProvider = new Map<string, string[]>();
    for (const item of items) {
      const list = byProvider.get(item.provider) ?? [];
      list.push(item.modelId);
      byProvider.set(item.provider, list);
    }

    for (const [provider, modelIds] of byProvider) {
      const totalForProvider = this.allItems.filter(
        (i) => i.provider === provider,
      ).length;
      if (modelIds.length === totalForProvider) {
        // All models for this provider — use a provider-level rule
        this.hiddenRules = deduplicateRules([
          ...this.hiddenRules.filter((r) => r.provider !== provider),
          { provider },
        ]);
      } else {
        // Partial — add individual model rules
        for (const modelId of modelIds) {
          this.hiddenRules = deduplicateRules([
            ...this.hiddenRules,
            { provider, model: modelId },
          ]);
        }
      }
    }
  }

  /** Remove hide rules for the given items. */
  private showModels(items: DisplayItem[]): void {
    for (const item of items) {
      this.hiddenRules = this.hiddenRules.filter(
        (r) =>
          !(r.provider === item.provider &&
            (r.model === item.modelId || r.model === undefined)),
      );
    }
  }

  /** Close and pass results to `done`. */
  private finish(cancelled: boolean): void {
    this.done({
      rules: cancelled ? [] : this.hiddenRules,
      cancelled,
    });
  }
}
