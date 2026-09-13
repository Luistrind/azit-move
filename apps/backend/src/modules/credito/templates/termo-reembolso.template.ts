// Termo do Reembolso Parcelado (doc 02 §18.5, 13/09) — mini contrato assinado
// via ZapSign ANTES do cronograma nascer. ⚠️ PLACEHOLDER FUNCIONAL (Regra 12):
// texto enxuto a validar pelo jurídico; a estrutura de dados é definitiva.
// Marcadores {{chave}} são resolvidos por renderTemplate (@azit/utils).
export const TERMO_REEMBOLSO_TEMPLATE = `# TERMO DE REEMBOLSO PARCELADO

**Contrato nº {{numeroContrato}}**

## Partes

**CREDORA:** {{razaoCredora}}, que pagará diretamente ao fornecedor indicado pelo CLIENTE.

**CLIENTE:** {{nomeCliente}}, CPF {{cpfCliente}}, telefone {{telefoneCliente}}.

## Objeto

A CREDORA pagará **à vista**, por conta e ordem do CLIENTE, o valor de **{{valorPrincipal}}
({{valorPrincipalExtenso}})** diretamente ao fornecedor **{{nomeFornecedor}}** ({{docFornecedor}}),
referente a: {{finalidade}}.

## Obrigação do cliente

Em contrapartida, o CLIENTE pagará à CREDORA o valor total de **{{valorTotal}}
({{valorTotalExtenso}})**, composto do principal acrescido da taxa inicial de processamento de
{{taxaInicial}} (financiada) e dos encargos de {{encargoMensal}} ao mês, em
**{{qtdeParcelas}} ({{qtdeParcelasExtenso}}) parcelas {{periodicidadePlural}} de {{valorParcela}}
({{valorParcelaExtenso}})**, lançadas nas faturas já existentes da sua conta, a partir de
{{dataPrimeiraParcela}}.

## Condições

1. O pagamento ao fornecedor será realizado pela CREDORA após a assinatura deste termo por
   todas as partes, pela esteira normal do financeiro da CREDORA.
2. O não pagamento das parcelas sujeita o CLIENTE à régua de cobrança do contrato, com multa
   e juros de mora da regra geral, sem prejuízo das demais medidas contratuais.
3. Este termo vincula-se à conta do CLIENTE junto à CREDORA e independe do veículo financiado.

{{dataAssinaturaLinha}}

_______________________________________
{{nomeCliente}}
CPF: {{cpfCliente}}
CLIENTE

_______________________________________
{{razaoCredora}}
CREDORA

**Testemunhas:**

_______________________________________
{{testemunha1Linha}}

_______________________________________
{{testemunha2Linha}}
`;
