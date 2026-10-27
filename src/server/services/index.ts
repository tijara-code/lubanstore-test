/**
 * Builds the outside-service clients. The same real clients run in every mode; in fake
 * mode their network is the in-process fake world (services/fakes).
 */
import type { Services } from "../core/deps";
import type { ServiceContext } from "./context";
import { createWorld, type World } from "./fakes/world";
import { createOmniful } from "./omniful";
import { installOmnifulFake } from "./omniful/fake";
import { createPixels } from "./pixels";
import { installPixelsFake } from "./pixels/fake";
import { createThawani } from "./thawani";
import { installThawaniFake } from "./thawani/fake";

export function createServices(ctx: ServiceContext): Services {
  return {
    ...createThawani(ctx),
    ...createOmniful(ctx),
    ...createPixels(ctx),
  } as Services;
}

/** A fake world with every emulator installed. */
export function createFakeWorld(opts: { seed?: number } = {}): World {
  const world = createWorld(opts);
  installThawaniFake(world);
  installOmnifulFake(world);
  installPixelsFake(world);
  return world;
}

/** Placeholder credentials so the real clients run against the fake world (fake mode only). */
export const FAKE_ENV = {
  THAWANI_SECRET_KEY: "fake-thawani-secret",
  THAWANI_PUBLISHABLE_KEY: "fake-thawani-publishable",
  THAWANI_WEBHOOK_SECRET: "fake-webhook-secret",
  OMNIFUL_API_TOKEN: "fake-omniful-token",
  OMNIFUL_HUB_CODE: "FAKE-HUB",
  OMNIFUL_HOOK_SECRET: "fake-hook-secret",
  META_PIXEL_ID: "100000000000001",
  META_CAPI_TOKEN: "fake-meta-token",
  SNAP_PIXEL_ID: "00000000-0000-4000-8000-000000000001",
  SNAP_CAPI_TOKEN: "fake-snap-token",
  GA4_MEASUREMENT_ID: "G-FAKE00001",
  GA4_API_SECRET: "fake-ga4-secret",
} as const;
