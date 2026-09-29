import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const BACKEND_URL = 'http://localhost:5000';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Session Hydration: verify existing session via HttpOnly cookie
  const refreshSession = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/me`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        if (data?.success && data?.user) {
          setUser(data.user);
          setIsAuthenticated(true);
          return data.user;
        }
      }

      setUser(null);
      setIsAuthenticated(false);
      return null;
    } catch {
      // Network failure or backend offline - safely degrade to unauthenticated
      setUser(null);
      setIsAuthenticated(false);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Hydrate session once on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (mounted) {
        await refreshSession();
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refreshSession]);

  // Login handler
  const login = useCallback(async (email, password) => {
    let response;
    try {
      response = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
    } catch (networkErr) {
      throw new Error('NEXORA authentication gateway unreachable. Ensure backend server is running on port 5000.');
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Server returned unexpected response (HTTP ${response.status})`);
    }

    if (!response.ok || !data?.success) {
      const message =
        data?.message ||
        (response.status === 401
          ? 'Invalid email or password'
          : `Authentication failed (HTTP ${response.status})`);
      throw new Error(message);
    }

    setUser(data.user);
    setIsAuthenticated(true);
    return data.user;
  }, []);

  // Signup handler (creates user record; does NOT automatically log in)
  const signup = useCallback(async (name, email, password) => {
    let response;
    try {
      response = await fetch(`${BACKEND_URL}/api/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ name, email, password }),
      });
    } catch (networkErr) {
      throw new Error('NEXORA registration service unreachable. Ensure backend server is running on port 5000.');
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Server returned unexpected response (HTTP ${response.status})`);
    }

    if (!response.ok || !data?.success) {
      const message =
        data?.message ||
        (response.status === 409
          ? 'Email already registered'
          : `Registration failed (HTTP ${response.status})`);
      throw new Error(message);
    }

    return data.user;
  }, []);

  // Logout handler
  const logout = useCallback(async () => {
    try {
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
        },
        credentials: 'include',
      });
    } catch {
      // Even if network fails, clear local auth state
    } finally {
      setUser(null);
      setIsAuthenticated(false);
    }
  }, []);

  const value = {
    user,
    isAuthenticated,
    isLoading,
    login,
    signup,
    logout,
    refreshSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
