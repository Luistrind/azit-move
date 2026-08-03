import { Controller, Get } from '@nestjs/common';
import { AreaSistema, RoleUsuario, StatusAnalise } from '@prisma/client';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../database/prisma.service';

// Tela Início (proposta UX §4.3): fila de trabalho do papel logado.
// Cada bloco pertence a uma área do sistema; o usuário só recebe os blocos
// das áreas efetivas (matriz papel×área ± exceções — doc 02 §16).

const ANALISE_FINAIS: StatusAnalise[] = [
  StatusAnalise.LIBERADO_PARA_FORMALIZACAO,
  StatusAnalise.NAO_APROVADO,
  StatusAnalise.PROPOSTA_ENCERRADA,
];

interface ItemFila {
  titulo: string;
  subtitulo: string;
  rota: string;
}
interface BlocoFila {
  area: AreaSistema;
  titulo: string;
  quantidade: number;
  vazio: string;
  rota: string;
  rotaRotulo: string;
  itens: ItemFila[];
}

@Controller()
export class InicioController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('inicio/fila')
  async fila(@CurrentUser() user: UsuarioAutenticado): Promise<{ blocos: BlocoFila[] }> {
    const areas = await this.areasEfetivas(user.id);
    const blocos: BlocoFila[] = [];

    if (areas.has(AreaSistema.APROVACOES)) {
      const pendentes = await this.prisma.db.aprovacao.findMany({
        where: { status: 'PENDENTE' },
        orderBy: { createdAt: 'asc' },
        include: { operacao: true },
      });
      blocos.push({
        area: AreaSistema.APROVACOES,
        titulo: 'Aprovações aguardando decisão',
        quantidade: pendentes.length,
        vazio: 'Nenhuma aprovação pendente.',
        rota: '/aprovacoes',
        rotaRotulo: 'Abrir central de aprovações',
        itens: pendentes.slice(0, 5).map((a) => ({
          titulo: a.resumo,
          subtitulo: a.operacao.nome,
          rota: '/aprovacoes',
        })),
      });
    }

    if (areas.has(AreaSistema.ANALISE_CADASTRO)) {
      const analises = await this.prisma.db.analiseCadastro.findMany({
        where: { status: { notIn: ANALISE_FINAIS } },
        orderBy: { updatedAt: 'asc' },
        include: { proposta: { include: { titular: true } } },
      });
      blocos.push({
        area: AreaSistema.ANALISE_CADASTRO,
        titulo: 'Análises de cadastro em andamento',
        quantidade: analises.length,
        vazio: 'Nenhuma análise em andamento.',
        rota: '/analises',
        rotaRotulo: 'Ver todas as análises',
        itens: analises.slice(0, 5).map((a) => ({
          titulo: a.proposta.titular.nome,
          subtitulo: a.status,
          rota: `/analises/${a.id}`,
        })),
      });
    }

    if (areas.has(AreaSistema.COMERCIAL)) {
      const propostas = await this.prisma.db.proposta.findMany({
        where: {
          deletedAt: null,
          status: { in: ['PENDENTE', 'EM_ANALISE', 'APROVADA', 'EM_FORMALIZACAO'] },
        },
        orderBy: { updatedAt: 'asc' },
        include: { titular: true },
      });
      blocos.push({
        area: AreaSistema.COMERCIAL,
        titulo: 'Propostas em andamento',
        quantidade: propostas.length,
        vazio: 'Nenhuma proposta em andamento.',
        rota: '/propostas',
        rotaRotulo: 'Abrir quadro de propostas',
        itens: propostas.slice(0, 5).map((p) => ({
          titulo: p.titular.nome,
          subtitulo: p.status,
          rota: `/propostas/${p.id}`,
        })),
      });
    }

    if (areas.has(AreaSistema.CONTRATOS)) {
      const contratos = await this.prisma.db.contratoCredito.findMany({
        where: {
          deletedAt: null,
          status: {
            in: ['AGUARDANDO_ASSINATURA', 'AGUARDANDO_PAGAMENTO_INICIAL', 'AGUARDANDO_ENTREGA_VEICULO'],
          },
        },
        orderBy: { updatedAt: 'asc' },
        include: { conta: { include: { titular: true } } },
      });
      blocos.push({
        area: AreaSistema.CONTRATOS,
        titulo: 'Contratos aguardando assinatura ou ativação',
        quantidade: contratos.length,
        vazio: 'Nenhum contrato aguardando.',
        rota: '/carteira',
        rotaRotulo: 'Abrir carteira',
        itens: contratos.slice(0, 5).map((c) => ({
          titulo: c.conta.titular.nome,
          subtitulo: c.status,
          rota: `/contratos/${c.id}`,
        })),
      });
    }

    if (areas.has(AreaSistema.CARTEIRA_COBRANCA)) {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const vencidas = await this.prisma.db.fatura.findMany({
        where: {
          status: { in: ['ABERTA', 'FECHADA', 'VENCIDA'] },
          dataVencimento: { lt: hoje },
        },
        orderBy: { dataVencimento: 'asc' },
        include: { conta: { include: { titular: true } } },
      });
      blocos.push({
        area: AreaSistema.CARTEIRA_COBRANCA,
        titulo: 'Faturas vencidas sem pagamento',
        quantidade: vencidas.length,
        vazio: 'Nenhuma fatura vencida.',
        rota: '/regua',
        rotaRotulo: 'Abrir régua de cobrança',
        itens: vencidas.slice(0, 5).map((f) => ({
          titulo: f.conta.titular.nome,
          subtitulo: `Venceu em ${f.dataVencimento.toISOString().slice(0, 10)}`,
          rota: `/titulares/${f.conta.titular.id}`,
        })),
      });
    }

    return { blocos };
  }

  // Mesma resolução de áreas do módulo de usuários (união dos papéis ± exceções).
  private async areasEfetivas(usuarioId: string): Promise<Set<AreaSistema>> {
    const usuario = await this.prisma.db.usuario.findFirst({
      where: { id: usuarioId },
      include: { roles: true, permissoesArea: true },
    });
    const areas = new Set<AreaSistema>();
    if (!usuario) return areas;
    const papeis = usuario.roles.map((r) => r.role as RoleUsuario);
    const matriz = await this.prisma.db.permissaoPapelArea.findMany();
    for (const m of matriz) {
      if (m.permitido && papeis.includes(m.papel)) areas.add(m.area);
    }
    for (const e of usuario.permissoesArea) {
      if (e.concedida) areas.add(e.area);
      else areas.delete(e.area);
    }
    return areas;
  }
}
