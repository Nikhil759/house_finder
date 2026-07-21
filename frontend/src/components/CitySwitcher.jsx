import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCity, mapPathToCity } from "../CityContext";

const CITIES = [
  { id: "bangalore", label: "Bangalore" },
  { id: "gurgaon", label: "Gurgaon" },
];

const ChevronIcon = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/**
 * City picker shown in the navbar. Switching cities keeps the user on the
 * "same" page where possible (Search -> Search, Societies <-> Pulse, etc.)
 * via mapPathToCity — see CityContext.jsx.
 */
export function CitySwitcher({ fullWidth = false }) {
  const { city } = useCity();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const current = CITIES.find((c) => c.id === city) || CITIES[0];

  const handleSelect = (targetCity) => {
    setOpen(false);
    if (targetCity === city) return;
    navigate(mapPathToCity(location.pathname, targetCity));
  };

  return (
    <div ref={rootRef} className={`city-switcher${fullWidth ? " full-width" : ""}`}>
      <button
        type="button"
        className="city-switcher-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{current.label}</span>
        <ChevronIcon />
      </button>

      {open && (
        <div className="city-switcher-menu" role="listbox">
          {CITIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={c.id === city}
              className={`city-switcher-option${c.id === city ? " active" : ""}`}
              onClick={() => handleSelect(c.id)}
            >
              {c.label}
              {c.id === city && <span className="city-switcher-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
