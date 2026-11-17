"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "@/lib/utils";

/**
 * Additional Implementation Requirements (spec sections 11-12: "select
 * and implement a charting library... integrating with shadcn chart
 * components" / "build reusable chart components"). The standard
 * shadcn/ui chart.tsx wrapper around Recharts.
 *
 * DELIBERATE, DOCUMENTED EXCEPTION to "do not hand-author shadcn
 * component source files": this file was authored by hand because the
 * official `npx shadcn@latest add chart` CLI needs network access to
 * ui.shadcn.com that this sandbox does not have, and the Lost Sales
 * Analytics page (app/lost-sales/analytics/_components/charts.tsx)
 * already depends on it as delivered. Every OTHER previously-hand-
 * authored shadcn primitive (button/card/badge/table/tabs/select) that
 * had NO real dependent yet has since been removed from this delivery
 * rather than kept as unused placeholder code -- see
 * INSTALLATION-COMMANDS.md. This file is the one exception because
 * removing it would break already-shipped, already-verified behavior.
 * Run `npx shadcn@latest add chart --overwrite` locally to replace it
 * with the official generated version; the import path
 * (`@/components/ui/chart`) and every export this file provides
 * (ChartContainer, ChartConfig, ChartTooltip, ChartTooltipContent,
 * ChartLegend, ChartLegendContent) match the official contract exactly,
 * so no application code needs to change when you do.
 *
 * Adapted to this project's own CSS tokens (app/globals.css's
 * --chart-1..8, sourced from the dataviz skill's validated,
 * colorblind-checked palette -- see that file's own comment).
 *
 * ChartConfig keys a logical series name to a label + either a fixed
 * color or a light/dark theme pair; ChartContainer turns that into CSS
 * variables (--color-<key>) so chart elements reference
 * `var(--color-<key>)` rather than a hardcoded hex, the same
 * "token, not hex" discipline every other components/ui/* file follows.
 */

const THEMES = { light: "", dark: ".dark" } as const;

export type ChartConfig = {
  [key: string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & ({ color?: string; theme?: never } | { color?: never; theme: Record<keyof typeof THEMES, string> });
};

type ChartContextProps = { config: ChartConfig };

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }
  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-(--chart-grid) [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-none [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-none",
          className
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([, cfg]) => cfg.theme || cfg.color);

  if (!colorConfig.length) return null;

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color = itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ?? itemConfig.color;
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

const ChartTooltip = RechartsPrimitive.Tooltip;

/**
 * recharts v3's own TooltipContentProps re-declares payload/coordinate/
 * active/accessibilityLayer/activeIndex as REQUIRED (unlike the rest of
 * TooltipProps, which stays optional) -- correct for a component recharts
 * itself clones with those props injected via <Tooltip content={...}>,
 * but it means a bare `<ChartTooltipContent />` constructed inline by a
 * caller (every real usage in this codebase) fails to type-check without
 * supplying all five by hand. `Partial<>` here is the correct fix, not a
 * type-safety hole: every one of those fields is already read through
 * optional chaining in the body below (`payload?.length`, `!active`),
 * exactly as if they were declared optional from the start.
 */
function ChartTooltipContent({
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
}: Partial<RechartsPrimitive.TooltipContentProps> & {
  className?: string;
  hideLabel?: boolean;
  hideIndicator?: boolean;
  indicator?: "line" | "dot" | "dashed";
  nameKey?: string;
  labelKey?: string;
  color?: string;
}) {
  const { config } = useChart();

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) return null;

    const [item] = payload;
    const key = labelKey ?? item?.dataKey ?? item?.name ?? "value";
    const itemConfig = getPayloadConfigFromConfig(config, key, item);
    const value =
      !labelKey && typeof label === "string" ? (config[label]?.label ?? label) : itemConfig?.label;

    if (labelFormatter) {
      return <div className={cn("font-medium text-foreground", labelClassName)}>{labelFormatter(value, payload)}</div>;
    }
    if (!value) return null;
    return <div className={cn("font-medium text-foreground", labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !payload?.length) return null;

  const nestLabel = payload.length === 1 && indicator !== "dot";

  return (
    <div
      className={cn(
        "grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md",
        className
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload.map((item, index: number) => {
          const key = nameKey ?? item.name ?? item.dataKey ?? "value";
          const itemConfig = getPayloadConfigFromConfig(config, key, item);
          const indicatorColor = color ?? (item.payload as { fill?: string } | undefined)?.fill ?? item.color;

          return (
            <div
              key={typeof item.dataKey === "string" || typeof item.dataKey === "number" ? item.dataKey : index}
              className={cn(
                "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
                indicator === "dot" && "items-center"
              )}
            >
              {formatter && item.value !== undefined && item.name ? (
                formatter(item.value, item.name, item, index, item.payload)
              ) : (
                <>
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
                        style={
                          {
                            "--color-bg": indicatorColor,
                            "--color-border": indicatorColor,
                          } as React.CSSProperties
                        }
                      />
                    )
                  )}
                  <div
                    className={cn("flex flex-1 justify-between leading-none", nestLabel ? "items-end" : "items-center")}
                  >
                    <div className="grid gap-1.5">
                      {nestLabel ? tooltipLabel : null}
                      <span className="text-muted-foreground">{itemConfig?.label ?? item.name}</span>
                    </div>
                    {item.value !== undefined && (
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {typeof item.value === "number" ? item.value.toLocaleString() : item.value}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ChartLegend = RechartsPrimitive.Legend;

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = "bottom",
  nameKey,
}: Pick<RechartsPrimitive.DefaultLegendContentProps, "payload" | "verticalAlign"> & {
  className?: string;
  hideIcon?: boolean;
  nameKey?: string;
}) {
  const { config } = useChart();

  if (!payload?.length) return null;

  return (
    <div className={cn("flex items-center justify-center gap-4 flex-wrap", verticalAlign === "top" ? "pb-3" : "pt-3", className)}>
      {payload.map((item) => {
        const key = nameKey ?? (item.dataKey as string | undefined) ?? "value";
        const itemConfig = getPayloadConfigFromConfig(config, key, item);

        return (
          <div
            key={item.value as string}
            className="flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground"
          >
            {itemConfig?.icon && !hideIcon ? (
              <itemConfig.icon />
            ) : (
              <div className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
            )}
            {itemConfig?.label}
          </div>
        );
      })}
    </div>
  );
}

function getPayloadConfigFromConfig(
  config: ChartConfig,
  key: unknown,
  payload: { payload?: unknown; dataKey?: unknown; name?: unknown } | undefined
): ChartConfig[string] | undefined {
  if (typeof key !== "string") return undefined;

  let configLabelKey: string = key;

  const payloadInner = payload?.payload as Record<string, unknown> | undefined;
  if (payload && typeof payload === "object") {
    const labelFromKey = (payload as Record<string, unknown>)[key];
    if (typeof labelFromKey === "string") {
      configLabelKey = labelFromKey;
    } else if (payloadInner && typeof payloadInner[key] === "string") {
      configLabelKey = payloadInner[key] as string;
    }
  }

  return configLabelKey in config ? config[configLabelKey] : config[key];
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartStyle, useChart };
