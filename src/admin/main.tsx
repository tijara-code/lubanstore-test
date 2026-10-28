/**
 * The admin panel's entry (site/admin/index.html). The styles are imported here — the admin is
 * not the storefront, so its CSS is bundled with it (src/admin/README.md).
 */
import { render } from "preact";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/kit.css";
import "./styles/orders.css";
import { App } from "./app/App";

const root = document.getElementById("app");
if (root) render(<App />, root);
