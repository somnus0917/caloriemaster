import { useState, type FormEvent } from "react";
import { useAuth } from "../hooks/useAuth";
import { ApiError } from "../services/http";

interface AuthFormProps {
  mode: "login" | "register";
  onSwitch: () => void;
}

export function AuthForm({ mode, onSwitch }: AuthFormProps) {
  const { login, register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isLogin = mode === "login";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      if (isLogin) {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "请求失败");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="screen active auth-screen">
      <section className="auth-card">
        <h1 className="auth-title">卡路里追踪</h1>
        <p className="auth-sub">
          {isLogin ? "登录以继续追踪饮食" : "创建账户以保存到云端"}
        </p>
        <form onSubmit={onSubmit} noValidate>
          <label htmlFor="email-input">邮箱</label>
          <input
            id="email-input"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            required
            maxLength={255}
          />
          <label htmlFor="password-input">密码（至少 8 位）</label>
          <input
            id="password-input"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            minLength={8}
            maxLength={128}
            required
          />
          {error ? (
            <div className="auth-error" role="alert">
              {error}
            </div>
          ) : null}
          <button
            className="btn-primary auth-submit"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "处理中..." : isLogin ? "登录" : "注册"}
          </button>
        </form>
        <button
          className="btn-ghost auth-switch"
          type="button"
          onClick={onSwitch}
          disabled={submitting}
        >
          {isLogin ? "没有账户？去注册" : "已有账户？去登录"}
        </button>
      </section>
    </main>
  );
}
