/**
 * `npm run admin:hash` — prints the scrypt hash of a password for ADMIN_PASSWORD_HASH.
 *
 * The password is read from stdin and never echoed: typed at a terminal (nothing shows; Enter
 * ends it, Ctrl-C aborts), or piped (`printf '%s' "$PW" | npm run -s admin:hash`). Only the
 * hash is printed (stdout); the prompt goes to stderr, so the output can be captured as is.
 */
import { hashPassword } from "../src/server/domain/admin/auth";

async function readHidden(): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(Buffer.from(c as Buffer));
    return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  }
  process.stderr.write("Password (not shown): ");
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let pw = "";
    const done = (fn: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeAllListeners("data");
      process.stderr.write("\n");
      fn();
    };
    stdin.on("data", (s: string) => {
      for (const ch of s) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return done(() => resolve(pw));
        if (ch === "\u0003") return done(() => reject(new Error("aborted")));
        if (ch === "\u007f" || ch === "\b") pw = pw.slice(0, -1);
        else pw += ch;
      }
    });
  });
}

async function main(): Promise<void> {
  const pw = await readHidden();
  if (pw.length < 12) {
    process.stderr.write("admin:hash: use at least 12 characters.\n");
    process.exit(1);
  }
  process.stdout.write((await hashPassword(pw)) + "\n");
}

main().catch((e) => {
  process.stderr.write("admin:hash: " + (e as Error).message + "\n");
  process.exit(1);
});
