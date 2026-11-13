import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AreaSistema, ROTULO_ENTRADA_USUARIO } from '@azit/types';

// Total de áreas vem do enum, nunca chumbado (caso 13/11: a tela dizia "11 de 10 áreas").
const TOTAL_AREAS = Object.values(AreaSistema).length;
import { SENHA_MINIMO_CARACTERES, ehEmailWorkspace } from '@azit/utils';
import {
  usuarioService,
  UsuarioInterno,
  nomeArea,
  nomePapel,
} from '../services/usuario.service';
import { mensagemErro, usePodeRole, QUERY_ME_AREAS } from '../lib/permissoes';
import { colunasAcesso } from '../lib/acessos';
import { instanteHoraBR } from '../lib/datas';
import { ENTRADA_USUARIO_COLORS } from '../config/statusColors';
import { useAuthStore } from '../stores/authStore';
import { Botao } from '../components/Botao';
import { Chips } from '../components/Chips';
import { Secao } from '../components/Secao';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { ModalConfirmacao } from '../components/ModalConfirmacao';
import { Tabela, type Coluna } from '../components/Tabela';
import { toast } from '../components/Toast';

// Gestão de Usuários (doc 02 §16): criação de usuários internos, matriz papel × área
// (o papel carrega as permissões do seu domínio) e exceções específicas por usuário.
// Layout v2 (doc 03 §11): lista em <Tabela>, abas em <Chips>, botões em <Botao>.
//
// Entrada (doc 06 v1.1 §2, 13/11/2026): a porta normal é a conta Google do
// Workspace; a senha é reserva DESLIGADA por padrão. Aqui o Admin liga/desliga
// "permite senha" (com motivo, auditado), redefine a senha de reserva (mín. 10),
// religa a conta Google, encerra todas as sessões e vê os últimos acessos.

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
          usuário concedem ou retiram áreas específicas sem mudar o papel. A entrada é pela conta Google
          da Azit; a senha é reserva, ligada por usuário. Toda alteração é auditada.
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
// Aba 1 — usuários: lista, criação, edição, entrada (Google/senha) e exceções
// ------------------------------------------------------------------

function ListaUsuarios({ onMudou }: { onMudou: () => void }) {
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => usuarioService.listar() });
  const [criando, setCriando] = useState(false);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<UsuarioInterno | null>(null);
  const meuId = useAuthStore((s) => s.usuario?.id);
  const pode = usePodeRole();
  const souAdmin = pode(['ADMIN']);

  // Exclusão (07/11): só administrador, nunca a si mesmo. O backend ainda impede
  // excluir o último administrador ativo. Exclusão é lógica: o histórico fica.
  async function excluir(usuario: UsuarioInterno) {
    setOcupadoId(usuario.id);
    try {
      await usuarioService.excluir(usuario.id);
      if (abertoId === usuario.id) setAbertoId(null);
      toast.sucesso(`Usuário ${usuario.nome} excluído.`);
      onMudou();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupadoId(null);
      setExcluindo(null);
    }
  }

  async function alternarAtivo(usuario: UsuarioInterno) {
    setOcupadoId(usuario.id);
    try {
      await usuarioService.atualizar(usuario.id, { ativo: !usuario.ativo });
      onMudou();
    } catch (e) {
      toast.erro(mensagemErro(e));
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
          {u.areasEfetivas.length >= TOTAL_AREAS ? 'Todas as áreas' : `${u.areasEfetivas.length} de ${TOTAL_AREAS} áreas`}
          {u.excecoes.length > 0 && (
            <span className={`${pilula} ml-[6px]`} style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
              {u.excecoes.length} exceção{u.excecoes.length > 1 ? 'es' : ''}
            </span>
          )}
        </span>
      ),
    },
    {
      // Entrada (doc 06 v1.1 §2): Google vinculado no 1º acesso; senha só se o Admin ligou.
      chave: 'entrada',
      titulo: 'Entrada',
      render: (u) => (
        <span className="flex flex-wrap gap-[4px]">
          {ehEmailWorkspace(u.email) ? (
            <StatusBadge label={u.googleVinculado ? ROTULO_ENTRADA_USUARIO.googleVinculado : ROTULO_ENTRADA_USUARIO.googlePendente} colors={ENTRADA_USUARIO_COLORS} />
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }} title="E-mail fora dos domínios da Azit: não entra pelo Google">sem Google</span>
          )}
          {u.permiteSenha && <StatusBadge label={ROTULO_ENTRADA_USUARIO.senhaLigada} colors={ENTRADA_USUARIO_COLORS} />}
        </span>
      ),
    },
    { chave: 'ultimo', titulo: 'Último acesso', render: (u) => instanteHoraBR(u.ultimoAcessoEm), classe: 'tabular-nums' },
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
        larguraMinima={900}
        vazio="Nenhum usuário interno cadastrado."
        acoes={(u) => (
          <>
            <Botao tamanho="sm" variante={abertoId === u.id ? 'secundaria' : 'fantasma'} onClick={() => setAbertoId(abertoId === u.id ? null : u.id)}>
              {abertoId === u.id ? 'Fechar' : 'Gerenciar'}
            </Botao>
            <Botao tamanho="sm" variante={u.ativo ? 'perigo' : 'secundaria'} onClick={() => void alternarAtivo(u)} disabled={ocupadoId === u.id || u.id === meuId}>
              {u.ativo ? 'Desativar' : 'Reativar'}
            </Botao>
            {souAdmin && u.id !== meuId && (
              <Botao tamanho="sm" variante="perigo" onClick={() => setExcluindo(u)} disabled={ocupadoId === u.id}>
                Excluir
              </Botao>
            )}
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

      <ModalConfirmacao
        open={!!excluindo}
        titulo="Excluir usuário"
        confirmar="Excluir usuário"
        carregando={!!excluindo && ocupadoId === excluindo.id}
        onConfirmar={() => excluindo && void excluir(excluindo)}
        onCancelar={() => setExcluindo(null)}
      >
        Excluir <b>{excluindo?.nome}</b> ({excluindo?.email})? O acesso é cortado na hora e o usuário some da lista.
        O que ele fez no sistema (aprovações, decisões, auditoria) continua registrado em nome dele.
      </ModalConfirmacao>
    </div>
  );
}

function FormNovoUsuario({ onCriado }: { onCriado: () => void }) {
  const souAdmin = usePodeRole()(['ADMIN']);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [permiteSenha, setPermiteSenha] = useState(false);
  const [senha, setSenha] = useState('');
  const [papeis, setPapeis] = useState<string[]>(['OPERADOR']);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const foraDoWorkspace = email.includes('@') && !ehEmailWorkspace(email);

  async function criar() {
    setErro(null);
    if (nome.trim().length < 3) return setErro('Informe o nome completo.');
    if (!email.includes('@')) return setErro('Informe um e-mail válido.');
    if (permiteSenha && senha.length < SENHA_MINIMO_CARACTERES) return setErro(`A senha de reserva precisa de pelo menos ${SENHA_MINIMO_CARACTERES} caracteres.`);
    if (papeis.length === 0) return setErro('Selecione pelo menos um papel.');
    setSalvando(true);
    try {
      await usuarioService.criar({ nome: nome.trim(), email: email.trim(), papeis, permiteSenha, senha: permiteSenha ? senha : undefined });
      toast.sucesso(permiteSenha ? 'Usuário criado com senha de reserva.' : 'Usuário criado — entra pela conta Google da Azit.');
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
          <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
            <Campo rotulo="Nome completo">
              <input value={nome} onChange={(e) => setNome(e.target.value)} className={`${inputCls} w-full`} style={inputStyle} />
            </Campo>
            <Campo rotulo="E-mail do Workspace (azit.com.br / azitmove.com.br)">
              <input value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} w-full`} style={inputStyle} placeholder="nome@azit.com.br" />
            </Campo>
          </div>
          <div className="text-[11.5px]" style={{ color: foraDoWorkspace ? 'var(--warn-fg)' : 'var(--text-muted)' }}>
            {foraDoWorkspace
              ? 'Este e-mail está fora dos domínios da Azit: a pessoa NÃO vai conseguir entrar pelo Google — só com senha de reserva.'
              : 'A pessoa entra com a conta Google deste e-mail (os dois domínios são a mesma caixa). Nenhuma senha é necessária.'}
          </div>
          <SeletorPapeis valor={papeis} onChange={setPapeis} />
          <label className="flex items-center gap-[8px] text-[12.5px]" style={{ color: 'var(--text-primary)', opacity: souAdmin ? 1 : 0.5 }} title={souAdmin ? undefined : 'Só um administrador libera a entrada por senha'}>
            <input type="checkbox" checked={permiteSenha} disabled={!souAdmin} onChange={(e) => setPermiteSenha(e.target.checked)} />
            Permitir entrada por senha (reserva — só em caso excepcional)
          </label>
          {permiteSenha && (
            <Campo rotulo={`Senha inicial (mínimo ${SENHA_MINIMO_CARACTERES} caracteres)`}>
              <input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} className={`${inputCls} w-full sm:w-[260px]`} style={inputStyle} />
            </Campo>
          )}
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

// Painel expandido: nome, papéis, entrada (Google/senha/sessões), últimos acessos e exceções de área.
function PainelUsuario({ usuario, onMudou }: { usuario: UsuarioInterno; onMudou: () => void }) {
  const permissoes = useQuery({
    queryKey: ['usuario-permissoes', usuario.id],
    queryFn: () => usuarioService.permissoes(usuario.id),
  });
  const queryClient = useQueryClient();
  const souAdmin = usePodeRole()(['ADMIN']);
  const meuId = useAuthStore((s) => s.usuario?.id);
  const [papeis, setPapeis] = useState<string[]>(usuario.papeis);
  const [nome, setNome] = useState(usuario.nome);
  const [novaSenha, setNovaSenha] = useState('');
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [painel, setPainel] = useState<'areas' | 'acessos'>('areas');

  async function recarregar() {
    await queryClient.invalidateQueries({ queryKey: ['usuario-permissoes', usuario.id] });
    // Se a exceção foi no próprio usuário, menu/rotas/links refletem na hora.
    await queryClient.invalidateQueries({ queryKey: QUERY_ME_AREAS });
    onMudou();
  }

  // Nome: o PATCH /usuarios/:id sempre aceitou `nome`, mas a tela não tinha o campo
  // (Luís, 31/10: "preciso alterar nome dos usuários e não consigo, mesmo sendo admin").
  async function salvarNome() {
    setMsg(null);
    const limpo = nome.trim();
    if (limpo.length < 3) return setMsg('Informe o nome completo.');
    if (limpo === usuario.nome) return setMsg('O nome não mudou.');
    try {
      await usuarioService.atualizar(usuario.id, { nome: limpo });
      setMsg('Nome atualizado.');
      await recarregar();
    } catch (e) {
      setMsg(mensagemErro(e));
    }
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
    if (novaSenha.length < SENHA_MINIMO_CARACTERES) return setMsg(`A senha de reserva precisa de pelo menos ${SENHA_MINIMO_CARACTERES} caracteres.`);
    try {
      await usuarioService.redefinirSenha(usuario.id, novaSenha);
      setNovaSenha('');
      setMsg('Senha de reserva redefinida.');
      onMudou();
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
      <div className="flex flex-wrap items-end gap-[8px]">
        <Campo rotulo="Nome">
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={`${inputCls} w-full sm:w-[260px]`} style={{ ...inputStyle, background: 'var(--surface)' }} />
        </Campo>
        <Botao tamanho="sm" variante="secundaria" onClick={() => void salvarNome()} disabled={nome.trim() === usuario.nome}>Salvar nome</Botao>
      </div>
      <div className="flex flex-col gap-[6px]">
        <SeletorPapeis valor={papeis} onChange={setPapeis} />
        <div>
          <Botao tamanho="sm" variante="secundaria" onClick={() => void salvarPapeis()}>Salvar papéis</Botao>
        </div>
      </div>

      <EntradaUsuario usuario={usuario} souAdmin={souAdmin} ehEu={usuario.id === meuId} onMudou={onMudou} setMsg={setMsg}>
        {usuario.permiteSenha && (
          <div className="flex flex-wrap items-end gap-[8px]">
            <Campo rotulo={`Nova senha de reserva (mín. ${SENHA_MINIMO_CARACTERES})`}>
              <input type="password" autoComplete="new-password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} className={`${inputCls} w-full sm:w-[200px]`} style={{ ...inputStyle, background: 'var(--surface)' }} />
            </Campo>
            <Botao tamanho="sm" variante="secundaria" onClick={() => void redefinirSenha()}>
              {usuario.temSenha ? 'Redefinir senha' : 'Definir senha'}
            </Botao>
          </div>
        )}
      </EntradaUsuario>

      <Chips
        todos={null}
        tamanho="sm"
        itens={[
          { chave: 'areas', rotulo: 'Acesso por área' },
          { chave: 'acessos', rotulo: 'Últimos acessos' },
        ]}
        valor={painel}
        onChange={(k) => setPainel((k as 'areas' | 'acessos') ?? 'areas')}
      />

      {painel === 'acessos' ? (
        <AcessosUsuario usuarioId={usuario.id} />
      ) : (
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
      )}

      {msg && (
        <div className="rounded-[10px] p-[8px] text-[12px]" style={{ background: 'var(--info-bg)', color: 'var(--info-fg)' }}>{msg}</div>
      )}
    </div>
  );
}

// Entrada no sistema (doc 06 v1.1 §2): Google vinculado/pendente + religar; senha
// de reserva liga/desliga com motivo (modal); encerrar todas as sessões.
function EntradaUsuario({
  usuario, souAdmin, ehEu, onMudou, setMsg, children,
}: {
  usuario: UsuarioInterno; souAdmin: boolean; ehEu: boolean; onMudou: () => void; setMsg: (m: string | null) => void; children?: React.ReactNode;
}) {
  const [modalSenha, setModalSenha] = useState(false);
  const [motivoSenha, setMotivoSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [confirmacao, setConfirmacao] = useState<'religar' | 'sessoes' | null>(null);
  const entraPeloGoogle = ehEmailWorkspace(usuario.email);

  async function alternarPermiteSenha() {
    if (motivoSenha.trim().length < 5) return;
    setSalvando(true);
    try {
      const r = await usuarioService.definirPermiteSenha(usuario.id, { permiteSenha: !usuario.permiteSenha, motivo: motivoSenha.trim() });
      setModalSenha(false);
      setMotivoSenha('');
      if (r.permiteSenha && !r.temSenha) {
        toast.info('Entrada por senha ligada — este usuário ainda não tem senha: defina uma abaixo.');
      } else {
        toast.sucesso(r.permiteSenha ? 'Entrada por senha ligada.' : 'Entrada por senha desligada.');
      }
      onMudou();
    } catch (e) {
      setMsg(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  async function confirmar() {
    setSalvando(true);
    try {
      if (confirmacao === 'religar') {
        await usuarioService.religarGoogle(usuario.id);
        toast.sucesso('Vínculo com a conta Google zerado — o próximo acesso dele grava a conta atual.');
      } else if (confirmacao === 'sessoes') {
        const r = await usuarioService.encerrarSessoes(usuario.id);
        toast.sucesso(`${r.encerradas} sessão${r.encerradas === 1 ? '' : 'ões'} encerrada${r.encerradas === 1 ? '' : 's'} — cai em até 15 minutos em todos os dispositivos.`);
      }
      onMudou();
    } catch (e) {
      setMsg(mensagemErro(e));
    } finally {
      setSalvando(false);
      setConfirmacao(null);
    }
  }

  return (
    <Secao titulo="Entrada no sistema">
      <div className="flex flex-col gap-[10px] rounded-[10px] p-[10px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex flex-wrap items-center gap-[8px]">
          {entraPeloGoogle ? (
            <StatusBadge label={usuario.googleVinculado ? ROTULO_ENTRADA_USUARIO.googleVinculado : ROTULO_ENTRADA_USUARIO.googlePendente} colors={ENTRADA_USUARIO_COLORS} />
          ) : (
            <span className="text-[11.5px]" style={{ color: 'var(--warn-fg)' }}>E-mail fora dos domínios da Azit: não entra pelo Google.</span>
          )}
          <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            {entraPeloGoogle
              ? usuario.googleVinculado
                ? 'A conta Google foi vinculada no primeiro acesso. Se o e-mail foi recriado no Workspace, religue.'
                : 'A conta Google é vinculada no primeiro acesso pelo botão do Google.'
              : ''}
          </span>
          {souAdmin && entraPeloGoogle && usuario.googleVinculado && (
            <Botao tamanho="sm" variante="secundaria" onClick={() => setConfirmacao('religar')}>Religar conta Google</Botao>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-[8px]">
          <StatusBadge label={usuario.permiteSenha ? ROTULO_ENTRADA_USUARIO.senhaLigada : ROTULO_ENTRADA_USUARIO.senhaDesligada} colors={ENTRADA_USUARIO_COLORS} />
          <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            {usuario.permiteSenha
              ? usuario.temSenha ? 'Entra por senha de reserva além do Google.' : 'Ligada, mas ainda SEM senha definida — defina abaixo.'
              : 'Senha desligada (padrão): só entra pelo Google.'}
          </span>
          {souAdmin && (
            <Botao tamanho="sm" variante={usuario.permiteSenha ? 'perigo' : 'secundaria'} onClick={() => setModalSenha(true)}>
              {usuario.permiteSenha ? 'Desligar senha' : 'Ligar senha'}
            </Botao>
          )}
        </div>
        {children}

        <div className="flex flex-wrap items-center gap-[8px]">
          <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            Suspeita de acesso indevido ou troca de aparelho: encerre as sessões; em até 15 min ele precisa entrar de novo em todo lugar.
          </span>
          <Botao tamanho="sm" variante="perigo" onClick={() => setConfirmacao('sessoes')}>
            {ehEu ? 'Encerrar minhas sessões' : 'Encerrar todas as sessões'}
          </Botao>
        </div>
      </div>

      <Modal open={modalSenha} onClose={() => setModalSenha(false)} title={usuario.permiteSenha ? 'Desligar entrada por senha' : 'Ligar entrada por senha'} largura={440}>
        <div className="flex flex-col gap-[12px]">
          <div className="text-[13px] leading-relaxed" style={{ color: 'var(--text-body)' }}>
            {usuario.permiteSenha
              ? <>A senha de reserva de <b>{usuario.nome}</b> deixa de funcionar; ele continua entrando pelo Google. O motivo fica na auditoria.</>
              : <>A senha é uma <b>reserva</b> (pane do Workspace, conta de teste, caso excepcional) — não é a porta normal. Diga por que está ligando para <b>{usuario.nome}</b>; fica na auditoria.</>}
          </div>
          <Campo rotulo="Motivo (obrigatório)">
            <input value={motivoSenha} onChange={(e) => setMotivoSenha(e.target.value)} className={`${inputCls} w-full`} style={inputStyle} autoFocus placeholder="ex.: conta de serviço do homolog; Workspace fora do ar" />
          </Campo>
          <div className="flex flex-col-reverse gap-[8px] sm:flex-row sm:justify-end">
            <Botao variante="secundaria" onClick={() => setModalSenha(false)} disabled={salvando}>Cancelar</Botao>
            <Botao variante={usuario.permiteSenha ? 'perigo' : 'primaria'} onClick={() => void alternarPermiteSenha()} carregando={salvando} disabled={motivoSenha.trim().length < 5}>
              {usuario.permiteSenha ? 'Desligar senha' : 'Ligar senha'}
            </Botao>
          </div>
        </div>
      </Modal>

      <ModalConfirmacao
        open={confirmacao !== null}
        titulo={confirmacao === 'religar' ? 'Religar conta Google' : 'Encerrar todas as sessões'}
        confirmar={confirmacao === 'religar' ? 'Religar' : 'Encerrar sessões'}
        variante={confirmacao === 'religar' ? 'primaria' : 'perigo'}
        carregando={salvando}
        onConfirmar={() => void confirmar()}
        onCancelar={() => setConfirmacao(null)}
      >
        {confirmacao === 'religar'
          ? <>O vínculo atual de <b>{usuario.nome}</b> com a conta Google é apagado e as sessões dele encerradas. No próximo acesso pelo Google, a conta usada passa a ser a vinculada. Só faça isso se o e-mail foi recriado no Workspace.</>
          : <>Todas as sessões de <b>{usuario.nome}</b> serão encerradas; em até 15 minutos ele precisa entrar de novo em todos os dispositivos.{ehEu ? ' Isto inclui a sua sessão atual.' : ''}</>}
      </ModalConfirmacao>
    </Secao>
  );
}

// Últimos acessos do usuário (doc 06 §2.5) — com o motivo interno (visão do Admin).
function AcessosUsuario({ usuarioId }: { usuarioId: string }) {
  const dados = useQuery({ queryKey: ['usuario-acessos', usuarioId], queryFn: () => usuarioService.acessos(usuarioId) });
  return (
    <Secao titulo="Últimos acessos" tag={dados.data ? `${dados.data.sessoesAtivas} sessão${dados.data.sessoesAtivas === 1 ? '' : 'ões'} válida${dados.data.sessoesAtivas === 1 ? '' : 's'} · últimas 50 tentativas` : undefined}>
      <Tabela
        colunas={colunasAcesso({ comMotivo: true })}
        linhas={dados.data?.acessos ?? []}
        chave={(a) => a.id}
        carregando={dados.isLoading}
        larguraMinima={760}
        vazio={dados.isError ? mensagemErro(dados.error) : 'Nenhum acesso registrado ainda.'}
      />
    </Secao>
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
      // A matriz vale para quem está logado também: menu/rotas/links refletem na hora.
      await queryClient.invalidateQueries({ queryKey: QUERY_ME_AREAS });
    } catch (e) {
      // Inclui o 422 do auto-bloqueio (doc 06 §13.3): "deixaria o sistema sem administrador com Configurações".
      toast.erro(mensagemErro(e));
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
        papel, exceto onde houver exceção individual. O sistema nunca fica sem um administrador ativo com
        a área Configurações — a alteração que causaria isso é recusada.
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
  // Só administrador dá ou tira o papel de administrador (07/11) — o backend recusa; a tela já trava.
  const souAdmin = usePodeRole()(['ADMIN']);
  return (
    <div>
      <div className="mb-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Papéis</div>
      <div className="flex flex-wrap gap-[10px]">
        {PAPEIS.map((papel) => (
          <label
            key={papel}
            className="flex min-h-[30px] items-center gap-[5px] text-[12.5px]"
            style={{ color: 'var(--text-primary)', opacity: papel === 'ADMIN' && !souAdmin ? 0.5 : 1 }}
            title={papel === 'ADMIN' && !souAdmin ? 'Só um administrador concede ou retira este papel' : undefined}
          >
            <input
              type="checkbox"
              disabled={papel === 'ADMIN' && !souAdmin}
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
