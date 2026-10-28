/**
 * THE TABS — the one list the sidebar, the top bar, the router and the Settings dialog read.
 * To add or replace a tab, change its entry here (see src/admin/README.md, "Adding a tab").
 *
 *   id       the hash word (#orders) and the key
 *   page     the name it is hidden by in Settings (shared ADMIN_PAGES); null = never hidden
 *   group    the sidebar heading it sits under
 *   title    the top bar's heading; `sub` the small line above it
 *   badge    an optional hook giving the sidebar's count (Orders: the New ones)
 */
import type { ComponentType } from "preact";
import type { AdminPage } from "../../shared/admin/api";
import { useNewOrders } from "../data/hooks";
import type { IconName } from "../kit/Icon";
import { Catalogue } from "../tabs/catalogue/Catalogue";
import { Empower, useEmpowerWaiting } from "../tabs/empower/Empower";
import { Analytics } from "../tabs/analytics/Analytics";
import { Customers } from "../tabs/customers/Customers";
import { Orders } from "../tabs/orders/Orders";
import { Overview } from "../tabs/overview/Overview";
import { Payments } from "../tabs/payments/Payments";

export interface TabDef {
  id: string;
  label: string;
  icon: IconName;
  title: string;
  sub: string;
  group: "Workspace" | "Insights";
  page: AdminPage | null;
  component: ComponentType;
  badge?: () => number | null;
}

export const TABS: TabDef[] = [
  { id: "overview", label: "Overview", icon: "grid", title: "Overview", sub: "Today at a glance", group: "Workspace", page: null, component: Overview },
  { id: "orders", label: "Orders", icon: "box", title: "Orders", sub: "Search and fulfil", group: "Workspace", page: "orders", component: Orders, badge: useNewOrders },
  { id: "payments", label: "Payments", icon: "card", title: "Payments", sub: "Transactions and refunds", group: "Workspace", page: "payments", component: Payments },
  { id: "catalogue", label: "Catalogue", icon: "tag", title: "Catalogue", sub: "Prices and stock", group: "Workspace", page: "catalogue", component: Catalogue },
  { id: "empower", label: "Empower", icon: "truck", title: "Empower", sub: "Omniful fulfilment", group: "Workspace", page: "empower", component: Empower, badge: useEmpowerWaiting },
  { id: "customers", label: "Customers", icon: "users", title: "Customers", sub: "Who buys, and how much", group: "Insights", page: "customers", component: Customers },
  { id: "analytics", label: "Analytics", icon: "trend", title: "Analytics", sub: "Visitor activity", group: "Insights", page: "analytics", component: Analytics },
];

export const tabOf = (id: string) => TABS.find((t) => t.id === id);

/** The tabs shown, given the pages hidden in Settings (Overview always). */
export function visibleTabs(hidden: readonly string[]): TabDef[] {
  return TABS.filter((t) => !t.page || hidden.indexOf(t.page) < 0);
}
