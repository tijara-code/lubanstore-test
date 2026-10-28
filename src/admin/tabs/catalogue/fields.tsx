/**
 * The Catalogue tab's boxes: a caption over a control, in the original's `.field-b` widths
 * (wide, narrow, swatch, act, rate). A number box keeps what was typed (Arabic digits read as
 * digits) and reports a box that does not read as a number to the tab, which will not publish
 * while one is wrong. English boxes (`en`) are tinted and written left to right.
 */
import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useId, useRef, useState } from "preact/hooks";
import { Switch } from "../../kit";
import { numText, readNum, type NumRule } from "./model";

/** Where a box says it cannot be read (and stops saying so). */
export const BadBoxes = createContext<(key: string, problem: string | null) => void>(() => {});

const cls = (...x: Array<string | false | undefined | null>) => x.filter(Boolean).join(" ");

export function Box({ label, width, en, children, error }: { label: string; width?: string; en?: boolean; children: ComponentChildren; error?: string }) {
  return (
    <label class={cls("field-b", width, en && "en", error && "bad")}>
      <span class="cap">{label}</span>
      {children}
      {error ? <em class="err-t">{error}</em> : null}
    </label>
  );
}

export function TextBox(p: { label: string; value: unknown; onValue: (v: string) => void; width?: string; en?: boolean; ltr?: boolean; readOnly?: boolean; placeholder?: string; title?: string; error?: string; maxLength?: number }) {
  return (
    <Box label={p.label} width={p.width} en={p.en} error={p.error}>
      <input
        value={p.value == null ? "" : String(p.value)}
        dir={p.en || p.ltr ? "ltr" : "auto"}
        readOnly={p.readOnly}
        placeholder={p.placeholder}
        title={p.title}
        maxLength={p.maxLength || 200}
        autocomplete="off"
        aria-invalid={p.error ? "true" : undefined}
        onInput={(e) => p.onValue((e.currentTarget as HTMLInputElement).value)}
      />
    </Box>
  );
}

/** A number box: commits a number (or null when blank is allowed) while what is typed reads. */
export function NumBox(p: { label: string; value: unknown; onValue: (v: number | null) => void; rule?: NumRule; width?: string; placeholder?: string; title?: string; suffix?: string; readOnly?: boolean; bare?: boolean; ariaLabel?: string }) {
  const report = useContext(BadBoxes);
  const key = useId();
  const [text, setText] = useState(numText(p.value));
  const [error, setError] = useState<string | undefined>();
  const focused = useRef(false);
  // the value changed elsewhere (a reload, a unit flip, a stepper): show it, unless being typed in
  useEffect(() => {
    if (focused.current) return;
    const r = readNum(text, p.rule);
    if (r.error || r.value !== (p.value === "" || p.value == null ? (p.rule?.blank ? null : 0) : Number(p.value))) {
      setText(numText(p.value));
      setError(undefined);
      report(key, null);
    }
  }, [p.value]);
  useEffect(() => () => report(key, null), []);
  const input = (
    <input
      value={text}
      inputMode="decimal"
      dir="ltr"
      readOnly={p.readOnly}
      placeholder={p.placeholder}
      title={p.title}
      aria-label={p.bare ? p.ariaLabel || p.label : undefined}
      aria-invalid={error ? "true" : undefined}
      autocomplete="off"
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        const r = readNum(text, p.rule);
        if (!r.error) setText(numText(r.value));
      }}
      onInput={(e) => {
        const t = (e.currentTarget as HTMLInputElement).value;
        setText(t);
        const r = readNum(t, p.rule);
        setError(r.error);
        report(key, r.error ? p.label + ": " + r.error.toLowerCase() : null);
        if (!r.error) p.onValue(r.value);
      }}
    />
  );
  if (p.bare) return input;
  return (
    <Box label={p.label} width={p.width} error={error}>
      {p.suffix ? (
        <span class="with-unit">
          {input}
          <i>{p.suffix}</i>
        </span>
      ) : (
        input
      )}
    </Box>
  );
}

export function ColorBox({ label, value, onValue, fallback }: { label: string; value: unknown; onValue: (v: string) => void; fallback: string }) {
  const v = /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? String(value) : fallback;
  return (
    <Box label={label} width="swatch">
      <input type="color" value={v} onInput={(e) => onValue((e.currentTarget as HTMLInputElement).value)} />
    </Box>
  );
}

/** A caption over one capsule switch (On, Sold out here, Offered here). */
export function Tick({ label, text, checked, onChange, width = "wide", title }: { label: string; text: ComponentChildren; checked: boolean; onChange: (on: boolean) => void; width?: string; title?: string }) {
  return (
    <div class={cls("field-b", width)} title={title}>
      <span class="cap" aria-hidden="true">
        {label}
      </span>
      <Switch checked={checked} onChange={onChange}>
        {text}
      </Switch>
    </div>
  );
}

/** A caption over a select. */
export function Pick({ label, value, options, onChange, width }: { label: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void; width?: string }) {
  return (
    <Box label={label} width={width}>
      <select class="pick" value={value} onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}>
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </Box>
  );
}

/** A row of market ticks (Offered in, Ships free in): one capsule per market. */
export function MarketTicks({ label, codes, value, onChange, title }: { label: string; codes: string[]; value: string[]; onChange: (v: string[]) => void; title?: string }) {
  return (
    <div class="field-b wide" role="group" aria-label={label} title={title}>
      <span class="cap" aria-hidden="true">
        {label}
      </span>
      <span class="flag-wrap">
        {codes.map((code) => (
          <Switch key={code} checked={value.indexOf(code) > -1} onChange={(on) => onChange(on ? codes.filter((c) => c === code || value.indexOf(c) > -1) : value.filter((c) => c !== code))}>
            {code}
          </Switch>
        ))}
      </span>
    </div>
  );
}

/** An empty cell on an English line, so each English box sits under the Arabic one it translates. */
export const Gap = ({ n = 1 }: { n?: number }) => <div class={"field-b en-gap" + (n > 1 ? " w" + n : "")} aria-hidden="true" />;
