import test from "node:test";
import assert from "node:assert/strict";

import { filterItemsByName, normalizeSearchQuery } from "./listSearch.js";

test("normalizeSearchQuery trims and lowercases input", () => {
  assert.equal(normalizeSearchQuery("  Hello "), "hello");
});

test("normalizeSearchQuery returns empty string for non-string input", () => {
  assert.equal(normalizeSearchQuery(undefined), "");
  assert.equal(normalizeSearchQuery(null), "");
  assert.equal(normalizeSearchQuery(42), "");
});

test("filterItemsByName returns the original array when query is empty", () => {
  const items = [{ name: "foo" }, { name: "bar" }];
  assert.equal(filterItemsByName(items, ""), items);
  assert.equal(filterItemsByName(items, "   "), items);
});

test("filterItemsByName filters by substring case-insensitively", () => {
  const items = [{ name: "Salary" }, { name: "Rent" }, { name: "SAVINGS" }];
  assert.deepEqual(
    filterItemsByName(items, "sa").map((item) => item.name),
    ["Salary", "SAVINGS"],
  );
});

test("filterItemsByName handles Chinese names", () => {
  const items = [{ name: "薪水" }, { name: "房租" }, { name: "電費" }];
  assert.deepEqual(filterItemsByName(items, "房"), [{ name: "房租" }]);
});

test("filterItemsByName treats missing or non-string names as empty", () => {
  const items = [{ name: "foo" }, { name: 42 }, { name: null }, {}];
  assert.deepEqual(filterItemsByName(items, "foo"), [{ name: "foo" }]);
  assert.deepEqual(filterItemsByName(items, "anything"), []);
});

test("filterItemsByName returns empty array for non-array input", () => {
  assert.deepEqual(filterItemsByName(null, "x"), []);
  assert.deepEqual(filterItemsByName(undefined, "x"), []);
});
