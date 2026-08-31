import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  reaisParaCentavos,
  centavosParaReaisString,
  renderTemplate,
  valorPorExtenso,
  numeroPorExtenso,
  dataPorExtenso,
  formatCurrency,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { ContratoService } from '../contrato/contrato.service';
import { AsaasService } from '../asaas/asaas.service';
import { PropostaService } from './proposta.service';
import { CatalogoFonteService } from '../catalogo/catalogo-fonte.service';
import { NotificacaoService } from '../notificacao/notificacao.service';

const cent = (d: Prisma.Decimal): number => reaisParaCentavos(d.toString());
const DIA_MS = 24 * 60 * 60 * 1000;

// Contrato PADRÃO de compra e venda de veículo (modelo oficial — layout fixo,
// dados por placeholder). Ver templates/contrato-veiculo.template.ts.
import { CONTRATO_VEICULO_TEMPLATE } from './templates/contrato-veiculo.template';
import { AssinaturaService } from '../assinatura/assinatura.service';

// Qualificação da parte no padrão do contrato oficial (campos ausentes são omitidos).
function qualificarParte(t: {
  nome: string;
  cpfCnpj: string;
  rg?: string | null;
  estadoCivil?: string | null;
  profissao?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  whatsapp?: string | null;
  email?: string | null;
}): string {
  let txt = [t.nome, 'brasileiro(a)', t.estadoCivil, t.profissao].filter(Boolean).join(', ');
  txt += `, portador(a) do CPF nº ${t.cpfCnpj}`;
  if (t.rg) txt += ` e RG nº ${t.rg}`;
  const endereco = [t.endereco, t.bairro, [t.cidade, t.estado].filter(Boolean).join(' - ')]
    .filter(Boolean)
    .join(', ');
  if (endereco) txt += `, residente e domiciliado(a) na ${endereco}`;
  if (t.cep) txt += `, CEP ${t.cep}`;
  if (t.whatsapp) txt += `, contato WhatsApp ${t.whatsapp}`;
  if (t.email) txt += `, e-mail ${t.email}`;
  return txt;
}

// Instrumento dos contratos APARTADOS (ex: proteção veicular / seguro). Jurídica e
// tributariamente independente do financiamento — NÃO há reserva de domínio.
const APARTADO_TEMPLATE = `INSTRUMENTO PARTICULAR DE CONTRATAÇÃO — {{produto}}

Contrato nº {{numero}}, firmado em {{dataAssinatura}}.

CONTRATANTE: {{cliente}}, CPF/CNPJ {{cpf}}.
CONTRATADA: Azit Move (na qualidade de {{credor}}).

OBJETO: {{produto}} — contrato apartado, vinculado à compra do veículo mas com
existência jurídica própria (independe do financiamento).

CONDIÇÕES:
- Valor total: {{valorTotal}} ({{valorTotalExtenso}}).
- Cobrança: {{numeroParcelas}} de {{valorParcela}}, periodicidade {{periodicidade}}.
- Primeira cobrança em {{dataPrimeiraParcela}}.

Este instrumento não transfere domínio de veículo e não se confunde com o contrato
de financiamento. Documento gerado automaticamente para assinatura digital.`;

// 7.10 Formalização + 7.11 Ativação. A proposta aprovada vira ContratoCredito em
// AGUARDANDO_ASSINATURA, com snapshot congelado e documento gerado por template.
// A ativação cria a cobrança da entrada (Asaas) e, no pagamento, ativa o contrato.
@Injectable()
export class FormalizacaoService {
  private readonly logger = new Logger(FormalizacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contrato: ContratoService,
    private readonly asaas: AsaasService,
    private readonly proposta: PropostaService,
    private readonly catalogoFonte: CatalogoFonteService,
    private readonly notificacao: NotificacaoService,
    private readonly assinatura: AssinaturaService,
  ) {}

  // 7.10 — congela snapshot, gera documento, cria o contrato.
  async formalizar(propostaId: string, parametros?: { dataPrimeiraParcela?: Date; dataPrevistaAtivacao?: Date }) {
    // Gate da Análise de Cadastro (Requisitos v0.2 RF-22): se a proposta tem análise,
    // só formaliza com status LIBERADO_PARA_FORMALIZACAO. Propostas sem análise seguem
    // o fluxo legado (parecer) — transição suave, sem propostas reais no banco.
    const analiseGate = await this.prisma.db.analiseCadastro.findUnique({
      where: { propostaId },
      select: { status: true },
    });
    if (analiseGate && analiseGate.status !== 'LIBERADO_PARA_FORMALIZACAO') {
      throw new UnprocessableEntityException({
        erro: 'analise_nao_liberada',
        mensagem: `Análise de cadastro em ${analiseGate.status} — libere a análise antes de formalizar`,
      });
    }
    // Gate de condição fora do parâmetro (decisão 03/08, opção b): proposta
    // marcada só formaliza com aprovação de alçada APROVADA no motor.
    const marcada = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      select: { foraParametro: true },
    });
    if (marcada?.foraParametro) {
      const aprovada = await this.prisma.db.aprovacao.findFirst({
        where: {
          tipoOperacao: 'condicao_fora_parametro',
          referenciaTipo: 'proposta',
          referenciaId: propostaId,
          status: 'APROVADA',
        },
      });
      if (!aprovada) {
        throw new UnprocessableEntityException({
          erro: 'fora_parametro_sem_aprovacao',
          mensagem:
            'Condição comercial fora do parâmetro — solicite a aprovação de alçada na proposta e aguarde a decisão antes de formalizar',
        });
      }
    }
    const proposta = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      include: {
        titular: true,
        ativo: true,
        parecer: true,
        vinculos: { include: { titular: true } }, // qualificação completa no contrato
        simulacao: { include: { ofertas: true } },
        itens: true,
      },
    });
    if (!proposta) throw this.naoEncontrada();
    if (!['APROVADA', 'EM_FORMALIZACAO'].includes(proposta.status)) {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: 'Só formaliza proposta Aprovada ou Em Formalização',
      });
    }
    if (proposta.contratoGeradoId) {
      throw new UnprocessableEntityException({ erro: 'ja_formalizada', mensagem: 'Proposta já gerou contrato' });
    }
    // Ressalva do parecer: exige garantidor → precisa do papel.
    if (proposta.parecer?.exigeGarantidor && !proposta.vinculos.some((v) => v.papel === 'GARANTIDOR')) {
      throw new UnprocessableEntityException({
        erro: 'garantidor_exigido',
        mensagem: 'O parecer exige garantidor; adicione o papel antes de formalizar',
      });
    }
    // Gate defensivo: documentos obrigatórios completos (Doc 2 §4-A.5).
    const pendencias = await this.proposta.pendenciasProposta(propostaId);
    if (pendencias.length) {
      throw new UnprocessableEntityException({
        erro: 'documentos_pendentes',
        mensagem: `Documentos obrigatórios pendentes: ${pendencias
          .map((p) => `${p.nome} (${p.faltando.join(', ')})`)
          .join('; ')}`,
      });
    }

    const conta = await this.prisma.db.conta.findFirst({ where: { titularId: proposta.titularId }, select: { id: true } });
    if (!conta) {
      throw new UnprocessableEntityException({ erro: 'sem_conta', mensagem: 'Titular sem conta — promova o lead antes' });
    }

    const valorEntrada = cent(proposta.valorEntrada);
    const valorParcela = cent(proposta.valorParcela);
    const valorTotal = valorEntrada + valorParcela * proposta.numeroParcelas;
    const dataAssinatura = new Date();
    // V3 (Doc 2 §4-A.3): a periodicidade do contrato vem da FREQUÊNCIA da oferta
    // escolhida (mensal/quinzenal/semanal); legado sem frequência segue semanal.
    const periodicidadeApi = (proposta.frequencia?.toLowerCase() ?? 'semanal') as
      | 'semanal'
      | 'quinzenal'
      | 'mensal';
    const passoDias = periodicidadeApi === 'mensal' ? 30 : periodicidadeApi === 'quinzenal' ? 14 : 7;
    // Parametrização do contrato (reunião 11/07): o operador define a data da
    // primeira parcela (ex.: "toda segunda"); sem escolha, cai no passo padrão.
    const dataPrimeira =
      parametros?.dataPrimeiraParcela && parametros.dataPrimeiraParcela > dataAssinatura
        ? parametros.dataPrimeiraParcela
        : new Date(dataAssinatura.getTime() + passoDias * DIA_MS);

    // Doc 02 §20 passo 12: DUAS datas do operador — previsão de ativação
    // (pagamento da entrada; vira o vencimento da cobrança) e 1º vencimento.
    // ⚠️ Limites PROVISÓRIOS (Regra 12) até as chaves entrarem nos parâmetros
    // do produto no Catálogo: ativação até 7 dias da assinatura; 1º vencimento
    // até 45 dias. Assinatura é imediata — não existe data de assinatura.
    const LIMITE_ATIVACAO_DIAS = 7;
    const LIMITE_PRIMEIRO_VENCIMENTO_DIAS = 45;
    const dataPrevistaAtivacao = parametros?.dataPrevistaAtivacao ?? null;
    if (dataPrevistaAtivacao) {
      const dias = Math.ceil((dataPrevistaAtivacao.getTime() - dataAssinatura.getTime()) / DIA_MS);
      if (dias < 0) {
        throw new UnprocessableEntityException({ erro: 'data_invalida', mensagem: 'A previsão de ativação não pode ser anterior à assinatura' });
      }
      if (dias > LIMITE_ATIVACAO_DIAS) {
        throw new UnprocessableEntityException({
          erro: 'data_fora_do_limite',
          mensagem: `A previsão de ativação deve ficar até ${LIMITE_ATIVACAO_DIAS} dias após a assinatura`,
        });
      }
    }
    {
      const diasPrimeira = Math.ceil((dataPrimeira.getTime() - dataAssinatura.getTime()) / DIA_MS);
      if (diasPrimeira > LIMITE_PRIMEIRO_VENCIMENTO_DIAS) {
        throw new UnprocessableEntityException({
          erro: 'data_fora_do_limite',
          mensagem: `O primeiro vencimento deve ficar até ${LIMITE_PRIMEIRO_VENCIMENTO_DIAS} dias após a assinatura`,
        });
      }
      if (dataPrevistaAtivacao && dataPrimeira <= dataPrevistaAtivacao) {
        throw new UnprocessableEntityException({
          erro: 'data_invalida',
          mensagem: 'O primeiro vencimento precisa ser depois da previsão de ativação (pagamento da entrada)',
        });
      }
    }

    // Carrinho: produtos apartados (seguro) viram contratos próprios; os demais
    // entram como itens recorrentes na cesta do contrato do veículo (§4.8).
    const apartados = proposta.itens.filter((i) => i.apartado);
    const naoApartados = proposta.itens.filter((i) => !i.apartado);
    const itensRecorrentes = naoApartados.map((i) => ({
      descricao: i.nome,
      credor: i.credor.toLowerCase() as 'azit' | 'investidor' | 'terceiro',
      valor: cent(i.valor),
      periodicidade: (i.periodicidade ? i.periodicidade.toLowerCase() : 'semanal') as 'semanal' | 'quinzenal' | 'mensal',
    }));

    // Contrato âncora (veículo) em AGUARDANDO_ASSINATURA SEM cronograma. O cronograma
    // nasce só no pagamento da entrada (ativação) — Decisão 2026-06-29.
    const novo = await this.contrato.criar(
      {
        contaId: conta.id,
        ativoId: proposta.ativoId,
        numero: undefined,
        dataAssinatura,
        dataPrimeiraParcela: dataPrimeira,
        valorTotal,
        valorEntrada,
        numeroParcelas: proposta.numeroParcelas,
        valorParcelaInicial: valorParcela,
        periodicidade: periodicidadeApi,
        entradaParcelada: proposta.simulacao?.ofertas.find((o) => o.selecionada)?.entradaParcelada ?? false,
        descricaoFinanciamento: `Financiamento ${proposta.ativo.descricao}`,
        credor: 'azit',
        itensRecorrentes,
      },
      'AGUARDANDO_ASSINATURA',
      false, // comCronograma = false → nasce na ativação
      { propostaPacoteId: propostaId },
    );

    // Contratos apartados (ex: seguro) — contrato próprio, mesmo ativo/conta,
    // cobrado por igual período (parcelado-shaped). Cronograma nasce na ativação.
    for (const ap of apartados) {
      const valorAp = cent(ap.valor);
      const totalAp = valorAp * proposta.numeroParcelas;
      const apContrato = await this.contrato.criar(
        {
          contaId: conta.id,
          ativoId: proposta.ativoId,
          numero: undefined,
          dataAssinatura,
          dataPrimeiraParcela: dataPrimeira,
          valorTotal: totalAp,
          valorEntrada: 0,
          numeroParcelas: proposta.numeroParcelas,
          valorParcelaInicial: valorAp,
          periodicidade: 'semanal',
          descricaoFinanciamento: ap.nome,
          credor: ap.credor.toLowerCase() as 'azit' | 'investidor' | 'terceiro',
        },
        'AGUARDANDO_ASSINATURA',
        false,
        { verificarEstoque: false, propostaPacoteId: propostaId },
      );

      // Instrumento próprio do contrato apartado (congelado no snapshot).
      const docAp = renderTemplate(APARTADO_TEMPLATE, {
        produto: ap.nome,
        numero: apContrato.numero,
        dataAssinatura: dataPorExtenso(dataAssinatura),
        cliente: proposta.titular.nome,
        cpf: proposta.titular.cpfCnpj,
        credor: ap.credor.toLowerCase(),
        valorTotal: formatCurrency(totalAp),
        valorTotalExtenso: valorPorExtenso(totalAp),
        numeroParcelas: proposta.numeroParcelas,
        valorParcela: formatCurrency(valorAp),
        periodicidade: 'semanal',
        dataPrimeiraParcela: dataPorExtenso(dataPrimeira),
      });
      const snapshotAp = {
        contrato: { numero: apContrato.numero, valorTotal: totalAp, valorEntrada: 0, numeroParcelas: proposta.numeroParcelas, valorParcela: valorAp },
        cliente: { nome: proposta.titular.nome, cpfCnpj: proposta.titular.cpfCnpj, whatsapp: proposta.titular.whatsapp },
        produto: { nome: ap.nome, apartado: true, credor: ap.credor.toLowerCase() },
        documento: docAp,
      };
      await this.prisma.db.contratoCredito.update({
        where: { id: apContrato.id },
        data: { snapshotJson: snapshotAp as unknown as Prisma.InputJsonValue, snapshotLockedAt: new Date() },
      });
    }

    // Papéis migram da proposta para o contrato (Doc 2 §4-A.7).
    for (const v of proposta.vinculos) {
      await this.prisma.db.vinculoPapel.create({
        data: { contratoCreditoId: novo.id, titularId: v.titularId, papel: v.papel },
      });
    }

    // Snapshot congelado + documento gerado (contrato oficial — dados × layout).
    const taxas = await this.prisma.db.contratoCredito.findFirst({
      where: { id: novo.id },
      select: { taxaMultaAtraso: true, taxaJurosAtraso: true },
    });
    const secundarios = proposta.vinculos.filter((v) => v.papel === 'COMPRADOR_SECUNDARIO');
    const garantidores = proposta.vinculos.filter((v) => v.papel === 'GARANTIDOR');
    const letras = ['A', 'B', 'C', 'D'];
    const compradoresBloco = [proposta.titular, ...secundarios.map((v) => v.titular)]
      .map((t, i) => `${letras[i] ?? '•'}) ${qualificarParte(t)}, doravante denominado simplesmente "COMPRADOR".`)
      .join('\n\n');
    const garantidorBloco = garantidores.length
      ? `\nGARANTIDOR (DEVEDOR SOLIDÁRIO):\n${garantidores
          .map((v) => `${qualificarParte(v.titular)}, que assume, em caráter solidário, todas as obrigações do COMPRADOR previstas neste contrato.`)
          .join('\n\n')}\n`
      : '';
    const valorSaldo = valorTotal - valorEntrada;
    const vencimentoPorFreq: Record<string, string> = {
      semanal: 'no mesmo dia das semanas subsequentes',
      quinzenal: 'a cada 15 (quinze) dias, mantendo o mesmo dia da semana',
      mensal: 'no mesmo dia dos meses subsequentes',
    };
    const pluralPorFreq: Record<string, string> = {
      semanal: 'semanais',
      quinzenal: 'quinzenais',
      mensal: 'mensais',
    };
    const assinaturasAdicionais = [...secundarios, ...garantidores]
      .map((v) => `\n\n___________________________________________\n${v.titular.nome}\nCPF: ${v.titular.cpfCnpj} (${v.papel === 'GARANTIDOR' ? 'Garantidor' : 'Comprador solidário'})`)
      .join('');
    // Testemunhas padrão (doc 02 §21 F1.1): as mesmas pessoas configuradas
    // saem impressas aqui e entram como signatárias na ZapSign.
    const paramsAssinatura = await this.assinatura.obterParametros();
    const linhaTestemunha = (nome: string, cpf: string) =>
      nome ? `${nome}\nCPF: ${cpf || '—'}` : 'Nome:\nCPF:';

    const documento = renderTemplate(CONTRATO_VEICULO_TEMPLATE, {
      numero: novo.numero,
      compradoresBloco,
      garantidorBloco,
      veiculoDescricao: proposta.ativo.descricao,
      veiculoAnoFabricacao: proposta.ativo.anoFabricacao ?? '—',
      veiculoAnoModelo: proposta.ativo.anoModelo ?? '—',
      veiculoCor: proposta.ativo.cor ?? '—',
      veiculoPlaca: proposta.ativo.placa ?? '—',
      veiculoChassi: proposta.ativo.chassi ?? '—',
      veiculoRenavam: proposta.ativo.renavam ?? '—',
      veiculoOrigem: proposta.ativo.origem
        ? proposta.ativo.origem.charAt(0) + proposta.ativo.origem.slice(1).toLowerCase()
        : '—',
      veiculoCombustivel: proposta.ativo.combustivel?.toLowerCase() ?? '—',
      veiculoKm: proposta.ativo.quilometragemEntrada ?? '—',
      valorTotal: formatCurrency(valorTotal),
      valorTotalExtenso: valorPorExtenso(valorTotal),
      valorEntrada: formatCurrency(valorEntrada),
      valorEntradaExtenso: valorPorExtenso(valorEntrada),
      valorSaldo: formatCurrency(valorSaldo),
      valorSaldoExtenso: valorPorExtenso(valorSaldo),
      numeroParcelas: proposta.numeroParcelas,
      numeroParcelasExtenso: numeroPorExtenso(proposta.numeroParcelas),
      periodicidadePlural: pluralPorFreq[periodicidadeApi] ?? 'semanais',
      valorParcela: formatCurrency(valorParcela),
      valorParcelaExtenso: valorPorExtenso(valorParcela),
      dataPrimeiraParcela: dataPrimeira.toLocaleDateString('pt-BR'),
      vencimentoSubsequente: vencimentoPorFreq[periodicidadeApi] ?? vencimentoPorFreq.semanal,
      taxaMulta: taxas ? Number(taxas.taxaMultaAtraso.toString()) : 2,
      taxaJuros: taxas ? Number(taxas.taxaJurosAtraso.toString()) : 1,
      dataAssinaturaLinha: `VITORIA/ES, ${dataPorExtenso(dataAssinatura)}.`,
      compradorAssinatura: `${proposta.titular.nome}\nCPF: ${proposta.titular.cpfCnpj}`,
      assinaturasAdicionais,
      testemunha1Linha: linhaTestemunha(paramsAssinatura.testemunha1Nome, paramsAssinatura.testemunha1Cpf),
      testemunha2Linha: linhaTestemunha(paramsAssinatura.testemunha2Nome, paramsAssinatura.testemunha2Cpf),
    });
    const snapshot = {
      contrato: { numero: novo.numero, valorTotal, valorEntrada, numeroParcelas: proposta.numeroParcelas, valorParcela },
      // Doc 02 §20 passo 8: plano de proteção escolhido no upsell (Essencial é
      // o embutido; o adicional já está DENTRO da parcela acima).
      protecao: { plano: proposta.planoProtecao, adicionalPorPeriodo: cent(proposta.adicionalProtecao) },
      cliente: { nome: proposta.titular.nome, cpfCnpj: proposta.titular.cpfCnpj, whatsapp: proposta.titular.whatsapp },
      ativo: { descricao: proposta.ativo.descricao, chassi: proposta.ativo.chassi, placa: proposta.ativo.placa },
      papeis: proposta.vinculos.map((v) => ({ papel: v.papel.toLowerCase(), nome: v.titular.nome, cpfCnpj: v.titular.cpfCnpj })),
      documento,
    };

    // F4: congela a referência da versão do Catálogo usada na contratação —
    // a quitação por componente lê ESTE snapshot, nunca a versão vigente.
    // Homologação 04/08: congela também protS (proteção semanal exata calculada
    // do produto PV na contratação) — o valor da proteção não flutua depois.
    const varianteContratada = proposta.ativo.varianteCatalogo ?? 'carro';
    const catContratacao = await this.catalogoFonte.compraParcelada(varianteContratada);
    let protS: number | null = null;
    if (catContratacao?.protecaoObrigatoria) {
      const baseAvista = proposta.simulacao?.valorAvista ? cent(proposta.simulacao.valorAvista) : 0;
      protS =
        (await this.catalogoFonte.protecaoEssencialSemanalExata(varianteContratada, baseAvista)) ??
        catContratacao.protecaoSemanalExata;
    }
    await this.prisma.db.contratoCredito.update({
      where: { id: novo.id },
      data: {
        snapshotJson: snapshot as unknown as Prisma.InputJsonValue,
        snapshotLockedAt: new Date(),
        dataPrevistaAtivacao,
        catalogoVersaoRef: catContratacao
          ? JSON.stringify({
              variante: varianteContratada,
              vp: catContratacao.versaoProduto,
              vv: catContratacao.versaoVariante,
              ...(protS !== null ? { protS } : {}),
            })
          : null,
      },
    });
    await this.prisma.db.proposta.update({
      where: { id: propostaId },
      data: { status: 'CONVERTIDA', contratoGeradoId: novo.id },
    });

    this.logger.log(`Proposta ${propostaId} formalizada → contrato ${novo.numero} (aguardando assinatura)`);
    return { contratoId: novo.id, numero: novo.numero, status: 'aguardando_assinatura', documento, snapshot };
  }

  // Status do contrato + assinaturas (para a tela de conclusão da proposta).
  async statusContrato(contratoId: string) {
    const c = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, numero: true, status: true, valorEntrada: true, entradaParcelada: true, assinaturaTitularEm: true, assinaturaAzitEm: true, cronogramaGeradoEm: true },
    });
    if (!c) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    const entrada = cent(c.valorEntrada);
    return {
      id: c.id,
      numero: c.numero,
      status: c.status.toLowerCase(),
      entrada,
      entradaAVista: c.entradaParcelada ? Math.round(entrada * 0.6) : entrada,
      entradaParcelada: c.entradaParcelada,
      assinadoTitular: !!c.assinaturaTitularEm,
      assinadoAzit: !!c.assinaturaAzitEm,
      ambasAssinaturas: !!c.assinaturaTitularEm && !!c.assinaturaAzitEm,
      cronogramaGerado: !!c.cronogramaGeradoEm,
    };
  }

  // Status do PACOTE de contratos de uma proposta (veículo + apartados) para a
  // tela de conclusão: assina cada contrato; cobra a entrada quando todos assinados.
  async statusPacote(propostaId: string) {
    const contratos = await this.prisma.db.contratoCredito.findMany({
      where: { propostaPacoteId: propostaId },
      select: {
        id: true, numero: true, status: true, valorEntrada: true, entradaParcelada: true,
        assinaturaTitularEm: true, assinaturaAzitEm: true, cronogramaGeradoEm: true,
        itensContratados: { where: { natureza: 'PARCELADO' }, select: { descricao: true }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });
    const lista = contratos.map((c) => {
      const entrada = cent(c.valorEntrada);
      return {
        id: c.id,
        numero: c.numero,
        descricao: c.itensContratados[0]?.descricao ?? c.numero,
        status: c.status.toLowerCase(),
        entrada,
        entradaAVista: c.entradaParcelada ? Math.round(entrada * 0.6) : entrada,
        entradaParcelada: c.entradaParcelada,
        ancora: entrada > 0,
        assinadoTitular: !!c.assinaturaTitularEm,
        assinadoAzit: !!c.assinaturaAzitEm,
        ambasAssinaturas: !!c.assinaturaTitularEm && !!c.assinaturaAzitEm,
        cronogramaGerado: !!c.cronogramaGeradoEm,
      };
    });
    const ancora = lista.find((c) => c.ancora) ?? lista[0] ?? null;
    return {
      propostaId,
      ancoraId: ancora?.id ?? null,
      entrada: ancora?.entrada ?? 0,
      entradaAVista: ancora?.entradaAVista ?? 0,
      entradaParcelada: ancora?.entradaParcelada ?? false,
      contratos: lista,
      todasAssinaturas: lista.length > 0 && lista.every((c) => c.ambasAssinaturas),
      cronogramaGerado: lista.length > 0 && lista.every((c) => c.cronogramaGerado),
    };
  }

  // Assinatura mock removida em 18/08 (doc 02 §21): a assinatura é exclusivamente
  // digital via ZapSign; a do contrato ÂNCORA vale para o pacote até a F2.

  // 7.11 — Ativação: cria a cobrança da entrada (Asaas) e marca aguardando pagamento.
  // Exige as duas assinaturas (titular + Azit).
  async ativar(contratoId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      include: { conta: { include: { titular: { select: { id: true, nome: true, cpfCnpj: true, email: true, whatsapp: true, asaasCustomerId: true } } } } },
    });
    if (!contrato) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    // Pacote: todos os contratos da proposta (veículo + apartados) precisam estar
    // assinados pelo titular e pela Azit antes de cobrar a entrada.
    if (contrato.propostaPacoteId) {
      const pendente = await this.prisma.db.contratoCredito.findFirst({
        where: {
          propostaPacoteId: contrato.propostaPacoteId,
          OR: [{ assinaturaTitularEm: null }, { assinaturaAzitEm: null }],
        },
        select: { numero: true },
      });
      if (pendente) {
        throw new UnprocessableEntityException({
          erro: 'assinatura_pendente',
          mensagem: 'Todos os contratos do pacote precisam estar assinados (titular + Azit) antes de cobrar a entrada',
        });
      }
    } else if (!contrato.assinaturaTitularEm || !contrato.assinaturaAzitEm) {
      throw new UnprocessableEntityException({
        erro: 'assinatura_pendente',
        mensagem: 'O contrato precisa estar assinado pelo titular e pela Azit antes de cobrar a entrada',
      });
    }
    if (!['AGUARDANDO_ASSINATURA', 'AGUARDANDO_PAGAMENTO_INICIAL'].includes(contrato.status)) {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: 'Contrato não está aguardando assinatura/pagamento inicial',
      });
    }
    // Gate do dia zero (doc 02 §4-A.3, 2026-08-16): sem origem de capital no ativo,
    // o cronograma não nasce — melhor barrar AQUI, antes de existir dinheiro pago,
    // do que falhar mudo na fila (caso real do contrato 2026080001).
    const temOrigem = await this.prisma.db.origemCapital.count({ where: { ativoId: contrato.ativoId } });
    if (!temOrigem) {
      throw new UnprocessableEntityException({
        erro: 'origem_capital_ausente',
        mensagem: 'O ativo deste contrato não tem Origem de Capital — cadastre no Estoque de Ativos antes de gerar a cobrança da entrada (necessária para gerar os recebíveis no dia zero)',
      });
    }

    // Contrato SEM entrada (doc 02 §4-A.3, 2026-08-16): upgrade de veículo e
    // Reembolso Parcelado podem nascer sem entrada — nada a cobrar (o Asaas
    // recusa cobrança de valor zero); dia zero imediato, assinaturas já validadas.
    if (cent(contrato.valorEntrada) === 0) {
      const r = await this.ativarPacotePorPagamento(contrato.id);
      return {
        contratoId: contrato.id,
        numero: contrato.numero,
        status: 'ativo',
        entrada: 0,
        entradaAVista: 0,
        entradaParcelada: false,
        cobranca: null,
        contratosAtivados: r.contratosAtivados,
      };
    }

    // Garante o cliente no Asaas antes da 1ª cobrança (pré-requisito do gateway real).
    const customerId = await this.garantirCliente(contrato.conta.titular);

    // Entrada parcelada: cobra só os 60% à vista agora; os 40% diluídos já estão
    // nas faturas seguintes como intermediárias (Doc 2 §4-A.3).
    const valorEntrada = cent(contrato.valorEntrada);
    const valorAVista = contrato.entradaParcelada ? Math.round(valorEntrada * 0.6) : valorEntrada;
    // Doc 02 §20 passo 12: a entrada vence na data PREVISTA DE ATIVAÇÃO
    // combinada com o cliente; sem data combinada, cai no padrão de 3 dias.
    const vencimentoEntrada =
      contrato.dataPrevistaAtivacao && contrato.dataPrevistaAtivacao.getTime() > Date.now() - DIA_MS
        ? contrato.dataPrevistaAtivacao
        : new Date(Date.now() + 3 * DIA_MS);
    const cobranca = await this.asaas.criarCobranca({
      externalReference: `ativacao:${contrato.id}`,
      valor: valorAVista,
      vencimento: vencimentoEntrada,
      descricao: `Entrada do contrato ${contrato.numero}${contrato.entradaParcelada ? ' (à vista 60%)' : ''}`,
      customerId,
      multaPct: Number(contrato.taxaMultaAtraso.toString()),
      jurosPct: Number(contrato.taxaJurosAtraso.toString()),
    });
    await this.prisma.db.contratoCredito.update({
      where: { id: contrato.id },
      // Guarda o id da cobrança: a materialização da entrada no dia zero amarra a
      // fatura interna a esta cobrança do Asaas (doc 02 §4-A.3, 2026-08-16).
      data: { status: 'AGUARDANDO_PAGAMENTO_INICIAL', entradaCobrancaAsaasId: cobranca.id },
    });
    await this.notificacao.emitir(
      `Cobrança da entrada gerada — contrato ${contrato.numero}`,
      `R$ ${centavosParaReaisString(valorAVista)} com vencimento em ${vencimentoEntrada.toLocaleDateString('pt-BR')}. O pagamento ativa o contrato automaticamente.`,
      `/contratos/${contrato.id}`,
    );
    return {
      contratoId: contrato.id,
      numero: contrato.numero,
      status: 'aguardando_pagamento_inicial',
      entrada: valorEntrada,
      entradaAVista: valorAVista,
      entradaParcelada: contrato.entradaParcelada,
      cobranca: { id: cobranca.id, valor: cobranca.value, simulada: cobranca.simulada },
    };
  }

  // Garante o cadastro do cliente no Asaas (idempotente): reaproveita o id salvo
  // ou cria e persiste. Em modo simulado o AsaasService devolve um id determinístico.
  private async garantirCliente(titular: {
    id: string; nome: string; cpfCnpj: string; email: string | null; whatsapp: string; asaasCustomerId: string | null;
  }): Promise<string> {
    if (titular.asaasCustomerId) return titular.asaasCustomerId;
    const customerId = await this.asaas.criarCliente({
      titularId: titular.id, nome: titular.nome, cpfCnpj: titular.cpfCnpj, email: titular.email, telefone: titular.whatsapp,
    });
    await this.prisma.db.titular.update({ where: { id: titular.id }, data: { asaasCustomerId: customerId } });
    return customerId;
  }

  // "Dia zero": o pagamento da entrada gera o cronograma e ativa o contrato âncora
  // e TODOS os contratos do pacote (apartados — ex: seguro). Chamado tanto pelo
  // webhook PAYMENT_RECEIVED (ref ativacao:) quanto pelo simulador dev.
  async ativarPacotePorPagamento(contratoId: string, paymentDate?: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: {
        id: true, numero: true, propostaPacoteId: true, contaId: true,
        valorEntrada: true, entradaParcelada: true, entradaPagaEm: true, entradaCobrancaAsaasId: true,
      },
    });
    if (!contrato) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    const pacote = contrato.propostaPacoteId
      ? await this.prisma.db.contratoCredito.findMany({
          where: { propostaPacoteId: contrato.propostaPacoteId },
          select: { id: true, numero: true },
        })
      : [{ id: contrato.id, numero: contrato.numero }];
    for (const c of pacote) {
      await this.contrato.ativarComCronograma(c.id);
    }
    await this.materializarEntradaPaga(contrato, paymentDate);
    const semEntrada = cent(contrato.valorEntrada) === 0;
    await this.notificacao.emitir(
      semEntrada ? `Contrato ${contrato.numero} ativado (sem entrada)` : `Entrada paga — contrato ${contrato.numero} ativado`,
      `Cronograma gerado e ${pacote.length > 1 ? `${pacote.length} contratos do pacote ativados` : 'contrato ativado'} automaticamente (dia zero).`,
      `/contratos/${contrato.id}`,
    );
    this.logger.log(`Pacote ativado (${pacote.length} contrato(s)): entrada paga → cronogramas gerados.`);
    return { contratoId: contrato.id, numero: contrato.numero, status: 'ativo', cronogramaGerado: true, contratosAtivados: pacote.length };
  }

  // Materialização da entrada paga (doc 02 §4-A.3, revisão 2026-08-30): o
  // dinheiro que entrou no Asaas vira LANÇAMENTO da conta (não fatura sintética
  // — solução rejeitada em homologação). Idempotente: sem entrada ou já
  // materializada, não faz nada.
  private async materializarEntradaPaga(
    contrato: {
      id: string; numero: string; contaId: string;
      valorEntrada: Prisma.Decimal; entradaParcelada: boolean;
      entradaPagaEm: Date | null; entradaCobrancaAsaasId: string | null;
    },
    paymentDate?: string,
  ) {
    const valorEntrada = cent(contrato.valorEntrada);
    if (valorEntrada <= 0 || contrato.entradaPagaEm) return;
    // Entrada parcelada: só os 60% à vista entram aqui — os 40% já são
    // intermediárias nas faturas do cronograma (§4-A.3).
    const valorAVista = contrato.entradaParcelada ? Math.round(valorEntrada * 0.6) : valorEntrada;
    const dataPagamento = paymentDate ? new Date(`${paymentDate}T12:00:00-03:00`) : new Date();

    await this.prisma.db.$transaction(async (tx) => {
      await tx.lancamentoConta.create({
        data: {
          contaId: contrato.contaId,
          contratoId: contrato.id,
          tipo: 'ENTRADA_CONTRATO',
          descricao: `Entrada do contrato ${contrato.numero}${contrato.entradaParcelada ? ' (à vista 60%)' : ''}`,
          valor: centavosParaReaisString(valorAVista),
          dataPagamento,
          asaasChargeId: contrato.entradaCobrancaAsaasId,
        },
      });
      await tx.contratoCredito.update({
        where: { id: contrato.id },
        data: { entradaPagaEm: dataPagamento, valorEntradaPago: centavosParaReaisString(valorAVista) },
      });
    });
  }

  // Dev: simula o pagamento da entrada (faz o papel do webhook PAYMENT_RECEIVED).
  async simularPagamentoAtivacao(contratoId: string) {
    return this.ativarPacotePorPagamento(contratoId);
  }

  private naoEncontrada() {
    return new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Proposta não encontrada' });
  }
}
