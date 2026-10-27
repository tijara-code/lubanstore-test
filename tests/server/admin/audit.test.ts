import { describe, expect, it } from "vitest";
import { idsOf, summaryOf } from "../../../src/server/domain/admin/audit";

// from test-v329.js / test-v334.js: the summary of a write
describe("the audit summary", () => {
  it("keeps small scalar fields, counts lists, names customer fields without their values", () => {
    const s = summaryOf({ status: "prep", force: true, ids: ["LM-1", "LM-2"], name: "Sara", phone: "+968 9123 4567", city: "Sohar", items: [1, 2, 3], data: { big: 1 }, password: "x" });
    expect(s).toEqual({ status: "prep", force: true, ids: "2 items", name: "(changed)", phone: "(changed)", city: "(changed)", items: "3 items", data: "{…}", password: "(changed)" });
    // a patch: customer fields named "(changed)", the rest masked like a log line
    const p = summaryOf({ patch: { status: "prep", admin_note: "call 96891234567 first", city: "Sohar" } });
    expect(p.patch).toEqual({ status: "prep", admin_note: "call [number] first", city: "(changed)" });
    expect(JSON.stringify(p)).not.toContain("Sohar");
    // what the answer says it did
    expect(summaryOf({ op: "trash" }, { updated: 3 })).toEqual({ op: "trash", "→updated": 3 });
  });

  it("names the ids an action concerns, from the path, the body and the answer", () => {
    expect(idsOf({ id: "LM-1000000001" }, { ids: ["LM-1000000002", "LM-1000000001"] }, { refundId: "rf_1" })).toEqual(["LM-1000000001", "LM-1000000002", "rf_1"]);
    expect(idsOf({}, null, null)).toEqual([]);
  });
});
