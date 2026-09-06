import { ParentSize } from '@visx/responsive';
import { scaleBand, scaleLinear } from '@visx/scale';
import { Group } from '@visx/group';
import { GridRows } from '@visx/grid';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip';
import { localPoint } from '@visx/event';
import { motion } from 'motion/react';
import { formatDay, type DailyActivity } from '../lib/stats';
import { axisMax, bandBar, integerTicks } from '../lib/chart';

const margin = { top: 16, right: 16, bottom: 32, left: 36 };

// 하루치 막대를 "맞힘(초록) 위에 틀림(회색)"으로 쌓아, 푼 양과 정답 비율을 한눈에.
function Chart({ data, width, height }: { data: DailyActivity[]; width: number; height: number }) {
  const innerWidth = Math.max(width - margin.left - margin.right, 0);
  const innerHeight = Math.max(height - margin.top - margin.bottom, 0);

  const xScale = scaleBand<string>({
    domain: data.map((d) => d.day),
    range: [0, innerWidth],
    padding: 0.3,
  });
  const maxTotal = Math.max(1, ...data.map((d) => d.total));
  const tickValues = integerTicks(maxTotal);
  const yScale = scaleLinear<number>({
    domain: [0, axisMax(maxTotal)],
    range: [innerHeight, 0],
  });

  const { tooltipData, tooltipLeft, tooltipTop, tooltipOpen, showTooltip, hideTooltip } =
    useTooltip<DailyActivity>();

  // 폭이 좁으면 날짜 라벨이 겹쳐서 읽을 수 없으니 몇 칸씩 건너뛰며 찍는다.
  const xTickStep = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerWidth / 44))));

  if (width < 10) return null;

  return (
    <div className="relative">
      <svg width={width} height={height}>
        <Group left={margin.left} top={margin.top}>
          <GridRows scale={yScale} width={innerWidth} stroke="var(--border)" tickValues={tickValues} />
          {data.map((d) => {
            const { x: barX, width: barWidth } = bandBar(xScale.bandwidth(), xScale(d.day) ?? 0, 40);
            const totalHeight = innerHeight - yScale(d.total);
            const correctHeight = innerHeight - yScale(d.correct);
            const onMove = (event: React.MouseEvent<SVGRectElement>) => {
              const point = localPoint(event) ?? { x: 0, y: 0 };
              showTooltip({ tooltipData: d, tooltipLeft: point.x, tooltipTop: point.y });
            };
            return (
              <Group key={d.day} onMouseMove={onMove} onMouseLeave={hideTooltip}>
                <motion.rect
                  x={barX}
                  width={barWidth}
                  rx={5}
                  fill="var(--border)"
                  initial={{ height: 0, y: innerHeight }}
                  animate={{ height: totalHeight, y: innerHeight - totalHeight }}
                  transition={{ type: 'spring', stiffness: 170, damping: 22 }}
                />
                <motion.rect
                  x={barX}
                  width={barWidth}
                  rx={5}
                  fill="#16a34a"
                  initial={{ height: 0, y: innerHeight }}
                  animate={{ height: correctHeight, y: innerHeight - correctHeight }}
                  transition={{ type: 'spring', stiffness: 170, damping: 22, delay: 0.05 }}
                />
              </Group>
            );
          })}
          <AxisBottom
            top={innerHeight}
            scale={xScale}
            stroke="var(--text-secondary)"
            tickStroke="var(--text-secondary)"
            tickValues={data.filter((_, i) => i % xTickStep === 0).map((d) => d.day)}
            tickFormat={(day) => formatDay(String(day))}
            tickLabelProps={() => ({
              fill: 'var(--text-secondary)',
              fontSize: 11,
              fontWeight: 600,
              textAnchor: 'middle',
              dy: 4,
            })}
          />
          <AxisLeft
            scale={yScale}
            tickValues={tickValues}
            tickFormat={(value) => String(value)}
            stroke="var(--text-secondary)"
            tickStroke="var(--text-secondary)"
            tickLabelProps={() => ({
              fill: 'var(--text-secondary)',
              fontSize: 11,
              textAnchor: 'end',
              dx: -4,
              dy: 4,
            })}
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
          {formatDay(tooltipData.day)} · {tooltipData.correct}/{tooltipData.total}문제 정답
        </TooltipWithBounds>
      )}
    </div>
  );
}

export function ActivityChart({ data, height = 220 }: { data: DailyActivity[]; height?: number }) {
  return (
    <div style={{ width: '100%', height }}>
      <ParentSize>{({ width, height }) => <Chart data={data} width={width} height={height} />}</ParentSize>
    </div>
  );
}
