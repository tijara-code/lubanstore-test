/**
 * The product page (index.html, en/index.html). The core first: it sets window.LM and
 * starts the catalogue before any page module evaluates. The page modules (stats, pixel,
 * header, cart, main — the original's script order) are added below by their ports.
 */
import "../core";
