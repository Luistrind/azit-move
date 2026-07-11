// Contrato PADRÃO de compra e venda de veículo com reserva de domínio — layout
// extraído do modelo real em uso (ex.: contrato nº 2026040006, plataforma SuperSign).
// LAYOUT é fixo (cláusulas jurídicas); DADOS entram por placeholder {{...}}:
//   numero, dataAssinaturaLinha, compradoresBloco, garantidorBloco,
//   veiculo* (marca/anos/cor/placa/chassi/renavam/origem/combustivel/km),
//   valorTotal/Extenso, valorEntrada/Extenso, valorSaldo/Extenso,
//   numeroParcelas/Extenso, periodicidadePlural, valorParcela/Extenso,
//   dataPrimeiraParcela, vencimentoSubsequente, taxaMulta, taxaJuros,
//   compradorAssinatura (nome + CPF na seção de assinaturas).
// Assinatura digital externa (SuperSign etc.) é etapa da plataforma — fora do texto.
export const CONTRATO_VEICULO_TEMPLATE = `CONTRATO DE PROMESSA DE COMPRA E VENDA DE VEÍCULO AUTOMOTOR COM RESERVA DE DOMÍNIO

Nº {{numero}}

Partes:

VENDEDOR: (POP CARROS) AZIT COMERCIO DE VEICULOS LTDA, pessoa jurídica de direito privado, inscrita no CNPJ/MF sob o nº 57.265.780/0001-19, com sede na Rua José Machado, n° 103, bairro Tabuazeiro - Vitória/ES, contato whatsapp (27)99288-5193, e-mail contato@popcarros.com.br, doravante denominada simplesmente "VENDEDOR";

COMPRADOR:
{{compradoresBloco}}
{{garantidorBloco}}
1. COMUNICAÇÃO ENTRE AS PARTES

1.1. Meios de Comunicação Oficial: Para todos os efeitos deste Contrato, as partes elegem como meios de comunicação oficial o número de WhatsApp e o endereço de e-mail informados em suas qualificações, considerando-se recebida qualquer comunicação enviada por e-mail ou WhatsApp no mesmo dia do envio, se realizado até às 18h (horário local) em dia útil. Caso a comunicação seja enviada após esse horário ou em dia não útil, será considerada recebida no primeiro dia útil subsequente.

1.3. Alteração dos Dados de Contato: Qualquer alteração nos números de WhatsApp ou endereços de e-mail deverá ser comunicada à outra parte, por escrito, com antecedência mínima de 5 (cinco) dias úteis. Enquanto não for comunicada a alteração, continuarão válidos os números de WhatsApp e endereços de e-mail anteriormente informados.

1.4. Responsabilidade: Cada parte é responsável por garantir que os meios de comunicação informados estejam ativos, operacionais, e monitorados regularmente. A ausência de resposta ou a não visualização das comunicações enviadas por esses meios não eximirá a parte destinatária das responsabilidades decorrentes das comunicações enviadas.

2. OBJETO DO CONTRATO

2.1. O presente Contrato tem por objeto a compra e venda do veículo abaixo descrito, conforme as seguintes características:

Marca/Modelo: {{veiculoDescricao}}
Ano de Fabricação: {{veiculoAnoFabricacao}}
Ano do Modelo: {{veiculoAnoModelo}}
Cor: {{veiculoCor}}
Placa: {{veiculoPlaca}}
Número do Chassi: {{veiculoChassi}}
Número do RENAVAM: {{veiculoRenavam}}
Origem do Veículo: {{veiculoOrigem}}
Tipo de Combustível: {{veiculoCombustivel}}
Quilometragem Atual: {{veiculoKm}}

2.2. Condições do Veículo: As partes declaram que o veículo descrito na Cláusula 2.1 encontra-se em perfeito estado de conservação e funcionamento.

2.3. Inspeção Prévia: O COMPRADOR declara ter realizado uma inspeção completa e detalhada do veículo antes da assinatura deste contrato, estando plenamente ciente e de acordo com o estado atual do bem, suas condições de conservação e funcionamento, bem como todas as características técnicas e especificações mencionadas, de modo que aceita o veículo nas condições em que se encontra.

2.4. Reserva de Domínio: Nos termos dos artigos 521 a 528 do Código Civil, a propriedade do veículo objeto deste contrato permanecerá reservada ao VENDEDOR até a quitação integral de todas as obrigações assumidas pelo COMPRADOR, incluindo parcelas principais, encargos, multas, tributos, despesas acessórias e quaisquer valores decorrentes deste instrumento.

2.5. A reserva de domínio poderá ser registrada junto ao órgão de trânsito competente (DETRAN), para fins de publicidade e eficácia perante terceiros, autorizando desde já o COMPRADOR a assinatura de todos os documentos necessários à formalização do gravame.

2.6. Somente após a quitação integral das obrigações contratuais é que a propriedade plena será transferida ao COMPRADOR, comprometendo-se o VENDEDOR a fornecer os documentos necessários para a transferência definitiva.

3. VALOR E FORMA DE PAGAMENTO

3.1. Valor Total: O valor total da compra e venda objeto deste contrato é de {{valorTotal}} ({{valorTotalExtenso}}), conforme condições descritas nas cláusulas seguintes.

3.2. Condições de Pagamento: O valor total do veículo {{valorTotal}} ({{valorTotalExtenso}}) será pago da seguinte forma:
a) Entrada: {{valorEntrada}} ({{valorEntradaExtenso}}).
b) Saldo: {{valorSaldo}} ({{valorSaldoExtenso}}), pagos em {{numeroParcelas}} ({{numeroParcelasExtenso}}) parcelas {{periodicidadePlural}} e sucessivas, no valor inicial de {{valorParcela}} ({{valorParcelaExtenso}}) cada, vencendo-se a primeira em {{dataPrimeiraParcela}} e as demais {{vencimentoSubsequente}}.

3.3. Atualização Monetária: As parcelas serão reajustadas anualmente, com base na variação acumulada do IPCA (Índice Nacional de Preços ao Consumidor Amplo) dos últimos 12 (doze) meses, contados a partir da data de assinatura deste contrato. Caso o IPCA deixe de ser divulgado, será utilizado outro índice oficial que o substitua. O VENDEDOR informará ao COMPRADOR o novo valor da parcela com pelo menos 30 (trinta) dias de antecedência ao vencimento da primeira parcela reajustada.

3.4. Meios de Pagamento: As parcelas deverão ser pagas por meio de boleto bancário, PIX, link de pagamento ou cartão de crédito/débito, desde que a operação seja realizada em favor do VENDEDOR. O meio será disponibilizado pelo VENDEDOR e informado ao COMPRADOR com antecedência mínima de 3 (três) dias do vencimento. Eventuais custos de processamento, quando houver, serão de responsabilidade do COMPRADOR.

3.5. Reembolsos de Despesas: Fica estabelecido que eventuais reembolsos de despesas, tais como IPVA, licenciamento, multas, aluguel de dispositivos de monitoramento, seguros, serviços, manutenções e outras taxas relacionadas ao veículo, poderão ser cobrados conjuntamente com as parcelas.

3.6. Penalidades por Atraso: Em caso de atraso no pagamento de qualquer parcela, incidirá multa de {{taxaMulta}}% sobre o valor em atraso, acrescida de juros moratórios de {{taxaJuros}}% ao mês, calculados proporcionalmente ao número de dias de atraso, contados a partir do vencimento até a data do efetivo pagamento.

4. FASES DO CONTRATO

4.1. Período de Garantia: O Período de Garantia é o prazo durante o qual o VENDEDOR se compromete a reparar, sem custos para o COMPRADOR, eventuais defeitos relacionados ao motor e à caixa de câmbio do veículo, conforme as condições estabelecidas neste contrato. Durante esse período, o COMPRADOR deve observar as obrigações de manutenção e uso adequado do veículo, conforme descrito no contrato, para assegurar a validade da garantia.

4.2. Período de Aquisição: O Período de Aquisição tem início na data da assinatura deste contrato e perdura durante todo o período em que o COMPRADOR estiver realizando o pagamento das parcelas, conforme estabelecido neste instrumento, enquanto exerce a posse e o uso do veículo. Durante este período, o veículo permanecerá registrado em nome do VENDEDOR ou de quem este indicar, podendo, inclusive ser oferecido como garantia, pelo VENDEDOR, a seu exclusivo critério. O COMPRADOR, por sua vez, deterá a posse direta, ou seja, o direito de uso do bem, sendo o responsável pela manutenção e conservação do veículo, pelo cumprimento de todas as obrigações legais decorrentes do uso do automóvel, bem como pelo cumprimento das obrigações contratuais como a quitação das parcelas, o cuidado com o veículo e o pagamento de taxas, impostos e multas, até que o saldo devedor seja totalmente liquidado.

4.3. Período de Pós-Quitação: O Período de Pós-Quitação se inicia após a quitação integral de todas as parcelas e obrigações contratuais e legais previstas neste contrato. Neste período, o COMPRADOR adquire a propriedade plena do veículo, passando a ter o direito de transferi-lo para seu nome. O VENDEDOR, por sua vez, se compromete a providenciar a documentação necessária para a efetiva transferência da propriedade ao COMPRADOR.

5. GARANTIA DO VEÍCULO

5.1. Objeto da Garantia: O VENDEDOR concede ao COMPRADOR uma garantia legal e contratual sobre o veículo objeto deste contrato, limitada aos componentes de motor e caixa de câmbio, conforme especificado nesta cláusula.

5.2. Prazo da Garantia: A garantia tem validade total, já incluindo a garantia legal e contratual, de 90 (noventa) dias corridos, contados a partir da data da entrega do veículo ao COMPRADOR.

5.3. Cobertura da Garantia: A garantia cobre exclusivamente os defeitos de fabricação ou vícios ocultos nos componentes de motor e caixa de câmbio que comprometam o funcionamento normal do veículo. A garantia não cobre: a) Desgaste natural de peças e componentes em função do uso; b) Danos decorrentes de acidentes, uso indevido, negligência, ou manutenção inadequada; c) Danos causados por modificações ou alterações realizadas no veículo sem a autorização expressa do VENDEDOR; d) Danos decorrentes do uso de combustíveis, lubrificantes, ou fluidos não recomendados pelo fabricante do veículo.

5.4. Condições para a Validade da Garantia: Para que a garantia seja válida, o COMPRADOR deve: a) Utilizar o veículo de acordo com as especificações do fabricante e as normas de trânsito vigentes; b) Realizar a manutenção preventiva e corretiva conforme o manual do proprietário e recomendações do fabricante; c) Informar imediatamente ao VENDEDOR qualquer anomalia ou defeito percebido no motor ou caixa de câmbio, antes de realizar qualquer reparo ou modificação; d) Permitir que o VENDEDOR, ou profissional por ele indicado, realize a inspeção e o reparo do veículo, se necessário.

5.5. Procedimento em Caso de Defeito: Em caso de defeito coberto pela garantia, o COMPRADOR deverá: a) Notificar o VENDEDOR por escrito, detalhando a natureza do defeito e as circunstâncias em que foi detectado; b) Disponibilizar o veículo para inspeção no local designado pelo VENDEDOR, no prazo máximo de 7 (sete) dias úteis após a notificação.

5.6. Reparos e Substituições: Se constatado o defeito coberto pela garantia, o VENDEDOR se compromete a realizar o reparo ou a substituição das peças defeituosas, sem qualquer custo para o COMPRADOR. Os reparos serão realizados no prazo máximo de 60 (sessenta) dias, contados a partir da data de entrega do veículo para conserto.

5.7. Limitações da Garantia: A garantia não se aplica em casos de: a) Uso do veículo em competições, ralis, ou atividades que exijam desempenho acima das condições normais de uso; b) Modificações realizadas no motor ou caixa de câmbio por terceiros não autorizados pelo VENDEDOR; c) Falta de manutenção preventiva ou uso de peças e componentes não originais ou não recomendados pelo fabricante.

5.8. Legislação Aplicável: Esta cláusula de garantia está em conformidade com o Código de Defesa do Consumidor (Lei nº 8.078/1990), em especial os artigos 18 e 26, que regulam a responsabilidade por vícios de qualidade e os prazos de reclamação.

6. RESPONSABILIDADES DO COMPRADOR

6.1. Manutenção e Conservação do Veículo: O COMPRADOR compromete-se a manter o veículo em perfeito estado de conservação e funcionamento durante todo o período de vigência deste contrato, realizando todas as manutenções preventivas e corretivas necessárias, conforme as recomendações do fabricante e as especificações constantes no manual do proprietário. Quaisquer modificações, reparos, ou substituições de peças deverão ser realizados com componentes originais ou de qualidade equivalente, exclusivamente em oficinas indicadas pelo VENDEDOR.

6.2. Modificações e Personalização do Veículo: Qualquer modificação, personalização ou alteração no veículo, incluindo, mas não se limitando a, alterações na pintura, instalação de acessórios, modificações na estrutura, ou qualquer outro tipo de personalização, só poderá ser realizada com a autorização prévia e expressa do VENDEDOR. Modificações realizadas sem essa autorização podem ser consideradas descumprimento contratual, sujeitas às penalidades previstas neste contrato, incluindo a possível rescisão do mesmo e a exigência de restituição do veículo ao seu estado original, às custas do COMPRADOR.

6.3. Uso Adequado do Veículo: O COMPRADOR deverá utilizar o veículo de forma adequada e em conformidade com as normas de trânsito vigentes e as especificações técnicas do fabricante. É vedada a utilização do veículo para fins diversos daqueles a que se destina, como em competições, ralis, transporte de carga acima do permitido, ou qualquer outra atividade que possa comprometer a segurança e a integridade do veículo.

6.4. Responsabilidade por Multas e Encargos: O COMPRADOR é responsável pelo pagamento integral de todas as multas, impostos, taxas e demais encargos decorrentes do uso do veículo a partir da assinatura do contrato. O VENDEDOR realizará o monitoramento ativo de tais ocorrências e informará ao COMPRADOR sempre que identificado algum débito, incluindo os respectivos valores nas cobranças periódicas para assegurar a regularidade contratual. O não reembolso desses valores no prazo indicado poderá acarretar o vencimento antecipado das parcelas e demais medidas previstas neste contrato.

6.5. Proteção Veicular: O COMPRADOR é responsável pela proteção do veículo contra riscos como colisão, furto, roubo, incêndio e danos a terceiros. Para facilitar esse processo, o VENDEDOR realizará a contratação da proteção veicular junto a fornecedor competente, em nome do COMPRADOR, incluindo o valor correspondente nas cobranças periódicas. A responsabilidade por comunicar sinistros e acompanhar os procedimentos junto à proteção contratada é exclusivamente do COMPRADOR.

6.6. Comunicação de Sinistros e Avarias: O COMPRADOR deverá comunicar imediatamente ao VENDEDOR qualquer sinistro, avaria, ou defeito ocorrido com o veículo, detalhando as circunstâncias e providências tomadas. No caso de sinistros que resultem em perda total, furto, ou roubo do veículo, o contrato será rescindido automaticamente, sem prejuízo das responsabilidades do COMPRADOR, que deverá restituir integralmente o saldo devedor, descontando-se o valor da indenização recebida pelo seguro, se houver.

6.7. Condutor Principal e Comunicação ao DETRAN: O COMPRADOR autoriza expressamente o VENDEDOR a registrá-lo como condutor principal do veículo junto ao DETRAN, assumindo total responsabilidade por todas as infrações, penalidades, encargos e demais obrigações legais decorrentes do uso e condução do veículo, a partir da data de entrega da posse.

6.8. Danos a Terceiros: O COMPRADOR assume total responsabilidade por quaisquer danos causados a terceiros durante o uso do veículo, após a assinatura deste Contrato, sendo obrigado a arcar com todas as despesas decorrentes de eventuais processos judiciais ou administrativos, indenizações, ou acordos extrajudiciais que venham a ser necessários.

6.9. Vistoria Periódica: O COMPRADOR deverá apresentar o veículo, a cada 15 (quinze) dias, no endereço indicado pelo VENDEDOR, para realização de vistoria obrigatória quanto ao estado de conservação e cumprimento das obrigações contratuais. A ausência injustificada ou o não comparecimento nas datas agendadas caracteriza descumprimento contratual, sujeito às penalidades previstas neste contrato.

6.10. Outras Responsabilidades Legais: O COMPRADOR é o responsável legal pelo pagamento do IPVA, DPVAT, licenciamento anual e demais obrigações legais relacionadas ao uso e posse do veículo. Para garantir a regularidade contratual, a VENDEDORA realizará a gestão desses vencimentos e integrará os respectivos valores nas cobranças periódicas. O não pagamento poderá ser considerado descumprimento contratual, sujeito às penalidades previstas neste contrato.

6.11. Legislação Aplicável: Esta cláusula está em conformidade com as disposições do Código Civil (Lei nº 10.406/2002) e do Código de Defesa do Consumidor (Lei nº 8.078/1990), que regulam as responsabilidades do possuidor e usuário de bens móveis.

7. MONITORAMENTO E CONTROLE DO VEÍCULO

7.1. Instalação de Dispositivos de Monitoramento: O VENDEDOR poderá instalar, a seu critério, dispositivos de monitoramento e controle remoto no veículo, como sistemas de telemetria, rastreamento por GPS, e bloqueio remoto. Estes dispositivos têm como finalidade principal garantir a segurança do veículo, monitorar seu uso e, se necessário, proteger os interesses do VENDEDOR em casos de inadimplência ou uso indevido do bem.

7.2. Autorização do COMPRADOR: Ao assinar este contrato, o COMPRADOR autoriza expressamente a instalação, manutenção e uso dos dispositivos mencionados na Cláusula 7.1 pelo VENDEDOR. O COMPRADOR concorda em não remover, desativar ou interferir no funcionamento desses dispositivos sem a autorização prévia e expressa do VENDEDOR.

7.3. Acesso às Informações de Monitoramento: O VENDEDOR terá acesso a todas as informações geradas pelos dispositivos de monitoramento, incluindo dados de localização, velocidade, eventos de condução, e outros parâmetros relacionados ao uso do veículo. O VENDEDOR se compromete a utilizar essas informações exclusivamente para os fins previstos neste contrato, respeitando a privacidade do COMPRADOR dentro dos limites estabelecidos pela legislação vigente, especialmente a Lei Geral de Proteção de Dados Pessoais (LGPD - Lei nº 13.709/2018).

7.4. Uso dos Dispositivos em Casos de Inadimplência: Em caso de inadimplência por parte do COMPRADOR, o VENDEDOR poderá utilizar os dispositivos de monitoramento e controle para localizar e, se necessário, realizar o bloqueio remoto do veículo até que a situação seja regularizada. O bloqueio remoto será realizado de forma a garantir a segurança do veículo e de terceiros, evitando situações de risco.

7.5. Responsabilidade por Interferência nos Dispositivos: O COMPRADOR será responsabilizado por qualquer dano, interferência, ou tentativa de remoção dos dispositivos de monitoramento e controle instalados no veículo. Em caso de violação, o VENDEDOR poderá tomar as medidas legais cabíveis, incluindo a rescisão contratual e o acionamento de autoridades competentes, além de exigir reparação por eventuais danos causados.

7.6. Manutenção dos Dispositivos: O VENDEDOR será responsável pela instalação e manutenção dos dispositivos de monitoramento e controle, garantindo seu funcionamento adequado durante o período de vigência deste contrato. O COMPRADOR deverá permitir o acesso do VENDEDOR ou de seus representantes ao veículo para a realização de inspeções e manutenções necessárias.

7.7. Área de Circulação: Por motivos de segurança e gestão de risco, o COMPRADOR somente poderá circular com o veículo dentro do território do Estado do Espírito Santo. Caso deseje utilizar o veículo fora desse limite, deverá solicitar autorização prévia e expressa do VENDEDOR, que avaliará o destino e o trajeto com base em critérios de risco, incluindo áreas com alta incidência de roubo ou furto. O descumprimento desta cláusula poderá resultar em bloqueio remoto imediato do veículo, retomada administrativa e aplicação das demais medidas contratuais e legais cabíveis.

7.8. Legislação Aplicável: Esta cláusula está em conformidade com as disposições da Lei Geral de Proteção de Dados Pessoais (LGPD - Lei nº 13.709/2018) e demais legislações aplicáveis, que regulam o uso de tecnologias de monitoramento e a proteção dos dados pessoais.

8. INADIMPLÊNCIA

8.1. Caracterização da Inadimplência: Considera-se inadimplência o não pagamento, total ou parcial, de qualquer parcela ou obrigação financeira prevista neste contrato, no prazo estabelecido, incluindo, mas não se limitando a, multas, taxas, impostos, e quaisquer encargos relacionados ao veículo.

8.2. Consequências da Inadimplência: A partir do primeiro dia de atraso, incidirá multa moratória de {{taxaMulta}}% sobre o valor da obrigação em atraso, acrescida de juros de {{taxaJuros}}% ao mês, calculados pro rata die.

8.3. Bloqueio e Retomada Imediata: O VENDEDOR poderá, a partir do primeiro dia de inadimplência, bloquear remotamente o veículo e iniciar o processo de retomada administrativa da posse, independentemente de notificação judicial.

8.4. Vencimento Antecipado: Na hipótese de inadimplência por período superior a 30 (trinta) dias, o VENDEDOR poderá considerar vencidas antecipadamente todas as parcelas futuras, exigindo o pagamento integral do saldo devedor. Neste caso, o COMPRADOR será notificado formalmente, conforme os meios de comunicação oficiais estabelecidos na Cláusula 1 deste contrato para que promova a quitação da dívida.

8.4.1. O não pagamento, pelo COMPRADOR, no prazo previsto no item 8.4, constitui cláusula resolutiva expressa, autorizando a imediata resolução do Contrato, podendo o VENDEDOR exercer seu direito de retomada do bem imediatamente, independentemente de decisão judicial.

8.4.2. Com a rescisão do Contrato, na forma prevista no Item 8.4.1., o VENDEDOR terá direito de reter 80% dos valores pagos até então, a título de:
I – indenização pela fruição do veículo durante o período de posse;
II – compensação pela depreciação natural e comercial do bem;
III – cobertura dos custos administrativos, comerciais, financeiros e operacionais;

8.4.2.1. O COMPRADOR expressamente reconhece que tais valores possuem natureza indenizatória e compensatória, não constituindo penalidade abusiva, mas recomposição de prejuízos efetivos.

8.5. Suspensão dos Direitos do COMPRADOR: Durante o período de inadimplência, o VENDEDOR poderá suspender os direitos do COMPRADOR sobre o uso e posse do veículo, inclusive o direito de transferir a propriedade do veículo para seu nome, até que a situação seja regularizada.

8.6. Custeio das Despesas de Retomada: Todos os custos relacionados à retomada do veículo, incluindo, mas não se limitando a, despesas com transporte, armazenagem, manutenção, reparos, custas processuais e honorários advocatícios serão de responsabilidade do COMPRADOR inadimplente.

8.7. Cobrança Judicial e Extrajudicial: Em caso de inadimplência não sanada, o VENDEDOR poderá recorrer a medidas de cobrança judicial e extrajudicial para garantir o cumprimento das obrigações contratuais. O COMPRADOR será responsável pelo pagamento de todos os custos e honorários advocatícios decorrentes de tais medidas.

8.8. Inserção em Cadastros de Inadimplentes: O VENDEDOR reserva-se o direito de inserir o nome do COMPRADOR em cadastros de proteção ao crédito, como SPC e SERASA, após a caracterização da inadimplência e o esgotamento das tentativas de cobrança amigável.

8.9. Legislação Aplicável: Esta cláusula está em conformidade com as disposições do Código Civil (Lei nº 10.406/2002) e do Código de Defesa do Consumidor (Lei nº 8.078/1990), que regulam as obrigações contratuais e as consequências da inadimplência.

9. TRANSFERÊNCIA DE PROPRIEDADE E TAXAS

9.1. Transferência da Propriedade: A transferência da propriedade do veículo do VENDEDOR para o COMPRADOR será efetivada somente após a quitação integral de todas as parcelas e demais obrigações financeiras previstas neste contrato, incluindo eventuais multas, juros, taxas, impostos e outras despesas relacionadas ao veículo.

9.2. Documentação Necessária: Após a quitação integral, o VENDEDOR se compromete a providenciar toda a documentação necessária para a transferência da propriedade do veículo, incluindo a Autorização para Transferência de Propriedade do Veículo (ATPV) devidamente preenchida e assinada, e quaisquer outros documentos exigidos pelos órgãos de trânsito competentes.

9.3. Prazo para Transferência: A transferência da propriedade deverá ser iniciada pelo COMPRADOR dentro do prazo de 30 (trinta) dias corridos a partir da data de quitação integral do contrato. O não cumprimento desse prazo poderá acarretar a aplicação de multas e outras penalidades previstas pelo Código de Trânsito Brasileiro (Lei nº 9.503/1997), sendo o COMPRADOR integralmente responsável pelo pagamento dessas multas e encargos.

9.4. Custos e Taxas de Transferência: Todos os custos e taxas relacionados à transferência da propriedade do veículo, incluindo taxas de registro, emolumentos cartorários, despachantes, e quaisquer outras despesas associadas ao processo de transferência, serão de responsabilidade exclusiva do COMPRADOR.

9.5. Responsabilidade por Infrações: Até que a transferência de propriedade seja devidamente registrada no DETRAN, o COMPRADOR permanece como responsável por todas as infrações de trânsito e demais responsabilidades civis e criminais decorrentes do uso do veículo.

9.6. Obrigações do VENDEDOR: O VENDEDOR se compromete a fornecer ao COMPRADOR toda a assistência necessária para a correta e rápida transferência da propriedade, incluindo a disponibilização de documentos, assinatura de formulários, e orientação sobre o procedimento junto aos órgãos competentes.

9.7. Impedimentos à Transferência: Caso existam impedimentos legais ou administrativos que impossibilitem a transferência da propriedade do veículo, o VENDEDOR se compromete a solucionar tais pendências no menor tempo possível. O prazo para regularização será acordado entre as partes, e durante esse período, o COMPRADOR não poderá ser penalizado ou cobrado por atrasos na transferência.

9.8. Não Transferência em Caso de Rescisão: Em caso de rescisão contratual antes da quitação integral das obrigações financeiras, seja por inadimplência ou qualquer outro motivo, a propriedade do veículo permanecerá em nome do VENDEDOR, e nenhuma transferência será realizada junto ao DETRAN. Nessa hipótese, o COMPRADOR deverá devolver o veículo imediatamente, nas condições previstas neste contrato. Os valores já pagos poderão ser retidos, total ou parcialmente, conforme as regras de devolução, compensação ou dedução previstas neste instrumento, não cabendo ao COMPRADOR qualquer direito à propriedade do bem.

9.9. Legislação Aplicável: Esta cláusula está em conformidade com as disposições do Código de Trânsito Brasileiro (Lei nº 9.503/1997) e do Código Civil (Lei nº 10.406/2002), que regulam a transferência de propriedade de veículos automotores e as responsabilidades das partes envolvidas.

10. ISENÇÃO DE RESPONSABILIDADE POR DÍVIDAS ANTERIORES

O COMPRADOR fica expressamente isento de qualquer responsabilidade por dívidas, obrigações ou passivos anteriores à assinatura deste contrato, incluindo dívidas trabalhistas, processos de falência, pedidos de recuperação judicial e pendências fiscais ou tributárias do VENDEDOR. O VENDEDOR assume integralmente tais responsabilidades, isentando o COMPRADOR de qualquer ônus, e se compromete a arcar com todos os custos e despesas decorrentes de eventuais reivindicações ou sanções relacionadas a essas obrigações.

11. TOLERÂNCIA

A eventual tolerância, por parte do VENDEDOR, quanto ao descumprimento de qualquer cláusula ou condição deste contrato pelo COMPRADOR não constituirá novação, renúncia ou alteração das disposições contratuais, nem prejudicará o direito do VENDEDOR de exigir o cumprimento integral das obrigações previstas neste contrato a qualquer tempo.

12. PENALIDADES ADICIONAIS

12.1. Descumprimento de Obrigações Contratuais: Em caso de descumprimento de qualquer obrigação estabelecida neste contrato pelo COMPRADOR, além das penalidades já previstas nas cláusulas específicas, poderá ser aplicada uma multa adicional de 10% (dez por cento) sobre o valor total do contrato, sem prejuízo da exigibilidade das demais obrigações e da adoção das medidas legais cabíveis.

12.2. Danos ao Veículo: Caso sejam constatados danos ao veículo que não sejam decorrentes do uso regular e apropriado, ou que sejam resultado de negligência, mau uso, ou falta de manutenção adequada, o COMPRADOR será responsabilizado pelo custo integral dos reparos necessários, além de uma multa equivalente a 5% (cinco por cento) do valor de mercado do veículo, conforme a tabela FIPE vigente.

12.3. Atraso na Devolução do Veículo: No caso de devolução tardia do veículo após o término do contrato ou sua rescisão, será aplicada uma multa diária de 1% (um por cento) sobre o valor de mercado do veículo, conforme a tabela FIPE vigente, até a efetiva devolução do bem ao VENDEDOR.

12.4. Interferência nos Dispositivos de Monitoramento: Se o COMPRADOR remover, desativar ou interferir nos dispositivos de monitoramento e controle instalados no veículo, conforme previsto na Cláusula 7, será aplicada uma multa adicional de 10% (dez por cento) sobre o valor total do contrato, além da obrigação de reparar qualquer dano causado ao sistema de monitoramento.

12.5. Acionamento de Garantias Contratuais: Caso o VENDEDOR precise acionar garantias contratuais devido ao descumprimento das obrigações por parte do COMPRADOR, as despesas decorrentes do acionamento e a reparação dos danos serão de responsabilidade exclusiva do COMPRADOR, além de uma multa adicional de 10% (dez por cento) sobre o valor total do contrato.

12.6. Legislação Aplicável: Esta cláusula está em conformidade com as disposições do Código Civil (Lei nº 10.406/2002) e demais legislações aplicáveis, assegurando a aplicação de penalidades justas e proporcionais ao descumprimento das obrigações contratuais.

13. PROTEÇÃO DE DADOS

13.1. Coleta e Tratamento de Dados Pessoais: As partes concordam que os dados pessoais coletados e tratados no âmbito deste contrato serão utilizados exclusivamente para a execução e cumprimento das obrigações contratuais. O VENDEDOR se compromete a tratar os dados pessoais do COMPRADOR em conformidade com a Lei Geral de Proteção de Dados Pessoais (LGPD - Lei nº 13.709/2018), garantindo que tais dados sejam processados de maneira lícita, justa e transparente.

13.2. Finalidade e Limitação de Uso: Os dados pessoais fornecidos pelo COMPRADOR serão utilizados para fins diretamente relacionados à execução do presente contrato, como comunicação entre as partes, emissão de boletos, cobrança de valores, cumprimento de obrigações fiscais e legais. Adicionalmente, o VENDEDOR poderá utilizar os dados, de forma anonimizada ou pseudonimizada sempre que aplicável, para fins de enriquecimento de modelos analíticos e preditivos, tais como modelos de risco de crédito, perfil de uso e comportamento, eficiência operacional, bem como para personalização e otimização de ofertas de produtos e serviços. O tratamento desses dados observará estritamente os princípios e limites estabelecidos pela Lei Geral de Proteção de Dados Pessoais (LGPD – Lei nº 13.709/2018), incluindo a garantia de segurança, confidencialidade e transparência no uso das informações.

13.3. Compartilhamento de Dados: Os dados pessoais do COMPRADOR poderão ser compartilhados com terceiros apenas quando necessário para a execução deste contrato, como instituições financeiras, empresas de cobrança, despachantes, e órgãos de trânsito. Em tais casos, o VENDEDOR se compromete a garantir que esses terceiros tratem os dados pessoais com o mesmo nível de proteção exigido pela LGPD.

13.4. Direitos do COMPRADOR: O COMPRADOR tem o direito de acessar, corrigir, atualizar, ou solicitar a exclusão de seus dados pessoais tratados pelo VENDEDOR, conforme previsto na LGPD. O COMPRADOR também pode solicitar informações sobre o tratamento de seus dados e exercer seus direitos através dos canais de comunicação estabelecidos neste contrato.

13.5. Segurança dos Dados: O VENDEDOR se compromete a adotar todas as medidas técnicas e administrativas adequadas para proteger os dados pessoais do COMPRADOR contra acessos não autorizados, perda, destruição, alteração ou qualquer outra forma de tratamento inadequado ou ilícito.

13.6. Retenção de Dados: Os dados pessoais do COMPRADOR serão retidos pelo tempo necessário para a execução deste contrato e para o cumprimento de obrigações legais e regulatórias. Após o término do contrato e o cumprimento de todas as obrigações legais, os dados pessoais poderão ser eliminados, salvo disposição legal em contrário.

13.7. Legislação Aplicável: Esta cláusula está em conformidade com a Lei Geral de Proteção de Dados Pessoais (LGPD - Lei nº 13.709/2018) e demais legislações aplicáveis, garantindo que os dados pessoais do COMPRADOR sejam tratados de acordo com os mais altos padrões de segurança e privacidade.

13.8. Responsabilidade por Violação de Dados: Em caso de violação de dados pessoais que possa resultar em risco ou dano relevante ao COMPRADOR, o VENDEDOR se compromete a informar o ocorrido ao COMPRADOR e à Autoridade Nacional de Proteção de Dados (ANPD) em conformidade com a LGPD, e a tomar todas as medidas necessárias para mitigar os efeitos da violação.

14. AUTORIZAÇÃO DE USO DE IMAGEM

O COMPRADOR autoriza expressamente o VENDEDOR a utilizar sua imagem, voz e nome em fotos, vídeos, depoimentos ou outros meios de captação, para fins de divulgação institucional e publicitária relacionados às atividades do VENDEDOR e de seus parceiros, em qualquer meio físico ou digital. Esta autorização é gratuita, por prazo indeterminado, podendo ser revogada mediante comunicação formal com antecedência mínima de 30 (trinta) dias, sem prejuízo das divulgações já realizadas.

15. CLÁUSULAS GERAIS

15.1. A seu exclusivo critério, sem a necessidade de anuência do COMPRADOR, o VENDEDOR poderá ceder total ou parcialmente os direitos decorrentes deste Contrato a quem interessar possa, desde que o Interessado mantenha vigente o presente Contrato.

15.2. A seu exclusivo critério, sem a necessidade de anuência do COMPRADOR, o VENDEDOR poderá, durante o período de aquisição, dar o veículo objeto do Contrato em garantia para terceiros.

15.3. Na forma do art. 784, III, do Código de Processo Civil, o presente contrato é título executivo extrajudicial, podendo ser assim exigido de imediato, caso necessário.

15.4. Este contrato poderá ser assinado digitalmente pelas partes, por meio de plataformas eletrônicas seguras e certificadas, com validade jurídica nos termos da Medida Provisória nº 2.200-2/2001 e do artigo 10 da Lei nº 14.063/2020.

17. RESOLUÇÃO DE CONFLITOS

17.1. Negociação Amigável: As partes concordam em tentar resolver qualquer divergência decorrente deste contrato por meio de negociação amigável, dentro do prazo de 30 (trinta) dias corridos após a comunicação do conflito.

17.2. Foro de Eleição: Caso a negociação amigável não seja viável, as partes elegem o foro da Comarca de VITORIA/ES, como competente para dirimir qualquer questão decorrente deste contrato.

{{dataAssinaturaLinha}}

VENDEDOR:

___________________________________________
AZIT COMERCIO DE VEICULOS LTDA
CNPJ: 57.265.780/0001-19


COMPRADOR:

___________________________________________
{{compradorAssinatura}}
{{assinaturasAdicionais}}

TESTEMUNHAS:

1) _________________________________
Nome:
CPF:

2) ________________________________
Nome:
CPF:`;
