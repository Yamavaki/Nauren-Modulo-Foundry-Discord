# Nauren no Discord (módulo do Foundry VTT)

Mostra no Discord o chat do Foundry em tempo real e manda ao bot **O Curador** o sinal de que o mundo está online.

- **Chat:** cada cartão ou fala vira uma mensagem no canal da mesa, com o nome e o retrato do personagem. Dos cartões da Nauren (sistema 0.94.18 ou mais novo) vão só ataque, resultado, dano, cura, alvos, efeitos, condições e Prioridade; as descrições ficam no Foundry. Sussurros e rolagens cegas ou privadas nunca vão.
- **Sinal:** a cada 2 minutos o Foundry avisa O Curador que o mundo está aberto, a cena, o combate e quem está conectado. O Curador mantém o painel "Mundos do Foundry".

## Instalar
No Foundry (ou na Forge), instale pelo link do manifesto:

```
https://github.com/Yamavaki/Nauren-Modulo-Foundry-Discord/releases/latest/download/module.json
```

Depois, em cada mundo: ative o módulo, abra Configurações → Configurar opções → **Nauren no Discord** → **Configurar**, cole o código que o Curador gera com `/foundry conectar` e clique em **Salvar** e **Testar**. É uma vez por mundo.

> O código fica salvo no mundo, embaralhado mas não criptografado. Se vazar, gere outro com `/foundry conectar novo:True`.

## Publicar uma versão nova
1. Mude `version` (e o número no fim de `download`) no `module.json`.
2. Faça o commit e crie a tag com o mesmo número: `git tag v1.2.0 && git push origin main --tags`.
3. A Action monta o zip e publica a release; o Foundry passa a oferecer a atualização.
