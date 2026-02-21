"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
    User,
    Mail,
    Lock,
    Save,
    Loader2,
    ShieldCheck,
    AlertCircle
} from "lucide-react";

export default function PerfilPage() {
    const supabase = createClient();
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const [user, setUser] = useState<any>(null);
    const [perfil, setPerfil] = useState<any>(null);

    // Form states
    const [nome, setNome] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    useEffect(() => {
        async function loadProfile() {
            setLoading(true);
            try {
                const { data: { user: authUser } } = await supabase.auth.getUser();
                if (authUser) {
                    setUser(authUser);
                    setEmail(authUser.email || "");

                    const { data: profileData } = await supabase
                        .from("usuarios_perfis")
                        .select("*")
                        .eq("id", authUser.id)
                        .single();

                    if (profileData) {
                        setPerfil(profileData);
                        setNome(profileData.nome || "");
                    }
                }
            } catch (err) {
                console.error("Erro ao carregar perfil:", err);
            } finally {
                setLoading(false);
            }
        }
        loadProfile();
    }, [supabase]);

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            // 1. Atualizar nome na tabela de perfis
            const { error: perfilError } = await supabase
                .from("usuarios_perfis")
                .update({ nome })
                .eq("id", user.id);

            if (perfilError) throw perfilError;

            // 2. Atualizar metadata do auth
            const { error: authError } = await supabase.auth.updateUser({
                data: { nome }
            });

            if (authError) throw authError;

            alert("Perfil atualizado com sucesso!");
        } catch (err: any) {
            alert("Erro ao atualizar perfil: " + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleUpdateEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        if (email === user.email) return;

        setIsSaving(true);
        try {
            const { error } = await supabase.auth.updateUser({ email });
            if (error) throw error;
            alert("Um e-mail de confirmação foi enviado para o novo endereço. Você precisa confirmar a alteração em ambos os e-mails.");
        } catch (err: any) {
            alert("Erro ao atualizar e-mail: " + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleUpdatePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password) return;
        if (password !== confirmPassword) {
            alert("As senhas não coincidem!");
            return;
        }

        setIsSaving(true);
        try {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            alert("Senha atualizada com sucesso!");
            setPassword("");
            setConfirmPassword("");
        } catch (err: any) {
            alert("Erro ao atualizar senha: " + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="p-20 flex flex-col items-center justify-center gap-4">
                <Loader2 className="animate-spin text-indigo-500" size={40} />
                <p className="text-[var(--fg-dim)]">Carregando perfil...</p>
            </div>
        );
    }

    return (
        <main className="p-8 max-w-4xl mx-auto space-y-8 pb-20">
            <header>
                <h1 className="text-3xl font-black text-white flex items-center gap-3">
                    <User className="text-indigo-500" size={32} />
                    Meu Perfil
                </h1>
                <p className="text-[var(--fg-dim)] text-sm">Gerencie suas informações pessoais e segurança.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Lado Esquerdo: Info Resumo */}
                <div className="space-y-6">
                    <div className="card p-6 flex flex-col items-center text-center space-y-4">
                        <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center text-white border-4 border-indigo-500/30">
                            <User className="icon-high-contrast" size={48} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">{nome || "Usuário"}</h2>
                            <p className="text-xs text-[var(--fg-dim)]">{email}</p>
                        </div>
                        <div className="pt-2">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black tracking-widest border ${perfil?.cargo === "ADMIN" ? "bg-amber-500/10 text-amber-500 border-amber-500/30" : "bg-indigo-500/10 text-indigo-500 border-indigo-500/30"
                                }`}>
                                <ShieldCheck size={12} className="inline mr-1" />
                                {perfil?.cargo || "USER"}
                            </span>
                        </div>
                    </div>

                    <div className="card p-4 bg-indigo-500/5 border-indigo-500/10 flex gap-3">
                        <AlertCircle className="text-indigo-500 shrink-0" size={20} />
                        <p className="text-[10px] text-indigo-200/60 leading-relaxed">
                            Suas permissões são definidas por administradores. Para alterar seu nível de acesso, entre em contato com o suporte técnico.
                        </p>
                    </div>
                </div>

                {/* Direita: Formulários */}
                <div className="md:col-span-2 space-y-6">
                    {/* Dados Básicos */}
                    <div className="card p-6 space-y-6">
                        <div className="flex items-center gap-2 text-white font-bold text-sm border-b border-[var(--border)] pb-4">
                            <User size={18} className="text-indigo-500" />
                            Dados Cadastrais
                        </div>
                        <form onSubmit={handleUpdateProfile} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-[var(--fg-dim)] uppercase tracking-wider">Nome Completo</label>
                                <input
                                    type="text"
                                    value={nome}
                                    onChange={(e) => setNome(e.target.value)}
                                    className="w-full bg-white/5 border border-[var(--border)] p-3 rounded-xl text-sm text-white focus:border-indigo-500 outline-none transition-all"
                                    placeholder="Seu nome"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={isSaving || nome === perfil?.nome}
                                className="btn-primary w-full md:w-auto px-8"
                            >
                                {isSaving ? <Loader2 className="animate-spin" size={18} /> : <><Save size={18} /> Salvar Alterações</>}
                            </button>
                        </form>
                    </div>

                    {/* Email */}
                    <div className="card p-6 space-y-6">
                        <div className="flex items-center gap-2 text-white font-bold text-sm border-b border-[var(--border)] pb-4">
                            <Mail size={18} className="text-indigo-500" />
                            Endereço de E-mail
                        </div>
                        <form onSubmit={handleUpdateEmail} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-[var(--fg-dim)] uppercase tracking-wider">Novo E-mail</label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full bg-white/5 border border-[var(--border)] p-3 rounded-xl text-sm text-white focus:border-indigo-500 outline-none transition-all"
                                    placeholder="novo@email.com"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={isSaving || email === user?.email}
                                className="btn-primary w-full md:w-auto px-8"
                            >
                                {isSaving ? <Loader2 className="animate-spin" size={18} /> : "Atualizar E-mail"}
                            </button>
                        </form>
                    </div>

                    {/* Senha */}
                    <div className="card p-6 space-y-6">
                        <div className="flex items-center gap-2 text-white font-bold text-sm border-b border-[var(--border)] pb-4">
                            <Lock size={18} className="text-indigo-500" />
                            Alterar Senha
                        </div>
                        <form onSubmit={handleUpdatePassword} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-[var(--fg-dim)] uppercase tracking-wider">Nova Senha</label>
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-white/5 border border-[var(--border)] p-3 rounded-xl text-sm text-white focus:border-indigo-500 outline-none transition-all"
                                        placeholder="Min. 8 caracteres"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-[var(--fg-dim)] uppercase tracking-wider">Confirmar Senha</label>
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="w-full bg-white/5 border border-[var(--border)] p-3 rounded-xl text-sm text-white focus:border-indigo-500 outline-none transition-all"
                                        placeholder="Confirme a senha"
                                    />
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={isSaving || !password}
                                className="btn-primary w-full md:w-auto px-8"
                            >
                                {isSaving ? <Loader2 className="animate-spin" size={18} /> : "Alterar Senha"}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </main>
    );
}
