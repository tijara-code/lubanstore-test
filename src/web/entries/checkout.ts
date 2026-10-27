/**
 * The checkout (checkout.html, en/checkout.html). The core first, then the city lists the
 * checkout reads as window.LM_CITIES (cities.js loaded just before checkout.js). The page
 * modules (stats, pixel, header, cart, checkout) are added below by their ports.
 */
import "../core";
import "../tracking/stats";
import "../tracking/pixel";
import "../header";
import "../cart";
import { LM_CITIES } from "../core/cities";
/* checkout.js came last; it reads the city lists by import (an import runs before the assignment below) */
import "../checkout";

window.LM_CITIES = LM_CITIES;
