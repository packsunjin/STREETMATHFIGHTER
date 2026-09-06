// 차트 공통 규칙: "문제 수 / 풀이 횟수"는 전부 정수라서 축 눈금도 정수만 찍고,
// 항목이 한두 개일 때 막대가 슬래브처럼 커지지 않도록 폭 상한을 둔다.

export const MAX_BAR_WIDTH = 72;

/** 0부터 max까지 정수 눈금만 만든다. (0.5, 1.5 같은 눈금 방지) */
export function integerTicks(max: number, desired = 4): number[] {
  const top = Math.max(1, Math.ceil(max));
  const step = Math.max(1, Math.ceil(top / desired));
  const values: number[] = [];
  for (let v = 0; v < top; v += step) values.push(v);
  values.push(top);
  return values;
}

/** integerTicks의 마지막 값 = y축 최대치. 축 위쪽이 눈금과 정확히 맞도록 도메인에 쓴다. */
export function axisMax(max: number, desired = 4): number {
  const ticks = integerTicks(max, desired);
  return ticks[ticks.length - 1];
}

/** 밴드 폭이 너무 넓으면 상한을 씌우고, 남는 자리는 좌우로 나눠 가운데 정렬한다. */
export function bandBar(band: number, bandStart: number, max = MAX_BAR_WIDTH) {
  const width = Math.min(band, max);
  return { x: bandStart + (band - width) / 2, width };
}
