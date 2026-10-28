/**
 * Feedback: the toast, and dialogs (a modal, and the two asked-for-an-answer forms).
 *
 *   toast(msg, ok?)                one line at the foot, role="status"; on screen long enough
 *                                  to be read (2.4–10 s, by length)
 *   ask({ title, text, ok, … })    → Promise<boolean>  (a confirm with the panel's look)
 *   choose({ title, text, options }) → Promise<value | null>
 *   <Modal open onClose title>     a dialog: aria-modal, focus moved in and trapped, Escape and
 *                                  the backdrop close it, focus returns to what opened it
 *
 * <Toast /> and <DialogHost /> are mounted once by the app.
 */
import { createPortal, type ComponentChildren } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";
import { createStore, useStore } from "../data/store";

/* ---------------- toast ---------------- */

interface ToastState {
  msg: string;
  ok: boolean;
  n: number;
}
export const toastStore = createStore<ToastState | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string, ok = false): void {
  toastStore.set({ msg, ok, n: (toastStore.get()?.n || 0) + 1 });
  clearTimeout(toastTimer);
  const ms = Math.max(2400, Math.min(10000, msg.length * 45));
  toastTimer = setTimeout(() => toastStore.set(null), ms);
}

export function Toast() {
  const t = useStore(toastStore);
  return (
    <div class={"toast" + (t ? " show" : "") + (t && t.ok ? " ok" : "")} role="status" aria-live="polite" aria-atomic="true">
      {t ? t.msg : ""}
    </div>
  );
}

/* ---------------- the modal ---------------- */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, wide, children, initialFocus }: { open: boolean; onClose: () => void; title: ComponentChildren; wide?: boolean; children: ComponentChildren; initialFocus?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const el = box.current;
    const first = (initialFocus && el?.querySelector<HTMLElement>(initialFocus)) || el?.querySelector<HTMLElement>(FOCUSABLE) || el;
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const list = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!list.length) return;
      const a = list[0]!;
      const z = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      if (before && document.contains(before)) before.focus();
    };
  }, [open]);

  if (!open) return null;
  // on the body: a dialog drawn inside an animated page would be dimmed with it, not over it
  return createPortal(
    <div class="dlg-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class={"dlg" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-labelledby={id} ref={box} tabIndex={-1}>
        <div class="card-head">
          <h2 id={id}>{title}</h2>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- asked questions ---------------- */

export interface Choice<T> {
  value: T;
  label: string;
  kind?: "primary" | "danger" | "ghost";
}
interface Asking {
  title: string;
  text?: string;
  options: Array<Choice<unknown>>;
  resolve: (v: unknown) => void;
}
const askStore = createStore<Asking | null>(null);

export function choose<T>(q: { title: string; text?: string; options: Array<Choice<T>> }): Promise<T | null> {
  return new Promise((resolve) => {
    const was = askStore.get();
    if (was) was.resolve(null);
    askStore.set({ ...q, options: q.options as Array<Choice<unknown>>, resolve: resolve as (v: unknown) => void });
  });
}

/** Yes or no. */
export async function ask(q: { title: string; text?: string; ok?: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  const v = await choose<boolean>({
    title: q.title,
    text: q.text,
    options: [
      { value: false, label: q.cancel || "Cancel", kind: "ghost" },
      { value: true, label: q.ok || "OK", kind: q.danger ? "danger" : "primary" },
    ],
  });
  return v === true;
}

export function DialogHost() {
  const a = useStore(askStore);
  const done = (v: unknown) => {
    if (!a) return;
    askStore.set(null);
    a.resolve(v);
  };
  return (
    <Modal open={!!a} onClose={() => done(null)} title={a ? a.title : ""} initialFocus=".dlg-foot .btn:last-child">
      {a && a.text ? <p class="hint">{a.text}</p> : null}
      <div class="dlg-foot">
        {(a ? a.options : []).map((o, i) => (
          <button key={i} type="button" class={"btn sm " + (o.kind || "")} onClick={() => done(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
