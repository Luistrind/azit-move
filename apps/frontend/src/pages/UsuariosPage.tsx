import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  usuarioService,
  UsuarioInterno,
  nomeArea,
  nomePapel,
} from '../services/usuario.service';
import { mensagemErro } from '../lib/permissoes';
import { Botao } from '../components/Botao';
import { Chips } from '../components/Chips';
import { Secao } from '../components/Secao';
import { Tabela, type Coluna } from '../components/Tabela';

// Gestão de Usuários (doc 02 §16): criação de usuários internos, matriz papel × área
// (o papel carrega as permissões do seu domínio) e exceções específicas por usuário.
// Layout v2 (doc 03 §11): lista em <Tabela>, abas em <Chips>, botões em <Botao>.

const inputCls = 'h-[32px] rounded-[10px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const pilula = 'inline-flex items-center rounded-full px-[8px] py-[2px] text-[11px] font-bold';

export function UsuariosPage() {
  const queryClient = useQueryClient();
  const [aba, setAba] = useState<'usuarios' | 'matriz'>('usuarios');

  return (
    <div className="flex flex-col gap-[16px]">
      <div>
        <h1 className="font-display text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>Usuários e permissões</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          O papel do usuário carrega as áreas do sistema que ele acessa (matriz abaixo). Exceções por
          usuário concedem ou retiram áreas específicas sem mudar o papel. Toda alteração é auditada.
        </p>
      </div>

      <Chips
        todos={null}
        itens={[
          { chave: 'usuarios', rotulo: 'Usuários' },
          { chave: 'matriz', rotulo: 'Matriz de permissões por papel' },
        ]}
        valor={aba}
        onChange={(k) => setAba((k as 'usuarios' | 'matriz') ?? 'usuarios')}
      />

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
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);

  async function alternarAtivo(usuario: UsuarioInterno) {
    setOcupadoId(usuario.id);
    try {
      await usuarioService.atualizar(usuario.id, { ativo: !usuario.ativo });
      onMudou();
    } catch (e) {
      window.alert(mensagemErro(e));
    } finally {
      setOcupadoId(null);
    }
  }

  const lista = usuarios.data ?? [];
  const aberto = lista.find((u) => u.id === abertoId) ?? null;

  const colunas: Coluna<UsuarioInterno>[] = [
    { chave: 'nome', titulo: 'Nome', render: (u) => u.nome, celular: 'titulo' },
    { chave: 'email', titulo: 'E-mail', render: (u) => u.email, celular: 'subtitulo' },
    { chave: 'papeis', titulo: 'Papéis', render: (u) => u.papeis.map(nomePapel).join(', ') },
    {
      chave: 'areas',
      titulo: 'Áreas com acesso',
      render: (u) => (
        <span className="whitespace-normal">
          {u.areasEfetivas.length === 10 ? 'Todas as áreas' : `${u.areasEfetivas.length} de 10 áreas`}
          {u.excecoes.length > 0 && (
            <span className={`${pilula} ml-[6px]`} style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
              {u.excecoes.length} exceção{u.excecoes.length > 1 ? 'es' : ''}
            </span>
          )}
        </span>
      ),
    },
    {
      chave: 'situacao',
      titulo: 'Situação',
      celular: 'destaque',
      render: (u) => (
        <span className={pilula} style={u.ativo ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)' } : { background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>
          {u.ativo ? 'Ativo' : 'Desativado'}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <Botao variante={criando ? 'secundaria' : 'primaria'} onClick={() => setCriando((v) => !v)}>
          {criando ? 'Cancelar' : '+ Novo usuário'}
        </Botao>
        <span className="ml-auto text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {lista.length} usuário{lista.length === 1 ? '' : 's'}
        </span>
      </div>

      {criando && (
        <FormNovoUsuario
          onCriado={() => {
            setCriando(false);
            onMudou();
          }}
        />
      )}

      <Tabela
        colunas={colunas}
        linhas={lista}
        chave={(u) => u.id}
        carregando={usuarios.isLoading || !usuarios.data}
        larguraMinima={720}
        vazio="Nenhum usuário interno cadastrado."
        acoes={(u) => (
          <>
            <Botao tamanho="sm" variante={abertoId === u.id ? 'secundaria' : 'fantasma'} onClick={() => setAbertoId(abertoId === u.id ? null : u.id)}>
              {abertoId === u.id ? 'Fechar' : 'Gerenciar'}
            </Botao>
            <Botao tamanho="sm" variante={u.ativo ? 'perigo' : 'secundaria'} onClick={() => void alternarAtivo(u)} disabled={ocupadoId === u.id}>
              {u.ativo ? 'Desativar' : 'Reativar'}
            </Botao>
          </>
        )}
      />

      {aberto && (
        <div className="rounded-card p-[16px]" style={cardStyle}>
          <Secao
            titulo={`Gerenciar — ${aberto.nome}`}
            tag={aberto.email}
            acao={<Botao tamanho="sm" variante="fantasma" onClick={() => setAbertoId(null)}>Fechar</Botao>}
          >
            <PainelUsuario key={aberto.id} usuario={aberto} onMudou={onMudou} />
          </Secao>
        </div>
      )}
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
    <div className="rounded-card p-[16px]" style={cardStyle}>
      <Secao titulo="Novo usuário interno">
        <div className="flex flex-col gap-[12px]">
          <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-3">
            <Campo rotulo="Nome completo">
              <input value={nome} onChange={(e) => setNome(e.target.value)} className={`${inputCls} w-full`} style={inputStyle} />
            </Campo>
            <Campo rotulo="E-mail de acesso">
              <input value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} w-full`} style={inputStyle} />
            </Campo>
            <Campo rotulo="Senha inicial">
              <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} className={`${inputCls} w-full`} style={inputStyle} />
            </Campo>
          </div>
          <SeletorPapeis valor={papeis} onChange={setPapeis} />
          {erro && (
            <div className="rounded-[10px] p-[8px] text-[12px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>{erro}</div>
          )}
          <div>
            <Botao variante="primaria" onClick={() => void criar()} carregando={salvando}>
              Criar usuário
            </Botao>
          </div>
        </div>
      </Secao>
    </div>
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
    <div className="flex flex-col gap-[14px] rounded-[12px] p-[14px]" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
      <div className="flex flex-wrap items-end gap-[16px]">
        <div className="flex flex-col gap-[6px]">
          <SeletorPapeis valor={papeis} onChange={setPapeis} />
          <div>
            <Botao tamanho="sm" variante="secundaria" onClick={() => void salvarPapeis()}>Salvar papéis</Botao>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-[8px]">
          <Campo rotulo="Nova senha">
            <input type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} className={`${inputCls} w-full sm:w-[160px]`} style={{ ...inputStyle, background: 'var(--surface)' }} />
          </Campo>
          <Botao tamanho="sm" variante="secundaria" onClick={() => void redefinirSenha()}>Redefinir senha</Botao>
        </div>
      </div>

      <Secao titulo="Acesso por área">
        <div className="mb-[8px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          "Padrão do papel" segue a matriz de permissões. Conceder ou retirar cria uma exceção só para
          este usuário. O motivo abaixo é gravado junto com a exceção.
        </div>
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Motivo da exceção (opcional, recomendado)"
          className={`${inputCls} mb-[10px] w-full max-w-[420px]`}
          style={{ ...inputStyle, background: 'var(--surface)' }}
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
                  className="flex flex-wrap items-center justify-between gap-[8px] rounded-[10px] px-[10px] py-[7px]"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>{nomeArea(area)}</div>
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
                      className={pilula}
                      style={efetiva ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)' } : { background: 'var(--surface-muted)', color: 'var(--text-muted)' }}
                    >
                      {efetiva ? 'Acessa' : 'Não acessa'}
                    </span>
                    {excecao ? (
                      <Botao tamanho="sm" variante="secundaria" onClick={() => void definirExcecao(area, null)}>Voltar ao padrão</Botao>
                    ) : efetiva ? (
                      <Botao tamanho="sm" variante="secundaria" onClick={() => void definirExcecao(area, false)}>Retirar</Botao>
                    ) : (
                      <Botao tamanho="sm" variante="secundaria" onClick={() => void definirExcecao(area, true)}>Conceder</Botao>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Secao>

      {msg && (
        <div className="rounded-[10px] p-[8px] text-[12px]" style={{ background: 'var(--info-bg)', color: 'var(--info-fg)' }}>{msg}</div>
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

  // Uma coluna por papel: no celular, cada área vira um cartão com um checkbox por papel.
  const colunas: Coluna<string>[] = [
    { chave: 'area', titulo: 'Área do sistema', render: (area) => nomeArea(area), celular: 'titulo' },
    ...(m?.papeis ?? []).map<Coluna<string>>((papel) => ({
      chave: papel,
      titulo: nomePapel(papel),
      alinhar: 'center',
      render: (area) => {
        const celula = m?.celulas.find((c) => c.papel === papel && c.area === area);
        const chave = `${papel}:${area}`;
        return (
          <input
            type="checkbox"
            aria-label={`${nomePapel(papel)} acessa ${nomeArea(area)}`}
            disabled={salvando === chave}
            checked={celula?.permitido ?? false}
            onChange={(e) => void alternar(papel, area, e.target.checked)}
            className="h-[16px] w-[16px] align-middle"
          />
        );
      },
    })),
  ];

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
        Marque as áreas que cada papel acessa por padrão. A alteração vale para todos os usuários do
        papel, exceto onde houver exceção individual.
      </div>
      <Tabela
        colunas={colunas}
        linhas={m?.areas ?? []}
        chave={(area) => area}
        carregando={matriz.isLoading || !m}
        larguraMinima={680}
        vazio="Matriz de permissões vazia."
      />
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
      <div className="mb-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Papéis</div>
      <div className="flex flex-wrap gap-[10px]">
        {PAPEIS.map((papel) => (
          <label key={papel} className="flex min-h-[30px] items-center gap-[5px] text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
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
    <div className="min-w-0">
      <div className="mb-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>{rotulo}</div>
      {children}
    </div>
  );
}
