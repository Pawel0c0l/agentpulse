import { describe, expect, test } from "bun:test";
import {
	ACTIVE_OPERATIONAL_STATUSES,
	type OperationalStatusInput,
	compareOperational,
	countOperationalStatuses,
	filterByOperationalStatus,
	getOperationalStatus,
	hasExplicitWait,
	isActiveOperationalSession,
	needsAttention,
} from "./session-state.js";

const STOP = "2026-10-01T10:00:00.000Z";
const ACK_LATER = "2026-10-01T10:01:00.000Z";
const ACK_EARLIER = "2026-10-01T09:59:00.000Z";

/** Default fixture: active, not working, both timestamps null (legacy row). */
function make(overrides: Partial<OperationalStatusInput> = {}): OperationalStatusInput {
	return {
		status: "active",
		isWorking: false,
		isArchived: false,
		endedAt: null,
		semanticStatus: null,
		metadata: {},
		lastAgentTurnCompletedAt: null,
		lastUserAcknowledgedAt: null,
		...overrides,
	};
}

const PERMISSION_WAIT = { permissionWait: { ids: ["t1"], anon: 0, prevStatus: null } };

describe("getOperationalStatus — precedence", () => {
	test("ended / completed / archived flag / legacy archived status → completed, even if other flags are stale", () => {
		expect(getOperationalStatus(make({ status: "completed", isWorking: true }))).toBe("completed");
		expect(getOperationalStatus(make({ isArchived: true, semanticStatus: "waiting" }))).toBe(
			"completed",
		);
		expect(getOperationalStatus(make({ status: "archived" }))).toBe("completed");
		// Case G: endedAt alone excludes, whatever the lifecycle status says.
		expect(getOperationalStatus(make({ endedAt: STOP, lastAgentTurnCompletedAt: STOP }))).toBe(
			"completed",
		);
		expect(getOperationalStatus(make({ status: "failed", endedAt: STOP }))).toBe("completed");
	});

	test("failed (not ended) → error, ahead of working and wait evidence", () => {
		expect(getOperationalStatus(make({ status: "failed" }))).toBe("error");
		expect(
			getOperationalStatus(make({ status: "failed", isWorking: true, semanticStatus: "waiting" })),
		).toBe("error");
	});

	test("isWorking=true → working, over stale wait metadata (case A)", () => {
		expect(getOperationalStatus(make({ isWorking: true }))).toBe("working");
		expect(
			getOperationalStatus(
				make({ isWorking: true, semanticStatus: "waiting", metadata: PERMISSION_WAIT }),
			),
		).toBe("working");
		expect(getOperationalStatus(make({ isWorking: true, metadata: PERMISSION_WAIT }))).toBe(
			"working",
		);
	});

	test("isWorking=true → working regardless of timestamps (case D: Stop then UserPromptSubmit)", () => {
		expect(
			getOperationalStatus(
				make({
					isWorking: true,
					lastAgentTurnCompletedAt: STOP,
					lastUserAcknowledgedAt: ACK_LATER,
				}),
			),
		).toBe("working");
		expect(
			getOperationalStatus(
				make({ isWorking: true, lastAgentTurnCompletedAt: STOP, lastUserAcknowledgedAt: null }),
			),
		).toBe("working");
	});

	test("explicit permission/input wait, not working → waiting (semanticStatus or metadata signal)", () => {
		expect(getOperationalStatus(make({ semanticStatus: "waiting" }))).toBe("waiting");
		expect(getOperationalStatus(make({ metadata: PERMISSION_WAIT }))).toBe("waiting");
	});

	test("an acknowledgement does not hide an active permission wait (case E)", () => {
		expect(
			getOperationalStatus(
				make({
					metadata: PERMISSION_WAIT,
					lastAgentTurnCompletedAt: STOP,
					lastUserAcknowledgedAt: ACK_LATER,
				}),
			),
		).toBe("waiting");
		expect(
			getOperationalStatus(
				make({
					semanticStatus: "waiting",
					lastAgentTurnCompletedAt: STOP,
					lastUserAcknowledgedAt: STOP,
				}),
			),
		).toBe("waiting");
	});

	test("Stop newer than ack, or no ack yet → waiting (case B)", () => {
		expect(
			getOperationalStatus(make({ lastAgentTurnCompletedAt: STOP, lastUserAcknowledgedAt: null })),
		).toBe("waiting");
		expect(
			getOperationalStatus(
				make({ lastAgentTurnCompletedAt: STOP, lastUserAcknowledgedAt: ACK_EARLIER }),
			),
		).toBe("waiting");
	});

	test("ack equal to or newer than Stop, not working → idle (case C / UserAcknowledge)", () => {
		expect(
			getOperationalStatus(
				make({ lastAgentTurnCompletedAt: STOP, lastUserAcknowledgedAt: ACK_LATER }),
			),
		).toBe("idle");
		expect(
			getOperationalStatus(make({ lastAgentTurnCompletedAt: STOP, lastUserAcknowledgedAt: STOP })),
		).toBe("idle");
	});

	test("ack only (user prompted, no turn finished since, worker flag cleared) → idle", () => {
		expect(
			getOperationalStatus(
				make({ lastAgentTurnCompletedAt: null, lastUserAcknowledgedAt: ACK_LATER }),
			),
		).toBe("idle");
	});

	test("legacy row: both timestamps null, active, not working → waiting (case F)", () => {
		expect(getOperationalStatus(make())).toBe("waiting");
		expect(getOperationalStatus(make({ status: "idle" }))).toBe("waiting");
		expect(getOperationalStatus(make({ semanticStatus: "planning" }))).toBe("waiting");
	});

	test("unparsable timestamps are treated as absent", () => {
		expect(
			getOperationalStatus(
				make({ lastAgentTurnCompletedAt: "not-a-date", lastUserAcknowledgedAt: ACK_LATER }),
			),
		).toBe("idle");
		expect(
			getOperationalStatus(
				make({ lastAgentTurnCompletedAt: STOP, lastUserAcknowledgedAt: "not-a-date" }),
			),
		).toBe("waiting");
	});

	test("other semantic statuses do not override working/idle", () => {
		expect(getOperationalStatus(make({ isWorking: true, semanticStatus: "implementing" }))).toBe(
			"working",
		);
		expect(
			getOperationalStatus(
				make({
					semanticStatus: "planning",
					lastAgentTurnCompletedAt: STOP,
					lastUserAcknowledgedAt: ACK_LATER,
				}),
			),
		).toBe("idle");
	});

	test("displayName, cwd, currentTask and lastActivityAt play no part", () => {
		const base = { lastAgentTurnCompletedAt: STOP, lastUserAcknowledgedAt: ACK_LATER };
		const idle = make(base);
		const decorated = {
			...make(base),
			displayName: "renamed-owl",
			cwd: "/somewhere/else",
			currentTask: "something new",
			lastActivityAt: "2026-10-01T11:00:00.000Z",
		};
		expect(getOperationalStatus(idle)).toBe("idle");
		expect(getOperationalStatus(decorated)).toBe("idle");

		const waiting = { ...make({ lastAgentTurnCompletedAt: STOP }), lastActivityAt: STOP };
		const bumped = { ...waiting, lastActivityAt: "2026-10-01T12:00:00.000Z" };
		expect(getOperationalStatus(waiting)).toBe("waiting");
		expect(getOperationalStatus(bumped)).toBe("waiting");
	});
});

describe("isActiveOperationalSession / hasExplicitWait", () => {
	test("active set excludes ended, completed, archived; keeps lifecycle idle and failed-not-ended", () => {
		expect(isActiveOperationalSession(make())).toBe(true);
		expect(isActiveOperationalSession(make({ status: "idle" }))).toBe(true);
		expect(isActiveOperationalSession(make({ status: "failed" }))).toBe(true);
		expect(isActiveOperationalSession(make({ endedAt: STOP }))).toBe(false);
		expect(isActiveOperationalSession(make({ status: "completed" }))).toBe(false);
		expect(isActiveOperationalSession(make({ status: "archived" }))).toBe(false);
		expect(isActiveOperationalSession(make({ isArchived: true }))).toBe(false);
	});

	test("explicit wait is evidence only", () => {
		expect(hasExplicitWait(make({ semanticStatus: "waiting" }))).toBe(true);
		expect(hasExplicitWait(make({ metadata: PERMISSION_WAIT }))).toBe(true);
		expect(hasExplicitWait(make({ metadata: { permissionWait: null } }))).toBe(false);
		expect(hasExplicitWait(make({ metadata: null }))).toBe(false);
		expect(hasExplicitWait(make({ semanticStatus: "planning" }))).toBe(false);
	});
});

describe("needsAttention", () => {
	test("only waiting and error need the operator", () => {
		expect(needsAttention(make({ semanticStatus: "waiting" }))).toBe(true);
		expect(needsAttention(make({ lastAgentTurnCompletedAt: STOP }))).toBe(true);
		expect(needsAttention(make({ status: "failed" }))).toBe(true);
		expect(needsAttention(make({ isWorking: true }))).toBe(false);
		expect(
			needsAttention(make({ lastAgentTurnCompletedAt: STOP, lastUserAcknowledgedAt: ACK_LATER })),
		).toBe(false);
		expect(needsAttention(make({ status: "completed" }))).toBe(false);
	});
});

describe("countOperationalStatuses / filterByOperationalStatus", () => {
	const fleet = [
		make({ isWorking: true }), // working
		make({ isWorking: true, semanticStatus: "waiting", metadata: PERMISSION_WAIT }), // working (A)
		make({ lastAgentTurnCompletedAt: STOP }), // waiting (B)
		make({ metadata: PERMISSION_WAIT, lastUserAcknowledgedAt: ACK_LATER }), // waiting (E)
		make(), // waiting (F, legacy)
		make({ lastAgentTurnCompletedAt: STOP, lastUserAcknowledgedAt: ACK_LATER }), // idle (C)
		make({ lastAgentTurnCompletedAt: STOP, lastUserAcknowledgedAt: STOP }), // idle (equal)
		make({ status: "failed" }), // error
		make({ endedAt: STOP }), // excluded (G)
		make({ status: "completed" }), // excluded
		make({ isArchived: true, lastAgentTurnCompletedAt: STOP }), // excluded
	];

	test("counts cover the four states over the active set only, including idle", () => {
		expect(countOperationalStatuses(fleet)).toEqual({
			waiting: 3,
			working: 2,
			idle: 2,
			error: 1,
		});
		expect(ACTIVE_OPERATIONAL_STATUSES).toEqual(["waiting", "working", "idle", "error"]);
	});

	test("null filter → all active sessions; a status → exactly the rows the classifier puts there", () => {
		const all = filterByOperationalStatus(fleet, null);
		expect(all).toHaveLength(8);
		expect(all.every(isActiveOperationalSession)).toBe(true);

		const counts = countOperationalStatuses(fleet);
		for (const status of ACTIVE_OPERATIONAL_STATUSES) {
			const rows = filterByOperationalStatus(fleet, status);
			expect(rows).toHaveLength(counts[status]);
			expect(rows.every((s) => getOperationalStatus(s) === status)).toBe(true);
		}
		// The four buckets partition the active set — no row is counted twice or dropped.
		const total = ACTIVE_OPERATIONAL_STATUSES.reduce((n, s) => n + counts[s], 0);
		expect(total).toBe(all.length);
	});
});

describe("compareOperational", () => {
	test("orders waiting, error, working, idle, completed; recency breaks ties", () => {
		const t = (iso: string, o: Partial<OperationalStatusInput>) => ({
			...make(o),
			lastActivityAt: iso,
		});
		const list = [
			t("2026-01-01T00:00:05Z", { status: "completed" }),
			t("2026-01-01T00:00:01Z", { isWorking: true }),
			t("2026-01-01T00:00:09Z", { isWorking: true }),
			t("2026-01-01T00:00:02Z", { lastAgentTurnCompletedAt: STOP, lastUserAcknowledgedAt: STOP }),
			t("2026-01-01T00:00:03Z", { status: "failed" }),
			t("2026-01-01T00:00:00Z", { semanticStatus: "waiting" }),
		];
		const ordered = [...list].sort(compareOperational).map((s) => getOperationalStatus(s));
		expect(ordered).toEqual(["waiting", "error", "working", "working", "idle", "completed"]);
		const working = [...list].sort(compareOperational).filter((s) => s.isWorking);
		expect(working[0].lastActivityAt).toBe("2026-01-01T00:00:09Z");
	});
});
