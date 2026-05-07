import test from "node:test";
import assert from "node:assert/strict";

import { TEMPLATE_DEFINITIONS } from "./index.js";

test("template definitions keep only the default blank template", () => {
  assert.deepEqual(Object.keys(TEMPLATE_DEFINITIONS), ["current"]);
});
