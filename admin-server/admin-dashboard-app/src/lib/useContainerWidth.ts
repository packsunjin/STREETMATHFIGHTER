import { useEffect, useRef, useState } from 'react';

/**
 * 부모의 "폭만" 재는 훅.
 * @visx/responsive의 ParentSize는 측정용 div가 position:absolute라서 부모에 높이가
 * 정해져 있어야 하는데, 높이를 내용에 맡기고 폭만 알고 싶은 차트에는 맞지 않는다.
 */
export function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - next) < 1 ? prev : next));
    });
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
