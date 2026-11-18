import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { closeSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

const { agentDir } = vi.hoisted(() => ({ agentDir: { path: "" } }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...await importOriginal<typeof import("@earendil-works/pi-coding-agent")>(),
  getAgentDir: () => agentDir.path,
}));

let root: string;
let projectFile: string;
let globalFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hide-providers-config-"));
  agentDir.path = join(root, "agent");
  vi.resetModules();
  projectFile = join(root, CONFIG_DIR_NAME, "hide-providers.json");
  globalFile = join(agentDir.path, "hide-providers.json");
  mkdirSync(dirname(projectFile));
  mkdirSync(dirname(globalFile));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const model = { provider: "openai", id: "example" };
const read = (path = projectFile) => JSON.parse(readFileSync(path, "utf8"));

async function session(mode = "rpc") {
  const { default: startExtension } = await import("../../hide-providers.js");
  const handlers = new Map<string, Function>();
  let command!: Function;
  startExtension({
    on: (name: string, fn: Function) => handlers.set(name, fn),
    registerCommand: (_name: string, definition: { handler: Function }) => { command = definition.handler; },
  } as any);
  const ctx = {
    cwd: root, mode, hasUI: true,
    modelRegistry: { getAll: () => [model], getAvailable: () => [model], find: () => model },
    ui: { notify: vi.fn(), custom: vi.fn(), select: vi.fn() },
  };
  await handlers.get("session_start")!({}, ctx);
  return { ctx, run: (args: string) => command(args, ctx), shutdown: () => handlers.get("session_shutdown")!() };
}

it("merges stale command sessions into the latest config and keeps unrelated keys", async () => {
  writeFileSync(projectFile, JSON.stringify({ hide: [{ provider: "initial" }], other: 42 }));
  const a = await session();
  const b = await session();
  await a.run("add openai");
  await b.run("add anthropic");
  await a.run("remove anthropic");
  await b.run("remove initial");
  expect(read()).toEqual({ hide: [{ provider: "openai" }], other: 42 });
});

it("merges a TUI selector delta, without restoring untouched rules removed while it was open", async () => {
  writeFileSync(projectFile, JSON.stringify({ hide: [{ provider: "old" }, { provider: "untouched" }] }));
  const a = await session("tui");
  const b = await session();
  try {
    a.ctx.ui.custom.mockImplementation(async () => {
      await b.run("add concurrent");
      await b.run("remove untouched");
      return { rules: [{ provider: "openai" }, { provider: "untouched" }], cancelled: false };
    });
    await a.run("");
    expect(read().hide).toEqual([{ provider: "concurrent" }, { provider: "openai" }]);
  } finally {
    a.shutdown();
  }
});

it("uses the GUI's displayed intent even when the same rule was added in the meantime", async () => {
  writeFileSync(projectFile, JSON.stringify({ hide: [] }));
  const a = await session();
  const b = await session();
  a.ctx.ui.select.mockImplementation(async (_title: string, choices: string[]) => {
    await b.run("add openai/example");
    await b.run("add concurrent");
    return choices[0];
  });
  await a.run("");
  expect(read().hide).toEqual([{ provider: "openai", model: "example" }, { provider: "concurrent" }]);
});

it.each(["{ unfinished", "[]", '{"hide":[null]}', '{"hide":[{"provider":"openai","model":42}]}'])(
  "refuses malformed authoritative config %s without falling back to global",
  async (invalid) => {
    writeFileSync(projectFile, invalid);
    writeFileSync(globalFile, '{"hide":[]}');
    const a = await session();
    await a.run("add openai");
    expect(a.ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("Could not update hide rules"), "error");
    expect(readFileSync(projectFile, "utf8")).toBe(invalid);
    expect(read(globalFile)).toEqual({ hide: [] });
  },
);

it("replaces the file under a symlink atomically, leaving the original inode and mode intact", async () => {
  const target = join(root, "shared.json");
  const before = '{"hide":[]}';
  writeFileSync(target, before, { mode: 0o640 });
  symlinkSync("../shared.json", projectFile);
  const old = openSync(target, "r");
  try {
    const a = await session();
    await a.run("add openai");
    expect(readFileSync(old, "utf8")).toBe(before);
    expect(lstatSync(projectFile).isSymbolicLink()).toBe(true);
    expect(readlinkSync(projectFile)).toBe("../shared.json");
    expect(statSync(target).mode & 0o777).toBe(0o640);
    expect(read(target).hide).toEqual([{ provider: "openai" }]);
  } finally {
    closeSync(old);
  }
});

it("does not rewrite the config for a rule that is already absent", async () => {
  const original = '{ "hide": [] }\n';
  writeFileSync(projectFile, original);
  const a = await session();
  await a.run("remove openai");
  expect(readFileSync(projectFile, "utf8")).toBe(original);
  expect(a.ctx.ui.notify).toHaveBeenLastCalledWith("Rule not found: openai/*", "warning");
});

it("creates the global config when no project file exists", async () => {
  const a = await session();
  await a.run("add openai");
  expect(read(globalFile)).toEqual({ hide: [{ provider: "openai" }] });
});
