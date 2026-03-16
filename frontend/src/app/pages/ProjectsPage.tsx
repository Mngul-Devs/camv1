import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { Plus, Search, MoreVertical, Camera, Grid3X3, Trash2, Pencil, Layers, LogOut } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { toast } from "sonner";
import { useOrganization, type Project } from "../contexts/OrganizationContext";

type Status = Project['status'];

const STATUS_CONFIG: Record<Status, { label: string; dot: string; badge: string }> = {
  ACTIVE:  { label: "Active",   dot: "bg-[#3fb950]", badge: "text-[#3fb950] border-[#3fb950]/30 bg-[#3fb950]/8" },
  ON_HOLD: { label: "On Hold",  dot: "bg-[#d29922]", badge: "text-[#d29922] border-[#d29922]/30 bg-[#d29922]/8" },
  CLOSED:  { label: "Closed",   dot: "bg-[#6e7681]", badge: "text-[#6e7681] border-[#6e7681]/30 bg-[#6e7681]/8" },
};

export function ProjectsPage() {
  const navigate = useNavigate();
  const { projects, selectedProject, selectProject, createProject, updateProject, deleteProject, user, signOut } = useOrganization();

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<Status | "ALL">("ALL");

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  // Edit dialog
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState<Status>("ACTIVE");

  // Delete dialog
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() =>
    projects.filter(p => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase());
      const matchStatus = filterStatus === "ALL" || p.status === filterStatus;
      return matchSearch && matchStatus;
    }),
  [projects, search, filterStatus]);

  const handleCreate = async () => {
    if (!newName.trim()) { toast.error("Enter a project name"); return; }
    try {
      const p = await createProject(newName.trim());
      selectProject(p);
      setNewName("");
      setShowCreate(false);
      navigate(`/app/project/${p.id}/dashboard`);
    } catch (e: unknown) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleEdit = async () => {
    if (!editProject) return;
    try {
      await updateProject(editProject.id, { name: editName.trim() || editProject.name, status: editStatus });
      toast.success("Project updated");
    } catch (e: unknown) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setEditProject(null);
  };

  const openEdit = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditProject(p);
    setEditName(p.name);
    setEditStatus(p.status);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const p = projects.find(x => x.id === deleteId);
    try {
      await deleteProject(deleteId);
      toast.success(`"${p?.name}" deleted`);
    } catch (e: unknown) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setDeleteId(null);
  };

  const handleSignOut = () => { signOut(); navigate('/'); };

  const handleSelect = (p: Project) => {
    selectProject(p);
    navigate(`/app/project/${p.id}/dashboard`);
  };

  return (
    <div className="min-h-screen bg-[#0c0e12] text-[#e6edf3]">
      {/* Standalone top bar — logo + user */}
      <div className="border-b border-[#1e2228] px-6 h-12 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded flex items-center justify-center">
            <Layers className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-[#e6edf3] font-semibold text-sm">CamPark</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#6e7681]">{user?.name}</span>
          <div className="w-7 h-7 rounded-full bg-[#1e2228] border border-[#30363d] flex items-center justify-center text-[#e6edf3] text-xs font-medium">
            {user?.avatar ?? '?'}
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-[#6e7681] hover:text-[#e6edf3] hover:bg-[#1e2228] transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </div>

      {/* Page header */}
      <div className="border-b border-[#1e2228] px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#e6edf3]">All Projects</h1>
          <p className="text-sm text-[#6e7681] mt-0.5">{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
        >
          <Plus className="w-4 h-4" /> New project
        </Button>
      </div>

      <div className="px-8 py-5">
        {/* Filters row */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e7681]" />
            <Input
              placeholder="Search for a project"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-[#161b22] border-[#30363d] text-[#e6edf3] placeholder:text-[#6e7681] h-9"
            />
          </div>
          <Select value={filterStatus} onValueChange={v => setFilterStatus(v as typeof filterStatus)}>
            <SelectTrigger className="w-36 bg-[#161b22] border-[#30363d] text-[#e6edf3] h-9">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-[#161a1f] border-[#30363d]">
              <SelectItem value="ALL" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">All statuses</SelectItem>
              {(Object.keys(STATUS_CONFIG) as Status[]).map(s => (
                <SelectItem key={s} value={s} className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">
                  {STATUS_CONFIG[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Project grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-12 h-12 rounded-full bg-[#161b22] border border-[#30363d] flex items-center justify-center mx-auto mb-4">
              <Grid3X3 className="w-5 h-5 text-[#6e7681]" />
            </div>
            <p className="text-[#8b949e] mb-1">{search || filterStatus !== "ALL" ? "No projects match your filters" : "No projects yet"}</p>
            {!search && filterStatus === "ALL" && (
              <Button onClick={() => setShowCreate(true)} variant="ghost" className="mt-3 gap-2 text-emerald-400 hover:text-emerald-300">
                <Plus className="w-4 h-4" /> Create your first project
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(p => {
              const cfg = STATUS_CONFIG[p.status];
              const isSelected = selectedProject?.id === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => handleSelect(p)}
                  className={`group relative bg-[#161b22] border rounded-lg p-5 cursor-pointer transition-all hover:border-[#484f58] ${
                    isSelected
                      ? "border-emerald-500/50 ring-1 ring-emerald-500/10"
                      : "border-[#30363d]"
                  }`}
                >
                  {/* ⋯ menu */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={e => e.stopPropagation()}
                        className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded text-[#6e7681] hover:text-[#e6edf3] hover:bg-[#2a2f36] opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-[#161a1f] border-[#30363d] z-50">
                      <DropdownMenuItem
                        onClick={e => openEdit(p, e)}
                        className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3] gap-2 text-sm"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit project
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-[#30363d]" />
                      <DropdownMenuItem
                        onClick={e => { e.stopPropagation(); setDeleteId(p.id); }}
                        className="text-[#f85149] focus:bg-[#2a2f36] focus:text-[#f85149] gap-2 text-sm"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Card content */}
                  <div className="mb-4">
                    <h3 className="text-[#e6edf3] font-medium text-base mb-2 pr-6 truncate">{p.name}</h3>
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border ${cfg.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                      {cfg.label}
                    </span>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 text-xs text-[#6e7681]">
                    <div className="flex items-center gap-1.5">
                      <Camera className="w-3.5 h-3.5" />
                      <span>{p.camerasCount} camera{p.camerasCount !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Grid3X3 className="w-3.5 h-3.5" />
                      <span>{p.zonesCount} zone{p.zonesCount !== 1 ? "s" : ""}</span>
                    </div>
                  </div>

                  {p.status === "CLOSED" && (
                    <div className="mt-3 pt-3 border-t border-[#30363d] flex items-center gap-1.5 text-xs text-[#6e7681]">
                      <span className="w-3.5 h-3.5 inline-flex items-center">⊙</span>
                      Project is closed
                    </div>
                  )}
                  {p.status === "ON_HOLD" && (
                    <div className="mt-3 pt-3 border-t border-[#30363d] flex items-center gap-1.5 text-xs text-[#6e7681]">
                      <span className="w-3.5 h-3.5 inline-flex items-center">⊙</span>
                      Project is on hold
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={v => { setShowCreate(v); if (!v) setNewName(""); }}>
        <DialogContent className="bg-[#161a1f] border-[#30363d] text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[#e6edf3]">New project</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label className="text-xs text-[#9da7b3] mb-2 block">Project name</Label>
            <Input
              placeholder="e.g. Westfield Parking"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreate()}
              className="bg-[#0f1115] border-[#30363d] text-white placeholder:text-[#6e7681]"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowCreate(false); setNewName(""); }} className="text-[#9da7b3]">Cancel</Button>
            <Button onClick={handleCreate} className="bg-emerald-600 hover:bg-emerald-700 text-white">Create project</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editProject} onOpenChange={v => !v && setEditProject(null)}>
        <DialogContent className="bg-[#161a1f] border-[#30363d] text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[#e6edf3]">Edit project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label className="text-xs text-[#9da7b3] mb-2 block">Project name</Label>
              <Input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="bg-[#0f1115] border-[#30363d] text-white"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs text-[#9da7b3] mb-2 block">Status</Label>
              <Select value={editStatus} onValueChange={v => setEditStatus(v as Status)}>
                <SelectTrigger className="bg-[#0f1115] border-[#30363d] text-[#e6edf3] w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#161a1f] border-[#30363d]">
                  {(Object.keys(STATUS_CONFIG) as Status[]).map(s => (
                    <SelectItem key={s} value={s} className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${STATUS_CONFIG[s].dot}`} />
                        {STATUS_CONFIG[s].label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditProject(null)} className="text-[#9da7b3]">Cancel</Button>
            <Button onClick={handleEdit} className="bg-emerald-600 hover:bg-emerald-700 text-white">Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={!!deleteId} onOpenChange={v => !v && setDeleteId(null)}>
        <DialogContent className="bg-[#161a1f] border-[#30363d] text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[#e6edf3]">Delete project</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#9da7b3] py-2">
            This will permanently delete <strong className="text-[#e6edf3]">{projects.find(p => p.id === deleteId)?.name}</strong>. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteId(null)} className="text-[#9da7b3]">Cancel</Button>
            <Button onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
