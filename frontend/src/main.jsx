import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { ThemeProvider } from "./ThemeContext";
import LandingPage from "./LandingPage";
import App from "./App";
import HealthPage from "./HealthPage";
import NewForYou from "./pages/NewForYou";
import Profile from "./pages/Profile";
import Stats from "./pages/Stats";
import LocalityGuide from "./pages/LocalityGuide";
import LocalityDetail from "./pages/LocalityDetail";
import InstallBanner from "./components/InstallBanner";
import PostHogRouteTracker from "./components/PostHogRouteTracker";
import { initPostHog } from "./lib/posthog";

initPostHog();

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
          <Route path="/app" element={<App />} />
          <Route path="/new" element={<NewForYou />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/health" element={<HealthPage />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/locality-guide" element={<LocalityGuide />} />
          <Route path="/neighbourhood-pulse/:locality" element={<LocalityDetail />} />
        </Routes>
        <InstallBanner />
      </BrowserRouter>
      <Analytics />
    </ThemeProvider>
  </React.StrictMode>
);
