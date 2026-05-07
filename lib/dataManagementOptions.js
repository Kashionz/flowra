export const DATA_MANAGEMENT_ACTIONS = Object.freeze([
  { key: "syncBackup", label: "同步備份" },
  { key: "restoreBackup", label: "還原備份" },
  { key: "importData", label: "匯入資料" },
  { key: "exportData", label: "匯出" },
]);

export function getImportReplaceNotice() {
  return "匯入會完全取代目前資料。";
}
