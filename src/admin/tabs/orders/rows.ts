/**
 * WHICH ORDER ROWS ARE OPEN (test-admin-tweaks): an accordion — opening one closes the others —
 * with a pin ("Keep open") as the way to compare two. Kept outside the list's render, so a
 * refresh, the five-minute timer or a page change puts the rows back exactly as they were.
 *
 *   toggle(s, id)   open (closing every unpinned other) or close (dropping its pin)
 *   pin(s, id)      pin or unpin; pinning a closed row opens it without closing the others
 *   forget(s)       a new filter is a new list: nothing open
 */
import { createStore } from "../../data/store";

export interface Rows {
  open: string[];
  pinned: string[];
}

export function toggle(s: Rows, id: string): Rows {
  if (s.open.indexOf(id) > -1) return { open: s.open.filter((x) => x !== id), pinned: s.pinned.filter((x) => x !== id) };
  return { open: [...s.open.filter((x) => s.pinned.indexOf(x) > -1), id], pinned: s.pinned };
}

export function pin(s: Rows, id: string): Rows {
  if (s.pinned.indexOf(id) > -1) return { open: s.open, pinned: s.pinned.filter((x) => x !== id) };
  return { open: s.open.indexOf(id) > -1 ? s.open : [...s.open, id], pinned: [...s.pinned, id] };
}

/** Open one row as asked from outside (a link from the Overview): the accordion applies. */
export function openOnly(s: Rows, id: string): Rows {
  return s.open.indexOf(id) > -1 ? s : toggle(s, id);
}

export const forget = (): Rows => ({ open: [], pinned: [] });

export const rowsStore = createStore<Rows>(forget());
