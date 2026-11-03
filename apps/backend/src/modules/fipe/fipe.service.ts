import { Injectable, Logger } from '@nestjs/common';
import { escolherModeloFipe, valorFipeParaCentavos, type ModeloFipe } from '@azit/utils';

// ============================================================
// Tabela FIPE — fonte OFICIAL (veiculos.fipe.org.br, a mesma API que o site
// da Fundação usa). Decisão Luís 01/10: o valor de venda do veículo migrado
// é a FIPE, preenchida PELO SISTEMA — ninguém edita cadastro à mão.
//
// Fluxo: tabela de referência (mês vigente) → marca → modelo (casado pelo
// nome, sem chute — ver escolherModeloFipe) → ano/combustível → valor.
// Tudo que não casar com certeza devolve `null` com o motivo: melhor ficar
// sem FIPE (a tela avisa) do que gravar a de outro carro.
// ============================================================

const BASE = 'https://veiculos.fipe.org.br/api/veiculos';
const CARRO = 1; // codigoTipoVeiculo

export interface ConsultaFipe {
  valor: number; // centavos
  codigoFipe: string;
  modeloFipe: string;
  anoModelo: number;
  combustivel: string;
  referencia: string; // "outubro de 2026"
  alternativas: string[]; // outros modelos que também casariam (para conferência)
}
export type ResultadoFipe = { ok: true; fipe: ConsultaFipe } | { ok: false; motivo: string };

// Item de lista para a busca em tela (doc 02 §29.1): código + rótulo.
export interface ItemFipe { codigo: string; nome: string }
export interface ValorFipe {
  valor: number; // centavos
  codigoFipe: string;
  marca: string;
  modelo: string;
  anoModelo: number;
  combustivel: string;
  referencia: string;
}

@Injectable()
export class FipeService {
  private readonly logger = new Logger(FipeService.name);
  // Cache em memória: a tabela muda uma vez por mês; marcas/modelos, quase nunca.
  private cacheRef: { codigo: number; em: number } | null = null;
  private cacheMarcas: { ref: number; marcas: ModeloFipe[] } | null = null;
  private cacheModelos = new Map<string, ModeloFipe[]>();

  private async post<T>(rota: string, corpo: Record<string, unknown>): Promise<T> {
    const resp = await fetch(`${BASE}/${rota}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: 'https://veiculos.fipe.org.br/' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) throw new Error(`FIPE ${rota} retornou ${resp.status}`);
    return (await resp.json()) as T;
  }

  private async referencia(): Promise<number> {
    if (this.cacheRef && Date.now() - this.cacheRef.em < 12 * 3_600_000) return this.cacheRef.codigo;
    const tabelas = await this.post<{ Codigo: number }[]>('ConsultarTabelaDeReferencia', {});
    if (!tabelas?.length) throw new Error('FIPE sem tabela de referência');
    this.cacheRef = { codigo: tabelas[0].Codigo, em: Date.now() };
    return tabelas[0].Codigo;
  }

  // --- Busca em tela para o veículo de REFERÊNCIA (doc 02 §29.1) ---
  // Mesma API oficial, mesmo cache; aqui o operador escolhe nas listas e o
  // valor vem da Fundação — nunca digitado.
  private async marcasCache(): Promise<{ ref: number; marcas: ModeloFipe[] }> {
    const ref = await this.referencia();
    if (!this.cacheMarcas || this.cacheMarcas.ref !== ref) {
      this.cacheMarcas = { ref, marcas: await this.post<ModeloFipe[]>('ConsultarMarcas', { codigoTabelaReferencia: ref, codigoTipoVeiculo: CARRO }) };
      this.cacheModelos.clear();
    }
    return this.cacheMarcas;
  }

  async marcas(): Promise<ItemFipe[]> {
    const { marcas } = await this.marcasCache();
    return marcas.map((m) => ({ codigo: String(m.Value), nome: m.Label.trim() }));
  }

  async modelos(codigoMarca: string): Promise<ItemFipe[]> {
    const { ref } = await this.marcasCache();
    const chave = `${ref}:${codigoMarca}`;
    let modelos = this.cacheModelos.get(chave);
    if (!modelos) {
      const r = await this.post<{ Modelos: ModeloFipe[] }>('ConsultarModelos', { codigoTabelaReferencia: ref, codigoTipoVeiculo: CARRO, codigoMarca: Number(codigoMarca) });
      modelos = r.Modelos ?? [];
      this.cacheModelos.set(chave, modelos);
    }
    return modelos.map((m) => ({ codigo: String(m.Value), nome: m.Label.replace(/\s+/g, ' ').trim() }));
  }

  // Ano vem como "2020-1" (ano-combustível); o rótulo é "2020 Gasolina".
  async anos(codigoMarca: string, codigoModelo: string): Promise<ItemFipe[]> {
    const { ref } = await this.marcasCache();
    const anos = await this.post<ModeloFipe[]>('ConsultarAnoModelo', { codigoTabelaReferencia: ref, codigoTipoVeiculo: CARRO, codigoMarca: Number(codigoMarca), codigoModelo: Number(codigoModelo) });
    // A Fundação usa "32000" como ano de ZERO KM — a tela mostra por extenso.
    return (anos ?? []).map((a) => ({ codigo: String(a.Value), nome: a.Label.trim().replace(/^32000\b/, 'Zero km') }));
  }

  async valorPorCodigos(p: { codigoMarca: string; codigoModelo: string; ano: string }): Promise<ValorFipe> {
    const { ref, marcas } = await this.marcasCache();
    const [anoModelo, combustivel] = p.ano.split('-');
    const v = await this.post<{ Valor?: string; CodigoFipe?: string; Marca?: string; Modelo?: string; AnoModelo?: number; Combustivel?: string; MesReferencia?: string; erro?: string }>('ConsultarValorComTodosParametros', {
      codigoTabelaReferencia: ref, codigoTipoVeiculo: CARRO, codigoMarca: Number(p.codigoMarca), codigoModelo: Number(p.codigoModelo),
      ano: p.ano, anoModelo: Number(anoModelo), codigoTipoCombustivel: Number(combustivel), tipoConsulta: 'tradicional',
    });
    const valor = v.Valor ? valorFipeParaCentavos(v.Valor) : null;
    if (!valor) throw new Error(v.erro || 'a FIPE não devolveu valor para essa combinação');
    const marca = marcas.find((m) => String(m.Value) === p.codigoMarca)?.Label.trim() ?? v.Marca ?? '';
    return {
      valor,
      codigoFipe: v.CodigoFipe ?? '',
      marca: v.Marca?.trim() || marca,
      modelo: (v.Modelo ?? '').replace(/\s+/g, ' ').trim(),
      anoModelo: Number(v.AnoModelo ?? anoModelo),
      combustivel: v.Combustivel ?? '',
      referencia: (v.MesReferencia ?? '').trim(),
    };
  }

  async consultar(veiculo: { marca: string | null; modelo: string | null; anoModelo: number | null }): Promise<ResultadoFipe> {
    if (!veiculo.marca || !veiculo.modelo || !veiculo.anoModelo) return { ok: false, motivo: 'marca, modelo e ano do modelo são necessários para consultar a FIPE' };
    try {
      const ref = await this.referencia();
      if (!this.cacheMarcas || this.cacheMarcas.ref !== ref) {
        this.cacheMarcas = { ref, marcas: await this.post<ModeloFipe[]>('ConsultarMarcas', { codigoTabelaReferencia: ref, codigoTipoVeiculo: CARRO }) };
        this.cacheModelos.clear();
      }
      const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      const marca = this.cacheMarcas.marcas.find((m) => n(m.Label) === n(veiculo.marca!))
        ?? this.cacheMarcas.marcas.find((m) => n(m.Label).includes(n(veiculo.marca!)) || n(veiculo.marca!).includes(n(m.Label)));
      if (!marca) return { ok: false, motivo: `marca "${veiculo.marca}" não encontrada na FIPE` };

      const chaveModelos = `${ref}:${marca.Value}`;
      let modelos = this.cacheModelos.get(chaveModelos);
      if (!modelos) {
        const r = await this.post<{ Modelos: ModeloFipe[] }>('ConsultarModelos', { codigoTabelaReferencia: ref, codigoTipoVeiculo: CARRO, codigoMarca: marca.Value });
        modelos = r.Modelos ?? [];
        this.cacheModelos.set(chaveModelos, modelos);
      }
      const escolha = escolherModeloFipe(veiculo.modelo, modelos);
      if (!escolha) {
        const semVersao = veiculo.modelo.trim().split(/\s+/).filter((p) => !/^(19|20)\d{2}$/.test(p)).length < 2;
        return {
          ok: false,
          motivo: semVersao
            ? `o modelo "${veiculo.modelo}" não diz a versão — informe como no documento do veículo (ex.: "HB20S 1.0 COMFORT")`
            : `modelo "${veiculo.modelo}" não casou com nenhum modelo ${marca.Label} da FIPE`,
        };
      }

      // O modelo escolhido pode não existir naquele ano — tenta as alternativas na ordem.
      for (const m of [escolha.modelo, ...escolha.alternativas]) {
        const anos = await this.post<ModeloFipe[]>('ConsultarAnoModelo', { codigoTabelaReferencia: ref, codigoTipoVeiculo: CARRO, codigoMarca: marca.Value, codigoModelo: m.Value });
        const ano = (anos ?? []).find((a) => String(a.Value).startsWith(`${veiculo.anoModelo}-`));
        if (!ano) continue;
        const [, combustivel] = String(ano.Value).split('-');
        const v = await this.post<{ Valor?: string; CodigoFipe?: string; Modelo?: string; Combustivel?: string; MesReferencia?: string; erro?: string }>('ConsultarValorComTodosParametros', {
          codigoTabelaReferencia: ref, codigoTipoVeiculo: CARRO, codigoMarca: marca.Value, codigoModelo: m.Value,
          ano: ano.Value, anoModelo: veiculo.anoModelo, codigoTipoCombustivel: Number(combustivel), tipoConsulta: 'tradicional',
        });
        const valor = v.Valor ? valorFipeParaCentavos(v.Valor) : null;
        if (!valor) continue;
        return {
          ok: true,
          fipe: {
            valor, codigoFipe: v.CodigoFipe ?? '', modeloFipe: (v.Modelo ?? m.Label).replace(/\s+/g, ' ').trim(),
            anoModelo: veiculo.anoModelo, combustivel: v.Combustivel ?? '', referencia: (v.MesReferencia ?? '').trim(),
            alternativas: escolha.alternativas.filter((a) => a.Value !== m.Value).map((a) => a.Label.replace(/\s+/g, ' ').trim()),
          },
        };
      }
      return { ok: false, motivo: `a FIPE não tem "${escolha.modelo.Label.trim()}" no ano ${veiculo.anoModelo}` };
    } catch (e) {
      this.logger.warn(`consulta FIPE falhou: ${(e as Error).message}`);
      return { ok: false, motivo: `consulta à FIPE falhou: ${(e as Error).message.slice(0, 120)}` };
    }
  }
}
