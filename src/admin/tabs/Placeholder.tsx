/**
 * THE STUB A PHASE-2 TAB REPLACES. Each of Payments, Catalogue, Empower, Customers and
 * Analytics is registered in app/tabs.ts with a component made by `placeholder(...)`; the
 * worker who builds the tab swaps that component for the real one (see src/admin/README.md).
 */
import { Card } from "../kit";
import { Icon, type IconName } from "../kit/Icon";

export function placeholder(what: string, icon: IconName) {
  return function Placeholder() {
    return (
      <Card class="stub">
        <Icon name={icon} />
        <h2>{what}</h2>
        <p class="hint">Coming in phase 2.</p>
      </Card>
    );
  };
}
