// Termo de Confissão de Dívida e Acordo de Parcelamento — base jurídica fornecida
// pelo Luís (Template_Acordo_Parcelamento_Azit.docx, 18/08/2026), ADAPTADA às
// decisões do doc 02 §7.7 (2026-08-18): o acordo vincula-se às FATURAS da conta
// (que agregam itens de vários contratos/produtos), não a um único contrato —
// os contratos de origem entram no plural e a reserva de domínio de cada um
// permanece intacta. Placeholders {{...}} preenchidos pelo motor (RAP031).
export const TERMO_ACORDO_TEMPLATE = `TERMO DE CONFISSÃO DE DÍVIDA E ACORDO DE PARCELAMENTO

Acordo nº {{numeroAcordo}} | Vinculado às faturas da conta do(a) DEVEDOR(A) discriminadas na Cláusula 1ª

DAS PARTES

CREDORA: (Azit Move) AZIT COMÉRCIO DE VEÍCULOS LTDA, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº 57.265.780/0001-19, com sede na Rua José Machado, n° 103, bairro Tabuazeiro - Vitória/ES, neste ato representada na forma de seu contrato social, doravante denominada simplesmente CREDORA.

DEVEDOR(A): {{nomeCliente}}, portador(a) do CPF nº {{cpfCliente}}, residente e domiciliado(a) conforme cadastro mantido junto à CREDORA, telefone/WhatsApp {{telefoneCliente}}, e-mail {{emailCliente}}, doravante denominado(a) simplesmente DEVEDOR(A).

CONSIDERANDO QUE

(i) as partes mantêm relação contratual por meio do(s) seguinte(s) instrumento(s), permanecendo a propriedade do(s) veículo(s) com a CREDORA até a quitação integral do preço, quando aplicável: {{contratosOrigem}};
(ii) o(a) DEVEDOR(A) encontra-se em atraso no pagamento das faturas discriminadas na Cláusula 1ª deste instrumento, faturas que agregam obrigações dos instrumentos acima e demais itens contratados (tais como proteção veicular e serviços);
(iii) as partes desejam, de boa-fé, ajustar condições especiais para a regularização exclusivamente das faturas vencidas, sem qualquer alteração das demais parcelas, prazos e condições dos instrumentos de origem;

resolvem celebrar o presente Termo de Confissão de Dívida e Acordo de Parcelamento ("Acordo"), que se regerá pelas cláusulas seguintes.

CLÁUSULA 1ª — DO RECONHECIMENTO E DA CONFISSÃO DA DÍVIDA

1.1. O(A) DEVEDOR(A) reconhece e confessa, de forma livre, irrevogável e irretratável, ser devedor(a) da CREDORA da quantia total de {{valorTotalConfessado}} ({{valorTotalExtenso}}), correspondente às faturas vencidas abaixo discriminadas, já acrescidas dos encargos moratórios contratuais apurados até a data-base deste Acordo ("Faturas Vinculadas"):

{{tabelaFaturas}}
TOTAL: {{valorTotalConfessado}}

1.2. A confissão ora realizada abrange exclusivamente as Faturas Vinculadas, permanecendo as demais parcelas e faturas dos instrumentos de origem exigíveis em seus vencimentos originais, na forma neles prevista.

CLÁUSULA 2ª — DA ENTRADA E DO PARCELAMENTO

2.1. O(A) DEVEDOR(A) pagará entrada de {{valorEntrada}} ({{valorEntradaExtenso}}), por meio de cobrança avulsa (PIX/boleto), com vencimento em {{dataEntrada}}. O não pagamento da entrada até essa data torna este Acordo sem efeito, permanecendo exigíveis as Faturas Vinculadas na forma original.

2.2. O saldo remanescente será pago em {{qtdeParcelas}} ({{qtdeParcelasExtenso}}) parcelas {{periodicidadePlural}} de {{valorParcela}} ({{valorParcelaExtenso}}) cada, vencendo-se a primeira em {{dataPrimeiraParcela}}, incluídas nas faturas {{periodicidadePlural}} da conta do(a) DEVEDOR(A) junto à CREDORA — o(a) DEVEDOR(A) paga uma única fatura por período, que agrega a parcela deste Acordo aos demais itens vincendos.

2.3. O pagamento de cada parcela somente será considerado realizado após a efetiva compensação/confirmação do valor em favor da CREDORA.

CLÁUSULA 3ª — DA IMPUTAÇÃO E APROPRIAÇÃO DOS PAGAMENTOS

3.1. Cada valor pago no âmbito deste Acordo será apropriado proporcionalmente entre as Faturas Vinculadas, na razão do valor atualizado de cada fatura sobre o total confessado, observando-se, dentro de cada fatura, a imputação primeiro nos encargos e, em seguida, no principal, nos termos do art. 354 do Código Civil. Eventuais diferenças de arredondamento serão apropriadas na fatura de vencimento mais antigo.

3.2. A quitação definitiva das Faturas Vinculadas somente ocorrerá com o cumprimento integral deste Acordo. Os recibos de pagamento de parcelas deste Acordo não implicam quitação das Faturas Vinculadas, mas mera amortização proporcional, nos termos do item 3.1.

CLÁUSULA 4ª — DA AUSÊNCIA DE NOVAÇÃO E DA MANUTENÇÃO DAS GARANTIAS

4.1. O presente Acordo NÃO constitui novação da dívida, nos termos dos arts. 360 e seguintes do Código Civil, tratando-se de mera composição quanto à forma de pagamento das Faturas Vinculadas. Permanecem íntegras e plenamente eficazes todas as cláusulas, condições, obrigações e garantias dos instrumentos de origem, em especial a reserva de domínio sobre o(s) veículo(s) em favor da CREDORA, que somente se resolverá com a quitação integral do preço, nos termos de cada instrumento.

4.2. Este Acordo não altera valores, prazos ou condições das parcelas vincendas dos instrumentos de origem, que deverão continuar sendo pagas normalmente em seus respectivos vencimentos.

CLÁUSULA 5ª — DO INADIMPLEMENTO

5.1. As parcelas deste Acordo pagas com atraso ficarão sujeitas a multa moratória de 2% (dois por cento), juros de mora de 1% (um por cento) ao mês pro rata die, seguindo o mesmo tratamento de cobrança e inadimplência dos demais itens de uma fatura vencida, na forma dos instrumentos de origem e da régua de cobrança da CREDORA.

5.2. O inadimplemento deste Acordo não desfaz as amortizações proporcionais já realizadas na forma da Cláusula 3ª, permanecendo exigíveis os saldos remanescentes das Faturas Vinculadas, sobre os quais voltarão a incidir os encargos moratórios contratuais, autorizada a CREDORA a adotar todas as medidas previstas nos instrumentos de origem e na legislação aplicável, inclusive as relativas à cobrança, à notificação extrajudicial e à retomada do(s) veículo(s) em razão da reserva de domínio.

CLÁUSULA 6ª — DO TÍTULO EXECUTIVO

6.1. O presente instrumento, assinado pelas partes e por 2 (duas) testemunhas, constitui título executivo extrajudicial, nos termos do art. 784, III, do Código de Processo Civil.

CLÁUSULA 7ª — DAS COMUNICAÇÕES

7.1. As partes reconhecem como válidas e eficazes, para todos os fins deste Acordo e dos instrumentos de origem, as comunicações, cobranças, notificações e envios de boletos/links de pagamento realizados por meio do WhatsApp {{telefoneCliente}} e do e-mail {{emailCliente}} informados pelo(a) DEVEDOR(A), a quem incumbe manter seus dados de contato atualizados perante a CREDORA.

CLÁUSULA 8ª — DA ASSINATURA ELETRÔNICA

8.1. As partes reconhecem a validade, autenticidade e integridade das assinaturas eletrônicas apostas neste instrumento por meio da plataforma ZapSign, nos termos da MP nº 2.200-2/2001 e da Lei nº 14.063/2020, com a mesma eficácia de assinaturas físicas, inclusive para os fins da Cláusula 6ª.

CLÁUSULA 9ª — DO FORO

9.1. Fica eleito o foro da Comarca de Vitória/ES para dirimir quaisquer controvérsias oriundas deste Acordo, com renúncia a qualquer outro, por mais privilegiado que seja.

E, por estarem justas e acordadas, as partes assinam o presente instrumento, juntamente com as testemunhas abaixo.

{{dataAssinaturaLinha}}

AZIT COMÉRCIO DE VEÍCULOS LTDA — CREDORA
CNPJ 57.265.780/0001-19

___________________________________________
{{nomeCliente}} — DEVEDOR(A)
CPF {{cpfCliente}}

TESTEMUNHAS:

1) _________________________________
{{testemunha1Linha}}

2) ________________________________
{{testemunha2Linha}}`;
