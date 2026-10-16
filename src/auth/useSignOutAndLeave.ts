import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

/** Signs out, then goes to /login. Shared with the workspace profile menu. */
export function useSignOutAndLeave() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const run = async () => {
    setFailed(false);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch {
      setFailed(true);
    }
  };
  return { run, failed };
}
