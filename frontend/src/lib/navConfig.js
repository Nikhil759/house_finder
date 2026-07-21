/**
 * Single source of truth for the primary nav items, shared by DesktopSidebar,
 * BottomNav and MobileNav so the three don't drift out of sync.
 *
 * Bangalore keeps "Pulse" (neighbourhood sentiment feed). Gurgaon swaps it
 * for "Societies" (gated-community directory) — Gurgaon has no locality
 * feed data yet.
 */
export function getNavItems(city) {
  const prefix = city === "gurgaon" ? "/gurgaon" : "";

  const items = [
    {
      id: "home",
      label: "Home",
      icon: "fa-solid fa-house",
      to: city === "gurgaon" ? "/gurgaon" : "/",
      match: (p) => p === "/" || p === "/gurgaon",
    },
    {
      id: "search",
      label: "Search",
      icon: "fa-solid fa-magnifying-glass",
      to: `${prefix}/app`,
      match: (p) => p.startsWith(`${prefix}/app`) || p.startsWith(`${prefix}/listing`),
    },
  ];

  if (city === "gurgaon") {
    items.push({
      id: "societies",
      label: "Societies",
      icon: "fa-solid fa-city",
      to: "/gurgaon/societies",
      match: (p) => p.startsWith("/gurgaon/societies"),
    });
  } else {
    items.push({
      id: "pulse",
      label: "Pulse",
      icon: "fa-solid fa-chart-line",
      to: "/locality-guide",
      match: (p) => p.startsWith("/locality-guide") || p.startsWith("/neighbourhood-pulse"),
    });
  }

  items.push(
    {
      id: "hub",
      label: "My Hub",
      icon: "fa-solid fa-layer-group",
      to: `${prefix}/new`,
      match: (p) => p.startsWith(`${prefix}/new`),
    },
    {
      id: "profile",
      label: "Profile",
      icon: "fa-solid fa-user",
      to: `${prefix}/profile`,
      match: (p) => p.startsWith(`${prefix}/profile`),
      // Desktop sidebar only — mobile bottom navs have 4 slots and surface
      // profile via the auth avatar instead (matches prior behaviour).
      hideOnMobile: true,
    },
  );

  return items;
}
