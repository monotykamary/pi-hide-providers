import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { HideProviderSelectorComponent } from "../../src/provider-selector.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as any;

describe("HideProviderSelectorComponent", () => {
  it.each([20, 40, 60])("never renders wider than %i columns", (width) => {
    const component = new HideProviderSelectorComponent(
      theme,
      [{ provider: "provider-with-a-long-name", id: "model-with-a-long-name", name: "Long Model Name" }],
      [],
      () => {},
    );

    for (const line of component.render(width)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });
});
