/**
 * The checkout (checkout.html, en/checkout.html). The core first, then the city lists the
 * checkout reads as window.LM_CITIES (cities.js loaded just before checkout.js). The page
 * modules (stats, pixel, header, cart, checkout) are added below by their ports.
 */
import "../core";
import { LM_CITIES } from "../core/cities";

window.LM_CITIES = LM_CITIES;
