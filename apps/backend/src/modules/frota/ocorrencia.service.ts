import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Prisma, ResponsavelOcorrencia, StatusOcorrenciaVeiculo, TipoOcorrenciaVeiculo } from '@prisma/client';
import { formatCurrency, inicioHojeBrasilUTC } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { NotificacaoService } from '../notificacao/notificacao.service';

// ============================================================
// Ocorrências do veículo — doc 02 §25.2 e §25.3 (decisão Luís 20/09).
// Multa, IPVA, licenciamento e afins chegam pela PLACA. Quem responde sai da
// DATA DO FATO contra a posse do cliente (cláusulas 6.4/6.7 do contrato), e o
// desfecho é negociado: nem toda ocorrência vira cobrança.
// ============================================================

const cent = (d: Prisma.Decimal | number): number => Math.round(Number(d.toString()) * 100);
const reais = (c: number): Prisma.Decimal => new Prisma.Decimal((c / 100).toFixed(2));
const DIA_MS = 24 * 60 * 60 * 1000;
const UPLOADS_DIR = join(process.cwd(), 'uploads', 'ocorrencias');

export const ROTULO_TIPO: Record<TipoOcorrenciaVeiculo, string> = {
  MULTA: 'Multa',
  NOTIFICACAO: 'Notificação de autuação',
  IPVA: 'IPVA',
  LICENCIAMENTO: 'Licenciamento',
  DPVAT: 'DPVAT',
  PEDAGIO: 'Pedágio',
  AVARIA: 'Avaria',
  OUTRA: 'Outra',
};

export const ROTULO_STATUS_OCORRENCIA: Record<StatusOcorrenciaVeiculo, string> = {
  REGISTRADA: 'Registrada',
  EM_RECURSO: 'Em recurso',
  AGUARDANDO_COMPROVANTE: 'Aguardando comprovante do cliente',
  REPASSADA: 'Repassada ao cliente',
  ASSUMIDA_AZIT: 'Assumida pela Azit',
  QUITADA: 'Quitada',
  CANCELADA: 'Cancelada',
};

const ABERTAS: StatusOcorrenciaVeiculo[] = ['REGISTRADA', 'EM_RECURSO', 'AGUARDANDO_COMPROVANTE'];

export interface DadosOcorrencia {
  ativoId?: string;
  placa?: string;
  tipo: TipoOcorrenciaVeiculo;
  orgao?: string;
  numeroAuto?: string;
  descricao?: string;
  dataFato: string;
  dataVencimento?: string;
  prazoIndicacao?: string;
  valor?: number; // centavos
  valorComDesconto?: number; // centavos
  origem?: string;
  origemRef?: string;
  bruto?: Prisma.InputJsonValue;
}

@Injectable()
export class OcorrenciaService {
  private readonly logger = new Logger(OcorrenciaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alertas: NotificacaoService,
  ) {}

  // ---------------- Responsabilidade pela data do fato ----------------

  // Posse do cliente: da ativação (entrada paga / cronograma / assinatura) até
  // o encerramento do contrato. Fato dentro da janela = do CLIENTE (cl. 6.4/6.7).
  async responsavelPorData(ativoId: string, dataFato: Date) {
    const contratos = await this.prisma.db.contratoCredito.findMany({
      // Contrato que existiu de fato: ativo hoje ou já encerrado (quitação,
      // novação, retomada). Rascunho e aguardando assinatura nunca deram posse.
      where: { ativoId, deletedAt: null, status: { in: ['ATIVO', 'ENCERRADO'] } },
      select: {
        id: true, numero: true, status: true, dataAssinatura: true, entradaPagaEm: true,
        cronogramaGeradoEm: true, dataEncerramento: true,
        conta: { select: { id: true, titular: { select: { id: true, nome: true } } } },
      },
      orderBy: { dataAssinatura: 'asc' },
    });
    for (const c of contratos) {
      const inicio = c.entradaPagaEm ?? c.cronogramaGeradoEm ?? c.dataAssinatura;
      const fim = c.dataEncerramento;
      if (inicio && dataFato >= inicio && (!fim || dataFato <= fim)) {
        return { responsavel: 'CLIENTE' as ResponsavelOcorrencia, contrato: c };
      }
    }
    return { responsavel: 'AZIT' as ResponsavelOcorrencia, contrato: null };
  }

  // ---------------- Registro ----------------

  private async resolverAtivo(d: DadosOcorrencia) {
    if (d.ativoId) {
      const a = await this.prisma.db.ativo.findFirst({ where: { id: d.ativoId, deletedAt: null }, select: { id: true, placa: true } });
      if (!a) throw new NotFoundException({ erro: 'ativo_nao_encontrado', mensagem: 'Veículo não encontrado' });
      return a;
    }
    const placa = (d.placa ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!placa) throw new UnprocessableEntityException({ erro: 'sem_placa', mensagem: 'Informe o veículo ou a placa' });
    const a = await this.prisma.db.ativo.findFirst({ where: { placa, deletedAt: null }, select: { id: true, placa: true } });
    if (!a) throw new NotFoundException({ erro: 'placa_desconhecida', mensagem: `Nenhum veículo cadastrado com a placa ${placa}` });
    return a;
  }

  // Criação/atualização idempotente pelo NÚMERO DO AUTO (doc 02 §25.4): a
  // importação nunca duplica e nunca sobrescreve o que o operador decidiu.
  async registrar(d: DadosOcorrencia, usuarioId?: string) {
    const ativo = await this.resolverAtivo(d);
    const dataFato = new Date(d.dataFato);
    if (Number.isNaN(dataFato.getTime())) {
      throw new UnprocessableEntityException({ erro: 'data_invalida', mensagem: 'Data do fato inválida' });
    }
    const numeroAuto = d.numeroAuto?.trim() || null;
    const existente = numeroAuto
      ? await this.prisma.db.ocorrenciaVeiculo.findUnique({ where: { numeroAuto } })
      : null;

    const data = {
      tipo: d.tipo,
      orgao: d.orgao?.trim() || null,
      descricao: d.descricao?.trim() || null,
      dataVencimento: d.dataVencimento ? new Date(d.dataVencimento) : null,
      prazoIndicacao: d.prazoIndicacao ? new Date(d.prazoIndicacao) : null,
      valor: reais(d.valor ?? 0),
      valorComDesconto: d.valorComDesconto ? reais(d.valorComDesconto) : null,
      bruto: d.bruto,
    };

    if (existente) {
      // Só atualiza o que vem da fonte; desfecho e responsável são do operador.
      const atualizada = await this.prisma.db.ocorrenciaVeiculo.update({
        where: { id: existente.id },
        data: { ...data, origemRef: d.origemRef ?? existente.origemRef },
      });
      return { resultado: 'atualizada' as const, ocorrencia: atualizada };
    }

    const { responsavel, contrato } = await this.responsavelPorData(ativo.id, dataFato);
    const criada = await this.prisma.db.ocorrenciaVeiculo.create({
      data: {
        ...data,
        ativoId: ativo.id,
        contratoId: contrato?.id ?? null,
        numeroAuto,
        dataFato,
        responsavel,
        origem: d.origem ?? 'manual',
        origemRef: d.origemRef ?? null,
      },
    });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'ocorrencia_veiculo_registrada',
        entidade: 'ativo',
        entidadeId: ativo.id,
        depois: { ocorrenciaId: criada.id, tipo: d.tipo, numeroAuto, responsavel, origem: d.origem ?? 'manual' } as Prisma.InputJsonValue,
      },
    });
    if (responsavel === 'CLIENTE' && contrato) {
      await this.alertas.emitir({
        titulo: `${ROTULO_TIPO[d.tipo]} — ${contrato.conta.titular.nome}`,
        corpo: `${ativo.placa ?? ''} · ${formatCurrency(d.valor ?? 0)} · fato em ${dataFato.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Defina o desfecho (cobrar, cliente paga direto ou assumir).`,
        rota: `/frota/ocorrencias?ativo=${ativo.id}`,
        tipo: 'COBRANCA',
        area: 'ATIVOS_FROTA',
      });
    }
    return { resultado: 'criada' as const, ocorrencia: criada };
  }

  // ---------------- Consulta ----------------

  async listar(f: { status?: string; tipo?: string; responsavel?: string; ativoId?: string; busca?: string } = {}) {
    const where: Prisma.OcorrenciaVeiculoWhereInput = { deletedAt: null };
    if (f.status === 'abertas') where.status = { in: ABERTAS };
    else if (f.status) where.status = f.status as StatusOcorrenciaVeiculo;
    if (f.tipo) where.tipo = f.tipo as TipoOcorrenciaVeiculo;
    if (f.responsavel) where.responsavel = f.responsavel as ResponsavelOcorrencia;
    if (f.ativoId) where.ativoId = f.ativoId;
    if (f.busca?.trim()) {
      const b = f.busca.trim();
      where.OR = [
        { numeroAuto: { contains: b, mode: 'insensitive' } },
        { descricao: { contains: b, mode: 'insensitive' } },
        { ativo: { placa: { contains: b.replace(/[^A-Za-z0-9]/g, ''), mode: 'insensitive' } } },
      ];
    }
    const itens = await this.prisma.db.ocorrenciaVeiculo.findMany({
      where,
      include: {
        ativo: { select: { id: true, placa: true, marca: true, modelo: true, descricao: true } },
        contrato: { select: { id: true, numero: true, conta: { select: { titular: { select: { id: true, nome: true } } } } } },
        itemFatura: { select: { id: true, faturaId: true, fatura: { select: { numero: true, dataVencimento: true, status: true } } } },
      },
      orderBy: [{ status: 'asc' }, { dataFato: 'desc' }],
      take: 300,
    });
    return itens.map((o) => this.mapear(o));
  }

  private mapear(o: Prisma.OcorrenciaVeiculoGetPayload<{
    include: {
      ativo: { select: { id: true; placa: true; marca: true; modelo: true; descricao: true } };
      contrato: { select: { id: true; numero: true; conta: { select: { titular: { select: { id: true; nome: true } } } } } };
      itemFatura: { select: { id: true; faturaId: true; fatura: { select: { numero: true; dataVencimento: true; status: true } } } };
    };
  }>) {
    return {
      id: o.id,
      tipo: o.tipo,
      tipoRotulo: ROTULO_TIPO[o.tipo],
      orgao: o.orgao,
      numeroAuto: o.numeroAuto,
      descricao: o.descricao,
      dataFato: o.dataFato.toISOString(),
      dataVencimento: o.dataVencimento?.toISOString() ?? null,
      prazoIndicacao: o.prazoIndicacao?.toISOString() ?? null,
      valor: cent(o.valor),
      valorComDesconto: o.valorComDesconto ? cent(o.valorComDesconto) : null,
      responsavel: o.responsavel,
      responsavelJustificativa: o.responsavelJustificativa,
      status: o.status,
      statusRotulo: ROTULO_STATUS_OCORRENCIA[o.status],
      desfechoEm: o.desfechoEm?.toISOString() ?? null,
      desfechoObs: o.desfechoObs,
      prazoComprovante: o.prazoComprovante?.toISOString() ?? null,
      comprovanteEm: o.comprovanteEm?.toISOString() ?? null,
      temComprovante: !!o.comprovanteRef,
      origem: o.origem,
      ativo: {
        id: o.ativo.id,
        placa: o.ativo.placa,
        descricao: [o.ativo.marca, o.ativo.modelo].filter(Boolean).join(' ') || o.ativo.descricao,
      },
      contrato: o.contrato ? { id: o.contrato.id, numero: o.contrato.numero, titular: o.contrato.conta.titular } : null,
      repasse: o.itemFatura
        ? {
            faturaId: o.itemFatura.faturaId,
            faturaNumero: o.itemFatura.fatura.numero,
            vencimento: o.itemFatura.fatura.dataVencimento.toISOString(),
            statusFatura: o.itemFatura.fatura.status,
          }
        : null,
    };
  }

  private async carregar(id: string) {
    const o = await this.prisma.db.ocorrenciaVeiculo.findFirst({
      where: { id, deletedAt: null },
      include: { ativo: { select: { id: true, placa: true } }, contrato: { select: { id: true, numero: true, contaId: true } } },
    });
    if (!o) throw new NotFoundException({ erro: 'nao_encontrada', mensagem: 'Ocorrência não encontrada' });
    return o;
  }

  private encerrada(status: StatusOcorrenciaVeiculo) {
    return ['REPASSADA', 'ASSUMIDA_AZIT', 'QUITADA', 'CANCELADA'].includes(status);
  }

  private async registrarDesfecho(id: string, data: Prisma.OcorrenciaVeiculoUpdateInput, acao: string, usuarioId?: string, detalhe?: Prisma.InputJsonValue) {
    const atualizada = await this.prisma.db.ocorrenciaVeiculo.update({
      where: { id },
      data: { ...data, desfechoEm: new Date(), desfechoPor: usuarioId ?? null },
    });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId, acao, entidade: 'ocorrencia_veiculo', entidadeId: id, depois: detalhe ?? ({ status: atualizada.status } as Prisma.InputJsonValue) },
    });
    return atualizada;
  }

  // ---------------- Responsável (sobreposição manual) ----------------

  async definirResponsavel(id: string, responsavel: ResponsavelOcorrencia, justificativa: string, usuarioId?: string) {
    const o = await this.carregar(id);
    if (!justificativa?.trim() || justificativa.trim().length < 10) {
      throw new UnprocessableEntityException({ erro: 'justificativa_obrigatoria', mensagem: 'O sistema define o responsável pela data do fato. Para mudar, explique o motivo (mínimo 10 caracteres).' });
    }
    if (this.encerrada(o.status)) {
      throw new UnprocessableEntityException({ erro: 'ocorrencia_encerrada', mensagem: 'Ocorrência já encerrada — reabra antes de mudar o responsável' });
    }
    await this.prisma.db.ocorrenciaVeiculo.update({ where: { id }, data: { responsavel, responsavelJustificativa: justificativa.trim() } });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId, acao: 'ocorrencia_responsavel_alterado', entidade: 'ocorrencia_veiculo', entidadeId: id,
        antes: { responsavel: o.responsavel }, depois: { responsavel, justificativa: justificativa.trim() },
      },
    });
    return { resultado: 'ok', responsavel };
  }

  // ---------------- Desfechos (doc 02 §25.3) ----------------

  // 1) Cliente paga direto ao órgão — nada vai para a fatura.
  async clientePagaDireto(id: string, prazoComprovante: string | undefined, obs: string | undefined, usuarioId?: string) {
    const o = await this.carregar(id);
    if (o.responsavel !== 'CLIENTE') {
      throw new UnprocessableEntityException({ erro: 'responsavel_azit', mensagem: 'A ocorrência está como responsabilidade da Azit — mude o responsável antes' });
    }
    const prazo = prazoComprovante ? new Date(prazoComprovante) : new Date(Date.now() + 7 * DIA_MS);
    await this.registrarDesfecho(id, { status: 'AGUARDANDO_COMPROVANTE', prazoComprovante: prazo, desfechoObs: obs?.trim() || null }, 'ocorrencia_cliente_paga_direto', usuarioId);
    return { resultado: 'aguardando_comprovante', prazo: prazo.toISOString() };
  }

  // Comprovante do pagamento feito pelo cliente (arquivo opcional, base64 —
  // mesmo padrão dos documentos do ativo).
  async registrarComprovante(id: string, arquivo: { nome: string; conteudo: string } | undefined, obs: string | undefined, usuarioId?: string) {
    await this.carregar(id);
    let ref: string | null = null;
    if (arquivo?.conteudo) {
      const base64 = arquivo.conteudo.includes(',') ? arquivo.conteudo.split(',')[1] : arquivo.conteudo;
      const extensao = (arquivo.nome.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      ref = `${id}.${extensao}`;
      await fs.mkdir(UPLOADS_DIR, { recursive: true });
      await fs.writeFile(join(UPLOADS_DIR, ref), Buffer.from(base64, 'base64'));
    }
    await this.registrarDesfecho(id, { status: 'QUITADA', comprovanteRef: ref, comprovanteEm: new Date(), desfechoObs: obs?.trim() || null }, 'ocorrencia_comprovante_registrado', usuarioId);
    return { resultado: 'quitada', comprovante: !!ref };
  }

  async comprovante(id: string) {
    const o = await this.carregar(id);
    if (!o.comprovanteRef) throw new NotFoundException({ erro: 'sem_comprovante', mensagem: 'Nenhum comprovante anexado' });
    return { nome: o.comprovanteRef, buffer: await fs.readFile(join(UPLOADS_DIR, o.comprovanteRef)) };
  }

  // Importação em lote (planilha ou robô do Infleet): idempotente pelo número
  // do auto; placa desconhecida não derruba o lote, vira relatório.
  async importarLote(itens: DadosOcorrencia[], usuarioId?: string) {
    let criadas = 0;
    let atualizadas = 0;
    const ignoradas: { placa?: string; numeroAuto?: string; motivo: string }[] = [];
    for (const item of itens) {
      try {
        const r = await this.registrar(item, usuarioId);
        if (r.resultado === 'criada') criadas += 1;
        else atualizadas += 1;
      } catch (e) {
        const msg = (e as { response?: { mensagem?: string } }).response?.mensagem ?? (e as Error).message;
        ignoradas.push({ placa: item.placa, numeroAuto: item.numeroAuto, motivo: msg });
      }
    }
    this.logger.log(`importação: ${criadas} nova(s), ${atualizadas} atualizada(s), ${ignoradas.length} ignorada(s)`);
    return { criadas, atualizadas, ignoradas };
  }

  // 2) Azit paga e repassa — item avulso na próxima fatura ABERTA da conta.
  async repassarNaFatura(id: string, valorCentavos: number | undefined, usuarioId?: string) {
    const o = await this.carregar(id);
    if (this.encerrada(o.status)) throw new UnprocessableEntityException({ erro: 'ocorrencia_encerrada', mensagem: 'Ocorrência já encerrada' });
    if (o.responsavel !== 'CLIENTE' || !o.contrato) {
      throw new UnprocessableEntityException({ erro: 'sem_cliente', mensagem: 'Só é possível repassar ocorrência de responsabilidade do cliente, com contrato identificado' });
    }
    const valor = valorCentavos ?? cent(o.valorComDesconto ?? o.valor);
    if (valor <= 0) throw new UnprocessableEntityException({ erro: 'valor_invalido', mensagem: 'Informe o valor a repassar' });

    // Consolidação (doc 02 §7.7): entra na PRÓXIMA fatura aberta da conta — o
    // repasse anda junto com as parcelas, como manda a cláusula 3.5.
    const hoje = inicioHojeBrasilUTC();
    const fatura = await this.prisma.db.fatura.findFirst({
      where: { contaId: o.contrato.contaId, status: 'ABERTA', dataVencimento: { gte: hoje } },
      orderBy: { dataVencimento: 'asc' },
      select: { id: true, numero: true, valorTotal: true, dataVencimento: true },
    });
    if (!fatura) {
      throw new UnprocessableEntityException({
        erro: 'sem_fatura_aberta',
        mensagem: 'A conta não tem fatura aberta à frente para receber o repasse. Use o Reembolso Parcelado ou registre depois que o próximo ciclo abrir.',
      });
    }
    const descricao = `${ROTULO_TIPO[o.tipo]}${o.numeroAuto ? ` ${o.numeroAuto}` : ''} — ${o.ativo.placa ?? 'veículo'} (fato em ${o.dataFato.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`;
    const item = await this.prisma.db.$transaction(async (tx) => {
      const criado = await tx.itemFatura.create({
        data: { faturaId: fatura.id, tipo: 'SERVICO', descricao, valor: reais(valor), credor: 'AZIT' },
      });
      await tx.fatura.update({ where: { id: fatura.id }, data: { valorTotal: reais(cent(fatura.valorTotal) + valor) } });
      return criado;
    });
    await this.registrarDesfecho(
      id,
      { status: 'REPASSADA', itemFatura: { connect: { id: item.id } } },
      'ocorrencia_repassada_fatura',
      usuarioId,
      { faturaId: fatura.id, faturaNumero: fatura.numero, valor } as Prisma.InputJsonValue,
    );
    this.logger.log(`ocorrência ${id} repassada: ${formatCurrency(valor)} na fatura ${fatura.numero}`);
    return { resultado: 'repassada', faturaNumero: fatura.numero, vencimento: fatura.dataVencimento.toISOString(), valor };
  }

  // 3) Azit assume — vira custo do veículo (centro de custo, §4.4-A).
  async assumirAzit(id: string, obs: string | undefined, usuarioId?: string) {
    const o = await this.carregar(id);
    if (this.encerrada(o.status)) throw new UnprocessableEntityException({ erro: 'ocorrencia_encerrada', mensagem: 'Ocorrência já encerrada' });
    const valor = cent(o.valorComDesconto ?? o.valor);
    const lancamento = await this.prisma.db.lancamentoCustoAtivo.create({
      data: {
        ativoId: o.ativoId,
        tipo: o.tipo === 'MULTA' || o.tipo === 'NOTIFICACAO' ? 'multa' : o.tipo.toLowerCase(),
        descricao: `${ROTULO_TIPO[o.tipo]}${o.numeroAuto ? ` ${o.numeroAuto}` : ''} assumida pela Azit`,
        valor: reais(valor),
        data: o.dataFato,
        criadoPor: usuarioId,
      },
    });
    await this.registrarDesfecho(
      id,
      { status: 'ASSUMIDA_AZIT', desfechoObs: obs?.trim() || null, lancamentoCusto: { connect: { id: lancamento.id } } },
      'ocorrencia_assumida_azit',
      usuarioId,
      { lancamentoId: lancamento.id, valor } as Prisma.InputJsonValue,
    );
    return { resultado: 'assumida', valor };
  }

  // 4) Recurso e 5) cancelamento.
  async emRecurso(id: string, prazo: string | undefined, obs: string | undefined, usuarioId?: string) {
    await this.carregar(id);
    const p = prazo ? new Date(prazo) : null;
    await this.prisma.db.ocorrenciaVeiculo.update({ where: { id }, data: { status: 'EM_RECURSO', prazoIndicacao: p ?? undefined, desfechoObs: obs?.trim() || null } });
    await this.prisma.db.logAuditoria.create({ data: { usuarioId, acao: 'ocorrencia_em_recurso', entidade: 'ocorrencia_veiculo', entidadeId: id, depois: { prazo: p?.toISOString() ?? null } } });
    return { resultado: 'em_recurso' };
  }

  async cancelar(id: string, motivo: string, usuarioId?: string) {
    await this.carregar(id);
    if (!motivo?.trim()) throw new UnprocessableEntityException({ erro: 'motivo_obrigatorio', mensagem: 'Informe o motivo do cancelamento' });
    await this.registrarDesfecho(id, { status: 'CANCELADA', desfechoObs: motivo.trim() }, 'ocorrencia_cancelada', usuarioId);
    return { resultado: 'cancelada' };
  }

  async reabrir(id: string, motivo: string, usuarioId?: string) {
    const o = await this.carregar(id);
    if (o.status === 'REPASSADA') {
      throw new UnprocessableEntityException({ erro: 'ja_repassada', mensagem: 'A ocorrência já virou item de fatura — trate pela fatura (o valor está cobrado)' });
    }
    await this.registrarDesfecho(id, { status: 'REGISTRADA', desfechoObs: motivo?.trim() || null, prazoComprovante: null }, 'ocorrencia_reaberta', usuarioId);
    return { resultado: 'reaberta' };
  }

  // ---------------- Alertas de prazo ----------------

  // Todo dia às 7h: prazo de indicação/recurso, comprovante prometido e
  // vencimento chegando (doc 02 §25.3). Um alerta por ocorrência por dia.
  @Cron(CronExpression.EVERY_DAY_AT_7AM, { timeZone: 'America/Sao_Paulo' })
  async alertarPrazos() {
    const hoje = inicioHojeBrasilUTC();
    const em3dias = new Date(hoje.getTime() + 3 * DIA_MS);
    const pendentes = await this.prisma.db.ocorrenciaVeiculo.findMany({
      where: {
        deletedAt: null,
        status: { in: ABERTAS },
        OR: [
          { prazoIndicacao: { lte: em3dias } },
          { prazoComprovante: { lte: em3dias } },
          { dataVencimento: { lte: em3dias } },
        ],
      },
      include: { ativo: { select: { placa: true } } },
    });
    for (const o of pendentes) {
      const vencido = (d: Date | null) => !!d && d < hoje;
      const motivo = vencido(o.prazoIndicacao)
        ? 'prazo de indicação VENCIDO'
        : vencido(o.prazoComprovante)
          ? 'comprovante do cliente ATRASADO'
          : vencido(o.dataVencimento)
            ? 'pagamento VENCIDO'
            : 'prazo chegando';
      await this.alertas.emitir({
        titulo: `${ROTULO_TIPO[o.tipo]} ${o.ativo.placa ?? ''} — ${motivo}`,
        corpo: `${o.numeroAuto ?? 'sem número'} · ${formatCurrency(cent(o.valor))}`,
        rota: `/frota/ocorrencias?id=${o.id}`,
        tipo: 'FALHA',
        area: 'ATIVOS_FROTA',
      });
    }
    if (pendentes.length) this.logger.log(`[cron] ${pendentes.length} ocorrência(s) com prazo a vencer`);
    return { alertadas: pendentes.length };
  }
}
