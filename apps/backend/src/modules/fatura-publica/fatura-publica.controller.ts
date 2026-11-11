import { Controller, Get, Header, Param, Res, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { FaturaPublicaService } from './fatura-publica.service';
import { LimitePublicoGuard } from './limite-publico.guard';

// Resposta crua do Fastify (mesmo recorte do dossiê): cabeçalhos + corpo binário.
type Resposta = { header: (k: string, v: string) => Resposta; send: (b: Buffer) => void };

// Rotas PÚBLICAS da Fatura Azit (doc 02 §32.2): sem login, acesso só pelo token
// longo da fatura. É a única superfície pública além dos webhooks — nenhuma
// rota do app autenticado é exposta aqui, e o mini-app não compartilha sessão
// com o app. Cache desligado: a página é "ao vivo".
@Public()
@UseGuards(LimitePublicoGuard)
@Controller('publico/faturas')
export class FaturaPublicaController {
  constructor(private readonly servico: FaturaPublicaService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  fatura(@Param('token') token: string) {
    return this.servico.porToken(token);
  }

  // Polling da página aberta (~30 s): só o que muda com o pagamento.
  @Get(':token/situacao')
  @Header('Cache-Control', 'no-store')
  situacao(@Param('token') token: string) {
    return this.servico.situacao(token);
  }

  // PDF da fatura (em aberto) ou comprovante (paga) — mesmo conteúdo da página.
  @Get(':token/pdf')
  async pdf(@Param('token') token: string, @Res() res: Resposta) {
    const { pdf, nomeArquivo } = await this.servico.pdf(token);
    res
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${nomeArquivo}"`)
      .header('Cache-Control', 'no-store')
      .send(pdf);
  }
}
