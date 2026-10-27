/**
 * The privacy & returns page (privacy.html, en/privacy.html). The original loaded only
 * stats.js here — NOT store.js — so this entry does not import the core either: the page
 * asks for no catalogue and no geo. The stats module is added here by its port.
 */
import "../tracking/stats";
