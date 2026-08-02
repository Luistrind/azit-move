import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { AreaSistema, Prisma, RoleUsuario } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../database/prisma.service';

// Gestão de Usuários e Permissões por Área (doc 02 §16).
// Papel carrega as áreas do seu domínio (matriz papel×área, editável);
// exceções por usuário concedem/revogam áreas específicas com motivo.

const criarUsuarioSchema = z.object({
  nome: z.string().min(3),
  email: z.string().email(),
  senha: z.string().min(6),
  papeis: z.array(z.nativeEnum(RoleUsuario)).min(1),
});

const atualizarUsuarioSchema = z.object({
  nome: z.string().min(3).optional(),
  ativo: z.boolean().optional(),
  papeis: z.array(z.nativeEnum(RoleUsuario)).min(1).optional(),
});

const senhaSchema = z.object({ senha: z.string().min(6) });

const celulaMatrizSchema = z.object({
  papel: z.nativeEnum(RoleUsuario),
  area: z.nativeEnum(AreaSistema),
  permitido: z.boolean(),
});

const excecaoSchema = z.object({
  area: z.nativeEnum(AreaSistema),
  concedida: z.boolean().nullable(), // null remove a exceção (volta ao padrão do papel)
  motivo: z.string().optional(),
});

@Controller()
export class UsuariosController {
  constructor(private readonly prisma: PrismaService) {}

  // Áreas efetivas do usuário logado (frontend monta o menu com isto — UX-1).
  @Get('me/areas')
  async minhasAreas(@CurrentUser() user: UsuarioAutenticado) {
    return { areas: await this.areasEfetivas(user.id) };
  }

  @Roles(RoleUsuario.ADMIN)
  @Get('usuarios')
  async listar() {
    const usuarios = await this.prisma.db.usuario.findMany({
      where: { deletedAt: null },
      include: { roles: true, permissoesArea: true },
      orderBy: { nome: 'asc' },
    });
    const matriz = await this.prisma.db.permissaoPapelArea.findMany();
    return Promise.all(
      usuarios.map(async (u) => ({
        id: u.id,
        nome: u.nome,
        email: u.email,
        ativo: u.ativo,
        papeis: u.roles.map((r) => r.role),
        excecoes: u.permissoesArea.map((p) => ({ area: p.area, concedida: p.concedida, motivo: p.motivo })),
        areasEfetivas: this.resolver(u.roles.map((r) => r.role), u.permissoesArea, matriz),
      })),
    );
  }

  @Roles(RoleUsuario.ADMIN)
  @Post('usuarios')
  @HttpCode(201)
  async criar(
    @Body(new ZodValidationPipe(criarUsuarioSchema)) dto: z.infer<typeof criarUsuarioSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const senhaHash = await bcrypt.hash(dto.senha, 10);
    const criado = await this.prisma.db.usuario.create({
      data: {
        nome: dto.nome,
        email: dto.email.toLowerCase(),
        senhaHash,
        roles: { create: dto.papeis.map((role) => ({ role })) },
      },
    });
    await this.auditar(user.id, 'usuario_criado', criado.id, undefined, { nome: dto.nome, email: dto.email, papeis: dto.papeis });
    return { id: criado.id };
  }

  @Roles(RoleUsuario.ADMIN)
  @Patch('usuarios/:id')
  async atualizar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(atualizarUsuarioSchema)) dto: z.infer<typeof atualizarUsuarioSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const antes = await this.prisma.db.usuario.findFirst({ where: { id }, include: { roles: true } });
    await this.prisma.db.usuario.update({ where: { id }, data: { nome: dto.nome, ativo: dto.ativo } });
    if (dto.papeis) {
      await this.prisma.db.usuarioRole.deleteMany({ where: { usuarioId: id } });
      await this.prisma.db.usuarioRole.createMany({ data: dto.papeis.map((role) => ({ usuarioId: id, role })) });
    }
    await this.auditar(user.id, 'usuario_alterado', id,
      { nome: antes?.nome, ativo: antes?.ativo, papeis: antes?.roles.map((r) => r.role) },
      { nome: dto.nome, ativo: dto.ativo, papeis: dto.papeis });
    return { resultado: 'ok' };
  }

  @Roles(RoleUsuario.ADMIN)
  @Post('usuarios/:id/senha')
  @HttpCode(200)
  async redefinirSenha(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(senhaSchema)) dto: z.infer<typeof senhaSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const senhaHash = await bcrypt.hash(dto.senha, 10);
    await this.prisma.db.usuario.update({ where: { id }, data: { senhaHash } });
    await this.auditar(user.id, 'usuario_senha_redefinida', id);
    return { resultado: 'ok' };
  }

  // --- Matriz papel × área (padrões que o papel carrega) ---
  @Roles(RoleUsuario.ADMIN)
  @Get('permissoes/matriz')
  async matriz() {
    const linhas = await this.prisma.db.permissaoPapelArea.findMany();
    return {
      papeis: Object.values(RoleUsuario),
      areas: Object.values(AreaSistema),
      celulas: linhas.map((l) => ({ papel: l.papel, area: l.area, permitido: l.permitido })),
    };
  }

  @Roles(RoleUsuario.ADMIN)
  @Put('permissoes/matriz')
  async salvarCelula(
    @Body(new ZodValidationPipe(celulaMatrizSchema)) dto: z.infer<typeof celulaMatrizSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const anterior = await this.prisma.db.permissaoPapelArea.findUnique({
      where: { papel_area: { papel: dto.papel, area: dto.area } },
    });
    await this.prisma.db.permissaoPapelArea.upsert({
      where: { papel_area: { papel: dto.papel, area: dto.area } },
      update: { permitido: dto.permitido },
      create: { papel: dto.papel, area: dto.area, permitido: dto.permitido },
    });
    await this.auditar(user.id, 'permissao_papel_area_alterada', `${dto.papel}:${dto.area}`,
      { permitido: anterior?.permitido ?? false }, { permitido: dto.permitido });
    return { resultado: 'ok' };
  }

  // --- Exceções por usuário (concede/revoga área específica) ---
  @Roles(RoleUsuario.ADMIN)
  @Get('usuarios/:id/permissoes')
  async permissoesUsuario(@Param('id') id: string) {
    const usuario = await this.prisma.db.usuario.findFirst({
      where: { id },
      include: { roles: true, permissoesArea: true },
    });
    if (!usuario) return { areasEfetivas: [], excecoes: [] };
    const matriz = await this.prisma.db.permissaoPapelArea.findMany();
    return {
      papeis: usuario.roles.map((r) => r.role),
      excecoes: usuario.permissoesArea.map((p) => ({ area: p.area, concedida: p.concedida, motivo: p.motivo })),
      areasDoPapel: this.resolver(usuario.roles.map((r) => r.role), [], matriz),
      areasEfetivas: this.resolver(usuario.roles.map((r) => r.role), usuario.permissoesArea, matriz),
    };
  }

  @Roles(RoleUsuario.ADMIN)
  @Put('usuarios/:id/permissoes')
  async definirExcecao(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(excecaoSchema)) dto: z.infer<typeof excecaoSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    if (dto.concedida === null) {
      await this.prisma.db.permissaoUsuarioArea.deleteMany({ where: { usuarioId: id, area: dto.area } });
      await this.auditar(user.id, 'permissao_usuario_excecao_removida', id, undefined, { area: dto.area });
    } else {
      await this.prisma.db.permissaoUsuarioArea.upsert({
        where: { usuarioId_area: { usuarioId: id, area: dto.area } },
        update: { concedida: dto.concedida, motivo: dto.motivo },
        create: { usuarioId: id, area: dto.area, concedida: dto.concedida, motivo: dto.motivo },
      });
      await this.auditar(user.id, 'permissao_usuario_excecao_definida', id, undefined,
        { area: dto.area, concedida: dto.concedida, motivo: dto.motivo });
    }
    return { areasEfetivas: await this.areasEfetivas(id) };
  }

  // --- internos ---

  private resolver(
    papeis: RoleUsuario[],
    excecoes: { area: AreaSistema; concedida: boolean }[],
    matriz: { papel: RoleUsuario; area: AreaSistema; permitido: boolean }[],
  ): AreaSistema[] {
    const areas = new Set<AreaSistema>();
    for (const m of matriz) {
      if (m.permitido && papeis.includes(m.papel)) areas.add(m.area);
    }
    for (const e of excecoes) {
      if (e.concedida) areas.add(e.area);
      else areas.delete(e.area);
    }
    return [...areas];
  }

  private async areasEfetivas(usuarioId: string): Promise<AreaSistema[]> {
    const usuario = await this.prisma.db.usuario.findFirst({
      where: { id: usuarioId },
      include: { roles: true, permissoesArea: true },
    });
    if (!usuario) return [];
    const matriz = await this.prisma.db.permissaoPapelArea.findMany();
    return this.resolver(usuario.roles.map((r) => r.role), usuario.permissoesArea, matriz);
  }

  private async auditar(usuarioId: string, acao: string, entidadeId: string, antes?: unknown, depois?: unknown) {
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao,
        entidade: 'usuario',
        entidadeId,
        antes: antes ? (JSON.parse(JSON.stringify(antes)) as Prisma.InputJsonValue) : undefined,
        depois: depois ? (JSON.parse(JSON.stringify(depois)) as Prisma.InputJsonValue) : undefined,
      },
    });
  }
}
