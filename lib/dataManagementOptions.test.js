import test from "node:test";
import assert from "node:assert/strict";

import { DATA_MANAGEMENT_ACTIONS, getImportReplaceNotice } from "./dataManagementOptions.js";

test("data management keeps backup, restore, import, and export actions", () => {
  assert.deepEqual(
    DATA_MANAGEMENT_ACTIONS.map((item) => item.key),
    ["syncBackup", "restoreBackup", "importData", "exportData"],
  );
});

test("import replacement notice no longer advertises undo", () => {
  assert.equal(getImportReplaceNotice(), "匯入會完全取代目前資料。");
});
