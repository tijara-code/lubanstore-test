/**
 * The English words, on the /en/ pages only. scripts/make-en.ts names this module just
 * before the page's own entry (as make-en.js put i18n-en.js just before store.js), so it is
 * evaluated first and L() finds window.LM_EN from the first call.
 */
import { LM_EN } from "../core/i18n-en";

window.LM_EN = LM_EN;
