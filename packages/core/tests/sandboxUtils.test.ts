import { assert } from "chai";
import { runtimeFormatDate, runtimeSafeRecord } from "../src/sandbox/utilities";

describe("sandbox value utilities", function () {
  it("offers a readonly record view that ignores writes", function () {
    const source = { text: "a", count: 2, nested: {} };
    const record = runtimeSafeRecord(source);

    assert.equal(record.text, "a");
    assert.equal(record.count, "2");
    assert.equal(record.nested, "");
    assert.equal(record.missing, "");

    // Style scripts are strict mode: a throwing write would abort them.
    record.text = "changed";
    assert.equal(record.text, "a");
    assert.equal(source.text, "a");

    // Deleting is a write too; the view promises silent ignoring, not a throw.
    delete record.text;
    assert.equal(record.text, "a");
    assert.equal(source.text, "a");
  });
});

describe("sandbox date utility", function () {
  const format = (parts: { year: string; month: string; day: string }) =>
    [parts.year, parts.month, parts.day].filter(Boolean).join("-");

  it("formats externally supplied date values", function () {
    assert.equal(runtimeFormatDate("2024-05-06", format), "2024-05-06");
    assert.equal(
      runtimeFormatDate("2024-05-06T12:30:00Z", format),
      "2024-05-06",
    );
    assert.equal(
      runtimeFormatDate("2024-05-06 12:30:00", format),
      "2024-05-06",
    );
    assert.equal(runtimeFormatDate("20240506", format), "2024-05-06");
    assert.equal(runtimeFormatDate("2024-05", format), "2024-05");
    assert.equal(runtimeFormatDate("2024", format), "2024");
    assert.equal(runtimeFormatDate("05/06/2024", format), "2024-05-06");
    assert.equal(runtimeFormatDate("6 May 2024", format), "2024-05-06");
    assert.equal(runtimeFormatDate("May 6, 2024", format), "2024-05-06");
    assert.equal(runtimeFormatDate("2024年5月6日", format), "2024-05-06");
    assert.equal(runtimeFormatDate(Date.UTC(2024, 4, 6), format), "2024-05-06");
  });

  it("preserves empty fallback values", function () {
    assert.equal(runtimeFormatDate("", format), "");
  });

  it("returns unsupported CSL date forms unchanged", function () {
    assert.equal(runtimeFormatDate("2020-2021", format), "2020-2021");
    assert.equal(runtimeFormatDate("Summer 2020", format), "Summer 2020");
    assert.equal(runtimeFormatDate("44 BCE", format), "44 BCE");
    assert.equal(runtimeFormatDate("2024-02-30", format), "2024-02-30");
  });
});
