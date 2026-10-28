/**
 * The panel's icons (the original sprite's drawings), 24×24, stroked in currentColor.
 * `<Icon name="box" />`; decorative unless given a `label`.
 */
const PATHS = {
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  box: '<path d="M12 3.3 4.5 7.2v9.6L12 20.7l7.5-3.9V7.2Z"/><path d="M4.5 7.2 12 11.1l7.5-3.9M12 11.1v9.6"/>',
  tag: '<path d="M3.8 11.4V4.6a.8.8 0 0 1 .8-.8h6.8a.8.8 0 0 1 .57.24l8.4 8.4a.8.8 0 0 1 0 1.13l-6.8 6.8a.8.8 0 0 1-1.13 0l-8.4-8.4a.8.8 0 0 1-.24-.57Z"/><circle cx="8" cy="8" r="1.4"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20.2a6.2 6.2 0 0 1 12.4 0"/><path d="M16.4 5.1a3.4 3.4 0 0 1 0 6.6M17.6 14.6a6.2 6.2 0 0 1 3.6 5.6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/>',
  refresh: '<path d="M20.4 12a8.4 8.4 0 1 1-2.5-6"/><path d="M20.4 4.2V10h-5.8"/>',
  download: '<path d="M12 3.6v11.2"/><path d="m7.6 10.4 4.4 4.4 4.4-4.4"/><path d="M4.4 19.2h15.2"/>',
  check: '<path d="m5 12.8 4.4 4.4L19 7.6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  cal: '<rect x="3.4" y="5" width="17.2" height="15.4" rx="2.6"/><path d="M3.4 9.8h17.2M8 3.2v3.6M16 3.2v3.6"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 2"/>',
  coin: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2v9.6M14.8 9.4c-.6-1-1.7-1.6-2.8-1.6-1.8 0-3 .9-3 2.2 0 2.9 6 1.5 6 4.4 0 1.3-1.2 2.2-3 2.2-1.2 0-2.3-.6-2.9-1.5"/>',
  truck: '<rect x="2.4" y="6.4" width="11" height="9.6" rx="1.4"/><path d="M13.4 9.8h3.6a1 1 0 0 1 .76.34l2.7 3a1 1 0 0 1 .26.66V15a1 1 0 0 1-1 1h-6.3Z"/><circle cx="6.6" cy="18" r="2"/><circle cx="17.6" cy="18" r="2"/>',
  card: '<rect x="2.6" y="5" width="18.8" height="14" rx="2.4"/><path d="M2.6 9.8h18.8"/>',
  cash: '<rect x="2.6" y="6" width="18.8" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/>',
  cog: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  out: '<path d="M14.4 16.8v2.4a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6V4.8a1.6 1.6 0 0 1 1.6-1.6h7.6a1.6 1.6 0 0 1 1.6 1.6v2.4"/><path d="M18.4 15.2 21.6 12l-3.2-3.2M9.6 12h12"/>',
  link: '<path d="M10.4 13.6a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 1 0-5.66-5.66l-1.4 1.4"/><path d="M13.6 10.4a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 1 0 5.66 5.66l1.4-1.4"/>',
  alert: '<path d="M12 3.6 21.4 20H2.6Z"/><path d="M12 10v4.2M12 17.2v.1"/>',
  copy: '<rect x="8.4" y="8.4" width="12" height="12" rx="2"/><path d="M15.6 5.6V4.4a1 1 0 0 0-1-1H4.6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1.2"/>',
  chat: '<path d="M20.4 11.6a8.4 8.4 0 0 1-12.3 7.4L3.6 20.4l1.4-4.3a8.4 8.4 0 1 1 15.4-4.5Z"/><path d="M8.6 11.8h.1M12 11.8h.1M15.4 11.8h.1"/>',
  chev: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  pin: '<path d="M14.6 2.9 21.1 9.4l-2.3 2.3a4 4 0 0 1-3.6 1.1l-1.5-.3-5.4 5.4-3.2-3.2 5.4-5.4-.3-1.5a4 4 0 0 1 1.1-3.6Z"/><path d="m7.6 16.4-4 4"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4.5c4.5-2.6 7.5 2.6 13.5 0v9c-6 2.6-9-2.6-13.5 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 6.6h16"/><path d="M9.4 6.6V4.8a1.2 1.2 0 0 1 1.2-1.2h2.8a1.2 1.2 0 0 1 1.2 1.2v1.8"/><path d="M6.4 6.6 7.3 19a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5l.9-12.4"/><path d="M10.4 10.4v6M13.6 10.4v6"/>',
  undo: '<path d="M3.6 5.4v5.4H9"/><path d="M3.9 10.8a8.4 8.4 0 1 1 .5 5.4"/>',
  trend: '<path d="m3.6 15.6 5-5.4 3.6 3.2 5.4-6.2"/><path d="M14.4 7.2h3.9v3.9"/><path d="M3.6 20.4h16.8"/>',
  eye: '<path d="M2.4 12s3.6-6.4 9.6-6.4S21.6 12 21.6 12s-3.6 6.4-9.6 6.4S2.4 12 2.4 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  cart: '<path d="M2.8 3.8h2.6l2.4 11.2h9.8l2.2-8H6.2"/><circle cx="9.4" cy="19.2" r="1.5"/><circle cx="17" cy="19.2" r="1.5"/>',
  note: '<path d="M5 3.6h10l4 4v12.8H5Z"/><path d="M15 3.6v4h4M8.4 12h7.2M8.4 15.6h5"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, label, class: cls }: { name: IconName; label?: string; class?: string }) {
  return (
    <svg
      class={cls}
      viewBox="0 0 24 24"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
      focusable="false"
      // fixed drawings from the table above, never user text
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
