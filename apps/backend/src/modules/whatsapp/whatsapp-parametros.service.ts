import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { MomentoLembrete } from '@azit/types';
import {
  BOTAO_MODELO_LEMBRETE,
  CORPO_MODELO_LEMBRETE,
  CORPO_MODELO_LEMBRETE_PIX,
  IDIOMA_PADRAO_MODELO,
  LEMBRETE_HORA_FIM,
  LEMBRETE_HORA_INICIO,
  MODELO_PADRAO_LEMBRETE_PIX,
  MOMENTOS_LEMBRETE_PIX,
  modeloPadraoLembrete,
  normalizarNumerosAutorizados,
  RECEBEDOR_PIX_PADRAO,
  type MomentoLembretePix,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { WhatsappMetaService } from './whatsapp-meta.service';

// Parâmetros do canal WhatsApp, VERSIONADOS (doc 02 §23.3): cada alteração
// grava uma linha nova; vale a de maior versão. Sem linha nenhuma valem os
// padrões — chave geral DESLIGADA, lista de números autorizados vazia.
// Desde 22/11 (§28.6): modelo do aviso de atraso (D+2) e o Pix na mensagem.

type Modelo = { nome: string; idioma: string };

export interface ParametrosWhatsapp {
  versao: number; // 0 = padrões (nunca salvo)
  ativo: boolean;
  numerosAutorizados: string[];
  modelos: Record<MomentoLembrete, Modelo>;
  // Modelos "detalhes do pedido" com o Pix copia e cola (§28.6).
  modelosPix: Record<MomentoLembretePix, Modelo>;
  pixNoLembrete: boolean;
  recebedorPix: string;
  alteradoEm: Date | null;
  usuarioId: string | null;
}

export interface SalvarParametrosWhatsapp {
  ativo?: boolean;
  numerosAutorizados?: string[];
  modeloD2Nome?: string;
  modeloD2Idioma?: string;
  modeloD0Nome?: string;
  modeloD0Idioma?: string;
  modeloAtrasoNome?: string;
  modeloAtrasoIdioma?: string;
  modeloPixD2Nome?: string;
  modeloPixD0Nome?: string;
  modeloPixIdioma?: string;
  pixNoLembrete?: boolean;
  recebedorPix?: string;
}

// Regras de nome e idioma de modelo na Meta: minúsculas, dígitos e sublinhado;
// idioma como "pt_BR" ou "pt".
const NOME_MODELO_RE = /^[a-z0-9_]{1,512}$/;
const IDIOMA_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/;
// Nome do recebedor no cartão do Pix: texto curto, sem quebra de linha.
const RECEBEDOR_MAX = 100;

// Padrões de quem nunca salvou nada. O nome do modelo de LINK depende do
// ambiente: produção sem sufixo, fora de produção com "_hml" (§23.3). Os de Pix
// levam o link no texto e servem aos dois ambientes (§28.6).
function modelosPadrao(producao: boolean): Record<MomentoLembrete, Modelo> {
  return {
    [MomentoLembrete.D_MENOS_2]: { nome: modeloPadraoLembrete(MomentoLembrete.D_MENOS_2, producao), idioma: IDIOMA_PADRAO_MODELO },
    [MomentoLembrete.D_ZERO]: { nome: modeloPadraoLembrete(MomentoLembrete.D_ZERO, producao), idioma: IDIOMA_PADRAO_MODELO },
    [MomentoLembrete.D_MAIS_2]: { nome: modeloPadraoLembrete(MomentoLembrete.D_MAIS_2, producao), idioma: IDIOMA_PADRAO_MODELO },
  };
}

function padrao(producao: boolean): ParametrosWhatsapp {
  return {
    versao: 0,
    ativo: false,
    numerosAutorizados: [],
    modelos: modelosPadrao(producao),
    modelosPix: {
      [MomentoLembrete.D_MENOS_2]: { nome: MODELO_PADRAO_LEMBRETE_PIX[MomentoLembrete.D_MENOS_2], idioma: IDIOMA_PADRAO_MODELO },
      [MomentoLembrete.D_ZERO]: { nome: MODELO_PADRAO_LEMBRETE_PIX[MomentoLembrete.D_ZERO], idioma: IDIOMA_PADRAO_MODELO },
    },
    pixNoLembrete: true,
    recebedorPix: RECEBEDOR_PIX_PADRAO,
    alteradoEm: null,
    usuarioId: null,
  };
}

@Injectable()
export class WhatsappParametrosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly meta: WhatsappMetaService,
  ) {}

  producao(): boolean {
    return this.config.get<string>('ambiente') === 'producao';
  }

  async vigente(): Promise<ParametrosWhatsapp> {
    const p = await this.prisma.db.parametroWhatsapp.findFirst({ orderBy: { versao: 'desc' } });
    const pad = padrao(this.producao());
    if (!p) return pad;
    // Colunas novas (§28.6) nulas = padrão do ambiente.
    const pixIdioma = p.modeloPixIdioma ?? IDIOMA_PADRAO_MODELO;
    return {
      versao: p.versao,
      ativo: p.ativo,
      numerosAutorizados: p.numerosAutorizados,
      modelos: {
        [MomentoLembrete.D_MENOS_2]: { nome: p.modeloD2Nome, idioma: p.modeloD2Idioma },
        [MomentoLembrete.D_ZERO]: { nome: p.modeloD0Nome, idioma: p.modeloD0Idioma },
        [MomentoLembrete.D_MAIS_2]: {
          nome: p.modeloAtrasoNome ?? pad.modelos[MomentoLembrete.D_MAIS_2].nome,
          idioma: p.modeloAtrasoIdioma ?? IDIOMA_PADRAO_MODELO,
        },
      },
      modelosPix: {
        [MomentoLembrete.D_MENOS_2]: { nome: p.modeloPixD2Nome ?? pad.modelosPix[MomentoLembrete.D_MENOS_2].nome, idioma: pixIdioma },
        [MomentoLembrete.D_ZERO]: { nome: p.modeloPixD0Nome ?? pad.modelosPix[MomentoLembrete.D_ZERO].nome, idioma: pixIdioma },
      },
      pixNoLembrete: p.pixNoLembrete,
      recebedorPix: p.recebedorPix ?? RECEBEDOR_PIX_PADRAO,
      alteradoEm: p.createdAt,
      usuarioId: p.usuarioId,
    };
  }

  // O que a tela Configuração › WhatsApp mostra: a versão em vigor, o estado
  // do ambiente e o que precisa existir na Meta (texto dos modelos e endereço
  // do botão DESTE ambiente). Nenhum segredo.
  async tela() {
    const p = await this.vigente();
    const autor = p.usuarioId
      ? await this.prisma.db.usuario.findFirst({ where: { id: p.usuarioId }, select: { nome: true } })
      : null;
    const baseFatura = (this.config.get<string>('faturaPublicaUrl') ?? '').replace(/\/+$/, '');
    const momentos = [MomentoLembrete.D_MENOS_2, MomentoLembrete.D_ZERO, MomentoLembrete.D_MAIS_2];
    return {
      versao: p.versao,
      ativo: p.ativo,
      numerosAutorizados: p.numerosAutorizados,
      modelos: momentos.map((m) => ({
        momento: m,
        nome: p.modelos[m].nome,
        idioma: p.modelos[m].idioma,
        // O que cadastrar na Meta para ESTE ambiente (§23.3).
        cadastro: {
          categoria: 'Utilidade',
          corpo: CORPO_MODELO_LEMBRETE[m],
          variaveis:
            m === MomentoLembrete.D_MAIS_2
              ? ['primeiro nome do cliente', 'número da fatura', 'data de vencimento', 'valor atualizado de hoje']
              : ['primeiro nome do cliente', 'número da fatura', 'valor em aberto', 'data de vencimento'],
          botaoTexto: BOTAO_MODELO_LEMBRETE,
          botaoUrl: `${baseFatura}/{{1}}`,
          botaoVariavel: 'código da fatura (final do endereço da Fatura Azit)',
        },
      })),
      // Pix copia e cola na mensagem de quem tem uma fatura só (§28.6).
      pix: {
        ativo: p.pixNoLembrete,
        recebedor: p.recebedorPix,
        modelos: MOMENTOS_LEMBRETE_PIX.map((m) => ({
          momento: m,
          nome: p.modelosPix[m].nome,
          idioma: p.modelosPix[m].idioma,
          cadastro: {
            categoria: 'Utilidade · Detalhes do pedido',
            corpo: CORPO_MODELO_LEMBRETE_PIX[m],
            variaveis: ['primeiro nome do cliente', 'número da fatura', 'valor em aberto', 'data de vencimento', 'link da fatura (endereço inteiro)'],
            botaoTexto: 'Copiar código Pix (botão fixo da Meta)',
          },
        })),
      },
      janela: { inicio: LEMBRETE_HORA_INICIO, fim: LEMBRETE_HORA_FIM },
      alteradoEm: p.alteradoEm?.toISOString() ?? null,
      alteradoPor: autor?.nome ?? null,
      ambiente: {
        producao: this.producao(),
        credencialConfigurada: this.meta.configurado(),
      },
    };
  }

  async salvar(dto: SalvarParametrosWhatsapp, usuarioId?: string) {
    const atual = await this.vigente();

    let numeros = atual.numerosAutorizados;
    if (dto.numerosAutorizados !== undefined) {
      if (!Array.isArray(dto.numerosAutorizados)) {
        throw new UnprocessableEntityException({ erro: 'numeros_invalidos', mensagem: 'Informe a lista de números autorizados' });
      }
      const r = normalizarNumerosAutorizados(dto.numerosAutorizados.map(String));
      if (r.invalidos.length > 0) {
        throw new UnprocessableEntityException({
          erro: 'numeros_invalidos',
          mensagem: `Número de WhatsApp inválido: ${r.invalidos.join(', ')}. Use DDD + número (ex.: 11 98765-4321).`,
        });
      }
      numeros = r.numeros;
    }

    const modelo = (novo: string | undefined, velho: string, rotulo: string) => {
      if (novo === undefined) return velho;
      const v = novo.trim();
      if (!NOME_MODELO_RE.test(v)) {
        throw new UnprocessableEntityException({
          erro: 'modelo_invalido',
          mensagem: `Nome do modelo (${rotulo}) inválido: use só letras minúsculas, números e sublinhado, como na Meta.`,
        });
      }
      return v;
    };
    const idioma = (novo: string | undefined, velho: string, rotulo: string) => {
      if (novo === undefined) return velho;
      const v = novo.trim();
      if (!IDIOMA_RE.test(v)) {
        throw new UnprocessableEntityException({ erro: 'idioma_invalido', mensagem: `Idioma do modelo (${rotulo}) inválido: use o código da Meta, como pt_BR.` });
      }
      return v;
    };
    let recebedor = atual.recebedorPix;
    if (dto.recebedorPix !== undefined) {
      recebedor = String(dto.recebedorPix).replace(/\s+/g, ' ').trim();
      if (!recebedor || recebedor.length > RECEBEDOR_MAX) {
        throw new UnprocessableEntityException({ erro: 'recebedor_invalido', mensagem: `Informe o nome de quem recebe o Pix (até ${RECEBEDOR_MAX} letras).` });
      }
    }

    const ativo = dto.ativo ?? atual.ativo;
    // Produção nunca simula (§23.1): ligar a chave sem credencial só produziria
    // lembretes retidos. A tela nem oferece; aqui é a garantia.
    if (ativo && !atual.ativo && this.producao() && !this.meta.configurado()) {
      throw new UnprocessableEntityException({
        erro: 'sem_credencial',
        mensagem: 'Cadastre o id do número e o token de acesso do WhatsApp em Configuração › Integrações antes de ligar os envios.',
      });
    }

    const D2 = MomentoLembrete.D_MENOS_2;
    const D0 = MomentoLembrete.D_ZERO;
    const DA = MomentoLembrete.D_MAIS_2;
    const data = {
      versao: atual.versao + 1,
      ativo,
      numerosAutorizados: numeros,
      modeloD2Nome: modelo(dto.modeloD2Nome, atual.modelos[D2].nome, '2 dias antes'),
      modeloD2Idioma: idioma(dto.modeloD2Idioma, atual.modelos[D2].idioma, '2 dias antes'),
      modeloD0Nome: modelo(dto.modeloD0Nome, atual.modelos[D0].nome, 'dia do vencimento'),
      modeloD0Idioma: idioma(dto.modeloD0Idioma, atual.modelos[D0].idioma, 'dia do vencimento'),
      modeloAtrasoNome: modelo(dto.modeloAtrasoNome, atual.modelos[DA].nome, '2 dias de atraso'),
      modeloAtrasoIdioma: idioma(dto.modeloAtrasoIdioma, atual.modelos[DA].idioma, '2 dias de atraso'),
      modeloPixD2Nome: modelo(dto.modeloPixD2Nome, atual.modelosPix[D2].nome, 'Pix, 2 dias antes'),
      modeloPixD0Nome: modelo(dto.modeloPixD0Nome, atual.modelosPix[D0].nome, 'Pix, dia do vencimento'),
      modeloPixIdioma: idioma(dto.modeloPixIdioma, atual.modelosPix[D2].idioma, 'Pix'),
      pixNoLembrete: typeof dto.pixNoLembrete === 'boolean' ? dto.pixNoLembrete : atual.pixNoLembrete,
      recebedorPix: recebedor,
      usuarioId: usuarioId ?? null,
    };
    const salvo = await this.prisma.db.parametroWhatsapp.create({ data });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'parametros_whatsapp_alterados',
        entidade: 'parametro_whatsapp',
        entidadeId: salvo.id,
        antes: {
          versao: atual.versao,
          ativo: atual.ativo,
          numerosAutorizados: atual.numerosAutorizados,
          modelos: atual.modelos,
          modelosPix: atual.modelosPix,
          pixNoLembrete: atual.pixNoLembrete,
          recebedorPix: atual.recebedorPix,
        } as unknown as Prisma.InputJsonValue,
        depois: data as unknown as Prisma.InputJsonValue,
      },
    });
    return this.tela();
  }
}
