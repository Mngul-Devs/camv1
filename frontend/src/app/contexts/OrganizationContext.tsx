import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import {
  login as apiLogin,
  logout as apiLogout,
  checkAuth,
  getProjects,
  getCameras,
  apiCreateProject,
  apiUpdateProject,
  apiDeleteProject,
  type ApiProject,
  type ApiCamera,
} from '../../lib/api';

export interface Project {
  id: string;
  name: string;
  status: 'ACTIVE' | 'ON_HOLD' | 'CLOSED';
  region: string;
  regionFlag: string;
  diskUsedGB: number;
  sitesCount: number;
  camerasCount: number;
  camerasOnline: number;
  zonesCount: number;
  zonesFree: number;
  zonesOccupied: number;
  eventsLast24h: number;
  sites: SiteLocation[];
}

export interface SiteLocation {
  id: string;
  name: string;
  city: string;
  address: string;
  lat: number;
  lng: number;
  cameras: number;
  camerasOnline: number;
  camerasStale: number;
  camerasOffline: number;
  occupancyPercent: number;
  totalSpots: number;
  occupiedSpots: number;
}

export interface User {
  name: string;
  email: string;
  avatar: string;
}

interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  time: string;
  read: boolean;
}

interface AppContextType {
  user: User | null;
  isAuthenticated: boolean;
  authChecked: boolean;
  signIn: (username: string, password: string) => Promise<boolean>;
  signOut: () => void;
  projects: Project[];
  selectedProject: Project | null;
  selectProject: (project: Project) => void;
  createProject: (name: string) => Promise<Project>;
  updateProject: (id: string, patch: { name?: string; status?: Project['status'] }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  notifications: Notification[];
  markNotificationRead: (id: string) => void;
  unreadCount: number;
  reload: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildProjects(apiProjects: ApiProject[], cameras: ApiCamera[]): Project[] {
  return apiProjects.map(ap => {
    const sites: SiteLocation[] = ap.sites.map(site => {
      const siteCameras = cameras.filter(c => c.site_id === site.id);
      const online  = siteCameras.filter(c => c.status === 'ONLINE').length;
      const stale   = siteCameras.filter(c => c.status === 'STALE').length;
      const offline = siteCameras.filter(c => c.status !== 'ONLINE' && c.status !== 'STALE').length;
      return {
        id: String(site.id),
        name: site.name,
        city: site.city ?? "",
        address: site.location ?? site.name,
        lat: site.latitude ?? 3.1390,
        lng: site.longitude ?? 101.6869,
        cameras: siteCameras.length,
        camerasOnline: online,
        camerasStale: stale,
        camerasOffline: offline,
        occupancyPercent: 0,
        totalSpots: 0,
        occupiedSpots: 0,
      };
    });

    const projectCameras = cameras.filter(c => c.project_id === ap.id);
    const totalOnline = projectCameras.filter(c => c.status === 'ONLINE').length;

    return {
      id: String(ap.id),
      name: ap.name,
      status: 'ACTIVE' as const,
      region: 'Asia Pacific',
      regionFlag: '🌏',
      diskUsedGB: 0,
      sitesCount: ap.sites.length,
      camerasCount: projectCameras.length,
      camerasOnline: totalOnline,
      zonesCount: ap.zone_count,
      zonesFree: 0,
      zonesOccupied: 0,
      eventsLast24h: 0,
      sites,
    };
  });
}

const SELECTED_PROJECT_KEY = 'campark_selected_project_id';

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [{ projects: apiProjects }, { cameras }] = await Promise.all([
        getProjects(),
        getCameras(),
      ]);
      const built = buildProjects(apiProjects, cameras);
      setProjects(built);
      setSelectedProject(prev => {
        // 1. Keep current in-memory selection if it still exists (live data refresh)
        if (prev) {
          const refreshed = built.find(p => p.id === prev.id);
          if (refreshed) return refreshed;
        }
        // 2. Restore from localStorage — survives page refresh & navigation
        const savedId = localStorage.getItem(SELECTED_PROJECT_KEY);
        if (savedId) {
          const restored = built.find(p => p.id === savedId);
          if (restored) return restored;
        }
        // 3. Default to first project
        return built[0] ?? null;
      });
    } catch {
      // Silently fail — user may not be authenticated yet
    }
  }, []);

  // On mount: check if there's already an active Flask session
  useEffect(() => {
    checkAuth().then(authed => {
      setIsAuthenticated(authed);
      setAuthChecked(true);
      if (authed) {
        loadData();
      }
    });
  }, [loadData]);

  const signIn = useCallback(async (username: string, password: string): Promise<boolean> => {
    const ok = await apiLogin(username, password);
    if (ok) {
      setUser({ name: username, email: username, avatar: username.slice(0, 2).toUpperCase() });
      setIsAuthenticated(true);
      await loadData();
    }
    return ok;
  }, [loadData]);

  const signOut = useCallback(() => {
    apiLogout();
    localStorage.removeItem(SELECTED_PROJECT_KEY);
    setUser(null);
    setIsAuthenticated(false);
    setProjects([]);
    setSelectedProject(null);
  }, []);

  const selectProject = useCallback((project: Project) => {
    localStorage.setItem(SELECTED_PROJECT_KEY, project.id);
    setSelectedProject(project);
  }, []);

  const createProject = useCallback(async (name: string): Promise<Project> => {
    const result = await apiCreateProject(name);
    await loadData();
    const found = projects.find(p => p.id === String(result.project.id));
    const fallback: Project = {
      id: String(result.project.id), name: result.project.name, status: 'ACTIVE',
      region: 'Asia Pacific', regionFlag: '\uD83C\uDF0F', diskUsedGB: 0,
      sitesCount: 1, camerasCount: 0, camerasOnline: 0,
      zonesCount: 0, zonesFree: 0, zonesOccupied: 0, eventsLast24h: 0, sites: [],
    };
    return found ?? fallback;
  }, [loadData, projects]);

  const updateProject = useCallback(async (id: string, patch: { name?: string; status?: Project['status'] }) => {
    if (patch.name) {
      try { await apiUpdateProject(Number(id), { name: patch.name }); } catch (_) { /* best-effort */ }
    }
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
    setSelectedProject(prev => prev?.id === id ? { ...prev, ...patch } : prev);
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    try { await apiDeleteProject(Number(id)); } catch (_) { /* best-effort */ }
    if (localStorage.getItem(SELECTED_PROJECT_KEY) === id) {
      localStorage.removeItem(SELECTED_PROJECT_KEY);
    }
    setProjects(prev => prev.filter(p => p.id !== id));
    setSelectedProject(prev => (prev?.id === id ? null : prev));
  }, []);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <AppContext.Provider
      value={{
        user,
        isAuthenticated,
        authChecked,
        signIn,
        signOut,
        projects,
        selectedProject,
        selectProject,
        createProject,
        updateProject,
        deleteProject,
        notifications,
        markNotificationRead,
        unreadCount,
        reload: loadData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useOrganization() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
}
