import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, StreamableFile, UseGuards } from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { DevOnlyGuard } from '../../common/guards/dev-only.guard';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { LeadService } from './lead.service';
import { SimulacaoService } from './simulacao.service';
import { PropostaService } from './proposta.service';
import { FormalizacaoService } from './formalizacao.service';
import { criarLeadSchema, CriarLeadDto } from './dto/lead.dto';
import {
  criarSimulacaoSchema,
  CriarSimulacaoDto,
  selecionarOfertaSchema,
  SelecionarOfertaDto,
} from './dto/simulacao.dto';
import {
  criarPropostaSchema,
  CriarPropostaDto,
  patchStatusPropostaSchema,
  PatchStatusPropostaDto,
  adicionarVinculoSchema,
  AdicionarVinculoDto,
  anexarDocumentoSchema,
  AnexarDocumentoDto,
  registrarParecerSchema,
  RegistrarParecerDto,
  assinarSchema,
  AssinarDto,
  adicionarProdutoSchema,
  AdicionarProdutoDto,
} from './dto/proposta.dto';

// Bloco 7 — Funil de originação nativa (Lead → Simulação → Proposta → ...).
// Operação interna (ADMIN/OPERADOR). O dado nasce na tela, não via API externa.
@Controller()
export class FunilController {
  constructor(
    private readonly lead: LeadService,
    private readonly simulacao: SimulacaoService,
    private readonly proposta: PropostaService,
    private readonly formalizacao: FormalizacaoService,
  ) {}

  // --- 7.2 Lead ---
  @Get('leads')
  listarLeads() {
    return this.lead.listar();
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('leads')
  @HttpCode(201)
  criarLead(@Body(new ZodValidationPipe(criarLeadSchema)) dto: CriarLeadDto) {
    return this.lead.criar(dto);
  }

  // --- 7.3 Simulação / ofertas ---
  @Get('simulacoes')
  listarSimulacoes() {
    return this.simulacao.listar();
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('simulacoes')
  @HttpCode(201)
  simular(@Body(new ZodValidationPipe(criarSimulacaoSchema)) dto: CriarSimulacaoDto) {
    return this.simulacao.criar(dto);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('simulacoes/:id/selecionar')
  @HttpCode(200)
  selecionar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(selecionarOfertaSchema)) dto: SelecionarOfertaDto,
  ) {
    return this.simulacao.selecionarOferta(id, dto.ofertaId);
  }

  // --- 7.5/7.6/7.7 Proposta + papéis ---
  @Get('propostas')
  listarPropostas() {
    return this.proposta.listar();
  }

  @Get('propostas/:id')
  detalheProposta(@Param('id') id: string) {
    return this.proposta.detalhe(id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('propostas')
  @HttpCode(201)
  criarProposta(@Body(new ZodValidationPipe(criarPropostaSchema)) dto: CriarPropostaDto) {
    return this.proposta.criar(dto);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Patch('propostas/:id/status')
  patchStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchStatusPropostaSchema)) dto: PatchStatusPropostaDto,
  ) {
    return this.proposta.patchStatus(id, dto.status);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('propostas/:id/vinculos')
  @HttpCode(201)
  adicionarVinculo(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adicionarVinculoSchema)) dto: AdicionarVinculoDto,
  ) {
    return this.proposta.adicionarVinculo(id, dto);
  }

  // --- Carrinho de produtos da proposta ---
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('propostas/:id/produtos')
  @HttpCode(201)
  adicionarProduto(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adicionarProdutoSchema)) dto: AdicionarProdutoDto,
  ) {
    return this.proposta.adicionarProduto(id, dto.produtoId, dto.valor);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Delete('propostas/:id/produtos/:itemId')
  removerProduto(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.proposta.removerProduto(id, itemId);
  }

  // --- 7.8 Análise documental ---
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('propostas/:id/documentos')
  @HttpCode(201)
  anexarDocumento(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(anexarDocumentoSchema)) dto: AnexarDocumentoDto,
  ) {
    return this.proposta.anexarDocumento(id, dto);
  }

  // Download do arquivo anexado.
  @Get('propostas/documentos/:docId/download')
  async baixarDocumento(@Param('docId') docId: string): Promise<StreamableFile> {
    const { nome, buffer } = await this.proposta.arquivoDocumento(docId);
    return new StreamableFile(buffer, { disposition: `attachment; filename="${encodeURIComponent(nome)}"` });
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.APROVADOR, RoleUsuario.DIRETOR)
  @Post('propostas/:id/parecer')
  @HttpCode(201)
  registrarParecer(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(registrarParecerSchema)) dto: RegistrarParecerDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.proposta.registrarParecer(id, dto, user.id);
  }

  // --- 7.10 Formalização ---
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('propostas/:id/formalizar')
  @HttpCode(201)
  formalizar(@Param('id') id: string) {
    return this.formalizacao.formalizar(id);
  }

  // --- Assinatura (titular + Azit) e status do contrato ---
  @Get('contratos/:id/status-formalizacao')
  statusContrato(@Param('id') id: string) {
    return this.formalizacao.statusContrato(id);
  }

  // Status do pacote de contratos da proposta (veículo + apartados).
  @Get('propostas/:id/status-pacote')
  statusPacote(@Param('id') id: string) {
    return this.formalizacao.statusPacote(id);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('contratos/:id/assinar')
  @HttpCode(200)
  assinar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assinarSchema)) dto: AssinarDto,
  ) {
    return this.formalizacao.assinar(id, dto.parte);
  }

  // --- 7.11 Ativação (cobrança da entrada; exige assinaturas) ---
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('contratos/:id/ativar')
  @HttpCode(200)
  ativar(@Param('id') id: string) {
    return this.formalizacao.ativar(id);
  }

  // Dev: simula o pagamento da entrada (webhook) → ativa o contrato.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @UseGuards(DevOnlyGuard)
  @Post('dev/simular-pagamento-ativacao/:id')
  @HttpCode(200)
  simularPagamentoAtivacao(@Param('id') id: string) {
    return this.formalizacao.simularPagamentoAtivacao(id);
  }
}
