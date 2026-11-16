import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ParametrosFaturamento, ParametrosFaturamentoResposta, VersaoParametrosFaturamento } from '@azit/types';
import { cascataValida, CASCATA_PADRAO, PARAMETROS_MOTOR_PADRAO, type GrupoCascata, type ParametrosMotorFatura } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { GATEWAY_PIX, type GatewayPix } from './gateway-pix';

const cent = (d: Prisma.Decimal): number => Math.round(Number(d.toString()) * 100);
const num = (d: Prisma.Decimal): number => Number(d.toString());

// Padrões provisórios (Regra 12) enquanto ninguém salvou nada — doc 02 §32.8.
// A chave do Pix sob demanda nasce DESLIGADA: nada muda até o Luís ligar.
export const PARAMETROS_FATURAMENTO_PADRAO: ParametrosFaturamento = {
  versao: 0,
  pixSobDemanda: false,
  // QR estático com valor é o padrão (decisão Luís 15/11, §32.4-A).
  modoPix: 'ESTATICO' as ParametrosFaturamento['modoPix'],
  multaPadraoPct: 2,
  atualizacaoMesPadraoPct: 1,
  cascata: [...CASCATA_PADRAO],
  minimoParcialPct: PARAMETROS_MOTOR_PADRAO.minimoParcialPct,
  minimoParcialPiso: PARAMETROS_MOTOR_PADRAO.minimoParcialPiso,
  tetoIntencoesDia: 10,
};

export interface SalvarParametrosFaturamentoDto {
  pixSobDemanda?: boolean;
  modoPix?: 'ESTATICO' | 'COBRANCA';
  multaPadraoPct?: number;
  atualizacaoMesPadraoPct?: number;
  cascata?: string[];
  minimoParcialPct?: number;
  minimoParcialPiso?: number; // centavos
  tetoIntencoesDia?: number;
  motivo?: string | null;
}

type Linha = Prisma.ParametroFaturamentoGetPayload<{ include: { criadoPor: { select: { nome: true } } } }>;
type LinhaBase = Omit<Linha, 'criadoPor'> & { criadoPor?: { nome: string } | null };

function mapear(l: LinhaBase): VersaoParametrosFaturamento {
  return {
    versao: l.versao,
    pixSobDemanda: l.pixSobDemanda,
    modoPix: l.modoPix as ParametrosFaturamento['modoPix'],
    multaPadraoPct: num(l.multaPadraoPct),
    atualizacaoMesPadraoPct: num(l.atualizacaoMesPadraoPct),
    // Cascata gravada inválida (não deveria existir) cai no padrão — nunca trava a baixa.
    cascata: (cascataValida(l.cascata) ? l.cascata : [...CASCATA_PADRAO]),
    minimoParcialPct: num(l.minimoParcialPct),
    minimoParcialPiso: cent(l.minimoParcialPiso),
    tetoIntencoesDia: l.tetoIntencoesDia,
    motivo: l.motivo,
    criadoPor: l.criadoPor?.nome ?? null,
    criadoEm: l.createdAt.toISOString(),
  };
}

// Leitura ÚNICA da versão vigente (a de maior número; sem linha, os padrões).
// Função solta para quem está dentro de uma transação e não injeta o serviço
// (ex.: criação de contrato lendo FAT001/FAT002).
export async function parametrosFaturamentoVigentes(db: {
  parametroFaturamento: { findFirst: (args: { orderBy: { versao: 'desc' } }) => Promise<LinhaBase | null> };
}): Promise<ParametrosFaturamento> {
  const l = await db.parametroFaturamento.findFirst({ orderBy: { versao: 'desc' } });
  if (!l) return { ...PARAMETROS_FATURAMENTO_PADRAO };
  const { motivo: _m, criadoPor: _c, criadoEm: _e, ...parametros } = mapear(l);
  return parametros;
}

// Parâmetros de faturamento (doc 02 §32.8), VERSIONADOS: salvar cria uma versão
// nova e a de maior número é a vigente. Fonte única para a emissão (chave do
// Pix sob demanda), o motor (cascata, mínimo do parcial) e a intenção (teto).
@Injectable()
export class ParametrosFaturamentoService {
  constructor(
    private readonly prisma: PrismaService,
    // Só para a tela dizer qual chave Pix recebe o QR estático (ou por que não há).
    @Inject(GATEWAY_PIX) private readonly gateway: GatewayPix,
  ) {}

  vigente(): Promise<ParametrosFaturamento> {
    return parametrosFaturamentoVigentes(this.prisma.db);
  }

  // Recorte que o motor de `@azit/utils` consome.
  async doMotor(): Promise<ParametrosMotorFatura & { multaPadraoPct: number; atualizacaoMesPadraoPct: number }> {
    const p = await this.vigente();
    return {
      cascata: p.cascata as GrupoCascata[],
      minimoParcialPct: p.minimoParcialPct,
      minimoParcialPiso: p.minimoParcialPiso,
      multaPadraoPct: p.multaPadraoPct,
      atualizacaoMesPadraoPct: p.atualizacaoMesPadraoPct,
    };
  }

  async pixSobDemandaLigado(): Promise<boolean> {
    return (await this.vigente()).pixSobDemanda;
  }

  async tela(): Promise<ParametrosFaturamentoResposta> {
    const [linhas, azit, asaasNativo, recebimentoPix] = await Promise.all([
      this.prisma.db.parametroFaturamento.findMany({ orderBy: { versao: 'desc' }, take: 30, include: { criadoPor: { select: { nome: true } } } }),
      this.prisma.db.fatura.count({ where: { status: 'FECHADA', modeloEncargo: 'AZIT' } }),
      this.prisma.db.fatura.count({ where: { status: 'FECHADA', modeloEncargo: 'ASAAS_NATIVO' } }),
      this.gateway.chaveRecebimento(),
    ]);
    return { vigente: await this.vigente(), faturasEmAberto: { azit, asaasNativo }, recebimentoPix, historico: linhas.map(mapear) };
  }

  async salvar(dto: SalvarParametrosFaturamentoDto, usuarioId: string): Promise<ParametrosFaturamentoResposta> {
    const atual = await this.vigente();
    const novo: ParametrosFaturamento = {
      versao: atual.versao + 1,
      pixSobDemanda: dto.pixSobDemanda ?? atual.pixSobDemanda,
      modoPix: (dto.modoPix ?? atual.modoPix) as ParametrosFaturamento['modoPix'],
      multaPadraoPct: dto.multaPadraoPct ?? atual.multaPadraoPct,
      atualizacaoMesPadraoPct: dto.atualizacaoMesPadraoPct ?? atual.atualizacaoMesPadraoPct,
      cascata: (dto.cascata ?? atual.cascata) as GrupoCascata[], // validada logo abaixo (cascataValida)
      minimoParcialPct: dto.minimoParcialPct ?? atual.minimoParcialPct,
      minimoParcialPiso: dto.minimoParcialPiso ?? atual.minimoParcialPiso,
      tetoIntencoesDia: dto.tetoIntencoesDia ?? atual.tetoIntencoesDia,
    };
    const campos: { campo: string; mensagem: string }[] = [];
    if (!cascataValida(novo.cascata)) campos.push({ campo: 'cascata', mensagem: 'A cascata precisa ter os quatro grupos, cada um uma vez' });
    if (!(novo.multaPadraoPct >= 0 && novo.multaPadraoPct <= 100)) campos.push({ campo: 'multaPadraoPct', mensagem: 'Informe um percentual entre 0 e 100' });
    if (!(novo.atualizacaoMesPadraoPct >= 0 && novo.atualizacaoMesPadraoPct <= 100)) campos.push({ campo: 'atualizacaoMesPadraoPct', mensagem: 'Informe um percentual entre 0 e 100' });
    if (!(novo.minimoParcialPct >= 0 && novo.minimoParcialPct <= 100)) campos.push({ campo: 'minimoParcialPct', mensagem: 'Informe um percentual entre 0 e 100' });
    if (!Number.isInteger(novo.minimoParcialPiso) || novo.minimoParcialPiso < 0) campos.push({ campo: 'minimoParcialPiso', mensagem: 'Informe um valor em reais maior ou igual a zero' });
    if (!Number.isInteger(novo.tetoIntencoesDia) || novo.tetoIntencoesDia < 1 || novo.tetoIntencoesDia > 100) campos.push({ campo: 'tetoIntencoesDia', mensagem: 'Informe um número inteiro entre 1 e 100' });
    if (campos.length) throw new BadRequestException({ erro: 'validacao', mensagem: 'Parâmetros de faturamento inválidos', campos });

    const { versao: _va, ...antes } = atual;
    const { versao: _vn, ...depois } = novo;
    if (JSON.stringify(antes) === JSON.stringify(depois)) {
      throw new BadRequestException({ erro: 'sem_alteracao', mensagem: 'Nada foi alterado — os parâmetros já estão assim.' });
    }

    const criado = await this.prisma.db.parametroFaturamento.create({
      data: {
        versao: novo.versao,
        pixSobDemanda: novo.pixSobDemanda,
        modoPix: novo.modoPix,
        multaPadraoPct: novo.multaPadraoPct,
        atualizacaoMesPadraoPct: novo.atualizacaoMesPadraoPct,
        cascata: novo.cascata,
        minimoParcialPct: novo.minimoParcialPct,
        minimoParcialPiso: (novo.minimoParcialPiso / 100).toFixed(2),
        tetoIntencoesDia: novo.tetoIntencoesDia,
        motivo: dto.motivo?.trim() || null,
        criadoPorId: usuarioId,
      },
    });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: atual.pixSobDemanda !== novo.pixSobDemanda ? (novo.pixSobDemanda ? 'pix_sob_demanda_ligado' : 'pix_sob_demanda_desligado') : 'parametros_faturamento_alterados',
        entidade: 'parametro_faturamento',
        entidadeId: criado.id,
        antes: atual as unknown as Prisma.InputJsonValue,
        depois: novo as unknown as Prisma.InputJsonValue,
      },
    });
    return this.tela();
  }
}
