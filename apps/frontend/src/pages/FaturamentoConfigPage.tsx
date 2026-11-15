import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GrupoCascata, ParametrosFaturamento, VersaoParametrosFaturamento } from '@azit/types';
import { formatCurrency, formatarInstanteBR, minimoParcialFatura, ROTULO_GRUPO_CASCATA } from '@azit/utils';
import { faturamentoService } from '../services/faturamento.service';
import { toast } from '../components/Toast';
import { mensagemErro, usePodeRole } from '../lib/permissoes';
import { Botao } from '../components/Botao';
import { Secao } from '../components/Secao';

// Configurações › Faturamento (doc 02 §32.8, D-14 do Vicente): parâmetros
// FAT001–FAT004, teto de Pix por dia e a CHAVE do Pix sob demanda (§32.4-A),
// versionados. Leitura para quem tem a área; só ADMIN/DIRETOR alteram — para
// os demais os campos ficam travados e o botão de salvar não aparece.

const card = 'rounded-card p-[16px]';
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputCls = 'h-[32px] w-[96px] rounded-[10px] px-[10px] text-right text-[13px] tabular-nums disabled:opacity-60';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
const mudo = { color: 'var(--text-muted)' } as const;
const ROLE_FATURAMENTO = ['ADMIN', 'DIRETOR'];

type Form = Omit<ParametrosFaturamento, 'versao'>;
const semVersao = ({ versao: _v, ...resto }: ParametrosFaturamento): Form => resto;

// "35" / "1,5" → número; vazio ou inválido → null (o botão de salvar trava).
function lerNumero(txt: string): number | null {
  const n = Number(txt.replace(/\./g, '').replace(',', '.'));
  return txt.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
}
const pct = (n: number) => String(n).replace('.', ',');

function CampoNumero({ rotulo, sufixo, valor, onChange, travado, ajuda }: { rotulo: string; sufixo: string; valor: string; onChange: (v: string) => void; travado: boolean; ajuda?: string }) {
  return (
    <label className="flex flex-col gap-[4px] text-[12.5px]">
      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{rotulo}</span>
      <span className="flex items-center gap-[8px]">
        <input className={inputCls} style={inputStyle} inputMode="decimal" value={valor} disabled={travado} onChange={(e) => onChange(e.target.value)} />
        <span style={mudo}>{sufixo}</span>
      </span>
      {ajuda ? <span className="text-[12px]" style={mudo}>{ajuda}</span> : null}
    </label>
  );
}

function resumoVersao(v: VersaoParametrosFaturamento): string {
  return [
    `Pix sob demanda ${v.pixSobDemanda ? 'ligado' : 'desligado'}`,
    `multa ${pct(v.multaPadraoPct)}%`,
    `atualização ${pct(v.atualizacaoMesPadraoPct)}% ao mês`,
    `mínimo ${pct(v.minimoParcialPct)}% ou ${formatCurrency(v.minimoParcialPiso)}`,
    `até ${v.tetoIntencoesDia} Pix por dia`,
  ].join(' · ');
}

export function FaturamentoConfigPage() {
  const qc = useQueryClient();
  const pode = usePodeRole();
  const podeEditar = pode(ROLE_FATURAMENTO);
  const q = useQuery({ queryKey: ['faturamento-parametros'], queryFn: () => faturamentoService.obter() });
  const [form, setForm] = useState<Form | null>(null);
  const [txt, setTxt] = useState({ multa: '', atualizacao: '', minimoPct: '', piso: '', teto: '' });
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  function carregar(p: ParametrosFaturamento) {
    setForm(semVersao(p));
    setTxt({
      multa: pct(p.multaPadraoPct),
      atualizacao: pct(p.atualizacaoMesPadraoPct),
      minimoPct: pct(p.minimoParcialPct),
      piso: (p.minimoParcialPiso / 100).toFixed(2).replace('.', ','),
      teto: String(p.tetoIntencoesDia),
    });
    setMotivo('');
  }
  useEffect(() => {
    if (q.data && !form) carregar(q.data.vigente);
  }, [q.data, form]);

  if (q.isError) return <div className="text-[13px]" style={{ color: 'var(--danger-fg)' }}>{mensagemErro(q.error)}</div>;
  if (!form || !q.data) return <div className="text-[13px]" style={mudo}>Carregando…</div>;
  const { vigente, faturasEmAberto, historico } = q.data;

  const multa = lerNumero(txt.multa);
  const atualizacao = lerNumero(txt.atualizacao);
  const minimoPct = lerNumero(txt.minimoPct);
  const piso = lerNumero(txt.piso);
  const teto = lerNumero(txt.teto);
  const numerosOk =
    multa !== null && multa <= 100 && atualizacao !== null && atualizacao <= 100 && minimoPct !== null && minimoPct <= 100 &&
    piso !== null && teto !== null && Number.isInteger(teto) && teto >= 1 && teto <= 100;
  const proposto: Form | null = numerosOk
    ? { ...form, multaPadraoPct: multa, atualizacaoMesPadraoPct: atualizacao, minimoParcialPct: minimoPct, minimoParcialPiso: Math.round(piso * 100), tetoIntencoesDia: teto }
    : null;
  const mudou = proposto !== null && JSON.stringify(proposto) !== JSON.stringify(semVersao(vigente));
  const viraChave = form.pixSobDemanda !== vigente.pixSobDemanda;

  function mover(i: number, delta: number) {
    if (!form) return;
    const cascata = [...form.cascata];
    const j = i + delta;
    if (j < 0 || j >= cascata.length) return;
    [cascata[i], cascata[j]] = [cascata[j], cascata[i]];
    setForm({ ...form, cascata });
  }

  async function salvar() {
    if (!proposto) return;
    setOcupado(true);
    try {
      const r = await faturamentoService.salvar({ ...proposto, motivo: motivo.trim() || null });
      qc.setQueryData(['faturamento-parametros'], r);
      carregar(r.vigente);
      toast.sucesso(`Parâmetros de faturamento salvos (versão ${r.vigente.versao}).`);
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  const exemplo = proposto ? minimoParcialFatura(104900, proposto) : null;

  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h1 className="font-display text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>Faturamento</h1>
        <p className="text-[13px]" style={mudo}>
          Regras da Fatura Azit: como a fatura é cobrada, em que ordem um pagamento quita os itens e quanto o cliente
          pode pagar em parte. Cada alteração vira uma versão nova, com quem alterou e quando.
          {vigente.versao === 0 ? ' Nada foi salvo ainda: estão valendo os padrões.' : ` Em vigor: versão ${vigente.versao}.`}
          {podeEditar ? '' : ' Só administrador e diretoria alteram estes parâmetros.'}
        </p>
      </div>

      <div className={card} style={cardStyle}>
        <Secao titulo="Pix sob demanda">
          <label className="flex min-h-[30px] items-center gap-[8px] text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={form.pixSobDemanda} disabled={!podeEditar} onChange={(e) => setForm({ ...form, pixSobDemanda: e.target.checked })} />
            Faturas novas fecham sem cobrança pré-criada; o Pix nasce quando o cliente vai pagar
          </label>
          <div className="mt-[6px] flex flex-col gap-[4px] text-[12px]" style={mudo}>
            <span>
              Ligada: toda fatura que fechar daqui em diante usa o cálculo da Azit (multa única e atualização por dia de atraso),
              aceita pagamento em parte e o Pix vale até 23h59 do dia em que é gerado. Desligada: tudo continua como hoje,
              com a cobrança criada no Asaas no fechamento.
            </span>
            <span>
              Faturas já fechadas não mudam de modelo: seguem com a cobrança que têm até serem pagas.
              Em aberto agora: <b style={{ color: 'var(--text-primary)' }}>{faturasEmAberto.azit}</b> no modelo novo
              e <b style={{ color: 'var(--text-primary)' }}>{faturasEmAberto.asaasNativo}</b> com cobrança no Asaas.
            </span>
            {viraChave && form.pixSobDemanda ? (
              <span className="rounded-[8px] px-[10px] py-[6px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
                Atenção: sem cobrança pré-criada o Asaas deixa de avisar o cliente da fatura. Antes de ligar em produção,
                os lembretes de pagamento precisam estar no ar ou o operador manda o link pela ficha.
              </span>
            ) : null}
          </div>
        </Secao>
      </div>

      <div className={card} style={cardStyle}>
        <Secao titulo="Encargos por atraso" tag="FAT001 · FAT002">
          <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
            <CampoNumero rotulo="Multa por atraso" sufixo="% uma única vez" valor={txt.multa} travado={!podeEditar} onChange={(v) => setTxt({ ...txt, multa: v })} />
            <CampoNumero rotulo="Atualização por dias de atraso" sufixo="% ao mês, proporcional aos dias" valor={txt.atualizacao} travado={!podeEditar} onChange={(v) => setTxt({ ...txt, atualizacao: v })} />
          </div>
          <div className="mt-[8px] text-[12px]" style={mudo}>
            Padrão dos contratos novos. Contrato já criado continua com os percentuais gravados nele, e é com eles que a fatura é calculada.
          </div>
        </Secao>
      </div>

      <div className={card} style={cardStyle}>
        <Secao titulo="Ordem de quitação" tag="FAT003">
          <div className="mb-[8px] text-[12px]" style={mudo}>
            Quando o pagamento não cobre a fatura inteira, o dinheiro quita nesta ordem. Se acabar no meio de um grupo,
            é dividido entre os itens do grupo na proporção do que cada um deve.
          </div>
          <ol className="flex flex-col gap-[6px]">
            {form.cascata.map((g: GrupoCascata, i) => (
              <li key={g} className="flex items-center gap-[10px] rounded-[10px] px-[10px] py-[6px] text-[12.5px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
                <span className="w-[20px] font-bold tabular-nums" style={mudo}>{i + 1}º</span>
                <span className="min-w-0 flex-1">{ROTULO_GRUPO_CASCATA[g]}</span>
                {podeEditar ? (
                  <span className="flex gap-[4px]">
                    <Botao tamanho="sm" variante="fantasma" disabled={i === 0} aria-label={`Subir ${ROTULO_GRUPO_CASCATA[g]}`} onClick={() => mover(i, -1)}>↑</Botao>
                    <Botao tamanho="sm" variante="fantasma" disabled={i === form.cascata.length - 1} aria-label={`Descer ${ROTULO_GRUPO_CASCATA[g]}`} onClick={() => mover(i, 1)}>↓</Botao>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="mt-[8px] text-[12px]" style={mudo}>
            Mudar a ordem vale para os próximos pagamentos; o que pagamentos anteriores já quitaram não é refeito.
          </div>
        </Secao>
      </div>

      <div className={card} style={cardStyle}>
        <Secao titulo="Pagamento em parte" tag="FAT004">
          <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
            <CampoNumero rotulo="Mínimo: percentual da fatura" sufixo="% do valor de face" valor={txt.minimoPct} travado={!podeEditar} onChange={(v) => setTxt({ ...txt, minimoPct: v })} />
            <CampoNumero rotulo="Mínimo: piso" sufixo="reais" valor={txt.piso} travado={!podeEditar} onChange={(v) => setTxt({ ...txt, piso: v })} />
          </div>
          <div className="mt-[8px] flex flex-col gap-[4px] text-[12px]" style={mudo}>
            <span>
              Vale o maior dos dois, sempre sobre o valor de face da fatura (nunca sobre o saldo atualizado).
              {exemplo !== null ? ` Numa fatura de ${formatCurrency(104900)}, o mínimo fica em ${formatCurrency(exemplo)}.` : ''}
            </span>
            <span>O pagamento que quita a fatura pode ser menor que o mínimo. Com duas ou mais faturas vencidas, o mínimo passa a ser a mais antiga inteira.</span>
            <span>Pagamento acima do que a conta deve (FAT007): a sobra fica só registrada no pagamento; ainda não vira crédito do cliente.</span>
          </div>
        </Secao>
      </div>

      <div className={card} style={cardStyle}>
        <Secao titulo="Limite de Pix por dia">
          <CampoNumero
            rotulo="Valores diferentes que a mesma conta pode pedir no dia"
            sufixo="por conta, por dia"
            valor={txt.teto}
            travado={!podeEditar}
            onChange={(v) => setTxt({ ...txt, teto: v })}
            ajuda="Pedir de novo o mesmo valor reaproveita o Pix já gerado e não conta. Só existe um Pix ativo por conta: pedir outro valor cancela o anterior."
          />
        </Secao>
      </div>

      {podeEditar ? (
        <div className={card} style={cardStyle}>
          <Secao titulo="Salvar">
            <label className="flex flex-col gap-[4px] text-[12.5px]">
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Motivo da alteração (opcional)</span>
              <input className="h-[32px] w-full rounded-[10px] px-[10px] text-[12.5px]" style={inputStyle} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: início da homologação da Fatura Azit" />
            </label>
            <div className="mt-[10px] flex flex-wrap items-center gap-[10px]">
              <Botao variante="primaria" carregando={ocupado} disabled={!mudou} onClick={() => void salvar()}>
                {viraChave ? (form.pixSobDemanda ? 'Ligar o Pix sob demanda e salvar' : 'Desligar o Pix sob demanda e salvar') : 'Salvar nova versão'}
              </Botao>
              {mudou ? <Botao variante="fantasma" onClick={() => carregar(vigente)}>Desfazer alterações</Botao> : null}
              {!numerosOk ? <span className="text-[12px]" style={{ color: 'var(--danger-fg)' }}>Confira os números: percentuais de 0 a 100 e limite de Pix de 1 a 100.</span> : !mudou ? <span className="text-[12px]" style={mudo}>Nada alterado.</span> : null}
            </div>
          </Secao>
        </div>
      ) : null}

      <div className={card} style={cardStyle}>
        <Secao titulo="Histórico de versões">
          {historico.length === 0 ? (
            <div className="text-[12.5px]" style={mudo}>Nenhuma versão salva: valem os padrões (Pix sob demanda desligado).</div>
          ) : (
            <ul className="flex flex-col gap-[8px]">
              {historico.map((v) => (
                <li key={v.versao} className="rounded-[10px] px-[10px] py-[8px] text-[12.5px]" style={{ background: 'var(--surface-input)' }}>
                  <div className="flex flex-wrap items-baseline gap-[8px]" style={{ color: 'var(--text-primary)' }}>
                    <b>Versão {v.versao}</b>
                    {v.versao === vigente.versao ? <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--accent)' }}>em vigor</span> : null}
                    <span style={mudo}>{formatarInstanteBR(new Date(v.criadoEm))}{v.criadoPor ? ` · ${v.criadoPor}` : ''}</span>
                  </div>
                  <div style={mudo}>{resumoVersao(v)}</div>
                  <div style={mudo}>Ordem: {v.cascata.map((g) => ROTULO_GRUPO_CASCATA[g].split(' (')[0]).join(' → ')}</div>
                  {v.motivo ? <div style={{ color: 'var(--text-primary)' }}>Motivo: {v.motivo}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </div>
    </div>
  );
}
