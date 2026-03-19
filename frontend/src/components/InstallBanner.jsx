import { useState, useEffect } from "react";
import { usePWAInstall } from "../hooks/usePWAInstall";

const LS_KEY = "pwa_banner_dismissed";

export default function InstallBanner() {
  const { canInstall, isIOS, triggerInstall } = usePWAInstall();
  const [visible,    setVisible]    = useState(false);
  const [showIOSTip, setShowIOSTip] = useState(false);

  useEffect(() => {
    if (canInstall && !localStorage.getItem(LS_KEY)) {
      // Small delay so it doesn't flash immediately on page load
      const t = setTimeout(() => setVisible(true), 1200);
      return () => clearTimeout(t);
    }
  }, [canInstall]);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(LS_KEY, "1");
  };

  const handleInstall = async () => {
    const result = await triggerInstall();
    if (result === "ios") {
      setShowIOSTip(true);
    } else if (result === "accepted") {
      dismiss();
    }
  };

  if (!visible) return null;

  return (
    <>
      <style>{`
        .install-banner {
          position: fixed;
          bottom: 0; left: 0; right: 0;
          z-index: 9999;
          padding: 16px 20px;
          background: #1a1a2a;
          border-top: 1px solid rgba(245,166,35,0.25);
          box-shadow: 0 -8px 32px rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          gap: 14px;
          animation: banner-slide-up 0.35s cubic-bezier(0.34,1.56,0.64,1);
        }
        @keyframes banner-slide-up {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .install-banner-icon {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: rgba(245,166,35,0.12);
          border: 1px solid rgba(245,166,35,0.25);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .install-banner-text {
          flex: 1;
          min-width: 0;
        }
        .install-banner-title {
          font-size: 13px;
          font-weight: 700;
          color: #ffffff;
          margin-bottom: 2px;
        }
        .install-banner-sub {
          font-size: 11px;
          color: rgba(255,255,255,0.45);
          line-height: 1.4;
        }
        .install-banner-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .install-banner-btn {
          padding: 8px 16px;
          background: #f5a623;
          border: none;
          border-radius: 8px;
          color: #000;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s;
        }
        .install-banner-btn:hover { background: #e09400; }
        .install-banner-dismiss {
          background: none;
          border: none;
          color: rgba(255,255,255,0.35);
          cursor: pointer;
          padding: 6px;
          font-size: 18px;
          line-height: 1;
          flex-shrink: 0;
          transition: color 0.15s;
        }
        .install-banner-dismiss:hover { color: rgba(255,255,255,0.7); }

        /* iOS share-sheet tooltip */
        .install-ios-tip {
          position: fixed;
          bottom: 92px; left: 16px; right: 16px;
          z-index: 10000;
          background: #1a1a2a;
          border: 1px solid rgba(245,166,35,0.3);
          border-radius: 14px;
          padding: 16px 18px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.6);
          animation: banner-slide-up 0.25s ease;
        }
        .install-ios-tip-title {
          font-size: 13px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 10px;
        }
        .install-ios-tip-steps {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .install-ios-tip-step {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          color: rgba(255,255,255,0.65);
        }
        .install-ios-tip-step-num {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: rgba(245,166,35,0.15);
          border: 1px solid rgba(245,166,35,0.3);
          color: #f5a623;
          font-size: 10px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .install-ios-tip-close {
          margin-top: 14px;
          width: 100%;
          padding: 8px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          color: rgba(255,255,255,0.5);
          font-size: 12px;
          cursor: pointer;
        }
      `}</style>

      {showIOSTip && (
        <div className="install-ios-tip">
          <div className="install-ios-tip-title">Add to Home Screen</div>
          <div className="install-ios-tip-steps">
            <div className="install-ios-tip-step">
              <span className="install-ios-tip-step-num">1</span>
              <span>Tap the <strong style={{color:"#fff"}}>Share</strong> button at the bottom of Safari</span>
            </div>
            <div className="install-ios-tip-step">
              <span className="install-ios-tip-step-num">2</span>
              <span>Scroll down and tap <strong style={{color:"#fff"}}>"Add to Home Screen"</strong></span>
            </div>
            <div className="install-ios-tip-step">
              <span className="install-ios-tip-step-num">3</span>
              <span>Tap <strong style={{color:"#fff"}}>Add</strong> — done!</span>
            </div>
          </div>
          <button className="install-ios-tip-close" onClick={() => { setShowIOSTip(false); dismiss(); }}>
            Got it
          </button>
        </div>
      )}

      <div className="install-banner">
        <div className="install-banner-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f5a623" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2"/>
            <line x1="12" y1="18" x2="12" y2="18" strokeWidth="2.5"/>
          </svg>
        </div>
        <div className="install-banner-text">
          <div className="install-banner-title">Add FlatRadar to your home screen</div>
          <div className="install-banner-sub">Instant access · full screen · no browser chrome</div>
        </div>
        <div className="install-banner-actions">
          <button className="install-banner-btn" onClick={handleInstall}>
            {isIOS ? "How to install" : "Install"}
          </button>
          <button className="install-banner-dismiss" onClick={dismiss} aria-label="Dismiss">×</button>
        </div>
      </div>
    </>
  );
}
