import { useState, useRef, useEffect } from "react";
import {
  Search, ChevronDown, Activity, Bell, LogOut, User, Settings,
  ChevronRight, Layers, X, FolderOpen, Command, Check, Plus
} from "lucide-react";
import { useNavigate, useLocation } from "react-router";
import { useOrganization } from "../../contexts/OrganizationContext";
import { Badge } from "../ui/badge";
import { toast } from "sonner";

export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user, signOut, selectedProject, projects, selectProject,
    notifications, markNotificationRead, unreadCount, createProject
  } = useOrganization();

  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  const projectMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const projectSearchRef = useRef<HTMLInputElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setShowProjectMenu(false);
        setProjectSearch('');
        setShowNewProject(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifications(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Focus project search when menu opens
  useEffect(() => {
    if (showProjectMenu) {
      setTimeout(() => projectSearchRef.current?.focus(), 100);
    }
  }, [showProjectMenu]);

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchRef.current?.focus(), 100);
      }
      if (e.key === 'Escape') {
        setShowSearch(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSignOut = () => {
    signOut();
    toast.success('Signed out successfully');
    navigate('/');
  };

  const handleSwitchProject = (project: typeof projects[0]) => {
    selectProject(project);
    setShowProjectMenu(false);
    setProjectSearch('');
    toast.success(`Switched to ${project.name}`);
    navigate(`/app/project/${project.id}/dashboard`);
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      const newProj = await createProject(newProjectName.trim());
      selectProject(newProj);
      setNewProjectName('');
      setShowNewProject(false);
      setShowProjectMenu(false);
      toast.success(`Created project "${newProj.name}"`);
      navigate(`/app/project/${newProj.id}/dashboard`);
    } catch {
      toast.error('Failed to create project');
    }
  };

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(projectSearch.toLowerCase())
  );

  const statusColors: Record<string, string> = {
    PRODUCTION: 'bg-emerald-500 text-emerald-100 border-emerald-500/30',
    PAUSED: 'bg-gray-500 text-gray-200 border-gray-500/30',
    DEVELOPMENT: 'bg-amber-500 text-amber-100 border-amber-500/30',
  };

  // Get breadcrumb segments — strip /app/project/:id/ prefix
  const getBreadcrumb = () => {
    const match = location.pathname.match(/\/app\/project\/[^/]+\/(.+)/);
    if (match) {
      return match[1].split('/').map(s => s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')).join(' / ');
    }
    return 'Dashboard';
  };

  return (
    <>
      <div className="h-12 border-b border-[#1e2228] bg-[#0c0e12] flex items-center px-3 gap-2 shrink-0">
        {/* Logo */}
        <button
          onClick={() => navigate('/app')}
          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[#1e2228] transition-colors mr-1"
        >
          <div className="w-6 h-6 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded flex items-center justify-center">
            <Layers className="w-3.5 h-3.5 text-white" />
          </div>
        </button>

        {/* Project switcher breadcrumb */}
        <div className="flex items-center gap-1 text-sm">
          {selectedProject && (
            <div ref={projectMenuRef} className="relative">
              <button
                onClick={() => setShowProjectMenu(!showProjectMenu)}
                className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-[#1e2228] transition-colors text-white"
              >
                <span>{selectedProject.name}</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>

              {showProjectMenu && (
                <div className="absolute top-full left-0 mt-1 w-80 bg-[#161a1f] border border-[#2a2f36] rounded-lg shadow-2xl z-50 overflow-hidden">
                  {/* Search */}
                  <div className="p-2 border-b border-[#2a2f36]">
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-[#111318] rounded-md border border-[#2a2f36]">
                      <Search className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                      <input
                        ref={projectSearchRef}
                        type="text"
                        placeholder="Find project..."
                        value={projectSearch}
                        onChange={(e) => setProjectSearch(e.target.value)}
                        className="flex-1 bg-transparent border-none outline-none text-white text-sm placeholder:text-gray-500"
                      />
                    </div>
                  </div>

                  {/* Projects list */}
                  <div className="p-1 max-h-64 overflow-auto">
                    {filteredProjects.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => handleSwitchProject(project)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors ${
                          project.id === selectedProject.id
                            ? 'bg-[#1e2228]'
                            : 'hover:bg-[#1e2228]'
                        }`}
                      >
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="text-sm text-white truncate">{project.name}</span>
                          {project.status !== 'PRODUCTION' && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${statusColors[project.status]} bg-opacity-20`}>
                              {project.status}
                            </span>
                          )}
                        </div>
                        {project.id === selectedProject.id && (
                          <Check className="w-4 h-4 text-white shrink-0" />
                        )}
                      </button>
                    ))}
                    {filteredProjects.length === 0 && (
                      <div className="px-3 py-4 text-center text-sm text-gray-500">
                        No projects found
                      </div>
                    )}
                  </div>

                  {/* New project */}
                  <div className="p-1 border-t border-[#2a2f36]">
                    {showNewProject ? (
                      <div className="px-2 py-2 space-y-2">
                        <input
                          type="text"
                          placeholder="Project name"
                          value={newProjectName}
                          onChange={(e) => setNewProjectName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                          className="w-full px-3 py-2 bg-[#111318] border border-[#2a2f36] rounded-md text-white text-sm placeholder:text-gray-500 outline-none focus:border-emerald-500/50"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleCreateProject}
                            className="flex-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-md transition-colors"
                          >
                            Create
                          </button>
                          <button
                            onClick={() => { setShowNewProject(false); setNewProjectName(''); }}
                            className="px-3 py-1.5 text-gray-400 hover:text-white text-xs transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowNewProject(true)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-md text-sm text-gray-400 hover:bg-[#1e2228] hover:text-white transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        New project
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <span className="text-gray-600">/</span>

          {/* Branch / environment indicator */}
          {selectedProject && (
            <>
              <div className="flex items-center gap-1.5 px-2 py-1 text-gray-400">
                <span>main</span>
              </div>
              <ChevronRight className="w-3 h-3 text-gray-600" />
            </>
          )}

          <span className="px-2 py-1 text-white">{getBreadcrumb()}</span>
        </div>

        <div className="flex-1" />

        {/* Search trigger */}
        <button
          onClick={() => { setShowSearch(true); setTimeout(() => searchRef.current?.focus(), 100); }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-[#2a2f36] bg-[#111318] hover:bg-[#1e2228] transition-colors text-gray-500 text-sm mr-1"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Search...</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#1e2228] rounded text-[10px] text-gray-500 border border-[#2a2f36]">
            <Command className="w-2.5 h-2.5" />K
          </kbd>
        </button>

        {/* System Status */}
        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-gray-400">Operational</span>
        </div>

        {/* Notifications */}
        <div ref={notifRef} className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 rounded-md hover:bg-[#1e2228] transition-colors text-gray-400 hover:text-white"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute top-full right-0 mt-1 w-80 bg-[#161a1f] border border-[#2a2f36] rounded-lg shadow-2xl z-50 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2f36]">
                <span className="text-sm text-white">Notifications</span>
                {unreadCount > 0 && (
                  <Badge variant="secondary" className="text-[10px] bg-red-500/10 text-red-400 border-red-500/20">
                    {unreadCount} new
                  </Badge>
                )}
              </div>
              <div className="max-h-80 overflow-auto">
                {notifications.map((notif) => {
                  const colors = {
                    info: 'bg-blue-400', warning: 'bg-yellow-400',
                    error: 'bg-red-400', success: 'bg-emerald-400',
                  };
                  return (
                    <button
                      key={notif.id}
                      onClick={() => markNotificationRead(notif.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-[#1e2228] transition-colors border-b border-[#2a2f36]/50 last:border-0 ${
                        !notif.read ? 'bg-[#1e2228]/50' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${colors[notif.type]}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm text-white truncate">{notif.title}</span>
                            <span className="text-[10px] text-gray-500 shrink-0">{notif.time}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 truncate">{notif.message}</p>
                        </div>
                        {!notif.read && (
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 shrink-0" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* User Menu */}
        <div ref={userMenuRef} className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 p-1 rounded-md hover:bg-[#1e2228] transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <span className="text-white text-xs">{user?.avatar || 'U'}</span>
            </div>
          </button>

          {showUserMenu && (
            <div className="absolute top-full right-0 mt-1 w-56 bg-[#161a1f] border border-[#2a2f36] rounded-lg shadow-2xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-[#2a2f36]">
                <p className="text-sm text-white">{user?.name}</p>
                <p className="text-xs text-gray-500">{user?.email}</p>
              </div>
              <div className="p-1">
                <button
                  onClick={() => { navigate('/app/settings'); setShowUserMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-gray-300 hover:bg-[#1e2228] hover:text-white transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Settings
                </button>

              </div>
              <div className="p-1 border-t border-[#2a2f36]">
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search overlay */}
      {showSearch && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-start justify-center pt-[20vh]"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowSearch(false); setSearchQuery(''); } }}
        >
          <div className="w-full max-w-lg bg-[#161a1f] border border-[#2a2f36] rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2a2f36]">
              <Search className="w-4 h-4 text-gray-500 shrink-0" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search devices, logs, sites, metrics..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-white text-sm placeholder:text-gray-500"
              />
              <button
                onClick={() => { setShowSearch(false); setSearchQuery(''); }}
                className="text-gray-500 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 max-h-64">
              {!searchQuery ? (
                <div className="px-3 py-6 text-center text-sm text-gray-500">
                  Start typing to search across your workspace
                </div>
              ) : (
                <div className="space-y-1">
                  {[
                    { icon: FolderOpen, label: `Search "${searchQuery}" in Projects`, path: '/app' },
                    { icon: Activity, label: `Search "${searchQuery}" in Devices`, path: selectedProject ? `/app/project/${selectedProject.id}/devices` : '/app' },
                    { icon: Search, label: `Search "${searchQuery}" in Logs`, path: selectedProject ? `/app/project/${selectedProject.id}/logs` : '/app' },
                  ].map((item) => (
                    <button
                      key={item.path}
                      onClick={() => { navigate(item.path); setShowSearch(false); setSearchQuery(''); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-gray-300 hover:bg-[#1e2228] hover:text-white transition-colors"
                    >
                      <item.icon className="w-4 h-4 text-gray-500" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="px-4 py-2 border-t border-[#2a2f36] flex items-center gap-4 text-[10px] text-gray-600">
              <span>ESC to close</span>
              <span>Enter to select</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
