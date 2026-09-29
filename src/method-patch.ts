// Cooperating model extensions may unload in either order.
const PATCH = Symbol.for("pi.model-accessor.patch.v1");
type Method = (this: any, ...args: any[]) => any;
type Wrapped = Method & { [PATCH]?: { active: boolean; original: Method } };
function unwrap(method: Wrapped): Method {
  while (method[PATCH] && !method[PATCH]!.active) method = method[PATCH]!.original;
  return method;
}
export function installMethodPatch(target: any, name: string, handler: (this: any, original: Method, ...args: any[]) => any): () => void {
  const original = target[name] as Method;
  if (typeof original !== "function") throw new Error(`Pi model contract missing: ${name}`);
  const state = { active: true, original };
  const wrapped: Wrapped = function (...args) {
    return state.active ? handler.call(this, original, ...args) : original.apply(this, args);
  };
  wrapped[PATCH] = state;
  target[name] = wrapped;
  return () => {
    state.active = false;
    if (target[name] === wrapped) target[name] = unwrap(original);
  };
}
