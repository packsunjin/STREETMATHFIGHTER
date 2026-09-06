import { scaleBand, scaleLinear, scaleOrdinal } from '@visx/scale';
import { Group } from '@visx/group';
import { GridRows } from '@visx/grid';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { BarStack } from '@visx/shape';
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip';
import { localPoint } from '@visx/event';
import { motion } from 'motion/react';
import { DIFFICULTY_COLOR, DIFFICULTY_LABEL, type Difficulty } from '../lib/theme';
import { axisMax, bandBar, integerTicks } from '../lib/chart';
import { useContainerWidth } from '../lib/useContainerWidth';

export interface UnitCount {
  unit: string;
  상: number;
  중: number;
  하: number;
  total: number;
}

const STACK_KEYS: Difficulty[] = ['하', '중', '상']; // 쉬운 문제가 아래, 어려운 문제가 위로 쌓임
const margin = { top: 16, right: 16, bottom: 44, left: 36 };
const BAR_SLOT_WIDTH = 84;

interface TooltipDatum {
  unit: string;
  key: Difficulty;
  value: number;
}

// 단원이 많으면 가로 스크롤, 적으면 가진 폭을 꽉 채운다.
function Chart({ data, height, available }: { data: UnitCount[]; height: number; available: number }) {
  const width = Math.max(data.length * BAR_SLOT_WIDTH, available, 360);
  const innerWidth = Math.max(width - margin.left - margin.right, 0);
  const innerHeight = Math.max(height - margin.top - margin.bottom, 0);

  const xScale = scaleBand<string>({
    domain: data.map((d) => d.unit),
    range: [0, innerWidth],
    padding: 0.35,
  });
  const maxTotal = Math.max(1, ...data.map((d) => d.total));
  const tickValues = integerTicks(maxTotal);
  const yScale = scaleLinear<number>({
    domain: [0, axisMax(maxTotal)],
    range: [innerHeight, 0],
  });
  const colorScale = scaleOrdinal<Difficulty, string>({
    domain: STACK_KEYS,
    range: STACK_KEYS.map((k) => DIFFICULTY_COLOR[k]),
  });

  const { tooltipData, tooltipLeft, tooltipTop, tooltipOpen, showTooltip, hideTooltip } =
    useTooltip<TooltipDatum>();

  return (
    <div className="relative">
      <svg width={width} height={height}>
        <Group left={margin.left} top={margin.top}>
          <GridRows scale={yScale} width={innerWidth} stroke="var(--border)" tickValues={tickValues} />
          <BarStack<UnitCount, Difficulty>
            data={data}
            keys={STACK_KEYS}
            x={(d) => d.unit}
            xScale={xScale}
            yScale={yScale}
            color={colorScale}
          >
            {(barStacks) =>
              barStacks.map((barStack) =>
                barStack.bars.map((bar) => {
                  const slot = bandBar(bar.width, bar.x);
                  return (
                  <motion.rect
                    key={`bar-${barStack.index}-${bar.index}`}
                    x={slot.x}
                    width={slot.width}
                    fill={bar.color}
                    style={{ cursor: 'pointer' }}
                    initial={{ height: 0, y: innerHeight }}
                    animate={{ height: bar.height, y: bar.y }}
                    whileHover={{ opacity: 0.82 }}
                    transition={{
                      type: 'spring',
                      stiffness: 170,
                      damping: 24,
                      delay: bar.index * 0.04,
                    }}
                    onMouseMove={(event) => {
                      const point = localPoint(event) ?? { x: 0, y: 0 };
                      const value = (bar.bar.data as UnitCount)[barStack.key];
                      showTooltip({
                        tooltipData: { unit: bar.bar.data.unit, key: barStack.key, value },
                        tooltipLeft: point.x,
                        tooltipTop: point.y,
                      });
                    }}
                    onMouseLeave={hideTooltip}
                  />
                  );
                })
              )
            }
          </BarStack>
          <AxisBottom
            top={innerHeight}
            scale={xScale}
            stroke="var(--text-secondary)"
            tickStroke="var(--text-secondary)"
            tickLabelProps={() => ({ fill: 'var(--text)', fontSize: 12, fontWeight: 600, textAnchor: 'middle', dy: 4 })}
          />
          <AxisLeft
            scale={yScale}
            tickValues={tickValues}
            tickFormat={(value) => String(value)}
            stroke="var(--text-secondary)"
            tickStroke="var(--text-secondary)"
            tickLabelProps={() => ({ fill: 'var(--text-secondary)', fontSize: 11, textAnchor: 'end', dx: -4, dy: 4 })}
          />
        </Group>
      </svg>
      {tooltipOpen && tooltipData && (
        <TooltipWithBounds
          left={tooltipLeft}
          top={tooltipTop}
          style={{
            ...defaultStyles,
            background: 'var(--text)',
            color: '#fff',
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {tooltipData.unit} · {DIFFICULTY_LABEL[tooltipData.key]}: {tooltipData.value}문제
        </TooltipWithBounds>
      )}
    </div>
  );
}

export function StackedBarChart({ data, height = 280 }: { data: UnitCount[]; height?: number }) {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  return (
    <div ref={ref} className="w-full overflow-x-auto">
      <Chart data={data} height={height} available={width} />
    </div>
  );
}

export function StackedBarLegend() {
  return (
    <div className="flex items-center gap-4 text-xs font-semibold text-[var(--text-secondary)]">
      {STACK_KEYS.slice()
        .reverse()
        .map((key) => (
          <span key={key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: DIFFICULTY_COLOR[key] }}
            />
            {DIFFICULTY_LABEL[key]}
          </span>
        ))}
    </div>
  );
}
