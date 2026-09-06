import { ParentSize } from '@visx/responsive';
import { scaleBand, scaleLinear } from '@visx/scale';
import { Group } from '@visx/group';
import { GridRows } from '@visx/grid';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip';
import { localPoint } from '@visx/event';
import { motion } from 'motion/react';
import { DIFFICULTY_COLOR, DIFFICULTY_LABEL, type Difficulty } from '../lib/theme';
import { axisMax, bandBar, integerTicks } from '../lib/chart';

export interface DifficultyCount {
  difficulty: Difficulty;
  count: number;
}

const margin = { top: 16, right: 16, bottom: 32, left: 36 };

function Chart({ data, width, height }: { data: DifficultyCount[]; width: number; height: number }) {
  const innerWidth = Math.max(width - margin.left - margin.right, 0);
  const innerHeight = Math.max(height - margin.top - margin.bottom, 0);

  const xScale = scaleBand<string>({
    domain: data.map((d) => d.difficulty),
    range: [0, innerWidth],
    padding: 0.35,
  });
  const maxCount = Math.max(1, ...data.map((d) => d.count));
  const tickValues = integerTicks(maxCount);
  const yScale = scaleLinear<number>({
    domain: [0, axisMax(maxCount)],
    range: [innerHeight, 0],
  });

  const { tooltipData, tooltipLeft, tooltipTop, tooltipOpen, showTooltip, hideTooltip } =
    useTooltip<DifficultyCount>();

  if (width < 10) return null;

  return (
    <div className="relative">
      <svg width={width} height={height}>
        <Group left={margin.left} top={margin.top}>
          <GridRows scale={yScale} width={innerWidth} stroke="var(--border)" tickValues={tickValues} />
          {data.map((d) => {
            const { x: barX, width: barWidth } = bandBar(xScale.bandwidth(), xScale(d.difficulty) ?? 0);
            const barHeight = innerHeight - yScale(d.count);
            const barY = innerHeight - barHeight;
            return (
              <motion.rect
                key={d.difficulty}
                x={barX}
                width={barWidth}
                rx={6}
                fill={DIFFICULTY_COLOR[d.difficulty]}
                style={{ cursor: 'pointer' }}
                initial={{ height: 0, y: innerHeight }}
                animate={{ height: barHeight, y: barY }}
                whileHover={{ opacity: 0.82 }}
                transition={{ type: 'spring', stiffness: 170, damping: 22 }}
                onMouseMove={(event) => {
                  const point = localPoint(event) ?? { x: 0, y: 0 };
                  showTooltip({ tooltipData: d, tooltipLeft: point.x, tooltipTop: point.y });
                }}
                onMouseLeave={hideTooltip}
              />
            );
          })}
          <AxisBottom
            top={innerHeight}
            scale={xScale}
            stroke="var(--text-secondary)"
            tickStroke="var(--text-secondary)"
            tickLabelProps={() => ({ fill: 'var(--text)', fontSize: 13, fontWeight: 700, textAnchor: 'middle', dy: 4 })}
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
          {DIFFICULTY_LABEL[tooltipData.difficulty]}: {tooltipData.count}문제
        </TooltipWithBounds>
      )}
    </div>
  );
}

export function SimpleBarChart({ data, height = 240 }: { data: DifficultyCount[]; height?: number }) {
  return (
    <div style={{ width: '100%', height }}>
      <ParentSize>{({ width, height }) => <Chart data={data} width={width} height={height} />}</ParentSize>
    </div>
  );
}
