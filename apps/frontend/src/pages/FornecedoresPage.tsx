import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { financeiroService, FornecedorFinanceiro } from '../services/financeiro.service';
import { rotuloStatus, ROTULO_STATUS_FORNECEDOR } from '../lib/rotulos';
import { mascararCpfCnpj, somenteDigitos } from '../lib/mascaras';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { mensagemErro } from '../lib/permissoes';

// Fornecedores do contas a pagar (FA-CP-01): Financeiro cadastra, Diretor aprova
// na Central; dados bancários VERSIONADOS; alerta no 1º pagamento após alteração.

const card = 'rounded-[14px] p-[16px]';
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputCls = 'h-[34px] w-full rounded-[8px] px-[10px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;
const btn = 'rounded-[8px] px-[12px] py-[7px] text-[12px] font-bold';
const btnP = `${btn} bg-[var(--navy)] text-white disabled:opacity-40`;
const btnS = `${btn} border border-[var(--border)]`;

const COR: Record<string, { bg: string; fg: string }> = {
  ATIVO: { bg: '#e5f5ec', fg: '#1c7c4c' },
  AGUARDANDO_APROVACAO: { bg: '#fff3d6', fg: '#8a5a00' },
  EM_CADASTRO: { bg: '#f2f3f5', fg: '#5a6472' },
  BLOQUEADO: { bg: '#fdecec', fg: '#a12622' },
  INATIVO: { bg: '#f2f3f5', fg: '#5a6472' },
};

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

  return (
    <div className="flex flex-col gap-[14px] p-[24px]">
      <div className="flex flex-wrap items-end justify-between gap-[10px]">
        <div>
          <h1 className="font-display text-[20px] font-bold">Fornecedores</h1>
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Cadastro mestre das contrapartes. Quem cadastra não ativa: a ativação e toda alteração
            bancária passam pela aprovação do Diretor na Central. Fornecedor com histórico nunca é excluído.
          </p>
        </div>
        <button className={btnP} onClick={() => setCriando(true)}>+ Novo fornecedor</button>
      </div>

      {fornecedores.isLoading ? (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
      ) : (fornecedores.data ?? []).length === 0 ? (
        <div className={card} style={cardStyle}><span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Nenhum fornecedor cadastrado.</span></div>
      ) : (
        (fornecedores.data ?? []).map((f) => (
          <div key={f.id} className={card} style={cardStyle}>
            <div className="flex flex-wrap items-center justify-between gap-[8px]">
              <div>
                <span className="font-display text-[14px] font-bold">{f.nome}</span>
                <span className="ml-[8px] rounded-full px-[9px] py-[2px] text-[11px] font-bold" style={{ background: (COR[f.status] ?? COR.EM_CADASTRO).bg, color: (COR[f.status] ?? COR.EM_CADASTRO).fg }}>
                  {rotuloStatus(f.status)}
                </span>
                {f.alertaProximoPagamento && (
                  <span className="ml-[6px] rounded-full px-[8px] py-[1px] text-[10.5px] font-bold" style={{ background: '#fff3d6', color: '#8a5a00' }}>
                    Conferir no próximo pagamento (alteração bancária)
                  </span>
                )}
                <div className="mt-[2px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                  {mascararCpfCnpj(f.cpfCnpj)}{f.contato ? ` · ${f.contato}` : ''}{f.email ? ` · ${f.email}` : ''}
                </div>
              </div>
              <div className="flex flex-wrap gap-[6px]">
                <button className={btnS} onClick={() => setAbertoId(abertoId === f.id ? null : f.id)}>{abertoId === f.id ? 'Fechar' : 'Dados bancários'}</button>
                <button className={btnS} disabled={ocupado} onClick={() => setAlterando(f)}>Alterar dados bancários</button>
                {f.status === 'ATIVO' && <button className={btnS} disabled={ocupado} onClick={() => mudarStatus(f, 'BLOQUEADO')}>Bloquear</button>}
                {f.status === 'BLOQUEADO' && <button className={btnS} disabled={ocupado} onClick={() => mudarStatus(f, 'ATIVO')}>Desbloquear</button>}
                {f.status === 'ATIVO' && <button className={btnS} disabled={ocupado} onClick={() => mudarStatus(f, 'INATIVO')}>Inativar</button>}
              </div>
            </div>
            {abertoId === f.id && (
              <div className="mt-[8px] flex flex-col gap-[4px]">
                {f.dadosBancarios.map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded-[8px] px-[10px] py-[6px] text-[12.5px]" style={{ background: 'var(--surface-input)' }}>
                    <span>
                      <b>Versão {d.versao}</b>{d.ativo ? ' · vigente' : ' · histórica'} — {[d.banco, d.agencia && `ag ${d.agencia}`, d.conta && `c/c ${d.conta}`, d.chavePix && `Pix ${d.chavePix}`].filter(Boolean).join(' · ') || 'sem dados'}
                      {d.motivo ? ` · ${d.motivo}` : ''}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>{new Date(d.criadoEm).toLocaleDateString('pt-BR')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
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
        <label className="text-[12px] font-semibold">CPF / CNPJ
          <input className={inputCls} style={inputStyle} inputMode="numeric" value={f.cpfCnpj} onChange={(e) => setF({ ...f, cpfCnpj: mascararCpfCnpj(e.target.value) })} /></label>
        <label className="text-[12px] font-semibold">Nome / razão social
          <input className={inputCls} style={inputStyle} value={f.nome} onChange={set('nome')} /></label>
        <div className="grid grid-cols-2 gap-[8px]">
          <label className="text-[12px] font-semibold">Contato
            <input className={inputCls} style={inputStyle} value={f.contato} onChange={set('contato')} /></label>
          <label className="text-[12px] font-semibold">E-mail
            <input className={inputCls} style={inputStyle} value={f.email} onChange={set('email')} /></label>
        </div>
        <div className="text-[12px] font-bold">Dados de pagamento (versão 1 — ativados junto com o fornecedor)</div>
        <div className="grid grid-cols-2 gap-[8px]">
          <label className="text-[12px] font-semibold">Banco
            <input className={inputCls} style={inputStyle} value={f.banco} onChange={set('banco')} /></label>
          <label className="text-[12px] font-semibold">Agência
            <input className={inputCls} style={inputStyle} value={f.agencia} onChange={set('agencia')} /></label>
          <label className="text-[12px] font-semibold">Conta
            <input className={inputCls} style={inputStyle} value={f.conta} onChange={set('conta')} /></label>
          <label className="text-[12px] font-semibold">Chave Pix
            <input className={inputCls} style={inputStyle} value={f.chavePix} onChange={set('chavePix')} /></label>
        </div>
        {erro && <div className="rounded-[8px] p-[8px] text-[12px]" style={{ background: '#fdecec', color: '#a12622' }}>{erro}</div>}
        <div className="flex justify-end gap-[8px]">
          <button className={btnS} onClick={fechar}>Cancelar</button>
          <button className={btnP} disabled={ocupado || somenteDigitos(f.cpfCnpj).length < 11 || f.nome.trim().length < 2} onClick={criar}>
            Cadastrar e enviar para aprovação
          </button>
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
        <div className="rounded-[8px] p-[8px] text-[12px] font-semibold" style={{ background: '#fff3d6', color: '#8a5a00' }}>
          Troca de conta é o momento de maior risco de fraude: a versão anterior fica preservada, a nova só vale
          com aprovação do Diretor, e o primeiro pagamento seguinte é sinalizado para conferência.
        </div>
        <div className="grid grid-cols-2 gap-[8px]">
          <label className="text-[12px] font-semibold">Banco
            <input className={inputCls} style={inputStyle} value={f.banco} onChange={set('banco')} /></label>
          <label className="text-[12px] font-semibold">Agência
            <input className={inputCls} style={inputStyle} value={f.agencia} onChange={set('agencia')} /></label>
          <label className="text-[12px] font-semibold">Conta
            <input className={inputCls} style={inputStyle} value={f.conta} onChange={set('conta')} /></label>
          <label className="text-[12px] font-semibold">Chave Pix
            <input className={inputCls} style={inputStyle} value={f.chavePix} onChange={set('chavePix')} /></label>
        </div>
        <label className="text-[12px] font-semibold">Motivo da alteração (obrigatório — vai para a auditoria)
          <input className={inputCls} style={inputStyle} value={f.motivo} onChange={set('motivo')} /></label>
        {erro && <div className="rounded-[8px] p-[8px] text-[12px]" style={{ background: '#fdecec', color: '#a12622' }}>{erro}</div>}
        <div className="flex justify-end gap-[8px]">
          <button className={btnS} onClick={fechar}>Cancelar</button>
          <button className={btnP} disabled={ocupado || f.motivo.trim().length < 3} onClick={salvar}>Criar nova versão</button>
        </div>
      </div>
    </Modal>
  );
}
