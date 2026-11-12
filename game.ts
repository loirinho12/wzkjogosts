type Dificuldade = "facil" | "medio" | "dificil";
type Estado = "menu" | "corrida" | "fim";
interface Carro { id: number; nome: string; cor: string; prog: number; lat: number; vel: number; max: number; alvoLat: number; fim: number; humano: boolean; }
interface Registro { nome: string; pontos: number; dif: Dificuldade; }

const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const CX = 450, CY = 280, RX = 340, RY = 200, L = 1650, VOLTAS = 5, LAT_MAX = 70;
const velAI: Record<Dificuldade, [number, number]> = { facil: [150, 195], medio: [185, 225], dificil: [215, 250] };
const cores = ["#e74c3c", "#3498db", "#f1c40f", "#9b59b6", "#e67e22", "#1abc9c", "#2ecc71", "#ecf0f1"];
const teclas: Record<string, boolean> = {};

let estado: Estado = "menu";
let dif: Dificuldade = "medio";
let carros: Carro[] = [];
let tempo = 0, ultimo = 0, ultimasColisao = 0, msg = "", msgT = 0;
let colisoes = 0, ultsos = 0, posAnterior = 7, posFinal = 0, pontosFinais = 0, avisoTop = "";

const el = (id: string) => document.getElementById(id) as HTMLElement;
const rank = (): Registro[] => JSON.parse(localStorage.getItem("corrida_rank") || "[]");

function iniciar(d: Dificuldade): void {
  dif = d; carros = []; tempo = 0; colisoes = 0; ultsos = 0; msg = ""; avisoTop = "";
  const [a, b] = velAI[d];
  for (let i = 0; i < 8; i++) {
    const humano = i === 6; // 7º lugar na largada
    carros.push({
      id: i, nome: humano ? "Você" : "Carro " + (i + 1), cor: humano ? "#ffffff" : cores[i],
      prog: -i * 30, lat: i % 2 ? 28 : -28, vel: 0, humano,
      max: humano ? 235 : a + Math.random() * (b - a), alvoLat: i % 2 ? 28 : -28, fim: 0,
    });
  }
  posAnterior = 7; estado = "corrida";
  el("menu").style.display = "none"; el("fim").style.display = "none";
}

function posicoes(): Carro[] {
  return [...carros].sort((x, y) => (x.fim && y.fim ? x.fim - y.fim : x.fim ? -1 : y.fim ? 1 : y.prog - x.prog));
}
const posDe = (c: Carro) => posicoes().indexOf(c) + 1;
const pontosAtuais = () => Math.max(0, ultsos * 100 - colisoes * 25);

function coord(c: Carro): { x: number; y: number; ang: number } {
  const a = (c.prog / L) * Math.PI * 2;
  return {
    x: CX + (RX + c.lat) * Math.cos(a), y: CY + (RY + c.lat) * Math.sin(a),
    ang: Math.atan2(RY * Math.cos(a), -RX * Math.sin(a)),
  };
}

function atualizar(dt: number): void {
  tempo += dt;
  const eu = carros[6];
  for (const c of carros) {
    if (c.humano) {
      if (!eu.fim) {
        if (teclas["w"]) c.vel += 130 * dt;
        else if (teclas["s"]) c.vel -= 220 * dt;
        else c.vel -= 45 * dt;
        if (teclas["a"]) c.lat -= 110 * dt;
        if (teclas["d"]) c.lat += 110 * dt;
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
  // colisões (só com o jogador)
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
  estado = "fim";
  posFinal = posicoes().indexOf(carros[6]) + 1;
  pontosFinais = pontosAtuais() + (8 - posFinal) * 200 + Math.max(0, Math.round((150 - tempo) * 5));
  el("fim-txt").textContent = `Você terminou em ${posFinal}º lugar! Pontos: ${pontosFinais}`;
  el("nome-box").style.display = posFinal === 1 ? "block" : "none";
  el("fim").style.display = "flex";
  mostrarRank();
}

function mostrarRank(): void {
  const r = rank().slice(0, 5);
  el("rank").innerHTML = r.length
    ? r.map((x, i) => `${i + 1}. ${x.nome} — ${x.pontos} pts (${x.dif})`).join("<br>")
    : "Ainda ninguém no ranking.";
  el("top1").textContent = avisoTop;
}

function salvarNome(): void {
  const input = el("nome") as HTMLInputElement;
  const nome = input.value.trim().slice(0, 16) || "Anônimo";
  const lista = rank(); lista.push({ nome, pontos: pontosFinais, dif });
  lista.sort((a, b) => b.pontos - a.pontos);
  localStorage.setItem("corrida_rank", JSON.stringify(lista.slice(0, 20)));
  avisoTop = lista[0].nome === nome && lista[0].pontos === pontosFinais ? `🏆 ${nome} é o TOP 1 do ranking!` : `${nome} entrou no ranking.`;
  el("nome-box").style.display = "none";
  mostrarRank();
}

function desenhar(): void {
  ctx.fillStyle = "#2d6a2d"; ctx.fillRect(0, 0, 900, 560);
  ctx.strokeStyle = "#444"; ctx.lineWidth = 170;
  ctx.beginPath(); ctx.ellipse(CX, CY, RX, RY, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(CX + RX - 85, CY); ctx.lineTo(CX + RX + 85, CY); ctx.stroke();
  for (const c of carros) {
    const { x, y, ang } = coord(c);
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = c.cor; ctx.fillRect(-14, -7, 28, 14);
    ctx.fillStyle = "#000"; ctx.fillRect(2, -5, 6, 10);
    if (c.humano) { ctx.strokeStyle = "#f00"; ctx.lineWidth = 2; ctx.strokeRect(-15, -8, 30, 16); }
    ctx.restore();
  }
  if (estado === "menu") return;
  const eu = carros[6];
  const volta = Math.min(VOLTAS, Math.max(1, Math.floor(eu.prog / L) + 1));
  ctx.fillStyle = "#fff"; ctx.font = "bold 18px sans-serif"; ctx.textAlign = "left";
  ctx.fillText(`Posição: ${posDe(eu)}º / 8`, 20, 28);
  ctx.fillText(`Volta: ${volta}/${VOLTAS}`, 20, 52);
  ctx.fillText(`Pontos: ${pontosAtuais()}`, 20, 76);
  ctx.fillText(`Tempo: ${tempo.toFixed(1)}s  (${dif})`, 20, 100);
  ctx.font = "14px sans-serif";
  posicoes().forEach((c, i) => { ctx.fillStyle = c.humano ? "#ff0" : "#fff"; ctx.fillText(`${i + 1}. ${c.nome}`, 780, 28 + i * 18); });
  ctx.fillStyle = "#ccc"; ctx.fillText("W acelera · S freia · A/D lados · Q reinicia", 280, 545);
  if (msgT > 0) { ctx.fillStyle = "#ff5252"; ctx.font = "bold 26px sans-serif"; ctx.textAlign = "center"; ctx.fillText(msg, CX, 70); }
}

function loop(t: number): void {
  const dt = Math.min(0.05, (t - ultimo) / 1000 || 0); ultimo = t;
  if (estado === "corrida") atualizar(dt);
  desenhar();
  requestAnimationFrame(loop);
}

function menu(): void {
  estado = "menu"; carros = [];
  el("menu").style.display = "flex"; el("fim").style.display = "none";
}

window.addEventListener("keydown", (e: KeyboardEvent) => {
  if ((e.target as HTMLElement).tagName === "INPUT") return;
  const k = e.key.toLowerCase(); teclas[k] = true;
  if (k === "q") menu(); // Q reinicia (volta ao menu para escolher a dificuldade)
});
window.addEventListener("keyup", (e: KeyboardEvent) => { teclas[e.key.toLowerCase()] = false; });
document.querySelectorAll<HTMLButtonElement>("[data-dif]").forEach(b =>
  b.addEventListener("click", () => iniciar(b.dataset.dif as Dificuldade)));
el("salvar").addEventListener("click", salvarNome);
requestAnimationFrame(loop);
