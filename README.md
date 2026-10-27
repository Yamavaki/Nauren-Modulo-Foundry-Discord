# Nauren no Discord (módulo do Foundry VTT)

Mostra no Discord o chat do Foundry em tempo real e manda ao bot **O Curador** o sinal de que o mundo está online.

- **Chat:** cada cartão ou fala vira uma mensagem no canal da mesa, com o nome e o retrato do personagem. Dos cartões da Nauren (sistema 0.94.18 ou mais novo) vão só ataque, resultado, dano, cura, alvos, efeitos, condições e Prioridade; as descrições ficam no Foundry. Sussurros e rolagens cegas ou privadas nunca vão.
- **Rolagens de atributos (Nauren 0.94.19+):** quando o jogador rola no Criador, o card vai ao canal do sinal como prova; O Curador confere com a ficha exportada.
- **Sinal:** a cada 2 minutos o Foundry avisa O Curador que o mundo está aberto, a cena, o combate e quem está conectado. O Curador mantém o painel "Mundos do Foundry".

## Instalar
No Foundry (ou na Forge), instale pelo link do manifesto:

```
https://raw.githubusercontent.com/Yamavaki/Nauren-Modulo-Foundry-Discord/main/module.json
```

Depois, em cada mundo: ative o módulo, abra Configurações → Configurar opções → **Nauren no Discord** → **Configurar**, cole o código que o Curador gera com `/foundry conectar` e clique em **Salvar** e **Testar**. É uma vez por mundo.

> O código fica salvo no mundo, embaralhado mas não criptografado. Se vazar, gere outro com `/foundry conectar novo:True`.

## Publicar uma versão nova
1. Mude `version` no `module.json`.
2. Gere o zip: `zip -r dist/nauren-discord.zip module.json scripts` (apague o antigo antes).
3. Faça o commit no `main`. O Foundry compara a versão do manifesto e oferece a atualização.
