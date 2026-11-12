import * as fs from "node:fs";
import * as path from "node:path";

type Dificuldade = "facil" | "medio" | "dificil";
type Estado = "menu" | "corrida" | "nome" | "fim";
interface Carro { id: number; nome: string; prog: number; lat: number; vel: number; max: number; alvoLat: number; fim: number; humano: boolean; }
interface Registro { nome: string; pontos: number; dif: Dificuldade; }

// Mundo (mesmas medidas da versão canvas 900x560) -> grade de texto 90x28
const CX = 450, CY = 280, RX = 340, RY = 200, L = 1650, VOLTAS = 5, LAT_MAX = 70;
const COLS = 90, ROWS = 28, CW = 10, CH = 20;
const velAI: Record<Dificuldade, [number, number]> = { facil: [150, 195], medio: [185, 225], dificil: [215, 250] };
// ---------- carros em pixel art ----------
// Cada caractere do terminal vira 2 pixels na vertical (▀ e ▄ com cor de frente e de fundo).
// B = lataria, W = vidro, T = pneu, H = farol, "." = transparente. O carro "olha" para a direita.
type RGB = [number, number, number];
const BASE = [
  ".TBBT.",
  "BBWWBH",
  "BBWWBH",
  ".TBBT.",
].map(l => l.split(""));
// gira a matriz 90° no sentido horário
const girar = (m: string[][]) => m[0].map((_, i) => m.map((_, j) => m[m.length - 1 - j][i]));
const SPR: string[][][] = [BASE];
for (let i = 1; i < 4; i++) SPR.push(girar(SPR[i - 1])); // 0 = direita, 1 = baixo, 2 = esquerda, 3 = cima

// cor da lataria de cada carro (índice 6 = você, em branco)
const LATARIA: RGB[] = [[231, 76, 60], [52, 152, 219], [241, 196, 15], [155, 89, 182], [230, 126, 34], [26, 188, 156], [255, 255, 255], [46, 204, 113]];
const PISTA_RGB: RGB = [88, 88, 88], GRAMA_RGB: RGB = [0, 95, 0];
const fg = (c: RGB) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
const bg = (c: RGB) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
const corPixel = (p: string, corpo: RGB): RGB | null =>
  p === "B" ? corpo : p === "W" ? [140, 200, 255] : p === "T" ? [25, 25, 25] : p === "H" ? [255, 240, 120] : null;

function desenharCarro(c: Carro): string {
  const { x, y } = coord(c);
  // direção do movimento -> escolhe o sprite virado para onde o carro anda
  const a = (c.prog / L) * Math.PI * 2;
  const dx = -(RX + c.lat) * Math.sin(a), dy = (RY + c.lat) * Math.cos(a);
  const idx = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 2)) % 4) + 4) % 4;
  const m = SPR[idx], h = m.length, w = m[0].length;
  const esq = Math.round(x / CW - w / 2), topo = Math.round(y / CH - h / 4);
  let s = "";
  for (let r = 0; r < h; r += 2) {
    for (let k = 0; k < w; k++) {
      const t = corPixel(m[r][k], LATARIA[c.id]), b = corPixel(m[r + 1][k], LATARIA[c.id]);
      if (!t && !b) continue;
      const row = topo + r / 2, col = esq + k;
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS) continue;
      const fundo = pista[row][col] ? PISTA_RGB : GRAMA_RGB;
      const cursor = `\x1b[${row + 1};${col + 1}H`;
      if (t && b) s += cursor + fg(t) + bg(b) + "▀" + RESET;
      else if (t) s += cursor + fg(t) + bg(fundo) + "▀" + RESET;
      else s += cursor + fg(b!) + bg(fundo) + "▄" + RESET;
    }
  }
  return s;
}
const RANK_FILE = path.join(process.cwd(), "corrida_rank.json");

let estado: Estado = "menu";
let dif: Dificuldade = "medio";
let carros: Carro[] = [];
let tempo = 0, ultimasColisao = 0, msg = "", msgT = 0;
let colisoes = 0, ultsos = 0, posAnterior = 7, posFinal = 0, pontosFinais = 0, avisoTop = "";
let nomeDigitado = "";
const seguraW = { t: 0 }, seguraS = { t: 0 }; // terminal não tem "tecla solta": simulamos "segurar"
const agora = () => Date.now() / 1000;

const rank = (): Registro[] => {
  try { return JSON.parse(fs.readFileSync(RANK_FILE, "utf8")); } catch { return []; }
};

// ---------- pista pré-calculada ----------
const pista: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
for (let a = 0; a < Math.PI * 2; a += 0.002) {
  for (let lat = -85; lat <= 85; lat += 2) {
    const x = CX + (RX + lat) * Math.cos(a), y = CY + (RY + lat) * Math.sin(a);
    const c = Math.floor(x / CW), r = Math.floor(y / CH);
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) pista[r][c] = true;
  }
}

// ---------- lógica ----------
function iniciar(d: Dificuldade): void {
  dif = d; carros = []; tempo = 0; colisoes = 0; ultsos = 0; msg = ""; avisoTop = ""; ultimasColisao = 0;
  const [a, b] = velAI[d];
  for (let i = 0; i < 8; i++) {
    const humano = i === 6; // 7º lugar na largada
    carros.push({
      id: i, nome: humano ? "Você" : "Carro " + (i + 1),
      prog: -i * 30, lat: i % 2 ? 28 : -28, vel: 0, humano,
      max: humano ? 235 : a + Math.random() * (b - a), alvoLat: i % 2 ? 28 : -28, fim: 0,
    });
  }
  posAnterior = 7; estado = "corrida";
}

function posicoes(): Carro[] {
  return [...carros].sort((x, y) => (x.fim && y.fim ? x.fim - y.fim : x.fim ? -1 : y.fim ? 1 : y.prog - x.prog));
}
const posDe = (c: Carro) => posicoes().indexOf(c) + 1;
const pontosAtuais = () => Math.max(0, ultsos * 100 - colisoes * 25);

function coord(c: Carro) {
  const a = (c.prog / L) * Math.PI * 2;
  return { x: CX + (RX + c.lat) * Math.cos(a), y: CY + (RY + c.lat) * Math.sin(a) };
}

function atualizar(dt: number): void {
  tempo += dt;
  const eu = carros[6];
  const t = agora();
  for (const c of carros) {
    if (c.humano) {
      if (!eu.fim) {
        if (t < seguraW.t) c.vel += 130 * dt;
        else if (t < seguraS.t) c.vel -= 220 * dt;
        else c.vel -= 45 * dt;
      } else c.vel -= 80 * dt;
      c.vel = Math.max(0, Math.min(c.max, c.vel));
      c.lat = Math.max(-LAT_MAX, Math.min(LAT_MAX, c.lat));
    } else {
      if (Math.random() < dt * 0.6) c.alvoLat = (Math.random() * 2 - 1) * LAT_MAX;
      c.lat += Math.sign(c.alvoLat - c.lat) * Math.min(Math.abs(c.alvoLat - c.lat), 40 * dt);
      const alvo = c.max * (0.93 + 0.07 * Math.sin(tempo * 0.8 + c.id));
      c.vel += (alvo - c.vel) * Math.min(1, dt * 1.5);
    }
    c.prog += c.vel * dt;
    if (!c.fim && c.prog >= VOLTAS * L) c.fim = tempo;
  }
  if (!eu.fim && tempo - ultimasColisao > 0.7) {
    const pe = coord(eu);
    for (const o of carros) {
      if (o.humano) continue;
      const po = coord(o);
      if (Math.hypot(pe.x - po.x, pe.y - po.y) < 20) {
        ultimasColisao = tempo; colisoes++;
        msg = "💥 Você colidiu com o " + o.nome + "!"; msgT = 1.6;
        eu.vel *= 0.45; o.vel *= 0.8;
        eu.lat += eu.lat >= o.lat ? 14 : -14;
        break;
      }
    }
  }
  const p = posDe(eu);
  if (p < posAnterior) ultsos += posAnterior - p;
  posAnterior = p;
  if (msgT > 0) msgT -= dt;
  if (eu.fim) terminar();
}

function terminar(): void {
  posFinal = posicoes().indexOf(carros[6]) + 1;
  pontosFinais = pontosAtuais() + (8 - posFinal) * 200 + Math.max(0, Math.round((150 - tempo) * 5));
  nomeDigitado = "";
  estado = posFinal === 1 ? "nome" : "fim";
}

function salvarNome(): void {
  const nome = nomeDigitado.trim().slice(0, 16) || "Anônimo";
  const lista = rank(); lista.push({ nome, pontos: pontosFinais, dif });
  lista.sort((a, b) => b.pontos - a.pontos);
  try { fs.writeFileSync(RANK_FILE, JSON.stringify(lista.slice(0, 20))); } catch { /* ignora */ }
  avisoTop = lista[0].nome === nome && lista[0].pontos === pontosFinais ? `🏆 ${nome} é o TOP 1 do ranking!` : `${nome} entrou no ranking.`;
  estado = "fim";
}

// ---------- desenho ----------
const RESET = "\x1b[0m";
function textoRank(): string {
  const r = rank().slice(0, 5);
  return r.length ? r.map((x, i) => `  ${i + 1}. ${x.nome} — ${x.pontos} pts (${x.dif})`).join("\n") : "  Ainda ninguém no ranking.";
}

function tela(s: string): void { process.stdout.write("\x1b[H\x1b[2J" + s); }

function desenhar(): void {
  if (estado === "menu") {
    tela(`\n  === CORRIDA (terminal) ===\n\n  Escolha a dificuldade:\n    [1] Fácil\n    [2] Médio\n    [3] Difícil\n\n  Controles: W acelera · S freia · A/D lados · Q volta ao menu · Ctrl+C sai\n\n  Ranking:\n${textoRank()}\n`);
    return;
  }
  if (estado === "nome") {
    tela(`\n  Você terminou em ${posFinal}º lugar! Pontos: ${pontosFinais}\n\n  🏆 Você foi o 1º! Digite seu nome e tecle Enter:\n  > ${nomeDigitado}█\n`);
    return;
  }
  if (estado === "fim") {
    tela(`\n  Você terminou em ${posFinal}º lugar! Pontos: ${pontosFinais}\n  ${avisoTop}\n\n  Ranking:\n${textoRank()}\n\n  Tecle Q para voltar ao menu.\n`);
    return;
  }

  // grade: estilo por célula
  const chars: string[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(" "));
  const estilo: string[][] = Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) => (pista[r][c] ? "\x1b[48;5;240m" : "\x1b[48;5;22m")));
  // linha de chegada
  const fr = Math.floor(CY / CH);
  for (let c = Math.floor((CX + RX - 85) / CW); c <= Math.floor((CX + RX + 85) / CW); c++) {
    if (c >= 0 && c < COLS) { chars[fr][c] = "▒"; estilo[fr][c] = "\x1b[97;48;5;240m"; }
  }
  let out = "\x1b[H";
  for (let r = 0; r < ROWS; r++) {
    let linha = "";
    for (let c = 0; c < COLS; c++) linha += estilo[r][c] + chars[r][c];
    out += linha + RESET + "\x1b[K\n";
  }
  // carros em pixel art, desenhados por cima da pista (você por último, fica na frente)
  let sprites = "";
  for (const c of [...carros].sort((a, b) => (a.humano ? 1 : 0) - (b.humano ? 1 : 0))) sprites += desenharCarro(c);
  const eu = carros[6];
  const volta = Math.min(VOLTAS, Math.max(1, Math.floor(eu.prog / L) + 1));
  const ordem = posicoes().map((c, i) => `${i + 1}.${c.humano ? "VOCÊ" : c.nome.replace("Carro ", "C")}`).join("  ");
  out += ` Posição: ${posDe(eu)}º/8   Volta: ${volta}/${VOLTAS}   Pontos: ${pontosAtuais()}   Tempo: ${tempo.toFixed(1)}s (${dif})\x1b[K\n`;
  out += ` ${ordem}\x1b[K\n`;
  out += ` W acelera · S freia · A/D lados · Q menu   (carro branco = você)\x1b[K\n`;
  out += msgT > 0 ? ` \x1b[91m${msg}\x1b[0m\x1b[K\n` : "\x1b[K\n";
  process.stdout.write(out + sprites);
}

// ---------- entrada ----------
function sair(): void {
  process.stdout.write("\x1b[?25h\x1b[?1049l");
  process.exit(0);
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (k: string) => {
  if (k === "\x03") return sair(); // Ctrl+C
  if (estado === "nome") {
    if (k === "\r" || k === "\n") salvarNome();
    else if (k === "\x7f" || k === "\b") nomeDigitado = nomeDigitado.slice(0, -1);
    else if (k.length === 1 && k >= " " && nomeDigitado.length < 16) nomeDigitado += k;
    return;
  }
  const tk = k.toLowerCase();
  if (tk === "q") { estado = "menu"; carros = []; return; }
  if (estado === "menu") {
    if (tk === "1") iniciar("facil");
    else if (tk === "2") iniciar("medio");
    else if (tk === "3") iniciar("dificil");
    return;
  }
  if (estado === "corrida" && !carros[6].fim) {
    const eu = carros[6];
    if (tk === "w") seguraW.t = agora() + 0.4;
    else if (tk === "s") seguraS.t = agora() + 0.4;
    else if (tk === "a") eu.lat = Math.max(-LAT_MAX, eu.lat - 14);
    else if (tk === "d") eu.lat = Math.min(LAT_MAX, eu.lat + 14);
  }
});

// ---------- loop ----------
process.stdout.write("\x1b[?1049h\x1b[?25l"); // tela alternativa + esconde cursor
process.on("exit", () => process.stdout.write("\x1b[?25h\x1b[?1049l"));
let ultimo = Date.now();
setInterval(() => {
  const n = Date.now();
  const dt = Math.min(0.05, (n - ultimo) / 1000);
  ultimo = n;
  if (estado === "corrida") atualizar(dt);
  desenhar();
}, 33);
