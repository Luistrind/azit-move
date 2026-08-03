import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, Periodicidade as PeriodicidadePrisma } from '@prisma/client';
import { precificarSimulacao, FrequenciaSimulacao } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { ParametrosService, ParametrosVigentes } from '../simulador/parametros.service';
import { OfertaFixaService } from '../simulador/oferta-fixa.service';
import {
  CatalogoFonteService,
  FATORES_CATALOGO,
  ParametrosCatalogoCompraParcelada,
} from '../catalogo/catalogo-fonte.service';
import { CriarSimulacaoDto, SimularOpcaoDto } from './dto/simulacao.dto';

const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;
const reais = (c: number) => (c / 100).toFixed(2);
const DIA_MS = 24 * 60 * 60 * 1000;

const FREQ_PRISMA: Record<FrequenciaSimulacao, PeriodicidadePrisma> = {
  mensal: 'MENSAL',
  quinzenal: 'QUINZENAL',
  semanal: 'SEMANAL',
};
const FREQ_API: Record<string, FrequenciaSimulacao> = {
  MENSAL: 'mensal',
  QUINZENAL: 'quinzenal',
  SEMANAL: 'semanal',
};

// Simulação V3 (Doc 2 §4-A.2, Decisão 2026-07-05): cálculo no BACKEND com
// parâmetros VERSIONADOS. Ao criar, calcula as ofertas padrão (combos
// parametrizados) e a oferta fixa vinculada ao ativo (se houver); cenários
// personalizados entram via "Simular outras opções". A visão do cliente mostra
// só a condição comercial — CI/CR/TR ficam internos.
@Injectable()
export class SimulacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parametros: ParametrosService,
    private readonly ofertaFixa: OfertaFixaService,
    private readonly catalogoFonte: CatalogoFonteService,
  ) {}

  // F2 (doc 02 §17): quando o produto compra_parcelada e a variante do ativo
  // estão ATIVOS no Catálogo, os parâmetros vêm de lá; senão, motor legado.
  private async fonteCatalogo(ativoId: string | null | undefined): Promise<ParametrosCatalogoCompraParcelada | null> {
    if (!ativoId) return null;
    const a = await this.prisma.db.ativo.findFirst({
      where: { id: ativoId },
      select: { varianteCatalogo: true },
    });
    if (!a) return null;
    return this.catalogoFonte.compraParcelada(a.varianteCatalogo);
  }

  // Preço no modo catálogo: motor V3 + componente de proteção (RF-CP12 — base
  // semanal; mensal = semanal × 4,3452) + fatores do Catálogo (4,3452/2,1726).
  private precificarCatalogo(
    cat: ParametrosCatalogoCompraParcelada,
    valorAvista: number,
    valorEntrada: number,
    prazoMeses: number,
    frequencia: FrequenciaSimulacao,
  ) {
    const r = precificarSimulacao({
      valorAvista,
      valorEntrada,
      prazoMeses,
      frequencia,
      comissaoInicial: cat.comissaoInicial,
      comissaoRecorrente: cat.comissaoRecorrenteMensal,
      taxaMensal: cat.taxaMensal,
      fatorPrecificacaoSemanal: FATORES_CATALOGO.precificacaoSemanal,
      fatorPrecificacaoQuinzenal: FATORES_CATALOGO.precificacaoQuinzenal,
      fatorSemanal: FATORES_CATALOGO.contratoSemanal,
      fatorQuinzenal: FATORES_CATALOGO.contratoQuinzenal,
    });
    // Arredondamento ÚNICO na soma dos componentes (como a planilha faz o ROUND):
    // parcela = round(pmt_exato ÷ fator + proteção_exata).
    const fatorPrec = frequencia === 'mensal' ? 1 : frequencia === 'quinzenal' ? FATORES_CATALOGO.precificacaoQuinzenal : FATORES_CATALOGO.precificacaoSemanal;
    const protecaoExata = this.catalogoFonte.protecaoPorPeriodoExata(cat.protecaoSemanalExata, frequencia);
    return { ...r, parcelaFinal: Math.round(r.parcelaMensalTotalExata / fatorPrec + protecaoExata) };
  }

  // Fora do parâmetro (decisão 03/08, opção b): no modo catálogo NÃO bloqueia —
  // a oferta é marcada e a proposta exigirá alçada antes de formalizar.
  private avaliarForaParametro(
    cat: ParametrosCatalogoCompraParcelada,
    dto: { valorEntrada: number; prazoMeses: number },
  ): string | null {
    const motivos: string[] = [];
    if (dto.valorEntrada < cat.entradaMinima) {
      motivos.push(`entrada abaixo da mínima da variante (R$ ${reais(cat.entradaMinima)})`);
    }
    if (dto.prazoMeses < cat.prazoMinMeses || dto.prazoMeses > cat.prazoMaxMeses) {
      motivos.push(`prazo fora da faixa (${cat.prazoMinMeses} a ${cat.prazoMaxMeses} meses)`);
    }
    return motivos.length > 0 ? `Condição fora do parâmetro: ${motivos.join('; ')}` : null;
  }

  private expirada(s: { validaAte: Date | null; status: string }): boolean {
    return (
      !!s.validaAte &&
      s.validaAte < new Date() &&
      (s.status === 'CALCULADA' || s.status === 'APRESENTADA')
    );
  }

  private async auditar(acao: string, entidadeId: string, depois?: unknown) {
    await this.prisma.db.logAuditoria.create({
      data: {
        acao,
        entidade: 'simulacao',
        entidadeId,
        depois: depois ? (JSON.parse(JSON.stringify(depois)) as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  private validarCenario(
    p: ParametrosVigentes,
    valorAvista: number,
    dto: { valorEntrada: number; prazoMeses: number },
  ) {
    if (dto.valorEntrada < p.entradaMinima) {
      throw new UnprocessableEntityException({
        erro: 'entrada_minima',
        mensagem: `A entrada mínima é R$ ${reais(p.entradaMinima)}`,
      });
    }
    if (dto.valorEntrada >= valorAvista) {
      throw new UnprocessableEntityException({
        erro: 'entrada_invalida',
        mensagem: 'A entrada não pode ser maior ou igual ao valor à vista',
      });
    }
    if (dto.prazoMeses < p.prazoMinMeses || dto.prazoMeses > p.prazoMaxMeses) {
      throw new UnprocessableEntityException({
        erro: 'prazo_invalido',
        mensagem: `O prazo deve estar entre ${p.prazoMinMeses} e ${p.prazoMaxMeses} meses`,
      });
    }
  }

  // Tela 1→2: cria a simulação (ativo OU valor manual) e calcula as ofertas
  // padrão + a oferta fixa vinculada ao ativo. Status: CALCULADA.
  async criar(dto: CriarSimulacaoDto) {
    const params = await this.parametros.vigente();

    let ativo: {
      id: string;
      descricao: string;
      status: string;
      valorVenda: Prisma.Decimal | null;
      ofertaFixaId: string | null;
    } | null = null;
    if (dto.ativoId) {
      ativo = await this.prisma.db.ativo.findFirst({
        where: { id: dto.ativoId },
        select: { id: true, descricao: true, status: true, valorVenda: true, ofertaFixaId: true },
      });
      if (!ativo) {
        throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Ativo não encontrado' });
      }
      if (ativo.status !== 'DISPONIVEL') {
        throw new UnprocessableEntityException({
          erro: 'ativo_indisponivel',
          mensagem: 'O ativo não está disponível para simulação',
        });
      }
    }

    // VA: cadastro do ativo tem prioridade; manual quando não há valor cadastrado.
    const valorCadastro = ativo?.valorVenda ? cent(ativo.valorVenda) : 0;
    const valorAvista = valorCadastro > 0 ? valorCadastro : (dto.valorAvista ?? 0);
    const manual = valorCadastro === 0;
    if (valorAvista <= 0) {
      throw new UnprocessableEntityException({
        erro: 'sem_valor_avista',
        mensagem: ativo
          ? 'O ativo não tem valor de venda cadastrado — informe o valor à vista manualmente'
          : 'Informe o valor à vista',
      });
    }
    const avisoDivergencia =
      !!dto.valorAvista && valorCadastro > 0 && dto.valorAvista !== valorCadastro
        ? `Valor informado (R$ ${reais(dto.valorAvista)}) diverge do cadastro (R$ ${reais(valorCadastro)}) — usado o valor do cadastro`
        : null;

    const simulacao = await this.prisma.db.simulacao.create({
      data: {
        leadId: dto.leadId,
        titularId: dto.titularId,
        ativoId: ativo?.id,
        valorAvista: reais(valorAvista),
        valorAvistaManual: manual,
        valorEntrada: reais(params.entradaMinima), // provisório até escolher oferta
        status: 'CALCULADA',
        validaAte: new Date(Date.now() + params.validadeDias * DIA_MS),
        parametroVersaoId: params.id,
        observacoes: dto.observacoes,
      },
    });

    // Oferta FIXA vinculada ao ativo (Doc 2 §4-A.3) — valores desenhados, em destaque.
    if (ativo?.ofertaFixaId) {
      const fixa = await this.prisma.db.ofertaFixa.findFirst({ where: { id: ativo.ofertaFixaId } });
      if (fixa && this.ofertaFixa.estaVigente(fixa)) {
        const fator =
          fixa.frequencia === 'MENSAL'
            ? 1
            : fixa.frequencia === 'QUINZENAL'
              ? params.fatorQuinzenal
              : params.fatorSemanal;
        await this.prisma.db.oferta.create({
          data: {
            simulacaoId: simulacao.id,
            tipo: 'OFERTA_FIXA',
            origemCalculo: 'VALOR_VENDA_ATIVO',
            valorEntrada: fixa.valorEntrada,
            prazoMeses: fixa.prazoMeses,
            frequencia: fixa.frequencia,
            valorParcela: fixa.valorParcela,
            numeroParcelas: Math.max(1, Math.round(fixa.prazoMeses * fator)),
          },
        });
      }
    }

    // Ofertas PADRÃO — pula combos cuja entrada não cabe no VA. Fonte: Catálogo
    // (produto/variante ATIVOS) ou combos legados dos parâmetros do simulador.
    const cat = await this.fonteCatalogo(ativo?.id);
    const combosPadrao = cat
      ? cat.ofertasPadrao.map((o) => ({ valorEntrada: o.valorEntrada, prazoMeses: o.prazoMeses, frequencia: o.frequencia }))
      : params.ofertasPadrao;
    for (const combo of combosPadrao) {
      if (combo.valorEntrada >= valorAvista) continue;
      const freqApi = FREQ_API[combo.frequencia] ?? 'semanal';
      const r = cat
        ? this.precificarCatalogo(cat, valorAvista, combo.valorEntrada, combo.prazoMeses, freqApi)
        : precificarSimulacao({
            valorAvista,
            valorEntrada: combo.valorEntrada,
            prazoMeses: combo.prazoMeses,
            frequencia: freqApi,
            comissaoInicial: params.comissaoInicial,
            comissaoRecorrente: params.comissaoRecorrente,
            taxaMensal: params.taxaMensal,
            fatorPrecificacaoSemanal: params.fatorPrecificacaoSemanal,
            fatorPrecificacaoQuinzenal: params.fatorPrecificacaoQuinzenal,
            fatorSemanal: params.fatorSemanal,
            fatorQuinzenal: params.fatorQuinzenal,
          });
      await this.prisma.db.oferta.create({
        data: {
          simulacaoId: simulacao.id,
          tipo: 'PADRAO',
          origemCalculo: 'VALOR_VENDA_ATIVO',
          valorEntrada: reais(combo.valorEntrada),
          prazoMeses: combo.prazoMeses,
          frequencia: combo.frequencia,
          valorParcela: reais(r.parcelaFinal),
          numeroParcelas: r.numeroParcelas,
        },
      });
    }

    await this.auditar('simulacao_criada', simulacao.id, {
      ativoId: ativo?.id ?? null,
      valorAvista,
      manual,
      parametroVersaoId: params.id,
      fonte: cat ? 'catalogo' : 'parametros_simulador',
      ...(cat ? { catalogo: { variante: cat.varianteChave, versaoProduto: cat.versaoProduto, versaoVariante: cat.versaoVariante } } : {}),
    });
    return this.detalhe(simulacao.id, avisoDivergencia);
  }

  // Tela 3: cenário personalizado ("Simular outras opções"). No modo catálogo,
  // entrada/prazo fora da faixa NÃO bloqueiam (decisão 03/08): a oferta nasce
  // marcada "fora do parâmetro" e a proposta exigirá alçada na formalização.
  async simularOpcao(simulacaoId: string, dto: SimularOpcaoDto) {
    const s = await this.buscar(simulacaoId);
    this.garantirEditavel(s);
    const valorAvista = cent(s.valorAvista);
    const cat = await this.fonteCatalogo(s.ativoId);

    let foraParametroMotivo: string | null = null;
    let r: { parcelaFinal: number; numeroParcelas: number };
    if (cat) {
      // Entrada >= valor à vista continua sendo erro duro em qualquer modo.
      if (dto.valorEntrada >= valorAvista) {
        throw new UnprocessableEntityException({
          erro: 'entrada_invalida',
          mensagem: 'A entrada não pode ser maior ou igual ao valor à vista',
        });
      }
      foraParametroMotivo = this.avaliarForaParametro(cat, dto);
      r = this.precificarCatalogo(cat, valorAvista, dto.valorEntrada, dto.prazoMeses, dto.frequencia);
    } else {
      const params = await this.parametros.vigente();
      this.validarCenario(params, valorAvista, dto);
      r = precificarSimulacao({
        valorAvista,
        valorEntrada: dto.valorEntrada,
        prazoMeses: dto.prazoMeses,
        frequencia: dto.frequencia,
        comissaoInicial: params.comissaoInicial,
        comissaoRecorrente: params.comissaoRecorrente,
        taxaMensal: params.taxaMensal,
        fatorPrecificacaoSemanal: params.fatorPrecificacaoSemanal,
        fatorPrecificacaoQuinzenal: params.fatorPrecificacaoQuinzenal,
        fatorSemanal: params.fatorSemanal,
        fatorQuinzenal: params.fatorQuinzenal,
      });
    }
    await this.prisma.db.oferta.create({
      data: {
        simulacaoId,
        tipo: 'PERSONALIZADA',
        origemCalculo: 'VALOR_VENDA_ATIVO',
        valorEntrada: reais(dto.valorEntrada),
        entradaParcelada: dto.entradaParcelada,
        prazoMeses: dto.prazoMeses,
        frequencia: FREQ_PRISMA[dto.frequencia],
        valorParcela: reais(r.parcelaFinal),
        numeroParcelas: r.numeroParcelas,
        foraParametro: foraParametroMotivo !== null,
        foraParametroMotivo,
      },
    });
    await this.auditar('simulacao_cenario_calculado', simulacaoId, {
      ...dto,
      fonte: cat ? 'catalogo' : 'parametros_simulador',
      foraParametro: foraParametroMotivo !== null,
    });
    return this.detalhe(simulacaoId);
  }

  // Marca a condição como apresentada ao cliente (Doc 2 §4-A.2 estados).
  async apresentar(simulacaoId: string) {
    const s = await this.buscar(simulacaoId);
    this.garantirEditavel(s);
    await this.prisma.db.simulacao.update({
      where: { id: simulacaoId },
      data: { status: 'APRESENTADA' },
    });
    await this.auditar('simulacao_apresentada', simulacaoId);
    return { id: simulacaoId, status: 'apresentada' };
  }

  async cancelar(simulacaoId: string) {
    const s = await this.buscar(simulacaoId);
    if (s.status === 'CONVERTIDA') {
      throw new UnprocessableEntityException({
        erro: 'ja_convertida',
        mensagem: 'Simulação já convertida em proposta não pode ser cancelada',
      });
    }
    await this.prisma.db.simulacao.update({
      where: { id: simulacaoId },
      data: { status: 'CANCELADA' },
    });
    await this.auditar('simulacao_cancelada', simulacaoId);
    return { id: simulacaoId, status: 'cancelada' };
  }

  async selecionarOferta(simulacaoId: string, ofertaId: string) {
    const s = await this.buscar(simulacaoId);
    this.garantirEditavel(s);
    const oferta = await this.prisma.db.oferta.findFirst({
      where: { id: ofertaId, simulacaoId },
    });
    if (!oferta) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Oferta não encontrada' });
    }
    await this.prisma.db.oferta.updateMany({ where: { simulacaoId }, data: { selecionada: false } });
    await this.prisma.db.oferta.update({ where: { id: ofertaId }, data: { selecionada: true } });
    // A entrada da simulação passa a refletir a oferta escolhida.
    await this.prisma.db.simulacao.update({
      where: { id: simulacaoId },
      data: { valorEntrada: oferta.valorEntrada, prazoMeses: oferta.prazoMeses },
    });
    return { simulacaoId, ofertaSelecionada: ofertaId };
  }

  async detalhe(simulacaoId: string, avisoDivergencia: string | null = null) {
    const s = await this.prisma.db.simulacao.findFirst({
      where: { id: simulacaoId },
      include: {
        ativo: { select: { id: true, descricao: true, placa: true } },
        lead: { select: { nome: true, cpf: true, telefone: true } },
        titular: { select: { id: true, nome: true, cpfCnpj: true } },
        proposta: { select: { id: true } },
        ofertas: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!s) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Simulação não encontrada' });
    }
    const cliente = s.titular
      ? { nome: s.titular.nome, cpf: s.titular.cpfCnpj, telefone: null as string | null, titularId: s.titular.id }
      : s.lead
        ? { nome: s.lead.nome, cpf: s.lead.cpf, telefone: s.lead.telefone, titularId: null }
        : null;
    return {
      id: s.id,
      status: this.expirada(s) ? 'expirada' : s.status.toLowerCase(),
      validaAte: s.validaAte?.toISOString() ?? null,
      leadId: s.leadId,
      cliente,
      propostaId: s.proposta?.id ?? null,
      ativo: s.ativo ? { id: s.ativo.id, descricao: s.ativo.descricao, placa: s.ativo.placa } : null,
      valorAvista: cent(s.valorAvista),
      valorAvistaManual: s.valorAvistaManual,
      avisoDivergencia,
      ofertas: s.ofertas.map((o) => ({
        id: o.id,
        tipo: o.tipo.toLowerCase(),
        valorEntrada: cent(o.valorEntrada),
        entradaParcelada: o.entradaParcelada,
        prazoMeses: o.prazoMeses,
        frequencia: FREQ_API[o.frequencia] ?? 'semanal',
        valorParcela: cent(o.valorParcela),
        numeroParcelas: o.numeroParcelas,
        selecionada: o.selecionada,
        foraParametro: o.foraParametro,
        foraParametroMotivo: o.foraParametroMotivo,
      })),
    };
  }

  // Listagem (tela de apoio): status/validade + oferta escolhida + proposta.
  async listar() {
    const simulacoes = await this.prisma.db.simulacao.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        lead: { select: { nome: true } },
        titular: { select: { nome: true } },
        ativo: { select: { descricao: true } },
        ofertas: { where: { selecionada: true }, take: 1 },
        proposta: { select: { id: true, status: true } },
      },
    });
    return simulacoes.map((s) => {
      const sel = s.ofertas[0];
      return {
        id: s.id,
        cliente: s.titular?.nome ?? s.lead?.nome ?? '—',
        ativo: s.ativo?.descricao ?? 'Valor manual',
        valorAvista: cent(s.valorAvista),
        valorEntrada: cent(s.valorEntrada),
        status: this.expirada(s) ? 'expirada' : s.status.toLowerCase(),
        validaAte: s.validaAte?.toISOString() ?? null,
        ofertaEscolhida: sel
          ? {
              valorParcela: cent(sel.valorParcela),
              numeroParcelas: sel.numeroParcelas,
              frequencia: FREQ_API[sel.frequencia] ?? 'semanal',
              prazoMeses: sel.prazoMeses,
            }
          : null,
        propostaId: s.proposta?.id ?? null,
        propostaStatus: s.proposta?.status?.toLowerCase() ?? null,
      };
    });
  }

  private async buscar(id: string) {
    const s = await this.prisma.db.simulacao.findFirst({ where: { id } });
    if (!s) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Simulação não encontrada' });
    }
    return s;
  }

  private garantirEditavel(s: { status: string; validaAte: Date | null }) {
    if (s.status === 'CONVERTIDA' || s.status === 'CANCELADA') {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: 'Simulação já convertida/cancelada não pode ser alterada',
      });
    }
    if (this.expirada(s)) {
      throw new UnprocessableEntityException({
        erro: 'simulacao_expirada',
        mensagem: 'Simulação expirada — crie uma nova para recalcular com os parâmetros vigentes',
      });
    }
  }
}
