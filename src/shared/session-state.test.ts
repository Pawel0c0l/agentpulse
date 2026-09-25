import { describe, expect, test } from "bun:test";
import {
	type OperationalStatusInput,
	compareOperational,
	getOperationalStatus,
	needsAttention,
} from "./session-state.js";

function make(overrides: Partial<OperationalStatusInput> = {}): OperationalStatusInput {
	return {
		status: "active",
		isWorking: false,
		isArchived: false,
		semanticStatus: null,
		metadata: {},
		...overrides,
	};
}

describe("getOperationalStatus", () => {
	test("active + isWorking → working", () => {
		expect(getOperationalStatus(make({ isWorking: true }))).toBe("working");
	});

	test("active, not working → idle; lifecycle idle → idle", () => {
		expect(getOperationalStatus(make())).toBe("idle");
		expect(getOperationalStatus(make({ status: "idle" }))).toBe("idle");
	});

	test("permission wait beats working (semanticStatus or metadata signal)", () => {
		expect(getOperationalStatus(make({ isWorking: true, semanticStatus: "waiting" }))).toBe(
			"waiting",
		);
		expect(
			getOperationalStatus(
				make({ isWorking: true, metadata: { permissionWait: { ids: ["t1"], anon: 0 } } }),
			),
		).toBe("waiting");
	});

	test("other semantic statuses do not override working/idle", () => {
		expect(getOperationalStatus(make({ isWorking: true, semanticStatus: "implementing" }))).toBe(
			"working",
		);
		expect(getOperationalStatus(make({ semanticStatus: "planning" }))).toBe("idle");
	});

	test("failed → error", () => {
		expect(getOperationalStatus(make({ status: "failed" }))).toBe("error");
	});

	test("completed / archived flag / legacy archived status → completed, even if flags are stale", () => {
		expect(getOperationalStatus(make({ status: "completed", isWorking: true }))).toBe("completed");
		expect(getOperationalStatus(make({ isArchived: true, semanticStatus: "waiting" }))).toBe(
			"completed",
		);
		expect(getOperationalStatus(make({ status: "archived" }))).toBe("completed");
	});
});

describe("needsAttention", () => {
	test("only waiting and error need the operator", () => {
		expect(needsAttention(make({ semanticStatus: "waiting" }))).toBe(true);
		expect(needsAttention(make({ status: "failed" }))).toBe(true);
		expect(needsAttention(make({ isWorking: true }))).toBe(false);
		expect(needsAttention(make({ status: "completed" }))).toBe(false);
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
			t("2026-01-01T00:00:02Z", {}),
			t("2026-01-01T00:00:03Z", { status: "failed" }),
			t("2026-01-01T00:00:00Z", { semanticStatus: "waiting" }),
		];
		const ordered = [...list].sort(compareOperational).map((s) => getOperationalStatus(s));
		expect(ordered).toEqual(["waiting", "error", "working", "working", "idle", "completed"]);
		const working = [...list].sort(compareOperational).filter((s) => s.isWorking);
		expect(working[0].lastActivityAt).toBe("2026-01-01T00:00:09Z");
	});
});
