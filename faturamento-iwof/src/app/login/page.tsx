"use client";

import { useState, type FormEvent } from "react";
import { Mail, Lock, Receipt, ArrowRight } from "lucide-react";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        // TODO: integrar com Supabase Auth
        console.log("Login attempt", { email, password });
    };

    return (
        <div className="login-page" style={{ marginLeft: 0 }}>
            <div className="login-card card-glass">
                {/* Branding */}
                <div className="login-brand">
                    <div className="login-logo">
                        <Receipt size={30} strokeWidth={2.2} />
                    </div>
                    <h1 className="login-title">IWOF Faturamento</h1>
                    <p className="login-subtitle">Acesse sua conta para continuar</p>
                </div>

                {/* Form */}
                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="input-group">
                        <label className="input-label" htmlFor="email">
                            E-mail
                        </label>
                        <div className="input-wrapper">
                            <Mail size={18} className="input-icon" />
                            <input
                                id="email"
                                type="email"
                                className="input"
                                placeholder="seu@email.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="input-group">
                        <label className="input-label" htmlFor="password">
                            Senha
                        </label>
                        <div className="input-wrapper">
                            <Lock size={18} className="input-icon" />
                            <input
                                id="password"
                                type="password"
                                className="input"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <button type="submit" className="btn btn-primary">
                        Entrar
                        <ArrowRight size={18} />
                    </button>
                </form>
            </div>
        </div>
    );
}
