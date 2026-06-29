import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { originacaoService } from '../services/originacao.service';
import { StatusBadge } from '../components/StatusBadge';
import { PROPOSTA_STATUS_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, ROLE_PARECER, mensagemErro } from '../lib/permissoes';

const LABEL_STATUS: Record<string, string> = {
  pendente: 'Pendente', em_analise: 'Em análise', aprovada: 'Aprovada',
  reprovada: 'Reprovada', em_formalizacao: 'Em formalização', convertida: 'Convertida', cancelada: 'Cancelada',
};
const PAPEL_LABEL: Record<string, string> = {
  comprador_principal: 'Comprador principal', comprador_secundario: 'Comprador secundário', garantidor: 'Garantidor',
};
const DOC_LABEL: Record<string, string> = {
  cnh: 'CNH', comprovante_endereco: 'Comp. endereço', comprovante_renda: 'Comp. renda', relatorio_brick: 'Relatório Brick', outro: 'Outro',
};

const card = { background: 'var(--surface)', border: '1px solid var(--border)' };
const inputCls = 'h-[34px] rounded-[8px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' };
const btn = (bg: string) => ({ background: bg, color: '#fff' });

export function PropostaDetalhePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pode = usePodeRole();
  const podeOperar = pode(ROLE_OPERACAO);
  const podeParecer = pode(ROLE_PARECER);
  const [ocupado, setOcupado] = useState(false);
  const [documento, setDocumento] = useState<string>('');

  // forms
  const [garNome, setGarNome] = useState(''); const [garCpf, setGarCpf] = useState(''); const [garZap, setGarZap] = useState('');
  const [docTitular, setDocTitular] = useState(''); const [docTipo, setDocTipo] = useState('cnh');
  const [resultado, setResultado] = useState('aprovado'); const [exigeGar, setExigeGar] = useState(false); const [motivo, setMotivo] = useState('');

  const q = useQuery({ queryKey: ['proposta', id], queryFn: () => originacaoService.detalheProposta(id), enabled: !!id });
  const p = q.data;

  async function run(fn: () => Promise<unknown>) {
    setOcupado(true);
    try { await fn(); await queryClient.invalidateQueries({ queryKey: ['proposta', id] }); await queryClient.invalidateQueries({ queryKey: ['propostas'] }); }
    catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
  }

  if (q.isLoading || !p) return <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>;

  const podeFormalizar = ['aprovada', 'em_formalizacao'].includes(p.status) && !p.contratoGeradoId;

  return (
    <div className="flex flex-col gap-[16px]">
      <button onClick={() => navigate('/originacao')} className="self-start text-[12.5px]" style={{ color: 'var(--text-muted)' }}>← Voltar para Originação</button>

      {/* Cabeçalho */}
      <div className="rounded-card p-[18px]" style={card}>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-[16px] font-bold">{p.titular.nome}</div>
            <div className="text-[12px]" style={{ color: 'var(--text-body)' }}>{p.ativo.descricao} · CPF {p.titular.cpfCnpj}</div>
          </div>
          <StatusBadge label={LABEL_STATUS[p.status] ?? p.status} colors={PROPOSTA_STATUS_COLORS} />
        </div>
        <div className="mt-[12px] flex gap-[24px] text-[12.5px]">
          <span style={{ color: 'var(--text-label)' }}>Entrada <b style={{ color: 'var(--text-primary)' }}>{formatCurrency(p.valorEntrada)}</b></span>
          <span style={{ color: 'var(--text-label)' }}>Parcelas <b style={{ color: 'var(--text-primary)' }}>{p.numeroParcelas}× {formatCurrency(p.valorParcela)}</b></span>
          <span style={{ color: 'var(--text-label)' }}>Prazo <b style={{ color: 'var(--text-primary)' }}>{p.prazoSemanas} sem</b></span>
        </div>
        {/* Transições */}
        {podeOperar && (
          <div className="mt-[14px] flex flex-wrap gap-[8px]">
            {p.status === 'pendente' && (
              <button disabled={ocupado} onClick={() => run(() => originacaoService.patchStatus(id, 'em_analise'))}
                className="h-[32px] rounded-[8px] px-[14px] text-[12px] font-semibold" style={btn('var(--navy)')}>Enviar para análise</button>
            )}
            {['pendente', 'em_analise', 'aprovada'].includes(p.status) && (
              <button disabled={ocupado} onClick={() => run(() => originacaoService.patchStatus(id, 'cancelada'))}
                className="h-[32px] rounded-[8px] px-[14px] text-[12px] font-semibold" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>Cancelar</button>
            )}
            {podeFormalizar && (
              <button disabled={ocupado} onClick={() => run(async () => { const r = await originacaoService.formalizar(id); setDocumento(r.documento); })}
                className="h-[32px] rounded-[8px] px-[14px] text-[12px] font-semibold" style={btn('var(--accent)')}>Formalizar (gerar contrato)</button>
            )}
            {p.status === 'convertida' && p.contratoGeradoId && (
              <>
                <button disabled={ocupado} onClick={() => run(() => originacaoService.ativar(p.contratoGeradoId!))}
                  className="h-[32px] rounded-[8px] px-[14px] text-[12px] font-semibold" style={btn('var(--navy)')}>Ativar (cobrar entrada)</button>
                <button disabled={ocupado} onClick={() => run(() => originacaoService.simularPagamentoAtivacao(p.contratoGeradoId!))}
                  className="h-[32px] rounded-[8px] px-[14px] text-[12px] font-semibold" style={btn('var(--accent)')}>Simular pagamento (dev)</button>
                <button onClick={() => navigate(`/contratos/${p.contratoGeradoId}`)}
                  className="h-[32px] rounded-[8px] px-[14px] text-[12px] font-semibold" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>Abrir contrato</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Papéis */}
      <div className="rounded-card p-[18px]" style={card}>
        <div className="mb-[10px] font-display text-[13px] font-bold">Papéis</div>
        <div className="flex flex-col gap-[6px]">
          {p.papeis.map((v) => (
            <div key={v.id} className="flex items-center gap-[10px] text-[12.5px]">
              <span className="rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>{PAPEL_LABEL[v.papel] ?? v.papel}</span>
              <span>{v.titular.nome} · CPF {v.titular.cpfCnpj}</span>
            </div>
          ))}
        </div>
        {podeOperar && p.status !== 'convertida' && (
          <div className="mt-[12px] flex flex-wrap items-end gap-[10px]">
            <input value={garNome} onChange={(e) => setGarNome(e.target.value)} placeholder="Nome garantidor" className={`${inputCls} w-[180px]`} style={inputStyle} />
            <input value={garCpf} onChange={(e) => setGarCpf(e.target.value)} placeholder="CPF" className={`${inputCls} w-[140px]`} style={inputStyle} />
            <input value={garZap} onChange={(e) => setGarZap(e.target.value)} placeholder="WhatsApp" className={`${inputCls} w-[140px]`} style={inputStyle} />
            <button disabled={ocupado || !garNome || !garCpf}
              onClick={() => run(async () => { await originacaoService.adicionarVinculo(id, 'garantidor', { nome: garNome, cpfCnpj: garCpf, whatsapp: garZap || '11999999999', tipoPessoa: 'pf' }); setGarNome(''); setGarCpf(''); setGarZap(''); })}
              className="h-[34px] rounded-[8px] px-[12px] text-[12px] font-semibold" style={btn('var(--navy)')}>+ Garantidor</button>
          </div>
        )}
      </div>

      {/* Documentos + Parecer */}
      <div className="rounded-card p-[18px]" style={card}>
        <div className="mb-[10px] font-display text-[13px] font-bold">Análise documental</div>
        <div className="flex flex-col gap-[6px]">
          {p.documentos.length === 0 && <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum documento anexado.</div>}
          {p.documentos.map((d) => (
            <div key={d.id} className="text-[12.5px]">📎 {DOC_LABEL[d.tipo] ?? d.tipo} — {d.arquivoRef}</div>
          ))}
        </div>
        {podeOperar && p.status !== 'convertida' && (
          <div className="mt-[12px] flex flex-wrap items-end gap-[10px]">
            <select value={docTitular} onChange={(e) => setDocTitular(e.target.value)} className={`${inputCls} w-[200px]`} style={inputStyle}>
              <option value="">Titular (papel)…</option>
              {p.papeis.map((v) => <option key={v.titular.id} value={v.titular.id}>{v.titular.nome}</option>)}
            </select>
            <select value={docTipo} onChange={(e) => setDocTipo(e.target.value)} className={`${inputCls} w-[170px]`} style={inputStyle}>
              {Object.entries(DOC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button disabled={ocupado || !docTitular}
              onClick={() => run(() => originacaoService.anexarDocumento(id, docTitular, docTipo))}
              className="h-[34px] rounded-[8px] px-[12px] text-[12px] font-semibold" style={btn('var(--navy)')}>Anexar (mock)</button>
          </div>
        )}

        {/* Parecer */}
        <div className="mt-[16px] border-t pt-[14px]" style={{ borderColor: 'var(--border)' }}>
          {p.parecer ? (
            <div className="text-[12.5px]">
              Parecer: <b>{p.parecer.resultado}</b>{p.parecer.exigeGarantidor ? ' · exige garantidor' : ''}{p.parecer.motivoReprovacao ? ` · ${p.parecer.motivoReprovacao}` : ''}
            </div>
          ) : podeParecer && ['pendente', 'em_analise'].includes(p.status) ? (
            <div className="flex flex-wrap items-end gap-[10px]">
              <select value={resultado} onChange={(e) => setResultado(e.target.value)} className={`${inputCls} w-[200px]`} style={inputStyle}>
                <option value="aprovado">Aprovado</option>
                <option value="aprovado_com_ressalvas">Aprovado com ressalvas</option>
                <option value="reprovado">Reprovado</option>
              </select>
              <label className="flex items-center gap-[6px] text-[12px]"><input type="checkbox" checked={exigeGar} onChange={(e) => setExigeGar(e.target.checked)} /> exige garantidor</label>
              {resultado === 'reprovado' && <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" className={`${inputCls} w-[200px]`} style={inputStyle} />}
              <button disabled={ocupado}
                onClick={() => run(() => originacaoService.registrarParecer(id, { resultado, exigeGarantidor: exigeGar, motivoReprovacao: motivo || undefined }))}
                className="h-[34px] rounded-[8px] px-[14px] text-[12px] font-semibold" style={btn('var(--accent)')}>Registrar parecer</button>
            </div>
          ) : (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Sem parecer.</div>
          )}
        </div>
      </div>

      {/* Documento gerado (após formalização) */}
      {documento && (
        <div className="rounded-card p-[18px]" style={card}>
          <div className="mb-[10px] font-display text-[13px] font-bold">Documento gerado (assinatura mock)</div>
          <pre className="whitespace-pre-wrap text-[11.5px]" style={{ color: 'var(--text-body)' }}>{documento}</pre>
        </div>
      )}
    </div>
  );
}
