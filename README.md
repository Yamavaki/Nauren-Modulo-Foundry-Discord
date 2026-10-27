# Nauren no Discord (módulo do Foundry VTT)

Liga cada mundo do Foundry ao Discord da campanha, junto com o bot **O Curador**.

- **Um tópico por mundo** no fórum da staff, criado sozinho na primeira vez. Ali aparece o chat da mesa: cada cartão ou fala vira uma mensagem, com o nome e o retrato do personagem. Dos cartões da Nauren (0.94.18+) vão só ataque, resultado, dano, cura, alvos, efeitos, condições e Prioridade; as descrições ficam no Foundry. Sussurros e rolagens cegas ou privadas nunca vão.
- **Painel para os jogadores:** a primeira mensagem do tópico é o sinal de vida, editado a cada 2 minutos. O Curador lê e mostra no painel quais mundos estão online, a cena, o combate e quem está conectado.
- **Rolagens de atributos (Nauren 0.94.19+):** o card da rolagem também vai ao tópico, como prova; O Curador confere com a ficha exportada.

## Instalar
Link do manifesto (Foundry ou Forge):

```
https://raw.githubusercontent.com/Yamavaki/Nauren-Modulo-Foundry-Discord/main/module.json
```

No Discord, a Administração usa **uma vez** `/foundry forum:#fórum-da-staff painel:#canal-do-painel` e recebe um código. Em cada mundo, uma vez só: ative o módulo, abra Configurações → Configurar opções → **Nauren no Discord** → **Configurar**, cole o código, **Salvar** e **Testar**. O mesmo código serve para todos os mundos.

> O código fica salvo no mundo, embaralhado mas não criptografado. Se vazar, gere outro com `/foundry novo:True`.

## Publicar uma versão nova
1. Mude `version` no `module.json`.
2. Gere o zip: `zip -r dist/nauren-discord.zip module.json scripts` (apague o antigo antes).
3. Faça o commit no `main`. O Foundry compara a versão do manifesto e oferece a atualização.
