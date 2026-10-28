/**
 * A figure tile: its name and glyph on the top line, the number on the floor. A trailing
 * three-letter currency is set at half size in the muted grey ("1018.721 OMR"); a plain count is
 * left alone. `dark` is the inverted tile (the Overview's revenue). Tiles sit in `<Kpis>`.
 */
import type { ComponentChildren } from "preact";
import { splitUnit } from "../lib/format";
import { Icon, type IconName } from "./Icon";

export function Kpi({ label, value, icon, tone, delta, up, dark }: { label: string; value: string; icon: IconName; tone?: string; delta?: string; up?: boolean | null; dark?: boolean }) {
  const [fig, unit] = splitUnit(value);
  return (
    <div class={"kpi" + (dark ? " dark" : "")}>
      <div class="kpi-top">
        <span>{label}</span>
        <span class={"ic " + (tone || "")}>
          <Icon name={icon} />
        </span>
      </div>
      <div class="col">
        <b>
          {fig}
          {unit ? (
            <>
              {" "}
              <em>{unit}</em>
            </>
          ) : null}
        </b>
        {delta ? <span class={"delta" + (up === true ? " up" : up === false ? " down" : "")}>{delta}</span> : null}
      </div>
    </div>
  );
}

export function Kpis({ five, children, label }: { five?: boolean; children: ComponentChildren; label?: string }) {
  return (
    <div class={"kpis" + (five ? " five" : "")} role="group" aria-label={label}>
      {children}
    </div>
  );
}
