"use client";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const ADMIN_COLORS = ["#a78bfa", "#60a5fa", "#34d399", "#f472b6", "#fb923c", "#facc15"];

type ChartType = "bar" | "line" | "area" | "donut";

interface DataKey {
  key: string;
  label?: string;
  color?: string;
}

interface AdminChartProps {
  type: ChartType;
  data: Record<string, unknown>[];
  dataKeys: DataKey[];
  xKey?: string;
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  nameKey?: string;
  valueKey?: string;
}

const customTooltipStyle = {
  backgroundColor: "#18181b",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "10px",
  fontSize: "12px",
  color: "#fff",
};

export function AdminChart({
  type,
  data,
  dataKeys,
  xKey = "label",
  height = 200,
  showGrid = true,
  showLegend = false,
  nameKey,
  valueKey,
}: AdminChartProps) {
  if (type === "donut") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={3}
            dataKey={valueKey ?? "value"}
            nameKey={nameKey ?? "name"}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={ADMIN_COLORS[i % ADMIN_COLORS.length]} strokeWidth={0} />
            ))}
          </Pie>
          <Tooltip contentStyle={customTooltipStyle} />
          {showLegend && <Legend />}
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const commonProps = {
    data,
    margin: { top: 0, right: 4, left: -20, bottom: 0 },
  };

  const axisStyle = { fontSize: 11, fill: "rgba(255,255,255,0.35)" };

  if (type === "bar") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart {...commonProps}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />}
          <XAxis dataKey={xKey} tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={customTooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
          {showLegend && <Legend />}
          {dataKeys.map((dk, i) => (
            <Bar
              key={dk.key}
              dataKey={dk.key}
              name={dk.label ?? dk.key}
              fill={dk.color ?? ADMIN_COLORS[i % ADMIN_COLORS.length]}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (type === "area") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart {...commonProps}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />}
          <XAxis dataKey={xKey} tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={customTooltipStyle} />
          {showLegend && <Legend />}
          {dataKeys.map((dk, i) => (
            <Area
              key={dk.key}
              type="monotone"
              dataKey={dk.key}
              name={dk.label ?? dk.key}
              stroke={dk.color ?? ADMIN_COLORS[i % ADMIN_COLORS.length]}
              fill={dk.color ?? ADMIN_COLORS[i % ADMIN_COLORS.length]}
              fillOpacity={0.12}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  // line (default)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart {...commonProps}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />}
        <XAxis dataKey={xKey} tick={axisStyle} axisLine={false} tickLine={false} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={customTooltipStyle} />
        {showLegend && <Legend />}
        {dataKeys.map((dk, i) => (
          <Line
            key={dk.key}
            type="monotone"
            dataKey={dk.key}
            name={dk.label ?? dk.key}
            stroke={dk.color ?? ADMIN_COLORS[i % ADMIN_COLORS.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
