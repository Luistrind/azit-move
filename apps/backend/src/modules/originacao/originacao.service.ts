import {
  Injectable,
  Logger,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  TipoPessoa,
  OrigemAtivo,
  TipoCombustivel,
} from '@prisma/client';
import { limparDocumento, centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { ContratoService } from '../contrato/contrato.service';
import { OriginarDto } from './dto/originar.dto';

// 7.2/7.3 — Originação real (PopHub -> Azit). Identifica/cria titular, conta e
// ativo, concilia a entrada e gera o contrato completo reusando ContratoService.
@Injectable()
export class OriginacaoService {
  private readonly logger = new Logger(OriginacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contrato: ContratoService,
  ) {}

  async originar(p: OriginarDto) {
    // 1. Idempotência por numero_origem (usado como numero do contrato).
    const dup = await this.prisma.db.contratoCredito.findFirst({
      where: { numero: p.contrato.numero_origem },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException({
        erro: 'contrato_duplicado',
        mensagem: 'numero_origem já existe no sistema',
      });
    }

    // 2. Titular: identifica pelo CPF/CNPJ ou cria.
    const cpfCnpj = limparDocumento(p.cliente.cpf_cnpj);
    let titular = await this.prisma.db.titular.findFirst({ where: { cpfCnpj } });
    if (!titular) {
      titular = await this.prisma.db.titular.create({
        data: {
          nome: p.cliente.nome,
          tipoPessoa: p.cliente.tipo_pessoa.toUpperCase() as TipoPessoa,
          cpfCnpj,
          rg: p.cliente.rg,
          estadoCivil: p.cliente.estado_civil,
          profissao: p.cliente.profissao,
          whatsapp: p.cliente.whatsapp,
          email: p.cliente.email,
          endereco: [p.cliente.endereco, p.cliente.numero].filter(Boolean).join(', ') || undefined,
          bairro: p.cliente.bairro,
          cidade: p.cliente.cidade,
          estado: p.cliente.estado,
          cep: p.cliente.cep,
          asaasCustomerId: p.cliente.asaas_customer_id,
        },
      });
    }

    // 3. Conta 1:1.
    let conta = await this.prisma.db.conta.findFirst({ where: { titularId: titular.id } });
    if (!conta) {
      conta = await this.prisma.db.conta.create({ data: { titularId: titular.id } });
    }

    // 4. Ativo: identifica pelo chassi ou cria a partir do payload.
    let ativo = await this.prisma.db.ativo.findFirst({ where: { chassi: p.ativo.chassi } });
    if (!ativo) {
      ativo = await this.prisma.db.ativo.create({
        data: {
          tipo: 'VEICULO',
          descricao: [p.ativo.marca, p.ativo.modelo, p.ativo.ano_modelo].filter(Boolean).join(' ') || 'Veículo',
          marca: p.ativo.marca,
          modelo: p.ativo.modelo,
          anoFabricacao: p.ativo.ano_fabricacao,
          anoModelo: p.ativo.ano_modelo,
          cor: p.ativo.cor,
          placa: p.ativo.placa,
          chassi: p.ativo.chassi,
          renavam: p.ativo.renavam,
          origem: p.ativo.origem ? (p.ativo.origem.toUpperCase() as OrigemAtivo) : undefined,
          combustivel: p.ativo.combustivel
            ? (p.ativo.combustivel.toUpperCase() as TipoCombustivel)
            : undefined,
          quilometragemEntrada: p.ativo.quilometragem_entrada,
          valorAquisicao:
            p.ativo.valor_aquisicao !== undefined
              ? centavosParaReaisString(p.ativo.valor_aquisicao)
              : undefined,
        },
      });
    }

    // 5. OrigemCapital: garante uma para os recebíveis (default capital próprio).
    const origem = await this.prisma.db.origemCapital.findFirst({
      where: { ativoId: ativo.id },
      select: { id: true },
    });
    if (!origem) {
      await this.prisma.db.origemCapital.create({
        data: {
          ativoId: ativo.id,
          tipo: 'CAPITAL_PROPRIO',
          valorAportado: centavosParaReaisString(p.ativo.valor_aquisicao ?? 0),
          dataAporte: p.contrato.data_assinatura,
        },
      });
    }

    // 6. Termos do financiamento (item parcelado âncora).
    const parcelamento = p.itens_contratados.find((i) => i.natureza === 'parcelado');
    if (!parcelamento?.numero_parcelas || parcelamento.valor_parcela === undefined) {
      throw new UnprocessableEntityException({
        erro: 'titular_dados_insuficientes',
        mensagem: 'É necessário um item parcelado com valor_parcela e numero_parcelas',
      });
    }
    const saldoDevedor = parcelamento.valor_total ?? parcelamento.valor_parcela * parcelamento.numero_parcelas;
    const valorEntrada = p.entrada?.valor ?? 0;

    const recorrentes = p.itens_contratados
      .filter((i) => i.natureza === 'recorrente')
      .map((i) => ({
        descricao: i.tipo_produto ?? 'Item recorrente',
        credor: i.credor,
        credorId: i.credor_id,
        valor: i.valor ?? 0,
      }));

    // 7. Gera o contrato completo (cronograma + recebíveis + faturas) — núcleo reusado.
    const criado = await this.contrato.criar({
      contaId: conta.id,
      ativoId: ativo.id,
      numero: p.contrato.numero_origem,
      dataAssinatura: p.contrato.data_assinatura,
      dataPrimeiraParcela: p.contrato.data_primeira_parcela,
      valorTotal: saldoDevedor + valorEntrada,
      valorEntrada,
      numeroParcelas: parcelamento.numero_parcelas,
      valorParcelaInicial: parcelamento.valor_parcela,
      periodicidade: p.contrato.periodicidade,
      indiceReajuste: p.contrato.indice_reajuste,
      descricaoFinanciamento: 'Parcelamento do veículo',
      credor: parcelamento.credor,
      credorId: parcelamento.credor_id,
      taxaMultaAtraso: p.contrato.taxa_multa_atraso,
      taxaJurosAtraso: p.contrato.taxa_juros_atraso_mensal,
      taxaDescontoQuitacao: p.contrato.taxa_desconto_quitacao_diaria,
      itensRecorrentes: recorrentes.length ? recorrentes : undefined,
    });

    // 8. Conciliação da entrada (já paga no Asaas): registrada no contrato; o
    // asaas_payment_id é informativo na originação.
    if (p.entrada?.asaas_payment_id) {
      this.logger.log(
        `Entrada conciliada p/ ${criado.numero}: ${p.entrada.asaas_payment_id} (${valorEntrada}c)`,
      );
    }

    return {
      contrato_credito_id: criado.id,
      numero: criado.numero,
      titular_id: titular.id,
      conta_id: conta.id,
      ativo_id: ativo.id,
      status: criado.status,
      total_parcelas_geradas: criado.totalParcelasGeradas,
      total_faturas_geradas: criado.totalParcelasGeradas,
    };
  }
}
