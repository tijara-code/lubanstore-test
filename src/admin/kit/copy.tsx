/**
 * Copy to the clipboard: navigator.clipboard where the page is a secure context, else the
 * textarea fallback (an admin opened over plain http on a local network). <CopyBtn> says
 * "Copied" in a toast, or why not.
 */
import { Btn } from "./basics";
import { toast } from "./feedback";

export function copyText(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) resolve();
        else reject(new Error("copy refused"));
      } catch (e) {
        reject(e as Error);
      }
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(resolve, fallback);
    else fallback();
  });
}

export function CopyBtn({ text, label, done, sm = true, kind }: { text: () => string; label: string; done: string; sm?: boolean; kind?: "primary" | "ghost" }) {
  return (
    <Btn
      sm={sm}
      kind={kind}
      icon="copy"
      onClick={() =>
        copyText(text()).then(
          () => toast(done, true),
          () => toast("Could not copy. Check clipboard permission."),
        )
      }
    >
      {label}
    </Btn>
  );
}
