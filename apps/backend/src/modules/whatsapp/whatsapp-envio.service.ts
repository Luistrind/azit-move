import { Injectable, Logger } from '@nestjs/common';
import { DecisaoEnvioWhatsapp } from '@azit/types';
import { decidirEnvioWhatsapp } from '@azit/utils';
import { WhatsappMetaService } from './whatsapp-meta.service';
import { WhatsappParametrosService } from './whatsapp-parametros.service';

// REGRA ÚNICA DE ENVIO (doc 02 §23.1 e §23.2). Tudo o que sai pelo WhatsApp —
// lembrete automático ou resposta do operador — passa por aqui; nenhum job ou
// tela decide sozinho se manda de verdade. A decisão é a função pura
// `decidirEnvioWhatsapp` (@azit/utils); este serviço junta o contexto do
// ambiente e executa.

export type ResultadoEnvioWhatsapp =
  | { resultado: 'ENVIADO'; mensagemId: string }
  | { resultado: 'SIMULADO'; motivo: string }
  | { resultado: 'RETIDO'; motivo: string }
  | { resultado: 'FALHOU'; motivo: string };

@Injectable()
export class WhatsappEnvioService {
  private readonly logger = new Logger(WhatsappEnvioService.name);

  constructor(
    private readonly meta: WhatsappMetaService,
    private readonly parametros: WhatsappParametrosService,
  ) {}

  // O que aconteceria com um envio para este destino, agora.
  async decidir(destino: string) {
    const p = await this.parametros.vigente();
    const producao = this.parametros.producao();
    const d = decidirEnvioWhatsapp({
      producao,
      credencialConfigurada: this.meta.configurado(),
      destino,
      numerosAutorizados: p.numerosAutorizados,
    });
    return { ...d, producao, autorizadoTeste: !producao && p.numerosAutorizados.includes(destino) };
  }

  private async executar(destino: string, enviar: (autorizadoTeste: boolean) => Promise<string>): Promise<ResultadoEnvioWhatsapp> {
    const d = await this.decidir(destino);
    if (d.decisao === DecisaoEnvioWhatsapp.SIMULADO) return { resultado: 'SIMULADO', motivo: d.motivo ?? 'simulado' };
    if (d.decisao === DecisaoEnvioWhatsapp.RETIDO) return { resultado: 'RETIDO', motivo: d.motivo ?? 'retido' };
    try {
      return { resultado: 'ENVIADO', mensagemId: await enviar(d.autorizadoTeste) };
    } catch (e) {
      const motivo = (e as Error).message.slice(0, 500);
      this.logger.warn(`envio ao WhatsApp falhou: ${motivo}`);
      return { resultado: 'FALHOU', motivo };
    }
  }

  enviarModelo(p: { destino: string; modelo: string; idioma: string; variaveisCorpo: string[]; sufixoBotaoUrl?: string }): Promise<ResultadoEnvioWhatsapp> {
    return this.executar(p.destino, (autorizadoTeste) => this.meta.enviarModelo({ ...p, destinoAutorizadoTeste: autorizadoTeste }));
  }

  enviarTexto(p: { destino: string; texto: string }): Promise<ResultadoEnvioWhatsapp> {
    return this.executar(p.destino, (autorizadoTeste) => this.meta.enviarTexto({ ...p, destinoAutorizadoTeste: autorizadoTeste }));
  }

  // Imagem, documento ou áudio pela tela Conversas (doc 02 §34.6) — mesma regra.
  enviarMidia(p: { destino: string; tipo: 'image' | 'document' | 'audio'; arquivo: Buffer; mime: string; nomeArquivo: string; legenda?: string | null }): Promise<ResultadoEnvioWhatsapp> {
    return this.executar(p.destino, (autorizadoTeste) => this.meta.enviarMidia({ ...p, destinoAutorizadoTeste: autorizadoTeste }));
  }

  // Visto azul para o cliente: só quando um envio real para ele seria permitido
  // (fora de produção, nada sai para número não autorizado — nem o visto).
  async confirmarLeitura(destino: string, mensagemId: string): Promise<void> {
    const d = await this.decidir(destino);
    if (d.decisao !== DecisaoEnvioWhatsapp.ENVIA) return;
    await this.meta.marcarComoLida(mensagemId).catch((e) => this.logger.warn(`confirmação de leitura falhou: ${(e as Error).message}`));
  }
}
