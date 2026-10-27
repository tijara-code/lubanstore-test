/** Placeholder admin panel (the admin worker replaces this). */
import { render } from "preact";

function Admin() {
  return <h1>Admin</h1>;
}

const root = document.getElementById("app");
if (root) render(<Admin />, root);
