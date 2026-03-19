import { useState, useEffect } from "react";

/**
 * Shared hook for PWA install logic.
 *
 * Returns:
 *   canInstall  — true if the install option should be shown
 *   isInstalled — true if already running as installed PWA
 *   isIOS       — true on iPhone/iPad (needs manual share-sheet instructions)
 *   triggerInstall() — call on button click:
 *                      Android: fires native install prompt, resolves to "accepted"|"dismissed"
 *                      iOS:     returns "ios" so caller can show share-sheet tooltip
 */
export function usePWAInstall() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled,   setIsInstalled]   = useState(false);
  const [isIOS,         setIsIOS]         = useState(false);

  useEffect(() => {
    // Already running as installed PWA
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
      return;
    }

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !("MSStream" in window);
    setIsIOS(ios);

    const onPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled",        onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled",        onInstalled);
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

  const canInstall = !isInstalled && (!!installPrompt || isIOS);

  return { canInstall, isInstalled, isIOS, triggerInstall };
}
