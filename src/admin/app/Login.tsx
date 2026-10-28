/**
 * THE SIGN-IN GATE. Username and password, POST /login. The password is never stored (the
 * session is an HttpOnly cookie). Errors are said as what they are, in a role="alert" line:
 * 401 wrong password (the field is cleared and focused), 429 locked out ("Too many attempts.
 * Try again in 15 minutes." — the server's own minutes when it sends them), 503 not set up,
 * anything else "Could not reach the server".
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { isApiError } from "../data/api";
import { login } from "../data/endpoints";
import { session, signedIn } from "./session";
import { useStore } from "../data/store";

const NOT_SET = "Sign-in is not set up on the server (ADMIN_USER, ADMIN_PASSWORD and SESSION_SECRET).";

export function loginError(e: unknown): string {
  if (isApiError(e, "too_many_attempts")) {
    const min = Number(e.extra.retry_after_min) || Math.ceil((Number(e.extra.retryAfter) || 900) / 60);
    return "Too many attempts. Try again in " + min + " minutes.";
  }
  if (isApiError(e, "bad_credentials") || isApiError(e, "bad_input")) return "Wrong username or password";
  if (isApiError(e, "not_configured")) return NOT_SET;
  return "Could not reach the server";
}

export function Login() {
  const s = useStore(session);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(s.note || (s.configured === false ? NOT_SET : ""));
  const [busy, setBusy] = useState(false);
  const pw = useRef<HTMLInputElement>(null);
  const u = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "Sign in · Luban & Musk";
    u.current?.focus();
  }, []);
  useEffect(() => {
    if (s.configured === false) setErr(NOT_SET);
  }, [s.configured]);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      const a = await login(user.trim(), password);
      setPassword("");
      signedIn(a.user);
    } catch (ex) {
      setErr(loginError(ex));
      setPassword("");
      pw.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="gate">
      <form onSubmit={submit} autocomplete="off" aria-labelledby="gateTitle" noValidate>
        <span class="gate-mark" aria-hidden="true">
          LM
        </span>
        <h1 id="gateTitle">Luban &amp; Musk</h1>
        <span class="sub">Admin panel</span>
        <label for="u">Username</label>
        <input id="u" ref={u} type="text" autocomplete="username" spellcheck={false} value={user} onInput={(e) => setUser((e.currentTarget as HTMLInputElement).value)} />
        <label for="p">Password</label>
        <input id="p" ref={pw} type="password" autocomplete="current-password" value={password} onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)} />
        <p class="err" id="loginErr" role="alert">
          {err}
        </p>
        <button class="btn primary" type="submit" disabled={busy}>
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
