import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { simuladorService, ParametrosSimulador } from '../services/simulador.service';
import { reaisParaCentavos } from '../lib/valor';
import { usePodeRole, mensagemErro } from '../lib/permissoes';
import { toast } from '../components/Toast';

const ROLES_CONFIG = ['ADMIN', 'DIRETOR'];
const reaisFmt = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const inputCls = 'h-[32px] rounded-[8px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' };

// Configurações → Simulador (Doc 2 §4-A.2/4-A.3): parâmetros VERSIONADOS (salvar
// cria versão nova; simulações antigas preservam a versão usada) + ofertas fixas.
export function SimuladorConfigPage() {
  const queryClient = useQueryClient();
  const pode = usePodeRole();
  const podeEditar = pode(ROLES_CONFIG);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState<Record<string, string> | null>(null);

  const params = useQuery({ queryKey: ['simulador-parametros'], queryFn: () => simuladorService.parametros() });
  const ofertas = useQuery({ queryKey: ['ofertas-fixas'], queryFn: () => simuladorService.ofertasFixas() });

  const [of, setOf] = useState({ nome: '', entrada: '', parcela: '', prazo: '48', freq: 'semanal' as 'mensal' | 'quinzenal' | 'semanal', fim: '' });

  function abrirEdicao(p: ParametrosSimulador) {
    setForm({
      comissaoInicial: reaisFmt(p.comissaoInicial),
      comissaoRecorrente: reaisFmt(p.comissaoRecorrente),
      taxaMensal: (p.taxaMensal * 100).toFixed(2),
      entradaMinima: reaisFmt(p.entradaMinima),
      prazoMinMeses: String(p.prazoMinMeses),
      prazoMaxMeses: String(p.prazoMaxMeses),
      prazosPadronizados: p.prazosPadronizados.join(', '),
      fatorSemanal: String(p.fatorSemanal),
      fatorQuinzenal: String(p.fatorQuinzenal),
      validadeDias: String(p.validadeDias),
    });
  }

  async function salvarVersao() {
    if (!form || !params.data) return;
    setSalvando(true);
    try {
      await simuladorService.criarVersao({
        comissaoInicial: reaisParaCentavos(form.comissaoInicial),
        comissaoRecorrente: reaisParaCentavos(form.comissaoRecorrente),
        taxaMensal: Number(form.taxaMensal.replace(',', '.')) / 100,
        entradaMinima: reaisParaCentavos(form.entradaMinima),
        prazoMinMeses: Number(form.prazoMinMeses),
        prazoMaxMeses: Number(form.prazoMaxMeses),
        prazosPadronizados: form.prazosPadronizados.split(',').map((s) => Number(s.trim())).filter(Boolean),
        fatorSemanal: Number(form.fatorSemanal.replace(',', '.')),
        fatorQuinzenal: Number(form.fatorQuinzenal.replace(',', '.')),
        validadeDias: Number(form.validadeDias),
        ofertasPadrao: params.data.ofertasPadrao,
      });
      setForm(null);
      await queryClient.invalidateQueries({ queryKey: ['simulador-parametros'] });
      toast.sucesso('Nova versão de parâmetros publicada (a anterior fica no histórico).');
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setSalvando(false); }
  }

  async function criarOferta() {
    setSalvando(true);
    try {
      await simuladorService.criarOfertaFixa({
        nome: of.nome.trim(),
        valorEntrada: reaisParaCentavos(of.entrada),
        valorParcela: reaisParaCentavos(of.parcela),
        frequencia: of.freq,
        prazoMeses: Number(of.prazo),
        vigenciaFim: of.fim ? new Date(of.fim + 'T23:59:59').toISOString() : undefined,
      });
      setOf({ nome: '', entrada: '', parcela: '', prazo: '48', freq: 'semanal', fim: '' });
      await queryClient.invalidateQueries({ queryKey: ['ofertas-fixas'] });
      toast.sucesso('Oferta fixa criada — vincule ativos a ela no cadastro de ativos.');
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setSalvando(false); }
  }

  async function alternarOferta(id: string, ativa: boolean) {
    try {
      await simuladorService.atualizarOfertaFixa(id, { ativa });
      await queryClient.invalidateQueries({ queryKey: ['ofertas-fixas'] });
    } catch (e) { toast.erro(mensagemErro(e)); }
  }

  const p = params.data;
  const CAMPOS: { chave: string; rotulo: string }[] = [
    { chave: 'comissaoInicial', rotulo: 'Comissão inicial — CI (R$)' },
    { chave: 'comissaoRecorrente', rotulo: 'Comissão recorrente — CR (R$)' },
    { chave: 'taxaMensal', rotulo: 'Taxa — TR (% a.m.)' },
    { chave: 'entradaMinima', rotulo: 'Entrada mínima (R$)' },
    { chave: 'prazoMinMeses', rotulo: 'Prazo mín. (meses)' },
    { chave: 'prazoMaxMeses', rotulo: 'Prazo máx. (meses)' },
    { chave: 'prazosPadronizados', rotulo: 'Prazos padronizados' },
    { chave: 'fatorSemanal', rotulo: 'Fator semanal (sem./mês)' },
    { chave: 'fatorQuinzenal', rotulo: 'Fator quinzenal' },
    { chave: 'validadeDias', rotulo: 'Validade da simulação (dias)' },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Parâmetros vigentes */}
      <div className="rounded-card p-[18px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="mb-[10px] flex items-center justify-between">
          <div>
            <div className="font-display text-[14px] font-bold">Parâmetros do simulador</div>
            <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
              Versionados: salvar publica uma nova versão — simulações antigas preservam a versão que usaram.
              {p && <> Vigente desde {new Date(p.vigenteDesde).toLocaleDateString('pt-BR')}.</>}
            </div>
          </div>
          {podeEditar && p && !form && (
            <button onClick={() => abrirEdicao(p)} className="h-[32px] rounded-[8px] px-[14px] text-[12px] font-semibold" style={{ background: 'var(--navy)', color: '#fff' }}>Editar (nova versão)</button>
          )}
        </div>

        {!p ? (
          <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
        ) : !form ? (
          <div className="grid grid-cols-2 gap-[10px] sm:grid-cols-5">
            <Metrica rotulo="CI" valor={formatCurrency(p.comissaoInicial)} />
            <Metrica rotulo="CR" valor={formatCurrency(p.comissaoRecorrente)} />
            <Metrica rotulo="TR" valor={`${(p.taxaMensal * 100).toFixed(2)}% a.m.`} />
            <Metrica rotulo="Entrada mín." valor={formatCurrency(p.entradaMinima)} />
            <Metrica rotulo="Prazo" valor={`${p.prazoMinMeses}–${p.prazoMaxMeses} meses`} />
            <Metrica rotulo="Prazos padrão" valor={p.prazosPadronizados.join(', ')} />
            <Metrica rotulo="Fator semanal" valor={String(p.fatorSemanal)} />
            <Metrica rotulo="Fator quinzenal" valor={String(p.fatorQuinzenal)} />
            <Metrica rotulo="Validade" valor={`${p.validadeDias} dias`} />
            <Metrica rotulo="Ofertas padrão" valor={p.ofertasPadrao.map((o) => `${o.prazoMeses}m/${o.frequencia.toLowerCase()}`).join(' · ')} />
          </div>
        ) : (
          <div className="flex flex-col gap-[12px]">
            <div className="grid grid-cols-2 gap-[10px] sm:grid-cols-5">
              {CAMPOS.map((c) => (
                <label key={c.chave} className="flex flex-col gap-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>
                  {c.rotulo}
                  <input value={form[c.chave]} onChange={(e) => setForm({ ...form, [c.chave]: e.target.value })} className={inputCls} style={inputStyle} />
                </label>
              ))}
            </div>
            <div className="flex gap-[8px]">
              <button onClick={salvarVersao} disabled={salvando} className="h-[34px] rounded-[8px] px-[16px] text-[12.5px] font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>Publicar nova versão</button>
              <button onClick={() => setForm(null)} className="h-[34px] rounded-[8px] px-[12px] text-[12px]" style={{ color: 'var(--text-muted)' }}>Cancelar</button>
            </div>
          </div>
        )}
      </div>

      {/* Ofertas fixas */}
      <div className="rounded-card p-[18px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="mb-[4px] font-display text-[14px] font-bold">Ofertas fixas</div>
        <div className="mb-[12px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          Condição comercial desenhada (números redondos, ex.: "R$ 599 por semana"). Vincule ativos a ela no cadastro de ativos — aparece em destaque na simulação.
        </div>

        {podeEditar && (
          <div className="mb-[14px] flex flex-wrap items-end gap-[10px]">
            <label className="flex flex-col gap-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Nome
              <input value={of.nome} onChange={(e) => setOf({ ...of, nome: e.target.value })} placeholder="Promoção da semana" className={`${inputCls} w-[180px]`} style={inputStyle} /></label>
            <label className="flex flex-col gap-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Entrada (R$)
              <input value={of.entrada} onChange={(e) => setOf({ ...of, entrada: e.target.value })} className={`${inputCls} w-[110px]`} style={inputStyle} /></label>
            <label className="flex flex-col gap-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Parcela (R$)
              <input value={of.parcela} onChange={(e) => setOf({ ...of, parcela: e.target.value })} placeholder="599,00" className={`${inputCls} w-[110px]`} style={inputStyle} /></label>
            <label className="flex flex-col gap-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Prazo (meses)
              <input value={of.prazo} onChange={(e) => setOf({ ...of, prazo: e.target.value.replace(/\D/g, '') })} className={`${inputCls} w-[90px]`} style={inputStyle} /></label>
            <label className="flex flex-col gap-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Frequência
              <select value={of.freq} onChange={(e) => setOf({ ...of, freq: e.target.value as typeof of.freq })} className={`${inputCls} w-[110px]`} style={inputStyle}>
                <option value="semanal">Semanal</option><option value="quinzenal">Quinzenal</option><option value="mensal">Mensal</option>
              </select></label>
            <label className="flex flex-col gap-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Válida até (opcional)
              <input type="date" value={of.fim} onChange={(e) => setOf({ ...of, fim: e.target.value })} className={`${inputCls} w-[140px]`} style={inputStyle} /></label>
            <button onClick={criarOferta} disabled={salvando || !of.nome.trim() || reaisParaCentavos(of.parcela) <= 0}
              className="h-[32px] rounded-[8px] px-[14px] text-[12px] font-semibold disabled:opacity-50" style={{ background: 'var(--navy)', color: '#fff' }}>+ Criar oferta</button>
          </div>
        )}

        {ofertas.data?.length === 0 ? (
          <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Nenhuma oferta fixa cadastrada.</div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[620px] border-collapse text-[12.5px]">
            <thead>
              <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
                <th className="py-[8px] text-left font-semibold">Oferta</th>
                <th className="py-[8px] text-left font-semibold">Condição</th>
                <th className="py-[8px] text-center font-semibold">Ativos</th>
                <th className="py-[8px] text-left font-semibold">Vigência</th>
                <th className="py-[8px] text-right font-semibold">Situação</th>
              </tr>
            </thead>
            <tbody>
              {ofertas.data?.map((o) => (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td className="py-[10px] font-semibold">{o.nome}</td>
                  <td className="py-[10px]">{formatCurrency(o.valorParcela)} {o.frequencia === 'mensal' ? 'por mês' : o.frequencia === 'quinzenal' ? 'por quinzena' : 'por semana'} · {o.prazoMeses} meses · entrada {formatCurrency(o.valorEntrada)}</td>
                  <td className="py-[10px] text-center tabular-nums">{o.ativosVinculados}</td>
                  <td className="py-[10px]">{o.vigenciaFim ? `até ${new Date(o.vigenciaFim).toLocaleDateString('pt-BR')}` : 'sem prazo'}</td>
                  <td className="py-[10px] text-right">
                    {podeEditar ? (
                      <button onClick={() => alternarOferta(o.id, !o.ativa)}
                        className="rounded-[7px] px-[10px] py-[4px] text-[11.5px] font-semibold"
                        style={o.vigente ? { background: '#eafaf1', color: '#1f9d5b' } : { background: 'var(--surface-input)', color: 'var(--text-muted)' }}>
                        {o.vigente ? 'Vigente — desativar' : o.ativa ? 'Fora de vigência' : 'Inativa — ativar'}
                      </button>
                    ) : (
                      <span className="text-[11.5px] font-semibold" style={{ color: o.vigente ? '#1f9d5b' : 'var(--text-muted)' }}>{o.vigente ? 'Vigente' : 'Inativa'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

function Metrica({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-[10px] p-[10px]" style={{ background: 'var(--surface-input)' }}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--text-label)' }}>{rotulo}</div>
      <div className="mt-[2px] text-[13px] font-bold">{valor}</div>
    </div>
  );
}
