import React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "../../lib/utils.js";

const THEMES = { light: "", dark: ".dark" };
const INITIAL_DIMENSION = { width: 320, height: 200 };

export const CHART_COLORS = {
  balance: "var(--chart-balance)",
  income: "var(--chart-income)",
  expense: "var(--chart-expense)",
  danger: "var(--chart-danger)",
  reserve: "var(--chart-reserve)",
  fixed: "var(--chart-fixed)",
  variable: "var(--chart-variable)",
  oneTime: "var(--chart-one-time)",
};

export const CHART_THEME_VARS = {
  "--chart-balance": "#2563eb",
  "--chart-income": "#16a34a",
  "--chart-expense": "#f97316",
  "--chart-danger": "#dc2626",
  "--chart-reserve": "#16a34a",
  "--chart-fixed": "#2563eb",
  "--chart-variable": "#14b8a6",
  "--chart-one-time": "#f59e0b",
};

const ChartContext = React.createContext(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }
  return context;
}

function getPayloadConfigFromPayload(config, payload, key) {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const payloadPayload = "payload" in payload && typeof payload.payload === "object" && payload.payload !== null ? payload.payload : undefined;
  let configLabelKey = key;

  if (key in payload && typeof payload[key] === "string") {
    configLabelKey = payload[key];
  } else if (payloadPayload && key in payloadPayload && typeof payloadPayload[key] === "string") {
    configLabelKey = payloadPayload[key];
  }

  return configLabelKey in config ? config[configLabelKey] : config[key];
}

function ChartStyle({ id, config }) {
  const colorConfig = Object.entries(config || {}).filter(([, itemConfig]) => itemConfig?.theme || itemConfig?.color);

  if (!colorConfig.length) {
    return null;
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color = itemConfig.theme?.[theme] ?? itemConfig.color;
    return color ? `  --color-${key}: ${color};` : null;
  })
  .filter(Boolean)
  .join("\n")}
}
`
          )
          .join("\n"),
      }}
    />
  );
}

export function ChartContainer({ id, className, children, config = {}, initialDimension = INITIAL_DIMENSION, ...props }) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex min-h-[240px] justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension}>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = RechartsPrimitive.Tooltip;
export const ChartLegend = RechartsPrimitive.Legend;

export function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}) {
  const { config } = useChart();
  const formatNumericDisplay = React.useCallback((value) => {
    if (typeof value === "number") {
      return Math.round(value).toLocaleString("zh-TW");
    }
    return String(value);
  }, []);

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) {
      return null;
    }

    const item = payload[0];
    const key = `${labelKey ?? item?.dataKey ?? item?.name ?? "value"}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value = !labelKey && typeof label === "string" ? config[label]?.label ?? label : itemConfig?.label;

    if (labelFormatter) {
      return <div className={cn("font-medium", labelClassName)}>{labelFormatter(value, payload)}</div>;
    }

    if (!value) {
      return null;
    }

    return <div className={cn("font-medium", labelClassName)}>{value}</div>;
  }, [config, hideLabel, label, labelClassName, labelFormatter, labelKey, payload]);

  if (!active || !payload?.length) {
    return null;
  }

  const nestLabel = payload.length === 1 && indicator !== "dot";

  return (
    <div className={cn("grid min-w-32 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl", className)}>
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.type !== "none")
          .map((item, index) => {
            const key = `${nameKey ?? item.name ?? item.dataKey ?? "value"}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor = color ?? item.payload?.fill ?? item.color;
            let formattedValue = item.value;
            let formattedName = itemConfig?.label ?? item.name;

            if (formatter && item?.value !== undefined && item.name) {
              const formatterResult = formatter(item.value, item.name, item, index, item.payload);
              if (React.isValidElement(formatterResult)) {
                return (
                  <div key={index} className={cn("flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground", indicator === "dot" && "items-center")}>
                    {formatterResult}
                  </div>
                );
              }

              if (Array.isArray(formatterResult)) {
                formattedValue = formatterResult[0];
                formattedName = formatterResult[1] ?? formattedName;
              } else if (formatterResult != null) {
                formattedValue = formatterResult;
              }
            }

            return (
              <div key={index} className={cn("flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground", indicator === "dot" && "items-center")}>
                {itemConfig?.icon ? (
                  <itemConfig.icon />
                ) : (
                  !hideIndicator && (
                    <div
                      className={cn("shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)", {
                        "h-2.5 w-2.5": indicator === "dot",
                        "w-1": indicator === "line",
                        "w-0 border-[1.5px] border-dashed bg-transparent": indicator === "dashed",
                        "my-0.5": nestLabel && indicator === "dashed",
                      })}
                      style={{
                        "--color-bg": indicatorColor,
                        "--color-border": indicatorColor,
                      }}
                    />
                  )
                )}
                <div className={cn("flex flex-1 justify-between leading-none", nestLabel ? "items-end" : "items-center")}>
                  <div className="grid gap-1.5">
                    {nestLabel ? tooltipLabel : null}
                    <span className="text-muted-foreground">{formattedName}</span>
                  </div>
                  {formattedValue != null ? (
                    <span className="font-mono font-medium text-foreground tabular-nums">{formatNumericDisplay(formattedValue)}</span>
                  ) : null}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export function ChartLegendContent({ className, hideIcon = false, payload, verticalAlign = "bottom", nameKey }) {
  const { config } = useChart();

  if (!payload?.length) {
    return null;
  }

  return (
    <div className={cn("flex items-center justify-center gap-4", verticalAlign === "top" ? "pb-3" : "pt-3", className)}>
      {payload
        .filter((item) => item.type !== "none")
        .map((item, index) => {
          const key = `${nameKey ?? item.dataKey ?? "value"}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);

          return (
            <div key={index} className="flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground">
              {itemConfig?.icon && !hideIcon ? <itemConfig.icon /> : <div className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />}
              {itemConfig?.label}
            </div>
          );
        })}
    </div>
  );
}

export function ChartSurface({ ariaLabel, height = "clamp(240px, 42vw, 320px)", footer, children, config = {} }) {
  return (
    <div className="rounded-3xl border border-border bg-linear-to-b from-white/92 to-slate-50/92 p-3" role="img" aria-label={ariaLabel}>
      <ChartContainer config={config} className="w-full" style={{ height }}>
        {children}
      </ChartContainer>
      {footer ? <div className="mt-2.5 flex flex-wrap gap-2.5">{footer}</div> : null}
    </div>
  );
}

export function ChartTooltipCard(props) {
  return <ChartTooltipContent {...props} />;
}
