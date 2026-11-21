import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { TIPOS_CUSTO_RECUPERACAO, TIPO_CUSTO_RECUPERACAO_LABEL, type TipoCustoRecuperacao } from '@azit/types';
import { centavosParaReaisString, dataCalendarioUTC, dataHojeBrasil, diaDeColunaMista, formatCurrency, inicioDiaUTC } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { RescisaoService } from './rescisao.service';

const UPLOADS_DIR = join(process.cwd(), 'uploads', 'custos');
const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null | undefined): number => (d ? Math.round(Number(d.toString()) * 100) : 0);

export interface CustoRecuperacaoApi {
  id: string;
  tipo: string;
  descricao: string;
  fornecedor: string | null;
  data: string; // 'YYYY-MM-DD'
  valor: number; // centavos
  situacao: 'orcado' | 'pago';
  quemPaga: 'cliente' | 'azit';
  comprovante: string | null; // nome do arquivo anexado
  lancadoPor: string | null;
}

export interface DadosCusto {
  tipo: string;
  descricao: string;
  valor: number; // centavos
  data?: string; // 'YYYY-MM-DD'
  fornecedor?: string;
  situacao: 'ORCADO' | 'PAGO';
  quemPaga: 'CLIENTE' | 'AZIT';
  comprovante?: { nome: string; conteudo: string }; // base64 — mesmo padrão dos documentos do ativo
}

// Custos da recuperação do veículo (doc 02 §29.3, decisões Luís 20–21/11/2026).
// Cada custo É um lançamento de custo do veículo (LancamentoCustoAtivo, o da aba
// Custos da ficha do veículo) ligado ao contrato — sem cadastro paralelo. O que
// o cliente paga entra na dívida do acerto da rescisão (orçado como estimativa);
// o que a Azit assume fica só como custo do veículo. Lança-se antes, durante e
// depois da rescisão; depois dela, cada mudança recalcula o saldo (RescisaoService).
@Injectable()
export class CustoRecuperacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rescisao: RescisaoService,
  ) {}

  private async contrato(contratoId: string) {
    const c = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, numero: true, status: true, motivoEncerramento: true, ativoId: true },
    });
    if (!c) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    return c;
  }

  // Onde cabe custo de recuperação: contrato do veículo, em vida ou já rescindido.
  private motivoSemLancamento(c: { status: string; motivoEncerramento: string | null; ativoId: string | null }): string | null {
    if (!c.ativoId) return 'Este contrato não tem veículo';
    if (c.status === 'ATIVO') return null;
    if (c.status === 'ENCERRADO' && c.motivoEncerramento === 'RESCISAO') return null;
    return 'Custos da recuperação só em contrato ativo ou rescindido';
  }

  async listar(contratoId: string) {
    const c = await this.contrato(contratoId);
    const linhas = await this.prisma.db.lancamentoCustoAtivo.findMany({
      where: { contratoId, deletedAt: null },
      orderBy: [{ data: 'asc' }, { createdAt: 'asc' }],
    });
    const ids = [...new Set(linhas.map((l) => l.criadoPor).filter((u): u is string => !!u))];
    const usuarios = ids.length ? await this.prisma.db.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } }) : [];
    const nome = new Map(usuarios.map((u) => [u.id, u.nome]));
    const custos: CustoRecuperacaoApi[] = linhas.map((l) => ({
      id: l.id,
      tipo: l.tipo,
      descricao: l.descricao,
      fornecedor: l.fornecedor,
      data: diaDeColunaMista(l.data),
      valor: cent(l.valor),
      situacao: l.situacao === 'ORCADO' ? 'orcado' : 'pago',
      quemPaga: l.quemPaga === 'CLIENTE' ? 'cliente' : 'azit',
      comprovante: l.comprovanteRef ? l.comprovanteNome ?? l.comprovanteRef : null,
      lancadoPor: l.criadoPor ? nome.get(l.criadoPor) ?? null : null,
    }));
    const soma = (f: (x: CustoRecuperacaoApi) => boolean) => custos.filter(f).reduce((s, x) => s + x.valor, 0);
    return {
      contratoId: c.id,
      // A tela não mostra o que não pode (regra 13/11): os motivos vêm prontos.
      motivoSemLancamento: this.motivoSemLancamento(c),
      motivoClienteTravado: await this.rescisao.motivoCustosTravados(contratoId),
      custos,
      totais: {
        cliente: soma((x) => x.quemPaga === 'cliente'),
        clienteOrcado: soma((x) => x.quemPaga === 'cliente' && x.situacao === 'orcado'),
        azit: soma((x) => x.quemPaga === 'azit'),
      },
    };
  }

  private validar(d: DadosCusto) {
    if (!(TIPOS_CUSTO_RECUPERACAO as readonly string[]).includes(d.tipo)) {
      throw new UnprocessableEntityException({ erro: 'tipo_invalido', mensagem: 'Tipo de custo inválido' });
    }
    if (!d.descricao?.trim()) throw new UnprocessableEntityException({ erro: 'descricao_obrigatoria', mensagem: 'Escreva o que foi o custo' });
    if (!Number.isInteger(d.valor) || d.valor <= 0) throw new UnprocessableEntityException({ erro: 'valor_invalido', mensagem: 'Informe um valor maior que zero' });
    const dia = d.data ?? dataHojeBrasil();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(inicioDiaUTC(dia).getTime())) {
      throw new UnprocessableEntityException({ erro: 'data_invalida', mensagem: 'Data inválida (use AAAA-MM-DD)' });
    }
    if (dia > dataHojeBrasil()) throw new UnprocessableEntityException({ erro: 'data_futura', mensagem: 'A data do custo não pode ser futura' });
    return dia;
  }

  private async travaDoCliente(contratoId: string, mexeNoCliente: boolean) {
    if (!mexeNoCliente) return;
    const motivo = await this.rescisao.motivoCustosTravados(contratoId);
    if (motivo) throw new UnprocessableEntityException({ erro: 'acerto_liquidado', mensagem: motivo });
  }

  private async gravarComprovante(id: string, arquivo?: { nome: string; conteudo: string }) {
    if (!arquivo?.conteudo) return null;
    const base64 = arquivo.conteudo.includes(',') ? arquivo.conteudo.split(',')[1] : arquivo.conteudo;
    const extensao = (arquivo.nome.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const ref = `${id}.${extensao}`;
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.writeFile(join(UPLOADS_DIR, ref), Buffer.from(base64, 'base64'));
    return { comprovanteRef: ref, comprovanteNome: arquivo.nome.slice(0, 120) };
  }

  private rotulo(tipo: string) {
    return TIPO_CUSTO_RECUPERACAO_LABEL[tipo as TipoCustoRecuperacao] ?? tipo;
  }

  async lancar(contratoId: string, d: DadosCusto, usuarioId: string) {
    const c = await this.contrato(contratoId);
    const motivo = this.motivoSemLancamento(c);
    if (motivo) throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: motivo });
    const dia = this.validar(d);
    await this.travaDoCliente(contratoId, d.quemPaga === 'CLIENTE');

    const criado = await this.prisma.db.lancamentoCustoAtivo.create({
      data: {
        ativoId: c.ativoId!,
        contratoId,
        tipo: d.tipo,
        descricao: d.descricao.trim(),
        valor: reais(d.valor),
        data: inicioDiaUTC(dia),
        fornecedor: d.fornecedor?.trim() || null,
        situacao: d.situacao,
        quemPaga: d.quemPaga,
        criadoPor: usuarioId,
      },
    });
    const arquivo = await this.gravarComprovante(criado.id, d.comprovante);
    if (arquivo) await this.prisma.db.lancamentoCustoAtivo.update({ where: { id: criado.id }, data: arquivo });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId, acao: 'custo_recuperacao_lancado', entidade: 'contrato', entidadeId: contratoId,
        depois: { custoId: criado.id, tipo: d.tipo, descricao: d.descricao.trim(), valor: d.valor, situacao: d.situacao, quemPaga: d.quemPaga, comprovante: !!arquivo },
      },
    });
    if (d.quemPaga === 'CLIENTE') {
      await this.rescisao.recalcularAposCusto(contratoId, usuarioId, `Custo lançado: ${this.rotulo(d.tipo)} ${formatCurrency(d.valor)}${d.situacao === 'ORCADO' ? ' (orçado)' : ''}`);
    }
    return this.listar(contratoId);
  }

  private async carregarCusto(custoId: string) {
    const l = await this.prisma.db.lancamentoCustoAtivo.findFirst({ where: { id: custoId, deletedAt: null, contratoId: { not: null } } });
    if (!l || !l.contratoId) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Custo não encontrado' });
    return { ...l, contratoId: l.contratoId };
  }

  // Altera valor, situação, quem paga, descrição, fornecedor, data ou troca o comprovante.
  async alterar(custoId: string, d: Partial<DadosCusto>, usuarioId: string) {
    const l = await this.carregarCusto(custoId);
    const novo: DadosCusto = {
      tipo: d.tipo ?? l.tipo,
      descricao: d.descricao ?? l.descricao,
      valor: d.valor ?? cent(l.valor),
      data: d.data ?? dataCalendarioUTC(l.data),
      fornecedor: d.fornecedor ?? l.fornecedor ?? undefined,
      situacao: d.situacao ?? (l.situacao === 'ORCADO' ? 'ORCADO' : 'PAGO'),
      quemPaga: d.quemPaga ?? (l.quemPaga === 'CLIENTE' ? 'CLIENTE' : 'AZIT'),
    };
    // A data antiga pode ser um instante (coluna mista): só revalida se veio nova.
    const dia = d.data ? this.validar(novo) : (this.validar({ ...novo, data: undefined }), null);
    const eraDoCliente = l.quemPaga === 'CLIENTE';
    await this.travaDoCliente(l.contratoId, eraDoCliente || novo.quemPaga === 'CLIENTE');

    const arquivo = await this.gravarComprovante(l.id, d.comprovante);
    await this.prisma.db.lancamentoCustoAtivo.update({
      where: { id: l.id },
      data: {
        tipo: novo.tipo,
        descricao: novo.descricao.trim(),
        valor: reais(novo.valor),
        ...(dia ? { data: inicioDiaUTC(dia) } : {}),
        fornecedor: novo.fornecedor?.trim() || null,
        situacao: novo.situacao,
        quemPaga: novo.quemPaga,
        ...(arquivo ?? {}),
      },
    });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId, acao: 'custo_recuperacao_alterado', entidade: 'contrato', entidadeId: l.contratoId,
        antes: { custoId: l.id, valor: cent(l.valor), situacao: l.situacao, quemPaga: l.quemPaga },
        depois: { custoId: l.id, valor: novo.valor, situacao: novo.situacao, quemPaga: novo.quemPaga, comprovanteTrocado: !!arquivo },
      },
    });
    if (eraDoCliente || novo.quemPaga === 'CLIENTE') {
      const de = formatCurrency(cent(l.valor));
      const para = formatCurrency(novo.valor);
      const oQue = !eraDoCliente
        ? `passou para o cliente (${para})`
        : novo.quemPaga !== 'CLIENTE'
          ? `a Azit assumiu (${de})`
          : de !== para
            ? `de ${de} para ${para}${l.situacao === 'ORCADO' && novo.situacao === 'PAGO' ? ' (orçamento virou nota)' : ''}`
            : l.situacao === 'ORCADO' && novo.situacao === 'PAGO' ? 'orçamento confirmado no mesmo valor' : 'dados alterados';
      await this.rescisao.recalcularAposCusto(l.contratoId, usuarioId, `${this.rotulo(novo.tipo)}: ${oQue}`);
    }
    return this.listar(l.contratoId);
  }

  async remover(custoId: string, usuarioId: string) {
    const l = await this.carregarCusto(custoId);
    await this.travaDoCliente(l.contratoId, l.quemPaga === 'CLIENTE');
    await this.prisma.db.lancamentoCustoAtivo.update({ where: { id: l.id }, data: { deletedAt: new Date() } });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId, acao: 'custo_recuperacao_retirado', entidade: 'contrato', entidadeId: l.contratoId,
        antes: { custoId: l.id, tipo: l.tipo, descricao: l.descricao, valor: cent(l.valor), situacao: l.situacao, quemPaga: l.quemPaga },
      },
    });
    if (l.quemPaga === 'CLIENTE') {
      await this.rescisao.recalcularAposCusto(l.contratoId, usuarioId, `Custo retirado: ${this.rotulo(l.tipo)} ${formatCurrency(cent(l.valor))}`);
    }
    return this.listar(l.contratoId);
  }

  async comprovante(custoId: string) {
    const l = await this.carregarCusto(custoId);
    if (!l.comprovanteRef) throw new NotFoundException({ erro: 'sem_comprovante', mensagem: 'Nenhum comprovante anexado' });
    return { nome: l.comprovanteNome ?? l.comprovanteRef, ref: l.comprovanteRef, buffer: await fs.readFile(join(UPLOADS_DIR, l.comprovanteRef)) };
  }
}
