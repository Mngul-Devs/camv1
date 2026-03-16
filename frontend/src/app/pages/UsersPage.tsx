import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, Shield, Eye, UserCog, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
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
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  type ApiUser,
} from "../../lib/api";

type UserRole = "admin" | "supervisor" | "viewer";

const ROLE_ICONS: Record<UserRole, typeof Shield> = {
  admin: Shield,
  supervisor: UserCog,
  viewer: Eye,
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin: "text-red-400 border-red-500/30",
  supervisor: "text-amber-400 border-amber-500/30",
  viewer: "text-blue-400 border-blue-500/30",
};

export function UsersPage() {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ApiUser | null>(null);

  // Form state
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState<UserRole>("viewer");
  const [formStatus, setFormStatus] = useState<"active" | "disabled">("active");
  const [submitting, setSubmitting] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const data = await getUsers();
      setUsers(data.users);
    } catch {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const resetForm = () => {
    setFormUsername("");
    setFormPassword("");
    setFormRole("viewer");
    setFormStatus("active");
  };

  const handleCreate = async () => {
    if (!formUsername.trim() || !formPassword.trim()) {
      toast.error("Username and password are required");
      return;
    }
    setSubmitting(true);
    try {
      await createUser({ username: formUsername, password: formPassword, role: formRole });
      toast.success(`User "${formUsername}" created`);
      resetForm();
      setShowCreateDialog(false);
      loadUsers();
    } catch (e: unknown) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingUser) return;
    setSubmitting(true);
    try {
      await updateUser(editingUser.id, {
        role: formRole,
        status: formStatus,
        password: formPassword.trim() || undefined,
      });
      toast.success(`User "${editingUser.username}" updated`);
      resetForm();
      setEditingUser(null);
      loadUsers();
    } catch (e: unknown) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setSubmitting(true);
    try {
      await deleteUser(deleteConfirm.id);
      toast.success(`User "${deleteConfirm.username}" deleted`);
      setDeleteConfirm(null);
      loadUsers();
    } catch (e: unknown) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const openEditDialog = (user: ApiUser) => {
    setFormRole(user.role);
    setFormStatus(user.status);
    setFormPassword("");
    setEditingUser(user);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl text-[#e6edf3] mb-1">User Management</h1>
          <p className="text-sm text-[#9da7b3]">Manage users and their access roles.</p>
        </div>
        <Button
          onClick={() => { resetForm(); setShowCreateDialog(true); }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
        >
          <Plus className="w-4 h-4" />
          Add User
        </Button>
      </div>

      {/* Users Table */}
      <div className="bg-[#1c2128] border border-[#2a2f36] rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-[#2a2f36] hover:bg-transparent">
              <TableHead className="text-[#9da7b3] text-xs uppercase tracking-wider">Username</TableHead>
              <TableHead className="text-[#9da7b3] text-xs uppercase tracking-wider">Role</TableHead>
              <TableHead className="text-[#9da7b3] text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-[#9da7b3] text-xs uppercase tracking-wider">Last Login</TableHead>
              <TableHead className="text-[#9da7b3] text-xs uppercase tracking-wider">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-[#9da7b3]">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-[#9da7b3]">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => {
                const RoleIcon = ROLE_ICONS[user.role] ?? Eye;
                return (
                  <TableRow key={user.id} className="border-[#2a2f36] hover:bg-[#161a1f]">
                    <TableCell className="py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#2a2f36] flex items-center justify-center text-xs text-[#e6edf3] uppercase">
                          {user.username.slice(0, 2)}
                        </div>
                        <span className="text-[#e6edf3] text-sm">{user.username}</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <Badge variant="outline" className={`text-xs gap-1.5 ${ROLE_COLORS[user.role] ?? "text-gray-400 border-gray-500/30"}`}>
                        <RoleIcon className="w-3 h-3" />
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3">
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          user.status === "active"
                            ? "text-[#3fb950] border-[#3fb950]/30"
                            : "text-[#9da7b3] border-[#9da7b3]/30"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                          user.status === "active" ? "bg-[#3fb950]" : "bg-[#9da7b3]"
                        }`} />
                        {user.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 text-[#9da7b3] text-sm">
                      {user.last_login_at ? new Date(user.last_login_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never"}
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-[#9da7b3] hover:text-[#e6edf3]"
                          onClick={() => openEditDialog(user)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                          onClick={() => setDeleteConfirm(user)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-sm text-[#9da7b3]">{users.length} user{users.length !== 1 ? "s" : ""}</div>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-[#161a1f] border-[#2a2f36] text-white">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-[#9da7b3]">Username</Label>
              <Input
                placeholder="e.g. john"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                className="bg-[#0f1115] border-[#2a2f36] text-white placeholder:text-gray-600"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[#9da7b3]">Password</Label>
              <Input
                type="password"
                placeholder="Enter password"
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                className="bg-[#0f1115] border-[#2a2f36] text-white placeholder:text-gray-600"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[#9da7b3]">Role</Label>
              <Select value={formRole} onValueChange={(v) => setFormRole(v as UserRole)}>
                <SelectTrigger className="bg-[#0f1115] border-[#2a2f36] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#161a1f] border-[#2a2f36]">
                  <SelectItem value="admin" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">Admin</SelectItem>
                  <SelectItem value="supervisor" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">Supervisor</SelectItem>
                  <SelectItem value="viewer" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCreateDialog(false)} className="text-gray-400">Cancel</Button>
            <Button onClick={handleCreate} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
        <DialogContent className="bg-[#161a1f] border-[#2a2f36] text-white">
          <DialogHeader>
            <DialogTitle>Edit User — {editingUser?.username}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-[#9da7b3]">Role</Label>
              <Select value={formRole} onValueChange={(v) => setFormRole(v as UserRole)}>
                <SelectTrigger className="bg-[#0f1115] border-[#2a2f36] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#161a1f] border-[#2a2f36]">
                  <SelectItem value="admin" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">Admin</SelectItem>
                  <SelectItem value="supervisor" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">Supervisor</SelectItem>
                  <SelectItem value="viewer" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[#9da7b3]">Status</Label>
              <Select value={formStatus} onValueChange={(v) => setFormStatus(v as "active" | "disabled")}>
                <SelectTrigger className="bg-[#0f1115] border-[#2a2f36] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#161a1f] border-[#2a2f36]">
                  <SelectItem value="active" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">Active</SelectItem>
                  <SelectItem value="disabled" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[#9da7b3]">New Password <span className="text-xs">(leave blank to keep current)</span></Label>
              <Input
                type="password"
                placeholder="New password"
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                className="bg-[#0f1115] border-[#2a2f36] text-white placeholder:text-gray-600"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingUser(null)} className="text-gray-400">Cancel</Button>
            <Button onClick={handleUpdate} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="bg-[#161a1f] border-[#2a2f36] text-white">
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#9da7b3] py-2">
            Are you sure you want to delete <span className="text-white">"{deleteConfirm?.username}"</span>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)} className="text-gray-400">Cancel</Button>
            <Button onClick={handleDelete} disabled={submitting} className="bg-red-600 hover:bg-red-700 text-white">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
