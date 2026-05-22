import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Scroll window to top on route change. Must be a child of BrowserRouter. */
export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
