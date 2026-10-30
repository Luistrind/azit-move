import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { financeiroService, FornecedorFinanceiro } from '../services/financeiro.service';
import { rotuloStatus, ROTULO_STATUS_FORNECEDOR } from '../lib/rotulos';
import { mascararCpfCnpj, somenteDigitos } from '../lib/mascaras';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { Tabela, type Coluna } from '../components/Tabela';
import { Botao } from '../components/Botao';
import { Bloco } from '../components/Bloco';
import { FORNECEDOR_STATUS_COLORS } from '../config/statusColors';
import { mensagemErro } from '../lib/permissoes';
import { instanteBR } from '../lib/datas';

// Fornecedores do contas a pagar (FA-CP-01): Financeiro cadastra, Diretor aprova
// na Central; dados bancários VERSIONADOS; alerta no 1º pagamento após alteração.
// Layout v2 (doc 03 §11): lista em <Tabela>, versões bancárias do fornecedor
// aberto em um <Bloco> abaixo da grade.

const inputCls = 'h-[34px] w-full rounded-[10px] px-[10px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
const lblCls = 'flex flex-col gap-[4px] text-[12px] font-semibold';

function SeloStatus({ status }: { status: string }) {
  const c = FORNECEDOR_STATUS_COLORS[status] ?? FORNECEDOR_STATUS_COLORS.EM_CADASTRO;
  return (
    <span className="whitespace-nowrap rounded-full px-[9px] py-[2px] text-[11px] font-bold" style={{ background: c.bg, color: c.fg }}>
      {rotuloStatus(status)}
    </span>
  );
}

export function FornecedoresPage() {
  const qc = useQueryClient();
  const fornecedores = useQuery({ queryKey: ['fin-fornecedores'], queryFn: () => financeiroService.fornecedores() });
  const [criando, setCriando] = useState(false);
  const [alterando, setAlterando] = useState<FornecedorFinanceiro | null>(null);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function recarregar() {
    await qc.invalidateQueries({ queryKey: ['fin-fornecedores'] });
    await qc.invalidateQueries({ queryKey: ['aprovacoes-contagem'] });
  }

  async function mudarStatus(f: FornecedorFinanceiro, status: string) {
    setOcupado(true);
    try {
      await financeiroService.statusFornecedor(f.id, status, status === 'BLOQUEADO' ? 'Bloqueio manual' : undefined);
      await recarregar();
      toast.sucesso(`Fornecedor ${ROTULO_STATUS_FORNECEDOR[status]?.toLowerCase() ?? status}.`);
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  const lista = fornecedores.data ?? [];
  const aberto = lista.find((f) => f.id === abertoId) ?? null;
  const vigente = (f: FornecedorFinanceiro) => f.dadosBancarios.find((d) => d.ativo) ?? f.dadosBancarios[0];
  const resumoBanco = (d?: FornecedorFinanceiro['dadosBancarios'][number]) =>
    d ? [d.banco, d.agencia && `ag ${d.agencia}`, d.conta && `c/c ${d.conta}`, d.chavePix && `Pix ${d.chavePix}`].filter(Boolean).join(' · ') || 'sem dados' : '—';

  const colunas: Coluna<FornecedorFinanceiro>[] = [
    {
      chave: 'nome',
      titulo: 'Fornecedor',
      celular: 'titulo',
      render: (f) => (
        <span className="inline-flex flex-wrap items-center gap-[6px]">
          {f.nome}
          {f.alertaProximoPagamento && (
            <span className="rounded-full px-[8px] py-[1px] text-[10.5px] font-bold" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }} title="Alteração bancária recente">
              Conferir no próximo pagamento
            </span>
          )}
        </span>
      ),
    },
    { chave: 'doc', titulo: 'CPF / CNPJ', celular: 'subtitulo', classe: 'tabular-nums', render: (f) => mascararCpfCnpj(f.cpfCnpj) },
    { chave: 'contato', titulo: 'Contato', celular: 'campo', render: (f) => [f.contato, f.email].filter(Boolean).join(' · ') || '—' },
    { chave: 'banco', titulo: 'Dados de pagamento', celular: 'campo', render: (f) => resumoBanco(vigente(f)) },
    { chave: 'status', titulo: 'Situação', celular: 'campo', render: (f) => <SeloStatus status={f.status} /> },
  ];

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <p className="m-0 max-w-[720px] text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Cadastro mestre das contrapartes. Quem cadastra não ativa: a ativação e toda alteração
          bancária passam pela aprovação do Diretor na Central. Fornecedor com histórico nunca é excluído.
        </p>
        <Botao variante="primaria" onClick={() => setCriando(true)}>+ Novo fornecedor</Botao>
      </div>

      <Tabela
        colunas={colunas}
        linhas={lista}
        chave={(f) => f.id}
        carregando={fornecedores.isLoading}
        vazio="Nenhum fornecedor cadastrado."
        larguraMinima={760}
        onClick={(f) => setAbertoId(abertoId === f.id ? null : f.id)}
        acoes={(f) => (
          <>
            <Botao tamanho="sm" onClick={() => setAbertoId(abertoId === f.id ? null : f.id)}>{abertoId === f.id ? 'Fechar' : 'Dados bancários'}</Botao>
            <Botao tamanho="sm" disabled={ocupado} onClick={() => setAlterando(f)}>Alterar dados bancários</Botao>
            {f.status === 'ATIVO' && <Botao tamanho="sm" variante="perigo" disabled={ocupado} onClick={() => mudarStatus(f, 'BLOQUEADO')}>Bloquear</Botao>}
            {f.status === 'BLOQUEADO' && <Botao tamanho="sm" disabled={ocupado} onClick={() => mudarStatus(f, 'ATIVO')}>Desbloquear</Botao>}
            {f.status === 'ATIVO' && <Botao tamanho="sm" disabled={ocupado} onClick={() => mudarStatus(f, 'INATIVO')}>Inativar</Botao>}
          </>
        )}
      />

      {aberto && (
        <Bloco titulo={`Dados bancários — ${aberto.nome}`} tag={`${aberto.dadosBancarios.length} ${aberto.dadosBancarios.length === 1 ? 'versão' : 'versões'}`}>
          <div className="flex flex-col gap-[4px]">
            {aberto.dadosBancarios.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-[6px] rounded-[10px] px-[10px] py-[6px] text-[12.5px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
                <span>
                  <b>Versão {d.versao}</b>{d.ativo ? ' · vigente' : ' · histórica'} — {resumoBanco(d)}
                  {d.motivo ? ` · ${d.motivo}` : ''}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>{instanteBR(d.criadoEm)}</span>
              </div>
            ))}
          </div>
        </Bloco>
      )}

      {criando && <ModalFornecedor fechar={() => setCriando(false)} onCriou={async () => { setCriando(false); await recarregar(); }} />}
      {alterando && <ModalAlteracaoBancaria fornecedor={alterando} fechar={() => setAlterando(null)} onCriou={async () => { setAlterando(null); await recarregar(); }} />}
    </div>
  );
}

function ModalFornecedor({ fechar, onCriou }: { fechar: () => void; onCriou: () => Promise<void> }) {
  const [f, setF] = useState({ cpfCnpj: '', nome: '', contato: '', email: '', banco: '', agencia: '', conta: '', chavePix: '' });
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const set = (campo: string) => (e: { target: { value: string } }) => setF({ ...f, [campo]: e.target.value });

  async function criar() {
    setErro(null);
    setOcupado(true);
    try {
      await financeiroService.criarFornecedor({
        cpfCnpj: somenteDigitos(f.cpfCnpj), nome: f.nome.trim(), contato: f.contato || undefined, email: f.email || undefined,
        banco: f.banco || undefined, agencia: f.agencia || undefined, conta: f.conta || undefined, chavePix: f.chavePix || undefined,
      });
      await onCriou();
      toast.sucesso('Fornecedor cadastrado — ativação aguarda aprovação do Diretor na Central.');
    } catch (e) { setErro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  return (
    <Modal open onClose={fechar} title="Novo fornecedor">
      <div className="flex flex-col gap-[8px]">
        <label className={lblCls}>CPF / CNPJ
          <input className={inputCls} style={inputStyle} inputMode="numeric" value={f.cpfCnpj} onChange={(e) => setF({ ...f, cpfCnpj: mascararCpfCnpj(e.target.value) })} /></label>
        <label className={lblCls}>Nome / razão social
          <input className={inputCls} style={inputStyle} value={f.nome} onChange={set('nome')} /></label>
        <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
          <label className={lblCls}>Contato
            <input className={inputCls} style={inputStyle} value={f.contato} onChange={set('contato')} /></label>
          <label className={lblCls}>E-mail
            <input className={inputCls} style={inputStyle} value={f.email} onChange={set('email')} /></label>
        </div>
        <div className="text-[12px] font-bold">Dados de pagamento (versão 1 — ativados junto com o fornecedor)</div>
        <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
          <label className={lblCls}>Banco
            <input className={inputCls} style={inputStyle} value={f.banco} onChange={set('banco')} /></label>
          <label className={lblCls}>Agência
            <input className={inputCls} style={inputStyle} value={f.agencia} onChange={set('agencia')} /></label>
          <label className={lblCls}>Conta
            <input className={inputCls} style={inputStyle} value={f.conta} onChange={set('conta')} /></label>
          <label className={lblCls}>Chave Pix
            <input className={inputCls} style={inputStyle} value={f.chavePix} onChange={set('chavePix')} /></label>
        </div>
        {erro && <div className="rounded-[10px] p-[8px] text-[12px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>{erro}</div>}
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao onClick={fechar}>Cancelar</Botao>
          <Botao variante="primaria" carregando={ocupado} disabled={somenteDigitos(f.cpfCnpj).length < 11 || f.nome.trim().length < 2} onClick={criar}>
            Cadastrar e enviar para aprovação
          </Botao>
        </div>
      </div>
    </Modal>
  );
}

function ModalAlteracaoBancaria({ fornecedor, fechar, onCriou }: { fornecedor: FornecedorFinanceiro; fechar: () => void; onCriou: () => Promise<void> }) {
  const [f, setF] = useState({ banco: '', agencia: '', conta: '', chavePix: '', motivo: '' });
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const set = (campo: string) => (e: { target: { value: string } }) => setF({ ...f, [campo]: e.target.value });

  async function salvar() {
    setErro(null);
    setOcupado(true);
    try {
      await financeiroService.alterarDadosBancarios(fornecedor.id, {
        banco: f.banco || undefined, agencia: f.agencia || undefined, conta: f.conta || undefined, chavePix: f.chavePix || undefined, motivo: f.motivo.trim(),
      });
      await onCriou();
      toast.sucesso('Nova versão criada — só vale após a aprovação do Diretor; o próximo pagamento terá alerta.');
    } catch (e) { setErro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  return (
    <Modal open onClose={fechar} title={`Alterar dados bancários — ${fornecedor.nome}`}>
      <div className="flex flex-col gap-[8px]">
        <div className="rounded-[10px] p-[8px] text-[12px] font-semibold" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
          Troca de conta é o momento de maior risco de fraude: a versão anterior fica preservada, a nova só vale
          com aprovação do Diretor, e o primeiro pagamento seguinte é sinalizado para conferência.
        </div>
        <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
          <label className={lblCls}>Banco
            <input className={inputCls} style={inputStyle} value={f.banco} onChange={set('banco')} /></label>
          <label className={lblCls}>Agência
            <input className={inputCls} style={inputStyle} value={f.agencia} onChange={set('agencia')} /></label>
          <label className={lblCls}>Conta
            <input className={inputCls} style={inputStyle} value={f.conta} onChange={set('conta')} /></label>
          <label className={lblCls}>Chave Pix
            <input className={inputCls} style={inputStyle} value={f.chavePix} onChange={set('chavePix')} /></label>
        </div>
        <label className={lblCls}>Motivo da alteração (obrigatório — vai para a auditoria)
          <input className={inputCls} style={inputStyle} value={f.motivo} onChange={set('motivo')} /></label>
        {erro && <div className="rounded-[10px] p-[8px] text-[12px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>{erro}</div>}
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Botao onClick={fechar}>Cancelar</Botao>
          <Botao variante="primaria" carregando={ocupado} disabled={f.motivo.trim().length < 3} onClick={salvar}>Criar nova versão</Botao>
        </div>
      </div>
    </Modal>
  );
}
