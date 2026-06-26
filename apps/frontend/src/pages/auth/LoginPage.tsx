import { FormEvent, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { authService } from '../../services/auth.service';
import { useAuthStore } from '../../stores/authStore';

// Tela de login (Doc 7 item 1.6). Form email+senha → guarda tokens → redireciona.
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSessao = useAuthStore((s) => s.setSessao);

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const destino =
    (location.state as { from?: string } | null)?.from ?? '/';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const resp = await authService.login(email, senha);
      setSessao(resp);
      navigate(destino, { replace: true });
    } catch {
      // Mensagem genérica — não revela se foi e-mail ou senha (Doc 6 §11.3).
      setErro('E-mail ou senha inválidos.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{ background: 'var(--navy)' }}
    >
      <div
        className="w-[380px] rounded-modal p-[28px]"
        style={{ background: 'var(--surface)', animation: 'azFade .28s ease both' }}
      >
        <div className="mb-[22px] flex items-center gap-[10px]">
          <div
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] font-display text-[17px] font-extrabold"
            style={{ background: 'var(--accent)', color: 'var(--navy)' }}
          >
            a
          </div>
          <span className="font-display text-[18px] font-bold tracking-[-0.01em]">
            azit<span style={{ color: 'var(--accent)' }}>move</span>
          </span>
        </div>

        <h1 className="font-display text-[18px] font-bold">Console operacional</h1>
        <p className="mb-[20px] mt-[2px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
          Entre com suas credenciais internas.
        </p>

        <form onSubmit={onSubmit} className="flex flex-col gap-[12px]">
          <label className="flex flex-col gap-[6px]">
            <span className="text-[11.5px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
              E-mail
            </span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="rounded-[10px] px-[12px] py-[10px] text-[13px] outline-none"
              style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
            />
          </label>

          <label className="flex flex-col gap-[6px]">
            <span className="text-[11.5px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Senha
            </span>
            <input
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              className="rounded-[10px] px-[12px] py-[10px] text-[13px] outline-none"
              style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
            />
          </label>

          {erro && (
            <div
              className="rounded-[8px] px-[12px] py-[8px] text-[12px] font-semibold"
              style={{ background: '#fdeceb', color: '#e0413c' }}
            >
              {erro}
            </div>
          )}

          <button
            type="submit"
            disabled={carregando}
            className="mt-[4px] rounded-[10px] py-[11px] text-[13px] font-bold transition-opacity disabled:opacity-60"
            style={{ background: 'var(--accent)', color: 'var(--navy)' }}
          >
            {carregando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
