import { Injectable, Logger } from '@nestjs/common';
import { BigDataCorpService } from './bigdatacorp.service';

// Camada 1 da análise (doc 02 §20): critérios ELIMINATÓRIOS objetivos rodam de
// forma automática e TRANSPARENTE ao operador quando a proposta é enviada.
// Contatos/renda presumida/processos NÃO reprovam — viram alertas p/ análise.
//
// ⚠️ PLACEHOLDER (Regra 12): os limites abaixo são o padrão provisório validado
// em reunião (04/08) até existir a central de parâmetros da Camada 1 em tela —
// substituíveis sem tocar no fluxo. Situação aceita: REGULAR; idade 21–75.
const PARAMETROS_CAMADA1 = {
  situacoesAceitas: ['REGULAR'],
  idadeMinima: 21,
  idadeMaxima: 75,
  reprovarSemCadastroNoBureau: false, // não encontrado NÃO reprova — vira alerta
};

export interface ResultadoCamada1 {
  status: 'aprovado' | 'reprovado' | 'indisponivel';
  // Motivos INTERNOS (análise/diretoria) — nunca exibidos ao operador/cliente.
  motivos: string[];
  alertas: string[];
  dados: {
    simulado: boolean;
    nomeOficial: string | null;
    situacaoCpf: string | null;
    dataNascimento: string | null;
    idade: number | null;
    indicacaoObito: boolean;
    // Datasets financial_data + processes (decisão 08/08: a plataforma é uma
    // só, muda o dataset) — informações para o analista, nunca eliminatórias:
    faixaRendaPresumida: string | null;
    faixaPatrimonio: string | null;
    processosTotal: number | null;
    processosComoReu: number | null;
    protocolo: string | null;
  } | null;
  // Retorno COMPLETO do birô (decisão 09/08: TODA consulta guarda tudo — serve
  // à análise e fica vinculada ao cadastro do cliente).
  bruto?: unknown;
}

@Injectable()
export class Camada1Service {
  private readonly logger = new Logger(Camada1Service.name);

  constructor(private readonly bigDataCorp: BigDataCorpService) {}

  // true quando o ambiente tem o par TokenId+AccessToken (consulta REAL).
  get temCredenciaisReais(): boolean {
    return this.bigDataCorp.configurado;
  }

  async avaliar(cpf: string): Promise<ResultadoCamada1> {
    let d;
    try {
      d = await this.bigDataCorp.basicData(cpf.replace(/\D/g, ''));
    } catch (e) {
      // Birô fora do ar NÃO trava a venda (decisão 04/08): segue com alerta.
      this.logger.error(`Camada 1 indisponível: ${(e as Error).message}`);
      return {
        status: 'indisponivel',
        motivos: [],
        alertas: ['Camada 1 indisponível no envio da proposta — repetir a consulta na análise'],
        dados: null,
      };
    }

    const motivos: string[] = [];
    const alertas: string[] = [];

    if (!d.encontrado) {
      if (PARAMETROS_CAMADA1.reprovarSemCadastroNoBureau) {
        motivos.push('CPF não localizado no birô');
      } else {
        alertas.push('CPF não localizado no birô — validar manualmente na análise');
      }
    } else {
      if (d.situacaoCpf && !PARAMETROS_CAMADA1.situacoesAceitas.includes(d.situacaoCpf)) {
        motivos.push(`Situação do CPF na Receita: ${d.situacaoCpf}`);
      }
      if (d.indicacaoObito) motivos.push('Indicação de óbito no CPF');
      if (d.idade !== null) {
        if (d.idade < PARAMETROS_CAMADA1.idadeMinima) motivos.push(`Idade ${d.idade} abaixo do mínimo (${PARAMETROS_CAMADA1.idadeMinima})`);
        if (d.idade > PARAMETROS_CAMADA1.idadeMaxima) motivos.push(`Idade ${d.idade} acima do máximo (${PARAMETROS_CAMADA1.idadeMaxima})`);
      } else {
        alertas.push('Data de nascimento indisponível no birô');
      }
      // Processos e renda presumida NÃO reprovam (decisão 04/08): viram alerta/
      // informação para a análise manual.
      if ((d.processosTotal ?? 0) > 0) {
        alertas.push(
          `${d.processosTotal} processo(s) judicial(is)${d.processosComoReu ? ` — ${d.processosComoReu} como réu` : ''} — avaliar na análise`,
        );
      }
      if (!d.faixaRendaPresumida) alertas.push('Renda presumida indisponível no birô');
      if (d.simulado) alertas.push('Consulta SIMULADA (sem credenciais do birô no ambiente)');
    }

    return {
      status: motivos.length > 0 ? 'reprovado' : 'aprovado',
      motivos,
      alertas,
      dados: {
        simulado: d.simulado,
        nomeOficial: d.nomeOficial,
        situacaoCpf: d.situacaoCpf,
        dataNascimento: d.dataNascimento,
        idade: d.idade,
        indicacaoObito: d.indicacaoObito,
        faixaRendaPresumida: d.faixaRendaPresumida,
        faixaPatrimonio: d.faixaPatrimonio,
        processosTotal: d.processosTotal,
        processosComoReu: d.processosComoReu,
        protocolo: d.protocolo,
      },
      bruto: d.bruto ?? null,
    };
  }
}
