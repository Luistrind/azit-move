import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MENSAGEM_FALHA_ENTRADA } from '@azit/utils';
import { authService } from '../../services/auth.service';
import { useAuthStore } from '../../stores/authStore';
import { queryClient } from '../../lib/queryClient';

// Tela de login (doc 06 v1.1 §2.4). Botão oficial do Google em destaque; o
// formulário de e-mail e senha fica recolhido atrás de "entrar com senha" e só
// funciona para quem tem permiteSenha. A mensagem de erro é sempre a mesma
// (§2.4): não diz se foi e-mail, senha, senha desligada, conta de fora ou bloqueio.
//
// Client id do Google: a fonte preferida é GET /auth/config (o mesmo build serve
// homolog e produção); VITE_GOOGLE_CLIENT_ID é reserva de build time.

const GSI_SCRIPT = 'https://accounts.google.com/gsi/client';

// Carrega o script do Google Identity Services uma vez; resolve quando `window.google` existe.
function carregarGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existente = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SCRIPT}"]`);
    if (existente) {
      existente.addEventListener('load', () => resolve());
      existente.addEventListener('error', () => reject(new Error('gsi')));
      return;
    }
    const s = document.createElement('script');
    s.src = GSI_SCRIPT;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('gsi'));
    document.head.appendChild(s);
  });
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSessao = useAuthStore((s) => s.setSessao);

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [comSenha, setComSenha] = useState(false);
  const [googlePronto, setGooglePronto] = useState<'carregando' | 'pronto' | 'falhou'>('carregando');
  const botaoGoogleRef = useRef<HTMLDivElement>(null);

  const destino =
    (location.state as { from?: string } | null)?.from ?? '/';

  // Client id: backend primeiro; se a API estiver fora, cai no valor de build (se houver).
  const config = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => authService.config(),
    retry: 1,
    staleTime: 5 * 60_000,
  });
  const clientId = config.data
    ? config.data.googleClientId
    : config.isError
      ? (import.meta.env.VITE_GOOGLE_CLIENT_ID || null)
      : undefined; // ainda carregando

  const entrar = useCallback(
    (resp: Awaited<ReturnType<typeof authService.login>>) => {
      setSessao(resp);
      // Sessão nova = cache novo: sem isso, menu/permissões do usuário anterior vazam.
      queryClient.clear();
      navigate(destino, { replace: true });
    },
    [setSessao, navigate, destino],
  );

  // Botão oficial do Google (Google Identity Services): initialize + renderButton.
  // Sem One Tap automático (decisão §2.2: o usuário escolhe a conta, nada entra sozinho).
  useEffect(() => {
    if (!clientId) return;
    let vivo = true;
    carregarGsi()
      .then(() => {
        if (!vivo || !botaoGoogleRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: async ({ credential }) => {
            setErro(null);
            setCarregando(true);
            try {
              entrar(await authService.loginGoogle(credential));
            } catch (e) {
              const status = (e as { response?: { status?: number } })?.response?.status;
              setErro(status === 429 ? 'Muitas tentativas de entrada. Aguarde um minuto e tente de novo.' : MENSAGEM_FALHA_ENTRADA);
            } finally {
              setCarregando(false);
            }
          },
        });
        botaoGoogleRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(botaoGoogleRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: 324,
          locale: 'pt-BR',
        });
        setGooglePronto('pronto');
      })
      .catch(() => { if (vivo) setGooglePronto('falhou'); });
    return () => { vivo = false; };
  }, [clientId, entrar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      entrar(await authService.login(email, senha));
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      // Mensagem genérica (doc 06 §2.4) — só o 429 (limite por IP) é dito, porque não revela nada da conta.
      setErro(status === 429 ? 'Muitas tentativas de entrada. Aguarde um minuto e tente de novo.' : MENSAGEM_FALHA_ENTRADA);
    } finally {
      setCarregando(false);
    }
  }

  const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;

  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{ background: 'var(--navy)' }}
    >
      <div
        className="w-[380px] max-w-[calc(100vw-24px)] rounded-modal p-[28px]"
        style={{ background: 'var(--surface)', animation: 'azFade .28s ease both' }}
      >
        <div className="mb-[22px] flex items-center gap-[10px]">
          <img src="/marca-icone.png" alt="" width={32} height={32} className="h-[32px] w-[32px]" />
          <span className="font-display text-[18px] font-bold tracking-[-0.01em]">
            azit<span style={{ color: 'var(--accent)' }}>move</span>
          </span>
        </div>

        <h1 className="font-display text-[18px] font-bold">Console operacional</h1>
        <p className="mb-[20px] mt-[2px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
          Entre com a sua conta Google da Azit.
        </p>

        {/* Entrada pelo Google (caminho normal) */}
        {clientId === undefined && (
          <div className="h-[44px] rounded-[10px]" style={{ background: 'var(--surface-input)' }} aria-busy="true" />
        )}
        {clientId === null && (
          <div className="rounded-[10px] px-[12px] py-[10px] text-[12px]" style={{ background: 'var(--surface-muted)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
            Entrada pelo Google não configurada neste ambiente.
          </div>
        )}
        {clientId && (
          <div className="flex min-h-[44px] flex-col items-center gap-[6px]">
            <div ref={botaoGoogleRef} className={carregando ? 'pointer-events-none opacity-60' : ''} />
            {googlePronto === 'carregando' && (
              <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>Carregando o botão do Google…</div>
            )}
            {googlePronto === 'falhou' && (
              <div className="rounded-[10px] px-[12px] py-[8px] text-[12px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>
                Não foi possível carregar o botão do Google. Confira a conexão ou use "entrar com senha".
              </div>
            )}
          </div>
        )}

        {erro && (
          <div
            className="mt-[12px] rounded-[8px] px-[12px] py-[8px] text-[12px] font-semibold"
            style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}
            role="alert"
          >
            {erro}
          </div>
        )}

        {/* Senha de reserva — recolhida (doc 06 §2.4) */}
        <div className="mt-[18px] text-center">
          {!comSenha ? (
            <button
              type="button"
              onClick={() => setComSenha(true)}
              className="text-[12px] underline-offset-2 hover:underline"
              style={{ color: 'var(--text-muted)' }}
            >
              entrar com senha
            </button>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-[12px] text-left" style={{ animation: 'azFade .2s ease both' }}>
              <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                A entrada por senha é uma reserva: só funciona se o administrador a liberou para você.
              </div>
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
                  autoFocus
                  className="rounded-[10px] px-[12px] py-[10px] text-[13px] outline-none"
                  style={inputStyle}
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
                  style={inputStyle}
                />
              </label>

              <button
                type="submit"
                disabled={carregando}
                className="mt-[4px] rounded-[10px] py-[11px] text-[13px] font-bold transition-opacity disabled:opacity-60"
                style={{ background: 'var(--accent)', color: 'var(--text-primary)' }}
              >
                {carregando ? 'Entrando…' : 'Entrar com senha'}
              </button>
              <button
                type="button"
                onClick={() => { setComSenha(false); setErro(null); }}
                className="text-[11.5px] underline-offset-2 hover:underline"
                style={{ color: 'var(--text-muted)' }}
              >
                voltar para a entrada com Google
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
