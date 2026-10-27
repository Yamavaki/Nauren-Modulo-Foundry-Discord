// ============================================================
// Nauren no Discord 1.2.0
// • Chat em tempo real: cada mensagem ou cartão do Foundry vira UMA
//   mensagem no Discord, com o nome e o retrato de quem falou. Dos
//   cartões da Nauren vai só o que importa (dados, dano, cura, alvos,
//   efeitos, Prioridade) — as descrições ficam no Foundry.
// • Sinal de vida: de 2 em 2 minutos o Foundry avisa O Curador que o
//   mundo está aberto, quem está conectado, a cena e o combate.
// Quem manda é SÓ um navegador por vez (o do Mestre principal; sem Mestre,
// o de um jogador). O código é colado uma vez por mundo e fica salvo nele.
// ============================================================
const ID = "nauren-discord";
const VERSAO = "1.2.0";
const INTERVALO_SINAL = 120_000;
const ESPACO_ENVIO = 450;          // o Discord aceita ~5 mensagens a cada 2 s por webhook
const APAGAR_ATE = 15 * 60_000;    // apagar no Discord só mensagens recentes (não espelha "limpar o chat")

const cfg = chave => { try { return game.settings.get(ID, chave); } catch { return undefined; } };
const esperar = ms => new Promise(r => setTimeout(r, ms));
const cortar = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// ------------------------------------------------------------
// Código de conexão (gerado pelo Curador com /foundry conectar)
// ------------------------------------------------------------
const ehWebhook = u => /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+(?:\?.*)?$/.test(String(u ?? "").trim());

export function lerCodigo(codigo) {
  const bruto = String(codigo ?? "").trim();
  if (!bruto.startsWith("NDC1.")) throw new Error("Esse não é um código do Curador (ele começa com NDC1.).");
  let dados;
  try {
    const b64 = bruto.slice(5).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    dados = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
  } catch { throw new Error("O código está incompleto. Copie de novo a mensagem inteira do Curador."); }
  if (dados.c && !ehWebhook(dados.c)) throw new Error("O link do chat dentro do código não é válido.");
  if (dados.s && !ehWebhook(dados.s)) throw new Error("O link do sinal dentro do código não é válido.");
  return { chat: dados.c || "", sinal: dados.s || "", servidor: dados.g || "" };
}

// ------------------------------------------------------------
// Envio: uma fila por webhook, na ordem, respeitando o limite do Discord
// ------------------------------------------------------------
function montarUrl(base, extra = "", params = {}) {
  const u = new URL(String(base).trim());
  u.pathname = u.pathname.replace(/\/$/, "") + extra;
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

class Fila {
  constructor() { this.itens = []; this.rodando = false; }
  get tamanho() { return this.itens.length; }
  add(fn) { return new Promise((res, rej) => { this.itens.push({ fn, res, rej }); this.#rodar(); }); }
  async #rodar() {
    if (this.rodando) return;
    this.rodando = true;
    while (this.itens.length) {
      const { fn, res, rej } = this.itens.shift();
      try { res(await fn()); } catch (err) { rej(err); }
      await esperar(ESPACO_ENVIO);
    }
    this.rodando = false;
  }
}
const filaChat = new Fila();
const filaSinal = new Fila();

async function chamar(metodo, url, corpo) {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const r = await fetch(url, {
      method: metodo,
      headers: corpo ? { "Content-Type": "application/json" } : {},
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    if (r.status === 429) {
      const j = await r.json().catch(() => ({}));
      await esperar(Math.ceil((Number(j.retry_after) || 1) * 1000) + 150);
      continue;
    }
    if (!r.ok) {
      const texto = await r.text().catch(() => "");
      const err = new Error(`Discord respondeu ${r.status}: ${cortar(texto, 200)}`);
      err.status = r.status;
      throw err;
    }
    return r.status === 204 ? null : r.json().catch(() => null);
  }
  throw new Error("O Discord pediu para esperar várias vezes seguidas; a mensagem foi descartada.");
}

// ------------------------------------------------------------
// Onde ficam os links: no próprio MUNDO (configura uma vez e vale para
// qualquer Mestre, em qualquer computador). Ficam embaralhados para não
// aparecer em texto puro, mas isso NÃO é criptografia: quem souber usar o
// console (F12) consegue ler. Se vazar, /foundry conectar novo:True.
// ------------------------------------------------------------
const embaralhar = (texto, chave) => {
  const k = new TextEncoder().encode(chave || "nauren");
  const b = new TextEncoder().encode(texto);
  return btoa(String.fromCharCode(...b.map((x, i) => x ^ k[i % k.length])));
};
const desembaralhar = (texto, chave) => {
  const k = new TextEncoder().encode(chave || "nauren");
  const b = Uint8Array.from(atob(texto), c => c.charCodeAt(0));
  return new TextDecoder().decode(b.map((x, i) => x ^ k[i % k.length]));
};
function links() {
  try {
    const bruto = cfg("links");
    if (bruto) return JSON.parse(desembaralhar(bruto, game.world?.id)) ?? {};
  } catch { /* configuração corrompida: trata como vazia */ }
  // 1.0.0 guardava no navegador: ainda vale até o Mestre salvar de novo
  try { return JSON.parse(localStorage.getItem(`${ID}.links.${game.world?.id ?? "?"}`) || "{}") ?? {}; } catch { return {}; }
}
async function salvarLinks(l) {
  const vazio = !l.chat && !l.sinal;
  await game.settings.set(ID, "links", vazio ? "" : embaralhar(JSON.stringify({ chat: l.chat || "", sinal: l.sinal || "" }), game.world?.id));
  try { localStorage.removeItem(`${ID}.links.${game.world?.id ?? "?"}`); } catch { /* sem armazenamento: tudo bem */ }
}
const urlChat = () => links().chat || "";
const urlSinal = () => links().sinal || "";
const temChat = () => ehWebhook(urlChat());
const temSinal = () => ehWebhook(urlSinal());

// Quem manda: o Mestre principal. Sem Mestre na sala, um dos jogadores
// conectados (o de menor id), para o mundo aparecer online e o chat seguir.
function souEmissor() {
  if (!game.user || !(temChat() || temSinal())) return false;
  const gm = game.users.activeGM;
  if (gm) return gm.id === game.user.id;
  const ativos = game.users.filter(u => u.active).sort((a, b) => a.id.localeCompare(b.id));
  return ativos[0]?.id === game.user.id;
}

// ------------------------------------------------------------
// Imagens: o Discord só mostra links públicos (e não lê SVG)
// ------------------------------------------------------------
function urlPublica(caminho) {
  if (!caminho || typeof caminho !== "string") return undefined;
  if (caminho.startsWith("data:") || /\.svg(\?|$)/i.test(caminho)) return undefined;
  let u;
  try { u = new URL(caminho, window.location.origin + foundry.utils.getRoute("/")); } catch { return undefined; }
  if (!/^https?:$/.test(u.protocol)) return undefined;
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) || u.hostname.endsWith(".local")) return undefined;
  return u.toString();
}

function quemFalou(msg) {
  const actor = ChatMessage.getSpeakerActor?.(msg.speaker) ?? (msg.speaker?.actor ? game.actors.get(msg.speaker.actor) : null);
  const autor = msg.author ?? msg.user;
  let nome = msg.alias || actor?.name || autor?.name || "Foundry";
  let img = actor?.img;
  if (!img || /mystery-man/.test(img)) {
    const tok = msg.speaker?.token && game.scenes.get(msg.speaker.scene)?.tokens.get(msg.speaker.token);
    img = tok?.texture?.src || img;
  }
  if (!actor) img = autor?.avatar || img;
  // O Discord recusa nomes com "discord"/"clyde" e acima de 80 caracteres
  nome = cortar(String(nome).replace(/discord/gi, "dsc").replace(/clyde/gi, "clyd"), 80) || "Foundry";
  return { nome, avatar: urlPublica(img), autor, actor };
}

const corDoAutor = autor => {
  const c = autor?.color;
  const hex = typeof c === "string" ? c : (c?.css ?? (c != null ? String(c) : ""));
  const n = parseInt(String(hex).replace("#", ""), 16);
  return Number.isFinite(n) ? n : 0x7a5cc4;
};

// ------------------------------------------------------------
// HTML → texto do Discord (num documento inerte: nada carrega nem roda)
// ------------------------------------------------------------
function htmlParaTexto(html) {
  const doc = new DOMParser().parseFromString(`<div id="r">${html ?? ""}</div>`, "text/html");
  const r = doc.getElementById("r");
  r.querySelectorAll(".secret, script, style, button, img, .nrc-regra, .nrc-details").forEach(e => e.remove());
  r.querySelectorAll("br").forEach(b => b.replaceWith("\n"));
  r.querySelectorAll("strong, b").forEach(b => { const t = b.textContent.trim(); b.replaceWith(t ? `**${t}**` : ""); });
  r.querySelectorAll("em, i").forEach(b => { const t = b.textContent.trim(); b.replaceWith(t ? `*${t}*` : ""); });
  r.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, tr").forEach(p => p.append("\n"));
  return r.textContent.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ------------------------------------------------------------
// Cartão da Nauren (flags.nauren.resumo) → embed colorido
// ------------------------------------------------------------
const COR = { dano: 0xe74c3c, cura: 0x2ecc71, condicao: 0x9b59b6, prioridade: 0xe67e22, critico: 0xf1c40f, desastre: 0x2c3e50, aviso: 0x3498db, destaque: 0xe67e22, descricao: 0x95a5a6 };

function emojiDaLinha(rotulo) {
  const r = String(rotulo).toLowerCase();
  if (/dano/.test(r)) return "💥";
  if (/cura|vida recuper/.test(r)) return "💚";
  if (/condi|veneno|lerdeza|loucura|caído|queima/.test(r)) return "🌀";
  if (/efeito|benef/.test(r)) return "✨";
  if (/custo|pagou|gastou|usou/.test(r)) return "🔷";
  if (/escudo|bloq|redu|esquiv/.test(r)) return "🛡️";
  if (/iniciativa/.test(r)) return "⏱️";
  if (/aguard/.test(r)) return "⏳";
  if (/recebeu|recuper|ganh|\+/.test(r)) return "✨";
  return "▫️";
}

function linhasDosDados(dados = []) {
  if (!dados.length) return [];
  const partes = dados.map(d => (d.descartado ? `~~${d.total}~~` : `**${d.total}**`));
  const rot = dados.length > 1 ? (dados[0].rotulo || "").replace(/\s*[AB]$/, "") : (dados[0].rotulo && dados[0].rotulo !== "Resultado" ? dados[0].rotulo : "");
  const linhas = [`🎲 ${rot ? `${rot}: ` : ""}${partes.join(" · ")}`];
  if (dados.some(d => d.crit && !d.descartado)) linhas.push("⭐ **CRÍTICO!**");
  if (dados.some(d => d.desastre && !d.descartado)) linhas.push("💀 **DESASTRE!**");
  return linhas;
}
const linhasDosItens = (linhas = []) => linhas.map(l => `${emojiDaLinha(l.rotulo)} ${l.rotulo ? `**${l.rotulo}:** ` : ""}${l.valor}${l.formula ? ` \`${l.formula}\`` : ""}`);

function corDoResumo(r, padrao) {
  const ativos = (r.dados ?? []).filter(d => !d.descartado);
  if (ativos.some(d => d.crit)) return COR.critico;
  if (ativos.some(d => d.desastre)) return COR.desastre;
  const tudo = [...(r.linhas ?? []).map(l => `${l.rotulo} ${l.valor}`), ...(r.alvos ?? []).flatMap(a => a.texto ?? []),
    ...(r.extras ?? []).flatMap(x => (x.linhas ?? []).map(l => `${l.rotulo} ${l.valor}`))].join(" ").toLowerCase();
  if (/dano/.test(tudo)) return COR.dano;
  if (/cura|curou|recupera/.test(tudo)) return COR.cura;
  if (/condi|veneno|lerdeza|loucura|caído|queimando|atordo|sangr/.test(tudo)) return COR.condicao;
  if (r.prioridade) return COR.prioridade;
  return padrao;
}

function embedDoResumo(r, { autor, ts }) {
  if (r.tipo === "aviso") return { color: COR.aviso, description: cortar(r.texto, 4000), timestamp: ts };
  if (r.tipo === "destaque") return { color: COR.destaque, title: cortar(`🛡️ ${r.titulo}`, 256), description: cortar(r.texto, 4000), timestamp: ts };
  if (r.tipo === "descricao") return { color: COR.descricao, description: `📖 Mostrou **${cortar(r.titulo, 200)}**`, timestamp: ts };

  const cor = corDoResumo(r, corDoAutor(autor));
  const icone = cor === COR.dano || cor === COR.critico || cor === COR.desastre ? "⚔️" : cor === COR.cura ? "💚" : cor === COR.condicao ? "🌀" : "✨";
  const desc = [...linhasDosDados(r.dados), ...linhasDosItens(r.linhas)];
  if (r.prioridade) desc.push(`👉 ${r.prioridade}`);
  const fields = [];
  const alvos = r.alvos ?? [];
  for (const a of alvos.slice(0, 12)) {
    const marca = a.acertou === true ? "✅" : a.acertou === false ? "❌" : "🎯";
    fields.push({ name: cortar(`${marca} ${a.nome}`, 256), value: cortar((a.texto ?? []).join("\n") || "—", 1024) });
  }
  if (alvos.length > 12) fields.push({ name: `e mais ${alvos.length - 12} alvo(s)`, value: "Veja o cartão no Foundry." });
  for (const x of (r.extras ?? []).slice(0, 6)) {
    const v = [...linhasDosDados(x.dados), ...linhasDosItens(x.linhas)].join("\n");
    if (v) fields.push({ name: cortar(`➕ ${x.titulo || "Extra"}`, 256), value: cortar(v, 1024) });
  }
  const rodape = [r.fonte, r.custo ? `Custo: ${r.custo}` : "", autor?.name ? `jogador: ${autor.name}` : ""].filter(Boolean).join(" • ");
  const embed = { color: cor, title: cortar(`${icone} ${r.titulo || "Ação"}`, 256), timestamp: ts };
  if (desc.length) embed.description = cortar(desc.join("\n"), 4000);
  if (fields.length) embed.fields = fields;
  if (rodape) embed.footer = { text: cortar(rodape, 2048) };
  const thumb = urlPublica(r.icone);
  if (thumb) embed.thumbnail = { url: thumb };
  // O Discord recusa mensagens com mais de 6000 caracteres somando o embed todo
  const tam = () => JSON.stringify(embed).length;
  while (embed.fields?.length && tam() > 5800) embed.fields.pop();
  return embed;
}

// ------------------------------------------------------------
// Qualquer mensagem do Foundry → corpo do webhook (ou null = não vai)
// ------------------------------------------------------------
const ESTILO = () => CONST.CHAT_MESSAGE_STYLES ?? {};

function deveIr(msg) {
  if (!cfg("chat")) return false;
  if (msg.whisper?.length || msg.blind) return false;          // sussurros, rolagens cegas e privadas
  if (msg.getFlag?.(ID, "ignorar")) return false;
  const estilo = msg.style ?? msg.type;
  if (estilo === ESTILO().OOC && !cfg("ooc")) return false;
  return true;
}

export function montarCorpo(msg) {
  const { nome, avatar, autor } = quemFalou(msg);
  const ts = new Date(msg.timestamp || Date.now()).toISOString();
  const corpo = { username: nome, allowed_mentions: { parse: [] } };
  if (avatar) corpo.avatar_url = avatar;
  const resumo = msg.getFlag?.("nauren", "resumo");
  if (resumo) {
    if (resumo.aguardando) return null;                         // vira o cartão final num update
    corpo.embeds = [resumo.tipo === "aviso"
      ? { color: COR.aviso, description: cortar(htmlParaTexto(msg.content) || resumo.texto, 4000), timestamp: ts }
      : embedDoResumo(resumo, { autor, ts })];
    return corpo;
  }
  if (msg.isRoll && msg.rolls?.length) {
    const flavor = htmlParaTexto(msg.flavor || "");
    const linhas = msg.rolls.map(r => `🎲 **${r.total}**  \`${cortar(r.formula, 120)}\``);
    corpo.embeds = [{ color: corDoAutor(autor), title: cortar(flavor || "Rolagem", 256), description: cortar(linhas.join("\n"), 4000), timestamp: ts }];
    return corpo;
  }
  const texto = htmlParaTexto(msg.content);
  if (!texto) return null;
  const estilo = msg.style ?? msg.type;
  if (estilo === ESTILO().OOC) {
    corpo.username = cortar(autor?.name || nome, 80);
    const av = urlPublica(autor?.avatar); if (av) corpo.avatar_url = av; else delete corpo.avatar_url;
    corpo.content = cortar(texto, 2000);
    return corpo;
  }
  if (estilo === ESTILO().EMOTE) {
    corpo.embeds = [{ color: corDoAutor(autor), description: cortar(`*${texto}*`, 4000) }];
    return corpo;
  }
  if (estilo === ESTILO().IC) {
    corpo.embeds = [{ color: corDoAutor(autor), description: cortar(`💬 “${texto}”`, 4000) }];
    return corpo;
  }
  corpo.embeds = [{ color: corDoAutor(autor), description: cortar(texto, 4000), timestamp: ts }];
  return corpo;
}

// ------------------------------------------------------------
// Chat: criar, editar (cartão que muda depois) e apagar
// ------------------------------------------------------------
const postados = new Map();   // id da mensagem no Foundry → { promessa do id no Discord, quando }
const pendentes = new Set();  // cartões "aguardando reação": vão quando virarem o cartão final

function postar(msg, corpo) {
  const base = urlChat();
  const promessa = filaChat.add(() => chamar("POST", montarUrl(base, "", { wait: "true" }), corpo)).then(r => r?.id ?? null);
  postados.set(msg.id, { promessa, quando: Date.now() });
  if (postados.size > 400) postados.delete(postados.keys().next().value);
  promessa.catch(err => avisarFalha(err));
}

// Rolagem de atributos no Criador (Nauren 0.94.19+): a prova vai ao canal do sinal,
// onde O Curador guarda e depois confere com a ficha exportada. Vai mesmo se o
// card for sussurro ou se o chat estiver desligado.
function enviarProvaDeRolagem(msg) {
  const reg = msg.getFlag?.("nauren", "registroRolagem");
  if (!reg?.entradaId || !souEmissor() || !temSinal()) return;
  const ator = (reg.actorUuid && globalThis.fromUuidSync?.(reg.actorUuid)?.name) || msg.alias || "";
  const autor = msg.author ?? msg.user;
  const dados = {
    t: "nauren-rolagem", v: 1,
    mundo: { id: game.world.id, titulo: game.world.title },
    ator: cortar(ator, 100), autor: cortar(autor?.name ?? "", 100), autorEhMestre: !!autor?.isGM,
    mensagemId: msg.id, quando: new Date(msg.timestamp || Date.now()).toISOString(),
    registro: {
      entradaId: String(reg.entradaId), actorUuid: reg.actorUuid ?? "", n: reg.n ?? null, tipo: reg.tipo ?? "",
      formula: reg.formula ?? (Array.isArray(reg.resultados) ? `${reg.resultados.length}d6` : ""),
      resultados: Array.isArray(reg.resultados) ? reg.resultados : [], total: reg.total ?? null, testemunha: reg.testemunha ?? ""
    }
  };
  const corpo = { username: "Foundry — Sinal", allowed_mentions: { parse: [] },
    content: `🎲 Rolagem registrada — lida pelo Curador, não apague.\n\`\`\`json\n${JSON.stringify(dados)}\n\`\`\`` };
  filaSinal.add(() => chamar("POST", montarUrl(urlSinal(), "", { wait: "true" }), corpo)).catch(err => avisarFalha(err));
}

function aoCriar(msg) {
  try { enviarProvaDeRolagem(msg); } catch (err) { console.warn("Nauren no Discord |", err); }
  if (!souEmissor() || !temChat() || !deveIr(msg)) return;
  if (msg.getFlag?.("nauren", "resumo")?.aguardando) { pendentes.add(msg.id); return; }
  const corpo = montarCorpo(msg);
  if (corpo) postar(msg, corpo);
}

async function aoAtualizar(msg, mudancas) {
  if (!souEmissor() || !temChat()) return;
  if (!("content" in (mudancas ?? {})) && !foundry.utils.hasProperty(mudancas ?? {}, "flags.nauren.resumo")) return;
  const registro = postados.get(msg.id);
  if (!registro && !pendentes.has(msg.id)) return;
  if (!deveIr(msg)) return;
  const corpo = montarCorpo(msg);
  if (!corpo) return;
  if (!registro) { pendentes.delete(msg.id); postar(msg, corpo); return; }
  const idDiscord = await registro.promessa.catch(() => null);
  if (!idDiscord) return;
  const { username, avatar_url, ...edicao } = corpo; // na edição o Discord não troca nome nem retrato
  filaChat.add(() => chamar("PATCH", montarUrl(urlChat(), `/messages/${idDiscord}`), edicao)).catch(err => avisarFalha(err));
}

async function aoApagar(msg) {
  pendentes.delete(msg.id);
  const registro = postados.get(msg.id);
  if (!registro || !souEmissor() || !temChat()) return;
  postados.delete(msg.id);
  if (Date.now() - registro.quando > APAGAR_ATE || filaChat.tamanho > 15) return;
  const idDiscord = await registro.promessa.catch(() => null);
  if (idDiscord) filaChat.add(() => chamar("DELETE", montarUrl(urlChat(), `/messages/${idDiscord}`))).catch(() => {});
}

// ------------------------------------------------------------
// Sinal de vida para O Curador (uma mensagem só, editada de tempos em tempos)
// ------------------------------------------------------------
const inicioSessao = Date.now();
let temporizadorSinal = null;
let ultimoAvisoFalha = 0;

export function dadosDoSinal(estado = "online") {
  const cena = game.scenes?.active;
  const combate = game.combat?.started ? game.combat : null;
  const vez = combate?.combatant;
  return {
    t: "nauren-sinal", v: 1, estado,
    mundo: { id: game.world.id, titulo: game.world.title },
    sistema: `${game.system.title ?? game.system.id} ${game.system.version ?? ""}`.trim(),
    modulo: VERSAO,
    cena: cfg("mostrarCena") && cena ? (cena.navName || cena.name) : "",
    combate: combate ? { rodada: combate.round, vez: vez && !vez.hidden ? vez.name : "" } : null,
    jogadores: game.users.filter(u => u.active).map(u => ({ n: cortar(u.name, 40), gm: u.isGM, p: cortar(u.character?.name ?? "", 40) })).slice(0, 30),
    inicio: inicioSessao, ts: Date.now()
  };
}
const textoDoSinal = dados => `🛰️ Sinal do Foundry — lido pelo Curador, não apague nem edite.\n\`\`\`json\n${JSON.stringify(dados)}\n\`\`\``;

async function enviarSinal(estado = "online") {
  if (!souEmissor() || !temSinal()) return;
  const base = urlSinal();
  const corpo = { content: textoDoSinal(dadosDoSinal(estado)), allowed_mentions: { parse: [] }, username: "Foundry — Sinal" };
  const id = cfg("sinalMensagemId");
  return filaSinal.add(async () => {
    if (id) {
      try { await chamar("PATCH", montarUrl(base, `/messages/${id}`), { content: corpo.content, allowed_mentions: corpo.allowed_mentions }); return; }
      catch (err) { if (err.status !== 404) throw err; }      // apagaram a mensagem: cria outra
    }
    if (!game.user.isGM) return;                             // só o Mestre cria a mensagem (o id fica no mundo)
    const nova = await chamar("POST", montarUrl(base, "", { wait: "true" }), corpo);
    if (nova?.id) await game.settings.set(ID, "sinalMensagemId", nova.id);
  }).catch(err => avisarFalha(err));
}

let sinalAgendado = null;
function sinalEmBreve() {
  clearTimeout(sinalAgendado);
  sinalAgendado = setTimeout(() => enviarSinal("online"), 4000);
}

function ligarSinal() {
  clearInterval(temporizadorSinal);
  temporizadorSinal = null;
  if (!souEmissor() || !temSinal()) return;
  enviarSinal("online");
  temporizadorSinal = setInterval(() => enviarSinal("online"), INTERVALO_SINAL);
}

// Ao fechar a aba: tenta avisar "offline" (se não der, o Curador percebe sozinho em poucos minutos)
function aoFecharAba() {
  if (!souEmissor() || !temSinal()) return;
  const id = cfg("sinalMensagemId");
  if (!id) return;
  try {
    fetch(montarUrl(urlSinal(), `/messages/${id}`), {
      method: "PATCH", keepalive: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: textoDoSinal(dadosDoSinal("offline")), allowed_mentions: { parse: [] } })
    }).catch(() => {});
  } catch { /* o navegador pode recusar: tudo bem */ }
}

function avisarFalha(err) {
  console.warn("Nauren no Discord |", err);
  if (!game.user?.isGM) return;                              // jogador não precisa ver aviso técnico
  if (Date.now() - ultimoAvisoFalha < 10 * 60_000) return;
  ultimoAvisoFalha = Date.now();
  const s = err?.status;
  const dica = s === 401 || s === 404 ? "o link foi apagado no Discord. Gere um código novo com /foundry conectar."
    : s === 400 ? "o Discord recusou uma mensagem (veja o console, F12)." : "veja o console (F12).";
  ui.notifications?.warn(`Nauren no Discord: falha ao enviar — ${dica}`);
}

// ------------------------------------------------------------
// Janela de configuração (só o Mestre abre)
// ------------------------------------------------------------
const { ApplicationV2 } = foundry.applications.api;
const esc = s => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

class ConfigDiscord extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "nauren-discord-config",
    tag: "form",
    window: { title: "Nauren no Discord", icon: "fab fa-discord", contentClasses: ["standard-form"] },
    position: { width: 560 },
    form: { handler: ConfigDiscord.#salvar, closeOnSubmit: true },
    actions: { testar: ConfigDiscord.#testar, limpar: ConfigDiscord.#limpar }
  };

  async _renderHTML() {
    const ok = v => (v ? `<span style="color:#2ecc71">✔ configurado</span>` : `<span style="color:#e67e22">não configurado</span>`);
    const div = document.createElement("div");
    div.innerHTML = `
      <p>Cole aqui o <b>código de conexão</b> que O Curador mandou quando você usou <code>/foundry conectar</code> no Discord.
      Ele fica salvo <b>neste mundo</b>: vale para qualquer Mestre, em qualquer computador, e só precisa ser colado uma vez.</p>
      <div class="form-group stacked">
        <label>Código de conexão</label>
        <input type="password" name="codigo" placeholder="NDC1.…" autocomplete="off">
        <p class="hint">Chat: ${ok(temChat())} · Sinal: ${ok(temSinal())}. Deixe em branco para manter o código atual.</p>
      </div>
      <fieldset>
        <legend>Neste mundo</legend>
        <div class="form-group"><label>Mandar o chat para o Discord</label><input type="checkbox" name="chat" ${cfg("chat") ? "checked" : ""}></div>
        <div class="form-group"><label>Incluir conversa fora do personagem (OOC)</label><input type="checkbox" name="ooc" ${cfg("ooc") ? "checked" : ""}></div>
        <div class="form-group"><label>Mostrar o nome da cena no painel</label><input type="checkbox" name="mostrarCena" ${cfg("mostrarCena") ? "checked" : ""}></div>
        <p class="hint">Sussurros, rolagens cegas e rolagens privadas do Mestre nunca vão para o Discord.</p>
      </fieldset>

      <footer class="form-footer">
        <button type="button" data-action="testar"><i class="fas fa-paper-plane"></i> Testar</button>
        <button type="button" data-action="limpar"><i class="fas fa-trash"></i> Apagar o código</button>
        <button type="submit"><i class="fas fa-save"></i> Salvar</button>
      </footer>`;
    return div;
  }
  _replaceHTML(resultado, conteudo) { conteudo.replaceChildren(resultado); }

  static async #salvar(_event, _form, formData) {
    const d = formData.object;
    try {
      if (String(d.codigo ?? "").trim()) await salvarLinks(lerCodigo(d.codigo));
      else if (links().chat || links().sinal) await salvarLinks(links()); // passa o código da 1.0.0 (navegador) para o mundo
      for (const k of ["chat", "ooc", "mostrarCena"]) await game.settings.set(ID, k, !!d[k]);
      ui.notifications.info("Nauren no Discord: configuração salva.");
      ligarSinal();
    } catch (err) { ui.notifications.error(err.message); throw err; }
  }

  static async #testar() {
    if (!temChat() && !temSinal()) return ui.notifications.warn("Salve o código de conexão primeiro.");
    try {
      if (temChat()) await filaChat.add(() => chamar("POST", montarUrl(urlChat(), "", { wait: "true" }), {
        username: "Foundry", allowed_mentions: { parse: [] },
        embeds: [{ color: 0x2ecc71, title: "✅ Foundry conectado", description: `O chat de **${cortar(game.world.title, 200)}** vai aparecer aqui.` }]
      }));
      if (temSinal()) {
        const id = cfg("sinalMensagemId");
        const base = urlSinal();
        const corpo = { content: textoDoSinal(dadosDoSinal("online")), allowed_mentions: { parse: [] }, username: "Foundry — Sinal" };
        await filaSinal.add(async () => {
          if (id) { try { return await chamar("PATCH", montarUrl(base, `/messages/${id}`), { content: corpo.content }); } catch (err) { if (err.status !== 404) throw err; } }
          const nova = await chamar("POST", montarUrl(base, "", { wait: "true" }), corpo);
          if (nova?.id) await game.settings.set(ID, "sinalMensagemId", nova.id);
        });
      }
      ui.notifications.info("Nauren no Discord: teste enviado. Confira o Discord.");
    } catch (err) {
      console.warn("Nauren no Discord |", err);
      ui.notifications.error(`O teste falhou: ${err.status === 401 || err.status === 404 ? "o link não existe mais no Discord." : err.message}`);
    }
  }

  static async #limpar() {
    await salvarLinks({});
    clearInterval(temporizadorSinal);
    temporizadorSinal = null;
    ui.notifications.info("Nauren no Discord: código apagado deste mundo.");
    this.render();
  }
}

// ------------------------------------------------------------
// Registro
// ------------------------------------------------------------
Hooks.once("init", () => {
  game.settings.register(ID, "links", { scope: "world", config: false, type: String, default: "" });
  game.settings.register(ID, "chat", { scope: "world", config: false, type: Boolean, default: true });
  game.settings.register(ID, "ooc", { scope: "world", config: false, type: Boolean, default: true });
  game.settings.register(ID, "mostrarCena", { scope: "world", config: false, type: Boolean, default: true });
  game.settings.register(ID, "sinalMensagemId", { scope: "world", config: false, type: String, default: "" });
  game.settings.registerMenu(ID, "config", {
    name: "Nauren no Discord", label: "Configurar", icon: "fab fa-discord",
    hint: "Cole o código de conexão do Curador. Só o Mestre vê esta opção.",
    type: ConfigDiscord, restricted: true
  });
});

Hooks.once("ready", () => {
  globalThis.NaurenDiscord = { versao: VERSAO, montarCorpo, dadosDoSinal, enviarSinal, abrir: () => new ConfigDiscord().render(true) };
  if (game.user.isGM && !temChat() && !temSinal()) console.info("Nauren no Discord | Este mundo ainda não tem o código de conexão (Configurações → Configurar opções → Nauren no Discord).");
  setTimeout(ligarSinal, 3000);
  window.addEventListener("pagehide", aoFecharAba);
});

Hooks.on("createChatMessage", msg => { try { aoCriar(msg); } catch (err) { console.warn("Nauren no Discord |", err); } });
Hooks.on("updateChatMessage", (msg, mudancas) => { aoAtualizar(msg, mudancas).catch(err => console.warn("Nauren no Discord |", err)); });
Hooks.on("deleteChatMessage", msg => { aoApagar(msg).catch(() => {}); });

// Sinal na hora quando muda algo que aparece no painel
Hooks.on("userConnected", () => { if (souEmissor()) { sinalEmBreve(); if (!temporizadorSinal) ligarSinal(); } });
Hooks.on("canvasReady", () => { if (souEmissor()) sinalEmBreve(); });
Hooks.on("updateCombat", (_c, m) => { if (souEmissor() && ("round" in m || "turn" in m || "started" in m)) sinalEmBreve(); });
Hooks.on("deleteCombat", () => { if (souEmissor()) sinalEmBreve(); });
Hooks.on("updateScene", (_s, m) => { if (souEmissor() && "active" in m) sinalEmBreve(); });
