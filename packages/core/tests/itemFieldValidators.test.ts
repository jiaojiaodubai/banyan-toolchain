import { assert } from "chai";
import { runInNewContext } from "node:vm";
import { createStyleMessageReporter } from "../src/messages";
import {
  normalizeItemFieldValidators,
  runItemFieldValidators,
} from "../src/validation/itemFieldValidators";
import type { FieldValidator } from "../src/types/style";
import { createIdentitySandboxContext } from "./helpers/sandboxContext";

const context = createIdentitySandboxContext();

const item = {
  id: "1",
  itemType: "book",
  title: "T",
  date: "2024",
  creators: [],
} as never;

describe("item field validator normalization", function () {
  const normalize = (raw: unknown) =>
    normalizeItemFieldValidators(raw, context, createStyleMessageReporter());

  it("normalizes item-type groups and trims descriptions", async function () {
    const result = normalize({
      book: [
        {
          description: "  标题  ",
          check: (value: { title?: string }) => value.title === "T",
        },
        { description: "日期", check: () => "缺日期" },
      ],
      journalArticle: [{ description: "文章", check: () => true }],
    });

    assert.deepEqual(Object.keys(result ?? {}), ["book", "journalArticle"]);
    assert.equal(result?.book?.[0].description, "标题");
    assert.isFunction(result?.book?.[0].check);
    assert.isTrue(await result!.book![0].check(item));
    assert.equal(await result!.book![1].check(item), "缺日期");
  });

  it("drops unknown types, non-arrays, and broken checkers", function () {
    const reporter = createStyleMessageReporter();
    const result = normalizeItemFieldValidators(
      {
        bogus: [{ description: "x", check: () => true }],
        book: [
          { description: "", check: () => true },
          { description: "no check" },
          "not an object",
          { description: "ok", check: () => true },
        ],
        journalArticle: [],
      },
      context,
      reporter,
    );

    assert.deepEqual(Object.keys(result ?? {}), ["book"]);
    assert.deepEqual(
      result?.book?.map((validator) => validator.description),
      ["ok"],
    );
    assert.lengthOf(reporter.diagnostics, 5);
    assert.equal(
      reporter.diagnostics.at(-1)?.finding?.diagnosticId,
      "validator.group.empty",
    );
  });

  it("rejects a top-level array or non-object", function () {
    for (const raw of [[], "book", 42]) {
      assert.isUndefined(normalize(raw));
    }
  });

  it("returns undefined for no declaration", function () {
    assert.isUndefined(normalize(undefined));
    assert.isUndefined(normalize(null));
    assert.isUndefined(normalize({}));
  });

  it("treats item type names as case-sensitive", function () {
    const result = normalize({
      Book: [{ description: "wrong case", check: () => true }],
      book: [{ description: "right case", check: () => true }],
    });

    assert.deepEqual(
      result?.book?.map((validator) => validator.description),
      ["right case"],
    );
  });
});

describe("item field validator execution", function () {
  const run = async (rawValidators: unknown[], timeoutMs?: number) => {
    const normalized = normalizeItemFieldValidators(
      { book: rawValidators },
      context,
      createStyleMessageReporter(),
    );
    assert.isDefined(normalized?.book);
    return runItemFieldValidators(
      normalized!.book!,
      item,
      timeoutMs ? { timeoutMs } : undefined,
    );
  };

  it("normalizes every documented result shape", async function () {
    const validators: FieldValidator[] = [
      { description: "pass", check: () => true },
      { description: "fail", check: () => false },
      { description: "message", check: () => "  缺标题  " },
      {
        description: "messages",
        check: async () => ["缺日期", " 缺语言 "],
      },
      { description: "empty array", check: () => [] },
    ];

    assert.deepEqual(await run(validators), [
      { description: "pass", status: "pass", messages: [] },
      { description: "fail", status: "fail", messages: [] },
      { description: "message", status: "fail", messages: ["缺标题"] },
      {
        description: "messages",
        status: "fail",
        messages: ["缺日期", "缺语言"],
      },
      { description: "empty array", status: "pass", messages: [] },
    ]);
  });

  it("awaits async checks and isolates thrown, invalid, and timed-out results", async function () {
    const validators: FieldValidator[] = [
      {
        description: "throw",
        check: () => {
          throw new Error("boom");
        },
      },
      { description: "promise", check: async () => true },
      { description: "number", check: (() => 42) as never },
      { description: "empty string", check: (() => "  ") as never },
      {
        description: "bad array",
        check: (() => ["ok", ""]) as never,
      },
      {
        description: "reject",
        check: async () => {
          throw new Error("rejected");
        },
      },
      {
        description: "timeout",
        check: () =>
          new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(true), 100);
          }),
      },
      { description: "still runs", check: () => true },
    ];

    const entries = await run(validators, 15);
    assert.deepEqual(
      entries.map((entry) => [entry.description, entry.status, entry.error]),
      [
        ["throw", "error", "thrown"],
        ["promise", "pass", undefined],
        ["number", "error", "invalid-result"],
        ["empty string", "error", "invalid-result"],
        ["bad array", "error", "invalid-result"],
        ["reject", "error", "thrown"],
        ["timeout", "error", "timeout"],
        ["still runs", "pass", undefined],
      ],
    );
    assert.deepEqual(entries[0].messages, ["boom"]);
    assert.deepEqual(entries[5].messages, ["rejected"]);
    assert.deepEqual(entries[6].messages, []);

    const crossRealm = runInNewContext('new Error("cross-realm boom")');
    const renamed = await runItemFieldValidators(
      [
        {
          description: "cross-realm",
          check: () => {
            throw crossRealm;
          },
        },
      ],
      item,
    );
    assert.deepEqual(renamed[0].messages, ["cross-realm boom"]);
    assert.notMatch(renamed[0].messages[0], /^Error:/);
  });

  it("hands the checker a snapshot of the item", async function () {
    let seenTitle = "";
    const validator: FieldValidator = {
      description: "read title",
      check: (value) => {
        seenTitle = String(value.title ?? "");
        return true;
      },
    };

    await run([validator]);
    assert.equal(seenTitle, "T");
  });

  it("returns no entries for no validators", async function () {
    assert.deepEqual(await runItemFieldValidators([], item), []);
  });

  it("rejects a non-positive timeout budget", async function () {
    let thrown: unknown;
    try {
      await runItemFieldValidators([], item, { timeoutMs: 0 });
    } catch (error) {
      thrown = error;
    }
    assert.instanceOf(thrown, RangeError);
  });
});
