import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * Lightweight route that handles signed-token URLs from email footers
 * (/preferences?token=xxx), then redirects to the Profile page where
 * the actual email preferences UI lives.
 *
 * If the user is already signed in, redirects immediately.
 * If a token is present, verifies it (so the session context is warm)
 * and then redirects to /profile.
 */
export default function Preferences() {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;

    const token = searchParams.get('token');

    if (user) {
      navigate('/profile', { replace: true });
      return;
    }

    if (token) {
      fetch(`${API_BASE}/api/email/verify-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
        .then(r => r.json())
        .then(() => navigate('/profile', { replace: true }))
        .catch(() => navigate('/profile', { replace: true }));
    } else {
      navigate('/profile', { replace: true });
    }
  }, [loading, user, searchParams, navigate]);

  return null;
}
