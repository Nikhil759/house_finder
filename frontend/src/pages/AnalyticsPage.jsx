import { useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import BottomNav from '../components/BottomNav';
import DesktopSidebar from '../components/DesktopSidebar';
import AnalyticsDashboard from '../components/AnalyticsDashboard';
import { useDesktop } from '../hooks/useDesktop';

export default function AnalyticsPage() {
  const isDesktop = useDesktop();
  const navigate = useNavigate();

  return (
    <div style={{
      background: 'var(--color-bg-primary)',
      color: 'var(--color-text-primary)',
      fontFamily: 'var(--font-sans)',
      minHeight: '100vh',
      marginLeft: isDesktop ? 240 : 0,
      paddingBottom: isDesktop ? 40 : 100,
    }}>
      <DesktopSidebar />
      <AppHeader />

      <div style={{
        padding: '24px 16px 0',
        maxWidth: isDesktop ? 600 : undefined,
        margin: isDesktop ? '0 auto' : undefined,
      }}>
        {/* Back link */}
        <button
          onClick={() => navigate('/profile')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            marginBottom: 20,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.06em',
            color: 'var(--color-text-muted)',
          }}
        >
          ← Profile
        </button>

        <AnalyticsDashboard />
      </div>

      <BottomNav />
    </div>
  );
}
