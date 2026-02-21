"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
    Users,
    UserPlus,
    Shield,
    User,
    Mail,
    Trash2,
    Key,
    MoreVertical,
    CheckCircle2,
    XCircle,
    Loader2,
    Search
} from "lucide-react";
import Modal from "@/components/Modal";

interface UsuarioPerfil {
    id: string;
    email: string;
    nome: string | null;
    cargo: "ADMIN" | "USER";
    created_at: string;
}

export default function UsuariosPage() {
    const supabase = createClient();
    const [usuarios, setUsuarios] = useState<UsuarioPerfil[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    // Modals
    const [showAddModal, setShowAddModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UsuarioPerfil | null>(null);

    // Form states
    const [newUserName, setNewUserName] = useState("");
    const [newUserEmail, setNewUserEmail] = useState("");
    const [newUserPassword, setNewUserPassword] = useState("");
    const [newUserRole, setNewUserRole] = useState<"ADMIN" | "USER">("USER");

    const fetchUsuarios = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("usuarios_perfis")
                .select("*")
                .order("created_at", { ascending: false });

            if (error) throw error;
            setUsuarios(data || []);
        } catch (err) {
            console.error("Erro ao buscar usuários:", err);
            alert("Falha ao carregar lista de usuários.");
        } finally {
            setLoading(false);
        }
    }, [supabase]);

    useEffect(() => {
        fetchUsuarios();
    }, [fetchUsuarios]);

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            const res = await fetch("/api/admin/usuarios", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: newUserEmail,
                    password: newUserPassword,
                    nome: newUserName,
                    cargo: newUserRole
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Erro ao criar usuário");

            alert("Usuário criado com sucesso!");
            setShowAddModal(false);
            setNewUserEmail("");
            setNewUserPassword("");
            setNewUserName("");
            setNewUserRole("USER");
            fetchUsuarios();
        } catch (err: any) {
            alert(err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteUser = async () => {
        if (!selectedUser) return;
        setIsSaving(true);
        try {
            const res = await fetch(`/api/admin/usuarios?id=${selectedUser.id}`, {
                method: "DELETE"
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Erro ao excluir usuário");

            alert("Usuário excluído com sucesso!");
            setShowDeleteModal(false);
            setSelectedUser(null);
            fetchUsuarios();
        } catch (err: any) {
            alert(err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleSendReset = async (user: UsuarioPerfil) => {
        try {
            const res = await fetch("/api/admin/usuarios", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    type: "recovery",
                    email: user.email
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Erro ao enviar e-mail");

            alert("E-mail de recuperação enviado!");
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleToggleRole = async (user: UsuarioPerfil) => {
        const newRole = user.cargo === "ADMIN" ? "USER" : "ADMIN";
        if (!confirm(`Deseja alterar o cargo de ${user.email} para ${newRole}?`)) return;

        try {
            const res = await fetch("/api/admin/usuarios", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: user.id,
                    type: "update_role",
                    cargo: newRole
                })
            });

            if (!res.ok) throw new Error("Erro ao atualizar cargo");
            fetchUsuarios();
        } catch (err: any) {
            alert(err.message);
        }
    };

    const filteredUsers = usuarios.filter(u =>
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        (u.nome || "").toLowerCase().includes(search.toLowerCase())
    );

    return (
        <main className="p-8 max-w-7xl mx-auto space-y-8">
            {/* Header */}
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-white flex items-center gap-3">
                        <Users className="text-indigo-500" size={32} />
                        Gestão de Usuários
                    </h1>
                    <p className="text-[var(--fg-dim)] text-sm">Controle de acessos e permissões do sistema.</p>
                </div>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="btn-primary w-full md:w-auto"
                >
                    <UserPlus size={18} />
                    Novo Usuário
                </button>
            </header>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="card p-6 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                        <Users size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-[var(--fg-dim)] uppercase tracking-wider font-bold">Total</p>
                        <p className="text-2xl font-black text-white">{usuarios.length}</p>
                    </div>
                </div>
                <div className="card p-6 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                        <Shield size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-[var(--fg-dim)] uppercase tracking-wider font-bold">Admins</p>
                        <p className="text-2xl font-black text-white">{usuarios.filter(u => u.cargo === "ADMIN").length}</p>
                    </div>
                </div>
                <div className="card p-6 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                        <CheckCircle2 size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-[var(--fg-dim)] uppercase tracking-wider font-bold">Ativos</p>
                        <p className="text-2xl font-black text-white">{usuarios.length}</p>
                    </div>
                </div>
            </div>

            {/* Filters & Table */}
            <div className="card overflow-hidden">
                <div className="p-4 border-b border-[var(--border)] flex items-center gap-3">
                    <Search className="text-[var(--fg-dim)]" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por nome ou e-mail..."
                        className="bg-transparent border-none outline-none text-sm text-white flex-1"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                {loading ? (
                    <div className="p-20 flex flex-col items-center justify-center gap-4">
                        <Loader2 className="animate-spin text-indigo-500" size={40} />
                        <p className="text-[var(--fg-dim)] text-sm">Carregando usuários...</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-white/5">
                                    <th className="p-4 text-xs font-bold text-[var(--fg-dim)] uppercase tracking-wider">Usuário</th>
                                    <th className="p-4 text-xs font-bold text-[var(--fg-dim)] uppercase tracking-wider">Cargo</th>
                                    <th className="p-4 text-xs font-bold text-[var(--fg-dim)] uppercase tracking-wider text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredUsers.map((user) => (
                                    <tr key={user.id} className="border-t border-[var(--border)] hover:bg-white/[0.02] transition-colors">
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-indigo-500">
                                                    <User size={20} />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-bold text-white">{user.nome || "Sem nome"}</span>
                                                    <span className="text-[10px] text-[var(--fg-dim)]">{user.email}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest ${user.cargo === "ADMIN" ? "bg-amber-500/10 text-amber-500" : "bg-indigo-500/10 text-indigo-500"
                                                }`}>
                                                {user.cargo}
                                            </span>
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    title="Alterar cargo"
                                                    onClick={() => handleToggleRole(user)}
                                                    className="p-2 hover:bg-white/5 rounded-lg text-[var(--fg-dim)] hover:text-white transition-all"
                                                >
                                                    <Shield size={16} />
                                                </button>
                                                <button
                                                    title="Enviar e-mail de recuperação"
                                                    onClick={() => handleSendReset(user)}
                                                    className="p-2 hover:bg-white/5 rounded-lg text-[var(--fg-dim)] hover:text-white transition-all"
                                                >
                                                    <Key size={16} />
                                                </button>
                                                <button
                                                    title="Excluir usuário"
                                                    onClick={() => {
                                                        setSelectedUser(user);
                                                        setShowDeleteModal(true);
                                                    }}
                                                    className="p-2 hover:bg-red-500/10 rounded-lg text-red-500 transition-all"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal: Novo Usuário */}
            {showAddModal && (
                <Modal
                    isOpen={true}
                    title="Adicionar Novo Usuário"
                    onClose={() => setShowAddModal(false)}
                >
                    <form onSubmit={handleCreateUser} className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-[var(--fg-dim)] uppercase">Nome Completo</label>
                            <input
                                type="text"
                                required
                                value={newUserName}
                                onChange={(e) => setNewUserName(e.target.value)}
                                className="w-full bg-white/5 border border-[var(--border)] p-3 rounded-xl text-sm text-white"
                                placeholder="Ex: João Silva"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-[var(--fg-dim)] uppercase">E-mail</label>
                            <input
                                type="email"
                                required
                                value={newUserEmail}
                                onChange={(e) => setNewUserEmail(e.target.value)}
                                className="w-full bg-white/5 border border-[var(--border)] p-3 rounded-xl text-sm text-white"
                                placeholder="usuario@iwof.com.br"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-[var(--fg-dim)] uppercase">Senha Inicial</label>
                            <input
                                type="password"
                                required
                                value={newUserPassword}
                                onChange={(e) => setNewUserPassword(e.target.value)}
                                className="w-full bg-white/5 border border-[var(--border)] p-3 rounded-xl text-sm text-white"
                                placeholder="********"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-[var(--fg-dim)] uppercase">Cargo</label>
                            <select
                                value={newUserRole}
                                onChange={(e) => setNewUserRole(e.target.value as any)}
                                className="w-full bg-white/5 border border-[var(--border)] p-3 rounded-xl text-sm text-white"
                            >
                                <option value="USER">Usuário Comum (USER)</option>
                                <option value="ADMIN">Administrador (ADMIN)</option>
                            </select>
                        </div>

                        <div className="pt-4 flex gap-3">
                            <button
                                type="button"
                                onClick={() => setShowAddModal(false)}
                                className="flex-1 px-4 py-3 rounded-xl bg-white/5 text-[var(--fg-dim)] font-bold text-sm"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={isSaving}
                                className="flex-1 btn-primary"
                            >
                                {isSaving ? <Loader2 className="animate-spin" size={18} /> : "Criar Usuário"}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {/* Modal: Excluir Usuário */}
            {showDeleteModal && selectedUser && (
                <Modal
                    isOpen={true}
                    title="Excluir Usuário"
                    onClose={() => setShowDeleteModal(false)}
                >
                    <div className="space-y-6 text-center">
                        <div className="w-16 h-16 rounded-full bg-red-500/10 text-red-500 mx-auto flex items-center justify-center">
                            <Trash2 size={32} />
                        </div>
                        <div>
                            <h3 className="text-white font-bold">Tem certeza disso?</h3>
                            <p className="text-sm text-[var(--fg-dim)] mt-2">
                                Você está prestes a excluir o usuário <strong>{selectedUser.email}</strong>.
                                Esta ação não pode ser desfeita.
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowDeleteModal(false)}
                                className="flex-1 px-4 py-3 rounded-xl bg-white/5 text-[var(--fg-dim)] font-bold text-sm"
                            >
                                Manter Usuário
                            </button>
                            <button
                                onClick={handleDeleteUser}
                                disabled={isSaving}
                                className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl py-3 transition-all"
                            >
                                {isSaving ? <Loader2 className="animate-spin" size={18} /> : "Sim, Excluir"}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </main>
    );
}
