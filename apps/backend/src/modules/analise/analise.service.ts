import {
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, StatusAnalise, PapelTitular } from '@prisma/client';
import {
  avaliarAnaliseCadastro,
  AnaliseInput,
  ParticipanteAnaliseInput,
  ResultadoAnalise,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AprovacaoService } from '../aprovacao/aprovacao.service';

// ============================================================
// Análise de Cadastro — Fase 1 (doc 02 §14; Requisitos v0.2).
// Consultas registradas manualmente (placeholder funcional).
// O motor de regras é puro (@azit/utils); este service cuida do
// ciclo de vida, pré-condições de transição e auditoria.
// COCAD = instância do motor de aprovação (tipo 'analise_cadastro').
// ============================================================

const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;
const reais = (c: number) => (c / 100).toFixed(2);

const DIA_MS = 24 * 60 * 60 * 1000;

// Transições permitidas além das controladas por ação dedicada (RF-14).
const TRANSICOES_LIVRES: Partial<Record<StatusAnalise, StatusAnalise[]>> = {
  CADASTRO_EM_PREENCHIMENTO: ['DOCUMENTOS_ENVIADOS'],
  DOCUMENTOS_ENVIADOS: ['CONSULTA_INICIAL_REALIZADA'],
  CONSULTA_INICIAL_REALIZADA: ['EM_TRIAGEM_INICIAL'],
  EM_TRIAGEM_INICIAL: ['EM_ANALISE_COMPLEMENTAR'],
  EM_ANALISE_COMPLEMENTAR: ['SCORE_CONSULTADO'],
  SCORE_CONSULTADO: ['RESTRICOES_CONSULTADAS'],
  RESTRICOES_CONSULTADAS: ['PARECER_EMITIDO'],
};

const FINAIS: StatusAnalise[] = ['LIBERADO_PARA_FORMALIZACAO', 'NAO_APROVADO', 'PROPOSTA_ENCERRADA'];

@Injectable()
export class AnaliseService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aprovacao: AprovacaoService,
  ) {}

  // COCAD via motor de aprovação: aprovado → APROVADO_COCAD; reprovado → volta a
  // PARECER_EMITIDO (a NÃO aprovação é sempre ação humana própria — Política §18).
  onModuleInit() {
    this.aprovacao.registrarEfetivador('analise_cadastro', {
      aprovada: async (a) => {
        await this.mudarStatus(a.referenciaId, 'APROVADO_COCAD', a.decisorId, 'Decisão do COCAD: aprovar');
        await this.prisma.db.analiseCadastro.update({
          where: { id: a.referenciaId },
          data: { aprovadaEm: new Date(), aprovadaPor: a.decisorId },
        });
        return 'Análise aprovada pelo COCAD';
      },
      reprovada: async (a) => {
        await this.mudarStatus(
          a.referenciaId,
          'PARECER_EMITIDO',
          a.decisorId,
          'COCAD devolveu: sem aprovação nesta submissão (não aprovação exige ação humana dedicada)',
        );
      },
    });
  }

  // --- ciclo de vida -------------------------------------------------------

  async iniciar(propostaId: string, usuarioId?: string) {
    const proposta = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      include: { vinculos: true, analiseCadastro: true },
    });
    if (!proposta) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Proposta não encontrada' });
    if (proposta.analiseCadastro) return this.dossie(proposta.analiseCadastro.id);

    const versao = await this.prisma.db.versaoParametrosAnalise.findFirst({ orderBy: { vigenteDesde: 'desc' } });
    if (!versao) {
      throw new UnprocessableEntityException({ erro: 'sem_parametros', mensagem: 'Nenhuma versão de parâmetros da análise' });
    }

    // Participantes: comprador principal (titular da proposta) + vínculos.
    const participantes = new Map<string, PapelTitular>();
    participantes.set(proposta.titularId, 'COMPRADOR_PRINCIPAL');
    for (const v of proposta.vinculos) {
      if (!participantes.has(v.titularId)) participantes.set(v.titularId, v.papel);
    }

    const analise = await this.prisma.db.analiseCadastro.create({
      data: {
        propostaId,
        parametroVersaoId: versao.id,
        status: 'CADASTRO_EM_PREENCHIMENTO',
        participantes: {
          create: [...participantes.entries()].map(([titularId, papel]) => ({ titularId, papel })),
        },
        transicoes: {
          create: [
            { de: null, para: 'ATENDIMENTO_INICIADO', usuarioId, motivo: 'Abertura (proposta já existente)' },
            { de: 'ATENDIMENTO_INICIADO', para: 'SIMULACAO_REALIZADA', usuarioId, motivo: 'Oferta já vinculada à proposta' },
            { de: 'SIMULACAO_REALIZADA', para: 'CADASTRO_EM_PREENCHIMENTO', usuarioId },
          ],
        },
      },
    });
    await this.auditar(usuarioId, 'analise_iniciada', analise.id, undefined, { propostaId, politicaVersao: versao.politicaVersao });
    return this.dossie(analise.id);
  }

  async dossie(analiseId: string) {
    const a = await this.carregar(analiseId);
    const avaliacao = this.avaliar(a);
    return {
      id: a.id,
      propostaId: a.propostaId,
      status: a.status,
      politicaVersao: a.parametroVersao.politicaVersao,
      condutorPrincipalTitularId: a.condutorPrincipalTitularId,
      parcelaMensalEquivalente: avaliacao.parcelaMensalEquivalente,
      comprometimento: avaliacao.comprometimento,
      participantes: a.participantes.map((p) => ({
        titularId: p.titularId,
        nome: p.titular.nome,
        papel: p.papel,
        rendaDeclarada: cent(p.rendaDeclarada),
        rendaPresumida: cent(p.rendaPresumida),
        rendaApurada: p.rendaApurada !== null ? cent(p.rendaApurada) : null,
        rendaParcialmenteComprovada: p.rendaParcialmenteComprovada,
        identidadeValidada: p.identidadeValidada,
        cnhValida: p.cnhValida,
        documentoAlternativo: p.documentoAlternativo,
        atividadeComprovada: p.atividadeComprovada,
        evidenciaAtividade: p.evidenciaAtividade,
        processosRelevantes: p.processosRelevantes,
        observacoes: p.observacoes,
        autorizacaoRegistrada: a.autorizacoes.some((x) => x.titularId === p.titularId),
      })),
      autorizacoes: a.autorizacoes,
      consultas: a.consultas.map((c) => ({
        id: c.id, titularId: c.titularId, tipo: c.tipo, fornecedor: c.fornecedor, protocolo: c.protocolo,
        dataConsulta: c.dataConsulta, situacao: c.situacao, motivoFalha: c.motivoFalha, tentativas: c.tentativas,
        resultado: c.resultado, valida: this.consultaValida(c.dataConsulta, a.parametroVersao.validadeConsultaDias),
      })),
      pendencias: a.pendencias,
      ressalvas: a.ressalvas,
      alertasFraude: a.alertasFraude,
      criterios: avaliacao.criterios,
      aprovacaoDiretaPermitida: avaliacao.aprovacaoDiretaPermitida,
      alcadaMinima: avaliacao.alcadaMinima,
      pacoteMinimo: this.pacoteMinimo(a, avaliacao),
      transicoes: a.transicoes,
    };
  }

  async atualizarParticipante(
    analiseId: string,
    titularId: string,
    dto: {
      rendaDeclarada?: number | null;
      rendaPresumida?: number | null;
      rendaApurada?: number | null;
      justificativaRendaApurada?: string;
      rendaParcialmenteComprovada?: boolean;
      identidadeValidada?: boolean;
      cnhValida?: boolean;
      documentoAlternativo?: boolean;
      atividadeComprovada?: boolean;
      evidenciaAtividade?: string;
      processosRelevantes?: boolean;
      observacoes?: string;
    },
    usuarioId?: string,
  ) {
    const a = await this.carregar(analiseId);
    this.garantirNaoFinal(a.status);
    const p = a.participantes.find((x) => x.titularId === titularId);
    if (!p) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Participante não encontrado' });

    // Feedback 22/07 §5: alterar renda apurada JÁ preenchida exige justificativa.
    if (dto.rendaApurada !== undefined && p.rendaApurada !== null && !dto.justificativaRendaApurada) {
      throw new UnprocessableEntityException({
        erro: 'justificativa_obrigatoria',
        mensagem: 'Alterar a renda apurada exige justificativa',
      });
    }

    const antes = { ...p, titular: undefined };
    const atualizado = await this.prisma.db.participanteAnalise.update({
      where: { id: p.id },
      data: {
        rendaDeclarada: dto.rendaDeclarada !== undefined ? (dto.rendaDeclarada === null ? null : reais(dto.rendaDeclarada)) : undefined,
        rendaPresumida: dto.rendaPresumida !== undefined ? (dto.rendaPresumida === null ? null : reais(dto.rendaPresumida)) : undefined,
        rendaApurada: dto.rendaApurada !== undefined ? (dto.rendaApurada === null ? null : reais(dto.rendaApurada)) : undefined,
        rendaParcialmenteComprovada: dto.rendaParcialmenteComprovada,
        identidadeValidada: dto.identidadeValidada,
        cnhValida: dto.cnhValida,
        documentoAlternativo: dto.documentoAlternativo,
        atividadeComprovada: dto.atividadeComprovada,
        evidenciaAtividade: dto.evidenciaAtividade,
        processosRelevantes: dto.processosRelevantes,
        observacoes: dto.observacoes,
      },
    });
    await this.auditar(usuarioId, 'analise_participante_alterado', analiseId, antes, {
      ...atualizado,
      justificativaRendaApurada: dto.justificativaRendaApurada,
    });
    await this.atualizarAgregados(analiseId);
    return this.dossie(analiseId);
  }

  async definirCondutor(analiseId: string, titularId: string, usuarioId?: string) {
    const a = await this.carregar(analiseId);
    this.garantirNaoFinal(a.status);
    const p = a.participantes.find((x) => x.titularId === titularId && x.papel !== 'GARANTIDOR');
    if (!p) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Comprador não encontrado' });
    if (!p.cnhValida) {
      throw new UnprocessableEntityException({ erro: 'condutor_sem_cnh', mensagem: 'Condutor principal deve ter CNH válida (RF-04)' });
    }
    await this.prisma.db.analiseCadastro.update({ where: { id: analiseId }, data: { condutorPrincipalTitularId: titularId } });
    await this.auditar(usuarioId, 'analise_condutor_definido', analiseId, undefined, { titularId });
    return this.dossie(analiseId);
  }

  async registrarAutorizacao(analiseId: string, titularId: string, usuarioId: string, evidenciaRef?: string) {
    const a = await this.carregar(analiseId);
    this.garantirNaoFinal(a.status);
    if (!a.participantes.some((x) => x.titularId === titularId)) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Participante não encontrado' });
    }
    if (a.autorizacoes.some((x) => x.titularId === titularId)) {
      throw new UnprocessableEntityException({ erro: 'ja_registrada', mensagem: 'Autorização já registrada para este participante' });
    }
    await this.prisma.db.autorizacaoConsulta.create({
      data: {
        analiseId,
        titularId,
        atendenteId: usuarioId,
        texto: a.parametroVersao.textoAutorizacao,
        canal: 'WHATSAPP',
        versao: a.parametroVersao.versaoAutorizacao,
        evidenciaRef,
      },
    });
    await this.auditar(usuarioId, 'analise_autorizacao_registrada', analiseId, undefined, {
      titularId, canal: 'WHATSAPP', versao: a.parametroVersao.versaoAutorizacao,
    });
    return this.dossie(analiseId);
  }

  // Fase 1: registro manual da consulta (RF-10). Exige autorização do participante.
  async registrarConsulta(
    analiseId: string,
    dto: {
      titularId: string;
      tipo: 'camada1' | 'score_quod' | 'restritivos';
      fornecedor: string;
      protocolo?: string;
      situacao: 'concluida' | 'falha';
      motivoFalha?: string;
      custo?: number; // centavos
      resultado?: {
        score?: number;
        restritivosFinanceiros?: number; // centavos
        restritivosNaoFinanceiros?: number; // centavos
        protestoChequeExecucao?: boolean;
        resumo?: string;
      };
    },
    usuarioId?: string,
  ) {
    const a = await this.carregar(analiseId);
    this.garantirNaoFinal(a.status);
    if (!a.autorizacoes.some((x) => x.titularId === dto.titularId)) {
      throw new UnprocessableEntityException({
        erro: 'sem_autorizacao',
        mensagem: 'Registre a autorização de consulta do participante antes (RF-05)',
      });
    }
    if (dto.situacao === 'falha' && !dto.motivoFalha) {
      throw new UnprocessableEntityException({ erro: 'motivo_obrigatorio', mensagem: 'Falha de consulta exige motivo (RF-10)' });
    }
    const tipo = dto.tipo === 'camada1' ? 'CAMADA1' : dto.tipo === 'score_quod' ? 'SCORE_QUOD' : 'RESTRITIVOS';
    const tentativas =
      (await this.prisma.db.consultaExterna.count({ where: { analiseId, titularId: dto.titularId, tipo } })) + 1;
    await this.prisma.db.consultaExterna.create({
      data: {
        analiseId,
        titularId: dto.titularId,
        tipo,
        fornecedor: dto.fornecedor,
        protocolo: dto.protocolo,
        situacao: dto.situacao === 'concluida' ? 'CONCLUIDA' : 'FALHA',
        motivoFalha: dto.motivoFalha,
        custo: dto.custo !== undefined ? reais(dto.custo) : undefined,
        tentativas,
        resultado: dto.resultado ? (JSON.parse(JSON.stringify(dto.resultado)) as Prisma.InputJsonValue) : undefined,
        registradaPor: usuarioId,
      },
    });
    // Avança o status de etapa quando a consulta conclui (transições do Processo §7).
    if (dto.situacao === 'concluida') {
      const alvo: StatusAnalise | null =
        tipo === 'CAMADA1' && a.status === 'DOCUMENTOS_ENVIADOS'
          ? 'CONSULTA_INICIAL_REALIZADA'
          : tipo === 'SCORE_QUOD' && ['EM_ANALISE_COMPLEMENTAR', 'EM_TRIAGEM_INICIAL'].includes(a.status)
            ? 'SCORE_CONSULTADO'
            : tipo === 'RESTRITIVOS' && a.status === 'SCORE_CONSULTADO'
              ? 'RESTRICOES_CONSULTADAS'
              : null;
      if (alvo) await this.mudarStatus(analiseId, alvo, usuarioId, `Consulta ${tipo} concluída`);
    }
    await this.auditar(usuarioId, 'analise_consulta_registrada', analiseId, undefined, { ...dto });
    return this.dossie(analiseId);
  }

  async transicionar(analiseId: string, para: StatusAnalise, usuarioId?: string, motivo?: string) {
    const a = await this.carregar(analiseId);
    const livres = TRANSICOES_LIVRES[a.status] ?? [];
    if (!livres.includes(para)) {
      throw new UnprocessableEntityException({
        erro: 'transicao_invalida',
        mensagem: `Transição ${a.status} → ${para} não permitida por esta via`,
      });
    }
    await this.mudarStatus(analiseId, para, usuarioId, motivo);
    return this.dossie(analiseId);
  }

  // --- pendências / complemento (RF-15) ------------------------------------

  async criarPendencia(
    analiseId: string,
    dto: { titularId?: string; codigo: string; descricao: string },
    usuarioId?: string,
  ) {
    const a = await this.carregar(analiseId);
    this.garantirNaoFinal(a.status);
    const prazo = new Date(Date.now() + a.parametroVersao.prazoComplementoDiasUteis * DIA_MS);
    await this.prisma.db.pendenciaAnalise.create({
      data: { analiseId, titularId: dto.titularId, codigo: dto.codigo, descricao: dto.descricao, prazo, origemStatus: a.status, criadaPor: usuarioId },
    });
    if (!FINAIS.includes(a.status) && a.status !== 'PENDENTE_DE_COMPLEMENTO') {
      await this.mudarStatus(analiseId, 'PENDENTE_DE_COMPLEMENTO', usuarioId, `Pendência ${dto.codigo}`);
    }
    return this.dossie(analiseId);
  }

  async cumprirPendencia(analiseId: string, pendenciaId: string, usuarioId?: string) {
    const a = await this.carregar(analiseId);
    const pend = a.pendencias.find((x) => x.id === pendenciaId && x.situacao === 'ABERTA');
    if (!pend) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Pendência aberta não encontrada' });
    await this.prisma.db.pendenciaAnalise.update({
      where: { id: pendenciaId },
      data: { situacao: 'CUMPRIDA', resolvidaEm: new Date(), resolvidaPor: usuarioId },
    });
    const restantes = a.pendencias.filter((x) => x.situacao === 'ABERTA' && x.id !== pendenciaId).length;
    if (restantes === 0 && a.status === 'PENDENTE_DE_COMPLEMENTO') {
      // Retorna à etapa que originou a pendência (RF-15).
      await this.mudarStatus(analiseId, pend.origemStatus, usuarioId, 'Complemento cumprido — retorno à etapa de origem');
    }
    return this.dossie(analiseId);
  }

  // --- parecer e decisão ----------------------------------------------------

  async emitirParecer(
    analiseId: string,
    dto: { tipo: 'aprovacao' | 'cocad' | 'complemento' | 'nao_aprovacao'; texto: string; codigos: string[] },
    usuarioId?: string,
  ) {
    const a = await this.carregar(analiseId);
    this.garantirNaoFinal(a.status);
    const avaliacao = this.avaliar(a);
    // Campos numéricos vêm do sistema (RF-18): snapshot congelado no parecer.
    await this.auditar(usuarioId, 'analise_parecer_emitido', analiseId, undefined, {
      tipo: dto.tipo,
      texto: dto.texto,
      codigos: dto.codigos,
      snapshot: {
        parcelaMensalEquivalente: avaliacao.parcelaMensalEquivalente,
        comprometimento: avaliacao.comprometimento,
        criterios: avaliacao.criterios,
        politicaVersao: a.parametroVersao.politicaVersao,
      },
    });
    if (a.status !== 'PARECER_EMITIDO') {
      await this.mudarStatus(analiseId, 'PARECER_EMITIDO', usuarioId, `Parecer: ${dto.tipo}`);
    }
    return this.dossie(analiseId);
  }

  async aprovarAlcadaAnalista(analiseId: string, usuarioId: string) {
    const a = await this.carregar(analiseId);
    if (a.status !== 'PARECER_EMITIDO') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'Aprovação direta exige parecer emitido' });
    }
    const avaliacao = this.avaliar(a);
    if (!avaliacao.aprovacaoDiretaPermitida) {
      throw new UnprocessableEntityException({
        erro: 'fora_da_alcada',
        mensagem: 'Critérios fora da alçada do analista — submeta ao COCAD',
        criterios: avaliacao.criterios,
      } as object);
    }
    await this.prisma.db.analiseCadastro.update({
      where: { id: analiseId },
      data: { aprovadaEm: new Date(), aprovadaPor: usuarioId },
    });
    await this.mudarStatus(analiseId, 'APROVADO_ALCADA_ANALISTA', usuarioId, 'Todos os critérios dentro da política');
    return this.dossie(analiseId);
  }

  async submeterCocad(analiseId: string, usuarioId: string, recomendacao: string) {
    const a = await this.carregar(analiseId);
    if (a.status !== 'PARECER_EMITIDO') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'Submissão ao COCAD exige parecer emitido' });
    }
    const avaliacao = this.avaliar(a);
    const { id } = await this.aprovacao.criar({
      tipoOperacao: 'analise_cadastro',
      referenciaTipo: 'analise_cadastro',
      referenciaId: analiseId,
      titularId: a.proposta.titularId,
      valorCentavos: cent(a.proposta.valorParcela),
      resumo: `COCAD — análise da proposta ${a.propostaId} (${avaliacao.codigosCocad.join(', ') || 'exceção'})`,
      payload: { recomendacao, codigos: avaliacao.codigosCocad },
      solicitanteId: usuarioId,
    });
    await this.prisma.db.analiseCadastro.update({ where: { id: analiseId }, data: { aprovacaoId: id } });
    await this.mudarStatus(analiseId, 'AGUARDANDO_COCAD', usuarioId, `Submissão ao COCAD (${avaliacao.codigosCocad.join(', ')})`);
    return this.dossie(analiseId);
  }

  // Decisões do COCAD além de aprovar/não aprovar (papéis decisores — controller).
  async aprovarComRessalvas(
    analiseId: string,
    ressalvas: { tipo: string; condicao: string }[],
    usuarioId: string,
  ) {
    const a = await this.carregar(analiseId);
    if (a.status !== 'AGUARDANDO_COCAD') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'Ação exclusiva de análises no COCAD' });
    }
    if (!ressalvas.length) {
      throw new UnprocessableEntityException({ erro: 'ressalva_obrigatoria', mensagem: 'Informe ao menos uma ressalva' });
    }
    const prazo = new Date(Date.now() + a.parametroVersao.prazoRessalvaDiasUteis * DIA_MS);
    await this.prisma.db.ressalvaAnalise.createMany({
      data: ressalvas.map((r) => ({
        analiseId, tipo: r.tipo as never, condicao: r.condicao, prazo, criadaPor: usuarioId,
      })),
    });
    await this.mudarStatus(analiseId, 'APROVADO_COM_RESSALVAS', usuarioId, 'COCAD aprovou condicionado');
    await this.mudarStatus(analiseId, 'RESSALVA_EM_TRATAMENTO', usuarioId, 'Ressalvas em cumprimento');
    return this.dossie(analiseId);
  }

  async validarRessalva(analiseId: string, ressalvaId: string, usuarioId: string, evidenciaRef?: string) {
    const a = await this.carregar(analiseId);
    const r = a.ressalvas.find((x) => x.id === ressalvaId && ['PENDENTE', 'CUMPRIDA'].includes(x.situacao));
    if (!r) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Ressalva pendente não encontrada' });
    await this.prisma.db.ressalvaAnalise.update({
      where: { id: ressalvaId },
      data: { situacao: 'VALIDADA', cumpridaEm: new Date(), validadaPor: usuarioId, validadaEm: new Date(), evidenciaRef },
    });
    const restantes = a.ressalvas.filter((x) => !['VALIDADA'].includes(x.situacao) && x.id !== ressalvaId).length;
    if (restantes === 0 && a.status === 'RESSALVA_EM_TRATAMENTO') {
      await this.mudarStatus(analiseId, 'APROVADO_COCAD', usuarioId, 'Todas as ressalvas cumpridas e validadas');
      await this.prisma.db.analiseCadastro.update({
        where: { id: analiseId },
        data: { aprovadaEm: new Date(), aprovadaPor: usuarioId },
      });
    }
    return this.dossie(analiseId);
  }

  async naoAprovar(analiseId: string, codigo: string, justificativa: string, usuarioId: string) {
    const a = await this.carregar(analiseId);
    this.garantirNaoFinal(a.status);
    await this.prisma.db.analiseCadastro.update({
      where: { id: analiseId },
      data: { encerradaEm: new Date(), motivoEncerramento: 'NAO_APROVACAO', codigoNaoAprovacao: codigo },
    });
    await this.mudarStatus(analiseId, 'NAO_APROVADO', usuarioId, `${codigo}: ${justificativa}`);
    await this.prisma.db.proposta.update({ where: { id: a.propostaId }, data: { status: 'REPROVADA' } });
    await this.auditar(usuarioId, 'analise_nao_aprovada', analiseId, undefined, { codigo, justificativa });
    return this.dossie(analiseId);
  }

  // Encerramentos operacionais ≠ não aprovação (RF-21).
  async encerrar(analiseId: string, motivo: 'desistencia' | 'ausencia_retorno' | 'expiracao', usuarioId?: string) {
    const a = await this.carregar(analiseId);
    this.garantirNaoFinal(a.status);
    const mapa = { desistencia: 'DESISTENCIA', ausencia_retorno: 'AUSENCIA_RETORNO', expiracao: 'EXPIRACAO' } as const;
    await this.prisma.db.analiseCadastro.update({
      where: { id: analiseId },
      data: { encerradaEm: new Date(), motivoEncerramento: mapa[motivo] },
    });
    await this.mudarStatus(analiseId, 'PROPOSTA_ENCERRADA', usuarioId, `Encerramento operacional: ${motivo}`);
    await this.prisma.db.proposta.update({ where: { id: a.propostaId }, data: { status: 'CANCELADA' } });
    return this.dossie(analiseId);
  }

  async liberar(analiseId: string, usuarioId: string) {
    const a = await this.carregar(analiseId);
    const avaliacao = this.avaliar(a);
    const pacote = this.pacoteMinimo(a, avaliacao);
    const faltando = pacote.filter((x) => !x.ok);
    if (faltando.length) {
      throw new UnprocessableEntityException({
        erro: 'pacote_incompleto',
        mensagem: 'Pacote mínimo incompleto (RF-22)',
        itens: faltando,
      } as object);
    }
    await this.prisma.db.analiseCadastro.update({
      where: { id: analiseId },
      data: { liberadaEm: new Date(), liberadaPor: usuarioId },
    });
    await this.mudarStatus(analiseId, 'LIBERADO_PARA_FORMALIZACAO', usuarioId, 'Pacote mínimo completo');
    await this.prisma.db.proposta.update({ where: { id: a.propostaId }, data: { status: 'APROVADA' } });
    await this.auditar(usuarioId, 'analise_liberada', analiseId, undefined, { pacote });
    return this.dossie(analiseId);
  }

  // Gate usado pela formalização (RF-22).
  async statusParaFormalizacao(propostaId: string): Promise<'sem_analise' | 'liberada' | 'bloqueada'> {
    const a = await this.prisma.db.analiseCadastro.findUnique({ where: { propostaId }, select: { status: true } });
    if (!a) return 'sem_analise';
    return a.status === 'LIBERADO_PARA_FORMALIZACAO' ? 'liberada' : 'bloqueada';
  }

  // --- internos --------------------------------------------------------------

  private async carregar(analiseId: string) {
    const a = await this.prisma.db.analiseCadastro.findFirst({
      where: { id: analiseId },
      include: {
        parametroVersao: true,
        proposta: true,
        participantes: { include: { titular: { select: { nome: true } } } },
        autorizacoes: true,
        consultas: { orderBy: { dataConsulta: 'desc' } },
        pendencias: { orderBy: { situacao: 'asc' } },
        ressalvas: true,
        alertasFraude: true,
        transicoes: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!a) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Análise não encontrada' });
    return a;
  }

  private consultaValida(data: Date, validadeDias: number): boolean {
    return Date.now() - data.getTime() <= validadeDias * DIA_MS;
  }

  private avaliar(a: Awaited<ReturnType<AnaliseService['carregar']>>): ResultadoAnalise {
    const v = a.parametroVersao;
    const resumoConsulta = (titularId: string, tipo: 'CAMADA1' | 'SCORE_QUOD' | 'RESTRITIVOS') => {
      const doTipo = a.consultas.filter((c) => c.titularId === titularId && c.tipo === tipo);
      const concluidaValida = doTipo.find(
        (c) => c.situacao === 'CONCLUIDA' && this.consultaValida(c.dataConsulta, v.validadeConsultaDias),
      );
      return {
        resumo: { registrada: !!concluidaValida, falhou: !concluidaValida && doTipo.some((c) => c.situacao === 'FALHA') },
        consulta: concluidaValida,
      };
    };

    const participantes: ParticipanteAnaliseInput[] = a.participantes.map((p) => {
      const score = resumoConsulta(p.titularId, 'SCORE_QUOD');
      const restr = resumoConsulta(p.titularId, 'RESTRITIVOS');
      const rScore = (score.consulta?.resultado ?? null) as { score?: number } | null;
      const rRestr = (restr.consulta?.resultado ?? null) as {
        restritivosFinanceiros?: number;
        restritivosNaoFinanceiros?: number;
        protestoChequeExecucao?: boolean;
      } | null;
      return {
        titularId: p.titularId,
        papel: p.papel,
        identidadeValidada: p.identidadeValidada,
        cnhValida: p.cnhValida,
        documentoAlternativo: p.documentoAlternativo,
        autorizacaoRegistrada: a.autorizacoes.some((x) => x.titularId === p.titularId),
        atividadeComprovada: p.atividadeComprovada,
        rendaApurada: p.rendaApurada !== null ? cent(p.rendaApurada) : null,
        rendaParcialmenteComprovada: p.rendaParcialmenteComprovada,
        scoreQuod: rScore?.score ?? null,
        consultaCamada1: resumoConsulta(p.titularId, 'CAMADA1').resumo,
        consultaScore: score.resumo,
        consultaRestritivos: restr.resumo,
        restritivosFinanceiros: rRestr?.restritivosFinanceiros ?? 0,
        restritivosNaoFinanceiros: rRestr?.restritivosNaoFinanceiros ?? 0,
        protestoChequeExecucao: rRestr?.protestoChequeExecucao ?? false,
        processosRelevantes: p.processosRelevantes,
        alertaFraudeAtivo: a.alertasFraude.some(
          (f) => (!f.titularId || f.titularId === p.titularId) && ['INDICIO_RELEVANTE', 'INDICIO_CONFIRMADO'].includes(f.nivel) && !f.resolvidoEm,
        ),
      };
    });

    const freq = a.proposta.frequencia === 'SEMANAL' ? 'semanal' : a.proposta.frequencia === 'QUINZENAL' ? 'quinzenal' : 'mensal';
    const entrada: AnaliseInput = {
      participantes,
      condutorPrincipalTitularId: a.condutorPrincipalTitularId,
      valorParcela: cent(a.proposta.valorParcela),
      frequencia: freq,
      pendenciasAbertas: a.pendencias.filter((x) => x.situacao === 'ABERTA').length,
      parametros: {
        comprometimentoAlcada: Number(v.comprometimentoAlcada.toString()),
        scoreQuodMinimo: v.scoreQuodMinimo,
        restritivoNaoFinanceiroMax: cent(v.restritivoNaoFinanceiroMax),
        fatorSemanal: Number(v.fatorSemanal.toString()),
        fatorQuinzenal: Number(v.fatorQuinzenal.toString()),
      },
    };
    return avaliarAnaliseCadastro(entrada);
  }

  // Pacote mínimo (RF-22) — cada item nominal.
  private pacoteMinimo(a: Awaited<ReturnType<AnaliseService['carregar']>>, r: ResultadoAnalise) {
    const aprovada = ['APROVADO_ALCADA_ANALISTA', 'APROVADO_COCAD'].includes(a.status);
    const aprovacaoValida =
      aprovada && a.aprovadaEm !== null &&
      Date.now() - (a.aprovadaEm as Date).getTime() <= a.parametroVersao.validadeAprovacaoDiasUteis * DIA_MS * 1.4; // dias úteis aproximados
    const compradores = a.participantes.filter((p) => p.papel !== 'GARANTIDOR');
    const condutor = compradores.find((p) => p.titularId === a.condutorPrincipalTitularId);
    const consultasOkOuDecididas =
      !r.criterios.some((c) => c.chave.startsWith('consulta_')) || a.status === 'APROVADO_COCAD';
    return [
      { item: 'Decisão válida (aprovação não vencida)', ok: aprovacaoValida },
      { item: 'CNH válida do condutor principal', ok: !!condutor?.cnhValida },
      { item: 'Consultas válidas ou ausência decidida pelo COCAD', ok: consultasOkOuDecididas },
      { item: 'Renda apurada de todos os compradores', ok: compradores.every((p) => p.rendaApurada !== null) },
      { item: 'Sem pendências abertas', ok: !a.pendencias.some((p) => p.situacao === 'ABERTA') },
      { item: 'Ressalvas cumpridas e validadas', ok: !a.ressalvas.some((x) => x.situacao !== 'VALIDADA' && x.situacao !== 'EXPIRADA') || a.ressalvas.every((x) => x.situacao === 'VALIDADA') },
      { item: 'Sem bloqueio de formalização (fraude/CNH)', ok: !r.bloqueiaFormalizacao },
      { item: 'Autorização de consulta de todos os participantes', ok: a.participantes.every((p) => a.autorizacoes.some((x) => x.titularId === p.titularId)) },
    ];
  }

  private async atualizarAgregados(analiseId: string) {
    const a = await this.carregar(analiseId);
    const r = this.avaliar(a);
    await this.prisma.db.analiseCadastro.update({
      where: { id: analiseId },
      data: {
        parcelaMensalEquivalente: reais(r.parcelaMensalEquivalente),
        comprometimento: r.comprometimento !== null ? (r.comprometimento * 100).toFixed(2) : null,
        rendaApuradaTotal: (() => {
          const compradores = a.participantes.filter((p) => p.papel !== 'GARANTIDOR');
          if (!compradores.every((p) => p.rendaApurada !== null)) return null;
          const soma = compradores.reduce((s, p) => s + cent(p.rendaApurada), 0);
          return reais(soma);
        })(),
      },
    });
  }

  private garantirNaoFinal(status: StatusAnalise) {
    if (FINAIS.includes(status)) {
      throw new UnprocessableEntityException({ erro: 'analise_finalizada', mensagem: `Análise em estado final (${status})` });
    }
  }

  private async mudarStatus(analiseId: string, para: StatusAnalise, usuarioId?: string, motivo?: string) {
    const a = await this.prisma.db.analiseCadastro.findUnique({ where: { id: analiseId }, select: { status: true } });
    if (!a) return;
    await this.prisma.db.$transaction([
      this.prisma.db.analiseCadastro.update({ where: { id: analiseId }, data: { status: para } }),
      this.prisma.db.transicaoAnalise.create({ data: { analiseId, de: a.status, para, usuarioId, motivo } }),
    ]);
  }

  private async auditar(usuarioId: string | undefined, acao: string, analiseId: string, antes?: unknown, depois?: unknown) {
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao,
        entidade: 'analise_cadastro',
        entidadeId: analiseId,
        antes: antes ? (JSON.parse(JSON.stringify(antes)) as Prisma.InputJsonValue) : undefined,
        depois: depois ? (JSON.parse(JSON.stringify(depois)) as Prisma.InputJsonValue) : undefined,
      },
    });
  }
}
