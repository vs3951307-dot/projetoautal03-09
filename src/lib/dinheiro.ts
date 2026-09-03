/**
 * Utilitários monetários — evita erro clássico de float (0.1+0.2).
 * Valores de domínio continuam em reais (number); toda operação passa
 * por centavos inteiros e volta com 2 casas.
 */

/** Converte reais → centavos inteiros (arredondamento bancário simples). */
export function paraCentavos(reais: number): number {
  return Math.round((Number(reais) || 0) * 100);
}

/** Converte centavos inteiros → reais com 2 casas. */
export function deCentavos(centavos: number): number {
  return Math.round(Number(centavos) || 0) / 100;
}

/** Arredonda valor em reais para 2 casas de forma segura. */
export function arredondarDinheiro(reais: number): number {
  return deCentavos(paraCentavos(reais));
}

/** Soma lista de valores em reais sem acumular erro de float. */
export function somarDinheiro(...valores: number[]): number {
  const totalCentavos = valores.reduce((acc, v) => acc + paraCentavos(v), 0);
  return deCentavos(totalCentavos);
}

/** Multiplica reais × quantidade usando centavos. */
export function multiplicarDinheiro(reais: number, quantidade: number): number {
  return deCentavos(paraCentavos(reais) * (Number(quantidade) || 0));
}
