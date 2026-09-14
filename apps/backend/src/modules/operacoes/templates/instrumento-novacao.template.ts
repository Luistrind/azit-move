// Instrumento da NOVAÇÃO (doc adaptações 13/09, A2/A6) — os DOIS contratos
// assinados no MESMO ATO: Contrato 1 (novação do veículo, credor = estrutura
// dona do ativo) e Contrato 2 (Termo de Regularização de Débitos, credor =
// Azit Move). ⚠️ PLACEHOLDER FUNCIONAL (Regra 12): texto enxuto a validar
// pelo jurídico (inclusive a cláusula de inadimplência cruzada — aberto no
// doc de adaptações); a estrutura de dados é definitiva.
// Marcadores {{chave}} são resolvidos por renderTemplate (@azit/utils).
export const INSTRUMENTO_NOVACAO_TEMPLATE = `# INSTRUMENTO PARTICULAR DE NOVAÇÃO DE DÍVIDA

## Partes

**CLIENTE:** {{nomeCliente}}, CPF {{cpfCliente}}, telefone {{telefoneCliente}}.

**CREDORA DO CONTRATO 1:** {{razaoCredoraVeiculo}} (estrutura titular do veículo).

**CREDORA DO CONTRATO 2:** Azit Move.

## Objeto

Pelo presente instrumento, as partes **novam** as obrigações em aberto do CLIENTE junto às
CREDORAS, apuradas na data-base de {{dataBase}} no valor total de **{{saldoTotal}}
({{saldoTotalExtenso}})**, que ficam **extintas** e substituídas pelos dois contratos abaixo,
celebrados e assinados **no mesmo ato**.

## Contrato 1 — Novação do veículo (nº {{numeroContratoVeiculo}})

Saldo novado da parte do veículo: **{{saldoVeiculo}} ({{saldoVeiculoExtenso}})**, acrescido da
taxa inicial de processamento de {{taxaInicial}}{{descontoLinha}}, a pagar em
**{{parcelasVeiculo}} ({{parcelasVeiculoExtenso}}) parcelas {{periodicidadePlural}} de
{{valorParcela}} ({{valorParcelaExtenso}})**, precedidas da fase do Contrato 2 conforme a
cláusula de sequenciamento. Permanece a reserva de domínio sobre o veículo
**{{descricaoVeiculo}}**.{{trocaLinha}}

## Contrato 2 — Termo de Regularização de Débitos (nº {{numeroContratoTermo}})

Saldo dos demais produtos (reembolsos, seguro vencido e regularizações anteriores):
**{{saldoDemais}} ({{saldoDemaisExtenso}})**, a pagar em **{{parcelasTermo}} parcelas
{{periodicidadePlural}}** no mesmo valor periódico de {{valorParcela}}.

## Sequenciamento e fatura de transição

1. As parcelas do Contrato 2 ocupam as **primeiras faturas** do relacionamento novado.
2. A última parcela do Contrato 2 é completada, na mesma fatura ("fatura de transição"),
   por uma **antecipação de {{antecipacaoTransicao}}** do Contrato 1, que amortiza o saldo
   do veículo antes do início do cronograma dele.
3. Durante a fase do Contrato 2, o saldo do Contrato 1 permanece **congelado**, sem
   incidência de juros.

## Recebimento inicial

{{recebimentoLinha}}

## Disposições gerais

1. A ativação dos contratos ocorre com a assinatura deste instrumento por todas as partes
   {{condicaoRecebimento}}.
2. O não pagamento de qualquer parcela sujeita o CLIENTE à régua de cobrança, com multa e
   juros de mora da regra geral, sem prejuízo das demais medidas contratuais.
3. O inadimplemento do Contrato 2 configura inadimplemento do conjunto da operação
   (inadimplência cruzada — redação final a critério do jurídico).

{{dataAssinaturaLinha}}

_______________________________________
{{nomeCliente}}
CPF: {{cpfCliente}}

_______________________________________
Pela Azit Move e pela estrutura credora do Contrato 1

**Testemunhas** (art. 784, III, CPC):

_______________________________________
{{testemunha1Linha}}

_______________________________________
{{testemunha2Linha}}
`;
