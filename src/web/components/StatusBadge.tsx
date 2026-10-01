import { cn } from "../lib/utils.js";

const STATUS_STYLES: Record<string, { bg: string; text: string; dot?: string; glow?: string }> = {
	active: {
		bg: "bg-emerald-500/12",
		text: "text-emerald-400",
		dot: "bg-emerald-400",
		glow: "glow-status-active",
	},
	// "idle" is shared by the lifecycle status and the operational status
	// (acknowledged, nothing to do). Neutral slate on purpose: visibly distinct
	// from WORKING (emerald) but lower-attention than WAITING / ERROR.
	idle: { bg: "bg-slate-500/12", text: "text-slate-400", dot: "bg-slate-400" },
	completed: { bg: "bg-slate-500/12", text: "text-slate-400" },
	failed: { bg: "bg-red-500/12", text: "text-red-400" },
	archived: { bg: "bg-zinc-500/10", text: "text-zinc-500" },
	// Operational statuses (see shared/session-state.ts getOperationalStatus).
	// Attention order: error (strongest) > waiting (needs me) > working > idle.
	working: {
		bg: "bg-emerald-500/12",
		text: "text-emerald-400",
		dot: "bg-emerald-400",
		glow: "glow-status-active",
	},
	waiting: {
		bg: "bg-amber-500/15",
		text: "text-amber-300",
		dot: "bg-amber-400",
		glow: "glow-status-active",
	},
	error: { bg: "bg-red-500/12", text: "text-red-400" },
};

/** Statuses that render the pulsing live dot. */
const LIVE_STATUSES = new Set(["active", "working", "waiting"]);

const SEMANTIC_STYLES: Record<string, { bg: string; text: string }> = {
	researching: { bg: "bg-blue-500/12", text: "text-blue-400" },
	implementing: { bg: "bg-emerald-500/12", text: "text-emerald-400" },
	testing: { bg: "bg-purple-500/12", text: "text-purple-400" },
	debugging: { bg: "bg-orange-500/12", text: "text-orange-400" },
	reviewing: { bg: "bg-cyan-500/12", text: "text-cyan-400" },
	documenting: { bg: "bg-teal-500/12", text: "text-teal-400" },
	planning: { bg: "bg-indigo-500/12", text: "text-indigo-400" },
	waiting: { bg: "bg-amber-500/12", text: "text-amber-400" },
};

interface StatusBadgeProps {
	status: string;
	variant?: "session" | "semantic";
	className?: string;
}

export function StatusBadge({ status, variant = "session", className }: StatusBadgeProps) {
	const styles =
		variant === "semantic"
			? SEMANTIC_STYLES[status] || { bg: "bg-slate-500/12", text: "text-slate-400" }
			: STATUS_STYLES[status] || { bg: "bg-slate-500/12", text: "text-slate-400" };

	const sessionStyle = variant === "session" ? STATUS_STYLES[status] : undefined;
	const isActive = LIVE_STATUSES.has(status);

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[11px] font-semibold tracking-wide uppercase border",
				styles.bg,
				styles.text,
				"border-current/10",
				sessionStyle?.glow,
				className,
			)}
		>
			{isActive && sessionStyle?.dot && (
				<span className={cn("h-1.5 w-1.5 rounded-full animate-pulse-dot", sessionStyle.dot)} />
			)}
			{status}
		</span>
	);
}
