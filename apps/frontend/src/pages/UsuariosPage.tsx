import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  usuarioService,
  UsuarioInterno,
  nomeArea,
  nomePapel,
} from '../services/usuario.service';
import { mensagemErro } from '../lib/permissoes';

// Gestão de Usuários (doc 02 §16): criação de usuários internos, matriz papel × área
// (o papel carrega as permissões do seu domínio) e exceções específicas por usuário.

const inputCls = 'h-[32px] rounded-[8px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;

export function UsuariosPage() {
  const queryClient = useQueryClient();
  const [aba, setAba] = useState<'usuarios' | 'matriz'>('usuarios');

  return (
    <div className="flex flex-col gap-[16px] p-[24px]">
      <div>
        <h1 className="font-display text-[20px] font-bold">Usuários e permissões</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          O papel do usuário carrega as áreas do sistema que ele acessa (matriz abaixo). Exceções por
          usuário concedem ou retiram áreas específicas sem mudar o papel. Toda alteração é auditada.
        </p>
      </div>

      <div className="flex gap-[8px]">
        {(
          [
            ['usuarios', 'Usuários'],
            ['matriz', 'Matriz de permissões por papel'],
          ] as const
        ).map(([k, rotulo]) => (
          <button
            key={k}
            onClick={() => setAba(k)}
            className="h-[32px] rounded-[8px] px-[14px] text-[12.5px] font-semibold"
            style={
              aba === k
                ? { background: 'var(--navy)', color: '#fff' }
                : { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }
            }
          >
            {rotulo}
          </button>
        ))}
      </div>

      {aba === 'usuarios' ? (
        <ListaUsuarios onMudou={() => queryClient.invalidateQueries({ queryKey: ['usuarios'] })} />
      ) : (
        <MatrizPermissoes />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Aba 1 — usuários: lista, criação, edição, senha e exceções por usuário
// ------------------------------------------------------------------

function ListaUsuarios({ onMudou }: { onMudou: () => void }) {
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => usuarioService.listar() });
  const [criando, setCriando] = useState(false);
  const [abertoId, setAbertoId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-[12px]">
      <div>
        <button
          onClick={() => setCriando((v) => !v)}
          className="h-[34px] rounded-[8px] px-[16px] text-[12.5px] font-semibold"
          style={{ background: 'var(--navy)', color: '#fff' }}
        >
          {criando ? 'Cancelar' : '+ Novo usuário'}
        </button>
      </div>

      {criando && (
        <FormNovoUsuario
          onCriado={() => {
            setCriando(false);
            onMudou();
          }}
        />
      )}

      <div className="overflow-x-auto rounded-[14px] p-[16px]" style={cardStyle}>
        {usuarios.isLoading || !usuarios.data ? (
          <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
        ) : (
          <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left" style={{ color: 'var(--text-muted)' }}>
                <th className="pb-[10px] font-semibold">Nome</th>
                <th className="pb-[10px] font-semibold">E-mail</th>
                <th className="pb-[10px] font-semibold">Papéis</th>
                <th className="pb-[10px] font-semibold">Áreas com acesso</th>
                <th className="pb-[10px] font-semibold">Situação</th>
                <th className="pb-[10px]" />
              </tr>
            </thead>
            <tbody>
              {usuarios.data.map((u) => (
                <LinhaUsuario
                  key={u.id}
                  usuario={u}
                  aberto={abertoId === u.id}
                  onAbrir={() => setAbertoId(abertoId === u.id ? null : u.id)}
                  onMudou={onMudou}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FormNovoUsuario({ onCriado }: { onCriado: () => void }) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [papeis, setPapeis] = useState<string[]>(['OPERADOR']);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    setErro(null);
    if (nome.trim().length < 3) return setErro('Informe o nome completo.');
    if (!email.includes('@')) return setErro('Informe um e-mail válido.');
    if (senha.length < 6) return setErro('A senha precisa de pelo menos 6 caracteres.');
    if (papeis.length === 0) return setErro('Selecione pelo menos um papel.');
    setSalvando(true);
    try {
      await usuarioService.criar({ nome: nome.trim(), email: email.trim(), senha, papeis });
      onCriado();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-[12px] rounded-[14px] p-[16px]" style={cardStyle}>
      <div className="text-[13px] font-bold">Novo usuário interno</div>
      <div className="flex flex-wrap items-end gap-[10px]">
        <Campo rotulo="Nome completo">
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={`${inputCls} w-[220px]`} style={inputStyle} />
        </Campo>
        <Campo rotulo="E-mail de acesso">
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} w-[220px]`} style={inputStyle} />
        </Campo>
        <Campo rotulo="Senha inicial">
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} className={`${inputCls} w-[160px]`} style={inputStyle} />
        </Campo>
      </div>
      <SeletorPapeis valor={papeis} onChange={setPapeis} />
      {erro && (
        <div className="rounded-[8px] p-[8px] text-[12px]" style={{ background: '#fdecec', color: '#a12622' }}>{erro}</div>
      )}
      <div>
        <button
          onClick={criar}
          disabled={salvando}
          className="h-[34px] rounded-[8px] px-[16px] text-[12.5px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--navy)', color: '#fff' }}
        >
          {salvando ? 'Criando…' : 'Criar usuário'}
        </button>
      </div>
    </div>
  );
}

function LinhaUsuario({
  usuario,
  aberto,
  onAbrir,
  onMudou,
}: {
  usuario: UsuarioInterno;
  aberto: boolean;
  onAbrir: () => void;
  onMudou: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);

  async function alternarAtivo() {
    setOcupado(true);
    try {
      await usuarioService.atualizar(usuario.id, { ativo: !usuario.ativo });
      onMudou();
    } catch (e) {
      window.alert(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <tr style={{ borderTop: '1px solid var(--border-light)' }}>
        <td className="py-[10px] font-semibold">{usuario.nome}</td>
        <td className="py-[10px]">{usuario.email}</td>
        <td className="py-[10px]">{usuario.papeis.map(nomePapel).join(', ')}</td>
        <td className="py-[10px]">
          {usuario.areasEfetivas.length === 10 ? 'Todas as áreas' : `${usuario.areasEfetivas.length} de 10 áreas`}
          {usuario.excecoes.length > 0 && (
            <span
              className="ml-[6px] rounded-full px-[7px] py-[1px] text-[10.5px] font-bold"
              style={{ background: '#fff3d6', color: '#8a5a00' }}
            >
              {usuario.excecoes.length} exceção{usuario.excecoes.length > 1 ? 'es' : ''}
            </span>
          )}
        </td>
        <td className="py-[10px]">
          <span
            className="rounded-full px-[8px] py-[2px] text-[11px] font-bold"
            style={usuario.ativo ? { background: '#e5f5ec', color: '#1c7c4c' } : { background: '#fdecec', color: '#a12622' }}
          >
            {usuario.ativo ? 'Ativo' : 'Desativado'}
          </span>
        </td>
        <td className="py-[10px] text-right">
          <div className="flex justify-end gap-[6px]">
            <BotaoLeve onClick={onAbrir}>{aberto ? 'Fechar' : 'Gerenciar'}</BotaoLeve>
            <BotaoLeve onClick={alternarAtivo} disabled={ocupado}>
              {usuario.ativo ? 'Desativar' : 'Reativar'}
            </BotaoLeve>
          </div>
        </td>
      </tr>
      {aberto && (
        <tr>
          <td colSpan={6} className="pb-[14px]">
            <PainelUsuario usuario={usuario} onMudou={onMudou} />
          </td>
        </tr>
      )}
    </>
  );
}

// Painel expandido: papéis, senha e exceções de área do usuário.
function PainelUsuario({ usuario, onMudou }: { usuario: UsuarioInterno; onMudou: () => void }) {
  const permissoes = useQuery({
    queryKey: ['usuario-permissoes', usuario.id],
    queryFn: () => usuarioService.permissoes(usuario.id),
  });
  const queryClient = useQueryClient();
  const [papeis, setPapeis] = useState<string[]>(usuario.papeis);
  const [novaSenha, setNovaSenha] = useState('');
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  async function recarregar() {
    await queryClient.invalidateQueries({ queryKey: ['usuario-permissoes', usuario.id] });
    onMudou();
  }

  async function salvarPapeis() {
    setMsg(null);
    if (papeis.length === 0) return setMsg('Selecione pelo menos um papel.');
    try {
      await usuarioService.atualizar(usuario.id, { papeis });
      setMsg('Papéis atualizados.');
      await recarregar();
    } catch (e) {
      setMsg(mensagemErro(e));
    }
  }

  async function redefinirSenha() {
    setMsg(null);
    if (novaSenha.length < 6) return setMsg('A senha precisa de pelo menos 6 caracteres.');
    try {
      await usuarioService.redefinirSenha(usuario.id, novaSenha);
      setNovaSenha('');
      setMsg('Senha redefinida.');
    } catch (e) {
      setMsg(mensagemErro(e));
    }
  }

  async function definirExcecao(area: string, concedida: boolean | null) {
    setMsg(null);
    try {
      await usuarioService.definirExcecao(usuario.id, {
        area,
        concedida,
        motivo: motivo.trim() || undefined,
      });
      await recarregar();
    } catch (e) {
      setMsg(mensagemErro(e));
    }
  }

  const p = permissoes.data;

  return (
    <div className="flex flex-col gap-[14px] rounded-[12px] p-[16px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
      <div className="flex flex-wrap items-end gap-[16px]">
        <div className="flex flex-col gap-[6px]">
          <SeletorPapeis valor={papeis} onChange={setPapeis} />
          <div>
            <BotaoLeve onClick={salvarPapeis}>Salvar papéis</BotaoLeve>
          </div>
        </div>
        <div className="flex items-end gap-[8px]">
          <Campo rotulo="Nova senha">
            <input type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} className={`${inputCls} w-[160px]`} style={{ background: '#fff', border: '1px solid var(--border)' }} />
          </Campo>
          <BotaoLeve onClick={redefinirSenha}>Redefinir senha</BotaoLeve>
        </div>
      </div>

      <div>
        <div className="mb-[6px] text-[12px] font-bold">Acesso por área</div>
        <div className="mb-[8px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          "Padrão do papel" segue a matriz de permissões. Conceder ou retirar cria uma exceção só para
          este usuário. O motivo abaixo é gravado junto com a exceção.
        </div>
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Motivo da exceção (opcional, recomendado)"
          className={`${inputCls} mb-[10px] w-full max-w-[420px]`}
          style={{ background: '#fff', border: '1px solid var(--border)' }}
        />
        {!p ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
        ) : (
          <div className="grid grid-cols-1 gap-[6px] sm:grid-cols-2">
            {Object.keys(NOMES_ORDENADOS).map((area) => {
              const excecao = p.excecoes.find((e) => e.area === area);
              const doPapel = p.areasDoPapel.includes(area);
              const efetiva = p.areasEfetivas.includes(area);
              return (
                <div
                  key={area}
                  className="flex items-center justify-between gap-[8px] rounded-[8px] px-[10px] py-[7px]"
                  style={{ background: '#fff', border: '1px solid var(--border)' }}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-semibold">{nomeArea(area)}</div>
                    <div className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
                      {excecao
                        ? excecao.concedida
                          ? 'Concedida por exceção'
                          : 'Retirada por exceção'
                        : doPapel
                          ? 'Padrão do papel: com acesso'
                          : 'Padrão do papel: sem acesso'}
                      {excecao?.motivo ? ` — ${excecao.motivo}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-[6px]">
                    <span
                      className="rounded-full px-[7px] py-[1px] text-[10.5px] font-bold"
                      style={efetiva ? { background: '#e5f5ec', color: '#1c7c4c' } : { background: '#f2f3f5', color: 'var(--text-muted)' }}
                    >
                      {efetiva ? 'Acessa' : 'Não acessa'}
                    </span>
                    {excecao ? (
                      <BotaoLeve onClick={() => definirExcecao(area, null)}>Voltar ao padrão</BotaoLeve>
                    ) : efetiva ? (
                      <BotaoLeve onClick={() => definirExcecao(area, false)}>Retirar</BotaoLeve>
                    ) : (
                      <BotaoLeve onClick={() => definirExcecao(area, true)}>Conceder</BotaoLeve>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {msg && (
        <div className="rounded-[8px] p-[8px] text-[12px]" style={{ background: '#eef4ff', color: '#1c4587' }}>{msg}</div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Aba 2 — matriz papel × área
// ------------------------------------------------------------------

function MatrizPermissoes() {
  const queryClient = useQueryClient();
  const matriz = useQuery({ queryKey: ['permissoes-matriz'], queryFn: () => usuarioService.matriz() });
  const [salvando, setSalvando] = useState<string | null>(null);

  async function alternar(papel: string, area: string, permitido: boolean) {
    const chave = `${papel}:${area}`;
    setSalvando(chave);
    try {
      await usuarioService.salvarCelula({ papel, area, permitido });
      await queryClient.invalidateQueries({ queryKey: ['permissoes-matriz'] });
      await queryClient.invalidateQueries({ queryKey: ['usuarios'] });
    } catch (e) {
      window.alert(mensagemErro(e));
    } finally {
      setSalvando(null);
    }
  }

  const m = matriz.data;

  return (
    <div className="overflow-x-auto rounded-[14px] p-[16px]" style={cardStyle}>
      <div className="mb-[10px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
        Marque as áreas que cada papel acessa por padrão. A alteração vale para todos os usuários do
        papel, exceto onde houver exceção individual.
      </div>
      {matriz.isLoading || !m ? (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
      ) : (
        <table className="w-full min-w-[680px] border-collapse text-[12.5px]">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th className="pb-[10px] text-left font-semibold">Área do sistema</th>
              {m.papeis.map((papel) => (
                <th key={papel} className="pb-[10px] text-center font-semibold">{nomePapel(papel)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.areas.map((area) => (
              <tr key={area} style={{ borderTop: '1px solid var(--border-light)' }}>
                <td className="py-[9px] font-semibold">{nomeArea(area)}</td>
                {m.papeis.map((papel) => {
                  const celula = m.celulas.find((c) => c.papel === papel && c.area === area);
                  const chave = `${papel}:${area}`;
                  return (
                    <td key={papel} className="py-[9px] text-center">
                      <input
                        type="checkbox"
                        disabled={salvando === chave}
                        checked={celula?.permitido ?? false}
                        onChange={(e) => alternar(papel, area, e.target.checked)}
                        className="h-[15px] w-[15px]"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Auxiliares
// ------------------------------------------------------------------

const NOMES_ORDENADOS: Record<string, string> = {
  COMERCIAL: '',
  ANALISE_CADASTRO: '',
  CONTRATOS: '',
  CARTEIRA_COBRANCA: '',
  PESSOAS: '',
  ATIVOS_FROTA: '',
  CAPITAL_INVESTIMENTO: '',
  PRODUTOS: '',
  APROVACOES: '',
  CONFIGURACOES: '',
};

const PAPEIS = ['ADMIN', 'DIRETOR', 'APROVADOR', 'OPERADOR', 'FINANCEIRO'];

function SeletorPapeis({ valor, onChange }: { valor: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <div className="mb-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Papéis</div>
      <div className="flex flex-wrap gap-[10px]">
        {PAPEIS.map((papel) => (
          <label key={papel} className="flex items-center gap-[5px] text-[12.5px]">
            <input
              type="checkbox"
              checked={valor.includes(papel)}
              onChange={(e) =>
                onChange(e.target.checked ? [...valor, papel] : valor.filter((v) => v !== papel))
              }
            />
            {nomePapel(papel)}
          </label>
        ))}
      </div>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{rotulo}</div>
      {children}
    </div>
  );
}

function BotaoLeve({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-[28px] whitespace-nowrap rounded-[7px] px-[10px] text-[11.5px] font-semibold disabled:opacity-50"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--navy)' }}
    >
      {children}
    </button>
  );
}
