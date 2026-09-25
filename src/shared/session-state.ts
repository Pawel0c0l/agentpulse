/**
 * Canonical archive-state predicates for session listings.
 *
 * `sessions.isArchived` is the single persisted truth for archival state.
 * `sessions.status` was historically a second write path (frontend wrote
 * `status='archived'` as an optimistic update), but as of Slice G that
 * write is gone. The `'archived'` literal remains in the `SessionStatus`
 * union for backwards-compat with any rows predating this slice; new code
 * never reads or writes that value as the archive signal.
 *
 * Use `isVisibleSession` everywhere a list/filter wants to exclude archived
 * sessions.  Use `isArchivedSession` for the inverse (e.g. the Archived tab).
 */

/**
 * Returns true when the session should appear in ordinary (non-archived)
 * listings.  Structural typing so both full `Session` objects and Drizzle
 * projection shapes (which only select `{ isArchived }`) satisfy it.
 */
export function isVisibleSession(s: { isArchived: boolean }): boolean {
	return !s.isArchived;
}

/**
 * Returns true when the session belongs in the "Archived" view.
 * Inverse of isVisibleSession — keep both to avoid accidental negation bugs
 * at call sites.
 */
export function isArchivedSession(s: { isArchived: boolean }): boolean {
	return s.isArchived;
}

/**
 * Operational status for the dashboard. Five plain words that answer
 * "what is working right now, and which agent needs me?":
 *
 *   waiting   → blocked on a permission prompt (needs the operator)
 *   error     → lifecycle failed
 *   working   → between prompt/tool start and Stop
 *   idle      → alive but not working (turn finished, or timed out to idle)
 *   completed → ended, or archived
 *
 * Derived purely from fields the API already returns; nothing new is persisted.
 */
export type OperationalStatus = "waiting" | "error" | "working" | "idle" | "completed";

/** Lower rank sorts first: attention-needing sessions, then working, then the rest. */
export const OPERATIONAL_STATUS_RANK: Record<OperationalStatus, number> = {
	waiting: 0,
	error: 1,
	working: 2,
	idle: 3,
	completed: 4,
};

/** Structural input so both API `Session` rows and test fixtures satisfy it. */
export interface OperationalStatusInput {
	status: string;
	isWorking: boolean;
	isArchived: boolean;
	semanticStatus: string | null;
	metadata?: Record<string, unknown> | null;
}

export function getOperationalStatus(s: OperationalStatusInput): OperationalStatus {
	if (s.isArchived || s.status === "completed" || s.status === "archived") return "completed";
	if (s.status === "failed") return "error";
	// `semanticStatus: "waiting"` is written by applyPermissionWaitTransition
	// together with `metadata.permissionWait`; either signal means a permission
	// prompt is outstanding.
	if (s.semanticStatus === "waiting" || s.metadata?.permissionWait != null) return "waiting";
	if (s.isWorking) return "working";
	return "idle";
}

/** True when a human has to act before the session can continue. */
export function needsAttention(s: OperationalStatusInput): boolean {
	const status = getOperationalStatus(s);
	return status === "waiting" || status === "error";
}

/** Sort comparator: attention first, then working, then idle, then completed; ties by recency. */
export function compareOperational(
	a: OperationalStatusInput & { lastActivityAt: string },
	b: OperationalStatusInput & { lastActivityAt: string },
): number {
	const rankDiff =
		OPERATIONAL_STATUS_RANK[getOperationalStatus(a)] -
		OPERATIONAL_STATUS_RANK[getOperationalStatus(b)];
	if (rankDiff !== 0) return rankDiff;
	return Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
}
