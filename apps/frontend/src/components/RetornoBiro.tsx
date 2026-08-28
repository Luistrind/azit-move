import { useState } from 'react';

// Visualizador do retorno COMPLETO de uma consulta de birô.
// Feedback 28/08 (exemplo: relatório do portal Quod): a tela organiza o retorno
// em SEÇÕES nomeadas em português com tabela Atributo → Resultado, atributos
// traduzidos e datas em dd/mm/aaaa — mesma informação, leitura de relatório.
// Movimentações de processo e chaves-ruído ficam ocultas (só contagem).

const CHAVES_OCULTAS = [
  'movements', 'movimentacoes', 'movimentações', 'movimentos', 'andamentos',
  'updates', 'lawsuitupdates', 'petitions', 'peticoes', 'decisions', 'decisoes',
];

// Ruído sem valor analítico (o dado continua salvo — só não polui a leitura).
const CHAVES_RUIDO = [
  'zodiacsign', 'chinesesign', 'namewordcount', 'nameuniquenessscore',
  'hascommonname', 'commonnamepercent', 'firstandlastnameexistenceapproximate',
];

// Tradução dos atributos conhecidos (BigDataCorp + Quod via Marketplace) —
// nomes por extenso como no relatório do portal. Chave desconhecida cai no
// fallback (camelCase → palavras) para nunca esconder informação.
const ROTULOS_PT: Record<string, string> = {
  // topo / metadados
  bruto: 'Retorno completo do birô',
  statusapi: 'Mensagem da API',
  protocolo: 'Protocolo',
  dataconsulta: 'Data da consulta',
  // Camada 1 — identificação (BasicData)
  basic: 'Dados cadastrais',
  basicdata: 'Dados cadastrais',
  age: 'Idade',
  name: 'Nome',
  gender: 'Sexo',
  aliases: 'Nomes alternativos',
  commonname: 'Nome comum',
  standardizedname: 'Nome padronizado',
  birthdate: 'Data de nascimento',
  fathername: 'Nome do pai',
  mothername: 'Nome da mãe',
  taxidnumber: 'CPF',
  taxidorigin: 'Origem do CPF',
  taxidstatus: 'Situação do CPF',
  taxidstatusdate: 'Situação do CPF em',
  taxidcountry: 'País do CPF',
  taxidfiscalregion: 'Região fiscal',
  birthcountry: 'País de nascimento',
  hasobitindication: 'Indicação de óbito',
  maritalstatusdata: 'Estado civil',
  creationdate: 'Cadastro criado em',
  lastupdatedate: 'Última atualização',
  alternativeidnumbers: 'Documentos alternativos',
  nationality: 'Nacionalidade',
  // Camada 1 — financeiro (FinancialData)
  financialdata: 'Dados financeiros',
  totalassets: 'Faixa de patrimônio',
  estimatedincomerange: 'Faixa de renda presumida',
  incomeestimates: 'Estimativas de renda',
  iscurrentlyemployed: 'Empregado atualmente',
  occupationstartdate: 'Início da ocupação',
  lastoccupationstartdate: 'Início da última ocupação',
  professioncode: 'Código da profissão',
  profession: 'Profissão',
  // Camada 1 — processos
  processes: 'Processos',
  lawsuits: 'Processos judiciais',
  totallawsuits: 'Total de processos',
  totallawsuitsasauthor: 'Como autor',
  totallawsuitsasdefendant: 'Como réu',
  totallawsuitsasother: 'Como outra parte',
  number: 'Número',
  type: 'Tipo',
  mainsubject: 'Assunto principal',
  courtname: 'Tribunal',
  courttype: 'Justiça',
  courtlevel: 'Instância',
  judgingbody: 'Órgão julgador',
  state: 'UF',
  status: 'Situação',
  value: 'Valor',
  parties: 'Partes',
  partytype: 'Tipo de parte',
  polarity: 'Polo',
  ispartyactive: 'Parte ativa',
  doc: 'Documento',
  lawyers: 'Advogados',
  publicationdate: 'Publicação',
  noticedate: 'Autuação',
  lastmovementdate: 'Última movimentação',
  redistributiondate: 'Última redistribuição',
  closedate: 'Encerramento',
  capturedate: 'Capturado em',
  courtdistrict: 'Comarca',
  // Quod — Score (QUODCreditScorePerson)
  quodcreditscoreperson: 'Dados de Score Quod Pessoal',
  score: 'Pontuação de crédito',
  scorepoints: 'Pontuação de crédito',
  paymentcommitmentscore: 'Pontuação de comprometimento de pagamento',
  paymentcapacityscore: 'Pontuação de capacidade de pagamento',
  capacityscore: 'Pontuação de capacidade de pagamento',
  commitmentscore: 'Pontuação de comprometimento de pagamento',
  referencedate: 'Data de referência',
  // Quod — Risco (QUODCreditRiskPerson)
  quodcreditriskperson: 'Risco de Crédito Quod Pessoal',
  transactionid: 'Identificador de transação',
  hasminimalrecord: 'Possui registro mínimo',
  hasnegativeindicator: 'Possui indicativo de negativação',
  hasinquiriesindicator: 'Possui indicativo de consultas',
  totalindebtednessvalue: 'Valor total devido (R$)',
  totalactivenegativeappointments: 'Apontamentos negativos ativos',
  totalinactivenegativeappointments: 'Apontamentos negativos inativos',
  negativeappointmentsbynature: 'Apontamentos negativos por natureza',
  negativeappointmentsdetails: 'Detalhes dos apontamentos negativos',
  nature: 'Natureza',
  amount: 'Quantia (R$)',
  totallawsuitappointments: 'Apontamentos de processos',
  lastnegativeappointmentdate: 'Data do último apontamento negativo',
  totalregisteredprotests: 'Protestos registrados',
  inquirieslast30days: 'Consultas nos últimos 30 dias',
  inquirieslast60days: 'Consultas nos últimos 60 dias',
  inquirieslast90days: 'Consultas nos últimos 90 dias',
  inquiriesbeyond90days: 'Consultas além dos últimos 90 dias',
  totalinquiriesbysegment: 'Consultas por segmento',
  // resumos que o sistema grava junto
  restritivosfinanceiros: 'Restritivos financeiros (R$)',
  restritivosnaofinanceiros: 'Restritivos não financeiros (R$)',
  protestochequeexecucao: 'Protesto / cheque / execução',
  apontamentosativos: 'Apontamentos ativos',
  protestos: 'Protestos',
  cpfregular: 'CPF regular',
  nomeoficial: 'Nome oficial',
  idade: 'Idade',
  rendapresumida: 'Renda presumida',
  processos: 'Processos',
  processoscomoreu: 'Processos como réu',
  alertas: 'Alertas',
};

function chaveNorm(chave: string): string {
  return chave.toLowerCase().replace(/[^a-zà-ü0-9]/g, '');
}

function ocultar(chave: string): boolean {
  const k = chaveNorm(chave);
  return CHAVES_OCULTAS.some((c) => k === chaveNorm(c));
}

function ruido(chave: string): boolean {
  return CHAVES_RUIDO.includes(chaveNorm(chave));
}

// Dicionário PT primeiro; desconhecidas caem no "TaxIdStatus" → "Tax Id Status".
function rotulo(chave: string): string {
  const pt = ROTULOS_PT[chaveNorm(chave)];
  if (pt) return pt;
  const solta = chave
    .replace(/_/g, ' ')
    .replace(/([a-zà-ü])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return solta.charAt(0).toUpperCase() + solta.slice(1);
}

// Datas ISO → dd/mm/aaaa; booleanos → Sim/Não.
function valorSimples(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (v === true) return 'Sim';
  if (v === false) return 'Não';
  const s = String(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(T[\d:.]+Z?)?$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return s;
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function Tabela({ dados, nivel }: { dados: Record<string, unknown>; nivel: number }) {
  const entradas = Object.entries(dados).filter(([k]) => !ruido(k));
  if (entradas.length === 0) return <div className="px-[8px] py-[4px] text-[12px] opacity-60">— vazio —</div>;
  return (
    <table className="w-full table-fixed border-collapse text-[12px]">
      <tbody>
        {entradas.map(([k, v]) => (
          <tr key={k} style={{ borderTop: '1px solid var(--border-light)' }}>
            <td className="w-[34%] break-words px-[8px] py-[5px] align-top font-semibold" style={{ color: 'var(--text-label)' }}>
              {rotulo(k)}
            </td>
            <td className="break-words px-[8px] py-[5px]">
              {ocultar(k) ? (
                <span className="opacity-60">
                  {Array.isArray(v) ? `${v.length} movimentação(ões) — ocultadas` : 'ocultado'}
                </span>
              ) : (
                <Valor v={v} nivel={nivel} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Valor({ v, nivel }: { v: unknown; nivel: number }) {
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="opacity-60">— nenhum —</span>;
    if (v.every((x) => !ehObjeto(x) && !Array.isArray(x))) {
      return <span className="break-words">{v.map(valorSimples).join(' · ')}</span>;
    }
    return (
      <div className="flex flex-col gap-[6px]">
        {v.map((item, i) => (
          <div key={i} className="rounded-[8px]" style={{ background: nivel % 2 ? 'var(--surface)' : 'var(--surface-input)', border: '1px solid var(--border-light)' }}>
            <div className="px-[8px] pt-[4px] text-[10.5px] font-bold opacity-60">#{i + 1}</div>
            {ehObjeto(item) ? <Tabela dados={item} nivel={nivel + 1} /> : <div className="break-words px-[8px] pb-[5px]">{valorSimples(item)}</div>}
          </div>
        ))}
      </div>
    );
  }
  if (ehObjeto(v)) {
    return (
      <div className="rounded-[8px]" style={{ background: nivel % 2 ? 'var(--surface)' : 'var(--surface-input)', border: '1px solid var(--border-light)' }}>
        <Tabela dados={v} nivel={nivel + 1} />
      </div>
    );
  }
  return <span className="break-words">{valorSimples(v)}</span>;
}

// Nível 0 no formato do relatório: cada bloco vira uma SEÇÃO com título
// ("Dados cadastrais", "Risco de Crédito Quod Pessoal"…) e a tabela
// Atributo → Resultado dentro; escalares soltos formam a seção "Identificação".
function Relatorio({ dados }: { dados: Record<string, unknown> }) {
  const entradas = Object.entries(dados).filter(([k]) => !ruido(k));
  const escalares = entradas.filter(([, v]) => !ehObjeto(v) && !Array.isArray(v));
  const blocos = entradas.filter(([, v]) => ehObjeto(v) || Array.isArray(v));
  return (
    <div className="flex flex-col gap-[14px]">
      {escalares.length > 0 && (
        <section>
          <div className="mb-[4px] font-display text-[13px] font-bold" style={{ color: 'var(--navy)' }}>Identificação</div>
          <div className="rounded-[10px]" style={{ border: '1px solid var(--border)' }}>
            <Tabela dados={Object.fromEntries(escalares)} nivel={1} />
          </div>
        </section>
      )}
      {blocos.map(([k, v]) => (
        <section key={k}>
          <div className="mb-[4px] font-display text-[13px] font-bold" style={{ color: 'var(--navy)' }}>{rotulo(k)}</div>
          <div className="rounded-[10px]" style={{ border: '1px solid var(--border)' }}>
            {ocultar(k) ? (
              <div className="px-[10px] py-[6px] text-[12px] opacity-60">{Array.isArray(v) ? `${v.length} movimentação(ões) — ocultadas` : 'ocultado'}</div>
            ) : ehObjeto(v) ? (
              // Um nível de "casca" (ex.: bruto → seções internas) vira seções também.
              Object.entries(v).filter(([ik]) => !ruido(ik)).every(([, iv]) => ehObjeto(iv) || Array.isArray(iv)) && Object.keys(v).length > 0 ? (
                <div className="flex flex-col gap-[10px] p-[10px]">
                  {Object.entries(v).filter(([ik]) => !ruido(ik)).map(([ik, iv]) => (
                    <div key={ik}>
                      <div className="mb-[3px] text-[12px] font-bold" style={{ color: 'var(--text-label)' }}>{rotulo(ik)}</div>
                      <div className="rounded-[8px]" style={{ border: '1px solid var(--border-light)' }}>
                        {ocultar(ik)
                          ? <div className="px-[10px] py-[6px] text-[12px] opacity-60">{Array.isArray(iv) ? `${iv.length} item(ns) — ocultados` : 'ocultado'}</div>
                          : <Valor v={iv} nivel={1} />}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Tabela dados={v} nivel={1} />
              )
            ) : (
              <Valor v={v} nivel={1} />
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

export function BotaoVerRetorno({ titulo, resultado }: { titulo: string; resultado: Record<string, unknown> | null }) {
  const [aberto, setAberto] = useState(false);
  if (!resultado || Object.keys(resultado).length === 0) return null;
  return (
    <>
      <button
        className="ml-[6px] inline-flex items-center gap-[4px] rounded-[7px] px-[8px] py-[2px] text-[11.5px] font-semibold"
        style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--navy)' }}
        title="Ver o retorno completo desta consulta"
        onClick={() => setAberto(true)}
      >
        👁 Ver retorno
      </button>
      {aberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-[16px]" style={{ background: 'rgba(0,16,41,.55)' }} onClick={() => setAberto(false)}>
          <div
            className="flex h-[92vh] w-[min(1100px,95vw)] flex-col overflow-hidden rounded-[14px]"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-[10px] px-[18px] py-[12px]" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="font-display text-[14px] font-bold">{titulo}</div>
              <button
                onClick={() => setAberto(false)}
                className="h-[32px] rounded-[8px] px-[12px] text-[13px] font-semibold"
                style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
              >
                Fechar ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-[16px] py-[12px]">
              <Relatorio dados={resultado} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
