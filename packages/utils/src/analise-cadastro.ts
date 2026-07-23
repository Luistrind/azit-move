// ============================================================
// Motor de regras da Análise de Cadastro (Política v1.0 §13-§16;
// Requisitos v0.2 RF-09/RF-10/RF-11). Função PURA: recebe o dossiê
// resumido e os parâmetros versionados, devolve a avaliação por
// critério + consolidado. NUNCA produz "não aprovado" — apenas
// bloqueia aprovação direta e encaminha (antirrequisito nº 1).
// Valores monetários em CENTAVOS; percentuais em fração.
// ============================================================

export type FrequenciaAnalise = 'semanal' | 'quinzenal' | 'mensal';
export type SituacaoCriterio = 'alcada' | 'complemento' | 'cocad';

export interface ParametrosAnalise {
  comprometimentoAlcada: number; // fração (0.40)
  scoreQuodMinimo: number; // 600
  restritivoNaoFinanceiroMax: number; // centavos (50_000)
  fatorSemanal: number; // 4.345
  fatorQuinzenal: number; // 2.17
}

export interface ConsultaResumo {
  registrada: boolean; // existe consulta CONCLUIDA válida
  falhou: boolean; // última tentativa em FALHA (indisponibilidade)
}

export interface ParticipanteAnaliseInput {
  titularId: string;
  papel: 'COMPRADOR_PRINCIPAL' | 'COMPRADOR_SECUNDARIO' | 'GARANTIDOR';
  identidadeValidada: boolean;
  cnhValida: boolean;
  documentoAlternativo: boolean; // RG aceito (RF-04)
  autorizacaoRegistrada: boolean;
  atividadeComprovada: boolean;
  rendaApurada: number | null; // centavos
  rendaParcialmenteComprovada: boolean;
  scoreQuod: number | null; // null = não registrado
  consultaCamada1: ConsultaResumo;
  consultaScore: ConsultaResumo;
  consultaRestritivos: ConsultaResumo;
  restritivosFinanceiros: number; // centavos ativos
  restritivosNaoFinanceiros: number; // centavos ativos
  protestoChequeExecucao: boolean;
  processosRelevantes: boolean;
  alertaFraudeAtivo: boolean; // INDICIO_RELEVANTE ou INDICIO_CONFIRMADO não resolvido
}

export interface AnaliseInput {
  participantes: ParticipanteAnaliseInput[];
  condutorPrincipalTitularId: string | null;
  valorParcela: number; // centavos
  frequencia: FrequenciaAnalise;
  pendenciasAbertas: number;
  parametros: ParametrosAnalise;
}

export interface CriterioAvaliado {
  chave: string;
  titularId?: string;
  situacao: SituacaoCriterio;
  codigo?: string; // COC-xx | COM-xx
  valorObservado?: string;
  bloqueiaAprovacaoDireta: boolean;
  bloqueiaFormalizacao?: boolean;
  descricao: string;
}

export interface ResultadoAnalise {
  criterios: CriterioAvaliado[];
  parcelaMensalEquivalente: number; // centavos
  comprometimento: number | null; // fração (null se sem renda apurada)
  aprovacaoDiretaPermitida: boolean;
  alcadaMinima: 'ANALISTA' | 'COCAD';
  exigeComplemento: boolean;
  bloqueiaFormalizacao: boolean;
  codigosCocad: string[];
  codigosComplemento: string[];
}

// RF-09 — conversão exclusivamente analítica (não altera cronograma).
export function parcelaMensalEquivalente(
  valorParcela: number,
  frequencia: FrequenciaAnalise,
  parametros: Pick<ParametrosAnalise, 'fatorSemanal' | 'fatorQuinzenal'>,
): number {
  const fator =
    frequencia === 'semanal' ? parametros.fatorSemanal : frequencia === 'quinzenal' ? parametros.fatorQuinzenal : 1;
  return Math.round(valorParcela * fator);
}

export function avaliarAnaliseCadastro(input: AnaliseInput): ResultadoAnalise {
  const c: CriterioAvaliado[] = [];
  const p = input.parametros;
  const compradores = input.participantes.filter((x) => x.papel !== 'GARANTIDOR');

  const pme = parcelaMensalEquivalente(input.valorParcela, input.frequencia, p);
  // Renda apurada total: soma apenas dos COMPRADORES (garantidor nunca soma — Política §21).
  const rendas = compradores.map((x) => x.rendaApurada).filter((v): v is number => v !== null && v > 0);
  const rendaTotal = rendas.length === compradores.length ? rendas.reduce((a, b) => a + b, 0) : null;
  const comprometimento = rendaTotal ? pme / rendaTotal : null;

  // --- Critérios por participante (Política §13; falha de qualquer um afeta a proposta inteira — §12) ---
  for (const part of input.participantes) {
    const t = part.titularId;

    if (!part.identidadeValidada) {
      c.push({ chave: 'identidade', titularId: t, situacao: 'complemento', codigo: 'COM-04', bloqueiaAprovacaoDireta: true, descricao: 'Identidade não validada' });
    }
    if (!part.autorizacaoRegistrada) {
      c.push({ chave: 'autorizacao', titularId: t, situacao: 'complemento', codigo: 'COM-05', bloqueiaAprovacaoDireta: true, descricao: 'Autorização de consulta ausente' });
    }
    if (!part.atividadeComprovada) {
      c.push({ chave: 'atividade', titularId: t, situacao: 'complemento', codigo: 'COM-08', bloqueiaAprovacaoDireta: true, descricao: 'Atividade não evidenciada' });
    }
    if (part.papel !== 'GARANTIDOR' && part.rendaApurada === null) {
      c.push({ chave: 'renda', titularId: t, situacao: 'complemento', codigo: 'COM-06', bloqueiaAprovacaoDireta: true, descricao: 'Renda apurada não registrada' });
    }
    if (part.rendaParcialmenteComprovada) {
      c.push({ chave: 'renda_parcial', titularId: t, situacao: 'cocad', codigo: 'COC-08', bloqueiaAprovacaoDireta: true, descricao: 'Renda parcialmente comprovada' });
    }

    // Consultas — feedback 22/07 §3: falha/ausência NÃO trava o fluxo; eleva alçada ao COCAD.
    const consultas: Array<[string, ConsultaResumo]> = [
      ['camada1', part.consultaCamada1],
      ['score_quod', part.consultaScore],
      ['restritivos', part.consultaRestritivos],
    ];
    for (const [nome, cons] of consultas) {
      if (!cons.registrada) {
        c.push({
          chave: `consulta_${nome}`, titularId: t, situacao: 'cocad', codigo: 'COC-11',
          bloqueiaAprovacaoDireta: true,
          descricao: cons.falhou ? `Consulta ${nome} falhou/indisponível — decisão sobe ao COCAD` : `Consulta ${nome} não registrada — decisão sobe ao COCAD`,
        });
      }
    }

    // Score Quod (Política §13.5) — só avalia se registrado.
    if (part.scoreQuod !== null && part.scoreQuod < p.scoreQuodMinimo) {
      c.push({ chave: 'score_quod', titularId: t, situacao: 'cocad', codigo: 'COC-02', valorObservado: String(part.scoreQuod), bloqueiaAprovacaoDireta: true, descricao: `Score Quod ${part.scoreQuod} abaixo de ${p.scoreQuodMinimo}` });
    }

    // Restritivos (Política §13.6)
    if (part.restritivosFinanceiros > 0) {
      c.push({ chave: 'restritivo_financeiro', titularId: t, situacao: 'cocad', codigo: 'COC-03', bloqueiaAprovacaoDireta: true, descricao: 'Restritivo financeiro ativo' });
    }
    if (part.restritivosNaoFinanceiros > p.restritivoNaoFinanceiroMax) {
      c.push({ chave: 'restritivo_nao_financeiro', titularId: t, situacao: 'cocad', codigo: 'COC-04', valorObservado: String(part.restritivosNaoFinanceiros), bloqueiaAprovacaoDireta: true, descricao: 'Restritivo não financeiro acima do limite' });
    }
    if (part.protestoChequeExecucao) {
      c.push({ chave: 'protesto_cheque_execucao', titularId: t, situacao: 'cocad', codigo: 'COC-05', bloqueiaAprovacaoDireta: true, descricao: 'Protesto, cheque sem fundo ou execução ativa' });
    }
    if (part.processosRelevantes) {
      c.push({ chave: 'processos', titularId: t, situacao: 'cocad', codigo: 'COC-06', bloqueiaAprovacaoDireta: true, descricao: 'Processo judicial relevante ativo' });
    }
    if (part.alertaFraudeAtivo) {
      c.push({ chave: 'fraude', titularId: t, situacao: 'cocad', codigo: 'COC-07', bloqueiaAprovacaoDireta: true, bloqueiaFormalizacao: true, descricao: 'Indício de fraude não resolvido' });
    }
    if (part.papel === 'GARANTIDOR') {
      c.push({ chave: 'garantidor', titularId: t, situacao: 'cocad', codigo: 'COC-10', bloqueiaAprovacaoDireta: true, descricao: 'Garantidor presente — decisão do COCAD' });
    }
  }

  // --- CNH e condutor principal (feedback 22/07 §1; RF-04) — critério da PROPOSTA ---
  const algumaCnh = compradores.some((x) => x.cnhValida);
  if (!algumaCnh) {
    c.push({ chave: 'cnh_proposta', situacao: 'complemento', codigo: 'COM-03', bloqueiaAprovacaoDireta: true, bloqueiaFormalizacao: true, descricao: 'Nenhum comprador possui CNH válida — bloqueio de formalização' });
  }
  const condutor = compradores.find((x) => x.titularId === input.condutorPrincipalTitularId);
  if (!input.condutorPrincipalTitularId) {
    c.push({ chave: 'condutor_principal', situacao: 'complemento', codigo: 'COM-04', bloqueiaAprovacaoDireta: true, descricao: 'Condutor principal não identificado' });
  } else if (!condutor || !condutor.cnhValida) {
    c.push({ chave: 'condutor_principal', situacao: 'complemento', codigo: 'COM-03', bloqueiaAprovacaoDireta: true, bloqueiaFormalizacao: true, descricao: 'Condutor principal sem CNH válida' });
  }

  // --- Comprometimento (Política §13.4) ---
  if (comprometimento !== null && comprometimento > p.comprometimentoAlcada) {
    c.push({
      chave: 'comprometimento', situacao: 'cocad', codigo: 'COC-01',
      valorObservado: `${(comprometimento * 100).toFixed(1)}%`,
      bloqueiaAprovacaoDireta: true,
      descricao: `Comprometimento acima de ${(p.comprometimentoAlcada * 100).toFixed(0)}%`,
    });
  }

  // --- Pendências abertas (Política §15) ---
  if (input.pendenciasAbertas > 0) {
    c.push({ chave: 'pendencias', situacao: 'complemento', bloqueiaAprovacaoDireta: true, descricao: `${input.pendenciasAbertas} pendência(s) aberta(s)` });
  }

  const codigosCocad = c.filter((x) => x.situacao === 'cocad' && x.codigo).map((x) => x.codigo as string);
  const codigosComplemento = c.filter((x) => x.situacao === 'complemento' && x.codigo).map((x) => x.codigo as string);
  const bloqueado = c.some((x) => x.bloqueiaAprovacaoDireta);

  return {
    criterios: c,
    parcelaMensalEquivalente: pme,
    comprometimento,
    aprovacaoDiretaPermitida: !bloqueado,
    alcadaMinima: c.some((x) => x.situacao === 'cocad') ? 'COCAD' : 'ANALISTA',
    exigeComplemento: c.some((x) => x.situacao === 'complemento'),
    bloqueiaFormalizacao: c.some((x) => x.bloqueiaFormalizacao),
    codigosCocad,
    codigosComplemento,
  };
}
