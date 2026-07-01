import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { titularService, AtualizarTitularBody } from '../services/titular.service';
import { StatusBadge } from '../components/StatusBadge';
import { CONTRATO_STATUS_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, mensagemErro } from '../lib/permissoes';

const inputCls = 'h-[34px] rounded-[8px] px-[10px] text-[12.5px]';
const inStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' };
const Lbl = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>{children}</span>
);
const soNumeros = (s: string) => /\d/.test(s) && !/[a-zA-Z]/.test(s);

export function TitularPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pode = usePodeRole();
  const podeEditar = pode(ROLE_OPERACAO);
  const [ocupado, setOcupado] = useState(false);
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<AtualizarTitularBody>({});

  const lista = useQuery({
    queryKey: ['titulares', termo],
    queryFn: () => titularService.listar(soNumeros(termo) ? { cpfCnpj: termo } : termo ? { nome: termo } : {}),
  });
  const ficha = useQuery({
    queryKey: ['titular-ficha', selId],
    queryFn: () => titularService.ficha(selId!),
    enabled: !!selId,
  });
  const set = (k: keyof AtualizarTitularBody) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function abrir(id: string) { setSelId(id); setEditando(false); }

  function iniciarEdicao() {
    const t = ficha.data?.titular;
    if (!t) return;
    setForm({
      nome: t.nome, rg: t.rg ?? '', estadoCivil: t.estadoCivil ?? '', profissao: t.profissao ?? '',
      whatsapp: t.whatsapp, email: t.email ?? '', endereco: t.endereco ?? '', bairro: t.bairro ?? '',
      cidade: t.cidade ?? '', estado: t.estado ?? '', cep: t.cep ?? '',
    });
    setEditando(true);
  }

  async function salvar() {
    if (!selId) return;
    // Não envia strings vazias (campos opcionais como e-mail falhariam a validação).
    const limpo: AtualizarTitularBody = {};
    for (const [k, v] of Object.entries(form)) {
      if (typeof v === 'string' && v.trim() !== '') (limpo as Record<string, string>)[k] = v.trim();
    }
    setOcupado(true);
    try {
      await titularService.atualizar(selId, limpo);
      setEditando(false);
      await queryClient.invalidateQueries({ queryKey: ['titular-ficha', selId] });
      await queryClient.invalidateQueries({ queryKey: ['titulares'] });
    } catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
  }

  const f = ficha.data;

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex items-center gap-[10px]">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setTermo(busca)}
          placeholder="Buscar por nome ou CPF" className={`${inputCls} w-[260px]`} style={inStyle} />
        <button onClick={() => setTermo(busca)} className="h-[34px] rounded-[8px] px-[14px] text-[12.5px] font-semibold" style={{ background: 'var(--navy)', color: '#fff' }}>Buscar</button>
      </div>

      <div className="grid grid-cols-[1fr_1.4fr] gap-[16px]">
        {/* Lista */}
        <div className="rounded-card overflow-hidden self-start" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
                <th className="px-[14px] py-[10px] text-left font-semibold">Nome</th>
                <th className="px-[14px] py-[10px] text-left font-semibold">CPF/CNPJ</th>
              </tr>
            </thead>
            <tbody>
              {lista.data?.data.length === 0 && (
                <tr><td colSpan={2} className="px-[14px] py-[20px] text-center" style={{ color: 'var(--text-muted)' }}>Nenhum titular.</td></tr>
              )}
              {lista.data?.data.map((t) => (
                <tr key={t.id} onClick={() => abrir(t.id)}
                  className="cursor-pointer hover:bg-[var(--surface-input)]"
                  style={{ borderBottom: '1px solid var(--border-light)', background: selId === t.id ? 'var(--surface-input)' : undefined }}>
                  <td className="px-[14px] py-[10px] font-semibold" style={{ color: 'var(--text-primary)' }}>{t.nome}</td>
                  <td className="px-[14px] py-[10px]" style={{ color: 'var(--text-body)' }}>{t.cpfCnpj}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Ficha */}
        <div className="flex flex-col gap-[16px]">
          {!selId && <div className="rounded-card p-[18px] text-[12.5px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>Selecione um titular para ver a ficha.</div>}
          {selId && f && (
            <>
              {/* Cadastro vivo */}
              <div className="rounded-card p-[18px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="mb-[10px] flex items-center justify-between">
                  <div className="font-display text-[15px] font-bold">{f.titular.nome}</div>
                  <div className="flex items-center gap-[8px]">
                    {selId && <button onClick={() => navigate(`/titulares/${selId}`)} className="h-[30px] rounded-[8px] px-[12px] text-[12px] font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>Detalhe completo</button>}
                    {podeEditar && !editando && <button onClick={iniciarEdicao} className="h-[30px] rounded-[8px] px-[12px] text-[12px] font-semibold" style={{ background: 'var(--navy)', color: '#fff' }}>Editar cadastro</button>}
                  </div>
                </div>
                {!editando ? (
                  <div className="grid grid-cols-2 gap-y-[6px] gap-x-[16px] text-[12.5px]">
                    <div><span style={{ color: 'var(--text-label)' }}>CPF/CNPJ:</span> {f.titular.cpfCnpj}</div>
                    <div><span style={{ color: 'var(--text-label)' }}>WhatsApp:</span> {f.titular.whatsapp}</div>
                    <div><span style={{ color: 'var(--text-label)' }}>E-mail:</span> {f.titular.email ?? '—'}</div>
                    <div><span style={{ color: 'var(--text-label)' }}>Profissão:</span> {f.titular.profissao ?? '—'}</div>
                    <div className="col-span-2"><span style={{ color: 'var(--text-label)' }}>Endereço:</span> {f.titular.endereco ?? '—'}{f.titular.cidade ? `, ${f.titular.cidade}/${f.titular.estado ?? ''}` : ''}</div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-[12px]">
                    <div className="rounded-[8px] p-[10px] text-[11.5px]" style={{ background: '#fef6e9', color: '#8a5a0a' }}>
                      Editar altera apenas o <b>cadastro vivo</b> (usado daqui pra frente). Contratos já assinados são imutáveis — seus dados ficam congelados no snapshot da formalização e <b>não</b> mudam.
                    </div>
                    <div className="grid grid-cols-3 gap-[12px]">
                      <label className="flex flex-col gap-[4px]"><Lbl>Nome</Lbl><input value={form.nome ?? ''} onChange={set('nome')} className={inputCls} style={inStyle} /></label>
                      <label className="flex flex-col gap-[4px]"><Lbl>WhatsApp</Lbl><input value={form.whatsapp ?? ''} onChange={set('whatsapp')} className={inputCls} style={inStyle} /></label>
                      <label className="flex flex-col gap-[4px]"><Lbl>E-mail</Lbl><input value={form.email ?? ''} onChange={set('email')} className={inputCls} style={inStyle} /></label>
                      <label className="flex flex-col gap-[4px]"><Lbl>Profissão</Lbl><input value={form.profissao ?? ''} onChange={set('profissao')} className={inputCls} style={inStyle} /></label>
                      <label className="flex flex-col gap-[4px]"><Lbl>Estado civil</Lbl><input value={form.estadoCivil ?? ''} onChange={set('estadoCivil')} className={inputCls} style={inStyle} /></label>
                      <label className="flex flex-col gap-[4px]"><Lbl>RG</Lbl><input value={form.rg ?? ''} onChange={set('rg')} className={inputCls} style={inStyle} /></label>
                      <label className="flex flex-col gap-[4px] col-span-2"><Lbl>Endereço</Lbl><input value={form.endereco ?? ''} onChange={set('endereco')} className={inputCls} style={inStyle} /></label>
                      <label className="flex flex-col gap-[4px]"><Lbl>Bairro</Lbl><input value={form.bairro ?? ''} onChange={set('bairro')} className={inputCls} style={inStyle} /></label>
                      <label className="flex flex-col gap-[4px]"><Lbl>Cidade</Lbl><input value={form.cidade ?? ''} onChange={set('cidade')} className={inputCls} style={inStyle} /></label>
                      <label className="flex flex-col gap-[4px]"><Lbl>Estado</Lbl><input value={form.estado ?? ''} onChange={set('estado')} className={inputCls} style={inStyle} /></label>
                      <label className="flex flex-col gap-[4px]"><Lbl>CEP</Lbl><input value={form.cep ?? ''} onChange={set('cep')} className={inputCls} style={inStyle} /></label>
                    </div>
                    <div className="flex gap-[8px]">
                      <button onClick={salvar} disabled={ocupado} className="h-[34px] rounded-[8px] px-[16px] text-[12.5px] font-semibold" style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado ? 0.6 : 1 }}>Salvar cadastro</button>
                      <button onClick={() => setEditando(false)} className="h-[34px] rounded-[8px] px-[12px] text-[12px]" style={{ color: 'var(--text-muted)' }}>Cancelar</button>
                    </div>
                  </div>
                )}
                {f.conta && <div className="mt-[12px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>Conta aberta em {new Date(f.conta.dataAbertura).toLocaleDateString('pt-BR')} · {f.conta.status}</div>}
              </div>

              {/* Contratos pendurados */}
              <div className="rounded-card p-[18px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="mb-[10px] font-display text-[13px] font-bold">Contratos de crédito</div>
                {f.contratosCredito.length === 0 ? <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum.</div> : (
                  <div className="flex flex-col gap-[6px]">
                    {f.contratosCredito.map((c) => (
                      <div key={c.id} onClick={() => navigate(`/contratos/${c.id}`)} className="flex cursor-pointer items-center justify-between rounded-[8px] p-[8px] hover:bg-[var(--surface-input)] text-[12.5px]">
                        <span className="font-semibold">{c.numero}</span>
                        <span style={{ color: 'var(--text-body)' }}>{formatCurrency(c.saldoDevedor)}</span>
                        <StatusBadge label={c.status} colors={CONTRATO_STATUS_COLORS} />
                      </div>
                    ))}
                  </div>
                )}
                {f.contratosInvestimento.length > 0 && (
                  <>
                    <div className="mt-[14px] mb-[10px] font-display text-[13px] font-bold">Contratos de investimento</div>
                    <div className="flex flex-col gap-[6px]">
                      {f.contratosInvestimento.map((c) => (
                        <div key={c.id} className="flex items-center justify-between rounded-[8px] p-[8px] text-[12.5px]">
                          <span className="font-semibold">{c.numero}</span>
                          <span style={{ color: 'var(--text-body)' }}>{formatCurrency(c.valorAportado)}</span>
                          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{c.status}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

            </>
          )}
        </div>
      </div>
    </div>
  );
}
