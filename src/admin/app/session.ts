/**
 * THE SESSION — whether this browser is signed in, as the server says (GET /session). The
 * credential is an HttpOnly cookie the panel never sees; only the user's name is kept here, in
 * memory, for the avatar. A 401 from any call drops back to the sign-in gate with a note.
 */
import { onUnauthorised } from "../data/api";
import { getSession, logout } from "../data/endpoints";
import { clearQueries } from "../data/query";
import { createStore } from "../data/store";
import { serverProblem } from "../lib/words";

export interface Session {
  state: "checking" | "out" | "in";
  user?: string;
  /** the server has a user, a password and a SESSION_SECRET */
  configured?: boolean;
  /** why the gate is showing again ("Your session ended…") */
  note?: string;
}

export const session = createStore<Session>({ state: "checking" });

export async function checkSession(): Promise<void> {
  try {
    const s = await getSession();
    session.set(s.signedIn ? { state: "in", user: s.user, configured: true } : { state: "out", configured: s.configured });
  } catch (e) {
    session.set({ state: "out", note: serverProblem(e) || "Could not reach the server" });
  }
}

export function signedIn(user: string): void {
  session.set({ state: "in", user, configured: true });
}

/** Sign out now (the cookie is cleared by the server); `everywhere` ends every other browser's session too. */
export async function signOut(everywhere = false): Promise<void> {
  try {
    await logout(everywhere);
  } catch {
    /* gone either way: the gate shows */
  }
  clearQueries();
  session.set({ state: "out", configured: true });
}

onUnauthorised(() => {
  if (session.get().state !== "in") return;
  clearQueries();
  session.set({ state: "out", configured: true, note: "Your session ended. Sign in again." });
});
