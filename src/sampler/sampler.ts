/**
 * Amostrador de parâmetros (Atividade 2.2).
 * PRNG determinístico por semente (mulberry32) + distribuições usadas na matriz de
 * rastreabilidade (uniforme, uniforme inteira, Beta via Gamma de Marsaglia-Tsang,
 * categórica, log-normal). Nada daqui é enviado ao LLM.
 */

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  /** U(0,1) — mulberry32 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  uniform(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, max: number): number {
    return Math.floor(this.uniform(min, max + 1));
  }
  bernoulli(p: number): boolean {
    return this.next() < p;
  }
  normal(): number {
    // Box-Muller
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  gamma(shape: number): number {
    if (shape < 1) {
      const u = this.next();
      return this.gamma(1 + shape) * Math.pow(u, 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number, v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.next();
      if (u < 1 - 0.0331 * x ** 4) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  beta(a: number, b: number): number {
    const x = this.gamma(a);
    const y = this.gamma(b);
    return x / (x + y);
  }
  lognormal(sigma: number): number {
    // mediana 1, dispersão sigma
    return Math.exp(sigma * this.normal());
  }
  categorical<T extends string>(weights: Record<T, number>): T {
    const entries = Object.entries(weights) as [T, number][];
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [k, w] of entries) {
      r -= w;
      if (r <= 0) return k;
    }
    return entries[entries.length - 1][0];
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

export type Dist =
  | { type: "uniform"; min: number; max: number }
  | { type: "uniform_int"; min: number; max: number }
  | { type: "beta"; a: number; b: number }
  | { type: "categorical"; values: Record<string, number> };

export function draw(rng: Rng, d: Dist): number | string {
  switch (d.type) {
    case "uniform":
      return rng.uniform(d.min, d.max);
    case "uniform_int":
      return rng.int(d.min, d.max);
    case "beta":
      return rng.beta(d.a, d.b);
    case "categorical":
      return rng.categorical(d.values);
  }
}

/** Parâmetros comportamentais θ sorteados para UMA execução (persona). */
export interface PersonaParams {
  buffer_k: number;
  p_enq: number;
  rho: number;
  theta: number;
  r_verif: number;
  q_accept: number;
  experience: string;
  p_at: number;
  p_slip: number;
  hesitation_sigma: number;
  capture_limit: number;
}

export interface Distributions {
  buffer_k: Dist;
  p_enq: Dist;
  rho: Dist;
  theta: Dist;
  r_verif: Dist;
  q_accept: Dist;
  experience: Dist;
  p_at: Record<string, Dist>;
  p_slip: Dist;
  hesitation_sigma: Dist;
  capture_limit: Dist;
}

export function sampleParams(rng: Rng, d: Distributions): PersonaParams {
  const experience = draw(rng, d.experience) as string;
  return {
    buffer_k: draw(rng, d.buffer_k) as number,
    p_enq: draw(rng, d.p_enq) as number,
    rho: draw(rng, d.rho) as number,
    theta: draw(rng, d.theta) as number,
    r_verif: draw(rng, d.r_verif) as number,
    q_accept: draw(rng, d.q_accept) as number,
    experience,
    p_at: draw(rng, d.p_at[experience]) as number,
    p_slip: draw(rng, d.p_slip) as number,
    hesitation_sigma: draw(rng, d.hesitation_sigma) as number,
    capture_limit: draw(rng, d.capture_limit) as number,
  };
}
