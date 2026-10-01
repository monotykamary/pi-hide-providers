import { expect, it, vi } from "vitest";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import extension from "../../hide-providers.js";
import { patchRegistry, unpatchRegistry } from "../../src/model-filter.js";
import { installMethodPatch } from "../../src/method-patch.js";

it("forwards 1.0 auth/cancellation options through asynchronous filtering", async () => {
  const getAvailable = vi.fn(async (..._args: any[]) => [{ provider: "p", id: "m" }]);
  const runtime = { getModels: () => [], getModel: () => undefined, getAvailableSnapshot: () => [], getAvailable };
  const registry = { runtime, getAll: () => [], getAvailable: () => [], find: () => undefined };
  patchRegistry(registry, () => []);
  const options = { signal: new AbortController().signal };
  try { await runtime.getAvailable("p", options); expect(getAvailable).toHaveBeenCalledWith("p", options); }
  finally { unpatchRegistry(registry); }
  expect(runtime.getAvailable).toBe(getAvailable);
});
it.each([false, true])("composes runtime ordering and filtering in either cleanup order (%s)", reverse => {
  const models = [{ provider: "p", id: "visible" }, { provider: "p", id: "hidden" }];
  const runtime = { getModels: () => models, getModel: () => undefined, getAvailableSnapshot: () => models };
  const original = runtime.getModels;
  const registry = { runtime, getAll: () => runtime.getModels(), getAvailable: () => [], find: () => undefined };
  patchRegistry(registry, () => [{ provider: "p", model: "hidden" }]);
  const restore = installMethodPatch(runtime, "getModels", function (base) { return [...base.call(this)].reverse(); });
  expect(runtime.getModels().map(m => m.id)).toEqual(["visible"]);
  if (reverse) restore(); else unpatchRegistry(registry);
  expect(runtime.getModels().map(m => m.id)).toEqual(reverse ? ["visible"] : ["hidden", "visible"]);
  if (reverse) unpatchRegistry(registry); else restore();
  expect(runtime.getModels).toBe(original);
});
it("forwards custom-screen focus to Input", async () => {
  let command: any;
  extension({ on() {}, registerCommand: (_: string, c: any) => { command = c; } } as any);
  let rendered = false;
  await command.handler("", { mode: "tui", modelRegistry: { getAll: () => [{ provider: "p", id: "m", name: "model" }] }, ui: { notify() {}, custom: async (factory: any) => {
    const theme = { fg: (_: string, s: string) => s, bold: (s: string) => s };
    const component = factory({ requestRender() {} }, theme, {}, () => {});
    component.focused = true;
    expect(component.render(40).join("\n")).toContain(CURSOR_MARKER);
    component.focused = false;
    expect(component.render(40).join("\n")).not.toContain(CURSOR_MARKER);
    rendered = true; return { cancelled: true };
  } } });
  expect(rendered).toBe(true);
});
