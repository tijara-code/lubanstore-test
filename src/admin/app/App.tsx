/**
 * THE APP: ask the server whether this browser is signed in, then the sign-in gate or the
 * panel. After sign-in the panel's settings are read BEFORE the shell is drawn (v408: hidden
 * pages and dismissed warnings are known before anything shows).
 */
import { useEffect } from "preact/hooks";
import { useStore } from "../data/store";
import { DialogHost, Toast } from "../kit";
import { Login } from "./Login";
import { loadUi, panelUi, usePanelUi } from "./panel";
import { checkSession, session } from "./session";
import { Shell } from "./Shell";

export function App() {
  const s = useStore(session);
  const ui = usePanelUi();
  useEffect(() => {
    void checkSession();
  }, []);
  useEffect(() => {
    if (s.state === "in") void loadUi();
    else panelUi.set({ hidden: [], dismissed: [], loaded: false });
  }, [s.state, s.user]);

  return (
    <>
      {s.state === "checking" || (s.state === "in" && !ui.loaded) ? (
        <div class="boot" role="status">
          Loading…
        </div>
      ) : s.state === "in" ? (
        <Shell />
      ) : (
        <Login />
      )}
      <Toast />
      <DialogHost />
    </>
  );
}
