import { createContext, useContext, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";

const CityContext = createContext("bangalore");

export const CITY_PREFIX = {
  bangalore: "",
  gurgaon: "/gurgaon",
};

/**
 * Derives the active city from the URL (path-segment strategy: Gurgaon
 * routes live under /gurgaon/*, Bangalore stays unprefixed at the root).
 * Sets data-city on <html> so global.css can swap --color-accent.
 *
 * Must be rendered inside <BrowserRouter> (needs useLocation).
 */
export function CityProvider({ children }) {
  const location = useLocation();
  const city = location.pathname.startsWith("/gurgaon") ? "gurgaon" : "bangalore";

  useEffect(() => {
    document.documentElement.setAttribute("data-city", city);
  }, [city]);

  const value = useMemo(() => ({ city, prefix: CITY_PREFIX[city] }), [city]);

  return <CityContext.Provider value={value}>{children}</CityContext.Provider>;
}

export function useCity() {
  return useContext(CityContext);
}

/**
 * Maps a pathname on one city to its best equivalent on `targetCity`.
 * Used by the navbar city switcher to preserve "where you were" instead of
 * always bouncing the user back to home.
 */
export function mapPathToCity(pathname, targetCity) {
  const isGurgaon = pathname.startsWith("/gurgaon");

  if (targetCity === "gurgaon") {
    if (isGurgaon) return pathname;
    if (pathname === "/") return "/gurgaon";
    if (pathname.startsWith("/locality-guide") || pathname.startsWith("/neighbourhood-pulse")) {
      return "/gurgaon/societies";
    }
    return "/gurgaon" + pathname;
  }

  // targetCity === "bangalore"
  if (!isGurgaon) return pathname;
  const rest = pathname.slice("/gurgaon".length) || "/";
  if (rest.startsWith("/societies")) return "/locality-guide";
  return rest;
}
