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
import { rotuloAtivo, rotuloVeiculoProposta, limparDocumento, reaisParaCentavos, centavosParaReaisString, formatCurrency, fatorValorDesdeSemanal, situacaoListaEspera, validadeAprovacaoEspera, aprovacaoExpirada, diasRestantesAprovacao, ROTULO_SITUACAO_ESPERA, type FrequenciaSimulacao } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { TitularService } from '../titular/titular.service';
import { ContaService } from '../conta/conta.service';
import { AprovacaoService } from '../aprovacao/aprovacao.service';
import { Camada1Service } from '../bureau/camada1.service';
import { AnaliseService } from '../analise/analise.service';
import { CatalogoFonteService } from '../catalogo/catalogo-fonte.service';
import { NotificacaoService } from '../notificacao/notificacao.service';
import { SimulacaoService } from './simulacao.service';
import { referenciaParaApi } from './referencia';
import { PropostaStatusService } from './proposta-status.service';
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

// Documentos obrigatórios por papel (doc 02 §20 passo 9): CNH e comprovante de
// endereço (decisão Luís 08/11/2026 — na homologação de 04/08 só a CNH era
// obrigatória; o comprovante voltou, o relatório BRIC continua fora). Demais
// documentos são COMPLEMENTARES opcionais (extrato, contracheque, contrato de
// locadora…). Fonte única: as telas leem `documentosObrigatorios` da proposta.
export const DOCS_OBRIGATORIOS: TipoDocumentoProposta[] = ['CNH', 'COMPROVANTE_ENDERECO'];
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
    private readonly notificacao: NotificacaoService,
    private readonly simulacaoService: SimulacaoService,
    private readonly statusProposta: PropostaStatusService,
  ) {
    // Bloco B da auditoria (15/09, P1-8): a exceção "fora de parâmetro" não
    // tinha efetivador — aprovar já funcionava (o gate da formalização lê o
    // status), mas a REPROVAÇÃO era muda: ninguém ficava sabendo e a proposta
    // seguia bloqueada sem explicação. Agora as duas decisões notificam.
    this.aprovacao.registrarEfetivador('condicao_fora_parametro', {
      aprovada: async (a) => {
        await this.notificarDecisaoForaParametro(a.referenciaId, true);
        return 'Exceção aprovada — a proposta pode ser formalizada.';
      },
      reprovada: async (a) => {
        await this.notificarDecisaoForaParametro(a.referenciaId, false);
      },
    });
  }

  private async notificarDecisaoForaParametro(propostaId: string, aprovada: boolean) {
    const p = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      select: { id: true, titular: { select: { nome: true } } },
    });
    if (!p) return;
    await this.prisma.db.notificacao.create({
      data: {
        titulo: aprovada
          ? `Condição fora de parâmetro APROVADA — ${p.titular?.nome ?? 'proposta'}`
          : `Condição fora de parâmetro NEGADA — ${p.titular?.nome ?? 'proposta'}`,
        corpo: aprovada
          ? 'A exceção foi aprovada pela alçada: a proposta está liberada para formalização.'
          : 'A exceção foi negada: ajuste as condições da proposta aos parâmetros (ou reapresente com nova justificativa).',
        rota: `/propostas/${p.id}`,
        tipo: 'APROVACAO',
        area: 'COMERCIAL',
      },
    }).catch(() => undefined);
  }

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
    // Proposta precisa de um ativo OU de um veículo de referência (doc 02 §31.1).
    // Simulação por valor manual livre deve ser refeita com um dos dois.
    if (!simulacao.ativoId && !simulacao.referenciaId) {
      throw new UnprocessableEntityException({
        erro: 'sem_ativo',
        mensagem: 'Vincule um veículo do estoque ou um modelo de referência (FIPE) à simulação antes de converter em proposta',
      });
    }

    // Resolve o comprador principal (promoção do lead, se necessário).
    const titularId = await this.resolverTitular(simulacao.id, simulacao.titularId, simulacao.leadId, dto.comprador);

    const proposta = await this.prisma.db.proposta.create({
      data: {
        simulacaoId: simulacao.id,
        titularId,
        ativoId: simulacao.ativoId,
        referenciaId: simulacao.referenciaId,
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
      include: {
        titular: { select: { cpfCnpj: true } },
        vinculos: { include: { titular: { select: { id: true, nome: true, cpfCnpj: true } } } },
        documentos: true,
      },
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
    // Camada 1 desatualizada? Reexecuta no envio quando o cache é SIMULADO,
    // indisponível ou ausente e agora há credenciais reais no ambiente — o caso
    // clássico: proposta criada antes de configurar o birô. Consome franquia.
    const cache = p.camada1Resultado as null | { dados?: { simulado?: boolean } | null };
    const precisaReconsultar =
      !p.camada1Status || p.camada1Status === 'indisponivel' || cache?.dados?.simulado === true;
    if (precisaReconsultar && this.camada1.temCredenciaisReais) {
      const r = await this.camada1.avaliar(p.titular.cpfCnpj);
      await this.prisma.db.proposta.update({
        where: { id: propostaId },
        data: {
          camada1Status: r.status,
          camada1Resultado: JSON.parse(JSON.stringify(r)) as Prisma.InputJsonValue,
          ...(r.status === 'reprovado' ? { status: 'REPROVADA' as const } : {}),
        },
      });
      await this.prisma.db.logAuditoria.create({
        data: { acao: 'camada1_reavaliada_no_envio', entidade: 'proposta', entidadeId: propostaId, depois: { status: r.status, motivos: r.motivos.length, alertas: r.alertas.length } },
      });
      if (r.status === 'reprovado') return this.detalhe(propostaId); // tela neutra no operador
    }
    await this.prisma.db.proposta.update({
      where: { id: propostaId },
      data: {
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
    // Status derivado dos fatos (04/11): a análise aberta acima é o fato que
    // leva a proposta a "Em análise" — mesmo gravador para todos os caminhos.
    await this.statusProposta.sincronizar(propostaId, 'proposta enviada para análise');
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
  // Sem ativo (proposta por referência, doc 02 §31) a variante é a padrão 'carro'.
  private async baseProtecao(p: { ativo: { varianteCatalogo: string } | null; simulacao: { valorAvista: Prisma.Decimal | null } | null; frequencia: Periodicidade | null }) {
    const valorAvista = p.simulacao?.valorAvista ? cent(p.simulacao.valorAvista) : 0;
    if (valorAvista <= 0) return null;
    const varianteCP = p.ativo?.varianteCatalogo ?? 'carro';
    const cat = await this.catalogoFonte.compraParcelada(varianteCP);
    if (!cat || !cat.protecaoObrigatoria) return null;
    const fator = p.frequencia ? fatorValorDesdeSemanal(p.frequencia) : 1;
    return { varianteCP, valorAvista, fator };
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

  // Remove um documento anexado por engano (pedido Luís 14/09): permitido
  // enquanto a proposta não está CONVERTIDA (fase de anexo/análise); o
  // registro sai com o arquivo, e a remoção fica auditada.
  async removerDocumento(propostaId: string, docId: string, usuarioId?: string) {
    const doc = await this.prisma.db.documentoProposta.findFirst({
      where: { id: docId, propostaId },
      include: { proposta: { select: { status: true } } },
    });
    if (!doc) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Documento não encontrado nesta proposta' });
    if (doc.proposta.status === 'CONVERTIDA') {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: 'Proposta já convertida — documentos fazem parte da trilha e não podem ser removidos',
      });
    }
    await this.prisma.db.documentoProposta.delete({ where: { id: doc.id } });
    try {
      await fs.unlink(join(UPLOADS_DIR, doc.id));
    } catch {
      // Arquivo pode não existir (uploads antigos pré-volume) — o registro já saiu.
    }
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'documento_proposta_removido',
        entidade: 'proposta',
        entidadeId: propostaId,
        depois: { docId: doc.id, tipo: doc.tipo, arquivoRef: doc.arquivoRef },
      },
    });
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
    const proposta = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      select: { status: true, analiseCadastro: { select: { id: true } } },
    });
    if (!proposta) throw this.naoEncontrada();
    // Trilha de decisão ÚNICA (doc 02 §14, decisão 2026-08-15): com Análise de
    // Cadastro aberta, o parecer legado da proposta sai de cena — aprovar aqui
    // criava uma proposta "Aprovada" com a análise ainda em andamento.
    if (proposta.analiseCadastro) {
      throw new UnprocessableEntityException({
        erro: 'analise_cadastro_ativa',
        mensagem: 'Esta proposta tem Análise de Cadastro — parecer, decisão e liberação acontecem no workspace da análise',
      });
    }
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
    });
    // Status derivado dos fatos (04/11): o parecer gravado acima decide.
    await this.statusProposta.sincronizar(propostaId, `parecer ${aprovada ? 'aprovado' : 'reprovado'}`, analistaId);
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
    // Doc 02 §31.4 passo 5: cancelar a proposta solta o ativo reservado.
    if (alvo === 'CANCELADA') await this.liberarReserva(propostaId);
    return this.detalhe(propostaId);
  }

  async listar() {
    const propostas = await this.prisma.db.proposta.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        titular: { select: { nome: true } },
        ativo: { select: { descricao: true, placa: true } },
        referencia: { select: { marca: true, modelo: true, anoModelo: true } },
      },
    });
    return propostas.map((p) => ({
      id: p.id,
      status: p.status.toLowerCase(),
      modalidade: p.modalidade.toLowerCase(),
      titular: p.titular.nome,
      ativo: rotuloVeiculoProposta(p),
      porReferencia: !!p.referenciaId,
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
      resumo: `Condição comercial fora do parâmetro — ${p.titular.nome}: entrada ${formatCurrency(Math.round(Number(p.valorEntrada.toString()) * 100))} + ${p.numeroParcelas}× ${formatCurrency(Math.round(Number(p.valorParcela.toString()) * 100))}`,
      payload: { motivos: [motivo] },
      solicitanteId: usuarioId,
    });
  }

  async detalhe(id: string) {
    const p = await this.prisma.db.proposta.findFirst({
      where: { id },
      include: {
        titular: { select: { id: true, nome: true, cpfCnpj: true, whatsapp: true } },
        ativo: { select: { id: true, descricao: true, placa: true, valorVenda: true } },
        referencia: true,
        vinculos: { include: { titular: { select: { id: true, nome: true, cpfCnpj: true } } } },
        documentos: true,
        parecer: true,
        itens: { orderBy: { createdAt: 'asc' } },
        analiseCadastro: { select: { id: true, status: true } },
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
      // Doc 02 §31: ativo OU referência; `veiculo` é o rótulo único para as telas.
      ativo: p.ativo ? { id: p.ativo.id, descricao: p.ativo.descricao, placa: p.ativo.placa, rotulo: rotuloAtivo(p.ativo) } : null,
      referencia: p.referencia ? referenciaParaApi(p.referencia) : null,
      veiculo: rotuloVeiculoProposta(p),
      veiculoAtribuidoEm: p.veiculoAtribuidoEm?.toISOString() ?? null,
      veiculoConferidoEm: p.veiculoConferidoEm?.toISOString() ?? null,
      ajusteVeiculo: (p.conferenciaVeiculo ?? null) as Record<string, unknown> | null,
      titular: p.titular,
      valorEntrada: cent(p.valorEntrada),
      valorParcela: cent(p.valorParcela),
      numeroParcelas: p.numeroParcelas,
      prazoSemanas: p.prazoSemanas,
      contratoGeradoId: p.contratoGeradoId,
      // Trilha única (doc 02 §14, 2026-08-15): com análise aberta, o parecer legado sai da tela.
      analiseCadastro: p.analiseCadastro ? { id: p.analiseCadastro.id, status: p.analiseCadastro.status } : null,
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

  // =========================================================================
  // Lista de espera (doc 02 §31, decisão Luís 03/11): proposta APROVADA por
  // veículo de REFERÊNCIA (FIPE), sem carro no estoque. Situação calculada
  // (Regra 7); validade = DIAS_VALIDADE_APROVACAO_ESPERA (Regra 16).
  // =========================================================================

  // Data da aprovação: liberação da análise de cadastro (trilha única §14) ou,
  // no fluxo legado sem análise, o parecer.
  private aprovadaEmDe(p: { analiseCadastro: { liberadaEm: Date | null } | null; parecer: { data: Date } | null; updatedAt: Date }): Date | null {
    return p.analiseCadastro?.liberadaEm ?? p.parecer?.data ?? (p.analiseCadastro || p.parecer ? p.updatedAt : null);
  }

  async listaEspera() {
    const propostas = await this.prisma.db.proposta.findMany({
      where: { referenciaId: { not: null }, contratoGeradoId: null, status: { in: ['APROVADA', 'EM_FORMALIZACAO'] } },
      include: {
        titular: { select: { id: true, nome: true, cpfCnpj: true, whatsapp: true } },
        referencia: true,
        ativo: { select: { id: true, descricao: true, placa: true, valorVenda: true } },
        analiseCadastro: { select: { id: true, liberadaEm: true } },
        parecer: { select: { data: true } },
      },
    });
    const agora = new Date();
    const itens = propostas.map((p) => {
      const aprovadaEm = this.aprovadaEmDe(p);
      const situacao = situacaoListaEspera({ aprovadaEm, veiculoAtribuidoEm: p.veiculoAtribuidoEm, veiculoConferidoEm: p.veiculoConferidoEm }, agora);
      return {
        id: p.id,
        titular: p.titular,
        referencia: p.referencia ? referenciaParaApi(p.referencia) : null,
        ativo: p.ativo ? { id: p.ativo.id, descricao: p.ativo.descricao, placa: p.ativo.placa, rotulo: rotuloAtivo(p.ativo), valorVenda: p.ativo.valorVenda ? cent(p.ativo.valorVenda) : null } : null,
        valorEntrada: cent(p.valorEntrada),
        valorParcela: cent(p.valorParcela),
        numeroParcelas: p.numeroParcelas,
        prazoMeses: p.prazoMeses,
        frequencia: p.frequencia ? p.frequencia.toLowerCase() : null,
        foraParametro: p.foraParametro,
        analiseId: p.analiseCadastro?.id ?? null,
        aprovadaEm: aprovadaEm?.toISOString() ?? null,
        validaAte: aprovadaEm ? validadeAprovacaoEspera(aprovadaEm).toISOString() : null,
        diasRestantes: diasRestantesAprovacao(aprovadaEm, agora),
        situacao,
        situacaoRotulo: ROTULO_SITUACAO_ESPERA[situacao],
        veiculoAtribuidoEm: p.veiculoAtribuidoEm?.toISOString() ?? null,
        veiculoConferidoEm: p.veiculoConferidoEm?.toISOString() ?? null,
        ajuste: (p.conferenciaVeiculo ?? null) as Record<string, unknown> | null,
      };
    });
    // Mais antiga primeiro (sugestão — o operador escolhe quem atende).
    itens.sort((a, b) => (a.aprovadaEm ?? '').localeCompare(b.aprovadaEm ?? ''));
    return itens;
  }

  // Passos 1–3 do §31.4: reserva o ativo, recalcula a condição com o carro real e
  // guarda a proposta de ajuste SEM sobrescrever a aprovada; avisa a análise.
  async atribuirVeiculo(propostaId: string, ativoId: string, usuarioId: string) {
    const p = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      include: {
        titular: { select: { nome: true, cpfCnpj: true } },
        referencia: true,
        analiseCadastro: { select: { id: true, liberadaEm: true } },
        parecer: { select: { data: true } },
      },
    });
    if (!p) throw this.naoEncontrada();
    if (!p.referenciaId) {
      throw new UnprocessableEntityException({ erro: 'nao_e_referencia', mensagem: 'Esta proposta já nasceu com um veículo do estoque' });
    }
    if (p.status !== 'APROVADA' || p.contratoGeradoId) {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'Só se atribui veículo a proposta aprovada e ainda sem contrato' });
    }
    if (p.veiculoAtribuidoEm) {
      throw new UnprocessableEntityException({ erro: 'ja_atribuido', mensagem: 'Já há um veículo atribuído — devolva-o antes de escolher outro' });
    }
    const ativo = await this.prisma.db.ativo.findFirst({ where: { id: ativoId, deletedAt: null }, select: { id: true, status: true, descricao: true, placa: true, varianteCatalogo: true } });
    if (!ativo) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Ativo não encontrado' });
    if (ativo.status !== 'DISPONIVEL') {
      throw new UnprocessableEntityException({ erro: 'ativo_indisponivel', mensagem: 'O ativo não está disponível (em contrato, reservado ou fora do estoque)' });
    }

    // Aprovação vencida (§31.3): nova Camada 1 antes de seguir; reprovado barra.
    const aprovadaEm = this.aprovadaEmDe(p);
    let camada1Renovada: string | null = null;
    if (aprovacaoExpirada(aprovadaEm)) {
      const r = await this.camada1.avaliar(p.titular.cpfCnpj);
      camada1Renovada = r.status;
      await this.prisma.db.proposta.update({
        where: { id: propostaId },
        data: { camada1Status: r.status, camada1Resultado: JSON.parse(JSON.stringify(r)) as Prisma.InputJsonValue },
      });
      await this.prisma.db.logAuditoria.create({
        data: { acao: 'camada1_renovada_lista_espera', entidade: 'proposta', entidadeId: propostaId, depois: JSON.parse(JSON.stringify({ status: r.status, motivos: r.motivos, alertas: r.alertas })) as Prisma.InputJsonValue },
      });
      if (r.status === 'reprovado') {
        throw new UnprocessableEntityException({
          erro: 'camada1_reprovada',
          mensagem: 'A aprovação venceu e a nova consulta de cadastro não permite seguir — a análise precisa reabrir o caso',
        });
      }
    }

    // Recalcula com o carro real: mesmo prazo/frequência/entrada da aprovação.
    const freq = (p.frequencia ?? 'SEMANAL').toLowerCase() as FrequenciaSimulacao;
    const r = await this.simulacaoService.recalcularCondicao({
      ativoId: ativo.id,
      valorEntrada: cent(p.valorEntrada),
      prazoMeses: p.prazoMeses ?? Math.max(1, Math.round(p.numeroParcelas / (freq === 'mensal' ? 1 : freq === 'quinzenal' ? 2 : 4))),
      frequencia: freq,
    });
    // Adicional de proteção (passo 8 do atendimento) recalculado sobre o valor real.
    let adicional = 0;
    if (p.planoProtecao !== 'essencial') {
      const essencial = await this.catalogoFonte.protecaoPlano(r.varianteCP, r.valorAvista, 'essencial');
      const escolhido = await this.catalogoFonte.protecaoPlano(r.varianteCP, r.valorAvista, p.planoProtecao as 'protecao' | 'completa');
      if (essencial && escolhido) {
        adicional = Math.max(0, Math.round((escolhido.semanalExata - essencial.semanalExata) * (p.frequencia ? fatorValorDesdeSemanal(p.frequencia) : 1)));
      }
    }
    const ajuste = {
      ativoId: ativo.id,
      ativoRotulo: rotuloAtivo(ativo),
      valorAvista: r.valorAvista,
      valorFipeReferencia: p.referencia ? cent(p.referencia.valorFipe) : null,
      parcelaBase: r.parcelaBase,
      adicionalProtecao: adicional,
      valorParcela: r.parcelaBase + adicional,
      parcelaAprovada: cent(p.valorParcela),
      // Valores da aprovação por referência — restaurados se o carro for devolvido
      // depois de confirmado (o carro caiu, a aprovação continua valendo).
      numeroParcelasAprovado: p.numeroParcelas,
      adicionalProtecaoAprovado: cent(p.adicionalProtecao),
      foraParametroAprovado: p.foraParametro,
      numeroParcelas: r.numeroParcelas,
      foraParametro: r.foraParametroMotivo !== null,
      foraParametroMotivo: r.foraParametroMotivo,
      camada1Renovada,
      calculadoEm: new Date().toISOString(),
      atribuidoPor: usuarioId,
    };

    await this.prisma.db.$transaction(async (tx) => {
      await tx.ativo.update({ where: { id: ativo.id }, data: { status: 'RESERVADO', reservadoPropostaId: propostaId, reservadoEm: new Date() } });
      await tx.proposta.update({
        where: { id: propostaId },
        data: { ativoId: ativo.id, veiculoAtribuidoEm: new Date(), veiculoConferidoEm: null, veiculoConferidoPorId: null, conferenciaVeiculo: ajuste as Prisma.InputJsonValue },
      });
    });
    await this.prisma.db.logAuditoria.create({
      data: { acao: 'veiculo_atribuido', entidade: 'proposta', entidadeId: propostaId, usuarioId, depois: ajuste as Prisma.InputJsonValue },
    });
    // Passo 6: a análise é avisada para conferir.
    await this.notificacao.emitir({
      titulo: `Veículo atribuído para conferência — ${p.titular.nome}`,
      corpo: `${rotuloAtivo(ativo)} · parcela ${formatCurrency(ajuste.valorParcela)} (aprovada ${formatCurrency(ajuste.parcelaAprovada)})${ajuste.foraParametro ? ' · fora do parâmetro' : ''}`,
      rota: p.analiseCadastro ? `/analises/${p.analiseCadastro.id}` : `/propostas/${propostaId}`,
      tipo: 'APROVACAO',
      area: 'ANALISE_CADASTRO',
    });
    return this.detalhe(propostaId);
  }

  // Passo 4 do §31.4: confirmar aplica o ajuste na proposta; devolver solta o
  // ativo, descarta o ajuste e a proposta volta à fila com os valores aprovados.
  async conferirVeiculo(propostaId: string, dto: { confirmar: boolean; observacao?: string }, usuarioId: string) {
    const p = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      include: { titular: { select: { nome: true } }, simulacao: { select: { id: true } }, analiseCadastro: { select: { id: true } } },
    });
    if (!p) throw this.naoEncontrada();
    if (!p.referenciaId || !p.veiculoAtribuidoEm || !p.ativoId) {
      throw new UnprocessableEntityException({ erro: 'sem_atribuicao', mensagem: 'Não há veículo atribuído para conferir' });
    }
    if (p.veiculoConferidoEm && dto.confirmar) {
      throw new UnprocessableEntityException({ erro: 'ja_conferido', mensagem: 'O veículo já foi conferido' });
    }
    if (p.contratoGeradoId) {
      throw new UnprocessableEntityException({ erro: 'ja_formalizada', mensagem: 'Proposta já gerou contrato' });
    }
    const ajuste = (p.conferenciaVeiculo ?? {}) as {
      valorParcela?: number; adicionalProtecao?: number; numeroParcelas?: number; foraParametro?: boolean; valorAvista?: number;
      parcelaAprovada?: number; numeroParcelasAprovado?: number; adicionalProtecaoAprovado?: number; foraParametroAprovado?: boolean; valorFipeReferencia?: number | null;
    };

    if (dto.confirmar) {
      await this.prisma.db.$transaction(async (tx) => {
        await tx.proposta.update({
          where: { id: propostaId },
          data: {
            valorParcela: ajuste.valorParcela !== undefined ? reais(ajuste.valorParcela) : undefined,
            adicionalProtecao: ajuste.adicionalProtecao !== undefined ? reais(ajuste.adicionalProtecao) : undefined,
            numeroParcelas: ajuste.numeroParcelas,
            prazoSemanas: ajuste.numeroParcelas,
            // Fora do parâmetro com o carro real → alçada, como já existe.
            foraParametro: p.foraParametro || !!ajuste.foraParametro,
            veiculoConferidoEm: new Date(),
            veiculoConferidoPorId: usuarioId,
          },
        });
        // A base comercial da proteção/contratação passa a ser o valor do carro
        // real (a simulação segue CONVERTIDA; só o valor à vista é atualizado —
        // registrado na auditoria abaixo).
        if (p.simulacao && ajuste.valorAvista) {
          await tx.simulacao.update({ where: { id: p.simulacao.id }, data: { valorAvista: reais(ajuste.valorAvista), ativoId: p.ativoId } });
        }
      });
      await this.prisma.db.logAuditoria.create({
        data: { acao: 'veiculo_conferido', entidade: 'proposta', entidadeId: propostaId, usuarioId, depois: { ...ajuste, observacao: dto.observacao ?? null } as Prisma.InputJsonValue },
      });
      await this.notificacao.emitir({
        titulo: `Veículo confirmado — ${p.titular.nome}`,
        corpo: `${dto.observacao?.trim() || 'A análise confirmou o carro real.'} Siga para o resumo e a geração do contrato.`,
        rota: `/propostas/${propostaId}`,
        tipo: 'INFO',
        area: 'COMERCIAL',
      });
      return this.detalhe(propostaId);
    }

    // Devolver à fila. Se já estava conferido, os valores do carro real saem e
    // os da aprovação por referência voltam (a aprovação continua valendo).
    const jaConferido = !!p.veiculoConferidoEm;
    await this.prisma.db.$transaction(async (tx) => {
      await tx.ativo.updateMany({ where: { id: p.ativoId!, reservadoPropostaId: propostaId }, data: { status: 'DISPONIVEL', reservadoPropostaId: null, reservadoEm: null } });
      await tx.proposta.update({
        where: { id: propostaId },
        data: {
          ativoId: null, veiculoAtribuidoEm: null, veiculoConferidoEm: null, veiculoConferidoPorId: null, conferenciaVeiculo: Prisma.DbNull,
          ...(jaConferido
            ? {
                valorParcela: ajuste.parcelaAprovada !== undefined ? reais(ajuste.parcelaAprovada) : undefined,
                numeroParcelas: ajuste.numeroParcelasAprovado,
                prazoSemanas: ajuste.numeroParcelasAprovado,
                adicionalProtecao: ajuste.adicionalProtecaoAprovado !== undefined ? reais(ajuste.adicionalProtecaoAprovado) : undefined,
                foraParametro: ajuste.foraParametroAprovado,
              }
            : {}),
        },
      });
      if (jaConferido && p.simulacao && ajuste.valorFipeReferencia) {
        await tx.simulacao.update({ where: { id: p.simulacao.id }, data: { valorAvista: reais(ajuste.valorFipeReferencia), ativoId: null } });
      }
    });
    await this.prisma.db.logAuditoria.create({
      data: { acao: 'veiculo_devolvido', entidade: 'proposta', entidadeId: propostaId, usuarioId, depois: { ativoId: p.ativoId, observacao: dto.observacao ?? null, ajusteDescartado: ajuste } as Prisma.InputJsonValue },
    });
    await this.notificacao.emitir({
      titulo: `Veículo devolvido à fila — ${p.titular.nome}`,
      corpo: dto.observacao?.trim() || 'A análise devolveu o veículo; a proposta voltou à lista de espera.',
      rota: '/lista-espera',
      tipo: 'INFO',
      area: 'COMERCIAL',
    });
    return this.detalhe(propostaId);
  }

  // Reserva cai sozinha ao cancelar a proposta (§31.4 passo 5).
  private async liberarReserva(propostaId: string) {
    await this.prisma.db.ativo.updateMany({
      where: { reservadoPropostaId: propostaId, status: 'RESERVADO' },
      data: { status: 'DISPONIVEL', reservadoPropostaId: null, reservadoEm: null },
    });
  }


  private naoEncontrada() {
    return new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Proposta não encontrada' });
  }
}
