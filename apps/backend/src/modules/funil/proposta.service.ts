import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import {
  Prisma,
  StatusProposta,
  ModalidadeContrato,
  PapelTitular,
  Periodicidade,
} from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { limparDocumento, reaisParaCentavos, centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { TitularService } from '../titular/titular.service';
import { ContaService } from '../conta/conta.service';
import { AprovacaoService } from '../aprovacao/aprovacao.service';
import { Camada1Service } from '../bureau/camada1.service';
import { AnaliseService } from '../analise/analise.service';
import { CatalogoFonteService } from '../catalogo/catalogo-fonte.service';
import {
  CriarPropostaDto,
  AdicionarVinculoDto,
  AnexarDocumentoDto,
  RegistrarParecerDto,
} from './dto/proposta.dto';
import {
  TipoDocumentoProposta,
  ResultadoParecer,
} from '@prisma/client';

const cent = (d: Prisma.Decimal): number => reaisParaCentavos(d.toString());
const reais = (c: number): string => centavosParaReaisString(c);
// Diretório de uploads (documentos da proposta) — dev/local.
const UPLOADS_DIR = join(process.cwd(), 'uploads', 'documentos');

// Cadastro pleno é igual ao CriarTitularDto (validação de CPF embutida no service).
type Cadastro = NonNullable<CriarPropostaDto['comprador']>;

// Transições permitidas no Kanban via PATCH (movimentos livres). APROVADA/REPROVADA
// só vêm do parecer (7.8); CONVERTIDA só da formalização (7.10) — Doc 2 §4-A.4.
const TRANSICOES: Record<string, StatusProposta[]> = {
  PENDENTE: ['EM_ANALISE', 'CANCELADA'],
  EM_ANALISE: ['CANCELADA'],
  APROVADA: ['EM_FORMALIZACAO', 'CANCELADA'],
  EM_FORMALIZACAO: ['CANCELADA'],
  REPROVADA: [],
  CONVERTIDA: [],
  CANCELADA: [],
};

// Documentos obrigatórios por papel — decisão da homologação 04/08 (doc 02 §20
// passo 9): SÓ a CNH é obrigatória. Comprovante de endereço e relatório BRIC
// caíram (não mudam a análise; birô via API). Demais documentos são
// COMPLEMENTARES opcionais (extrato, contracheque, contrato de locadora…).
export const DOCS_OBRIGATORIOS: TipoDocumentoProposta[] = ['CNH'];
const PAPEIS_QUE_EXIGEM_DOCS: PapelTitular[] = ['COMPRADOR_PRINCIPAL', 'COMPRADOR_SECUNDARIO'];

export interface PendenciaDoc {
  titularId: string;
  papel: string;
  nome: string;
  faltando: string[];
}

// 7.5/7.6/7.7 — Proposta: converte a oferta escolhida em pedido de crédito,
// promove Lead→Titular (reconciliação por CPF) e vincula papéis.
@Injectable()
export class PropostaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly titular: TitularService,
    private readonly conta: ContaService,
    private readonly aprovacao: AprovacaoService,
    private readonly camada1: Camada1Service,
    private readonly analise: AnaliseService,
    private readonly catalogoFonte: CatalogoFonteService,
  ) {}

  async criar(dto: CriarPropostaDto) {
    const simulacao = await this.prisma.db.simulacao.findFirst({
      where: { id: dto.simulacaoId },
      include: { ofertas: true, proposta: true },
    });
    if (!simulacao) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Simulação não encontrada' });
    }
    if (simulacao.proposta) {
      throw new ConflictException({ erro: 'ja_convertida', mensagem: 'Simulação já tem proposta' });
    }
    const oferta = simulacao.ofertas.find((o) => o.selecionada);
    if (!oferta) {
      throw new UnprocessableEntityException({
        erro: 'sem_oferta',
        mensagem: 'Selecione uma oferta antes de criar a proposta',
      });
    }
    // Bloqueio (Doc 2 §4-A.2): simulação expirada não converte sem recálculo.
    if (
      simulacao.validaAte &&
      simulacao.validaAte < new Date() &&
      (simulacao.status === 'CALCULADA' || simulacao.status === 'APRESENTADA')
    ) {
      throw new UnprocessableEntityException({
        erro: 'simulacao_expirada',
        mensagem: 'Simulação expirada — recalcule antes de converter em proposta',
      });
    }
    // Proposta precisa de um ativo (o veículo da venda). Simulação por valor manual
    // deve ser refeita com o ativo definido antes de virar proposta.
    if (!simulacao.ativoId) {
      throw new UnprocessableEntityException({
        erro: 'sem_ativo',
        mensagem: 'Vincule um veículo/ativo à simulação antes de converter em proposta',
      });
    }

    // Resolve o comprador principal (promoção do lead, se necessário).
    const titularId = await this.resolverTitular(simulacao.id, simulacao.titularId, simulacao.leadId, dto.comprador);

    const proposta = await this.prisma.db.proposta.create({
      data: {
        simulacaoId: simulacao.id,
        titularId,
        ativoId: simulacao.ativoId,
        modalidade: dto.modalidade.toUpperCase() as ModalidadeContrato,
        valorEntrada: oferta.valorEntrada,
        // V3: prazo em meses + frequência (a conversão em contrato deriva daqui).
        // prazoSemanas preservado por compat (NOT NULL): recebe o nº de parcelas.
        prazoSemanas: oferta.prazoSemanas ?? oferta.numeroParcelas,
        prazoMeses: oferta.prazoMeses,
        frequencia: oferta.frequencia,
        valorParcela: oferta.valorParcela,
        numeroParcelas: oferta.numeroParcelas,
        // Condição fora do parâmetro (decisão 03/08): a proposta herda a marca
        // da oferta e exigirá aprovação de alçada antes da formalização.
        foraParametro: oferta.foraParametro,
        status: 'PENDENTE',
        vinculos: {
          create: { titularId, papel: 'COMPRADOR_PRINCIPAL' },
        },
      },
    });
    // Rastreabilidade (Doc 2 §4-A.2): simulação convertida vira imutável.
    await this.prisma.db.simulacao.update({
      where: { id: simulacao.id },
      data: { status: 'CONVERTIDA' },
    });
    await this.prisma.db.logAuditoria.create({
      data: {
        acao: 'simulacao_convertida',
        entidade: 'simulacao',
        entidadeId: simulacao.id,
        depois: { propostaId: proposta.id, ofertaId: oferta.id },
      },
    });

    // Camada 1 do birô (doc 02 §20 passo 6): roda ao ENVIAR a proposta, de
    // forma transparente ao operador. Reprovado → proposta nasce REPROVADA com
    // motivo INTERNO (análise/diretoria); em tela vai só a mensagem neutra.
    // Birô indisponível não trava: segue com alerta para a análise.
    const titularCamada1 = await this.prisma.db.titular.findFirst({
      where: { id: titularId },
      select: { cpfCnpj: true },
    });
    if (titularCamada1) {
      const r = await this.camada1.avaliar(titularCamada1.cpfCnpj);
      await this.prisma.db.proposta.update({
        where: { id: proposta.id },
        data: {
          camada1Status: r.status,
          camada1Resultado: JSON.parse(JSON.stringify(r)) as Prisma.InputJsonValue,
          ...(r.status === 'reprovado' ? { status: 'REPROVADA' } : {}),
        },
      });
      await this.prisma.db.logAuditoria.create({
        data: {
          acao: 'camada1_avaliada',
          entidade: 'proposta',
          entidadeId: proposta.id,
          depois: JSON.parse(JSON.stringify({ status: r.status, motivos: r.motivos, alertas: r.alertas })) as Prisma.InputJsonValue,
        },
      });
    }
    return this.detalhe(proposta.id);
  }

  // --- Jornada do atendimento (doc 02 §20) ---

  // Passo 8 — opções de proteção para o upsell: adicional POR PERÍODO sobre a
  // parcela base (o Essencial já está embutido) + diferenças qualitativas.
  async protecaoOpcoes(propostaId: string) {
    const p = await this.buscarJornada(propostaId);
    const base = await this.baseProtecao(p);
    if (!base) {
      return { disponivel: false, planoAtual: p.planoProtecao, opcoes: [] };
    }
    const { varianteCP, valorAvista, fator } = base;
    const essencial = await this.catalogoFonte.protecaoPlano(varianteCP, valorAvista, 'essencial');
    const planos: ('essencial' | 'protecao' | 'completa')[] = ['essencial', 'protecao', 'completa'];
    const parcelaBase = cent(p.valorParcela) - cent(p.adicionalProtecao);
    const opcoes = [];
    for (const plano of planos) {
      const info = await this.catalogoFonte.protecaoPlano(varianteCP, valorAvista, plano);
      if (!info || !essencial) continue;
      const adicional = Math.max(0, Math.round((info.semanalExata - essencial.semanalExata) * fator));
      opcoes.push({
        plano,
        nome: plano === 'essencial' ? 'Essencial' : plano === 'protecao' ? 'Proteção' : 'Completa',
        cobertura: info.cobertura,
        adicionalPorPeriodo: adicional, // centavos, na frequência do contrato
        parcelaResultante: parcelaBase + adicional,
        atual: p.planoProtecao === plano,
      });
    }
    return { disponivel: opcoes.length > 0, planoAtual: p.planoProtecao, frequencia: (p.frequencia ?? 'SEMANAL').toLowerCase(), opcoes };
  }

  // Passo 8 — escolha do plano: a parcela da proposta passa a ser base + adicional.
  async escolherProtecao(propostaId: string, plano: 'essencial' | 'protecao' | 'completa') {
    const p = await this.buscarJornada(propostaId);
    this.garantirEditavelJornada(p.status);
    const base = await this.baseProtecao(p);
    let adicional = 0;
    if (base && plano !== 'essencial') {
      const essencial = await this.catalogoFonte.protecaoPlano(base.varianteCP, base.valorAvista, 'essencial');
      const escolhido = await this.catalogoFonte.protecaoPlano(base.varianteCP, base.valorAvista, plano);
      if (essencial && escolhido) {
        adicional = Math.max(0, Math.round((escolhido.semanalExata - essencial.semanalExata) * base.fator));
      }
    }
    const parcelaBase = cent(p.valorParcela) - cent(p.adicionalProtecao);
    await this.prisma.db.proposta.update({
      where: { id: propostaId },
      data: {
        planoProtecao: plano,
        adicionalProtecao: reais(adicional),
        valorParcela: reais(parcelaBase + adicional),
      },
    });
    await this.prisma.db.logAuditoria.create({
      data: { acao: 'protecao_escolhida', entidade: 'proposta', entidadeId: propostaId, depois: { plano, adicional } },
    });
    return this.detalhe(propostaId);
  }

  // Passo 10 — envio para análise com renda declarada e parecer opcional do
  // operador. Valida o documento obrigatório (CNH) antes de enviar.
  async enviarParaAnalise(propostaId: string, dto: { rendaDeclarada?: number; parecerOperador?: string }) {
    const p = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      include: { vinculos: { include: { titular: { select: { id: true, nome: true, cpfCnpj: true } } } }, documentos: true },
    });
    if (!p) throw this.naoEncontrada();
    if (p.status !== 'PENDENTE') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'A proposta não está pendente de envio' });
    }
    const pendencias = this.calcPendencias(p.vinculos, p.documentos);
    if (pendencias.length > 0) {
      throw new UnprocessableEntityException({
        erro: 'documentos_pendentes',
        mensagem: `Anexe a CNH de: ${pendencias.map((x) => x.nome).join(', ')}`,
      });
    }
    await this.prisma.db.proposta.update({
      where: { id: propostaId },
      data: {
        status: 'EM_ANALISE',
        rendaDeclarada: dto.rendaDeclarada !== undefined ? reais(dto.rendaDeclarada) : undefined,
        parecerOperador: dto.parecerOperador?.trim() || undefined,
      },
    });
    await this.prisma.db.logAuditoria.create({
      data: { acao: 'proposta_enviada_analise', entidade: 'proposta', entidadeId: propostaId, depois: { rendaDeclarada: dto.rendaDeclarada ?? null, parecer: !!dto.parecerOperador } },
    });
    // PONTE com a análise (decisões 08/08 Q2/Q5): o envio CRIA a análise de
    // cadastro, injeta a consulta da Camada 1 na trilha oficial e copia as
    // rendas — a política roda sempre, nunca em campo paralelo.
    await this.analise.abrirDaJornada(propostaId);
    return this.detalhe(propostaId);
  }

  private garantirEditavelJornada(status: string) {
    if (!['PENDENTE'].includes(status)) {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'A proposta não está mais em edição' });
    }
  }

  private async buscarJornada(id: string) {
    const p = await this.prisma.db.proposta.findFirst({
      where: { id },
      include: {
        ativo: { select: { varianteCatalogo: true } },
        simulacao: { select: { valorAvista: true } },
      },
    });
    if (!p) throw this.naoEncontrada();
    return p;
  }

  // Base do cálculo da proteção (mesma regra da simulação): valor à vista como
  // proxy da FIPE + fator de VALOR da frequência (semanal 1, quinzenal 2, mensal 4).
  private async baseProtecao(p: { ativo: { varianteCatalogo: string }; simulacao: { valorAvista: Prisma.Decimal | null } | null; frequencia: Periodicidade | null }) {
    const valorAvista = p.simulacao?.valorAvista ? cent(p.simulacao.valorAvista) : 0;
    if (valorAvista <= 0) return null;
    const cat = await this.catalogoFonte.compraParcelada(p.ativo.varianteCatalogo ?? 'carro');
    if (!cat || !cat.protecaoObrigatoria) return null;
    const fator = p.frequencia === 'MENSAL' ? 4 : p.frequencia === 'QUINZENAL' ? 2 : 1;
    return { varianteCP: p.ativo.varianteCatalogo ?? 'carro', valorAvista, fator };
  }

  // 7.6 — promoção/reconciliação por CPF; garante Conta; vincula lead e simulação.
  private async resolverTitular(
    simulacaoId: string,
    titularIdExistente: string | null,
    leadId: string | null,
    cadastro?: Cadastro,
  ): Promise<string> {
    if (titularIdExistente) return titularIdExistente;
    if (!cadastro) {
      throw new UnprocessableEntityException({
        erro: 'cadastro_obrigatorio',
        mensagem: 'Cadastro completo do comprador é obrigatório para criar a proposta',
      });
    }
    const cpf = limparDocumento(cadastro.cpfCnpj);
    const existente = await this.prisma.db.titular.findFirst({ where: { cpfCnpj: cpf } });
    const titularId = existente ? existente.id : (await this.titular.criar(cadastro)).id;

    const conta = await this.prisma.db.conta.findFirst({ where: { titularId } });
    if (!conta) await this.conta.criar({ titularId });

    if (leadId) {
      await this.prisma.db.lead.update({ where: { id: leadId }, data: { titularId } });
    }
    await this.prisma.db.simulacao.update({ where: { id: simulacaoId }, data: { titularId } });
    return titularId;
  }

  // 7.7 — adiciona comprador secundário ou garantidor (papel de Titular).
  async adicionarVinculo(propostaId: string, dto: AdicionarVinculoDto) {
    const proposta = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      include: { vinculos: { include: { titular: { select: { cpfCnpj: true } } } } },
    });
    if (!proposta) throw this.naoEncontrada();

    const cpf = limparDocumento(dto.titular.cpfCnpj);
    const existente = await this.prisma.db.titular.findFirst({ where: { cpfCnpj: cpf } });
    const titularId = existente ? existente.id : (await this.titular.criar(dto.titular)).id;

    // CPF único entre papéis no mesmo contrato/proposta (Doc 2 §4-A.7).
    if (proposta.vinculos.some((v) => v.titularId === titularId)) {
      throw new ConflictException({
        erro: 'papel_duplicado',
        mensagem: 'Este titular já ocupa um papel nesta proposta',
      });
    }
    await this.prisma.db.vinculoPapel.create({
      data: { propostaId, titularId, papel: dto.papel.toUpperCase() as PapelTitular },
    });
    return this.detalhe(propostaId);
  }

  // Carrinho: adiciona um produto do catálogo à proposta (snapshot do produto).
  async adicionarProduto(propostaId: string, produtoId: string, valorOverride?: number) {
    const proposta = await this.prisma.db.proposta.findFirst({ where: { id: propostaId }, select: { status: true } });
    if (!proposta) throw this.naoEncontrada();
    if (proposta.status === 'convertida'.toUpperCase()) {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'Proposta já convertida' });
    }
    const produto = await this.prisma.db.produto.findFirst({ where: { id: produtoId } });
    if (!produto) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Produto não encontrado' });
    const valorCent = valorOverride ?? (produto.valorPadrao ? reaisParaCentavos(produto.valorPadrao.toString()) : 0);
    await this.prisma.db.itemProposta.create({
      data: {
        propostaId,
        produtoId: produto.id,
        nome: produto.nome,
        natureza: produto.natureza,
        apartado: produto.apartado,
        credor: produto.credorPadrao,
        valor: centavosParaReaisString(valorCent),
        periodicidade: produto.periodicidade,
      },
    });
    return this.detalhe(propostaId);
  }

  async removerProduto(propostaId: string, itemId: string) {
    await this.prisma.db.itemProposta.deleteMany({ where: { id: itemId, propostaId } });
    return this.detalhe(propostaId);
  }

  // 7.8 — anexa documento digital a um titular que tem papel na proposta.
  async anexarDocumento(propostaId: string, dto: AnexarDocumentoDto) {
    const proposta = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      include: { vinculos: { select: { titularId: true } } },
    });
    if (!proposta) throw this.naoEncontrada();
    if (!proposta.vinculos.some((v) => v.titularId === dto.titularId)) {
      throw new UnprocessableEntityException({
        erro: 'titular_sem_papel',
        mensagem: 'O documento deve pertencer a um titular com papel na proposta',
      });
    }
    const doc = await this.prisma.db.documentoProposta.create({
      data: {
        propostaId,
        titularId: dto.titularId,
        tipo: dto.tipo.toUpperCase() as TipoDocumentoProposta,
        arquivoRef: dto.arquivoNome ?? 'documento',
      },
    });
    // Upload real: grava o conteúdo (base64) em disco, indexado pelo id do documento.
    if (dto.arquivoConteudo) {
      const base64 = dto.arquivoConteudo.includes(',') ? dto.arquivoConteudo.split(',')[1] : dto.arquivoConteudo;
      await fs.mkdir(UPLOADS_DIR, { recursive: true });
      await fs.writeFile(join(UPLOADS_DIR, doc.id), Buffer.from(base64, 'base64'));
    }
    return this.detalhe(propostaId);
  }

  // Lê o arquivo salvo de um documento (para download).
  async arquivoDocumento(docId: string): Promise<{ nome: string; buffer: Buffer }> {
    const doc = await this.prisma.db.documentoProposta.findFirst({ where: { id: docId } });
    if (!doc) throw this.naoEncontrada();
    const caminho = join(UPLOADS_DIR, doc.id);
    try {
      const buffer = await fs.readFile(caminho);
      return { nome: doc.arquivoRef, buffer };
    } catch {
      throw new NotFoundException({ erro: 'arquivo_ausente', mensagem: 'Arquivo não encontrado em disco' });
    }
  }

  // 7.8 — registra o parecer; decide o status da proposta (decisão de crédito).
  async registrarParecer(propostaId: string, dto: RegistrarParecerDto, analistaId: string) {
    const proposta = await this.prisma.db.proposta.findFirst({ where: { id: propostaId }, select: { status: true } });
    if (!proposta) throw this.naoEncontrada();
    if (!['PENDENTE', 'EM_ANALISE'].includes(proposta.status)) {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: 'Parecer só pode ser emitido em proposta Pendente ou Em Análise',
      });
    }
    if (dto.resultado === 'reprovado' && !dto.motivoReprovacao) {
      throw new UnprocessableEntityException({
        erro: 'motivo_obrigatorio',
        mensagem: 'Reprovação exige motivo',
      });
    }
    if (dto.resultado === 'aprovado_com_ressalvas' && !dto.motivosRessalva?.length) {
      throw new UnprocessableEntityException({
        erro: 'motivo_obrigatorio',
        mensagem: 'Aprovação com ressalvas exige ao menos um motivo',
      });
    }
    // Ressalvas: todos os motivos requerem garantidor (referência da análise).
    const exigeGarantidor = dto.resultado === 'aprovado_com_ressalvas' ? true : dto.exigeGarantidor;
    const motivosRessalva = dto.motivosRessalva?.length ? dto.motivosRessalva.join(',') : null;
    // Gate: documentos obrigatórios completos antes do parecer (Doc 2 §4-A.5 / §8-A.5).
    const pendencias = await this.pendenciasProposta(propostaId);
    if (pendencias.length) {
      throw new UnprocessableEntityException({
        erro: 'documentos_pendentes',
        mensagem: `Documentos obrigatórios pendentes: ${pendencias
          .map((p) => `${p.nome} (${p.faltando.join(', ')})`)
          .join('; ')}`,
      });
    }
    const aprovada = dto.resultado !== 'reprovado';
    await this.prisma.db.$transaction(async (tx) => {
      await tx.parecer.upsert({
        where: { propostaId },
        create: {
          propostaId,
          resultado: dto.resultado.toUpperCase() as ResultadoParecer,
          motivoReprovacao: dto.motivoReprovacao,
          motivosRessalva,
          observacao: dto.observacao,
          exigeGarantidor,
          analistaId,
        },
        update: {
          resultado: dto.resultado.toUpperCase() as ResultadoParecer,
          motivoReprovacao: dto.motivoReprovacao,
          motivosRessalva,
          observacao: dto.observacao,
          exigeGarantidor,
          analistaId,
        },
      });
      await tx.proposta.update({
        where: { id: propostaId },
        data: { status: aprovada ? 'APROVADA' : 'REPROVADA' },
      });
    });
    return this.detalhe(propostaId);
  }

  async patchStatus(propostaId: string, novo: string) {
    const proposta = await this.prisma.db.proposta.findFirst({ where: { id: propostaId }, select: { status: true } });
    if (!proposta) throw this.naoEncontrada();
    const alvo = novo.toUpperCase() as StatusProposta;
    if (!TRANSICOES[proposta.status]?.includes(alvo)) {
      throw new UnprocessableEntityException({
        erro: 'transicao_invalida',
        mensagem: `Transição ${proposta.status} → ${alvo} não é permitida`,
      });
    }
    await this.prisma.db.proposta.update({ where: { id: propostaId }, data: { status: alvo } });
    return this.detalhe(propostaId);
  }

  async listar() {
    const propostas = await this.prisma.db.proposta.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        titular: { select: { nome: true } },
        ativo: { select: { descricao: true } },
      },
    });
    return propostas.map((p) => ({
      id: p.id,
      status: p.status.toLowerCase(),
      modalidade: p.modalidade.toLowerCase(),
      titular: p.titular.nome,
      ativo: p.ativo.descricao,
      valorEntrada: cent(p.valorEntrada),
      valorParcela: cent(p.valorParcela),
      numeroParcelas: p.numeroParcelas,
      prazoSemanas: p.prazoSemanas,
      contratoGeradoId: p.contratoGeradoId,
      foraParametro: p.foraParametro,
      createdAt: p.createdAt.toISOString(),
    }));
  }


  // Condição fora do parâmetro (decisão 03/08): solicita a aprovação de alçada
  // que o gate da formalização exige. Valor de alçada = total do plano.
  async solicitarAprovacaoForaParametro(propostaId: string, usuarioId: string) {
    const p = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      include: { titular: { select: { id: true, nome: true } }, simulacao: { include: { ofertas: { where: { selecionada: true } } } } },
    });
    if (!p) throw this.naoEncontrada();
    if (!p.foraParametro) {
      throw new UnprocessableEntityException({
        erro: 'dentro_do_parametro',
        mensagem: 'A proposta está dentro do parâmetro — não precisa de aprovação de alçada',
      });
    }
    const existente = await this.prisma.db.aprovacao.findFirst({
      where: { tipoOperacao: 'condicao_fora_parametro', referenciaTipo: 'proposta', referenciaId: propostaId, status: { in: ['PENDENTE', 'APROVADA'] } },
    });
    if (existente) {
      return { id: existente.id, status: existente.status.toLowerCase() };
    }
    const motivo = p.simulacao?.ofertas[0]?.foraParametroMotivo ?? 'condição fora do parâmetro';
    const total = Math.round(Number(p.valorParcela.toString()) * 100) * p.numeroParcelas;
    return this.aprovacao.criar({
      tipoOperacao: 'condicao_fora_parametro',
      referenciaTipo: 'proposta',
      referenciaId: propostaId,
      titularId: p.titular.id,
      valorCentavos: total,
      resumo: `Fora do parâmetro — ${p.titular.nome}: entrada R$ ${Number(p.valorEntrada.toString()).toFixed(2)}, ${p.numeroParcelas}x R$ ${Number(p.valorParcela.toString()).toFixed(2)} (${motivo})`,
      solicitanteId: usuarioId,
    });
  }

  async detalhe(id: string) {
    const p = await this.prisma.db.proposta.findFirst({
      where: { id },
      include: {
        titular: { select: { id: true, nome: true, cpfCnpj: true, whatsapp: true } },
        ativo: { select: { id: true, descricao: true, valorVenda: true } },
        vinculos: { include: { titular: { select: { id: true, nome: true, cpfCnpj: true } } } },
        documentos: true,
        parecer: true,
        itens: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!p) throw this.naoEncontrada();
    const aprovacaoFp = p.foraParametro
      ? await this.prisma.db.aprovacao.findFirst({
          where: { tipoOperacao: 'condicao_fora_parametro', referenciaTipo: 'proposta', referenciaId: id },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    const pendencias = this.calcPendencias(p.vinculos, p.documentos);
    return {
      id: p.id,
      status: p.status.toLowerCase(),
      modalidade: p.modalidade.toLowerCase(),
      ativo: { id: p.ativo.id, descricao: p.ativo.descricao },
      titular: p.titular,
      valorEntrada: cent(p.valorEntrada),
      valorParcela: cent(p.valorParcela),
      numeroParcelas: p.numeroParcelas,
      prazoSemanas: p.prazoSemanas,
      contratoGeradoId: p.contratoGeradoId,
      foraParametro: p.foraParametro,
      aprovacaoForaParametro: aprovacaoFp ? aprovacaoFp.status.toLowerCase() : null,
      // Jornada (doc 02 §20): camada 1 é NEUTRA para o operador — só o status;
      // motivos/alertas ficam no Json interno (análise/diretoria).
      camada1: p.camada1Status,
      planoProtecao: p.planoProtecao,
      adicionalProtecao: cent(p.adicionalProtecao),
      rendaDeclarada: p.rendaDeclarada ? cent(p.rendaDeclarada) : null,
      parecerOperador: p.parecerOperador,
      // Documentos obrigatórios (Doc 2 §4-A.5) — para a UI exibir pendência e travar avanço.
      documentosObrigatorios: DOCS_OBRIGATORIOS.map((t) => t.toLowerCase()),
      pendenciasDocumentos: pendencias,
      documentosCompletos: pendencias.length === 0,
      papeis: p.vinculos.map((v) => ({
        id: v.id,
        papel: v.papel.toLowerCase(),
        titular: v.titular,
      })),
      documentos: p.documentos.map((d) => ({
        id: d.id,
        tipo: d.tipo.toLowerCase(),
        titularId: d.titularId,
        arquivoRef: d.arquivoRef,
      })),
      parecer: p.parecer
        ? {
            resultado: p.parecer.resultado.toLowerCase(),
            exigeGarantidor: p.parecer.exigeGarantidor,
            motivoReprovacao: p.parecer.motivoReprovacao,
            motivosRessalva: p.parecer.motivosRessalva ? p.parecer.motivosRessalva.split(',') : [],
            observacao: p.parecer.observacao,
          }
        : null,
      // Carrinho: produtos adicionados à proposta (além do âncora financiamento).
      itens: p.itens.map((it) => ({
        id: it.id,
        produtoId: it.produtoId,
        nome: it.nome,
        natureza: it.natureza.toLowerCase(),
        apartado: it.apartado,
        credor: it.credor.toLowerCase(),
        valor: cent(it.valor),
        periodicidade: it.periodicidade ? it.periodicidade.toLowerCase() : null,
      })),
    };
  }

  // Pendências de documentos obrigatórios por papel (principal/secundário).
  private calcPendencias(
    vinculos: { titularId: string; papel: PapelTitular; titular: { nome: string } }[],
    documentos: { titularId: string; tipo: TipoDocumentoProposta }[],
  ): PendenciaDoc[] {
    const pend: PendenciaDoc[] = [];
    for (const v of vinculos.filter((x) => PAPEIS_QUE_EXIGEM_DOCS.includes(x.papel))) {
      const tipos = new Set(documentos.filter((d) => d.titularId === v.titularId).map((d) => d.tipo));
      const faltando = DOCS_OBRIGATORIOS.filter((t) => !tipos.has(t));
      if (faltando.length) {
        pend.push({
          titularId: v.titularId,
          papel: v.papel.toLowerCase(),
          nome: v.titular.nome,
          faltando: faltando.map((t) => t.toLowerCase()),
        });
      }
    }
    return pend;
  }

  // Carrega e verifica pendências — usado nos gates (parecer/formalização).
  async pendenciasProposta(propostaId: string): Promise<PendenciaDoc[]> {
    const p = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      include: { vinculos: { include: { titular: { select: { nome: true } } } }, documentos: true },
    });
    if (!p) throw this.naoEncontrada();
    return this.calcPendencias(p.vinculos, p.documentos);
  }

  private naoEncontrada() {
    return new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Proposta não encontrada' });
  }
}
