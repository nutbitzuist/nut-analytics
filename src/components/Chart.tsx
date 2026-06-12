"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { t: number; visitors: number; pageviews: number };

export default function Chart({ data, hourly }: { data: Point[]; hourly: boolean }) {
  const fmt = (t: number) => {
    const d = new Date(t);
    return hourly
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="gVisitors" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gPageviews" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#ffffff14" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={fmt}
            stroke="#ffffff40"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
          />
          <YAxis stroke="#ffffff40" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            labelFormatter={(t) => fmt(Number(t))}
            contentStyle={{
              background: "#16161d",
              border: "1px solid #ffffff1f",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="pageviews"
            name="Pageviews"
            stroke="#60a5fa"
            strokeWidth={1.5}
            fill="url(#gPageviews)"
          />
          <Area
            type="monotone"
            dataKey="visitors"
            name="Visitors"
            stroke="#34d399"
            strokeWidth={2}
            fill="url(#gVisitors)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
