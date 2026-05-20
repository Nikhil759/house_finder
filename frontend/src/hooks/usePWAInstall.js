import { useState, useEffect } from "react";
import { posthog } from "../lib/posthog";

function detectInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

/**
 * Shared hook for PWA install logic.
 *
 * Returns:
 *   canInstall       — native prompt or iOS manual install available
 *   isInstalled      — already running as installed PWA
 *   isIOS            — iPhone/iPad Safari
 *   hasNativePrompt  — beforeinstallprompt was captured (Android/Chrome)
 *   triggerInstall() — "accepted"|"dismissed"|"ios"|"unavailable"
 */
export function usePWAInstall() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(detectInstalled);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (detectInstalled()) {
      setIsInstalled(true);
      return;
    }

    const ios =
      /iphone|ipad|ipod/i.test(navigator.userAgent) && !("MSStream" in window);
    setIsIOS(ios);

    const onPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      try {
        posthog.capture("app_installed", {
          platform: ios ? "ios" : "android",
        });
      } catch (_) {}
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const triggerInstall = async () => {
    if (isIOS) return "ios";
    if (!installPrompt) return "unavailable";
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
      setInstallPrompt(null);
    }
    return outcome;
  };

  const hasNativePrompt = !!installPrompt;
  const canInstall = !isInstalled && (hasNativePrompt || isIOS);

  return {
    canInstall,
    isInstalled,
    isIOS,
    hasNativePrompt,
    triggerInstall,
  };
}
