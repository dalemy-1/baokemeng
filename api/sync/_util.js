export const TABLES = {
  accounts: 'ops_accounts',
  activities: 'ops_activities',
  entries: 'ops_activity_entries',
};

// 不同表的冲突键（upsert 用）
export const CONFLICT = {
  accounts: 'account',          // ops_accounts 主键是 account
  activities: 'id',             // ops_activities 主键是 id
  entries: 'activity_id,account'// ops_activity_entries 组合键
};
