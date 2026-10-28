/**
 * A plain Preact render helper for the admin's DOM tests (no testing library): mount a vnode
 * into a fresh container inside act(), find by text or selector, fire events, wait for the
 * DOM to settle, and a fetch stub that answers by method + path.
 */
import { render, type VNode } from "preact";
import { act } from "preact/test-utils";
import { vi } from "vitest";

export interface Mounted {
  root: HTMLElement;
  $: <T extends Element = HTMLElement>(sel: string) => T | null;
  $$: <T extends Element = HTMLElement>(sel: string) => T[];
  text: () => string;
  unmount: () => void;
}

/** `v`: any component's vnode (h(App, null) is typed VNode<never>). */
export function mount(vnode: unknown): Mounted {
  const v = vnode as VNode;
  const root = document.createElement("div");
  document.body.appendChild(root);
  act(() => {
    render(v, root);
  });
  return {
    root,
    $: (sel) => root.querySelector(sel),
    $$: (sel) => [...root.querySelectorAll(sel)] as never,
    text: () => root.textContent || "",
    unmount: () => {
      act(() => render(null, root));
      root.remove();
    },
  };
}

/** Let promises and effects run (a few turns of the loop), inside act. */
export async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

export async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error("nothing to click");
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}

export async function type(el: Element | null, value: string): Promise<void> {
  if (!el) throw new Error("nothing to type in");
  await act(async () => {
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

export async function key(el: Element | null, k: string, extra: KeyboardEventInit = {}): Promise<void> {
  if (!el) throw new Error("no element");
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
  });
  await settle();
}

export function byText(root: ParentNode, sel: string, text: string | RegExp): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(sel)) {
    const t = (el.textContent || "").trim();
    if (typeof text === "string" ? t === text : text.test(t)) return el;
  }
  return null;
}

export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
  credentials?: RequestCredentials;
}

/** A fetch that answers /api/admin calls from a table: "GET /orders" → (call) => [status, json]. */
export function stubFetch(routes: Record<string, (c: Call) => [number, unknown] | unknown>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url, "http://localhost");
    const method = (init.method || "GET").toUpperCase();
    const path = u.pathname.replace(/^\/api\/admin/, "");
    const headers = Object.fromEntries(Object.entries((init.headers || {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const c: Call = { method, path, query: u.searchParams, body: init.body ? JSON.parse(String(init.body)) : undefined, headers, credentials: init.credentials };
    calls.push(c);
    const h = routes[method + " " + path] || routes[path];
    let status = 404;
    let json: unknown = { ok: false, error: "not_found" };
    if (h) {
      const out = h(c);
      if (Array.isArray(out) && out.length === 2 && typeof out[0] === "number") [status, json] = out as [number, unknown];
      else [status, json] = [200, out];
    }
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}
