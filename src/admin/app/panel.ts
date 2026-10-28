/**
 * THE PANEL'S SETTINGS (v211, v411), shared by every admin and every browser, kept on the
 * server (GET/PUT /settings/ui): which pages are hidden, which Overview warnings were
 * dismissed (by code; never in localStorage). Loaded once after sign-in, before any tab is drawn.
 */
import type { AdminPage } from "../../shared/admin/api";
import { getUi, putUi } from "../data/endpoints";
import { createStore, useStore } from "../data/store";

export interface PanelUi {
  hidden: AdminPage[];
  dismissed: string[];
  loaded: boolean;
}

export const panelUi = createStore<PanelUi>({ hidden: [], dismissed: [], loaded: false });
export const usePanelUi = () => useStore(panelUi);

export async function loadUi(): Promise<void> {
  try {
    const j = await getUi();
    panelUi.set({ hidden: j.ui.hidden, dismissed: j.dismissed, loaded: true });
  } catch {
    // every page shows, as before
    panelUi.set({ ...panelUi.get(), loaded: true });
  }
}

export async function saveHidden(hidden: AdminPage[]): Promise<void> {
  const j = await putUi({ hidden });
  panelUi.set({ hidden: j.ui.hidden, dismissed: j.dismissed, loaded: true });
}

/** Dismiss these warning codes (added to the ones already dismissed). */
export async function dismissWarnings(codes: string[]): Promise<void> {
  const was = panelUi.get();
  const next = [...was.dismissed];
  for (const c of codes) if (next.indexOf(c) < 0) next.push(c);
  panelUi.set({ ...was, dismissed: next });
  const j = await putUi({ dismissed: next });
  panelUi.set({ hidden: j.ui.hidden, dismissed: j.dismissed, loaded: true });
}
