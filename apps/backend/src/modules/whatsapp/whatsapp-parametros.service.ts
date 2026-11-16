import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { MomentoLembrete } from '@azit/types';
import {
  BOTAO_MODELO_LEMBRETE,
  CORPO_MODELO_LEMBRETE,
  IDIOMA_PADRAO_MODELO,
  LEMBRETE_HORA_FIM,
  LEMBRETE_HORA_INICIO,
  MODELO_PADRAO_LEMBRETE,
  normalizarNumerosAutorizados,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { WhatsappMetaService } from './whatsapp-meta.service';

// Parâmetros do canal WhatsApp, VERSIONADOS (doc 02 §23.3): cada alteração
// grava uma linha nova; vale a de maior versão. Sem linha nenhuma valem os
// padrões — chave geral DESLIGADA, lista de números autorizados vazia.

export interface ParametrosWhatsapp {
  versao: number; // 0 = padrões (nunca salvo)
  ativo: boolean;
  numerosAutorizados: string[];
  modelos: Record<MomentoLembrete, { nome: string; idioma: string }>;
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
}

// Regras de nome e idioma de modelo na Meta: minúsculas, dígitos e sublinhado;
// idioma como "pt_BR" ou "pt".
const NOME_MODELO_RE = /^[a-z0-9_]{1,512}$/;
const IDIOMA_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/;

const PADRAO: ParametrosWhatsapp = {
  versao: 0,
  ativo: false,
  numerosAutorizados: [],
  modelos: {
    [MomentoLembrete.D_MENOS_2]: { nome: MODELO_PADRAO_LEMBRETE[MomentoLembrete.D_MENOS_2], idioma: IDIOMA_PADRAO_MODELO },
    [MomentoLembrete.D_ZERO]: { nome: MODELO_PADRAO_LEMBRETE[MomentoLembrete.D_ZERO], idioma: IDIOMA_PADRAO_MODELO },
  },
  alteradoEm: null,
  usuarioId: null,
};

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
    if (!p) return PADRAO;
    return {
      versao: p.versao,
      ativo: p.ativo,
      numerosAutorizados: p.numerosAutorizados,
      modelos: {
        [MomentoLembrete.D_MENOS_2]: { nome: p.modeloD2Nome, idioma: p.modeloD2Idioma },
        [MomentoLembrete.D_ZERO]: { nome: p.modeloD0Nome, idioma: p.modeloD0Idioma },
      },
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
    const momentos = [MomentoLembrete.D_MENOS_2, MomentoLembrete.D_ZERO];
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
          variaveis: ['primeiro nome do cliente', 'número da fatura', 'valor em aberto', 'data de vencimento'],
          botaoTexto: BOTAO_MODELO_LEMBRETE,
          botaoUrl: `${baseFatura}/{{1}}`,
          botaoVariavel: 'código da fatura (final do endereço da Fatura Azit)',
        },
      })),
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

    const ativo = dto.ativo ?? atual.ativo;
    // Produção nunca simula (§23.1): ligar a chave sem credencial só produziria
    // lembretes retidos. A tela nem oferece; aqui é a garantia.
    if (ativo && !atual.ativo && this.producao() && !this.meta.configurado()) {
      throw new UnprocessableEntityException({
        erro: 'sem_credencial',
        mensagem: 'Cadastre o id do número e o token de acesso do WhatsApp em Configuração › Integrações antes de ligar os envios.',
      });
    }

    const data = {
      versao: atual.versao + 1,
      ativo,
      numerosAutorizados: numeros,
      modeloD2Nome: modelo(dto.modeloD2Nome, atual.modelos[MomentoLembrete.D_MENOS_2].nome, '2 dias antes'),
      modeloD2Idioma: idioma(dto.modeloD2Idioma, atual.modelos[MomentoLembrete.D_MENOS_2].idioma, '2 dias antes'),
      modeloD0Nome: modelo(dto.modeloD0Nome, atual.modelos[MomentoLembrete.D_ZERO].nome, 'dia do vencimento'),
      modeloD0Idioma: idioma(dto.modeloD0Idioma, atual.modelos[MomentoLembrete.D_ZERO].idioma, 'dia do vencimento'),
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
        } as unknown as Prisma.InputJsonValue,
        depois: data as unknown as Prisma.InputJsonValue,
      },
    });
    return this.tela();
  }
}
