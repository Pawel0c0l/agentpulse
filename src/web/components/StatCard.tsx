import { cn } from "../lib/utils.js";

/**
 * StatCard — reusable KPI tile used by DashboardPage and DigestPage.
 *
 * Props:
 *   label    — short descriptor rendered above the value
 *   value    — the primary number or string
 *   sub      — optional secondary line below the value (DashboardPage usage)
 *   tone     — optional color override: "warn" (amber), "danger" (red),
 *              "success" (emerald) or "muted" (low-attention slate).
 *              Default is "default" (foreground color). DigestPage uses
 *              warn/danger to flag blocked / stuck counts; the dashboard's
 *              operational status cards use all four.
 *   onClick  — when set, the tile renders as a toggle button (used by the
 *              dashboard's single-select status filter)
 *   selected — pressed state of that toggle; also drives the highlight ring
 */
export function StatCard({
	label,
	value,
	sub,
	tone = "default",
	onClick,
	selected = false,
}: {
	label: string;
	value: string | number;
	sub?: string;
	tone?: "default" | "warn" | "danger" | "success" | "muted";
	onClick?: () => void;
	selected?: boolean;
}) {
	const toneClass =
		tone === "warn"
			? "text-amber-300"
			: tone === "danger"
				? "text-red-300"
				: tone === "success"
					? "text-emerald-400"
					: tone === "muted"
						? "text-slate-400"
						: "text-foreground";
	const body = (
		<>
			<p className="text-xs text-muted-foreground mb-1">{label}</p>
			<p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
			{sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
		</>
	);
	const frame = "rounded-lg border bg-card p-4";
	if (onClick) {
		return (
			<button
				type="button"
				aria-pressed={selected}
				onClick={onClick}
				className={cn(
					frame,
					"w-full text-left transition-colors hover:bg-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
					selected ? "border-primary/40 ring-1 ring-primary/30" : "border-border",
				)}
			>
				{body}
			</button>
		);
	}
	return <div className={cn(frame, "border-border")}>{body}</div>;
}
