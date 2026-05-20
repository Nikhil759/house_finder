import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { ThemeProvider } from "./ThemeContext";
import LandingPage from "./pages/Landing";
import App from "./App";
import Search from "./pages/Search";
import Pulse from "./pages/Pulse";
import PulseLocality from "./pages/PulseLocality";
import MyHub from "./pages/MyHub";
import ListingDetail from "./pages/ListingDetail";
import HealthPage from "./HealthPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import NewForYou from "./pages/NewForYou";
import Profile from "./pages/Profile";
import Preferences from "./pages/Preferences";
import Stats from "./pages/Stats";
import LocalityGuide from "./pages/LocalityGuide";
import LocalityDetail from "./pages/LocalityDetail";
import PostHogRouteTracker from "./components/PostHogRouteTracker";
import { initPostHog } from "./lib/posthog";
import { useAuth } from "./hooks/useAuth";

initPostHog();

const ADMIN_EMAIL = "bn5799@gmail.com";

function AdminRoute({ element }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user || user.email !== ADMIN_EMAIL)
    return <Navigate to={`/?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  return element;
}

// Register service worker (enables Android PWA install prompt)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <PostHogRouteTracker />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/app" element={<Search />} />
          <Route path="/new" element={<MyHub />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/preferences" element={<Preferences />} />
          <Route path="/health" element={<AdminRoute element={<HealthPage />} />} />
          <Route path="/analytics" element={<AdminRoute element={<AnalyticsPage />} />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/listing/:id" element={<ListingDetail />} />
          <Route path="/locality-guide" element={<Pulse />} />
          <Route path="/neighbourhood-pulse/:locality" element={<PulseLocality />} />
        </Routes>
      </BrowserRouter>
      <Analytics />
    </ThemeProvider>
  </React.StrictMode>
);
