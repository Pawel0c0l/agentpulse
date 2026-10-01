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
 * Operational status for the dashboard. Four live states plus the
 * "completed" bucket for sessions that are no longer active:
 *
 *   error     → lifecycle failed (and not ended)
 *   working   → between prompt/tool start and Stop (`isWorking`)
 *   waiting   → needs the operator: a permission prompt is outstanding, or
 *               the agent finished a turn the user has not acknowledged yet
 *   idle      → alive, not working, latest finished turn acknowledged
 *   completed → ended, completed, or archived — not in the active set
 *
 * Same precedence as the Android widget (`AgentJson.derive`), in order:
 *   1. ended / completed / archived → completed (excluded from the active set);
 *   2. `status === "failed"` → error;
 *   3. `isWorking` → working. The live activity flag is authoritative:
 *      `semanticStatus: "waiting"` / `metadata.permissionWait` can survive
 *      briefly after the agent resumes, so stale wait evidence never keeps a
 *      working session in WAITING;
 *   4. an explicit permission/input wait → waiting. Checked before the
 *      timestamps on purpose: an acknowledgement (`/copy` of an earlier
 *      answer) must not hide a permission prompt that is still open;
 *   5. `lastAgentTurnCompletedAt` set and newer than `lastUserAcknowledgedAt`
 *      (or no acknowledgement yet) → waiting;
 *   6. neither timestamp (row predates the acknowledgement model) → waiting,
 *      conservatively, until a real Stop / prompt / ack stamps the row;
 *   7. otherwise → idle: the acknowledgement is at least as new as the
 *      finished turn (equal counts as acknowledged), or the user prompted
 *      and no turn has finished since.
 *
 * Derived purely from fields the API already returns. `lastActivityAt`,
 * `displayName`, `cwd` and `currentTask` play no part.
 */
export const ACTIVE_OPERATIONAL_STATUSES = ["waiting", "working", "idle", "error"] as const;
export type ActiveOperationalStatus = (typeof ACTIVE_OPERATIONAL_STATUSES)[number];
export type OperationalStatus = ActiveOperationalStatus | "completed";

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
	endedAt: string | null;
	semanticStatus: string | null;
	metadata?: Record<string, unknown> | null;
	lastAgentTurnCompletedAt: string | null;
	lastUserAcknowledgedAt: string | null;
}

/**
 * True when the session belongs to the active operational set: not ended,
 * not completed, not archived. Lifecycle `idle` (inactivity sweep) and
 * `failed` without `endedAt` are still active — they classify as idle/waiting
 * and error respectively.
 */
export function isActiveOperationalSession(
	s: Pick<OperationalStatusInput, "status" | "isArchived" | "endedAt">,
): boolean {
	return !s.isArchived && s.endedAt == null && s.status !== "completed" && s.status !== "archived";
}

/**
 * True when the server recorded an explicit permission/input wait.
 * `semanticStatus: "waiting"` is written by applyPermissionWaitTransition
 * together with `metadata.permissionWait`; either signal counts. Evidence
 * only — whether the session IS waiting is decided by getOperationalStatus,
 * where `isWorking` takes precedence.
 */
export function hasExplicitWait(
	s: Pick<OperationalStatusInput, "semanticStatus" | "metadata">,
): boolean {
	return s.semanticStatus === "waiting" || s.metadata?.permissionWait != null;
}

/** Epoch millis from an ISO timestamp; null for null, empty or unparsable input. */
function parseTime(iso: string | null | undefined): number | null {
	if (!iso) return null;
	const t = Date.parse(iso);
	return Number.isNaN(t) ? null : t;
}

export function getOperationalStatus(s: OperationalStatusInput): OperationalStatus {
	if (!isActiveOperationalSession(s)) return "completed";
	if (s.status === "failed") return "error";
	if (s.isWorking) return "working";
	if (hasExplicitWait(s)) return "waiting";
	const turn = parseTime(s.lastAgentTurnCompletedAt);
	const ack = parseTime(s.lastUserAcknowledgedAt);
	if (turn !== null && (ack === null || turn > ack)) return "waiting";
	// Legacy fallback: no timing data at all. Treat as needing attention
	// rather than silently idle; the next Stop / prompt / ack fixes it.
	if (turn === null && ack === null) return "waiting";
	return "idle";
}

/** True when a human has to act before the session can continue. */
export function needsAttention(s: OperationalStatusInput): boolean {
	const status = getOperationalStatus(s);
	return status === "waiting" || status === "error";
}

/** Per-state counts over the active operational set. Non-active rows are ignored. */
export function countOperationalStatuses(
	sessions: readonly OperationalStatusInput[],
): Record<ActiveOperationalStatus, number> {
	const counts: Record<ActiveOperationalStatus, number> = {
		waiting: 0,
		working: 0,
		idle: 0,
		error: 0,
	};
	for (const s of sessions) {
		const status = getOperationalStatus(s);
		if (status !== "completed") counts[status] += 1;
	}
	return counts;
}

/**
 * Single-select status filter over the active operational set. `null`
 * returns every active session; a status returns only the sessions the
 * classifier puts in that state, so filter, cards and counts always agree.
 */
export function filterByOperationalStatus<T extends OperationalStatusInput>(
	sessions: readonly T[],
	status: ActiveOperationalStatus | null,
): T[] {
	if (status === null) return sessions.filter(isActiveOperationalSession);
	return sessions.filter((s) => getOperationalStatus(s) === status);
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
