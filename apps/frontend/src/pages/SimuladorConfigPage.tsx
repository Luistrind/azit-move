import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { simuladorService, ParametrosSimulador, type OfertaFixaApi } from '../services/simulador.service';
import { reaisParaCentavos } from '../lib/valor';
import { usePodeRole, mensagemErro } from '../lib/permissoes';
import { toast } from '../components/Toast';
import { Metrica } from '../components/Metrica';
import { Bloco } from '../components/Bloco';
import { Botao } from '../components/Botao';
import { Tabela, type Coluna } from '../components/Tabela';
import { dataMistaBR, instanteBR } from '../lib/datas';

const ROLES_CONFIG = ['ADMIN', 'DIRETOR'];
const reaisFmt = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const inputCls = 'h-[34px] w-full rounded-[10px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' };
const lblCls = 'flex min-w-0 flex-col gap-[4px] text-[11px] font-semibold';
const lblStyle = { color: 'var(--text-label)' } as const;
const POR: Record<OfertaFixaApi['frequencia'], string> = { mensal: 'por mês', quinzenal: 'por quinzena', semanal: 'por semana' };

// Configurações → Simulador (Doc 2 §4-A.2/4-A.3): parâmetros VERSIONADOS (salvar
// cria versão nova; simulações antigas preservam a versão usada) + ofertas fixas.
// Layout v2 (doc 03 §11): dois <Bloco>s, ofertas em <Tabela>, botões do kit.
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
      taxaDescAntecipCR: (p.taxaDescontoAntecipacaoCR * 100).toFixed(2),
      entradaMinima: reaisFmt(p.entradaMinima),
      prazoMinMeses: String(p.prazoMinMeses),
      prazoMaxMeses: String(p.prazoMaxMeses),
      prazosPadronizados: p.prazosPadronizados.join(', '),
      fatorPrecSemanal: String(p.fatorPrecificacaoSemanal),
      fatorPrecQuinzenal: String(p.fatorPrecificacaoQuinzenal),
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
        taxaDescontoAntecipacaoCR: Number(form.taxaDescAntecipCR.replace(',', '.')) / 100,
        entradaMinima: reaisParaCentavos(form.entradaMinima),
        prazoMinMeses: Number(form.prazoMinMeses),
        prazoMaxMeses: Number(form.prazoMaxMeses),
        prazosPadronizados: form.prazosPadronizados.split(',').map((s) => Number(s.trim())).filter(Boolean),
        fatorPrecificacaoSemanal: Number(form.fatorPrecSemanal.replace(',', '.')),
        fatorPrecificacaoQuinzenal: Number(form.fatorPrecQuinzenal.replace(',', '.')),
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
    { chave: 'taxaDescAntecipCR', rotulo: 'Desc. antecipação CR (% a.m.)' },
    { chave: 'entradaMinima', rotulo: 'Entrada mínima (R$)' },
    { chave: 'prazoMinMeses', rotulo: 'Prazo mín. (meses)' },
    { chave: 'prazoMaxMeses', rotulo: 'Prazo máx. (meses)' },
    { chave: 'prazosPadronizados', rotulo: 'Prazos padronizados' },
    { chave: 'fatorPrecSemanal', rotulo: 'Divisor da parcela semanal' },
    { chave: 'fatorPrecQuinzenal', rotulo: 'Divisor da parcela quinzenal' },
    { chave: 'fatorSemanal', rotulo: 'Fator nº parcelas semanal' },
    { chave: 'fatorQuinzenal', rotulo: 'Fator nº parcelas quinzenal' },
    { chave: 'validadeDias', rotulo: 'Validade da simulação (dias)' },
  ];

  const colunasOferta: Coluna<OfertaFixaApi>[] = [
    { chave: 'nome', titulo: 'Oferta', celular: 'titulo', render: (o) => o.nome },
    { chave: 'condicao', titulo: 'Condição', celular: 'subtitulo', render: (o) => `${formatCurrency(o.valorParcela)} ${POR[o.frequencia]} · ${o.prazoMeses} meses · entrada ${formatCurrency(o.valorEntrada)}` },
    { chave: 'ativos', titulo: 'Ativos', alinhar: 'center', classe: 'tabular-nums', celular: 'campo', render: (o) => o.ativosVinculados },
    { chave: 'vigencia', titulo: 'Vigência', celular: 'campo', render: (o) => (o.vigenciaFim ? `até ${dataMistaBR(o.vigenciaFim)}` : 'sem prazo') },
    {
      chave: 'situacao',
      titulo: 'Situação',
      celular: 'campo',
      render: (o) => (
        <span className="rounded-full px-[9px] py-[2px] text-[11px] font-bold" style={o.vigente ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)' } : { background: 'var(--surface-input)', color: 'var(--text-muted)' }}>
          {o.vigente ? 'Vigente' : o.ativa ? 'Fora de vigência' : 'Inativa'}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Parâmetros vigentes */}
      <Bloco
        titulo="Parâmetros do simulador"
        tag={p ? `vigente desde ${instanteBR(p.vigenteDesde)}` : undefined}
        acao={podeEditar && p && !form ? <Botao tamanho="sm" onClick={() => abrirEdicao(p)}>Editar (nova versão)</Botao> : undefined}
        leitura="Versionados: salvar publica uma nova versão — simulações antigas preservam a versão que usaram."
      >
        {!p ? (
          <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
        ) : !form ? (
          <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-3 lg:grid-cols-5">
            <Metrica label="CI" valor={formatCurrency(p.comissaoInicial)} />
            <Metrica label="CR" valor={formatCurrency(p.comissaoRecorrente)} />
            <Metrica label="TR" valor={`${(p.taxaMensal * 100).toFixed(2)}% a.m.`} />
            <Metrica label="Entrada mín." valor={formatCurrency(p.entradaMinima)} />
            <Metrica label="Prazo" valor={`${p.prazoMinMeses}–${p.prazoMaxMeses} meses`} />
            <Metrica label="Prazos padrão" valor={p.prazosPadronizados.join(', ')} />
            <Metrica label="Divisor parcela (sem·quinz)" valor={`÷${p.fatorPrecificacaoSemanal} · ÷${p.fatorPrecificacaoQuinzenal}`} />
            <Metrica label="Fator nº parcelas" valor={`${p.fatorSemanal} · ${p.fatorQuinzenal}`} />
            <Metrica label="Validade" valor={`${p.validadeDias} dias`} />
            <Metrica label="Ofertas padrão" valor={p.ofertasPadrao.map((o) => `${o.prazoMeses}m/${o.frequencia.toLowerCase()}`).join(' · ')} />
          </div>
        ) : (
          <div className="flex flex-col gap-[12px]">
            <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2 lg:grid-cols-4">
              {CAMPOS.map((c) => (
                <label key={c.chave} className={lblCls} style={lblStyle}>
                  {c.rotulo}
                  <input value={form[c.chave]} onChange={(e) => setForm({ ...form, [c.chave]: e.target.value })} className={inputCls} style={inputStyle} />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-[8px]">
              <Botao variante="primaria" onClick={salvarVersao} carregando={salvando}>Publicar nova versão</Botao>
              <Botao variante="fantasma" onClick={() => setForm(null)}>Cancelar</Botao>
            </div>
          </div>
        )}
      </Bloco>

      {/* Ofertas fixas */}
      <Bloco
        titulo="Ofertas fixas"
        tag={ofertas.data ? `${ofertas.data.length} ${ofertas.data.length === 1 ? 'oferta' : 'ofertas'}` : undefined}
        leitura={<>Condição comercial desenhada (números redondos, ex.: "R$ 599 por semana"). Vincule ativos a ela no cadastro de ativos — aparece em destaque na simulação.</>}
      >
        {podeEditar && (
          <div className="grid grid-cols-1 items-end gap-[10px] sm:grid-cols-2 lg:grid-cols-4">
            <label className={lblCls} style={lblStyle}>Nome
              <input value={of.nome} onChange={(e) => setOf({ ...of, nome: e.target.value })} placeholder="Promoção da semana" className={inputCls} style={inputStyle} /></label>
            <label className={lblCls} style={lblStyle}>Entrada (R$)
              <input value={of.entrada} onChange={(e) => setOf({ ...of, entrada: e.target.value })} className={inputCls} style={inputStyle} /></label>
            <label className={lblCls} style={lblStyle}>Parcela (R$)
              <input value={of.parcela} onChange={(e) => setOf({ ...of, parcela: e.target.value })} placeholder="599,00" className={inputCls} style={inputStyle} /></label>
            <label className={lblCls} style={lblStyle}>Prazo (meses)
              <input value={of.prazo} onChange={(e) => setOf({ ...of, prazo: e.target.value.replace(/\D/g, '') })} className={inputCls} style={inputStyle} /></label>
            <label className={lblCls} style={lblStyle}>Frequência
              <select value={of.freq} onChange={(e) => setOf({ ...of, freq: e.target.value as typeof of.freq })} className={inputCls} style={inputStyle}>
                <option value="semanal">Semanal</option><option value="quinzenal">Quinzenal</option><option value="mensal">Mensal</option>
              </select></label>
            <label className={lblCls} style={lblStyle}>Válida até (opcional)
              <input type="date" value={of.fim} onChange={(e) => setOf({ ...of, fim: e.target.value })} className={inputCls} style={inputStyle} /></label>
            <Botao variante="primaria" onClick={criarOferta} carregando={salvando} disabled={!of.nome.trim() || reaisParaCentavos(of.parcela) <= 0}>+ Criar oferta</Botao>
          </div>
        )}

        <Tabela
          colunas={colunasOferta}
          linhas={ofertas.data ?? []}
          chave={(o) => o.id}
          carregando={ofertas.isLoading}
          vazio="Nenhuma oferta fixa cadastrada."
          larguraMinima={720}
          acoes={podeEditar ? (o) => (
            <Botao tamanho="sm" variante={o.vigente ? 'perigo' : 'secundaria'} onClick={() => alternarOferta(o.id, !o.ativa)}>
              {o.vigente ? 'Vigente — desativar' : o.ativa ? 'Fora de vigência' : 'Inativa — ativar'}
            </Botao>
          ) : undefined}
        />
      </Bloco>
    </div>
  );
}
