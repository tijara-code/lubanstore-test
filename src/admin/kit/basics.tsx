/**
 * Small pieces every tab uses: Btn, Pill, Card, CardHead, Fold, Seg, Switch, Empty, Field
 * wrappers, the quantity stepper and the pager.
 */
import type { ButtonHTMLAttributes, ComponentChildren, HTMLAttributes } from "preact";
import { useId, useState } from "preact/hooks";
import { Icon, type IconName } from "./Icon";

type BtnKind = "primary" | "accent" | "ghost" | "danger" | undefined;

export interface BtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "icon" | "size"> {
  kind?: BtnKind;
  sm?: boolean;
  icon?: IconName;
  /** an icon-only button: the label becomes its accessible name and its tooltip */
  iconOnly?: boolean;
  busy?: boolean;
  label?: string;
  children?: ComponentChildren;
}

/** A capsule button. `label` names an icon-only one. */
export function Btn({ kind, sm, icon, iconOnly, busy, label, children, class: cls, type, disabled, ...rest }: BtnProps) {
  const c = ["btn", kind, sm && "sm", iconOnly && "icon", busy && "busy", cls].filter(Boolean).join(" ");
  return (
    <button
      type={(type as "button" | "submit") || "button"}
      class={c}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : (rest.title as string | undefined)}
      disabled={disabled || busy}
      aria-busy={busy ? "true" : undefined}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : null}
      {iconOnly ? null : children !== undefined ? <span>{children}</span> : label ? <span>{label}</span> : null}
    </button>
  );
}

/** A link styled as a button (an outside page, a download). */
export function LinkBtn({ href, icon, sm, kind, children, newTab, label, title, download }: { href: string; icon?: IconName; sm?: boolean; kind?: BtnKind; newTab?: boolean; label?: string; title?: string; download?: boolean; children?: ComponentChildren }) {
  return (
    <a
      class={["btn", kind, sm && "sm"].filter(Boolean).join(" ")}
      href={href}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener" : undefined}
      aria-label={label}
      title={title}
      download={download || undefined}
    >
      {icon ? <Icon name={icon} /> : null}
      {children !== undefined ? <span>{children}</span> : null}
    </a>
  );
}

export function Pill({ tone, title, children }: { tone?: string; title?: string; children: ComponentChildren }) {
  return (
    <span class={"pill" + (tone ? " " + tone : "")} title={title}>
      {children}
    </span>
  );
}

export function Card({ flush, class: cls, children, ...rest }: HTMLAttributes<HTMLElement> & { flush?: boolean }) {
  return (
    <section class={["card", flush && "flush", cls].filter(Boolean).join(" ")} {...rest}>
      {children}
    </section>
  );
}

export function CardHead({ title, id, children }: { title: ComponentChildren; id?: string; children?: ComponentChildren }) {
  return (
    <div class="card-head">
      <h2 id={id}>{title}</h2>
      {children}
    </div>
  );
}

/**
 * A card that folds: the heading is the toggle (a button with aria-expanded), the body is
 * unmounted only if `unmount` is set — by default it stays in the page, hidden, so a form inside
 * keeps its values while folded (test-admin-batch).
 */
export function Fold({ title, stamp, open: initial = false, unmount, children }: { title: ComponentChildren; stamp?: ComponentChildren; open?: boolean; unmount?: boolean; children: ComponentChildren }) {
  const [open, setOpen] = useState(initial);
  const id = useId();
  return (
    <section class={"card fold" + (open ? " open" : "")}>
      <div class="card-head">
        <button type="button" class="fold-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <Icon name="chev" class="fold-chev" />
          <h2>{title}</h2>
        </button>
        {stamp ? <span class="stamp">{stamp}</span> : null}
      </div>
      {unmount && !open ? null : (
        <div id={id} hidden={!open}>
          {children}
        </div>
      )}
    </section>
  );
}

/** A segmented control (7d / 30d / 90d). */
export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div class="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={String(o.value)} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A switch: a capsule, still a checkbox for the keyboard and the screen reader. */
export function Switch({ checked, onChange, disabled, children, fixed }: { checked: boolean; onChange?: (on: boolean) => void; disabled?: boolean; fixed?: boolean; children: ComponentChildren }) {
  return (
    <label class={"flag-sw" + (fixed ? " fixed" : "")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange?.((e.currentTarget as HTMLInputElement).checked)} />
      <span>{children}</span>
    </label>
  );
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <p class="empty">{children}</p>;
}

/** A labelled field: caps label over the control. */
export function Field({ label, children, class: cls, error }: { label: ComponentChildren; children: ComponentChildren; class?: string; error?: string }) {
  return (
    <label class={"tf" + (cls ? " " + cls : "")}>
      <span>{label}</span>
      {children}
      {error ? <em class="err-t">{error}</em> : null}
    </label>
  );
}

/** A search box with its glyph. */
export function SearchField({ value, onInput, placeholder, label, inputRef, onKeyDown }: { value: string; onInput: (v: string) => void; placeholder: string; label: string; inputRef?: { current: HTMLInputElement | null }; onKeyDown?: (e: KeyboardEvent) => void }) {
  return (
    <div class="field search">
      <Icon name="search" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        spellcheck={false}
        autocomplete="off"
        onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

/** A select in the capsule style. */
export function Select({ value, onChange, options, label, sm, disabled, class: cls }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string; disabled?: boolean }>; label: string; sm?: boolean; disabled?: boolean; class?: string }) {
  return (
    <select
      class={["pick", sm && "sm", value && "on", cls].filter(Boolean).join(" ")}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A count, stepped rather than typed (1–99). */
export function QtyStepper({ value, onChange, label = "Quantity" }: { value: number; onChange: (n: number) => void; label?: string }) {
  const set = (n: number) => onChange(Math.max(1, Math.min(99, Math.round(n) || 1)));
  return (
    <span class="qty-step">
      <button type="button" tabIndex={-1} aria-label="One fewer" onClick={() => set(value - 1)}>
        −
      </button>
      <input type="number" min={1} max={99} step={1} value={value} aria-label={label} onInput={(e) => set(Number((e.currentTarget as HTMLInputElement).value))} />
      <button type="button" tabIndex={-1} aria-label="One more" onClick={() => set(value + 1)}>
        +
      </button>
    </span>
  );
}

/**
 * The pager: "20 of 86" (how far down the list this page reaches) and ‹ 1 / 5 ›, drawn even
 * for a single page so the count is always there.
 */
export function Pager({ offset, limit, total, onPage }: { offset: number; limit: number; total: number; onPage: (offset: number) => void }) {
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(pages - 1, Math.floor(offset / limit));
  const upTo = Math.min(offset + limit, total);
  return (
    <div class="pager">
      <span class="pg-count">
        {upTo} of {total}
      </span>
      {pages > 1 ? (
        <span class="pg-nav">
          <button class="btn sm" type="button" aria-label="Previous page" disabled={page === 0} onClick={() => onPage((page - 1) * limit)}>
            ‹
          </button>
          <span class="pg-of">
            {page + 1} / {pages}
          </span>
          <button class="btn sm" type="button" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage((page + 1) * limit)}>
            ›
          </button>
        </span>
      ) : null}
    </div>
  );
}
